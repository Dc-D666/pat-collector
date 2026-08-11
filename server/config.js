// 服务端配置
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CONFIG = {
  PORT: 3000,
  UPLOAD_ROOT: path.join(__dirname, '..', 'uploads'),
  SESSION_SECRET: 'patplayer-internal-secret-change-me',
  // 允许的班级列表
  CLASSES: [
    ...Array.from({ length: 24 }, (_, i) => `25${String(i + 1).padStart(2, '0')}`),
    ...Array.from({ length: 25 }, (_, i) => `26${String(i + 1).padStart(2, '0')}`),
  ],
  // 允许的文件扩展名
  ALLOWED_EXTENSIONS: [
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg',
    '.mp4', '.webm', '.mov', '.avi',
    '.mp3', '.wav', '.ogg',
    '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
    '.txt', '.md', '.csv', '.json', '.xml',
    '.zip', '.rar', '.7z',
    '.py', '.js', '.html', '.css', '.cpp', '.c', '.java',
    '.psd', '.ai', '.blend', '.fbx', '.obj',
  ],
  // 最大文件大小 500MB
  MAX_FILE_SIZE: 500 * 1024 * 1024,
  // Token 有效期（毫秒）
  TOKEN_EXPIRE: 24 * 60 * 60 * 1000,
};
