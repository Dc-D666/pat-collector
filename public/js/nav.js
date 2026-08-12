'use strict';

// 导航：桌面左 rail + 移动端顶部栏 + 底部 app bar
window.Nav = (() => {
  const ITEMS = [
    { hash: '#/files', icon: '🗂️', label: '我的文件', key: 'files' },
    { hash: '#/class-wall', icon: '🏫', label: '班级作品墙', key: 'class-wall' },
    { hash: '#/overview', icon: '📊', label: '提交总览', key: 'overview' },
  ];

  function currentKey() {
    const h = location.hash || '#/files';
    if (h.startsWith('#/class-wall')) return 'class-wall';
    if (h.startsWith('#/overview')) return 'overview';
    return 'files';
  }

  function render() {
    const u = API.getUser() || {};
    const key = currentKey();
    const { escapeHtml } = Utils;
    const initial = (u.real_name || '?').trim().charAt(0);

    document.getElementById('rail').innerHTML = `
      <div class="brand">
        <span class="brand-logo">P</span><span class="brand-name">PatPlayer</span>
      </div>
      <nav class="rail-nav">
        ${ITEMS.map((it) => `
          <a class="nav-item ${it.key === key ? 'active' : ''}" href="${it.hash}">
            <span class="nav-icon">${it.icon}</span><span>${it.label}</span>
          </a>`).join('')}
      </nav>
      <div class="rail-user">
        <div class="avatar">${escapeHtml(initial)}</div>
        <div class="user-meta">
          <div class="user-name">${escapeHtml(u.real_name || '')}</div>
          <div class="user-class">${u.class_name ? escapeHtml(u.class_name + '班') : ''}</div>
        </div>
        <button class="icon-btn logout-btn" title="退出登录">⎋</button>
      </div>`;

    document.getElementById('topbar').innerHTML = `
      <div class="topbar-title">PatPlayer</div>
      <div style="display:flex;align-items:center;gap:10px;">
        <div class="topbar-user">${u.class_name ? escapeHtml(u.class_name + '班 ' + u.real_name) : ''}</div>
        <button class="icon-btn logout-btn" title="退出登录">⎋</button>
      </div>`;

    document.getElementById('appbar').innerHTML = ITEMS.map((it) => `
      <a class="appbar-item ${it.key === key ? 'active' : ''}" href="${it.hash}">
        <span class="nav-icon">${it.icon}</span><span>${it.label}</span>
      </a>`).join('');

    document.querySelectorAll('.logout-btn').forEach((btn) => {
      btn.onclick = () => { API.clearToken(); location.hash = '#/login'; };
    });
  }

  return { render };
})();
