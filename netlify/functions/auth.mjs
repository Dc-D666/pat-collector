// PatPlayer Auth API - local account system (Netlify Blobs)
import { getStore } from '@netlify/blobs';
import crypto from 'crypto';

// ---------- Config ----------
const CLASSES = [
  ...Array.from({ length: 24 }, (_, i) => `25${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 25 }, (_, i) => `26${String(i + 1).padStart(2, '0')}`),
];
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'patplayer-default-secret-change-me';
const DEFAULT_PASSWORD_HASH = hashPassword('123456');

// ---------- Utils ----------
function isValidClass(c) { return CLASSES.includes(c); }

function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(pwd, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(pwd, salt, 64).toString('hex');
  return check === hash;
}

function generateToken(userKey) {
  const payload = `${userKey}|${Date.now()}`;
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}|${sig}`).toString('base64url');
}

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

function userKey(className, name) { return `${className}/${name.trim()}`; }
function parseUserKey(key) { const [c, n] = key.split('/'); return { className: c, name: n }; }

// ---------- User store (Netlify Blobs) ----------
async function getUser(className, name) {
  const store = getStore('patplayer-users');
  try { const raw = await store.get(userKey(className, name)); return raw ? JSON.parse(raw) : null; }
  catch { return null; }
}

async function saveUser(user) {
  const store = getStore('patplayer-users');
  await store.set(userKey(user.className, user.name), JSON.stringify(user));
}

async function getUserFromToken(event) {
  const auth = event.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return null;
  const key = verifyToken(auth.slice(7));
  if (!key) return null;
  const { className, name } = parseUserKey(key);
  const user = await getUser(className, name);
  return user ? { className, name, last4: user.last4 } : null;
}

// ========== API ==========

async function login(event) {
  try {
    const { className, name, last4, password } = JSON.parse(event.body || '{}');
    if (!className || !name || !last4 || !password)
      return { statusCode: 400, body: JSON.stringify({ error: 'Fill all fields' }) };
    if (!isValidClass(className)) return { statusCode: 400, body: JSON.stringify({ error: '无效的班级' }) };
    if (!/^\d{4}$/.test(last4)) return { statusCode: 400, body: JSON.stringify({ error: '学号后4位应为4位数字' }) };

    const user = await getUser(className, name);
    if (!user) return { statusCode: 401, body: JSON.stringify({ error: 'Account not found' }) };
    if (user.last4 !== last4) return { statusCode: 401, body: JSON.stringify({ error: 'Wrong student ID' }) };
    if (!verifyPassword(password, user.passwordHash)) return { statusCode: 401, body: JSON.stringify({ error: 'Wrong password' }) };

    return { statusCode: 200, body: JSON.stringify({ success: true, token: generateToken(userKey(className, name)), className, name }) };
  } catch (err) { return { statusCode: 500, body: JSON.stringify({ error: err.message }) }; }
}

async function register(event) {
  try {
    const { className, name, last4 } = JSON.parse(event.body || '{}');
    if (!className || !name || !last4)
      return { statusCode: 400, body: JSON.stringify({ error: 'Fill all fields' }) };
    if (!isValidClass(className)) return { statusCode: 400, body: JSON.stringify({ error: '无效的班级' }) };
    if (!/^\d{4}$/.test(last4)) return { statusCode: 400, body: JSON.stringify({ error: '学号后4位应为4位数字' }) };

    if (await getUser(className, name))
      return { statusCode: 400, body: JSON.stringify({ error: 'Already registered' }) };

    await saveUser({ className, name: name.trim(), last4, passwordHash: DEFAULT_PASSWORD_HASH, createdAt: new Date().toISOString() });
    return { statusCode: 200, body: JSON.stringify({ success: true, token: generateToken(userKey(className, name)), className, name, message: 'Registered! Default password: 123456' }) };
  } catch (err) { return { statusCode: 500, body: JSON.stringify({ error: err.message }) }; }
}

async function me(event) {
  const user = await getUserFromToken(event);
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: 'Not logged in' }) };
  return { statusCode: 200, body: JSON.stringify({ className: user.className, name: user.name }) };
}

async function changePassword(event) {
  try {
    const u = await getUserFromToken(event);
    if (!u) return { statusCode: 401, body: JSON.stringify({ error: '请先登录' }) };
    const { oldPassword, newPassword } = JSON.parse(event.body || '{}');
    if (!oldPassword || !newPassword) return { statusCode: 400, body: JSON.stringify({ error: 'Fill both passwords' }) };
    if (newPassword.length < 4) return { statusCode: 400, body: JSON.stringify({ error: 'Min 4 chars' }) };

    const full = await getUser(u.className, u.name);
    if (!verifyPassword(oldPassword, full.passwordHash)) return { statusCode: 400, body: JSON.stringify({ error: 'Wrong old password' }) };
    full.passwordHash = hashPassword(newPassword);
    await saveUser(full);
    return { statusCode: 200, body: JSON.stringify({ success: true, message: 'Password changed' }) };
  } catch (err) { return { statusCode: 500, body: JSON.stringify({ error: err.message }) }; }
}

// ========== Routes ==========
export const handler = async (event) => {
  const path = event.path.replace('/api/auth/', '');
  switch (path) {
    case 'login':            return login({ ...event, httpMethod: event.httpMethod, body: event.body, headers: event.headers });
    case 'register':         return register({ ...event, httpMethod: event.httpMethod, body: event.body, headers: event.headers });
    case 'me':               return me({ ...event, httpMethod: event.httpMethod, headers: event.headers });
    case 'change-password':  return changePassword(event);
    default:                 return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
  }
};

