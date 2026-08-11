// 身份认证中间件
import { CONFIG } from './config.js';

// 简单 Token 存储（生产环境可换数据库）
const tokens = new Map();

/**
 * 生成简单 token（学号后4位 + 时间戳哈希）
 */
export function generateToken(studentId) {
  const token = Buffer.from(`${studentId}-${Date.now()}-${Math.random()}`).toString('base64url');
  tokens.set(token, {
    studentId,
    createdAt: Date.now(),
  });
  return token;
}

/**
 * 验证 token 并返回学生信息
 */
export function verifyToken(token) {
  const data = tokens.get(token);
  if (!data) return null;
  if (Date.now() - data.createdAt > CONFIG.TOKEN_EXPIRE) {
    tokens.delete(token);
    return null;
  }
  return data;
}

/**
 * 认证中间件：验证 session 中的用户身份
 */
export function authMiddleware(req, res, next) {
  // 开发模式下允许无认证访问
  if (req.session?.user) {
    req.user = req.session.user;
    return next();
  }

  // 也支持 Authorization header（token 方式）
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const data = verifyToken(token);
    if (data) {
      req.user = { studentId: data.studentId };
      return next();
    }
  }

  return res.status(401).json({ error: '请先登录' });
}

/**
 * 权限检查：只能修改自己的文件
 */
export function ownFileOnly(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: '请先登录' });
  }
  // 从路径中提取班级和姓名，与登录用户比对
  const userId = req.user.studentId; // 格式: className|name|last4
  const [className, name] = userId.split('|');
  req.userClass = className;
  req.userName = name;
  next();
}

/**
 * 构建学生ID字符串
 */
export function buildStudentId(className, name, last4) {
  return `${className}|${name}|${last4}`;
}

/**
 * 从 studentId 解析信息
 */
export function parseStudentId(studentId) {
  const [className, name, last4] = studentId.split('|');
  return { className, name, last4 };
}

/**
 * 验证班级是否有效
 */
export function isValidClass(className) {
  return CONFIG.CLASSES.includes(className);
}
