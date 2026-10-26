# Muse 邀请码互助站 (Muse Invite Code Hub)

> **非官方声明**：本站是独立社区互助项目，与 Muse 官方无隶属关系，也未获得官方授权。邀请码由社区成员公开分享，请自行判断有效性。

- **公网地址**：<https://musecode.pages.dev/>
- **GitHub 仓库**：<https://github.com/WRM-FW/muse-invite-hub>
- **Cloudflare Pages 项目**：`musecode`
- **Supabase 项目**：`MuseCodeHelp`（ref `fqgbdgsinlmdznnxnmml`，区域 Seoul）
- **联系开发者**：3391792088@qq.com

---

## 一、当前实现的功能

- 每人（浏览器令牌）限分享 1 个码、最多使用 2 个码；界面显示限额提示，服务端强制校验。
- 邀请码队列按全局 `queue_rank` 排序：新码追加到队尾，队首卡展示当前顺位可用码；持有管理密钥的人可调整指定码的顺位。
- 复制邀请码、切换到下一个可用码。
- 发布邀请码：邀请码、剩余次数（1–30）。
- 状态与名额：
  - 「我已使用 (-1)」按访客去重，剩余次数减一。
  - 次数归零自动变为「已失效」。
  - 「反馈给开发者」把状态、原因和可选说明写入开发者收件箱；**不会自动改变邀请码状态**，由开发者用通用密钥处理。
  - 状态弹窗仍保留；通用管理密钥可管理所有邀请码，并可调整任意码的可用次数与队列顺位；发布者发布时仍会自动保存该码的专用密钥。
  - 状态弹窗支持导入 / 清除通用密钥；切换域名或清空浏览器数据后，重新导入一个密钥即可恢复管理。
- 可用 / 已失效 / 已使用 / 全部 筛选，以及按邀请码搜索。
- 中文（默认）与英文切换，语言选择保存在浏览器。
- 深色模式：`prefers-color-scheme: dark` 自动跟随系统，无需手动切换。
- 加载、空数据、网络失败、后端未配置、重复记录、非法输入、限流等状态提示。
- 桌面端与移动端适配；邮箱联系入口固定为 `3391792088@qq.com`。
- 安全响应头：CSP、HSTS、X-Frame-Options、X-Content-Type-Options、Referrer-Policy、Permissions-Policy。

与原前端相比，交互结构、视觉风格、队列顺位/30 名额/状态弹窗/中英切换均保留。必要的改动只有：

- 移除「重置演示数据」按钮（它会把共享数据库清空或恢复假数据），换成同位置的「刷新」。
- 移除卡片上的 DEMO 假数据标记；自己发布的记录显示「我发布的」。
- 发布表单保持「邀请码 + 剩余次数 + 立即分享」，不再提交或展示使用说明/有效期；「填入示例」按钮已移除。
- 增加跟随系统的深色模式；数据库中的 `description` / `expires_at` 已通过 `20261025090000` 迁移删除。
- 状态弹窗改为密钥管理；普通访客可用「我已使用」和「反馈给开发者」参与状态维护。没有密钥时显示导入通用密钥的提示，而不是显示点了会报错的按钮。

---

## 二、技术栈与构建

- 原生 ES Modules + Vite 5 构建（`@supabase/supabase-js` 需打包，故不再使用零依赖复制脚本）。
- 纯静态站点，**不需要 Pages Functions 或服务端运行时**。
- Supabase Postgres + PostgREST RPC；浏览器只持有 publishable key。
- 构建产物在 `dist/`，附带 `_headers`、`_redirects`、`favicon.ico`（Muse 图标，16–256 px 多尺寸）。

---

## 三、数据库模型与迁移

迁移文件：

