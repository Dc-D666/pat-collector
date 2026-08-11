// 认证路由：登录/登出/检查状态
import { Router } from 'express';
import { CONFIG } from '../config.js';
import { buildStudentId, isValidClass, generateToken, parseStudentId } from '../auth.js';

const router = Router();

/**
 * POST /api/auth/login
 * 登录接口：班级 + 姓名 + 学号后4位
 */
router.post('/login', (req, res) => {
  const { className, name, last4 } = req.body;

  // 验证必填字段
  if (!className || !name || !last4) {
    return res.status(400).json({ error: '请填写班级、姓名和学号后4位' });
  }

  // 验证班级
  if (!isValidClass(className)) {
    return res.status(400).json({ error: '无效的班级' });
  }

  // 验证姓名
  if (name.trim().length === 0 || name.length > 50) {
    return res.status(400).json({ error: '姓名不合法' });
  }

  // 验证学号后4位
  if (!/^\d{4}$/.test(last4)) {
    return res.status(400).json({ error: '学号后4位应为4位数字' });
  }

  // 构建用户标识
  const studentId = buildStudentId(className, name.trim(), last4);
  const token = generateToken(studentId);

  // 存入 session
  req.session.user = {
    studentId,
    className,
    name: name.trim(),
    token,
  };

  res.json({
    success: true,
    token,
    user: {
      className,
      name: name.trim(),
      studentId,
    },
  });
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

/**
 * GET /api/auth/me
 * 获取当前登录用户信息
 */
router.get('/me', (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: '未登录' });
  }
  const { studentId, className, name } = req.session.user;
  res.json({ studentId, className, name });
});

/**
 * GET /api/auth/classes
 * 获取所有可选班级列表
 */
router.get('/classes', (_req, res) => {
  res.json({ classes: CONFIG.CLASSES });
});

export default router;
