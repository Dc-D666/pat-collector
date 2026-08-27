# PatPlayer 工作交接文档

> 给下一个 AI Agent session 的快速上手指南。本文档沉淀了全部开发踩过的坑和关键结论，**新 session 请先读这里**，不要重复逆向。

---

## 1. 项目是什么

高中 AI 社团「作品收集与展示平台」，品牌名**南中科创局**。核心能力：

- QQ 频道扫码登录（主）+ **访客直传**（无 QQ：登录页填年级/班级/姓名 + 上传程序文件 → 给专属项目地址，不进入系统）
- 个人文件上传（多文件/拖拽/进度）
- 全校作品展（按项目平铺 + 班级 tag）+ 全校提交总览
- **AI 轻应用自动/手动识别收集**（从 QQ 频道帖子提取 AI 轻应用链接）
- **学AI 栏目**：5 章 AI 教程（Markdown 存储），每章带任务（B站视频 + 单选题 + 实操）
- **积分体系**：首次登录/阅读课程/完成任务/提交作品赚 ⭐ 积分，含排行榜
- **跨站体验**：第1章实操任务跳转 NFTI（nfti.weaxi.cn）自动登录完成人格测试

域名：`https://pat.weaxi.cn`（已上线）。代码仓库：`git@github.com:Dc-D666/pat-collector.git`。

## 2. 技术栈

- **后端**：Node.js + Express 4 + `mysql2` + `multer`，无构建步骤
- **前端**：原生 HTML/CSS/JS，hash 路由 SPA（`public/`），零外部依赖（含自研 Markdown 渲染器）
- **QQ 集成**：`tencent-channel-cli`（npm 公开包，Go 原生二进制）+ 两个 Python 脚本（`feed_links.py`、`share_resolve.py`）
- **鉴权**：应用内 HMAC-SHA256 token（24h，`utils/token.js`）+ QQ 会话 token（由 CLI 管理）
- **跨站**：HMAC 签名 ticket（与 NFTI 共享密钥）实现 NFTI 自动登录

## 3. 目录结构

```
server/
  index.js            入口（路由挂载/静态托管/SPA 回退，监听 127.0.0.1:3001）
  config.js           班级白名单、扩展名白名单（**代码/文本 15 种 + 压缩包 5 种**，图片视频等已关）、每日上传次数 20 次/人/天、GUILD_ID、路径、dateStrings、NFTI 跨站配置、DeepSeek 审查配置
  db.js               mysql2 连接池（dateStrings:true 直返字符串，规避时区）
  schema.sql          建表（users/files/apps/articles/points_log/task_progress/likes/purchases/feed_like_snapshots）
  init-db.js          建表脚本（npm run init-db，IF NOT EXISTS 幂等，可增量建新表）
  jobs.js             后台定时任务：过期置顶/精华自动回收（10 分钟）
  middleware/auth.js  Bearer token 鉴权（requireAuth）
  routes/auth.js      访客直传登记(guest：签发项目地址令牌，不签发系统令牌)/me/PATCH profile(展示名)/classes
  routes/guest.js     访客项目地址：files(列表+额度)/upload/download/preview（凭 guest_token，仅本项目文件）
  routes/auth-qq.js   QQ 扫码登录(init/poll/bind) + /status 失效检测
  routes/files.js     文件上传（每日20次限制+AI审查+百万字符拦截）/列表/PATCH/下载/删除（回扣积分）/HTML 预览（CSP sandbox）
  routes/class.js     全校作品展(wall)/总览(overview)——含 apps 混排 + display_name
  routes/apps.js      AI 轻应用 auto-scan/manual-scan/submit/list/delete
  routes/learn.js     学AI 栏目：章节列表/文章详情/nfti-ticket/nfti-status/app-status/project-status/tinyid-check
  routes/points.js    积分：查询/阅读上报/任务上报(整章判定)/任务进度/排行榜
  qq/proxy.js         runCli 封装（execFile 调 CLI 二进制）
  qq/sessions.js      QQ 会话管理（每会话 HOME 隔离 + index.json 持久化 + 30天TTL）
  qq/feed-links.js    feed_links.py + share_resolve.py 的 Node 封装
  utils/token.js      HMAC token 签发/校验
  utils/points.js     积分服务（grant 幂等发放 + 流水）
  utils/async.js, rateLimit.js
  utils/audit.js       DeepSeek 内容审查（文本/代码类上传时调用，reviewContent；key 在 .env 的 DEEPSEEK_API_KEY）
  utils/pwd.js        访客删除安全密码（scrypt 加盐哈希 salt:hash + timingSafeEqual）
  utils/adminLog.js   管理后台审计（writeAdminLog 写 admin_log）
  utils/settings.js   运行时设置（settings 表，30s 进程内缓存，PUT 后 invalidate）
  middleware/admin.js requireAdmin（Bearer + is_admin，非管理员 403）
  routes/admin.js     管理后台全部接口（requireAdmin + 审计；教程编辑/批量审核/置顶/称号/会话等）
  utils/upload.js     共享上传管线（multer 配置 + ensureDiskSpace 磁盘自检 + runUploadPipeline：每日次数/配额/入库/积分/审查）——登录与访客共用，勿各自复制逻辑
  utils/disk.js       磁盘剩余空间检测（fs.statfsSync 优先，df -k 兜底；Node<18.15 走 df）
public/
  index.html          SPA 壳
  css/style.css
  js/                 app/api/utils/nav/auth/dashboard/class-wall/overview/learn/points/activity/project/admin（管理后台 11 页签）
  js/project.js       访客项目地址页（#/p/:token，独立页不进入系统）
  img/                logo.png（本地化，onerror 降级"南"字）+ learn-ch1.png/learn-ch3-trae*.png/learn-ch5-skillhub.png
  videos/ch2-create-app.mp4  第2章配套操作视频
feed_links.py         从 BID 提取 AI 轻应用链接（用户提供）
share_resolve.py      短链 pd.qq.com/s/xxx → BID（用户提供）
seed-articles.js      学AI 教程入库脚本（node seed-articles.js，按 slug 幂等 upsert：保留原 id，
                      不破坏学员 task_progress/整章积分记录；仅删除本脚本中已移除的 slug）
ecosystem.config.cjs  PM2 配置（服务名 patplayer，fork 单实例）
.env.example          环境变量模板（含全部配置项说明，密码类一律占位符）
deploy/pat.weaxi.cn.conf       nginx 反代配置（HTTP 301→HTTPS、www 归一化、200m、proxy_cache off）
deploy/pat.weaxi.cn.http.conf  临时 HTTP 段（certbot 签发证书前使用）
```

## 4. 数据库（库 pat / 用户 pat，本机 MySQL 3306）

> ⚠️ **密码不写入本文档**：真实密码在服务器 `.env`（`DB_PASSWORD`）。2026-08 曾把明文密码提交到 GitHub 触发安全告警，已改密；今后文档一律用占位符，密码只放 `.env`（gitignore）。

- **users**：id, class_name, real_name, qq_tiny_id(可空唯一), qq_session_id(可空), show_real_name(展示名授权,默认1), nickname(昵称), **guest_token(访客项目地址令牌,可空唯一,64位hex无过期)**, **guest_pwd_hash(访客删除安全密码 scrypt 哈希,空=默认密码)**, **points(积分)**, created_at；唯一键 `(class_name, real_name)`
- **files**：id, user_id, stored_name(uuid落盘), original_name, size, mime_type, **title/description/gameplay(作品信息)**, **audit_status(pending/reviewed/flagged)**, **audit_reason**, uploaded_at
- **apps**：id, user_id, app_url, title, description, gameplay, source_feed_id, created_at
- **articles**：id, slug(唯一), chapter(章节号), title, summary, content(Markdown), **tasks(JSON 任务数组)**, sort_order, created_at, updated_at
- **points_log**：id, user_id, amount, reason(first_login/read_article/task/app_submit/file_submit), ref_id(防重), created_at；唯一键 `(user_id, reason, ref_id)`
- **task_progress**：id, user_id, article_id, task_index, created_at；唯一键 `(user_id, article_id, task_index)`
- **likes**：id, user_id(点赞人), target_type(file/app), target_id, created_at；唯一键 `(user_id, target_type, target_id)`
- **feed_like_snapshots**：~~已废弃~~（原 CLI 增量被赞统计用，表保留不删，代码不再写入）
- **purchases**：id, user_id, item(wall_top/app_top/app_essence/title), cost, ref_type, ref_id, feed_id(帖子BID), feed_extra(JSON: create_time/author_id，取消置顶用), title(称号), status(active/expired), expires_at, created_at
- **admin_log**：管理后台操作审计（admin_id, action, target_type/id, detail(JSON), ip, created_at）
- **settings**：运行时设置（skey/svalue，商城/审核开关等，`utils/settings.js` 30s 缓存）
- **upload_log**：id, user_id, created_at；每次上传动作插一行，**每人每天最多 20 次（含删除）**，`DATE(created_at)=CURDATE()` 计数

> 线上库有真实数据，改表用 ALTER 不要 DROP；`npm run init-db` 只在全新环境用。

## 5. 认证体系（核心难点，务必理解）

**两种登录**：
1. **QQ 扫码登录**（主）：`init` 拿二维码/链接 → 用户扫 → `poll` 轮询 → `bind` 绑定班级姓名
2. **访客直传**：登录页「我没有QQ…」→ 表单（年级→班级→姓名→展示名授权）→ 上传文件 → 拿项目地址（`#/p/<token>`）。**只发 guest_token（长随机串），不发系统 Bearer 令牌**——访客无法进入系统（其余功能全部不可用），只能看/下/传自己地址下的文件

**班级白名单**（`config.js`）：高一 2601-2624、高二 2501-2524、高三 2401-2425，另有「其他」：毕业生填自己班级（4 位数字），外校填 0（必填，前后端均校验）。

**身份模型**：`(class_name, real_name)` 唯一身份；`qq_tiny_id` 是 QQ 绑定（可空唯一）。

**展示名授权（重点）**：`show_real_name=1` 展示真实姓名；`=0` 展示 `nickname`（QQ 登录时默认预填频道昵称）。前端所有展示处用 `display_name`（后端 publicUser 已算好）；作品墙/总览/排行榜都遵循。修改入口：登录绑定表单 + 我的文件页「👤 展示设置」。

**QQ 会话 token 机制（关键）**：
- `tencent-channel-cli` 的 `login` 走 device-bind，token 写入 `$HOME/.qqcli/.env`（`QQ_AI_CONNECT_TOKEN` + `QQ_AI_CONNECT_DEVICE_ID`）
- **token 隔离**靠「每会话独立 HOME」：`storage/qq-sessions/<sessionId>/`，CLI 带 `HOME=<该目录>` env
- 会话索引 `storage/qq-sessions/index.json`，30 天闲置回收
- `users.qq_session_id` 关联用户；登录 bind 后**不清理会话**（AI 识别 + NFTI 跨站借用都需要它）
- **bind_secret（2026-08-21 安全加固）**：`/init` 生成随机 bind_secret 只返回给发起登录的浏览器（不落库、不随 ticket 外发）；`/poll` 与 `/bind` 必须同时携带它——仅凭泄露的会话 ID（曾出现在 NFTI ticket 中）无法换取 Bearer token。前端存于 localStorage（移动端 OAuth 回调恢复用），页面刷新会丢失需重新扫码

## 6. AI 轻应用识别（核心难点，务必理解）

**链路**：
```
自动识别：get-guild-feeds(--count 24) → 筛 author_id===tiny_id → 每帖 verifyOwnFeed(get-feed-detail 校验作者) → feed_links.py(BID) 提链接
手动识别：BID 直贴 ──┐
          分享链接/文本 → share_resolve.py → BID ─→ verifyOwnFeed 校验作者 → feed_links.py 提链接
```

**两个 Python 脚本**（项目根）：
- `feed_links.py <BID> [channel_id]`：起本地代理捕获 `get-feed-detail` 原始 MCP 响应，提取 `urlContent.url` + `launch_app` 正则。需 CLI 在 PATH + 用户 HOME（token）
- `share_resolve.py <短链>`：curl + 浏览器 UA 拉 Nuxt SSR 页面，从 `__NUXT_DATA__` 提取 `feedId`（BID）

## 7. 学AI 栏目与积分体系（本 session 新增，重点）

### 学AI（`/api/learn` + `public/js/learn.js`）
- 5 章教程存在 `articles` 表，正文 Markdown，**前端自研渲染器**（支持标题/列表/引用/代码块/表格/链接，先转义防 XSS）
- 每章 `tasks` JSON 数组，任务类型：`quiz`(单选，**2026-08-21 起判分完全在服务端**，答案/解析不再下发前端，答错不泄露正确答案且有指数冷却防试错)、`action`(实操，带 `nfti`/`appcheck`/`projectcheck`/`tinyidcheck` 标记，**全部服务端核验**：NFTI 库查记录 / 站内有来源帖投稿或频道近 7 天发帖 / 近 14 天有上传文件或 verified GitHub 项目任一（见 §15.8）/ tiny_id 与登录身份一致)；B站视频/本地 mp4 以媒体行嵌入正文（不是独立任务类型）
- 文章页：阅读计时 ≥60s 上报积分；任务进度条 + 单选判分 + 实操打卡按钮。**服务端校验**：`GET /api/learn/:slug` 记录阅读开始（`utils/readTimer.js`，进程内 Map），`POST /api/points/read` 需已读 ≥60s 才发分；**`POST /api/points/task` 拒绝 quiz 类型**（强制走 `POST /api/points/quiz` 判分接口）；`/api/points/quiz` 防试错：答错按 10s→1min→5min→30min→60min 指数冷却
- **章节完成人数 Tag**：`GET /api/learn` 每章返回 `completed_count`（完成该章全部文章的 `points_log reason='task'` 去重用户数），列表页显示「👥 N 人已完成」
- 改教程内容：编辑 `seed-articles.js` 后 `node seed-articles.js`（**幂等 upsert**，按 slug 保留原 id，不清空学员进度；仅当某 slug 从脚本移除时才删除该文章）

### 积分规则（`utils/points.js` RULES）
| 行为 | 积分 |
| --- | --- |
| 首次登录（注册即发） | 10 |
| 阅读课程 ≥60s（每篇一次） | 10 |
| **完成整章所有任务**（每章一次） | 20 |
| 提交 AI 轻应用（每个作品一次，最多计 3 个） | 15 |
| 提交作品文件（每个文件一次，最多计 5 个） | 30 |
| **主动点赞他人**（网页操作，每次 +2⭐，每日票数不限，点赞者每日上限 10） | 2 |
| **作品被点赞**（站内直接发放，作者每日上限 30） | 2/赞 |
| **课程毕业**（5 章全读完+任务全完成，仅一次） | 50 |
| **彩蛋**（连续点击顶栏积分徽章 5 次，仅一次） | 5 |

