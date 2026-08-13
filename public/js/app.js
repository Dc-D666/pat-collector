'use strict';

// 入口路由（hash 路由）
window.App = (() => {
  const routes = {
    login: () => Views.login(),
    files: () => Views.files(),
    'class-wall': () => Views.classWall(),
    overview: () => Views.overview(),
    learn: () => Views.learnList(),
    'learn/:slug': (slug) => Views.learnArticle(slug),
    points: () => Views.points(),
  };

  function parseKey() {
    const h = location.hash.replace(/^#\/?/, '') || 'files';
    const parts = h.split('/');
    return { key: parts[0] || 'files', arg: parts[1] || '' };
  }

  function render() {
    // 每次路由切换（含 SPA 内跳转）先取消正在进行的阅读计时，
    // 避免离开文章后 60 秒定时器仍触发"阅读完成"提示
    if (typeof window.__cancelLearnReadTimer === 'function') {
      window.__cancelLearnReadTimer();
    }

    const { key, arg } = parseKey();
    const isLogin = key === 'login';
    document.body.classList.toggle('is-auth', !isLogin);

    if (isLogin) {
      routes.login();
      return;
    }
    if (!API.getToken()) {
      location.hash = '#/login';
      return;
    }
    Nav.render();
    if (key === 'learn' && arg) {
      routes['learn/:slug'](arg);
      return;
    }
    (routes[key] || routes.files)();
  }

  window.addEventListener('hashchange', render);
  document.addEventListener('DOMContentLoaded', () => {
    if (!location.hash) {
      location.hash = API.getToken() ? '#/files' : '#/login';
    } else {
      render();
    }
  });

  return { render };
})();
