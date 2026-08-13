# PatPlayer

高中 AI 社团**作品收集与展示平台**（品牌：**南中科创局**）。从零实现（不依赖任何历史仓库代码），技术栈：**Node.js + Express + MySQL + 原生前端**。

## 功能

| 模块 | 功能 |
| --- | --- |
| 认证 | QQ 频道扫码登录（主）+ 无 QQ 直通（姓名+班级直接进入）；无需注册、密码、学号 |
| 班级 | 二级菜单：高一 2601–2624、高二 2501–2524、高三 2401–2425，另有「其他」自由填写 |
| 展示名 | 「是否授权展示真实姓名」设置：授权显示真名，否则显示昵称（QQ 登录默认预填频道昵称） |
| 令牌 | HMAC-SHA256 签名 + base64url，24h 过期，`Authorization: Bearer` 携带 |
| 个人文件 | multipart 上传（多文件、拖拽、按文件进度、失败跳过）、上传后填写作品信息（标题/简介/玩法）、列表、下载、删除（二次确认） |
| 扩展名白名单 | 约 50 种：图片 / 视频 / 音频 / Office / 压缩包 / 代码 / 3D |
| 全校作品展 | 全校所有项目平铺展示（文件 + AI 轻应用混排），班级 tag 标识（本班高亮），按标题/作者/班级实时搜索；下载仅同班 |
| 提交总览 | 统计卡片 + 每班卡片（学生数 / 文件数 / 轻应用数 / 总大小），可展开学生与项目明细 |
| AI 轻应用 | 自动/手动识别 QQ 频道帖子中的 AI 轻应用并收集（作者硬校验） |
| 学AI 栏目 | 5 章 AI 教程（Markdown，自研渲染器），每章含 B站视频 / 单选题 / 实操任务 |
| 积分体系 | 首次登录 / 阅读课程 / 完成整章任务 / 提交作品赚 ⭐ 积分，含排行榜与获取记录 |
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
  routes/auth.js    无 QQ 直通（guest）/ me / PATCH profile（展示名）
  routes/auth-qq.js QQ 扫码登录（init/poll/bind）
  routes/files.js   上传 / 列表 / PATCH 作品信息 / 下载 / 删除
  routes/class.js   全校作品展 / 提交总览
  routes/apps.js    AI 轻应用识别与收集
  routes/learn.js   学AI 栏目 + NFTI 跨站 ticket/状态
  routes/points.js  积分查询 / 上报 / 进度 / 排行榜
  qq/proxy.js       tencent-channel-cli 调用封装
  qq/sessions.js    每会话 HOME 隔离 + 闲置清理
  utils/            token、async、rateLimit、points
public/
  img/logo.png      本地 logo
  index.html        SPA 壳
  css/style.css
  js/               app/api/utils/nav/auth/dashboard/class-wall/overview/learn/points
seed-articles.js    学AI 教程入库脚本（node seed-articles.js）
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
| `MAX_USER_STORAGE_MB` | 每用户存储配额 | `2048` |
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
| POST | `/api/auth/guest` | — | 无 QQ 直通：姓名+班级直接进入 |
| GET | `/api/auth/me` | Bearer | 当前用户（含 max_upload_mb） |
| PATCH | `/api/auth/profile` | Bearer | 修改展示名授权（真名/昵称） |
| POST | `/api/files/upload` | Bearer | multipart 单文件（`file` 字段） |
| GET | `/api/files` | Bearer | 本人文件列表 |
| PATCH | `/api/files/:id` | Bearer | 更新作品信息（标题/简介/玩法，仅本人） |
| GET | `/api/files/download/:id` | Bearer | 下载（本人 + 同班） |
| DELETE | `/api/files/:id` | Bearer | 删除（仅本人） |
| GET | `/api/class/wall` | Bearer | 全校作品展（文件+轻应用平铺，含班级 tag） |
| GET | `/api/class/overview` | Bearer | 全校总览 |
| POST | `/api/apps/auto-scan` | Bearer | 自动识别 QQ 频道帖子中的 AI 轻应用 |
| POST | `/api/apps/manual-scan` | Bearer | 手动识别（BID / 分享链接） |
| POST | `/api/apps` | Bearer | 提交轻应用（+25 ⭐） |
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
- 作品展 / 总览 / 排行榜只返回展示名（尊重展示名授权）与班级，不泄露其它身份字段。
- 登录 / 绑定 / 直通均内置进程内速率限制（单机够用）。
- 上传按扩展名白名单 + 单文件大小上限 + **每用户存储配额**三重校验；前端预检大小防 nginx 413。
- 下载按「本人 + 同班」鉴权，跨班 `403`；删除仅本人。
- 落盘文件名用 `uuid`，原始文件名仅存于元数据，避免路径穿越。
- 积分发放幂等（`points_log` 唯一键防重复）；NFTI 跨站 ticket 为 HMAC 签名 + 5min 过期 + pat_sid 白名单。

> ⚠️ **「无 QQ 直通」是自报身份、无鉴权**：任何人可填任意「姓名+班级」冒充他人访问其文件。这是产品取舍——QQ 扫码才是可信身份；若需防冒名，应仅保留 QQ 登录（或对直通入口加邀请码/管理员审批）。
