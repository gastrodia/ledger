// Real model decisions against a sandbox ledger. Never imports the account DB.
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
const require = createRequire(import.meta.url);
if (!process.argv.includes("--live")) {
  console.log("Run with --live to evaluate the configured Bailian model against sandbox data. No account records are read or written.");
  process.exit(0);
}
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(process.cwd());
const ts = require("typescript"), modules = new Map();
function load(file) {
  if (modules.has(file)) return modules.get(file);
  const exports = {}; modules.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, process, console, structuredClone, Date, Error, JSON, Number, Set, Map, BigInt, Buffer, URL, fetch, Headers, Request, Response, TextEncoder, TextDecoder,
      ReadableStream, TransformStream, AbortController, AbortSignal, setTimeout, clearTimeout, require: name => {
        if (name === "@/lib/db") throw new Error("Evaluation cannot access the account database.");
        return name.startsWith("@/") ? load(`${name.slice(2)}.ts`) : require(name);
      } }, { filename: file });
  return exports;
}
const { runAssistantAgent } = load("lib/assistant-agent-runtime.ts");
const { resolveAssistantEventChoice } = load("lib/assistant-event-clarification.ts");
const { ASSISTANT_AGENT_WORKFLOW_STEP_SCHEMA, ASSISTANT_AGENT_RUNTIME_PROMPT } = load("lib/assistant-agent-schema.ts");
if(process.argv.includes("--trace")) {
  const validateStep = ASSISTANT_AGENT_WORKFLOW_STEP_SCHEMA.validate;
  ASSISTANT_AGENT_WORKFLOW_STEP_SCHEMA.validate = async value => {
    const result = await validateStep(value);
    if(!result.success) console.log(JSON.stringify({schema_error:{kind:value?.kind,keys:Object.keys(value||{}),types:Object.fromEntries(Object.entries(value||{}).map(([key,v])=>[key,v===null?"null":Array.isArray(v)?"array":typeof v])),issues:result.error?.issues?.map(issue=>({path:issue.path,code:issue.code})),message:result.error?.issues?undefined:result.error?.message}}));
    return result;
  };
}
const { ASSISTANT_AGENT_DOMAIN_PROMPT } = load("lib/assistant-agent-instructions.ts");
const { ASSISTANT_SYSTEM_PROMPT, validatePlan } = load("lib/assistant.ts");
const { ASSISTANT_COMMAND_PROMPT, validateLedgerCommand } = load("lib/assistant-commands.ts");
const { LEDGER_EVENT_PROMPT, validateLedgerEvent } = load("lib/ledger-event.ts");
const { ASSISTANT_DRAFT_ACTION_PROMPT } = load("lib/assistant-draft-actions.ts");
const { bailianObject, BAILIAN_ASSISTANT_MODEL } = load("lib/bailian.ts");
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const categories = [{ id: id(1), name: "餐饮", type: "expense" }, { id: id(2), name: "交通", type: "expense" }];
const members = [{ id: id(3), name: "我" }];
const model = process.env.BAILIAN_ASSISTANT_MODEL?.trim() || BAILIAN_ASSISTANT_MODEL;
const report = { model, evidence: 'live_model_with_sandbox_receipts', account_database_access:false, account_writes:0, scenarios:[] };
const scenarios = [
  ...Array.from({length:3},(_,i)=>({name:`mixed_${i+1}`,goal:'早餐3.9 地铁2.96 小美生日送礼500外加一双200的鞋子',answer:'鞋子是已有物品，只登记估值200元；没有本次买鞋付款。礼金实际付了500元，所有账目成员是我。'})),
  ...Array.from({length:3},(_,i)=>({name:`short_reply_${i+1}`,goal:'早餐3.9 地铁2.96 小美生日送礼500外加一双200的鞋子',answer:'已有物品'})),
  ...Array.from({length:3},(_,i)=>({name:`duplicate_event_${i+1}`,goal:'早餐3.9 地铁2.96 小美生日送礼500外加一双200的鞋子',answer:'鞋子是已有物品，只登记估值200元；没有本次买鞋付款。礼金实际付了500元，所有账目成员是我。',duplicateEvent:true})),
  {name:'management_and_query',goal:'新建便利贴“下周检查轮胎”，把昨天已保存的午餐金额改成30元，完成后查询本月支出合计。',answer:'唯一那笔午餐，成员我。'},
];
for (const scenario of (process.argv.includes("--short-replies") ? scenarios.filter(s=>s.name.startsWith("short_reply")) : process.argv.includes("--duplicates") ? scenarios.filter(s=>s.duplicateEvent) : process.argv.includes("--management") ? scenarios.slice(-1) : process.argv.includes("--single") ? scenarios.slice(0,1) : scenarios)) {
  const goalId=randomUUID(), trace=[], saved=[];
  let checkpoint=null, result=null, asked=false, unique=0;
  const adapters={
    chooseStep:async(messages,signal)=>bailianObject({model,temperature:0.2,maxOutputTokens:6000,timeoutMs:60000,thinking:false,schema:ASSISTANT_AGENT_WORKFLOW_STEP_SCHEMA,schemaName:'ledger_agent_step',messages},signal).then(step=>{if(process.argv.includes("--trace"))console.log(JSON.stringify({step}));return step;}),
    validatePlan:raw=>validatePlan(raw,categories,members,randomUUID),validateCommand:validateLedgerCommand,validateEvent:validateLedgerEvent,
    verifyTargets:async targets=>({verified:true,records:targets.map(target=>({...target,rows:[]}))}),
    query:async query=>{trace.push({tool:'query',query});return {filters:query,facts:{summary:{income:'0.00',expense:'536.86',balance:'-536.86',count:4}}};},
    command:async (command,_signal,fp)=>{
      trace.push({tool:'command',command,fingerprint:fp});
      if(['list','duplicates','export'].includes(command.operation)) return {reply:'找到一笔午餐',record_context:{resource:command.resource,rows:[{id:id(50),description:'午餐',amount:'20.00',member_id:id(3),category_id:id(1)}]}};
      return {reply:'待确认',approval:{id:randomUUID(),summary:'模拟账本确认',count:1,expires_at:null}};
    },
    event:async(event,_signal,fp)=>{trace.push({tool:'event',event,fingerprint:fp});if(scenario.duplicateEvent&&!event.allow_duplicate)return {reply:'发现同一天、同对方、同金额的已登记事项。请核对是不是已经记过；确实又发生一笔才继续。',event_context:{status:'pending',event_id:null,input:event},event_choices:[{label:'这是另外新发生的一笔，继续核对',input:{...event,allow_duplicate:true}}]};return {reply:'待确认',event_context:{status:'pending',event_id:null,input:event},approval:{id:randomUUID(),summary:'模拟事项确认',count:1,expires_at:null}};},
  };
  const messages=[{role:'system',content:[ASSISTANT_SYSTEM_PROMPT,ASSISTANT_COMMAND_PROMPT,ASSISTANT_DRAFT_ACTION_PROMPT,LEDGER_EVENT_PROMPT,ASSISTANT_AGENT_DOMAIN_PROMPT,ASSISTANT_AGENT_RUNTIME_PROMPT,`可用数据：${JSON.stringify({today:'2026-10-10',categories,members})}`].join('\n')},{role:'user',content:scenario.goal}];
  try {
    for(let turn=0;turn<8;turn++) {
      result=await runAssistantAgent({requireWorkflow:true,goalId,goal:scenario.goal,messages,checkpoint,adapters,signal:AbortSignal.timeout(90000),attempt:turn+1,onCheckpoint:c=>{checkpoint=c; const error=c.tool_results.at(-1); if(error?.name==='validation_error') console.log(JSON.stringify({validation:error.result}));}});
      if(result.action==='record') saved.push({kind:'drafts',drafts:result.drafts});
      if(result.agent.status==='completed') break;
      if(result.agent.status==='waiting_approval') {
        const pending=checkpoint.pending_approval?.action_id||checkpoint.pending_batch?.batch_id;
        const target=checkpoint.pending_batch?'transactions':result.command?.resource||(result.event?.kind==='gift_given'?'gifts_given':'transactions');
        checkpoint.approval_outcome={id:pending,status:'succeeded',text:'隔离模拟账本已确认',targets:[{resource:target,operation:result.command?.operation==='delete'?'delete':'create',ids:[id(70+(unique++))]}]};
      } else if(checkpoint.awaiting_answer) {
        asked=true;checkpoint.awaiting_answer=false;if(checkpoint.duplicate_review)checkpoint.duplicate_review.answered=true;
        const op=checkpoint.operations.find(op=>op.id===checkpoint.current_operation_id);if(op?.status==='needs_input'){op.status='pending';op.questions=[];}
        const duplicateChoice=result.event_choices?.find(choice=>choice.input.allow_duplicate);
        const answer=duplicateChoice?.label || (checkpoint.duplicate_review?'这是同一笔，请复用前面已确认的账目，不要重复入账。':scenario.answer);
        const resolved=op&&resolveAssistantEventChoice(checkpoint,op.id,answer);
        if(resolved) checkpoint.event_resolutions=[...(checkpoint.event_resolutions||[]).filter(item=>item.operation_id!==op.id),resolved];
        checkpoint.turn_input={message:answer,display_text:answer,display_images:[]};checkpoint.messages.push({role:'user',content:answer});
      } else if(checkpoint.awaiting_delivery) { checkpoint.awaiting_delivery=false;const op=checkpoint.operations.find(op=>op.id===checkpoint.current_operation_id);if(op?.status==='needs_input')op.status='completed';checkpoint.messages.push({role:'user',content:'隔离页面已经展示此结果，继续未完成事项。'}); }
      else if(result.agent.status!=="running") break;
    }
    const gift=trace.find(call=>call.tool==='event')?.event;
    const check=(scenario.name.startsWith('mixed')||scenario.name.startsWith('short_reply')||scenario.duplicateEvent) ? result.agent.status==='completed' && asked && saved.flatMap(batch=>batch.drafts).reduce((sum,d)=>sum+d.amount_cents,0)===686 && gift?.amount_cents===50000 && ['auto','new','existing'].includes(gift.cashflow) && gift?.items?.some(item=>item.estimated_value===200) && (gift.transaction_amount_cents===null||gift.transaction_amount_cents===50000) && (!scenario.duplicateEvent || trace.filter(call=>call.tool==='event'&&!call.event.allow_duplicate).length===1 && trace.filter(call=>call.tool==='event'&&call.event.allow_duplicate).length===1)
      : result.agent.status==='completed' && trace.some(call=>call.tool==='command'&&call.command.resource==='notes'&&call.command.operation==='create') && trace.some(call=>call.tool==='command'&&call.command.resource==='transactions'&&call.command.operation==='update') && trace.some(call=>call.tool==='query');
    report.scenarios.push({name:scenario.name,passed:check,asked,agent:result.agent,trace,saved,validation_errors:checkpoint.tool_results.filter(tool=>tool.name==='validation_error')});
    console.log(JSON.stringify({name:scenario.name,passed:check,asked,status:result.agent.status,operations:result.agent.operations?.map(op=>({label:op.label,status:op.status})),validation_errors:checkpoint.tool_results.filter(tool=>tool.name==='validation_error').map(tool=>tool.result)}));
  } catch(error) {report.scenarios.push({name:scenario.name,passed:false,error:String(error),trace});console.log(JSON.stringify({name:scenario.name,error:String(error)}));}
}
fs.mkdirSync('output/assistant-workflow',{recursive:true});fs.writeFileSync('output/assistant-workflow/live-evaluation.json',JSON.stringify(report,null,2));
process.exitCode=report.scenarios.every(s=>s.passed)?0:1;