- `grant()` 幂等：`points_log` 唯一键 `(user_id, reason, ref_id)` 防重复，事务内插流水+更新 `users.points`
- 任务积分是**整章判定**：`/api/points/task` 记 `task_progress` → 该章全完成才 `grant('task','article:<id>')`
- 排行榜 `/api/points/leaderboard`（top20 降序 + 我的排名 + 称号），前端「🏆 我的积分」页
- 主动点赞：`/api/points/like`，**每日票数不限**，禁自赞（400），重复赞 409；点赞者 `like_give` +2⭐（每日上限 LIKE_GIVE_DAILY=10）
- **删除回扣**：删除文件时 `revoke()` 扣回提交奖励（`file_submit_revoke` 负数流水对冲）；审查拒绝/超长拒绝的文件同样回扣（防止白送 50⭐）；app 删除暂未回扣（如需再补）
- **被赞积分（站内直发，不用 CLI）**：`POST /api/points/like` 时同步双向发分——点赞者本人 `like_give` +2⭐（每日上限 LIKE_GIVE_DAILY=10，票数不限、禁自赞 400、重复赞 409），作品作者 `like_receive` +2⭐（每日上限 LIKE_RECEIVE_DAILY=30）；同一 `likes.id` 作 ref_id、reason 区分，均幂等。~~原 CLI 增量方案~~（`jobs.refreshUserFeedLikes`、`/api/points/refresh-likes` 已删除；`feed_like_snapshots` 表废弃保留不删）
- 彩蛋：前端 `app.js` 事件委托监听 `.points-badge` 连点 5 次（2s 窗口）→ `POST /api/points/easter-egg`（幂等 once）

### 积分商城（前端无入口待重新上架；后端接口保留）
- **2026-08-21 两阶段兑换**（`utils/points.js` spendPending/settlePurchase）：频道类（app_top/app_essence）先原子预扣积分并写 `pending` 记录 → 执行 QQ CLI → 成功 `settlePurchase(true)` 转 active / 失败退款并标 cancelled。杜绝原「先外部操作后扣分」的免费兑换；悬空 pending（进程崩溃遗留）由 jobs 查询频道帖子状态处理：已生效→转 active、未生效→退款、无法判定→保持 pending 人工核对（**不再盲目退款**）
- **有效期**：SHOP 每项直接配置 `durationMs`（不再解析展示文本；修了「24 小时」被算成 24 天）
- **开关**：`settings.shop_enabled='0'` 后端强制关闭 `/api/points/purchase`（不再只藏前端入口）
- 到期回收 `server/jobs.js`：查询已含 `feed_extra`（取消置顶需 create_time）；CLI 取消失败保持 active 下轮重试；删除作品/用户时主动作废关联购买并尽力撤销频道操作（`utils/channelOps.js` cancelChannelPurchase）
| 商品 | 价格 | 说明 |
| --- | --- | --- |
| 作品展置顶 24h（wall_top） | 100 | 站内自动：class.js wall 排序置顶 + 前端 🔥 徽标 |
| 频道帖子置顶 24h（app_top） | 150 | CLI `feed top-feed --action=1`（需 QQ 会话+管理权限） |
| 频道精华 24h（app_essence） | 100 | CLI `feed set-feed-essence --action=1` |
| 专属称号 30 天（title） | 60 | 作品展/总览/排行榜展示 title_tag |

- `spend()` 事务：余额 `FOR UPDATE` → 扣分 → 负数流水 → 写 `purchases`
- 频道类兑换**先执行 CLI 成功才扣分**（失败返回错误不扣）；24h 到期由 `server/jobs.js` 每 10 分钟扫描 `expires_at` 过期项自动取消（top-feed action=2 / set-feed-essence action=2）并标 expired；**无有效会话时无法自动取消，会标记 expired 并提示人工处理**
- CLI 命令参数（已实测 schema）：`top-feed` 需 `--feed-id --user-id --create-time --guild-id --action 1|2`；`set-feed-essence` 需 `--feed-id --action 1|2`

### 跨站体验（第1章实操任务 → NFTI）
- **机制**：PatPlayer 签 HMAC ticket（`GET /api/learn/nfti-ticket`，含 tiny_id+nickname+一次性授权码 sid+5min 过期，**不再携带会话 ID**——2026-08-21 安全修复）→ 前端跳 `https://nfti.weaxi.cn/?pat_ticket=...` → NFTI 校验 ticket 后调 `POST https://pat.weaxi.cn/api/learn/nfti-session-grant` 服务端换发真实会话 ID（一次性消费）→ 建"借用会话"
- **跨仓库同步（已完成）**：NFTI 仓库（/home/nfti/NF-BTI）`backend/server.js` 已同步新格式（`verifyPatTicket` 校验 `sid` 授权码 + `exchangePatSession` 换发）并重建容器；docker-compose 已配置 `PAT_BASE_URL`。后续若再改 ticket 格式，必须同步 NFTI 两侧（两边 `PAT_TICKET_SECRET` 也须一致）
- **借用会话**：NFTI 会话的 `cliHome` 指向 docker 只读挂载的 PatPlayer 会话目录 `/patplayer-sessions/<sid>`（复用真实 QQ token，**无需重新扫码，不违反单设备登录**——token 从不改变）
- **完成判定**：`GET /api/learn/nfti-status` 直查 nfti 库 `test_results WHERE tiny_id=? AND assessment_type='nfti'`（PatPlayer 的 DB 账号被授权只读 nfti 库）；有记录 → 前端自动标记任务完成
- 未 QQ 登录（无 tiny_id）：前端提示必须 QQ 登录，ticket 接口拒绝
- **注意**：借用会话拥有与本人扫码登录**完全等价**的权限（含管理员/发帖）——这是设计意图，不是漏洞

### 上传限制与内容审查（2026-08 新增，重要）

- **白名单**：`config.js` 仅允许**代码/文本 15 种**（html/htm/py/js/ts/c/cpp/java/css/json/ipynb/md/txt/csv/svg）+ **压缩包 5 种**（zip/rar/7z/tar/gz）；图片/视频/音频/Office/3D 已全部关闭（历史文件不受影响）
- **上传限制**：一次最多 5 个文件（前端拦截，更多提示打包压缩包）；每人每天最多 **20 次上传**（含删除，`upload_log` 表计数，`config.maxUploadsPerDay`）
- **AI 内容审查**（`utils/audit.js` + DeepSeek，key 在 `.env` 的 `DEEPSEEK_API_KEY`）：
  - 代码/文本类上传时**同步审查**：色情/未成年不宜、违法违规、恶意代码注入
  - 违规/超长 → 拒绝收录 + **回扣已发积分**（revoke）；AI 超时/异常 → 降级放行标记 `pending`
  - **百万级字符超长拦截**：`deepseek.maxFileChars=1000000`，字节 >4MB 兜底不读直接拒（提示联系频道主/QQ：3303188265）
  - 压缩包为二进制不审查（多文件打包途径）
- **HTML 预览**：`GET /api/files/preview/:id`（登录即可，?token= 传参），响应带 `Content-Security-Policy: sandbox allow-scripts`（脚本可跑但 unique origin，读不了 localStorage/API，防存储型 XSS）+ **`Referrer-Policy: no-referrer`**（2026-08-15 加：防预览页把 ?token= 经 Referer 泄露——上传的 HTML 可用 `<meta referrer=unsafe-url>` 覆盖浏览器默认策略）
- **第2章任务双条件**：`/api/learn/app-status` 返回 `posted`（频道发帖）+ `submitted`（本站投稿 apps），两者都满足才算完成

## 8. 关键结论与坑（最重要，避免重复踩坑）

这些是**实际踩过、验证过的**，新 session 不要再怀疑：

### QQ 频道相关
1. **`get-user-info`（全局/频道）都不返回 `tiny_id`**，只返回 nickname/gender/province 等。tiny_id 只能靠 `guild-member-search --guild-id --keyword=<昵称>` → `members[0].tinyid`（小写 `tinyid`）
2. **`manage get-share-info` 只返回频道信息**，**根本不返回 feed_id**。短链转 BID 必须用 `share_resolve.py`
3. **`get-feed-detail` 返回 `data.feed.author_id`（平铺）**、`data.feed.title`、`data.feed.channel_id`、`data.feed.feed_id`。作者校验 `author_id === tiny_id`
4. **`get-guild-feeds` 返回 `data.feeds[]`**，作者字段可能 `author_id`（平铺）或 `author.tiny_id`（嵌套），都要兼容
5. **`login status` 返回 `data.valid`**，用于检测 token 失效（单设备登录被踢后失效）
6. **`get-feed-share-url --feed-id` 返回 `data.share_url`**（BID → 短链）
7. QQ 分享短链 `pd.qq.com/s/xxx` 有反爬（EdgeOne JS 挑战），`curl` 必须带浏览器 UA 才能拿到 SSR 页面
8. **CLI 二进制**：`node_modules/tencent-channel-cli-linux-x64/bin/tencent-channel-cli`；`feed_links.py` 靠 `shutil.which` 找 CLI，Node 封装要注入 `PATH=<bin目录>:...`
9. **`QQ_AI_CONNECT_MCP_URL`** env 可重定向 CLI 的 MCP 网关（`feed_links.py` 靠这个起代理捕获原始响应）
10. **GUILD_ID 默认 `621631744026206738`**（南方中学频道），`.env` 可覆盖。CLI 参数只接受纯数字 ID，**频道号（如 nanfang1958）不是有效 ID**，别传错
11. **QQ token 单设备登录**：别处登录即踢下线。加 `/api/auth/qq/status` + 前端横幅检测
12. **`api.js` 的 401 处理**：只有携带 Bearer 的请求 401 才跳登录，扫码流程的 401 是业务态错误要原样抛
13. **【重坑】频道显示名 ≠ 全局昵称**：频道 `get-user-info` 返回的 `nickname`/`member_name` 是**频道内显示名**（可能带前缀如 `【摸鱼打杂】Cemetary`，也可能与全局昵称完全不同如 `Codex` vs `Cemetary`）。用它搜成员可能**搜 0 个结果** → tiny_id 拿不到 → bind 报"无法识别身份"。**修复**：`resolveTinyId` 必须把频道昵称、member_name、全局昵称、去前缀版本全部作为关键词依次尝试。**这是登录链路最大的坑**，本 session 用真实会话实测定位
14. **token 会因新登录失效**：旧会话目录的 `.qqcli/.env` 可能 `invalid ai token`（8011），调试时先 `manage get-user-info` 验证 token 有效性，再排其它问题

### 本 session 新踩的坑（务必看）
15. **mysql2 对 JSON 列自动解析**：读 `articles.tasks`/JSON 字段时，别再做 `JSON.parse`（会抛错被 catch 吞掉变空数组）；`typeof === 'string'` 才 parse
16. **Express 路由顺序**：固定路径（如 `/api/learn/nfti-ticket`）必须放在参数路由（`/:slug`）**之前**，否则被 `:slug` 捕获返回"文章不存在"
17. **前端阅读计时**：SPA hash 切换不触发 `pagehide`/`beforeunload`——离开文章页（回首页/切文章）定时器仍会触发。**必须**：每次路由切换时取消计时器（`app.js render()` 调 `window.__cancelLearnReadTimer()`）+ 每篇文章独立 `readStart`（不能跨文章共享变量，否则第二篇秒读发分）；兜底上报用 `fetch keepalive` 带 Bearer（`sendBeacon` 不带 Authorization 会 401）
18. **前端文件无构建步骤**：改 `public/` 下 JS/CSS 后只需 `pm2 restart patplayer`（静态文件直接伺服），但**改了 index.html 的 script 引用必须同步**（新增 JS 文件要加 `<script>` 标签）。**改 JS/CSS 后记得把 index.html 里所有 `?v=N` 版本号 +1**（2026-08 起引入：浏览器/QQ webview 会缓存旧 JS，曾出现"改了代码用户看不到"的困惑；`Cache-Control: max-age=0` 只保证刷新时重校验，已打开的旧标签页 SPA 内跳转不会重载 JS）
19. **NFTI 是 Docker 部署**：改 NFTI 代码要 `docker compose -f /home/nfti/NF-BTI/docker-compose.yml up -d --build <服务>`。**前端由 nginx 容器托管，改前端必须 rebuild nginx 服务**（光 rebuild backend 前端不生效——本 session 踩过）
20. **CSS 编辑风险**：SEARCH/REPLACE 误删选择器行（`.empty {` 的规则体被吞）会导致全站空态样式丢失；改完 grep 确认 `.empty`/`.spinner` 等关键规则完整
21. **logo 用外链 CDN 会卡加载**：腾讯图片 CDN（groupprohead.gtimg.cn）在部分网络下慢/被墙，已本地化到 `public/img/logo.png` 并加 `onerror` 降级为"南"字
22. **nginx 413 拦截**：超 200MB 文件被 nginx `client_max_body_size 200m` 拦截返回 HTML 413（前端解析失败显示"请求失败 (413)"）；前端已做上传前预检（大小上限从 `/api/auth/me` 下发）+ api.js 对 413 给固定中文文案
23. **证书 www 子域**：证书 SAN 已含 `www.pat.weaxi.cn`（重签），nginx 配置 www → 301 归一化到不带 www；`deploy/pat.weaxi.cn.conf` 是源，改完 `cp` 到宝塔目录 + `nginx -t && reload`
24. **`middleware/auth.js` 的 SELECT 必须包含新列**：加 `points` 列时若漏查，`req.user.points` 恒 undefined → 排行榜 `me.points` 恒 0（我的积分页显示错误）。加列后同步 middleware SELECT。**2026-08-15 延伸**：`routes/auth.js` 的 `PATCH /profile` 返回的 `publicUser` 同样必须全列 SELECT——否则前端 `API.setUser(data.user)` 用 points=0 / is_admin=false 覆盖缓存（积分徽章归零、管理员导航入口消失，直到重新登录）。同类"响应字段缺失"排查：凡是前端 `setUser` 的接口，响应必须含 `points/is_admin/status/created_at`
25. **任务上报失败要可见**：前端 `reportTask` 不能静默吞错（`catch {}`）——失败时按钮已置灰但服务端没记录，用户以为完成了。失败要 toast + 回滚按钮状态允许重试
26. **`poll` 的 `token_obtained` 快捷分支要检查 tiny_id**：已授权但 tiny_id 反查失败时，下一次 poll 不能直接返回 `authorized`（会弹 bind 表单 → bind 又报错），必须重查 tiny_id，仍失败返回 `pending_authorization` + 明确错误
27. **B站视频链接获取**：`search.bilibili.com` 直接 curl 会被反爬（412），需带浏览器 UA + Referer；`api.bilibili.com/x/web-interface/view?bvid=` 可验证 BV 有效性（标题/时长/UP主）。教程任务里的 BV 号失效需更新 `seed-articles.js` 重跑
28. **Content-Disposition 不能直接放中文文件名**：HTTP 头仅 ASCII，中文会抛 `ERR_INVALID_CHAR`（预览 500）。用 `filename="preview.html"; filename*=UTF-8''<encodeURIComponent(中文名)>`（RFC 5987）
29. **`query()` 返回值解构陷阱**：`db.query()` 对 INSERT/UPDATE 返回 ResultSetHeader（对象），对 SELECT 返回行数组。`const [rows] = await query('INSERT ...')` 会解构 ResultSetHeader 报 "not iterable"；SELECT 想取整组用 `const rows = await query(...)`，取首行才 `const [row] = ...`。已踩：点赞 INSERT、learn.js app-status 的 `[appRows]`
30. **审查拒绝曾白送积分**：原 upload 顺序 INSERT→grant(+50)→审查拒绝→删记录但积分留下。修复：违规/超长分支加 `revoke()` 回扣（file_submit_revoke 负数流水对冲）
31. **`upload_log` 计数含删除**：删除文件不删 upload_log 行，`file_submit` 流水也保留（revoke 只加负数对冲），保证"每天 20 次含删除"计数准确

