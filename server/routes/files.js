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
      return cb(new Error('不支持的文件类型：.' + ext));
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
        return res.status(413).json({ error: '文件过大，超出大小上限' });
      }
      return res.status(400).json({ error: err.message || '上传失败' });
    }
    if (!req.file) {
      return res.status(400).json({ error: '未收到文件' });
    }

    const originalName = sanitizeName(path.basename(decodeName(req.file.originalname)));
    const size = req.file.size;
    const mimeType = req.file.mimetype || 'application/octet-stream';

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
        'INSERT INTO files (user_id, stored_name, original_name, size, mime_type) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, req.file.filename, originalName, size, mimeType]
      );
      const inserted = await query('SELECT uploaded_at FROM files WHERE id = ?', [result.insertId]);
      return res.json({
        file: {
          id: result.insertId,
          original_name: originalName,
          size,
          mime_type: mimeType,
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
      'SELECT id, original_name, size, mime_type, uploaded_at FROM files WHERE user_id = ? ORDER BY uploaded_at DESC, id DESC',
      [req.user.id]
    );
    res.json({ files: rows });
  })
);

// 下载：本人文件 + 同班同学文件（对应"同班可互相查看"）
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
    if (file.user_id !== req.user.id && file.owner_class !== req.user.class_name) {
      return res.status(403).json({ error: '无权下载该文件' });
    }
    const absPath = path.join(config.storageDir, file.stored_name);
    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ error: '文件已丢失' });
    }
    res.download(absPath, sanitizeName(file.original_name));
  })
);

// 删除（仅本人）
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
    fs.promises
      .unlink(path.join(config.storageDir, rows[0].stored_name))
      .catch(() => {});
    res.json({ ok: true });
  })
);

module.exports = router;
