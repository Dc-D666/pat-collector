'use strict';

const { verify } = require('../utils/token');
const { query } = require('../db');

// 校验 Bearer token 并加载用户到 req.user；失败返回 401
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: '未登录' });
  }
  const payload = verify(token);
  if (!payload) {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
  try {
    const rows = await query(
      'SELECT id, class_name, real_name, qq_tiny_id, created_at FROM users WHERE id = ?',
      [payload.uid]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: '用户不存在' });
    }
    req.user = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
