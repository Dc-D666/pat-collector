'use strict';

const express = require('express');
const config = require('../config');
const { query } = require('../db');
const { issue } = require('../utils/token');
const { hashPassword, verifyPassword } = require('../utils/password');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../utils/rateLimit');

const router = express.Router();

const DEFAULT_PASSWORD = '123456';

function publicUser(row) {
  return {
    id: row.id,
    class_name: row.class_name,
    real_name: row.real_name,
    student_id_last4: row.student_id_last4,
    created_at: row.created_at,
    must_change_password: !!row.must_change_password,
  };
}

function validateIdentity(body) {
  const class_name = String(body.class_name || '').trim();
  const real_name = String(body.real_name || '').trim();
  const student_id_last4 = String(body.student_id_last4 || '').trim();
  if (!config.classes.includes(class_name)) {
    return { error: '班级不在白名单内' };
  }
  if (real_name.length < 1 || real_name.length > 32) {
    return { error: '请输入真实姓名' };
  }
  if (!/^\d{4}$/.test(student_id_last4)) {
    return { error: '学号后4位需为4位数字' };
  }
  return { class_name, real_name, student_id_last4 };
}

const ipKey = (req) => req.ip || req.connection.remoteAddress || 'unknown';

// 注册：班级 + 姓名 + 学号后4位，初始密码 123456，注册即登录
router.post(
  '/register',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const v = validateIdentity(req.body || {});
    if (v.error) return res.status(400).json({ error: v.error });

    const existing = await query(
      'SELECT id FROM users WHERE class_name = ? AND real_name = ? AND student_id_last4 = ?',
      [v.class_name, v.real_name, v.student_id_last4]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: '该身份已注册，请直接登录' });
    }

    const hash = hashPassword(DEFAULT_PASSWORD);
    let result;
    try {
      result = await query(
        'INSERT INTO users (class_name, real_name, student_id_last4, password_hash) VALUES (?, ?, ?, ?)',
        [v.class_name, v.real_name, v.student_id_last4, hash]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: '该身份已注册，请直接登录' });
      }
      throw err;
    }
    const inserted = await query('SELECT created_at FROM users WHERE id = ?', [result.insertId]);
    const user = {
      id: result.insertId,
      class_name: v.class_name,
      real_name: v.real_name,
      student_id_last4: v.student_id_last4,
      created_at: inserted[0].created_at,
      must_change_password: 1,
    };
    return res.json({ token: issue(user.id), user: publicUser(user) });
  })
);

// 登录：班级/姓名/学号后4位 + 密码
router.post(
  '/login',
  rateLimit({ windowMs: 10 * 60 * 1000, max: 30, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const class_name = String(body.class_name || '').trim();
    const real_name = String(body.real_name || '').trim();
    const student_id_last4 = String(body.student_id_last4 || '').trim();
    const password = String(body.password || '');

    const rows = await query(
      'SELECT * FROM users WHERE class_name = ? AND real_name = ? AND student_id_last4 = ?',
      [class_name, real_name, student_id_last4]
    );
    if (rows.length === 0 || !verifyPassword(password, rows[0].password_hash)) {
      return res.status(401).json({ error: '班级/姓名/学号或密码不正确' });
    }
    return res.json({
      token: issue(rows[0].id),
      user: publicUser(rows[0]),
      must_change_password: !!rows[0].must_change_password,
    });
  })
);

// 当前用户
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

// 修改密码：需旧密码，新密码 ≥ 4 位；首次改密后清除强制改密标志
router.post(
  '/change-password',
  rateLimit({ windowMs: 10 * 60 * 1000, max: 15, keyFn: ipKey }),
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const oldPassword = String(body.old_password || '');
    const newPassword = String(body.new_password || '');

    const rows = await query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!verifyPassword(oldPassword, rows[0].password_hash)) {
      return res.status(400).json({ error: '旧密码不正确' });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ error: '新密码至少 4 位' });
    }
    if (newPassword === DEFAULT_PASSWORD) {
      return res.status(400).json({ error: '请勿使用默认密码 123456' });
    }
    await query('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?', [
      hashPassword(newPassword),
      req.user.id,
    ]);
    return res.json({ ok: true });
  })
);

module.exports = router;
