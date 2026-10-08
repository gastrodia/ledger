# Ledger（账本 / 礼簿 / 借还）


一个基于 **Next.js 16 + React 19** 的个人/家庭账本 Web 应用，包含交易记账、分类与成员管理、统计分析（含可选 AI 月度总结）、便利贴（Markdown）、礼簿、送礼台账、欠款/借款（支持部分归还）以及附件上传能力，并内置 PWA（离线页 + Service Worker）。

![](cover.png)

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
- **便利贴**：五色纸张贴墙，快速新建/原地编辑、颜色与内容筛选、置顶分区、归档收纳；保留 Markdown、图片上传和账户隔离的本机草稿
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
BAILIAN_ASSISTANT_MODEL="qwen3.7-plus"
BAILIAN_ASR_MODEL="qwen3-asr-flash"
# 默认北京旧域名仍可用；设置业务空间 ID 可使用专属域名
# DASHSCOPE_WORKSPACE_ID="..."
# 其他地域请设置与 Key 匹配的 OpenAI 兼容接口地址
# DASHSCOPE_BASE_URL="https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1"

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
- 编辑时输入自动保存在本机草稿，点击“保存”或“贴上去”才提交服务器；未完成上传或保存时禁止关闭面板。

### 分类拖动排序

- 分类管理中拖动卡片左上角手柄，可在收入、支出各自分组内调整顺序；松开后自动保存，记账分类选择器沿用相同顺序。支持触屏，键盘可用空格键开始/确认、方向键移动、Escape 取消。
- 保存期间暂时禁用排序和编辑；失败恢复原顺序，列表发生变化时重新加载。
- `sort_order` 为可空整数，旧分类在首次排序前保留创建时间倒序；已排序后新增分类放在该组末尾。首次读取会尝试增量添加该列；无 DDL 权限的部署请先执行 `scripts/categories-sort.sql`。


对话记账与语音

- 入口：侧栏「对话记账」或手机底栏「对话」，路径 `/dashboard/assistant`。
- 文字或账单截图会生成最多20笔可编辑草稿，分类和家庭成员必填；金额、日期、收支类型和备注可修改。输入框可直接粘贴 JPG、PNG 或 WebP 图片，先显示预览，点击发送后才识别。发出的图片显示在聊天气泡内，可点击查看，并随本机对话草稿恢复。未入账草稿可直接删除单笔或整组，保存结果待核对时保持原批次锁定。支付方式保存在备注中，不代表支付账户余额。
- 未指定成员时，助手按组询问支出人或收入所属人，显示所有成员按钮；点击一次即可自动回复并补全本组所有待选成员的草稿，确认前仍可逐笔修改。初次补充时保留明确指定的成员，后续新账不会沿用上一次选择。可发送“把这组全改成某成员”修改最近一组尚未入账草稿的人员，也可指定某一笔；只说“修改支出人”且目标明确时会展示人员按钮，选中后自动回复并原位更新；选择前保持原人员，可取消，待选择请求随对话草稿恢复。卡片原位更新，金额和日期保持不变，仍需用户确认入账。已保存或保存结果待核对的草稿不能通过聊天修改。历史聊天只用于理解上下文，不重新记账。转账、借贷和不明确的退款先澄清。
- 语音最多60秒，通过浏览器 MediaRecorder 录制并转为16kHz单声道WAV；千问 ASR 返回文字后，用户可修改再发送。浏览器需要 HTTPS（localhost 可用）和麦克风权限；不支持录音时可选音频文件。
- 截图在浏览器缩小到最长边1920px，仅发送本次选择的图片；语音不会存到附件服务。必要的分类、成员或查询结果会发送给百炼。
- 对话、未发送文字和待发送图片保存在当前用户的本机草稿中；进入页面自动恢复，退出登录会清理。清空对话随时可用，会移除聊天、未提交草稿和待发送内容，停止识别、录音与转写；已发出的入账请求保留独立的原批次核对入口，结果返回不会恢复旧聊天。保存结果未确认时锁定原批次，重试不会重复记账。
- `POST /api/assistant` 识别意图和账单，查询时由参数化 SQL 计算真实汇总后生成回答；模型不能执行SQL或写数据库。
- `POST /api/assistant/transcribe` 语音转文字；`POST /api/assistant/confirm` 原子批量确认，按用户和批次ID幂等，拒绝不同内容复用批次。
- `assistant_batches` 表在首次确认时按需创建；只读/无DDL部署请先执行 `scripts/init-db.sql` 中该表的建表语句。
- 使用普通百炼 API Key。Coding Plan 等有专门用途的订阅不能直接当作本产品的通用 API 配额。

### AI 调用与编排

- `lib/bailian.ts` 使用 AI SDK 的 `generateText`、`Output.object` 和 `streamText`，经 `@ai-sdk/openai-compatible` 直接调用百炼。继续使用现有 `DASHSCOPE_*` 与 `BAILIAN_*_MODEL` 配置，无需 AI Gateway 凭证。
- `lib/assistant-output.ts` 用 Zod 定义唯一的输出结构，派生提供给模型的 JSON Schema；SDK 负责解析和结构校验，`validatePlan` 继续校验当前账号的分类、成员、金额、日期和修改目标。
- 对话保留 `record/query/update/chat` 四种动作。查询仍由固定参数化 SQL 读取真实数据，再交给总结模型；选人、删除和确认入账不调用模型。草稿与确认接口的行为不变。
- 图片与语音使用 SDK 的多模态消息。百炼兼容钩子只处理音频 data URL、专用参数以及流结束检查；统计页对外仍返回原有纯文本流，客户端无需迁移消息协议。
- 模型请求超时90秒，支持调用取消。明确设置 `maxRetries: 0`；错误由统一映射返回，结构化输出错误为422，截断或中断不会当作完整结果。
- 服务端仅记录模型、调用类型、耗时和 token 用量；不记录提示词、图片、录音、模型答案或 API Key。
