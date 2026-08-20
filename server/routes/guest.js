'use strict';

// 访客直传：仅凭「项目地址令牌」（users.guest_token，长随机串）访问本人的上传/列表/下载/预览。
// 访客不进入系统（无 Bearer 系统令牌），所有能力都在这一个页面内闭环。

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { query } = require('../db');
const { asyncHandler } = require('../utils/async');
const { rateLimit } = require('../utils/rateLimit');
const { revoke } = require('../utils/points');
const { verifyPassword } = require('../utils/pwd');
const { runMulter, ensureDiskSpace, runUploadPipeline, sanitizeName, extOf } = require('../utils/upload');

const router = express.Router();

const ipKey = (req) => req.ip || req.connection.remoteAddress || 'unknown';

function displayNameOf(row) {
  const showReal = row.show_real_name !== 0;
  return {
    class_name: row.class_name,
    real_name: row.real_name,
    display_name: showReal ? row.real_name : (row.nickname || row.real_name),
    show_real_name: showReal,
    nickname: row.nickname || '',
  };
}

// 从 query / multipart 字段 / 请求头取访客令牌
function guestTokenOf(req) {
  return String(req.query.token || (req.body && req.body.token) || req.headers['x-guest-token'] || '').trim();
}

// 校验访客令牌 → 返回用户行；无效返回 null
async function loadGuestByToken(token) {
  if (!token) return null;
  const rows = await query('SELECT * FROM users WHERE guest_token = ?', [token]);
  return rows.length ? rows[0] : null;
}

// 校验访客令牌 + 账号状态；无效/停用已发送响应，返回 null
async function loadActiveGuest(req, res) {
  const user = await loadGuestByToken(guestTokenOf(req));
  if (!user) {
    res.status(401).json({ error: '项目地址无效或已失效' });
    return null;
  }
  if (user.status !== 'active') {
    res.status(401).json({ error: '账号已停用' });
    return null;
  }
  return user;
}

// 今日已上传次数
async function uploadsToday(userId) {
  const [cnt] = await query(
    'SELECT COUNT(*) AS c FROM upload_log WHERE user_id = ? AND DATE(created_at) = CURDATE()',
    [userId]
  );
  return Number(cnt.c);
}

// 文件列表 + 身份 + 额度信息（项目地址页数据源）
router.get(
  '/files',
  asyncHandler(async (req, res) => {
    const user = await loadActiveGuest(req, res);
    if (!user) return;

    const [rows, cnt] = await Promise.all([
      query(
        'SELECT id, original_name, size, mime_type, title, description, gameplay, audit_status, uploaded_at FROM files WHERE user_id = ? ORDER BY uploaded_at DESC, id DESC',
        [user.id]
      ),
      uploadsToday(user.id),
    ]);
    res.json({
      user: displayNameOf(user),
      files: rows,
      quota: {
        max_upload_mb: Math.round(config.maxUploadBytes / 1024 / 1024),
        max_uploads_per_day: config.guestMaxUploadsPerDay,
        uploads_today: cnt,
        remaining: Math.max(0, config.guestMaxUploadsPerDay - cnt),
      },
    });
  })
);

// 访客上传（multipart：file + token 字段；每次一个文件，前端可循环传多个）
// IP 限流（2026-08-20）：防未认证请求无限投递 multipart 造成磁盘/CPU 写放大（multer 先落盘后校验 token）
router.post(
  '/upload',
  rateLimit({ windowMs: 60 * 1000, max: 10, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    // 上传前磁盘自检：剩余空间不足时直接拒绝（不落盘任何文件）
    if (!ensureDiskSpace(res)) return;

    try {
      await runMulter(req, res);
    } catch (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `文件过大，超出 ${Math.round(config.maxUploadBytes / 1024 / 1024)}MB 上限；如确需上传大文件/文件夹，请联系频道主或 QQ：3303188265` });
      }
      return res.status(400).json({ error: err.message || '上传失败' });
    }
    // multer 可能已把文件写入磁盘，令牌无效/账号停用时必须清理落盘文件
    const token = guestTokenOf(req);
    const user = await loadGuestByToken(token);
    if (!user || user.status !== 'active') {
      if (req.file && req.file.path) fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(401).json({ error: user ? '账号已停用' : '项目地址无效或已失效，请重新填写表单获取' });
    }
    // 访客专用每日上限（默认 5 次/天），单次大小上限沿用 MAX_UPLOAD_MB（默认 200MB）
    return runUploadPipeline(req, res, user, { maxUploadsPerDay: config.guestMaxUploadsPerDay });
  })
);

