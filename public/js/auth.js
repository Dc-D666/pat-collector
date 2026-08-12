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

  function showError(msg) {
    const el = document.getElementById('auth-error');
    if (el) { el.textContent = msg; el.classList.add('show'); }
  }

  function enterSystem(data) {
    API.setToken(data.token);
    API.setUser(data.user);
    location.hash = '#/files';
  }

  // 渲染「年级 → 班级」二级菜单 + 姓名字段；返回取值函数
  // nickname：仅「其他」分支会预填到姓名（QQ 场景）；标准年级不预填
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
      <div class="field" id="id-name-field"></div>`;

    const gradeSel = container.querySelector('#id-grade');
    const classField = container.querySelector('#id-class-field');
    const nameField = container.querySelector('#id-name-field');

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
    });
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
            const bindRes = await API.post('/api/auth/qq/bind', JSON.stringify({ session }));
            enterSystem(bindRes);
          } else {
            renderBindForm(session, r.nickname || '');
          }
          return;
        }
        const statusEl = document.getElementById('qr-status');
        if (statusEl) {
          statusEl.textContent = (r.status === 'pending_authorization' && r.error) ? r.error : '等待扫码授权…';
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
  async function renderBindForm(session, nickname) {
    clearPoll();
    view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card card">
          <div class="auth-brand"><div class="brand-logo">P</div><h1>完善信息</h1><p>QQ 登录成功，请确认你的班级与姓名</p></div>
          <div class="form-error" id="auth-error"></div>
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
      try {
        const data = await API.post('/api/auth/qq/bind', JSON.stringify({ session, class_name: v.class_name, real_name: v.real_name }));
        enterSystem(data);
      } catch (err) { showError(err.message); }
    };
  }

  // 无 QQ 直通：姓名 + 班级
  async function renderGuestForm() {
    clearPoll();
    view.innerHTML = `
      <div class="auth-wrap">
        <div class="auth-card card">
          <div class="auth-brand"><div class="brand-logo">P</div><h1>直接提交</h1><p>没有 QQ？填班级和姓名即可进入</p></div>
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
      try {
        const data = await API.post('/api/auth/guest', JSON.stringify({ class_name: v.class_name, real_name: v.real_name }));
        enterSystem(data);
      } catch (err) { showError(err.message); }
    };
  }

  renderHome();
};
