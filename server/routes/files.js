// 文件管理路由：上传/删除/重命名/列表
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { CONFIG } from '../config.js';
import { authMiddleware, ownFileOnly, parseStudentId } from '../auth.js';
import { safePath, isAllowedExtension, ensureDir } from '../safePath.js';

const router = Router();

// 配置 multer
const storage = multer.diskStorage({
  destination: async (req, _file, cb) => {
    try {
      const user = req.session?.user || req.user;
      if (!user) return cb(new Error('未登录'));

      const { className, name } = parseStudentId(user.studentId);
      const dir = safePath(className, name);
      await ensureDir(dir);
      cb(null, dir);
    } catch (err) {
      cb(err);
    }
  },
  filename: (_req, file, cb) => {
    // 保留中文文件名，但过滤危险字符
    const original = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const safe = original.replace(/[<>:"|?*\\/]/g, '_').replace(/\.\./g, '');
    cb(null, safe || 'unnamed');
  },
});

const upload = multer({
  storage,
  limits: { fileSize: CONFIG.MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (isAllowedExtension(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件类型: ${path.extname(file.originalname)}`));
    }
  },
});

// 所有操作需要认证
router.use(authMiddleware);
router.use(ownFileOnly);

/**
 * POST /api/files/upload
 * 上传文件（支持多文件）
 */
router.post('/upload', upload.array('files', 50), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: '没有选择文件' });
  }

  const uploaded = req.files.map(f => ({
    name: f.filename,
    size: f.size,
    type: f.mimetype,
    uploadedAt: new Date().toISOString(),
  }));

  res.json({ success: true, files: uploaded });
});

/**
 * GET /api/files/list
 * 获取当前用户的文件列表
 */
router.get('/list', (req, res) => {
  try {
    const userDir = safePath(req.userClass, req.userName);

    if (!fs.existsSync(userDir)) {
      return res.json({ files: [] });
    }

    const items = fs.readdirSync(userDir, { withFileTypes: true });
    const files = items
      .filter(item => item.isFile())
      .map(item => {
        const filePath = path.join(userDir, item.name);
        const stat = fs.statSync(filePath);
        return {
          name: item.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          createdAt: stat.birthtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

    res.json({ files });
  } catch (err) {
    res.status(500).json({ error: '获取文件列表失败: ' + err.message });
  }
});

/**
 * DELETE /api/files/delete/:filename
 * 删除自己的文件
 */
router.delete('/delete/:filename', (req, res) => {
  try {
    const filePath = safePath(req.userClass, req.userName, decodeURIComponent(req.params.filename));

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '文件不存在' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败: ' + err.message });
  }
});

/**
 * PUT /api/files/rename
 * 重命名自己的文件
 */
router.put('/rename', (req, res) => {
  const { oldName, newName } = req.body;

  if (!oldName || !newName) {
    return res.status(400).json({ error: '请提供原文件名和新文件名' });
  }

  try {
    const oldPath = safePath(req.userClass, req.userName, decodeURIComponent(oldName));

    if (!fs.existsSync(oldPath)) {
      return res.status(404).json({ error: '文件不存在' });
    }

    if (!isAllowedExtension(newName)) {
      return res.status(400).json({ error: '不支持的文件类型' });
    }

    const newPath = safePath(req.userClass, req.userName, newName);

    if (fs.existsSync(newPath)) {
      return res.status(400).json({ error: '同名文件已存在' });
    }

    fs.renameSync(oldPath, newPath);
    res.json({ success: true, newName });
  } catch (err) {
    res.status(500).json({ error: '重命名失败: ' + err.message });
  }
});

/**
 * GET /api/files/download/:filename
 * 下载自己的文件
 */
router.get('/download/:filename', (req, res) => {
  try {
    const filePath = safePath(req.userClass, req.userName, decodeURIComponent(req.params.filename));

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '文件不存在' });
    }

    res.download(filePath);
  } catch (err) {
    res.status(500).json({ error: '下载失败: ' + err.message });
  }
});

export default router;
