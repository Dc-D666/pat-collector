'use strict';

// 我的项目视图：项目文件（上传/列表/下载/删除/补齐信息）+ AI 轻应用收集（识别/提交）
// 两个功能域以 Tab 分隔，展示设置收进页头按钮；QQ 失效横幅由 app.js 全局处理
window.Views = window.Views || {};
Views.files = () => {
  const { escapeHtml, formatSize, formatTime, getFileIcon, confirm, toast, openModal, closeModal } = Utils;
  const view = document.getElementById('view');
  const isQqBound = !!(API.getUser() && API.getUser().is_qq_bound);

  const appsActionBtns = isQqBound
    ? `<button class="btn btn-primary btn-sm" id="auto-scan-btn">自动识别</button>
       <button class="btn btn-sm" id="manual-scan-btn">手动识别</button>`
    : `<span style="font-size:12px;color:var(--text-dim);">需 QQ 频道登录后可用</span>`;

  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">我的项目</h1>
        <div class="page-sub">${isQqBound ? '上传项目文件，或自动收集你的 AI 轻应用' : '拖拽或点击上传，仅本人可见'}</div>
        <button class="btn btn-sm btn-ghost" id="display-settings-btn" style="margin-top:10px;">${Icons.icon('user', 15)} 展示设置</button>
      </div>

      <div class="tabs" id="files-tabs">
        <button class="tab-btn ${isQqBound ? 'active' : ''}" data-tab="apps">${Icons.icon('robot', 15)} AI 轻应用</button>
        <button class="tab-btn ${isQqBound ? '' : 'active'}" data-tab="files">${Icons.icon('folder', 15)} 项目文件</button>
        <button class="tab-btn" data-tab="links">${Icons.icon('link', 15)} GitHub 项目</button>
      </div>

      <!-- Tab 1：项目文件 -->
      <div id="panel-files" style="display:${isQqBound ? 'none' : ''};">
        <div class="dropzone" id="dropzone">
          <div class="dz-icon">${Icons.icon('upload', 26)}</div>
          <div class="dz-title">点击选择 或 拖拽文件到此处</div>
          <div class="dz-hint">仅支持代码 / 文本文件（.html .py .js .md 等），多文件可一次上传</div>
          <input type="file" id="file-input" multiple style="display:none;" />
        </div>
        <div class="card upload-queue" id="upload-queue"></div>
        <div class="card">
          <div id="file-list"><div class="spinner"></div></div>
        </div>
      </div>

      <!-- Tab 2：AI 轻应用 -->
      <div id="panel-apps" style="display:${isQqBound ? '' : 'none'};">
        <!-- ✨ 一句话生成小程序（2026-08-25，AI 小学堂第2章配套；生成作品与频道轻应用完全等价） -->
        <div class="card" id="gen-app-card" style="margin-bottom:14px;">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px;">
            <h2 style="margin:0;font-size:17px;">✨ 一句话生成小程序</h2>
            <span style="font-size:12px;color:var(--text-dim);">AI 小学堂第 2 章实操 · 每人每天 10 次</span>
          </div>
          <div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;line-height:1.7;">用一句话描述你想做的小游戏/小工具，AI 会生成一个能玩的小程序。生成的作品和频道轻应用一样计入「提交应用」积分。示例：做一个 5 以内加减法答题小游戏，每轮 5 题，答对加 1 分</div>
          <textarea id="gen-idea" rows="3" maxlength="500" placeholder="一句话描述你的想法…" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:10px;font-size:14px;resize:vertical;"></textarea>
          <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap;">
            <label for="gen-model" style="font-size:12px;color:var(--text-dim);">生成模型</label>
            <select id="gen-model" style="padding:6px 8px;border:1px solid var(--border);border-radius:8px;font-size:13px;background:var(--surface);">
              <option value="inkling">Inkling 975B</option>
              <option value="glm52">GLM-5.2 744B</option>
              <option value="nemotronultra">Nemotron 3 Ultra 550B</option>
              <option value="dots3note">Dots3-Note Preview 280B</option>
              <option value="nemotron35">Nemotron 3.5 Lightning 30B</option>
              <option value="glm47">GLM 4.7 Flash 30B（稳定推荐）</option>
            </select>
          </div>
          <textarea id="gen-log" rows="4" readonly placeholder="AI 思考与输出过程（思考结束自动清空，开始展示代码）…" style="display:none;width:100%;margin-top:8px;padding:8px 10px;border:1px solid var(--border);border-radius:10px;font-size:12px;font-family:monospace;color:var(--text-dim);background:var(--bg);resize:vertical;overflow-y:auto;line-height:1.5;"></textarea>
          <div class="form-error" id="gen-error"></div>
          <div style="display:flex;gap:8px;margin-top:10px;align-items:center;flex-wrap:wrap;">
            <button class="btn btn-primary" id="gen-start-btn" type="button">✨ 开始生成</button>
            <span id="gen-hint" style="font-size:12px;color:var(--text-dim);"></span>
          </div>
          <!-- 内嵌预览区（不再用弹窗）：生成成功后展示，含预览/标题/提交/重生成 -->
          <div id="gen-preview-inline" style="display:none;margin-top:12px;">
            <div style="font-size:13px;font-weight:600;margin-bottom:6px;">📺 预览你的小程序</div>
            <iframe id="gen-preview-frame" sandbox="allow-scripts allow-modals" style="width:100%;height:min(60vh,480px);border:1px solid var(--border);border-radius:10px;background:#fff;"></iframe>
            <div class="field" style="margin-top:10px;"><label>作品标题（提交后可参与全校作品展）</label><input id="gen-title" type="text" maxlength="100" placeholder="给作品起个名字" style="width:100%;padding:10px;border:1px solid var(--border);border-radius:10px;font-size:14px;" /></div>
            <div class="form-error" id="gen-commit-error"></div>
            <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
              <button class="btn btn-ghost" id="gen-regen" type="button">🔄 不满意，修改后重新生成</button>
              <button class="btn btn-primary" id="gen-commit" type="button">✅ 满意，提交</button>
            </div>
          </div>
        </div>
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
            <div>
              <h2 style="margin:0;font-size:17px;">识别你的 AI 轻应用</h2>
              <div style="font-size:12px;color:var(--text-dim);">从你在 QQ 频道发布的帖子中提取应用链接，确认后提交</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;">${appsActionBtns}</div>
          </div>
          <div id="apps-status"></div>
          <div id="apps-list"></div>
        </div>
      </div>

      <!-- Tab 3：GitHub 项目外链（2026-08-21：OAuth 授权验证所有权，验证通过 +25⭐） -->
      <div id="panel-links" style="display:none;">
        <div class="card">
          <div style="margin-bottom:12px;">
            <h2 style="margin:0;font-size:17px;">${Icons.icon('link', 18)} GitHub 项目</h2>
            <div style="font-size:12px;color:var(--text-dim);margin-top:4px;line-height:1.7;">从你的 GitHub 仓库选择公开项目提交，验证通过 +25 ${Icons.icon('star-filled', 12)}（作品文件 + GitHub 项目合计最多 5 个）；Fork 无法通过验证。</div>
            <div id="lk-gh-status" style="margin-top:10px;"></div>
          </div>
          <div id="lk-fields" style="opacity:.5;">
            <div class="field">
              <label>选择项目仓库（仅公开可选）</label>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <select id="lk-repo-select" disabled style="flex:1;min-width:220px;padding:10px;border:1px solid var(--border);border-radius:10px;font-size:14px;background:var(--surface);">
                  <option value="">— 选择仓库 —</option>
                </select>
                <button class="btn btn-sm btn-ghost" id="lk-repo-load" type="button" disabled>🔄 刷新</button>
              </div>
              <div id="lk-gh-scope-hint" style="display:none;margin-top:6px;font-size:12px;color:#8A6226;"></div>
            </div>
            <div class="field"><label>项目名称（必填）</label><input id="lk-title" type="text" maxlength="255" placeholder="选择仓库后自动生成，可修改" disabled style="width:100%;padding:10px;border:1px solid var(--border);border-radius:10px;font-size:14px;" /></div>
            <div class="field"><label>简介（选填，自动生成）</label><textarea id="lk-desc" rows="3" maxlength="2000" placeholder="一句话介绍这个项目" disabled style="width:100%;padding:10px;border:1px solid var(--border);border-radius:10px;font-size:14px;"></textarea></div>
            <div class="form-error" id="lk-error"></div>
            <button class="btn btn-primary" id="lk-submit" type="button" disabled>提交链接</button>
          </div>
          <div id="lk-verify-box" style="display:none;margin-top:14px;padding:12px 14px;border:1px solid var(--border);border-radius:12px;background:var(--bg);font-size:13px;line-height:1.9;"></div>
        </div>
        <div class="card">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">
            <h2 style="margin:0;font-size:17px;">我的 GitHub 项目</h2>
            <span style="font-size:12px;color:var(--text-dim);">已验证的作品会展现在全校作品展</span>
          </div>
          <div id="links-list"><div class="spinner"></div></div>
        </div>
      </div>
    </div>`;

  // ---- Tab 切换 ----
  const tabs = document.getElementById('files-tabs');
  if (tabs) {
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      tabs.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      const panelFiles = document.getElementById('panel-files');
      const panelApps = document.getElementById('panel-apps');
      const panelLinks = document.getElementById('panel-links');
      if (panelFiles) panelFiles.style.display = btn.dataset.tab === 'files' ? '' : 'none';
      if (panelApps) panelApps.style.display = btn.dataset.tab === 'apps' ? '' : 'none';
      if (panelLinks) panelLinks.style.display = btn.dataset.tab === 'links' ? '' : 'none';
    });
  }

  // ---- ✨ 一句话生成小程序（2026-08-25，AI 小学堂第2章） ----
  const GEN_EXAMPLES = [
    '做一个 5 以内加减法答题小游戏，每轮 5 题，答对加 1 分',
    '做一个石头剪刀布游戏，和电脑对战，显示比分',
    '做一个单位换算器，支持长度/重量/温度互换',
    '做一个随机点名器，输入名单后随机抽人',
  ];
  function initGenApp() {
    const ideaEl = document.getElementById('gen-idea');
    const btn = document.getElementById('gen-start-btn');
    const errEl = document.getElementById('gen-error');
    const hintEl = document.getElementById('gen-hint');
    if (!btn || !ideaEl) return;
    // 模型选择记忆：localStorage 持久化用户上次的选择
    const modelSel = document.getElementById('gen-model');
    if (modelSel) {
      try {
        const saved = localStorage.getItem('gen_model');
        if (saved && modelSel.querySelector(`option[value="${saved}"]`)) modelSel.value = saved;
        modelSel.addEventListener('change', () => localStorage.setItem('gen_model', modelSel.value));
      } catch (_) { /* 隐私模式等场景忽略 */ }
    }
    // 示例快捷填充：聚焦时随机提示一个示例
    ideaEl.addEventListener('focus', () => {
      if (!ideaEl.value && hintEl) hintEl.textContent = '💡 没灵感？试试：' + GEN_EXAMPLES[Math.floor(Math.random() * GEN_EXAMPLES.length)];
    });
    // 当前草稿令牌 + 上一版代码（供「修改后重新生成」携带上下文）
    let draftToken = '';
    let lastHtml = '';        // 最近一次生成的完整 HTML（done 事件下发）
    let regenContext = null;  // 点「不满意，修改后重新生成」后置为 lastHtml，下一次请求作为上下文
    btn.onclick = async () => {
      errEl.classList.remove('show');
      const idea = ideaEl.value.trim();
      if (!idea) { errEl.textContent = '请先用一句话描述你的想法'; errEl.classList.add('show'); return; }
      const logEl = document.getElementById('gen-log');
      btn.disabled = true;
      btn.textContent = '⏳ AI 正在编写…';
      if (hintEl) hintEl.textContent = '约需 30 秒～ 2 分钟，可实时查看下方输出';
      // 流式输出框：展示模型逐段输出的内容，自动滚动到底部（用户可手动滚动）
      logEl.style.display = '';
      logEl.value = '';
      try {
        // 手动 fetch 消费 SSE（API.request 不支持流式读取）；Bearer 走请求头
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 180000);
        const res = await fetch('/api/gen/app/stream', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + API.getToken(),
          },
          body: JSON.stringify(Object.assign(
            regenContext ? { idea, prev_html: regenContext } : { idea },
            { model: (document.getElementById('gen-model') || {}).value || 'glm47' }
          )),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok || !res.body) {
          let msg = '生成失败，请稍后再试';
          try { msg = (await res.json()).error || msg; } catch (_) { /* ignore */ }
          throw new Error(msg);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let streamErr = null;
        let sawContent = false; // 思考过程结束后，正式代码的第一个片段到达时清空展示框
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (!chunk.startsWith('data:')) continue;
            try {
              const ev = JSON.parse(chunk.slice(5).trim());
              if (ev.type === 'start') {
                // 链路已通的即时反馈（免费档首 token 排队可能 ~20s，避免用户以为卡死）
                logEl.value += ev.context ? '✅ 已连接（改进模式：将基于上一版修改）…\n' : '✅ 已连接生成服务…\n';
              } else if (ev.type === 'delta') {
                if (ev.reasoning) {
                  logEl.value += ev.text;
                } else {
                  if (!sawContent) { logEl.value = ''; sawContent = true; }
                  logEl.value += ev.text;
                }
                logEl.scrollTop = logEl.scrollHeight;
              } else if (ev.type === 'error') {
                streamErr = new Error(ev.message || '生成失败');
                if (ev.code === 'model_unavailable') { streamErr.modelUnavailable = true; streamErr.suppress = true; }
              } else if (ev.type === 'done') {
                draftToken = ev.draft_token;
                lastHtml = ev.html || '';
                regenContext = null;
              }
            } catch (_) { /* 忽略不完整块 */ }
          }
        }
        if (streamErr) {
          if (streamErr.modelUnavailable) {
            // 上游模型限流：卡片内显著红条提醒，引导换模型
            errEl.innerHTML = '⚠️ <strong>该模型暂不可用，请更换模型。</strong>（免费模型高峰期限流，稍后可再试或选其它模型）';
            errEl.classList.add('show');
            toast('⚠️ 该模型暂不可用，请更换其它模型');
          }
          throw streamErr.suppress ? streamErr : streamErr;
        }
        if (!draftToken) throw new Error('生成中断，请重试');
        showGenPreview({ draft_token: draftToken, preview_url: '/api/gen/preview/' + encodeURIComponent(draftToken) });
      } catch (err) {
        if (!(err && err.suppress)) { // model_unavailable 已有显著提醒，不覆盖
          errEl.textContent = (err && err.name === 'AbortError') ? '请求超时，请重试' : (err.message || '生成失败，请稍后再试');
          errEl.classList.add('show');
        }
      } finally {
        btn.disabled = false;
        btn.textContent = '✨ 开始生成';
        if (hintEl) hintEl.textContent = '';
        // 输出框保留内容供回看；下次生成时清空
      }
    };

    // 内嵌预览区：渲染到卡片内的 #gen-preview-inline（不再用弹窗）
    function showGenPreview(genData) {
      const box = document.getElementById('gen-preview-inline');
      if (!box) return;
      box.style.display = '';
      const frame = document.getElementById('gen-preview-frame');
      if (frame) frame.src = genData.preview_url; // iframe 原生导航，无需 Bearer（draft_token 即身份）
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      document.getElementById('gen-regen').onclick = () => {
        // 作废草稿；把上一版代码作为上下文保留——下次生成将基于上一版改进而非从零重写。
        // 输入框保留原描述，可直接改成新的修改意见（如“加上科学计数法”）
        if (draftToken) API.del('/api/gen/draft/' + encodeURIComponent(draftToken)).catch(() => {});
        regenContext = lastHtml || null;
        draftToken = '';
        box.style.display = 'none';
        ideaEl.focus();
        if (hintEl) hintEl.textContent = regenContext ? '🔁 将基于上一版修改：直接在上方输入修改意见' : '✏️ 可修改描述后重新生成；越具体效果越好';
      };
      document.getElementById('gen-commit').onclick = async () => {
        const commitErr = document.getElementById('gen-commit-error');
        const titleEl = document.getElementById('gen-title');
        commitErr.classList.remove('show');
        const title = (titleEl ? titleEl.value : '').trim();
        if (!title) { commitErr.textContent = '请先填写作品标题'; commitErr.classList.add('show'); return; }
        const cbtn = document.getElementById('gen-commit');
        cbtn.disabled = true;
        cbtn.textContent = '提交中…';
        try {
          await API.post('/api/gen/commit', JSON.stringify({ draft_token: draftToken, title }));
          box.style.display = 'none';
          draftToken = '';
          lastHtml = '';
          toast('✅ 作品已提交，可在下方列表查看；去 AI 小学堂第2章打卡吧！');
          loadFiles();
        } catch (err) {
          cbtn.disabled = false;
          cbtn.textContent = '✅ 满意，提交';
          commitErr.textContent = err.message || '提交失败，请重试';
          commitErr.classList.add('show');
        }
      };
    }
  }
  initGenApp();

  // ---- 上传交互 ----
  const dz = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  if (dz) dz.onclick = () => fileInput && fileInput.click();
  if (fileInput) fileInput.onchange = () => { uploadFiles(fileInput.files); fileInput.value = ''; };
  if (dz) {
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('dragover'); }));
    dz.addEventListener('drop', (e) => uploadFiles(e.dataTransfer.files));
  }

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
    // 一次最多 5 个文件，更多请打包压缩包
    if (files.length > 5) {
      toast('最多一次上传 5 个文件；如需提交更多文件，请打包成压缩包后上传');
      return;
    }
    const limitMb = await getMaxUploadMb();
    const queue = document.getElementById('upload-queue');
    if (!queue) return;
    queue.classList.add('show');
    queue.innerHTML = `
      <div class="progress"><div class="progress-bar" id="progress-bar"></div><div class="upload-summary" id="upload-summary" style="font-size:12px;color:var(--text-dim);margin-top:4px;"></div></div>
      <div id="upload-items">${files.map((f, i) => `
        <div class="upload-item" data-idx="${i}">
          <span class="fstatus">⏳</span><span class="fname">${escapeHtml(f.name)}</span><span class="fprog"></span>
        </div>`).join('')}</div>`;
    const bar = document.getElementById('progress-bar');
    const summary = document.getElementById('upload-summary');
    const setStatus = (i, icon) => {
      const el = queue.querySelector(`[data-idx="${i}"] .fstatus`);
      if (el) el.textContent = icon;
    };
    const setProg = (i, text) => {
      const el = queue.querySelector(`[data-idx="${i}"] .fprog`);
      if (el) { el.textContent = text; el.style.color = 'var(--text-dim)'; el.style.fontSize = '12px'; el.style.flexShrink = '0'; }
    };
    // 真实字节进度：顶部进度条 = 全部文件已传字节 / 总字节；每行显示 已传/总 + 实时速度
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    let doneBytes = 0;
    const updateBar = () => {
      if (bar) bar.style.width = (totalBytes ? Math.min(100, (doneBytes / totalBytes) * 100) : 100) + '%';
      if (summary) summary.textContent = `${Utils.formatSize(doneBytes)} / ${Utils.formatSize(totalBytes)}`;
    };
    let failedCount = 0; // 失败文件数：有失败时保留上传队列，避免错误提示一闪而过
    const newFiles = []; // 本次上传成功的文件，列表中以「待完善」标记，可随时补齐作品信息
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      // 前端预检大小：超过上限直接拦截，避免 nginx 返回 HTML 413
      if (f.size > limitMb * 1024 * 1024) {
        setStatus(i, '❌');
        setProg(i, `超过 ${limitMb}MB 上限`);
        const row = queue.querySelector(`[data-idx="${i}"]`);
        if (row) {
          const msg = `文件过大（超过 ${limitMb}MB 上限），无法上传；如确需上传大文件/文件夹，请联系频道主或 QQ：3303188265`;
          row.title = msg; row.querySelector('.fname').textContent += ' — ' + msg;
        }
        failedCount++;
        continue;
      }
      const fd = new FormData();
      fd.append('file', f);
      // HTML 文件：上传后需 AI 安全审查（数秒），显示「安全审查中」动画提示
      const isHtml = /\.(html?|htm)$/i.test(f.name || '');
      let auditRow = null;
      if (isHtml) {
        const rowEl = queue.querySelector(`[data-idx="${i}"]`);
        if (rowEl) {
          const st = rowEl.querySelector('.fstatus');
          if (st) st.innerHTML = '<span class="audit-loader"></span>';
          const tag = document.createElement('span');
          tag.className = 'audit-tag';
          tag.textContent = '安全审查中…';
          const nameEl = rowEl.querySelector('.fname');
          if (nameEl) nameEl.appendChild(tag);
          auditRow = rowEl;
        }
      }
      const tracker = Utils.createSpeedTracker();
      try {
        const data = await API.uploadWithProgress('/api/files/upload', fd, (loaded, total) => {
          // 顶部进度 = 已完成文件字节 + 当前文件已传字节
          setProg(i, Utils.formatProgress(loaded, total, tracker(loaded)));
          if (bar) bar.style.width = (totalBytes ? Math.min(100, ((doneBytes + loaded) / totalBytes) * 100) : 100) + '%';
          if (summary) summary.textContent = `${Utils.formatSize(doneBytes + loaded)} / ${Utils.formatSize(totalBytes)}`;
        });
        doneBytes += f.size;
        updateBar();
        setStatus(i, '✅');
        setProg(i, '已完成');
        if (data && data.file) {
          newFiles.push({ id: data.file.id, original_name: data.file.original_name });
          refreshPoints();
        }
      } catch (err) {
        setStatus(i, '❌');
        setProg(i, err.message);
        const row = queue.querySelector(`[data-idx="${i}"]`);
        if (row) { row.title = err.message; row.querySelector('.fname').textContent += ' — ' + err.message; }
        failedCount++;
      } finally {
        // 审查结束：移除「安全审查中」标记
        if (auditRow) {
          const tag = auditRow.querySelector('.audit-tag');
          if (tag) tag.remove();
        }
      }
    }
    // 全部完成：进度条 100%
    bar.style.width = '100%';
    if (summary) summary.textContent = `${Utils.formatSize(totalBytes)} / ${Utils.formatSize(totalBytes)}`;
    if (failedCount > 0) {
      // 有失败：保留队列显示错误原因，不自动关闭
      toast(`上传完成：成功 ${newFiles.length} 个，失败 ${failedCount} 个，原因见上方列表`);
    } else {
      setTimeout(() => { queue.classList.remove('show'); queue.innerHTML = ''; }, 900);
    }
    await loadFiles();
    // 上传成功不强制弹表单：toast 提示，列表项带「待完善」标记，可随时编辑或一键补齐
    if (newFiles.length && failedCount === 0) toast(`✅ 上传成功 ${newFiles.length} 个，可补充作品信息`);
  }

  // 逐个为文件填写作品信息（「补齐作品信息」批量入口 / 编辑入口共用）
  async function promptFileInfos(files) {
    for (const f of files) {
      await new Promise((resolve) => {
        showFileInfoModal(f, { onDone: resolve });
      });
    }
    await loadFiles();
  }

  // ---- 文件列表 ----
  async function loadFiles() {
    const list = document.getElementById('file-list');
    if (!list) return;
    let files;
    try {
      const data = await API.get('/api/files');
      files = data.files;
    } catch (err) {
      list.innerHTML = `<div class="empty"><div class="empty-icon">${Icons.icon('error-circle', 26)}</div>${escapeHtml(err.message)}</div>`;
      return;
    }
    if (!files.length) {
      list.innerHTML = `<div class="empty"><div class="empty-icon">🗂️</div>暂无项目，快来上传第一份作品吧</div>`;
      return;
    }
    const pendingCount = files.filter((f) => !(f.title && f.title.trim())).length;
    list.innerHTML = `
      <div class="file-list-head">
        <span>共 ${files.length} 个项目${pendingCount ? `，${pendingCount} 个待完善` : ''}</span>
        ${pendingCount ? `<button class="btn btn-sm btn-ghost" id="batch-fill-btn">${Icons.icon('edit', 14)} 补齐作品信息（${pendingCount}）</button>` : ''}
      </div>
      <div class="file-list">${files.map((f) => {
      const icon = getFileIcon(f.original_name);
      const hasTitle = !!(f.title && f.title.trim());
      return `
        <div class="file-row">
          <div class="file-icon" style="background:${icon.color};">${Icons.icon(icon.icon, 20)}</div>
          <div class="file-info">
            <div class="file-name">${escapeHtml(hasTitle ? f.title : f.original_name)}${hasTitle ? '' : `<span class="badge-pending">待完善</span>`}</div>
            <div class="file-meta">${hasTitle ? escapeHtml(f.original_name) + ' · ' : ''}${formatSize(f.size)} · ${formatTime(f.uploaded_at)}</div>
            ${f.description ? `<div class="file-meta">${escapeHtml(f.description)}</div>` : ''}
          </div>
          <div class="file-actions">
            <button class="btn btn-sm btn-ghost" data-edit="${f.id}">${hasTitle ? '编辑' : '完善'}</button>
            <button class="btn btn-sm btn-ghost" data-dl="${f.id}" data-name="${escapeHtml(f.original_name)}">下载</button>
            <button class="btn btn-sm btn-ghost" data-del="${f.id}" style="color:var(--danger);">删除</button>
          </div>
        </div>`;
    }).join('')}</div>`;

    const batchBtn = document.getElementById('batch-fill-btn');
    if (batchBtn) batchBtn.onclick = () => promptFileInfos(files.filter((f) => !(f.title && f.title.trim())));

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
      <div class="field"><label>应用简介（选填）</label><textarea id="file-info-desc" rows="3" maxlength="2000" placeholder="一句话介绍这个作品">${escapeHtml(file.description || '')}</textarea></div>
      <div class="field"><label>玩法（选填）</label><textarea id="file-info-gameplay" rows="3" maxlength="2000" placeholder="怎么玩">${escapeHtml(file.gameplay || '')}</textarea></div>
      <div class="modal-actions">
        <button class="btn" id="file-info-skip">取消</button>
        <button class="btn btn-primary" id="file-info-save">保存</button>
      </div>`);
    document.getElementById('file-info-skip').onclick = () => { closeModal(); if (onDone) onDone(); };
    const saveBtn = document.getElementById('file-info-save');
    const skipBtn = document.getElementById('file-info-skip');
    saveBtn.onclick = async () => {
      const errEl = document.getElementById('file-info-error');
      errEl.classList.remove('show');
      const title = document.getElementById('file-info-title').value.trim();
      if (!title) { errEl.textContent = '请输入项目标题'; errEl.classList.add('show'); return; }
      // 保存会触发服务端 AI 内容审核（1-3 秒）：按钮变浅禁用 + 「审核中.」点点滚动，避免看起来像卡死
      const dots = ['审核中', '审核中.', '审核中..', '审核中...'];
      let tick = 0;
      saveBtn.disabled = true; // :disabled 自带 opacity .55 变浅 + not-allowed
      saveBtn.textContent = dots[0];
      skipBtn.disabled = true;
      const dotTimer = setInterval(() => {
        tick = (tick + 1) % dots.length;
        saveBtn.textContent = dots[tick];
      }, 400);
      try {
        await API.patch('/api/files/' + file.id, JSON.stringify({
          title,
          description: document.getElementById('file-info-desc').value.trim(),
          gameplay: document.getElementById('file-info-gameplay').value.trim(),
        }));
        clearInterval(dotTimer);
        closeModal();
        toast('已保存');
        await loadFiles();
        if (onDone) onDone();
      } catch (err) {
        clearInterval(dotTimer);
        errEl.textContent = err.message;
        errEl.classList.add('show');
        saveBtn.disabled = false;
        saveBtn.textContent = '保存';
        skipBtn.disabled = false;
      }
    };
  }

  // ---- 展示设置：是否授权展示真实姓名 / 昵称（昵称=姓名拼音首字母，选定后不可更改）----
  function showDisplaySettingsModal() {
    const u = API.getUser() || {};
    const notShowReal = u.show_real_name === false || u.show_real_name === 0;
    openModal(`
      <h3 class="modal-title">展示设置</h3>
      <p style="font-size:13px;color:var(--text-dim);margin:0 0 12px;text-align:center;">控制你的姓名是否在作品墙 / 提交总览中展示</p>
      <div class="form-error" id="display-settings-error"></div>
      <div class="field">
        <label>是否授权展示真实姓名</label>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:6px;align-items:center;">
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;white-space:nowrap;"><input type="radio" name="ds-show-real" value="1" ${notShowReal ? '' : 'checked'} /> 是，展示真实姓名</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;white-space:nowrap;"><input type="radio" name="ds-show-real" value="0" ${notShowReal ? 'checked' : ''} /> 否，只展示昵称</label>
        </div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:6px;text-align:center;line-height:1.6;">${Icons.icon('info-circle', 14)} 真实姓名<strong>只对同班同学</strong>展示；其他班级/访客看到的是你的昵称（姓名拼音首字母）</div>
      </div>
      <div class="field" id="ds-nickname-field" style="display:${notShowReal ? '' : 'none'};">
        <label>展示昵称（姓名拼音首字母）</label>
        <div style="font-size:12px;color:var(--text-dim);margin-bottom:6px;">由真实姓名自动生成；多音字可多选，<strong>选定后不可更改</strong></div>
        <div id="ds-initials-options" style="display:flex;flex-wrap:wrap;gap:8px;"></div>
        <input id="ds-nickname" type="hidden" value="${escapeHtml(u.nickname || '')}" />
      </div>
      <div class="modal-actions" style="justify-content:center;">
        <button class="btn" id="ds-cancel">取消</button>
        <button class="btn btn-primary" id="ds-save">保存</button>
      </div>`);
    const nicknameField = document.getElementById('ds-nickname-field');
    const initialsOptions = document.getElementById('ds-initials-options');
    const initialsInput = document.getElementById('ds-nickname');
    // 初始渲染候选（含已有昵称高亮锁定）
    Utils.initialsPicker(initialsOptions, initialsInput, (u.real_name || '').trim(), (u.nickname || '').trim());
    document.querySelectorAll('input[name="ds-show-real"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        nicknameField.style.display = radio.value === '0' ? '' : 'none';
        if (radio.value === '0') Utils.initialsPicker(initialsOptions, initialsInput, (u.real_name || '').trim(), (u.nickname || '').trim());
      });
    });
    document.getElementById('ds-cancel').onclick = closeModal;
    document.getElementById('ds-save').onclick = async () => {
      const errEl = document.getElementById('display-settings-error');
      errEl.classList.remove('show');
      const showReal = (document.querySelector('input[name="ds-show-real"]:checked') || {}).value !== '0';
      const nickname = initialsInput.value.trim();
      if (!showReal && !nickname) {
        errEl.textContent = '请选择姓名拼音首字母作为昵称';
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
    if (!list) return;
    try {
      const data = await API.get('/api/apps');
      const apps = data.apps;
      submittedAppUrls = new Set(apps.map((a) => a.app_url));
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

  // 已识别但未提交的轻应用（累积，按 url 去重；localStorage 持久化，刷新不丢）
  let scanItems = [];
  // 已提交过的轻应用 url（loadApps 时刷新）：识别结果不再提示重复提交（2026-08-20 去重修复）
  let submittedAppUrls = new Set();
  const scanStorageKey = 'pat-scanitems-' + ((API.getUser() || {}).id || 'anon');
  function saveScanItems() {
    try { localStorage.setItem(scanStorageKey, JSON.stringify(scanItems)); } catch (_) { /* 静默 */ }
  }
  function restoreScanItems() {
    try {
      const s = localStorage.getItem(scanStorageKey);
      if (s) {
        const arr = JSON.parse(s);
        if (Array.isArray(arr)) scanItems = arr;
      }
    } catch (_) { scanItems = []; }
  }

  function renderScanResults() {
    const status = document.getElementById('apps-status');
    if (!status) return;
    if (!scanItems.length) {
      status.innerHTML = `<div class="empty" style="padding:16px;">还没有识别结果，点「自动识别」从你的频道帖子中提取</div>`;
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
        if (submittedAppUrls.has(item.url)) continue; // 已提交过该作品，不再提示（服务端亦有去重兜底）
        scanItems.push(item);
        added++;
      }
    }
    saveScanItems();
    renderScanResults();
    return added;
  }

  function showScanning(msg) {
    const status = document.getElementById('apps-status');
    if (!status) return;
    status.innerHTML = `<div class="scan-loading"><div class="spinner"></div><p>${escapeHtml(msg)}</p></div>`;
  }

  async function autoScan() {
    showScanning('正在识别你的近期帖子，可能需要一点时间…');
    try {
      const data = await API.post('/api/apps/auto-scan', JSON.stringify({}));
      scanItems = []; // 自动识别重置结果（已提交的不受影响）
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
    const appSaveBtn = document.getElementById('app-save');
    const appCancelBtn = document.getElementById('app-cancel');
    appSaveBtn.onclick = async () => {
      const errEl = document.getElementById('app-submit-error');
      errEl.classList.remove('show');
      const appTitle = document.getElementById('app-title').value.trim();
      if (!appTitle) {
        errEl.textContent = '请输入应用名称';
        errEl.classList.add('show');
        return;
      }
      // 提交会触发服务端 AI 内容审核（1-3 秒）：按钮变浅禁用 + 「审核中.」点点滚动，避免看起来像卡死
      const dots = ['审核中', '审核中.', '审核中..', '审核中...'];
      let tick = 0;
      appSaveBtn.disabled = true; // :disabled 自带 opacity .55 变浅 + not-allowed
      appSaveBtn.textContent = dots[0];
      appCancelBtn.disabled = true;
      const dotTimer = setInterval(() => {
        tick = (tick + 1) % dots.length;
        appSaveBtn.textContent = dots[tick];
      }, 400);
      try {
        await API.post('/api/apps', JSON.stringify({
          app_url: document.getElementById('app-url').value,
          title: appTitle,
          description: document.getElementById('app-desc').value.trim(),
          gameplay: document.getElementById('app-gameplay').value.trim(),
          source_feed_id: feedId || '',
        }));
        clearInterval(dotTimer);
        closeModal();
        toast('已提交');
        refreshPoints();
        // 提交成功 → 从识别结果移除（其余保留），持久化
        scanItems = scanItems.filter((it) => it.url !== appUrl);
        saveScanItems();
        renderScanResults();
        await loadApps();
      } catch (err) {
        clearInterval(dotTimer);
        errEl.textContent = err.message;
        errEl.classList.add('show');
        appSaveBtn.disabled = false;
        appSaveBtn.textContent = '提交';
        appCancelBtn.disabled = false;
      }
    };
  }

  const autoBtn = document.getElementById('auto-scan-btn');
  if (autoBtn) autoBtn.onclick = autoScan;
  const dsBtn = document.getElementById('display-settings-btn');
  if (dsBtn) dsBtn.onclick = showDisplaySettingsModal;
  if (isQqBound) {
    const manualBtn = document.getElementById('manual-scan-btn');
    if (manualBtn) manualBtn.onclick = manualScan;
  }

  // ---- GitHub 项目外链（2026-08-20 起；2026-08-21 改为 OAuth 授权验证）----
  // GitHub OAuth 连接状态：一键授权后验证仓库归属，取代"仓库放 nanfang-pat.txt 文件"流程
  let ghConnected = false;
  let selectedRepoUrl = ''; // 下拉选中的仓库链接（唯一提交来源；2026-08-21 起不再允许手填）
  // 整个 GitHub 提交表单启用/禁用（未连接 GitHub 时置灰不可点，2026-08-21）
  function setFormDisabled(disabled) {
    const wrap = document.getElementById('lk-fields');
    if (wrap) wrap.style.opacity = disabled ? '0.5' : '';
    ['lk-repo-select', 'lk-repo-load', 'lk-title', 'lk-desc', 'lk-submit'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.disabled = disabled;
    });
  }

  async function loadGithubStatus() {
    const el = document.getElementById('lk-gh-status');
    if (!el) return;
    try {
      const data = await API.get('/api/github/status');
      ghConnected = !!data.connected;
      if (ghConnected) {
        setFormDisabled(false); // 已连接：解锁表单并拉取仓库下拉列表
        loadMyRepos();
      } else {
        setFormDisabled(true);
        resetRepoSelect();
      }
      el.innerHTML = ghConnected
        ? `<span style="font-size:12.5px;color:var(--success);">✅ 已连接 GitHub：<strong>${escapeHtml(data.login || '')}</strong>
             <button class="btn btn-sm btn-ghost" id="lk-gh-disconnect" style="margin-left:8px;">断开</button></span>`
        : `<span style="font-size:12.5px;color:var(--text-dim);">未连接 GitHub
             <button class="btn btn-sm btn-primary" id="lk-gh-connect" style="margin-left:8px;">🔑 用 GitHub 授权</button></span>`;
      const cb = document.getElementById('lk-gh-connect');
      if (cb) cb.onclick = connectGithub;
      const db = document.getElementById('lk-gh-disconnect');
      if (db) db.onclick = async () => {
        const yes = await confirm('断开 GitHub 连接？已认证的项目不受影响，新项目需重新授权验证', { danger: true });
        if (!yes) return;
        try {
          await API.post('/api/github/disconnect', '{}');
          toast('已断开 GitHub');
          ghConnected = false;
          await loadGithubStatus();
          await loadLinks();
        } catch (err) { toast(err.message); }
      };
    } catch (_) { /* 静默 */ }
  }

  async function connectGithub() {
    // 移动端（QQ/微信内置浏览器等无可靠弹窗模型，window.open 常返回 null 或行为异常）：
    // 直接整页跳转 GitHub 授权，授权后回调结果页自动跳回 /#/files，本页加载时自动刷新连接状态。
    // （2026-08-22 修复：此前依赖弹窗 + postMessage，手机端 opener 缺失导致「完不成」）
    const isMobile = /Android|iPhone|iPad|iPod|MQQBrowser|MicroMessenger|Mobile/i.test(navigator.userAgent);
    if (isMobile) {
      let data;
      try { data = await API.get('/api/github/oauth/start'); }
      catch (err) { toast(err.message); return; }
      location.href = data.url;
      return;
    }
    // 桌面：先开空窗口（保持用户手势，防弹窗拦截），再请求授权链接并跳转
    const win = window.open('', '_blank', 'width=640,height=760');
    let data;
    try { data = await API.get('/api/github/oauth/start'); }
    catch (err) {
      try { if (win) win.close(); } catch (_) { /* ignore */ }
      toast(err.message);
      return;
    }
    if (win) { win.location.href = data.url; }
    else { location.href = data.url; }
  }

  // 拉取已连接用户的全部仓库（本人创建、非 Fork）填入下拉选择器：
  // 公开项目可选；私有项目置灰带 🔒、不可选择（需设为公开后才能提交）。
  // 选中后自动填名称，并调用 README → GLM 生成名称/简介
  async function loadMyRepos() {
    const sel = document.getElementById('lk-repo-select');
    const btn = document.getElementById('lk-repo-load');
    if (!sel) return;
    if (btn) btn.disabled = true;
    sel.disabled = true;
    sel.innerHTML = '<option value="">正在加载仓库…</option>';
    try {
      const data = await API.get('/api/github/repos');
      const repos = data.repos || [];
      const publicCount = repos.filter((r) => !r.private).length;
      sel.innerHTML = '<option value="">— 选择仓库 —</option>'
        + repos.map((r) => {
          const label = r.private
            ? `${Icons.icon('lock-on', 14)} ${escapeHtml(r.full_name)}（私密，不可选）`
            : `${escapeHtml(r.full_name)}${r.description ? ' — ' + escapeHtml(r.description.slice(0, 40)) : ''}`;
          return `<option value="${escapeHtml(r.html_url)}" data-owner="${escapeHtml(r.owner)}" data-repo="${escapeHtml(r.name)}" data-name="${escapeHtml(r.name)}"${r.private ? ' disabled' : ''}>${label}</option>`;
        }).join('')
        + (repos.length === 0 ? '<option value="">没有可选的仓库（需自己创建、非 Fork）</option>'
          : publicCount === 0 ? '<option value="" disabled>没有公开项目，设为公开后刷新即可提交</option>' : '');
      // 授权范围不足时提示重新授权（看不到私有项目列表）
      const hintEl = document.getElementById('lk-gh-scope-hint');
      if (hintEl) {
        if (data.scope_limited) {
          hintEl.style.display = '';
          hintEl.innerHTML = '当前授权看不到私有项目，断开后重新授权即可展示';
        } else {
          hintEl.style.display = 'none';
          hintEl.innerHTML = '';
        }
      }
      sel.onchange = () => {
        if (!sel.value) return;
        const opt = sel.options[sel.selectedIndex];
        selectedRepoUrl = sel.value;
        // 立即用仓库名占位，随后由自动生成覆盖
        const titleInput = document.getElementById('lk-title');
        if (titleInput) titleInput.value = (opt.dataset.name || '').trim();
        const descInput = document.getElementById('lk-desc');
        if (descInput) descInput.value = '⏳ 正在读 README 生成简介…';
        autoDescribe((opt.dataset.owner || '').trim(), (opt.dataset.repo || '').trim(), opt);
      };
    } catch (err) {
      sel.innerHTML = '<option value="">加载仓库失败，请稍后重试（' + escapeHtml(err.message) + '）</option>';
    } finally {
      sel.disabled = false;
      if (btn) btn.disabled = false;
    }
  }

  // 选仓库后自动生成名称与简介（README → GLM）；未配置 GLM / 无 README 时服务端降级返回仓库信息
  let describeSeq = 0;
  async function autoDescribe(owner, repoName, opt) {
    if (!owner || !repoName) return;
    const seq = ++describeSeq; // 防竞态：快速切换仓库时丢弃过期结果
    try {
      const r = await API.post('/api/github/describe', JSON.stringify({ owner, repo: repoName }), 45000);
      if (seq !== describeSeq) return;
      const titleInput = document.getElementById('lk-title');
      const descInput = document.getElementById('lk-desc');
      if (r.title && titleInput) titleInput.value = r.title;
      if (descInput) descInput.value = r.description || '';
      if (r.note) toast(r.note);
    } catch (err) {
      if (seq !== describeSeq) return;
      const titleInput = document.getElementById('lk-title');
      const descInput = document.getElementById('lk-desc');
      if (opt && titleInput && !titleInput.value.trim()) titleInput.value = (opt.dataset.name || repoName || '').trim();
      if (descInput) descInput.value = '';
      toast('自动生成简介失败：' + (err.message || '请重试'));
    }
  }

  // 未连接时把选择器复位为占位
  function resetRepoSelect() {
    const sel = document.getElementById('lk-repo-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">— 选择仓库 —</option>';
    selectedRepoUrl = '';
  }

  // OAuth 弹窗结果（postMessage）→ 刷新连接状态（监听只装一次，指向当前渲染的处理函数）
  if (!window.__ghOauthListenerInstalled) {
    window.__ghOauthListenerInstalled = true;
    window.addEventListener('message', (e) => {
      if (!e.data || e.data.type !== 'github-oauth') return;
      toast(e.data.message || (e.data.ok ? 'GitHub 连接成功' : 'GitHub 连接失败'));
      if (typeof window.__refreshGhStatus === 'function') window.__refreshGhStatus();
    });
  }
  window.__refreshGhStatus = loadGithubStatus;

  // 验证指引框（OAuth 版）：连接 GitHub 后一键验证，无需放文件
  function showVerifyBox(l) {
    const box = document.getElementById('lk-verify-box');
    if (!box || !l) return;
    box.style.display = '';
    if (!ghConnected) {
      box.innerHTML = `🔑 连接 GitHub 后，从下拉选择你的公开项目点「验证」即可（需为自己创建、非 Fork 的项目）。<br>
        <button class="btn btn-sm btn-primary" id="lk-gh-connect2" style="margin-top:8px;">🔑 用 GitHub 授权</button>`;
      const cb = document.getElementById('lk-gh-connect2');
      if (cb) cb.onclick = connectGithub;
      return;
    }
    box.innerHTML = `✅ 已连接 GitHub。确认是你自己创建的公开项目（Fork 无法通过验证）后点「验证」，+25 ${Icons.icon('star-filled', 12)} 自动发放。<br>
      <button class="btn btn-sm btn-primary" id="lk-verify-new" style="margin-top:8px;" data-id="${l.id}">立即验证</button>`;
    const vb = document.getElementById('lk-verify-new');
    vb.onclick = async () => {
      vb.disabled = true;
      try {
        const r2 = await API.post('/api/links/' + vb.dataset.id + '/verify', JSON.stringify({}));
        toast(r2.message || '验证完成');
        box.innerHTML = `<span style="color:var(--success);">${escapeHtml(r2.message || '验证完成')}</span>`;
        await loadLinks();
      } catch (err2) {
        toast(err2.message);
        vb.disabled = false;
      }
    };
  }

  async function loadLinks() {
    const list = document.getElementById('links-list');
    if (!list) return;
    let data;
    try { data = await API.get('/api/links'); }
    catch (err) { list.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; return; }
    const links = data.links || [];
    if (!links.length) { list.innerHTML = `<div class="empty">还没有提交 GitHub 项目</div>`; return; }
    list.innerHTML = links.map((l) => `
      <div class="app-row">
        <div class="app-info">
          <div class="app-title">
            <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.title || l.url)}</a>
            ${l.verified
              ? '<span class="title-tag" style="color:var(--success);" title="已通过仓库所有权验证">✓ 已认证</span>'
              : '<span class="title-tag" style="color:var(--danger);">待验证</span>'}
          </div>
          <div class="app-desc">${escapeHtml(l.owner + '/' + l.repo)} · ${formatTime(l.created_at)}${l.description ? ' · ' + escapeHtml(l.description) : ''}</div>
        </div>
        <div class="file-actions">
          ${l.verified ? '' : `<button class="btn btn-sm btn-ghost lk-steps" data-id="${l.id}">验证指引</button><button class="btn btn-sm btn-primary lk-verify-btn" data-id="${l.id}">验证</button>`}
          <button class="btn btn-sm btn-ghost lk-del" data-id="${l.id}" style="color:var(--danger);">删除</button>
        </div>
      </div>`).join('');
    list.querySelectorAll('.lk-del').forEach((b) => {
      b.onclick = async () => {
        const ok = await confirm('删除该 GitHub 项目？（回扣已发提交积分）', { danger: true });
        if (!ok) return;
        try { await API.del('/api/links/' + b.dataset.id); toast('已删除'); await loadLinks(); }
        catch (err) { toast(err.message); }
      };
    });
    list.querySelectorAll('.lk-verify-btn').forEach((b) => {
      b.onclick = async () => {
        b.disabled = true;
        try {
          const r = await API.post('/api/links/' + b.dataset.id + '/verify', JSON.stringify({}));
          toast(r.message || '验证完成');
          await loadLinks();
        } catch (err) {
          toast(err.message);
          b.disabled = false;
        }
      };
    });
    list.querySelectorAll('.lk-steps').forEach((b) => {
      b.onclick = () => {
        const l = links.find((x) => String(x.id) === String(b.dataset.id));
        if (l) showVerifyBox(l);
      };
    });
  }

  const lkSubmitBtn = document.getElementById('lk-submit');
  if (lkSubmitBtn) {
    lkSubmitBtn.onclick = async () => {
      const errEl = document.getElementById('lk-error');
      errEl.classList.remove('show');
      const url = selectedRepoUrl; // 只能来自下拉选择（2026-08-21：不允许手填链接）
      const title = document.getElementById('lk-title').value.trim();
      const description = document.getElementById('lk-desc').value.trim();
      if (!url || !title) {
        errEl.textContent = '请选择项目仓库并填写名称';
        errEl.classList.add('show');
        return;
      }
      lkSubmitBtn.disabled = true;
      try {
        const r = await API.post('/api/links', JSON.stringify({ url, title, description }));
        const l = r.link;
        // 清空表单：选择器复位 + 清名称/简介
        const sel = document.getElementById('lk-repo-select');
        if (sel) sel.value = '';
        selectedRepoUrl = '';
        document.getElementById('lk-title').value = '';
        document.getElementById('lk-desc').value = '';
        showVerifyBox(l);
        await loadLinks();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.add('show');
      } finally {
        lkSubmitBtn.disabled = false;
      }
    };
  }

  restoreScanItems();
  loadFiles();
  loadApps();
  loadLinks();
  loadGithubStatus();
  const repoLoadBtn = document.getElementById('lk-repo-load');
  if (repoLoadBtn) repoLoadBtn.onclick = loadMyRepos;
};