- `supabase/migrations/20261024120000_init_invite_codes.sql`：扩展、类型、表、索引、触发器、RLS、列级授权。
- `supabase/migrations/20261024120100_invite_code_functions.sql`：全部 RPC、限流校验和函数授权。
- `supabase/migrations/20261024130000_status_quota_consistency.sql`：发布者强制切换状态时保持 `remaining_spots` / `claimed_count` 一致。
- `supabase/migrations/20261025090000_drop_description_expiry.sql`：删除 `description` / `expires_at` 两列，并重建不带这两个字段的 RPC。
- `supabase/migrations/20261025120000_usage_limits_and_ledger.sql`：每人 1 次分享、最多 2 个码；领取记录在删码后保留。
- `supabase/migrations/20261025140000_universal_admin_key.sql`：新增单行 `app_settings` 通用管理密钥表，并让状态函数接受通用密钥或专用密钥。
- `supabase/migrations/20261025160000_feedback_inbox.sql`：新增开发者反馈收件箱、提交 RPC 和通用密钥读取 RPC。
- `supabase/migrations/20261025180000_security_advisor_cleanup.sql`：删除测试表、旧失效反馈函数和反馈读取 RPC；收紧函数执行权限。
- `supabase/migrations/20261025200000_queue_rank_admin_edit.sql`：新增全局 `queue_rank`，并增加管理密钥调整次数/顺位的 RPC。

### `public.invite_codes`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | `gen_random_uuid()` |
| `code` | text | 4–64 位，服务端统一大写；大小写不敏感唯一索引 |
| `status` | enum | `available` / `used` / `expired` |
| `total_spots` | integer | 默认 30，范围 1–30 |
| `remaining_spots` | integer | 0–total_spots |
| `claimed_count` | integer | 发布时初始化为 `30 - remaining` |
| `fail_reports` | integer | 历史字段；旧版 3 次失效反馈自动失效，当前前端不再写入 |
| `queue_rank` | integer | 全局顺位 1..N；新码追加到队尾；管理密钥可重排 |
| `created_at` / `updated_at` | timestamptz | 自动维护 |
| `manage_token_hash` | text | 发布者管理密钥的 SHA-256；**不对客户端开放** |
| `creator_token_hash` | text | 发布限流用的访客令牌哈希；**不对客户端开放** |

> `description` 与 `expires_at` 已在 `20261025090000_drop_description_expiry.sql` 中删除。历史迁移文件仍保留它们，便于按顺序回放；最新数据库结构和 RPC 不再包含这两个字段。

### `public.invite_code_reports`

只存 `code_id`、`reporter_hash`、`action`（`used` / `invalid`）、`created_at`，用于去重、限流和“每人最多 2 个码”的计数。匿名客户端无任何读写权限。`code_id` 可为空：邀请码被删除后记录保留（`ON DELETE SET NULL`），因此删码不会重置领取上限。

### `public.app_settings`

单行表，保存通用管理密钥：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | boolean PK | 固定为 `true`，保证只有一行 |
| `admin_token_hash` | text | 通用管理密钥的 SHA-256；**不对客户端开放** |
| `updated_at` | timestamptz | 自动维护 |

RLS 已启用且没有策略，`anon` / `authenticated` 的全部权限已撤销；只有 `SECURITY DEFINER` 状态函数能读取。通用密钥是一个高权限凭据，可管理所有邀请码，包括其他用户发布的码。

### `public.invite_code_feedback`

开发者反馈收件箱：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | bigint PK | identity |
| `code_id` | uuid, nullable | 邀请码删除后自动置空 |
| `code` | text | 提交时的邀请码快照 |
| `reason` | text | `invalid` / `used` / `wrong_info` / `other` |
| `note` | text | 可选补充说明，最多 300 字 |
| `reporter_hash` | text | 访客令牌哈希；不对客户端开放 |
| `created_at` | timestamptz | 提交时间 |
| `resolved` | boolean | 开发者可在 Dashboard 标记已处理 |

RLS 已启用且没有策略，客户端无任何直接读写权限；提交走 `submit_invite_feedback`。反馈**不会自动改变邀请码状态**。开发者查看方式：

- Supabase Dashboard → Table Editor → `invite_code_feedback`；`resolved` 可直接改。
- 没有邮件或推送通知；也没有公开的反馈读取 RPC，需开发者主动查看 Dashboard。

### 应用迁移

已用 Supabase CLI（Management API）应用到 `MuseCodeHelp`：

```bash
supabase link --project-ref fqgbdgsinlmdznnxnmml
for f in supabase/migrations/*.sql; do
  supabase db query --linked --file "$f"
done
```

