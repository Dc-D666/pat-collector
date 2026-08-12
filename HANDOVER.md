# PatPlayer 工作交接文档

> 给下一个 AI Agent session 的快速上手指南。本文档沉淀了这一整轮开发踩过的坑和关键结论，**新 session 请先读这里**，不要重复逆向。

---

## 1. 项目是什么

高中 AI 社团「作品收集与展示平台」。核心能力：

- QQ 频道扫码登录（主）+ 无 QQ 直通（姓名+班级直接进）
- 个人文件上传（多文件/拖拽/进度）
- 班级作品墙（仅本班）+ 全校提交总览
- **AI 轻应用自动/手动识别收集**（从 QQ 频道帖子提取 AI 轻应用链接）

域名：`https://pat.weaxi.cn`（已上线）。代码仓库：`git@github.com:Dc-D666/pat-collector.git`。

## 2. 技术栈

- **后端**：Node.js + Express 4 + `mysql2` + `multer`，无构建步骤
- **前端**：原生 HTML/CSS/JS，hash 路由 SPA（`public/`）
- **QQ 集成**：`tencent-channel-cli`（npm 公开包，Go 原生二进制）+ 两个 Python 脚本（`feed_links.py`、`share_resolve.py`）
- **鉴权**：应用内 HMAC-SHA256 token（24h，`utils/token.js`）+ QQ 会话 token（由 CLI 管理）

## 3. 目录结构

```
server/
  index.js            入口（路由挂载/静态托管/SPA 回退，监听 127.0.0.1:3001）
  config.js           班级白名单、扩展名白名单、GUILD_ID、各路径、dateStrings
  db.js               mysql2 连接池（dateStrings:true 直返字符串，规避时区）
  schema.sql          建表（users/files/apps）
  init-db.js          建表脚本（npm run init-db）
  middleware/auth.js  Bearer token 鉴权（requireAuth）
  routes/auth.js      无QQ直通(guest)/me/classes 列表
  routes/auth-qq.js   QQ 扫码登录(init/poll/bind) + /status 失效检测
  routes/files.js     文件上传/列表/下载/删除
  routes/class.js     班级墙/总览
  routes/apps.js      AI 轻应用 auto-scan/manual-scan/submit/list/delete
  qq/proxy.js         runCli 封装（execFile 调 CLI 二进制）
  qq/sessions.js      QQ 会话管理（每会话 HOME 隔离 + index.json 持久化 + 30天TTL）
  qq/feed-links.js    feed_links.py + share_resolve.py 的 Node 封装
  utils/token.js      HMAC token 签发/校验
  utils/async.js, rateLimit.js
public/js/            app/api/utils/nav/auth/dashboard/class-wall/overview
feed_links.py         从 BID 提取 AI 轻应用链接（用户提供）
share_resolve.py      短链 pd.qq.com/s/xxx → BID（用户提供）
ecosystem.config.cjs  PM2 配置
deploy/pat.weaxi.cn.conf  nginx 反代配置
```

## 4. 数据库

- 库名/用户/密码：`pat` / `pat` / `WtfAYXjWMkJi78WM`（本机 MySQL 3306）
- 表：
  - `users`：id, class_name, real_name, qq_tiny_id(可空唯一), qq_session_id(可空), created_at；唯一键 `(class_name, real_name)`
  - `files`：id, user_id, stored_name(uuid落盘名), original_name, size, mime_type, uploaded_at
  - `apps`：id, user_id, app_url, title, description, gameplay, source_feed_id, created_at
- 改表后直接 `DROP TABLE ...; npm run init-db`（库基本是空的，无迁移负担）

## 5. 认证体系（核心难点，务必理解）

**两种登录**：
1. **QQ 扫码登录**（主）：`init` 拿二维码/链接 → 用户扫 → `poll` 轮询 → `bind` 绑定班级姓名
2. **无 QQ 直通**：`guest` 填姓名+班级直接进（无密码、无学号）

**班级白名单**（`config.js`）：高一 2601-2624、高二 2501-2524、高三 2401-2425，另有「其他」自由文本。前端「年级→班级」二级菜单。

**身份模型**：`(class_name, real_name)` 是唯一身份；`qq_tiny_id` 是 QQ 绑定（可空）。

**QQ 会话 token 机制（关键）**：
- `tencent-channel-cli` 的 `login` 走 device-bind 流程，token 由 CLI 写入 `$HOME/.qqcli/.env`（`QQ_AI_CONNECT_TOKEN` + `QQ_AI_CONNECT_DEVICE_ID`）
- **token 隔离**靠「每会话独立 HOME」：`storage/qq-sessions/<sessionId>/`，CLI 进程带上 `HOME=<该目录>` env
- 会话索引持久化到 `storage/qq-sessions/index.json`，30 天闲置回收
- `users.qq_session_id` 关联用户；登录 bind 后**不清理会话**（AI 轻应用识别需要它）

## 6. AI 轻应用识别（核心难点，务必理解）

