'use strict';

// GitHub 项目外链（2026-08-20）：Token 文件验证防冒充。
// 流程：提交仓库链接 → 平台生成 token → 用户在仓库根目录建 nanfang-pat.txt 写入 → 平台读取验证通过 → 发分。
// 仅支持公开 GitHub 仓库（raw.githubusercontent.com 可读）；验证通过才计分（link_submit +25，最多 5 个）。
// Fork 防护（2026-08-21）：Token 文件只能证明"能往该仓库 push"，而 Fork 的仓库人人可 push——
// 若不加限制，Fork 别人的项目再写入自己的 token 即可通过验证。故验证时调 GitHub API 查 fork 标志，Fork 仓库直接拒绝。

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { query, pool } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../utils/rateLimit');
const { grant, revokeInTx } = require('../utils/points');
const { auditDisplayText } = require('../utils/audit');

const router = express.Router();
const ipKey = (req) => req.ip || req.connection.remoteAddress || 'unknown';

// 解析 GitHub 仓库 URL → { owner, repo }；非法返回 null（仅 github.com/{owner}/{repo}）
function parseGitHubUrl(raw) {
  const m = String(raw || '').trim().match(
    /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})/
  );
  if (!m) return null;
  const repo = m[2].replace(/\.git\/?$/, '').replace(/\/+$/, '');
  // 拒绝含 '..' 的路径段（防 raw.githubusercontent.com 拉取 URL 被当作路径穿越；GitHub 本身也不允许）
  if (!repo || repo.includes('..') || m[1].includes('..')) return null;
  return { owner: m[1], repo };
}

// 读取仓库根目录 nanfang-pat.txt 内容并与预期 token 比对。
// 注意：本服务器在境内，raw.githubusercontent.com 不稳定（实测间歇超时），
// 故以 jsDelivr CDN（cdn.jsdelivr.net/gh/...@HEAD 解析默认分支，境内可达）为主源，raw 兜底。
// R2-11（2026-08-21）：按内容匹配决定是否继续尝试下一源——CDN 缓存旧内容时不直接返回，
// 只要与预期 token 不匹配就继续尝试 raw 源（否则 CDN 缓存会导致验证持续失败）。
async function fetchRepoToken(owner, repo, expected) {
  const sources = [
    'https://cdn.jsdelivr.net/gh/' + owner + '/' + repo + '@HEAD/nanfang-pat.txt',
    'https://raw.githubusercontent.com/' + owner + '/' + repo + '/HEAD/nanfang-pat.txt',
  ];
  for (const url of sources) {
    const txt = await fetchText(url);
    if (txt == null) continue; // 404/网络失败：尝试下一源
    if (txt === expected) return txt; // 内容匹配 → 验证通过
    // 内容存在但不匹配（如 CDN 缓存旧 token）：继续尝试下一源
  }
  return null;
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'PatPlayer/1.0' } });
    if (!res.ok) return null; // 404 = 文件/仓库不存在或私有
    if (!res.body) return (await res.text()).trim();
    // 限制响应体大小（防仓库里放超大 nanfang-pat.txt 造成内存尖峰；验证文件应 <1KB）
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    const MAX = 64 * 1024;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8').trim();
  } catch (_) {
    return null; // 网络失败按未验证处理（可重试）
  } finally {
    clearTimeout(timer);
  }
}

// ---- Fork 检测：GitHub API /repos/{owner}/{repo} 的 fork 标志 ----
// 注意：仅在 token 匹配后调用（API 调用次数 ≈ 成功验证次数），并带 10 分钟内存缓存，
// 避免未认证配额（60 次/时/IP）被反复点验证耗尽；配置 GITHUB_TOKEN 可提升到 5000 次/时。
const repoMetaCache = new Map(); // key: owner/repo → { ts, meta }
const REPO_META_TTL = 10 * 60 * 1000;
async function getRepoMeta(owner, repo) {
  const key = owner + '/' + repo;
  const hit = repoMetaCache.get(key);
  if (hit && Date.now() - hit.ts < REPO_META_TTL) return hit.meta;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  let meta = null;
  try {
    const headers = { 'User-Agent': 'PatPlayer/1.0', Accept: 'application/vnd.github+json' };
    if (config.github.token) headers.Authorization = 'token ' + config.github.token;
    const res = await fetch(
      'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo),
      { signal: ctrl.signal, headers }
    );
    if (res.ok) {
      const data = await res.json();
      meta = {
        fork: !!data.fork,
        parent: data.parent ? data.parent.full_name : '',
      };
    }
    // 仅缓存成功结果（API 故障不缓存，下次验证可重试）
    if (meta) repoMetaCache.set(key, { ts: Date.now(), meta });
  } catch (_) { /* API 不可达 → meta=null，调用方按放行处理 */ }
  finally {
    clearTimeout(timer);
  }
  return meta;
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

// 验证：读取仓库 nanfang-pat.txt 比对 token → 通过则标记 verified 并发放提交积分
router.post(
  '/:id/verify',
  requireAuth,
  rateLimit({ windowMs: 60 * 1000, max: 10, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const [row] = await query('SELECT * FROM links WHERE id = ? AND user_id = ?', [id, req.user.id]);
    if (!row) return res.status(404).json({ error: '链接不存在' });
    if (!row.verified) {
      const token = await fetchRepoToken(row.owner, row.repo, row.verify_token);
      if (!token || token !== row.verify_token) {
        return res.status(400).json({
          error: '未找到匹配的验证文件。请在仓库根目录新建 nanfang-pat.txt，内容写入：' + row.verify_token
            + '（push 到默认分支；私有仓库无法验证，请将仓库设为公开）。若刚提交，请等 1 分钟再试（CDN 缓存延迟）',
        });
      }
      // Token 匹配（所有权 = 能 push）通过后，再查是否为 Fork：
      // Fork 的仓库任何登录用户都能 push 自己的 token，不能证明项目是本人原创，直接拒绝。
      const meta = await getRepoMeta(row.owner, row.repo);
      if (!meta) {
        // R2-12（2026-08-21）：GitHub API 超时/限流/异常时无法确认仓库状态 → 暂缓验证（fail-closed），
        // 避免 Fork 仓库在 API 故障或额度耗尽期间绕过"禁止 Fork"约束
        return res.status(503).json({ error: '暂时无法确认仓库状态（GitHub API 不可达或繁忙），请稍后重试' });
      }
      if (meta.fork) {
        const parent = meta.parent ? '（原仓库：' + meta.parent + '）' : '';
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
