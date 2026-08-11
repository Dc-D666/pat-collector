// PatPlayer Class API - local auth + Netlify Blobs
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
 * GET /api/class/wall - View all submissions from classmates
 */
async function classWall(event, user) {
  try {
    const store = getStore('patplayer-files');
    const prefix = `${user.className}/`;

    const { blobs } = await store.list({ prefix });

    // Group by student name
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

    // Get file size info
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
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      statusCode: 200,
      body: JSON.stringify({ className: user.className, students }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

/**
 * GET /api/class/overview - Submission summary for all classes
 */
async function overview(_event, _user) {
  try {
    const store = getStore('patplayer-files');
    const { blobs } = await store.list({});

    const allKeys = blobs.map(b => b.key);
    const metasMap = await getMetas(allKeys);

    // Organize by class-student (derived from file paths)
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
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, files]) => {
            const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
            return { name, fileCount: files.length, totalSize,
              files: files.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0)) };
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
    return { statusCode: 401, body: JSON.stringify({ error: 'Not logged in' }) };
  }

  const path = event.path.replace('/api/class/', '');

  switch (path) {
    case 'wall':
      return classWall(event, user);
    case 'overview':
      return overview(event, user);
    default:
      return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
  }
};
