'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { query } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { revoke } = require('../utils/points');
const { runMulter, ensureDiskSpace, runUploadPipeline, sanitizeName, extOf } = require('../utils/upload');

const router = express.Router();

// 上传（单文件/次；前端逐文件上传以支持按文件进度与失败跳过）
router.post(
  '/upload',
  requireAuth,
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
    // 已登录用户沿用全局每日上传上限（config.maxUploadsPerDay）
    return runUploadPipeline(req, res, req.user, { maxUploadsPerDay: config.maxUploadsPerDay });
  })
);

// 文件列表（仅本人）
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(
      'SELECT id, original_name, size, mime_type, title, description, gameplay, audit_status, uploaded_at FROM files WHERE user_id = ? ORDER BY uploaded_at DESC, id DESC',
      [req.user.id]
    );
    res.json({ files: rows });
  })
);

// 更新作品信息（仅本人）：标题 / 简介 / 玩法
router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT id FROM files WHERE id = ? AND user_id = ?', [
      req.params.id,
      req.user.id,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '文件不存在' });
    }
    const body = req.body || {};
    const title = String(body.title || '').trim().slice(0, 255);
    if (!title) {
      return res.status(400).json({ error: '请输入项目标题' });
    }
    const description = String(body.description || '').trim().slice(0, 2000) || null;
    const gameplay = String(body.gameplay || '').trim().slice(0, 2000) || null;
    await query('UPDATE files SET title = ?, description = ?, gameplay = ? WHERE id = ?', [
      title,
      description,
      gameplay,
      req.params.id,
    ]);
    const updated = await query(
      'SELECT id, original_name, size, mime_type, title, description, gameplay, uploaded_at FROM files WHERE id = ?',
      [req.params.id]
    );
    res.json({ file: updated[0] });
  })
);

// 下载：全校公开（登录即可下载任何文件）
router.get(
  '/download/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(
      'SELECT f.*, u.class_name AS owner_class FROM files f JOIN users u ON u.id = f.user_id WHERE f.id = ?',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: '文件不存在' });
    }
    const file = rows[0];
    const absPath = path.join(config.storageDir, file.stored_name);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ error: '文件已丢失' });
    }
    res.download(absPath, sanitizeName(file.original_name));
  })
);

// HTML 文件预览（只读，浏览器直接打开）：全校公开（登录即可预览）。
// 鉴权：Bearer 或 ?token=（顶层导航无法带自定义请求头，故支持 query 传 token）。
// 安全：CSP sandbox allow-scripts——脚本可运行（预览正常），但页面为独特源（opaque origin），
// 无法访问本站 localStorage / 调用本站 API，防存储型 XSS 窃取登录态。
router.get(
  '/preview/:id',
  asyncHandler(async (req, res) => {
    const { verify } = require('../utils/token');
    let payload = null;
    const header = req.headers.authorization || '';
    if (header.startsWith('Bearer ')) payload = verify(header.slice(7));
    if (!payload && req.query.token) payload = verify(String(req.query.token));
    if (!payload) return res.status(401).json({ error: '未登录' });

    const rows = await query(
      'SELECT f.* FROM files f WHERE f.id = ?',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: '文件不存在' });
    }
    const file = rows[0];
    const ext = extOf(file.original_name);
    if (ext !== 'html' && ext !== 'htm') {
      return res.status(400).json({ error: '仅支持 HTML 文件预览' });
    }
    const absPath = path.join(config.storageDir, file.stored_name);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ error: '文件已丢失' });
    }
    // Content-Disposition：中文文件名不能直接进响应头（HTTP 头仅 ASCII），
    // 用 ASCII 兜底名 + RFC 5987 filename*（UTF-8 编码）携带真实文件名
    const previewName = sanitizeName(file.original_name);
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': "inline; filename=\"preview.html\"; filename*=UTF-8''" + encodeURIComponent(previewName),
      'Content-Security-Policy': 'sandbox allow-scripts',
      'X-Content-Type-Options': 'nosniff',
    });
    res.sendFile(absPath);
  })
);

// 删除（仅本人）：删除文件并回扣对应提交积分（+50⭐）
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT stored_name FROM files WHERE id = ? AND user_id = ?', [
      req.params.id,
      req.user.id,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ error: '文件不存在' });
    }
    await query('DELETE FROM files WHERE id = ?', [req.params.id]);
    // 回扣提交作品文件积分（若发过）
    const revoked = await revoke(req.user.id, 'file_submit', 'file:' + req.params.id);
    fs.promises
      .unlink(path.join(config.storageDir, rows[0].stored_name))
      .catch(() => {});
    res.json({ ok: true, points_revoked: revoked });
  })
);

module.exports = router;
