# Ledger Agent

Agent负责理解本轮完整意图和明确指代，使用Ledger工具处理任务。自然语言批准、取消、修订、澄清和能力询问均由同一循环解释，不用短语表、关键词或问句形式选择操作。能力限定在Ledger已有记录、关联与统计，不提供付款、主动通知、任意SQL、终端、文件或外部网络操作。

## 职责与提示词

`assistant-agent-instructions.ts`定义通用目标、授权和结果原则；`assistant.ts`定义单动作契约；`assistant-commands.ts`、`ledger-event.ts`和`assistant-draft-actions.ts`定义Ledger数据语义与工具参数；`assistant-native-tools.ts`提供原生工具schema与传输适配；`assistant-control.ts`定义针对现有对象的控制决定。工具参数复用现有Zod契约，程序仍执行完整业务校验。各模块保留字段、单位、能力与业务约束，不枚举用户说法，不默认最近方案就是被引用对象。

文字Agent通过`bailianTool`每轮选择一个原生工具，不自动执行SDK工具回调。业务工具包括`query_statistics`、`read_records`、`match_drafts`、`prepare_command`、`prepare_event`、`prepare_records`、`draft_action`、`navigate`及`control`；`set_workflow`建立完整清单，`revise_workflow`只提交未完成事项的改动，`reuse_result`核对同次发生，`respond`提交解释或澄清状态。修订由程序保留已完成事项与凭据、组装完整清单后进入原有覆盖、依赖、事项不可变与降级校验。普通解释不用建立业务清单。

工具可用范围同时依据真实页面资源，不能依据模型自己写的清单假设对象存在：没有draft_batch就不提供草稿查重/编辑，没有saved_batch就不提供批次撤销。已保存记录的修改使用manage及prepare_command，update仅是草稿成员修改。错误的本地编辑清单不会遮蔽资源预览工具；执行前仍要求先修订正确action/effect。数据库记录ID只从真实记录结果及已保存批次映射提供，审批/任务/卡片ID不是记录ID；SDK约束不会替代服务端账户、范围和快照校验。

模型参数为结构化对象：`command.values`与`control.changes`不再是JSON字符串。`arguments_json`/`plan_json`仅保留为调度器内部和旧数据的适配格式，模型不再生成它们。工具对应业务能力，卡片由真实结果映射；模型不能设置入账成功或凭据。只读草稿核对用chat/read事项并调用`match_drafts`，得到候选即完成核对，不强制用户追加处置决定。

图片识别与文字分页是只提取事实的子工具，其提示词约束来源、资金方向、完整覆盖和分页顺序。类别按完整语义选择可用ID，成员仅依据明确指定，未知值保持未确定。日期和金额的格式校验、分页证据及缓存版本保留；修改提取契约时更新缓存版本，不能混用旧结果。

## 任务与续接

业务目标先保存完整operations清单，包含稳定事项ID、action、read/write/local、依赖、questions及原文sources。每一步引用当前未完成事项；已完成操作不能重放，业务澄清不能丢失剩余目标或执行凭据。互不相关事项不增加依赖，有歧义的事项先核对或询问，不准备可执行审批。

恢复执行时从当前代码刷新system指令，检查点只延续原目标、对话事实、事项与凭据，不能继续沿用过时的短语路由prompt。

回答按原任务ID、attempt、输出ID和回答消息ID续接；原目标日期保持初次today，明确修订的日期才使用answer_today。事项类型可以在读取或澄清后修订，但保留原ID和全量目标。写事项变成只读必须引用本轮已接受的revision_answers；服务端校验来源和身份，由Agent理解语义。

普通收支以covered_operation_ids绑定完整核对组。系统内部每页20笔，分页原文逐字覆盖、每笔映射恰好一次，完成全部提取后生成待确认草稿。每组输出使用独立稳定批次ID，不复用已入账批次。重复回答、重试和延迟worker受CAS及内容指纹约束。

