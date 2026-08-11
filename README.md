# PatPlayer

> 高中 AI 社团作品收集管理系统

基于 **Astro + MDUI2 + Netlify + Supabase** 构建的轻量级作品提交与展示平台。学生可通过邮箱注册登录，拖拽上传作品文件，浏览同班同学的作品墙，查看全校提交总览。

---

## 技术栈

| 层 | 技术 |
|---|------|
| 前端框架 | [Astro](https://astro.build/) (SSR 模式) |
| UI 组件库 | [MDUI2](https://www.mdui.org/) (Material Design 3) |
| 样式辅助 | Tailwind CSS |
| 部署平台 | [Netlify](https://netlify.com) |
| 认证服务 | [Supabase Auth](https://supabase.com/auth) |
| 数据库 | Supabase PostgreSQL |
| 文件存储 | Netlify Blobs |
| API 层 | Netlify Functions |

---

## 功能列表

- **身份认证** — 邮箱注册 / 登录，绑定班级、姓名、学号
- **拖拽上传** — 支持多文件，实时进度条，扩展名白名单
- **文件管理** — 查看、下载、删除个人文件
- **班级作品墙** — 浏览同班同学提交，支持搜索过滤和下载
- **提交总览** — 全校按班级-姓名层级展示，统计卡片
- **安全防护** — RLS 权限隔离，Token 认证，路径遍历防护

---

## 快速开始

### 前置要求

- Node.js 18+
- [Supabase](https://supabase.com) 账号（免费套餐即可）
- [Netlify](https://netlify.com) 账号

### 本地开发

```bash
# 1. 克隆仓库
git clone https://github.com/YOUR_USERNAME/PatPlayer.git
cd PatPlayer

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 填入 Supabase 凭据

# 4. 启动开发服务器
npm run dev
```

浏览器访问 `http://localhost:4321`

### 环境变量

创建 `.env` 文件：

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
```

---

## 部署

### 1. Supabase 设置

在 Supabase SQL Editor 中执行 `supabase/schema.sql`，创建以下表：

- `profiles` — 用户扩展信息（班级、姓名、学号）
- `file_meta` — 文件元数据

### 2. Netlify 部署

1. 将代码推送到 GitHub
2. 在 Netlify 中 Import from Git → 选择仓库
3. 设置环境变量（同 `.env.example`）
4. 部署完成后绑定自定义域名

详细步骤见 [DEPLOY.md](./DEPLOY.md)

---

## 项目结构

```
PatPlayer/
├── src/
│   ├── layouts/Layout.astro      # 全局布局（MDUI2 引入）
│   ├── components/NavBar.astro   # 导航栏（顶部栏 + 侧边栏 + 底部栏）
│   └── pages/
│       ├── index.astro           # 登录/注册页
│       ├── dashboard.astro       # 个人文件管理
│       ├── class-wall.astro      # 班级作品墙
│       └── overview.astro        # 提交记录总览
├── netlify/
│   └── functions/
│       ├── auth.mjs              # 认证 API（注册/登录/获取用户）
│       ├── files.mjs             # 文件 API（上传/列表/删除/下载）
│       └── class.mjs             # 班级 API（作品墙/总览）
├── supabase/
│   └── schema.sql                # 数据库建表语句
├── scripts/                      # 旧版部署脚本（内网版保留）
├── astro.config.mjs              # Astro 配置（Netlify SSR 适配器）
├── netlify.toml                  # Netlify 部署配置
└── .env.example                  # 环境变量模板
```

---

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/auth/me` | 获取当前用户 |
| POST | `/api/files/upload` | 上传文件 |
| GET | `/api/files/list` | 文件列表 |
| POST | `/api/files/delete` | 删除文件 |
| GET | `/api/files/download` | 下载文件 |
| GET | `/api/class/wall` | 班级作品墙 |
| GET | `/api/class/overview` | 提交总览 |

---

## License

MIT
