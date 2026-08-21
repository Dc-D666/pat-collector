'use strict';

// GitHub OAuth 连接（2026-08-21）：「我的项目 → GitHub 项目」所有权验证改造——
// 学生用 GitHub 账号授权后，平台以用户级 access_token 调 GitHub API 直接验证仓库归属，
// 取代旧的「仓库根目录放 nanfang-pat.txt 文件」校验（无需建文件、可支持私有仓库、API 配额 5000 次/时）。
// token 只存服务端（AES-256-GCM 加密落库），不下发前端。

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { query } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../utils/rateLimit');

const router = express.Router();
const ipKey = (req) => req.ip || req.connection.remoteAddress || 'unknown';

// ---- access_token 加密存储（AES-256-GCM；密钥由 TOKEN_SECRET 派生，不落明文）----
const ENC_KEY = crypto
  .createHash('sha256')
  .update(String(config.tokenSecret || '') + ':github-oauth')
  .digest();

function encryptToken(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptToken(pack) {
  const buf = Buffer.from(String(pack), 'base64');
  if (buf.length < 28) return '';
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const data = buf.slice(28);
  const d = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

// 读取当前用户的 GitHub 连接信息（含解密后的 token）；未连接返回 null
async function getGithubConnection(userId) {
  const rows = await query(
    'SELECT github_uid, github_login, github_token_enc FROM users WHERE id = ?',
    [userId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  if (!r.github_uid || !r.github_token_enc) return null;
  let token = '';
  try { token = decryptToken(r.github_token_enc); } catch (_) { token = ''; }
  if (!token) return null;
  return { uid: String(r.github_uid), login: String(r.github_login || ''), token };
}

// ---- OAuth state（进程内、10 分钟有效；防 CSRF 并绑定发起用户）----
const oauthStates = new Map(); // state → { user_id, exp }
const STATE_TTL = 10 * 60 * 1000;

// 1. 发起授权：生成 state，返回 GitHub 授权 URL（前端弹窗打开）
router.get(
  '/oauth/start',
  requireAuth,
  rateLimit({ windowMs: 60 * 1000, max: 10, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const { clientId, callbackUrl, scope } = config.github.oauth;
    if (!clientId || !config.github.oauth.clientSecret || !callbackUrl) {
      return res.status(503).json({ error: '服务未配置 GitHub OAuth（GITHUB_OAUTH_*），请联系频道主' });
    }
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, { user_id: req.user.id, exp: Date.now() + STATE_TTL });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: callbackUrl,
      scope,
      state,
    });
    res.json({ url: 'https://github.com/login/oauth/authorize?' + params.toString() });
  })
);

// 2. 回调：GitHub 302 回这里 → code 换 token → 绑定身份 → 弹窗页 postMessage 通知前端
router.get(
  '/oauth/callback',
  rateLimit({ windowMs: 60 * 1000, max: 30, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const state = String((req.query && req.query.state) || '');
    const code = String((req.query && req.query.code) || '');
    const denied = String((req.query && req.query.error) || '');
    const st = oauthStates.get(state);
    oauthStates.delete(state); // 一次性消费
    if (denied || !st || Date.now() > st.exp || !code) {
      return sendPopupResult(res, false, denied ? '已取消授权' : '授权链接已过期或无效，请重试');
    }
    const { clientId, callbackUrl } = config.github.oauth;
    if (!clientId || !config.github.oauth.clientSecret || !callbackUrl) {
      return sendPopupResult(res, false, '服务未配置 GitHub OAuth，请联系频道主');
    }
    // 换 access_token
    let tokenRes;
    try {
      tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'PatPlayer/1.0',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: config.github.oauth.clientSecret,
          code,
          redirect_uri: callbackUrl,
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch (_) {
      return sendPopupResult(res, false, '无法连接 GitHub（网络超时），请重试');
    }
    const tok = await tokenRes.json().catch(() => ({}));
    if (!tok.access_token) {
      return sendPopupResult(res, false, 'GitHub 授权失败：' + (tok.error_description || tok.error || '未知错误'));
    }
    // 取身份
    let me = null;
    try {
      const userRes = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: 'Bearer ' + tok.access_token,
          'User-Agent': 'PatPlayer/1.0',
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (userRes.ok) me = await userRes.json();
    } catch (_) { /* 下方统一处理 */ }
    if (!me || !me.id || !me.login) {
      return sendPopupResult(res, false, '获取 GitHub 身份失败，请重试');
    }
    await query(
      'UPDATE users SET github_uid = ?, github_login = ?, github_token_enc = ? WHERE id = ?',
      [String(me.id), String(me.login).slice(0, 64), encryptToken(tok.access_token), st.user_id]
    );
    sendPopupResult(res, true, '已连接 GitHub：' + me.login);
  })
);

// 结果页（2026-08-22）：统一重定向到 /gh-oauth-result.html，由页面按环境分派——
// 弹窗（window.opener 存在）→ postMessage 通知主页面后自动关闭；
// 整页（手机 QQ/微信内置浏览器，无弹窗）→ 展示结果并自动跳回 /#/files。
function sendPopupResult(res, ok, message) {
  res.redirect('/gh-oauth-result.html?ok=' + (ok ? '1' : '0') + '&msg=' + encodeURIComponent(message));
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// 3. 连接状态（前端进入 GitHub 页签时调用）
router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT github_uid, github_login FROM users WHERE id = ?', [req.user.id]);
    const r = rows[0] || {};
    if (r.github_uid) {
      res.json({ connected: true, login: r.github_login || '' });
    } else {
      res.json({ connected: false });
    }
  })
);

