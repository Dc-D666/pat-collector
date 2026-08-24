# 「AI 小学堂」章节结构调整 · 开发计划与方案

> 版本：v1.0（2026-08-25）
> 背景：腾讯频道 AI 轻应用创建功能下架（通知 https://pd.qq.com/s/7rfbjyjnj），原第2章「频道内一句话做轻应用」无法继续；借此机会将课程升级为更清晰的五级递进。
> 原则：**合理度优先、调整程度最小化**——章节总数、slug/id 体系、积分框架、毕业规则全部保持不变。

---

## 一、目标结构（新五章）

| 章 | slug | 定位 | 完成方式 | 任务核验 | 相对现状的改动 |
| --- | --- | --- | --- | --- | --- |
| 第1章 体验AI | `ai-intro` | AI 初识 + NFTI 人格测试 | NFTI 体验 + 答题 | `nfti` + `quiz` | **不动** |
| **第2章 最简单AI应用** | `ai-first-app` | 平台内「✨ 一句话生成小程序」，两三分钟做出第一个能玩的小程序 | 本站生成一个小程序 | 新 `genappcheck` | **重写正文/任务 + 新功能开发** |
| **第3章 独立AI小应用** | `ai-real-app` | 用扣子(Coze)/Trae 等专业 Agent 工具做独立项目并上传文件 | 上传项目文件 | `projectcheck`（排除 gen 来源） | **微调文案 + 核验口径小改** |
| **第4章 项目级AI应用**（选做） | `ai-project` | 项目级应用长什么样；GitHub 是什么、为什么用；可选把 GitHub 项目提交到本站(+25⭐)；进阶部署 | **纯答题**（不强制提交任何东西） | 仅 `quiz` ×2~3 | **整章改造（原 ai-deploy 部署章）** |
| 第5章 Skill/MCP | `ai-agent-skill` | Skill 与 MCP，装腾讯频道技能查 tiny_id | Agent 查 tiny_id 核验 | `tinyidcheck` | **不动** |

### 教学递进逻辑
1. 体验 AI（知道 AI 能干什么）
2. 一句话生成（零门槛做出第一个东西，**在本站内闭环**）
3. 专业 Agent 工具（扣子/Trae 等，做出**独立的**小应用，产物文件归自己）
4. 项目级思维（多文件、版本管理、开源协作 → GitHub；选修，重认知轻操作）
5. 调教 Agent（Skill/MCP 进阶）

### 关键设计决策（已确认）

| # | 决策 | 结论 |
| --- | --- | --- |
| D1 | 第2章实现方式 | **平台内自建「一句话生成」**（复用已有 GLM/DeepSeek API），学生免注册外部平台、免下载 |
| D2 | 生成模型 | 可配置切换 GLM / DeepSeek（环境变量），GLM 默认（glm-4.7-flash 免费档，繁忙自动回退） |
| D3 | gen-app 积分 | 生成的文件**不发** `file_submit` 积分；仅第2章 `genappcheck` 任务通过时发整章 `task` 积分（+15⭐，活动期 ×1.2） |
| D4 | 第4章完成条件 | 纯答题制，不强制 GitHub 提交；GitHub 提交作为**可选加分路径**（复用现有 `/api/links` 全套能力） |
| D5 | 第4章「选做」属性 | 保持 `OPTIONAL_CHAPTERS = [4]` 不变；注意：**毕业判定仍要求第4章任务+阅读完成**（现有口径，与现状一致，不改） |
| D6 | 数据兼容 | 所有文章 id 不变（slug 迁移走一次性 SQL）；`task_progress` 按索引对齐设计 |

---

## 二、现状核实结论（已逐项对照代码）

