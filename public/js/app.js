'use strict';

// 入口路由（hash 路由）
window.App = (() => {
  const routes = {
    login: () => Views.login(),
    files: () => Views.files(),
    'class-wall': () => Views.classWall(),
    overview: () => Views.overview(),
  };

  function parseKey() {
    const h = location.hash.replace(/^#\/?/, '') || 'files';
    return h.split('/')[0] || 'files';
  }

  function render() {
    const key = parseKey();
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
    const user = API.getUser();
    if (user && user.must_change_password) {
      Views.forcePassword();
      return;
    }
    Nav.render();
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
