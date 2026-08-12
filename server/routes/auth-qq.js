'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const config = require('../config');
const { query } = require('../db');
const { issue } = require('../utils/token');
const { asyncHandler } = require('../utils/async');
const { runCli } = require('../qq/proxy');
const qqSessions = require('../qq/sessions');
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

// 1. 发起扫码登录：创建隔离会话 → CLI login 拿二维码
router.post(
  '/init',
  rateLimit({ windowMs: 10 * 60 * 1000, max: 30, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const sessionId = qqSessions.createSession();
    const s = qqSessions.getSession(sessionId);
    const qrcodePath = path.join(s.homeDir, 'login-qrcode.png');
    const env = qqSessions.sessionEnv(s);
    const result = await runCli(['login', '--yes', `--qrcode-path=${qrcodePath}`], 30000, env);
    if (!result || result.success === false) {
      qqSessions.cleanupSession(sessionId);
      return res.json({
        session: sessionId,
        error: (result && result.error && result.error.message) || 'CLI 返回未知错误',
        qrcode_base64: '',
        verification_uri: '',
        expires_in_s: 0,
      });
    }
    let qrcodeBase64 = (result.data && result.data.qr_code) || '';
    if (!qrcodeBase64 && fs.existsSync(qrcodePath)) {
      qrcodeBase64 = fs.readFileSync(qrcodePath).toString('base64');
    }
    return res.json({
      session: sessionId,
      verification_uri: (result.data && result.data.verification_uri) || '',
      qrcode_base64: qrcodeBase64,
      expires_in_s: (result.data && result.data.expires_in_s) || 120,
    });
  })
);

// 2. 轮询授权状态（扫码期间高频调用，不设限流）
router.post(
  '/poll',
  asyncHandler(async (req, res) => {
    const sessionId = String((req.body && req.body.session) || '');
    if (!sessionId) return res.status(400).json({ error: 'Missing session' });
    const s = qqSessions.getSession(sessionId);
    if (!s) return res.status(404).json({ error: '会话已过期，请重新扫码' });
    if (s.token_obtained) {
      return res.json({
        session: sessionId,
        status: 'authorized',
        tiny_id: s.tiny_id,
        nickname: s.nickname,
        bound: !!s.bound_user,
        user: s.bound_user ? publicUser(s.bound_user) : undefined,
      });
    }
    const env = qqSessions.sessionEnv(s);
    let result;
    try {
      result = await runCli(['login', 'poll-token'], 25000, env);
    } catch (err) {
      return res.json({ session: sessionId, status: 'pending_authorization', error: '令牌检查失败' });
    }
    if (!result || !result.success) {
      return res.json({
        session: sessionId,
        status: 'pending_authorization',
        error: (result && result.error && result.error.message) || '',
      });
    }
    const isAuthorized = (result.data && result.data.status === 'authorized') || result.status === 'authorized';
    if (!isAuthorized) {
      return res.json({ session: sessionId, status: 'pending', error: '' });
    }

    // 已授权：取 QQ 身份 tiny_id + nickname（全局接口，防御式字段探测）
    s.token_obtained = true;
    try {
      const globalInfo = await runCli(['manage', 'get-user-info'], 10000, env);
      const d = (globalInfo && globalInfo.data) || {};
      s.tiny_id = String(d.tiny_id || d.tinyid || d.user_id || d.id || d.openid || d.uid || '');
      s.nickname = d.nickname || d.global_nickname || '';
    } catch (_) { /* tiny_id 为空则后续 bind 会拒绝 */ }

    let bound = false;
    let user = null;
    if (s.tiny_id) {
      const rows = await query('SELECT * FROM users WHERE qq_tiny_id = ?', [s.tiny_id]);
      if (rows.length > 0) { bound = true; user = rows[0]; }
    }
    s.bound_user = user;
    return res.json({
      session: sessionId,
      status: 'authorized',
      tiny_id: s.tiny_id,
      nickname: s.nickname,
      bound,
      user: user ? publicUser(user) : undefined,
    });
  })
);

// 3. 绑定：已绑定则直接登录；未绑定需班级+姓名
router.post(
  '/bind',
  rateLimit({ windowMs: 10 * 60 * 1000, max: 30, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const sessionId = String((req.body && req.body.session) || '');
    const s = qqSessions.getSession(sessionId);
    if (!s || !s.token_obtained || !s.tiny_id) {
      return res.status(401).json({ error: '请先完成扫码授权' });
    }
    const class_name = String((req.body && req.body.class_name) || '').trim();
    const real_name = String((req.body && req.body.real_name) || '').trim();

    // 该 tiny_id 已绑定 → 直接登录（无需再填班级姓名）
    const byQq = await query('SELECT * FROM users WHERE qq_tiny_id = ?', [s.tiny_id]);
    if (byQq.length > 0) {
      qqSessions.cleanupSession(sessionId);
      return res.json({ token: issue(byQq[0].id), user: publicUser(byQq[0]) });
    }

    if (!config.classes.includes(class_name)) {
      return res.status(400).json({ error: '班级不在白名单内' });
    }
    if (real_name.length < 1 || real_name.length > 32) {
      return res.status(400).json({ error: '请输入真实姓名' });
    }

    const byName = await query(
      'SELECT * FROM users WHERE class_name = ? AND real_name = ?',
      [class_name, real_name]
    );
    if (byName.length > 0) {
      const u = byName[0];
      if (u.qq_tiny_id && u.qq_tiny_id !== s.tiny_id) {
        return res.status(409).json({ error: '该姓名已绑定其他 QQ，请勿冒用' });
      }
      await query('UPDATE users SET qq_tiny_id = ? WHERE id = ?', [s.tiny_id, u.id]);
      u.qq_tiny_id = s.tiny_id;
      qqSessions.cleanupSession(sessionId);
      return res.json({ token: issue(u.id), user: publicUser(u) });
    }

    const result = await query(
      'INSERT INTO users (class_name, real_name, qq_tiny_id) VALUES (?, ?, ?)',
      [class_name, real_name, s.tiny_id]
    );
    const created = { id: result.insertId, class_name, real_name, qq_tiny_id: s.tiny_id, created_at: new Date() };
    qqSessions.cleanupSession(sessionId);
    return res.json({ token: issue(created.id), user: publicUser(created) });
  })
);

module.exports = router;