| 事实 | 出处 | 对方案的影响 |
| --- | --- | --- |
| 教程完全由 `articles` 表驱动，seed 按 slug 幂等 upsert（UPDATE 保留 id） | `seed-articles.js:400-430` | 改内容只需改 seed 重跑；**但会覆盖后台在线编辑的手改**，上线流程要注意 |
| 任务进度按 `(user_id, article_id, task_index)` 存储 | `schema.sql:102-112` | 新旧任务数组要按 index 对齐设计（见 §六.3） |
| 选择题答案不下发前端、服务端判分 + 指数冷却防试错 | `routes/points.js:287+` | 第4章新 quiz 自动获得同等防护，无需额外开发 |
| `/api/points/task` 统一走 `verifyTaskCompletion`，quiz 类型被拒绝前置 | `routes/points.js:272-278` | 新增 `genappcheck` 只需在 `taskVerify.js` 加分支 |
| 第3章 `projectcheck` = 最近 14 天上传过任意 files | `learnStatus.js:getProjectSubmitted` | **必须排除 `source='gen'`**，否则学生在第2章生成的文件会误判为第3章完成 |
| HTML 上传管线：入库 pending → DeepSeek `reviewContent` 审查 → reviewed/flagged | `utils/upload.js:163-240` | gen-app 审查复用同一套状态流转 |
| 删除文件的积分回扣查不到流水时安全返回 null | `points.js:revokeInTx` | gen 文件无 `file_submit` 流水，删除不会误扣分，删除代码零改动 |
| 毕业判定 = 全部文章（含选修）task + read 齐全 → +40⭐ 一次性 | `routes/points.js:443-476` | 第4章改造后仍是「读完+答对」即可毕业，口径不变 ✓ |
| GitHub 基础设施完备：OAuth 连接、仓库下拉、GLM 生成简介、所有权验证、link_submit +25⭐（与 file_submit 合计上限 5） | `routes/github-oauth.js`、`routes/links.js` | 第4章「可选加分路径」零新开发，纯教材文案引导 |
| `OPTIONAL_CHAPTERS = new Set([4])` 前端硬编码 | `public/js/learn.js:7` | 第4章仍是选修，无需改 ✓ |
| 第5章 tinyidcheck 依赖的是频道 CLI（未下架）而非轻应用 | `taskVerify.js:54-61` | 第5章整体不动 ✓ |

---

## 三、各章改造明细

### 3.1 第1章（不动）
无改动。

### 3.2 第2章 `ai-first-app` —— 重写

**标题**：《一句话，做出你的第一个小程序》（slug/chapter 不变）

**正文大纲**：
1. 承接第1章「人出想法、AI 干活」：现在你只要一句话，AI 就能在**本站**直接生成一个带界面、有交互、能玩的小程序
2. **亲手做**：「我的项目」→「✨ 一句话生成小程序」，输入一句话（示例："做一个 5 以内加减法答题小游戏，每轮 5 题，答对加 1 分"）→ 点生成 → 约 30 秒~2 分钟得到预览
3. **把想法说具体**（保留原有 ❌太模糊 vs ✅很具体 的对比示例，场景从 QQ 频道换成本站生成框）
4. **预览与迭代**：不满意就补充需求重新生成；满意后填标题提交，作品进入「我的项目」（可预览/下载，也会出现在全校作品展）
5. 本章任务说明 + 配套演示视频/截图占位（**替换失效的 `videos/ch2-create-app.mp4`**，需录制本站生成功能的演示录屏或步骤截图）

**任务数组**（index 与旧版严格对齐，见 §六.3）：
- `index 0` — quiz《什么样的描述效果最好？》（沿用原题，微调选项措辞）
- `index 1` — action **`genappcheck`**：《生成你的第一个小程序》——在本站用一句话生成一个小程序并提交，点「我已生成」由系统核验生成记录

### 3.3 第3章 `ai-real-app` —— 微调（必改项）

虽然章节定位不变，但正文与频道轻应用强耦合，以下位置必须联动修改：

| 位置 | 现状 | 改为 |
| --- | --- | --- |
| 开头段 | "第 2 章你已经在频道里做出了第一个应用" | "第 2 章你用一句话生成了第一个小程序" |
| §1 局限性论述 | "频道轻应用的三个局限：模板化/功能受限/只在频道里" | "一句话快速生成的三个局限：代码不在你手里难迭代 / 功能深度有限 / 存不了数据、多文件项目做不了" |
| §3 工具表 | Trae / WorkBuddy / Codex | 增加**扣子 Coze**（网页版智能体平台，浏览器直接用、免下载，适合没装软件条件的同学）；Trae 仍是入门首选 |
| quiz 第1题 | "为什么说频道轻应用不能满足认真做项目的需求？" | "为什么说平台内一句话快速生成的小程序还不够，需要独立项目？"（考点同构，答案微调） |

**服务端核验修改**（`learnStatus.js`）：

```sql
-- getProjectSubmitted 增加来源过滤，防止第2章生成物冒充第3章成果
SELECT COUNT(*) AS cnt FROM files
WHERE user_id = ? AND source != 'gen'
  AND uploaded_at >= (NOW() - INTERVAL 14 DAY)
```

