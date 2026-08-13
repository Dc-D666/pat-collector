'use strict';

// 积分榜视图：排行榜 + 我的积分 + 获取记录
window.Views = window.Views || {};
Views.points = async () => {
  const { escapeHtml, formatTime, toast } = Utils;
  const view = document.getElementById('view');

  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">积分榜</h1>
        <div class="page-sub">完成课程、提交作品赚取 ⭐ 积分</div>
      </div>
      <div id="points-content"><div class="spinner"></div></div>
    </div>`;

  let data, logs;
  try {
    const [lb, mine] = await Promise.all([
      API.get('/api/points/leaderboard'),
      API.get('/api/points'),
    ]);
    data = lb;
    logs = mine.logs || [];
  } catch (err) {
    document.getElementById('points-content').innerHTML =
      `<div class="empty"><div class="empty-icon">⚠️</div>${escapeHtml(err.message)}</div>`;
    return;
  }

  const content = document.getElementById('points-content');
  const me = data.me || {};
  // 我的积分用 /api/points 的实时值（排行榜 me.points 仅作参考）
  const myPoints = (mine && typeof mine.points === 'number') ? mine.points : (me.points || 0);
  const myRank = me.rank || '-';

  const medal = ['🥇', '🥈', '🥉'];

  content.innerHTML = `
    <div class="stat-grid" style="margin-bottom:18px;">
      <div class="card stat-card"><div class="stat-label">我的积分</div><div class="stat-value">⭐ ${myPoints}</div></div>
      <div class="card stat-card"><div class="stat-label">我的排名</div><div class="stat-value">#${myRank}</div></div>
    </div>

    <div class="card" style="padding:16px 18px;margin-bottom:16px;">
      <h2 style="margin:0 0 12px;font-size:17px;">🏆 全校排行榜</h2>
      <div class="lb-list">
        ${data.list.length ? data.list.map((u, i) => `
          <div class="lb-row ${u.user_id === me.user_id ? 'lb-mine' : ''}">
            <span class="lb-rank">${i < 3 ? medal[i] : '#' + (i + 1)}</span>
            <span class="lb-name">${escapeHtml(u.display_name)}</span>
            <span class="lb-class">${escapeHtml(u.class_name)}班</span>
            <span class="lb-points">⭐ ${u.points}</span>
          </div>`).join('')
        : `<div class="empty" style="padding:20px;">还没有人获得积分，快来抢第一！</div>`}
      </div>
    </div>

    <div class="card" style="padding:16px 18px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <h2 style="margin:0;font-size:17px;">🧾 我的积分记录</h2>
        <span style="font-size:12px;color:var(--text-dim);">最近 ${logs.length} 条</span>
      </div>
      ${logs.length ? `<div class="lb-list">
        ${logs.map((l) => `
          <div class="lb-row">
            <span class="lb-reason">${escapeHtml(l.reason_text)}</span>
            <span class="lb-time">${formatTime(l.created_at)}</span>
            <span class="lb-points" style="color:var(--success);">+${l.amount} ⭐</span>
          </div>`).join('')}
      </div>` : `<div class="empty" style="padding:20px;">还没有积分记录</div>`}
    </div>`;
};
