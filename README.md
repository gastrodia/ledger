# AI记账


让每一笔，都心里有数。AI记账是一个基于 **Next.js 16 + React 19** 的个人/家庭账本 Web 应用，包含 AI 对话记账、交易记录、分类与成员管理、统计分析（含可选 AI 月度总结）、便利贴（Markdown）、礼簿、送礼台账、欠款/借款（支持部分归还）以及附件上传能力，并内置 PWA（离线页 + Service Worker）。

![AI记账登录页](cover.png)

技术栈
---

- **框架**：Next.js（App Router）
- **UI**：Tailwind CSS + Radix UI + lucide-react
- **数据库**：PostgreSQL（Neon Serverless 驱动 `@neondatabase/serverless`）
- **鉴权**：JWT（`jose`）+ HttpOnly Cookie（`session`）
- **附件**：Vercel Blob（`@vercel/blob` / `@vercel/blob/client`）
- **AI（可选）**：Vercel AI SDK 7 + OpenAI Compatible provider，直连阿里云百炼；Zod 统一输出结构，统计总结流式返回
- **PWA**：`public/sw.js`、`public/manifest.webmanifest`，生产环境自动注册

功能概览
---

- **交易记录**：收入/支出、日期筛选、分类/成员筛选、金额汇总；支持上传图片/PDF 附件（最大 10MB）
- **分类管理**：收入/支出分类，支持预设模板快速创建（Emoji 图标）
- **成员管理**：家庭成员（用于交易归属统计）
- **统计分析**：按月份聚合统计（分类/成员 Top、收入/支出/结余）；支持隐藏收入金额
- **AI 总结（可选）**：基于当月统计数据生成“可读、可执行”的月度总结（流式输出）
- **便利贴**：五色纸张贴墙，快速新建/原地编辑、颜色与内容筛选、置顶分区、归档收纳；支持 Markdown 和图片上传
- **礼簿**：按“事件/礼簿”管理礼金/礼品（含估值）汇总
- **送礼**：记录“我送给别人”的现金 + 多行物品组合礼（含估值），支持筛选与附件
- **欠款/借款（借还）**：欠款/借款分组展示；支持部分归还、归还列表、附件与状态（未还/部分/结清）
- **PWA**：生产环境注册 Service Worker，提供离线页

快速开始
---

步骤 1：安装依赖

运行环境需要 Node.js 22 或更高版本（AI SDK 7 的要求）。本仓库带有 `bun.lock` 和 `pnpm-lock.yaml`；可使用 Bun 或 pnpm 安装依赖，`db:init` 脚本默认使用 bun。

```bash
bun install
```

步骤 2：配置环境变量

在项目根目录创建 `.env.local`（或在部署平台配置同名环境变量）：

```bash
# 必填：Postgres 连接串（Neon / 自建 Postgres 均可）
DATABASE_URL="postgres://USER:PASSWORD@HOST:PORT/DB?sslmode=require"

# 必填：用于签发/校验登录态 JWT，缺失时服务拒绝启动
# 使用足够长的随机值，例如 openssl rand -base64 32
JWT_SECRET="replace-me-with-a-long-random-secret"

# 可选：启用统计页“AI总结”（阿里云百炼）
DASHSCOPE_API_KEY="..."
# 可选：覆盖默认模型
BAILIAN_SUMMARY_MODEL="qwen3.8-max"
BAILIAN_ASSISTANT_MODEL="qwen3.8-max"
BAILIAN_ASR_MODEL="qwen3-asr-flash"
BAILIAN_REALTIME_ASR_MODEL="qwen3-asr-flash-realtime"
# 默认北京旧域名仍可用；设置业务空间 ID 可使用专属域名
# DASHSCOPE_WORKSPACE_ID="..."
# 其他地域请设置与 Key 匹配的 OpenAI 兼容接口地址
# DASHSCOPE_BASE_URL="https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"
# 香港接入地址还需匹配工作空间的部署范围与模型权限。
# qwen3.8-max 的香港接入需选择“全球”部署范围；不代表仅在香港推理。
# “中国香港”范围可核对 qwen3.5-flash，但需先确认该空间具备模型调用权限。
# 以百炼控制台及对应模型文档为准；/models 列出模型不代表当前 Key 有调用权限。

# 可选：启用附件上传（Vercel Blob）
# 本地/非 Vercel 环境通常需要手动配置
BLOB_READ_WRITE_TOKEN="..."
```