### 本 session（访客直传）新踩/新增的坑
32. **访客令牌 ≠ 系统令牌**：`POST /api/auth/guest` 现在返回 `{ token: guestToken, project_path: '#/p/<token>', ... }`——`token` 是 64 位 hex 的 `guest_token`（无过期、随地址分享），**不是** HMAC Bearer。前端不要把 guest_token 塞进 `API.setToken`（会把访客带进系统），上传时以 multipart 字段 `token` 单独传
33. **`guest_token` 是存量库迁移**：MySQL 不支持 `ADD COLUMN IF NOT EXISTS`，`init-db.js` 先查 `information_schema.COLUMNS` 再 `ALTER TABLE users ADD COLUMN guest_token ... ADD UNIQUE KEY uq_guest`；`schema.sql` 已同步（新库直接建）。**线上跑过 `npm run init-db` 后列才存在**，改表用 ALTER 勿 DROP
34. **磁盘自检必须在 multer 之前**：multer 会把文件写进磁盘，`ensureDiskSpace()` 必须放在 `runMulter()` 之前调用，否则空间不足时文件已落盘（虽会被清理，但已造成瞬时写入）。用 `fs.statfsSync`（Node ≥18.15，本机 v22 可用），老 Node 兜底 `df -k`
35. **上传管线已抽取共享**：`utils/upload.js` 的 `runUploadPipeline(req, res, user, { maxUploadsPerDay })` 是登录（`/api/files/upload`，20 次/天）与访客（`/api/guest/upload`，5 次/天）共用的唯一实现；改上传逻辑只改这一处。`files.js` 只保留路由壳 + multer 错误映射。**2026-08-15 起额度/配额原子化**：每日次数、作品数、存储配额的检查与 `files`/`upload_log` 写入在**同一事务 + `SELECT id FROM users WHERE id=? FOR UPDATE` 用户行锁**内完成，并发不会突破上限；失败上传整体回滚、不消耗当天次数。同类模式也用于 `apps.js` 提交（数量上限）、`utils/points.js` 的 `grant()`（REASON_CAPS 计数上限）与 `grantCapped()`（点赞每日上限）
36. **访客项目页绕过系统登录检查**：`app.js render()` 里 `#/p/:token` 在 `if (!API.getToken())` 之前 return，且复用 `body.is-auth` 隐藏主页壳；新增独立页路由时别忘了这两点（否则访客没系统令牌会被踢回登录页）
37. **`#/p/` 页内请求令牌走 `x-guest-token` 头**：`API.download()` 只带 Bearer 头，访客页的 files/download/delete 用 `x-guest-token` 请求头 + 密码走 JSON body（`public/js/project.js` 独立实现；2026-08-15 起不再放 query，防 nginx 访问日志记录凭据）；**预览**（顶层导航 `<a href>` 无法带头）仍用 `?token=` query，靠 `Referrer-Policy: no-referrer` + nginx `noquery` 日志格式兜底
38. **同一身份重复登记返回同一项目地址**（`ensureGuestToken` 幂等）：用户丢了地址重新填表即可找回；也因此「谁拿到地址谁可看文件」是设计行为（地址即凭证），文档已标注
39. **访客表单必须「提交前」校验文件类型/大小**：曾出现用户选 PDF → 提交 → 先弹「🎉 提交成功」页再在页面里提示「1 个文件上传失败（不支持 .pdf）」，体验很差。修复：新增公开接口 `GET /api/auth/upload-rules`（允许扩展名 + max_upload_mb，单一数据源在 config.js），前端选文件时即拦截不支持的扩展名/超限文件，点提交时再兜底校验一遍，**任何文件不过校验就不进入登记/上传流程**；成功页标题也改为失败时不显示「提交成功」。改白名单记得同步 `FALLBACK_UPLOAD_RULES`（auth.js 前端兜底常量）
40. **上传必须用 XHR，不能用 fetch**：`api.js` 的 `request()` 对所有请求套了 **15s 超时**（AbortController），200MB 大文件慢网速下必被掐断。上传统一走 `API.uploadWithProgress(path, formData, onProgress)`（XMLHttpRequest `upload.onprogress`，**不设超时**），三处上传（访客表单 auth.js / 项目页 project.js / 我的项目 dashboard.js）已全部接入；`Utils.createSpeedTracker()`（EWMA 平滑）算速度、`Utils.formatProgress(loaded, total, speed)` 输出 `12.6 MB / 198.8 MB · 1.2 MB/s`。dashboard 原「假进度条」（fakePct 封顶 88%）已删，改由真实字节驱动顶部进度条
41. **访客删除 = 安全密码 + 限流**：`DELETE /api/guest/files/:id`，令牌走 `x-guest-token` 头、密码走 JSON body（2026-08-15 起，勿再放 query——nginx 日志不再记 query，但老客户端可能仍发 query 兜底兼容）。密码逻辑在 `utils/pwd.js`：scrypt 加盐哈希（`salt:hash`，Node 内置 crypto，无新依赖），`timingSafeEqual` 常量时间比对；`users.guest_pwd_hash` 为 NULL 时按默认密码 `config.guestDefaultPassword`（env `GUEST_DEFAULT_PASSWORD`，默认 `nanfang1958`）比对。**默认密码已明示在客户端提示里 = 公开，留空 = 不设防**——这是产品取舍（用户要求直接告知默认值，否则留空用户删文件时无从知晓）。**改默认密码必须同步三处**：`config.js`、`public/js/auth.js` 提交表单提示、`public/js/project.js` 删除弹窗提示。删除接口限流 `guestDeleteRateLimit`（10 次/10 分钟/令牌+IP）防爆破；删除回扣 `file_submit` 积分、**不返还当天上传次数**（与 QQ 用户删除一致）
42. **管理后台 P0（2026-08-14 上线）**：设计见 `ADMIN-DESIGN.md`，代码在 `routes/admin.js`（全部 `requireAdmin`）+ `public/js/admin.js`（`#/admin*` 四页：总览/用户/文件/审核）。要点：① 管理员引导 = `ADMIN_QQ_TINY_IDS` 环境变量（QQ 绑定 `maybeGrantAdmin` 自动置 `is_admin`），或已有管理员在后台授权，或手动 SQL `UPDATE users SET is_admin=1 WHERE ...`；② `users.status='disabled'` 停用生效点：`middleware/auth.js`（登录态 401「账号已停用」）、`auth.js /guest`（403）、`guest.js loadActiveGuest`（401）；③ `publicUser` 两处（auth.js / auth-qq.js）都要带 `is_admin`/`status`，middleware SELECT 也要带（坑 #24）；④ **`db.query()` 返回行数组：SELECT 多行直接 `const rows = await query(...)`（解构 `[x]` 只取首行），SELECT 单行聚合才 `const [row] = ...` 且用 `row.c` 别用 `row[0].c`，INSERT/UPDATE 返回 ResultSetHeader（对象）用 `const r = await query(...)` 取 `r.insertId`——**绝不可解构**（P0 stats、P1 pins/titles/storage 都在这上面 500 过）**；⑤ 管理端删除文件/拒绝审核走 `revoke()` 回扣 +50，删除轻应用回扣 +25（普通用户路径 app 删除未回扣，管理端补齐），审核「重新通过」会补发被回扣的 +50（ref 用 `file:<id>:restore`）；⑥ 前端管理入口仅 `API.getUser().is_admin` 显示，非管理员访问 `#/admin*` 被 Views.admin 内部拦截；⑦ **`DATE_ADD(NOW(), INTERVAL ? HOUR)` 在预处理语句不可用**——置顶/称号的到期时间用 JS `mysqlNow(offsetMs)` 计算传参（`routes/admin.js` 顶部 helper）；⑧ 管理页下载走 `API.download`（带 Bearer），预览链接要拼 `?token=`，普通 `<a href>` 会 401；⑨ **P2**：教程编辑 `routes/admin.js` 的 `upsertArticle`（slug 唯一校验 + tasks 必须 JSON 数组；改教程不动学员 task_progress——FK 按 article_id，保留 id）；`utils/settings.js` 运行时设置（30s 进程内缓存，PUT 后 `invalidate()` 立即生效；`upload.js` 上传管线读 `audit_enabled` 覆盖 DeepSeek 审核）；批量审核 `/api/admin/audit/batch` 逐条 try/catch 不中断；教程预览复用 `learn.js` 顶层 `renderMarkdown()`（全局函数，learn.js 必须先于 admin.js 加载）；⑩ **教程独立编辑页** `#/admin/articles/new` / `#/admin/articles/edit/:id`（`Views.admin` 内解析 `location.hash` 子路由分发，`renderArticleEditor` 双栏：左表单右实时预览，`.ae-grid` CSS 响应式，Ctrl+S 保存；已废弃弹窗版 showArticleModal）

### 2026-08-16 新增（昵称方案二 / 内容审查 / 展示名隐私 / 防刷榜）
43. **昵称方案二（取代 AI 审核）**：昵称 = 姓名拼音首字母，多音字展开候选由用户选、**选定后不可更改**。链路：`pinyin_initials.py`（pypinyin `heteronym`，pip 已装；最多 6 个候选）→ `server/utils/pinyin.js`（execFile 封装）→ 公开接口 `GET /api/auth/pinyin-candidates?name=`（限流 120/10min）→ 前端 `Utils.initialsPicker(optionsEl, hiddenEl, name, existing)`（utils.js 全局函数，绑定表单 auth.js `renderIdentity` / 访客表单 / dashboard.js 展示设置三处复用）。**服务端必校验**：bind（auth-qq.js）、访客登记（auth.js /guest）、改资料（PATCH /profile）三处都要 `pinyinCandidates(real_name)` 重算并 `candidates.includes(nickname)`；PATCH 已有合法缩写则**强制保留**（不可改）。存量自由文本昵称不迁移，下次编辑展示设置时强制改选。**auditNickname 调用已移除**（方案二无自由文本）
44. **R2 展示文本审查**：作品标题/简介/玩法（files PATCH / apps POST）提交时 `auditDisplayText`（utils/audit.js 新增 TEXT_SYSTEM_PROMPT 从严提示词）同步审查，违规 400 + 原因；AI 不可用降级放行；**违规同时写 `audit_logs` 表（O3）**，管理后台「审计」页签顶部展示最近 20 条
45. **⚠️ `_review(text, prompt, maxLen)` 参数**：重构 audit.js 共享 HTTP 逻辑时**必须传 maxLen**——`reviewContent` 用 `config.deepseek.maxChars`(16000)，`reviewNickname` 64，`reviewDisplayText` 2000；漏传会退化为 64 字符（曾导致文件正文审查只送 64 字符的回归，已修）
46. **O1 防刷榜**：积分排行榜/排名查询加 `AND qq_tiny_id IS NOT NULL`（访客不进榜，防批量注册刷分）；访客项目页（project.js）顶部加「💡 QQ 合并」提示条——绑定同名班级即接管合并（既有 bind 逻辑天然支持）
47. **P1 同班才显真名**：`class.js displayNameOf(row, viewerClass)` 与排行榜按**查看者班级**判断——同班展示真名，非同班显示昵称（拼音缩写），**无昵称兜底「同学」而非真实姓名**（防泄漏）；wall/overview/leaderboard 三处都改；`groupByStudent` 透传 viewerClass
48. **新建表 `audit_logs`**（content/result/reason/user_id/ref_type/ref_id/created_at）：schema.sql 已含，存量库 `npm run init-db` 自动建；管理端 `GET /api/admin/audit-logs`（requireAdmin 内）
49. **R3 恶意程序扫描（ClamAV，2026-08-16 上线）**：本机为 OpenCloudOS 9.4（dnf 系，EPOL 源含 clamd/clamav-freshclam）；已装 clamd 1.0.7 + 签名库（main/daily/bytecode 共 360 万+ 签名），服务 `systemctl enable --now clamd@scan clamav-freshclam.service`；**clamd 仅监听 127.0.0.1:3310**（务必确认 `TCPAddr 127.0.0.1`，勿公网暴露）。集成：`server/utils/clamav.js`（clamd INSTREAM 协议流式扫描，`scanFile(filePath)` → `{available, clean, virus}`；不可用/超时返回 available:false）；上传管线 `utils/upload.js` 在**落库/发分前**扫描，命中病毒直接删盘拒收 400（无 DB/积分副作用）；`config.malwareScan`（env `MALWARE_SCAN`，默认 1）。扫描不可用 → 降级放行（与 DeepSeek fail-open 一致）。实测：EICAR 拒收、正常文件放行
50. **P2 全局访客登记限速（2026-08-16）**：`routes/auth.js` /guest 新建身份分支加进程内滑动窗口 `guestRegTimes`（`config.guestRegGlobalPerHour`，env `GUEST_REG_GLOBAL_HOUR`，默认 60/小时）——**只统计新建身份**，幂等找回地址不消耗额度；批量脚本即使换 IP 绕过单 IP 限流也会全局熔断 429。实测：阈值 3 时第 4 个 429、找回同身份 200
51. **2026-08-16 二轮（用户拍板）**：① O1 排行榜加「在校/全部」切换（`GET /api/points/leaderboard?scope=in_school|all`，默认 in_school=标准班 2401-2425/2501-2524/2601-2624，全部=含毕业生/外校；前端 points.js 滑块局部刷新）；② R1 落地：访客作品**不进作品展/总览**（class.js wall/overview 的 JOIN 加 `u.qq_tiny_id IS NOT NULL`，QQ 合并后自动转正）；③ R3 双扫描：新增 `server/utils/virustotal.js`（VT v3 API：sha256 哈希查询命中即判 → 未收录且 ≤32MB 则上传；429 额度耗尽进程内熔断 12h 自动降级只跑 ClamAV；key 在 `.env` 的 `VIRUSTOTAL_API_KEY`，勿泄露/勿提交）；④ P3 积分重平衡：被赞 +2→**+5**（日上限 30→**20**）、提交文件 30→**25**、阅读 10→**8**、整章任务 20→**15**、毕业 50→**40**（RULES 在 utils/points.js 单源；前端 tips/README/FEATURES 已同步）；评委打分走既有 `POST /api/admin/users/:id/points`（±，reason 备注评委评审）
52. **评委评审（P3，2026-08-16 上线；2026-08-17 升级为独立页签 `#/admin/judge`；2026-08-17 权重改为 4:3:2:1）**：管理后台「评审」页签 → 打分表单（文件/应用搜索选择器 + 4 维度输入 + 实时预览）+ **待评审作品列表**（`GET /api/admin/judge?pending=1`，未评审的 QQ 用户作品）+ 已评审记录（可重新评审）→ 4 维度 0-10 整数打分（`JUDGE_DIMS`：创意 40% / 内容 30% / 完成 20% / 价值观 10%，4:3:2:1）→ 实时预览综合分与积分 → 提交。算法：`total=Σ(分×权重)`（2 位小数）→ `points=total<6?0:round(round(total*100)*30/100)`（满分 300，整数化防浮点漂移——勿用 `Math.round(total*30)` 直接乘，8.45×30 会因浮点得 253）。表 `judge_reviews`（ref_type/ref_id 唯一，覆盖评审 upsert）；差额发放走 `applyJudgePoints`（事务+行锁，points_log reason=`judge_review`，ref 带 `:j<时间戳>` 保证唯一键）；接口 `GET/POST /api/admin/judge`；管理员操作记 admin_log。P2 增强（口令/验证码）用户已取消
53. **⚠️ TDZ 坑（2026-08-17，评审页加载不出来的根因）**：`Views.admin` 函数体内 `const JUDGE_DIMS` 声明在函数体**靠后**，但 `loaders` 分发（前面）调用 `loadJudge()` 时该 const 处于**暂时性死区** → `ReferenceError: Cannot access 'JUDGE_DIMS' before initialization` → 页面内容从未渲染。**教训**：函数声明会提升、`const` 不会；页签级函数引用的模块级/函数级 const 必须声明在 loaders 分发之前。`node --check` 查不出 TDZ，用「DOM 桩 + 真实调用 Views.admin(page)」的 stub 测试才能抓到（stub 方法见本轮）。另：`audit_logs` 现记录 `kind='file_scan'`（每次上传的 ClamAV/VT 扫描结论，approved/rejected + 原因摘要 + ref_id=文件 id，`utils/upload.js` logScan）；作品信息/轻应用保存按钮有「审核中.」点点滚动动画（disabled 变浅，`public/js/dashboard.js` 两处）

