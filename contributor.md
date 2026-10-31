# 贡献指南

开发环境需要 Node.js **24 LTS** 和 npm。

## 本地开发与验证

```bash
npm ci
npm run build
npm run dev:api
```

Wrangler 使用本地 D1 和 KV（`.wrangler/state`，已忽略）。直接访问终端中的地址可查看生产构建。开发前端时另开终端运行 `npm run dev`；Vite 将 `/api` 与 `/hooks` 代理到 8787。

如需测试初始化保护，可在已忽略的 `.dev.vars` 配置 `SETUP_TOKEN`。

```bash
npm run check
npx playwright install chromium
npm run test:e2e
```

已有 Chromium 可用 `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`。后端测试在 Workers / D1 中验证鉴权、原始报文 HMAC、去重、每日净变化和旧数据迁移；浏览器测试使用本地签名事件走通连接流程，不依赖外部 GitHub。图表展示测试使用明确的 fixture。

本地测试真实 GitHub 投递需要可公开访问的 HTTPS 地址；不要将管理员会话或签名密钥写入仓库。也可用脚本对原始 JSON 的 UTF-8 字节计算 HMAC-SHA256，设置 `X-Hub-Signature-256: sha256=<hex>`、`X-GitHub-Event` 和唯一 `X-GitHub-Delivery`，POST 到 `/hooks/github/<project-id>`。

手动触发本地定时器：

```bash
curl 'http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*'
```

## 代码结构与扩展

```text
src/                       React 网页、响应式样式、SVG 图表
shared/types.ts            前后端接口约定
worker/index.ts            管理 API、鉴权、定时入口、安全响应头
worker/auth.ts             密码、会话、限速
worker/db.ts               原子、版本化 D1 迁移
worker/projects.ts         仓库名称解析
worker/webhooks.ts         签名校验、仓库身份绑定、投递去重和事件接收
worker/webhook-secrets.ts  签名密钥加密；主密钥单独保存在 WEBHOOK_KEYS KV
worker/summaries.ts        北京时间截止点、用户净变化、定时汇总
worker/dashboard.ts        事件、历史、图表及分页查询
tests/                     Workers + D1 集成测试
e2e/                       Chromium 浏览器验证
```

Webhook 接收入口独立于管理员会话，只接受 HMAC-SHA256 验证通过的原始报文。首份签名事件确认仓库名称及 GitHub ID，此后按稳定 ID 识别仓库，允许重命名。正文限制为 1 MiB，不保存原始报文或请求头；每项目的 Delivery ID 在 D1 事务中去重。签名密钥只在生成或更换时返回，D1 仅存 AES-GCM 密文，认证失败不记录事件。

事件按接收时间进入半开区间 `[上次截止点, 本次截止点)`；首次从连接时间起算。同一用户以第一和最后的动作确定净变化，前后相反时抵消。总量取截止点之前最近一次有效投递的 `repository.stargazers_count`，没有事件则沿用上次上报值，不推测遗漏数据。每分钟执行汇总，补齐停机期间已经保存的事件，单次最多处理 6 个汇总窗口，按最久未更新的项目轮转，后续分钟继续；重复触发幂等，并重算最近窗口以覆盖边界时刻提交的请求。暂停期间忽略 Star 变化与总量，但仍校验并确认投递。

新指标可新增独立事件处理模块及对应表，通过 `worker/db.ts` 追加迁移，在设置接口注册能力。已有管理员鉴权、签名校验和投递去重可复用，避免新增指标依赖 Star 的净变化算法。迁移版本 1/2 仅用于升级历史兼容，版本 3 清理旧拉取表并将已完成的统计迁入汇总表。