服务端显示的事项选择按钮提交完整event_selection，必须匹配当前任务、当前输出与实际提供的选项。输入框即使输入与选项标签相同的文字，也仍交给Agent解释，不能自动改变重复发生或资金模式。选择只补充条件，不批准入账。

## 工具与Ledger业务

`read/query`读取完整普通收支汇总；daily排除借还本金，cashflow包含其资金流。`read/records`读取现有台账，`read/draft_matches`核对当前草稿。疑似重复只提供证据，不自动删除、合并或跳过；相同字段不能证明同一次发生。金额差额由整数分计算，有限明细不能替代完整汇总。

新目标通过set_workflow一次提交完整清单与reads：所有条件明确、无依赖的数据库只读事项必须提供参数，同一事项可以对应多个同类读取。程序从实际查询工具确定query/manage，不要求模型重复分类。参数经过现有清单覆盖、依赖和业务校验后保存为pending_reads，程序逐项执行；只有该事项全部读取成功才标记completed。恢复先执行剩余队列，已完成读取不重放；SQL失败保留原条件并暴露执行失败，不让模型重新规划。

记录读取按日期与ID稳定排序，使用50条一页的游标分页，保留完整日期范围，程序读取全部页。写预览仍保留50条范围限制及原有身份、快照、版本、批准、幂等和执行校验。完整只读结果保存在checkpoint并由程序展示；模型汇总只接收完整统计与记录计数、真实卡片指标，不重写全部明细。所有只读事项完成后调用一次无工具的文字汇总，解释与实际结果分别保存为analysis/reply，完成状态由程序决定。混合写任务、澄清和依赖读取继续使用原有流程。v1历史initial_read/initial_reads仍可恢复进入同一执行队列。

`preview/command`和`preview/event`只生成影响预览。钱款借还及送收礼统一核对台账、资金流水和关联；实物估值不形成付款，也不能取消独立明确的礼金流水。cashflow=none须当前事项明确不计流水的cashflow_basis或已核实的结构化条件。实际付款与礼品价值分别保存，差异不能自动变成额外交易。

草稿edit/update/remove/sort由页面实际应用后返回delivery_result。remove可恢复，只标记参与入账，不删已保存数据。undo恢复已入账草稿与管理删除是不同业务操作，撤销须同时核对数据库凭据。

## 批准、取消与执行

单一控制请求可直接使用control；组合目标中的控制绑定control/local事项。本机卡片与服务端方案均以SHA-256摘要表示内容版本，模型无需复制完整快照。模型选择目标类型及ID并提交requested_operation与changes对象；有多个可处理方案时还需target_reference。任务与非任务方案按既有校验分组，唯一对象时程序绑定null引用；没有清单的控制和普通回复不要求模型填写事项ID。程序从调用前提供的该对象快照绑定实际operation/revision，并绑定当前完整用户原文user_quote，再进入原有全部控制校验。不能在调用后换用较新版本；实际执行重新读取对象并核对版本与原卡片快照。

服务端独立读取账号、会话内的方案和任务。多个可操作对象时，引用须来自本轮原文并唯一对应方案摘要；业务操作类型不一致、方案版本变化或包含修订条件均不能执行原方案。修订后重新预览和批准。新目标保留无关待确认方案，取消只针对确定对象；已完成结果不因此撤销。

后台模型只持久化决定，不直接调用需要登录会话的写接口。页面调用`POST /api/assistant/tasks/:id/control`，只提交attempt和output_id；服务端从当前检查点读取已保存决定并重新核验身份、状态和范围，拒绝客户端提供新的执行参数。已有assistant_actions原子pending→executing、数据指纹、事务和幂等ID继续控制实际写入。响应丢失后用原ID核对，不新建同一操作。