## 9. 部署环境

- 服务器：`49.232.252.213`（腾讯云轻量，宝塔面板，**本沙箱就是这台服务器**）
- 域名：`pat.weaxi.cn`（DNS 指向本机；同机还有 greendoc/speak/nfti 等站点，**勿动**）
- **PM2**：服务名 `patplayer`（`server/index.js`，监听 127.0.0.1:3001）
- **nginx**：`/www/server/panel/vhost/nginx/pat.weaxi.cn.conf`（反代 3001，`client_max_body_size 200m`）
- **SSL**：certbot webroot 模式（`/var/www/certbot`），证书 `/etc/letsencrypt/live/pat.weaxi.cn`（SAN 含 www）
- **NFTI**：`/home/nfti/NF-BTI`（Docker，backend 9000 + nginx 8081→80），与 PatPlayer 共享 MySQL、共享频道；**backend 容器只读挂载 `/home/PatPlayer/storage/qq-sessions → /patplayer-sessions:ro`**
- `.env`（生产，已 gitignore）：`NODE_ENV=production`、强随机 `TOKEN_SECRET`、DB 连接、**`PAT_TICKET_SECRET`（与 NFTI docker-compose 一致）+ `NFTI_DB_*` 只读连接 + **`DEEPSEEK_API_KEY`（内容审查，模型 `DEEPSEEK_MODEL` 默认 deepseek-v4-flash）****；配置项模板见仓库 `.env.example`（全部占位符，可安全提交）

## 10. 常用运维命令

```bash
# 重启服务（改代码后）
pm2 restart patplayer

# 改了 ecosystem 配置后（pm2 restart 不重读）
pm2 delete patplayer && pm2 start ecosystem.config.cjs && pm2 save

# 改 nginx 后
cp deploy/pat.weaxi.cn.conf /www/server/panel/vhost/nginx/pat.weaxi.cn.conf
nginx -t && nginx -s reload

# 看日志
pm2 logs patplayer --lines 50 --nostream

# 更新学AI 教程（seed-articles.js 是唯一数据源；幂等 upsert，不清空学员进度）
node seed-articles.js

# 重建 NFTI（跨站体验依赖它）
docker compose -f /home/nfti/NF-BTI/docker-compose.yml up -d --build backend
docker compose -f /home/nfti/NF-BTI/docker-compose.yml up -d --build nginx   # 前端改动必须重建这个

# 查积分/任务（密码从 .env 取，勿写死）
mysql -h127.0.0.1 -upat -p"$DB_PASSWORD" pat -e "SELECT id,real_name,points FROM users ORDER BY points DESC;"
mysql -h127.0.0.1 -upat -p"$DB_PASSWORD" pat -e "SELECT * FROM points_log ORDER BY id DESC LIMIT 20;"
```

## 11. 已知待办 / 风险

- **QQ 扫码完整链路**（poll-token → tiny_id → bind）需真人扫一次码验证（沙箱无法模拟）；**NFTI 借用会话的 CLI 调用（发帖等）也依赖真实 token，同样需真人扫码后验证一次**
- **auto-scan 较慢**：串行跑最多 24 个 python 子进程（首次几十秒），已加限流 5 次/分钟
- **`share_resolve.py` 依赖 QQ 反爬策略**：QQ 换反爬会失效，需重新逆向
- **访客直传是自报身份、无鉴权**：可冒名登记，且项目地址即凭证（谁拿到地址谁可看文件）；访客不进入系统，NFTI 体验任务强制 QQ 登录规避了系统侧冒名问题
- **访客项目地址需要真人走一遍**：填表 → 上传 → 复制地址 → 用地址回访下载/继续上传（本 session 已用 curl 冒烟验证接口，前端交互建议浏览器实测一次）
- **NFTI 借用会话依赖 PatPlayer 会话存活**：PatPlayer 30 天闲置回收会连带 NFTI 借用失效（提示重新登录，符合预期）
- **跨站 ticket 安全（2026-08-21 重构）**：ticket 只含一次性授权码（32 位 hex sid）+ HMAC + 5min 过期；真实会话 ID 由 `POST /api/learn/nfti-session-grant` 服务端换发（单次消费）。密钥在两边 .env 必须一致，勿泄露/勿改一侧
- **已知边界（2026-08-21 第三轮结论）**：① 视频任务与纯自报实操任务无法服务端核验（当前 5 章无此类任务，未来新增章节注意）；② GitHub Fork 检测依赖 API，API 故障时链接验证暂缓（503 提示重试）而非放行；③ NFTI 换发依赖 PAT 服务在线，PAT 重启会丢失内存中的授权码（5 分钟内重试即恢复）；④ 访客未设找回密码时无法自助找回项目地址（防冒名取舍，联系频道主人工处理）
- `feed_links.py` 提取正则依赖轻应用链接格式，变了需更新
- **B站视频链接**是教程任务的一部分，若失效需替换 `seed-articles.js` 中 BV 号并重跑

## 12. 下一步建议

- **上线前必须真人验证**：QQ 扫码 → 绑定（含展示名授权表单）→ 自动识别轻应用 → 第1章 NFTI 体验任务全链路；访客直传（填表→上传→地址回访）浏览器实测一次
- 若 PatPlayer 要独立 QQ 频道（不用南方中学频道），改 `.env` 的 `GUILD_ID`（会连带 NFTI 跨站失效，两边都要改）
- 若访客直传也要防冒名/防盗链，可参考 NFTI 的邀请码 + 设备指纹方案，或给 `guest_token` 加过期/重置机制
- NFTI 项目 `/home/nfti/NF-BTI`，QQ 集成思路同源；跨站体验的 import-session/cliHome 机制在其 backend/server.js 中

## 13. 2026-08-20 限时积分加成（1.2 倍）

- **顶部横幅**改为「🚀 系统上线，限时可得 1.2 倍积分」（index.html，静态文本）。
- **限时加成**：2026-08-20 00:00 ~ 2026-08-23 24:00（北京时间，UTC+8，即 `[2026-08-20T00:00, 2026-08-24T00:00)` 北京时），窗口内**所有正向积分 ×1.2**（`Math.round(amount*1.2)`，只乘正向发放，回扣/负数不乘）。实现集中在 `server/utils/points.js`：`BONUS_START_TS/BONUS_END_TS`（`Date.UTC(2026,7,20,0,0,0)-8h` 与 `Date.UTC(2026,7,24,0,0,0)-8h`，不依赖服务器时区）+ `bonusAmount()`；`grant()` 与 `grantCapped()` 入口处调用；评审积分在 `routes/admin.js` 的 `applyJudgePoints` 里对正向 delta 调用（`bonusAmount` 已从 points.js 导出）。**管理员手动调整 `admin_adjust`（正值）也走 grant()，同样会乘**——这是"所有积分"的预期行为。
- **幂等/回扣不受影响**：points_log 记录的是乘倍后的实际金额；`revoke()` 按流水原额扣回（删掉加成期提交的文件会扣回乘倍后的数）。
- 活动结束后（2026-08-24 00:00 北京时起）`bonusAmount` 自动失效；如需提前结束/改倍率，改 `points.js` 顶部常量并重启 pm2 即可。前端横幅文案需同步改（index.html）。

### 13.1 超限提交显示 +0 与 ⓘ（2026-08-20）

- 背景：有同学误以为「提交作品超 5 次导致 +30 未计入」——实际 `REASON_CAPS`（file_submit≤5 / app_submit≤3）超限时 `grant()` 原本**静默跳过、不写流水**，积分记录页什么都看不到。
- 改动：`server/utils/points.js` `grant()` 超限分支改为 `INSERT IGNORE ... amount=0`（ref 同幂等键，同一作品只记一条 +0），仍返回 `null`（调用方行为不变）；`revoke()` 对 0 行不扣分（amount<=0 直接 return），`restoreFilePoints` 不受影响。
- 前端：`public/js/points.js` 积分记录页对 `amount===0` 的行显示中性色 `+0 ⭐` + ⓘ 按钮（`ZERO_REASON_HINTS`：file_submit/app_submit 专属文案，点击 `Utils.toast` 说明「超出计分规则」）；`style.css` 新增 `.lb-info`。
- 注意：+0 行会计入 `COUNT(*)` 上限判断（本来也已达上限，无影响）；改倍率/窗口见 §13。

### 13.2 轻应用重复提交修复（2026-08-20）

- **Bug**：自动识别与手动识别同一帖子会得到同一 app_url，`POST /api/apps` 无去重 → 同一作品可入库两条列表（实测 Codex 用户 apps 28/41 重复，且重复的 41 还多拿了 +18 星，15×1.2）。
- **修复**：① `server/routes/apps.js` 提交接口在「用户行锁事务」内先查 `SELECT id FROM apps WHERE user_id=? AND app_url=? LIMIT 1`，存在则 400「该作品已提交过了，请勿重复提交」（与 maxAppsPerUser 检查同一事务，并发安全）；② `public/js/dashboard.js` 新增模块级 `submittedAppUrls`（loadApps 时刷新），`addScanItems` 对已提交 url 直接跳过，识别结果不再提示重复项。
- **清理**：`revoke(36,'app_submit','app:41')` 回扣 18 星 + 删 apps 行 + admin_log 记 `apps.dedupe.cleanup`（admin_id=3）。去重键用 **app_url** 而非 source_feed_id——同一帖子可能含多个应用链接，按 feed 去重会误杀同帖多应用。

### 13.3 GitHub 项目外链（2026-08-20，讨论后落地）

- **需求**：频繁更新的项目用 GitHub 链接最合适；**防冒充是核心**（粘贴别人仓库 URL 冒充零成本，比文件上传更严重）。
- **决策**：Token 文件验证 + +25⭐ 最多 5 个 + 仅 GitHub 公开仓库。
- **实现**：新表 `links`（`uq_link_user_url` 唯一）；`server/routes/links.js`：POST / 生成 `PAT-` token（解析 `github.com/{owner}/{repo}`）→ POST /:id/verify 读 `raw.githubusercontent.com/{owner}/{repo}/HEAD/nanfang-pat.txt` 比对（8s 超时，404/网络失败=未验证可重试）→ 通过发分 `link_submit`（RULES 25 / REASON_CAPS 5，走 grant 自动吃限时 1.2 倍）；删除 `revoke('link_submit','link:<id>')`。
- **接入**：`index.js` 挂 `/api/links`；点赞接口支持 `link` 类型；作品展 wall 混排已验证外链（🔗 + ✓ 已认证 + owner/repo + 前往 GitHub），overview 统计 `link_count`/`total_links`；管理后台新增「外链」页签（`/api/admin/links` 列表 + DELETE，回扣+审计）；「我的项目」新增第三个 Tab。
- **注意**：`GET /api/links` 不返回 verify_token（只在下单响应里给用户）；验证幂等（verified 后不再发分）；仓库改名/删除后链接失效属预期（作品展展示的是提交时 URL）。

### 13.4 审查修复（2026-08-20）

