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

// ---- 扩展名白名单：代码/文本 + 压缩包（图片/视频/音频/Office/PDF/3D 均已关闭）----
// 代码/文本类走 AI 内容审查 + 超长限制；压缩包为二进制（不审查，仅作多文件打包途径）
const ALLOWED_EXTENSIONS = new Set([
  // 网页 / 代码 / 文本（审查集合）
  'html', 'htm', 'py', 'js', 'ts', 'c', 'cpp', 'java', 'css', 'json', 'ipynb',
  'md', 'txt', 'csv', 'svg',
  // 压缩包（多文件打包上传）
  'zip', 'rar', '7z', 'tar', 'gz',
]);
// 文本/代码类：走 AI 内容审查 + 百万字符超长限制
const TEXT_FORMATS = new Set([
  'html', 'htm', 'py', 'js', 'ts', 'c', 'cpp', 'java', 'css', 'json', 'ipynb',
  'md', 'txt', 'csv', 'svg',
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
  // DeepSeek 内容审查（文本/代码类上传时调用；key 放 .env，勿入库）
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
    auditEnabled: process.env.DEEPSEEK_AUDIT !== '0', // 默认开启，设 0 关闭
    timeoutMs: 20000,
    maxChars: 16000, // 送入模型的文本截断长度
    maxFileChars: 1000000, // 单文件内容达百万级字符 → 直接拒绝上传
    maxFileBytesBeforeRead: 4 * 1024 * 1024, // 字节超此值必超百万字符（UTF-8 中文 3B/字），不读直接拒
  },
  malwareScan: process.env.MALWARE_SCAN !== '0', // R3：上传恶意程序扫描总开关（2026-08-20 起仅 VirusTotal），0 关闭
  virustotal: {
    // R3（2026-08-20 起为唯一扫描器）：哈希命中即判，未收录且 ≤32MB 才上传；429 自动熔断 12h 降级放行。
    // 本地 ClamAV（clamd/clamscan）因需加载 ~600MB 签名库、2GB 服务器内存吃紧已移除。
    apiKey: process.env.VIRUSTOTAL_API_KEY || '',
    enabled: process.env.VIRUSTOTAL_ENABLED !== '0',
  },
  guestRegGlobalPerHour: parseInt(process.env.GUEST_REG_GLOBAL_HOUR || '60', 10) || 60, // P2：全局访客新建登记限速（个/小时），防批量脚本刷屏
  maxUploadBytes: (parseInt(process.env.MAX_UPLOAD_MB || '200', 10) || 200) * 1024 * 1024,
  maxUserStorageBytes:
    (parseInt(process.env.MAX_USER_STORAGE_MB || '1024', 10) || 1024) * 1024 * 1024, // 每人文件总容量（默认 1GB），超限提示联系频道主
  maxFilesPerUser: parseInt(process.env.MAX_FILES_PER_USER || '20', 10) || 20, // 每人作品文件总数上限（删除可释放名额）
  maxAppsPerUser: parseInt(process.env.MAX_APPS_PER_USER || '20', 10) || 20, // 每人轻应用总数上限（删除可释放名额）
  maxUploadsPerDay: parseInt(process.env.MAX_UPLOADS_PER_DAY || '20', 10) || 20, // 每人每天上传次数上限（含删除）
  // 访客（无 QQ 直传）专用：每天最多上传次数（默认 5），单次大小仍走 MAX_UPLOAD_MB（默认 200MB）
  guestMaxUploadsPerDay: parseInt(process.env.GUEST_MAX_UPLOADS_PER_DAY || '5', 10) || 5,
  // 访客删除安全密码：提交时可自定义（选填）；留空则使用此默认密码。
  // 注意：默认密码写在客户端提示里等于公开——留空=不设防，设置自定义密码才是真保护。
  guestDefaultPassword: process.env.GUEST_DEFAULT_PASSWORD || 'nanfang1958',
  // 访客删除接口限流（防密码爆破）：每令牌/IP 窗口内最多尝试次数
  guestDeleteRateLimit: { windowMs: 10 * 60 * 1000, max: 10 },
  // 上传前磁盘自检：剩余空间低于该值（GB）时拒绝上传，提示联系频道主扩容
  minFreeDiskBytes: (parseFloat(process.env.MIN_FREE_DISK_GB || '2') || 2) * 1024 * 1024 * 1024,
  // 管理后台：QQ tiny_id 白名单（逗号分隔）——命中者在 QQ 绑定时自动成为管理员（首个管理员引导）
  adminQqTinyIds: new Set(
    String(process.env.ADMIN_QQ_TINY_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  ),
  storageDir: path.resolve(PROJECT_ROOT, process.env.STORAGE_DIR || 'storage/uploads'),
  publicDir: path.resolve(PROJECT_ROOT, 'public'),
  qqSessionsDir: path.resolve(PROJECT_ROOT, process.env.QQ_SESSIONS_DIR || 'storage/qq-sessions'),
  // QQ 登录需在频道内搜成员拿到 tiny_id（get-user-info 不返回 tiny_id）；默认南方中学频道，可用 GUILD_ID 覆盖
  guildId: process.env.GUILD_ID || '621631744026206738',
  // 跨站体验任务（NFTI）：ticket 签名密钥 + NFTI 库只读连接（判定"已体验"）
  patTicketSecret: process.env.PAT_TICKET_SECRET || '',
  // GitHub API（GitHub 项目 Fork 检测用）：填 GITHUB_TOKEN 可提升配额（未认证 60 次/时/IP，认证 5000 次/时）
  github: {
    token: process.env.GITHUB_TOKEN || '',
    // GitHub OAuth（2026-08-21）：所有权验证改为用户授权（取代仓库放 nanfang-pat.txt 文件校验）。
    // 需在 GitHub → Settings → Developer settings → OAuth Apps 注册一个 OAuth App：
    //   Homepage URL = https://pat.weaxi.cn，Authorization callback URL = https://pat.weaxi.cn/api/github/oauth/callback
    // scope 默认 repo：需要看到用户「全部」项目（含私有）才能做置灰展示；
    // 私有项目仅展示（前端置灰带锁、不可选择），只有公开项目可选、可验证。
    oauth: {
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID || '',
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || '',
      callbackUrl:
        process.env.GITHUB_OAUTH_CALLBACK_URL || 'https://pat.weaxi.cn/api/github/oauth/callback',
      scope: process.env.GITHUB_OAUTH_SCOPE || 'repo',
    },
  },
  nftiDb: {
    host: process.env.NFTI_DB_HOST || '127.0.0.1',
    port: parseInt(process.env.NFTI_DB_PORT || '3306', 10),
    database: process.env.NFTI_DB_NAME || 'nfti',
    user: process.env.NFTI_DB_USER || 'pat',
    password: process.env.NFTI_DB_PASSWORD || '',
  },
  // 智谱 GLM 免费模型（2026-08-21）：GitHub 仓库 README → 自动生成项目名称/简介。
  // 默认 glm-4.7-flash（最新免费档）；繁忙/限流时接口层自动回退 glm-4-flash。
  glm: {
    apiKey: process.env.GLM_API_KEY || '',
    baseUrl: process.env.GLM_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
    model: process.env.GLM_MODEL || 'glm-4.7-flash',
    fallbackModel: process.env.GLM_FALLBACK_MODEL || 'glm-4-flash',
    timeoutMs: 30000,
  },
  // 「一句话生成小程序」（AI 小学堂第2章，2026-08-25）：复用 glm/deepseek 凭据。
  // timeoutMs 是生成专用长超时（大模型写完整 HTML 耗时远超审查），不要复用 deepseek.timeoutMs。
  genApp: {
    provider: process.env.GENAPP_PROVIDER || 'glm',            // 'glm' | 'deepseek'
    model: process.env.GENAPP_MODEL || '',                     // 留空用各 provider 默认模型
    fallbackModel: process.env.GENAPP_FALLBACK_MODEL || '',    // 留空用各 provider 默认回退模型
    timeoutMs: parseInt(process.env.GENAPP_TIMEOUT_MS || '240000', 10), // 免费档排队可能超2分钟，放宽到4分钟
    maxIdeaChars: 500,
    maxHtmlBytes: 1024 * 1024,
    maxPerUserPerDay: 10,      // 每人每天生成次数上限（rateLimit）
    maxConcurrent: 3,          // 全局并发信号量（同时生成中的请求数）
    draftTtlMs: 30 * 60 * 1000,// 草稿有效期（30 分钟）
  },
  // OpenRouter（可选模型源，2026-08-25）：国内服务器实测可直连；:free 模型共享池高峰期常见上游 429，
  // 失败自动回退官方 GLM glm-4.7-flash。模型白名单见 genApp.js GEN_MODELS。
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    baseUrl: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
  },
  projectRoot: PROJECT_ROOT,
  classes: CLASSES,
  grades: GRADES,
  classesByGrade: CLASSES_BY_GRADE,
  gradeOf,
  normalizeClass,
  isStandardClass,
  allowedExtensions: ALLOWED_EXTENSIONS,
  textFormats: TEXT_FORMATS,
  // 最高管理员（2026-08-20）：仅此人可设置/取消其他管理员，其余管理员权限不变。
  // 按 (class_name, real_name) 唯一身份识别，可用 SUPER_ADMIN_CLASS/SUPER_ADMIN_NAME 覆盖。
  superAdmin: {
    class_name: process.env.SUPER_ADMIN_CLASS || '2120',
    real_name: process.env.SUPER_ADMIN_NAME || '戴睿羲',
  },
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