控制回执从真实assistant_actions或任务状态读取，保存在历史输出中，刷新后不会恢复旧控制。原业务任务从真实批准或入账凭据恢复，先按实际受影响ID回读字段及关联，再继续剩余事项。最后一个已批准事项回读验证成功且全量清单已完成时，直接展示真实回执完成任务，不再调用模型重复查询。失败、取消、过期和部分成功停止后续自动执行并保留凭据。

## 输出、界面与历史

回复的执行结论来自真实工具结果、凭据和页面回执；模型文字用于说明或具体提问。查询分析与执行结果分开保存，不按成功或失败短语推断任务状态。

更正关系由replaces_output_id及卡片link字段决定，不依同名、金额或回复文字关联。历史问题保留，旧卡片失去按钮，只指向当前输出。成员选择、编辑、排序及更正保留稳定批次身份，刷新和轮询不能覆盖用户编辑或复活旧审批。

私有checkpoint v2在领域消息中增加原生调用身份和结构化反馈，保留全部业务ID、已完成凭据和分页提取的record_step。v1恢复进入同一个调度器时升级为v2，旧步骤只作为历史事实传入模型，不重放。调用/结果消息由适配层重建；后来的用户回答、批准回执和自动核对结果维持先后顺序，不能把后续核对移到批准之前。公开任务API仍不返回模型上下文或工具追踪。

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
node scripts/evaluate-assistant-native-tools.mjs --live
LEDGER_TASKS_PGLITE_MODULE=/tmp/ledger-agent-sql-fixture/node_modules/@electric-sql/pglite \
node scripts/evaluate-assistant-query-batch.mjs --live --repeat 2
```

确定性测试验证实际调度、校验和回放；PGlite集成测试执行隔离的真实PostgreSQL语句，不连接账户DATABASE_URL。真实模型脚本拒绝导入账户数据库，使用合成上下文、工具和凭据，会产生模型调用费用；报告保存在output/，不能提交。`--scenario`可单独选择场景，`--output`可指定报告路径。

脚本通过证明的是列出的隔离场景，不能推断所有表达、真实账户页面或生产部署已经验收。运行波次最多8步，组合目标最多32项及192累计步；格式错误和实际读取失败保留可续接状态，不将中间结果冒充完成。

Agent与语义脚本默认评估原生协议，记录调用数、耗时及可取得的token用量。`--legacy`读取`output/assistant-native-tools/`内改造前的源码快照，仅供相同合成场景对照；不在生产保留第二套调度器。对照快照和报告均为本地产物，不提交。原生传输测试只使用合成查询结果并拒绝加载账户数据库。工具模式校验与图片/分页结构化JSON输出的校验分别运行，模型调用可能产生费用。

## 前端会话职责

`app/dashboard/assistant/page.tsx`只组装布局、恢复提示、消息区和输入区。`hooks/assistant/use-assistant-controller.ts`组合各模块；会话状态与本机持久化由`use-assistant-session.ts`负责，任务订阅和检查点续接由`use-assistant-tasks.ts`负责，确认、撤销、成员和草稿操作由`use-assistant-actions.ts`负责，文字发送和媒体输入分别由`use-assistant-send.ts`、`use-assistant-input.ts`负责。界面滚动和定位由`use-assistant-feed.ts`负责；初始化成员、分类和配置由`use-assistant-setup.ts`负责。

`lib/assistant-conversation-state.ts`保留现有本机存储格式、恢复校验和历史迁移，在恢复、清空及退出登录时一次转换会话状态。流式回复直接取当前任务，不另存一份进度状态；预览、展开、录音计时等临时界面变化不改变持久化快照。`components/assistant/conversation-message.tsx`、`draft-editor.tsx`、`composer.tsx`只呈现原有交互。

确认与撤销的同步锁、原批次/操作ID、不可变请求快照和待核对记录继续保留。清空对话会取消会话内请求，但不取消正在核对的确认/撤销；其迟到结果不得恢复旧对话。刷新只恢复数据和查询进度，不自动批准入账；未知结果只按原身份和原载荷重试。
