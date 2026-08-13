# PatPlayer 工作交接文档

> 给下一个 AI Agent session 的快速上手指南。本文档沉淀了全部开发踩过的坑和关键结论，**新 session 请先读这里**，不要重复逆向。

---

## 1. 项目是什么

高中 AI 社团「作品收集与展示平台」，品牌名**南中科技局**。核心能力：

- QQ 频道扫码登录（主）+ 无 QQ 直通（姓名+班级直接进）
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
  config.js           班级白名单、扩展名白名单、GUILD_ID、路径、dateStrings、NFTI 跨站配置
  db.js               mysql2 连接池（dateStrings:true 直返字符串，规避时区）
  schema.sql          建表（users/files/apps/articles/points_log/task_progress）
  init-db.js          建表脚本（npm run init-db）
  middleware/auth.js  Bearer token 鉴权（requireAuth）
  routes/auth.js      无QQ直通(guest)/me/PATCH profile(展示名)/classes
  routes/auth-qq.js   QQ 扫码登录(init/poll/bind) + /status 失效检测
  routes/files.js     文件上传/列表/PATCH 元数据/下载/删除
  routes/class.js     全校作品展(wall)/总览(overview)——含 apps 混排 + display_name
  routes/apps.js      AI 轻应用 auto-scan/manual-scan/submit/list/delete
  routes/learn.js     学AI 栏目：章节列表/文章详情/nfti-ticket/nfti-status
  routes/points.js    积分：查询/阅读上报/任务上报(整章判定)/任务进度/排行榜
  qq/proxy.js         runCli 封装（execFile 调 CLI 二进制）
  qq/sessions.js      QQ 会话管理（每会话 HOME 隔离 + index.json 持久化 + 30天TTL）
  qq/feed-links.js    feed_links.py + share_resolve.py 的 Node 封装
  utils/token.js      HMAC token 签发/校验
  utils/points.js     积分服务（grant 幂等发放 + 流水）
  utils/async.js, rateLimit.js
public/
  img/logo.png        本地 logo（QQ 频道头像，已本地化避免外链 CDN 卡加载）
  index.html          SPA 壳
  css/style.css
  js/                 app/api/utils/nav/auth/dashboard/class-wall/overview/learn/points
