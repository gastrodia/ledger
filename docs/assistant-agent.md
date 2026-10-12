# Ledger Agent

Agent负责理解本轮完整意图和明确指代，使用Ledger工具处理任务。自然语言批准、取消、修订、澄清和能力询问均由同一循环解释，不用短语表、关键词或问句形式选择操作。能力限定在Ledger已有记录、关联与统计，不提供付款、主动通知、任意SQL、终端、文件或外部网络操作。

## 职责与提示词

`assistant-agent-instructions.ts`定义通用目标、授权和结果原则；`assistant.ts`定义单动作契约；`assistant-commands.ts`、`ledger-event.ts`和`assistant-draft-actions.ts`定义Ledger数据语义与工具参数；`assistant-agent-schema.ts`定义调度协议；`assistant-control.ts`定义针对现有对象的控制决定。工具参数直接复用现有Zod schema，模型与服务端看到同一字段契约。各模块保留字段、单位、能力与业务约束，不枚举用户说法，不默认最近方案就是被引用对象。

图片识别与文字分页是只提取事实的子工具，其提示词约束来源、资金方向、完整覆盖和分页顺序。类别按完整语义选择可用ID，成员仅依据明确指定，未知值保持未确定。日期和金额的格式校验、分页证据及缓存版本保留；修改提取契约时更新缓存版本，不能混用旧结果。

## 任务与续接

业务目标先保存完整operations清单，包含稳定事项ID、action、read/write/local、依赖、questions及原文sources。每一步引用当前未完成事项；已完成操作不能重放，业务澄清不能丢失剩余目标或执行凭据。互不相关事项不增加依赖，有歧义的事项先核对或询问，不准备可执行审批。

恢复执行时从当前代码刷新system指令，检查点只延续原目标、对话事实、事项与凭据，不能继续沿用过时的短语路由prompt。

回答按原任务ID、attempt、输出ID和回答消息ID续接；原目标日期保持初次today，明确修订的日期才使用answer_today。事项类型可以在读取或澄清后修订，但保留原ID和全量目标。写事项变成只读必须引用本轮已接受的revision_answers；服务端校验来源和身份，由Agent理解语义。

普通收支以covered_operation_ids绑定完整核对组。系统内部每页20笔，分页原文逐字覆盖、每笔映射恰好一次，完成全部提取后生成待确认草稿。每组输出使用独立稳定批次ID，不复用已入账批次。重复回答、重试和延迟worker受CAS及内容指纹约束。

服务端显示的事项选择按钮提交完整event_selection，必须匹配当前任务、当前输出与实际提供的选项。输入框即使输入与选项标签相同的文字，也仍交给Agent解释，不能自动改变重复发生或资金模式。选择只补充条件，不批准入账。

## 工具与Ledger业务

`read/query`读取完整普通收支汇总；daily排除借还本金，cashflow包含其资金流。`read/records`读取现有台账，`read/draft_matches`核对当前草稿。疑似重复只提供证据，不自动删除、合并或跳过；相同字段不能证明同一次发生。金额差额由整数分计算，有限明细不能替代完整汇总。

无歧义、无依赖的独立只读新目标可以用initial_reads逐项执行读取；直接展示真实结果使用result，解释或比较使用analysis。混合写任务、澄清、依赖及已有清单修订走正常循环。优化参数不适用不丢弃任务清单；已完成查询不重放。

`preview/command`和`preview/event`只生成影响预览。钱款借还及送收礼统一核对台账、资金流水和关联；实物估值不形成付款，也不能取消独立明确的礼金流水。cashflow=none须当前事项明确不计流水的cashflow_basis或已核实的结构化条件。实际付款与礼品价值分别保存，差异不能自动变成额外交易。

草稿edit/update/remove/sort由页面实际应用后返回delivery_result。remove可恢复，只标记参与入账，不删已保存数据。undo恢复已入账草稿与管理删除是不同业务操作，撤销须同时核对数据库凭据。

## 批准、取消与执行

单一控制请求可直接使用control；组合目标中的控制绑定control/local事项。本机卡片与服务端方案均以SHA-256摘要表示内容版本，模型无需复制完整快照；实际执行仍核对原卡片快照。决定包含目标类型及ID、实际operation与revision、本轮完整user_quote、明确的requested_operation、changes_json和必要的target_reference。

服务端独立读取账号、会话内的方案和任务。多个可操作对象时，引用须来自本轮原文并唯一对应方案摘要；业务操作类型不一致、方案版本变化或包含修订条件均不能执行原方案。修订后重新预览和批准。新目标保留无关待确认方案，取消只针对确定对象；已完成结果不因此撤销。

后台模型只持久化决定，不直接调用需要登录会话的写接口。页面调用`POST /api/assistant/tasks/:id/control`，只提交attempt和output_id；服务端从当前检查点读取已保存决定并重新核验身份、状态和范围，拒绝客户端提供新的执行参数。已有assistant_actions原子pending→executing、数据指纹、事务和幂等ID继续控制实际写入。响应丢失后用原ID核对，不新建同一操作。

控制回执从真实assistant_actions或任务状态读取，保存在历史输出中，刷新后不会恢复旧控制。原业务任务从真实批准或入账凭据恢复，先按实际受影响ID回读字段及关联，再继续剩余事项。失败、取消、过期和部分成功停止后续自动执行并保留凭据。

## 输出、界面与历史

回复的执行结论来自真实工具结果、凭据和页面回执；模型文字用于说明或具体提问。查询分析与执行结果分开保存，不按成功或失败短语推断任务状态。

更正关系由replaces_output_id及卡片link字段决定，不依同名、金额或回复文字关联。历史问题保留，旧卡片失去按钮，只指向当前输出。成员选择、编辑、排序及更正保留稳定批次身份，刷新和轮询不能覆盖用户编辑或复活旧审批。

业务错误的输入定位使用草稿字段校验，步骤标题及已执行事项文案由动作和状态生成，不解析本地化错误或显示标题。历史审批的固定到期说明仍有只用于显示的迁移清理；日期证据和金额、ID格式仍执行必要校验。这些都不识别用户意图或决定金融操作。

## 验证

```sh
LEDGER_TASKS_PGLITE_MODULE=/tmp/ledger-agent-sql-fixture/node_modules/@electric-sql/pglite \
LEDGER_UNDO_PGLITE_MODULE=/tmp/ledger-agent-sql-fixture/node_modules/@electric-sql/pglite npm test
npx tsc --noEmit
npm run lint
npm run build
node scripts/evaluate-assistant-semantics.mjs --live --repeat 2
node scripts/evaluate-assistant-workflow.mjs --live
```

确定性测试验证实际调度、校验和回放；PGlite集成测试执行隔离的真实PostgreSQL语句，不连接账户DATABASE_URL。真实模型脚本拒绝导入账户数据库，使用合成上下文、工具和凭据，会产生模型调用费用；报告保存在output/，不能提交。`--scenario`可单独选择场景，`--output`可指定报告路径。

脚本通过证明的是列出的隔离场景，不能推断所有表达、真实账户页面或生产部署已经验收。运行波次最多8步，组合目标最多32项及192累计步；格式错误和实际读取失败保留可续接状态，不将中间结果冒充完成。
