# PatPlayer 功能清单

> 版本：**v3.0.0**（Express + MySQL 从零重构版，当前仓库实际代码）
> 说明：旧版 FEATURES.md 描述的是 v2（Netlify 重构版：Astro + Netlify Functions + Blobs），架构已完全废弃，本文件基于 v3 代码重新核实整理。

## 项目概况

高中 AI 社团**作品收集与展示平台**，品牌名「南中科创局」（株洲市南方中学信息技术拓展社）。学生用 AI 做出作品（项目文件或 QQ 频道 AI 轻应用），在此提交、展示、互相查看，并通过学AI 课程与提交作品赚取 ⭐ 积分。

- 后端：Node.js + Express 4 + `mysql2` + `multer`，单进程监听 `127.0.0.1:3001`
- 前端：原生 HTML/CSS/JS，hash 路由 SPA（`public/`），零构建、零外部依赖
- 存储：MySQL（库 `pat`）+ 本地磁盘 `storage/uploads`
- 外部依赖：`tencent-channel-cli`（QQ 频道 Go 二进制）+ `python3`（`feed_links.py` / `share_resolve.py`）

## 一、认证与账户系统（server/routes/auth.js + auth-qq.js + public/js/auth.js）

| 功能 | 说明 | 位置 |
| --- | --- | --- |
| QQ 频道扫码登录（主） | `init` 拿二维码 → `poll` 轮询授权并反查 tiny_id → `bind` 绑定班级+姓名；已绑定直接登录；身份识别失败（未加入频道）时自动展示频道二维码引导加入（`public/img/qq-channel.jpg`） | auth-qq.js:73/164/244 / auth.js(前端) |
| **访客直传（无 QQ）** | 登录页点「我没有QQ，或直接提交我的程序文件」→ 表单：**年级 → 班级 → 姓名 → 展示名授权 → 安全密码（选填）** → 上传程序文件 → 提交后签发**专属项目地址**（`#/p/<token>`），凭地址查看/下载/继续上传/删除；**不进入系统**（无系统令牌，其余功能全部不可用）。额度：单文件 ≤200MB（`MAX_UPLOAD_MB`），每天最多 5 次（`GUEST_MAX_UPLOADS_PER_DAY`） | auth.js(前端) / routes/auth.js:44 / routes/guest.js / public/js/project.js |
| 访客项目地址 | `GET /api/guest/files?token=`（身份+文件列表+今日额度）、`POST /api/guest/upload`（multipart file+token）、`GET /api/guest/download/:id?token=`、`GET /api/guest/preview/:id?token=`（HTML，CSP sandbox）；令牌为 64 位 hex 长随机串、无过期、同一身份幂等返回同一地址 | routes/guest.js |
| **访客删除（密码保护）** | `DELETE /api/guest/files/:id?token=&password=`：仅删本项目地址下的文件；密码 = 提交时自定义（scrypt 加盐哈希存 `users.guest_pwd_hash`）或未设置时的默认密码（`GUEST_DEFAULT_PASSWORD`）；错误 403、限流（10 次/10 分钟/令牌+IP）防爆破；删除回扣提交积分（与系统内删除一致），不返还当天上传次数 | routes/guest.js / utils/pwd.js / public/js/project.js |
| 上传磁盘自检 | **每次上传前**（登录与访客共用）检测服务器磁盘剩余空间，低于 `MIN_FREE_DISK_GB`（默认 2GB）返回 507「磁盘即将爆满，文件上传失败，请联系频道主扩容处理」，不落盘 | utils/upload.js:63（ensureDiskSpace）/ utils/disk.js |
| Token | 系统：HMAC-SHA256 签名（`TOKEN_SECRET`），base64url，**24h 过期**，Bearer 头携带；访客：`guest_token` 列 | utils/token.js |
| 当前用户 | `GET /api/auth/me`（附单文件上传上限供前端预检） | auth.js:85 |
| 班级数据源 | `GET /api/auth/classes` 年级→班级二级菜单；前端有兜底常量 | auth.js:32 / auth.js(前端) |
| 展示名授权 | `PATCH /api/auth/profile`：是否展示真实姓名；选否需填昵称（QQ 登录默认预填频道昵称） | auth.js:90 |
| 班级白名单 | 高一 2601–2624、高二 2501–2524、高三 2401–2425，另有「其他」：毕业生填自己班级（4 位数字），外校填 0（必填校验） | config.js:15 |
| QQ 会话失效检测 | `GET /api/auth/qq/status` 调 CLI `login status`，失效清理会话；前端全站横幅检测（60s 节流） | auth-qq.js:36 / app.js |

