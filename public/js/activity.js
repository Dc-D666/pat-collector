'use strict';

// 活动简介视图：「信息素养体验活动」摘要页（完整规则见金山文档，不照抄全文）
window.Views = window.Views || {};
Views.activity = () => {
  const view = document.getElementById('view');

  // 活动流程：按当前日期标注 已完成 / 进行中 / 未开始（时间写 'M.D'，null = 待定）
  const STAGES = [
    { name: '系统内测', start: '8.13', end: '8.18' },
    { name: '作品投稿', start: '8.20', end: '9.8' },
    { name: '评委打分', start: null, end: null },
    { name: '结果公示', start: null, end: null },
    { name: '奖品发放', start: null, end: null },
    { name: '参观展示', start: null, end: null },
  ];
  const now = new Date();
  const stageYear = now.getFullYear();
  function stageState(s) {
    if (!s.start || !s.end) return 'todo';
    const [sm, sd] = s.start.split('.').map(Number);
    const [em, ed] = s.end.split('.').map(Number);
    const st = new Date(stageYear, sm - 1, sd);
    const en = new Date(stageYear, em - 1, ed);
    if (now < st) return 'todo';
    if (now > en) return 'done';
    return 'active';
  }
  const STATE_TEXT = { done: '已完成', active: '进行中', todo: '未开始' };
  const timelineHtml = STAGES.map((s) => {
    const st = stageState(s);
    return `
      <div class="timeline-item ${st}">
        <span class="timeline-dot"></span>
        <div class="timeline-content">
          <span class="timeline-title">${s.name}</span>
          <span class="stage-state stage-${st}">${STATE_TEXT[st]}</span>
          <span class="timeline-time">${s.start ? s.start + ' – ' + s.end : '待定'}</span>
        </div>
      </div>`;
  }).join('');

  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">活动简介</h1>
        <div class="page-sub">「信息素养体验活动」· 株洲市南方中学校友频道 × 株洲市南方中学信息技术拓展社</div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
          <div>
            <div class="activity-title">🎉 信息素养体验活动</div>
            <div class="activity-sub">用 AI 做出你的第一个作品，零基础也能参加</div>
          </div>
          <a class="btn btn-primary" href="https://365.kdocs.cn/l/cvXvUaSc6iNY" target="_blank" rel="noopener">📄 查看完整活动通知</a>
        </div>
        <div class="activity-body">
          <p>活动以 <strong>AI 编程实践</strong> 为核心：用自然语言说出想法，AI 帮你生成代码，零基础也能快速做出小工具、网页、小游戏。优秀作品可获奖状与频道奖品。</p>
        </div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px;">
          <div class="activity-title">📌 怎么从 0 开始</div>
          <a class="btn btn-primary" href="#/learn">🎓 前往 AI 小学堂学习 →</a>
        </div>
        <div class="activity-body">
          <p>完全零基础？没关系，先从「AI 小学堂」花 5 分钟入门：</p>
          <p>通过 5 分钟的学习，你将体验到从 0 开始，用一句话生成一个独属于你自己的小游戏，或者是小工具。</p>
          <p style="color:var(--text-dim);font-size:12.5px;margin-top:8px;">学完就动手：在 QQ 频道用「AI 轻应用」创作你的作品，或把已有项目上传到本站「我的项目」，即算参与活动。</p>
        </div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:16px;">
        <div class="activity-title" style="margin-bottom:14px;">📋 活动流程</div>
        <div class="timeline">
          ${timelineHtml}
        </div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:16px;">
        <div class="activity-title" style="margin-bottom:8px;">❓ 常见问题</div>
        <div class="activity-body">
          <div class="qa-item">
            <div class="qa-q">Q1 · 没灵感怎么办？</div>
            <div class="qa-a">把你的想法用一句话说给 AI，剩下的交给它。可以从这些方向找找感觉：
              <ul>
                <li>📚 <strong>学习工具</strong>：错题本、单词卡、公式速查、自习计时器</li>
                <li>🏫 <strong>校园生活</strong>：课表助手、食堂推荐、社团活动日历、校史问答</li>
                <li>🎮 <strong>趣味创作</strong>：小游戏、互动测验、表情包 / 段子生成器</li>
                <li>❤️ <strong>公益应用</strong>：环保打卡、心理关怀小工具、无障碍辅助</li>
              </ul>
            </div>
          </div>
          <div class="qa-item">
            <div class="qa-q">Q2 · 完全不会编程可以参加吗？</div>
            <div class="qa-a">当然可以！「入门体验」就是为零基础设计的——有手机、会打字就能参加。</div>
          </div>
          <div class="qa-item">
            <div class="qa-q">Q3 · 用什么工具创作？</div>
            <div class="qa-a">入门用 QQ 频道里的「AI 轻应用」；进阶可用 Trae、GitHub Copilot 等（「AI 小学堂」第 3 章有教程）。</div>
          </div>
          <div class="qa-item">
            <div class="qa-q">Q4 · 一个人能提交几个作品？</div>
            <div class="qa-a">不限数量，每个作品独立参与评选。</div>
          </div>
          <div class="qa-item">
            <div class="qa-q">Q5 · 毕业生或外校成员能参加吗？</div>
            <div class="qa-a">可以参与创作与展示，但只参与排名与展示，不参与颁奖。</div>
          </div>
        </div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:16px;">
        <div class="activity-title" style="margin-bottom:10px;">🏆 奖项</div>
        <div class="activity-body">
          <table class="activity-table">
            <thead>
              <tr><th>奖项</th><th>名额</th><th>奖品内容</th></tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>一等奖</strong></td><td>2 名</td>
                <td>• 学校颁发奖状<br>• 「水原雫」IP 徽章 ×2（记忆版、基础版）<br>• 频道内 21 天超级管理员体验卡<br>• 帖子置顶一周</td>
              </tr>
              <tr>
                <td><strong>二等奖</strong></td><td>3 名</td>
                <td>• 学校颁发奖状<br>• 「水原雫」IP 徽章 ×1（基础版）<br>• 频道内 7 天超级管理员体验卡<br>• 帖子置顶一周</td>
              </tr>
              <tr>
                <td><strong>三等奖</strong></td><td>4 名</td>
                <td>• 学校颁发奖状<br>• 「水原雫」IP 徽章 ×1（基础版）</td>
              </tr>
              <tr>
                <td><strong>参与奖</strong></td><td>不限</td>
                <td>• 学校颁发奖状</td>
              </tr>
            </tbody>
          </table>
          <p>🏆 评奖规则：个人积分排行榜名次，积分相同时优先达成者的排名靠前</p>
        </div>
      </div>
    </div>`;
};
