'use strict';

// 班级作品墙视图：本班按姓名分组 + 实时搜索
window.Views = window.Views || {};
Views.classWall = async () => {
  const { escapeHtml, formatSize, formatTime, getFileIcon, toast } = Utils;
  const view = document.getElementById('view');

  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">班级作品墙</h1>
        <div class="page-sub" id="wall-sub">同班同学可互相查看</div>
      </div>
      <div class="search-box">
        <span class="search-icon">🔍</span>
        <input id="wall-search" placeholder="搜索同学姓名或文件名" />
      </div>
      <div id="wall-content"><div class="spinner"></div></div>
    </div>`;

  let students = [];
  let class_name = '';

  try {
    const data = await API.get('/api/class/wall');
    students = data.students;
    class_name = data.class_name;
    document.getElementById('wall-sub').textContent = `${class_name}班 · 共 ${students.length} 位同学提交`;
  } catch (err) {
    document.getElementById('wall-content').innerHTML =
      `<div class="empty"><div class="empty-icon">⚠️</div>${escapeHtml(err.message)}</div>`;
    return;
  }

  function render(filter) {
    const q = String(filter || '').trim().toLowerCase();
    const content = document.getElementById('wall-content');

    const visible = students
      .map((s) => {
        const nameHit = !q || s.real_name.toLowerCase().includes(q);
        const files = q ? s.files.filter((f) => f.original_name.toLowerCase().includes(q)) : s.files;
        if (q && !nameHit && files.length === 0) return null;
        // 姓名命中时显示该同学全部文件；否则只显示文件名命中的文件
        return { ...s, files: nameHit ? s.files : files };
      })
      .filter(Boolean);

    if (!visible.length) {
      content.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div>没有匹配的结果</div>`;
      return;
    }

    content.innerHTML = `<div class="wall-grid">${visible.map((s) => {
      const initial = s.real_name.trim().charAt(0);
      return `
        <div class="card student-card">
          <div class="card-head">
            <div class="avatar">${escapeHtml(initial)}</div>
            <div class="stu-name">${escapeHtml(s.real_name)}</div>
            <div class="stu-meta">${s.file_count} 个文件 · ${formatTime(s.last_submit)}</div>
          </div>
          <div class="file-list">
            ${s.files.map((f) => {
              const icon = getFileIcon(f.original_name);
              return `
                <div class="file-row">
                  <div class="file-icon" style="background:${icon.color};">${icon.emoji}</div>
                  <div class="file-info">
                    <div class="file-name">${escapeHtml(f.original_name)}</div>
                    <div class="file-meta">${formatSize(f.size)} · ${formatTime(f.uploaded_at)}</div>
                  </div>
                  <div class="file-actions">
                    <button class="btn btn-sm btn-ghost" data-dl="${f.id}" data-name="${escapeHtml(f.original_name)}">下载</button>
                  </div>
                </div>`;
            }).join('')}
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
