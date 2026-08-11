// PatPlayer 班级 API — 本地认证 + Netlify Blobs
import { getStore } from '@netlify/blobs';
import crypto from 'crypto';

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'patplayer-default-secret-change-me';
const META_STORE = 'patplayer-files-meta';

function verifyToken(token) {
  try {
    const decoded = Buffer.from(token, 'base64url').toString();
    const [userKey, ts, sig] = decoded.split('|');
    if (!userKey || !ts || !sig) return null;
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(`${userKey}|${ts}`).digest('hex');
    if (sig !== expected) return null;
    if (Date.now() - Number(ts) > 24 * 60 * 60 * 1000) return null;
    return userKey;
  } catch { return null; }
}

async function getUserFromToken(event) {
  const auth = event.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  const key = verifyToken(auth.slice(7));
  if (!key) return null;
  const [className, name] = key.split('/');
  return { className, name };
}

async function getMetas(keys) {
  if (keys.length === 0) return {};
  const store = getStore(META_STORE);
  const result = {};
  for (const k of keys) {
    try { const raw = await store.get(k); if (raw) result[k] = JSON.parse(raw); } catch {}
  }
  return result;
}

/**
 * GET /api/class/wall
 * 班级作品墙：查看同班所有同学的提交
 */
async function classWall(event, user) {
  try {
    const store = getStore('patplayer-files');
    const prefix = `${user.className}/`;

    const { blobs } = await store.list({ prefix });

    // 按学生姓名分组
    const studentMap = {};
    for (const blob of blobs) {
      const parts = blob.key.replace(prefix, '').split('/');
      if (parts.length < 2) continue;
      const [studentName, filename] = [parts[0], parts.slice(1).join('/')];
      if (!studentMap[studentName]) {
        studentMap[studentName] = [];
      }
      studentMap[studentName].push({
        name: filename,
        key: blob.key,
      });
    }

    // 获取大小信息
    const allKeys = blobs.map(b => b.key);
    const metasMap = await getMetas(allKeys);

    const students = Object.entries(studentMap)
      .map(([name, files]) => {
        const enrichedFiles = files.map(f => {
          const meta = metasMap[f.key];
          return {
            name: f.name,
            size: meta?.size || 0,
            modifiedAt: meta?.uploadedAt || null,
          };
        }).sort((a, b) => new Date(b.modifiedAt || 0) - new Date(a.modifiedAt || 0));

        return {
          name,
          fileCount: files.length,
          files: enrichedFiles,
          lastSubmit: enrichedFiles[0]?.modifiedAt || null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    return {
      statusCode: 200,
      body: JSON.stringify({ className: user.className, students }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

/**
 * GET /api/class/overview
 * 提交记录总览：所有班级
 */
async function overview(_event, _user) {
  try {
    const store = getStore('patplayer-files');
    const { blobs } = await store.list({});

    // 获取元数据
    const allKeys = blobs.map(b => b.key);
    const metasMap = await getMetas(allKeys);

    // 按班级-学生 组织（从文件路径推导）
    const classMap = {};
    for (const blob of blobs) {
      const parts = blob.key.split('/');
      if (parts.length < 3) continue;
      const [className, studentName, filename] = parts;
      if (!classMap[className]) classMap[className] = {};
      if (!classMap[className][studentName]) classMap[className][studentName] = [];
      const meta = metasMap[blob.key] || {};
      classMap[className][studentName].push({ name: filename, key: blob.key, size: meta.size || 0, uploadedAt: meta.uploadedAt || null });
    }

    const result = Object.entries(classMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([className, studentMap]) => {
        const students = Object.entries(studentMap)
          .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
          .map(([name, files]) => {
            const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
            return { name, fileCount: files.length, totalSize,
              files: files.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0)) };
          });
        const totalFiles = students.reduce((s, st) => s + st.fileCount, 0);
        const totalSize = students.reduce((s, st) => s + st.totalSize, 0);
        return { className, studentCount: students.length, totalFiles, totalSize, students };
      });

        const totalFiles = students.reduce((s, st) => s + st.fileCount, 0);
        const totalSize = students.reduce((s, st) => s + st.totalSize, 0);

        return { className, studentCount: students.length, totalFiles, totalSize, students };
      });

    return {
      statusCode: 200,
      body: JSON.stringify({ overview: result }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204 };
  }

  const user = await getUserFromToken(event);
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: '请先登录' }) };
  }

  const path = event.path.replace('/api/class/', '');

  switch (path) {
    case 'wall':
      return classWall(event, user);
    case 'overview':
      return overview(event, user);
    default:
      return { statusCode: 404, body: JSON.stringify({ error: '接口不存在' }) };
  }
};
