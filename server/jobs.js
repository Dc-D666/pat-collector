'use strict';

// 后台定时任务：积分兑换到期自动回收（频道置顶/精华 24h 后自动取消）
// （被赞积分已改为站内点赞直接发放，不再走 CLI 统计）
// P1 修复（2026-08-21）：
//  1. 查询补上 feed_extra——取消置顶需要帖子 create_time，此前未选中导致恒为 "0" 而取消失败；
//  2. CLI 取消失败时保持 active，下轮重试（不再无条件标记 expired 导致永不重试）；
//  3. 清理悬空 pending 记录（两阶段兑换在外部操作后崩溃遗留）：超时未结算 → 退款并标记 cancelled。
const config = require('./config');
const fs = require('fs');
const path = require('path');
const { query, pool } = require('./db');
const qqSessions = require('./qq/sessions');
const proxy = require('./qq/proxy');
const genApp = require('./utils/genApp');

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

// 从帖子详情推断置顶/精华是否已生效（尽力而为）：
// 返回 true=已生效 / false=明确未生效 / null=字段缺失无法判定（走人工确认）
function feedBoostActive(feed) {
  if (!feed) return null;
  const hasTop = feed.is_top !== undefined || feed.top_level !== undefined || feed.top !== undefined;
  const hasEssence = feed.is_essence !== undefined || feed.essence !== undefined;
  if (!hasTop && !hasEssence) return null;
  const topActive = feed.is_top === true || feed.top === true || Number(feed.top_level) === 1;
  const essActive = feed.is_essence === true || feed.essence === 1 || feed.essence === true;
  return topActive || essActive;
}

// 清理悬空 pending（两阶段兑换在"外部操作成功后、结算前"进程崩溃遗留）。
// R3-1（2026-08-21）：不再按超时盲目退款——pending 残留最可能对应"外部已生效"，
// 自动退款会造成"用户退款但帖子仍置顶/加精"。改为查询频道帖子状态：
//   已生效 → 转 active（积分保留，功能有效）
//   明确未生效 → 退款 + cancelled
//   无法判定（无会话/字段缺失/CLI 异常）→ 保持 pending，写警告，人工核对
async function sweepStalePending() {
  let rows = [];
  try {
    rows = await query(
      `SELECT id, user_id, cost, item, feed_id FROM purchases
       WHERE status = 'pending' AND created_at < (NOW() - INTERVAL 10 MINUTE)`
    );
  } catch (err) {
    console.error('[jobs] 查询悬空 pending 失败：', err.message);
    return;
  }
  for (const p of rows) {
    // 先取会话（外部查询需要用户 QQ 会话；无会话则无法判定）
    const userRows = await query('SELECT qq_session_id FROM users WHERE id = ?', [p.user_id]);
    const sid = userRows.length ? userRows[0].qq_session_id : '';
    const sess = sid ? qqSessions.getSession(sid) : null;
    let state = null; // true=生效 false=未生效 null=无法判定
    if (sess && sess.token_obtained && p.feed_id) {
      try {
        const env = qqSessions.sessionEnv(sess);
        const detail = await proxy.runCli(
          ['feed', 'get-feed-detail', '--feed-id=' + p.feed_id, '--guild-id=' + config.guildId],
          15000,
          env
        );
        const dd = (detail && detail.data) || {};
        state = feedBoostActive(dd.feed || dd);
      } catch (_) { state = null; }
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // 行锁防与结算并发；仅 pending 可处理
      const [lock] = await conn.execute(
        "SELECT user_id, cost FROM purchases WHERE id = ? AND status = 'pending' FOR UPDATE",
        [p.id]
      );
      if (lock.length === 0) {
        await conn.rollback();
        conn.release();
        continue;
      }
      if (state === true) {
        // 外部已生效：转 active（不退款），用户获得应有服务
        await conn.execute("UPDATE purchases SET status = 'active' WHERE id = ?", [p.id]);
        await conn.commit();
        console.warn('[jobs] 兑换 #' + p.id + ' 悬空 pending 检测到外部已生效，已转 active');
        continue;
      }
      if (state === false) {
        // 明确未生效：退款 + cancelled
        await conn.execute('UPDATE users SET points = points + ? WHERE id = ?', [lock[0].cost, lock[0].user_id]);
        await conn.execute(
          'INSERT INTO points_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)',
          [lock[0].user_id, lock[0].cost, 'purchase_refund', 'purchase:' + p.id]
        );
        await conn.execute("UPDATE purchases SET status = 'cancelled' WHERE id = ?", [p.id]);
        await conn.commit();
        console.warn('[jobs] 兑换 #' + p.id + ' 悬空 pending 确认未生效，已退款并取消');
        continue;
      }
      // 无法判定：不退款、不取消，保持 pending 待人工核对
      await conn.rollback();
      console.error('[jobs] 兑换 #' + p.id + ' 悬空 pending 无法确认外部状态（无会话/字段缺失/CLI 异常），' +
        '保持 pending，需人工核对频道侧后手动处理（feed_id=' + (p.feed_id || '-') + '）');
    } catch (err) {
      try { await conn.rollback(); } catch (_) { /* ignore */ }
      console.error('[jobs] 清理悬空 pending #' + p.id + ' 出错：', err.message);
    } finally {
      conn.release();
    }
  }
}

// 清理超期生成草稿（storage/tmp-gen/<userId>/*.html，TTL 宽容到 2h）
async function sweepStaleGenDrafts() {
  const root = genApp.genTmpDir();
  try {
    const users = await fs.promises.readdir(root).catch(() => []);
    const now = Date.now();
    for (const u of users) {
      const dir = path.join(root, u);
      const files = await fs.promises.readdir(dir).catch(() => []);
      for (const f of files) {
        const p = path.join(dir, f);
        try {
          const st = await fs.promises.stat(p);
          if (now - st.mtimeMs > 2 * 3600 * 1000) await fs.promises.unlink(p);
        } catch (_) { /* 忽略单个文件失败 */ }
      }
      // 目录空则顺手移除
      const rest = await fs.promises.readdir(dir).catch(() => ['x']);
      if (rest.length === 0) await fs.promises.rmdir(dir).catch(() => {});
    }
  } catch (_) { /* 目录不存在等：忽略 */ }
}

function startJobs() {
  const timer = setInterval(() => {
    sweepExpiredChannelBoosts().catch((err) => console.error('[jobs] sweep 异常：', err.message));
  }, CHECK_INTERVAL_MS);
  if (timer.unref) timer.unref();
  // 启动后立即扫一次
  sweepExpiredChannelBoosts().catch((err) => console.error('[jobs] 启动 sweep 异常：', err.message));

  // 生成草稿清理：每 20 分钟一次，启动后 5 分钟首扫
  const genTimer = setInterval(() => {
    sweepStaleGenDrafts().catch(() => {});
  }, 20 * 60 * 1000);
  if (genTimer.unref) genTimer.unref();
  setTimeout(() => sweepStaleGenDrafts().catch(() => {}), 5 * 60 * 1000).unref?.();

  console.log('[jobs] 已启动：置顶/精华自动回收（10 分钟）；帖子被赞积分由「我的积分」页按用户触发');
}

module.exports = { startJobs, sweepExpiredChannelBoosts };
