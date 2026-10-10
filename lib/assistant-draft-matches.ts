import { sql } from "@/lib/db";
import { validateDraftBatch, type AssistantDraftBatch, type AssistantCategory, type AssistantMember } from "@/lib/assistant";
import { draftMatchesReplyView, type AssistantReplyView } from "@/lib/assistant-reply-view";

import { draftMatchReason, draftMatchReasonLabel, type DraftMatchReason } from "@/lib/assistant-draft-match-rules";

const CANDIDATE_LIMIT = 3;
const DATE_WINDOW_DAYS = 7;
type Candidate = { id: string; type: string; amount_cents: number; transaction_date: string; description: string; member_id: string | null; category_id: string | null; date_difference_days: number };
export type AssistantDraftMatches = {
  reply: string;
  reply_view: AssistantReplyView;
  batch_id: string;
  basis: "amount_date_and_merchant_or_purpose";
  date_window_days: number;
  same_description_is_only_suspected: true;
  rows: Array<{
    draft_id: string; description: string; type: string; transaction_date: string | null; amount_cents: number | null;
    status: "possible_match" | "no_match" | "incomplete";
    candidate_count: number; candidates: Array<Candidate & { same_description: boolean; match_reason: DraftMatchReason }>; candidates_limited: boolean;
  }>;
};

function draftMatchesReply(rows: AssistantDraftMatches["rows"]) {
  const money = (cents: number | null) => cents === null ? "金额缺失" : `¥${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
  const label = (description: string) => description.replace(/[\r\n]/g, " ") || "未填写用途";
  return `逐笔核对结果：\n${rows.map((row, i) => {
    const detail = row.status === "incomplete" ? "金额或日期不完整，暂未核对。"
      : row.status === "no_match" ? `前后 ${DATE_WINDOW_DAYS} 天未找到有商户或用途关联的记录；仅同金额的流水已排除。`
      : `找到 ${row.candidate_count} 笔待核对候选：${row.candidates.map(candidate => `${label(candidate.description)}｜${candidate.transaction_date}｜${money(candidate.amount_cents)}（${draftMatchReasonLabel[candidate.match_reason]}；${candidate.date_difference_days === 0 ? "日期相同" : `账本日期比草稿${candidate.date_difference_days < 0 ? "早" : "晚"} ${Math.abs(candidate.date_difference_days)} 天`}）`).join("、")}${row.candidates_limited ? "；仅列出前三笔候选" : ""}。`;
    return `${i + 1}. ${label(row.description)}｜${row.transaction_date ?? "日期缺失"}｜${money(row.amount_cents)}：${detail}`;
  }).join("\n")}\n\n已检查草稿日期前后 ${DATE_WINDOW_DAYS} 天。日期不同也可能是同一交易，请核对原始日期；仅金额相同的记录已排除；用途相关或缺少用途仅提示核对。没有更改草稿或账本。`;
}

/** Compare pending drafts with saved transactions, including a single saved match.
 * This is intentionally different from finding duplicates within saved records.
 * The batch is request data; account ownership always comes from the session.
 */
export async function readAssistantDraftMatches(userId: string, input: AssistantDraftBatch | null, members: AssistantMember[] = [], categories: AssistantCategory[] = []): Promise<AssistantDraftMatches> {
  const batch = validateDraftBatch(input);
  if (!batch) throw new Error("当前没有可核对的待确认草稿，请指定要核对的账目。");
  const complete = batch.drafts.filter(d => d.amount_cents !== undefined && d.transaction_date !== undefined);
  const matches = complete.length ? await sql.query(`
    SELECT d.id AS draft_id, t.id,t.type,(t.amount*100)::bigint AS amount_cents,
      TO_CHAR(t.transaction_date,'YYYY-MM-DD') AS transaction_date,
      LEFT(COALESCE(t.description,''),200) AS description,t.member_id,t.category_id,
      t.transaction_date::date-d.transaction_date AS date_difference_days
    FROM jsonb_to_recordset($2::jsonb) AS d(id text,type text,amount_cents bigint,transaction_date date)
    JOIN transactions t ON t.user_id=$1 AND t.type=d.type
      AND t.amount=d.amount_cents::numeric/100
      AND t.transaction_date >= d.transaction_date-${DATE_WINDOW_DAYS}
      AND t.transaction_date < d.transaction_date+${DATE_WINDOW_DAYS + 1}
    ORDER BY d.id,t.id`, [userId, JSON.stringify(complete.map(d => ({ id: d.id, type: d.type, amount_cents: d.amount_cents, transaction_date: d.transaction_date })))]) : [];
  const specificCategories = new Set(categories.filter(c => !/^(其他|其它|支出|收入|未分类|日常|消费|购物|线上购物|线下购物)$/.test(c.name.trim())).map(c => c.id));
  const rows: AssistantDraftMatches["rows"] = batch.drafts.map(draft => {
    const candidates = matches.filter(row => row.draft_id === draft.id).flatMap(row => {
      const saved = { ...row, amount_cents: Number(row.amount_cents), date_difference_days: Number(row.date_difference_days) } as Candidate;
      const reason = draftMatchReason(draft, saved, specificCategories);
      return reason ? [{ ...saved, same_description: reason === "merchant", match_reason: reason }] : [];
    }).sort((a, b) => Number(b.same_description) - Number(a.same_description) || Math.abs(a.date_difference_days) - Math.abs(b.date_difference_days) || a.id.localeCompare(b.id));
    const count = candidates.length;
    return { draft_id: draft.id, description: draft.description.slice(0, 200), type: draft.type,
      transaction_date: draft.transaction_date ?? null, amount_cents: draft.amount_cents ?? null,
      status: draft.amount_cents === undefined || draft.transaction_date === undefined ? "incomplete" : count ? "possible_match" : "no_match",
      candidate_count: count, candidates: candidates.slice(0, CANDIDATE_LIMIT), candidates_limited: count > CANDIDATE_LIMIT };
  });
  return { batch_id: batch.batch_id, basis: "amount_date_and_merchant_or_purpose", date_window_days: DATE_WINDOW_DAYS, same_description_is_only_suspected: true, rows, reply: draftMatchesReply(rows), reply_view: draftMatchesReplyView({ batch_id: batch.batch_id, rows, date_window_days: DATE_WINDOW_DAYS }, members, categories, batch) };
}
