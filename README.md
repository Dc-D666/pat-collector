# PatPlayer

高中 AI 社团**作品收集与展示平台**。从零实现（不依赖任何历史仓库代码），技术栈：**Node.js + Express + MySQL + 原生前端**。

## 功能

| 模块 | 功能 |
| --- | --- |
| 认证 | 注册（班级 + 姓名 + 学号后 4 位，初始密码 `123456`）、登录、当前用户、修改密码（需旧密码，新密码 ≥ 4 位）、首次登录强制改密 |
| 班级白名单 | 高二 2501–2524（24 班）、高一 2601–2625（25 班） |
| 令牌 | HMAC-SHA256 签名 + base64url，24h 过期，`Authorization: Bearer` 携带 |
| 个人文件 | multipart 上传（多文件、拖拽、按文件进度、失败跳过）、列表、下载、删除（二次确认） |
| 扩展名白名单 | 约 50 种：图片 / 视频 / 音频 / Office / 压缩包 / 代码 / 3D |
| 班级作品墙 | 仅本班，按姓名分组卡片，文件倒序，按姓名 / 文件名实时搜索，逐文件下载 |
| 全校总览 | 统计卡片 + 每班卡片（学生数 / 文件数 / 总大小），可展开学生与文件明细 |

## 技术栈

- **后端**：Express 4 + `mysql2` + `multer`；密码用 Node 内置 `scrypt`（加盐哈希），令牌用内置 `crypto` HMAC。
- **存储**：本地文件系统 `storage/uploads/`，MySQL 存元数据。
- **前端**：原生 HTML/CSS/JS，hash 路由 SPA，无构建步骤；响应式（桌面左 rail + 移动端底部 app bar）。

## 目录结构

```
server/
  index.js          入口（路由挂载 / 静态托管 / SPA 回退）
  config.js         班级与扩展名白名单、端口、大小上限、存储路径
  db.js             mysql2 连接池（dateStrings 直返字符串，规避时区偏移）
  schema.sql        users / files 建表
  init-db.js        建表 + 建存储目录
  middleware/auth.js Bearer 鉴权中间件
  routes/auth.js    注册 / 登录 / me / 改密
  routes/files.js   上传 / 列表 / 下载 / 删除
  routes/class.js   班级墙 / 全校总览
  utils/            token、password、async、rateLimit
public/
  index.html        SPA 壳
  css/style.css
  js/{app,api,utils,nav,auth,dashboard,class-wall,overview}.js
storage/uploads/    上传文件（已 gitignore）
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

## API

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | — | 注册并返回 token |
| POST | `/api/auth/login` | — | 登录 |
| GET | `/api/auth/me` | Bearer | 当前用户 |
| POST | `/api/auth/change-password` | Bearer | 改密 |
| POST | `/api/files/upload` | Bearer | multipart 单文件（`file` 字段） |
| GET | `/api/files` | Bearer | 本人文件列表 |
| GET | `/api/files/download/:id` | Bearer | 下载（本人 + 同班） |
| DELETE | `/api/files/:id` | Bearer | 删除（仅本人） |
| GET | `/api/class/wall` | Bearer | 本班作品墙 |
| GET | `/api/class/overview` | Bearer | 全校总览 |

## 部署（宝塔 + PM2 + nginx）

1. **时区**：`timedatectl set-timezone Asia/Shanghai`（时间显示以数据库墙钟时间为准，请确保机器为北京时间）。
2. 上传代码，`npm install --production`，`npm run init-db`。
3. 配置 `.env`（生产库名/账号、强随机 `TOKEN_SECRET`，并设 `NODE_ENV=production` 以启用密钥 fail-fast）。
4. PM2 启动：`pm2 start server/index.js --name patplayer`（新增进程后 `pm2 save`）。
5. nginx 反代 `80/443 → 127.0.0.1:3001`；`client_max_body_size` 需 ≥ `MAX_UPLOAD_MB`（例如 `200m`）。

## 安全说明

- 密码 `scrypt` 加盐哈希；令牌 HMAC 签名、24h 过期；`TOKEN_SECRET` 无硬编码默认值，生产环境缺失/示例值会拒绝启动。
- **首次登录强制改密**：新账户 `must_change_password=1`，登录后须先设置非默认密码；禁止改回 `123456`。
- **登录凭据不泄露**：班级墙 / 全校总览只返回姓名与班级，**不返回学号后 4 位**（登录三元组不完整）。
- 登录 / 注册 / 改密均内置进程内速率限制（单机够用；多实例请接 Redis）。
- 上传按扩展名白名单 + 单文件大小上限 + **每用户存储配额**三重校验；文件名清洗控制字符与非法字符。
- 下载按「本人 + 同班」鉴权，跨班 `403`；删除仅本人。
- 落盘文件名用 `uuid`，原始文件名仅存于元数据，避免路径穿越。