feed_links.py         从 BID 提取 AI 轻应用链接（用户提供）
share_resolve.py      短链 pd.qq.com/s/xxx → BID（用户提供）
seed-articles.js      学AI 教程入库脚本（node seed-articles.js 重跑会清空重写）
ecosystem.config.cjs  PM2 配置
deploy/pat.weaxi.cn.conf  nginx 反代配置（含 www 301 归一化）
```

## 4. 数据库（库 pat / 用户 pat / WtfAYXjWMkJi78WM，本机 MySQL 3306）

- **users**：id, class_name, real_name, qq_tiny_id(可空唯一), qq_session_id(可空), show_real_name(展示名授权,默认1), nickname(昵称), **points(积分)**, created_at；唯一键 `(class_name, real_name)`
- **files**：id, user_id, stored_name(uuid落盘), original_name, size, mime_type, **title/description/gameplay(作品信息)**, uploaded_at
- **apps**：id, user_id, app_url, title, description, gameplay, source_feed_id, created_at
- **articles**：id, slug(唯一), chapter(章节号), title, summary, content(Markdown), **tasks(JSON 任务数组)**, sort_order, created_at, updated_at
- **points_log**：id, user_id, amount, reason(first_login/read_article/task/app_submit/file_submit), ref_id(防重), created_at；唯一键 `(user_id, reason, ref_id)`
- **task_progress**：id, user_id, article_id, task_index, created_at；唯一键 `(user_id, article_id, task_index)`

> 线上库有真实数据，改表用 ALTER 不要 DROP；`npm run init-db` 只在全新环境用。

## 5. 认证体系（核心难点，务必理解）

**两种登录**：
1. **QQ 扫码登录**（主）：`init` 拿二维码/链接 → 用户扫 → `poll` 轮询 → `bind` 绑定班级姓名
2. **无 QQ 直通**：`guest` 填姓名+班级直接进（无密码、无学号）

**班级白名单**（`config.js`）：高一 2601-2624、高二 2501-2524、高三 2401-2425，另有「其他」自由文本。

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
- 每章 `tasks` JSON 数组，任务类型：`video`(B站)、`quiz`(单选)、`action`(实操，可带 `nfti:true` 标记)
- 文章页：阅读计时 ≥60s 上报积分；任务进度条 + 单选即时判题 + 视频/实操打卡按钮
- 改教程内容：编辑 `seed-articles.js` 后 `node seed-articles.js`（清空重写全部）

### 积分规则（`utils/points.js` RULES）
| 行为 | 积分 |
| --- | --- |
| 首次登录（注册即发） | 10 |
| 阅读课程 ≥60s（每篇一次） | 10 |
| **完成整章所有任务**（每章一次） | 20 |
| 提交 AI 轻应用（每个作品一次） | 25 |
| 提交作品文件（每个文件一次） | 50 |

- `grant()` 幂等：`points_log` 唯一键 `(user_id, reason, ref_id)` 防重复，事务内插流水+更新 `users.points`
- 任务积分是**整章判定**：`/api/points/task` 记 `task_progress` → 该章全完成才 `grant('task','article:<id>')`
- 排行榜 `/api/points/leaderboard`（top20 降序 + 我的排名），前端「🏆 积分榜」页

### 跨站体验（第1章实操任务 → NFTI）
- **机制**：PatPlayer 签 HMAC ticket（`GET /api/learn/nfti-ticket`，含 tiny_id+pat_sid+5min 过期）→ 前端跳 `https://nfti.weaxi.cn/?pat_ticket=...` → NFTI 校验后建"借用会话"
- **借用会话**：NFTI 会话的 `cliHome` 指向 docker 只读挂载的 PatPlayer 会话目录 `/patplayer-sessions/<sid>`（复用真实 QQ token，**无需重新扫码，不违反单设备登录**——token 从不改变）
- **完成判定**：`GET /api/learn/nfti-status` 直查 nfti 库 `test_results WHERE tiny_id=? AND assessment_type='nfti'`（PatPlayer 的 DB 账号被授权只读 nfti 库）；有记录 → 前端自动标记任务完成
- 未 QQ 登录（无 tiny_id）：前端提示必须 QQ 登录，ticket 接口拒绝
- **注意**：借用会话拥有与本人扫码登录**完全等价**的权限（含管理员/发帖）——这是设计意图，不是漏洞

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
18. **前端文件无构建步骤**：改 `public/` 下 JS/CSS 后只需 `pm2 restart patplayer`（静态文件直接伺服），但**改了 index.html 的 script 引用必须同步**（新增 JS 文件要加 `<script>` 标签）
19. **NFTI 是 Docker 部署**：改 NFTI 代码要 `docker compose -f /home/nfti/NF-BTI/docker-compose.yml up -d --build <服务>`。**前端由 nginx 容器托管，改前端必须 rebuild nginx 服务**（光 rebuild backend 前端不生效——本 session 踩过）
20. **CSS 编辑风险**：SEARCH/REPLACE 误删选择器行（`.empty {` 的规则体被吞）会导致全站空态样式丢失；改完 grep 确认 `.empty`/`.spinner` 等关键规则完整
21. **logo 用外链 CDN 会卡加载**：腾讯图片 CDN（groupprohead.gtimg.cn）在部分网络下慢/被墙，已本地化到 `public/img/logo.png` 并加 `onerror` 降级为"南"字
22. **nginx 413 拦截**：超 200MB 文件被 nginx `client_max_body_size 200m` 拦截返回 HTML 413（前端解析失败显示"请求失败 (413)"）；前端已做上传前预检（大小上限从 `/api/auth/me` 下发）+ api.js 对 413 给固定中文文案
23. **证书 www 子域**：证书 SAN 已含 `www.pat.weaxi.cn`（重签），nginx 配置 www → 301 归一化到不带 www；`deploy/pat.weaxi.cn.conf` 是源，改完 `cp` 到宝塔目录 + `nginx -t && reload`
24. **`middleware/auth.js` 的 SELECT 必须包含新列**：加 `points` 列时若漏查，`req.user.points` 恒 undefined → 排行榜 `me.points` 恒 0（积分榜显示错误）。加列后同步 middleware SELECT
25. **任务上报失败要可见**：前端 `reportTask` 不能静默吞错（`catch {}`）——失败时按钮已置灰但服务端没记录，用户以为完成了。失败要 toast + 回滚按钮状态允许重试
26. **`poll` 的 `token_obtained` 快捷分支要检查 tiny_id**：已授权但 tiny_id 反查失败时，下一次 poll 不能直接返回 `authorized`（会弹 bind 表单 → bind 又报错），必须重查 tiny_id，仍失败返回 `pending_authorization` + 明确错误
27. **B站视频链接获取**：`search.bilibili.com` 直接 curl 会被反爬（412），需带浏览器 UA + Referer；`api.bilibili.com/x/web-interface/view?bvid=` 可验证 BV 有效性（标题/时长/UP主）。教程任务里的 BV 号失效需更新 `seed-articles.js` 重跑