## 二、个人文件管理（server/routes/files.js + public/js/dashboard.js「项目文件」tab）

| 功能 | 说明 | 位置 |
| --- | --- | --- |
| 上传 | multer 单文件/次；前端逐文件上传：拖拽/点击多文件、进度条（浏览器式平滑加载）、失败自动跳过 | files.js:61 |
| **内容审查（全部文本/代码类）** | 上传任意代码/文本格式（html/py/js/ts/c/java/css/json/md/txt/csv/svg 等）都同步调用 DeepSeek 审查（色情/未成年不宜、违法违规、恶意代码注入），**违规/超长拒绝时回扣已发积分**（file_submit_revoke）；AI 不可用降级放行标记 `pending`；压缩包为二进制不审查 | utils/audit.js + files.js |
| **超长限制** | 文本/代码类单文件内容达**百万级字符**直接拒绝上传，提示联系频道主/QQ：3303188265（字节 >4MB 兜底不读文件） | files.js |
| 超 200MB 提示 | 413 及前端预检文案均附「请联系频道主或 QQ：3303188265」 | files.js / api.js / dashboard.js |
| 扩展名白名单 | **代码/文本 15 种 + 压缩包 5 种**：html/htm/py/js/ts/c/cpp/java/css/json/ipynb/md/txt/csv/svg + zip/rar/7z/tar/gz；图片/视频/音频/Office/3D 已关闭 | config.js |
| 上传限制 | 一次最多 **5 个文件**（更多提示打包压缩包）；每人每天最多 **20 次上传**（含删除，`upload_log` 表计数） | dashboard.js / files.js |
| 大小限制 | 单文件默认 **200MB**（`MAX_UPLOAD_MB`）；每用户配额默认 **2GB**（`MAX_USER_STORAGE_MB`，超限回滚落盘） | config.js:84 / files.js:82 |
| 文件列表 | 仅列本人文件（含标题/简介/玩法） | files.js:123 |
| 作品信息 | `PATCH /api/files/:id` 补标题/简介/玩法（标题必填） | files.js:136 |
| 下载 | `GET /api/files/download/:id`：本人 + **同班同学**可下载；落盘缺失返回「文件已丢失」 | files.js:169 |
| 删除 | `DELETE /api/files/:id` 仅本人；删记录 + 落盘文件 | files.js:193 |
| 同名冲突 | `(user_id, original_name)` 唯一约束 → 409 提示先删除或重命名 | schema.sql / files.js:114 |

## 三、AI 轻应用收集（server/routes/apps.js + dashboard.js「AI 轻应用」tab）

| 功能 | 说明 | 位置 |
| --- | --- | --- |
| 自动识别 | `auto-scan`：拉频道近 24 帖 → 筛本人 → 逐帖 `get-feed-detail` 校验作者 → `feed_links.py` 提取轻应用链接（串行，限流 5 次/分） | apps.js:42 |
| 手动识别 | `manual-scan`：粘贴 `B_` 开头帖子 ID，或 `pd.qq.com/s/` 分享链接 → `share_resolve.py` 解析 BID → 校验作者本人 → 提取 | apps.js:90 |
| 提交 | `POST /api/apps`：链接格式校验（http/https、≤512）+ 标题必填 + 简介/玩法/来源帖 | apps.js:135 |
| 列表/删除 | `GET /`（仅本人）、`DELETE /:id` | apps.js:168/181 |
| 前置条件 | 需 QQ 频道登录会话（token 持久化于 `storage/qq-sessions`，30 天闲置回收） | qq/sessions.js |

## 四、全校作品展（server/routes/class.js:77 + public/js/class-wall.js）

- 全校**文件 + 轻应用**项目平铺展示，按时间倒序混排，带班级 tag + 年级归属
- 展示名遵循授权（`show_real_name=0` 用昵称/频道名）；生效中的**专属称号**以小徽章展示
- 每项标注 `is_mine` / `same_class`；文件可下载（本人/同班），应用可跳转
- **点赞**：每日票数不限（🤍→❤️），主动点赞 +2⭐/次；重复点赞 409；置顶作品排最前 + 🔥 徽标
- 实时搜索：按项目标题 / 作者 / 班级过滤（前端 oninput 即时渲染）
- **排序切换**：🕐 最新发表（默认，从新到旧）/ ❤️ 点赞最多；置顶作品始终优先 | class-wall.js

