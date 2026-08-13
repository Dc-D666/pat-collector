'use strict';

// 我的积分页：被赞刷新 + 毕业奖励 + 排行榜 + 积分流水 + 赚积分小贴士
// （积分商城已下架，前端无兑换入口；后端 /shop /purchase /my-purchases 保留待重新上架）
window.Views = window.Views || {};
Views.points = async () => {
  const { escapeHtml, formatTime, toast } = Utils;
  const view = document.getElementById('view');

  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">我的积分</h1>
        <div class="page-sub">完成课程、提交作品、互相点赞赚 ⭐</div>
      </div>
      <div id="points-content"><div class="spinner"></div></div>
    </div>`;

  let data, mine, graduate;
  try {
    // 先刷新被赞数据（CLI 增量统计频道帖子点赞），再拉取最新积分
    try {
      await API.get('/api/points/refresh-likes');
    } catch (_) { /* 刷新失败（如未 QQ 登录）不阻塞页面 */ }
    [data, mine, graduate] = await Promise.all([
      API.get('/api/points/leaderboard'),
      API.get('/api/points'),
      API.post('/api/points/graduate', '{}'),
    ]);
  } catch (err) {
    document.getElementById('points-content').innerHTML =
      `<div class="empty"><div class="empty-icon">⚠️</div>${escapeHtml(err.message)}</div>`;
    return;
  }

  const content = document.getElementById('points-content');
  const me = data.me || {};
  const myPoints = (mine && typeof mine.points === 'number') ? mine.points : (me.points || 0);
  const myRank = me.rank || '-';
  const logs = mine.logs || [];
  const medal = ['🥇', '🥈', '🥉'];

  // ---- 刷新积分余额显示（领取毕业奖后）----
  function refreshPoints() {
    API.get('/api/points').then((m) => {
      if (m && typeof m.points === 'number') {
        const el = document.getElementById('my-points-val');
        if (el) el.textContent = m.points;
      }
    }).catch(() => {});
  }

  content.innerHTML = `
    <div class="stat-grid" style="margin-bottom:18px;">
      <div class="card stat-card"><div class="stat-label">我的积分</div><div class="stat-value" id="my-points-val">⭐ ${myPoints}</div></div>
      <div class="card stat-card"><div class="stat-label">我的排名</div><div class="stat-value">#${myRank}</div></div>
    </div>

    <div class="card" style="padding:16px 18px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
        <h2 style="margin:0;font-size:17px;">🎓 课程毕业奖励</h2>
        ${graduate.has_claimed
          ? '<button class="btn btn-sm" disabled>已领取 +50 ⭐</button>'
          : `<button class="btn btn-sm btn-primary" id="grad-btn" ${graduate.eligible ? '' : 'disabled'}>领取 +50 ⭐</button>`}
      </div>
      <div style="font-size:13px;color:var(--text-dim);line-height:1.8;">
        读完 5 章全部课程 + 完成全部章节任务，即可领取毕业大奖。
        <br>进度：📖 阅读 ${graduate.read_done}/${graduate.total} 章 · ✅ 任务 ${graduate.tasks_done}/${graduate.total} 章
        ${graduate.eligible && !graduate.has_claimed ? '<br><span style="color:var(--success);">🎉 已达成！点击领取</span>' : ''}
      </div>
    </div>

    <div class="card" style="padding:16px 18px;margin-bottom:16px;">
      <h2 style="margin:0 0 8px;font-size:17px;">💡 怎么赚积分</h2>
      <div style="font-size:13px;color:var(--text-dim);line-height:2;">
        ✍️ 提交作品文件 +50⭐ / 提交 AI 轻应用 +25⭐<br>
        🧑‍🤝‍🧑 主动点赞他人 +2⭐/次（每天上限 10⭐，票数不限）<br>
        💬 你的帖子被点赞 +2⭐/赞（每天上限 30⭐，打开本页自动统计）<br>
        🎓 读完 5 章全部任务完成，毕业大奖 +50⭐<br>
        🥚 连续点击顶栏的积分徽章 5 次，有惊喜
      </div>
    </div>

    <div class="card" style="padding:16px 18px;margin-bottom:16px;">
      <h2 style="margin:0 0 12px;font-size:17px;">🏆 全校排行榜</h2>
      <div class="lb-list">
        ${data.list.length ? data.list.map((u, i) => `
          <div class="lb-row ${u.user_id === me.user_id ? 'lb-mine' : ''}">
            <span class="lb-rank">${i < 3 ? medal[i] : '#' + (i + 1)}</span>
            <span class="lb-name">${escapeHtml(u.display_name)}${u.title_tag ? `<span class="title-tag" style="margin-left:6px;">${escapeHtml(u.title_tag)}</span>` : ''}</span>
            <span class="lb-class">${escapeHtml(u.class_name)}班</span>
            <span class="lb-points">⭐ ${u.points}</span>
          </div>`).join('')
        : `<div class="empty" style="padding:20px;">还没有人获得积分，快来抢第一！</div>`}
      </div>
    </div>

    <div class="card" style="padding:16px 18px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <h2 style="margin:0;font-size:17px;">📜 我的积分记录</h2>
        <span style="font-size:12px;color:var(--text-dim);">最近 ${logs.length} 条</span>
      </div>
      ${logs.length ? `<div class="lb-list">
        ${logs.map((l) => `
          <div class="lb-row">
            <span class="lb-reason">${escapeHtml(l.reason_text)}</span>
            <span class="lb-time">${formatTime(l.created_at)}</span>
            <span class="lb-points" style="color:${l.amount > 0 ? 'var(--success)' : 'var(--danger)'};">${l.amount > 0 ? '+' : ''}${l.amount} ⭐</span>
          </div>`).join('')}
      </div>` : `<div class="empty" style="padding:20px;">还没有积分记录</div>`}
    </div>`;

  // 毕业奖励
  const gradBtn = document.getElementById('grad-btn');
  if (gradBtn) {
    gradBtn.onclick = async () => {
      gradBtn.disabled = true;
      try {
        const r = await API.post('/api/points/graduate', '{}');
        if (r.granted) {
          toast('毕业奖励 +50 ⭐ 🎓');
          refreshPoints();
          setTimeout(() => Views.points(), 600);
        } else {
          toast(r.has_claimed ? '已经领取过啦' : '还没达成全部条件');
          gradBtn.disabled = false;
        }
      } catch (err) {
        gradBtn.disabled = false;
        toast(err.message);
      }
    };
  }
};