// 4. 断开连接（清除 GitHub 身份与 token）
router.post(
  '/disconnect',
  requireAuth,
  rateLimit({ windowMs: 60 * 1000, max: 10, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    await query(
      'UPDATE users SET github_uid = NULL, github_login = NULL, github_token_enc = NULL WHERE id = ?',
      [req.user.id]
    );
    res.json({ ok: true });
  })
);

// 5. 拉取已连接用户的仓库列表（2026-08-21：提交页「从我的仓库选择」下拉用）。
// 只返回本人创建的非 Fork 仓库（Fork 无法通过所有权验证，不展示）；分页拉取，每页 100、最多 3 页。
router.get(
  '/repos',
  requireAuth,
  rateLimit({ windowMs: 60 * 1000, max: 10, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const conn = await getGithubConnection(req.user.id);
    if (!conn) {
      return res.status(400).json({ error: '请先连接 GitHub 账号（「用 GitHub 授权」）' });
    }
    const repos = [];
    let scopeLimited = false; // 当前 token 授权范围看不到私有仓库（需重新授权 repo scope）
    try {
      for (let page = 1; page <= 3; page++) {
        const r = await fetch(
          'https://api.github.com/user/repos?per_page=100&page=' + page
            + '&affiliation=owner&sort=updated',
          {
            headers: {
              Authorization: 'Bearer ' + conn.token,
              'User-Agent': 'PatPlayer/1.0',
              Accept: 'application/vnd.github+json',
            },
            signal: AbortSignal.timeout(10000),
          }
        );
        if (r.status === 401 || r.status === 403) {
          return res.status(400).json({ error: 'GitHub 授权已失效，请断开后重新连接' });
        }
        if (!r.ok) {
          return res.status(503).json({ error: 'GitHub API 暂时不可用（' + r.status + '），请稍后重试' });
        }
        // 首次响应读 X-OAuth-Scopes：没有 repo 权限时私有仓库不会出现在列表里，提示重新授权
        if (page === 1) {
          const scopes = String(r.headers.get('x-oauth-scopes') || '');
          scopeLimited = scopes !== '' && !/\brepo\b/.test(scopes);
        }
        const arr = await r.json();
        if (!Array.isArray(arr) || arr.length === 0) break;
        repos.push(...arr);
        if (arr.length < 100) break;
      }
    } catch (_) {
      return res.status(503).json({ error: '无法连接 GitHub API（网络超时），请稍后重试' });
    }
    // 只保留本人创建的非 Fork 仓库（owner.id 与授权身份一致 + fork=false）；
    // 私有仓库一并返回，由前端置灰展示（仅公开可选）
    const mine = repos
      .filter((x) => x && !x.fork && x.owner && String(x.owner.id) === conn.uid)
      .map((x) => ({
        owner: x.owner.login,
        full_name: x.full_name,
        name: x.name,
        description: x.description || '',
        private: !!x.private,
        html_url: x.html_url,
      }));
    res.json({ repos: mine, total: mine.length, scope_limited: scopeLimited });
  })
);

// ---- 自动生成项目名称/简介（README → 智谱 GLM 免费模型）----
const GLM_SYSTEM_PROMPT = `你是校园作品展示平台的文案助手。根据用户提供的 GitHub 项目 README 内容，生成：
1. 项目名称（title）：简短、吸引人、贴合项目内容的中文名称，不超过 12 个字；
2. 项目简介（description）：80~120 字的中文简介，说明这个项目是什么、解决什么问题或怎么玩，面向零基础同学，语气轻松自然。

只输出 JSON 对象：{"title": "...", "description": "..."}，不要输出其它任何内容。`;