- **网络坑（重要）**：本服务器（腾讯云境内）访问 `raw.githubusercontent.com` **间歇超时**（curl/node fetch 时而 200 时而 000）；`raw.gitmirror.com`、`ghproxy.com` 不可达。**jsDelivr `cdn.jsdelivr.net/gh/{owner}/{repo}@HEAD/...` 稳定可达**（@HEAD 解析默认分支）。`links.js fetchRepoToken` 已改为 jsDelivr 主源 + raw 兜底；验证失败提示加「刚提交请等 1 分钟（CDN 缓存延迟）」。
- **verify 幂等补发**：原 `if (row.verified) return` 早退会让"验证成功但发分途中 500"的链接永久漏分；改为已认证也走 `grant()`（按 ref 幂等）补发。
- **token 可找回**：`GET /api/links` 现在返回 `verify_token`（仅本人可见），前端列表加「验证指引」按钮（`showVerifyBox` 复用），刷新页面后仍可完成验证。
- **url 规范化**：入库统一存 `https://github.com/{owner}/{repo}`，去重按规范化值（`/foo/bar/` 与 `/foo/bar` 不再算两条）。
- **守卫**：owner/repo 拒绝含 `..`（防 raw URL 路径穿越，GitHub 本身也不允许）。
- **+0 提示**：前端 `ZERO_REASON_HINTS` 补 `link_submit`（超 5 个验证时 ⓘ 显示「提交 GitHub 项目最多计 5 个」）。
- **全库对账**：`SELECT users WHERE points <> SUM(points_log.amount)` → 0 条不一致（1.2 倍/回扣/+0/评审全部一致）。

### 13.5 ClamAV 移除 → 纯 VirusTotal（2026-08-20，内存危机处理）

- **背景**：2GB 小服务器内存打满、swap 耗尽。实测 **clamd 常驻占 744MB**（签名库载入内存），连"按需 clamscan"也不可行（每次扫描瞬时加载 ~600MB 同样触发 OOM）。用户决策：只停 ClamAV，其余服务不动。
- **改动**：① `server/utils/clamav.js` **已删除**，`utils/upload.js` 扫描块改为纯 `scanWithVirusTotal`（`config.malwareScan && config.virustotal.enabled` 门控；infected 拒收删盘，其余状态放行并记 audit_logs file_scan）；② `systemctl disable --now clamd@scan clamav-freshclam`（释放 ~730MB，可用内存 399→1129MB）；③ virustotal.js 清理残留"ClamAV 兜底"文案；④ 实测：普通文件放行、EICAR 被 VT 拦截（W32.EicarTest.Trojan）。
- **注意**：① VT 免费档 4 次/分、500 次/天，429 熔断 12h 降级放行——高峰期可能短暂无扫描（fail-open，可接受）；② >32MB 文件不传 VT（哈希未命中即放行）；③ 如需恢复本地扫描：`dnf install clamd clamav-freshclam` + `systemctl enable --now clamd@scan` + 恢复 utils/clamav.js（旧版在 git 历史）；④ freshclam 已停，签名库不再更新（本地已无扫描器，无所谓）。

### 13.6 上线前安全审查修复（2026-08-20，双子代理独立审计 + 人工复核）

**严重项（已修复）**
- **HTML 预览令牌泄露（存储型 XSS 链 → 账号接管）**：旧实现 `/api/files/preview/:id?token=...`（及 guest preview）把令牌放 URL，CSP sandbox 挡不住上传 HTML 读自身 `location.href` 外传令牌。修复：① 新建 `public/preview.html` 安全预览壳——令牌只走请求头（登录态从 localStorage 读；访客令牌经壳页 hash 传入，本就是 URL 凭据），fetch 取内容后经 **blob URL + `<iframe sandbox="allow-scripts">`**（无 allow-same-origin，unique origin）渲染，上传页面读不到父壳/自身 URL 的任何令牌；② 服务端两个 preview 端点**改为仅接受请求头**（files.js 删 `req.query.token`；guest.js 预览改 header-only，不再走 loadActiveGuest 的 query 兼容）；③ 前端三处预览链接改指向 `/preview.html#/file|guest/...`。

**中危（已修复）**
- **`.env` 644 世界可读**（含 DB 密码/TOKEN_SECRET/API 密钥）→ `chmod 600`。
- **`/poll` 无限流**（可伪造会话刷 CLI 子进程）→ 加 `rateLimit 120 次/10 分钟/IP`。
- **VT 请求无超时**（VT 不可达时上传挂起）→ `vtRequest` 加 12s AbortController 超时，超时/错误按 pass 放行（fail-open 语义不变）。

**已知设计取舍（子代理列为中危但属文档化的产品决策，不改）**：① QQ 扫码无设备绑定（QR 登录固有，bind 前展示昵称确认）；② 访客自报身份 + 默认删除密码公开（README 已声明"地址即凭证/默认密码=不设防"）；③ guest_token 永久 URL 凭据（产品设计）；④ token 24h 过期无撤销（可接受）；⑤ 扫描 fail-open（防阻断学生上传）；⑥ 访客上传先落盘后鉴权（有清理兜底）；⑦ AI 审查 16K 截断（覆盖率取舍）。
**未发现**：SQL 注入、token 算法缺陷、admin 提权绕过、密码哈希问题、路径穿越、配额竞态。

### 13.7 子代理 B 报告剩余项处理（2026-08-20）

- **multer 字段数限制**：`limits` 补 `parts:20 / fields:20 / fieldSize:64KB`（防 multipart 海量字段内存 OOM DoS，upload.js）。
- **访客上传 IP 限流**：`POST /api/guest/upload` 加 `rateLimit 10 次/分钟/IP`（防未认证无限投递 multipart 磁盘写放大——multer 先落盘后校验 token，现限流在 multer 之前生效）。
- **links.js 抓取响应体上限**：`fetchText` 改流式读取 + 64KB 上限（防仓库里放大文件造成内存尖峰）。
- **上传发分容错**：`grant(file_submit)` 失败不再让已入库的上传整体 500，记录日志（积分可后台补发）。
- **复查不成立的项**：QQ 会话 `.qqcli/.env` 实为 600（CLI 自建，安全）；`execFile` 无 shell 无 flag 注入；访客默认删除密码为文档化产品决策（"地址即凭证+留空=不设防"）。
- **记录不改（迭代排期）**：AI 审查 16K 截断（覆盖率取舍）、pending 文件全校可见（审核队列兜底）、ensureDiskSpace TOCTOU、guest_token 永久凭据、token 无撤销。

### 13.8 子代理 A（认证与权限）报告处理结论（2026-08-20）

- **严重 1 QQ 扫码无设备绑定**：QR 登录固有模型（微信/QQ 扫码同款）；bind 表单要求受害者填班级姓名=二次确认；属文档化设计取舍，不改。
- **严重 2 访客"姓名+班级"找回 token + 公开删除密码**：README 已声明"地址即凭证/留空=不设防/防冒名仅 QQ 保护"——产品决策（便利性换安全），用户拍板保留，不改。已知边界：知道姓名+班级可枚举找回任意访客 token。
- **严重 3 预览 token 泄露**：✅ 已修复（§13.6，安全预览壳 + header-only 端点）。
- **中 4 /poll 无限流**：✅ 已加 120 次/10min/IP（§13.6）。
- **中 5 .env 644**：✅ chmod 600（§13.6）。
- **中 6 scryptSync 阻塞事件循环**：记录排期（访客删除限流 10/10min 已缓解；需改 pwd.js 异步 + auth.js/guest.js 调用点 await）。
- **中 7 guest_token 永久 + query 兼容**：文档化设计；前端已走 x-guest-token 头，query 仅老客户端兼容（nginx noquery 日志缓解）。
- **中 8 token 24h 无撤销**：学校平台可接受，记录。
- **低 9-12**：限流非原子（单实例可接受）/uid 类型（无注入）/删除密码 query（nginx 缓解）/trust proxy（已核实 nginx $remote_addr 覆盖安全）。
- **复核不成立**：preview 未拦 flagged（实已拦，files.js:140-141）；pending 文件他人可见为 fail-open 设计（审核队列兜底）。

### 13.9 共同计分上限 + 作品展标识 + topbar 全宽（2026-08-20）

- **共同上限**：`file_submit`（作品文件）与 `link_submit`（GitHub 项目）**合计最多计 5 个**（此前分别计 5）。实现：`points.js` 新增 `CAP_GROUPS`，`grant()` 上限计数按组 `reason IN (...)` 统计（file/link 互相计入）；`app_submit` 仍独立 3 个。前端 +0 提示、GitHub tab 文案、README/FEATURES 已同步。**存量已发积分不回扣**（向前生效）。
- **作品展**：GitHub 项目卡片的「✓ 已认证」徽标移除（class-wall.js proj-title），避免误导（所有入墙链接本来就是已验证的）。
- **topbar 全宽**：`index.html` 把 `#topbar` 从 `.main` 移到 `#app` 直属（rail/appbar 之间）——移动端不再被 `.main` 的 14px 侧内边距约束，撑满全屏；桌面端仍 `display:none` 不受影响。

### 13.10 QQ 登录超时修复（2026-08-20）

- **问题**：前端 `api.js` 全局 15s 超时，但服务端 `/api/auth/qq/poll` 内部 `runCli` 就有 25s 超时，扫码后 tiny_id 反查还是多步 CLI——单次 poll 合法耗时可超 15s；而 `pollSession` 的 catch 遇超时就 `clearPoll()` 停轮询 → 登录流程被掐死（"请求超时，请检查网络后重试"后必须重新扫码）。
- **修复**：`api.js` `request(path, opts, timeoutMs)` 支持按请求指定超时（默认仍 15s，get/post/patch/del 透传）；`auth.js` 定义 `QQ_LOGIN_TIMEOUT = 599000`（约 10 分钟，覆盖整个扫码授权窗口），init/poll/bind 四处调用全部传长超时。**全局仍是 15s**（避免其他接口挂 10 分钟），只放大 QQ 登录链路。
- **遗留可选**：pollSession catch 对瞬时网络错误仍会停轮询（599s 下超时不再发生，仅剩真实网络故障场景）；如需彻底抗抖动可改成"连续 N 次失败才停"。

### 13.11 姓名合法性校验（2026-08-20，清理内测数据前补充）

- **现状（此前）**：real_name 只有「标准年级必填 + 最长 32 字符」，无汉字/长度/字符集校验（"abc"、"A" 都能过）。
- **规则（用户拍板）**：姓名须为 **2-4 个汉字**，禁英文字符/数字/符号：`/^[\u4e00-\u9fa5]{2,4}$/`。
- **落点**：后端 `routes/auth.js`（访客登记）+ `routes/auth-qq.js`（QQ bind）——typed 值非空时校验；「其他」年级（毕业生/外校）可留空（仍回落 QQ 昵称/「同学」，**回落值不校验**，避免挡住英文昵称的毕业生）；前端 `auth.js` 两处提交前校验 + 输入框 `maxlength=4`。
- **边界提示**：复姓 4 字（欧阳娜娜/司马相如）可过；5 字名、生僻扩展区汉字、少数民族转写名会被拒（如需放宽改正则）。
- **存量数据不受影响**：校验只作用于提交时；内测数据（含 ikuu/fhq/F=kQq/r² 等不合规名）清理后消失。

### 13.12 内测数据清理（2026-08-20 执行）

- **备份**：`storage/backups/pre-clear-pat-20260820-213204.sql.gz`（全库 15 表）+ `pre-clear-uploads-20260820-213204.tar.gz`（93MB/13 文件）。**用户确认无误后可删除**（建议保留到上线后稳定一周）。
- **清理**：`scripts/clear-beta-data.js`（保留在仓库可复用）TRUNCATE 13 张业务表（users/files/apps/links/points_log/task_progress/likes/purchases/judge_reviews/upload_log/audit_logs/admin_log/feed_like_snapshots）；**保留 articles（5 章教程）与 settings**；`storage/uploads`、`storage/qq-sessions` 清空。users AUTO_INCREMENT 归零（新用户从 id=1 开始）。
- **清后状态**：全部业务表 0 行；首页/学AI 200；访客登记接口 400 校验正常；内存 available ~975MB。
- **注意**：管理员已随 users 清空——QQ 扫码绑定后由 `ADMIN_QQ_TINY_IDS` 白名单自动恢复（.env 已配置 ✓）；QQ 会话已清，需重新扫码。冒烟测试由用户手动执行。

### 13.13 「其他」年级身份表单逻辑理顺（2026-08-20）

- **问题（用户反馈"逻辑怪"）**：「其他」分支姓名字段标签是「姓名(或昵称)」，但方案二下昵称=姓名拼音首字母、不可手填——用户以为能直接填昵称，填进去却被当姓名用，还要再走"选展示方式→生成缩写"，语义矛盾。
- **修复**（`public/js/auth.js` renderIdentity，「其他」分支）：标签改「姓名」；placeholder「可留空」→「选填：毕业生/外校可不填」；新增小字说明「展示昵称固定为姓名拼音首字母（在下方选择，不可手填）；不填姓名则展示默认名」；**移除 QQ 频道昵称预填**（预填英文昵称会撞上 2-4 汉字校验且语义错误）。前端报错文案「选择只展示昵称后，请填写昵称」→「选择只展示昵称后，请填写姓名以生成展示昵称」（两处，与后端文案对齐）。
- **顺带明确**：「其他」班级 2120 能通过是因为毕业生班号只能约束为 4 位数字（历届无法穷举），属文档化设计取舍；已知边界=任何 4 位数字均可，呼应访客自报身份风险。

### 13.14 「其他」年级误填在校班级的引导（2026-08-20）

- **需求**：选「其他」却填了在校班级号（2401-2425/2501-2524/2601-2624）时，引导用户选择对应年级。
- **实现三层**：
  1. 前端实时提示（auth.js renderIdentity「其他」分支）：输入在校班号即出现「⚠️ 检测到这是在校班级（范围），请在年级中选择」+ **一键「切换到高一/高二/高三」**按钮（点击即切年级下拉并重渲染）；
  2. 前端提交拦截（`checkOtherClass` 新增 `inSchoolClassOf` 判断）：提示「「2401」是在校高三班级，请返回选择「高三」」；
  3. **后端硬校验**（routes/auth.js 访客登记 + routes/auth-qq.js bind）：`config.isStandardClass(class_name)` 命中即 400「「2401」是在校高三班级，请返回选择对应年级」。
- **边界**：`gradeOf` 按前缀判断（26→高一/25→高二/24→高三）；2600、2625、2312、9999、0 等非标准范围班级仍走「其他」放行（毕业班号无法穷举，仅挡当前在校班号）。
- 复用：`config.isStandardClass` + `gradeOf`；前端 `GRADE_RANGES` 与 config 对齐（改班级范围需同步两处）。

### 13.15 毕业班合法班号规则（2026-08-20 用户提供）+ 在校班引导修正

- **毕业班合法班号**（「其他」分支，后端 routes/auth.js + auth-qq.js）：格式 4 位 `YYCC`（前两位年级、后两位班号）或 `0`（外校）；3/2/1 位（除 0）非法。规则：
  - 年级 ≤20 → 班号 01-18（2001~2018…，含 19xx 及更早）
  - 21 → 01-20（2101~2120）；22 → 01-22（2201~2222）；23 → 01-20（2301~2320）
  - 年级 >26 非法；其余非法 → 400「不是合法的毕业班班级号」
