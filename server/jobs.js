'use strict';

// 后台定时任务：
// 1. 积分兑换到期自动回收（频道置顶/精华 24h 后自动取消）
// 2. 帖子被赞积分（CLI 查 prefer_count 与快照对比取增量）——不再定时，
//    改为用户打开「我的积分」页时按用户实时刷新（routes/points.js /refresh-likes 调用）
const config = require('./config');
const { query } = require('./db');
const qqSessions = require('./qq/sessions');
const proxy = require('./qq/proxy');
const { grant } = require('./utils/points');

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 置顶/精华回收：每 10 分钟
const LIKE_RECEIVE_DAILY = 30; // 帖子被赞作者每日积分上限（与 routes/points.js 一致）

// 把过期的 app_top / app_essence 兑换项自动取消，并标记 expired
async function sweepExpiredChannelBoosts() {
  let rows = [];
  try {
    rows = await query(
      `SELECT id, user_id, item, feed_id FROM purchases
       WHERE item IN ('app_top', 'app_essence') AND status = 'active'
         AND expires_at IS NOT NULL AND expires_at < NOW()`
    );
  } catch (err) {
    console.error('[jobs] 查询过期兑换失败：', err.message);
    return;
  }
  for (const p of rows) {
    try {
      // 会话按用户绑定关系取：user_id → users.qq_session_id
      const userRows = await query('SELECT qq_session_id FROM users WHERE id = ?', [p.user_id]);
      const sid = userRows.length ? userRows[0].qq_session_id : '';
      const sess = sid ? qqSessions.getSession(sid) : null;
      if (!sess || !sess.token_obtained || !p.feed_id) {
        // 无有效会话/无帖子：无法自动取消，直接标记过期（频道侧可能仍置顶，提示人工处理）
        await query("UPDATE purchases SET status = 'expired' WHERE id = ?", [p.id]);
        console.warn('[jobs] 兑换 #' + p.id + ' 无有效会话，标记过期（频道侧需人工取消）');
        continue;
      }
      const env = qqSessions.sessionEnv(sess);
      // 取消置顶需要帖子创建时间戳（兑换时已存 feed_extra）
      let createTime = '0';
      try {
        const extra = p.feed_extra ? JSON.parse(p.feed_extra) : null;
        if (extra && extra.create_time) createTime = String(extra.create_time);
      } catch (_) { /* 忽略 */ }
      const args =
        p.item === 'app_top'
          ? ['feed', 'top-feed', '--feed-id=' + p.feed_id, '--user-id=' + sess.tiny_id, '--guild-id=' + config.guildId, '--action=2', '--create-time=' + createTime]
          : ['feed', 'set-feed-essence', '--feed-id=' + p.feed_id, '--action=2'];
      const cliRes = await proxy.runCli(args, 20000, env);
      const ok = !!(cliRes && cliRes.success !== false);
      await query("UPDATE purchases SET status = 'expired' WHERE id = ?", [p.id]);
      if (ok) {
        console.log('[jobs] 兑换 #' + p.id + '（' + p.item + '）已自动取消');
      } else {
        console.warn('[jobs] 兑换 #' + p.id + ' 取消失败（CLI 返回错误），已标记过期：',
          cliRes && cliRes.error && cliRes.error.message);
      }
    } catch (err) {
      console.error('[jobs] 处理兑换 #' + p.id + ' 出错：', err.message);
    }
  }
}

