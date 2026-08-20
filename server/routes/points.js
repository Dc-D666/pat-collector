'use strict';

const express = require('express');
const config = require('../config');
const { query } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../utils/rateLimit');
const { grant, grantCapped, getPoints, spend, spendPending, settlePurchase } = require('../utils/points');
const { runCli } = require('../qq/proxy');
const qqSessions = require('../qq/sessions');
const { checkElapsed } = require('../utils/readTimer');
const { verifyTaskCompletion } = require('../utils/taskVerify');
const { getSetting } = require('../utils/settings');

const router = express.Router();

// ---- 点赞规则 ----
const LIKE_GIVE_DAILY = 10; // 主动点赞者每日积分上限（每次 +2⭐）
const LIKE_RECEIVE_DAILY = 20; // 作品被赞作者每日积分上限（P3：每个赞 +5⭐，日上限 20）

const HOUR_MS = 3600 * 1000;

// ---- 积分商城（价格/说明集中在此，前端从 /api/points/shop 拉取）----
// P1 修复（2026-08-21）：durationMs 直接配置毫秒数，不再解析展示文本
// （原 "24 小时" 被算成 24 天：duration.includes('天')?30:24 → 24*24h=576h）。
const SHOP = [
  {
    item: 'wall_top',
    name: '作品展置顶 24 小时',
    desc: '你的作品在「全校作品展」顶部置顶展示 24 小时（选一个自己的文件或轻应用）',
    cost: 100,
    duration: '24 小时',
    durationMs: 24 * HOUR_MS,
    target: 'file|app',
  },
  {
    item: 'app_top',
    name: '频道帖子置顶 24 小时',
    desc: '你发表在 QQ 频道的帖子置顶 24 小时（需要 QQ 频道登录，帖子需为本人发布）',
    cost: 150,
    duration: '24 小时',
    durationMs: 24 * HOUR_MS,
    target: 'app',
    need_feed: true,
  },
  {
    item: 'app_essence',
    name: '频道帖子加精华 24 小时',
    desc: '你发表在 QQ 频道的帖子设为精华 24 小时（需要 QQ 频道登录）',
    cost: 100,
    duration: '24 小时',
    durationMs: 24 * HOUR_MS,
    target: 'app',
    need_feed: true,
  },
  {
    item: 'title',
    name: '专属称号 30 天',
    desc: '昵称旁展示自定义称号（如「AI 新星」），作品墙 / 总览 / 排行榜均可见',
    cost: 60,
    duration: '30 天',
    durationMs: 30 * 24 * HOUR_MS,
    target: 'text',
  },
];

const ipKey = (req) => req.ip || req.connection.remoteAddress || 'unknown';

// ---- 任务完成记录 + 整章积分发放（/task 与 /quiz 共用）----
// 幂等：task_progress 唯一键防重；整章积分按 article 维度只发一次（grant 幂等）
async function recordTaskCompletion(userId, articleId, taskIndex, list) {
  await query(
    'INSERT IGNORE INTO task_progress (user_id, article_id, task_index) VALUES (?, ?, ?)',
    [userId, articleId, taskIndex]
  );
  const [done] = await query(
    'SELECT COUNT(*) AS cnt FROM task_progress WHERE user_id = ? AND article_id = ?',
    [userId, articleId]
  );
  const total = list.length;
  const doneCount = Number(done.cnt);
  const granted = doneCount >= total ? await grant(userId, 'task', 'article:' + articleId) : null;
  const points = await getPoints(userId);
  return { granted, done_count: doneCount, total, chapter_done: doneCount >= total, points: points.points };
}

