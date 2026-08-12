'use strict';

const path = require('path');

// 加载 .env（若存在）；不存在也不报错，便于裸启动
try {
  require('dotenv').config();
} catch (e) {
  // dotenv 未安装时忽略，配置走环境变量
}

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---- 班级：高一 2601–2624、高二 2501–2524、高三 2401–2425，另有「其他」自由填写 ----
const GRADES = [
  { name: '高一', start: 2601, end: 2624 },
  { name: '高二', start: 2501, end: 2524 },
  { name: '高三', start: 2401, end: 2425 },
];

const CLASSES_BY_GRADE = {};
const CLASSES = [];
for (const g of GRADES) {
  const list = [];
  for (let c = g.start; c <= g.end; c++) list.push(String(c));
  CLASSES_BY_GRADE[g.name] = list;
  CLASSES.push(...list);
}
const CLASS_SET = new Set(CLASSES);

// 班级 -> 年级文案；自由文本（不在标准范围内）一律归为「其他」
function gradeOf(className) {
  const c = String(className || '');
  if (!CLASS_SET.has(c)) return '其他';
  if (c.startsWith('26')) return '高一';
  if (c.startsWith('25')) return '高二';
  return '高三'; // 24 前缀
}

// 归一化班级：标准班级原样返回；自由文本去空白并截断；空 → '其他'
function normalizeClass(raw) {
  const c = String(raw || '').trim();
  return c ? c.slice(0, 32) : '其他';
}

function isStandardClass(name) {
  return CLASS_SET.has(name);
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
  grades: GRADES,
  classesByGrade: CLASSES_BY_GRADE,
  gradeOf,
  normalizeClass,
  isStandardClass,
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
