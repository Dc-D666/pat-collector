'use strict';

const express = require('express');
const config = require('../config');
const { query } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../utils/rateLimit');
const { grant, getPoints, spend } = require('../utils/points');
const { runCli } = require('../qq/proxy');
const qqSessions = require('../qq/sessions');

const router = express.Router();

// ---- 点赞规则 ----
const LIKE_GIVE_DAILY = 10; // 主动点赞者每日积分上限（每次 +2⭐）
const LIKE_RECEIVE_DAILY = 30; // 帖子被赞作者每日积分上限（CLI 增量，每个赞 +2⭐）

// ---- 积分商城（价格/说明集中在此，前端从 /api/points/shop 拉取）----
const SHOP = [
  {
    item: 'wall_top',
    name: '作品展置顶 24 小时',
    desc: '你的作品在「全校作品展」顶部置顶展示 24 小时（选一个自己的文件或轻应用）',
    cost: 100,
    duration: '24 小时',
    target: 'file|app',
  },
  {
    item: 'app_top',
    name: '频道帖子置顶 24 小时',
    desc: '你发表在 QQ 频道的帖子置顶 24 小时（需要 QQ 频道登录，帖子需为本人发布）',
    cost: 150,
    duration: '24 小时',
    target: 'app',
    need_feed: true,
  },
  {
    item: 'app_essence',
    name: '频道帖子加精华 24 小时',
    desc: '你发表在 QQ 频道的帖子设为精华 24 小时（需要 QQ 频道登录）',
    cost: 100,
    duration: '24 小时',
    target: 'app',
    need_feed: true,
  },
  {
    item: 'title',
    name: '专属称号 30 天',
    desc: '昵称旁展示自定义称号（如「AI 新星」），作品墙 / 总览 / 排行榜均可见',
    cost: 60,
    duration: '30 天',
    target: 'text',
  },
];