// ---- 选择题判分防"试错刷题"（2026-08-21）----
// 答案与解析不再下发前端，判分完全在服务端。防暴力试错（选项就 2-4 个）：
// 答错按指数递增冷却 10s → 1min → 5min → 30min → 60min（同一用户同一题），答对即清零。
const QUIZ_LOCK_STEPS = [10 * 1000, 60 * 1000, 5 * 60 * 1000, 30 * 60 * 1000, 60 * 60 * 1000];
const quizWrong = new Map(); // key: `${uid}:${articleId}:${taskIndex}` → { count, lockedUntil }
function quizLockState(key) {
  const now = Date.now();
  const rec = quizWrong.get(key);
  if (!rec) return { locked: false, retryAfterMs: 0 };
  if (rec.lockedUntil && now < rec.lockedUntil) return { locked: true, retryAfterMs: rec.lockedUntil - now };
  return { locked: false, retryAfterMs: 0 };
}
function quizRecordWrong(key) {
  const now = Date.now();
  const rec = quizWrong.get(key) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  rec.lockedUntil = now + QUIZ_LOCK_STEPS[Math.min(rec.count - 1, QUIZ_LOCK_STEPS.length - 1)];
  quizWrong.set(key, rec);
  // 防内存膨胀：条目多时清掉已过冷却期的
  if (quizWrong.size > 5000) {
    for (const [k, v] of quizWrong) {
      if (v.lockedUntil && now >= v.lockedUntil) quizWrong.delete(k);
    }
  }
}
function quizClearWrong(key) {
  quizWrong.delete(key);
}

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
    // O1（2026-08-16）：访客（无 QQ 绑定）不参与排行榜；
    // scope=in_school（默认，仅高一/高二/高三标准班）或 all（含毕业生/外校）。前端滑块默认「在校」。
    const scope = String(req.query.scope || 'in_school') === 'all' ? 'all' : 'in_school';
    const myClass = req.user.class_name || '';
    const scopeSql = scope === 'all'
      ? 'AND qq_tiny_id IS NOT NULL'
      : 'AND qq_tiny_id IS NOT NULL AND class_name IN (' + config.classes.map(() => '?').join(',') + ')';
    const scopeParams = scope === 'all' ? [] : config.classes;
    const rows = await query(
      `SELECT id, class_name, real_name, show_real_name, nickname, points
       FROM users WHERE points > 0 ${scopeSql}
       ORDER BY points DESC, id ASC
       LIMIT 20`,
      scopeParams
    );
    const titles = await query(
      "SELECT user_id, title FROM purchases WHERE item = 'title' AND status = 'active' AND expires_at > NOW()"
    );
    const titleMap = new Map(titles.map((t) => [t.user_id, t.title]));
    const list = rows.map((u) => ({
      user_id: u.id,
      class_name: u.class_name,
      grade: require('../config').gradeOf(u.class_name),
      // P1：真实姓名仅对同班同学展示；非同班显示昵称（拼音缩写）
      display_name: (u.show_real_name !== 0 && u.class_name === myClass) ? u.real_name : (u.nickname || '同学'),
      title_tag: titleMap.get(u.id) || '',
      points: u.points,
    }));
    // 我的排名（0 分未上榜 → null，前端显示 -；与 scope 同口径）
    let myRank = null;
    if ((req.user.points || 0) > 0) {
      const rankRows = await query(
        `SELECT COUNT(*) + 1 AS rank FROM users WHERE points > ? ${scopeSql}`,
        [req.user.points || 0].concat(scopeParams)
      );
      myRank = rankRows.length ? Number(rankRows[0].rank) : null;
    }
    res.json({
      scope,
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
    // 服务端阅读时长校验（L7 修复）：需先加载过文章详情（记录开始时间）且已读 ≥60 秒，
    // 防止直接 POST 刷 +10⭐；前端计时器到达 60s 后正常打卡不受影响
    if (!checkElapsed(req.user.id, articleId, 60 * 1000)) {
      return res.status(400).json({ error: '阅读时间不足，请至少阅读 60 秒后再打卡' });
    }
    const granted = await grant(req.user.id, 'read_article', 'article:' + articleId);
    const points = await getPoints(req.user.id);
    res.json({ granted, points: points.points });
  })
);

// 任务完成上报：记录单个任务完成；一章内所有任务都完成时才发整章积分（20 ⭐）。
// 2026-08-21 加固：完成条件由服务端核验（verifyTaskCompletion，口径与 /api/learn/*-status 一致），
// 防直接 POST 绕过前端 UI 校验刷任务。
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
    const task = list[taskIndex];
    if (!task) return res.status(400).json({ error: '任务不存在' });

    // P2 修复（2026-08-21）：选择题统一走 /api/points/quiz（带防试错冷却），
    // /task 拒绝 quiz 类型——否则可通过 /task 直接提交答案无限试错绕过冷却。
    if (task.type === 'quiz') {
      return res.status(400).json({ error: '选择题请直接在题目下方作答（服务端判分）' });
    }

    // 服务端核验该任务的真实完成条件（NFTI 体验 / 频道发帖 / 项目上传 / tiny_id 等）
    const vr = await verifyTaskCompletion(task, req.user, req.body);
    if (!vr.ok) return res.status(400).json({ error: vr.error });

    res.json(await recordTaskCompletion(req.user.id, articleId, taskIndex, list));
  })
);

