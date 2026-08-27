'use strict';

// 导航：桌面左 rail + 移动端顶部栏 + 底部 app bar
window.Nav = (() => {
  // icon 为 TDesign 图标名（2026-08-22 起替代 emoji，经 Icons.icon() 渲染内联 SVG）
  const ITEMS = [
    { hash: '#/activity', icon: 'activity', label: '活动简介', key: 'activity' },
    { hash: '#/learn', icon: 'education', label: 'AI 小学堂', key: 'learn' },
    { hash: '#/class-wall', icon: 'view-module', label: '全校作品展', key: 'class-wall' },
    { hash: '#/files', icon: 'folder', label: '我的项目', key: 'files' },
    { hash: '#/points', icon: 'star-filled', label: '我的积分', key: 'points' },
  ];

  function currentKey() {
    const h = location.hash || '#/activity';
    if (h.startsWith('#/activity')) return 'activity';
    if (h.startsWith('#/files')) return 'files';
    if (h.startsWith('#/gen')) return 'gen'; // AI 轻应用独立页：不进主导航，任何项都不高亮
    if (h.startsWith('#/class-wall')) return 'class-wall';
    if (h.startsWith('#/overview')) return 'overview';
    if (h.startsWith('#/learn')) return 'learn';
    if (h.startsWith('#/points')) return 'points';
    if (h.startsWith('#/admin')) return 'admin';
    return 'activity';
  }

  function render() {
    const u = API.getUser() || {};
    const key = currentKey();
    const { escapeHtml } = Utils;
    const displayName = u.display_name || u.real_name || '';
    const initial = displayName.trim().charAt(0);
    // 管理后台入口：仅管理员可见
    const items = [...ITEMS];
    if (u.is_admin) items.push({ hash: '#/admin', icon: 'setting', label: '管理后台', key: 'admin' });

    document.getElementById('rail').innerHTML = `
      <div class="brand">
        <img class="brand-logo" src="/img/logo.png" alt="南中科创局" onerror="this.outerHTML='<span class=&quot;brand-logo&quot; style=&quot;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700;&quot;>南</span>'" /><span class="brand-name">南中科创局</span>
      </div>
      <nav class="rail-nav">
        ${items.map((it) => `
          <a class="nav-item ${it.key === key ? 'active' : ''}" href="${it.hash}">
            ${it.icon ? `<span class="nav-icon">${Icons.icon(it.icon, 18)}</span>` : ''}<span>${it.label}</span>
          </a>`).join('')}
      </nav>
      <div class="rail-user">
        <div class="avatar">${escapeHtml(initial)}</div>
        <div class="user-meta">
          <div class="user-name">${escapeHtml(displayName)}</div>
          <div class="user-class">${u.class_name ? escapeHtml(u.class_name + '班') : ''}</div>
        </div>
        <span class="points-badge" title="我的积分">${Icons.icon('star-filled', 14)}${u.points || 0}</span>
      </div>
    `;

    document.getElementById('topbar').innerHTML = `
      <div class="topbar-title"><img class="brand-logo" src="/img/logo.png" alt="" onerror="this.remove()" style="width:24px;height:24px;border-radius:8px;" />南中科创局</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <span class="points-badge" title="我的积分">${Icons.icon('star-filled', 14)}${u.points || 0}</span>
        <div class="topbar-user">${u.class_name ? escapeHtml(u.class_name + '班 ' + displayName) : ''}</div>
        <button class="logout-btn" title="退出登录">退出</button>
      </div>`;

    document.getElementById('appbar').innerHTML = items.map((it) => `
      <a class="appbar-item ${it.key === key ? 'active' : ''}" href="${it.hash}">
        ${it.icon ? `<span class="nav-icon">${Icons.icon(it.icon, 18)}</span>` : ''}<span>${it.label}</span>
      </a>`).join('');

    document.querySelectorAll('.logout-btn').forEach((btn) => {
      btn.onclick = async () => {
        const yes = await Utils.confirm('确定要退出登录吗？');
        if (!yes) return;
        API.clearToken();
        location.hash = '#/login';
      };
    });
  }

  return { render };
})();
