'use strict';

const express = require('express');
const config = require('../config');
const { query } = require('../db');
const { issue } = require('../utils/token');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../utils/rateLimit');

const router = express.Router();

function publicUser(row) {
  return {
    id: row.id,
    class_name: row.class_name,
    real_name: row.real_name,
    is_qq_bound: !!row.qq_tiny_id,
    created_at: row.created_at,
  };
}

const ipKey = (req) => req.ip || req.connection.remoteAddress || 'unknown';

// 年级 → 班级 二级菜单结构（供前端渲染，单一数据源在 config.js）
router.get('/classes', (req, res) => {
  res.json({
    grades: config.grades.map((g) => ({ name: g.name, classes: config.classesByGrade[g.name] })),
  });
});

// 无 QQ 直通：姓名 + 班级，直接放行进入系统（无密码、无学号）
router.post(
  '/guest',
  rateLimit({ windowMs: 10 * 60 * 1000, max: 30, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    let class_name = config.normalizeClass((req.body && req.body.class_name) || '');
    let real_name = String((req.body && req.body.real_name) || '').trim();
    const isStandard = config.isStandardClass(class_name);

    // 标准年级：姓名必填；「其他」：姓名选填（缺省用「同学」）
    if (isStandard && !real_name) {
      return res.status(400).json({ error: '请输入姓名' });
    }
    if (real_name.length > 32) {
      return res.status(400).json({ error: '姓名过长' });
    }
    if (!real_name) real_name = '同学';

    const existing = await query(
      'SELECT * FROM users WHERE class_name = ? AND real_name = ?',
      [class_name, real_name]
    );
    if (existing.length > 0) {
      return res.json({ token: issue(existing[0].id), user: publicUser(existing[0]) });
    }

    const result = await query(
      'INSERT INTO users (class_name, real_name) VALUES (?, ?)',
      [class_name, real_name]
    );
    const created = { id: result.insertId, class_name, real_name, qq_tiny_id: null, created_at: new Date() };
    return res.json({ token: issue(created.id), user: publicUser(created) });
  })
);

// 当前用户
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

module.exports = router;