同步更新错误提示文案："请先到「我的项目」上传**用 Agent 工具做的**项目文件"。

### 3.4 第4章 `ai-deploy` → 《项目级AI应用：认识 GitHub》—— 整章改造（选修）

**slug 处理**：`ai-deploy` → `ai-project`。因 seed 按 slug 匹配 id，直接改名会导致旧行被删（进度级联丢失），所以**上线前执行一次性 SQL 改 slug（保留 id）**：

```sql
UPDATE articles SET slug = 'ai-project' WHERE slug = 'ai-deploy';
-- 之后 seed 中以 ai-project 条目维护，upsert 正常命中同一行
```

**正文大纲**：
1. 从「小应用」到「项目级」：多文件结构、持续迭代、多人协作、版本历史——这才是真实世界的软件形态
2. **认识 GitHub**：程序员的"家"
   - 仓库（repository）/ commit（存档点）/ 开源（open source）/ README（项目说明书）
   - 为什么全球程序员都用它：存档历史 + 协作 + 展示作品（求职/升学的作品集）
   - 我们社团的项目也托管在上面（PatPlayer 本身就是例子，可展示仓库页面）
3. **进阶玩法（可选）**：把你做好的项目提交到本站「我的项目 → GitHub 项目外链」——连接 GitHub 账号 → 选择公开仓库 → 系统自动生成名称简介 → 验证所有权后 +25⭐（配一张流程截图）
4. **发布上线（压缩保留原部署精华）**：Cloudflare Pages 免费部署一节 + 原 B站视频保留；云服务器路线一段带过
5. 本章任务：读完全文答题即可

**任务数组**（纯 quiz，无 action；建议 3 道）：
- quiz①：GitHub 上"仓库（repository）"指的是什么？
- quiz②：程序员使用 Git/GitHub 做版本管理的最主要好处是什么？（存档历史 + 可回退 + 便于协作）
- quiz③：（保留原题）想最快、免费地把一个静态网页项目发布上线，首选哪个？（Cloudflare Pages——衔接保留的部署节）

**明确不做**：不新增 GitHub 相关 action 任务、不强制 OAuth 连接、不改 `/api/links` 积分规则。

### 3.5 第5章（不动）
tinyidcheck 依赖的频道 CLI 未受轻应用下架影响。无改动。

---

## 四、核心新功能：「✨ 一句话生成小程序」技术方案

### 4.1 总体流程（两段式：暂存 → 提交）

```
学生输入 idea
    │ POST /api/gen/app {idea}
    ▼
[限流校验] → [并发信号量] → 大模型生成单文件 HTML
    │                          （GLM 默认 / DeepSeek 可切）
    ▼
提取校验（剥 markdown 围栏、<html>…</html> 完整性、大小 ≤ maxHtmlBytes）
    ▼
落盘 storage/tmp-gen/<userId>/<uuid>.html（30 分钟过期，jobs 定期清理）
    ▼
返回 { draft_token, preview_url }  ←── 前端 sandbox iframe 预览
    │
    ├─「重新生成」→ 回到开头（旧草稿自动作废清理）
    │
    ▼ 学生满意，填标题
POST /api/gen/commit {draft_token, title}
    │
    ├── 校验 draft_token 签名与归属、磁盘空间 ensureDiskSpace
    ├── 配额检查：每人文件总数 ≤20 / 总容量 ≤1GB（复用 upload 口径）
    ├── reviewContent(DeepSeek) 内容安全审查 ──违规──→ 400 + 删除草稿
    ▼ 通过
移入 storage/uploads/ + INSERT files(source='gen', audit_status='reviewed')
    │                    ★ 不发 file_submit 积分（决策 D3）
    ▼
返回 { file } → 出现在「我的项目」列表 / 全校作品展
```

**为什么采用「满意才落库」而不是「生成即入库」**：
- 反复试错不会吃掉每人 20 个文件 / 1GB 的配额；
- 中间草稿**不会提前出现在全校作品展**（落库即 reviewed 即上墙，草稿上墙是明显的产品缺陷）；
- 审查时机放在 commit，被拒的草稿不留垃圾数据。

### 4.2 后端改动清单

