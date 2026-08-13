'use strict';

const express = require('express');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const config = require('../config');
const { query } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// 跨站体验（NFTI）：签发一次性 ticket / 判定已体验
// ticket = base64url(payload).hmacHex，payload = { tiny_id, nickname, pat_sid, exp }
function signPatTicket(user, patSid) {
  const payload = {
    tiny_id: String(user.qq_tiny_id || ''),
    nickname: String(user.nickname || user.real_name || '同学').slice(0, 128),
    pat_sid: String(patSid),
    exp: Date.now() + 5 * 60 * 1000, // 5 分钟有效
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', config.patTicketSecret).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

// 判定用户在 NFTI 是否已完成过人格测试（只读 nfti 库）
async function hasNftiExperience(tinyId) {
  if (!config.nftiDb.password || !tinyId) return false;
  const conn = await mysql.createConnection(config.nftiDb);
  try {
    const [rows] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM test_results WHERE tiny_id = ? AND assessment_type = 'nfti'",
      [String(tinyId)]
    );
    return rows.length > 0 && Number(rows[0].cnt) > 0;
  } finally {
    await conn.end();
  }
}

// 章节列表：按章节+排序返回摘要（不含正文，列表页够用）
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await query(
      'SELECT id, slug, chapter, title, summary, updated_at FROM articles ORDER BY chapter ASC, sort_order ASC, id ASC'
    );
    // 按章节分组，返回 [{ chapter, title, articles: [...] }]
    const chapters = [];
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.chapter)) {
        const entry = { chapter: r.chapter, title: '', articles: [] };
        map.set(r.chapter, entry);
        chapters.push(entry);
      }
      map.get(r.chapter).articles.push({
        id: r.id,
        slug: r.slug,
        title: r.title,
        summary: r.summary,
        updated_at: r.updated_at,
      });
    }
    res.json({ chapters });
  })
);

// 签发 NFTI 体验 ticket（需 QQ 频道登录；返回跳转 URL）
router.get(
  '/nfti-ticket',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user.qq_tiny_id) {
      return res.status(400).json({ error: '需要 QQ 频道登录才能体验，请先扫码登录' });
    }
    if (!config.patTicketSecret) {
      return res.status(500).json({ error: '服务未配置体验密钥' });
    }
    // 复用当前用户绑定的 QQ 会话目录（cliHome 用）
    const rows = await query('SELECT qq_session_id FROM users WHERE id = ?', [req.user.id]);
    const patSid = rows.length && rows[0].qq_session_id ? rows[0].qq_session_id : '';
    if (!patSid) {
      return res.status(400).json({ error: '未检测到 QQ 登录会话，请重新扫码登录' });
    }
    const ticket = signPatTicket(req.user, patSid);
    res.json({
      url: 'https://nfti.weaxi.cn/?pat_ticket=' + encodeURIComponent(ticket),
      exp: Date.now() + 5 * 60 * 1000,
    });
  })
);

// 体验状态：用户在 NFTI 是否已完成人格测试（需 QQ 登录）
router.get(
  '/nfti-status',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!req.user.qq_tiny_id) {
      return res.json({ experienced: false, need_login: true });
    }
    const experienced = await hasNftiExperience(req.user.qq_tiny_id);
    res.json({ experienced });
  })
);

// 文章详情
router.get(
  '/:slug',
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT * FROM articles WHERE slug = ?', [req.params.slug]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '文章不存在' });
    }
    const a = rows[0];
    // mysql2 对 JSON 列自动解析为对象/数组；字符串兜底（旧数据可能是 TEXT）
    let tasks = [];
    const raw = a.tasks;
    if (raw) {
      try { tasks = typeof raw === 'string' ? JSON.parse(raw) : raw; }
      catch (_) { tasks = []; }
    }
    res.json({
      article: {
        id: a.id,
        slug: a.slug,
        chapter: a.chapter,
        title: a.title,
        summary: a.summary,
        content: a.content,
        tasks,
        updated_at: a.updated_at,
      },
    });
  })
);

module.exports = router;