步骤 3：初始化数据库表结构

项目使用 `scripts/init-db.sql` 定义表结构，脚本 `scripts/init-db.ts` 会按语句顺序执行。

```bash
bun run db:init
```

如果你不想安装 Bun，也可以直接用 psql 执行 SQL（确保能连接到 `DATABASE_URL` 对应的库）：

```bash
psql "$DATABASE_URL" -f scripts/init-db.sql
```

步骤 4：启动开发环境

```bash
bun run dev
```

访问：

- `http://localhost:3000`（会重定向到 `/dashboard`，未登录会被中间件重定向到 `/login`）

常用命令
---

```bash
bun run dev      # 本地开发
bun run build    # 构建
bun run start    # 生产启动
bun run lint     # ESLint
bun run db:init  # 初始化数据库表结构
```

认证与路由保护
---

- **登录态**：`session` Cookie（HttpOnly）
- **保护路由**：`/dashboard/*` 需要登录；未登录会重定向到 `/login?redirect=/dashboard/...`
- **登录/注册**：`/login`、`/register`；已登录访问会被重定向到 `/dashboard`

API 概览（节选）
---

以下接口均位于 `app/api/**/route.ts`，大多需要登录（未登录返回 401）。

- **Auth**
  - `POST /api/auth/register`：注册并写入 `session` Cookie
  - `POST /api/auth/login`：登录并写入 `session` Cookie（支持邮箱或用户名）
  - `POST /api/auth/logout`：退出登录（清 Cookie）
  - `GET /api/auth/me`：获取当前会话信息

- **交易**
  - `GET /api/transactions`：查询交易列表（支持 type/categoryId/memberId/startDate/endDate）
  - `POST /api/transactions`：新增交易（可包含附件 URL/名称/类型）
  - `PATCH /api/transactions/:id`：更新交易
  - `DELETE /api/transactions/:id`：删除交易

- **分类 / 成员**
  - `GET/POST /api/categories`，`PATCH/DELETE /api/categories/:id`
  - `GET/POST /api/members`，`PATCH/DELETE /api/members/:id`

- **统计**
  - `GET /api/stats?month=YYYY-MM`：月度统计（分类/成员聚合 + 总计）
  - `GET /api/stats/ai-summary?month=YYYY-MM`：AI 月度总结（**流式**文本返回，需要 `DASHSCOPE_API_KEY`）

- **便利贴**
  - `GET/POST /api/notes`，`PATCH/DELETE /api/notes/:id`

- **礼簿**
  - `GET/POST /api/giftbooks`，`PATCH/DELETE /api/giftbooks/:id`
  - `GET/POST /api/giftbooks/:id/records`：礼簿记录
  - `PATCH/DELETE /api/gift-records/:id`、`PATCH/DELETE /api/gift-record-groups/:id`（分组/记录）

- **送礼**
  - `GET/POST /api/gifts-given`，`GET/PATCH/DELETE /api/gifts-given/:id`

- **欠款/借款（借还）**
  - `GET/POST /api/loans`，`GET/PATCH/DELETE /api/loans/:id`
  - `GET/POST /api/loans/:id/repayments`：归还列表/新增归还
  - `PATCH/DELETE /api/loan-repayments/:id`：编辑/删除归还

- **附件上传（Vercel Blob）**
  - `POST /api/blob/upload`：获取上传 token（需要登录 + `BLOB_READ_WRITE_TOKEN`）

附件上传说明
---

