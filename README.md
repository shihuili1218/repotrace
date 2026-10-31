# RepoTrace ✦

个人 GitHub 项目的 Star 观测站，基于 Cloudflare Workers + D1 + KV，无需自己的服务器。

## 支持的功能

- 首次访问设置管理员密码，登录后才能访问项目与统计。
- 多仓库监控，支持暂停、恢复和移除，兼容公开与私有仓库。
- 通过 GitHub **Star Webhook** 记录新增、取消的用户，签名校验与重复投递去重。
- 每晚自动汇总用户净变化，默认北京时间 **23:00**，可在网页调整。同一用户在汇总期间新增后又取消会相互抵消。
- 最近上报的 Star 总量、事件数字、趋势图、变化名单与每日汇总历史。

需要仓库的 Webhook 管理权限。名单从启用后开始记录，无法补回历史或停用期间的变化；总量来自最近收到的 Webhook，不会主动读取 GitHub。投递失败可在 GitHub 的 **Recent Deliveries → Redeliver** 重试。

## 部署到 Cloudflare

### 1. Fork 仓库

打开 [shihuili1218/repotrace](https://github.com/shihuili1218/repotrace)，点击 **Fork**。

### 2. 在 Cloudflare 连接仓库

进入 **Workers & Pages → 创建应用 → 导入现有 Git 仓库 / 连接 GitHub**，选择自己 Fork 的 `repotrace`，使用 **Workers** 部署。

| 设置         | 填写内容                         |
| ------------ | -------------------------------- |
| 仓库         | 你的 GitHub 账号下的 `repotrace` |
| 生产分支     | `main`                           |
| 根目录       | `/`（仓库根目录）                |
| 构建命令     | `npm run build`                  |
| 部署命令     | `npx wrangler deploy`            |
| 构建环境变量 | `NODE_VERSION=24`                |

Cloudflare 自动创建并绑定 D1 数据库 `DB`、KV 命名空间 `WEBHOOK_KEYS`，并配置定时任务。表结构在首次运行时自动初始化。

### 3. 为项目连接 Webhook

1. 打开部署后的网页，设置管理员密码并登录，点击 **添加项目**，填写 `owner/repo` 或 GitHub 仓库地址。
2. 复制弹窗中的 **Payload URL** 和 **Secret**；每个项目有独立密钥，仅生成时显示一次。
3. 打开被监控仓库的 **Settings → Webhooks → Add webhook**。
4. 填入 **Payload URL**；**Content type** 选 `application/json`；**Secret** 填入刚复制的密钥，保留 **Enable SSL verification**。
5. 选择 **Let me select individual events**，只勾选 **Stars**；勾选 **Active**，保存。
6. GitHub 会发送 Ping，RepoTrace 显示 **已连接** 后即可记录后续变化。若未连接，检查 **Recent Deliveries** 的响应。

后续从项目卡片的 **配置 Webhook** 查看地址；重新生成 Secret 后，须同步更新 GitHub 配置并重新投递 Ping。无需创建 GitHub 访问凭据，也无需为项目配置 Cloudflare Secret。

### 保护首次初始化（可选）

首次成功设置密码的人会成为管理员。若需要保护初始化入口，请在第一次公开访问前，在 Worker 中添加随机机密 `SETUP_TOKEN` 并部署。初始化时必须输入这份口令。

### 后续更新

同步 Fork 的上游更新后，Cloudflare 可自动重新构建。保持同一 `DB` 和 `WEBHOOK_KEYS` 绑定，以保留密码、历史与签名密钥。首次部署后可将控制台中的资源 ID 固定到 Fork 的 `wrangler.jsonc`：D1 的 `database_id`、KV 的 `id`。

旧版本升级会自动保留项目、管理员密码和已完成的历史快照，删除旧项目访问凭据和未完成的拉取任务。升级后请逐个项目点击 **配置 Webhook → 生成签名密钥** 完成连接。

## 命令行部署

需要 Node.js **24 LTS** 和 npm。将 `YOUR_GITHUB_USERNAME` 替换为自己的用户名：

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/repotrace.git
cd repotrace
npm ci
npx wrangler login
npm run deploy
```

部署后按上面的步骤连接 Webhook。若需要保护初始化，在首次访问前执行：

```bash
npx wrangler secret put SETUP_TOKEN
```

本地开发、测试及扩展说明见 [contributor.md](contributor.md)。