## 五、全校提交总览（server/routes/class.js:140 + public/js/overview.js）

- 统计卡片：总班级数 / 有提交班级数 / 总文件数 / 总应用数 / 总大小
- 每班卡片：学生数、文件数、应用数、总大小、最近提交时间；每名学生行内展示文件数/应用数/总大小/最近提交，可展开明细

## 六、学AI 栏目（server/routes/learn.js + public/js/learn.js + seed-articles.js）

| 功能 | 说明 | 位置 |
| --- | --- | --- |
| 教程内容 | **5 章** AI 教程存 `articles` 表（Markdown 正文 + `tasks` JSON 任务数组） | seed-articles.js |
| 章节列表 | `GET /api/learn` 按章节分组返回摘要（不含正文） | learn.js:46 |
| 文章详情 | `GET /api/learn/:slug`（含任务数组；固定路径如 nfti-ticket 必须先于 `/:slug` 注册） | learn.js:223 |
| Markdown 渲染 | 前端自研轻量渲染器：标题/列表/引用/代码块/表格/媒体行（B站 iframe、本地 mp4），先转义防 XSS | learn.js(前端) |
| 章节任务 | 类型：`quiz`（单选即时判题）、`action`（实操打卡，可带 `nfti:true` 标记跳 NFTI 体验）；B站视频嵌入正文 | seed-articles.js |
| 阅读计时 | 文章页 ≥60s 上报积分；路由切换时取消计时器（防切页刷分） | learn.js(前端) / app.js:25 |
| 学习进度 | `GET /api/learn/progress`（每章是否完成；游客宽松返回空进度） | learn.js:74 |

## 七、积分体系（server/utils/points.js + routes/points.js + public/js/points.js）

「我的积分」页：打开时先刷新被赞数据，再展示毕业奖励（领取后按钮变灰）/赚积分小贴士/排行榜/流水。

### 获取积分

| 行为 | 积分 | 防重键 |
| --- | --- | --- |
| 首次登录（注册即发） | 10 ⭐ | `once` |
| 阅读课程 ≥60s（每篇一次） | 10 ⭐ | `article:<id>` |
| 完成整章所有任务（每章一次） | 20 ⭐ | `article:<id>`（task 维度） |
| 提交 AI 轻应用（每个作品一次） | 25 ⭐ | `app:<id>` |
| 提交作品文件（每个文件一次） | 50 ⭐ | `file:<id>` |
| **主动点赞他人**（网页操作，每次 +2⭐） | 2 ⭐ | `like:<likes.id>`；**每日票数不限**，点赞者每日积分上限 10⭐，禁自赞 |
| **作品被点赞**（站内直接发放） | 2 ⭐/赞 | 点赞时同步给作品作者发放；作者每日上限 30⭐ |
| **课程毕业**（5 章读完全部任务完成，仅一次） | 50 ⭐ | `once` |
| **彩蛋**（连续点击顶栏积分徽章 5 次，仅一次） | 5 ⭐ | `once`（前端 app.js 事件委托连点计数） |

- **幂等发放**：`points_log` 唯一键 `(user_id, reason, ref_id)` + 事务内插流水/更新 `users.points` | utils/points.js:19
- **整章判定**：`POST /api/points/task` 记 `task_progress` → 该章任务全完成才发整章积分；`GET /api/points/task-progress` 回填完成状态 | points.js
- **被赞积分（站内直发）**：`POST /api/points/like` 时，除点赞者本人 +2⭐（`like_give`，每日上限 10）外，同步给作品作者 +2⭐（`like_receive`，每日上限 30）；同一 `likes.id` 作 ref_id、reason 区分，均幂等。**不使用 CLI 查频道点赞**（原 CLI 增量方案及 `feed_like_snapshots` 表已废弃，表保留不删）
- 排行榜：`GET /api/points/leaderboard` top20 降序 + 我的排名（0 分不占榜），展示名/称号遵循授权 | points.js
- 流水：`GET /api/points` 积分+最近 50 条记录（含中文原因文案，消费为负数） | utils/points.js

### 积分商城（已下架，前端无入口；后端接口与定时回收保留，待重新上架）

> ⚠️ 2026-08 已下架：`/api/points/shop`、`/purchase`、`/my-purchases` 接口保留但前端不展示；`jobs.js` 的置顶/精华到期回收继续运行（防存量兑换不回收）。

