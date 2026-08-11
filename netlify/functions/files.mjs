// PatPlayer 文件管理 API �?本地认证 + Netlify Blobs 存储
import { getStore } from '@netlify/blobs';
import crypto from 'crypto';

const TOKEN_SECRET = process.env.TOKEN_SECRET || 'patplayer-default-secret-change-me';

const ALLOWED_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg',
  '.mp4', '.webm', '.mov', '.avi', '.mp3', '.wav', '.ogg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.md', '.csv', '.json', '.xml', '.zip', '.rar', '.7z',
  '.py', '.js', '.html', '.css', '.cpp', '.c', '.java',
  '.psd', '.ai', '.blend', '.fbx', '.obj',
];

function isAllowedExtension(fn) {
  return ALLOWED_EXTENSIONS.includes('.' + fn.split('.').pop()?.toLowerCase());
}

// ---------- 本地 token 验证 ----------
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

function blobKey(user, filename) { return `${user.className}/${user.name}/${filename}`; }

// ---------- 文件元数据存�?----------
const META_STORE = 'patplayer-files-meta';

async function saveMeta(key, meta) {
  const store = getStore(META_STORE);
  await store.set(key, JSON.stringify(meta));
}

async function getMetas(keys) {
  if (keys.length === 0) return {};
  const store = getStore(META_STORE);
  const result = {};
  for (const k of keys) {
    try {
      const raw = await store.get(k);
      if (raw) result[k] = JSON.parse(raw);
    } catch {}
  }
  return result;
}

async function deleteMeta(key) {
  const store = getStore(META_STORE);
  await store.delete(key);
}

// ========== API ==========

async function upload(event, user) {
  try {
    const { filename, contentType, data, size } = JSON.parse(event.body);
    if (!filename || !data) return { statusCode: 400, body: JSON.stringify({ error: '缺少文件名或数据' }) };
    if (!isAllowedExtension(filename)) return { statusCode: 400, body: JSON.stringify({ error: '不支持的文件类型' }) };

    const store = getStore('patplayer-files');
    const key = blobKey(user, filename);
    const buffer = Buffer.from(data, 'base64');
    await store.set(key, buffer, { metadata: { contentType } });

    await saveMeta(key, {
      filename, size: size || buffer.length, contentType, uploadedAt: new Date().toISOString(),
      className: user.className, studentName: user.name,
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, filename, size: buffer.length }) };
  } catch (err) { return { statusCode: 500, body: JSON.stringify({ error: err.message }) }; }
}

async function listFiles(event, user) {
  try {
    const store = getStore('patplayer-files');
    const prefix = `${user.className}/${user.name}/`;
    const { blobs } = await store.list({ prefix });
    const keys = blobs.map(b => b.key);
    const metas = await getMetas(keys);

    const files = blobs.map(b => {
      const filename = b.key.replace(prefix, '');
      const meta = metas[b.key] || {};
      return { name: filename, key: b.key, size: meta.size || 0, uploadedAt: meta.uploadedAt || null };
    });

    return { statusCode: 200, body: JSON.stringify({ files }) };
  } catch (err) { return { statusCode: 500, body: JSON.stringify({ error: err.message }) }; }
}

async function deleteFile(event, user) {
  try {
    const { filename } = JSON.parse(event.body);
    const store = getStore('patplayer-files');
    const key = blobKey(user, filename);
    await store.delete(key);
    await deleteMeta(key);
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) { return { statusCode: 500, body: JSON.stringify({ error: err.message }) }; }
}

async function downloadFile(event, user) {
  try {
    const filename = event.queryStringParameters?.filename;
    if (!filename) return { statusCode: 400, body: JSON.stringify({ error: '缺少文件�? }) };
    const store = getStore('patplayer-files');
    const key = blobKey(user, filename);
    const blob = await store.get(key, { type: 'stream' });
    if (!blob) return { statusCode: 404, body: JSON.stringify({ error: '文件不存�? }) };
    const chunks = [];
    for await (const chunk of blob) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': buffer.length.toString(),
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) { return { statusCode: 500, body: JSON.stringify({ error: err.message }) }; }
}


export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*' } };
  const user = await getUserFromToken(event);
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: '���ȵ�¼' }) };
  const path = event.path.replace('/api/files/', '');
  switch (path) {
    case 'upload':   return upload(event, user);
    case 'list':     return listFiles(event, user);
    case 'delete':   return deleteFile(event, user);
    case 'download': return downloadFile(event, user);
    default:         return { statusCode: 404, body: JSON.stringify({ error: '�ӿڲ�����' }) };
  }
};
