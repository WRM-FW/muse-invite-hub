# Muse 邀请码互助站 (Muse Invite Code Hub)

> **非官方声明**：本站是独立社区互助项目，与 Muse 官方无隶属关系，也未获得官方授权。邀请码由社区成员公开分享，请自行判断有效性。

- **公网地址**：<https://musecode.pages.dev/>
- **GitHub 仓库**：<https://github.com/WRM-FW/muse-invite-hub>
- **Cloudflare Pages 项目**：`musecode`
- **Supabase 项目**：`MuseCodeHelp`（ref `fqgbdgsinlmdznnxnmml`，区域 Seoul）
- **联系开发者**：3391792088@qq.com

---

## 一、当前实现的功能

- 邀请码 FIFO 队列：早入池的排在最上面，队首卡展示当前顺位可用码。
- 复制邀请码、切换到下一个可用码。
- 发布邀请码：邀请码、剩余次数（1–30）。
- 状态与名额：
  - 「我已使用 (-1)」按访客去重，剩余次数减一。
  - 次数归零自动变为「已失效」。
  - 「失效反馈」累计 3 个不同访客后自动失效。
  - 状态弹窗仍保留；发布者可用本浏览器保存的管理密钥切换可用/已使用/已失效。
- 可用 / 已失效 / 已使用 / 全部 筛选，以及按邀请码搜索。
- 中文（默认）与英文切换，语言选择保存在浏览器。
- 深色模式：`prefers-color-scheme: dark` 自动跟随系统，无需手动切换。
- 加载、空数据、网络失败、后端未配置、重复记录、非法输入、限流等状态提示。
- 桌面端与移动端适配；邮箱联系入口固定为 `3391792088@qq.com`。
- 安全响应头：CSP、HSTS、X-Frame-Options、X-Content-Type-Options、Referrer-Policy、Permissions-Policy。

与原前端相比，交互结构、视觉风格、FIFO/30 名额/状态弹窗/中英切换均保留。必要的改动只有：

- 移除「重置演示数据」按钮（它会把共享数据库清空或恢复假数据），换成同位置的「刷新」。
- 移除卡片上的 DEMO 假数据标记；自己发布的记录显示「我发布的」。
- 发布表单保持「邀请码 + 剩余次数 + 立即分享」，不再提交或展示使用说明/有效期；「填入示例」按钮已移除。
- 增加跟随系统的深色模式；数据库保留 `description` / `expires_at` 字段以兼容历史数据，但当前界面不再输入或展示它们。
- 状态弹窗改为发布者管理；普通访客仍可用「我已使用」和「失效反馈」参与状态维护。

---

## 二、技术栈与构建

- 原生 ES Modules + Vite 5 构建（`@supabase/supabase-js` 需打包，故不再使用零依赖复制脚本）。
- 纯静态站点，**不需要 Pages Functions 或服务端运行时**。
- Supabase Postgres + PostgREST RPC；浏览器只持有 publishable key。
- 构建产物在 `dist/`，附带 `_headers`、`_redirects`、`favicon.svg`。

---

## 三、数据库模型与迁移

迁移文件：

- `supabase/migrations/20261024120000_init_invite_codes.sql`：扩展、类型、表、索引、触发器、RLS、列级授权。
- `supabase/migrations/20261024120100_invite_code_functions.sql`：全部 RPC、限流校验和函数授权。
- `supabase/migrations/20261024130000_status_quota_consistency.sql`：发布者强制切换状态时保持 `remaining_spots` / `claimed_count` 一致。

### `public.invite_codes`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | `gen_random_uuid()` |
| `code` | text | 4–64 位，服务端统一大写；大小写不敏感唯一索引 |
| `description` | text | 可空字符串，最多 280 字 |
| `status` | enum | `available` / `used` / `expired` |
| `total_spots` | integer | 默认 30，范围 1–30 |
| `remaining_spots` | integer | 0–total_spots |
| `claimed_count` | integer | 发布时初始化为 `30 - remaining` |
| `fail_reports` | integer | 失效反馈数，3 次自动失效 |
| `created_at` / `updated_at` | timestamptz | 自动维护 |
| `expires_at` | timestamptz | 可空；读取时若已过则视为 `expired` |
| `manage_token_hash` | text | 发布者管理密钥的 SHA-256；**不对客户端开放** |
| `creator_token_hash` | text | 发布限流用的访客令牌哈希；**不对客户端开放** |

> `description` 与 `expires_at` 保留在数据库以兼容历史数据；当前发布界面不收集这两项，队首卡和列表卡也不展示它们。`expires_at` 仍会参与有效状态计算。