- **允许类型**：图片（`image/*`）或 PDF（`application/pdf`）
- **大小限制**：最大 10MB
- **上传路径限制**：仅允许以下前缀：
  - `transactions/`、`notes/`、`giftbooks/`、`loans/`、`loan-repayments/`、`gifts-given/`
  - 新上传使用 `模块/用户ID/随机上传ID/文件名`，服务器验证用户归属和实际 Blob；禁止覆盖已有文件。
  - 历史附件可继续查看和保留，但无法验证上传归属的旧文件不会被自动物理删除。
- **注意**：本地/非 Vercel 环境通常需要手动配置 `BLOB_READ_WRITE_TOKEN`，否则 `/api/blob/upload` 会返回 500。

AI 总结说明
---

- **接口**：`GET /api/stats/ai-summary?month=YYYY-MM` 或 `?year=YYYY`，可附加 `asOf=YYYY-MM-DD` 与统计页面保持相同日期口径
- **依赖**：需要设置 `DASHSCOPE_API_KEY`；默认模型为 `qwen3.8-max`，可用 `BAILIAN_SUMMARY_MODEL` 覆盖。采用百炼普通 API 按量计费，Key 与地域需匹配。
- **分析口径**：分类占比、笔均金额与结余比例由服务端计算；未结束期间按已过天数对比上期，单独标明未来日期记录；年度提供逐月趋势，月度提供逐日趋势。无记录时不调用模型。
- **错误处理**：限流、模型权限、连接超时分别返回可读提示；前端解析 JSON 错误，避免把错误对象当总结显示。
- **返回**：`text/plain; charset=utf-8`，并以 **ReadableStream** 方式逐段返回（前端边读边渲染）

数据库结构（概览）
---

初始化脚本位于 `scripts/init-db.sql`，主要表包括：

- **users**：用户
- **categories**：分类（收入/支出）
- **members**：家庭成员
- **transactions**：交易（可选关联分类/成员；可选附件字段）
- **notes**：便利贴（支持置顶/归档）
- **giftbooks / gift_records**：礼簿与礼簿记录
- **given_gifts**：送礼记录（含 `items` JSONB）
- **loans / loan_repayments**：欠款/借款及归还记录

目录结构
---

```text
app/                Next.js App Router（页面与 API）
  api/              REST 风格 API routes
  dashboard/        登录后页面（交易/分类/成员/统计/礼簿/送礼/借还/留言）
components/         UI 组件、布局、PWA 注册等
lib/                鉴权、数据库连接、工具函数、各模块 schema 辅助
scripts/            数据库初始化脚本（SQL + 执行器）
public/             PWA 资源（sw.js、manifest、offline.html 等）
types/              共享类型定义
middleware.ts       路由保护与重定向
```

部署提示（Vercel 推荐）
---

- 在部署平台配置环境变量：`DATABASE_URL`、`JWT_SECRET`，如需附件/AI 则加上 `BLOB_READ_WRITE_TOKEN`、`DASHSCOPE_API_KEY`
- 生产环境会注册 Service Worker（见 `components/pwa/register-sw.tsx`）

Vercel + Neon（Postgres）部署（重要）
---

本项目使用 `@neondatabase/serverless` 通过 `DATABASE_URL` 连接 Postgres。**推荐在 Vercel 使用 Neon 集成**来创建/绑定数据库，并让 Vercel 自动注入环境变量。

步骤 1：在 Vercel 绑定 Neon 数据库

- 在 Vercel 项目中添加 Neon（Postgres）集成，并选择/创建数据库（或分支）
- 集成完成后，通常会自动注入以下变量（以你的控制台为准）：
  - `DATABASE_URL`：**pooled** 连接串（走 Neon pooler / PgBouncer），更适合 Web/Serverless 运行时
  - `DATABASE_URL_UNPOOLED`：**直连**连接串（不走 pooler），更适合一次性工具/管理操作
  - 以及一组 `PG*` 变量（如 `PGHOST`、`PGUSER` 等）