// ---- 帖子被赞积分（CLI 增量，按用户）：刷新某用户的被赞数据，查 prefer_count 与快照对比发增量 ----
// 由「我的积分」页打开时调用（GET /api/points/refresh-likes）。返回 {posts_checked, points_granted}
async function refreshUserFeedLikes(userId) {
  let feeds = [];
  try {
    feeds = await query(
      `SELECT source_feed_id AS feed_id FROM apps
       WHERE user_id = ? AND source_feed_id IS NOT NULL AND source_feed_id != ''
       GROUP BY source_feed_id`,
      [userId]
    );
  } catch (err) {
    console.error('[jobs] 查询帖子列表失败：', err.message);
    return { posts_checked: 0, points_granted: 0 };
  }
  if (feeds.length === 0) return { posts_checked: 0, points_granted: 0 };

  // 用户 QQ 会话（帖子点赞数需真实 token 查询）
  const userRows = await query('SELECT qq_session_id FROM users WHERE id = ?', [userId]);
  const sid = userRows.length ? userRows[0].qq_session_id : '';
  const sess = sid ? qqSessions.getSession(sid) : null;
  if (!sess || !sess.token_obtained) {
    console.warn('[jobs] 用户(id=' + userId + ')无有效 QQ 会话，跳过被赞刷新（提示重新扫码登录）');
    return { posts_checked: 0, points_granted: 0 };
  }
  const env = qqSessions.sessionEnv(sess);

  let postsChecked = 0;
  let totalGranted = 0;
  for (const f of feeds) {
    const feedId = String(f.feed_id || '').trim();
    if (!feedId) continue;
    try {
      const res = await proxy.runCli(
        ['feed', 'get-feed-detail', '--feed-id=' + feedId, '--guild-id=' + config.guildId],
        20000,
        env
      );
      if (!res || res.success === false) {
        console.warn('[jobs] 查询帖子 ' + feedId + ' 详情失败：', res && res.error && res.error.message);
        continue;
      }
      const feed = (res.data && (res.data.feed || res.data)) || {};
      const likeCount = parseInt(feed.prefer_count, 10) || 0;
      postsChecked++;

      // 与上次快照对比（无快照 = 首次建立基线，历史赞不补发）
      const last = await query(
        'SELECT like_count FROM feed_like_snapshots WHERE feed_id = ? ORDER BY id DESC LIMIT 1',
        [feedId]
      );
      const prev = last.length ? Number(last[0].like_count) : null;
      const delta = prev === null ? 0 : Math.max(0, likeCount - prev);

      // 发分：每个新增赞 +2⭐，作者每日上限 LIKE_RECEIVE_DAILY
      let pointsGranted = 0;
      const ins = await query(
        'INSERT INTO feed_like_snapshots (feed_id, like_count, owner_user_id, delta) VALUES (?, ?, ?, ?)',
        [feedId, likeCount, userId, delta]
      );
      const snapId = ins.insertId;
      if (delta > 0) {
        const amount = delta * 2;
        const [earned] = await query(
          "SELECT COALESCE(SUM(amount), 0) AS t FROM points_log WHERE user_id = ? AND reason = 'like_receive' AND DATE(created_at) = CURDATE()",
          [userId]
        );
        const remaining = LIKE_RECEIVE_DAILY - Number(earned.t || 0);
        if (remaining > 0) {
          const g = await grant(userId, 'like_receive', 'feed:' + feedId + ':' + snapId, Math.min(amount, remaining));
          if (g) {
            pointsGranted = g;
            totalGranted += g;
            await query('UPDATE feed_like_snapshots SET points_granted = ? WHERE id = ?', [g, snapId]);
          }
        }
      }
      console.log(
        `[jobs] 帖子 ${feedId} 赞数 ${prev === null ? '(基线)' : prev + '→' + likeCount}，新增 ${delta} 赞，发分 ${pointsGranted}⭐（用户 id=${userId}）`
      );
    } catch (err) {
      console.error('[jobs] 处理帖子 ' + feedId + ' 出错：', err.message);
    }
  }
  return { posts_checked: postsChecked, points_granted: totalGranted };
}

function startJobs() {
  const timer = setInterval(() => {
    sweepExpiredChannelBoosts().catch((err) => console.error('[jobs] sweep 异常：', err.message));
  }, CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref();
  // 启动后立即扫一次
  sweepExpiredChannelBoosts().catch((err) => console.error('[jobs] 启动 sweep 异常：', err.message));

  console.log('[jobs] 已启动：置顶/精华自动回收（10 分钟）；帖子被赞积分由「我的积分」页按用户触发');
}

module.exports = { startJobs, sweepExpiredChannelBoosts, refreshUserFeedLikes };
