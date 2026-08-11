// 班级路由：作品墙、提交总览
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { CONFIG } from '../config.js';
import { authMiddleware, ownFileOnly, parseStudentId } from '../auth.js';
import { safePath } from '../safePath.js';

const router = Router();

router.use(authMiddleware);
router.use(ownFileOnly);

/**
 * GET /api/class/wall
 * 班级作品墙：查看同班所有同学的提交
 */
router.get('/wall', (req, res) => {
  try {
    const className = req.userClass || req.session?.user?.className;
    const classDir = safePath(className);

    if (!fs.existsSync(classDir)) {
      return res.json({ className, students: [] });
    }

    const studentDirs = fs.readdirSync(classDir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    const students = studentDirs.map(dir => {
      const studentPath = path.join(classDir, dir.name);
      const files = fs.readdirSync(studentPath, { withFileTypes: true })
        .filter(f => f.isFile())
        .map(f => {
          const fp = path.join(studentPath, f.name);
          const stat = fs.statSync(fp);
          return {
            name: f.name,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          };
        })
        .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));

      return {
        name: dir.name,
        fileCount: files.length,
        files,
        lastSubmit: files.length > 0 ? files[0].modifiedAt : null,
      };
    });

    res.json({ className, students });
  } catch (err) {
    res.status(500).json({ error: '获取班级作品墙失败: ' + err.message });
  }
});

/**
 * GET /api/class/download/:studentName/:filename
 * 下载同班同学的文件（只读）
 */
router.get('/download/:studentName/:filename', (req, res) => {
  try {
    const className = req.userClass || req.session?.user?.className;
    const filePath = safePath(
      className,
      decodeURIComponent(req.params.studentName),
      decodeURIComponent(req.params.filename)
    );

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '文件不存在' });
    }

    res.download(filePath);
  } catch (err) {
    res.status(500).json({ error: '下载失败: ' + err.message });
  }
});

/**
 * GET /api/class/overview
 * 提交记录总览：按班级-姓名层级展示
 */
router.get('/overview', (_req, res) => {
  try {
    const rootDir = CONFIG.UPLOAD_ROOT;
    const result = [];

    if (!fs.existsSync(rootDir)) {
      return res.json({ overview: [] });
    }

    const classDirs = fs.readdirSync(rootDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .sort();

    for (const classDir of classDirs) {
      const classPath = path.join(rootDir, classDir.name);
      const studentDirs = fs.readdirSync(classPath, { withFileTypes: true })
        .filter(d => d.isDirectory());

      const students = studentDirs.map(sd => {
        const sp = path.join(classPath, sd.name);
        const files = fs.readdirSync(sp, { withFileTypes: true })
          .filter(f => f.isFile());

        let totalSize = 0;
        const fileList = files.map(f => {
          const fp = path.join(sp, f.name);
          const stat = fs.statSync(fp);
          totalSize += stat.size;
          return {
            name: f.name,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          };
        });

        return {
          name: sd.name,
          fileCount: files.length,
          totalSize,
          files: fileList.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt)),
        };
      });

      const classTotalFiles = students.reduce((s, st) => s + st.fileCount, 0);
      const classTotalSize = students.reduce((s, st) => s + st.totalSize, 0);

      result.push({
        className: classDir.name,
        studentCount: students.length,
        totalFiles: classTotalFiles,
        totalSize: classTotalSize,
        students: students.filter(s => s.fileCount > 0),
      });
    }

    res.json({ overview: result });
  } catch (err) {
    res.status(500).json({ error: '获取提交总览失败: ' + err.message });
  }
});

export default router;
