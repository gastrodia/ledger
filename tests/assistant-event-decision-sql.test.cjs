/* eslint-disable @typescript-eslint/no-require-imports -- real continuation fences in disposable PostgreSQL. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./helpers/ledger-sql-fixture.cjs');
const modulePath = process.env.LEDGER_TASKS_PGLITE_MODULE;
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function setup(t) {
  const f=await fixture(modulePath);t.after(f.close);
  await f.load('lib/assistant-task-schema.ts').ensureAssistantTaskSchema();
  const event=f.load('lib/ledger-event.ts').validateLedgerEvent({operation:'create',kind:'gift_given',counterparty:'朋友',amount_cents:5000,date:'2026-10-14'});
  const context={status:'pending',event_id:null,input:event};
  const plan={action:'event',event,reply:'疑似重复',drafts:[],query:null,event_context:context,event_choices:[
    {label:'已记过，不再新增',input:event,decision:'skip_creation'},
    {label:'另发生一笔',input:{...event,allow_duplicate:true}}]};
  const checkpoint={version:1,goal_id:id(1),goal:'记送礼后查看本月收支',status:'needs_input',steps:2,messages:[],pending_approval:null,preview_fingerprints:[],
    awaiting_answer:true,output_id:id(4),current_operation_id:'gift',pending_plan:plan,
    tool_results:[{call_id:'preview',name:'event_preview',operation_id:'gift',result:{event_context:context}}],
    operations:[{id:'gift',label:'送礼',action:'event',effect:'write',depends_on:[],status:'needs_input'},
      {id:'query',label:'本月收支',action:'query',effect:'read',depends_on:['gift'],status:'pending'}],
    outputs:[{id:id(4),user_message_id:id(3),input:{message:'送礼',display_text:'送礼',display_images:[]},plan,attempt:1}]};
  await f.db.query(`INSERT INTO assistant_tasks(user_id,id,conversation_id,user_message_id,request_hash,payload,display_input,status,phase,result,agent_checkpoint)
    VALUES('owner',$1,$2,$3,'initial',$4::jsonb,$5::jsonb,'succeeded','thinking',$6::jsonb,$7::jsonb)`,
    [id(1),id(2),id(3),JSON.stringify({message:checkpoint.goal,today:'2026-10-14',history:[],images:[],draft_batch:null,saved_batch:null}),JSON.stringify(checkpoint.outputs[0].input),JSON.stringify(plan),JSON.stringify(checkpoint)]);
  return {...f,api:f.load('lib/assistant-tasks.ts'),request:{id:id(1),conversation_id:id(2),user_message_id:id(5),message:'已记过',display_text:'已记过',today:'2026-10-14',event_selection:event,event_decision:'skip_creation',continuation:{kind:'answer',attempt:1,output_id:id(4)}},
    async stored(){return (await f.db.query('SELECT * FROM assistant_tasks WHERE id=$1',[id(1)])).rows[0];}};
}
test('declining duplicate creates a scoped no-write receipt, preserves other operations, and replays once', {skip:!modulePath},async t=>{
  const f=await setup(t);
  await f.api.createAssistantTask('owner',f.request);
  await f.api.createAssistantTask('owner',f.request);
  const row=await f.stored(),c=row.agent_checkpoint;
  assert.equal(row.attempt,2);
  assert.equal(c.operations[0].status,'completed');
  assert.equal(c.operations[1].status,'pending');
  assert.equal(c.awaiting_answer,false);
  assert.equal(c.pending_plan,undefined);
  const receipts=c.tool_results.filter(r=>r.name==='event_decision_result');
  assert.equal(receipts.length,1);assert.equal(receipts[0].operation_id,'gift');
  assert.match(receipts[0].result.text,/未写入账本/);
  assert.equal(c.pending_approval,null);
  assert.equal(Number((await f.db.query('SELECT count(*) FROM transactions')).rows[0].count),0);
  await assert.rejects(f.api.createAssistantTask('owner',{...f.request,user_message_id:id(6)}),/已经推进/);
});
test('decline rejects foreign owners, stale outputs, modified conditions and requests without a continuation', {skip:!modulePath},async t=>{
  const f=await setup(t);
  await assert.rejects(f.api.createAssistantTask('foreign',f.request),/不存在/);
  await assert.rejects(f.api.createAssistantTask('owner',{...f.request,continuation:{...f.request.continuation,output_id:id(9)}}),/不等待此回答/);
  await assert.rejects(f.api.createAssistantTask('owner',{...f.request,event_selection:{...f.request.event_selection,amount_cents:9000}}),/不匹配/);
  await assert.rejects(f.api.createAssistantTask('owner',{...f.request,continuation:undefined}),/必须接续/);
  assert.equal((await f.stored()).attempt,1);
});

test('task snapshots retain historical agent status without restoring historical task controls', {skip:!modulePath},async t=>{
  const f=await setup(t),row=await f.stored(),c=row.agent_checkpoint;
  c.outputs[0].plan={action:'chat',reply:'原任务中断',drafts:[],query:null,agent:{goal_id:id(1),goal:c.goal,status:'interrupted',steps:2,tool_calls:0}};
  c.output_id=id(8);
  await f.db.query('UPDATE assistant_tasks SET agent_checkpoint=$2::jsonb WHERE id=$1',[id(1),JSON.stringify(c)]);
  const task=await f.api.getAssistantTask('owner',id(1));
  assert.equal(task.output_history[0].agent_status,'interrupted');
  assert.equal(task.output_history[0].result.agent,undefined);
});
