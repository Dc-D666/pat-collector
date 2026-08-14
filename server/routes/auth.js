'use strict';

const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { query } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../utils/rateLimit');
const { grant } = require('../utils/points');
const { hashPassword } = require('../utils/pwd');

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
    is_admin: row.is_admin === 1,
    status: row.status || 'active',
    created_at: row.created_at,
  };
}

const ipKey = (req) => req.ip || req.connection.remoteAddress || 'unknown';

// 生成访客直传令牌：64 位十六进制长随机串（不可猜测，作为项目地址的访问凭证）
function newGuestToken() {
  return crypto.randomBytes(32).toString('hex');
}

// 确保用户持有 guest_token（无则生成并落库）；返回 guest_token
async function ensureGuestToken(userId) {
  const rows = await query('SELECT guest_token FROM users WHERE id = ?', [userId]);
  if (rows.length && rows[0].guest_token) return rows[0].guest_token;
  const token = newGuestToken();
  await query('UPDATE users SET guest_token = ? WHERE id = ?', [token, userId]);
  return token;
}

// 年级 → 班级 二级菜单结构（供前端渲染，单一数据源在 config.js）
router.get('/classes', (req, res) => {
  res.json({
    grades: config.grades.map((g) => ({ name: g.name, classes: config.classesByGrade[g.name] })),
  });
});

// 上传规则（公开）：前端提交前校验文件类型/大小，避免"先提交成功、后提示文件失败"
router.get('/upload-rules', (req, res) => {
  res.json({
    allowed_extensions: [...config.allowedExtensions],
    text_formats: [...config.textFormats],
    max_upload_mb: Math.round(config.maxUploadBytes / 1024 / 1024),
  });
});

// 访客直传：姓名 + 班级 + 展示名授权 → 建/取用户并签发「项目地址」令牌。
// 注意：不签发系统 Bearer 令牌——访客只走直传表单与项目地址页，不进入系统。
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
    // 「其他」年级：班级必填，仅接受 4 位班级号（毕业生）或 0（外校）
    if (!isStandard) {
      if (!class_name || (class_name !== '0' && !/^\d{4}$/.test(class_name))) {
        return res.status(400).json({ error: '毕业生请填自己班级（4 位数字），外校请填 0' });
      }
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

    // 访客删除安全密码（选填）：留空存 NULL（校验时按默认密码比对）；自定义则 scrypt 加盐哈希
    const guestPwd = String((req.body && req.body.guest_pwd) || '').trim();
    if (guestPwd.length > 64) {
      return res.status(400).json({ error: '安全密码过长（最多 64 位）' });
    }
    const guestPwdHash = guestPwd ? hashPassword(guestPwd) : null;

    const existing = await query(
      'SELECT * FROM users WHERE class_name = ? AND real_name = ?',
      [class_name, real_name]
    );
    let row;
    if (existing.length > 0) {
      // 停用用户：拒绝登记（已有文件保留，可下载）
      if (existing[0].status !== 'active') {
        return res.status(403).json({ error: '账号已停用，无法提交作品' });
      }
      row = existing[0];
    } else {
      const result = await query(
        'INSERT INTO users (class_name, real_name, show_real_name, nickname, guest_pwd_hash) VALUES (?, ?, ?, ?, ?)',
        [class_name, real_name, showReal ? 1 : 0, nickname, guestPwdHash]
      );
      // 首次登录奖励（与旧流程一致；访客积分在系统内可见，直传本身不展示）
      await grant(result.insertId, 'first_login', 'once');
      const fresh = await query('SELECT * FROM users WHERE id = ?', [result.insertId]);
      row = fresh[0];
    }

    const guestToken = await ensureGuestToken(row.id);
    return res.json({
      token: guestToken,
      project_path: '#/p/' + guestToken,
      user: publicUser(row),
      max_upload_mb: Math.round(config.maxUploadBytes / 1024 / 1024),
      max_uploads_per_day: config.guestMaxUploadsPerDay,
    });
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