**链路**：
```
自动识别：get-guild-feeds(--count 24) → 筛 author_id===tiny_id → 每帖 verifyOwnFeed(get-feed-detail 校验作者) → feed_links.py(BID) 提链接
手动识别：BID 直贴 ──┐
          分享链接/文本 → share_resolve.py → BID ─→ verifyOwnFeed 校验作者 → feed_links.py 提链接
```

**两个 Python 脚本**（都在项目根）：
- `feed_links.py <BID> [channel_id]`：起本地代理捕获 `get-feed-detail` 的原始 MCP 响应，提取 `urlContent.url` + `launch_app` 正则。需要 CLI 在 PATH + 用户 HOME（token）
- `share_resolve.py <短链>`：curl + 浏览器 UA 拉 Nuxt SSR 页面，从 `__NUXT_DATA__` 提取 `feedId`（BID）

## 7. 关键结论与坑（最重要，避免重复踩坑）

这些是**实际踩过、验证过的**，新 session 不要再怀疑：

1. **`get-user-info`（全局/频道）都不返回 `tiny_id`**，只返回 nickname/gender/province 等。tiny_id 只能靠 `guild-member-search --guild-id --keyword=<昵称>` → `members[0].tinyid`（注意字段是小写 `tinyid`）
2. **`manage get-share-info` 只返回频道信息**，底层 MCP 工具叫 `shareGuildInfo`，**根本不返回 feed_id**。所以「短链转 BID」不能用它，必须用 `share_resolve.py`
3. **`get-feed-detail` 返回 `data.feed.author_id`（平铺）**、`data.feed.title`、`data.feed.channel_id`、`data.feed.feed_id`。作者校验用 `author_id === tiny_id`
4. **`get-guild-feeds` 返回 `data.feeds[]`**，作者字段可能是 `author_id`（平铺）或 `author.tiny_id`（嵌套），要两者都兼容
5. **`login status` 返回 `data.valid`**，用于检测 QQ token 是否失效（单设备登录被踢后失效）
6. **`get-feed-share-url --feed-id` 返回 `data.share_url`**（BID → 短链）
7. QQ 分享短链 `pd.qq.com/s/xxx` 有反爬（EdgeOne JS 挑战），`curl` 必须带浏览器 UA 才能拿到 SSR 页面
8. **CLI 二进制路径**：`node_modules/tencent-channel-cli-linux-x64/bin/tencent-channel-cli`；`feed_links.py` 靠 `shutil.which` 找 CLI，所以 Node 封装里要注入 `PATH=<bin目录>:...`
9. **`QQ_AI_CONNECT_MCP_URL`** env 可重定向 CLI 的 MCP 网关（`feed_links.py` 靠这个起代理捕获原始响应）
10. **GUILD_ID 默认 `621631744026206738`**（南方中学频道），可 `.env` 覆盖
11. **QQ token 单设备登录**：别处登录即踢下线，原 token 失效。PatPlayer 加了 `/api/auth/qq/status` + 前端横幅检测
12. **`api.js` 的 401 处理**：只有携带 Bearer 的请求 401 才跳登录，扫码流程的 401 是业务态错误要原样抛

## 8. 部署环境

- 服务器：`49.232.252.213`（腾讯云轻量，宝塔面板，**本沙箱就是这台服务器**）
- 域名：`pat.weaxi.cn`（DNS 指向本机；同机还有 greendoc/speak/nfti 等站点，**勿动**）
- **PM2**：服务名 `patplayer`（`server/index.js`，监听 127.0.0.1:3001）
- **nginx**：`/www/server/panel/vhost/nginx/pat.weaxi.cn.conf`（反代 3001，`client_max_body_size 200m`）
- **SSL**：certbot webroot 模式（`/var/www/certbot`），证书 `/etc/letsencrypt/live/pat.weaxi.cn`
- `.env`（生产，已 gitignore）：`NODE_ENV=production`、强随机 `TOKEN_SECRET`、DB 连接

## 9. 常用运维命令

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

# 建表（改 schema 后）
mysql -h127.0.0.1 -upat -pWtfAYXjWMkJi78WM pat -e "DROP TABLE IF EXISTS files,apps,users;"
npm run init-db
```

## 10. 已知待办 / 风险

- **QQ 扫码完整链路**（poll-token → 拿 tiny_id → bind）需要真人扫一次码验证（沙箱无法模拟）
- **auto-scan 较慢**：串行跑最多 24 个 python 子进程（首次几十秒），已加限流 5 次/分钟
- **`share_resolve.py` 依赖 QQ 反爬策略**：若 QQ 换了反爬（UA/JS 挑战升级），短链解析会失效，需重新逆向
- **无 QQ 直通是自报身份、无鉴权**：任何人可填任意姓名班级冒充他人（产品取舍，已文档化警告）
- `feed_links.py` 提取的是 `urlContent` + `launch_app` 正则，若轻应用链接格式变化需更新正则

## 11. 下一步建议

- 若 PatPlayer 要独立 QQ 频道（不用南方中学频道），改 `.env` 的 `GUILD_ID`
- 若要对「无 QQ 直通」加防冒名，可参考 NFTI 的邀请码 + 设备指纹方案（`/home/nfti/NF-BTI`）
- NFTI 项目在 `/home/nfti/NF-BTI`，QQ 集成思路同源，可作参考
