# AI记账

让每一笔，都心里有数。

一个以 **AI 对话为主要入口**的个人 / 家庭账本。用文字、语音或账单截图整理收支，在对话中查账、修改记录，处理送礼和借还；核对方案并确认后，才会写入账本。

![AI记账登录页](cover.png)

## 用 AI 记账

- **说一句，记多笔**：用自然语言描述收支，AI 整理金额、日期、分类和成员；在卡片中补齐或修改，再批量确认入账。
- **截图变账单**：一次选择或粘贴最多 5 张账单截图，支持预览和排序；识别后生成可编辑草稿，疑似重复项供你核对。
- **语音输入**：实时语音转文字，也支持上传录音；核对文字后发送，沿用相同的记账流程。
- **直接问账本**：按日期、分类和成员查询真实记录与汇总，支持月度、年度 AI 统计总结。
- **在对话里管理**：修改已有记录、调整待确认方案，或撤销已入账批次；涉及账本写入时先展示影响，再确认执行。
- **处理人情与借还**：送礼、收礼、借出、借入及归还统一预览台账与实际资金流水，可关联已有收支；礼品估值与实际付款分别记录。
- **进度可恢复**：查看任务处理过程，离开页面后可恢复进度和结果，支持停止与重试。

例如，可以这样说：

> 今天午饭 28 元，打车 16 元，都是我花的。
>
> 查一下这个月餐饮花了多少。
>
> 借给小王 500 元，记在我名下。

基本流程：**输入或上传 → AI 整理 / 必要时补充信息 → 核对卡片 → 确认入账**。刷新或恢复任务不会自动批准；查询汇总由程序读取数据库，执行结果以实际入账凭据为准。

## 其他账本功能

手动收支、分类与家庭成员管理、统计分析、礼簿、送礼台账、借还及部分归还、Markdown 便利贴、图片 / PDF 附件，以及 PWA 安装与离线提示页。

## 本地启动

需要 **Node.js 22+** 和可用的 PostgreSQL 数据库。以下使用 Bun（数据库初始化脚本依赖 Bun）。

```bash
bun install
```

在项目根目录创建 `.env.local`：

```dotenv
# 必填：数据库与登录签名密钥（可用 openssl rand -base64 32 生成密钥）
DATABASE_URL="postgres://USER:PASSWORD@HOST:PORT/DB?sslmode=require"
JWT_SECRET="replace-with-a-long-random-secret"

# 启用 AI：阿里云百炼普通 API Key，需与接口地域及模型权限匹配
DASHSCOPE_API_KEY="your-api-key"

# 可选：覆盖默认模型
# BAILIAN_ASSISTANT_MODEL="qwen3.8-max"
# BAILIAN_SUMMARY_MODEL="qwen3.8-max"
# BAILIAN_ASR_MODEL="qwen3-asr-flash"
# BAILIAN_REALTIME_ASR_MODEL="qwen3-asr-flash-realtime"

# 可选：使用其他百炼地域或业务空间时配置对应的兼容接口地址
# DASHSCOPE_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"
# DASHSCOPE_WORKSPACE_ID="your-workspace-id"

# 可选：启用附件上传（Vercel Blob）
# BLOB_READ_WRITE_TOKEN="your-token"
```

```bash
bun run db:init
bun run dev
```

打开 [localhost:3000](http://localhost:3000)，注册或登录后进入 AI 记账。未配置百炼时仍可使用手动账本功能。

## 技术与部署

**Next.js 16 · React 19 · TypeScript · Tailwind CSS · Radix UI · PostgreSQL / Neon · AI SDK 7 · 阿里云百炼 · Vercel Blob**

- 本地检查：`bun run test`、`bun run lint`、`bunx tsc --noEmit`；生产构建与启动：`bun run build`、`bun run start`。
- 部署时配置相同环境变量并初始化数据库；Vercel 的 AI 函数地域由 `vercel.json` 配置为 `sin1`。
- 后台任务依赖平台支持 Next.js `after` / `waitUntil` 及足够的函数执行时间；自建生产环境还需设置 `ASSISTANT_TASK_ORIGIN` 为本应用的 HTTPS 根地址。
- 实时语音需要麦克风权限与 WebSocket 支持。自建 Node 服务需由反向代理转发 WebSocket，并配置 `SPEECH_ALLOWED_ORIGINS` 为网页来源；Vercel 部署需开启 Fluid Compute。

## 开发文档

- [Agent 工作流、授权与验证](docs/assistant-agent.md)
- [钱款事项联动](docs/assistant-ledger-events.md)
- [对话回复与卡片呈现](docs/assistant-reply-presentation.md)
- [数据库初始化](scripts/init-db.sql)
