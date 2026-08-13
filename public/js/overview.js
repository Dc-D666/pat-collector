'use strict';

// 全校提交总览视图：统计卡片 + 每班/每生明细（可展开）
window.Views = window.Views || {};
Views.overview = async () => {
  const { escapeHtml, formatSize, formatTime, getFileIcon, toast } = Utils;
  const view = document.getElementById('view');

  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">提交总览</h1>
        <div class="page-sub">全校各班作品提交情况</div>
      </div>
      <div id="overview-content"><div class="spinner"></div></div>
    </div>`;

  let data;
  try {
    data = await API.get('/api/class/overview');
  } catch (err) {
    document.getElementById('overview-content').innerHTML =
      `<div class="empty"><div class="empty-icon">⚠️</div>${escapeHtml(err.message)}</div>`;
    return;
  }

  const myClass = (API.getUser() || {}).class_name;
  const { stats, classes } = data;

  const statCards = [
    { label: '总班级数', value: stats.total_classes },
    { label: '有提交班级', value: stats.classes_with_submissions },
    { label: '总文件数', value: stats.total_files },
    { label: '总大小', value: formatSize(stats.total_size) },
    ...(stats.total_apps ? [{ label: 'AI 轻应用', value: stats.total_apps }] : []),
  ];

  const content = document.getElementById('overview-content');
  content.innerHTML = `
    <div class="stat-grid">
      ${statCards.map((c) => `
        <div class="card stat-card">
          <div class="stat-label">${c.label}</div>
          <div class="stat-value">${c.value}</div>
        </div>`).join('')}
    </div>
    <div id="class-list">
      ${classes.map((c, ci) => `
        <div class="card class-card" id="class-card-${ci}">
          <button class="class-head" data-toggle="class-${ci}">
            <span class="class-title">${escapeHtml(c.class_name)}班 <span style="font-size:12px;color:var(--text-dim);font-weight:400;">${c.grade}</span></span>
            <span class="class-stats">${c.student_count} 人 · ${c.file_count} 文件 · ${formatSize(c.total_size)} · ${formatTime(c.last_submit)}</span>
            <span class="chevron">▾</span>
          </button>
          <div class="class-body">
            ${c.students.map((s, si) => `
              <div class="student-row" id="stu-row-${ci}-${si}">
                <button class="student-head" data-toggle="stu-${ci}-${si}">
                  <span class="avatar" style="width:30px;height:30px;font-size:13px;">${escapeHtml((s.display_name || s.real_name).trim().charAt(0))}</span>
                  <span class="stu-name">${escapeHtml(s.display_name || s.real_name)}</span>
                  <span class="stu-stats">${s.file_count} 文件${s.app_count ? ' · ' + s.app_count + ' 轻应用' : ''} · ${formatSize(s.total_size)} · ${formatTime(s.last_submit)}</span>
                  <span class="chevron">▾</span>
                </button>
                <div class="student-files">
                  ${(s.apps || []).map((a) => `
                    <div class="file-row">
                      <div class="file-icon" style="width:32px;height:32px;font-size:16px;background:#EDE6D6;">🤖</div>
                      <div class="file-info">
                        <div class="file-name">${escapeHtml(a.title || 'AI 轻应用')}</div>
                        <div class="file-meta">${escapeHtml(a.description || '')}${a.gameplay ? ' · ' + escapeHtml(a.gameplay) : ''}</div>
                      </div>
                      <div class="file-actions">
                        <a class="btn btn-sm btn-primary" href="${escapeHtml(a.app_url)}" target="_blank" rel="noopener">跳转试玩</a>
                      </div>
                    </div>`).join('')}
                  ${s.files.map((f) => {
                    const icon = getFileIcon(f.original_name);
                    const canDl = c.class_name === myClass;
                    return `
                      <div class="file-row">
                        <div class="file-icon" style="width:32px;height:32px;font-size:16px;background:${icon.color};">${icon.emoji}</div>
                        <div class="file-info">
                          <div class="file-name">${escapeHtml(f.title && f.title.trim() ? f.title : f.original_name)}</div>
                          <div class="file-meta">${escapeHtml(f.title && f.title.trim() ? f.original_name + ' · ' : '')}${formatSize(f.size)} · ${formatTime(f.uploaded_at)}</div>
                        </div>
                        ${canDl ? `<div class="file-actions"><button class="btn btn-sm btn-ghost" data-dl="${f.id}" data-name="${escapeHtml(f.original_name)}">下载</button></div>` : ''}
                      </div>`;
                  }).join('')}
                </div>
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;

  if (!classes.length) {
    document.getElementById('class-list').innerHTML =
      `<div class="empty"><div class="empty-icon">📊</div>暂无提交记录</div>`;
  }

  // 展开/收起
  content.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.toggle;
      if (key.startsWith('class-')) {
        const el = document.getElementById('class-card-' + key.slice(6));
        el.classList.toggle('open');
      } else {
        const [_, ci, si] = key.split('-');
        const el = document.getElementById(`stu-row-${ci}-${si}`);
        el.classList.toggle('open');
      }
    };
  });

  // 下载（仅本班）
  content.querySelectorAll('[data-dl]').forEach((b) => {
    b.onclick = async () => {
      try { await API.download(b.dataset.dl, b.dataset.name); }
      catch (err) { toast(err.message); }
    };
  });
};
