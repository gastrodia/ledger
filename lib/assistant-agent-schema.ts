import { commandSchema, commandValueSchemas } from "@/lib/assistant-commands";
import { ledgerEventSchema } from "@/lib/ledger-event";
import { ASSISTANT_CONTROL_PROMPT, assistantControlSchema } from "@/lib/assistant-control";
import { jsonSchema } from "ai";
import { z } from "zod";
import { parseAssistantAgentStep } from "@/lib/assistant-agent-step";
import type { AssistantAgentStep } from "@/lib/assistant-agent-runtime";
const stepShape = z.object({
  replaces_output_id: z.string().uuid().nullable().optional().describe("更正当前卡片时填写card_contexts中原输出ID；独立请求为null，不能根据关键词或金额猜目标"),
  kind: z.enum(["plan", "reuse", "read", "preview", "respond", "control"]),
  covered_operation_ids: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).max(64)).max(32).optional().describe("本次record草稿覆盖的全部普通收支事项ID，包含operation_id；其他动作留空数组"),
  operation_id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).max(64).nullable().optional().describe("任务清单中的事项ID；plan、单一control和全部完成后的总结为null，其他步骤引用对应事项"),
  tool: z.enum(["query", "records", "draft_matches", "command", "event"]).nullable().describe("read只用query/records/draft_matches；读取借还等记录用records，arguments_json为完整command；command/event只用于preview；plan/reuse/respond/control为null"),
  arguments_json: z.string().max(24000).describe("plan为operations完整清单；独立无歧义只读新清单可含initial_reads:[{operation_id,tool:query或records,arguments_json:完整读取参数JSON字符串,reply_mode:result或analysis}]，单事项也兼容initial_read；read/query含scope,start_date,end_date,type,category_id,member_id,keyword；read/draft_matches为{}；read/records和preview为完整账本参数JSON；control为{target_type,target_id,decision,target_reference,requested_operation,changes_json,operation,revision,user_quote}；respond时{}"),
  plan_json: z.string().max(24000).nullable().describe("仅respond时为一个Ledger AssistantPlan JSON字符串。read和preview必须是JSON null，不能写goal/steps/计划/说明文字"),
  needs_input: z.boolean().default(false).describe("回复需要用户补充信息或核对草稿时为true；目标已完成时为false；省略时默认false"),
}).strict();
const stepSchema = stepShape.refine(s => ["plan", "reuse", "control"].includes(s.kind) ? s.tool === null && s.plan_json === null : s.kind === "respond" ? s.tool === null && s.plan_json !== null : s.plan_json === null && (s.kind === "read" ? ["query", "records", "draft_matches"] : ["command", "event"]).includes(s.tool || ""));
export const ASSISTANT_AGENT_STEP_SCHEMA = jsonSchema<AssistantAgentStep>(
  z.toJSONSchema(stepSchema, { target: "draft-7" }) as Parameters<typeof jsonSchema>[0],
  { validate: value => {
    try { return { success: true, value: parseAssistantAgentStep(value) }; }
    catch (error) { return { success: false, error: error as Error }; }
  } },
);
// New task prompts require an explicit operation reference on every step.
// The legacy schema remains available for restoring older single-action loops.
const workflowStep = z.toJSONSchema(stepSchema, { target: "draft-7" }) as Parameters<typeof jsonSchema>[0] & { required?: string[] };
export const ASSISTANT_AGENT_WORKFLOW_STEP_SCHEMA = jsonSchema<AssistantAgentStep>(
  { ...workflowStep, required: [...new Set([...(workflowStep.required || []), "operation_id"])] },
  { validate: value => {
    try { return { success: true, value: parseAssistantAgentStep(value, true) }; }
    catch (error) { return { success: false, error: error as Error }; }
  } },
);
const toolParameters = JSON.stringify({
  command: z.toJSONSchema(commandSchema, { target: "draft-7" }),
  command_values: Object.fromEntries(Object.entries(commandValueSchemas).map(([resource, schema]) => [resource, z.toJSONSchema(schema, { target: "draft-7" })])),
  event: z.toJSONSchema(ledgerEventSchema, { target: "draft-7" }),
  control: z.toJSONSchema(assistantControlSchema, { target: "draft-7" }),
});
const responseProtocol = JSON.stringify({ kind: "respond", operation_id: null, tool: null, arguments_json: "{}", plan_json: JSON.stringify({ action: "chat", reply: "根据实际事实回答，或提出具体缺失信息", drafts: [], query: null }), needs_input: false });
export const ASSISTANT_AGENT_RUNTIME_PROMPT = `${ASSISTANT_CONTROL_PROMPT}
当前为仅限Ledger的持久化Agent循环，输出必须符合步骤schema，而不是直接输出顶层AssistantPlan。
以下是现有工具真实参数schema；arguments_json内参数按对应契约构造，command的values_json按command_values[resource]构造，link/unlink按对应关联契约构造。引用和业务约束另由服务端核验：${toolParameters}
respond/chat的字段格式示例（具体内容按本轮意图填写，发问时needs_input=true）：${responseProtocol}
步骤：kind=plan/reuse/read/preview/respond/control；operation_id为当前事项ID或null；tool为query/records/draft_matches/command/event或null；arguments_json为参数JSON对象字符串；plan_json仅respond时填写AssistantPlan JSON字符串，其内必须有action、reply、drafts、query，不能使用message/content/goal替代reply；其余为JSON null；needs_input表示需要具体补充或页面核对。
纯解释、一般回应、能力边界说明及具体澄清可直接respond/chat、operation_id=null；发生任何业务工具调用前必须保存完整清单。业务新目标先plan，tool=null、operation_id=null，arguments_json={operations:[{id,label,action,effect,depends_on,questions,sources}]}。保存全部要求、明确约束和必要依赖，最多32项；action为现有Ledger动作或control，action只能为record/query/chat/update/undo/remove/manage/edit/confirm/navigate/event/control。effect：query/chat及manage的list/duplicates/export为read；record/event/confirm/undo及manage写操作为write；edit/update/remove/navigate/control为local。sources逐字引用本次goal或已接收authorized_answers，合起来覆盖原目标全部内容，不引入其他历史目标。多个同类动作可共享原句，但不能重复同一真实发生。questions仅为未解决业务问题；缺少可由既有卡片补充的分类、成员或批准不应被当成新的业务问题。control的单一请求可直接提交，不需新建业务清单。
读取或澄清后可plan修订完整清单，保留事项ID和未完成目标，不提交status/receipt_id，不改已完成事项。写事项变成只读须revision_answers:{事项ID:该事项本轮已接受回答完整原文}；服务端只核验来源，模型按完整语义理解条件。依赖只引用清单ID，既不能越过依赖，也不为无关事项增加依赖。
后续步骤operation_id必须引用未完成且依赖已完成的事项，辅助读取不会完成写事项。发问前读取能查清的信息；未解决questions先展示问题，不准备含歧义的审批。回答接回原任务和事项，继续剩余工作，不重建已完成步骤。早期澄清尚未建立清单时保留原goal；接续plan须将相关authorized_answers逐字列入对应事项sources，确保后续提取同时得到原文和已接受条件。原目标相对日期保持初次today，回答明确修订的相对日期才使用answer_today。
read/query：arguments_json包含scope,start_date,end_date,type,category_id,member_id,keyword；用于普通收支汇总，完整金额由数据库计算。read/records：完整command，仅operation=list或duplicates，用于现有记录和台账。read/draft_matches：参数"{}"，逐笔核对当前草稿与真实已保存记录，使用工具返回的完整候选与差异，不用收支汇总或已保存记录内部重复检查代替。相似字段只是候选，不授权删除、确认或断言重复。
新清单全部为无歧义、无依赖的独立query或manage只读事项时，可在plan携带initial_reads:[{operation_id,tool:query或records,arguments_json,reply_mode:result或analysis}]，每个事项一组完整条件，不合并不同资源。仅直接展示真实结果用result；需解释或比较用analysis。单事项也兼容initial_read。含写操作、歧义、依赖、草稿核对或清单修订时走正常循环。快捷参数不适用时保留清单继续read，不能反复重建。
preview/command和preview/event只准备具体影响方案，不执行。参数分别是完整command或event。钱款与实物的业务性质、估值和实际付款分别保持；none模式必须有该事项明确不计资金流水的cashflow_basis原文或已核实的服务端选择，不能取消其他独立付款。
respond：tool=null、arguments_json="{}"，plan_json为既有AssistantPlan。record仅提交提取请求action=record、drafts=[]，系统根据完整sources和回答自动分页提取。普通收支按共同依赖组成核对组，covered_operation_ids明确本组覆盖的全部未完成record事项并包含operation_id；不得遗漏、沿用旧编号或混入未解决问题。其他动作covered_operation_ids为空或省略。生成预览或草稿不是执行成功，修改/移除/排序/导航等待实际页面回执，入账或撤销等待真实凭据。
更正现有输出使用replaces_output_id引用card_contexts中明确对应的原输出；独立事项不替换旧卡片。待执行方案修订后重新预览和确认，已提交方案先核对真实结果，不重放。服务端选择按钮提交的结构化条件可直接复用；自然语言回答由Agent解释，不能按选项标签匹配绕过语义处理。
reuse：仅用于服务端提供的同任务重复核对，arguments_json={source_output_id,decision:same_occurrence,answer_quote:当前完整回答}。只有用户明确同一次发生且原输出有成功凭据时才能复用；不能把一般回应或补充条件当批准。不同真实发生生成独立待确认方案。
所有剩余事项都有成功工具结果且仅为查询、无需澄清时，可respond/chat、operation_id=null一次汇总并完成这些查询；写事项、未查询或截断结果不能被总结标记完成。仍有工作时持续处理，不要求用户重发原目标。最终回复基于所有真实结果；模型分析与执行结果分开。跨查询差额只使用query_comparison中的精确值，不自行猜算金额差额。
批准成功后先读取真实目标核对，再继续目标；失败、取消或过期停止后续自动执行，保留已完成凭据。ID来自当前工具事实、草稿映射或可信上下文，不猜；同名、多匹配和含糊范围先核对。任务status只表示调度进度，不能据此推断某笔账是否已保存。validation_error表示步骤或参数被拒绝，不代表账本执行失败；使用错误说明修正本步，保留已接受回答，不重新询问已明确条件。工具失败据实保留未完成状态，不能编造结果或退回任意SQL、网络、文件和系统操作。`;
