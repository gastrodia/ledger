import { sql } from "@/lib/db";

/** One atomic upgrade; no financial rows or existing execution results are rewritten. */
export const eventReceiptMigration = `DO $migration$
BEGIN
  PERFORM pg_advisory_xact_lock(1818584946, 3);
  ALTER TABLE assistant_actions ADD COLUMN IF NOT EXISTS event_id VARCHAR(36);
  ALTER TABLE assistant_actions ADD COLUMN IF NOT EXISTS event_revision INTEGER;

  IF to_regclass('public.ledger_events') IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM ledger_events e WHERE NOT EXISTS (
      SELECT 1 FROM assistant_actions a WHERE a.user_id=e.user_id AND a.status='succeeded'
        AND a.payload->>'event'='true' AND a.payload->>'eventId'=e.id
        AND a.result->'event_context'->>'event_id'=e.id
    )) THEN
      RAISE EXCEPTION 'Cannot migrate ledger_events: an execution receipt is missing';
    END IF;

    WITH revisions AS (
      SELECT id,payload->>'eventId' AS event_id,
        row_number() OVER (PARTITION BY user_id,payload->>'eventId' ORDER BY updated_at,id)::integer AS revision
      FROM assistant_actions WHERE status='succeeded' AND payload->>'event'='true'
    )
    UPDATE assistant_actions a SET event_id=r.event_id,event_revision=r.revision
      FROM revisions r WHERE a.id=r.id;

    -- Pending old previews keep their IDs. A changed predecessor must be reviewed again.
    UPDATE assistant_actions a SET status='failed',result=jsonb_build_object(
      'id',a.id,'status','failed','completed',0,
      'text','原事项在确认期间已变化，请重新核对；本次未写入账本。')
    WHERE a.status='pending' AND a.payload->>'event'='true' AND a.payload->'input'->>'operation'<>'create'
      AND NOT EXISTS (SELECT 1 FROM ledger_events e WHERE e.user_id=a.user_id AND e.id=a.payload->>'eventId'
        AND e.state='saved' AND md5(to_jsonb(e)::text)=a.payload->'eventBefore'->>'_revision');

    UPDATE assistant_actions a SET event_id=a.payload->>'eventId',
      event_revision=COALESCE((SELECT MAX(r.event_revision) FROM assistant_actions r
        WHERE r.user_id=a.user_id AND r.event_id=a.payload->>'eventId' AND r.status='succeeded'),0)+1
      WHERE a.status='pending' AND a.payload->>'event'='true';

    UPDATE assistant_actions a SET payload=(a.payload-'eventBefore') || jsonb_build_object(
      'receiptBefore',jsonb_build_object(
        'actionId',r.id,'revision',r.event_revision,'id',e.id,'state',e.state,'input',e.input,
        'source_id',e.source_id,'transaction_id',e.transaction_id,'owns_transaction',e.owns_transaction,
        'payments',to_jsonb(e)->'payments','original_flow_kind',e.original_flow_kind))
    FROM ledger_events e,assistant_actions r
    WHERE a.status='pending' AND a.payload->>'event'='true' AND a.payload->'input'->>'operation'<>'create'
      AND e.user_id=a.user_id AND e.id=a.event_id AND r.user_id=e.user_id AND r.event_id=e.id
      AND r.status='succeeded' AND r.event_revision=(SELECT MAX(last.event_revision)
        FROM assistant_actions last WHERE last.user_id=e.user_id AND last.event_id=e.id AND last.status='succeeded');

    -- The action payload already contains ownership and restore data; retain only business snapshots.
    UPDATE assistant_actions a SET payload=jsonb_set(a.payload,'{snapshots}',COALESCE((
      SELECT jsonb_agg(snapshot) FROM jsonb_array_elements(a.payload->'snapshots') snapshot
        WHERE snapshot->>'table'<>'ledger_events'),'[]'::jsonb))
      WHERE a.payload->>'event'='true';

    UPDATE assistant_actions SET payload=payload || jsonb_build_object('eventRevision',event_revision)
      WHERE payload->>'event'='true' AND event_revision IS NOT NULL;

    DROP TABLE ledger_events;
  END IF;

  CREATE UNIQUE INDEX IF NOT EXISTS assistant_event_receipt_revision
    ON assistant_actions(user_id,event_id,event_revision) WHERE status='succeeded' AND event_id IS NOT NULL;
END
$migration$;`;

export async function ensureAssistantEventReceiptsSchema() {
  const rows = await sql.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='assistant_actions' AND column_name='event_revision') AS ready,
    to_regclass('public.ledger_events') IS NOT NULL AS legacy`);
  if (rows[0]?.ready && !rows[0].legacy) return;
  await sql.query(eventReceiptMigration);
}
