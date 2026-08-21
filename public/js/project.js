'use strict';

// 项目地址页（#/p/:token）：访客凭地址令牌查看 / 下载 / 继续上传自己的作品。
// 独立页（不进入系统）：隐藏主页壳，仅本项目相关能力。
window.Views = window.Views || {};
Views.project = (token) => {
  const { escapeHtml, formatSize, formatTime, getFileIcon, toast, openModal, closeModal } = Utils;
  const view = document.getElementById('view');
  const tk = String(token || '').trim();

  view.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card card" id="project-root">
        <div class="spinner"></div>
      </div>
    </div>`;

  if (!tk) {
    renderError('项目地址无效');
    return;
  }

  async function loadData() {
    try {
      // 令牌走请求头，避免出现在 URL（防 nginx 访问日志/浏览器历史记录泄露永久项目地址令牌）
      return await API.get('/api/guest/files', { headers: { 'x-guest-token': tk } });
    } catch (err) {
      renderError(err.message || '项目地址无效或已失效');
      return null;
    }
  }

  function renderError(msg) {
    const root = document.getElementById('project-root');
    if (!root) return;
    root.innerHTML = `
      <div class="auth-brand"><img class="brand-logo" src="/img/logo.png" alt="南中科创局" onerror="this.outerHTML='<span class=&quot;brand-logo&quot; style=&quot;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700;&quot;>南</span>'" /><h1>项目地址无效</h1></div>
      <div class="form-error show" style="display:block;margin:10px 0;">${escapeHtml(msg)}</div>
      <a class="btn" style="width:100%;justify-content:center;" href="#/login">返回首页</a>`;
  }

  function downloadFile(fileId, filename) {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      fetch('/api/guest/download/' + fileId, { headers: { 'x-guest-token': tk }, signal: controller.signal })
        .then(async (res) => {
          clearTimeout(timer);
          if (!res.ok) {
            let msg = '下载失败';
            try { msg = (await res.json()).error || msg; } catch (_) { /* ignore */ }
            throw new Error(msg);
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
          resolve();
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e && e.name === 'AbortError' ? new Error('下载超时，请重试') : e);
        });
    });
  }

  function render(data) {
    const root = document.getElementById('project-root');
    if (!root) return;
    const u = data.user || {};
    const q = data.quota || {};
    const files = data.files || [];
    const isHtml = (name) => /\.(html?|htm)$/i.test(name || '');
    const remaining = q.remaining != null ? q.remaining : Math.max(0, (q.max_uploads_per_day || 5) - (q.uploads_today || 0));

    root.innerHTML = `
      <div class="auth-brand"><img class="brand-logo" src="/img/logo.png" alt="南中科创局" onerror="this.outerHTML='<span class=&quot;brand-logo&quot; style=&quot;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700;&quot;>南</span>'" /><h1>我的项目</h1><p>${escapeHtml((u.class_name || '') + '班 ' + (u.display_name || ''))}</p></div>

      <a href="#/login" style="display:block;margin:0 0 14px;padding:11px 12px;border:1px dashed var(--primary);border-radius:12px;background:var(--primary-soft);text-decoration:none;color:var(--primary);font-size:13px;line-height:1.6;">
        <span style="font-weight:700;">${Icons.icon('info-circle', 15)} 想享受完整平台体验？</span>用 QQ 扫码登录并绑定你的姓名班级，当前作品与积分将合并到 QQ 账号，可参与全校作品展、AI 小学堂与积分排行榜。
      </a>

      <div class="guest-dropzone" id="p-dropzone">
        <div class="dz-icon">${Icons.icon('upload', 26)}</div>
        <div class="dz-title">继续上传作品</div>
        <div class="dz-hint">单个文件不超过 ${q.max_upload_mb || 200}MB；今天还能上传 ${remaining} 次（每天最多 ${q.max_uploads_per_day || 5} 次）</div>
        <input type="file" id="p-file-input" multiple style="display:none;" />
      </div>
      <div id="p-upload-status" style="margin-top:8px;"></div>

      <div class="card" style="margin-top:14px;">
        <div class="file-list-head"><span>共 ${files.length} 个项目</span></div>
        ${files.length ? `<div class="file-list">${files.map((f) => {
          const icon = getFileIcon(f.original_name);
          const hasTitle = !!(f.title && f.title.trim());
          return `
            <div class="file-row">
              <div class="file-icon" style="background:${icon.color};">${Icons.icon(icon.icon, 20)}</div>
              <div class="file-info">
                <div class="file-name">${escapeHtml(hasTitle ? f.title : f.original_name)}</div>
                <div class="file-meta">${escapeHtml(f.original_name)} · ${formatSize(f.size)} · ${formatTime(f.uploaded_at)}</div>
                ${f.description ? `<div class="file-meta">${escapeHtml(f.description)}</div>` : ''}
              </div>
              <div class="file-actions">
                ${isHtml(f.original_name) ? `<a class="btn btn-sm btn-ghost" href="/preview.html?v=2#/guest/${f.id}/${tk}" target="_blank" rel="noopener">预览</a>` : ''}
                <button class="btn btn-sm btn-ghost" data-dl="${f.id}" data-name="${escapeHtml(f.original_name)}">下载</button>
                <button class="btn btn-sm btn-ghost" data-del="${f.id}" data-name="${escapeHtml(f.original_name)}" style="color:var(--danger);">删除</button>
              </div>
            </div>`;
        }).join('')}</div>` : `<div class="empty"><div class="empty-icon">🗂️</div>还没有提交过作品，上传第一份试试吧</div>`}
      </div>

      <a class="btn btn-ghost" id="p-back" style="width:100%;justify-content:center;margin-top:12px;">返回首页</a>`;

    document.getElementById('p-back').onclick = () => { location.hash = '#/login'; };

    root.querySelectorAll('[data-dl]').forEach((b) => {
      b.onclick = async () => {
        try { await downloadFile(b.dataset.dl, b.dataset.name); }
        catch (err) { toast(err.message); }
      };
    });

    // 删除：需输入安全密码（提交时自定义，未设置则用默认密码），防拿到地址的人误删/批量删
    root.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = () => showDeleteModal(b.dataset.del, b.dataset.name);
    });

    // 继续上传
    const dz = document.getElementById('p-dropzone');
    const input = document.getElementById('p-file-input');
    if (dz) dz.onclick = () => input && input.click();
    if (input) input.onchange = () => { uploadMore(input.files); input.value = ''; };
    if (dz) {
      ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
      ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
      dz.addEventListener('drop', (e) => uploadMore(e.dataTransfer.files));
    }
  }

  // 删除弹窗：需输入安全密码（提交时自定义；未设置则用默认密码），防拿到地址的人误删/批量删
  function showDeleteModal(fileId, fileName) {
    openModal(`
      <h3 class="modal-title">删除文件</h3>
      <p style="font-size:13px;color:var(--text-dim);margin:0 0 12px;">确定删除「${escapeHtml(fileName)}」吗？删除后不可恢复。</p>
      <div class="form-error" id="guest-del-error"></div>
      <div class="field"><label>安全密码</label><input id="guest-del-pwd" type="password" maxlength="64" placeholder="输入提交时设置的安全密码" /></div>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:12px;">未设置过密码？请输入默认密码 nanfang1958</div>
      <div class="modal-actions">
        <button class="btn" id="guest-del-cancel">取消</button>
        <button class="btn" id="guest-del-confirm" style="background:var(--danger);color:#fff;">确认删除</button>
      </div>`);
    const errEl = document.getElementById('guest-del-error');
    const pwdInput = document.getElementById('guest-del-pwd');
    const confirmBtn = document.getElementById('guest-del-confirm');
    document.getElementById('guest-del-cancel').onclick = closeModal;
    const doDelete = async () => {
      errEl.classList.remove('show');
      const pwd = pwdInput.value.trim();
      if (!pwd) { errEl.textContent = '请输入安全密码'; errEl.classList.add('show'); return; }
      confirmBtn.disabled = true;
      confirmBtn.textContent = '删除中…';
      try {
        // 令牌走 x-guest-token 头、密码走 JSON body：避免出现在 URL（防 nginx 访问日志/历史记录泄露）
        await API.del('/api/guest/files/' + fileId, {
          headers: { 'x-guest-token': tk },
          body: JSON.stringify({ password: pwd }),
        });
        closeModal();
        toast('已删除');
        const data = await loadData();
        if (data) render(data);
      } catch (err) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = '确认删除';
        errEl.textContent = err.message;
        errEl.classList.add('show');
      }
    };
    confirmBtn.onclick = doDelete;
    pwdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doDelete(); });
    setTimeout(() => pwdInput && pwdInput.focus(), 50);
  }

  async function uploadMore(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const statusEl = document.getElementById('p-upload-status');
    if (!statusEl) return;
    if (files.length > 5) {
      toast('一次最多上传 5 个文件；如需提交更多，请打包成压缩包');
      return;
    }
    statusEl.innerHTML = files.map((f, i) => `
      <div class="file-row" style="padding:8px 10px;">
        <span style="width:20px;flex-shrink:0;" data-fs="${i}">⏳</span>
        <div class="file-info">
          <div class="file-name">${escapeHtml(f.name)}</div>
          <div class="file-meta" data-pg="${i}" style="font-size:12px;">等待上传…</div>
        </div>
      </div>`).join('');
    const setStatus = (i, icon, msg) => {
      const el = statusEl.querySelector(`[data-fs="${i}"]`);
      if (el) el.textContent = icon;
      if (msg) {
        const row = statusEl.querySelectorAll('.file-row')[i];
        if (row) { row.title = msg; row.querySelector('.file-name').textContent += ' — ' + msg; }
      }
    };
    const setProg = (i, text) => {
      const el = statusEl.querySelector(`[data-pg="${i}"]`);
      if (el) el.textContent = text;
    };
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const fd = new FormData();
      fd.append('file', f);
      // 令牌走 x-guest-token 请求头（P1：服务端在 multer 落盘前校验，不再放 multipart body）
      const tracker = Utils.createSpeedTracker();
      try {
        const up = await API.uploadWithProgress('/api/guest/upload', fd, (loaded, total) => {
          setProg(i, Utils.formatProgress(loaded, total, tracker(loaded)));
        }, { 'x-guest-token': tk });
        setStatus(i, '✅');
        setProg(i, '已完成');
        ok++;
        if (up && typeof up.uploads_today === 'number' && up.max_uploads_per_day != null && up.uploads_today >= up.max_uploads_per_day) {
          setStatus(i, '✅');
          break;
        }
      } catch (err) {
        setStatus(i, '❌', err.message);
        setProg(i, err.message);
        fail++;
        if (err.status === 401) break;
      }
    }
    if (fail) toast(`上传完成：成功 ${ok} 个，失败 ${fail} 个，原因见上方列表`);
    else toast(`✅ 上传成功 ${ok} 个`);
    const data = await loadData();
    if (data) render(data);
  }

  loadData().then((data) => { if (data) render(data); });
};
