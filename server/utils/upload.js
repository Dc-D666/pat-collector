'use strict';

// 共享上传管线：multer 配置 + 上传前磁盘自检 + 上传后处理（每日次数 / 配额 / 入库 / 积分 / AI 审查）
// 供「已登录用户上传」（routes/files.js）与「访客直传」（routes/guest.js）复用，避免逻辑分叉。

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const { query } = require('../db');
const { grant, revoke } = require('./points');
const { reviewContent } = require('./audit');
const { freeDiskBytes } = require('./disk');
const { getSetting } = require('./settings');

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

// 上传前磁盘自检：剩余空间低于 minFreeDiskBytes 时直接拒绝（不写入任何文件）。
// 返回 true 表示空间充足可继续；false 表示已发送 507 响应。
function ensureDiskSpace(res) {
  const free = freeDiskBytes(config.storageDir);
  if (free !== null && free < config.minFreeDiskBytes) {
    res.status(507).json({ error: '磁盘即将爆满，文件上传失败，请联系频道主扩容处理' });
    return false;
  }
  return true;
}

// multer 已把文件写入磁盘后执行的处理管线。opts.maxUploadsPerDay 为该用户今日上限
// （访客 5 次/天，QQ 用户沿用 config.maxUploadsPerDay）。所有响应均由本函数发出。
async function runUploadPipeline(req, res, user, opts) {
  const maxUploadsPerDay = opts && opts.maxUploadsPerDay ? opts.maxUploadsPerDay : config.maxUploadsPerDay;
  if (!req.file) {
    return res.status(400).json({ error: '未收到文件' });
  }

  const originalName = sanitizeName(path.basename(decodeName(req.file.originalname)));
  const size = req.file.size;
  const mimeType = req.file.mimetype || 'application/octet-stream';
  const ext = extOf(originalName);
  const isText = config.textFormats.has(ext); // 文本/代码类：需 AI 审查 + 超长限制

  // 每人每天上传次数限制（含上传后删除的）：先检查再记录
  const [ulogCnt] = await query(
    'SELECT COUNT(*) AS c FROM upload_log WHERE user_id = ? AND DATE(created_at) = CURDATE()',
    [user.id]
  );
  if (Number(ulogCnt.c) >= maxUploadsPerDay) {
    fs.promises.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: `今日上传次数已达上限（${maxUploadsPerDay} 次），请明天再试` });
  }
  await query('INSERT INTO upload_log (user_id) VALUES (?)', [user.id]);

  try {
    // 每用户存储配额检查
    const [used] = await query(
      'SELECT COALESCE(SUM(size), 0) AS total FROM files WHERE user_id = ?',
      [user.id]
    );
    if (Number(used.total) + size > config.maxUserStorageBytes) {
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(413).json({ error: '超出个人存储配额，请删除部分文件后再试' });
    }

    const result = await query(
      `INSERT INTO files (user_id, stored_name, original_name, size, mime_type, audit_status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [user.id, req.file.filename, originalName, size, mimeType, isText ? 'pending' : 'reviewed']
    );
    const inserted = await query('SELECT uploaded_at FROM files WHERE id = ?', [result.insertId]);
    // 提交作品文件奖励（每个文件一次）
    await grant(user.id, 'file_submit', 'file:' + result.insertId);

    // 文本/代码类文件：先做超长限制（单文件达百万级字符直接拒绝），再同步 AI 内容审查
    let auditStatus = isText ? 'pending' : 'reviewed';
    let auditReason = '';
    // 运行时开关：settings.audit_enabled = '0' 可临时关闭 AI 审核（默认随 DEEPSEEK_AUDIT 环境变量）
    const auditRuntime = await getSetting('audit_enabled');
    const auditOn = config.deepseek.auditEnabled && auditRuntime !== '0';
    if (isText && auditOn) {
      const ds = config.deepseek;
      try {
        // 超长检查：字节超阈值必超百万字符（不读文件直接拒）；否则读内容精确按字符数判断
        if (size > ds.maxFileBytesBeforeRead) {
          await query('DELETE FROM files WHERE id = ?', [result.insertId]);
          await revoke(user.id, 'file_submit', 'file:' + result.insertId);
          fs.promises.unlink(req.file.path).catch(() => {});
          return res.status(400).json({ error: '文件过大（内容超长），请压缩后分多次上传；或私信联系频道主 / QQ：3303188265 解决' });
        }
        const content = await fs.promises.readFile(req.file.path, 'utf8');
        if (content.length >= ds.maxFileChars) {
          await query('DELETE FROM files WHERE id = ?', [result.insertId]);
          await revoke(user.id, 'file_submit', 'file:' + result.insertId);
          fs.promises.unlink(req.file.path).catch(() => {});
          return res.status(400).json({ error: '文件过大（内容超长），请压缩后分多次上传；或私信联系频道主 / QQ：3303188265 解决' });
        }
        const r = await reviewContent(content);
        if (!r.safe) {
          // 违规：删除文件与记录 + 回扣已发积分，拒绝收录
          await query('DELETE FROM files WHERE id = ?', [result.insertId]);
          await revoke(user.id, 'file_submit', 'file:' + result.insertId);
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

    // 今日剩余上传次数（前端展示用）
    const [cnt] = await query(
      'SELECT COUNT(*) AS c FROM upload_log WHERE user_id = ? AND DATE(created_at) = CURDATE()',
      [user.id]
    );
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
      uploads_today: Number(cnt.c),
      max_uploads_per_day: maxUploadsPerDay,
    });
  } catch (err) {
    // 唯一约束冲突（同名文件）或其它 DB 错误 → 回滚落盘文件
    fs.promises.unlink(req.file.path).catch(() => {});
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: '同名文件已存在，请先删除或重命名' });
    }
    throw err;
  }
}

module.exports = { runMulter, ensureDiskSpace, runUploadPipeline, sanitizeName, extOf, decodeName };