步骤 2：选择用哪个连接串？

- **应用运行时**：优先用 `DATABASE_URL`（pooled）
- **初始化/手动执行 SQL**：可用 `DATABASE_URL_UNPOOLED`（直连）或 Neon 控制台的 SQL Editor

> 说明：本项目的代码默认读取 `DATABASE_URL`（见 `lib/db.ts` 和 `scripts/init-db.ts`）。

步骤 3：初始化表结构（首次必须做一次）

你有三种方式任选其一：

- **方式 A：Neon 控制台 SQL Editor**：把 `scripts/init-db.sql` 粘贴执行（最省事）
- **方式 B：本地执行（推荐）**：把本地 `.env.local` 的 `DATABASE_URL` 临时指向 Neon（建议用 `DATABASE_URL_UNPOOLED`），然后运行：

```bash
bun run db:init
```

- **方式 C：psql 执行**：

```bash
psql "$DATABASE_URL_UNPOOLED" -f scripts/init-db.sql
```

步骤 4：常见坑（很关键）

- **SSL**：Neon 连接通常需要 `sslmode=require`（很多 Neon 提供的连接串已自带）
- **连接数/并发**：在 Vercel 上并发较高时，优先使用 pooled 连接串（`DATABASE_URL`）以降低直连连接数压力
- **Preview 环境**：如果你启用了 Neon Previews/分支功能，注意 Vercel 的 Preview 环境也要注入对应的 `DATABASE_URL`（集成通常会自动处理）

手动关联收支
---

- 送礼、收礼组、借还单、归还记录均可手动关联一笔已有收支，支持更换和解除。每笔收支最多关联一个来源，重复提交同一关联可安全重试。
- 关联只保存对应关系，不创建交易、不同步金额，也不改变任何台账或统计口径。删除来源只清除关系；删除收支只清除关系，其他台账的记录仍保留。
- 收礼按整个 `group_id`（历史记录按 `COALESCE(group_id,id)`）关联，不依附礼金行。编辑时删除礼金、替换礼品行不会丢失组关联；整组或礼簿删除才解除。
- `GET /api/transaction-links?sourceType=given_gift&sourceId=...` 返回 `{data: transaction|null}`；批量用 `sourceIds=id1,id2`（最多 100 个），返回 `{data:[{sourceId,transaction}]}`，只含当前账户仍存在的已关联来源。
- `PUT /api/transaction-links` 接收 `{sourceType,sourceId,transactionId}`；`DELETE` 接收 `{sourceType,sourceId}`。`sourceType` 支持 `given_gift`、`gift_group`、`loan`、`repayment`。
- 返回的 `transaction` 含 `id`、`type`、数值 `amount`、`description`、`transaction_date`。已被其他来源占用返回 409 / `TRANSACTION_ALREADY_LINKED`；并发变更返回 409 / `LINK_CONFLICT`，应刷新后重试。
- 新数据库执行 `scripts/init-db.sql`。已有数据库可由管理员在各模块基础表已存在后执行 `scripts/transaction-links.sql`，其中包含关联表、外键和延迟组清理触发器；请完整执行。应用首次使用会尝试初始化，缺少权限明确返回 503 / `LINK_SCHEMA_UNAVAILABLE`，不会以成功或未关联状态掩盖配置失败。已初始化后的读写不再需要 DDL 权限。

便利贴升级
---

- `/dashboard/notes` 为便利贴墙；原有 `/new` 与 `/:id` 链接继续可用，打开相同的便利贴编辑面板。
- 旧笔记保持原始标题、Markdown 和图片内容，默认显示为奶油黄色。颜色保存在数据库中，可跨设备同步。
- 新库使用 `scripts/init-db.sql`；旧库首次访问时仅在缺少 `notes.color` 时尝试追加字段。运行账户没有 DDL 权限时，请由管理员执行 `scripts/notes-sticky.sql` 后重试；不需要清空或重建 notes 表。
- 编辑内容仅在当前面板保留，点击“保存”或“贴上去”才提交服务器；关闭前提醒放弃未保存内容，未完成上传或保存时禁止关闭面板。普通录入表单不再保存或恢复本机草稿，进入任一账本页面会清理旧录入草稿；AI 对话相关本机存储继续保留。

