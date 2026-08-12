'use strict';

// 登录视图：QQ 频道扫码登录（主）+ 无 QQ 直通（兜底，姓名+班级直接进）
window.Views = window.Views || {};
Views.login = () => {
  const { escapeHtml } = Utils;
  const view = document.getElementById('view');
  let pollTimer = null;

  function classOptions() {
    let html = '<option value="" disabled selected>请选择班级</option>';
    html += '<optgroup label="高二">';
    for (let c = 2501; c <= 2524; c++) html += `<option value="${c}">${c}班</option>`;
    html += '</optgroup><optgroup label="高一">';
    for (let c = 2601; c <= 2625; c++) html += `<option value="${c}">${c}班</option>`;
    html += '</optgroup>';
    return html;
  }

  function clearPoll() {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  }

  function showError(msg) {
    const el = document.getElementById('auth-error');
    if (el) { el.textContent = msg; el.classList.add('show'); }
  }

  function enterSystem(data) {
    API.setToken(data.token);
    API.setUser(data.user);
    location.hash = '#/files';
  }

  // 主界面：两个入口
  function renderHome() {
    clearPoll();
    view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card card">
          <div class="auth-brand">
            <div class="brand-logo">P</div>
            <h1>PatPlayer</h1>
            <p>高中 AI 社团 · 作品收集与展示平台</p>
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
    view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card card" style="text-align:center;">
          <div class="auth-brand"><div class="brand-logo">P</div><h1>QQ 频道登录</h1></div>
          <p style="color:var(--text-dim);font-size:13px;margin:0 0 12px;">用手机 QQ 扫码，或点击下方链接授权</p>
          <img id="qr-img" alt="登录二维码" src="data:image/png;base64,${initData.qrcode_base64}"
               style="width:220px;height:220px;border:1px solid var(--border);border-radius:12px;" />
          <div style="margin:10px 0;">
            <a href="${escapeHtml(initData.verification_uri || '')}" target="_blank" rel="noopener" style="color:var(--primary);font-size:13px;">在手机上打开授权链接</a>
          </div>
          <div id="qr-status" style="font-size:13px;color:var(--text-dim);margin-bottom:10px;">等待扫码授权…</div>
          <button class="btn" id="qr-back" style="width:100%;justify-content:center;">返回</button>
        </div>
      </div>`;
    document.getElementById('qr-back').onclick = renderHome;

    const poll = async () => {
      try {
        const r = await API.post('/api/auth/qq/poll', JSON.stringify({ session }));
        if (r.status === 'authorized') {
          clearPoll();
          if (r.bound && r.user) {
            // 已绑定 → 直接登录
            const bindRes = await API.post('/api/auth/qq/bind', JSON.stringify({ session }));
            enterSystem(bindRes);
          } else {
            renderBindForm(session, r.nickname || '');
          }
          return;
        }
        const statusEl = document.getElementById('qr-status');
        if (statusEl) {
          if (r.status === 'pending_authorization' && r.error) {
            statusEl.textContent = r.error;
          } else {
            statusEl.textContent = '等待扫码授权…';
          }
        }
        pollTimer = setTimeout(poll, 2500);
      } catch (err) {
        clearPoll();
        const statusEl = document.getElementById('qr-status');
        if (statusEl) statusEl.textContent = err.message;
      }
    };
    pollTimer = setTimeout(poll, 2000);
  }

  // 扫码成功但未绑定 → 补全班级+姓名
  function renderBindForm(session, nickname) {
    clearPoll();
    view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card card">
          <div class="auth-brand"><div class="brand-logo">P</div><h1>完善信息</h1><p>QQ 登录成功，请确认你的班级与姓名</p></div>
          <div class="form-error" id="auth-error"></div>
          <div class="field"><label>班级</label><select id="bind-class">${classOptions()}</select></div>
          <div class="field"><label>真实姓名</label><input id="bind-name" type="text" placeholder="请输入真实姓名" value="${escapeHtml(nickname)}" /></div>
          <button class="btn btn-primary" id="bind-submit" style="width:100%;justify-content:center;">进入系统</button>
          <button class="btn btn-ghost" id="bind-back" style="width:100%;justify-content:center;margin-top:6px;">返回</button>
        </div>
      </div>`;
    document.getElementById('bind-back').onclick = renderHome;
    document.getElementById('bind-submit').onclick = async () => {
      const class_name = document.getElementById('bind-class').value;
      const real_name = document.getElementById('bind-name').value.trim();
      if (!class_name) return showError('请选择班级');
      if (!real_name) return showError('请输入真实姓名');
      try {
        const data = await API.post('/api/auth/qq/bind', JSON.stringify({ session, class_name, real_name }));
        enterSystem(data);
      } catch (err) { showError(err.message); }
    };
  }

  // 无 QQ 直通：姓名 + 班级
  function renderGuestForm() {
    clearPoll();
    view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card card">
          <div class="auth-brand"><div class="brand-logo">P</div><h1>直接提交</h1><p>没有 QQ？填班级和姓名即可进入</p></div>
          <div class="form-error" id="auth-error"></div>
          <div class="field"><label>班级</label><select id="guest-class">${classOptions()}</select></div>
          <div class="field"><label>真实姓名</label><input id="guest-name" type="text" placeholder="请输入真实姓名" /></div>
          <button class="btn btn-primary" id="guest-submit" style="width:100%;justify-content:center;">进入系统</button>
          <button class="btn btn-ghost" id="guest-back" style="width:100%;justify-content:center;margin-top:6px;">返回</button>
        </div>
      </div>`;
    document.getElementById('guest-back').onclick = renderHome;
    document.getElementById('guest-submit').onclick = async () => {
      const class_name = document.getElementById('guest-class').value;
      const real_name = document.getElementById('guest-name').value.trim();
      if (!class_name) return showError('请选择班级');
      if (!real_name) return showError('请输入真实姓名');
      try {
        const data = await API.post('/api/auth/guest', JSON.stringify({ class_name, real_name }));
        enterSystem(data);
      } catch (err) { showError(err.message); }
    };
  }

  renderHome();
};