// 选择题判分（2026-08-21）：答案与解析不下发前端（/api/learn/:slug 已剥离），
// 逐题由服务端判分，答对才记录完成；答错返回 correct:false 且不泄露正确答案，
// 并以指数冷却防试错刷题（见 quizLockState）。
router.post(
  '/quiz',
  requireAuth,
  rateLimit({ windowMs: 60 * 1000, max: 40, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const articleId = parseInt(req.body && req.body.article_id, 10);
    const taskIndex = parseInt(req.body && req.body.task_index, 10);
    const chosen = parseInt(req.body && req.body.answer, 10);
    if (!articleId || isNaN(taskIndex) || isNaN(chosen)) {
      return res.status(400).json({ error: '参数错误' });
    }
    const rows = await query('SELECT id, tasks FROM articles WHERE id = ?', [articleId]);
    if (rows.length === 0) return res.status(404).json({ error: '文章不存在' });
    const tasks = rows[0].tasks;
    let list = [];
    try { list = typeof tasks === 'string' ? JSON.parse(tasks) : tasks; } catch (_) { list = []; }
    const task = list[taskIndex];
    if (!task || task.type !== 'quiz') return res.status(400).json({ error: '任务不存在' });

    const lockKey = req.user.id + ':' + articleId + ':' + taskIndex;
    const lock = quizLockState(lockKey);
    if (lock.locked) {
      const s = Math.ceil(lock.retryAfterMs / 1000);
      return res.status(429).json({
        error: '尝试次数过多，请 ' + (s >= 60 ? Math.ceil(s / 60) + ' 分钟' : s + ' 秒') + ' 后再试',
      });
    }

    const correct = chosen === Number(task.answer);
    if (!correct) {
      quizRecordWrong(lockKey);
      return res.json({ correct: false });
    }
    quizClearWrong(lockKey);
    const result = await recordTaskCompletion(req.user.id, articleId, taskIndex, list);
    res.json({ correct: true, explain: task.explain || '', ...result });
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
    const progress = list.map((t, i) => {
      const entry = { task_index: i, done: doneSet.has(i) };
      // 已完成的选择题：下发正确答案与解析（奖励已发放，无泄露价值；前端用于回填高亮与解析）
      if (entry.done && t && t.type === 'quiz') {
        entry.answer = Number(t.answer);
        entry.explain = t.explain || '';
      }
      return entry;
    });
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

// ---- 作品点赞：每日票数不限；点赞者本人 +2⭐/次（每日上限 LIKE_GIVE_DAILY），
// 被赞作者 +5⭐/赞（站内直接发放，每日上限 LIKE_RECEIVE_DAILY；P3）----
router.post(
  '/like',
  requireAuth,
  asyncHandler(async (req, res) => {
    const targetType = String((req.body && req.body.target_type) || '').trim();
    const targetId = parseInt(req.body && req.body.target_id, 10);
    if (!['file', 'app', 'link'].includes(targetType) || !targetId) {
      return res.status(400).json({ error: '参数错误' });
    }

    // 目标作品存在性 + 禁止自赞（防止自赞刷分）；违规下架作品不可点赞（L5 修复）。
    // R3-6（2026-08-21）：完全复用作品墙可见性——文件须已过审、所属用户须 active，
    // 链接须已验证；防止通过枚举 ID 点赞"不应公开"的作品刷双方积分。
    let owner = 0;
    if (targetType === 'file') {
      const rows = await query(
        "SELECT f.user_id, u.status FROM files f JOIN users u ON u.id = f.user_id WHERE f.id = ? AND f.audit_status = 'reviewed'",
        [targetId]
      );
      if (rows.length === 0) return res.status(404).json({ error: '作品不存在或未通过审核' });
      if (rows[0].status !== 'active') return res.status(403).json({ error: '该用户账号已停用，作品不可点赞' });
      owner = rows[0].user_id;
    } else if (targetType === 'app') {
      const rows = await query(
        'SELECT a.user_id, u.status FROM apps a JOIN users u ON u.id = a.user_id WHERE a.id = ?',
        [targetId]
      );
      if (rows.length === 0) return res.status(404).json({ error: '作品不存在' });
      if (rows[0].status !== 'active') return res.status(403).json({ error: '该用户账号已停用，作品不可点赞' });
      owner = rows[0].user_id;
    } else {
      // 仅已验证（verified=1）的 GitHub 链接可点赞
      const rows = await query(
        'SELECT l.user_id, u.status FROM links l JOIN users u ON u.id = l.user_id WHERE l.id = ? AND l.verified = 1',
        [targetId]
      );
      if (rows.length === 0) return res.status(404).json({ error: '作品不存在或未通过验证' });
      if (rows[0].status !== 'active') return res.status(403).json({ error: '该用户账号已停用，作品不可点赞' });
      owner = rows[0].user_id;
    }
    if (owner === req.user.id) return res.status(400).json({ error: '不能给自己点赞' });

    // 插入点赞（唯一键防重复赞同一作品）；每日票数不限
    let inserted = false;
    let likeId = 0;
    try {
      const ins = await query(
        'INSERT INTO likes (user_id, target_type, target_id) VALUES (?, ?, ?)',
        [req.user.id, targetType, targetId]
      );
      inserted = ins.affectedRows > 0;
      likeId = ins.insertId;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: '你已经赞过这个作品了' });
      }
      throw err;
    }

    // 双向发分（同一 likes.id 作 ref_id；reason 不同互不冲突，均幂等）
    // 每日上限检查与发放在同一事务（用户行锁）内完成，并发下不会突破上限（L4 修复）
    let gained = 0;        // 点赞者 +2
    let authorGained = 0;  // 作者 +2
    if (inserted && likeId) {
      gained = await grantCapped(req.user.id, 'like_give', 'like:' + likeId, 2, LIKE_GIVE_DAILY);
      authorGained = await grantCapped(owner, 'like_receive', 'like:' + likeId, 5, LIKE_RECEIVE_DAILY);
    }

    res.json({
      ok: true,
      liked: inserted,
      gained,
      author_gained: authorGained,
      daily_left: Math.max(0, LIKE_GIVE_DAILY - (Number((await query(
        "SELECT COALESCE(SUM(amount), 0) AS t FROM points_log WHERE user_id = ? AND reason = 'like_give' AND DATE(created_at) = CURDATE()",
        [req.user.id]
      ))[0].t) || 0)),
    });
  })
);

