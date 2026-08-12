'use strict';

// 我的文件视图：上传 / 列表 / 下载 / 删除
window.Views = window.Views || {};
Views.files = () => {
  const { escapeHtml, formatSize, formatTime, getFileIcon, confirm, toast } = Utils;
  const view = document.getElementById('view');

  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">我的文件</h1>
        <div class="page-sub">拖拽或点击上传，仅本人可见</div>
      </div>

      <div class="dropzone" id="dropzone">
        <div class="dz-icon">📤</div>
        <div class="dz-title">点击选择 或 拖拽文件到此处</div>
        <div class="dz-hint">支持多文件上传，失败的文件会自动跳过</div>
        <input type="file" id="file-input" multiple style="display:none;" />
      </div>

      <div class="card upload-queue" id="upload-queue"></div>

      <div class="card">
        <div id="file-list"><div class="spinner"></div></div>
      </div>
    </div>`;

  // ---- 上传交互 ----
  const dz = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  dz.onclick = () => fileInput.click();
  fileInput.onchange = () => { uploadFiles(fileInput.files); fileInput.value = ''; };
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
  dz.addEventListener('drop', (e) => uploadFiles(e.dataTransfer.files));

  async function uploadFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const queue = document.getElementById('upload-queue');
    queue.classList.add('show');
    queue.innerHTML = `
      <div class="progress"><div class="progress-bar" id="progress-bar"></div></div>
      <div id="upload-items">${files.map((f, i) => `
        <div class="upload-item" data-idx="${i}">
          <span class="fstatus">⏳</span><span class="fname">${escapeHtml(f.name)}</span>
        </div>`).join('')}</div>`;
    const bar = document.getElementById('progress-bar');
    const setStatus = (i, icon) => {
      const el = queue.querySelector(`[data-idx="${i}"] .fstatus`);
      if (el) el.textContent = icon;
    };
    let done = 0;
    for (let i = 0; i < files.length; i++) {
      const fd = new FormData();
      fd.append('file', files[i]);
      try {
        await API.post('/api/files/upload', fd);
        setStatus(i, '✅');
      } catch (err) {
        setStatus(i, '❌');
        const row = queue.querySelector(`[data-idx="${i}"]`);
        if (row) { row.title = err.message; row.querySelector('.fname').textContent += ' — ' + err.message; }
      }
      done++;
      bar.style.width = (done / files.length) * 100 + '%';
    }
    await loadFiles();
  }

  // ---- 文件列表 ----
  async function loadFiles() {
    const list = document.getElementById('file-list');
    let files;
    try {
      const data = await API.get('/api/files');
      files = data.files;
    } catch (err) {
      list.innerHTML = `<div class="empty"><div class="empty-icon">⚠️</div>${escapeHtml(err.message)}</div>`;
      return;
    }
    if (!files.length) {
      list.innerHTML = `<div class="empty"><div class="empty-icon">🗂️</div>暂无文件，快来上传第一份作品吧</div>`;
      return;
    }
    list.innerHTML = `<div class="file-list">${files.map((f) => {
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
            <button class="btn btn-sm btn-ghost" data-del="${f.id}" style="color:var(--danger);">删除</button>
          </div>
        </div>`;
    }).join('')}</div>`;

    list.querySelectorAll('[data-dl]').forEach((b) => {
      b.onclick = async () => {
        try { await API.download(b.dataset.dl, b.dataset.name); }
        catch (err) { toast(err.message); }
      };
    });
    list.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const ok = await confirm('确定删除该文件吗？删除后不可恢复。', { danger: true });
        if (!ok) return;
        try { await API.del('/api/files/' + b.dataset.del); toast('已删除'); await loadFiles(); }
        catch (err) { toast(err.message); }
      };
    });
  }

  loadFiles();
};
