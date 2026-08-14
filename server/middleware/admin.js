'use strict';

const { requireAuth } = require('./auth');

// 管理接口鉴权：先 requireAuth 加载用户，再校验 is_admin；停用用户由 requireAuth 统一拦截
function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (!req.user || req.user.is_admin !== 1) {
      return res.status(403).json({ error: '无管理员权限' });
    }
    next();
  });
}

module.exports = { requireAdmin };
