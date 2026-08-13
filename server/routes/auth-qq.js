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
const { requireAuth } = require('../middleware/auth');
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

// 检查当前用户 QQ 会话是否仍有效（单设备登录被踢后 token 失效）；失效则清理会话
router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  const rows = await query('SELECT qq_session_id FROM users WHERE id = ?', [req.user.id]);
  if (rows.length === 0 || !rows[0].qq_session_id) {
    return res.json({ valid: false, reason: 'no_session' });
  }
  const sid = rows[0].qq_session_id;
  const s = qqSessions.getSession(sid);
  if (!s || !s.token_obtained) {
    return res.json({ valid: false, reason: 'no_session' });
  }
  try {
    const status = await runCli(['login', 'status'], 10000, qqSessions.sessionEnv(s));
    const valid = !!(status && status.success && status.data && status.data.valid === true);
    if (!valid) {
      qqSessions.cleanupSession(sid);
      await query('UPDATE users SET qq_session_id = NULL WHERE id = ?', [req.user.id]);
    }
    return res.json({ valid });
  } catch (_) {
    return res.json({ valid: false, reason: 'error' });
  }
}));

// 把 QQ 会话关联到用户（不清理，供后续自动/手动识别轻应用使用）；顺带清理该用户旧的会话
async function linkSession(sessionId, userId) {
  const old = await query('SELECT qq_session_id FROM users WHERE id = ?', [userId]);
  if (old.length > 0 && old[0].qq_session_id && old[0].qq_session_id !== sessionId) {
    qqSessions.cleanupSession(old[0].qq_session_id);
  }
  await query('UPDATE users SET qq_session_id = ? WHERE id = ?', [sessionId, userId]);
  const s = qqSessions.getSession(sessionId);
  if (s) s.user_id = userId;
  qqSessions.markDirty();
  qqSessions.saveIndex();
}

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

// 已授权：从会话真实 token 反查 tiny_id + 频道昵称
// 注意：get-user-info（全局/频道）都不返回 tiny_id，只能靠 guild-member-search 拿（字段 tinyid）
// 关键坑：频道 get-user-info 的 nickname 是"频道内显示名"（可能带前缀/与全局昵称不同），
// 用它搜索可能搜不到人；必须把频道昵称、全局昵称、member_name 等全部作为关键词依次尝试。
async function resolveTinyId(s, env) {
  let nickname = '';
  let tinyId = '';
  try {
    const globalInfo = await runCli(['manage', 'get-user-info'], 10000, env);
    const gd = (globalInfo && globalInfo.data) || {};
    const globalNick = gd.nickname || gd.global_nickname || '';
    nickname = globalNick;

    if (config.guildId) {
      const guildInfo = await runCli(['manage', 'get-user-info', '--guild-id=' + config.guildId], 10000, env);
      const gi = (guildInfo && guildInfo.data) || {};
      const guildNick = gi.nickname || gi.member_name || gi.global_nickname || '';
      // 频道昵称优先用于展示；搜索关键词集合则同时包含频道/全局昵称
      if (guildNick) nickname = guildNick;

      // 搜索关键词去重集合：频道昵称、member_name、全局昵称、各自截断前缀
      const kwSet = new Set();
      const add = (v) => {
        const str = String(v || '').trim();
        if (str) kwSet.add(str);
      };
      add(gi.nickname);
      add(gi.member_name);
      add(gi.global_nickname);
      add(gd.nickname);
      add(gd.global_nickname);
      // 对带装饰前缀的昵称（如【摸鱼打杂】Cemetary），追加去前缀版本
      for (const kw of [...kwSet]) {
        const cleaned = kw.replace(/^[【\[\(（][^】\]\)）]+[】\]\)）]\s*/, '').trim();
        if (cleaned && cleaned !== kw) add(cleaned);
      }

      for (const kw of kwSet) {
        if (tinyId) break;
        const searchR = await runCli(
          ['manage', 'guild-member-search', '--guild-id=' + config.guildId, '--keyword=' + kw],
          10000,
          env
        );
        const members = (searchR && searchR.data && searchR.data.members) || [];
        if (members.length > 0) {
          tinyId = String(members[0].tinyid || members[0].tiny_id || '');
        }
      }
    }
  } catch (_) { /* 反查失败返回空，调用方处理 */ }

  // 更新 session 并标记（供 bind 复用）
  if (nickname) s.nickname = nickname;
  if (tinyId) s.tiny_id = tinyId;
  return { nickname, tinyId };
}

