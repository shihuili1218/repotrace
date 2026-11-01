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

已有 Chromium 可用 `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`。后端在 Workers / D1 中测试鉴权、原始报文 HMAC、原子去重、多种事件、乱序状态、实时日历统计和旧数据迁移。浏览器测试通过本地签名事件验证完整流程；图表展示测试使用明确的 fixture，不依赖外部 GitHub。

本地接收真实 GitHub 投递需要可公开访问的 HTTPS 地址。也可对原始 JSON 的 UTF-8 字节计算 HMAC-SHA256，设置 `X-Hub-Signature-256: sha256=<hex>`、`X-GitHub-Event` 和唯一 `X-GitHub-Delivery`，POST 到 `/hooks/github/<project-id>`。不要把管理员会话或签名密钥写进仓库。

## 代码结构与扩展

```text
src/                       React 网页、响应式样式、SVG 图表
src/Monitoring.tsx         Fork / Issue / PR / Release 与统一动态
shared/types.ts            前后端接口约定
shared/monitors.ts         支持的事件与模块名称
worker/index.ts            管理 API、鉴权、安全响应头
worker/auth.ts             密码、会话、限速
worker/db.ts               原子、版本化 D1 迁移及新安装初始化
worker/projects.ts         仓库名称解析
worker/webhooks.ts         签名校验、仓库身份绑定、投递去重
worker/events.ts           事件验证、归一化和各模块状态更新
worker/webhook-secrets.ts  签名密钥加密；主密钥保存在 WEBHOOK_KEYS KV
worker/time.ts             北京时间日期与自然日边界
worker/dashboard.ts        实时 Star 净变化、总量趋势、统一动态
worker/monitoring.ts       Fork / Issue / PR / Release 的统计、筛选及分页
tests/                     Workers + D1 集成测试
e2e/                       Chromium 浏览器验证
```

## 事件与统计口径

Webhook 接收入口独立于管理员会话。原始正文限制为 1 MiB，先验证 HMAC-SHA256 再解析 JSON。首份有效事件确认仓库名称及 GitHub ID，此后按稳定 ID 识别，允许重命名。每项目 Delivery ID 在 D1 事务中去重，投递标记、事件和对象状态一起提交，失败可重投。签名密钥只在生成或更换时返回，D1 仅存 AES-GCM 密文。

按接收时间记录动态和每日变化，使用北京时间半开区间 `[当日 00:00, 次日 00:00)`。Star 按项目、稳定用户 ID 和日期比较第一与最后的动作，相反则抵消；总量取当天最后已收到的上报，安静日期沿用上一次值。缺失总量保留为未知，不会伪造为 0。无需定时器，不再写入新快照；升级前的快照与汇总只读保留。

Fork 按仓库 ID 去重，计数采用首次收到时间；GitHub 没有完整的 Fork 删除事件。Issue 与 PR 按 GitHub 对象 ID 保存，更新状态时比较上游 `updated_at` 和投递顺序，防止较旧报文覆盖新状态。首条回复排除作者自身和机器人，耗时基于上游创建与回复时间。PR 由 `merged` / `merged_at` 判断合并，普通关闭不计入合并数，PR 下的普通评论归属 PR。新代码到达会清除旧评审显示。

Release 保存正式版、预发布、草稿、撤回和删除状态。相同版本只计一次首次收到的发布，编辑已有历史版本不会伪造新发布；删除的版本不会被延迟编辑事件恢复。图表的版本节点使用已记录的上游发布时间，不据此推断发版导致了 Star 增长。

暂停期间仍验证并确认投递，但不记录业务事件或更新总量；已确认投递不会在恢复后因重投而补入。所有列表、状态和指标仅覆盖已收到的数据，不主动访问 GitHub，也不补齐历史积压。事件时间、接收时间和上游更新时间各自用于对应口径，不假定所有 GitHub 事件都带完整发生时间。

## 数据迁移与新增指标

迁移版本 1–3 用于兼容旧拉取和夜间汇总版本；版本 4 增加新模块并清除旧定时设置。新安装直接创建当前模型，避免建立再删除旧采集表。`wrangler.jsonc` 显式配置空 Cron 列表，以清除之前部署的计划。

新增指标时在 `shared/monitors.ts` 注册事件，为 `worker/events.ts` 添加独立处理逻辑，并在 `worker/db.ts` 追加迁移。复用签名验证、仓库身份和事务去重；不要为未支持的事件建立假统计。