- **⚠️ 关键认知（踩过）**：后端**没有年级参数**，`isStandard` 完全由 class_name 推导（`normalizeClass`+`isStandardClass`）。因此：
  1. 在校班号（24xx/25xx/26xx）**永远不会进「其他」分支**——后端直接按标准年级接受（本就是合法在校班，语义正确）。此前加的"在校班号不允许走其他"后端校验是**恒假死代码**（`!isStandard && isStandardClass(class_name)` 永假），已删除。
  2. "选「其他」误填在校班号 → 引导选年级"**只能在前端实现**（前端才有"选了其他"的显式状态）：黄色提示条 + 一键切换年级 + 提交拦截（auth.js `checkOtherClass` → `inSchoolClassOf`）。前端还加了红色实时提示「不是合法的毕业班班级号」（`isValidGraduateClass`）。
- **边界**：2120 现按规则**合法**（21级20班，用户修正 2101~2120）；0000 非法（grade 0）；0101-0118 合法（年级≤20 规则）。
- **改动班级范围需同步**：config.js（标准班）+ 前端 `GRADE_RANGES`/`isValidGraduateClass` + 后端两处 maxCls 规则。

### 13.16 「其他」年级身份逻辑与在校生统一（2026-08-20 用户最终拍板）

- **背景**：用户先要求"一个姓名/昵称框+去掉授权单选"，随后撤回（"前面的当我没说，昵称还是别让他们自由填写了，太乱"），最终拍板：**所有年级（含「其他」毕业生/外校）与在校生表单逻辑完全一致**。
- **改动**：
  1. 前端 auth.js renderIdentity「其他」分支姓名框 = 与标准年级相同：**姓名必填 2-4 汉字**，placeholder「请输入真实姓名（2-4 个汉字）」；删除「姓名(或昵称)/选填/可留空」及"不填姓名则展示默认名"提示。
  2. 两处提交校验 `v.grade !== '其他' && !v.real_name` → `!v.real_name`（所有年级必填）。
  3. 后端 routes/auth.js（访客登记）与 auth-qq.js（bind）：`isStandard && !real_name` → `!real_name`；**删除 `real_name = '同学'` / `= s.nickname || '同学'` 回落逻辑**（「其他」不再可留空）。
- **保留**：「是否授权展示真实姓名」单选 + 昵称=姓名拼音首字母（方案二，选定后不可更改）；「其他」班级的在校班引导（前端）与毕业班合法班号校验（前端+后端，§13.14/13.15）。
- **注意**：§13.13 中"「其他」姓名可留空/回落 QQ 昵称"的描述已被本节取代（以本节为准）。

### 13.17 排行榜"同学"问题修复 + 个例昵称修正（2026-08-20）

- **现象**：排行榜出现"同学"（真实用户 2505 肖熙桐、2506 黄俊宇）。
- **根因**：P1 隐私规则（非同班只显示昵称、无昵称兜底"同学"）+ 方案二缺口——昵称只在选「否，只展示昵称」时生成，选「是」的用户 nickname 恒 NULL，非同班查看者即显示"同学"。
- **修复（逻辑改动，本次唯一一次）**：
  1. 后端 `routes/auth.js`（访客登记）+ `auth-qq.js`（bind）：`showReal` 且 nickname 为空时自动用 `pinyinCandidates(real_name)` 取**首个候选**作兜底昵称存入（选「是」也生成昵称）。
  2. 前端 `auth.js` renderIdentity：输入姓名**总是**刷新拼音缩写（`refreshInitials` 不再仅限选「否」时）；`utils.js` `initialsPicker` 新增 `autoFirst` 参数（是：自动选首个候选，不展示候选区；否：展示候选区手选）。
  3. 回填存量 NULL 昵称用户（脚本一次性执行）：肖熙桐→XXD、黄俊宇→HDY。
- **个例修正（2026-08-20，用户指定，逻辑不动）**：黄俊宇昵称 **HDY → HJY**（SQL 直改，`UPDATE users SET nickname='HJY' WHERE id=6`）。肖熙桐的 XXD 保留（首个候选）——多音字默认取首个候选是设计行为，用户如需其他读音可在注册时选「否」手选。
- **注意**：自动兜底昵称也受"选定后不可更改"约束（PATCH profile 锁已有合法缩写）；后续如需调整某用户昵称，直接 SQL 改即可（与本次个例相同）。

### 13.18 最高管理员权限（2026-08-20）

- **需求**：仅「2120班 戴睿羲」可设置/取消其他管理员（最高管理员）；其余管理员除不能调整管理员权限外，其他权限不变。
- **实现**：
  1. `server/config.js` 新增 `superAdmin: { class_name: '2120', real_name: '戴睿羲' }`（env `SUPER_ADMIN_CLASS`/`SUPER_ADMIN_NAME` 可覆盖；按 (class_name, real_name) 唯一身份识别）。
  2. 后端 `routes/admin.js` `POST /api/admin/users/:id/admin` 开头守卫：非超管 → 403「仅最高管理员可设置/取消管理员权限」。
  3. 前端 `admin.js`：`isSuperAdmin`（与 config 同步的硬编码）非真时不渲染「设为/取消管理员」按钮（仅隐藏按钮，后端 403 才是硬保障）。
- **保留不变**：`ADMIN_QQ_TINY_IDS` 白名单自动授权（maybeGrantAdmin，部署层配置）；其余管理接口对所有管理员开放。
- **实测**：胡誉腾（非超管）调授权接口 403 ✓；戴睿羲（超管）设/取消谭一凡管理员均 200 ✓（测试后已恢复谭一凡为非管理员）。
- **注意**：改最高管理员身份需同步 `config.js`（或 env）与前端 `admin.js` 的 `isSuperAdmin` 两处。

### 13.19 三轮安全修复（2026-08-21，安全复审 P0-P2 全部落地）

> 涉及两个仓库：PatPlayer（`Dc-D666/pat-collector`）与 NFTI（`Dc-D666/NF-BTI`）；NFTI 侧已同步并重建容器。

**P0 账号接管（已修）**
- NFTI ticket 不再携带 QQ 会话 ID（pat_sid，base64 可解码 + 曾可被 `/api/auth/qq/bind` 直接换 token）→ 改为一次性授权码 + `POST /api/learn/nfti-session-grant` 服务端换发；`/init` 增加 `bind_secret`（仅发起登录的浏览器持有），`/poll`/`/bind` 必须携带。
- **NFTI 侧必须同步**（已同步+部署）：`verifyPatTicket` 校验 `sid` 授权码、`exchangePatSession` 换发；docker-compose 需 `PAT_BASE_URL`；两边 `PAT_TICKET_SECRET` 必须一致（.env 与 docker-compose 已核对一致）。

**P1（已修）**
- 频道兑换两阶段化（先扣分写 pending → CLI → 结算/退款）；有效期用 `durationMs`；jobs 到期回收补 `feed_extra` + 失败重试；pending 悬空按外部状态处理（不盲目退款）。
- 访客上传在 multer 落盘前校验 `x-guest-token`（前端已改请求头）；nginx 加上传限速（`deploy/0.pat-upload-limits.conf`，10r/s burst 20 + 并发 4）。
- 重复文件上传：事务阶段清理落盘文件并返回 409（不再留孤儿文件 + 500）。
- 审核（单条/批量/改状态）：状态变更与积分回扣/恢复同事务；恢复积分按原发放流水金额（不再硬编码 30、不重复乘活动倍率）。
- 作品墙/总览/下载/预览：仅 `reviewed` 文件公开（pending/flagged 仅所有者可见）；排除停用用户。
- 未验证 GitHub 链接禁止点赞；点赞接口复用作品墙可见性（文件 reviewed + 用户 active + 链接 verified）。
- 商城开关 `settings.shop_enabled` 后端强制。
- QQ 绑定访客身份：事务 + 行锁 + `WHERE qq_tiny_id IS NULL` 条件更新（并发双绑第二个 409）。
- 最高管理员保护：调分/停用/删除/重置密码/权限变更一律禁止作用于 `config.superAdmin`。
- 删除（文件/应用/GitHub/访客/审核/用户）与积分回扣同事务；删除作品/用户时作废关联商城购买并尽力撤销频道操作（`utils/channelOps.js`）。
- 访客已有账号取回 token 必须验证安全密码；未设密码则拒绝自助找回（防「班级+姓名」冒名接管）。

**P2（已修）**
- `/api/points/task` 拒绝 quiz 类型（防绕过 `/quiz` 冷却）。
- VirusTotal 12h 熔断时间判断修复（原 `Date.now() < quotaExhaustedAt` 恒假，熔断从未生效——ClamAV 移除改造遗留）。
- 评委评审与积分差额发放同事务（锁评审行+用户行，防并发重复/失败漏发）。
- HTML 预览挂 `requireAuth`（停用/删除用户 token 过期前无法预览）；下载/预览非 reviewed 仅本人。
- 删除/停用用户立即清理 QQ 会话目录。
- 提交应用/访客注册/QQ 首次绑定：积分发放与业务记录同事务（`grantInTx`，防永久漏发）。
- CDN（jsDelivr）验证按内容匹配决定是否回退 raw 源；Fork 检测 API 不可达时暂缓验证（503 fail-closed）。
- 全站安全响应头（nosniff / X-Frame-Options DENY / no-referrer / Permissions-Policy / HSTS）。
- 内测清理脚本 `scripts/clear-beta-data.js` 同步清空 `storage/uploads` 与 `storage/qq-sessions`。

**遗留已知边界（见 §11）**：视频/纯自报任务无服务端核验（当前章节无此类）；Fork 检测 API 故障时新验证暂缓；NFTI 换发依赖 PAT 在线；访客未设密码无法自助找回地址。

### 13.20 GitHub 项目 OAuth 重构 + 相关修复（2026-08-21）

**背景**：原「仓库根目录放 nanfang-pat.txt 文件」所有权验证体验差（建文件/等 CDN/必须公开），且手填链接防冒充弱。改为 **GitHub OAuth 授权验证**。

- **链路**：`GET /api/github/oauth/start`（生成 state，10 分钟一次性，防 CSRF）→ 弹窗跳 github.com 授权 → `/api/github/oauth/callback`（code 换 access_token → `GET /api/github/user` 取身份 → 绑定 `users.github_uid/github_login`）→ **access_token 用 `TOKEN_SECRET` 派生密钥 AES-256-GCM 加密落库**（`github_token_enc`，含篡改检测），不下发前端；`/status` 查连接、`/disconnect` 断开。新文件 `server/routes/github-oauth.js`，`index.js` 挂 `/api/github`；`users` 表新增三列（schema.sql + init-db.js 存量迁移）。
- **验证**：`POST /api/links/:id/verify` 带用户 token 调 `GET /repos/{owner}/{repo}`——200 + **owner.id == github_uid** + 非 Fork → 通过；401/403（授权失效）/404/网络异常（503 fail-closed）分别提示。`links.js` 删除了整条文件校验路径（fetchRepoToken/fetchText/getRepoMeta）。Fork 检测并入同一响应，不再单独调 API。
- **只选不填（用户拍板）**：提交表单**移除手填链接输入框**，只能从下拉选择本人仓库（`GET /api/github/repos`：`affiliation=owner`、分页 100×3、过滤非 Fork）。**公开可选、私有置灰带 🔒 不可选**——为此 **OAuth scope 默认从 `public_repo` 改为 `repo`**（public_repo 下 GitHub API 根本不返回私有仓库）；`X-OAuth-Scopes` 检测旧授权 → 响应 `scope_limited:true`，前端提示"断开后重新授权"（**存量用户必须重授权一次才能看到私有项目**）。未连接 GitHub 时整个表单置灰禁用。
- **AI 自动生成（用户拍板）**：`POST /api/github/describe` 选仓库后自动拉 README 原文（`Accept: application/vnd.github.raw+json`，截 8000 字）→ 智谱 GLM 生成名称（≤12 字）+ 80~120 字简介，自动填入可修改。模型默认 **`glm-4.7-flash`**（最新免费档，实测 429 繁忙），**繁忙自动回退 `glm-4-flash`**（`GLM_FALLBACK_MODEL`）；未配 `GLM_API_KEY`/无 README 降级用仓库名/描述（generated:false）。归属校验前置（防当任意 README+GLM 代理刷额度）。前端 `autoDescribe` 带竞态保护（快速切换仓库丢弃过期结果）。
- **部署注意**：`.env` 已配 `GITHUB_OAUTH_CLIENT_ID/SECRET`（回调 `https://pat.weaxi.cn/api/github/oauth/callback`）与 `GLM_API_KEY`（智谱 `9bea...`，生产 `.env` 不入库）；`GLM_MODEL=glm-4.7-flash`。**存量用户需断开后重新授权（repo scope）**。

**同期修复（同 commit）**
- 第2章实操任务：完成条件改为「发帖 + 本站投稿记录」**双条件**（`taskVerify.js` 原只查 posted，只发帖即可过关；前端 `initAppTask` 同步）——与文档既定口径一致。
- `feed_links.py`：轻应用识别只保留 `pd.qq.com/launch_app/` 链接（原把所有 urlContent 链接都当轻应用，B站/GitHub/分享链误识别）。
- 活动简介页新增社团引导横幅（芥末金，链接 itex.zznfzx.com），**仅 `#/activity` 显示**（body.route-activity 标记 + 条件布局偏移），移除站内「👋 社团简介」卡片。
- 我的积分页：顶栏积分徽章与页面余额同步（徽章读 localStorage 缓存，页面读服务端，被赞/后台调分后曾不一致）。
- QQ 授权绑定表单：修复慢网络下偶现「年级选不了」——表单渲染原被 `await loadGrades()` 阻塞，改为**立即渲染（兜底年级数据）+ 后台刷新班级选项**（`renderIdentity` 返回 `{getValues, refresh}`）；访客直传表单同款修复。

## 14. 2026-08-21/22 移动端兼容与 UI 升级（本 session）

> 本 session 主题：**QQ 内置浏览器（MQQBrowser/X5·TBS）全链路兼容修复 + TDesign 图标替换 + 若干功能增强**。全部改动已提交：`cfd77fb`（表单兼容+排行+作品墙）→ `d26891e`（TDesign 图标）→ `b473f95`（竖排）→ `cd5228f`（积分统一）→ `de3197a`（GitHub OAuth 移动端）→ `cce0df6`（漏斗图标）→ `8b65147`（选做章）→ `0390764`（过滤停用用户）。

### 14.1 QQ 登录表单兼容：自研下拉 + 聚焦增强（重要，勿再走原生 select 老路）

