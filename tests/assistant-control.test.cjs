/* eslint-disable @typescript-eslint/no-require-imports -- semantic controls with isolated account-owned executors. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const contract = require('./helpers/assistant-contracts.cjs');
const controls = contract('@/lib/assistant-control');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const plain = x => JSON.parse(JSON.stringify(x));
const context = extra => ({target_type:'action',target_id:uuid(1),operation:'update',revision:'revision-1',summary:'早餐金额20改为22',status:'pending',...extra});
const control = extra => ({target_type:'action',target_id:uuid(1),operation:'update',revision:'revision-1',decision:'approve',target_reference:null,requested_operation:null,changes_json:'{}',user_quote:'就按这个方案处理吧',...extra});

test('controls bind exact current turn, concrete object, operation and version without phrase lists',()=>{
 for(const text of ['就按这个方案处理吧','可以，把早餐那笔改成预览里的数额','我核对过了，同意这项修改'])
  assert.equal(controls.validateAssistantControl(control({user_quote:text}),[context()],text).decision,'approve');
 for(const patch of [{target_id:uuid(2)},{operation:'delete'},{revision:'old'},{user_quote:'历史里的确认执行'},{sql:'DELETE FROM notes'}])
  assert.throws(()=>controls.validateAssistantControl(control(patch),[context()],'就按这个方案处理吧'));
 assert.throws(()=>controls.validateAssistantControl(control({target_type:'task',operation:'task'}),[context({target_type:'task',operation:'task'})],'就按这个方案处理吧'));
});

test('local choices remain independently identified and changing their snapshot invalidates approval',async()=>{
 const cards=[{id:uuid(3),confirmChoice:{batch_id:uuid(4),draft_ids:[uuid(5)],snapshot:'amount=22'}},
  {id:uuid(6),undoChoice:{batch_id:uuid(7),draft_ids:[uuid(8)]}},
  {id:uuid(9),approval:{id:uuid(10)}},{id:uuid(11),cardUpdatedLink:uuid(3),confirmChoice:{batch_id:uuid(4)}}];
 const contexts=await controls.assistantCardControlContexts(cards);
 assert.deepEqual(plain(contexts.map(c=>[c.target_id,c.operation])),[[uuid(3),'record'],[uuid(6),'undo']]);
 const decision=control({...contexts[0],summary:undefined,status:undefined,target_type:'card',user_quote:'执行amount=22的这个入账方案',target_reference:'amount=22'});
 delete decision.summary;delete decision.status;
 controls.validateAssistantControl(decision,contexts,decision.user_quote);
 cards[0].confirmChoice.snapshot='amount=100';
 const changed=await controls.assistantCardControlContexts(cards);
 assert.throws(()=>controls.validateAssistantControl(decision,changed,decision.user_quote),/已经变化/);
 assert.throws(()=>controls.assistantCardControlContextsSchema.parse([context()]),/card/);
});

function serverFixture({tasks=[]}={}){
 const actions=[{id:uuid(1),user_id:'owner',conversation_id:uuid(20),payload:{command:{resource:'transactions',operation:'update'}},summary:'早餐金额20改22',status:'pending'},
  {id:uuid(2),user_id:'other',conversation_id:uuid(20),payload:{command:{operation:'delete'}},summary:'外国账户',status:'pending'},
  {id:uuid(3),user_id:'owner',conversation_id:uuid(21),payload:{command:{operation:'delete'}},summary:'另一个对话',status:'pending'}];
 const task={id:uuid(22),user_id:'owner',conversation_id:uuid(20),attempt:2,status:'succeeded',payload:{message:'就按这个方案处理吧'},agent_checkpoint:{goal_id:uuid(22),output_id:uuid(23),awaiting_delivery:true,pending_plan:null}};
 let writes=0;const queries=[];
 const get=async(_user,id)=>{const row=actions.find(a=>a.id===id&&a.user_id===_user);if(!row)throw Error('no action');return {id,status:row.status,text:row.status==='succeeded'?'已修改早餐金额22元':row.status==='cancelled'?'已取消，未修改':'方案尚未执行'};};
 const exports={};
 const sql={query:async(text,params)=>{queries.push({text,params});if(text.includes('assistant_actions'))return actions.filter(a=>a.user_id===params[0]&&a.conversation_id===params[1]);
  if(text.includes('agent_checkpoint FROM assistant_tasks')) return task.user_id===params[0]&&task.id===params[1]?[task]:[];
  return tasks.filter(t=>t.user_id===params[0]&&t.conversation_id===params[1]&&t.id!==params[2]);}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/assistant-control-server.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,JSON,Error,Number,Promise,require(name){
  if(name==='node:crypto')return require(name);if(name==='@/lib/db')return {sql};if(name==='@/lib/assistant-control')return controls;
  if(name==='@/lib/assistant')return {UUID_PATTERN:/^[0-9a-f-]{36}$/};
  if(name==='@/lib/assistant-command-server')return {ensureAssistantActionsSchema:async()=>{},getAssistantAction:get,decideAssistantAction:async(user,id,decision)=>{const row=actions.find(a=>a.id===id&&a.user_id===user);if(row.status==='pending'){row.status=decision==='approve'?'succeeded':'cancelled';if(decision==='approve')writes++;}return get(user,id);}};
  throw Error(name);
 }});
 return {exports,task,actions,queries,writes:()=>writes,async prepare(decision='approve'){
  const [c]=await exports.loadAssistantControlContexts('owner',uuid(20),task.id);
  const request=control({revision:c.revision,decision});task.agent_checkpoint.pending_plan={action:'control',control:request};return request;
 }};
}

test('server control context is account/conversation scoped and contains no executable account payload',async()=>{
 const f=serverFixture();const contexts=await f.exports.loadAssistantControlContexts('owner',uuid(20),f.task.id);
 assert.equal(contexts.length,1);assert.equal(contexts[0].target_id,uuid(1));assert.doesNotMatch(JSON.stringify(contexts),/user_id|transactions|command/);
 for(const q of f.queries){assert.match(q.text,/user_id=\$1/);assert.match(q.text,/conversation_id=\$2/);assert.match(q.text,/cleared_at IS NULL/);}
});

test('persisted approval can be retried after lost response and only executes once; status reads never write',async()=>{
 const f=serverFixture();await f.prepare();
 const receipts=await Promise.all([f.exports.executeAssistantTaskControl('owner',f.task.id,2,uuid(23)),f.exports.executeAssistantTaskControl('owner',f.task.id,2,uuid(23))]);
 assert.equal(f.writes(),1);assert.ok(receipts.every(r=>r.status==='succeeded'));
 await f.prepare('status');assert.equal((await f.exports.executeAssistantTaskControl('owner',f.task.id,2,uuid(23))).status,'succeeded');assert.equal(f.writes(),1);
});

test('cancel retires only its specific pending action and does not dispatch a financial write',async()=>{
 const f=serverFixture();await f.prepare('cancel');const result=await f.exports.executeAssistantTaskControl('owner',f.task.id,2,uuid(23));
 assert.equal(result.status,'cancelled');assert.equal(f.writes(),0);assert.equal(f.actions[2].status,'pending');
 await f.prepare();assert.equal((await f.exports.executeAssistantTaskControl('owner',f.task.id,2,uuid(23))).status,'cancelled');assert.equal(f.writes(),0);
});

test('foreign user, stale output/attempt, consumed decision, mismatched operation and replaced preview cannot execute',async()=>{
 for(const bad of ['foreign','attempt','output','consumed','operation','revision']){
  const f=serverFixture();await f.prepare();let user='owner',attempt=2,output=uuid(23);
  if(bad==='foreign')user='other';if(bad==='attempt')attempt=1;if(bad==='output')output=uuid(24);
  if(bad==='consumed')f.task.agent_checkpoint.awaiting_delivery=false;
  if(bad==='operation')f.task.agent_checkpoint.pending_plan.control.operation='delete';
  if(bad==='revision')f.actions[0].payload.command.amount=100;
  await assert.rejects(f.exports.executeAssistantTaskControl(user,f.task.id,attempt,output));assert.equal(f.writes(),0);
 }
});


test('task control context preserves the original goal instead of replacing it with a short clarification answer',async()=>{
 const f=serverFixture({tasks:[{id:uuid(30),user_id:'owner',conversation_id:uuid(20),attempt:2,goal:'记录早餐再处理送礼',display_input:{message:'已有物品'},status:'succeeded'}]});
 const contexts=await f.exports.loadAssistantControlContexts('owner',uuid(20),f.task.id);
 assert.equal(contexts.find(c=>c.target_type==='task').summary,'记录早餐再处理送礼');
 assert.doesNotMatch(JSON.stringify(contexts),/已有物品/);
});


test('long reviewed snapshots have compact stable revisions and remain within the agent control argument limit',async()=>{
 const card={id:uuid(40),confirmChoice:{batch_id:uuid(41),draft_ids:[uuid(42)],snapshot:JSON.stringify({description:'账目'.repeat(20000),amount:22})}};
 const [context]=await controls.assistantCardControlContexts([card]);
 assert.equal(context.revision.length,64);assert.equal(context.summary.length,4000);
 controls.assistantCardControlContextsSchema.parse([context]);
 const decision=control({target_type:'card',target_id:context.target_id,operation:context.operation,revision:context.revision});
 assert.ok(JSON.stringify(decision).length<24000);controls.validateAssistantControl(decision,[context],decision.user_quote);
 const [reloaded]=await controls.assistantCardControlContexts([plain(card)]);assert.equal(reloaded.revision,context.revision);
 card.confirmChoice.snapshot=card.confirmChoice.snapshot.replace('22','23');const [changed]=await controls.assistantCardControlContexts([card]);assert.notEqual(changed.revision,context.revision);
});
