'use strict';

// 社团简介页（#/club）：信息技术拓展社完整介绍
// 正文用 Markdown 渲染（复用 learn.js 顶层的全局 renderMarkdown，learn.js 先于本文件加载）
window.Views = window.Views || {};
Views.club = () => {
  const view = document.getElementById('view');

  const md = `# 欢迎来到南方中学信息技术拓展社！
Ciallo～(∠・ω<)⌒☆

**信息技术拓展社（IT Extension Club）**，是在原信息社的基础上，围绕「信息技术 +」方向重新组建的新型社团，致力于为建设信息化科技高中贡献学生力量。

## 不刷竞赛题，也不限定同一条赛道

学校设有信息奥赛团队，但算法竞赛并非所有人的选择。我们不刷竞赛题，也不会将大家的兴趣限定在同一条赛道。

我们是一群在校园里探索电脑、开发小工具、研究网络与创意表达的伙伴：

- 有人擅长设备维护
- 有人热爱写代码
- 有人深耕视觉创作
- 也有人只是好奇「它为什么这样运作」

## 讲台属于每一个人

这里没有标准答案，只有一同把问题打磨成作品的同伴。在这里，只要你愿意，就可以上台分享：一个函数、一段故事、一次教训……

我们欢迎每一位对信息技术抱有兴趣的同学——无论你是**编程高手**、**音视频创作者**、**绘画爱好者**、**设计师**，抑或是**零基础小白**。在这里，你都可以在喜欢的领域发光发热，为高中生活增添一抹亮色。

## 思考 · 创造 · 实践 · 落地

这里是一个「思考 · 创造 · 实践 · 落地」的全新平台。在 AI 飞速发展的时代，独立思考尤为珍贵。你转瞬迸发的灵感千金不换，可在这里将创意转化为作品，深耕打磨，甚至参与中小学生数字素养提升实践活动赛事。

## 让信息的火种，从这里点亮

在实践中，我们希望你收获的不只是一项技能，更能学会承担责任、团结协作、不懈奋斗。相信机房里跳动的秒针，日后都会成为你珍贵的回忆。

> “The only constant is change.”（唯一不变的，就是改变。）
> **信息技术拓展社，欢迎你的到来！**`;

  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">社团简介</h1>
        <div class="page-sub">南方中学信息技术拓展社 · IT Extension Club</div>
      </div>

      <article class="card learn-article" style="margin-bottom:16px;">
        <div class="learn-article-body">${renderMarkdown(md)}</div>
      </article>

      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
        <a class="btn btn-ghost" href="#/activity">← 返回活动简介</a>
        <a class="btn btn-primary" href="#/learn">🎓 前往 AI 小学堂 →</a>
      </div>
    </div>`;
};
