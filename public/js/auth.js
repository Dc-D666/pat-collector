'use strict';

// 登录视图：QQ 频道扫码登录（主）+ 无 QQ 直通（兜底）
// 班级采用「年级 → 班级」二级菜单：高一 2601–2624、高二 2501–2524、高三 2401–2425、其他（自由填写）
window.Views = window.Views || {};
Views.login = () => {
  const { escapeHtml } = Utils;
  const view = document.getElementById('view');
  let pollTimer = null;
  let gradesCache = null;

  // 兜底结构（与 server/config.js 保持一致，仅当后端接口不可用时使用）
  function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(String(i)); return r; }
  const FALLBACK_GRADES = [
    { name: '高一', classes: range(2601, 2624) },
    { name: '高二', classes: range(2501, 2524) },
    { name: '高三', classes: range(2401, 2425) },
  ];

  async function loadGrades() {
    if (gradesCache) return gradesCache;
    try {
      const data = await API.get('/api/auth/classes');
      if (data && data.grades && data.grades.length) gradesCache = data.grades;
    } catch (_) { /* 用兜底 */ }
    if (!gradesCache) gradesCache = FALLBACK_GRADES;
    return gradesCache;
  }

  // ---- 上传规则：允许的扩展名 + 单文件大小上限（提交前校验用，与 server/config.js 保持一致）----
  const FALLBACK_UPLOAD_RULES = {
    allowed_extensions: ['html','htm','py','js','ts','c','cpp','java','css','json','ipynb','md','txt','csv','svg','zip','rar','7z','tar','gz'],
    max_upload_mb: 200,
  };
  let uploadRules = null;
  async function loadUploadRules() {
    if (uploadRules) return uploadRules;
    try {
      const data = await API.get('/api/auth/upload-rules');
      if (data && Array.isArray(data.allowed_extensions) && data.allowed_extensions.length) {
        uploadRules = data;
      }
    } catch (_) { /* 用兜底 */ }
    if (!uploadRules) uploadRules = FALLBACK_UPLOAD_RULES;
    return uploadRules;
  }
  function extOf(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
    return m ? m[1].toLowerCase() : '';
  }
  // 校验单个文件；返回错误文案（null = 通过）
  function validateGuestFile(f, rules) {
    const ext = extOf(f.name);
    if (!ext || !rules.allowed_extensions.includes(ext)) {
      return ext ? `不支持 .${ext} 类型` : '缺少文件扩展名';
    }
    if (f.size > rules.max_upload_mb * 1024 * 1024) {
      return `超过 ${rules.max_upload_mb}MB 上限`;
    }
    return null;
  }
  // 「其他」年级的班级校验：毕业生填 4 位班级号（如 2601），外校填 0
  function isValidOtherClass(c) {
    return c === '0' || /^\d{4}$/.test(c);
  }
  function checkOtherClass(v) {
    if (v.grade !== '其他') return '';
    if (!v.class_name) return '毕业生请填自己班级（4 位数字），外校请填 0';
    if (!isValidOtherClass(v.class_name)) return '班级格式不正确：毕业生填 4 位班级号（如 2601），外校填 0';
    return '';
  }

  function clearPoll() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }

  // ---- 移动端 OAuth 回调恢复：跳 connect.qq.com 授权再跳回时页面刷新会丢 session，用 localStorage 恢复 ----
  const PENDING_OAUTH_KEY = 'patplayer_pending_oauth';
  function savePendingOAuth(sessionId) {
    localStorage.setItem(PENDING_OAUTH_KEY, JSON.stringify({ sessionId, timestamp: Date.now() }));
  }
  function getPendingOAuth() {
    try {
      const raw = localStorage.getItem(PENDING_OAUTH_KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d.sessionId) return null;
      if (Date.now() - d.timestamp > 300000) { // 300s 覆盖授权耗时
        localStorage.removeItem(PENDING_OAUTH_KEY);
        return null;
      }
      return d.sessionId;
    } catch (_) { return null; }
  }
  function clearPendingOAuth() {
    localStorage.removeItem(PENDING_OAUTH_KEY);
  }

  function showError(msg) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = msg;
    // 有文字才显示，空消息（清除错误）隐藏——避免正常提交时露出空红框
    el.classList.toggle('show', !!msg);
  }

  function enterSystem(data) {
    clearPendingOAuth();
    API.setToken(data.token);
    API.setUser(data.user);
    location.hash = '#/files';
  }

  // 渲染「年级 → 班级」二级菜单 + 姓名字段 + 展示名授权；返回取值函数
  // nickname：QQ 场景传入频道昵称，作为「只展示昵称」的默认值
  function renderIdentity(container, nickname) {
    container.innerHTML = `
      <div class="field">
        <label>年级</label>
        <select id="id-grade">
          <option value="" disabled selected>请选择年级</option>
          <option value="高一">高一</option>
          <option value="高二">高二</option>
          <option value="高三">高三</option>
          <option value="其他">其他</option>
        </select>
      </div>
      <div class="field" id="id-class-field"></div>
      <div class="field" id="id-name-field"></div>
      <div class="field" style="margin-top:10px;">
        <label>是否授权展示真实姓名</label>
        <div style="display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:6px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;white-space:nowrap;"><input type="radio" name="id-show-real" value="1" checked /> 是</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;white-space:nowrap;"><input type="radio" name="id-show-real" value="0" /> 否，只展示昵称</label>
        </div>
      </div>
      <div class="field" id="id-nickname-field" style="display:none;">
        <label>展示昵称</label>
        <input id="id-nickname" type="text" maxlength="32" value="${escapeHtml(nickname || '')}" placeholder="作品墙上展示的昵称" />
      </div>`;

    const gradeSel = container.querySelector('#id-grade');
    const classField = container.querySelector('#id-class-field');
    const nameField = container.querySelector('#id-name-field');
    const nicknameField = container.querySelector('#id-nickname-field');

    // 选「否，只展示昵称」→ 显示昵称输入框
    container.querySelectorAll('input[name="id-show-real"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        nicknameField.style.display = radio.value === '0' ? '' : 'none';
      });
    });

    function update() {
      const g = gradeSel.value;
      if (g === '其他') {
        classField.innerHTML = `<label>班级（必填）</label><input id="id-class" type="text" inputmode="numeric" maxlength="4" placeholder="毕业生填自己班级，外校填0" />`;
        nameField.innerHTML = `<label>姓名(或昵称)</label><input id="id-name" type="text" maxlength="32" value="${escapeHtml(nickname || '')}" placeholder="可留空" />`;
      } else if (g) {
        const grade = (gradesCache || []).find((x) => x.name === g);
        const classes = grade ? grade.classes : [];
        classField.innerHTML = `<label>班级</label><select id="id-class">
          <option value="" disabled selected>请选择班级</option>
          ${classes.map((c) => `<option value="${c}">${c}班</option>`).join('')}
        </select>`;
        nameField.innerHTML = `<label>姓名</label><input id="id-name" type="text" maxlength="32" placeholder="请输入真实姓名" />`;
      } else {
        classField.innerHTML = '';
        nameField.innerHTML = '';
      }
    }
    gradeSel.addEventListener('change', update);
    update();

    return () => ({
      grade: gradeSel.value,
      class_name: (container.querySelector('#id-class') ? container.querySelector('#id-class').value : '').trim(),
      real_name: (container.querySelector('#id-name') ? container.querySelector('#id-name').value : '').trim(),
      show_real_name: (container.querySelector('input[name="id-show-real"]:checked') || {}).value !== '0',
      nickname: (container.querySelector('#id-nickname') ? container.querySelector('#id-nickname').value : '').trim(),
    });
  }

  // 主界面：两个入口
  function renderHome() {
    clearPoll();
    clearPendingOAuth();
    view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card card">
          <div class="auth-brand auth-brand-row">
            <img class="brand-logo" src="/img/logo.png" alt="南中科创局" onerror="this.outerHTML='<span class=&quot;brand-logo&quot; style=&quot;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700;&quot;>南</span>'" />
            <div class="auth-brand-text">
              <h1>南中科创局</h1>
              <p>高中 AI 社团 · 作品收集与展示平台</p>
            </div>
          </div>
          <button class="btn btn-primary" id="qq-login-btn" style="width:100%;justify-content:center;padding:13px;font-size:15px;">🐧 QQ 频道登录</button>
          <div style="text-align:center;margin:14px 0;color:var(--text-dim);font-size:13px;">— 或 —</div>
          <button class="btn" id="guest-btn" style="width:100%;justify-content:center;">我没有QQ，或直接提交我的程序文件</button>
        </div>
      </div>`;
    document.getElementById('qq-login-btn').onclick = () => startQqLogin();
    document.getElementById('guest-btn').onclick = () => renderGuestSubmit();
  }

  // QQ 扫码登录
  async function startQqLogin() {
    const btn = document.getElementById('qq-login-btn');
    if (btn) { btn.disabled = true; btn.textContent = '获取二维码中…'; }
    try {
      const data = await API.post('/api/auth/qq/init', JSON.stringify({}));
      if (data.error || !data.session || !data.qrcode_base64) {
        throw new Error(data.error || '获取二维码失败，请重试');
      }
      renderQr(data);
    } catch (err) {
      showError(err.message);
      if (btn) { btn.disabled = false; btn.textContent = '🐧 QQ 频道登录'; }
    }
  }

  function renderQr(initData) {
    clearPoll();
    const session = initData.session;
    const uri = initData.verification_uri || '';
    savePendingOAuth(session);
    view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card card" style="text-align:center;">
          <div class="auth-brand"><img class="brand-logo" src="/img/logo.png" alt="南中科创局" onerror="this.outerHTML='<span class=&quot;brand-logo&quot; style=&quot;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700;&quot;>南</span>'" /><h1>QQ 频道登录</h1></div>
          <p style="color:var(--text-dim);font-size:13px;margin:0 0 14px;">授权后即可进入系统</p>

          ${uri
            ? `<a href="${escapeHtml(uri)}" target="_blank" rel="noopener" class="btn btn-primary auth-link-btn">打开授权链接</a>`
            : `<button class="btn btn-primary auth-link-btn" id="copy-link">复制授权链接</button>`}
          <p style="font-size:12px;color:var(--text-dim);margin:8px 0 4px;">推荐在手机或电脑浏览器中打开，用 QQ 授权登录</p>

          <details class="qrcode-details">
            <summary>也可以用 QQ 扫码登录</summary>
            <img alt="登录二维码" src="data:image/png;base64,${initData.qrcode_base64}"
                 style="width:180px;height:180px;border:2px dashed var(--border);border-radius:20px;margin-top:8px;" />
          </details>

          <div id="qr-status" style="font-size:13px;color:var(--text-dim);margin:12px 0;">等待授权…</div>
          <div id="channel-join" style="display:none;margin-top:6px;padding:14px 12px;border:1px solid var(--border);border-radius:16px;background:var(--bg);">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px;">🤔 没找到你的频道身份？</div>
            <img src="/img/qq-channel.jpg" alt="南方中学校友频道二维码" style="width:150px;height:150px;border-radius:12px;border:1px solid var(--border);" />
            <div style="font-size:12px;color:var(--text-dim);margin-top:8px;line-height:1.7;">可能是还没加入频道。扫一扫加入「南方中学校友频道」后，重新扫码授权即可。</div>
          </div>
          <button class="btn" id="qr-back" style="width:100%;justify-content:center;">返回</button>
        </div>
      </div>`;
    document.getElementById('qr-back').onclick = renderHome;
    const copyBtn = document.getElementById('copy-link');
    if (copyBtn) {
      copyBtn.onclick = () => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(uri).catch(() => {});
        }
        const st = document.getElementById('qr-status');
        if (st) st.textContent = '链接已复制，请到浏览器粘贴打开';
      };
    }

    const poll = async () => {
      const done = await pollSession(session, document.getElementById('qr-status'));
      if (!done) pollTimer = setTimeout(poll, 2500);
    };
    pollTimer = setTimeout(poll, 2000);
  }

  // 轮询授权状态；返回 true 表示已结束（授权成功或出错），false 表示继续轮询
  // 身份反查失败（tiny_id 拿不到）时最多重试 10 次（约 25 秒），避免无限轮询
  let pollRetries = 0;
  const MAX_POLL_RETRIES = 10;
  async function pollSession(sessionId, statusEl) {
    try {
      const r = await API.post('/api/auth/qq/poll', JSON.stringify({ session: sessionId }));
      if (r.status === 'authorized') {
        clearPoll();
        if (r.bound && r.user) {
          const bindRes = await API.post('/api/auth/qq/bind', JSON.stringify({ session: sessionId }));
          enterSystem(bindRes);
        } else {
          renderBindForm(sessionId, r.nickname || '');
        }
        return true;
      }
      if (statusEl) {
        statusEl.textContent = (r.status === 'pending_authorization' && r.error) ? r.error : '等待授权…';
      }
      if (r.status === 'pending_authorization' && r.error) {
        // 身份反查失败/未加入频道：显示频道二维码引导加入（仅首次出现时展示，避免每次重绘闪烁）
        const qrBox = document.getElementById('channel-join');
        if (qrBox && qrBox.style.display === 'none') qrBox.style.display = '';
        // 身份反查类错误：重试有上限
        pollRetries++;
        if (pollRetries >= MAX_POLL_RETRIES) {
          clearPoll();
          if (statusEl) {
            statusEl.innerHTML = `${Utils.escapeHtml(r.error)}<br><a href="#" id="retry-auth-link" style="color:var(--primary);font-weight:600;">重新扫码</a>`;
            const link = document.getElementById('retry-auth-link');
            if (link) link.onclick = (e) => { e.preventDefault(); renderHome(); };
          }
          return true;
        }
      }
      return false;
    } catch (err) {
      clearPoll();
      if (statusEl) statusEl.textContent = err.message;
      return true;
    }
  }

  // 移动端回调恢复：页面刷新后凭 localStorage 里的 session 继续轮询（无二维码/链接）
  function renderPendingAuth(sessionId) {
    clearPoll();
    view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card card" style="text-align:center;">
          <div class="auth-brand"><img class="brand-logo" src="/img/logo.png" alt="南中科创局" onerror="this.outerHTML='<span class=&quot;brand-logo&quot; style=&quot;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700;&quot;>南</span>'" /><h1>QQ 频道登录</h1></div>
          <div id="qr-status" style="font-size:13px;color:var(--text-dim);margin:16px 0;">等待授权…</div>
          <div id="channel-join" style="display:none;margin-top:6px;padding:14px 12px;border:1px solid var(--border);border-radius:16px;background:var(--bg);">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px;">🤔 没找到你的频道身份？</div>
            <img src="/img/qq-channel.jpg" alt="南方中学校友频道二维码" style="width:150px;height:150px;border-radius:12px;border:1px solid var(--border);" />
            <div style="font-size:12px;color:var(--text-dim);margin-top:8px;line-height:1.7;">可能是还没加入频道。扫一扫加入「南方中学校友频道」后，重新扫码授权即可。</div>
          </div>
          <button class="btn" id="qr-back" style="width:100%;justify-content:center;">重新扫码</button>
        </div>
      </div>`;
    document.getElementById('qr-back').onclick = renderHome;
    const poll = async () => {
      const done = await pollSession(sessionId, document.getElementById('qr-status'));
      if (!done) pollTimer = setTimeout(poll, 2500);
    };
    pollTimer = setTimeout(poll, 2000);
  }

  // 扫码成功但未绑定 → 补全班级+姓名
  async function renderBindForm(session, nickname) {
    clearPoll();
    clearPendingOAuth();
    view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card card">
          <div class="auth-brand"><img class="brand-logo" src="/img/logo.png" alt="南中科创局" onerror="this.outerHTML='<span class=&quot;brand-logo&quot; style=&quot;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700;&quot;>南</span>'" /><h1>完善信息</h1><p>QQ 登录成功，请确认你的班级与姓名</p></div>
          <div class="form-error" id="auth-error"></div>
          <div id="channel-join" style="display:none;margin-bottom:14px;padding:14px 12px;border:1px solid var(--border);border-radius:16px;background:var(--bg);text-align:center;">
            <div style="font-size:13px;font-weight:600;margin-bottom:8px;">🤔 没找到你的频道身份？</div>
            <img src="/img/qq-channel.jpg" alt="南方中学校友频道二维码" style="width:150px;height:150px;border-radius:12px;border:1px solid var(--border);" />
            <div style="font-size:12px;color:var(--text-dim);margin-top:8px;line-height:1.7;">可能是还没加入频道。扫一扫加入「南方中学校友频道」后，重新扫码授权即可。</div>
          </div>
          <div id="id-container"></div>
          <button class="btn btn-primary" id="bind-submit" style="width:100%;justify-content:center;">进入系统</button>
          <button class="btn btn-ghost" id="bind-back" style="width:100%;justify-content:center;margin-top:6px;">返回</button>
        </div>
      </div>`;
    document.getElementById('bind-back').onclick = renderHome;
    await loadGrades();
    const getValues = renderIdentity(document.getElementById('id-container'), nickname);
    document.getElementById('bind-submit').onclick = async () => {
      const v = getValues();
      if (!v.grade) return showError('请选择年级');
      if (v.grade !== '其他' && !v.class_name) return showError('请选择班级');
      const otherErr = checkOtherClass(v);
      if (otherErr) return showError(otherErr);
      if (v.grade !== '其他' && !v.real_name) return showError('请输入姓名');
      if (!v.show_real_name && !v.nickname) return showError('选择只展示昵称后，请填写昵称');
      try {
        const data = await API.post('/api/auth/qq/bind', JSON.stringify({
          session, class_name: v.class_name, real_name: v.real_name,
          show_real_name: v.show_real_name, nickname: v.nickname,
        }));
        enterSystem(data);
      } catch (err) {
        showError(err.message);
        // 身份/频道相关错误（如"无法识别你的 QQ 身份"）：展示频道二维码引导加入
        const qrBox = document.getElementById('channel-join');
        if (qrBox && /身份|频道|加入/.test(err.message)) qrBox.style.display = '';
      }
    };
  }

  // 访客直传：年级 → 班级 → 姓名 → 展示名授权 → 上传文件 → 提交后给项目地址。
  // 不进入系统（不发系统令牌），只在这一个表单里闭环；以后用项目地址查看/下载。
  function renderGuestSubmit() {
    clearPoll();
    clearPendingOAuth();
    view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card card">
          <div class="auth-brand"><img class="brand-logo" src="/img/logo.png" alt="南中科创局" onerror="this.outerHTML='<span class=&quot;brand-logo&quot; style=&quot;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700;&quot;>南</span>'" /><h1>直接提交作品</h1><p>没有 QQ？填好班级姓名，上传你的程序文件即可</p></div>
          <div class="form-error" id="auth-error"></div>
          <div id="id-container"></div>
          <div class="field" style="margin-top:10px;">
            <label>安全密码（选填）</label>
            <input id="guest-pwd" type="password" maxlength="64" autocomplete="new-password" placeholder="删除文件时需要输入" />
            <div style="font-size:12px;color:var(--text-dim);margin-top:4px;">用于保护你的项目文件不被误删 / 他人删除；<strong>留空则使用默认密码 nanfang1958</strong>，建议设置一个专属密码并记好</div>
          </div>
          <div class="field" style="margin-top:12px;">
            <label>上传程序文件</label>
            <div class="guest-dropzone" id="guest-dropzone">
              <div class="dz-icon">📤</div>
              <div class="dz-title">点击选择 或 拖拽文件到此处</div>
              <div class="dz-hint">仅支持代码 / 文本文件（.html .py .js .md 等）或压缩包；单次单个文件不超过 200MB，每天最多上传 5 次</div>
              <input type="file" id="guest-file-input" multiple style="display:none;" />
            </div>
            <div id="guest-file-list" style="margin-top:8px;display:none;"></div>
            <div id="guest-upload-status" style="margin-top:8px;display:none;"></div>
          </div>
          <button class="btn btn-primary" id="guest-submit" style="width:100%;justify-content:center;margin-top:14px;">提交作品</button>
          <button class="btn btn-ghost" id="guest-back" style="width:100%;justify-content:center;margin-top:6px;">返回</button>
        </div>
      </div>`;
    document.getElementById('guest-back').onclick = renderHome;

    const dropzone = document.getElementById('guest-dropzone');
    const fileInput = document.getElementById('guest-file-input');
    let selectedFiles = [];
    const renderSelected = () => {
      const listEl = document.getElementById('guest-file-list');
      listEl.style.display = selectedFiles.length ? '' : 'none';
      listEl.innerHTML = selectedFiles.map((f, i) => `
        <div class="file-row" style="padding:8px 10px;">
          <div class="file-info">
            <div class="file-name">${escapeHtml(f.name)}</div>
            <div class="file-meta">${Utils.formatSize(f.size)}</div>
          </div>
          <button class="btn btn-sm btn-ghost" data-remove="${i}" style="color:var(--danger);">移除</button>
        </div>`).join('');
      listEl.querySelectorAll('[data-remove]').forEach((b) => {
        b.onclick = () => { selectedFiles.splice(parseInt(b.dataset.remove, 10), 1); renderSelected(); };
      });
    };
    if (dropzone) dropzone.onclick = () => fileInput && fileInput.click();
    // 选文件即校验：不支持的扩展名 / 超限文件当场拦截（不进入待传列表），避免"提交成功"后才提示失败
    const addPickedFiles = async (picked) => {
      const rules = await loadUploadRules();
      const invalid = [];
      const valid = [];
      for (const f of picked) {
        const reason = validateGuestFile(f, rules);
        (reason ? invalid : valid).push({ f, reason });
      }
      if (invalid.length) {
        showError(`${invalid.length} 个文件未添加：${invalid.map((x) => `${x.f.name}（${x.reason}）`).join('；')}。仅支持 ${rules.allowed_extensions.map((e) => '.' + e).join(' ')}，单文件不超过 ${rules.max_upload_mb}MB`);
      } else {
        showError('');
      }
      if (selectedFiles.length + valid.length > 5) {
        showError('一次最多上传 5 个文件；如需提交更多，请打包成压缩包');
        return;
      }
      // 只把真正的 File 对象加入待传列表（valid 里是 {f, reason} 包装对象，不能直接 concat）
      selectedFiles = selectedFiles.concat(valid.map((x) => x.f));
      renderSelected();
    };
    if (fileInput) {
      fileInput.onchange = () => {
        const picked = [...fileInput.files];
        fileInput.value = '';
        addPickedFiles(picked);
      };
    }
    if (dropzone) {
      ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('dragover'); }));
      ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
      dropzone.addEventListener('drop', (e) => addPickedFiles([...e.dataTransfer.files]));
    }

    loadGrades().then(async () => {
      const getValues = renderIdentity(document.getElementById('id-container'), '');
      document.getElementById('guest-submit').onclick = async () => {
        const errEl = document.getElementById('auth-error');
        errEl.classList.remove('show');
        const v = getValues();
        if (!v.grade) return showError('请选择年级');
        if (v.grade !== '其他' && !v.class_name) return showError('请选择班级');
        const otherErr = checkOtherClass(v);
        if (otherErr) return showError(otherErr);
        if (v.grade !== '其他' && !v.real_name) return showError('请输入姓名');
        if (!v.show_real_name && !v.nickname) return showError('选择只展示昵称后，请填写昵称');
        if (!selectedFiles.length) return showError('请先选择要上传的程序文件');

        // 提交前兜底校验（与选文件时一致）：任何文件不通过都不进入登记/上传流程
        const rules = await loadUploadRules();
        const invalid = selectedFiles.map((f) => ({ f, reason: validateGuestFile(f, rules) })).filter((x) => x.reason);
        if (invalid.length) {
          return showError(`${invalid.length} 个文件不通过校验：${invalid.map((x) => `${x.f.name}（${x.reason}）`).join('；')}。请移除后重试`);
        }
        showError('');

        const submitBtn = document.getElementById('guest-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = '提交中…';
        try {
          // 1) 登记身份，拿到项目地址令牌（含安全密码：留空服务端按默认密码处理）
          const guestPwdEl = document.getElementById('guest-pwd');
          const reg = await API.post('/api/auth/guest', JSON.stringify({
            class_name: v.class_name, real_name: v.real_name,
            show_real_name: v.show_real_name, nickname: v.nickname,
            guest_pwd: guestPwdEl ? guestPwdEl.value.trim() : '',
          }));
          if (!reg || !reg.token) throw new Error('登记失败，请重试');

          // 2) 逐个上传文件：显示实时进度（已传/总字节 + 速度），失败跳过，最后汇总
          const results = [];
          const statusEl = document.getElementById('guest-upload-status');
          if (statusEl) {
            statusEl.style.display = '';
            statusEl.innerHTML = selectedFiles.map((f, i) => `
              <div class="file-row" style="padding:8px 10px;">
                <span style="width:22px;flex-shrink:0;" data-st="${i}">⏳</span>
                <div class="file-info">
                  <div class="file-name">${escapeHtml(f.name)}</div>
                  <div class="file-meta" data-pg="${i}" style="font-size:12px;">等待上传…</div>
                </div>
              </div>`).join('');
          }
          const setProg = (i, text) => {
            const el = statusEl && statusEl.querySelector(`[data-pg="${i}"]`);
            if (el) el.textContent = text;
          };
          const setIcon = (i, icon) => {
            const el = statusEl && statusEl.querySelector(`[data-st="${i}"]`);
            if (el) el.textContent = icon;
          };
          for (let i = 0; i < selectedFiles.length; i++) {
            const f = selectedFiles[i];
            const fd = new FormData();
            fd.append('file', f);
            fd.append('token', reg.token);
            const tracker = Utils.createSpeedTracker();
            try {
              const up = await API.uploadWithProgress('/api/guest/upload', fd, (loaded, total) => {
                setProg(i, Utils.formatProgress(loaded, total, tracker(loaded)));
              });
              setIcon(i, '✅');
              setProg(i, '已完成');
              results.push({ name: f.name, ok: true, msg: '' });
              if (up && typeof up.uploads_today === 'number' && up.max_uploads_per_day != null && up.uploads_today >= up.max_uploads_per_day) {
                // 已达今日上限：停止后续文件（避免全部失败）
                break;
              }
            } catch (err) {
              setIcon(i, '❌');
              setProg(i, err.message);
              results.push({ name: f.name, ok: false, msg: err.message });
              if (err.status === 401) break; // 令牌失效，停止
            }
          }
          renderGuestSuccess(reg, results);
        } catch (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = '提交作品';
          showError(err.message);
        }
      };
    });
  }

  // 提交完成：展示项目地址（以后用它查看/下载提交的作品）。
  // 文件类型/大小已在提交前校验，走到这里基本是全部成功；若仍有运行时失败（网络/额度/同名），如实展示，不伪装"提交成功"
  function renderGuestSuccess(reg, results) {
    clearPoll();
    const projectUrl = location.origin + location.pathname + '#/p/' + reg.token;
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    const heading = failCount
      ? `⚠️ 部分文件上传失败（成功 ${okCount} 个）`
      : `🎉 提交成功${okCount ? `（${okCount} 个文件）` : ''}`;
    view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card card" style="text-align:center;">
          <div class="auth-brand"><img class="brand-logo" src="/img/logo.png" alt="南中科创局" onerror="this.outerHTML='<span class=&quot;brand-logo&quot; style=&quot;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700;&quot;>南</span>'" /><h1>${heading}</h1></div>
          <p style="font-size:14px;color:var(--text);margin:0 0 14px;">这是你的<strong>专属项目地址</strong>，请保存好：<br>以后想查看或下载你提交的作品，用这个地址访问即可。</p>
          <div style="display:flex;gap:8px;margin-bottom:12px;">
            <input id="project-url" type="text" readonly value="${escapeHtml(projectUrl)}" style="flex:1;padding:10px;border:1px solid var(--border);border-radius:10px;font-size:13px;background:var(--bg);color:var(--text);" />
            <button class="btn btn-primary" id="copy-url" style="white-space:nowrap;">复制</button>
          </div>
          <div style="font-size:12px;color:var(--text-dim);line-height:1.8;margin-bottom:12px;">
            额度：单个文件不超过 ${reg.max_upload_mb || 200}MB，每天最多上传 ${reg.max_uploads_per_day || 5} 次。<br>
            想继续上传更多作品？打开上面的地址，在项目页里继续提交即可。
          </div>
          ${failCount ? `<div class="form-error show" style="display:block;margin-bottom:10px;">${failCount} 个文件上传失败：${escapeHtml(results.filter((r) => !r.ok).map((r) => r.name + '（' + r.msg + '）').join('；'))}</div>` : ''}
          <a class="btn btn-primary" id="open-project" style="width:100%;justify-content:center;" href="#/p/${encodeURIComponent(reg.token)}">打开我的项目地址</a>
          <button class="btn btn-ghost" id="again-submit" style="width:100%;justify-content:center;margin-top:6px;">再提交一份作品</button>
        </div>
      </div>`;
    document.getElementById('copy-url').onclick = async () => {
      try {
        await navigator.clipboard.writeText(projectUrl);
        Utils.toast('项目地址已复制');
      } catch (_) {
        const input = document.getElementById('project-url');
        if (input) { input.select(); document.execCommand('copy'); Utils.toast('已复制（请手动粘贴）'); }
      }
    };
    document.getElementById('again-submit').onclick = renderGuestSubmit;
  }

  const pending = getPendingOAuth();
  if (pending) {
    renderPendingAuth(pending);
  } else {
    renderHome();
  }
};
