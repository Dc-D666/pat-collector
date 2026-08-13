'use strict';

const express = require('express');
const { query } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { grant, getPoints } = require('../utils/points');

const router = express.Router();

// 我的积分与流水
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getPoints(req.user.id));
  })
);

// 积分排行榜：按积分降序 top 20（展示名遵循展示名授权）
router.get(
  '/leaderboard',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT id, class_name, real_name, show_real_name, nickname, points
       FROM users WHERE points > 0
       ORDER BY points DESC, id ASC
       LIMIT 20`
    );
    const list = rows.map((u) => ({
      user_id: u.id,
      class_name: u.class_name,
      grade: require('../config').gradeOf(u.class_name),
      display_name: u.show_real_name !== 0 ? u.real_name : (u.nickname || u.real_name),
      points: u.points,
    }));
    // 我的排名（0 分未上榜 → null，前端显示 -）
    let myRank = null;
    if ((req.user.points || 0) > 0) {
      const rankRows = await query(
        'SELECT COUNT(*) + 1 AS rank FROM users WHERE points > ?',
        [req.user.points || 0]
      );
      myRank = rankRows.length ? Number(rankRows[0].rank) : null;
    }
    res.json({
      list,
      me: {
        user_id: req.user.id,
        display_name: req.user.show_real_name !== 0 ? req.user.real_name : (req.user.nickname || req.user.real_name),
        points: req.user.points || 0,
        rank: myRank,
      },
    });
  })
);

// 阅读完成上报（前端计时 ≥60s 后调用）；每篇文章只发一次
router.post(
  '/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    const articleId = parseInt(req.body && req.body.article_id, 10);
    if (!articleId) return res.status(400).json({ error: '缺少文章ID' });
    const rows = await query('SELECT id FROM articles WHERE id = ?', [articleId]);
    if (rows.length === 0) return res.status(404).json({ error: '文章不存在' });
    const granted = await grant(req.user.id, 'read_article', 'article:' + articleId);
    const points = await getPoints(req.user.id);
    res.json({ granted, points: points.points });
  })
);

// 任务完成上报：记录单个任务完成；一章内所有任务都完成时才发整章积分（20 ⭐）
router.post(
  '/task',
  requireAuth,
  asyncHandler(async (req, res) => {
    const articleId = parseInt(req.body && req.body.article_id, 10);
    const taskIndex = parseInt(req.body && req.body.task_index, 10);
    if (!articleId || isNaN(taskIndex)) {
      return res.status(400).json({ error: '缺少文章ID或任务序号' });
    }
    const rows = await query('SELECT id, tasks FROM articles WHERE id = ?', [articleId]);
    if (rows.length === 0) return res.status(404).json({ error: '文章不存在' });
    const tasks = rows[0].tasks;
    let list = [];
    try { list = typeof tasks === 'string' ? JSON.parse(tasks) : tasks; } catch (_) { list = []; }
    if (!list[taskIndex]) return res.status(400).json({ error: '任务不存在' });

    // 1. 记录该任务完成（幂等：已记录则跳过）
    await query(
      'INSERT IGNORE INTO task_progress (user_id, article_id, task_index) VALUES (?, ?, ?)',
      [req.user.id, articleId, taskIndex]
    );

    // 2. 查该章已完成任务数 vs 总任务数
    const [done] = await query(
      'SELECT COUNT(*) AS cnt FROM task_progress WHERE user_id = ? AND article_id = ?',
      [req.user.id, articleId]
    );
    const total = list.length;
    const doneCount = Number(done.cnt);

    // 3. 全部完成 → 发整章积分（ref_id 用 article 维度，整章只发一次）
    const granted = doneCount >= total
      ? await grant(req.user.id, 'task', 'article:' + articleId)
      : null;

    const points = await getPoints(req.user.id);
    res.json({
      granted,
      done_count: doneCount,
      total,
      chapter_done: doneCount >= total,
      points: points.points,
    });
  })
);

// 章节任务进度（前端加载文章时回填完成状态）
router.get(
  '/task-progress',
  requireAuth,
  asyncHandler(async (req, res) => {
    const articleId = parseInt(req.query && req.query.article_id, 10);
    if (!articleId) return res.status(400).json({ error: '缺少文章ID' });
    const rows = await query('SELECT id, tasks FROM articles WHERE id = ?', [articleId]);
    if (rows.length === 0) return res.status(404).json({ error: '文章不存在' });
    const tasks = rows[0].tasks;
    let list = [];
    try { list = typeof tasks === 'string' ? JSON.parse(tasks) : tasks; } catch (_) { list = []; }
    const done = await query(
      'SELECT task_index FROM task_progress WHERE user_id = ? AND article_id = ?',
      [req.user.id, articleId]
    );
    const doneSet = new Set(done.map((d) => Number(d.task_index)));
    const progress = list.map((t, i) => ({ task_index: i, done: doneSet.has(i) }));
    // 是否已发整章积分（用于前端展示"已完成"）
    const points = await query(
      "SELECT 1 FROM points_log WHERE user_id = ? AND reason = 'task' AND ref_id = ?",
      [req.user.id, 'article:' + articleId]
    );
    res.json({
      progress,
      done_count: doneSet.size,
      total: list.length,
      chapter_done: doneSet.size >= list.length,
      chapter_rewarded: points.length > 0,
    });
  })
);

module.exports = router;
