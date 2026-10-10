/* eslint-disable @typescript-eslint/no-require-imports -- pure card history, no account access. */
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm'), ts=require('typescript');
const cache=new Map();
function load(file){if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,JSON,Date,Error,require:name=>{if(name==='@/lib/db')throw Error('No account access');return name.startsWith('@/')?load(name.slice(2)+'.ts'):require(name);}});return exports;}
const {reconcileAssistantCardUpdate,reconcileAssistantCardHistory,relocateAssistantCard,linkAssistantEventCards}=load('lib/assistant-card-updates.ts');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`, plain=x=>JSON.parse(JSON.stringify(x));
const event=(n,kind='gift_given',counterparty='小李')=>({id:id(n),role:'assistant',text:'预览',taskApplied:true,approval:{id:id(n+100),summary:'preview'},eventContext:{status:'pending',event_id:null,input:{kind,operation:'create',counterparty,amount_cents:n*100,date:'2026-10-10'}},actionPreview:{title:'记录',metrics:[],sections:[],notices:[]}});
test('gift and loan corrections replace old controls, chain all markers to the newest card and survive reload',()=>{
 for(const kind of ['gift_given','gift_received','loan_lent','loan_borrowed','repayment_received','repayment_paid']){
  const a=event(1,kind),b=event(2,kind),c=event(3,kind);
  const original=[a,{id:id(9),role:'user',text:'记错了是300'},b];
  const updated=reconcileAssistantCardUpdate(original,b.id,'记错了是300');
  assert.equal(updated[0].cardUpdatedLink,b.id);assert.equal(updated[0].approval,undefined);assert.equal(updated[0].supersededApproval.id,a.approval.id);
  const latest=reconcileAssistantCardUpdate([...updated,{id:id(10),role:'user',text:'改成400'},c],c.id,'改成400');
  assert.equal(latest[0].cardUpdatedLink,c.id);assert.equal(latest.find(m=>m.id===b.id).cardUpdatedLink,c.id);
  assert.equal(latest.filter(m=>m.approval).length,1);
  assert.deepEqual(plain(reconcileAssistantCardHistory(plain(latest))),plain(latest));
 }
});
test('new unrelated requests and ambiguous corrections preserve independent proposals',()=>{
 const a=event(1),b=event(2);
 for(const text of ['再送给小李300','另外新增一笔','记一笔新的送礼'])assert.equal(reconcileAssistantCardUpdate([a,b],b.id,text)[0],a);
 const changed=event(3,'gift_given','另一个人');
 const many=[a,event(2,'gift_given','小王'),changed];
 assert.equal(reconcileAssistantCardUpdate(many,changed.id,'改成300'),many);
 const failed={...b,approval:undefined,eventChoices:undefined};
 assert.equal(reconcileAssistantCardUpdate([a,failed],failed.id,'记错了是300')[0],a);
});
test('explicit choice updates, management targets and query corrections share the marker contract',()=>{
 const a=event(1,null),b=event(2);
 assert.equal(reconcileAssistantCardUpdate([a,b],b.id,'记录送礼',a.id)[0].cardUpdatedLink,b.id);
 const management=n=>({id:id(n),role:'assistant',approval:{id:id(n+100)},proposalScope:{resource:'transactions',operation:'update',ids:[id(99)]}});
 assert.equal(reconcileAssistantCardUpdate([management(1),management(2)],id(2),'修改金额为300')[0].cardUpdatedLink,id(2));
 const other={...management(2),proposalScope:{resource:'transactions',operation:'update',ids:[id(98)]}};
 assert.equal(reconcileAssistantCardUpdate([management(1),other],id(2),'修改金额为300')[0].cardUpdatedLink,undefined);
 const query=n=>({id:id(n),role:'assistant',replyView:{title:'统计',analysis:true}});
 assert.equal(reconcileAssistantCardUpdate([query(1),query(2)],id(2),'查错了，应该是上月')[0].cardUpdatedLink,id(2));
});
test('saved cards relocate with stable identities and verified event updates replace old receipts',()=>{
 const a={id:id(1),role:'assistant',status:'saved',drafts:[{id:id(11),amount:'300'}]};
 const later={id:id(2),role:'assistant',text:'已修改'};
 const moved=relocateAssistantCard([a,later],a.id,later.id);
 assert.equal(moved[0].draftCardLink,a.id);assert.equal(moved.at(-1),a);assert.equal(moved.at(-1).drafts[0].id,id(11));
 const old={...event(3),approval:undefined,eventContext:{status:'saved',event_id:id(99),input:{kind:'gift_given'}}};
 const latest={...event(4),eventContext:{status:'saved',event_id:id(99),input:{kind:'gift_given'}}};
 assert.equal(linkAssistantEventCards([old,latest],latest.id,id(99))[0].cardUpdatedLink,latest.id);
 assert.equal(relocateAssistantCard([{...a,commit:[{}]},later],a.id,later.id)[0].draftCardLink,undefined);
});
