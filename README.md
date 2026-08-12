# PatPlayer

高中 AI 社团作品收集与展示平台 — 适合部署在云端的轻量级学生作品提交与管理系统。

核心目标：为班级/年级提供一个简单、安全的作品提交入口与班级作品墙，支持拖拽上传、多文件、按班级/姓名浏览与下载。

状态
- 当前仓库基于 Astro + MDUI2 + Netlify Serverless（Netlify Functions + Netlify Blobs）。项目已经移除了 Supabase，存储与用户信息均使用 Netlify Blobs 实现；README 已更新以匹配当前代码结构与运行方式。
- 注意：仓库中存在几个会导致本地/CI 构建失败的重复/多余代码（详见 Troubleshooting）。在合并部署前请先修复这些问题或让我代为修复。

主要特性
- 学生注册/登录（班级 + 姓名 + 学号后4位，基于 Netlify Blobs 的本地账户系统）
- 拖拽批量上传文件，上传进度与文件管理（查看、下载、删除）
- 班级作品墙与全校提交总览（按班级→姓名 分层）
- 简单的 Token 认证与访问控制（Netlify Functions 端）
- 可部署到 Netlify（静态 + Netlify Functions）；无需外部数据库（Supabase 已移除）

技术栈
- 语言：Astro (页面模板) + JavaScript
- 运行/框架：Astro v4.x（Netlify adapter）
- 关键依赖：@astrojs/netlify、@astrojs/tailwind、mdui、@netlify/blobs、tailwindcss
- 部署：Netlify（前端 + Functions），数据/用户信息使用 Netlify Blobs

快速开始（本地开发）
前置：
- Node.js 18+（推荐 18/20）
- npm 或 pnpm
- Netlify 账号（若要部署）

克隆并运行：
```bash
git clone https://github.com/CookieTZH/PatPlayer.git
cd PatPlayer
npm install
# 将环境变量复制并编辑
cp .env.example .env
# 填入 TOKEN_SECRET 或在 Netlify 环境变量中设置
npm run dev
```

默认本地地址： http://localhost:4321

构建与预览：
```bash
npm run build
npm run preview
```

必需环境变量
在仓库根目录创建 `.env`（或在 Netlify 中设置相应环境变量）：
```env
# 用于 HMAC token 的签名密钥；生产环境请设置为强随机值
TOKEN_SECRET=your-random-secret-change-me
```

存储与数据库说明
- 本项目当前不依赖外部数据库。用户账号、文件元数据与二进制文件均存储在 Netlify Blobs（通过 @netlify/blobs 的 getStore API）。
- 如果你希望迁移到 Supabase / Postgres 或其他数据库，请告知，我可以帮忙迁移并同步更新函数代码与 README。

Netlify 部署（简要）
1. 将代码推送到 GitHub。  
2. 在 Netlify 中选择 “Import from Git” → 选择本仓库。  
3. 设置构建命令：`npm run build`，发布目录：通常为 `dist`（如有差异请确认 Astro 输出目录）。  
4. 在 Netlify 的环境变量设置中填入 TOKEN_SECRET（或其他自定义变量）。  
5. 若使用 Netlify Functions，请确认 `netlify/` 目录及 `netlify.toml` 配置正确。

项目结构（概览）
```
src/
  layouts/        全局布局（MDUI2 引入、全局工具函数）
  pages/          页面 (index.astro 登录页、dashboard 等)
  components/     可复用组件（按钮、列表等）
netlify/
  functions/      Serverless API（auth/files/class 等，使用 Netlify Blobs）
astro.config.mjs Astro 配置（Netlify adapter）
netlify.toml     Netlify 部署配置
.env.example     环境变量模板
package.json
```

如何贡献 / 修改
- 若要修复 UI 或后端逻辑，建议在分支上提交改动并创建 PR，CI 通过后合并。
- 我可以帮助提交 README 的改动，或修复仓库中明显导致编译失败的问题并创建 PR。

Troubleshooting（需要优先修复的两处）
1. src/layouts/Layout.astro 中存在重复的闭合标签（两个 `</body></html>`），请保留一组闭合标签并删除多余部分，重复闭合会导致 SSR/构建问题。文件路径：`src/layouts/Layout.astro`。

2. src/pages/index.astro 包含重复与冲突的 `<script>` 内容（页面内部有两份相似/重复的脚本段落与重复的 DOM 操作），这会导致运行时错误或编译失败。请合并脚本逻辑并删除重复段落，确保每个 DOM 元素仅被定义/监听一次。文件路径：`src/pages/index.astro`。

许可
- MIT

附录：仓库中主要文件（快速参考）
- package.json — 脚本：dev/build/preview；依赖列在其中
- astro.config.mjs — Astro 配置
- netlify.toml — Netlify 部署设置
- netlify/functions/*.mjs — 认证与文件 API（基于 Netlify Blobs）
- src/layouts/Layout.astro — 全局布局（含全局工具函数）
- src/pages/index.astro — 登录/注册页面（含前端表单与脚本）
