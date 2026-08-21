'use strict';

// GitHub 项目外链（2026-08-20 起，2026-08-21 改为 OAuth 所有权验证）：
// 流程：提交仓库链接 → 用户 GitHub OAuth 授权（一次性连接）→ 验证 → 发分。
// 验证（2026-08-21 取代「仓库根目录 nanfang-pat.txt 文件」校验）：
//   用用户授权的 access_token 调 GitHub API GET /repos/{owner}/{repo}——
//   repo 可读（200）+ owner 是授权账号本人 + 非 Fork → 通过；无需在仓库放任何文件。
//   仅支持本人创建的项目仓库（Fork 的仓库人人可 push，不能证明原创，直接拒绝）。
// 连接管理见 routes/github-oauth.js（/api/github/*）。

const express = require('express');
const crypto = require('crypto');
const { query, pool } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../utils/rateLimit');
const { grant, revokeInTx } = require('../utils/points');
const { auditDisplayText } = require('../utils/audit');
const { getGithubConnection } = require('./github-oauth');

const router = express.Router();
const ipKey = (req) => req.ip || req.connection.remoteAddress || 'unknown';

// 解析 GitHub 仓库 URL → { owner, repo }；非法返回 null（仅 github.com/{owner}/{repo}）
function parseGitHubUrl(raw) {
  const m = String(raw || '').trim().match(
    /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})/
  );
  if (!m) return null;
  const repo = m[2].replace(/\.git\/?$/, '').replace(/\/+$/, '');
  // 拒绝含 '..' 的路径段（GitHub 本身不允许，双重保险）
  if (!repo || repo.includes('..') || m[1].includes('..')) return null;
  return { owner: m[1], repo };
}

// 用 GitHub 用户 token 验证仓库归属。返回 { ok, status?, error?, fork?, parent? }
// 鉴权：token 请求 GET /repos 对公开仓库任何人可读，故必须校验 owner 是授权账号本人。
async function verifyRepoWithToken(owner, repo, conn) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo),
      {
        signal: ctrl.signal,
        headers: {
          'User-Agent': 'PatPlayer/1.0',
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + conn.token,
        },
      }
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: 400, error: 'GitHub 授权已失效，请断开后重新连接' };
    }
    if (res.status === 404) {
      return { ok: false, status: 400, error: '仓库不存在或无权访问。请确认链接正确（私有仓库需在连接时授权 repo 权限）' };
    }
    if (!res.ok) {
      return { ok: false, status: 503, error: 'GitHub API 暂时不可用（' + res.status + '），请稍后重试' };
    }
    const data = await res.json();
    const ownerId = String((data.owner && data.owner.id) || '');
    const ownerLogin = String((data.owner && data.owner.login) || '').toLowerCase();
    const myUid = String(conn.uid || '');
    const myLogin = String(conn.login || '').toLowerCase();
    // 优先按稳定的 owner.id 比对；个别场景拿不到 id 时退回 login 比对（忽略大小写）
    const mine = ownerId ? ownerId === myUid : ownerLogin === myLogin;
    if (!mine) {
      return {
        ok: false,
        status: 400,
        error: '该仓库不属于你授权的 GitHub 账号（' + (conn.login || '')
          + '）。请确认提交的是你自己创建的项目仓库；如需切换账号，先断开 GitHub 再重新授权',
      };
    }
    return { ok: true, fork: !!data.fork, parent: data.parent ? data.parent.full_name : '' };
  } catch (_) {
    return { ok: false, status: 503, error: '无法连接 GitHub API（网络超时），请稍后重试' };
  } finally {
    clearTimeout(timer);
  }
}