#### 新增 `server/utils/genApp.js`
- `generateAppHtml(idea)`：
  - 读 `config.genApp.provider` 分发到 GLM 或 DeepSeek 的 HTTP 封装（参考现有 `callGlm` / `_review` 模式：fetch + AbortController 超时 + 错误重试一次 + 模型回退 glm-4.7-flash→glm-4-flash）
  - SYSTEM_PROMPT 要点：只输出**单个完整 HTML 文件原文**（禁止 markdown 围栏和解释文字）；CSS/JS 全部内联；**禁止任何外部网络请求**（CDN/图片/API 一律不许）；移动端自适应；中文界面；单文件控制在 ~50KB 内；做一个完整可玩的小游戏或实用小工具
  - 输出提取：剥离 ```html 围栏 → 截取 `<html…</html>` → 校验闭合与大小，失败自动重试一次
- `draftToken` 工具：HMAC 签名（复用 `TOKEN_SECRET`），payload 含 userId + 文件名 + exp（30min），常量时间校验

#### 新增 `server/routes/gen.js`（挂载 `/api/gen`）
| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/gen/app` | Bearer；body `{idea}`；idea 截断 ≤500 字符；限流 10 次/人/日（`rateLimit`）+ 全局并发信号量（同时 ≤3 个生成中）；返回 `{draft_token, preview_url}` |
| GET | `/api/gen/preview/:draft_token` | Bearer；校验签名+归属；`Content-Type: text/html` + CSP sandbox 头返回草稿 HTML（对齐现有 preview 安全口径） |
| POST | `/api/gen/commit` | Bearer；body `{draft_token, title}`；走 4.1 流程后半段 |
| DELETE | `/api/gen/draft/:draft_token` | Bearer；主动丢弃草稿 |

- 访客（guest_token）不可用：路由挂在 `requireAuth` 之后。
- 运行时开关：`settings` 表新增 `genapp_enabled`（默认开），关闭时接口返回友好提示——作为故障时的 kill-switch（复用 `settings.js` 30s 缓存机制）。

#### 修改 `server/config.js`
```js
genApp: {
  provider: process.env.GENAPP_PROVIDER || 'glm',      // 'glm' | 'deepseek'
  model: process.env.GENAPP_MODEL || '',               // 留空用各 provider 默认模型
  timeoutMs: parseInt(process.env.GENAPP_TIMEOUT_MS || '150000'), // 生成专用长超时，
                                                        // 不要复用 deepseek.timeoutMs（那是审查用的短超时）
  maxIdeaChars: 500,
  maxHtmlBytes: 1024 * 1024,
}
```
凭据直接复用现有 `glm.*` / `deepseek.*` 配置，不新增 key。

#### 修改 `server/schema.sql` + `server/init-db.js`
```sql
ALTER TABLE files ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'upload'
  COMMENT '来源：upload=手动上传 / gen=站内一句话生成';
```
init-db 启动时幂等补列（查 information_schema 判断存在性）。存量行默认 `'upload'`，不影响任何现有逻辑。

#### 修改 `server/utils/taskVerify.js`
```js
if (task.genappcheck) {
  const st = await getGeneratedAppStatus(user.id);
  if (!st.generated) {
    return { ok: false, error: '尚未检测到你生成的小程序，请先到「我的项目」→「一句话生成小程序」制作并提交' };
  }
  return { ok: true };
}
```

#### 修改 `server/utils/learnStatus.js`
- 新增 `getGeneratedAppStatus(userId)`：`files WHERE user_id=? AND source='gen' LIMIT 1` → `{generated}`（**不限时间窗**：入门任务生成过一次即永久达成，对中途加入的学生更友好）
- `getProjectSubmitted` 排除 `source='gen'`（§3.3）

#### 修改 `server/index.js`
挂载 `/api/gen` 路由。

#### 修改 `server/jobs.js`
定时清理 `storage/tmp-gen/` 下超期（>30min，宽容到 2h）草稿文件。

### 4.3 前端改动清单

#### `public/js/project.js`（我的项目页）
新增「✨ 一句话生成小程序」卡片：
- textarea + 示例提示词快捷填充
- 「开始生成」按钮 → loading 态（"AI 正在编写你的小程序，约需 30 秒～2 分钟…"），按钮防重复点击
- 成功 → 弹层内嵌 `<iframe sandbox="allow-scripts">` 加载 `preview_url` 预览
- 操作区：「🔄 重新生成」「✅ 满意，提交」（提交时填写标题）
- 提交成功 → 刷新文件列表，toast 引导去第2章打卡
- 异常分支：模型超时/审查拒绝/额度用尽分别给明确文案