| 商品 | 价格 | 说明 |
| --- | --- | --- |
| 作品展置顶 24h（wall_top） | 100 ⭐ | 自己的文件/轻应用在全校作品展置顶（站内自动，class.js 排序 + 前端 🔥 徽标） |
| 频道帖子置顶 24h（app_top） | 150 ⭐ | 自己发布的频道帖子置顶（CLI `feed top-feed` 自动执行，需 QQ 登录+管理权限） |
| 频道精华 24h（app_essence） | 100 ⭐ | 自己帖子加精华（CLI `feed set-feed-essence` 自动执行） |
| 专属称号 30 天（title） | 60 ⭐ | 昵称旁展示自定义称号（作品展/总览/排行榜可见） |

- 消费走 `spend()` 事务：余额检查（`FOR UPDATE`）→ 扣分 → 负数流水（reason=purchase）→ 写 `purchases` 记录 | utils/points.js:57
- 频道类兑换：先调 CLI 成功才扣分；24h 到期由 `server/jobs.js` 定时（每 10 分钟）自动取消并标记 expired（`feed_extra` 存 create_time 供取消用）
- 接口：`GET /api/points/shop` / `POST /api/points/purchase` / `GET /api/points/my-purchases`

## 八、跨站体验（NFTI 联动，server/routes/learn.js:106 + config.js nftiDb）

| 功能 | 说明 | 位置 |
| --- | --- | --- |
| 体验 ticket | `GET /api/learn/nfti-ticket`：HMAC 签名一次性 ticket（tiny_id+pat_sid+5min 过期）→ 跳 `https://nfti.weaxi.cn/?pat_ticket=...` 免登录体验 | learn.js:107 |
| 体验判定 | `GET /api/learn/nfti-status`：只读连接 nfti 库查 `test_results`（`assessment_type='nfti'`） | learn.js:132 |
| 第2章任务 | `GET /api/learn/app-status`：近 7 天是否在频道发帖 **+ 是否已在本站投稿轻应用**，两者都满足才算完成 | learn.js:145 |
| 第3章任务 | `GET /api/learn/project-status`：近 14 天是否上传过项目文件 | learn.js:191 |
| 第5章任务 | `POST /api/learn/tinyid-check`：提交的 tiny_id 与登录身份一致性核验 | learn.js:205 |

## 九、活动简介页（public/js/activity.js）

「信息素养体验活动」摘要页（完整规则链金山文档），精简后共 4 张卡片：

- 活动介绍（主办方：南方中学校友频道 × 信拓社 + 完整通知链接）
- 怎么参加（入门体验 / 创意进阶 + 一行流程指引）
- 灵感 & 常见问题（details 折叠：创作方向 + FAQ）
- 时间与奖项；底部一行社团介绍小字

## 九.五、管理后台（server/routes/admin.js + public/js/admin.js，仅 QQ 管理员）

- **权限**：`users.is_admin` 标志 + `ADMIN_QQ_TINY_IDS` 白名单引导（QQ 绑定自动授权）；全部接口 `requireAdmin`（非管理员 403）；`users.status='disabled'` 停用（禁登录/登记/上传）；所有写操作记 `admin_log` 审计
- **总览**：用户/文件/轻应用/积分/存储统计、磁盘剩余、待审核数（`GET /api/admin/stats`）
- **用户**：搜索（姓名/昵称/班级/访客令牌前缀）、身份与状态筛选；调积分（±，防自肥）、设/取消管理员（仅 QQ）、停用/恢复、重置访客删除密码、删除（级联+物理文件）
- **文件**：搜索（文件名/标题/作者/班级/审核状态）、预览/下载、改作品信息与审核状态（flagged→reviewed 自动补发积分）、删除（回扣 +50）
- **审核**：pending/flagged/reviewed 队列，通过（补发回扣积分）/拒绝（+原因，回扣积分）/删除；**批量**勾选通过/删除
- **轻应用**：搜索、删除（回扣 +25——普通用户路径未回扣，管理端补齐）
- **积分**：排行榜 TOP50、流水检索（用户/类型）
- **运营**：置顶/称号/精华记录、手动过期、免费手动置顶（file/app，≤168h）、发放称号、商城开关（`settings.shop_enabled`）
- **运维**：按班级存储占用、大文件 TOP20、磁盘剩余、QQ 会话列表/一键失效
- **教程**：在线编辑 `articles`（**独立全屏编辑页** `#/admin/articles/new|edit/:id`，双栏实时预览 + Ctrl+S 保存；tasks 须 JSON 数组；改教程保留 id 不影响学员进度）；`seed-articles.js` 仅作初始种子
- **设置**：运行时开关 `shop_enabled` / `audit_enabled`（覆盖 DeepSeek 审核，30s 缓存写后即时生效）
- **审计**：管理员操作日志检索（谁/何时/对什么/IP）