// 拉取仓库元数据（带用户 token）；返回 { status, data }
async function fetchRepoApi(owner, repo, token) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo),
      {
        signal: ctrl.signal,
        headers: {
          Authorization: 'Bearer ' + token,
          'User-Agent': 'PatPlayer/1.0',
          Accept: 'application/vnd.github+json',
        },
      }
    );
    return { status: res.status, data: res.ok ? await res.json() : null };
  } catch (_) {
    return { status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

// 拉取 README 原文（raw 响应，最多 8000 字符）；无 README 返回 null
async function fetchReadmeRaw(owner, repo, token) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/readme',
      {
        signal: ctrl.signal,
        headers: {
          Authorization: 'Bearer ' + token,
          'User-Agent': 'PatPlayer/1.0',
          Accept: 'application/vnd.github.raw+json',
        },
      }
    );
    if (!res.ok) return null;
    return (await res.text()).slice(0, 8000);
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 调智谱 GLM 生成 { title, description }；失败抛错由调用方降级。
// 优先配置模型（默认 glm-4.7-flash）；繁忙/限流（429）或异常时自动回退 fallbackModel（glm-4-flash）重试一次。
async function glmDescribe(readmeText) {
  const cfg = config.glm;
  const content = String(readmeText || '').slice(0, 6000);
  const models = [cfg.model, cfg.fallbackModel || 'glm-4-flash']
    .filter((m, i, a) => m && a.indexOf(m) === i); // 去重保序
  let lastErr = null;
  for (const model of models) {
    try {
      return await callGlm(model, content, cfg);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('GLM 调用失败');
}

async function callGlm(model, content, cfg) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: GLM_SYSTEM_PROMPT },
          { role: 'user', content: '以下是项目 README 内容：\n\n' + content },
        ],
        temperature: 0.7,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('GLM ' + model + ' HTTP ' + res.status + ' ' + body.slice(0, 200));
    }
    const data = await res.json();
    const out = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const m = String(out || '').match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : null;
    return {
      title: parsed && parsed.title ? String(parsed.title).trim().slice(0, 255) : '',
      description: parsed && parsed.description ? String(parsed.description).trim().slice(0, 2000) : '',
    };
  } finally {
    clearTimeout(timer);
  }
}

// 6. 生成项目名称与简介：先校验仓库归属 → 拉 README → GLM 生成。
// 未配置 GLM_API_KEY / 无 README 时降级用仓库名与描述（generated:false），不阻断。
router.post(
  '/describe',
  requireAuth,
  rateLimit({ windowMs: 60 * 1000, max: 15, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const owner = String((req.body && req.body.owner) || '').trim();
    const repo = String((req.body && req.body.repo) || '').trim();
    if (!owner || !repo) return res.status(400).json({ error: '缺少仓库信息' });
    const conn = await getGithubConnection(req.user.id);
    if (!conn) return res.status(400).json({ error: '请先连接 GitHub 账号' });

    // 1. 校验仓库归属（防把本接口当"任意 README + GLM"代理刷额度）
    const metaRes = await fetchRepoApi(owner, repo, conn.token);
    if (metaRes.status === 401 || metaRes.status === 403) {
      return res.status(400).json({ error: 'GitHub 授权已失效，请断开后重新连接' });
    }
    if (metaRes.status === 404) return res.status(400).json({ error: '仓库不存在或无权访问' });
    if (metaRes.status !== 200) return res.status(503).json({ error: 'GitHub API 暂时不可用，请稍后重试' });
    if (String(metaRes.data.owner && metaRes.data.owner.id) !== conn.uid) {
      return res.status(400).json({ error: '该仓库不属于你授权的 GitHub 账号' });
    }
    const repoName = String(metaRes.data.name || repo).slice(0, 255);
    const repoDesc = String(metaRes.data.description || '').slice(0, 2000);

    // 2. 拉 README
    const readme = await fetchReadmeRaw(owner, repo, conn.token);
    const sourceText = readme || repoDesc || '';

    // 3. 生成
    if (!config.glm.apiKey) {
      return res.json({
        title: repoName,
        description: repoDesc,
        generated: false,
        note: '未配置 GLM_API_KEY，已用仓库信息填充，可手动修改',
      });
    }
    if (!sourceText.trim()) {
      return res.json({
        title: repoName,
        description: '',
        generated: false,
        note: '仓库没有 README 或描述，无法自动生成简介',
      });
    }
    let out;
    try {
      out = await glmDescribe(sourceText);
    } catch (err) {
      return res.status(502).json({ error: 'AI 生成失败：' + (err.message || '请重试') });
    }
    res.json({
      title: out.title || repoName,
      description: out.description || '',
      generated: !!(out.title || out.description),
    });
  })
);

module.exports = router;
module.exports.getGithubConnection = getGithubConnection;
module.exports.encryptToken = encryptToken;
module.exports.decryptToken = decryptToken;
