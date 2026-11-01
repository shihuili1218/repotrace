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

`e2e/connection.spec.ts` 模拟启动时断线、响应正文超时、重新连接及异常响应，并验证登录请求不会自动重复提交。只读 API 请求每次 10 秒超时，连接失败最多重试两次；写入请求最多等待 120 秒，不自动重试。登录状态必须包含完整布尔字段，异常响应不会进入首次初始化。

本地接收真实 GitHub 投递需要可公开访问的 HTTPS 地址。也可对原始 JSON 的 UTF-8 字节计算 HMAC-SHA256，设置 `X-Hub-Signature-256: sha256=<hex>`、`X-GitHub-Event` 和唯一 `X-GitHub-Delivery`，POST 到 `/hooks/github/<project-id>`。不要把管理员会话或签名密钥写进仓库。

## 代码结构与扩展

```text
src/                       React 网页、响应式样式、SVG 图表
src/ProjectData.tsx        单项目选择、Release 区间和版本目录同步
src/Monitoring.tsx         Star / Fork / Issue / PR / Release 与统一动态
src/ReleaseAssets.tsx      当前产物下载量与按需刷新
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
worker/monitoring.ts       单项目指标的统计、筛选及分页
worker/range.ts            版本边界校验、半开区间与图表分组
worker/release-assets.ts   产物验证与原子快照替换
worker/public-releases.ts  GitHub Release 缓存、完整产物清单与下载量汇总
worker/release-cache.ts    缓存状态、D1 刷新租约与后台任务
tests/                     Workers + D1 集成测试
e2e/                       Chromium 浏览器验证
```

## 事件与统计口径

Webhook 接收入口独立于管理员会话。原始正文限制为 1 MiB，先验证 HMAC-SHA256 再解析 JSON。首份有效事件确认仓库名称及 GitHub ID，此后按稳定 ID 识别，允许重命名。每项目 Delivery ID 在 D1 事务中去重，投递标记、事件和对象状态一起提交，失败可重投。签名密钥只在生成或更换时返回，D1 仅存 AES-GCM 密文。

按接收时间记录动态和每日变化，使用北京时间半开区间 `[当日 00:00, 次日 00:00)`。Star 按项目、稳定用户 ID 和日期比较第一与最后的动作，相反则抵消；总量取当天最后已收到的上报，安静日期沿用上一次值。缺失总量保留为未知，不会伪造为 0。无需定时器，不再写入新快照；升级前的快照与汇总只读保留。

Fork 按仓库 ID 去重，计数采用首次收到时间；GitHub 没有完整的 Fork 删除事件。Issue 与 PR 按 GitHub 对象 ID 保存，更新状态时比较上游 `updated_at` 和投递顺序，防止较旧报文覆盖新状态。首条回复排除作者自身和机器人，耗时基于上游创建与回复时间。PR 由 `merged` / `merged_at` 判断合并，普通关闭不计入合并数，PR 下的普通评论归属 PR。新代码到达会清除旧评审显示。

Release Webhook 只写入 `project_events`，记录发版、编辑、撤回和删除动态；不写版本目录、产物、下载量或仓库 Star / Fork 总量。旧版本缓存继续保留，新的公开元数据由访问驱动的后台任务更新。图表版本节点来自目录缓存中的发布时间。

暂停期间仍验证并确认投递，但不记录业务事件或更新总量；已确认投递不会在恢复后因重投而补入。事件列表、状态和指标只覆盖已收到的事件，不补齐历史积压。公开 Release 目录和产物下载量是独立的数据来源，按需匿名读取 GitHub 官方接口，不请求 Star 用户名单。事件时间、接收时间和上游更新时间各自用于对应口径，不假定所有 GitHub 事件都带完整发生时间。

## 数据迁移与新增指标

迁移版本 1–3 用于兼容旧拉取和夜间汇总版本；版本 4 增加新模块并清除旧定时设置；版本 5 添加产物快照和公开版本目录同步状态，保留管理员、签名密钥及原有事件。新安装直接创建当前模型，避免建立再删除旧采集表。`wrangler.jsonc` 显式配置空 Cron 列表，以清除之前部署的计划。

新增指标时在 `shared/monitors.ts` 注册事件，为 `worker/events.ts` 添加独立处理逻辑，并在 `worker/db.ts` 追加迁移。复用签名验证、仓库身份和事务去重；不要为未支持的事件建立假统计。

## 项目范围、Release 区间与下载量

总览默认汇总所有项目，可按项目筛选；版本信息与发布标记只出现在单项目数据。`scope=project` 的 Dashboard 和 `/api/monitoring` 需要项目 ID。Release 区间使用该项目两个已发布版本的 `published_at`，验证身份、先后顺序和非未来时间，并将同一 `[since,until)` 应用于事件计数、图表、Star 净变化与列表。长区间自动按多天分组，最多约 90 个图表点；对监控启用前的时间显示覆盖不足提示。Issue / PR 仅筛出区间内有事件的条目，显示其当前已记录状态，不将其当成历史状态快照。

打开项目数据、版本列表或产物面板时先返回 Worker 的 D1 缓存，再通过 `ctx.waitUntil` 异步刷新。浏览器只请求本站接口，不直接访问 GitHub，也不定时轮询。首次无缓存会返回空值及后台刷新提示，后续访问读取已完成的缓存。失败保留旧快照和更新时间，不将未知数据写成 0。

`release_refresh` 按项目与资源保存刷新状态、上次错误、重试时间及租约。D1 的原子租约合并并发请求，租约 35 秒、后台外部请求总预算 25 秒；失败后只在后续访问且重试时间已到时尝试。GitHub 的 403 / 429 按响应头区分限流，尊重恢复时间并共享主机级退避；不会提示用户配置访问凭据。仓库身份校验短暂复用 5 分钟，以减少额外调用；重定向仍使用 Workers 支持的 `manual`，不访问上游提供的任意地址。

目录每页 30 条，产物按页读取完整后原子替换。所有数据固定访问 GitHub 官方 HTTPS JSON 接口，限制响应大小且不读取文件二进制。总量由 Worker 完整分页汇总 GitHub 的 `download_count`（BigInt 精确累加），最新正式版使用 GitHub latest 接口的产物计数。未读完整清单时不写入部分总量。后台刷新失败时记录错误、保留上次成功的 GitHub 缓存，并在页面以错误提示标明，绝不切换数据源。公开下载量汇总缓存同时保存逐版本的精确计数与发布时间。产物对比只绘制已知计数，占比图要求全量计数可用；未知数据不绘制为 0。图表用 BigInt 比较、累加与计算比例，不从累计值推算历史增量。

`src/DownloadCharts.tsx` 提供可点击查看名称和数字的横向对比图及带图例的产物占比图。产物图表在移动端自动纵向排列。Release 列表由服务端按发布时间倒序限制为 5 条，`total` 保留当前筛选条件下的缓存总数；默认展开最新已发布且未删除版本的产物，手动选择或关闭后保留用户选择。

迁移版本 6 增加刷新状态、主机退避和下载量显示字段，保留管理员、签名密钥、事件和已有缓存。浏览器测试仅在 Playwright 创建的临时 D1 中植入公开缓存夹具，Release 签名事件不能替代公开数据读取。

迁移版本 7 清理已停用第三方源写入的下载量缓存及其显示字段，保留项目、版本元数据和 GitHub 来源的缓存。

总览使用独立的 `recentEvents`，展示所选项目与时间范围内最新 5 条全类型事件，不受项目动态页的事件分类或分页影响；项目动态页仍保留完整筛选和分页。