### `public.invite_code_reports`

只存 `code_id`、`reporter_hash`、`action`（`used` / `invalid`）、`created_at`，用于去重和限流。匿名客户端无任何读写权限。

### 应用迁移

已用 Supabase CLI（Management API）应用到 `MuseCodeHelp`：

```bash
supabase link --project-ref fqgbdgsinlmdznnxnmml
supabase db query --linked --file supabase/migrations/20261024120000_init_invite_codes.sql
supabase db query --linked --file supabase/migrations/20261024120100_invite_code_functions.sql
```

也可以在 Supabase Dashboard 的 SQL Editor 中按顺序执行两个文件。迁移不是“破坏性重建”脚本；如果项目里已存在同名表，请先核对结构再执行。

---

## 四、权限模型与 RLS 边界

### 表级

- 两张表都启用了 RLS。
- `invite_codes` 只有一条 `SELECT` 策略：`anon` / `authenticated` 可读公开字段。
- `invite_codes` **没有** INSERT / UPDATE / DELETE 策略，也没有对应表级授权。
- 列级授权排除了 `manage_token_hash`、`creator_token_hash`；直接 `select=manage_token_hash` 会返回 401。
- `invite_code_reports` 没有策略，且撤销了 anon/authenticated 的全部授权。

### 写入入口（全部是 `SECURITY DEFINER` + 固定 `search_path`）

| RPC | 允许角色 | 作用 |
| --- | --- | --- |
| `list_invite_codes(status, query, limit)` | anon | 服务端筛选/搜索，返回有效状态 |
| `invite_stats()` | anon | 全表状态计数 |
| `publish_invite_code(...)` | anon | 校验、去重、限流、发布；返回一次性管理密钥 |
| `claim_invite_code_use(id, token)` | anon | 名额 -1；同一访客同一码只能一次 |
| `report_invite_code_invalid(id, token)` | anon | 失效反馈 +1；3 个不同访客后失效 |
| `set_invite_code_status(id, manage_token, status)` | anon + 管理密钥 | 发布者切换状态；无有效密钥返回 `not_authorized` |

### 限流与输入处理

- 发布：每个访客令牌 24 小时最多 3 条；全站 10 分钟最多 30 条。
- 领取/反馈：每个访客令牌每小时最多 60 次；`(code_id, reporter_hash, action)` 唯一去重。
- 服务端统一去控制字符、折叠空白、大写邀请码、限制 280 字说明、4–64 位邀请码、有效期不超过 90 天。
- 搜索使用转义后的 `ILIKE` + `pg_trgm` GIN 索引，参数长度上限 64。
- 前端所有动态文本经 HTML 转义后输出；CSP 禁止内联脚本和外部脚本。

### 诚实的限制（不是“完美防护”）

- 邀请码本身是公开的，无法阻止别人抢先使用；这是互助站的固有取舍。
- 访客令牌存在 localStorage，清空后可以绕过“按令牌”的发布/领取限流；全站突发上限仍然有效。
- 没有 CAPTCHA / Turnstile / WAF。如果出现恶意刷量，建议在 Cloudflare 侧加 Turnstile 或 WAF 规则。
- 3 个不同令牌可以联合把有效码标记为失效；发布者可用管理密钥恢复。没有管理员后台。
- 管理密钥只保存在发布时的浏览器；清空站点数据或换浏览器会失去管理能力。
- 列表一次最多加载 500 条，搜索/筛选在前端对已加载数据执行；数据量更大时应改为服务端分页搜索（RPC 已支持 `p_query`）。
- 过期状态是读取时计算，没有定时任务回写 `status`。
- 没有删除功能（避免任意访客删除他人记录）；需要清理时由项目所有者在数据库执行 SQL。
- 本站不提供账号系统，也没有“发布者实名/审核”。

---

## 五、环境变量

只需要两个公开变量：

```bash
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable key 或 legacy anon key>
```

代码也兼容 `VITE_SUPABASE_PUBLISHABLE_KEY`。`VITE_SUPABASE_URL` 即使误填成 `.../rest/v1/` 也会被自动规范化。

- `.env.example` 只有变量名和占位值。
- `.env.local` 已被 `.gitignore` 忽略；真实 key 只放在本地。
- **严禁**把 `service_role` / `sb_secret_...` 放进任何 `VITE_` 变量或前端代码。
- 当前生产包是本地构建后直接上传的，publishable key 会按设计出现在公开 JS 中。若改为 Cloudflare Git 集成构建，需要在 Pages 项目设置里配置上述两个环境变量。
- GitHub 仓库不包含 `.env.local`；推送代码不会自动触发部署，当前仍使用 Wrangler 直接上传。