const HOUR_MS = 3600 * 1000;

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
    const titles = await query(
      "SELECT user_id, title FROM purchases WHERE item = 'title' AND status = 'active' AND expires_at > NOW()"
    );
    const titleMap = new Map(titles.map((t) => [t.user_id, t.title]));
    const list = rows.map((u) => ({
      user_id: u.id,
      class_name: u.class_name,
      grade: require('../config').gradeOf(u.class_name),
      display_name: u.show_real_name !== 0 ? u.real_name : (u.nickname || u.real_name),
      title_tag: titleMap.get(u.id) || '',
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

// ---- 作品点赞：每日票数不限；点赞者本人 +2⭐/次（每日上限 LIKE_GIVE_DAILY），
// 被赞作者 +2⭐/赞（站内直接发放，每日上限 LIKE_RECEIVE_DAILY）----
router.post(
  '/like',
  requireAuth,
  asyncHandler(async (req, res) => {
    const targetType = String((req.body && req.body.target_type) || '').trim();
    const targetId = parseInt(req.body && req.body.target_id, 10);
    if (!['file', 'app'].includes(targetType) || !targetId) {
      return res.status(400).json({ error: '参数错误' });
    }

    // 目标作品存在性 + 禁止自赞（防止自赞刷分）
    let owner = 0;
    if (targetType === 'file') {
      const rows = await query('SELECT user_id FROM files WHERE id = ?', [targetId]);
      if (rows.length === 0) return res.status(404).json({ error: '作品不存在' });
      owner = rows[0].user_id;
    } else {
      const rows = await query('SELECT user_id FROM apps WHERE id = ?', [targetId]);
      if (rows.length === 0) return res.status(404).json({ error: '作品不存在' });
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
    let gained = 0;        // 点赞者 +2
    let authorGained = 0;  // 作者 +2
    if (inserted && likeId) {
      // 点赞者（每日上限 LIKE_GIVE_DAILY；到上限本次点赞仍记录，但不发分）
      const [giveEarned] = await query(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM points_log WHERE user_id = ? AND reason = 'like_give' AND DATE(created_at) = CURDATE()",
        [req.user.id]
      );
      if (Number(giveEarned.total) < LIKE_GIVE_DAILY) {
        gained = (await grant(req.user.id, 'like_give', 'like:' + likeId, 2)) || 0;
      }
      // 作者（站内直接发放，每日上限 LIKE_RECEIVE_DAILY）
      const [recvEarned] = await query(
        "SELECT COALESCE(SUM(amount), 0) AS total FROM points_log WHERE user_id = ? AND reason = 'like_receive' AND DATE(created_at) = CURDATE()",
        [owner]
      );
      if (Number(recvEarned.total) < LIKE_RECEIVE_DAILY) {
        authorGained = (await grant(owner, 'like_receive', 'like:' + likeId, 2)) || 0;
      }
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
router.post(
  '/graduate',
  requireAuth,
  asyncHandler(async (req, res) => {
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
      [req.user.id, req.user.id]
    );
    const total = Number(rows.total);
    const tasksDone = Number(rows.tasks_done || 0);
    const readDone = Number(rows.read_done || 0);
    const eligible = total > 0 && tasksDone === total && readDone === total;

    // 是否已领取过（grant 幂等返回 null 无法区分"已发过"和"未发"，故单独查流水）
    const claimedRows = await query(
      "SELECT 1 FROM points_log WHERE user_id = ? AND reason = 'graduate' AND ref_id = 'all'",
      [req.user.id]
    );
    const hasClaimed = claimedRows.length > 0;

    const granted = eligible && !hasClaimed ? await grant(req.user.id, 'graduate', 'all') : null;
    const points = await getPoints(req.user.id);
    res.json({
      eligible,
      has_claimed: hasClaimed,
      granted,
      total,
      tasks_done: tasksDone,
      read_done: readDone,
      points: points.points,
    });
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
router.post(
  '/purchase',
  requireAuth,
  asyncHandler(async (req, res) => {
    const item = String((req.body && req.body.item) || '').trim();
    const def = SHOP.find((s) => s.item === item);
    if (!def) return res.status(400).json({ error: '未知商品' });

    const refType = String((req.body && req.body.ref_type) || '').trim();
    const refId = parseInt(req.body && req.body.ref_id, 10) || 0;
    const title = String((req.body && req.body.title) || '').trim().slice(0, 32);
    let channelMeta = ''; // 频道类兑换的帖子元数据（取消置顶需要 create_time）

    // 校验目标归属
    if (def.target.includes('file') || def.target.includes('app')) {
      if (!['file', 'app'].includes(refType) || !refId) {
        return res.status(400).json({ error: '请选择要生效的作品' });
      }
      let owner = null;
      let feedId = '';
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

      // 频道类（置顶/精华）：需要 QQ 会话 + 帖子 BID
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
        // 先执行频道操作，成功才扣积分
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
        const cliRes = await runCli(cliArgs, 20000, env);
        if (!cliRes || cliRes.success === false) {
          const msg = (cliRes && cliRes.error && cliRes.error.message) || '频道操作失败（可能没有管理权限）';
          return res.status(502).json({ error: msg });
        }
        channelMeta = JSON.stringify({ create_time: verify.create_time, author_id: verify.author_id });
      }
    }

    // 称号类：文本校验
    if (item === 'title') {
      if (!title) return res.status(400).json({ error: '请输入称号内容' });
      if (title.length > 16) return res.status(400).json({ error: '称号最多 16 个字' });
    }

    const expiresAt = new Date(Date.now() + (def.duration.includes('天') ? 30 : 24) * 24 * HOUR_MS);
    const result = await spend(req.user.id, {
      item: def.item,
      cost: def.cost,
      refType: def.target.includes('file') || def.target.includes('app') ? refType : '',
      refId: def.target.includes('file') || def.target.includes('app') ? refId : 0,
      feedId: def.need_feed ? feedId : '',
      // 频道类存帖子元数据（取消置顶需要 create_time）
      feedExtra: channelMeta,
      title: item === 'title' ? title : '',
      expiresAt,
    });
    if (!result.ok) return res.status(400).json({ error: result.error });
    res.json({ ok: true, points: result.points, purchase_id: result.purchase_id, expires_at: expiresAt });
  })
);

module.exports = router;
