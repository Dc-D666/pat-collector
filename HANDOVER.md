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
- 每章 `tasks` JSON 数组，任务类型：`quiz`(单选，即时判题)、`action`(实操，可带 `nfti:true` 标记)；B站视频/本地 mp4 以媒体行嵌入正文（不是独立任务类型）
- 文章页：阅读计时 ≥60s 上报积分；任务进度条 + 单选即时判题 + 实操打卡按钮
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

### 积分商城（已下架：前端无入口，后端接口+定时回收保留，待重新上架）
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
- **机制**：PatPlayer 签 HMAC ticket（`GET /api/learn/nfti-ticket`，含 tiny_id+pat_sid+5min 过期）→ 前端跳 `https://nfti.weaxi.cn/?pat_ticket=...` → NFTI 校验后建"借用会话"
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
- **HTML 预览**：`GET /api/files/preview/:id`（登录即可，?token= 传参），响应带 `Content-Security-Policy: sandbox allow-scripts`（脚本可跑但 unique origin，读不了 localStorage/API，防存储型 XSS）
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
24. **`middleware/auth.js` 的 SELECT 必须包含新列**：加 `points` 列时若漏查，`req.user.points` 恒 undefined → 排行榜 `me.points` 恒 0（我的积分页显示错误）。加列后同步 middleware SELECT
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
35. **上传管线已抽取共享**：`utils/upload.js` 的 `runUploadPipeline(req, res, user, { maxUploadsPerDay })` 是登录（`/api/files/upload`，20 次/天）与访客（`/api/guest/upload`，5 次/天）共用的唯一实现；改上传逻辑只改这一处。`files.js` 只保留路由壳 + multer 错误映射
36. **访客项目页绕过系统登录检查**：`app.js render()` 里 `#/p/:token` 在 `if (!API.getToken())` 之前 return，且复用 `body.is-auth` 隐藏主页壳；新增独立页路由时别忘了这两点（否则访客没系统令牌会被踢回登录页）
37. **`#/p/` 页内下载/预览带 token 走 query**：`API.download()` 只带 Bearer 头，访客页要用 `fetch('/api/guest/download/:id?token=...')`（`public/js/project.js` 里独立实现）
38. **同一身份重复登记返回同一项目地址**（`ensureGuestToken` 幂等）：用户丢了地址重新填表即可找回；也因此「谁拿到地址谁可看文件」是设计行为（地址即凭证），文档已标注
39. **访客表单必须「提交前」校验文件类型/大小**：曾出现用户选 PDF → 提交 → 先弹「🎉 提交成功」页再在页面里提示「1 个文件上传失败（不支持 .pdf）」，体验很差。修复：新增公开接口 `GET /api/auth/upload-rules`（允许扩展名 + max_upload_mb，单一数据源在 config.js），前端选文件时即拦截不支持的扩展名/超限文件，点提交时再兜底校验一遍，**任何文件不过校验就不进入登记/上传流程**；成功页标题也改为失败时不显示「提交成功」。改白名单记得同步 `FALLBACK_UPLOAD_RULES`（auth.js 前端兜底常量）
40. **上传必须用 XHR，不能用 fetch**：`api.js` 的 `request()` 对所有请求套了 **15s 超时**（AbortController），200MB 大文件慢网速下必被掐断。上传统一走 `API.uploadWithProgress(path, formData, onProgress)`（XMLHttpRequest `upload.onprogress`，**不设超时**），三处上传（访客表单 auth.js / 项目页 project.js / 我的项目 dashboard.js）已全部接入；`Utils.createSpeedTracker()`（EWMA 平滑）算速度、`Utils.formatProgress(loaded, total, speed)` 输出 `12.6 MB / 198.8 MB · 1.2 MB/s`。dashboard 原「假进度条」（fakePct 封顶 88%）已删，改由真实字节驱动顶部进度条
41. **访客删除 = 安全密码 + 限流**：`DELETE /api/guest/files/:id?token=&password=`。密码逻辑在 `utils/pwd.js`：scrypt 加盐哈希（`salt:hash`，Node 内置 crypto，无新依赖），`timingSafeEqual` 常量时间比对；`users.guest_pwd_hash` 为 NULL 时按默认密码 `config.guestDefaultPassword`（env `GUEST_DEFAULT_PASSWORD`，默认 `nanfang1958`）比对。**默认密码已明示在客户端提示里 = 公开，留空 = 不设防**——这是产品取舍（用户要求直接告知默认值，否则留空用户删文件时无从知晓）。**改默认密码必须同步三处**：`config.js`、`public/js/auth.js` 提交表单提示、`public/js/project.js` 删除弹窗提示。删除接口限流 `guestDeleteRateLimit`（10 次/10 分钟/令牌+IP）防爆破；删除回扣 `file_submit` 积分、**不返还当天上传次数**（与 QQ 用户删除一致）
42. **管理后台 P0（2026-08-14 上线）**：设计见 `ADMIN-DESIGN.md`，代码在 `routes/admin.js`（全部 `requireAdmin`）+ `public/js/admin.js`（`#/admin*` 四页：总览/用户/文件/审核）。要点：① 管理员引导 = `ADMIN_QQ_TINY_IDS` 环境变量（QQ 绑定 `maybeGrantAdmin` 自动置 `is_admin`），或已有管理员在后台授权，或手动 SQL `UPDATE users SET is_admin=1 WHERE ...`；② `users.status='disabled'` 停用生效点：`middleware/auth.js`（登录态 401「账号已停用」）、`auth.js /guest`（403）、`guest.js loadActiveGuest`（401）；③ `publicUser` 两处（auth.js / auth-qq.js）都要带 `is_admin`/`status`，middleware SELECT 也要带（坑 #24）；④ **`db.query()` 返回行数组：SELECT 多行直接 `const rows = await query(...)`（解构 `[x]` 只取首行），SELECT 单行聚合才 `const [row] = ...` 且用 `row.c` 别用 `row[0].c`，INSERT/UPDATE 返回 ResultSetHeader（对象）用 `const r = await query(...)` 取 `r.insertId`——**绝不可解构**（P0 stats、P1 pins/titles/storage 都在这上面 500 过）**；⑤ 管理端删除文件/拒绝审核走 `revoke()` 回扣 +50，删除轻应用回扣 +25（普通用户路径 app 删除未回扣，管理端补齐），审核「重新通过」会补发被回扣的 +50（ref 用 `file:<id>:restore`）；⑥ 前端管理入口仅 `API.getUser().is_admin` 显示，非管理员访问 `#/admin*` 被 Views.admin 内部拦截；⑦ **`DATE_ADD(NOW(), INTERVAL ? HOUR)` 在预处理语句不可用**——置顶/称号的到期时间用 JS `mysqlNow(offsetMs)` 计算传参（`routes/admin.js` 顶部 helper）；⑧ 管理页下载走 `API.download`（带 Bearer），预览链接要拼 `?token=`，普通 `<a href>` 会 401；⑨ **P2**：教程编辑 `routes/admin.js` 的 `upsertArticle`（slug 唯一校验 + tasks 必须 JSON 数组；改教程不动学员 task_progress——FK 按 article_id，保留 id）；`utils/settings.js` 运行时设置（30s 进程内缓存，PUT 后 `invalidate()` 立即生效；`upload.js` 上传管线读 `audit_enabled` 覆盖 DeepSeek 审核）；批量审核 `/api/admin/audit/batch` 逐条 try/catch 不中断；教程预览复用 `learn.js` 顶层 `renderMarkdown()`（全局函数，learn.js 必须先于 admin.js 加载）；⑩ **教程独立编辑页** `#/admin/articles/new` / `#/admin/articles/edit/:id`（`Views.admin` 内解析 `location.hash` 子路由分发，`renderArticleEditor` 双栏：左表单右实时预览，`.ae-grid` CSS 响应式，Ctrl+S 保存；已废弃弹窗版 showArticleModal）

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
- **跨站 ticket 安全**：HMAC + 5min 过期 + 16 位 hex pat_sid 白名单 + 常量时间比较；密钥在两边 .env，勿泄露/勿改一侧
- `feed_links.py` 提取正则依赖轻应用链接格式，变了需更新
- **B站视频链接**是教程任务的一部分，若失效需替换 `seed-articles.js` 中 BV 号并重跑

## 12. 下一步建议

- **上线前必须真人验证**：QQ 扫码 → 绑定（含展示名授权表单）→ 自动识别轻应用 → 第1章 NFTI 体验任务全链路；访客直传（填表→上传→地址回访）浏览器实测一次
- 若 PatPlayer 要独立 QQ 频道（不用南方中学频道），改 `.env` 的 `GUILD_ID`（会连带 NFTI 跨站失效，两边都要改）
- 若访客直传也要防冒名/防盗链，可参考 NFTI 的邀请码 + 设备指纹方案，或给 `guest_token` 加过期/重置机制
- NFTI 项目 `/home/nfti/NF-BTI`，QQ 集成思路同源；跨站体验的 import-session/cliHome 机制在其 backend/server.js 中