// 提交 GitHub 仓库链接：解析 owner/repo + 生成 token → 待验证
router.post(
  '/',
  requireAuth,
  rateLimit({ windowMs: 60 * 1000, max: 20, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const url = String((req.body && req.body.url) || '').trim();
    const title = String((req.body && req.body.title) || '').trim().slice(0, 255);
    const description = String((req.body && req.body.description) || '').trim().slice(0, 2000) || null;
    const parsed = parseGitHubUrl(url);
    if (!parsed) {
      return res.status(400).json({ error: '仅支持 GitHub 仓库链接，如 https://github.com/用户名/仓库名' });
    }
    if (!title) return res.status(400).json({ error: '请输入项目名称' });

    // R2 展示文本审查（与轻应用一致）
    const displayText = [title, description].filter(Boolean).join('\n');
    const d = await auditDisplayText(displayText, { userId: req.user.id, refType: 'link', refId: 0 });
    if (!d.ok) {
      return res.status(400).json({ error: '项目信息不合规（' + (d.reason || '请修改后重试') + '）' });
    }

    const verifyToken = 'PAT-' + crypto.randomBytes(12).toString('hex');
    // 规范化存储（去重按规范化后的 url，避免 /foo/bar 与 /foo/bar/ 被当作两条）
    const canonicalUrl = 'https://github.com/' + parsed.owner + '/' + parsed.repo;
    const conn = await pool.getConnection();
    let result;
    try {
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
      // 去重：同一用户同一 url 只允许一条（含待验证）
      const [dup] = await conn.execute('SELECT id FROM links WHERE user_id = ? AND url = ? LIMIT 1', [req.user.id, canonicalUrl]);
      if (dup.length) {
        await conn.rollback();
        conn.release();
        return res.status(400).json({ error: '该项目链接已提交过了' });
      }
      const ins = await conn.execute(
        'INSERT INTO links (user_id, url, title, description, owner, repo, verify_token) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [req.user.id, canonicalUrl, title, description, parsed.owner, parsed.repo, verifyToken]
      );
      result = { insertId: ins[0].insertId };
      await conn.commit();
    } catch (err) {
      try { await conn.rollback(); } catch (_) { /* ignore */ }
      conn.release();
      throw err;
    }
    conn.release();
    const [row] = await query(
      'SELECT id, url, title, description, owner, repo, verify_token, verified, verified_at, created_at FROM links WHERE id = ?',
      [result.insertId]
    );
    res.json({ link: row });
  })
);

// 验证：GitHub OAuth 授权后一键验证仓库归属 → 通过则标记 verified 并发放提交积分
router.post(
  '/:id/verify',
  requireAuth,
  rateLimit({ windowMs: 60 * 1000, max: 10, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [row] = await query('SELECT * FROM links WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!row) return res.status(404).json({ error: '链接不存在' });
    if (!row.verified) {
      // 1. 需已连接 GitHub（OAuth；token 仅存服务端）
      const conn = await getGithubConnection(req.user.id);
      if (!conn) {
        return res.status(400).json({
          error: '请先连接 GitHub 账号：到「我的项目」→「GitHub 项目」点「用 GitHub 授权」，连接后即可一键验证',
        });
      }
      // 2. 带用户 token 调 GitHub API 验证归属（含 Fork 检测）
      const r = await verifyRepoWithToken(row.owner, row.repo, conn);
      if (!r.ok) return res.status(r.status || 400).json({ error: r.error });
      if (r.fork) {
        const parent = r.parent ? '（原仓库：' + r.parent + '）' : '';
        return res.status(400).json({
          error: '检测到该仓库是 Fork 的副本' + parent + '，无法通过验证。'
            + '请提交你自己创建的项目仓库：在 GitHub 新建仓库（不要点 Fork）后上传你自己的项目代码。',
        });
      }
      await query('UPDATE links SET verified = 1, verified_at = NOW() WHERE id = ?', [id]);
    }
    // 发分（幂等：link_submit +25，最多 5 个；已认证也走 grant 补发——
    // 防"验证成功但发分途中出错"导致积分永久漏发；grant 按 ref 幂等不会重复发）
    const granted = await grant(req.user.id, 'link_submit', 'link:' + id);
    const [updated] = await query(
      'SELECT id, url, title, description, owner, repo, verify_token, verified, verified_at, created_at FROM links WHERE id = ?',
      [id]
    );
    res.json({
      link: updated,
      points: granted,
      message: granted ? '✓ 认证通过，+25⭐ 已发放' : '该项目已认证（已达计分上限或已发放过）',
    });
  })
);

// 我的 GitHub 项目列表
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(
      'SELECT id, url, title, description, owner, repo, verify_token, verified, verified_at, created_at FROM links WHERE user_id = ? ORDER BY created_at DESC, id DESC',
      [req.user.id]
    );
    res.json({ links: rows });
  })
);

// 删除（回扣提交积分）——R3-3：删除与回扣同一事务
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const linkId = Number(req.params.id);
    const conn = await pool.getConnection();
    let revoked = null;
    try {
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
      const [rows] = await conn.execute(
        'SELECT id FROM links WHERE id = ? AND user_id = ? FOR UPDATE',
        [linkId, req.user.id]
      );
      if (rows.length === 0) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: '链接不存在' });
      }
      revoked = await revokeInTx(conn, req.user.id, 'link_submit', 'link:' + linkId);
      await conn.execute('DELETE FROM links WHERE id = ?', [linkId]);
      await conn.commit();
    } catch (err) {
      try { await conn.rollback(); } catch (_) { /* ignore */ }
      conn.release();
      throw err;
    }
    conn.release();
    res.json({ ok: true, points_revoked: revoked });
  })
);

module.exports = router;
