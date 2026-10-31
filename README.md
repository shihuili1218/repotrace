# RepoTrace ✦

**每一份关注，都有迹可循。** 一个给个人项目用的私有 GitHub 观测站。

第一版专注 Star：每天保存关注者快照，按 GitHub 用户 ID 比对新增与取消，展示趋势、数字与用户名单。网页、API、定时任务和数据库全部在 Cloudflare，不需要自己的服务器。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/shihuili1218/repotrace)

## 第一版能做什么

- 首次访问设置管理员密码；所有项目、统计、名单和设置 API 均需登录。
- 最多监控 20 个 GitHub 仓库；添加后立即建立基线。支持暂停、恢复、移除。
- 默认每天 **北京时间 23:00（Asia/Shanghai，UTC+8）** 采集，可在设置中调整整点。
- 展示累计 Stars、最近快照新增/取消、7 / 30 / 90 天趋势、近 14 天变化及分页用户名单。
- 手动采集、快照历史、失败重试；大仓库分页、断点续跑、并发互斥。
- 每日快照始终与上一次完整的**每日快照**对比；手动采集不改变每日基准。首日可回退到初始基线。
- 只有完整并通过数量校验的快照才发布。GitHub 失败、限流、权限错误不会把所有用户误报为取消。
- Star 采集模块与 API、展示层分离，为 Fork / Issue / Release 等后续指标保留扩展位置。

## 部署到 Cloudflare：推荐方式

准备一个 Cloudflare 账号和 GitHub 账号，随后：

1. 点击上方 **Deploy to Cloudflare**。授权 Cloudflare 连接 GitHub，按页面提示选择或复制此仓库，应用名可用 `repotrace`。
2. 保留仓库中的 Wrangler 配置。构建使用 `npm ci` 安装依赖，部署命令为 `npx wrangler deploy`（或 `npm run deploy`）。`wrangler.jsonc` 内置的构建命令会先执行 `npm run build`。
3. Cloudflare 自动创建并绑定 D1 数据库 **DB**，同时配置 Cron。第一版不依赖 KV、R2、队列或付费外部数据库；部署后表结构会在首次 API / 定时执行时自动初始化，无需手动执行 SQL。
4. 打开 Cloudflare 返回的 `*.workers.dev` 地址，**立即设置管理员密码**（12–256 个字符，建议密码管理器生成）。首次成功初始化者成为唯一管理员。
5. 登录 →「添加项目」→ 输入 `shihuili1218/repotrace` 或你的其他仓库地址。首次快照完成后即可看到 Stars；第二份有效快照开始显示变化。
6. 在 Cloudflare 的 Worker → **设置 → 变量和机密**中，建议添加 **Secret / 机密** `GITHUB_TOKEN`，保存并部署。然后在网页「设置」检查是否显示“已配置 GitHub Token”。

如果部署按钮无法使用（例如仓库私有或已有同名仓库），在 Cloudflare 控制台 **Workers & Pages → 创建应用 → 连接 Git 仓库**，选择本仓库，构建和部署命令使用上面的值，部署到 **Workers**。这是 Worker + D1 应用，不是纯静态 Pages 站点。

### 可选：保护首次初始化

默认按需求在第一次访问时设置密码。若不希望部署到设置密码之间存在被别人先初始化的窗口，在第一次公开访问前，给 Worker 添加一个随机的 **Secret `SETUP_TOKEN`**。初始化页会要求输入这份口令，验证通过才能创建管理员。口令与 GitHub Token 都不要写入仓库。

### GitHub Token 怎么选

公开仓库可不填 Token，但匿名 GitHub REST API 通常只有 **60 次请求 / 小时**，多人共享的出口也可能共享额度；分页和完整性校验都会消耗请求。强烈建议配置自己的只读 Token。

- GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**。
- 选择需要监控的仓库，`Repository permissions → Metadata: Read-only`。私有仓库需选择正确的资源所有者、仓库，组织可能还需要审批 / SSO 授权。不要授予写权限。
- 标准认证额度通常为 **5,000 次请求 / 小时**，以 GitHub 实际响应为准。
- 在 Cloudflare 中作为 `GITHUB_TOKEN` **机密**保存。前端只能看到是否配置，不能读取 Token。
- Token 过期或权限不够时，采集记录会给出错误；更新机密后对失败快照点击“重试”。限流与暂时性错误会自动续跑。

