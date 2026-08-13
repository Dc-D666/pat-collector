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

module.exports = { RULES, grant, getPoints };