- **现象**：用户「好累啊」（荣耀 CMA-AN00 / Android 11 / QQ 内置浏览器）反馈**年级下拉点不动**；日志还原：5 次扫码 4 次授权成功（poll authorized），但**从不 bind**（0 次 bind 请求、0 次 pinyin-candidates 请求）→ 卡在绑定表单。
- **根因排查（三轮修正，勿再犯）**：
  1. ❌ 「QQ 内置浏览器整体兼容问题」——**推翻**：28 个成功绑定会话里 16 个就是 MQQBrowser（`index.json` 反查 init UA 验证）。
  2. ❌ 「QQ 9.2.66 特定版本 bug」——**推翻**：用户升级到 9.3.35 后（nginx 日志 UA 确认 `QQ/9.3.35.39800`）姓名 input 依然填不了。
  3. ✅ **结论：特定设备（荣耀 Magic UI / Android 11）的 QQ 内置浏览器里，原生表单控件（select/input/radio）无法获得输入焦点**（点击/触摸事件正常——纯 div/button 可点，见 customSelect 能用），而 16 个成功 QQ 内置用户用的是其他机型/系统版本。这是 webview 层焦点/键盘 bug，**页面代码无法根治，只能规避 + 引导**。
- **修复（已上线）**：
  - `Utils.customSelect(wrap, opts)`（utils.js）：**纯 div 下拉组件**替代原生 `<select>`（年级/班级），任何 webview 可用；API：`getValue/setValue/setOptions/close`，实例挂 `wrap.__cs`；互斥展开 + 点击外部收起 + 列表 max-height 滚动。**教训：QQ/微信内置浏览器一律不要再依赖原生 select**。
  - `ensureInputFocusable(inputEl)`（auth.js）：姓名/班级 input 绑定 touchstart/click 强制 focus（blur→focus 重激活技巧），尽力唤醒输入法；`IS_QQ_WEBVIEW` 检测到 MQQBrowser 时表单顶部显示黄色提示条「点右上角 ··· 选『在浏览器中打开』」。
  - **注意**：聚焦增强只是尽力而为，该设备可能仍无法输入——终极兜底是引导换系统浏览器。

### 14.2 HTML 预览兼容：blob URL → srcdoc（X5 内核限制）

- **现象**：预览在电脑正常，QQ 内置浏览器打不开（空白）。
- **根因**：preview.html 原用 `iframe.src = URL.createObjectURL(blob)` 注入上传 HTML；**Android X5/TBS 内核对 iframe 加载 blob: URL 支持不佳**。
- **修复**：改 **`iframe.srcdoc = html`**（HTML5 标准，不依赖 blob；DOM property 赋值**不要做实体转义**，字符串原样按 HTML 解析——转义反而会把 `&` 显示成 `&amp;`）；sandbox="allow-scripts"（无 allow-same-origin）语义不变，上传内容仍 unique origin，令牌无外传路径；极老内核回退 blob。三处预览链接（class-wall/project/admin）加 `?v=2` 防 webview 缓存旧版。

### 14.3 GitHub OAuth 移动端：整页跳转替代弹窗 + postMessage

- **现象**：GitHub 授权电脑能完成，手机（QQ/微信内置浏览器）完不成。
- **根因**：OAuth 流程依赖「弹窗 + `window.opener.postMessage`」——移动 webview 无可靠弹窗模型（`window.open` 返回 null/异常），整页跳转后回调无 opener → 主页面收不到结果。
- **修复**：① 前端 `connectGithub()` 检测移动端 UA（Android/iPhone/MQQBrowser/MicroMessenger/Mobile）→ **整页跳转** GitHub；② 后端 callback 统一 302 到**新结果页 `public/gh-oauth-result.html`**（ok/msg 参数）；③ 结果页**双模式**：有 opener（桌面弹窗）→ postMessage 通知 + 自动关闭（行为不变）；无 opener（手机整页）→ 显示结果 + 自动跳回 `/#/files`（我的项目页加载自动刷新连接状态）。msg 用 textContent 防 XSS。

### 14.4 积分年级/班级统计榜（新接口）

- `GET /api/points/class-stats`（requireAuth）：**在校口径**（`qq_tiny_id IS NOT NULL AND status='active' AND class_name IN (config.classes)`，外校/毕业生天然排除）→ 年级榜固定 3 个（高一/高二/高三，按总积分排序，含人数/人均/班级数）+ 班级榜按总积分 **TOP5**。
- 前端「我的积分」页新增「🏅 年级 · 班级排行」卡片（全校排行榜卡片下方）。
- **注意 mysql2 返回类型**：`SUM()` 可能是字符串，统一 `Number()` 转换。

### 14.5 作品墙增强 + 布局修复

- **「仅看本班」筛选**（class-wall.js）：`onlyMyClass` 状态 + `.wall-filter-btn`（TDesign filter 漏斗图标，`margin-left:auto` 靠右），与搜索/排序/置顶叠加；副标题切换计数。
- **布局修复（窄容器溢出）**：`.proj-foot` 加 `flex-wrap: wrap` + `.proj-time` 加 `min-width:0; word-break:break-all` + `.file-actions` 加 `margin-left:auto`（按钮固定右下角）；`.wall-grid` 改 `minmax(min(320px,100%), 1fr)` 防窄视口横向溢出。
- **文件列表按钮竖排**（我的项目页）：`#file-list .file-row > .file-actions { flex-direction: column }`——**只作用于文件列表**，不影响作品墙等其他 `.file-actions`。

### 14.6 TDesign 图标替换（emoji → 内联 SVG，零依赖）

- 新增 **`public/js/icons.js`**：从 `@iconify-icons/tdesign` 提取 **64 个 TDesign 图标 SVG**（MIT，`stroke="currentColor"` 可随文字着色），`Icons.icon(name, size)` 返回 `<svg>`；index.html 在 utils.js 后引入。
- 替换 **~110 处结构性 UI 图标**：导航栏、各页页头、按钮（下载/预览/点赞/上传/核验/复制…）、文件类型图标（getFileIcon 改返回 `{icon, color}`，image/video/music/file/chart-bar/book/folder/code/app）。
- **toast 支持 HTML**：`toast(msg, {html:true})` 渲染受信 HTML（默认仍 textContent 防注入）——积分/状态 toast 可带图标。
- **积分单位统一**：全站 ⭐ emoji 清除 → star-filled SVG；**纯文本场景（select option、title 属性）无法渲染 SVG，用「积分」文字**。
- **保留 emoji（合理）**：`✓/✅/❌` 任务状态文本、`🥇🥈🥉` 奖牌（TDesign 无 trophy/medal）、`→` 文本箭头、正文内容 emoji。
- **新增图标流程**：`npm pack @iconify-icons/tdesign` → `/tmp/tds/package/data/<首字母>/<name>.js`（`const data = {...}` 提取 body）→ 插入 icons.js `BODIES`。**改完必须复查**：所有 `Icons.icon('...')` 引用在 BODIES 中都有定义（脚本核对），否则渲染空白。

### 14.7 其他改动

- **AI 小学堂第 4 章选做**：`learn.js` 模块级 `OPTIONAL_CHAPTERS = new Set([4])`（与 seed 章节结构对应，改章节需同步），章节列表 + 文章页显示琥珀色「选做」标签（`.optional-tag`）；seed-articles.js 第 4 章 content 开头加「不要求实际操作，阅读了解即可」+ summary 前缀【选做】（已重跑入库，id/进度保留）。**注意**：选做=实操选做，quiz 仍须完成 → 毕业判定不受影响。
- **排行榜/统计榜过滤停用用户**：`leaderboard`（list + 我的排名）与 `class-stats` SQL 加 `AND status='active'`（用户「NKT」停用后仍在榜的问题）；管理后台 TOP50 保留停用用户（管理视角）。
- **点赞积分上限排查结论**（like:15 无 like_give 记录）：`grantCapped` like_give 每日 10⭐ 上限（5 次赞满），超限**静默跳过不写流水**（返回 0）——「看不到记录」是设计行为非 bug；like_receive 独立上限 20⭐/天不受影响。
- **管理后台调分确认**：加分走 `grant()` ×1.2（窗口内），**扣分走独立事务直扣不乘**（`bonusAmount` 负数返回原值）；扣分不低于 0（`Math.min(balance, -amount)`）。

### 14.8 本 session 新踩的坑（务必看）

54. **QQ/微信内置浏览器不要用原生 `<select>` 和依赖 focus 的表单控件**：X5 内核上可能点不动/无法聚焦（具体见 §14.1）；自研 div 下拉 + 强制 focus workaround 是通用解法。
55. **iframe 加载 blob: URL 在 X5 内核不可靠** → 用 `srcdoc`（DOM property 赋值**不要**实体转义）。
56. **移动 webview 无弹窗模型**：`window.open` 返回值不可靠，OAuth 用整页跳转 + 回调回跳；结果页按 `window.opener` 是否存在分派双模式。
57. **批量替换模板字符串里的 emoji 时小心引号**：单引号字符串（`'...'`）内不能嵌 `Icons.icon('x', n)` 的单引号——用双引号或拆成 `+ Icons.icon(...) +` 拼接（本 session 在 points.js 踩过一次，`node --check` 抓出）。
58. **`.top-badge` 等非 flex 徽标放 SVG**：inline SVG 与文字会贴紧，需 `display:inline-flex; gap:4px`。
59. **CSS 作用域**：`.file-actions` 被多处复用（作品墙/文件列表/app/links）——改局部布局用 `#file-list .file-row >` 前缀限定，勿全局改。
60. **`SUM()` 在 mysql2 下可能返回字符串**：聚合后统一 `Number()`。

### 14.9 待办 / 风险更新

- **「好累啊」设备（荣耀 CMA-AN00/Android 11 + QQ 内置浏览器）焦点 bug 未根治**：customSelect/聚焦增强已尽力，需真机复测；不行则引导换系统浏览器（提示条已加）。
- **GitHub OAuth 移动端链路需真人验证一次**：手机整页授权 → 回调结果页 → 自动回 /#/files → 状态刷新。
- **emoji→TDesign 替换后有约 140 处 emoji 保留**（⭐ 已清除；✓/✅/❌/🥇🥈🥉/→/toast 部分）——如需继续替换，注意 toast/option/title 不支持 SVG。
- **第 4 章选做标记是前端硬编码 `OPTIONAL_CHAPTERS=[4]`**：将来新增/调整选做章需同步 learn.js + seed-articles.js 两处。

## 15. 2026-08-25 AI 轻应用改版：站内一句话生成 + 创作槽（本 session）

### 15.1 背景与结论
- **导火索**：腾讯频道下架轻应用创建功能 → 原第2章实操（appcheck）失效。
- **方案文档**：`AI-SCHOOL-RESTRUCTURE-PLAN.md`（注意其中决策 D3「gen 不发分」**已被用户推翻**，现行口径见 15.3）。
- **术语（用户拍板）**：**AI 轻应用**=站内一句话生成的作品；**频道轻应用**=QQ 频道原版生成的（识别投稿入口保留，位于 AI 轻应用 Tab 底部，只改名没动功能）。两者计分**完全等价**。

### 15.2 新功能：站内一句话生成小程序
- **端点**（`server/routes/gen.js`，挂 `/api/gen`）：
  - `POST /app/stream`：SSE 流式生成（事件 `start`/`delta{reasoning}`/`done{draft_token,html,slot_no,version_seq}`/`error{code}`）。限流+全局并发≤3+kill-switch `settings.genapp_enabled`。
  - `POST /commit`：草稿落库 `files(source='gen')`，发 `app_submit`（与频道轻应用共享 3 个名额）；删除/审核拒绝/误拒补发全链路对齐（files.js、admin.js、points.js 的 restoreAppSubmitInTx）。
  - `GET /preview/:draft_token`、`/version-preview/:vtoken`：**凭自证令牌、无 Bearer**（iframe 原生导航带不了 Authorization 头！）。X-Frame-Options 覆盖全局 DENY 为 SAMEORIGIN。
  - `GET /slots`、`GET /version/:id/token`、`POST /slots/:no/clear`、`GET /quota`：创作槽与次数。
- **模型选择**（`utils/genApp.js` GEN_MODELS 白名单）：glm47 走智谱官方；glm52/gemma4/nemotron35/nemotronultra/dots3note/inkling 走 OpenRouter（`.env` OPENROUTER_API_KEY）。免费池上游 429 → 前端显著提醒「该模型暂不可用，请更换模型」（不静默回退，用户拍板）。**inkling 需带 coding-agent User-Agent**（OpenRouter 按客户端类型拦截，实测 claude-cli UA 可用）。
- **思考模式**：GLM 4.7 显式开启；思考走 `delta.reasoning_content`，正文走 `delta.content`，前端分流展示、正文首片段清空思考。Nemotron 3.5 是**内联思考**（混在 content 里），前端已归一化（`<html` 出现前视为前置说明）。
- **max_tokens=32000**、超时 240s（nginx `proxy_read_timeout 300s` 已覆盖，无需改）。
- **创作槽**：每用户 5 槽（gen_slots/gen_versions 表），槽内版本链+对话记录；**服务端按槽取上一版做改进模式上下文（跨会话生效）**；prompt 顺序=代码在前、修改意见在最后（反序会被模型无视导致另起炉灶——实测踩坑）。未提交版本不占作品配额，7 天未动自动清理（jobs.js）。
- **前端**（dashboard.js initGenApp，v90）：槽胶囊（从未使用则隐藏）、流式 log（等待期动态计时）、内嵌预览 360px（弃弹窗）、标题+双按钮一行、对话记录折叠时间线+历史版本只读回看+清空槽。
- **测试期间不限次**：`GENAPP_DISABLE_DAILY_LIMIT=1`（默认开）。正式运营设 `0` 恢复，前端自动切回「今天还可生成 N/10 次」。

### 15.3 计分等价口径（取代方案 D3，用户拍板）
生成作品与频道轻应用**完全等价**：提交发 `app_submit` +15（共享每人 3 个名额）；用户删除、后台审核拒绝都回扣；审核误拒后通过会按原额补发（`restoreAppSubmitInTx`）。名额不释放（防刷分）。第2章 `genappcheck` 整章 +15 与作品计分互不影响。×1.2 加成是硬编码时间窗（8/20~24）已过期。

### 15.4 教程改版（已执行上线）
- 第2章实操改 `genappcheck`（核验 files.source='gen'，不限时间窗）；第3章 projectcheck **排除 gen 来源**；第4章 slug `ai-deploy→ai-project`（纯 3 道题）。
- （§15.8 二次更新：第3章 projectcheck 现已计入 verified GitHub 项目，与文件上传任一即通过。）
- **seed 内置幂等改名**（`UPDATE slug='ai-project' WHERE slug='ai-deploy'` 在 upsert 前执行）——忘跑迁移 SQL 也不会丢进度。`scripts/migrate-2026-08-25-ai-school.sql` 仍保留作部署记录。

