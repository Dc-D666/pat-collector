'use strict';

// 我的积分页：被赞刷新 + 毕业奖励 + 排行榜 + 积分流水 + 赚积分小贴士
// （积分商城已下架，前端无兑换入口；后端 /shop /purchase /my-purchases 保留待重新上架）
window.Views = window.Views || {};
// 排行榜范围：in_school（默认，仅高一/高二/高三）/ all（含毕业生/外校）；跨视图重渲染保持
let lbScope = 'in_school';
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

  let data, mine, graduate, cs;
  try {
    [data, mine, graduate, cs] = await Promise.all([
      API.get('/api/points/leaderboard?scope=' + lbScope),
      API.get('/api/points'),
      // 只读查询毕业资格（GET）：页面加载不自动发放，点击「领取」按钮才 POST 发放
      API.get('/api/points/graduate'),
      // 年级/班级积分统计榜（2026-08-21）：在校口径，班级 TOP5
      API.get('/api/points/class-stats'),
    ]);
  } catch (err) {
    document.getElementById('points-content').innerHTML =
      `<div class="empty"><div class="empty-icon">${Icons.icon('error-circle', 26)}</div>${escapeHtml(err.message)}</div>`;
    return;
  }

  const content = document.getElementById('points-content');
  const me = data.me || {};
  const myPoints = (mine && typeof mine.points === 'number') ? mine.points : (me.points || 0);
  const myRank = me.rank || '-';
  const logs = mine.logs || [];
  const medal = ['🥇', '🥈', '🥉'];

  // 顶栏积分徽章与页面余额同步（2026-08-21 修复）：
  // 徽章读 localStorage 缓存的 u.points、这里是服务端实时值，积分在别处变动
  // （被点赞/后台调整/毕业领取等）后缓存未刷新会出现「徽章 ≠ 我的积分」。
  // 拿到实时值后回写缓存并重绘导航（值没变则不重绘）。
  function syncNavPoints(total) {
    const u = API.getUser() || {};
    if (typeof total === 'number' && u.points !== total) {
      u.points = total;
      API.setUser(u);
      Nav.render();
    }
  }
  syncNavPoints(myPoints);
  // +0 流水（超出计分规则被置 0）的 ⓘ 提示文案
  const ZERO_REASON_HINTS = {
    file_submit: '超出计分规则：作品文件 + GitHub 项目合计最多计 5 个',
    app_submit: '超出计分规则：提交 AI 轻应用最多计 3 个',
    link_submit: '超出计分规则：作品文件 + GitHub 项目合计最多计 5 个',
  };

  // ---- 刷新积分余额显示（领取毕业奖后）：同步页面数值 + 顶栏徽章 + 缓存 ----
  function refreshPoints() {
    API.get('/api/points').then((m) => {
      if (m && typeof m.points === 'number') {
        const el = document.getElementById('my-points-val');
        if (el) el.textContent = m.points;
        syncNavPoints(m.points);
      }
    }).catch(() => {});
  }

  content.innerHTML = `
    <div class="stat-grid" style="margin-bottom:18px;">
      <div class="card stat-card"><div class="stat-label">我的积分</div><div class="stat-value" id="my-points-val">${Icons.icon('star-filled', 20)} ${myPoints}</div></div>
      <div class="card stat-card"><div class="stat-label">我的排名</div><div class="stat-value" id="my-rank-val">#${myRank}</div></div>
    </div>

    <div class="card" style="padding:16px 18px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
        <h2 style="margin:0;font-size:17px;">${Icons.icon('education', 18)} 课程毕业奖励</h2>
        ${graduate.has_claimed
          ? '<button class="btn btn-sm" disabled>已领取 +40 ⭐</button>'
          : `<button class="btn btn-sm btn-primary" id="grad-btn" ${graduate.eligible ? '' : 'disabled'}>领取 +40 ⭐</button>`}
      </div>
      <div style="font-size:13px;color:var(--text-dim);line-height:1.8;">
        读完 5 章全部课程 + 完成全部章节任务，即可领取毕业大奖。
        <br>进度：📖 阅读 ${graduate.read_done}/${graduate.total} 章 · ✅ 任务 ${graduate.tasks_done}/${graduate.total} 章
        ${graduate.eligible && !graduate.has_claimed ? '<br><span style="color:var(--success);">🎉 已达成！点击领取</span>' : ''}
      </div>
    </div>

    <div class="card" style="padding:16px 18px;margin-bottom:16px;">
      <h2 style="margin:0 0 8px;font-size:17px;">${Icons.icon('info-circle', 18)} 怎么赚积分</h2>
      <div style="font-size:13px;color:var(--text-dim);line-height:2;">
        1. 提交作品文件 +25⭐（最多计 5 个）/ 提交 AI 轻应用 +15⭐（最多计 3 个）<br>
        2. 主动点赞他人 +2⭐/次（每天上限 10⭐，票数不限）<br>
        3. 你的作品被点赞 +5⭐/赞（每天上限 20⭐）<br>
        4. 读完 5 章全部任务完成，毕业大奖 +40⭐<br>
        5. 连续点击顶栏的积分徽章 5 次，有惊喜
      </div>
    </div>

    <div class="card" style="padding:16px 18px;margin-bottom:16px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
        <h2 style="margin:0;font-size:17px;">${Icons.icon('flag', 18)} 全校排行榜</h2>
        <div style="display:flex;border:1px solid var(--border);border-radius:9999px;overflow:hidden;">
          <button type="button" class="lb-scope-btn ${lbScope === 'in_school' ? 'active' : ''}" data-scope="in_school" style="border:none;background:${lbScope === 'in_school' ? 'var(--primary)' : 'transparent'};color:${lbScope === 'in_school' ? '#fff' : 'var(--text-dim)'};padding:5px 14px;font-size:13px;font-weight:600;cursor:pointer;">在校</button>
          <button type="button" class="lb-scope-btn ${lbScope === 'all' ? 'active' : ''}" data-scope="all" style="border:none;background:${lbScope === 'all' ? 'var(--primary)' : 'transparent'};color:${lbScope === 'all' ? '#fff' : 'var(--text-dim)'};padding:5px 14px;font-size:13px;font-weight:600;cursor:pointer;">全部</button>
        </div>
      </div>
      <div id="lb-list" class="lb-list">
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

    <div class="card" style="padding:16px 18px;margin-bottom:16px;">
      <h2 style="margin:0 0 4px;font-size:17px;">${Icons.icon('chart-bar', 18)} 年级 · 班级排行</h2>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">按在校同学总积分统计（不含毕业生 / 外校）</div>

      <div style="font-size:13px;font-weight:600;margin:10px 0 6px;">${Icons.icon('chart-bar', 15)} 年级总积分</div>
      <div class="lb-list">
        ${(cs.grades || []).map((g) => `
          <div class="lb-row">
            <span class="lb-rank">${g.rank <= 3 ? medal[g.rank - 1] : '#' + g.rank}</span>
            <span class="lb-name">${escapeHtml(g.grade)}</span>
            <span class="lb-class">${g.student_count} 人 · 人均 ${g.avg_points}</span>
            <span class="lb-points">⭐ ${g.total_points}</span>
          </div>`).join('')}
      </div>

      <div style="font-size:13px;font-weight:600;margin:14px 0 6px;">${Icons.icon('view-module', 15)} 班级总积分 TOP5</div>
      <div class="lb-list">
        ${(cs.classes || []).length ? (cs.classes || []).map((c) => `
          <div class="lb-row">
            <span class="lb-rank">${c.rank <= 3 ? medal[c.rank - 1] : '#' + c.rank}</span>
            <span class="lb-name">${escapeHtml(c.class_name)}班</span>
            <span class="lb-class">${c.student_count} 人 · 人均 ${c.avg_points}</span>
            <span class="lb-points">⭐ ${c.total_points}</span>
          </div>`).join('') : `<div class="empty" style="padding:20px;">还没有班级获得积分，快来拉高班级总分！</div>`}
      </div>
    </div>

    <div class="card" style="padding:16px 18px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
        <h2 style="margin:0;font-size:17px;">${Icons.icon('history', 18)} 我的积分记录</h2>
        <span style="font-size:12px;color:var(--text-dim);">最近 ${logs.length} 条</span>
      </div>
      ${logs.length ? `<div class="lb-list">
        ${logs.map((l) => {
          const zero = l.amount === 0;
          const zeroHint = zero ? (ZERO_REASON_HINTS[l.reason] || '超出计分规则，该次未计入积分') : '';
          return `
          <div class="lb-row">
            <span class="lb-reason">${escapeHtml(l.reason_text)}${zero ? `<button class="lb-info" type="button" data-hint="${zeroHint}" title="${zeroHint}" aria-label="${zeroHint}">${Icons.icon('info-circle', 14)}</button>` : ''}</span>
            <span class="lb-time">${formatTime(l.created_at)}</span>
            <span class="lb-points" style="color:${l.amount > 0 ? 'var(--success)' : (l.amount < 0 ? 'var(--danger)' : 'var(--text-dim)')};">${l.amount > 0 ? '+' : ''}${l.amount} ⭐</span>
          </div>`;
        }).join('')}
      </div>` : `<div class="empty" style="padding:20px;">还没有积分记录</div>`}
    </div>`;

  // 积分记录中 +0 流水（超出计分规则）的 ⓘ 图标：点击 toast 说明原因
  document.querySelectorAll('.lb-info').forEach((btn) => {
    btn.onclick = () => Utils.toast(btn.dataset.hint || '超出计分规则，该次未计入积分');
  });

  // 排行榜「在校/全部」切换：局部刷新列表与我的排名（默认在校）
  document.querySelectorAll('.lb-scope-btn').forEach((btn) => {
    btn.onclick = async () => {
      if (btn.dataset.scope === lbScope) return;
      lbScope = btn.dataset.scope;
      btn.disabled = true;
      try {
        const d = await API.get('/api/points/leaderboard?scope=' + lbScope);
        const listEl = document.getElementById('lb-list');
        if (listEl) {
          listEl.innerHTML = d.list.length ? d.list.map((u, i) => `
            <div class="lb-row ${u.user_id === d.me.user_id ? 'lb-mine' : ''}">
              <span class="lb-rank">${i < 3 ? medal[i] : '#' + (i + 1)}</span>
              <span class="lb-name">${escapeHtml(u.display_name)}${u.title_tag ? `<span class="title-tag" style="margin-left:6px;">${escapeHtml(u.title_tag)}</span>` : ''}</span>
              <span class="lb-class">${escapeHtml(u.class_name)}班</span>
              <span class="lb-points">⭐ ${u.points}</span>
            </div>`).join('')
          : `<div class="empty" style="padding:20px;">还没有人获得积分，快来抢第一！</div>`;
        }
        const rankVal = document.getElementById('my-rank-val');
        if (rankVal) rankVal.textContent = '#' + (d.me && d.me.rank || '-');
      } catch (err) {
        toast(err.message);
      }
      document.querySelectorAll('.lb-scope-btn').forEach((x) => {
        const on = x.dataset.scope === lbScope;
        x.style.background = on ? 'var(--primary)' : 'transparent';
        x.style.color = on ? '#fff' : 'var(--text-dim)';
        x.classList.toggle('active', on);
      });
      btn.disabled = false;
    };
  });

  // 毕业奖励
  const gradBtn = document.getElementById('grad-btn');
  if (gradBtn) {
    gradBtn.onclick = async () => {
      gradBtn.disabled = true;
      try {
        const r = await API.post('/api/points/graduate', '{}');
        if (r.granted) {
          toast('毕业奖励 +40 ⭐');
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