也可以在 Supabase Dashboard 的 SQL Editor 中按顺序执行两个文件。迁移不是“破坏性重建”脚本；如果项目里已存在同名表，请先核对结构再执行。

---

## 四、权限模型与 RLS 边界

### 表级

- 所有公开相关表都启用了 RLS。
- `invite_codes` 只有一条 `SELECT` 策略：`anon` / `authenticated` 可读公开字段。
- `invite_codes` **没有** INSERT / UPDATE / DELETE 策略，也没有对应表级授权。
- 列级授权排除了 `manage_token_hash`、`creator_token_hash`；直接 `select=manage_token_hash` 会返回 401。
- `invite_code_reports`、`app_settings`、`invite_code_feedback` 都没有策略，且撤销了 anon/authenticated 的全部授权；只能通过 `SECURITY DEFINER` 函数访问。

### 写入入口（全部是 `SECURITY DEFINER` + 固定 `search_path`）

| RPC | 允许角色 | 作用 |
| --- | --- | --- |
| `list_invite_codes(status, query, limit)` | anon | 服务端筛选/搜索，返回有效状态 |
| `invite_stats()` | anon | 全表状态计数 |
| `publish_invite_code(...)` | anon | 校验、去重、限流、发布；返回一次性管理密钥 |
| `claim_invite_code_use(id, token)` | anon | 名额 -1；同一访客同一码只能一次 |
| `submit_invite_feedback(code_id, reason, note, token)` | anon | 写入开发者收件箱；不改状态；每访客每天最多 10 条 |
| `set_invite_code_status(id, manage_token, status)` | anon + 管理密钥 | 通用密钥可管理所有码；专用密钥仅管理该码；无效密钥返回 `not_authorized` |
| `update_invite_code_admin(id, manage_token, remaining, position)` | anon + 管理密钥 | 调整 0–30 次与全局顺位；0 次自动失效，失效码 >0 自动恢复；重排所有码 |

### 限流与输入处理

- 发布：每个访客令牌最多 1 条当前邀请码（删除后释放名额）；全站 10 分钟最多 30 条。
- 领取：每个访客令牌最多 2 次成功领取；领取动作每小时最多 60 次；`(code_id, reporter_hash, action)` 唯一去重。
- 反馈收件箱：每访客每天最多 10 条；同一访客对同一码的同一原因只接收一次；说明最多 300 字。
- 领取记录在邀请码删除后仍保留（`code_id` 自动置 NULL），因此删码不会重置“最多 2 个码”的计数。
- 服务端统一去控制字符、大写邀请码、限制 4–64 位，剩余次数限制 1–30。
- 搜索使用转义后的 `ILIKE` + `pg_trgm` GIN 索引，参数长度上限 64。
- 前端所有动态文本经 HTML 转义后输出；CSP 禁止内联脚本和外部脚本。

### Security Advisor 审计（2026-10-25）

实际查询确认并处理：

- `public._qoder_probe`：早期测试遗留表，RLS 关闭，`anon` / `authenticated` 拥有 ALL；仅 1 行整数测试数据，无敏感信息。已 **DROP**。
- `report_invite_code_invalid`：旧版 3 次自动下架函数，前端已不使用；已 **DROP**，避免匿名访客通过它篡改状态。
- `list_invite_feedback`：用通用密钥读取全部反馈的 RPC；属于不必要的公开执行面，已 **DROP**。反馈改在 Dashboard 查看。
- `set_updated_at`：触发器函数原先对 `PUBLIC` 可执行；已从 `public/anon/authenticated` 撤销 EXECUTE，触发器仍正常。
- 4 张表全部启用 RLS；`anon/authenticated` 没有表级授权；`invite_codes` 只有列级 SELECT（不含两个哈希列）。
- 剩余 5 个 `SECURITY DEFINER` RPC 是产品必需的匿名入口：`publish_invite_code`、`claim_invite_code_use`、`set_invite_code_status`、`submit_invite_feedback`、`update_invite_code_admin`。
  - 均固定 `search_path = public, extensions, pg_temp`。
  - 均未授予 `PUBLIC`；只授予 `anon/authenticated`。
  - 分别有输入校验、1 次分享、2 次领取、每天 10 条反馈、管理密钥校验等限制。
  - `update_invite_code_admin` 额外要求专用/通用管理密钥，校验 0–30 次和顺位，使用 advisory lock 串行化队列重排；不会删除领取记录。
  - **Security Advisor 仍会把“anon 可执行 SECURITY DEFINER”列为警告**；这是匿名 RPC 架构的固有提示。若要求零警告，需要把写操作迁到登录用户或 Cloudflare Functions + service role。
