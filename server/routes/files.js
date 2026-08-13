'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { query } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { grant, revoke } = require('../utils/points');
const { reviewContent } = require('../utils/audit');

const router = express.Router();

// multer 把 originalname 按 latin1 解析，中文会乱码；转回 utf8
function decodeName(name) {
  return Buffer.from(name || '', 'latin1').toString('utf8');
}

// 清洗文件名：去控制字符（防止 Content-Disposition 头注入/崩溃）、非法字符、限长
function sanitizeName(name) {
  const cleaned = String(name || '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .slice(0, 255);
  return cleaned || 'file';
}

function extOf(name) {
  return path.extname(name).slice(1).toLowerCase();
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, config.storageDir),
  filename: (req, file, cb) => {
    const ext = extOf(decodeName(file.originalname));
    cb(null, crypto.randomUUID() + (ext ? '.' + ext : ''));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = extOf(decodeName(file.originalname));
    if (!config.allowedExtensions.has(ext)) {
      return cb(new Error('仅支持代码/文本文件（.html .py .js .md 等），不支持 .' + ext + ' 类型'));
    }
    cb(null, true);
  },
});

function runMulter(req, res) {
  return new Promise((resolve, reject) => {
    upload.single('file')(req, res, (err) => (err ? reject(err) : resolve()));
  });
}

// 上传（单文件/次；前端逐文件上传以支持按文件进度与失败跳过）
router.post(
  '/upload',
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      await runMulter(req, res);
    } catch (err) {
      if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `文件过大，超出 ${Math.round(config.maxUploadBytes / 1024 / 1024)}MB 上限；如确需上传大文件/文件夹，请联系频道主或 QQ：3303188265` });
      }
      return res.status(400).json({ error: err.message || '上传失败' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '未收到文件' });
    }

    const originalName = sanitizeName(path.basename(decodeName(req.file.originalname)));
    const size = req.file.size;
    const mimeType = req.file.mimetype || 'application/octet-stream';
    const ext = extOf(originalName);
    const isText = config.textFormats.has(ext); // 文本/代码类：需 AI 审查 + 超长限制
    const isHtml = ext === 'html' || ext === 'htm'; // 预览按钮仅 HTML

    // 每人每天上传次数限制（含上传后删除的）：先检查再记录
    const [ulogCnt] = await query(
      'SELECT COUNT(*) AS c FROM upload_log WHERE user_id = ? AND DATE(created_at) = CURDATE()',
      [req.user.id]
    );
    if (Number(ulogCnt.c) >= config.maxUploadsPerDay) {
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ error: `今日上传次数已达上限（${config.maxUploadsPerDay} 次），请明天再试` });
    }
    await query('INSERT INTO upload_log (user_id) VALUES (?)', [req.user.id]);

    try {
      // 每用户存储配额检查
      const [used] = await query(
        'SELECT COALESCE(SUM(size), 0) AS total FROM files WHERE user_id = ?',
        [req.user.id]
      );
      if (Number(used.total) + size > config.maxUserStorageBytes) {
        fs.promises.unlink(req.file.path).catch(() => {});
        return res.status(413).json({ error: '超出个人存储配额，请删除部分文件后再试' });
      }

      const result = await query(
        `INSERT INTO files (user_id, stored_name, original_name, size, mime_type, audit_status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [req.user.id, req.file.filename, originalName, size, mimeType, isText ? 'pending' : 'reviewed']
      );
      const inserted = await query('SELECT uploaded_at FROM files WHERE id = ?', [result.insertId]);
      // 提交作品文件奖励（每个文件一次）
      await grant(req.user.id, 'file_submit', 'file:' + result.insertId);

      // 文本/代码类文件：先做超长限制（单文件达百万级字符直接拒绝），再同步 AI 内容审查
      let auditStatus = isText ? 'pending' : 'reviewed';
      let auditReason = '';
      if (isText && config.deepseek.auditEnabled) {
        const ds = config.deepseek;
        try {
          // 超长检查：字节超阈值必超百万字符（不读文件直接拒）；否则读内容精确按字符数判断
          if (size > ds.maxFileBytesBeforeRead) {
            await query('DELETE FROM files WHERE id = ?', [result.insertId]);
            await revoke(req.user.id, 'file_submit', 'file:' + result.insertId);
            fs.promises.unlink(req.file.path).catch(() => {});
            return res.status(400).json({ error: '文件过大（内容超长），请压缩后分多次上传；或私信联系频道主 / QQ：3303188265 解决' });
          }
          const content = await fs.promises.readFile(req.file.path, 'utf8');
          if (content.length >= ds.maxFileChars) {
            await query('DELETE FROM files WHERE id = ?', [result.insertId]);
            await revoke(req.user.id, 'file_submit', 'file:' + result.insertId);
            fs.promises.unlink(req.file.path).catch(() => {});
            return res.status(400).json({ error: '文件过大（内容超长），请压缩后分多次上传；或私信联系频道主 / QQ：3303188265 解决' });
          }
          const r = await reviewContent(content);
          if (!r.safe) {
            // 违规：删除文件与记录 + 回扣已发积分，拒绝收录
            await query('DELETE FROM files WHERE id = ?', [result.insertId]);
            await revoke(req.user.id, 'file_submit', 'file:' + result.insertId);
            fs.promises.unlink(req.file.path).catch(() => {});
            return res.status(400).json({ error: '内容未通过审核：' + (r.reason || '可能包含违规内容（如色情、违法内容或恶意代码）') });
          }
          auditStatus = 'reviewed';
        } catch (err) {
          // AI 审查不可用（超时/接口错误）：放行并标记待审，不阻塞学生上传
          console.warn('[audit] 内容审查失败（放行，标记待审）：', err.message);
          auditStatus = 'pending';
        }
      }
      if (auditStatus !== 'pending') {
        await query('UPDATE files SET audit_status = ?, audit_reason = ? WHERE id = ?', [auditStatus, auditReason, result.insertId]);
      }

      return res.json({
        file: {
          id: result.insertId,
          original_name: originalName,
          size,
          mime_type: mimeType,
          title: null,
          description: null,
          gameplay: null,
          audit_status: auditStatus,
          uploaded_at: inserted[0].uploaded_at,
        },
      });
    } catch (err) {
      // 唯一约束冲突（同名文件）或其它 DB 错误 → 回滚落盘文件
      fs.promises.unlink(req.file.path).catch(() => {});
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: '同名文件已存在，请先删除或重命名' });
      }
      throw err;
    }
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
