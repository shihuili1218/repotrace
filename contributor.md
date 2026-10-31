# 贡献指南

开发环境需要 Node.js **24 LTS** 和 npm。

## 本地开发与验证

```bash
npm ci
npm run build
npm run dev:api
```

Wrangler 使用本地 D1 模拟数据库（`.wrangler/state`，已忽略）。直接使用终端打印的本地地址可查看生产构建。开发前端时，另开终端：

```bash
npm run dev
```

Vite 自动把 `/api` 代理到 8787。本地采集也必须配置 `GITHUB_TOKEN`，在仓库根目录新建已忽略的 `.dev.vars`：

```dotenv
GITHUB_TOKEN="填入你的只读 Token"
# SETUP_TOKEN="可选的首次初始化口令"
```

测试命令：

```bash
npm run check        # TypeScript + 生产构建 + Workers/D1 集成测试 + 部署打包检查
npx playwright install chromium
npm run test:e2e     # 浏览器完整流程 + 图表展示；使用独立临时数据库
```

已有 Chromium 的环境可使用 `CHROMIUM_PATH=/usr/bin/chromium npm run test:e2e`。浏览器图表测试使用明确的展示 fixture；采集、比对、API 和权限测试在本地 Workers / D1 中运行，不依赖外部 GitHub 的可用性。

本地也可手动模拟一次定时触发（`npm run dev:api` 包含 `--test-scheduled`）：

```bash
curl 'http://127.0.0.1:8787/__scheduled?cron=*+*+*+*+*'
```

仅在已到设定时间、尚无当日每日快照且项目已在该时间之前被加入时才会创建每日任务；不会伪造历史快照。手动采集可随时从网页发起，两次启动至少间隔一分钟。

## 代码结构与扩展

```text
src/                       React 网页、响应式样式、SVG 图表
shared/types.ts            前后端接口约定
worker/index.ts            路由、鉴权、定时入口、安全响应头
worker/auth.ts             密码、会话、限速
worker/db.ts               版本化、幂等 D1 迁移
worker/github.ts           GitHub 数据源与分页/限流适配
worker/monitors/stars.ts   Star 任务、租约、检查点、快照发布与集合差异
worker/dashboard.ts        历史、统计和分页查询
tests/                     Workers + D1 集成测试
e2e/                       Chromium 浏览器验证
```

后续指标可在 `worker/monitors/` 新增独立采集模块，通过 `worker/db.ts` 追加迁移，再注册到定时入口和 `/api/settings` 的能力列表。GitHub 数据源由 `StarProvider` 接口注入测试；新增指标不必改写密码、会话与 Star 差异算法。没有为未实现的功能建立假接口或假统计数据。
