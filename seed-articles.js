'use strict';
// 一次性脚本：写入学AI 小学堂教程文章（5 章，含章节任务）。node seed-articles.js
// 按 slug 幂等 upsert：已有文章保留原 id（学员 task_progress / 整章积分记录不受影响），
// 仅当某 slug 从本脚本中移除时才删除该文章（其关联任务进度一并级联清除）
const mysql = require('mysql2/promise');
const config = require('./server/config');

const BILIBILI = 'https://www.bilibili.com/video/';

const articles = [
  // ============ 第 1 章 AI 初识 ============
  {
    slug: 'ai-intro',
    chapter: 1,
    title: 'AI 就在你身边：从「NFTI」说起',
    summary: '这一章从真实项目「NFTI」出发，带你认识 AI 到底是什么。',
    content: `你测过南中人格测试 **NFTI** 吗？答题 8 分钟，得到一个"你是哪种南方人"的结果，还能找 AI 学长"方小楠"聊人格……

> 🎯 [还没体验？](https://nfti.weaxi.cn)（测完再回来读也行～）

告诉你一个秘密：**NFTI 就是频道主用 AI 工具从零做出来的真项目**。

## 1. 一个真实的故事：NFTI 是怎么诞生的

当初我们想做一个属于南方中学自己的心理测试，但完全不会做产品。这是搭建的过程：

- **设计人格体系**：我们参考 MBTI，把维度改写成 O/R、G/V、L/E、S/F 这种校园语言——全程由 AI 设计
- **写题目、写结果文案**：几十道场景题、19 种人格的解读，是让 AI 通过抓取频道帖子数据，了解南方特色文化后生成的——这也全是 AI 做的
- **插画**：先让 Gemini 生成提示词，再交给千问或者豆包来生成插画，这些依旧全程 AI
- **开发网站**：前端页面、登录、发帖分享……我们用 AI 编程工具和 AI 对话，让它帮我们写代码——这些也是 AI 做完的
- **"方小楠"问答**：接上大模型 API，它就能基于你的测试结果跟你聊人格建议

你看，一个完整的 AI 产品，背后是"**人出想法，AI 干活**"。

![NFTI测试结果页面](img/learn-ch1.png)

## 2. 那 AI 到底是什么？

一句话：**AI 是让电脑替人干活的技术**——认图片、听语音、写文章、写代码、推荐视频。

它为什么突然这么厉害？不是工程师写了十万条规则，而是**喂给它海量的数据，让它自己找出规律**。就像你见过的猫多了自然能认出猫，AI"看过"几十亿张图、几千亿字之后，就学会了"理解"。

最近两年最火的**大模型**（DeepSeek、豆包、Kimi……）就是这种技术里最聪明的代表：你问它问题，它一个字一个字地"预测"出最合理的回答。

## 3. 它不是魔法，是工具

AI 不会替你想"做什么"，但会帮你把想法变成现实。**不会用 AI 的人，会输给会用 AI 的人**——就像当年不会用搜索引擎、不会用 Office 一样。

而我们本次活动的目的，就是教大家把这件"工具"用起来。从下一章开始，你就要亲手做出自己的 AI 作品了（不要担心，有手机、会打字、一分钟就够啦）。`,
    tasks: [
      {
        type: 'action',
        title: '🎯 实操任务：去体验 AI —— 南中人格测试 NFTI',
        desc: '打开「南中人格测试 NFTI」（频道主用 AI 工具打造的真实项目），完成一次人格测试，感受 AI 产品从答题到结果生成的完整体验。回来点「我已体验完成」即可领取积分；测试记录会通过你的 QQ 身份自动识别。',
        nfti: true,
      },
      {
        type: 'quiz',
        question: '1. 为什么说 NFTI 是一个"AI 项目"？',
        options: [
          '因为它能免费使用',
          '因为它用大模型生成内容、用 AI 工具写代码，是人和 AI 协作做出来的',
          '因为它是一个手机 App',
          '因为它测出来的人格是 AI 编的',
        ],
        answer: 1,
        explain: 'NFTI 的结果文案、AI 学长问答、网站开发都用了大模型和 AI 工具，是"人出想法、AI 干活"的产物。',
      },
      {
        type: 'quiz',
        question: '2. 今天的 AI 大模型为什么突然这么厉害？',
        options: [
          '工程师写死了所有情况的应对规则',
          '它接入了全球网络实时搜索',
          '它被喂了海量数据，自己从中找出了规律',
          '它的服务器特别大',
        ],
        answer: 2,
        explain: '机器学习 + 海量数据：AI 像看过无数猫之后认出猫一样，从几十亿张图、几千亿字里学会"理解"。',
      },
    ],
  },

  // ============ 第 2 章 AI 初体验 ============
  {
    slug: 'ai-first-app',
    chapter: 2,
    title: '一句话，做出你的第一个 AI 应用',
    summary: '不用写代码：用自然语言把你的想法告诉 AI，就能生成一个能用的应用。本章任务：创作并发表你的第一个 AI 作品。',
    content: `上一章我们说到"人出想法，AI 干活"。这一章你就要**亲手做**了——而且不用写一行代码。

## 1. 现在的 AI 应用是"说"出来的

过去做一个 App 要学几年编程，现在你只需要**把你的想法用一句话说清楚**，AI 就能帮你生成一个能用的应用：

> 💡 比如："帮我做一个 AI 背单词小工具，每轮出 5 个单词，我答对记 1 分。"

AI 听懂后，会生成界面、逻辑、答案判定……你检查一下、说"再改改"，它就改好了。这个过程叫 **AI 生成式开发**，也是我们社团同学做项目的主力方式。

## 2. 在 QQ 频道里创建你的第一个应用

我们的 QQ 频道里就有 AI 轻应用功能，专门让同学们一句话创作应用：

1. 打开 QQ 频道（南中中学频道）
2. 找到 **AI 轻应用** 入口（下方有配套操作视频）
3. 用一句话描述你的想法，点击生成
4. 预览没问题，就**发布**到频道

![🎬 配套操作视频：在 QQ 频道里创建你的第一个 AI 应用](videos/ch2-create-app.mp4)

**发布前，把想法说具体点**：

> ❌ 太模糊："做个助手"
> ✅ 很具体："帮高一新生做一个选科建议小助手，输入我喜欢的科目，告诉我适合选什么组合"

说得越具体，AI 生成的东西越好用。

## 3. 本章任务：发表你的第一个 AI 作品

去 QQ 频道用一句话创作一个 AI 轻应用并**发布**（类型不限：答题、工具、游戏都行）。

> 💡 没灵感？[点这里看看频道里的热门应用示例](https://pd.qq.com/s/5r2dq98pk)，参考别人的创意，再用自己的想法做出不一样的作品～

发布后，还要**回到本站「我的项目」→「AI 轻应用」页点「自动识别」**，把作品一键投稿上来（投稿后作品会出现在「全校作品展」）。最后点下面的「我已发表」按钮，系统会核验**发帖记录 + 本站投稿**，两项都完成才算任务通过。`,
    tasks: [
      {
        type: 'quiz',
        question: '1. 用一句话创作 AI 应用时，什么样的描述效果最好？',
        options: [
          '"帮我做个东西"',
          '"做个好玩的游戏"',
          '"帮我做一个背单词工具，每轮 5 个词，答对记 1 分，最后显示总分"',
          '"随便什么都行"',
        ],
        answer: 2,
        explain: '描述越具体，AI 越能理解你的需求，生成的应用越好用。',
      },
      {
        type: 'action',
        title: '📤 实操任务：发表你的第一个 AI 应用',
        desc: '在 QQ 频道的 AI 轻应用功能里，用一句话创作一个应用并发布（需要 QQ 频道登录）。发布后再到本站「我的项目」→「AI 轻应用」点「自动识别」把作品投稿上来，然后点「我已发表」，系统核验发帖与投稿两项都完成才算通过。',
        appcheck: true,
      },
    ],
  },

  // ============ 第 3 章 AI 提高 ============
  {
    slug: 'ai-real-app',
    chapter: 3,
    title: '从「小应用」到「真项目」：认识 AI 编程 Agent',
    summary: '频道里的轻应用很方便，但功能有限。这一章带你认识 AI 编程 Agent，亲手做出一个独立的、真正属于自己的项目。',
    content: `第 2 章你已经在频道里做出了第一个应用。但用着用着你会发现它的"天花板"：

## 1. 频道轻应用的三个局限

- **模板化**：只能在平台给的框架里做，自由度有限
- **功能受限**：做不了复杂逻辑，不能读写文件、存数据、跑服务器程序
- **只在频道里**：作品属于平台，离开频道就打不开

说白了：它适合"快速体验"，但不适合"认真做一个项目"。

## 2. 真正的独立 AI 应用长什么样

独立应用 = **属于你自己的程序**：

- 想做什么做什么（小游戏、个人网站、学习工具……）
- 能发给任何人，双击就能用，或放到网上人人可访问
- 代码在你手里，可以不断改、不断加功能

以前做这些要先学几个月编程，但现在有了 **AI 编程 Agent**（你可以把它理解成"AI 程序员搭档"）——你负责描述需求，Agent 负责写代码、改 bug、加功能。

## 3. 认识三位"编程搭子"

| 工具 | 特点 | 适合谁 |
| --- | --- | --- |
| **Trae** | AI 编程软件，装好后用中文对话就能让它写代码 | **入门首选**，国内下载快 |
| **WorkBuddy** | 桌面 AI 助手工作台，自然语言指挥它完成代码/文档等任务 | 想要"全能助理"的同学 |
| **Codex** | AI 程序员，在电脑终端（命令窗口）里跟它对话 | 硬核玩家、想更深入的同学 |

- **Trae**：[官网下载](https://www.trae.cn/ide/download)，trae.cn
- **WorkBuddy**：[官网下载](https://www.workbuddy.cn/)，腾讯云出品
- **Codex**：[GitHub 官方仓库](https://github.com/openai/codex)，需要 **VPN** 才能访问 OpenAI 环境，适合有条件的同学

## 4. 快速上手：用 Trae 做出你的第一个独立项目

> 📱 **没有电脑？**在手机应用商店搜索「Trae」下载 App——手机上也能造出自己的小项目！

1. 去 **trae.cn** 下载并安装 Trae（免费）
2. 打开，新建一个项目（比如"记事本小工具"）
3. 在对话框里用中文描述：*"做一个待办清单网页，能添加、勾选、删除任务，数据保存在浏览器里"*
4. 等它生成代码，点运行——你的第一个独立应用就诞生了！

比如这样，一句话就生成了一个能用的应用：

![Trae 电脑端：一句话生成应用示例](img/learn-ch3-trae.png)
![Trae 手机端：手机上也能造项目](img/learn-ch3-trae-mobile.jpg)

**不会就问**：哪里不对，直接告诉它"这里报错了，帮我看看"，它会自己修。

## 5. 本章任务：提交你的项目文件

做一个独立项目（小游戏 / 小网页 / 小工具，用什么工具都行），把**项目文件**上传到「我的项目」页（作品信息填上标题和简介）。

上传后系统会自动检测你的上传记录，检测通过即完成。`,
    tasks: [
      {
        type: 'quiz',
        question: '1. 为什么说频道轻应用不能满足"认真做项目"的需求？',
        options: [
          '因为它要收费',
          '因为它模板化、功能受限，且作品只能在频道里使用',
          '因为它不支持手机',
          '因为它无法被搜索到',
        ],
        answer: 1,
        explain: '频道轻应用适合快速体验；独立项目才能自由开发、分享给任何人、不断迭代。',
      },
      {
        type: 'action',
        title: '📦 实操任务：提交你的独立项目文件',
        desc: '用 AI 编程 Agent（Trae / WorkBuddy / Codex 任选）做一个独立项目，把项目文件（如压缩包、HTML 网页）上传到「我的项目」页并填写作品信息。上传后系统自动检测，检测通过即完成。',
        projectcheck: true,
      },
    ],
  },

  // ============ 第 4 章 AI 进阶 ============
  {
    slug: 'ai-deploy',
    chapter: 4,
    title: '把你的项目发布到全世界',
    summary: '【选做】项目做出来了，怎么让同学点个链接就能用？这一章教你免费把项目部署上线（不要求实际操作，阅读了解即可）。',
    content: `> 📌 **选做章节**：本章不要求实际操作，阅读了解即可；学有余力的同学，可以试着把第 3 章的项目部署上线，分享链接给同学看看。

第 3 章的项目还只存在你自己电脑里，同学想用也看不到。这一章把它**发布到网上**——给所有人一个能访问的链接。

## 1. 为什么要部署

- 把作品**分享给同学**：发个链接，手机电脑都能打开
- 证明你真的**做出来了**：面试社团、参加活动，一个能访问的作品比截图有说服力
- 以后可以**不断更新**：改好了重新发布，链接不变

## 2. 最快的路：Cloudflare（免费，无需服务器）

**Cloudflare Pages / Workers** 是国际知名的免费托管平台，特点：免费额度够用、全球加速、不用买服务器、注册就能用。

**部署步骤（静态项目 / 网页类）：**

1. 注册 Cloudflare 账号（cloudflare.com）
2. 进入 **Pages** → **Create**（创建项目）
3. 上传你的项目文件（HTML / 前端项目打包产物）
4. 点 Deploy，几秒钟后得到一个 **xxx.pages.dev** 链接
5. 把链接发到群里，全世界都能打开 🎉

> 如果你的是带后端（需要数据库/接口）的项目，可以用 **Workers**（云函数）托管后端逻辑，或者本地起个小服务器后配合内网穿透工具（如 cpolar）临时分享。

**配套视频，跟着做一遍更稳**（点播放器右下角可全屏）：

![零成本建站！Cloudflare Pages 十分钟部署个人网站，小白也能秒上手](https://player.bilibili.com/player.html?bvid=BV1gW53zqErG&page=1&autoplay=0)
![保姆级教程：Cloudflare Pages 部署个人网站 + 绑定独立域名](https://player.bilibili.com/player.html?bvid=BV1WZYjzWE18&page=1&autoplay=0)
![带后端的项目：Cloudflare Tunnel 免费内网穿透，无需公网 IP](https://player.bilibili.com/player.html?bvid=BV1Sy411B7Bb&page=1&autoplay=0)

## 3. 更"正式"的路：云服务器

如果以后项目做大了（有数据库、要稳定运行），可以买一台云服务器（腾讯云学生机很便宜），用**宝塔面板**一键部署——你现在所处的网站和 NFTI 就是这么跑的。

**进阶视频**（以后想走这条路时再看）：

![小白必看：五分钟安装宝塔面板，搭建服务器不求人](https://player.bilibili.com/player.html?bvid=BV1CY411E7Xn&page=1&autoplay=0)

这条路配置更多，适合进阶。先把 Cloudflare 玩熟，这条以后再说。

## 4. 部署注意事项

- 部署前**先本地测试**：确认功能正常再发布
- 链接分享时附上一句介绍："这是我用 AI 做的 XX，大家来玩"
- 改版后重新部署，覆盖更新即可

## 5. 本章任务

读完全文，完成下面的选择题。有条件的话，把第 3 章的项目部署到 Cloudflare，分享链接给同学看看！`,
    tasks: [
      {
        type: 'quiz',
        question: '1. 想最快、免费地把一个静态网页项目发布上线，首选哪个？',
        options: ['买一台云服务器手动配置', 'Cloudflare Pages', '发到 QQ 群文件', '打包成安装包寄给同学'],
        answer: 1,
        explain: 'Cloudflare Pages 免费、无需服务器、几分钟完成部署，最适合快速上线。',
      },
      {
        type: 'quiz',
        question: '2. 部署作品到线上，最大的好处是什么？',
        options: [
          '电脑不会死机了',
          '项目文件不会丢失',
          '任何人通过链接都能访问，作品真正"上架"了',
          '不用再写代码了',
        ],
        answer: 2,
        explain: '部署后作品获得一个公开链接，可分享给任何人，也能持续更新。',
      },
    ],
  },

  // ============ 第 5 章 Agent 深度定制 ============
  {
    slug: 'ai-agent-skill',
    chapter: 5,
    title: '给 Agent 装上「外挂」：Skill 与 MCP',
    summary: '想让 AI 编程 Agent 按你的习惯干活？学学 Skill（技能）和 MCP（连接器），把 Agent 调教成你的专属搭档。',
    content: `到这一章，你已经能用 Agent 写项目、发布项目了。但有没有觉得它有时"不够懂你"？

比如你希望它每次写代码都带注释、每次做作业都按固定格式输出……这就要用到 Agent 的两件"外挂"：**Skill（技能）** 和 **MCP（连接器）**。

## 1. Skill（技能）：教 Agent 按你的方法干活

Skill 就像给 Agent 一本"操作手册"：你写好一套流程或规则，之后它遇到同类任务就自动按这个流程来。

**举个例子**，你可以给 Trae 配置一个 skill：*"写任何代码前，先列出功能清单 → 写完后自动跑一遍测试 → 再总结改动"*。以后它就会照着做。

**再举个例子**：我们社团给频道做了一款「腾讯频道」技能，装进 Agent 后，它就能直接读取频道数据——比如你发了多少帖子、收到多少赞和评论（这些在频道 App 里可看不到）。

**配置位置**：Trae 有自己的 skills 目录（在项目里放一个 markdown 说明文件即可）；WorkBuddy 更直接，界面里就叫**「技能」**，点几下就能新建。

## 2. MCP（连接器）：让 Agent 够到外面的世界

Agent 默认"困在对话里"，访问不了你的文件、数据库、网页。MCP（Model Context Protocol）就是**标准化的"插座"**，插上之后 Agent 就能调用外部工具：

| MCP 能连什么 | 能干什么 |
| --- | --- |
| 本地文件系统 | 读写你的项目文件 |
| 数据库 | 查询、更新数据 |
| 网页 / 搜索 | 实时查资料 |
| 天气、地图等 API | 接入各种服务 |

WorkBuddy 里 MCP 叫**「连接器」**，官方市场里直接选；Trae 通过配置文件引入。

## 3. 为什么值得学

- **省事**：把重复的流程写成 skill，一次配置永远生效
- **更强**：接上 MCP 后，Agent 能干"查数据库、抓网页"这种重活
- **进阶信号**：会配 Skill / MCP，说明你已经不是"会用 AI"，而是"会调教 AI"了

## 4. 本章任务：让 Agent 帮你查频道数据

想不想知道：自己在频道里一共发了多少帖子？收到过多少个赞、多少条评论？——这些数据在频道 App 里**看不到**。

这时候就该我们的**腾讯频道 Skill** 出场了：把它装进你的 Agent，你的 Agent 就能自动连上频道后台，帮你把数据查出来。

**安装配置**（在 Trae / WorkBuddy 任选一个）：

不用翻设置，直接打开 Agent 的对话窗口，把下面这句提示词发给它：

\`\`\`
从skillhub上帮我下载腾讯频道的skill，名称是tencent-channel-community
\`\`\`

（点提示词右上角的「复制」按钮复制，再粘贴到对话框发送；Agent 会自动从 SkillHub 下载并装好「腾讯频道」技能）

![Agent 从 SkillHub 安装腾讯频道技能](img/learn-ch5-skillhub.png)

**提示词示例**（可以直接用，也可以改成你想查的）：

- "用腾讯频道技能，统计我在频道里一共发了多少个帖子"
- "把我的帖子按点赞数从高到低排序，告诉我每条的赞数"
- "汇总我所有帖子收到的评论数，做一张表"
- "分析我最近 30 天的发帖和互动情况，总结一下数据"

Agent 会自动调用技能替你查完。完成后点「我完成了」打卡领取积分。`,
    tasks: [
      {
        type: 'quiz',
        question: '1. Skill（技能）和 MCP（连接器）分别是什么？',
        options: [
          '都是游戏里的道具',
          'Skill 是教 Agent 按固定流程干活；MCP 是让 Agent 连接外部工具和数据',
          'Skill 是让 AI 变聪明的魔法，MCP 是它的名字',
          'Skill 是收费功能，MCP 是免费功能',
        ],
        answer: 1,
        explain: 'Skill = 操作手册（流程/规则）；MCP = 插座（连接文件、数据库、网页等外部能力）。',
      },
      {
        type: 'quiz',
        question: '2. 想让 Agent 能读取你本地项目文件，应该怎么做？',
        options: [
          '把文件复制到聊天框里',
          '配置一个 MCP（连接器）接入本地文件系统',
          '重新安装 Agent',
          '没法做到',
        ],
        answer: 1,
        explain: 'MCP 让 Agent 获得访问外部工具（如本地文件）的标准能力，不需要手动搬运内容。',
      },
      {
        type: 'action',
        title: '🎯 毕业实操：让 Agent 查出你的频道身份（tiny_id）',
        desc: '给 Agent 装好腾讯频道技能后，让它查询你的频道用户 ID（tiny_id）。💡 尝试给你的Agent发：查询我在南方中学频道里面的用户ID。把 Agent 返回的纯数字 ID 填到下面的输入框，系统会和你登录时的身份自动核验，一致即通过。',
        tinyidcheck: true,
      },
    ],
  },
];