#### `public/js/learn.js`（学AI 页）
- `renderTasks` 增加 `t.genappcheck` 分支：任务卡片 + 「我已生成」按钮 + 状态区（渲染模式照抄 appcheck 卡片结构）
- `initAutoTasks` 注册 `initGenTask`：加载文章时请求新端点 `GET /api/learn/gen-status`（learn.js 加一行透传 `getGeneratedAppStatus`），已完成则自动显示完成态
- 点击「我已生成」→ `POST /api/points/task {article_id, task_index}` → 服务端 `verifyTaskCompletion` 核验
- `OPTIONAL_CHAPTERS` 无需改动
- 顺带清理：`initAppTask`/`checkAppPosted` 相关死代码可保留（无文章引用即不执行）或删除

### 4.4 安全与滥用防护汇总
| 风险 | 措施 |
| --- | --- |
| prompt 注入（idea 里塞指令） | idea 截断 500 字；SYSTEM_PROMPT 明确"用户输入仅作为需求描述"；产物最终经 reviewContent 审查兜底 |
| 生成恶意 HTML | reviewContent（恶意脚本/XSS/钓鱼专项）审查不过即拒；预览与正式访问均走 sandbox + CSP；禁外链约束写进生成提示词 |
| 刷生成额度 | 每人 10 次/日 rateLimit + 全局并发 ≤3 + kill-switch 设置项 |
| 草稿伪造他人 | draft_token HMAC 签名绑定 userId，常量时间校验 |
| 配额绕过 | commit 时原子复查文件数/容量配额（对齐 upload 管线口径） |
| 积分刷取 | gen 文件不发分；genappcheck 幂等（task_index 唯一键 + grant 幂等天然保证） |

---

## 五、实施步骤（按依赖排序）

### Phase 0 · 准备（半天）
- [ ] 确认 GLM / DeepSeek key 在生产 `.env` 可用，实测两个 provider 各生成 3 个不同类型小程序评估质量，定默认 provider
- [ ] 录制/截取新第2章演示素材（生成功能上线后补录，先用文字版上线亦可）
- [ ] 准备第4章 GitHub 配图（本社团 PatPlayer 仓库页截图、提交外链流程截图）

### Phase 1 · 后端生成能力（1~1.5 天）
- [ ] `config.js` genApp 配置块
- [ ] `utils/genApp.js`（生成 + 提取 + draft token）
- [ ] `routes/gen.js` 四个端点 + settings 开关 + jobs 清理
- [ ] `schema.sql` / `init-db.js` files.source 列
- [ ] 手测：curl 全链路（生成→预览→commit→列表→预览→删除），GLM/DeepSeek 双跑

### Phase 2 · 教程内容重写（0.5 天，可与 Phase 1 并行）
- [ ] `seed-articles.js`：第2章全文重写 + 任务对齐；第3章四处文案微调 + 工具表加 Coze；第4章全新正文与 3 道 quiz（条目 slug 写 `ai-project`）
- [ ] 编写一次性迁移 SQL 并演练：`UPDATE articles SET slug='ai-project' WHERE slug='ai-deploy';`

### Phase 3 · 核验与积分适配（0.5 天）
- [ ] `taskVerify.js` genappcheck 分支
- [ ] `learnStatus.js` getGeneratedAppStatus + getProjectSubmitted 排除 gen
- [ ] `routes/learn.js` gen-status 端点
- [ ] 确认删除 gen 文件不产生任何积分流水（回归测）

### Phase 4 · 前端（1 天）
- [ ] `project.js` 生成卡片全流程
- [ ] `learn.js` genappcheck 任务卡片 + 自动回填
- [ ] 移动端样式自查（生成卡片、iframe 弹层）

