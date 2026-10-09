# 对话回复展示规范

所有展示只读服务端结果或已验证的本地草稿；文字、展开明细、选择成员或下载文件均不代表批准写入。

| 回复场景 | 展示方式 | 复用组件 |
| --- | --- | --- |
| 普通解释、追问、流式分析 | Markdown 段落、标题、列表、引用、可横向滚动表格 | 现有 Markdown 表格组件与统一正文样式 |
| 日常收支、资金流动统计 | SQL 汇总金额、时间及筛选范围、分类与大额明细；分析文字可展开 | ReplyCard / Metrics / Records / Fields |
| 收支、借还、归还、礼簿、收礼、送礼、便签、分类、成员查询 | 对应名称、日期、金额或物品数量、明细；不展示内部 ID | ReplyCard / Records / Fields |
| 空查询 | 明确无结果及可调整的筛选条件 | ReplyNotice |
| 疑似重复查询 | 候选列表与“尚未删除”提示，不自动删除 | ReplyCard / Records / Notice |
| 导出 | 查询卡片内下载入口，保留服务端 CSV | ReplyCard 页脚 / Button |
| 打开页面 | 页面入口卡片 | ReplyCard 页脚 / Link |
| 送礼、收礼、借还关联候选 | 说明与纵向选项 | ReplyShell / Button |
| 成员选择与成员修改 | 复用原成员头像、选择逻辑 | MemberPicker / MemberLabel / ReplyShell |
| 截图识别汇总 | 图片与草稿数量、去重、零金额及警告 | ReplyCard / Metrics / Fields / Notice |
| 编辑、排序、删除草稿及撤销结果 | 处理结果卡片，保留具体成功或失败说明 | ReplyCard / Notice |
| 可编辑记账草稿与已入账卡片 | 本组收支合计、逐笔摘要、展开编辑、状态和底部操作；复用原表单与成员显示 | DraftCard / DraftRow / ReplyShell / Metrics / Badge / Notice |
| 草稿入账、删除、撤销确认 | 审阅快照的金额与逐笔明细、操作影响、确认与取消 | ActionCard / ReplyBody / ActionControls |
| 已保存记录修改与钱款事项确认 | 原有结构化确认卡片 | ActionCard / ReplyBody / ActionControls |
| 生成中、失败、停止和重试 | 原处理过程与重试行为，错误使用统一提示样式 | ProcessingDetails / ReplyNotice |

卡片共用圆角、边框、背景、标题层级、字号、金额与警告样式。列表默认展示前 5 条，其余由原生 details 展开，不截断数据。长说明可展开全文。旧查询有 record_context 时可恢复为卡片；缺少结构化统计的旧回复保留原文，不从模型文字反推金额。对话刷新后保持查询、导出和操作结果。

统计总计来源于完整 SQL 聚合，不使用最多 20 条的明细重新计算；日常统计排除借还本金，资金流水统计包含本金。送礼现金与物品估值独立展示，不把估值重新计入支出。

记账卡片金额汇总随草稿编辑更新；无效金额显示待核对，仍由原校验阻止提交。列表逐笔展示，不套用只读查询的前 5 条折叠；缺失字段自动展开，保留排序、确认、重试和撤销逻辑。状态标签与确认卡片共用 Badge。
