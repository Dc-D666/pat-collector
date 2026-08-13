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
    if (el) { el.textContent = msg; el.classList.add('show'); }
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
        <div style="display:flex;gap:16px;margin-top:6px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;"><input type="radio" name="id-show-real" value="1" checked /> 是</label>
          <label style="display:flex;align-items:center;gap:6px;font-size:14px;"><input type="radio" name="id-show-real" value="0" /> 否，只展示昵称</label>
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
        classField.innerHTML = `<label>班级（选填）</label><input id="id-class" type="text" maxlength="32" placeholder="如：教师 / 社团 / 毕业生，可留空" />`;
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
    document.getElementById('guest-btn').onclick = () => renderGuestForm();
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

  // 无 QQ 直通：姓名 + 班级
  async function renderGuestForm() {
    clearPoll();
    view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card card">
          <div class="auth-brand"><img class="brand-logo" src="/img/logo.png" alt="南中科创局" onerror="this.outerHTML='<span class=&quot;brand-logo&quot; style=&quot;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-weight:700;&quot;>南</span>'" /><h1>直接提交</h1><p>没有 QQ？填班级和姓名即可进入</p></div>
          <div class="form-error" id="auth-error"></div>
          <div id="id-container"></div>
          <button class="btn btn-primary" id="guest-submit" style="width:100%;justify-content:center;">进入系统</button>
          <button class="btn btn-ghost" id="guest-back" style="width:100%;justify-content:center;margin-top:6px;">返回</button>
        </div>
      </div>`;
    document.getElementById('guest-back').onclick = renderHome;
    await loadGrades();
    const getValues = renderIdentity(document.getElementById('id-container'), '');
    document.getElementById('guest-submit').onclick = async () => {
      const v = getValues();
      if (!v.grade) return showError('请选择年级');
      if (v.grade !== '其他' && !v.class_name) return showError('请选择班级');
      if (v.grade !== '其他' && !v.real_name) return showError('请输入姓名');
      if (!v.show_real_name && !v.nickname) return showError('选择只展示昵称后，请填写昵称');
      try {
        const data = await API.post('/api/auth/guest', JSON.stringify({
          class_name: v.class_name, real_name: v.real_name,
          show_real_name: v.show_real_name, nickname: v.nickname,
        }));
        enterSystem(data);
      } catch (err) { showError(err.message); }
    };
  }

  const pending = getPendingOAuth();
  if (pending) {
    renderPendingAuth(pending);
  } else {
    renderHome();
  }
};