### Phase 5 · 文档与部署（0.5 天）
- [ ] `README.md`：API 表（/api/gen/*）、环境变量表（GENAPP_*）、学AI 章节描述、files.source 说明
- [ ] `DEPLOY.md` 新增：
  - nginx 为 `/api/gen/` 单独配置 `proxy_read_timeout 180s;`（**宝塔默认 60s 会 504，必做**）
  - 上线迁移 SQL（slug 改名 + files.source 补列，若 init-db 未覆盖）
  - 上线顺序：停机窗口内 → 迁移 SQL → 发新代码 → `node seed-articles.js` → 冒烟测试
- [ ] `FEATURES.md` 同步章节变化

### Phase 6 · 验收测试清单
- [ ] 新学生全链路：注册 → 第1章 → 第2章生成+打卡得 15⭐（活动期 ×1.2）→ 第3章 Trae 项目上传打卡 → 第4章纯答题完成 → 第5章 tiny_id → 毕业 40⭐
- [ ] **存量学生回归**：已完成旧第2章（appcheck）的学生进度/积分不受影响，打开新第2章显示已完成态
- [ ] 已完成旧第4章（ai-deploy quiz）的学生：slug 迁移后文章 id 不变、进度保留
- [ ] 第3章核验排除验证：只生成过第2章小程序（无其他上传）的学生，projectcheck 必须判未完成
- [ ] 生成异常路径：断网/超时/审查拒绝/额度耗尽/kill-switch 关闭，均有友好提示且无脏数据残留
- [ ] 草稿 30min 过期后 commit 应报错；jobs 清理生效
- [ ] 访客身份调用 /api/gen/* 被 401 拒绝
- [ ] 全校作品展出现 gen 作品且作者展示名符合隐私规则（同班真名/异班昵称）
- [ ] seed 重跑幂等：连跑两次结果一致、id 不变

---

## 六、风险与兼容性说明

### 6.1 task_index 错位问题（已通过设计规避）
`task_progress` 按 `(article_id, task_index)` 存进度，重排任务会让老进度映射错位。对策：**新旧任务数组按 index 对齐设计**：
- 第2章：旧 `[quiz@0, appcheck@1]` → 新 `[quiz@0, genappcheck@1]`。已完成旧章的学生 index1 已记录 → 新章直接显示完成（他们确实做过等价实操，合理）；新学生必须真实生成才能过核验（服务端 verify 把关，前端显示完成≠发过分？——注意：老学生当年已完成该 index 并领过 `task` 整章积分，不会重复发放；新学生走正常核验。✓ 自洽）
- 第3章：任务结构不变（quiz@0 + projectcheck@1），零错位
- 第4章：旧 `[quiz@0, quiz@1]` → 新 `[quiz@0, quiz@1, quiz@2]`。老学生 index0/1 视为已答（题目换了但都是认知题，可接受）；新增的第3题需真实作答。若希望更严谨，可在迁移 SQL 中顺手清掉第4章旧进度让所有人重答（选修章，代价小）——**二选一，默认不清**

### 6.2 seed 覆盖后台编辑
seed 是全字段 UPDATE。上线窗口内执行 seed 后，如需微调文案请在**管理后台编辑器**改（以库为准），不要再跑 seed，否则下次 seed 会覆盖后台改动。

### 6.3 轻应用功能退役（本次不处理，记录备忘）
腾讯下架轻应用创建后，`apps.js` 自动识别/manual-scan、`jobs.js` 帖子扫描、`app_submit` 积分、商城 `app_top/app_essence` 失去新增来源。存量 apps 数据与展示不受影响。建议后续单独做一次小改：前端「AI 轻应用」入口加提示"腾讯已停止轻应用创建，此页保留历史作品"。**不在本期范围**。

### 6.4 回滚方案
- kill-switch：`settings.genapp_enabled=false` 立即停用生成功能（教程文案可临时指向"稍后再试"）
- 代码回滚：git revert 后，files.source 列与迁移后的 slug 无需还原（向后兼容）
- 极端情况恢复旧第4章内容：git revert seed 后重跑 seed 即可（id 未变）

---

## 七、工作量估算与里程碑

| Phase | 内容 | 估时 |
| --- | --- | --- |
| P0 | 准备（模型实测、素材） | 0.5 天 |
| P1 | 后端生成能力 | 1~1.5 天 |
| P2 | 教程重写 + 迁移 SQL | 0.5 天 |
| P3 | 核验适配 | 0.5 天 |
| P4 | 前端 | 1 天 |
| P5 | 文档部署 | 0.5 天 |
| P6 | 验收测试 | 0.5 天 |
| **合计** | | **4.5~5 天** |

建议上线顺序：P1+P3 先合并（功能就绪但入口隐藏，settings 开关控制）→ P2/P4 合并 → 低峰期执行迁移 SQL + seed → 冒烟验收 → 开启开关。