// 2. 轮询授权状态（扫码期间高频调用，不设限流）
router.post(
  '/poll',
  asyncHandler(async (req, res) => {
    const sessionId = String((req.body && req.body.session) || '');
    if (!sessionId) return res.status(400).json({ error: 'Missing session' });
    const s = qqSessions.getSession(sessionId);
    if (!s) return res.status(404).json({ error: '会话已过期，请重新扫码' });
    if (s.token_obtained) {
      // 快捷分支：已授权。但若 tiny_id 缺失（上次反查失败），必须重查，
      // 否则前端拿到 authorized 但 bind 仍失败 → 用户看到的"弹表单又报扫码"循环
      if (!s.tiny_id) {
        const envRetry = qqSessions.sessionEnv(s);
        const { tinyId: retryTinyId } = await resolveTinyId(s, envRetry);
        if (!retryTinyId) {
          return res.json({
            session: sessionId,
            status: 'pending_authorization',
            error: '已授权但无法识别你的 QQ 身份（频道成员搜索失败），请稍后重试或检查是否已加入频道',
          });
        }
      }
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

    // 已授权：取昵称 + tiny_id
    s.token_obtained = true;
    const { tinyId } = await resolveTinyId(s, env);

    // tiny_id 反查失败：不进入 bind（否则填完班级姓名 bind 才报"请先扫码授权"）。
    // 返回 pending_authorization + 明确错误，前端重试；bind 侧也有兜底重查。
    if (!tinyId) {
      return res.json({
        session: sessionId,
        status: 'pending_authorization',
        error: '已授权但无法识别你的 QQ 身份（频道成员搜索失败），请稍后重试或检查是否已加入频道',
      });
    }

    let bound = false;
    let user = null;
    const rows = await query('SELECT * FROM users WHERE qq_tiny_id = ?', [s.tiny_id]);
    if (rows.length > 0) { bound = true; user = rows[0]; }
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
    if (!s || !s.token_obtained) {
      return res.status(401).json({ error: '请先完成扫码授权' });
    }

    // 兜底：tiny_id 缺失时（poll 阶段反查失败/超时），用会话真实 token 再查一次
    if (!s.tiny_id) {
      const env = qqSessions.sessionEnv(s);
      const { tinyId } = await resolveTinyId(s, env);
      if (!tinyId) {
        return res.status(401).json({
          error: '无法识别你的 QQ 身份，请确认已加入频道后重新扫码，或稍后重试',
        });
      }
    }

    let class_name = String((req.body && req.body.class_name) || '').trim();
    let real_name = String((req.body && req.body.real_name) || '').trim();

    // 展示名授权：默认展示真实姓名；选「否」时昵称默认取频道昵称，仍为空则报错
    const showReal = req.body && req.body.show_real_name !== false && req.body.show_real_name !== 0 && req.body.show_real_name !== '0';
    let nickname = String((req.body && req.body.nickname) || '').trim().slice(0, 32) || s.nickname || null;
    if (!showReal && !nickname) {
      return res.status(400).json({ error: '选择只展示昵称后，请填写昵称' });
    }

    // 该 tiny_id 已绑定 → 直接登录（无需再填班级姓名）
    const byQq = await query('SELECT * FROM users WHERE qq_tiny_id = ?', [s.tiny_id]);
    if (byQq.length > 0) {
      await linkSession(sessionId, byQq[0].id);
      return res.json({ token: issue(byQq[0].id), user: publicUser(byQq[0]) });
    }

    class_name = config.normalizeClass(class_name);
    const isStandard = config.isStandardClass(class_name);
    if (isStandard && !real_name) {
      return res.status(400).json({ error: '请输入姓名' });
    }
    if (real_name.length > 32) {
      return res.status(400).json({ error: '姓名过长' });
    }
    if (!real_name) real_name = s.nickname || '同学';

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
      await linkSession(sessionId, u.id);
      return res.json({ token: issue(u.id), user: publicUser(u) });
    }

    const result = await query(
      'INSERT INTO users (class_name, real_name, qq_tiny_id, show_real_name, nickname) VALUES (?, ?, ?, ?, ?)',
      [class_name, real_name, s.tiny_id, showReal ? 1 : 0, nickname]
    );
    const created = { id: result.insertId, class_name, real_name, qq_tiny_id: s.tiny_id, show_real_name: showReal ? 1 : 0, nickname, points: 0, created_at: new Date() };
    // 首次登录奖励
    await grant(created.id, 'first_login', 'once');
    const fresh = await query('SELECT points FROM users WHERE id = ?', [created.id]);
    created.points = fresh.length ? fresh[0].points : 0;
    await linkSession(sessionId, created.id);
    return res.json({ token: issue(created.id), user: publicUser(created) });
  })
);

module.exports = router;