参考：[GitHub REST 限额](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)、[列出 stargazers 所需权限](https://docs.github.com/en/rest/activity/starring#list-stargazers)。

### 部署后检查这几项

- 在无痕窗口打开站点，应看到登录页；直接访问 `/api/dashboard` 应返回 `401`。
- 添加自己的仓库，等“采集中”变为“监控中”，总 Stars 应与 GitHub 当前数量接近。
- Worker 的 **设置 → 触发事件 / Cron Triggers** 应有 `* * * * *`。每分钟的触发器负责到点建立每日快照和续跑分页；不是每分钟重采全部仓库。
- 在网页中查看“设置”的时间；默认 **23:00 北京时间**。Cron 配置传播可能需要数分钟；不依赖浏览器打开。
- 第二天在“Star 动态 → 采集记录”查看每日快照，检查对比日期和新增 / 取消。

部署操作和真实 Cloudflare Cron 需在你的账号完成；本仓库的测试不会调用你的生产账户。

### 固定数据库与更新

首次部署使用 Wrangler 的**自动资源创建**，故配置中没有固定账户专属 `database_id`。

首次部署成功后，建议在 Cloudflare → D1 中找到数据库 UUID，并将 `wrangler.jsonc` 的绑定固定为：

```jsonc
"d1_databases": [{
  "binding": "DB",
  "database_name": "repotrace-db",
  "database_id": "你的现有数据库 UUID"
}]
```

这个 UUID 不是密码。**后续部署保持同一 DB 绑定，不要删除数据库或替换成新数据库**，管理员、会话和历史数据都存在其中。CLI 部署会将新建资源的 ID 写回本地配置；从控制台部署时请从控制台记录 ID。

连接 Git 后，向生产分支推送代码可触发重新构建。服务器会自动运行新增的版本化迁移；更新前建议使用 D1 备份 / Time Travel 功能。这里没有 CI 自动部署机密，不需要向 GitHub Actions 提供 Cloudflare Token。

## 命令行部署（备选）

需要 Node.js **24 LTS** 和 npm。

```bash
git clone https://github.com/shihuili1218/repotrace.git
cd repotrace
npm ci
npx wrangler login
npm run deploy
```

Wrangler 会构建网页并提示创建 D1。无需先手工创建数据库。然后（可选但推荐）：

```bash
npx wrangler secret put GITHUB_TOKEN
# 若尚未初始化，且需要保护首位管理员设置：
npx wrangler secret put SETUP_TOKEN
```

命令会安全提示输入机密值，不要把值直接拼在命令行中。不要提交 `.dev.vars` 或 Token。

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

Vite 自动把 `/api` 代理到 8787。需要本地 GitHub Token 时，新建已忽略的 `.dev.vars`：

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

## 数据与边界

- **初始快照是基线**，已有用户不会全部算作“新增”。无法回溯部署前谁取消过 Star。
- GitHub 列表是分页采样，不提供整个列表的事务性时间点。RepoTrace 使用稳定用户 ID 去重，检查最终数量，并只发布完整快照；采集中快速变化仍可能影响观测结果。数量校验失败时需重试，不会发布误导性的半份快照。
- 记录的是两次有效快照之间的**净用户集合变化**；有人在期间取消后又重新 Star，可能不会出现在差异中。GitHub 不提供取消的确切时间，页面显示的是观测完成时间。
- 默认每分钟最多处理 **6 页（每页 100 位关注者）**，状态和分页进度保存在 D1。大仓库可能跨多个定时周期；匿名限额不足时会等待恢复。20 个仓库共享本应用的处理预算，采集完成时间并不保证恰好为 23:00。
- 采集暂停、故障或平台停机后，与**上一次有效每日快照**比较，跨度可能超过一天；历史选择器显示对比日期。不会凭空补齐遗漏日期。
- 对已经过期的失败日期点击重试，会保留原失败记录并生成一份**当前手动快照**，不会把今天采到的数据标成以前某晚的历史。
- 总览卡片来自最新完整快照（包括手动快照）；每日趋势来自每日快照与初始基线。未采集日期沿用上次已知总量，**不表示当天实际采集成功**。新增监控项目会使总量变化，不能把累计曲线的所有增加解释为新 Star。
- 所有历史快照默认保留，因此存储随 `关注者数 × 采集天数` 增长。留意 D1 存储与读写、Worker 请求 / CPU、GitHub API 配额；免费额度以 Cloudflare 当前政策为准，大仓库长期使用可能需要升级套餐或增加保留策略。移除项目会永久删除对应全部数据。
- 仅一个管理员。密码使用随机盐 + PBKDF2-SHA256（100,000 次）；会话只存哈希，HttpOnly / SameSite=Strict Cookie，在 HTTPS 下启用 Secure，7 天过期。写请求检查同源，密码尝试限速。
- 修改密码会注销其他会话。如果忘记密码，可在 Cloudflare D1 控制台执行以下 SQL，再使用首次初始化流程重设（历史不受影响）。建议先设置 `SETUP_TOKEN` 保护重置窗口：

```sql
DELETE FROM sessions;
DELETE FROM admin;
```

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

参考：[Cloudflare 部署按钮](https://developers.cloudflare.com/workers/platform/deploy-buttons/)、[Wrangler 自动创建资源](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning)。