- 审计核对：不存在名为 `claim_invite_code` 的独立函数，实际是 `claim_invite_code_use`。
- 残余风险：匿名限流基于 visitor token，清空 localStorage 可绕过；通用密钥泄露可管理所有码；仍无 CAPTCHA/WAF。

### 诚实的限制（不是“完美防护”）

- 邀请码本身是公开的，无法阻止别人抢先使用；这是互助站的固有取舍。
- 访客令牌存在 localStorage，清空后可以绕过“按令牌”的发布/领取限流；全站突发上限仍然有效。
- 没有 CAPTCHA / Turnstile / WAF。如果出现恶意刷量，建议在 Cloudflare 侧加 Turnstile 或 WAF 规则。
- 旧版“3 次失效反馈自动下架”函数已在 `20261025180000` 中删除；新反馈不会自动改变状态，由持有管理密钥的人处理。
- 反馈只写入 Supabase 收件箱，没有邮件或推送通知，也没有公开读取 RPC；开发者需在 Dashboard 主动查看。
- 反馈的每日 10 条限制同样基于 visitor token，清空 localStorage 可绕过。
- 通用管理密钥可管理所有邀请码，是高权限凭据；数据库只保存 SHA-256，客户端无法读取 `app_settings`。泄露后应立即轮换，丢失后可由项目所有者重新生成。
- “1 次分享 / 2 个码”限制基于浏览器 visitor token，没有账号体系；清空 localStorage 可绕过。若要强身份限制，需要登录或 Turnstile/WAF。
- 通用密钥保存在当前浏览器的 localStorage；切换域名、清空站点数据或换浏览器后需要重新导入。专用密钥同样按“浏览器 + 域名”保存；密钥本身不会上传到服务器。
- 通用密钥可管理其他用户发布的码；只应保存在项目所有者的设备上，不要写进仓库、前端代码或聊天。
- 列表一次最多加载 500 条，搜索/筛选在前端对已加载数据执行；数据量更大时应改为服务端分页搜索（RPC 已支持 `p_query`）。
- 状态由领取、反馈和管理函数维护，没有定时任务；旧的 `expires_at` 列已删除。
- 前端没有删除功能（避免任意访客删除他人记录）；需要清理时由项目所有者在数据库执行 SQL。
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
- `_redirects`：其余路径 SPA 回退到 `/index.html`；`/favicon.ico` 直接由 Pages 静态资源返回。

不需要 Pages Functions；静态托管即可。

---

## 八、已验证的内容（2026-10-25）

### 数据库 / RLS

通过 Supabase PostgREST + publishable key 以 `anon` 身份验证：

