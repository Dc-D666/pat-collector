'use strict';

// 全校作品展视图：所有班级的项目平铺展示（文件 + 轻应用），班级用 tag 标识，实时搜索
window.Views = window.Views || {};
Views.classWall = async () => {
  const { escapeHtml, formatSize, formatTime, getFileIcon, toast } = Utils;
  const view = document.getElementById('view');
  const myClass = (API.getUser() || {}).class_name || '';

  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">全校作品展</h1>
        <div class="page-sub" id="wall-sub">全校同学的作品与轻应用</div>
      </div>
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input id="wall-search" placeholder="搜索项目标题 / 作者 / 班级" />
      </div>
      <div id="wall-content"><div class="spinner"></div></div>
    </div>`;

  let projects = [];

  try {
    const data = await API.get('/api/class/wall');
    projects = data.projects || [];
    document.getElementById('wall-sub').textContent =
      `全校共 ${projects.length} 个项目 · 文件与 AI 轻应用混排展示`;
  } catch (err) {
    document.getElementById('wall-content').innerHTML =
      `<div class="empty"><div class="empty-icon">⚠️</div>${escapeHtml(err.message)}</div>`;
    return;
  }

  function classTag(p) {
    const isMine = p.class_name === myClass;
    return `<span class="proj-tag ${isMine ? 'tag-mine' : ''}">${escapeHtml(p.class_name)}班</span>`;
  }

  function render(filter) {
    const q = String(filter || '').trim().toLowerCase();
    const content = document.getElementById('wall-content');

    const visible = projects.filter((p) => {
      if (!q) return true;
      const hay = [
        p.title,
        p.original_name,
        p.display_name,
        p.class_name,
        p.description,
        p.gameplay,
      ].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });

    if (!visible.length) {
      content.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div>没有匹配的项目</div>`;
      return;
    }

    content.innerHTML = `<div class="wall-grid">${visible.map((p) => {
      const isFile = p.type === 'file';
      const icon = isFile ? getFileIcon(p.original_name || '') : { emoji: '🤖', color: '#ede9fe' };
      const canDl = isFile && (p.is_mine || p.same_class);
      return `
        <div class="card project-card">
          <div class="proj-head">
            <div class="proj-icon" style="background:${icon.color};">${icon.emoji}</div>
            <div class="proj-main">
              <div class="proj-title">${escapeHtml(p.title || (isFile ? p.original_name : 'AI 轻应用'))}</div>
              <div class="proj-meta">${classTag(p)}<span class="proj-author">${escapeHtml(p.display_name)}</span></div>
            </div>
          </div>
          ${p.description ? `<div class="proj-desc">${escapeHtml(p.description)}</div>` : ''}
          ${p.gameplay ? `<div class="proj-desc">玩法：${escapeHtml(p.gameplay)}</div>` : ''}
          <div class="proj-foot">
            <div class="proj-time">
              ${isFile
                ? `${escapeHtml(p.original_name)} · ${formatSize(p.size)}<br>${formatTime(p.time)}`
                : formatTime(p.time)}
            </div>
            <div class="file-actions">
              ${isFile
                ? (canDl
                    ? `<button class="btn btn-sm btn-ghost" data-dl="${p.id}" data-name="${escapeHtml(p.original_name)}">下载</button>`
                    : `<span class="proj-lock" title="仅同班可下载">🔒</span>`)
                : `<a class="btn btn-sm btn-primary" href="${escapeHtml(p.app_url)}" target="_blank" rel="noopener">跳转试玩</a>`}
            </div>
          </div>
        </div>`;
    }).join('')}</div>`;

    content.querySelectorAll('[data-dl]').forEach((b) => {
      b.onclick = async () => {
        try { await API.download(b.dataset.dl, b.dataset.name); }
        catch (err) { toast(err.message); }
      };
    });
  }

  document.getElementById('wall-search').oninput = (e) => render(e.target.value);
  render('');
};
