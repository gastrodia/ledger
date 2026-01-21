# Ledger（账本 / 礼簿 / 借还）


一个基于 **Next.js 16 + React 19** 的个人/家庭账本 Web 应用，包含交易记账、分类与成员管理、统计分析（含可选 AI 月度总结）、留言/笔记（Markdown）、礼簿、送礼台账、欠款/借款（支持部分归还）以及附件上传能力，并内置 PWA（离线页 + Service Worker）。

![](cover.png)

技术栈
---

- **框架**：Next.js（App Router）
- **UI**：Tailwind CSS + Radix UI + lucide-react
- **数据库**：PostgreSQL（Neon Serverless 驱动 `@neondatabase/serverless`）
- **鉴权**：JWT（`jose`）+ HttpOnly Cookie（`session`）
- **附件**：Vercel Blob（`@vercel/blob` / `@vercel/blob/client`）
- **AI（可选）**：Groq（`groq-sdk`，流式返回）
- **PWA**：`public/sw.js`、`public/manifest.webmanifest`，生产环境自动注册

功能概览
---

- **交易记录**：收入/支出、日期筛选、分类/成员筛选、金额汇总；支持上传图片/PDF 附件（最大 10MB）
- **分类管理**：收入/支出分类，支持预设模板快速创建（Emoji 图标）
- **成员管理**：家庭成员（用于交易归属统计）
- **统计分析**：按月份聚合统计（分类/成员 Top、收入/支出/结余）；支持隐藏收入金额
- **AI 总结（可选）**：基于当月统计数据生成“可读、可执行”的月度总结（流式输出）
- **留言/笔记**：Markdown 内容，支持置顶/归档/预览
- **礼簿**：按“事件/礼簿”管理礼金/礼品（含估值）汇总
- **送礼**：记录“我送给别人”的现金 + 多行物品组合礼（含估值），支持筛选与附件
- **欠款/借款（借还）**：欠款/借款分组展示；支持部分归还、归还列表、附件与状态（未还/部分/结清）
- **PWA**：生产环境注册 Service Worker，提供离线页

快速开始
---

步骤 1：安装依赖

本仓库带有 `bun.lock`，推荐使用 Bun；也可以用 npm/pnpm 安装依赖（但 `db:init` 脚本默认使用 bun）。

```bash
bun install
```

步骤 2：配置环境变量

在项目根目录创建 `.env.local`（或在部署平台配置同名环境变量）：

```bash
# 必填：Postgres 连接串（Neon / 自建 Postgres 均可）
DATABASE_URL="postgres://USER:PASSWORD@HOST:PORT/DB?sslmode=require"

# 建议配置：用于签发/校验登录态 JWT
# 不配置时会使用默认值（仅适合本地开发，生产务必设置）
JWT_SECRET="replace-me-with-a-long-random-secret"

# 可选：启用统计页“AI总结”（Groq）
GROQ_API_KEY="..."

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
  - `GET /api/stats/ai-summary?month=YYYY-MM`：AI 月度总结（**流式**文本返回，需要 `GROQ_API_KEY`）

- **留言/笔记**
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
- **注意**：本地/非 Vercel 环境通常需要手动配置 `BLOB_READ_WRITE_TOKEN`，否则 `/api/blob/upload` 会返回 500。

AI 总结说明
---

- **接口**：`GET /api/stats/ai-summary?month=YYYY-MM`
- **依赖**：需要设置 `GROQ_API_KEY`
- **返回**：`text/plain; charset=utf-8`，并以 **ReadableStream** 方式逐段返回（前端边读边渲染）

数据库结构（概览）
---

初始化脚本位于 `scripts/init-db.sql`，主要表包括：

- **users**：用户
- **categories**：分类（收入/支出）
- **members**：家庭成员
- **transactions**：交易（可选关联分类/成员；可选附件字段）
- **notes**：留言/笔记（支持置顶/归档）
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

- 在部署平台配置环境变量：`DATABASE_URL`、`JWT_SECRET`，如需附件/AI 则加上 `BLOB_READ_WRITE_TOKEN`、`GROQ_API_KEY`
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