## 十、全局框架（public/index.html + app.js / nav.js / api.js / utils.js）

- **hash 路由 SPA**：`#/activity`（活动简介）、`#/files`（我的项目）、`#/class-wall`（全校作品展）、`#/overview`（提交总览，路由保留但导航不展示）、`#/learn` + `#/learn/:slug`（学AI）、`#/points`（我的积分） | app.js:5
- **导航**：桌面左 rail + 移动端底部 app bar + 顶栏；入口顺序：活动简介 → AI 小学堂 → 全校作品展 → 我的项目 → 我的积分；显示班级+展示名+积分徽章；退出登录 | nav.js
- **顶部内测横幅**：全站 sticky 顶部「删档内测中，感谢各位参与」（高度 32px，rail/topbar/QQ 失效横幅均下移避让） | index.html + style.css
- **底部备案号**：全站 footer 挂 `湘ICP备2026024339号-1`（链工信部备案查询；移动端避开底部 appbar） | index.html + style.css
- **401 处理**：仅携带 Bearer 的请求 401 才跳登录（扫码流程的 401 是业务态错误原样抛） | api.js:42
- 请求封装：15s 超时中断、fetch+blob 下载、413 固定中文文案（nginx 拦截返回 HTML 时兜底） | api.js:21
- 工具函数：`escapeHtml / formatSize / formatTime / getFileIcon / confirm / toast / openModal` 等 | utils.js
- 全站 QQ 会话失效横幅（`/api/auth/qq/status`，60s 节流） | app.js

## 十一、部署与配置

| 项 | 值 |
| --- | --- |
| 启动 | `npm start`（`node server/index.js`）监听 `127.0.0.1:3001`；PM2 服务名 `patplayer`（`ecosystem.config.cjs`，fork 单实例） |
| 数据库 | MySQL（库 `pat`，`dateStrings:true` 直返字符串规避时区）；`npm run init-db` 建 11 张表（users/files/apps/articles/points_log/task_progress/likes/purchases/**feed_like_snapshots**/admin_log/settings） |
| 文件存储 | 本地磁盘 `storage/uploads`（UUID 落盘名 + 原始名映射）；QQ 会话 `storage/qq-sessions` |
| 环境变量 | `.env`（模板见 `.env.example`）：`PORT / DB_* / TOKEN_SECRET / MAX_UPLOAD_MB / MAX_USER_STORAGE_MB / MAX_UPLOADS_PER_DAY / GUEST_MAX_UPLOADS_PER_DAY / GUEST_DEFAULT_PASSWORD / MIN_FREE_DISK_GB / ADMIN_QQ_TINY_IDS / STORAGE_DIR / QQ_SESSIONS_DIR / GUILD_ID / PAT_TICKET_SECRET / NFTI_DB_* / DEEPSEEK_API_KEY / DEEPSEEK_MODEL / DEEPSEEK_BASE_URL / DEEPSEEK_AUDIT` |
| 安全 | 生产环境 `TOKEN_SECRET` 缺失/示例值 → 启动 fail-fast（config.assertConfig）；`.env` 已 gitignore |
| nginx | `deploy/pat.weaxi.cn.conf`：反代 3001、`client_max_body_size 200m`、`proxy_cache off`（保 Range 请求不被吞）、www 301 归一化、certbot ACME 段 |
| 域名 | `https://pat.weaxi.cn`（证书 SAN 含 www；`deploy/pat.weaxi.cn.http.conf` 为签证书前的临时 HTTP 段） |
| 教程数据 | `node seed-articles.js`（按 slug 幂等 upsert，不破坏已有任务进度/积分记录） |

## 十二、与 v2（Netlify 版）的关系

- 本仓库 **v3.0.0 从零重构**：Express + MySQL + 原生 SPA；无 Astro/Netlify Functions/Netlify Blobs/Supabase
- v2 遗留问题（下载 token 传参、字段名不一致、中文乱码、大文件上限等）在 v3 中已通过设计规避（统一 Bearer 鉴权、`snake_case` 字段、磁盘直存、multer 流式上传）
- 已知待办/风险与运维细节见 **HANDOVER.md**（工作交接文档）
