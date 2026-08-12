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
      'SELECT id, class_name, real_name, student_id_last4, must_change_password, created_at FROM users WHERE id = ?',
      [payload.uid]
    );
    if (rows.length === 0) {
      return res.status(401).json({ error: '用户不存在' });
    }
    req.user = rows[0];
    // 首次登录未改密：仅放行查询本人与改密，其余接口一律拦截
    if (rows[0].must_change_password === 1) {
      const allowed = req.path === '/me' || req.path === '/change-password';
      if (!allowed) {
        return res.status(403).json({ error: '请先修改初始密码', code: 'MUST_CHANGE_PASSWORD' });
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
