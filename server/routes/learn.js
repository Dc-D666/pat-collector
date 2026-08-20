'use strict';

const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const { query } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { verify } = require('../utils/token');
const readTimer = require('../utils/readTimer');
const { hasNftiExperience } = require('../utils/nfti');
const { getAppPostedStatus, getProjectSubmitted } = require('../utils/learnStatus');

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

// 章节列表：按章节+排序返回摘要（不含正文，列表页够用）
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await query(
      'SELECT id, slug, chapter, title, summary, updated_at FROM articles ORDER BY chapter ASC, sort_order ASC, id ASC'
    );
    // 每章完成人数：完成"整章积分已发放"（points_log reason='task' ref_id='article:<id>'）
    // 即完成该章全部任务；一章含多篇文章时，须该章所有文章都完成才算完成本章。
    const doneRows = await query(
      `SELECT g.chapter, COUNT(*) AS completed_users
       FROM (
         SELECT u.id AS uid, a.chapter, COUNT(DISTINCT a.id) AS done_articles
         FROM users u
         JOIN articles a ON EXISTS (
           SELECT 1 FROM points_log pl
           WHERE pl.user_id = u.id AND pl.reason = 'task'
             AND pl.ref_id = CONCAT('article:', a.id)
         )
         GROUP BY u.id, a.chapter
       ) g
       JOIN (
         SELECT chapter, COUNT(*) AS total_articles FROM articles GROUP BY chapter
       ) c ON c.chapter = g.chapter
       WHERE g.done_articles = c.total_articles
       GROUP BY g.chapter`
    );
    const doneMap = new Map(doneRows.map((r) => [Number(r.chapter), Number(r.completed_users)]));
    // 按章节分组，返回 [{ chapter, title, completed_count, articles: [...] }]
    const chapters = [];
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.chapter)) {
        const entry = { chapter: r.chapter, title: '', completed_count: doneMap.get(r.chapter) || 0, articles: [] };
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

// 学习进度：每章是否完成（以"整章积分已发放"为准）+ 总进度。宽松鉴权：游客返回空进度
router.get(
  '/progress',
  asyncHandler(async (req, res) => {
    let userId = 0;
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      const p = verify(token);
      if (p && p.uid) userId = p.uid;
    }
    if (!userId) {
      return res.json({ chapters: [], completed: 0, total: 0, logged_in: false });
    }
    const rows = await query(
      `SELECT a.id, a.chapter, a.title,
         EXISTS(SELECT 1 FROM points_log pl
                WHERE pl.user_id = ? AND pl.reason = 'task' AND pl.ref_id = CONCAT('article:', a.id)) AS done
       FROM articles a
       ORDER BY a.chapter ASC, a.sort_order ASC, a.id ASC`,
      [userId]
    );
    const chapters = rows.map((r) => ({
      id: r.id,
      chapter: r.chapter,
      title: r.title,
      done: Number(r.done) === 1,
    }));
    const completed = chapters.filter((c) => c.done).length;
    res.json({ chapters, completed, total: chapters.length, logged_in: true });
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

// 第2章任务检测：判定"是否已发表 AI 应用"（口径与任务完成核验共用 utils/learnStatus）。
// 优先看站内投稿：apps 表有带来源帖（source_feed_id）的记录即视为已发帖——
// 来源帖在自动/手动识别导入阶段已核验归属（verifyOwnFeed），提交接口也会再复核，
// 无需重复扫频道；也避免旧帖超出"最近 7 天 / 最近 24 条"扫描窗口被误判未发帖。
// 尚未导入的用户走 CLI 扫描兜底（近期发过帖也可自动完成）。
router.get(
  '/app-status',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getAppPostedStatus(req.user.id, req.user));
  })
);

// 第3章任务检测：用户最近 14 天是否上传过项目文件（无需 QQ 登录）
router.get(
  '/project-status',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getProjectSubmitted(req.user.id));
  })
);

// 第5章任务核验：提交的 tiny_id 是否与登录身份一致（QQ 登录用户在 bind 时已获取并存入 users.qq_tiny_id）
router.post(
  '/tinyid-check',
  requireAuth,
  asyncHandler(async (req, res) => {
    const submitted = String((req.body && req.body.tiny_id) || '').trim();
    if (!submitted) {
      return res.status(400).json({ error: '请先填写 Agent 查到的用户 ID' });
    }
    const mine = req.user.qq_tiny_id;
    if (!mine) {
      return res.status(400).json({ error: '需要 QQ 频道登录才能核验' });
    }
    const match = submitted === String(mine);
    res.json({ match });
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
    // 2026-08-21：选择题判分移到服务端——不再下发答案与解析（防客户端读取后刷题）。
    // 答案/解析仅在答对（/api/points/quiz）或已完成（/api/points/task-progress）时返回。
    tasks = tasks.map((t) => {
      if (t && t.type === 'quiz') {
        const { answer, explain, ...rest } = t;
        return rest;
      }
      return t;
    });
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
    // 记录阅读开始时间（供 /api/points/read 的 60s 服务端校验；需登录，L7 修复）
    const authHeader = req.headers.authorization || '';
    const tok = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (tok) {
      const p = verify(tok);
      if (p && p.uid) readTimer.markStart(p.uid, a.id);
    }
  })
);

module.exports = router;