---

## 六、本地开发与构建

```bash
npm install
npm run dev        # Vite 开发服务器，默认 http://localhost:5173
npm run build      # 生产构建 -> dist/
npm run preview    # 预览 dist/，默认 4173
```

依赖检查说明：`npm audit` 仍报告 Vite 5 所用 esbuild 的 **dev server** 安全公告（不影响静态生产构建）。升级到更高主版本需要单独验证，未在本轮强行升级。

---

## 七、Cloudflare Pages 部署

- 项目名：`musecode`
- 生产分支：`main`
- 构建命令：`npm run build`
- 输出目录：`dist`
- 公网地址：<https://musecode.pages.dev/>

本次使用直接上传（Wrangler OAuth，未创建长期 API Token）：

```bash
npm run build
wrangler pages deploy dist \
  --project-name musecode \
  --branch main \
  --commit-dirty=true \
  --commit-message "Muse invite hub update"
```

`public/_headers` 与 `public/_redirects` 会随构建复制到 `dist/`：

- `_headers`：CSP、HSTS、X-Frame-Options、Permissions-Policy 等。
- `_redirects`：`/favicon.ico` → `/favicon.svg`，其余路径 SPA 回退到 `/index.html`。

不需要 Pages Functions；静态托管即可。

---

## 八、已验证的内容（2026-10-25）

### 数据库 / RLS

通过 Supabase PostgREST + publishable key 以 `anon` 身份验证：

- `publish_invite_code` 200，返回 48 位一次性管理密钥（仅哈希入库）。
- `list_invite_codes` / `invite_stats` 200。
- `claim_invite_code_use` 200，剩余次数 3 → 2；同一令牌再次领取返回 400 `already_claimed`。
- `report_invite_code_invalid` 200，`fail_reports` 1。
- 错误管理密钥返回 400 `not_authorized`；正确密钥可切换为 `expired`。
- 强制切换为 `expired` 后为 0/30，恢复为 `available` 后为 1/29（`claimed_count` 同步修正）。
- 匿名直接 `POST /rest/v1/invite_codes` → 401。
- 匿名读取 `manage_token_hash` → 401。
- 测试数据已全部清理，当前 `invite_codes` 与 `invite_code_reports` 均为 0 行。

### 生产站点

用无头 Edge 在公网地址完成端到端测试：

- 首屏中文、空状态、筛选计数为 0。
- 发布邀请码 → 队首卡、列表卡、统计、Toast 全部正确。
- 「我已使用」3 → 2、「失效反馈」1/3 正确。
- 邀请码搜索命中，清除按钮正常出现/隐藏。
- 浅色/深色模式均按系统 `prefers-color-scheme` 渲染，移动端无横向溢出。
- 发布者状态弹窗：可用 → 已使用 → 可用，统计同步。
- 中文 ↔ English 切换，标题和文案同步。
- 390px 移动端无横向溢出，导航自动换行。
- 浏览器控制台 0 个应用错误，0 个失败请求。
- 线上响应头已用 `curl -I` 验证：CSP、HSTS、X-Frame-Options、nosniff、Referrer-Policy、Permissions-Policy 均存在。
- `/`、`/favicon.svg`、JS/CSS 资源 200；未知深层路径回退到 `index.html` 200；`/favicon.ico` 302 到 SVG。

未做：真机多浏览器矩阵、并发压测、第三方安全审计、CAPTCHA/WAF 滥用演练。

---

## 九、后续更新步骤

1. 修改 `src/` 下的代码或 `public/` 下的静态配置。
2. 本地 `npm run dev` 验证；至少执行一次 `npm run build`。
3. 部署：
   ```bash
   npm run build
   wrangler pages deploy dist --project-name musecode --branch main --commit-dirty=true
   ```
4. 打开生产地址验证首页、语言切换、发布/领取/反馈和网络请求。
5. 数据库变更：新增 `supabase/migrations/YYYYMMDDHHMMSS_name.sql`，用 `supabase db query --linked --file ...` 应用，再复查 RLS 与授权。
6. 不要提交 `.env.local`、`.wrangler/`、`dist/` 或任何高权限密钥。

仓库已初始化并推送到 <https://github.com/WRM-FW/muse-invite-hub>（默认分支 `main`）。`.gitignore` 排除了 `.env.local`、`dist/`、`node_modules/`、`.wrangler/` 和 `supabase/.temp/`。提交前请用 `git status` 确认没有真实密钥被加入暂存区。
