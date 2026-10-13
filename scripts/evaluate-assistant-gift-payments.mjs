// Real model and production task/event code, with every database operation bound to disposable PGlite.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
if (!process.argv.includes('--live')) { console.log('Use --live with LEDGER_TASKS_PGLITE_MODULE. No production database access.'); process.exit(0); }
createRequire(require.resolve('next/package.json'))('@next/env').loadEnvConfig(process.cwd());
const createFixture = require('../tests/helpers/ledger-sql-fixture.cjs');
const { NextRequest } = require('next/server');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scenarios = [
  { name:'reference_previous_purchase', goal:'吃饭20，给小美买鞋子200，小美生日送礼50外加刚才的鞋。', amounts:[20,50,200] },
  { name:'reference_different_wording', goal:'午饭花了18元，花120元买了一本画册准备送给阿林。给阿林庆生另外包了30元红包，把前面买的画册一起送了。', amounts:[18,30,120] },
  { name:'single_payment_multiple_uses', goal:'给姐姐转了250元，请她代办给小美的生日礼物，其中礼金50元、鞋子价值200元。只发生了这一笔付款。', amounts:[250] },
  { name:'unknown_purchase_price', goal:'小美生日送礼50元，外加一双价值200元的鞋。鞋是新买的，需要入账。', clarify:true },
];
const name=process.argv.includes('--scenario')?process.argv[process.argv.indexOf('--scenario')+1]:null;
const report={evidence:'live_model_actual_tasks_and_SQL_in_disposable_PGlite',account_database_access:false,account_writes:0,runs:[]};
for(const scenario of scenarios.filter(s=>!name||s.name===name)) {
 const f=await createFixture(process.env.LEDGER_TASKS_PGLITE_MODULE), taskId=randomUUID(),conversationId=randomUUID();
 const run={name:scenario.name,goal:scenario.goal,plans:[],passed:false};report.runs.push(run);
 try {
  await f.db.query("INSERT INTO members(id,user_id,name) VALUES($1,'owner','本人')",[id(1)]);
  await f.db.query("INSERT INTO categories(id,user_id,name,type) VALUES($1,'owner','餐饮','expense'),($2,'owner','购物','expense'),($3,'owner','人情','expense')",[id(2),id(3),id(4)]);
  const tasks=f.load('lib/assistant-tasks.ts'),actions=f.load('lib/assistant-command-server.ts');
  await tasks.createAssistantTask('owner',{id:taskId,conversation_id:conversationId,user_message_id:randomUUID(),message:scenario.goal,display_text:scenario.goal,today:'2026-10-13',history:[{role:'user',content:'接下来所有支出成员为本人；餐费分类餐饮，购买实物分类购物，礼金和代办整笔付款分类人情。'}]});
  for(let wave=0;wave<6;wave++) {
   await tasks.runAssistantTask('owner',taskId);
   const task=await tasks.getAssistantTask('owner',taskId);run.status=task.status;run.agent=task.agent;run.error=task.error;
   fs.mkdirSync('output/assistant-gift-payments',{recursive:true});
   run.checkpoint=(await f.db.query('SELECT agent_checkpoint FROM assistant_tasks WHERE id=$1',[taskId])).rows[0]?.agent_checkpoint;
   fs.writeFileSync(`output/assistant-gift-payments/progress-${scenario.name}.json`,JSON.stringify({task,checkpoint:run.checkpoint},null,2));
   console.log(JSON.stringify({wave,scenario:scenario.name,status:task.agent?.status,errors:run.checkpoint?.tool_results.filter(tool=>tool.name==='validation_error')}));
   if(task.status==='queued')continue;
   run.plans.push(task.result);
   if(task.status!=='succeeded')break;
   if(task.agent.status==='completed')break;
   if(task.agent.awaiting_answer) {
    const selection=task.result.event_choices?.find(choice=>choice.label==='本人'||choice.label==='人情');
    if(selection&&!scenario.clarify){
     await tasks.createAssistantTask('owner',{id:taskId,conversation_id:conversationId,user_message_id:randomUUID(),message:selection.label,display_text:selection.label,today:'2026-10-13',event_selection:selection.input,continuation:{kind:'answer',attempt:task.attempt,output_id:task.agent.output_id}});continue;
    }
    run.question=task.result.reply;break;
   }
   if(task.result.approval) {
    const receipt=await actions.decideAssistantAction('owner',task.result.approval.id,'approve');
    if(receipt.status!=='succeeded')throw Error(receipt.text);
    await tasks.resumeAssistantTask('owner',taskId,task.attempt);continue;
   }
   if(task.agent.pending_batch_id) {
    const res=await f.load('app/api/assistant/confirm/route.ts').POST(new NextRequest('http://sandbox/api/assistant/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({task_id:taskId,batch_id:task.agent.pending_batch_id,drafts:task.result.drafts.map(draft=>({...draft,member_id:draft.member_id||id(1)}))})}));
    if(!res.ok)throw Error(JSON.stringify(await res.json()));
    await tasks.resumeAssistantTask('owner',taskId,task.attempt);continue;
   }
   break;
  }
  run.transactions=(await f.db.query('SELECT id,amount,description,transaction_date FROM transactions ORDER BY amount,id')).rows;
  run.gifts=(await f.db.query('SELECT id,cash_amount,items FROM given_gifts')).rows;
  run.links=(await f.db.query('SELECT source_id,transaction_id FROM transaction_links')).rows;
  run.checkpoint=(await f.db.query('SELECT agent_checkpoint FROM assistant_tasks WHERE id=$1',[taskId])).rows[0]?.agent_checkpoint;
  run.passed=scenario.clarify?!!run.question&&run.transactions.length===0:run.agent?.status==='completed'&&JSON.stringify(run.transactions.map(row=>Number(row.amount)))===JSON.stringify(scenario.amounts)&&run.gifts.length===1&&run.links.length===scenario.amounts.length-(scenario.amounts.length===3?1:0);
 }catch(error){run.error={name:error.name,message:error.message};}
 finally{await f.close();}
 fs.mkdirSync('output/assistant-gift-payments',{recursive:true});fs.writeFileSync(`output/assistant-gift-payments/live${name?'-'+name:''}.json`,JSON.stringify(report,null,2));
 console.log(JSON.stringify({scenario:run.name,passed:run.passed,status:run.agent?.status,error:run.error,question:run.question}));
}
process.exitCode=report.runs.every(run=>run.passed)?0:1;
