'use strict';

// API 封装：统一 Bearer 鉴权、401 自动跳登录、fetch+blob 下载
window.API = (() => {
  const TOKEN_KEY = 'patplayer_token';
  const USER_KEY = 'patplayer_user';

  const getToken = () => localStorage.getItem(TOKEN_KEY);
  const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
  const clearToken = () => { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); };
  const setUser = (u) => localStorage.setItem(USER_KEY, JSON.stringify(u));
  const getUser = () => {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch (e) { return null; }
  };

  function goLogin() {
    clearToken();
    location.hash = '#/login';
  }

  async function request(path, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (opts.body && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    const res = await fetch(path, { ...opts, headers });
    if (res.status === 401) {
      goLogin();
      throw new Error('登录已过期，请重新登录');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* 无 JSON 体 */ }
    if (!res.ok) {
      const err = new Error((data && data.error) || `请求失败 (${res.status})`);
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }
    return data;
  }

  const get = (path) => request(path);
  const post = (path, body) => request(path, { method: 'POST', body });
  const del = (path) => request(path, { method: 'DELETE' });

  // 下载：fetch → blob → 触发浏览器保存；统一走 Authorization 头
  async function download(fileId, filename) {
    const token = getToken();
    const res = await fetch('/api/files/download/' + fileId, {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (res.status === 401) { goLogin(); throw new Error('登录已过期'); }
    if (!res.ok) {
      let msg = '下载失败';
      try { msg = (await res.json()).error || msg; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  return { request, get, post, del, download, getToken, setToken, clearToken, setUser, getUser };
})();
