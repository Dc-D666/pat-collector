'use strict';

// 后台定时任务：积分兑换到期自动回收（频道置顶/精华 24h 后自动取消）
// （被赞积分已改为站内点赞直接发放，不再走 CLI 统计）
const config = require('./config');
const { query } = require('./db');
const qqSessions = require('./qq/sessions');
const proxy = require('./qq/proxy');

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 置顶/精华回收：每 10 分钟

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

function startJobs() {
  const timer = setInterval(() => {
    sweepExpiredChannelBoosts().catch((err) => console.error('[jobs] sweep 异常：', err.message));
  }, CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref();
  // 启动后立即扫一次
  sweepExpiredChannelBoosts().catch((err) => console.error('[jobs] 启动 sweep 异常：', err.message));

  console.log('[jobs] 已启动：置顶/精华自动回收（10 分钟）；帖子被赞积分由「我的积分」页按用户触发');
}

module.exports = { startJobs, sweepExpiredChannelBoosts };
