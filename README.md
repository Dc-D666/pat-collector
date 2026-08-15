# PatPlayer

高中 AI 社团**作品收集与展示平台**（品牌：**南中科创局**）。从零实现（不依赖任何历史仓库代码），技术栈：**Node.js + Express + MySQL + 原生前端**。

## 功能

| 模块 | 功能 |
| --- | --- |
| 认证 | QQ 频道扫码登录（主）+ **访客直传**（无 QQ：填年级/班级/姓名 + 上传程序文件，提交后给专属项目地址，不进入系统） |
| 班级 | 二级菜单：高一 2601–2624、高二 2501–2524、高三 2401–2425，另有「其他」：毕业生填自己班级（4 位数字），外校填 0（必填校验）|
| 展示名 | 「是否授权展示真实姓名」设置：授权显示真名，否则显示**昵称=姓名拼音首字母**（方案二，2026-08-16）：pypinyin 生成缩写、多音字展开候选（如 单依纯 → CYC/DYC/SYC）由用户选择，**选定后不可更改**；`GET /api/auth/pinyin-candidates?name=` 供前端动态生成 |
| 昵称安全 | 昵称永远派生自己的姓名（无法冒充班主任姓名/填违规文本）；存量自由文本昵称在下次编辑展示设置时强制改选缩写；缩写尴尬（如 史冰→SB）可改展示真名 |
| 令牌 | 系统 HMAC-SHA256 签名 + base64url，24h 过期，`Authorization: Bearer` 携带；**访客项目地址令牌**为 64 位十六进制长随机串（无过期，随地址分享） |
| 个人文件 | multipart 上传（多文件、拖拽、按文件进度、失败跳过）、上传后填写作品信息（标题/简介/玩法，**AI 审查，R2**）、列表、下载、删除（二次确认）；**上传前 ClamAV + VirusTotal 双恶意扫描（R3，VT 429 自动降级 ClamAV）** + 自检磁盘剩余空间（低于 2GB 拒绝）；每人作品文件总数上限 20 个、总容量 1GB（超限提示联系频道主扩容） |
| 访客直传 | 无 QQ 用户专用：登录页填「年级→班级→姓名→展示名授权→安全密码」后直接上传程序文件，提交后生成**专属项目地址**（`#/p/<token>`），以后凭此地址查看/下载/继续上传/删除；额度：单文件 ≤200MB，每天最多 5 次 |
| 访客删除保护 | 项目页删除文件需输入**安全密码**（提交时设置，选填；留空用默认密码 `nanfang1958`），防拿到 URL 的人误删/批量删；密码 scrypt 加盐哈希存库、常量时间比较、删除接口限流防爆破 |
| 管理后台 | 仅 QQ 登录管理员可用（`ADMIN_QQ_TINY_IDS` 白名单引导）：总览 / 用户 / 文件 / 内容审核 / 轻应用 / 积分 / 运营（置顶/称号/商城开关/**评委评审**）/ 运维（存储/会话）/ 教程在线编辑（**独立全屏编辑页**，双栏实时预览，Ctrl+S 保存）/ 系统设置 / 审计日志；支持批量审核；全部操作记 `admin_log` 审计 |
| 扩展名白名单 | 约 50 种：图片 / 视频 / 音频 / Office / 压缩包 / 代码 / 3D |
| 全校作品展 | 全校所有项目平铺展示（文件 + AI 轻应用混排），班级 tag 标识（本班高亮），按标题/作者/班级实时搜索；下载全校公开（登录即可）；**访客作品不参展（R1，2026-08-16）**——访客作品只在自己的项目地址页展示，QQ 合并后自动转正参展 |
| 提交总览 | 统计卡片 + 每班卡片（学生数 / 文件数 / 轻应用数 / 总大小），可展开学生与项目明细 |
| AI 轻应用 | 自动/手动识别 QQ 频道帖子中的 AI 轻应用并收集（作者硬校验） |
| 学AI 栏目 | 5 章 AI 教程（Markdown，自研渲染器），每章含 B站视频 / 单选题 / 实操任务 |
| 积分体系 | 首登 +10、阅读 **+8**、整章任务 **+15**、提交文件 **+25**（最多计 5 个）、提交应用 **+15**（最多计 3 个）、主动点赞 +2（日上限 10）、**被赞 +5（日上限 20，P3）**、毕业 **+40**、彩蛋 +5；幂等发放 + 计数上限 + 排行榜；**访客不进榜（O1）**，排行榜**默认「在校」可切「全部」（2026-08-16）**；人工评委可经后台调积分发放评审分 |
| 跨站体验 | 第1章实操任务跳转 NFTI（nfti.weaxi.cn）自动登录（HMAC ticket），完成人格测试自动核验 |

## 技术栈

- **后端**：Express 4 + `mysql2` + `multer`；QQ 登录通过 `tencent-channel-cli`（官方原生二进制，device-bind 扫码），应用令牌用内置 `crypto` HMAC。
- **存储**：本地文件系统 `storage/uploads/`，MySQL 存元数据（含教程文章与积分流水）。
- **前端**：原生 HTML/CSS/JS，hash 路由 SPA，无构建步骤；响应式（桌面左 rail + 移动端底部 app bar）。

## 目录结构

```
server/
  index.js          入口（路由挂载 / 静态托管 / SPA 回退）
  config.js         班级与扩展名白名单、端口、大小上限、存储路径、NFTI 跨站配置
  db.js             mysql2 连接池（dateStrings 直返字符串，规避时区偏移）
  schema.sql        users/files/apps/articles/points_log/task_progress 建表
  init-db.js        建表 + 建存储目录
  middleware/auth.js Bearer 鉴权中间件
  routes/auth.js    访客直传登记（guest，签发项目地址令牌）/ me / PATCH profile（展示名）
  routes/auth-qq.js QQ 扫码登录（init/poll/bind）
  routes/guest.js   访客项目地址：列表 / 上传 / 下载 / HTML 预览（凭 guest_token）
  routes/files.js   上传 / 列表 / PATCH 作品信息 / 下载 / 删除
  routes/class.js   全校作品展 / 提交总览
  routes/apps.js    AI 轻应用识别与收集
  routes/learn.js   学AI 栏目 + NFTI 跨站 ticket/状态
  routes/points.js  积分查询 / 上报 / 进度 / 排行榜
  routes/admin.js   管理后台（总览/用户/文件/审核/轻应用/积分/运营/运维/教程/设置/审计，requireAdmin）
  qq/proxy.js       tencent-channel-cli 调用封装
  qq/sessions.js    每会话 HOME 隔离 + 闲置清理（含 listSessions 供管理后台）
  middleware/admin.js 管理接口鉴权（requireAdmin）
  utils/            token、async、rateLimit、points、audit（DeepSeek 审查）
  utils/upload.js   共享上传管线（multer + 磁盘自检 + 每日次数/配额 + 审查），登录与访客共用
  utils/disk.js     磁盘剩余空间检测（fs.statfsSync，df 兜底）
  utils/pwd.js      访客删除安全密码（scrypt 加盐哈希 + 常量时间比较）
  utils/adminLog.js 管理操作审计（admin_log 表）
  utils/settings.js 运行时设置（settings 表，30s 缓存，写后立即生效）
public/
  img/logo.png      本地 logo
  index.html        SPA 壳
  css/style.css
  js/               app/api/utils/nav/auth/dashboard/class-wall/overview/learn/points/project/admin（管理后台）
seed-articles.js    学AI 教程入库脚本（node seed-articles.js；管理后台可在线编辑，库为准）
ADMIN-DESIGN.md     管理后台设计文档（P0/P1/P2 已实现）
storage/uploads/    上传文件（已 gitignore）
storage/qq-sessions/ QQ 登录会话（已 gitignore）
```

## 本地开发

```bash
# 1. 准备 MySQL（库 pat / 用户 pat），并配置环境变量
cp .env.example .env    # 按需修改 DB_* 与 TOKEN_SECRET

# 2. 安装依赖 + 建表
npm install
npm run init-db

# 3. 启动
npm run dev            # 或 npm start
```

默认监听 `http://127.0.0.1:3001`。

## 环境变量

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `PORT` | 监听端口 | `3001` |
| `DB_HOST` / `DB_PORT` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | MySQL 连接 | `127.0.0.1` / `3306` / `pat` / `pat` / — |
| `TOKEN_SECRET` | 令牌签名密钥，**生产务必设强随机值** | —（无硬编码默认） |
| `MAX_UPLOAD_MB` | 上传大小上限 | `200` |
| `MAX_USER_STORAGE_MB` | 每用户文件总容量（超限提示联系频道主扩容） | `1024` |
| `MAX_FILES_PER_USER` | 每人作品文件总数上限 | `20` |
| `MAX_APPS_PER_USER` | 每人轻应用总数上限 | `20` |
| `MAX_UPLOADS_PER_DAY` | 已登录用户每人每天上传次数上限 | `20` |
| `GUEST_MAX_UPLOADS_PER_DAY` | 访客直传每人每天上传次数上限 | `5` |
| `GUEST_DEFAULT_PASSWORD` | 访客删除安全密码默认值（未设置密码的用户用） | `nanfang1958` |
| `ADMIN_QQ_TINY_IDS` | 管理员 QQ tiny_id 白名单（逗号分隔，QQ 绑定时自动授权） | — |
| `MIN_FREE_DISK_GB` | 上传前磁盘自检阈值：剩余空间低于该值（GB）拒绝上传 | `2` |
| `STORAGE_DIR` | 文件存储目录 | `storage/uploads` |
| `QQ_SESSIONS_DIR` | QQ 登录会话目录 | `storage/qq-sessions` |
| `GUILD_ID` | 可选：限定 QQ 登录到某频道（空 = 不校验） | — |
| `PAT_TICKET_SECRET` | NFTI 跨站体验 ticket 签名密钥（与 NFTI 侧一致） | — |
| `NFTI_DB_HOST/PORT/NAME/USER/PASSWORD` | NFTI 库只读连接（判定"已体验"） | `127.0.0.1`/`3306`/`nfti`/`nfti`/— |

## API

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/auth/qq/init` | — | 发起 QQ 扫码，返回二维码 + session |
| POST | `/api/auth/qq/poll` | — | 轮询扫码授权状态 |
| POST | `/api/auth/qq/bind` | — | 绑定班级姓名（或已绑定直登），返回 token |
| POST | `/api/auth/guest` | — | 访客直传登记：姓名+班级+展示名授权，返回**项目地址令牌**（不签发系统令牌） |
| GET | `/api/auth/upload-rules` | — | 上传规则（允许扩展名 + 单文件大小上限，前端提交前校验用） |
| GET | `/api/auth/me` | Bearer | 当前用户（含 max_upload_mb） |
| PATCH | `/api/auth/profile` | Bearer | 修改展示名授权（真名/昵称） |
| GET | `/api/guest/files?token=` | 访客令牌 | 项目地址页数据：身份 + 文件列表 + 今日额度 |
| POST | `/api/guest/upload` | 访客令牌 | 访客上传（multipart：file + token；单文件 ≤200MB，每天 ≤5 次） |
| GET | `/api/guest/download/:id?token=` | 访客令牌 | 下载（仅本项目地址下的文件） |
| GET | `/api/guest/preview/:id?token=` | 访客令牌 | HTML 预览（仅本项目地址下的文件，CSP sandbox） |
| DELETE | `/api/guest/files/:id?token=&password=` | 访客令牌+密码 | 删除（仅本项目地址下的文件；密码错 403，限流防爆破；回扣提交积分） |
| POST | `/api/files/upload` | Bearer | multipart 单文件（`file` 字段；每人总数上限 20、总容量 1GB） |
| GET | `/api/files` | Bearer | 本人文件列表 |
| PATCH | `/api/files/:id` | Bearer | 更新作品信息（标题/简介/玩法，仅本人） |
| GET | `/api/files/download/:id` | Bearer | 下载（登录即可下载任意作品） |
| DELETE | `/api/files/:id` | Bearer | 删除（仅本人） |
| GET | `/api/class/wall` | Bearer | 全校作品展（文件+轻应用平铺，含班级 tag） |
| GET | `/api/class/overview` | Bearer | 全校总览 |
| POST | `/api/apps/auto-scan` | Bearer | 自动识别 QQ 频道帖子中的 AI 轻应用 |
| POST | `/api/apps/manual-scan` | Bearer | 手动识别（BID / 分享链接） |
| POST | `/api/apps` | Bearer | 提交轻应用（+15 ⭐，最多计 3 个；总数上限 20） |
| GET | `/api/apps` | Bearer | 我的轻应用列表 |
| DELETE | `/api/apps/:id` | Bearer | 删除轻应用（仅本人） |
| GET | `/api/learn` | — | 学AI 章节列表 |
| GET | `/api/learn/:slug` | — | 文章详情（含 tasks） |
| GET | `/api/learn/nfti-ticket` | Bearer | 签发 NFTI 跨站体验 ticket（需 QQ 登录） |
| GET | `/api/learn/nfti-status` | Bearer | 是否已在 NFTI 完成人格测试 |
| GET | `/api/points` | Bearer | 我的积分与流水 |
| GET | `/api/points/leaderboard` | Bearer | 积分排行榜（top20 + 我的排名） |
| POST | `/api/points/read` | Bearer | 阅读课程上报（≥60s，+10 ⭐/篇） |
| POST | `/api/points/task` | Bearer | 任务完成上报（整章全完成才 +20 ⭐） |
| GET | `/api/points/task-progress` | Bearer | 章节任务进度（回填用） |
| GET | `/api/admin/stats` | 管理员 | 仪表盘统计 |
| GET | `/api/admin/users` | 管理员 | 用户列表/搜索（含文件数/占用/今日上传） |
| POST | `/api/admin/users/:id/points` | 管理员 | 调整积分（±，原因必填） |
| POST | `/api/admin/users/:id/admin` | 管理员 | 设/取消管理员（仅 QQ 用户） |
| POST | `/api/admin/users/:id/status` | 管理员 | 停用/恢复用户 |
| POST | `/api/admin/users/:id/guest-pwd-reset` | 管理员 | 重置访客删除密码 |
| DELETE | `/api/admin/users/:id` | 管理员 | 删除用户（级联+物理文件） |
| GET | `/api/admin/files` | 管理员 | 文件列表/搜索（按状态过滤） |
| PATCH | `/api/admin/files/:id` | 管理员 | 改作品信息/审核状态 |
| DELETE | `/api/admin/files/:id` | 管理员 | 删除文件（回扣积分） |
| GET | `/api/admin/audit` | 管理员 | 审核队列（pending/flagged/reviewed） |
| POST | `/api/admin/audit/:id/review` | 管理员 | 审核：通过/拒绝(+原因+回扣)/删除 |
| POST | `/api/admin/audit/batch` | 管理员 | 批量审核（approve/delete，逐条容错） |
| GET | `/api/admin/apps` | 管理员 | 轻应用列表/搜索 |
| DELETE | `/api/admin/apps/:id` | 管理员 | 删除轻应用（回扣 +15） |
| GET | `/api/admin/points/leaderboard` | 管理员 | 积分榜 TOP50 |
| GET | `/api/admin/points/logs` | 管理员 | 积分流水检索（user_id/reason/limit） |
| GET | `/api/admin/purchases` | 管理员 | 置顶/称号/精华记录 |
| POST | `/api/admin/purchases/:id/expire` | 管理员 | 手动过期 |
| POST | `/api/admin/pins` | 管理员 | 免费手动置顶（file/app，小时） |
| POST | `/api/admin/titles` | 管理员 | 发放专属称号 |
| GET/POST | `/api/admin/judge` | 管理员 | 评委评审：GET 查单项目/最近列表，POST 打分（4 维度 0-10 加权：创意30%/内容25%/完成25%/价值观20% → `round(综合×30)`，满分 300，综合<6 不兑现；覆盖评审自动补/扣差额积分，reason=`judge_review`） |
| GET/PUT | `/api/admin/settings[/:key]` | 管理员 | 运行时设置（shop_enabled/audit_enabled 等） |
| GET | `/api/admin/storage` | 管理员 | 按班级存储/大文件/磁盘剩余 |
| GET | `/api/admin/sessions` | 管理员 | QQ 会话列表 |
| POST | `/api/admin/sessions/:id/invalidate` | 管理员 | 使 QQ 会话失效 |
| GET | `/api/admin/articles` | 管理员 | 教程列表 |
| GET | `/api/admin/articles/:id` | 管理员 | 教程详情（含 tasks） |
| POST | `/api/admin/articles` | 管理员 | 新建教程 |
| PUT | `/api/admin/articles/:id` | 管理员 | 更新教程 |
| DELETE | `/api/admin/articles/:id` | 管理员 | 删除教程 |
| GET | `/api/admin/logs` | 管理员 | 管理操作审计日志检索 |

## 部署（宝塔 + PM2 + nginx）

1. **时区**：`timedatectl set-timezone Asia/Shanghai`（时间显示以数据库墙钟时间为准，请确保机器为北京时间）。
2. 上传代码，`npm install --production`，`npm run init-db`。
3. 配置 `.env`（生产库名/账号、强随机 `TOKEN_SECRET`，并设 `NODE_ENV=production` 以启用密钥 fail-fast）。
4. PM2 启动：`pm2 start server/index.js --name patplayer`（新增进程后 `pm2 save`）。
5. nginx 反代 `80/443 → 127.0.0.1:3001`；`client_max_body_size` 需 ≥ `MAX_UPLOAD_MB`（例如 `200m`）。
6. （可选）学AI 教程：`node seed-articles.js` 写入教程内容。
7. （可选）NFTI 跨站体验：`docker compose -f /home/nfti/NF-BTI/docker-compose.yml up -d --build`（含只读挂载 PatPlayer 会话目录）。

## 安全说明

- QQ 登录走 `tencent-channel-cli` 的 device-bind 扫码流程，token 由 CLI 写入**每会话独立 HOME**（`storage/qq-sessions/<id>/.qqcli/`），天然隔离；登录绑定后会话保留（AI 识别 + NFTI 跨站需要）。
- 应用令牌 HMAC 签名、24h 过期；`TOKEN_SECRET` 无硬编码默认值，生产环境缺失/示例值会拒绝启动。
- 作品展 / 总览 / 排行榜只返回展示名与班级，不泄露其它身份字段。**同班才显真名（P1，2026-08-16）**：真实姓名仅对同班同学展示（`displayNameOf(row, viewerClass)` / 排行榜按查看者班级判断），非同班/非本校一律显示昵称（拼音缩写），无昵称用户兜底「同学」——不向非同班泄漏真实姓名。
- 登录 / 绑定 / 直传登记均内置进程内速率限制（单机够用）。
- 上传按扩展名白名单 + 单文件大小上限 + **每用户存储配额**三重校验，**上传前自检磁盘剩余空间**（低于 `MIN_FREE_DISK_GB` 直接拒绝，不落盘）；前端预检大小防 nginx 413。
- 下载全校公开（登录即可下载任意作品，2026-08 起的产品决策：展示学生作品、互相学习）；删除仅本人。
- 落盘文件名用 `uuid`，原始文件名仅存于元数据，避免路径穿越。
- **访客项目地址令牌**（`guest_token`）为 64 位十六进制长随机串、无过期：谁拿到地址谁就能查看/下载该项目文件——这是产品设计（地址即凭证），请勿公开分享；同一身份重复登记返回同一地址。**防冒名（2026-08-15）**：该姓名+班级已被 QQ 账号绑定时，访客登记直接拒绝（请用 QQ 登录），QQ 用户身份不再能被访客冒名取得项目地址；纯访客身份仍走幂等找回地址流程。
- **访客删除需安全密码**：自定义密码 scrypt 加盐哈希存 `users.guest_pwd_hash`，删除接口常量时间比对 + 限流防爆破；**留空 = 用默认密码（等于不设防）**，只有设置专属密码才是真保护——默认密码会写在客户端提示里。
- 积分发放幂等（`points_log` 唯一键防重复）；**阅读打卡服务端校验（2026-08-15）**：需先加载文章详情且已读 ≥60s 才发 +10⭐；**额度/配额原子化（2026-08-15）**：每日上传次数、作品数、存储配额、点赞每日积分上限、提交计数上限均在同事务 + 用户行锁内检查与写入，并发不会突破上限；NFTI 跨站 ticket 为 HMAC 签名 + 5min 过期 + pat_sid 白名单。
- **违规下架（2026-08-15）**：`audit_status='flagged'` 的作品不进入作品展/总览，下载/预览/点赞一律 403。

- **管理后台**：仅 QQ 登录用户可为管理员（`users.is_admin`，`ADMIN_QQ_TINY_IDS` 白名单引导或管理员互授）；全部管理接口 `requireAdmin`（非管理员 403）；`users.status='disabled'` 可停用用户（登录/登记/上传一律拒绝）；所有管理写操作记 `admin_log` 审计（含 IP）。
- **教程编辑以库为准**：管理后台在线编辑 `articles` 表（保留文章 id，不影响学员 `task_progress`/积分）；`seed-articles.js` 仅作初始种子。

> ⚠️ **访客直传是自报身份、无鉴权**：任何人可填任意「姓名+班级」冒充他人，且拿到别人的项目地址即可查看其文件。这是产品取舍——QQ 扫码才是可信身份；访客仅能提交/查看自己的项目，**不进入系统**（无系统令牌）。2026-08-15 起，**已被 QQ 绑定的身份禁止访客冒名登记**（QQ 用户受保护）；纯访客身份之间仍遵循"地址即凭证"。
