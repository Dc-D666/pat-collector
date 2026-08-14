# PatPlayer 管理后台设计文档（v1 草案，待审批）

> 状态：**设计已审批**（2026-08-14，5 项决策确认），待按「实施顺序」分阶段实现。
> 目标读者：站点运营者（频道主/老师）。技术栈沿用现有：Express + MySQL + 原生 SPA，零新依赖。

---

## 1. 背景与目标

现状：所有运营动作（审核、删文件、改积分、管教程、看统计）只能靠**直接改数据库 / 跑脚本**，没有可视化入口。管理后台要解决：

- 内容审核（DeepSeek 自动审 + 人工兜底）可视化
- 用户 / 文件 / 轻应用 / 积分的日常运营
- 教程（学AI）在线编辑（不再只能改 `seed-articles.js`）
- 存储 / 会话 / 商城置顶等运维操作
- 管理员操作留痕（审计）

原则：**轻量、够用、不引入新依赖**；与现有「QQ 登录为主」的信任模型一致；所有管理动作记审计日志。

---

## 2. 管理员身份与登录（P0）

| 项 | 设计 |
| --- | --- |
| 身份标志 | `users.is_admin TINYINT(1) DEFAULT 0`（DB 迁移，`init-db.js` 补列） |
| 登录方式 | **仅 QQ 扫码登录**可成为管理员（访客/直传身份永不为管理员） |
| 引导授权 | 环境变量 `ADMIN_QQ_TINY_IDS`（逗号分隔）：QQ 绑定时 tiny_id 命中 → 自动置 `is_admin=1`（**首个管理员引导**） |
| 授权他人 | 已是管理员者，可在「用户管理」里给其他 QQ 用户开/关管理员（记审计） |
| 鉴权中间件 | `server/middleware/admin.js`：`requireAdmin`（先 requireAuth 再查 `is_admin`，非管理员 403） |
| 会话 | 复用现有 Bearer token；管理接口 401/403 与普通接口一致 |
| 审计 | `admin_log` 表：admin_id、action、target 类型/id、detail(JSON)、ip、created_at；**所有写操作**落库 |

**前端入口**：导航仅对 `is_admin` 用户显示「🛠 管理后台」；直接访问 `#/admin*` 非管理员重定向回首页。

---

## 3. 整体架构

```
后端：server/routes/admin/*.js（按模块拆分）→ 全部 requireAdmin
      server/middleware/admin.js      requireAdmin
      server/utils/adminLog.js        writeAdminLog(adminId, action, target, detail)
前端：public/js/admin.js              管理后台视图（哈希路由 #/admin/*）
      public/js/app.js                admin 路由注册 + 导航入口（仅管理员可见）
DB  ：users.is_admin 列 + admin_log 表 + settings 表（运行时开关）
```

管理接口统一前缀 `/api/admin/`，全部走 `requireAdmin` + 审计。

---

## 4. 模块设计

### 4.1 仪表盘（P0）
- 统计卡片：用户总数 / 今日新增 / 文件总数 / 今日上传 / 轻应用数 / 积分总量
- 存储：已用总空间、磁盘剩余（复用 `utils/disk.js`）、人均 / 班级 TOP
- 待办：待审核文件数（`audit_status='pending'`）、违规标记数（`flagged`）、今日上传次数告警
- 活跃度：近 7 天每日上传数、注册数（简单折线或表格）

### 4.2 内容审核（P0）
- 队列：`GET /api/admin/audit?status=pending|flagged|reviewed`
- 每条：文件信息 + 作者 + `audit_reason`（DeepSeek 拒绝原因）+ 预览（HTML）或下载
- 操作：**通过**（置 reviewed）/ **拒绝**（置 flagged + 填原因，**回扣 +50 积分**，同删除逻辑）/ **删除文件**（落盘+记录+回扣）
- 说明：DeepSeek 可用时大部分自动过；此队列是人工兜底（AI 超时降级为 pending 的、被判违规的）

### 4.3 文件管理（P0）
- 列表/搜索：按 标题/文件名/作者/班级/类型/审核状态/时间
- 查看元数据（存储名、大小、mime、audit_reason）；HTML 预览（管理员直读落盘）；下载
- 操作：补/改作品信息（标题/简介/玩法）、删除（回扣积分）、改审核状态
- 每用户存储汇总（占用、配额 2GB 进度条）

### 4.4 用户管理（P0）
- 列表/搜索：班级/姓名/昵称、QQ 绑定与否、访客与否、积分排序
- 每行汇总：文件数、应用数、占用空间、今日上传次数（upload_log）、积分
- 操作：**调整积分**（±N + 原因，走 grant/revoke 幂等）、**设为/取消管理员**（仅 QQ 用户）、**重置访客删除密码**（置回默认，提示用户）、**停用/恢复用户**（`users.status='disabled'`，停用后无法登录/直传登记/继续上传，已有文件保留可下载，待管理员处理）、**删除用户**（级联删文件/应用/流水，需二次确认+审计）
- 禁止：展示 `guest_pwd_hash`（哈希不可逆，只允许重置）

