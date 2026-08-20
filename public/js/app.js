'use strict';

// 入口路由（hash 路由）
window.App = (() => {
  const routes = {
    activity: () => Views.activity(),
    club: () => Views.club(),
    login: () => Views.login(),
    files: () => Views.files(),
    'class-wall': () => Views.classWall(),
    overview: () => Views.overview(),
    learn: () => Views.learnList(),
    'learn/:slug': (slug) => Views.learnArticle(slug),
    points: () => Views.points(),
    'p/:token': (token) => Views.project(token),
    admin: () => Views.admin(''),
    'admin/:page': (page) => Views.admin(page),
  };

  function parseKey() {
    const h = location.hash.replace(/^#\/?/, '') || 'activity';
    const parts = h.split('/');
    return { key: parts[0] || 'activity', arg: parts[1] || '' };
  }

  function render() {
    // 每次路由切换（含 SPA 内跳转）先取消正在进行的阅读计时，
    // 避免离开文章后 60 秒定时器仍触发"阅读完成"提示
    if (typeof window.__cancelLearnReadTimer === 'function') {
      window.__cancelLearnReadTimer();
    }

    const { key, arg } = parseKey();
    const isLogin = key === 'login';
    // 项目地址页（#/p/:token）：访客独立页，同样隐藏主页壳
    const isProject = key === 'p' && !!arg;
    // is-auth = 登录页/独立页标记：隐藏主页壳（rail/appbar/topbar），进入系统后移除恢复
    document.body.classList.toggle('is-auth', isLogin || isProject);

    if (isLogin) {
      routes.login();
      animateView();
      return;
    }
    if (isProject) {
      routes['p/:token'](arg);
      animateView();
      return;
    }
    if (!API.getToken()) {
      location.hash = '#/login';
      return;
    }
    Nav.render();
    checkQqStatusGlobal(); // 全站 QQ 会话失效检测（节流 60s）
    if (key === 'learn' && arg) {
      routes['learn/:slug'](arg);
      animateView();
      return;
    }
    if (key === 'admin') {
      // 管理后台：非管理员由 Views.admin 内部拦截（后端 requireAdmin 双保险）
      if (arg) routes['admin/:page'](arg);
      else routes.admin();
      animateView();
      return;
    }
    (routes[key] || routes.activity)();
    animateView();
  }

  // 视图切换淡入（对齐 NFTI 页面过渡动效）
  function animateView() {
    const viewEl = document.getElementById('view');
    if (!viewEl) return;
    viewEl.classList.remove('view-enter');
    void viewEl.offsetWidth; // 强制 reflow，重启动画
    viewEl.classList.add('view-enter');
  }

  // 全站 QQ 会话失效检测（单设备登录被踢后 token 失效）：节流 60s，失效时顶部横幅提示重新登录
  let lastQqCheck = 0;
  async function checkQqStatusGlobal() {
    let u = null;
    try { u = API.getUser(); } catch (_) { return; }
    if (!u || !u.is_qq_bound) return;
    const now = Date.now();
    if (now - lastQqCheck < 60 * 1000) return;
    lastQqCheck = now;
    try {
      const data = await API.get('/api/auth/qq/status');
      if (data.valid === false) {
        const root = document.getElementById('qq-banner-root');
        if (root && !root.querySelector('.qq-expired-banner')) {
          root.innerHTML = `
            <div class="qq-expired-banner">
              <span>⚠️ QQ 频道登录已失效（可能在其他设备登录了），AI 轻应用识别功能暂不可用。</span>
              <button id="qq-relogin-btn">重新登录</button>
            </div>`;
          const btn = document.getElementById('qq-relogin-btn');
          if (btn) btn.onclick = () => { API.clearToken(); location.hash = '#/login'; };
        }
      }
    } catch (_) { /* 静默失败 */ }
  }

  window.addEventListener('hashchange', render);
  document.addEventListener('DOMContentLoaded', () => {
    if (!location.hash) {
      location.hash = API.getToken() ? '#/activity' : '#/login';
    } else {
      render();
    }
  });

  // ---- 彩蛋：连续点击积分徽章 5 次（2s 窗口内）触发一次奖励（后端幂等，只能领一次）----
  (function initEasterEgg() {
    let clicks = 0;
    let lastClick = 0;
    const WINDOW_MS = 2000;
    const NEED = 5;
    document.addEventListener('click', async (e) => {
      if (!e.target || !e.target.closest) return;
      const badge = e.target.closest('.points-badge');
      if (!badge) return;
      const now = Date.now();
      if (now - lastClick > WINDOW_MS) clicks = 0;
      lastClick = now;
      clicks++;
      if (clicks < NEED) return;
      clicks = 0;
      if (!API.getToken()) return;
      try {
        const r = await API.post('/api/points/easter-egg', '{}');
        if (r && r.ok) {
          Utils.toast('🎉 发现彩蛋！+5 ⭐');
          const u = API.getUser();
          if (u) {
            if (typeof r.points === 'number') u.points = r.points;
            API.setUser(u);
          }
          if (r.points != null) {
            document.querySelectorAll('.points-badge').forEach((b) => { b.textContent = '⭐ ' + r.points; });
          }
        } else {
          Utils.toast('彩蛋已经领过啦 😉');
        }
      } catch (_) { /* 静默失败 */ }
    });
  })();

  return { render };
})();