- `publish_invite_code` 200，返回 48 位一次性管理密钥（仅哈希入库）。
- `list_invite_codes` / `invite_stats` 200。
- `claim_invite_code_use` 200，剩余次数 3 → 2；同一令牌再次领取返回 400 `already_claimed`。
- `submit_invite_feedback` 200；重复原因 400 `feedback_duplicate`；3 个不同访客提交“已失效”后邀请码仍是 `available`（不再自动下架）；说明超过 300 字 400；非法原因 400。
- Security Advisor 清理后复测：`_qoder_probe` 不存在；`report_invite_code_invalid` / `list_invite_feedback` 不存在；4 张表 RLS=true；`anon/authenticated` 无表级授权；`set_updated_at` 的 anon/public 执行权限为 false；剩余 5 个 definer RPC 仅 anon/authenticated 可执行，`public_grant=false`，`search_path` 固定。
- 清理后重新调用 `publish_invite_code` / `set_invite_code_status` / `submit_invite_feedback` 均 200，`updated_at` 触发器正常；测试事务已回滚。
- 错误管理密钥返回 400 `not_authorized`；正确密钥可切换为 `expired`。
- 强制切换为 `expired` 后为 0/30，恢复为 `available` 后为 1/29（`claimed_count` 同步修正）。
- 匿名直接 `POST /rest/v1/invite_codes` → 401。
- 匿名读取 `manage_token_hash` → 401。
- 执行 `20261025090000` 后，`invite_codes` 列清单不再包含 `description` / `expires_at`；匿名查询这两列返回 400。
- `list_invite_codes` 返回字段、`publish_invite_code(p_code, p_remaining, p_client_token)` 与前端调用一致，发布/领取/反馈/状态管理全部 200。
- 2026-10-25 池重置：删除 24 个可用码（含执行期间新发布的 1 条），恢复 15 个失效码；恢复的 15 条已重置为 **30/30**，IK1D9I 第一顺位。随后按所有者要求删除 `DDRJDM`、`GMSXW5` 和测试码 `QAADMIN-MVNBR0OX`；删除后为 14 条。站点开放后社区持续新增（后续验证时已 35 条），具体数量以线上为准。
- 领取/反馈报告保留；其中包含已删除码留下的孤儿领取记录（用于维持 2 次领取上限）；删除邀请码不会退回用户的领取次数。
- 管理密钥已简化为 **1 个通用密钥**，明文只写入本地文件 `C:\Users\28322\Desktop\muse-manage-keys.txt`，不在仓库或聊天中；状态弹窗导入一次即可管理所有邀请码，并可调整任意码的可用次数与顺位。旧文件里的 3 个专用密钥已被这个文件覆盖，专用哈希仍保留但不再需要。

### 生产站点

用无头 Edge 在公网地址完成端到端测试：

- 首屏中文、筛选计数正确（验证时数据库已有社区发布的邀请码）。
- 发布表单仅包含邀请码与剩余次数；发布后队首卡、列表卡、统计、Toast 全部正确。
- 「我已使用」剩余次数减一；「反馈给开发者」表单可提交原因和说明，提交后 Toast 提示成功，邀请码状态保持不变。
- 邀请码搜索命中，清除按钮正常出现/隐藏。
- 浅色/深色模式均按系统 `prefers-color-scheme` 渲染，移动端无横向溢出。
- 发布者状态弹窗：可用 → 已使用 → 可用，统计同步。
- 通用管理密钥：在测试码上 API 调用 200；错误密钥 400；匿名读取 `app_settings` 401。UI 导入一次后，两个不同邀请码都能直接切换状态；清除后恢复导入框。
- 通用密钥导入：无密钥时显示导入框；导入后出现状态按钮；清除后恢复导入框；重新导入并切换状态成功。
- 反馈收件箱 UI：队首和卡片都有反馈入口；弹窗包含原因、说明、提示；提交成功关闭弹窗；重复提交显示错误；旧「失效反馈」按钮已移除。
- 中文 ↔ English 切换，标题和文案同步。
- 390px 移动端无横向溢出，导航自动换行。
- 浏览器控制台 0 个应用错误，0 个失败请求。
- 线上响应头已用 `curl -I` 验证：CSP、HSTS、X-Frame-Options、nosniff、Referrer-Policy、Permissions-Policy 均存在。
- `/`、`/favicon.ico`、JS/CSS 资源 200；`favicon.ico` 返回 `image/x-icon`；浏览器标签页图标和页头品牌图标均使用该 ICO（页头 `img` 自然宽度 256）。旧 `favicon.svg` 已删除，旧的 `/favicon.ico → favicon.svg` 302 已移除。
- 队列顺位：初始化为 1..N；管理密钥调整后目标码准确落到指定顺位，其他码依次顺延；新发布码追加到队尾。测试后已重新编号为 1..74，IK1D9I 为 #1。
- 管理密钥编辑：可用次数 2→7、顺位保持不变保存成功；卡片显示「剩余 7/30 次」「顺位 #75」；首位仍为 IK1D9I；测试码已删除并重新编号。

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
