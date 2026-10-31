# RepoTrace ✦

个人 GitHub 项目的 Star 观测站，基于 Cloudflare Workers + D1 + KV，无需自己的服务器。

## 支持的功能

- 首次访问设置管理员密码，登录后才能访问项目与统计。
- 监控多个 GitHub 仓库，支持添加、暂停、恢复和移除。
- 每天定时保存 Star 快照，与上次每日快照比对新增和取消的用户；默认北京时间 23:00，可在网页设置中调整。
- 累计 Stars、新增/取消数字、趋势图、用户变化名单与快照历史。
- 手动采集、分页续跑、失败重试；只有完整快照才参与比对，手动采集不影响每日对比基准。
- 首份快照建立初始基线，后续快照开始显示变化。

**添加项目时填写该项目的 GitHub Token，每个项目可使用不同 Token；后续可在网页中更新。**

## 部署到 Cloudflare

### 1. Fork 仓库

打开 [shihuili1218/repotrace](https://github.com/shihuili1218/repotrace)，点击 **Fork**，将仓库复制到自己的 GitHub 账号。

### 2. 在 Cloudflare 连接仓库

进入 **Workers & Pages → 创建应用 → 导入现有 Git 仓库 / 连接 GitHub**，选择自己 Fork 的 `repotrace`。授权范围需包含该仓库。

| 设置         | 填写内容                         |
| ------------ | -------------------------------- |
| 仓库         | 你的 GitHub 账号下的 `repotrace` |
| 生产分支     | `main`                           |
| 根目录       | `/`（仓库根目录）                |
| 构建命令     | `npm run build`                  |
| 部署命令     | `npx wrangler deploy`            |
| 构建环境变量 | `NODE_VERSION=24`                |

选择 **Workers** 部署。Cloudflare 会自动创建并绑定 D1 数据库 `DB` 和 KV 命名空间 `TOKEN_KEYS`，配置定时任务；表结构在首次运行时自动初始化。

### 3. 获取并配置 GitHub Token

1. 打开 [GitHub Fine-grained token 创建页面](https://github.com/settings/personal-access-tokens/new)。
2. 填写名称（例如 `RepoTrace`）并设置有效期。
3. **Resource owner** 选择要监控仓库所属的账号或组织。
4. **Repository access → Only select repositories**，勾选要监控的仓库。
5. 仓库权限保留 **Metadata → Read-only**，无需写权限；点击 **Generate token** 并复制，完整值只显示一次。
6. 打开 RepoTrace，设置管理员密码并登录，点击 **添加项目**，填写仓库地址和这个项目的 **GitHub Token**。应用验证仓库及 Star 读取权限后开始监控。

不同项目可以填写不同 Token。Token 到期或需要调整权限时，点击项目卡片的 **更新项目 Token**。Token 在 D1 中加密保存，加密密钥由应用自动保存在 KV，不需要配置 GitHub Token Secret，旧值不会回显。

升级前已添加的项目，请在项目卡片中补填各自的 Token，历史数据会保留。

### 保护首次初始化（可选）

首次成功设置密码的人会成为管理员。若需要保护初始化入口，请在第一次公开访问前，在 Worker 中添加随机机密 `SETUP_TOKEN` 并部署。初始化页面会要求输入这份口令，验证通过才能设置管理员密码。

### 后续更新

同步 Fork 的上游更新后，Cloudflare 可自动重新构建。后续部署须保持同一 `DB` 和 `TOKEN_KEYS` 绑定，以保留密码、历史和已保存的项目 Token。首次部署后可从 Cloudflare 控制台取得数据库和 KV 的 ID，分别固定到 Fork 中 `wrangler.jsonc` 的 `database_id` 与 KV `id`。

## 命令行部署

需要 Node.js **24 LTS** 和 npm。将 `YOUR_GITHUB_USERNAME` 替换为自己的 GitHub 用户名：

```bash
git clone https://github.com/YOUR_GITHUB_USERNAME/repotrace.git
cd repotrace
npm ci
npx wrangler login
npm run deploy
```

部署后在网页中为每个项目填写 Token。若需要保护首次初始化，在首次访问前执行：

```bash
npx wrangler secret put SETUP_TOKEN
```

本地开发、测试及代码扩展说明见 [contributor.md](contributor.md)。