### 分类拖动排序

- 分类管理中拖动卡片左上角手柄，可在收入、支出各自分组内调整顺序；松开后自动保存，记账分类选择器沿用相同顺序。支持触屏，键盘可用空格键开始/确认、方向键移动、Escape 取消。
- 保存期间暂时禁用排序和编辑；失败恢复原顺序，列表发生变化时重新加载。
- `sort_order` 为可空整数，旧分类在首次排序前保留创建时间倒序；已排序后新增分类放在该组末尾。首次读取会尝试增量添加该列；无 DDL 权限的部署请先执行 `scripts/categories-sort.sql`。


对话记账与语音

- 入口：侧栏或手机底栏「AI 记账」，路径 `/dashboard/assistant`。
- 文字或账单截图会生成最多20笔可编辑草稿，分类和家庭成员必填；金额、日期、收支类型和备注可修改。一次可选择或粘贴最多5张 JPG、PNG 或 WebP 图片，追加选择不会覆盖已有截图；支持逐张预览、删除和调整顺序，点击发送后才识别。发出的全部图片显示在聊天气泡内，可点击查看，并随本机对话草稿恢复。未入账草稿可直接删除单笔或整组，保存结果待核对时保持原批次锁定。支付方式保存在备注中，不代表支付账户余额。
- 未指定成员时，助手按组询问支出人或收入所属人，显示所有成员按钮；点击一次即可自动回复并补全本组所有待选成员的草稿，确认前仍可逐笔修改。初次补充时保留明确指定的成员，后续新账不会沿用上一次选择。可发送“把这组全改成某成员”修改最近一组尚未入账草稿的人员，也可指定某一笔；只说“修改支出人”且目标明确时会展示人员按钮，选中后自动回复并原位更新；选择前保持原人员，可取消，待选择请求随对话草稿恢复。卡片原位更新，金额和日期保持不变，仍需用户确认入账。已保存或保存结果待核对的草稿不能通过聊天修改。历史聊天只用于理解上下文，不重新记账。转账、借贷和不明确的退款先澄清。
- 语音最多60秒，通过 AudioWorklet 实时采集并重采样为16kHz单声道 PCM16，每100毫秒经 WebSocket 网关发送给千问实时 ASR；识别中的文字动态显示在输入框中，同一句临时结果会被最终文字替换。点击停止后等待最后一段识别完成，再核对、编辑和发送。保留录音前已有文字，断线保留已显示文字；清空对话、退出登录或离开页面会停止录音并丢弃旧会话结果。浏览器需要 HTTPS（localhost 可用）、AudioWorklet 和麦克风权限；不支持实时录音时可选音频文件走原有整段转写。
- 多图拆成逐张识别任务，每轮最多按原图顺序处理两张，前图完成后再传递月份信息，结果按原图顺序汇总；每个请求只输出目标图交易，并携带紧邻前图及有来源的月份信息用于核对日期。保持原图可读性，不合成长图后再压缩。服务端仅衔接相邻流水截图中有相同日期、金额、商户及明示时间或交易单号的重叠边界；同图的多笔真实交易、证据缺失或不明确的疑似重复都会保留并提示核对。页面展示合并图片数、去重数和保留数；不对历史对话或已入账交易自动删重。截图中的月份汇总、划线原价、优惠金额不生成交易。合并后仍最多20笔，超限须分批，不能悄悄截断。
- 「核对账目」旁的排序按钮依次切换原顺序、日期正序、日期倒序；同日账目保留识别时的顺序，未填写或无效的日期放在末尾。每组单独记住排序，刷新自动恢复；聊天中的“第三笔”等序号以当前显示顺序为准。排序不修改账目内容，也不改变确认入账及失败重试的原始批次。
- 已入账卡片提供「撤销入账」，也可在对话中说“撤销这笔”“撤销第三笔”或“撤销整组”；目标不明确时先澄清。撤销成功会删除对应入账记录并自动恢复可编辑草稿，保留金额、日期、分类、成员和支付方式，重新确认使用新批次。旧版已入账卡片支持整组撤销；已在交易记录中修改、删除或添加附件的账目会拒绝撤销并提示核对。撤销结果未知时保留原操作核对入口，清空对话不会丢失进行中的撤销；成功后只恢复草稿，不恢复旧聊天。
- 截图在浏览器缩小到最长边1920px，仅发送本次选择的图片，单张 data URL 最多2,000,000字符，总计最多4,000,000字符；聊天展示副本每组总计最多400,000字符，保持完整图片比例。语音不会存到附件服务。必要的分类、成员或查询结果会发送给百炼。
- 对话、未发送文字和待发送图片保存在当前用户的本机草稿中；进入页面自动恢复，退出登录会清理。清空对话随时可用，会移除聊天、未提交草稿和待发送内容，停止识别、录音与转写；已发出的入账请求保留独立的原批次核对入口，结果返回不会恢复旧聊天。保存结果未确认时锁定原批次，重试不会重复记账。
- 聊天及账本分析文字随任务进度逐步显示；记账卡片、修改成员和撤销目标仍在完整结果校验后处理，确认入账仍由用户点击。服务器接收任务后，切页、刷新或关闭页面只断开进度读取，不停止后台生成；回到同一本机会话后自动读取进度和最终结果。识别完一张就保存一张，页面显示真实完成数量、正在识别和失败的图片编号。失败或停止后保留最早未完成图片之前的成功结果，从该图片起重新识别后续图片，避免前图失败造成缺失或过期月份被缓存复用。识别配置或分类/成员数据改变时会重新识别，无需再次上传；任务与回复使用稳定 ID，刷新不会重复追加卡片，也不会覆盖已经核对编辑或删除的草稿。恢复的撤销意图不会自动执行账本删除，需通过原账单卡片操作。
- 已发送的识别任务及原始识别输入按账户保存在数据库，本机草稿保存会话 ID、消息和待确认卡片。清空对话会切换会话并取消旧会话未完成的任务；点击停止会主动取消当前任务。网络故障导致无法确认任务是否被接收时，页面保留恢复入口，不把未知状态当成识别成功。未完成轮次不进入后续模型上下文。
- `POST /api/assistant/tasks` 创建幂等任务，`GET /api/assistant/tasks?conversation_id=…` 恢复会话任务，`GET /api/assistant/tasks/[id]` 获取进度和结果；`PATCH` 支持 `retry`（带观察到的 `attempt`）和 `cancel`，`DELETE /api/assistant/tasks?conversation_id=…` 取消会话未完成任务。所有接口校验登录账户，同任务 ID 不能用于不同输入；后台只生成并保存计划，不调用确认入账或撤销接口。
- 任务通过 Next.js 的 [`after`](https://nextjs.org/docs/app/api-reference/functions/after) 在响应结束后执行，任务接口声明 `maxDuration = 300`；部署平台必须支持 `after`/`waitUntil` 并允许足够的函数执行时间。每轮有独立执行标识，数据库条件更新隔离迟到结果、重试和取消。图片任务保存每张结果后，通过带用途隔离签名的服务器请求接续下一轮，不依赖浏览器保持打开；每次接续进入新的函数调用。服务器接续失败时保留已完成结果，页面读取任务时可重新调度。它不是保证跨服务器宕机自动续跑的外部队列；执行进程被终止或超时的任务会转为可重试失败，不会永久显示处理中。任务表首次访问时自动创建；无 DDL 权限时先执行 `scripts/assistant-tasks.sql`。本地验证不能代替部署后的关闭页面恢复验收。
- `POST /api/assistant` 可传 `stream: true` 获取 `application/x-ndjson` 事件流：`status` 为处理阶段，`delta` 仅含回复文字，`result` 携带完整校验后的计划，`error` 表示失败；没有 `result` 不能视为完成。不传 `stream` 保留原 JSON 响应。
- `POST /api/assistant` 识别意图和账单（支持 `images` 数组，兼容原有 `image` 单图字段，二者不能同时传入），查询时由参数化 SQL 计算真实汇总后生成回答；模型不能执行SQL或写数据库。
- `POST /api/assistant/transcribe/session` 签发60秒有效、仅用于语音网关的一次性授权票据；`WS /api/assistant/transcribe/realtime` 双向传输音频块与识别文字。`POST /api/assistant/transcribe` 保留音频文件转文字；`POST /api/assistant/confirm` 原子批量确认，按用户和批次ID幂等，拒绝不同内容复用批次。
- `POST /api/assistant/undo` 按用户、确认批次及撤销请求ID执行原子撤销，校验原始入账快照与当前记录；重复核对返回相同的恢复草稿，撤销后的原批次不能再次确认。`assistant_batches` 与 `assistant_undos` 在首次确认或撤销时按需创建和补齐字段；无DDL权限的部署请先执行 `scripts/init-db.sql` 中相关建表及迁移语句。
- 使用普通百炼 API Key。Coding Plan 等有专门用途的订阅不能直接当作本产品的通用 API 配额。
- 服务器接续地址优先使用显式配置的 `ASSISTANT_TASK_ORIGIN`，Vercel 生产环境没有自动化访问密钥时使用 `VERCEL_PROJECT_PRODUCTION_URL` 的公开生产域名，其他情况使用 `VERCEL_URL`；预览环境不会向生产域名接续任务。自建生产部署需要配置本应用的 HTTPS 根地址，本地开发默认 `http://localhost:3000`（可用 `PORT` 修改）。接续签名复用 `JWT_SECRET` 派生独立用途密钥，不向浏览器暴露，不能作为登录凭证。部署保护启用时需提供平台的 `VERCEL_AUTOMATION_BYPASS_SECRET`；接续错误会保留任务供页面恢复，不反复调用模型。已有数据库通过 `scripts/assistant-tasks.sql` 增加 `run_token`、`image_progress`、`image_checkpoint` 字段；应用有 DDL 权限时首次访问自动迁移。

### 实时语音运行与部署

- `pnpm dev` 同时提供 Next.js 页面与语音 WebSocket，默认 `http://localhost:3000`；`pnpm build && pnpm start` 以同样方式启动 Node 生产服务。升级后需要重启旧的 `next dev` 进程，页面热更新不会给旧进程增加 WebSocket 路由。
- 网关默认读取现有 `DASHSCOPE_API_KEY`、`DASHSCOPE_BASE_URL` / `DASHSCOPE_WORKSPACE_ID`；实时模型独立使用 `BAILIAN_REALTIME_ASR_MODEL`，默认 `qwen3-asr-flash-realtime`。必要时用 `DASHSCOPE_REALTIME_URL` 配置同地域的百炼 `wss://…/api-ws/v1/realtime` 地址（不带查询参数）。
- 自建 Node 服务的反向代理需转发 WebSocket Upgrade，并允许至少90秒连接；在服务端配置 `SPEECH_ALLOWED_ORIGINS=https://你的账本域名`，多个来源用逗号分隔。本地默认只允许 localhost/127.0.0.1。
- **Vercel 可直接使用同域实时语音接口。** 在项目设置中开启 Fluid Compute，并重新部署包含本次语音接口的版本；实现使用 Vercel WebSocket Public Beta 的 `experimental_upgradeWebSocket`，单次函数最长120秒。沿用现有 `DASHSCOPE_API_KEY` 和 `JWT_SECRET`；可设置 `BAILIAN_REALTIME_ASR_MODEL=qwen3-asr-flash-realtime`（默认值）及 `SPEECH_ALLOWED_ORIGINS=https://ledger.jiajiwei.top`（不设置时只允许当前请求的同域网页）。生产网页自动连接 `wss://ledger.jiajiwei.top/api/assistant/transcribe/realtime`，无需配置 `SPEECH_GATEWAY_URL` 或另备语音域名。Fluid Compute 是平台设置，不是环境变量；仅本地测试通过不代表 Vercel 已启用或线上已验收。参见 [Vercel WebSocket 文档](https://vercel.com/docs/functions/websockets)。
- 如果选择独立语音服务，可在支持 WebSocket 的主机部署本仓库并执行 `pnpm speech`（默认3001端口，可用 `SPEECH_PORT` 修改），以 HTTPS/WSS 反向代理暴露 `/api/assistant/transcribe/realtime`。网关配置与账本相同的 `JWT_SECRET`、百炼配置和 `SPEECH_ALLOWED_ORIGINS`；此时才在页面服务配置 `SPEECH_GATEWAY_URL=wss://语音服务域名/api/assistant/transcribe/realtime`。
- 授权票据通过第一条 WebSocket 消息发送，地址中不携带密钥。网关限制每用户两条连接、每次60秒音频、连接时长及缓冲大小，不存储录音或识别文字。票据防重放与并发限制保存在单个网关进程中；部署多实例时应使用共享存储实现这两项限制。
- 协议依据：[百炼实时 ASR 客户端事件](https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-client-events)、[服务端事件](https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-server-events)。

### AI 调用与编排

- `lib/bailian.ts` 使用 AI SDK 的 `generateText`、`Output.object` 和 `streamText`，经 `@ai-sdk/openai-compatible` 直接调用百炼。继续使用现有 `DASHSCOPE_*` 与 `BAILIAN_*_MODEL` 配置，无需 AI Gateway 凭证。
- 文字请求由 `lib/assistant-output.ts` 定义输出结构；截图使用 `lib/assistant-image-recognition.ts` 的精简 Zod 结构和专用提示词，仅发送本次图片、当前要求、日期及分类/成员名称，不附带历史聊天或已有账单。模型用短编号选择分类和成员，服务端映射回当前账户 ID，继续经过去重及 `validatePlan` 的金额、日期和归属校验；卡片仍需手动确认入账。
- 对话支持 `record/query/update/undo/chat` 五种动作。查询由固定参数化 SQL 读取真实数据，再交给总结模型；撤销意图只能指定当前已入账卡片中的目标，由页面调用独立撤销接口，模型回复本身不能代表执行成功。选人、卡片删除、确认及卡片撤销不调用模型。
- 图片与音频文件转写使用 SDK 的多模态消息；实时麦克风走百炼 ASR WebSocket，由服务端保管 API Key。百炼兼容钩子只处理音频 data URL、专用参数以及流结束检查；统计页对外仍返回原有纯文本流，客户端无需迁移消息协议。
- 模型请求默认超时90秒；后台截图改为每张90秒、每轮最多两张按顺序识别，单轮任务预算240秒，任务路由 `maxDuration = 300`。超过一轮的图片由服务器接续处理。同步接口、文字及语音继续使用原预算。超时预算由服务端选择，支持主动取消，`maxRetries: 0`；结构化输出错误为422，截断或中断不会当作完整结果。
- 服务端日志记录任务读取/保存、上下文准备、首次模型文本或非空部分结果、完整模型调用、合并校验及结果写入耗时，通过任务 ID 和服务端生成的 `telemetryId` 关联。首次部分结果不代表卡片已校验完成；`requestReadMs` 也不是完整的浏览器上传耗时。只记录耗时、图片大小/数量、提示词字符数、模型、用量及安全错误分类，不记录截图、对话或密钥。部署后可用相同的1/3/5张截图比较日志，确认实际收益。
- 服务端仅记录模型、调用类型、耗时和 token 用量；不记录提示词、图片、录音、模型答案或 API Key。
