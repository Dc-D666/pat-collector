'use strict';

const path = require('path');

// 加载 .env（若存在）；不存在也不报错，便于裸启动
try {
  require('dotenv').config();
} catch (e) {
  // dotenv 未安装时忽略，配置走环境变量
}

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---- 班级白名单：高二 2501–2524（24 班）、高一 2601–2625（25 班） ----
const CLASSES = [];
for (let c = 2501; c <= 2524; c++) CLASSES.push(String(c));
for (let c = 2601; c <= 2625; c++) CLASSES.push(String(c));

// 班级 -> 年级文案
function gradeOf(className) {
  return className.startsWith('25') ? '高二' : '高一';
}

// ---- 扩展名白名单（约 50 种）----
const ALLOWED_EXTENSIONS = new Set([
  // 图片
  'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg', 'ico', 'tiff', 'tif', 'heic',
  // 视频
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v',
  // 音频
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma',
  // Office / 文档
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt', 'md', 'csv',
  // 压缩包
  'zip', 'rar', '7z', 'tar', 'gz',
  // 代码
  'py', 'js', 'ts', 'c', 'cpp', 'java', 'html', 'css', 'json', 'ipynb',
  // 3D
  'stl', 'obj', 'glb', 'gltf', 'fbx', 'blend',
]);

const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    database: process.env.DB_NAME || 'pat',
    user: process.env.DB_USER || 'pat',
    password: process.env.DB_PASSWORD || '',
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    // 直接返回 "YYYY-MM-DD HH:mm:ss" 字符串，避免时区偏移；墙钟时间以数据库为准
    dateStrings: true,
  },
  tokenSecret: process.env.TOKEN_SECRET,
  tokenTtlMs: 24 * 60 * 60 * 1000, // 24h
  maxUploadBytes: (parseInt(process.env.MAX_UPLOAD_MB || '200', 10) || 200) * 1024 * 1024,
  maxUserStorageBytes:
    (parseInt(process.env.MAX_USER_STORAGE_MB || '2048', 10) || 2048) * 1024 * 1024,
  storageDir: path.resolve(PROJECT_ROOT, process.env.STORAGE_DIR || 'storage/uploads'),
  publicDir: path.resolve(PROJECT_ROOT, 'public'),
  qqSessionsDir: path.resolve(PROJECT_ROOT, process.env.QQ_SESSIONS_DIR || 'storage/qq-sessions'),
  // 可选：限定 QQ 登录到某个频道（guild）；空 = 不校验频道成员
  guildId: process.env.GUILD_ID || '',
  projectRoot: PROJECT_ROOT,
  classes: CLASSES,
  gradeOf,
  allowedExtensions: ALLOWED_EXTENSIONS,
};

// 启动前强校验：生产环境不允许无密钥裸奔
function assertConfig() {
  const missingOrDefault =
    !config.tokenSecret || config.tokenSecret === 'please-change-me-to-a-long-random-string';
  if (missingOrDefault) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[config] 生产环境必须设置强随机 TOKEN_SECRET（禁止使用示例值）。'
      );
    }
    console.warn('[config] ⚠️  TOKEN_SECRET 未设置或仍为示例值！生产环境请务必配置强随机密钥。');
  }
}

module.exports = config;
module.exports.assertConfig = assertConfig;
