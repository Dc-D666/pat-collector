'use strict';

// 登录 / 注册视图
window.Views = window.Views || {};
Views.login = () => {
  const { escapeHtml } = Utils;
  const view = document.getElementById('view');

  function classOptions() {
    let html = '<option value="" disabled selected>请选择班级</option>';
    html += '<optgroup label="高二">';
    for (let c = 2501; c <= 2524; c++) html += `<option value="${c}">${c}班</option>`;
    html += '</optgroup><optgroup label="高一">';
    for (let c = 2601; c <= 2625; c++) html += `<option value="${c}">${c}班</option>`;
    html += '</optgroup>';
    return html;
  }

  view.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card card">
        <div class="auth-brand">
          <div class="brand-logo">P</div>
          <h1>PatPlayer</h1>
          <p>高中 AI 社团 · 作品收集与展示平台</p>
        </div>
        <div class="auth-tabs">
          <button class="auth-tab active" data-mode="login">登录</button>
          <button class="auth-tab" data-mode="register">注册</button>
        </div>
        <div class="form-error" id="form-error"></div>
        <form id="auth-form" novalidate>
          <div class="field">
            <label for="f-class">班级</label>
            <select id="f-class" required>${classOptions()}</select>
          </div>
          <div class="field">
            <label for="f-name">真实姓名</label>
            <input id="f-name" type="text" autocomplete="name" placeholder="请输入真实姓名" required />
          </div>
          <div class="field">
            <label for="f-last4">学号后 4 位</label>
            <input id="f-last4" type="text" inputmode="numeric" maxlength="4" placeholder="如 0001" required />
          </div>
          <div class="field" id="f-password-field" style="display:none;">
            <label for="f-password">密码</label>
            <input id="f-password" type="password" autocomplete="current-password" placeholder="请输入密码" />
          </div>
          <div class="hint" id="f-hint" style="display:none;">初始密码为 123456，注册成功后可自行修改。</div>
          <button class="btn btn-primary" id="submit-btn" type="submit" style="width:100%;justify-content:center;margin-top:4px;">登录</button>
        </form>
      </div>
    </div>`;

  let mode = 'login';

  const setMode = (m) => {
    mode = m;
    document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === m));
    document.getElementById('f-password-field').style.display = m === 'login' ? '' : 'none';
    document.getElementById('f-hint').style.display = m === 'register' ? '' : 'none';
    document.getElementById('submit-btn').textContent = m === 'login' ? '登录' : '注册';
    document.getElementById('f-password').required = m === 'login';
    hideError();
  };

  const showError = (msg) => {
    const el = document.getElementById('form-error');
    el.textContent = msg;
    el.classList.add('show');
  };
  const hideError = () => document.getElementById('form-error').classList.remove('show');

  view.querySelectorAll('.auth-tab').forEach((t) => {
    t.onclick = () => setMode(t.dataset.mode);
  });

  document.getElementById('auth-form').onsubmit = async (e) => {
    e.preventDefault();
    hideError();
    const payload = {
      class_name: document.getElementById('f-class').value,
      real_name: document.getElementById('f-name').value.trim(),
      student_id_last4: document.getElementById('f-last4').value.trim(),
    };
    const btn = document.getElementById('submit-btn');
    btn.disabled = true;
    try {
      let data;
      if (mode === 'register') {
        data = await API.post('/api/auth/register', JSON.stringify(payload));
      } else {
        data = await API.post('/api/auth/login', JSON.stringify({
          ...payload,
          password: document.getElementById('f-password').value,
        }));
      }
      API.setToken(data.token);
      API.setUser(data.user);
      if (data.user && data.user.must_change_password) {
        Views.forcePassword();
      } else {
        location.hash = '#/files';
      }
    } catch (err) {
      showError(err.message);
    } finally {
      btn.disabled = false;
    }
  };

  setMode('login');
};

// 首次登录强制改密视图（登录/注册后，或路由守卫发现未改密时调用）
Views.forcePassword = () => {
  const view = document.getElementById('view');
  view.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card card">
        <div class="auth-brand">
          <div class="brand-logo">P</div>
          <h1>首次登录</h1>
          <p>请先设置你的新密码</p>
        </div>
        <div class="form-error" id="np-error"></div>
        <div class="field"><label>新密码</label><input id="np" type="password" autocomplete="new-password" placeholder="至少 4 位" /></div>
        <div class="field"><label>确认新密码</label><input id="np2" type="password" autocomplete="new-password" placeholder="再次输入" /></div>
        <button class="btn btn-primary" id="np-submit" style="width:100%;justify-content:center;">设置并进入</button>
      </div>
    </div>`;
  const errEl = document.getElementById('np-error');
  const showNpErr = (m) => { errEl.textContent = m; errEl.classList.add('show'); };
  document.getElementById('np-submit').onclick = async () => {
    errEl.classList.remove('show');
    const p1 = document.getElementById('np').value;
    const p2 = document.getElementById('np2').value;
    if (p1.length < 4) return showNpErr('密码至少 4 位');
    if (p1 !== p2) return showNpErr('两次输入的密码不一致');
    if (p1 === '123456') return showNpErr('请勿使用默认密码 123456');
    try {
      await API.post('/api/auth/change-password', JSON.stringify({ old_password: '123456', new_password: p1 }));
      API.setUser({ ...API.getUser(), must_change_password: false });
      location.hash = '#/files';
    } catch (err) {
      showNpErr(err.message);
    }
  };
};
