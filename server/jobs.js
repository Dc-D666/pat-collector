'use strict';

// 后台定时任务：积分兑换到期自动回收（频道置顶/精华 24h 后自动取消）
// （被赞积分已改为站内点赞直接发放，不再走 CLI 统计）
// P1 修复（2026-08-21）：
//  1. 查询补上 feed_extra——取消置顶需要帖子 create_time，此前未选中导致恒为 "0" 而取消失败；
//  2. CLI 取消失败时保持 active，下轮重试（不再无条件标记 expired 导致永不重试）；
//  3. 清理悬空 pending 记录（两阶段兑换在外部操作后崩溃遗留）：超时未结算 → 退款并标记 cancelled。
const config = require('./config');
const { query, pool } = require('./db');
const qqSessions = require('./qq/sessions');
const proxy = require('./qq/proxy');

const CHECK_INTERVAL_MS = 10 * 60 * 1000; // 置顶/精华回收：每 10 分钟

// 把过期的 app_top / app_essence 兑换项自动取消，并标记 expired
async function sweepExpiredChannelBoosts() {
  let rows = [];
  try {
    rows = await query(
      `SELECT id, user_id, item, feed_id, feed_extra FROM purchases
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
        // 无有效会话/无帖子：无法自动取消，标记过期（频道侧可能仍置顶，提示人工处理）
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
      let cliRes = null;
      try {
        cliRes = await proxy.runCli(args, 20000, env);
      } catch (_) { /* 按失败处理 */ }
      const ok = !!(cliRes && cliRes.success !== false);
      if (ok) {
        await query("UPDATE purchases SET status = 'expired' WHERE id = ?", [p.id]);
        console.log('[jobs] 兑换 #' + p.id + '（' + p.item + '）已自动取消');
      } else {
        // P1：取消失败 → 保持 active，下一轮（10 分钟后）重试，直到成功或人工介入
        console.warn('[jobs] 兑换 #' + p.id + ' 取消失败，下轮重试：',
          cliRes && cliRes.error && cliRes.error.message);
      }
    } catch (err) {
      console.error('[jobs] 处理兑换 #' + p.id + ' 出错：', err.message);
    }
  }

  // 清理悬空 pending（两阶段兑换遗留：外部操作后进程崩溃未结算）
  // 超 10 分钟未结算 → 退款 + 标记 cancelled（宁可退款，也不让用户为未知结果买单）
  await sweepStalePending();
}

async function sweepStalePending() {
  let rows = [];
  try {
    rows = await query(
      `SELECT id, user_id, cost FROM purchases
       WHERE status = 'pending' AND created_at < (NOW() - INTERVAL 10 MINUTE)`
    );
  } catch (err) {
    console.error('[jobs] 查询悬空 pending 失败：', err.message);
    return;
  }
  for (const p of rows) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // 行锁防与结算并发；仅 pending 可退款
      const [lock] = await conn.execute(
        "SELECT user_id, cost FROM purchases WHERE id = ? AND status = 'pending' FOR UPDATE",
        [p.id]
      );
      if (lock.length === 0) {
        await conn.rollback();
        conn.release();
        continue;
      }
      await conn.execute('UPDATE users SET points = points + ? WHERE id = ?', [lock[0].cost, lock[0].user_id]);
      await conn.execute(
        'INSERT INTO points_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)',
        [lock[0].user_id, lock[0].cost, 'purchase_refund', 'purchase:' + p.id]
      );
      await conn.execute("UPDATE purchases SET status = 'cancelled' WHERE id = ?", [p.id]);
      await conn.commit();
      console.warn('[jobs] 兑换 #' + p.id + ' 悬空 pending 已退款并取消（外部操作结果未知，请人工核对频道侧）');
    } catch (err) {
      try { await conn.rollback(); } catch (_) { /* ignore */ }
      console.error('[jobs] 清理悬空 pending #' + p.id + ' 出错：', err.message);
    } finally {
      conn.release();
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