// ---- 课程毕业奖：全部文章读完 + 全部章节任务完成 → 一次性 +50⭐ ----
// 状态查询与发放分离：GET 只读（页面加载用，避免"打开积分页即自动领取"），POST 才发放
async function getGraduateStatus(userId) {
  const [rows] = await query(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN EXISTS(
         SELECT 1 FROM points_log pl WHERE pl.user_id = ? AND pl.reason = 'task' AND pl.ref_id = CONCAT('article:', a.id)
       ) THEN 1 ELSE 0 END) AS tasks_done,
       SUM(CASE WHEN EXISTS(
         SELECT 1 FROM points_log pl WHERE pl.user_id = ? AND pl.reason = 'read_article' AND pl.ref_id = CONCAT('article:', a.id)
       ) THEN 1 ELSE 0 END) AS read_done
     FROM articles a`,
    [userId, userId]
  );
  const total = Number(rows.total);
  const tasksDone = Number(rows.tasks_done || 0);
  const readDone = Number(rows.read_done || 0);
  const eligible = total > 0 && tasksDone === total && readDone === total;
  // 是否已领取过（grant 幂等返回 null 无法区分"已发过"和"未发"，故单独查流水）
  const claimedRows = await query(
    "SELECT 1 FROM points_log WHERE user_id = ? AND reason = 'graduate' AND ref_id = 'all'",
    [userId]
  );
  const hasClaimed = claimedRows.length > 0;
  return { total, tasks_done: tasksDone, read_done: readDone, eligible, has_claimed: hasClaimed };
}

// 毕业资格查询（只读，不发放）：积分页加载时调用
router.get(
  '/graduate',
  requireAuth,
  asyncHandler(async (req, res) => {
    const status = await getGraduateStatus(req.user.id);
    const points = await getPoints(req.user.id);
    res.json({ ...status, granted: null, points: points.points });
  })
);

// 毕业奖励领取（仅按钮点击触发）
router.post(
  '/graduate',
  requireAuth,
  asyncHandler(async (req, res) => {
    const status = await getGraduateStatus(req.user.id);
    const granted = status.eligible && !status.has_claimed ? await grant(req.user.id, 'graduate', 'all') : null;
    const points = await getPoints(req.user.id);
    res.json({ ...status, granted, points: points.points });
  })
);

// ---- 彩蛋：连续点击顶栏积分徽章 5 次触发（前端计数），每人仅一次 ----
router.post(
  '/easter-egg',
  requireAuth,
  asyncHandler(async (req, res) => {
    const granted = await grant(req.user.id, 'easter_egg', 'once');
    const points = await getPoints(req.user.id);
    res.json({ ok: !!granted, granted: granted || null, points: points.points });
  })
);

// ---- 积分商城 ----
router.get('/shop', requireAuth, (req, res) => {
  res.json({
    items: SHOP,
    like_give_daily: LIKE_GIVE_DAILY,
    like_receive_daily: LIKE_RECEIVE_DAILY,
  });
});

// 我的兑换记录
router.get(
  '/my-purchases',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(
      'SELECT id, item, cost, ref_type, ref_id, feed_id, title, status, created_at, expires_at FROM purchases WHERE user_id = ? ORDER BY id DESC LIMIT 30',
      [req.user.id]
    );
    res.json({ purchases: rows });
  })
);

// 取用户 QQ 会话（频道类兑换需要）
async function getUserSession(userId) {
  const rows = await query('SELECT qq_session_id FROM users WHERE id = ?', [userId]);
  if (rows.length === 0 || !rows[0].qq_session_id) return null;
  const s = qqSessions.getSession(rows[0].qq_session_id);
  if (!s || !s.token_obtained || !s.tiny_id) return null;
  return s;
}

// 校验帖子作者是本人，并取置顶所需字段（user_id / create_time）
async function verifyOwnFeedWithTs(feedId, s, env) {
  const detail = await runCli(['feed', 'get-feed-detail', '--feed-id=' + feedId, '--guild-id=' + config.guildId], 15000, env);
  const dd = (detail && detail.data) || {};
  const feed = dd.feed || dd;
  const authorId = String(feed.author_id || (feed.author && feed.author.tiny_id) || '');
  return {
    ok: authorId !== '' && authorId === s.tiny_id,
    author_id: authorId,
    create_time: String(feed.create_time || ''),
    title: feed.title || feed.content || '',
  };
}

// ---- 积分兑换 ----
// P1 修复（2026-08-21）：频道类（置顶/加精）改为两阶段——
// 先原子预扣积分并创建 pending 记录 → 再执行外部频道操作 → 成功转 active / 失败退款，
// 杜绝"外部操作已生效但余额不足/DB 失败导致免费兑换且无记录可回收"。
router.post(
  '/purchase',
  requireAuth,
  asyncHandler(async (req, res) => {
    // R2-8（2026-08-21）：商城开关后端强制——settings.shop_enabled = '0' 时直接拒绝，
    // 不再只依赖前端隐藏入口（此前可直接调用 /api/points/purchase 绕过）
    const shopOn = await getSetting('shop_enabled');
    if (shopOn === '0') {
      return res.status(403).json({ error: '积分商城已关闭' });
    }
    const item = String((req.body && req.body.item) || '').trim();
    const def = SHOP.find((s) => s.item === item);
    if (!def) return res.status(400).json({ error: '未知商品' });

    const refType = String((req.body && req.body.ref_type) || '').trim();
    const refId = parseInt(req.body && req.body.ref_id, 10) || 0;
    const title = String((req.body && req.body.title) || '').trim().slice(0, 32);
    let channelMeta = ''; // 频道类兑换的帖子元数据（取消置顶需要 create_time）

    // 校验目标归属
    let feedId = '';
    if (def.target.includes('file') || def.target.includes('app')) {
      if (!['file', 'app'].includes(refType) || !refId) {
        return res.status(400).json({ error: '请选择要生效的作品' });
      }
      let owner = null;
      if (refType === 'file') {
        const rows = await query('SELECT user_id FROM files WHERE id = ?', [refId]);
        if (rows.length === 0) return res.status(404).json({ error: '作品不存在' });
        owner = rows[0].user_id;
      } else {
        const rows = await query('SELECT user_id, source_feed_id FROM apps WHERE id = ?', [refId]);
        if (rows.length === 0) return res.status(404).json({ error: '作品不存在' });
        owner = rows[0].user_id;
        feedId = rows[0].source_feed_id || '';
      }
      if (owner !== req.user.id) return res.status(403).json({ error: '只能对自己的作品使用' });
    }

    // 称号类：文本校验
    if (item === 'title') {
      if (!title) return res.status(400).json({ error: '请输入称号内容' });
      if (title.length > 16) return res.status(400).json({ error: '称号最多 16 个字' });
    }

    // P1：有效期直接取配置的 durationMs（不再解析展示文本）
    const expiresAt = new Date(Date.now() + def.durationMs);

    // 频道类：两阶段兑换
    if (def.need_feed) {
      if (!feedId) {
        return res.status(400).json({ error: '该轻应用没有关联的频道帖子，无法置顶/加精华（请用「自动识别」提交的轻应用）' });
      }
      const s = await getUserSession(req.user.id);
      if (!s) {
        return res.status(400).json({ error: '需要 QQ 频道登录才能操作频道帖子，请重新扫码登录' });
      }
      const env = qqSessions.sessionEnv(s);
      const verify = await verifyOwnFeedWithTs(feedId, s, env);
      if (!verify.ok) {
        return res.status(403).json({ error: '无法确认该帖子是你发布的（可能已删除或非本人），请先到「我的项目」重新识别' });
      }
      channelMeta = JSON.stringify({ create_time: verify.create_time, author_id: verify.author_id });

      // 阶段一：原子预扣积分 + 创建 pending 记录
      const pending = await spendPending(req.user.id, {
        item: def.item,
        cost: def.cost,
        refType,
        refId,
        feedId,
        feedExtra: channelMeta,
        title: '',
        expiresAt,
      });
      if (!pending.ok) return res.status(400).json({ error: pending.error });

      // 阶段二：执行外部频道操作；失败退款
      let cliArgs = [];
      if (item === 'app_top') {
        cliArgs = [
          'feed', 'top-feed',
          '--feed-id=' + feedId,
          '--user-id=' + verify.author_id,
          '--create-time=' + verify.create_time,
          '--guild-id=' + config.guildId,
          '--action=1',
        ];
      } else if (item === 'app_essence') {
        cliArgs = ['feed', 'set-feed-essence', '--feed-id=' + feedId, '--action=1'];
      }
      let cliRes = null;
      try {
        cliRes = await runCli(cliArgs, 20000, env);
      } catch (_) { /* 按失败处理 */ }
      if (!cliRes || cliRes.success === false) {
        const msg = (cliRes && cliRes.error && cliRes.error.message) || '频道操作失败（可能没有管理权限）';
        await settlePurchase(pending.purchase_id, false); // 退款 + cancelled
        return res.status(502).json({ error: msg });
      }
      await settlePurchase(pending.purchase_id, true); // 转 active（幂等）
      return res.json({ ok: true, points: pending.points, purchase_id: pending.purchase_id, expires_at: expiresAt });
    }

    // 普通类（wall_top / title）：单阶段直接扣分
    const result = await spend(req.user.id, {
      item: def.item,
      cost: def.cost,
      refType: def.target.includes('file') || def.target.includes('app') ? refType : '',
      refId: def.target.includes('file') || def.target.includes('app') ? refId : 0,
      feedId: '',
      feedExtra: '',
      title: item === 'title' ? title : '',
      expiresAt,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, points: result.points, purchase_id: result.purchase_id, expires_at: expiresAt });
  })
);

module.exports = router;