## 9. 部署环境

- 服务器：`49.232.252.213`（腾讯云轻量，宝塔面板，**本沙箱就是这台服务器**）
- 域名：`pat.weaxi.cn`（DNS 指向本机；同机还有 greendoc/speak/nfti 等站点，**勿动**）
- **PM2**：服务名 `patplayer`（`server/index.js`，监听 127.0.0.1:3001）
- **nginx**：`/www/server/panel/vhost/nginx/pat.weaxi.cn.conf`（反代 3001，`client_max_body_size 200m`）
- **SSL**：certbot webroot 模式（`/var/www/certbot`），证书 `/etc/letsencrypt/live/pat.weaxi.cn`（SAN 含 www）
- **NFTI**：`/home/nfti/NF-BTI`（Docker，backend 9000 + nginx 8081→80），与 PatPlayer 共享 MySQL、共享频道；**backend 容器只读挂载 `/home/PatPlayer/storage/qq-sessions → /patplayer-sessions:ro`**
- `.env`（生产，已 gitignore）：`NODE_ENV=production`、强随机 `TOKEN_SECRET`、DB 连接、**`PAT_TICKET_SECRET`（与 NFTI docker-compose 一致）+ `NFTI_DB_*` 只读连接**

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

# 重写学AI 教程（seed-articles.js 是唯一数据源）
node seed-articles.js

# 重建 NFTI（跨站体验依赖它）
docker compose -f /home/nfti/NF-BTI/docker-compose.yml up -d --build backend
docker compose -f /home/nfti/NF-BTI/docker-compose.yml up -d --build nginx   # 前端改动必须重建这个

# 查积分/任务
mysql -h127.0.0.1 -upat -pWtfAYXjWMkJi78WM pat -e "SELECT id,real_name,points FROM users ORDER BY points DESC;"
mysql -h127.0.0.1 -upat -pWtfAYXjWMkJi78WM pat -e "SELECT * FROM points_log ORDER BY id DESC LIMIT 20;"
```

## 11. 已知待办 / 风险

- **QQ 扫码完整链路**（poll-token → tiny_id → bind）需真人扫一次码验证（沙箱无法模拟）；**NFTI 借用会话的 CLI 调用（发帖等）也依赖真实 token，同样需真人扫码后验证一次**
- **auto-scan 较慢**：串行跑最多 24 个 python 子进程（首次几十秒），已加限流 5 次/分钟
- **`share_resolve.py` 依赖 QQ 反爬策略**：QQ 换反爬会失效，需重新逆向
- **无 QQ 直通是自报身份、无鉴权**：可冒名（产品取舍）；NFTI 体验任务强制 QQ 登录规避了该问题
- **NFTI 借用会话依赖 PatPlayer 会话存活**：PatPlayer 30 天闲置回收会连带 NFTI 借用失效（提示重新登录，符合预期）
- **跨站 ticket 安全**：HMAC + 5min 过期 + 16 位 hex pat_sid 白名单 + 常量时间比较；密钥在两边 .env，勿泄露/勿改一侧
- `feed_links.py` 提取正则依赖轻应用链接格式，变了需更新
- **B站视频链接**是教程任务的一部分，若失效需替换 `seed-articles.js` 中 BV 号并重跑

## 12. 下一步建议

- **上线前必须真人验证**：QQ 扫码 → 绑定（含展示名授权表单）→ 自动识别轻应用 → 第1章 NFTI 体验任务全链路
- 若 PatPlayer 要独立 QQ 频道（不用南方中学频道），改 `.env` 的 `GUILD_ID`（会连带 NFTI 跨站失效，两边都要改）
- 若要给"无 QQ 直通"加防冒名，可参考 NFTI 的邀请码 + 设备指纹方案
- NFTI 项目 `/home/nfti/NF-BTI`，QQ 集成思路同源；跨站体验的 import-session/cliHome 机制在其 backend/server.js 中
