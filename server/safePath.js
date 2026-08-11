// 路径安全工具
import path from 'path';
import { CONFIG } from './config.js';

/**
 * 安全检查：防止路径遍历攻击
 * 确保最终路径在 UPLOAD_ROOT 之内
 */
export function safePath(...segments) {
  // 过滤每个路径段中的危险字符
  const cleaned = segments.map(s => {
    // 移除 ../ .\\ 等路径遍历字符
    let clean = s.replace(/\.\./g, '').replace(/[<>:"|?*\\]/g, '_');
    // 移除 null 字节
    clean = clean.replace(/\0/g, '');
    // 限制长度
    return clean.slice(0, 200);
  });

  const resolved = path.resolve(CONFIG.UPLOAD_ROOT, ...cleaned);
  const normalizedRoot = path.resolve(CONFIG.UPLOAD_ROOT);

  // 确保解析后的路径在 UPLOAD_ROOT 之下
  if (!resolved.startsWith(normalizedRoot + path.sep) && resolved !== normalizedRoot) {
    throw new Error('路径越权访问');
  }

  return resolved;
}

/**
 * 检查文件扩展名是否在白名单中
 */
export function isAllowedExtension(filename) {
  const ext = path.extname(filename).toLowerCase();
  return CONFIG.ALLOWED_EXTENSIONS.includes(ext);
}

/**
 * 确保目录存在
 */
export async function ensureDir(dirPath) {
  const fs = await import('fs');
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}
