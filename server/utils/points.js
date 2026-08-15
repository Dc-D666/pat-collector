'use strict';

// 轻量积分体系：积分发放 + 流水记录（唯一索引防重）
const { pool, query } = require('../db');

// 积分规则（⭐）
// 计数上限：reason 的历史发放次数达到上限后不再发放（删除/回扣不释放名额，防刷分）
const REASON_CAPS = { file_submit: 5, app_submit: 3 };
const RULES = {
  first_login: 10, // 首次登录（注册时发放，仅一次）
  read_article: 8, // 阅读课程 ≥1 分钟（每篇一次；P3 微降 10→8）
  task: 15, // 完成整章所有任务（每章一次；P3 微降 20→15）
  app_submit: 15, // 提交 AI 轻应用（QQ 频道，每个作品一次；每人最多计 3 个）
  file_submit: 25, // 提交作品文件（每个文件一次；每人最多计 5 个；P3 30→25）
  liked: 0, // （已废弃：被赞积分改由 like_receive 通过 CLI 增量发放）
  like_give: 2, // 主动点赞他人（网页操作，每次 +2⭐，每日上限 10）
  like_receive: 2, // 帖子被点赞（CLI 增量统计，每个赞 +2⭐，作者每日上限 30）
  graduate: 40, // 全课程毕业（P3 50→40）
  easter_egg: 5, // 彩蛋（连续点击顶栏积分徽章 5 次触发，仅一次）
};

/**
 * 给用户发放积分。幂等：同一 (user, reason, refId) 只发一次。
 * @returns {number|null} 实际发放的积分数；已发过返回 null
 */
async function grant(userId, reason, refId, extraAmount) {
  const amount = extraAmount != null ? extraAmount : RULES[reason];
  if (!amount || amount <= 0) return null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // 用户行锁：串行化同一用户的并发发放，保证 REASON_CAPS 计数上限与幂等防重在并发下依然成立
    await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    // 计数上限：该 reason 历史发放达上限则跳过（file_submit ≤5 个 / app_submit ≤3 个）
    const cap = REASON_CAPS[reason];
    if (cap) {
      const [cntRows] = await conn.execute('SELECT COUNT(*) AS c FROM points_log WHERE user_id = ? AND reason = ?', [userId, reason]);
      if (Number(cntRows[0].c) >= cap) {
        await conn.commit();
        return null;
      }
    }
    // 防重：唯一索引 (user_id, reason, ref_id)，冲突则跳过
    const [ins] = await conn.execute(
      'INSERT IGNORE INTO points_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)',
      [userId, amount, reason, String(refId || '')]
    );
    if (ins.affectedRows === 0) {
      await conn.commit();
      return null; // 已发过
    }
    await conn.execute('UPDATE users SET points = points + ? WHERE id = ?', [amount, userId]);
    await conn.commit();
    return amount;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// 查询用户积分与流水
async function getPoints(userId) {
  const rows = await query('SELECT points FROM users WHERE id = ?', [userId]);
  const logs = await query(
    'SELECT id, amount, reason, ref_id, created_at FROM points_log WHERE user_id = ? ORDER BY id DESC LIMIT 50',
    [userId]
  );
  const reasonText = {
    first_login: '首次登录奖励',
    read_article: '阅读课程',
    task: '完成任务',
    app_submit: '提交 AI 轻应用',
    file_submit: '提交作品文件',
    liked: '作品被点赞',
    like_give: '点赞他人',
    like_receive: '作品被点赞',
    graduate: '课程毕业奖励',
    easter_egg: '彩蛋奖励',
    purchase: '积分商城兑换',
    admin_adjust: '管理员调整',
    file_submit_restore: '审核通过补发',
    file_submit_revoke: '删除作品文件（回扣）',
    app_submit_revoke: '删除轻应用（回扣）',
  };
  return {
    points: rows.length ? rows[0].points : 0,
    logs: logs.map((l) => ({
      id: l.id,
      amount: l.amount,
      reason: l.reason,
      reason_text: reasonText[l.reason] || l.reason,
      ref_id: l.ref_id,
      created_at: l.created_at,
    })),
  };
}

/**
 * 消费积分（积分商城兑换）。事务：余额检查 → 扣分 → 记负数流水 → 写消费记录。
 * @returns {{ok: boolean, points: number, purchase_id?: number} | {ok:false, error:string}}
 */
async function spend(userId, { item, cost, refType = '', refId = 0, feedId = '', feedExtra = '', title = '', expiresAt = null }) {
  if (!cost || cost <= 0) return { ok: false, error: '参数错误' };
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.execute('SELECT points FROM users WHERE id = ? FOR UPDATE', [userId]);
    const balance = rows.length ? Number(rows[0].points) : 0;
    if (balance < cost) {
      await conn.rollback();
      return { ok: false, error: '积分不足' };
    }
    await conn.execute('UPDATE users SET points = points - ? WHERE id = ?', [cost, userId]);
    await conn.execute(
      'INSERT INTO points_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)',
      [userId, -cost, 'purchase', item + ':' + (refId || title || feedId || 'x')]
    );
    const [ins] = await conn.execute(
      `INSERT INTO purchases (user_id, item, cost, ref_type, ref_id, feed_id, feed_extra, title, status, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [userId, item, cost, refType, refId, feedId, feedExtra, title, expiresAt]
    );
    await conn.commit();
    return { ok: true, points: balance - cost, purchase_id: ins.insertId };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 撤销积分（删除文件/应用等回扣对应奖励）：事务内扣回原发放金额，写负数流水（reason + '_revoke'）。
 * @returns {number|null} 回扣的积分数；无原发放记录返回 null
 */
async function revoke(userId, reason, refId) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [logs] = await conn.execute(
      'SELECT amount FROM points_log WHERE user_id = ? AND reason = ? AND ref_id = ?',
      [userId, reason, refId]
    );
    if (logs.length === 0) {
      await conn.commit();
      return null;
    }
    const amount = Number(logs[0].amount);
    if (amount <= 0) {
      await conn.commit();
      return null;
    }
    await conn.execute('UPDATE users SET points = points - ? WHERE id = ?', [amount, userId]);
    await conn.execute(
      'INSERT INTO points_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)',
      [userId, -amount, reason + '_revoke', refId]
    );
    await conn.commit();
    return amount;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/**
 * 带每日上限的积分发放（点赞双向发分用）：用户行锁 + 事务内「SUM 每日已发 → 防重插入 → 更新余额」，
 * 并发下也不会突破 dailyCap（L4 修复：替代原"先查 SUM 再 grant"的非原子检查）。
 * @returns {number} 实际发放积分数（到上限或已发过返回 0）
 */
async function grantCapped(userId, reason, refId, amount, dailyCap) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    const [earned] = await conn.execute(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM points_log WHERE user_id = ? AND reason = ? AND DATE(created_at) = CURDATE()',
      [userId, reason]
    );
    if (Number(earned[0].total) >= dailyCap) {
      await conn.commit();
      return 0;
    }
    const [ins] = await conn.execute(
      'INSERT IGNORE INTO points_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)',
      [userId, amount, reason, String(refId || '')]
    );
    if (ins.affectedRows === 0) {
      await conn.commit();
      return 0;
    }
    await conn.execute('UPDATE users SET points = points + ? WHERE id = ?', [amount, userId]);
    await conn.commit();
    return amount;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { RULES, grant, grantCapped, getPoints, spend, revoke };
