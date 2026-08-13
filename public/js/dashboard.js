'use strict';

// 我的文件视图：上传 / 列表 / 下载 / 删除 + AI 轻应用收集
window.Views = window.Views || {};
Views.files = () => {
  const { escapeHtml, formatSize, formatTime, getFileIcon, confirm, toast, openModal, closeModal } = Utils;
  const view = document.getElementById('view');
  const isQqBound = !!(API.getUser() && API.getUser().is_qq_bound);

  // QQ 用户：顶部最显眼的自动识别入口；非 QQ 用户不渲染（上传区自然在最上）
  const topBanner = isQqBound
    ? `<div class="card" style="margin-bottom:16px;background:linear-gradient(135deg,var(--primary),#7c3aed);color:#fff;border:none;box-shadow:var(--shadow);">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <div>
            <div style="font-size:17px;font-weight:700;">🤖 自动识别 AI 轻应用</div>
            <div style="font-size:13px;opacity:.92;">一键识别你最近在 QQ 频道发布的 AI 轻应用并收集</div>
          </div>
          <button class="btn" id="auto-scan-top-btn" style="background:#fff;color:var(--primary);border:none;font-weight:700;padding:11px 22px;font-size:15px;border-radius:12px;">开始识别</button>
        </div>
      </div>`
    : '';

  const appsActionBtns = isQqBound
    ? `<button class="btn btn-primary btn-sm" id="auto-scan-btn">自动识别</button>
       <button class="btn btn-sm" id="manual-scan-btn">手动识别</button>`
    : `<span style="font-size:12px;color:var(--text-dim);">需 QQ 频道登录后可用</span>`;

  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">我的文件</h1>
        <div class="page-sub">${isQqBound ? '上传程序文件，或自动收集你的 AI 轻应用' : '拖拽或点击上传，仅本人可见'}</div>
        <button class="btn btn-sm btn-ghost" id="display-settings-btn" style="margin-top:10px;">👤 展示设置</button>
      </div>

      <div id="qq-expired-banner"></div>

      ${topBanner}

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

      <div class="card" style="margin-top:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
          <div>
            <h2 style="margin:0;font-size:17px;">AI 轻应用</h2>
            <div style="font-size:12px;color:var(--text-dim);">识别你在 QQ 频道发布的 AI 轻应用并收集</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">${appsActionBtns}</div>
        </div>
        <div id="apps-status"></div>
        <div id="apps-list"><div class="spinner"></div></div>
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

  // 上传大小上限（MB），从 /api/auth/me 获取，用于上传前预检（避免 nginx 413 直接拦截）
  let maxUploadMb = null;
  async function getMaxUploadMb() {
    if (maxUploadMb) return maxUploadMb;
    try {
      const data = await API.get('/api/auth/me');
      maxUploadMb = data.max_upload_mb || 200;
    } catch (_) { maxUploadMb = 200; }
    return maxUploadMb;
  }

  // 提交作品后刷新积分徽章（导航栏）
  async function refreshPoints() {
    try {
      const data = await API.get('/api/points');
      const u = API.getUser() || {};
      u.points = data.points;
      API.setUser(u);
      Nav.render();
    } catch (_) { /* 静默 */ }
  }

  async function uploadFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    const limitMb = await getMaxUploadMb();
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
    const newFiles = []; // 本次上传成功的文件，稍后逐个填写作品信息
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      // 前端预检大小：超过上限直接拦截，避免 nginx 返回 HTML 413
      if (f.size > limitMb * 1024 * 1024) {
        setStatus(i, '❌');
        const row = queue.querySelector(`[data-idx="${i}"]`);
        if (row) {
          const msg = `文件过大（超过 ${limitMb}MB 上限），无法上传`;
          row.title = msg; row.querySelector('.fname').textContent += ' — ' + msg;
        }
        done++;
        bar.style.width = (done / files.length) * 100 + '%';
        continue;
      }
      const fd = new FormData();
      fd.append('file', f);
      try {
        const data = await API.post('/api/files/upload', fd);
        setStatus(i, '✅');
        if (data && data.file) {
          newFiles.push({ id: data.file.id, original_name: data.file.original_name });
          refreshPoints();
        }
      } catch (err) {
        setStatus(i, '❌');
        const row = queue.querySelector(`[data-idx="${i}"]`);
        if (row) { row.title = err.message; row.querySelector('.fname').textContent += ' — ' + err.message; }
      }
      done++;
      bar.style.width = (done / files.length) * 100 + '%';
    }
    await loadFiles();
    // 上传成功 → 逐个弹出「作品信息」表单（标题必填，默认文件名）
    if (newFiles.length) await promptFileInfos(newFiles);
  }

  // 逐个为上传成功的文件填写作品信息
  async function promptFileInfos(newFiles) {
    for (const f of newFiles) {
      await new Promise((resolve) => {
        showFileInfoModal(f, { onDone: resolve });
      });
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
      const hasTitle = !!(f.title && f.title.trim());
      return `
        <div class="file-row">
          <div class="file-icon" style="background:${icon.color};">${icon.emoji}</div>
          <div class="file-info">
            <div class="file-name">${escapeHtml(hasTitle ? f.title : f.original_name)}</div>
            <div class="file-meta">${hasTitle ? escapeHtml(f.original_name) + ' · ' : ''}${formatSize(f.size)} · ${formatTime(f.uploaded_at)}</div>
            ${f.description ? `<div class="file-meta">${escapeHtml(f.description)}</div>` : ''}
          </div>
          <div class="file-actions">
            <button class="btn btn-sm btn-ghost" data-edit="${f.id}">编辑</button>
            <button class="btn btn-sm btn-ghost" data-dl="${f.id}" data-name="${escapeHtml(f.original_name)}">下载</button>
            <button class="btn btn-sm btn-ghost" data-del="${f.id}" style="color:var(--danger);">删除</button>
          </div>
        </div>`;
    }).join('')}</div>`;

    list.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => {
        const f = files.find((x) => String(x.id) === b.dataset.edit);
        if (f) showFileInfoModal(f);
      };
    });

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

  // ---- 作品信息表单（新建/编辑）：标题必填（默认文件名），简介/玩法选填 ----
  function showFileInfoModal(file, { onDone } = {}) {
    const defaultTitle = (file.title && file.title.trim()) ? file.title : (file.original_name || '').replace(/\.[^.]+$/, '');
    openModal(`
      <h3 class="modal-title">作品信息</h3>
      <p style="font-size:13px;color:var(--text-dim);margin:0 0 12px;">${escapeHtml(file.original_name || '')}</p>
      <div class="form-error" id="file-info-error"></div>
      <div class="field"><label>项目标题（必填）</label><input id="file-info-title" type="text" maxlength="255" value="${escapeHtml(defaultTitle)}" placeholder="请输入项目标题" /></div>
      <div class="field"><label>应用简介（选填）</label><input id="file-info-desc" type="text" maxlength="2000" value="${escapeHtml(file.description || '')}" placeholder="一句话介绍这个作品" /></div>
      <div class="field"><label>玩法（选填）</label><input id="file-info-gameplay" type="text" maxlength="2000" value="${escapeHtml(file.gameplay || '')}" placeholder="怎么玩" /></div>
      <div class="modal-actions">
        <button class="btn" id="file-info-skip">跳过</button>
        <button class="btn btn-primary" id="file-info-save">保存</button>
      </div>`);
    document.getElementById('file-info-skip').onclick = () => { closeModal(); if (onDone) onDone(); };
    document.getElementById('file-info-save').onclick = async () => {
      const errEl = document.getElementById('file-info-error');
      errEl.classList.remove('show');
      const title = document.getElementById('file-info-title').value.trim();
      if (!title) { errEl.textContent = '请输入项目标题'; errEl.classList.add('show'); return; }
      try {
        await API.patch('/api/files/' + file.id, JSON.stringify({
          title,
          description: document.getElementById('file-info-desc').value.trim(),
          gameplay: document.getElementById('file-info-gameplay').value.trim(),
        }));
        closeModal();
        toast('已保存');
        await loadFiles();
        if (onDone) onDone();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.add('show');
      }
    };
  }

  // ---- 展示设置：是否授权展示真实姓名 / 昵称 ----
  function showDisplaySettingsModal() {
    const u = API.getUser() || {};
    const notShowReal = u.show_real_name === false || u.show_real_name === 0;
    openModal(`
      <h3 class="modal-title">展示设置</h3>
      <p style="font-size:13px;color:var(--text-dim);margin:0 0 12px;">控制你的姓名是否在作品墙 / 提交总览中展示</p>
      <div class="form-error" id="display-settings-error"></div>
      <div class="field">
        <label>是否授权展示真实姓名</label>
        <div style="display:flex;gap:16px;margin-top:6px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;"><input type="radio" name="ds-show-real" value="1" ${notShowReal ? '' : 'checked'} /> 是</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;"><input type="radio" name="ds-show-real" value="0" ${notShowReal ? 'checked' : ''} /> 否，只展示昵称</label>
        </div>
      </div>
      <div class="field" id="ds-nickname-field" style="display:${notShowReal ? '' : 'none'};">
        <label>展示昵称</label>
        <input id="ds-nickname" type="text" maxlength="32" value="${escapeHtml(u.nickname || '')}" placeholder="作品墙上展示的昵称" />
      </div>
      <div class="modal-actions">
        <button class="btn" id="ds-cancel">取消</button>
        <button class="btn btn-primary" id="ds-save">保存</button>
      </div>`);
    const nicknameField = document.getElementById('ds-nickname-field');
    document.querySelectorAll('input[name="ds-show-real"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        nicknameField.style.display = radio.value === '0' ? '' : 'none';
      });
    });
    document.getElementById('ds-cancel').onclick = closeModal;
    document.getElementById('ds-save').onclick = async () => {
      const errEl = document.getElementById('display-settings-error');
      errEl.classList.remove('show');
      const showReal = (document.querySelector('input[name="ds-show-real"]:checked') || {}).value !== '0';
      const nickname = document.getElementById('ds-nickname').value.trim();
      if (!showReal && !nickname) {
        errEl.textContent = '选择只展示昵称后，请填写昵称';
        errEl.classList.add('show');
        return;
      }
      try {
        const data = await API.patch('/api/auth/profile', JSON.stringify({ show_real_name: showReal, nickname }));
        API.setUser(data.user);
        closeModal();
        toast('已保存');
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.add('show');
      }
    };
  }

  // ---- AI 轻应用 ----
  async function loadApps() {
    const list = document.getElementById('apps-list');
    try {
      const data = await API.get('/api/apps');
      const apps = data.apps;
      if (!apps.length) {
        list.innerHTML = `<div class="empty" style="padding:20px;">还没有收集的轻应用</div>`;
        return;
      }
      list.innerHTML = apps.map((a) => `
        <div class="app-row">
          <div class="app-info">
            <a class="app-title" href="${escapeHtml(a.app_url)}" target="_blank" rel="noopener">${escapeHtml(a.title || a.app_url)}</a>
            ${a.description ? `<div class="app-desc">${escapeHtml(a.description)}</div>` : ''}
            ${a.gameplay ? `<div class="app-desc">玩法：${escapeHtml(a.gameplay)}</div>` : ''}
          </div>
          <div class="file-actions">
            <button class="btn btn-sm btn-ghost app-del" data-id="${a.id}" style="color:var(--danger);">删除</button>
          </div>
        </div>`).join('');
      list.querySelectorAll('.app-del').forEach((b) => {
        b.onclick = async () => {
          const ok = await confirm('删除该轻应用？', { danger: true });
          if (!ok) return;
          try { await API.del('/api/apps/' + b.dataset.id); toast('已删除'); await loadApps(); }
          catch (err) { toast(err.message); }
        };
      });
    } catch (err) {
      list.innerHTML = `<div class="empty" style="padding:20px;">${escapeHtml(err.message)}</div>`;
    }
  }

  // 已识别但未提交的轻应用（累积，按 url 去重）
  let scanItems = [];

  function renderScanResults() {
    const status = document.getElementById('apps-status');
    if (!scanItems.length) {
      status.innerHTML = `<div class="empty" style="padding:16px;">还没有识别结果</div>`;
      return;
    }
    status.innerHTML = `
      <div style="font-size:13px;color:var(--text-dim);margin-bottom:8px;">识别到 ${scanItems.length} 个轻应用（未提交）：</div>
      ${scanItems.map((it, i) => `
        <div class="app-row">
          <div class="app-info">
            <div class="app-title">${escapeHtml(it.text || it.post_title || it.url)}</div>
            <div class="app-desc">来源帖子：${escapeHtml(it.post_title || it.feed_id)}</div>
          </div>
          <div class="file-actions">
            <a class="btn btn-sm btn-ghost" href="${escapeHtml(it.url)}" target="_blank" rel="noopener">跳转</a>
            <button class="btn btn-sm btn-primary app-submit-btn" data-i="${i}">提交</button>
          </div>
        </div>`).join('')}`;
    status.querySelectorAll('.app-submit-btn').forEach((b) => {
      b.onclick = () => {
        const it = scanItems[parseInt(b.dataset.i, 10)];
        if (it) showSubmitModal(it.url, it.text || it.post_title || '', it.feed_id);
      };
    });
  }

  function addScanItems(posts) {
    let added = 0;
    for (const p of posts) {
      for (const a of (p.apps || [])) {
        const item = { feed_id: p.feed_id, post_title: p.title, text: a.text, url: a.url };
        if (scanItems.some((x) => x.url === item.url)) continue;
        scanItems.push(item);
        added++;
      }
    }
    renderScanResults();
    return added;
  }

  function showScanning(msg) {
    const status = document.getElementById('apps-status');
    status.innerHTML = `<div class="scan-loading"><div class="spinner"></div><p>${escapeHtml(msg)}</p></div>`;
  }

  async function autoScan() {
    showScanning('正在识别你的近期帖子，可能需要一点时间…');
    try {
      const data = await API.post('/api/apps/auto-scan', JSON.stringify({}));
      scanItems = []; // 自动识别重置结果
      addScanItems(data.posts || []);
      if (!scanItems.length) {
        document.getElementById('apps-status').innerHTML = `<div class="empty" style="padding:16px;">没有在近期帖子中识别到轻应用</div>`;
      }
    } catch (err) {
      document.getElementById('apps-status').innerHTML = `<div class="form-error show" style="display:block;">${escapeHtml(err.message)}</div>`;
    }
  }

  function manualScan() {
    openModal(`
      <h3 class="modal-title">手动识别</h3>
      <p style="font-size:13px;color:var(--text-dim);margin:0 0 12px;">粘贴帖子ID（B_ 开头）或分享链接/文本</p>
      <div class="form-error" id="manual-scan-error"></div>
      <div class="field"><textarea id="manual-scan-text" rows="3" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:10px;font-size:14px;" placeholder="例如：点击链接查看腾讯频道帖子【...】：https://pd.qq.com/s/xxx"></textarea></div>
      <div id="manual-scan-result"></div>
      <div class="modal-actions">
        <button class="btn" id="manual-cancel">取消</button>
        <button class="btn btn-primary" id="manual-save">识别</button>
      </div>`);
    document.getElementById('manual-cancel').onclick = closeModal;
    document.getElementById('manual-save').onclick = async () => {
      const errEl = document.getElementById('manual-scan-error');
      const resultEl = document.getElementById('manual-scan-result');
      errEl.classList.remove('show');
      const text = document.getElementById('manual-scan-text').value.trim();
      if (!text) { errEl.textContent = '请粘贴帖子ID或分享链接'; errEl.classList.add('show'); return; }
      resultEl.innerHTML = `<div class="scan-loading"><div class="spinner"></div><p>识别中…</p></div>`;
      try {
        const data = await API.post('/api/apps/manual-scan', JSON.stringify({ text }));
        if (data.apps && data.apps.length) {
          addScanItems([{ feed_id: data.feed_id, title: data.title, apps: data.apps }]);
          resultEl.innerHTML = `<div style="color:var(--success);font-size:13px;">✓ 识别到 ${data.apps.length} 个轻应用，已加入下方列表</div>`;
          setTimeout(closeModal, 800);
        } else {
          resultEl.innerHTML = `<div class="empty" style="padding:12px;">该帖子未识别到轻应用</div>`;
        }
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.add('show');
        resultEl.innerHTML = '';
      }
    };
  }

  function showSubmitModal(appUrl, title, feedId) {
    openModal(`
      <h3 class="modal-title">提交轻应用</h3>
      <div class="form-error" id="app-submit-error"></div>
      <div class="field"><label>应用名称（必填）</label><input id="app-title" type="text" value="${escapeHtml(title)}" maxlength="255" placeholder="请输入应用名称" /></div>
      <div class="field"><label>应用链接（不可改）</label><input id="app-url" type="text" value="${escapeHtml(appUrl)}" readonly /></div>
      <div class="field"><label>应用简介（选填）</label><input id="app-desc" type="text" maxlength="2000" placeholder="一句话介绍这个应用" /></div>
      <div class="field"><label>玩法（选填）</label><input id="app-gameplay" type="text" maxlength="2000" placeholder="怎么玩" /></div>
      <div class="modal-actions">
        <button class="btn" id="app-cancel">取消</button>
        <button class="btn btn-primary" id="app-save">提交</button>
      </div>`);
    document.getElementById('app-cancel').onclick = closeModal;
    document.getElementById('app-save').onclick = async () => {
      const errEl = document.getElementById('app-submit-error');
      errEl.classList.remove('show');
      const appTitle = document.getElementById('app-title').value.trim();
      if (!appTitle) {
        errEl.textContent = '请输入应用名称';
        errEl.classList.add('show');
        return;
      }
      try {
        await API.post('/api/apps', JSON.stringify({
          app_url: document.getElementById('app-url').value,
          title: appTitle,
          description: document.getElementById('app-desc').value.trim(),
          gameplay: document.getElementById('app-gameplay').value.trim(),
          source_feed_id: feedId || '',
        }));
        closeModal();
        toast('已提交');
        refreshPoints();
        document.getElementById('apps-status').innerHTML = '';
        await loadApps();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.add('show');
      }
    };
  }

  const autoBtn = document.getElementById('auto-scan-btn');
  if (autoBtn) autoBtn.onclick = autoScan;
  const topAutoBtn = document.getElementById('auto-scan-top-btn');
  if (topAutoBtn) topAutoBtn.onclick = autoScan;
  const dsBtn = document.getElementById('display-settings-btn');
  if (dsBtn) dsBtn.onclick = showDisplaySettingsModal;
  if (isQqBound) {
    const manualBtn = document.getElementById('manual-scan-btn');
    if (manualBtn) manualBtn.onclick = manualScan;
  }

  // QQ 会话失效检测：单设备登录被踢后 token 失效，提示重新登录
  async function checkQqStatus() {
    if (!isQqBound) return;
    try {
      const data = await API.get('/api/auth/qq/status');
      if (data.valid === false) {
        const banner = document.getElementById('qq-expired-banner');
        if (banner) {
          banner.innerHTML = `
            <div style="background:#fff7ed;border:1px solid #fdba74;color:#9a3412;border-radius:12px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
              <div style="font-size:14px;">⚠️ QQ 频道登录已失效（可能在其他设备登录了），AI 轻应用识别功能暂不可用。</div>
              <button class="btn btn-sm" id="qq-relogin-btn" style="background:#9a3412;color:#fff;border:none;">重新登录</button>
            </div>`;
          document.getElementById('qq-relogin-btn').onclick = () => { API.clearToken(); location.hash = '#/login'; };
        }
      }
    } catch (_) { /* 静默失败 */ }
  }

  loadFiles();
  loadApps();
  checkQqStatus();
};