// 下载（仅限本项目地址下的文件）
router.get(
  '/download/:id',
  asyncHandler(async (req, res) => {
    const user = await loadActiveGuest(req, res);
    if (!user) return;

    const rows = await query(
      'SELECT stored_name, original_name FROM files WHERE id = ? AND user_id = ?',
      [req.params.id, user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: '文件不存在' });
    // 访客路由本身就是"仅所有者"（token = 本人），flagged 不拦截——所有者需能取回自己的作品；
    // 对外展示面（作品展/系统下载）已由 L5 过滤/拦截
    const absPath = path.join(config.storageDir, rows[0].stored_name);
    if (!fs.existsSync(absPath)) return res.status(404).json({ error: '文件已丢失' });
    res.download(absPath, sanitizeName(rows[0].original_name));
  })
);

// HTML 预览（仅限本项目地址下的文件；2026-08-20 修复：仅接受 x-guest-token 请求头，
// 禁止 ?token= query——预览 URL 会暴露访客令牌，上传的 HTML 可读取 location.href 外传；
// 前端经 /preview.html#/guest/<id>/<token> 预览壳 fetch 渲染，令牌在 hash 中、被 sandbox 隔离）
router.get(
  '/preview/:id',
  asyncHandler(async (req, res) => {
    const token = String(req.headers['x-guest-token'] || '').trim();
    const user = await loadGuestByToken(token);
    if (!user) return res.status(401).json({ error: '项目地址无效或已失效' });
    if (user.status !== 'active') return res.status(401).json({ error: '账号已停用' });

    const rows = await query(
      'SELECT stored_name, original_name FROM files WHERE id = ? AND user_id = ?',
      [req.params.id, user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: '文件不存在' });
    const ext = extOf(rows[0].original_name);
    if (ext !== 'html' && ext !== 'htm') return res.status(400).json({ error: '仅支持 HTML 文件预览' });
    // 访客路由=仅所有者，flagged 不拦截（见下载注释）
    const absPath = path.join(config.storageDir, rows[0].stored_name);
    if (!fs.existsSync(absPath)) return res.status(404).json({ error: '文件已丢失' });

    const previewName = sanitizeName(rows[0].original_name);
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': "inline; filename=\"preview.html\"; filename*=UTF-8''" + encodeURIComponent(previewName),
      'Content-Security-Policy': 'sandbox allow-scripts',
      // 防预览页把 ?token= 经 Referer 泄露给上传者（上传的 HTML 可用 meta referrer=unsafe-url 覆盖浏览器默认策略）
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    res.sendFile(absPath);
  })
);

// 校验删除密码：有自定义哈希按哈希比对；未设置（NULL）则与默认密码比对（常量时间）。
function verifyGuestPassword(user, input) {
  const pwd = String(input == null ? '' : input);
  if (user.guest_pwd_hash) {
    return verifyPassword(pwd, user.guest_pwd_hash);
  }
  // 默认密码比对（长度不同的先短路，避免 timingSafeEqual 抛错）
  const a = Buffer.from(pwd);
  const b = Buffer.from(config.guestDefaultPassword);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// 删除（仅限本项目地址下的文件）：需提供安全密码（自定义或默认），防拿到 URL 的人误删/批量删。
// 与系统内删除一致：删库记录 + 删落盘文件 + 回扣提交积分；不返还当天上传次数。
router.delete(
  '/files/:id',
  rateLimit({
    windowMs: config.guestDeleteRateLimit.windowMs,
    max: config.guestDeleteRateLimit.max,
    keyFn: (req) => (req.ip || 'unknown') + ':' + guestTokenOf(req),
  }),
  asyncHandler(async (req, res) => {
    const user = await loadActiveGuest(req, res);
    if (!user) return;

    // 密码走 JSON body（前端已改）；query 兜底仅兼容旧客户端，nginx 日志已不再记录 query
    const password = (req.body && req.body.password != null) ? req.body.password : req.query.password;
    if (!verifyGuestPassword(user, password)) {
      return res.status(403).json({ error: '密码错误，无法删除' });
    }

    const rows = await query(
      'SELECT stored_name FROM files WHERE id = ? AND user_id = ?',
      [req.params.id, user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: '文件不存在' });

    await query('DELETE FROM files WHERE id = ?', [req.params.id]);
    // 回扣提交作品文件积分（若发过）
    const revoked = await revoke(user.id, 'file_submit', 'file:' + req.params.id);
    fs.promises.unlink(path.join(config.storageDir, rows[0].stored_name)).catch(() => {});
    return res.json({ ok: true, points_revoked: revoked });
  })
);

module.exports = router;
