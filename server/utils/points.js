'use strict';

// 轻量积分体系：积分发放 + 流水记录（唯一索引防重）
const { pool, query } = require('../db');

// 积分规则（⭐）
const RULES = {
  first_login: 10, // 首次登录（注册时发放，仅一次）
  read_article: 10, // 阅读课程 ≥1 分钟（每篇一次）
  task: 20, // 完成整章所有任务（每章一次，ref_id 用 article:<id>）
  app_submit: 25, // 提交 AI 轻应用（QQ 频道，每个作品一次）
  file_submit: 50, // 提交作品文件（每个文件一次）
  liked: 0, // （已废弃：被赞积分改由 like_receive 通过 CLI 增量发放）
  like_give: 2, // 主动点赞他人（网页操作，每次 +2⭐，每日上限 10）
  like_receive: 2, // 帖子被点赞（CLI 增量统计，每个赞 +2⭐，作者每日上限 30）
  graduate: 50, // 全课程毕业（5 章全部学完+任务全完成，仅一次）
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

module.exports = { RULES, grant, getPoints, spend };