### 4.5 访客直传管理（P1）
- 列表：`guest_token IS NOT NULL` 的用户，显示令牌、班级、姓名/昵称、占用、今日上传
- 操作：重置删除密码、删除其文件、停用/恢复（同 4.4）
- 支持按令牌前缀搜索（帮助用户找回地址）

### 4.6 积分管理（P1）
- 排行榜（复用现有逻辑）+ 按用户查流水（`points_log`）
- 手动发放/扣减：原因下拉（活动/补偿/违规扣回…）+ 备注，幂等 ref_id 由系统生成
- 流水搜索：用户/原因/时间段

### 4.7 AI 轻应用管理（P1）
- 列表/搜索：标题/链接/作者/来源帖子
- 操作：删除（回扣 +25，对齐 app 删除规则——**当前 app 删除未回扣，此处在管理端补上**）、查看来源

### 4.8 学AI 教程管理（P2）
- 章节列表 + 文章 CRUD（slug、chapter、title、summary、**Markdown 正文**、tasks JSON 编辑器——简单做法：textarea + 校验 JSON、排序）
- 保存即写库（幂等按 slug upsert，不动学员 `task_progress`/积分）；保留 `seed-articles.js` 作为初始种子，管理端编辑后以库为准
- 提供「预览渲染」按钮（复用前端 Markdown 渲染器）

### 4.9 运营与商城（P1）
- 置顶管理：当前生效的 `purchases`（wall_top/app_top/app_essence/title），手动置顶/取消、手动过期
- 称号管理：发放/撤销专属称号（title 类 purchase，30 天）
- 商城开关：`settings` 表存 `shop_enabled`，**仅后台开关，前端入口暂不上架**（保持现状）；开关随时可翻，未来上架时前端读该值

### 4.10 存储与运维（P1）
- 存储：按班级/用户空间排行、磁盘剩余、大文件 TOP（>100MB 列表）
- QQ 会话：`storage/qq-sessions/index.json` 列表现有会话（用户、最后活跃、失效状态），可标记失效/清理
- 任务状态：`jobs.js` 置顶/精华回收运行状态、最近一轮执行时间
- 上传日志：按天/用户查询 upload_log

### 4.11 系统设置（P2）
- `settings` 表（key/value，运行时生效，**不重启**）：
  - 审核开关（DEEPSEEK_AUDIT 运行时版）、上传每日上限、访客每日上限、上传白名单追加、商城开关、内测横幅文案
- 环境级配置（TOKEN_SECRET/DB 等）**只读展示**，不提供修改

### 4.12 操作审计（P1）
- `admin_log` 表：管理员在后台的每次写操作（谁、何时、对什么、做了什么、IP）
- 后台页面：按管理员/时间/操作类型检索；只读

---

## 5. 接口清单（/api/admin/*）

| 方法 | 路径 | 模块 |
| --- | --- | --- |
| GET | `/api/admin/stats` | 仪表盘 |
| GET | `/api/admin/audit` | 审核队列 |
| POST | `/api/admin/audit/:id/review` | 审核：通过/拒绝(+原因)/删除 |
| GET | `/api/admin/files` | 文件管理（搜索分页） |
| PATCH | `/api/admin/files/:id` | 改作品信息/审核状态 |
| DELETE | `/api/admin/files/:id` | 删除（回扣积分） |
| GET | `/api/admin/users` | 用户管理（搜索分页+汇总） |
| POST | `/api/admin/users/:id/points` | 调整积分 |
| POST | `/api/admin/users/:id/admin` | 设置/取消管理员 |
| POST | `/api/admin/users/:id/status` | 停用/恢复用户（disabled/active） |
| POST | `/api/admin/users/:id/guest-pwd-reset` | 重置访客删除密码 |
| DELETE | `/api/admin/users/:id` | 删除用户（级联） |
| GET | `/api/admin/apps` | 轻应用管理 |
| DELETE | `/api/admin/apps/:id` | 删除轻应用（回扣） |
| GET/POST/PATCH/DELETE | `/api/admin/articles[/:id]` | 教程 CRUD |
| GET | `/api/admin/purchases` | 置顶/称号/精华管理 |
| POST | `/api/admin/purchases/:id/expire` | 手动过期 |
| GET | `/api/admin/storage` | 存储/会话/上传日志 |
| POST | `/api/admin/sessions/:id/invalidate` | 使 QQ 会话失效 |
| GET/PUT | `/api/admin/settings[/:key]` | 运行时设置 |
| GET | `/api/admin/logs` | 审计日志 |
| GET | `/api/admin/points/leaderboard` | 积分排行（管理视角） |
| GET | `/api/admin/points/logs` | 积分流水检索 |

---

## 6. 数据库变更

