'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { query, pool } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { revokeInTx, deactivatePurchasesInTx } = require('../utils/points');
const { runMulter, ensureDiskSpace, runUploadPipeline, sanitizeName, extOf } = require('../utils/upload');
const { auditDisplayText } = require('../utils/audit');

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
      'SELECT id, original_name, size, mime_type, title, description, gameplay, audit_status, uploaded_at, source FROM files WHERE user_id = ? ORDER BY uploaded_at DESC, id DESC',
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
    // R2（2026-08-15）：作品标题/简介/玩法公开展示，同步 AI 审查；违规拒绝，AI 不可用降级放行
    const displayText = [title, description, gameplay].filter(Boolean).join('\n');
    const d = await auditDisplayText(displayText, { userId: req.user.id, refType: 'file', refId: Number(req.params.id) });
    if (!d.ok) {
      return res.status(400).json({ error: '作品信息不合规（' + (d.reason || '请修改后重试') + '）' });
    }
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
    // R2-5：非 reviewed（pending 待审 / flagged 违规）文件全校不可下载；所有者本人仍可下载
    if (file.audit_status !== 'reviewed' && file.user_id !== req.user.id) {
      return res.status(403).json({
        error: file.audit_status === 'flagged' ? '该作品因违规已被下架' : '该作品正在审核中，暂未公开',
      });
    }
    const absPath = path.join(config.storageDir, file.stored_name);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ error: '文件已丢失' });
    }
    res.download(absPath, sanitizeName(file.original_name));
  })
);

// HTML 文件预览（只读）：全校公开（登录即可预览）。
// 鉴权：仅 Bearer 请求头（2026-08-20 修复：禁止 ?token= query——预览 URL 会暴露令牌，
// 上传的 HTML 可读取自身 location.href 外传令牌，导致任意登录用户账号被窃取。
// 前端改用 /preview.html 预览壳，经 fetch+请求头取内容、sandbox iframe 渲染）。
// R2-13（2026-08-21）：挂 requireAuth——停用/删除用户在旧 token 过期前也无法预览。
// 安全：响应带 CSP sandbox allow-scripts；预览壳再套一层 sandbox iframe（unique origin）。
router.get(
  '/preview/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
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
    // R2-5：非 reviewed 文件仅所有者本人可预览
    if (file.audit_status !== 'reviewed' && file.user_id !== req.user.id) {
      return res.status(403).json({
        error: file.audit_status === 'flagged' ? '该作品因违规已被下架' : '该作品正在审核中，暂未公开',
      });
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
      // 防预览页把 ?token= 经 Referer 泄露给上传者（上传的 HTML 可用 meta referrer=unsafe-url 覆盖浏览器默认策略）
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    });
    res.sendFile(absPath);
  })
);

// 删除（仅本人）：删除文件并回扣对应提交积分。
// R3-3（2026-08-21）：删除与回扣同一事务（此前 DELETE 后再 revoke，回扣失败会永久保留积分）；
// R3-4：一并作废该文件相关商城购买（wall_top 置顶记录）。
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const fid = Number(req.params.id);
    const conn = await pool.getConnection();
    let storedName = null;
    let revoked = null;
    try {
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
      const [rows] = await conn.execute(
        'SELECT stored_name FROM files WHERE id = ? AND user_id = ? FOR UPDATE',
        [fid, req.user.id]
      );
      if (rows.length === 0) {
        await conn.rollback();
        conn.release();
        return res.status(404).json({ error: '文件不存在' });
      }
      storedName = rows[0].stored_name;
      revoked = (await revokeInTx(conn, req.user.id, 'file_submit', 'file:' + fid)) || 0;
      // 站内生成作品（source='gen'）曾以 app_submit 计分（与频道轻应用等价，2026-08-25）：
      // 删除时一并回扣；普通上传无此流水，revokeInTx 查不到安全返回 null。名额不释放（防刷分口径）。
      revoked += (await revokeInTx(conn, req.user.id, 'app_submit', 'file:' + fid)) || 0;
      await deactivatePurchasesInTx(conn, req.user.id, 'file', fid);
      await deactivatePurchasesInTx(conn, req.user.id, 'file', fid);
      await conn.execute('DELETE FROM files WHERE id = ?', [fid]);
      await conn.commit();
    } catch (err) {
      try { await conn.rollback(); } catch (_) { /* ignore */ }
      conn.release();
      throw err;
    }
    conn.release();
    // 事务提交后再物理删盘（删盘失败仅留孤儿文件，不影响一致性）
    if (storedName) {
      fs.promises.unlink(path.join(config.storageDir, storedName)).catch(() => {});
    }
    res.json({ ok: true, points_revoked: revoked });
  })
);

module.exports = router;
