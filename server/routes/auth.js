'use strict';

const express = require('express');
const config = require('../config');
const { query } = require('../db');
const { issue } = require('../utils/token');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../utils/rateLimit');
const { grant } = require('../utils/points');

const router = express.Router();

function publicUser(row) {
  const showReal = row.show_real_name !== 0; // 默认展示真实姓名
  return {
    id: row.id,
    class_name: row.class_name,
    real_name: row.real_name,
    display_name: showReal ? row.real_name : (row.nickname || row.real_name),
    show_real_name: showReal,
    nickname: row.nickname || '',
    points: row.points || 0,
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

    // 展示名授权：show_real_name 默认 1（是）；选「否」时校验昵称
    const showReal = req.body && req.body.show_real_name !== false && req.body.show_real_name !== 0 && req.body.show_real_name !== '0';
    let nickname = String((req.body && req.body.nickname) || '').trim().slice(0, 32) || null;
    if (!showReal && !nickname) {
      return res.status(400).json({ error: '选择只展示昵称后，请填写昵称' });
    }

    const existing = await query(
      'SELECT * FROM users WHERE class_name = ? AND real_name = ?',
      [class_name, real_name]
    );
    if (existing.length > 0) {
      return res.json({ token: issue(existing[0].id), user: publicUser(existing[0]) });
    }

    const result = await query(
      'INSERT INTO users (class_name, real_name, show_real_name, nickname) VALUES (?, ?, ?, ?)',
      [class_name, real_name, showReal ? 1 : 0, nickname]
    );
    const created = { id: result.insertId, class_name, real_name, qq_tiny_id: null, show_real_name: showReal ? 1 : 0, nickname, points: 0, created_at: new Date() };
    // 首次登录奖励
    await grant(created.id, 'first_login', 'once');
    const fresh = await query('SELECT points FROM users WHERE id = ?', [created.id]);
    created.points = fresh.length ? fresh[0].points : 0;
    return res.json({ token: issue(created.id), user: publicUser(created) });
  })
);

// 当前用户（附上传大小上限，供前端上传前预检）
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), max_upload_mb: Math.round(config.maxUploadBytes / 1024 / 1024) });
});

// 修改展示名授权（是否展示真实姓名 / 昵称）
router.patch(
  '/profile',
  requireAuth,
  rateLimit({ windowMs: 10 * 60 * 1000, max: 30, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const showReal = body.show_real_name !== false && body.show_real_name !== 0 && body.show_real_name !== '0';
    let nickname = String(body.nickname || '').trim().slice(0, 32) || null;
    if (!showReal && !nickname) {
      return res.status(400).json({ error: '选择只展示昵称后，请填写昵称' });
    }
    await query('UPDATE users SET show_real_name = ?, nickname = ? WHERE id = ?', [
      showReal ? 1 : 0,
      nickname,
      req.user.id,
    ]);
    const rows = await query(
      'SELECT id, class_name, real_name, qq_tiny_id, show_real_name, nickname, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    return res.json({ user: publicUser(rows[0]) });
  })
);

module.exports = router;
