# PatPlayer 功能清单

> 来源仓库：`github.com/CookieTZH/PatPlayer`（main @ `54784b3`，v2.0.0）
> 生成日期：2026-08-13

## 项目概况

高中 AI 社团**作品收集与展示平台**。当前仓库为 **Netlify 重构版**：Astro 4（server 输出）+ Netlify Functions + Netlify Blobs，UI 用 MDUI2，Tailwind 样式，无外部数据库（Supabase 已移除）。

> ⚠️ 注意：线上 pat.weaxi.cn 跑的是 **v1（Express + MySQL + PM2，3001 端口）**，与本仓库 v2 架构完全不同（v2 无 `server/` 目录、无 MySQL 依赖）。本清单基于 v2 代码。

## 一、认证与账户系统（netlify/functions/auth.mjs + src/pages/index.astro）

| 功能 | 说明 | 位置 |
| --- | --- | --- |
| 注册 | 班级 + 真实姓名 + 学号后4位；初始密码 `123456`，注册即自动登录 | auth.mjs:92 |
| 登录 | 校验班级/姓名/学号后4位/密码（scrypt 加盐哈希比对） | auth.mjs:75 |
| Token 签发 | HMAC-SHA256 签名（TOKEN_SECRET），`base64url`，**24h 过期**，Bearer 头携带 | auth.mjs:30 |
| 当前用户查询 | `GET /api/auth/me` | auth.mjs:108 |
| 修改密码 | 需旧密码，新密码≥4位 | auth.mjs:114 |
| 班级白名单 | 高二 2501–2524（24班）、高一 2601–2625（25班） | auth.mjs:6 |
| 登录/注册页 | 表单模式切换、班级下拉加载、成功跳转 dashboard | index.astro |

## 二、个人文件管理（netlify/functions/files.mjs + src/pages/dashboard.astro）

| 功能 | 说明 | 位置 |
| --- | --- | --- |
| 上传 | 前端转 base64 后 POST，按 `班级/姓名/文件名` 存 Blobs，并记录元数据（大小/类型/时间） | files.mjs:71 |
| 扩展名白名单 | 约 40 种：图片/视频/音频/Office/压缩包/代码/3D 文件 | files.mjs:7 |
| 文件列表 | 仅列本人文件，含大小、上传时间 | files.mjs:92 |
| 下载 | `GET /api/files/download?filename=` | files.mjs:121 |
| 删除 | 二次确认弹窗，删 Blob + 元数据 | files.mjs:110 |
| 上传交互 | 拖拽/点击多文件、进度条（按文件数）、失败跳过继续 | dashboard.astro |
| 修改密码入口 | 导航栏锁图标打开对话框 | dashboard.astro |

## 三、班级作品墙（netlify/functions/class.mjs:42 + src/pages/class-wall.astro）

- 同班全部同学提交，按姓名分组卡片，文件按上传时间倒序，显示每人文件数、最后提交时间
- 搜索框：按**同学姓名或文件名**实时过滤
- 每个文件带下载按钮
- 可见范围：**仅自己班级**（"同班同学可互相查看"）

## 四、全校提交总览（netlify/functions/class.mjs:100 + src/pages/overview.astro）

- 统计卡片：总班级数 / 有提交班级数 / 总文件数 / 总大小
- 每班卡片：学生数、文件数、总大小；每位学生行内展示文件数、总大小、最近提交，可展开查看文件明细

## 五、全局框架（src/layouts/Layout.astro + src/components/NavBar.astro）

- 全局工具函数：`logout` / `formatSize` / `formatTime` / `getFileIcon`（按扩展名映射 MDUI 图标）
- 响应式导航：移动端底部 app bar，桌面端左侧 rail，三入口（我的文件/班级作品墙/提交总览）
- 导航栏显示当前用户（`班级班 姓名`），token 失效自动跳回登录页

## 六、部署与配置

| 项 | 值 |
| --- | --- |
| 构建 | `npm run build` → `dist/`，Astro `output: server` + Netlify adapter（astro.config.mjs） |
| API 路由 | `/api/*` 重定向到 Netlify Functions（netlify.toml） |
| 存储 | Netlify Blobs 三个 store：`patplayer-users`（账户）、`patplayer-files`（二进制）、`patplayer-files-meta`（元数据） |
| 环境变量 | `TOKEN_SECRET`（有硬编码默认值） |

---

## ⚠️ 代码中已核实的问题（待修复）

1. **dashboard.astro 6 处中文乱码**（U+FFFD 替换字符），其中 3 处是**硬 JS 语法错误**：L101（列表渲染后残留垃圾字符串）、L213（`'文件已删�?` 引号未闭合）、L241（`'新密码至�?`），另 3 处文案损坏（L167/190/200）——该页面脚本大概率直接崩溃
2. **overview.astro:170 残留垃圾 HTML** `<tbody>${studentRows}</tbody>` 混在 `<script>` 里 → 语法错误，总览页 JS 失效
3. **下载功能前后端不匹配**：两个页面都用 `?token=` 传参（dashboard.astro、class-wall.astro:161），但后端只认 `Authorization` 头（files.mjs:54），且 **class.mjs 没有 download 路由**（switch 只有 wall/overview）→ 班级墙下载 404、个人下载 401
4. **overview 最近提交时间字段名错误**：前端读 `uploaded_at`，后端返回 `uploadedAt` → 一直显示 `-`
5. **UI 宣称"最大500MB"，但 Netlify 同步函数请求体上限约 10MB**（且 base64 膨胀 33%）→ 大文件上传实际会失败
6. 注册完全开放、默认密码 `123456`、无速率限制；`TOKEN_SECRET` 有硬编码默认值（生产有被伪造 token 风险）
7. README 的 Troubleshooting 已过时（Layout.astro 重复闭合标签、index.astro 重复脚本——最新两个 commit 已修复）
