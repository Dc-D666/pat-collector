'use strict';

// 磁盘剩余空间检测（上传前自检用）
const fs = require('fs');
const { execFileSync } = require('child_process');

// 返回目录所在文件系统的可用字节数；检测失败返回 null（调用方按"不阻塞"处理）
function freeDiskBytes(dir) {
  try {
    // Node >= 18.15：fs.statfsSync 直接可取 bavail * bsize
    const s = fs.statfsSync(dir);
    if (s && typeof s.bavail === 'number' && typeof s.bsize === 'number') {
      return s.bavail * s.bsize;
    }
  } catch (_) { /* 走 df 兜底 */ }
  try {
    // 兜底：df -k <dir>，解析第二行第 4 列（可用 KB）
    const out = execFileSync('df', ['-k', dir], { encoding: 'utf8', timeout: 5000 });
    const lines = out.trim().split('\n');
    for (const line of lines.slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4 && /^\d+$/.test(parts[3])) {
        return Number(parts[3]) * 1024;
      }
    }
  } catch (_) { /* ignore */ }
  return null;
}

module.exports = { freeDiskBytes };