// 入库：按 slug 幂等 upsert，保留已有文章 id → task_progress / 整章积分不丢失；
// 仅移除 seed 中已不存在的文章（其关联进度级联清除）
async function seed() {
  const conn = await mysql.createConnection(config.db);
  try {
    const [rows] = await conn.query('SELECT id, slug FROM articles');
    const slugToId = new Map(rows.map((r) => [r.slug, r.id]));

    for (let i = 0; i < articles.length; i++) {
      const a = articles[i];
      const tasks = JSON.stringify(a.tasks || []);
      const id = slugToId.get(a.slug);
      if (id !== undefined) {
        await conn.query(
          'UPDATE articles SET chapter = ?, title = ?, summary = ?, content = ?, tasks = ?, sort_order = ? WHERE id = ?',
          [a.chapter, a.title, a.summary, a.content, tasks, i, id]
        );
        console.log(`[seed] 更新：第${a.chapter}章 ${a.title}（id=${id}，进度保留）`);
      } else {
        const [res] = await conn.query(
          'INSERT INTO articles (slug, chapter, title, summary, content, tasks, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [a.slug, a.chapter, a.title, a.summary, a.content, tasks, i]
        );
        console.log(`[seed] 新增：第${a.chapter}章 ${a.title}（id=${res.insertId}）`);
      }
    }

    // 清理：seed 中已不存在的文章（slug 移除 → 该文进度级联清除）
    const seedSlugs = new Set(articles.map((a) => a.slug));
    for (const r of rows) {
      if (!seedSlugs.has(r.slug)) {
        await conn.query('DELETE FROM articles WHERE id = ?', [r.id]);
        console.log(`[seed] 移除：${r.slug}（id=${r.id}，其任务进度已级联清除）`);
      }
    }
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  seed().catch((err) => { console.error('[seed] 失败：', err); process.exit(1); });
}

module.exports = { articles };