### 15.5 本 session 踩坑（重要）
1. **iframe 无法携带 Bearer 头**：预览端点最初要求登录，iframe 加载必 401 → 被 X-Frame-Options DENY 拦成「拒绝连接」。解法=自证令牌（HMAC 绑 uid+30min）。
2. **全局 X-Frame-Options: DENY**（index.js R2-15）会拦截自家预览 iframe，子端点需单独覆盖 SAMEORIGIN。
3. **`var`/`let` 作用域连环坑**：draftToken 声明在 onclick 内、弹窗按钮引用报 ReferenceError（按钮"无响应"）；waitTimer 用 var 但赋值在声明后被覆盖（计时器永不停止）。**教训：跨闭包引用的状态一律声明在 initGenApp 顶层。**
4. **批量 python 编辑被整体拒绝时，部分修改可能已丢失**——曾导致 prevHtml 参数漏加（改进模式 500）、重复 catch（服务起不来全站 502）。**每次改路由文件必须 `node --check` 后再 pm2 restart。**
5. **OpenRouter :free 模型共享池高峰期上游 429 频繁**；GLM 官方免费档也会排队（首 token 可能等 30s+，极端卡死 150s+）。
6. **模型输出无 `</body>` 闭合**会导致 extractHtml 误判——已放宽为只要求 `<html…</html>`。
7. **前端文字与后端规则要对齐**：学AI 任务提示"20⭐"实为 15⭐（P3 遗留）；活动页 FAQ 还在引导"频道 AI 轻应用"——本次已修，新增文案时注意。

### 15.6 待办
- [ ] 正式运营：`GENAPP_DISABLE_DAILY_LIMIT=0` 恢复限次。
- [ ] 录制第2章新演示素材（旧 videos/ch2-create-app.mp4 已从教程移除引用）。
- [ ] OpenRouter 免费池限流严重时考虑 BYOK（自己的上游 key）。
- [ ] 频道轻应用识别入口建议加提示"腾讯已停止轻应用创建，此页保留历史作品"（方案 §6.3，未做）。

### 15.7 UI 定稿与补充踩坑（同 session 后半，多轮视觉走查后）
- **术语定稿**：「AI 轻应用」=站内一句话生成（主入口，卡片在上方）；「频道轻应用」=QQ 频道原版识别投稿（底部，仅改名未动功能）。新写文案必须用这套词，不要再说"频道里的 AI 轻应用"。
- **gen-app-card 内部顺序定稿（v93）**：标题行（含动态次数）→ 槽胶囊行（从未使用则整行隐藏）→ 一句描述 → idea 输入框 → 「选择模型」行（select + 圆形?帮助图标，点击弹"参数量大=能力强但可靠性/速度略降"引导）→ 「✨ 开始生成」整行按钮 → 错误条 → 流式 log → 💬对话记录折叠区（含清空此槽）→ 📺内嵌预览 360px（标题+重新生成+提交一行）。
- **「我的 AI 轻应用」是独立兄弟卡**（gen-app-card 与 频道轻应用卡 之间），列已提交的 source='gen' 作品（预览/删除）；项目文件列表已过滤掉 source='gen'。
- **踩坑（同类第 8 条，务必记住）**：对 dashboard.js 这类长模板串做大段增删时——①锚点选错会把整张卡嵌进另一张卡内部（"我的AI轻应用"曾嵌进 gen-app-card）；②清理残留时边界切多会误删相邻块（对话记录折叠区曾被连根删掉，JS 引用还在所以不报错、入口凭空消失）；③重复块（旧 preview）残留会产生重复 id。**铁律：改前 grep 确认锚点唯一，改后再 grep 数块数、核对嵌套层级。**
- **前端缓存**：dashboard.js/learn.js 等每次改动必须递增 index.html 里的 `?v=N`（微信/QQ 内置浏览器缓存极顽固），本 session 已递增到 dashboard v93。

### 15.8 同 session 追加改动（生成预检层 + 作品展图标 + 第3章任务放宽）

1. **「一句话生成」请求预检层（audit.js + routes/gen.js）**：
   - 生成前先调 DeepSeek（deepseek-v4-flash，复用 DEEPSEEK_API_KEY）做两项判定：`is_app_request`（是否为应用生成式命令——"你好"等闲聊拒）、`safe`（提示词合规性）。合规才放行给生成模型。
   - 新增 `reviewGenRequest()` / `auditGenIdea()`（audit.js）；`/api/gen/app` 与 `/app/stream` 在**占用并发信号量之前**预检，被拒不消耗资源。
   - 拒绝文案分两类：`not_app`（闲聊/无关请求）与 `unsafe`（违规内容）；流式接口预检放在 writeHead 之前，失败走普通 JSON 400（前端 `!res.ok` 分支天然兼容，无需改前端）。
   - 被拒请求落 audit_logs（kind='gen_precheck'）可追溯；尊重 DEEPSEEK_AUDIT + settings.audit_enabled 开关；AI 不可用降级放行（与其它审查一致）。
2. **全校作品展轻应用图标统一**：站内生成作品（source='gen' 的 .html 文件）在作品展原来按扩展名显示 `code` 图标（闪电括号），与「我的项目」页的 `app` 四宫格不一致。修复：wall SQL 增查 `f.source` 并透传；class-wall.js 对 source==='gen' 改用 `{icon:'app', color:'#EDE6D6'}`。频道轻应用仍是 robot 图标。
3. **第3章 projectcheck 放宽：文件上传或 GitHub 项目任一即通过**：
   - `getProjectSubmitted()`（learnStatus.js）新增并行查询 `links` 表：`verified=1 AND created_at >= NOW()-INTERVAL 14 DAY` 与原 files 条件（排除 gen、14 天窗）互为替代，返回值增 `link_count`。
   - taskVerify.js 错误文案同步更新；前端 learn.js 提示语更新；seed-articles.js 任务标题/desc 更新，且已直接改库（articles id=25 ai-real-app，库为准 seed 仅种子）。
   - 注意：GitHub 外链积分 +25（github_link）与本任务核验是两回事，互不影响。
4. **缓存版本号**：class-wall.js → v65、learn.js → v72（index.html），微信/QQ 内置浏览器缓存极顽固，改前端必须递增。

### 15.9 改动审查发现的三个 bug（已修复，教训记录）
§15.8 的改动上线后复查发现：最初一次「三段编辑」因第三段锚点在原文件中出现两次被整体拒绝，导致只有补发的流式路由段生效，**前两段（import 行、/app 路由预检）从未落盘**：
1. `auditGenIdea` 没进 import → 运行时 `ReferenceError`（`node --check` 查不出运行时标识符，服务能启动、正常生成不受影响，唯独预检拒绝路径才炸成 500）
2. `/app` 非流式路由漏接预检（可绕过）
3. 审计 reason 未按列宽截断：audit_logs.reason VARCHAR(200)，拼接前缀后可超长；本机 sql_mode 含 STRICT_TRANS_TABLES 会插入报错并被空 catch 吞掉（审计静默丢失）

修复：import 补全、/app 接入预检、reason `.slice(0, 200)`。已用真实 HMAC 令牌对两个路由做端到端验证（闲聊→400 not_app 文案正确；正常需求→放行生成）。
**铁律重申（同类第 9 条）：多段编辑被整体拒绝时，绝不能假设"部分生效"，必须逐段 grep 复核每一段是否落盘；改完路由除了 `node --check`，还要用真实请求打一遍新分支（尤其错误分支）。**

## 16. 2026-08-27 本 session：AI 轻应用独立页 `#/gen` + DeepSeek 官方切换 + 多轮 UI 迭代

### 16.1 背景
第 15 节的「一句话生成小程序」原本嵌在「我的项目」页（dashboard.js `Views.files` 的 gen-app-card 卡）。本 session 用户要求把它做成**独立页面**，并对零基础高中生重做体验；同时把生成模型从「山东大学智创模型广场（xplt）」切换为 DeepSeek 官方 API，并解决 DeepSeek 思考超时。

### 16.2 独立页 `#/gen`（路由 + 全新视图）
- 新增 `public/js/gen.js`：`Views.gen()`，独立页。`index.html` 引入，`app.js` 注册 `gen` 路由；`nav.js` currentKey 加 `#/gen` 返回 'gen'（不进主导航，任何项不高亮）。
- dashboard.js **删掉**原 gen-app-card 的创作区 + gen-myworks 卡 + `initGenApp`/`renderGenWorks`，原位置替换为**引导入口卡**（标题 + 「进入 AI 轻应用」按钮跳 `#/gen`）。`loadFiles` 仍过滤 `source==='gen'`（gen 作品归独立页，不混入项目文件列表）。
- 入口：我的项目 Tab2 顶部引导卡；`#/gen` 页头「← 返回我的项目」。learn.js 第2章引导文案同步改「我的项目 → ✨ AI 轻应用」。

### 16.3 主流程与多轮 UI 迭代（面向零基础）
用户多轮反馈「换汤不换药」「看不懂作品槽」「太啰嗦」后，最终定稿为一套**正向主流程**：
- **三步 step 指示器**：① 描述想法 → ② AI 创作 → ③ 拿走你的作品；顶部高亮当前步，已完成步打勾。`setStep(n)` 控制 `.gen-step`/`.gen-phase`。
- **Step1（描述想法）**：打开只看到「描述你想做的小程序」大输入框 + 「✨ 开始生成」大按钮（`.btn-lg`）+ 灵感示例。**多作品草稿、模型选择都收进页面顶部的次要按钮**（「🗂 我的创作」「⚙ 设置」浮层），不再是开场就要处理的概念。
- **Step2（AI 创作）**：大加载卡（转圈 + 「AI 正在为你创作…」）；**代码输出默认折叠**在「▸ 查看创作过程」，防吓新手；有「← 修改描述」放弃按钮。
- **Step3（拿走你的作品）**：大预览 iframe 是主角，下方「起个名字 / ↻ 改一改 / ✅ 我要提交」；「💬 对话记录」折叠区在底部。
- **多作品草稿**：页头「🗂 我的创作」弹浮层卡片列表（显示最近描述+版本数，空卡「＋新建一个作品」，当前作品标「正在编辑」）。**后端仍是 5 槽（gen_slots/gen_versions），只改前端呈现**。
- **模型选择**：收进「⚙ 设置」浮层下拉；**默认模型 `DEFAULT_MODEL='inkling'`（Inkling 975B）**，新手不用碰。
- **灵感到 50 个**：`GEN_EXAMPLES` 扩到 50 个；每次随机展示 1-2 个（`showExamples`，用 `lastExampleIdx` 防连续重复）；加「换一批」刷新按钮（`Icons.icon('refresh')`，非 emoji）；标题图标用 `Icons.icon('gift')`。
- **文案精简**：去掉了「模型名后可看说明」等莫名其妙/啰嗦句，整页文字大幅压缩。
- **按钮描边**：页头三按钮（我的创作/设置/返回）用新增 `.btn-outline`（1.5px 沙褐实线框），不再是无边框 `btn-ghost`。

### 16.4 DeepSeek 官方切换（替换山大智创广场 xplt）
- 原 xplt 方案（SDU 配置走 `sdu-vpn` 容器 socat 转发 `127.0.0.1:4000`）**弃用**。`config.js` sdu 块默认改为 `baseUrl=https://api.deepseek.com`、`model=deepseek-v4-flash`；`.env` 的 `SDU_API_KEY` 换成官方 new key。
- `genApp.js` providerCfg sdu 分支/baseUrl 补 `/v1` 逻辑保留；`routes/gen.js`、`gen.js` 注释里「xplt/LiteLLM/山大」措辞全部改为「DeepSeek 官方」。
- 已实测：`deepseek-v4-flash` 官方端点可用（含流式 `delta.reasoning_content`/`delta.content`），模型名真实存在。
- **`SDU-XPLT-MODEL-ACCESS-GUIDE.md` 含旧 xplt key，已加入 `.gitignore` 不推送**（改 key 后旧指引作废）。`.env.example` SDU 说明改为官方 API。

### 16.5 DeepSeek 超时单独放宽到 15 分钟
- 后端：`config.js` genApp 新增 `deepseekTimeoutMs`（默认 900000 = 15 分钟）；`genApp.js` 新增 `timeoutForModel(modelId)`（sdu→900000，其余→`genApp.timeoutMs`=240s），`callChat` 与 `routes/gen.js` 流式 timer 都按模型取。`.env.example` 补 `GENAPP_DEEPSEEK_TIMEOUT_MS`。
- 前端：`gen.js` abort timer 按 `curModel==='sdu-deepseek'` 用 900s，其余 240s；等待提示「最长约 N 分钟」动态显示。
- **注意**：nginx `proxy_read_timeout` 当前 `300s`，若 DeepSeek 思考超 5 分钟仍会被 nginx 掐断——本 session 未改 nginx（用户未确认），如需真正 15 分钟需把 deploy/pat.weaxi.cn.conf 调大。

### 16.6 前端超长输出防崩溃
- 生成流 `logEl.value` 累积设 `LOG_MAX=50000` 上限，超限截断只留最近一段；`scrollTop=scrollHeight` 改 `requestAnimationFrame` 节流。防 DeepSeek 超长输出把 textarea 拖垮。

### 16.7 本 session 踩坑/注意
1. **默认模型改 inkling 后，老用户 localStorage 里的 `gen_model` 仍会覆盖默认值**——仅对无缓存的新用户真正用默认。若想强行统一需清 localStorage 或改读取逻辑。
2. **`inkling` 走 OpenRouter 免费池且需 `agentUA`**——`.env` OPENROUTER_API_KEY 已配置才可用；免费池高峰期可能 429（前端已提示换模型）。
3. **模块化长模板改动务必 grep 锚点唯一 + 改后数 id**：gen.js 重构中曾出现 `getElementById` 与模板 id 不一致（如 `gen-works-list` 是浮层动态创建、非静态模板），靠 `comm ref/def` 校验兜住。
4. **`node` 视图只在 `viewport` 容器填充**，`#/gen` 路由是系统内页（非 login/project），不隐藏主页壳（`is-auth` 不加，正确）。
5. **缓存版本号**：本 session 改动多轮，最终 gen.js v9、style.css v71、app.js v62、nav.js v60、learn.js v73、dashboard.js v96。改前端必须再递增 index.html `?v=`。

### 16.8 待办/风险
- [ ] 确认是否调大 nginx `proxy_read_timeout`（≥900s）让 DeepSeek 15 分钟超时真正生效。
- [ ] `SDU-XPLT-MODEL-ACCESS-GUIDE.md`（gitignored）可考虑删除，避免留旧 key 残留。
- [ ] inkling 作为默认模型的稳定性观察：免费池 429 频率。
