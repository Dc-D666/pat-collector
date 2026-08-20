'use strict';

// 频道置顶/精华撤销（2026-08-21 抽取）：供 jobs 定时回收与"删除作品/用户时主动撤销"共用。
const config = require('../config');
const { query } = require('../db');
const qqSessions = require('../qq/sessions');
const { runCli } = require('../qq/proxy');

/**
 * 尝试撤销一条频道购买（purchases 行：item=app_top|app_essence，需含 feed_id/feed_extra/user_id）。
 * @returns {{ok: boolean, reason?: string}}
 */
async function cancelChannelPurchase(purchase) {
  const userRows = await query('SELECT qq_session_id FROM users WHERE id = ?', [purchase.user_id]);
  const sid = userRows.length ? userRows[0].qq_session_id : '';
  const sess = sid ? qqSessions.getSession(sid) : null;
  if (!sess || !sess.token_obtained || !purchase.feed_id) {
    return { ok: false, reason: 'no_session' };
  }
  // 取消置顶需要帖子创建时间戳（兑换时已存 feed_extra）
  let createTime = '0';
  try {
    const extra = purchase.feed_extra ? JSON.parse(purchase.feed_extra) : null;
    if (extra && extra.create_time) createTime = String(extra.create_time);
  } catch (_) { /* 忽略 */ }
  const args = purchase.item === 'app_top'
    ? ['feed', 'top-feed', '--feed-id=' + purchase.feed_id, '--user-id=' + sess.tiny_id, '--guild-id=' + config.guildId, '--action=2', '--create-time=' + createTime]
    : ['feed', 'set-feed-essence', '--feed-id=' + purchase.feed_id, '--action=2'];
  try {
    const cliRes = await runCli(args, 20000, qqSessions.sessionEnv(sess));
    if (!cliRes || cliRes.success === false) {
      return { ok: false, reason: (cliRes && cliRes.error && cliRes.error.message) || 'cli_failed' };
    }
    return { ok: true };
  } catch (_) {
    return { ok: false, reason: 'cli_error' };
  }
}

module.exports = { cancelChannelPurchase };