```sql
-- users 加管理员标志 + 停用状态
ALTER TABLE users ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0 COMMENT '管理员（仅 QQ 登录用户可为）';
ALTER TABLE users ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT 'active / disabled（停用：禁登录/上传）';

-- 管理操作审计
CREATE TABLE IF NOT EXISTS admin_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  admin_id INT NOT NULL COMMENT '操作管理员 user_id',
  action VARCHAR(64) NOT NULL COMMENT '如 user.points.adjust / file.delete',
  target_type VARCHAR(16) NOT NULL DEFAULT '',
  target_id INT NOT NULL DEFAULT 0,
  detail VARCHAR(1000) NOT NULL DEFAULT '' COMMENT 'JSON 备注',
  ip VARCHAR(64) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_admin (admin_id), KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 运行时设置（P2 起用，商城开关 P1 就用）
CREATE TABLE IF NOT EXISTS settings (
  skey VARCHAR(64) PRIMARY KEY, svalue VARCHAR(500) NOT NULL DEFAULT '', updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

迁移沿用 `init-db.js` 的 information_schema 判断模式（存量库兼容）。

**停用（disabled）生效点**：`requireAuth`/`requireAdmin` 加载用户时校验 `status`（disabled → 401「账号已停用」）；访客登记/上传/下载/删除接口同样校验；已登录会话下次请求即失效。已有文件保留（可被下载），作品展仍展示（管理员可删）。

---

## 7. 前端设计

- 同一 SPA 内新哈希路由：`#/admin`（→overview）、`#/admin/users`、`#/admin/files`、`#/admin/audit`、`#/admin/apps`、`#/admin/articles`、`#/admin/points`、`#/admin/ops`、`#/admin/settings`、`#/admin/logs`
- 布局：沿用左 rail + 顶栏；管理页内有次级 tab 导航（模块切换）
- 入口：导航「🛠 管理后台」（仅 `API.getUser().is_admin` 显示）；非管理员访问 `#/admin*` 弹提示并跳回
- 新文件 `public/js/admin.js`，`index.html` 加 script 标签（记得版本号 +1）
- 所有管理操作：二次确认弹窗（删除/调整积分/重置密码）、结果 toast；失败显示服务端错误

---

## 8. 安全设计

- 全部管理接口 `requireAdmin`：Bearer 校验 + `is_admin=1`，非管理员 403
- 管理员**仅能由 QQ 登录身份**获得（`ADMIN_QQ_TINY_IDS` 引导或管理员授权），访客/直传身份永远不是管理员
- 停用（disabled）用户：登录/登记/上传/下载/删除一律拒绝（401「账号已停用」），管理端可见并可恢复
- 所有写操作写 `admin_log` 审计（含 IP），可追溯
- 敏感操作（删用户/删文件/调积分/停用）二次确认 + 限流
- 不展示 `guest_pwd_hash`（哈希不可逆，只能重置）；管理接口不返回 token/密钥类字段
- 管理页复用现有 XSS 防护（escapeHtml、CSP sandbox 预览）

---

## 9. 实施顺序

- **P0（核心可用）✅ 2026-08-14 已实现**：admin 鉴权（`users.is_admin`/`status` + `ADMIN_QQ_TINY_IDS` 引导 + `requireAdmin` + `admin_log` 审计）→ 仪表盘（stats）→ 用户管理（搜索/调分/授权/停用/重置密码/删除）→ 文件管理（搜索/编辑/删除）→ 内容审核（通过/拒绝/删除）→ 前端 `#/admin*` 管理台（总览/用户/文件/审核四页）
- **P1（日常运营）✅ 2026-08-14 已实现**：积分管理（排行榜 + 流水检索）→ 轻应用管理（列表/删除回扣 25）→ 访客管理（token 前缀搜索）→ 运营（purchases 列表/手动过期/免费置顶/称号发放/`settings` 商城开关）→ 存储与会话（按班级占用/大文件/会话失效）→ 审计页（admin_log 检索）→ 审核重新通过补发积分；前端 `#/admin*` 扩至 9 页
- **P2（增强）✅ 2026-08-14 已实现**：教程在线编辑（articles CRUD + tasks JSON 校验 + Markdown 预览，库为准）→ 系统设置（`settings` 表运行时开关：`audit_enabled` 覆盖 AI 审核、`shop_enabled`；30s 缓存写后即失效）→ 批量操作（审核页勾选批量通过/删除，回扣/补发积分一致）；前端 `#/admin*` 扩至 11 页（含教程/设置）

---

## 10. 已确认决策（2026-08-14 审批通过）

1. **首个管理员引导**：环境变量 `ADMIN_QQ_TINY_IDS` 白名单（QQ 登录命中自动 `is_admin=1`），已确认
2. **商城**：后台只做开关（`settings.shop_enabled`），前端入口暂不上架，已确认
3. **用户停用**：增加 `users.status`（active/disabled），停用后禁登录/登记/上传，已有文件保留，已确认
4. **教程数据源**：管理端在线编辑后以库为准，`seed-articles.js` 仅作初始种子，已确认
5. **入口形态**：同一 SPA 内 `#/admin` 路由，导航仅管理员可见，已确认
