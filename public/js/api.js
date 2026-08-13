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
    const hadToken = !!token;
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (opts.body && !(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    // 请求超时（15s）：网络挂起时给出明确错误，避免界面无限等待（如我的积分页 spinner 一直转）
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let res;
    try {
      res = await fetch(path, { ...opts, headers, signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') throw new Error('请求超时，请检查网络后重试');
      throw new Error('网络错误，请稍后重试');
    }
    clearTimeout(timer);
    // 只有携带了 Bearer token 的请求收到 401 才视为「登录过期」；扫码登录流程（无 token）的 401 是业务态错误，原样抛出
    if (res.status === 401 && hadToken) {
      goLogin();
      throw new Error('登录已过期，请重新登录');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* 无 JSON 体（如 nginx 拦截返回的 HTML 413） */ }
    if (!res.ok) {
      // 413：nginx 或 multer 层拦截的超限错误，若响应体非 JSON（HTML）则给固定文案
      let msg = (data && data.error);
      if (!msg && res.status === 413) msg = '文件过大，超出上传大小上限；如确需上传大文件/文件夹，请联系频道主或 QQ：3303188265';
      if (!msg) msg = `请求失败 (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      err.code = data && data.code;
      throw err;
    }
    return data;
  }

  const get = (path) => request(path);
  const post = (path, body) => request(path, { method: 'POST', body });
  const patch = (path, body) => request(path, { method: 'PATCH', body });
  const del = (path) => request(path, { method: 'DELETE' });

  // 下载：fetch → blob → 触发浏览器保存；统一走 Authorization 头
  async function download(fileId, filename) {
    const token = getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let res;
    try {
      res = await fetch('/api/files/download/' + fileId, {
        headers: { Authorization: 'Bearer ' + token },
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === 'AbortError') throw new Error('下载超时，请重试');
      throw new Error('网络错误，请稍后重试');
    }
    clearTimeout(timer);
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

  return { request, get, post, patch, del, download, getToken, setToken, clearToken, setUser, getUser };
})();
