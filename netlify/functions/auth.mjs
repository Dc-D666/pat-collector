// PatPlayer 认证 API — 本地账号系统（Netlify Blobs 存储）
import { getStore } from '@netlify/blobs';
import crypto from 'crypto';

// ---------- 配置 ----------
const CLASSES = [
  ...Array.from({ length: 24 }, (_, i) => `25${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 25 }, (_, i) => `26${String(i + 1).padStart(2, '0')}`),
];
const TOKEN_SECRET = process.env.TOKEN_SECRET || 'patplayer-default-secret-change-me';
const DEFAULT_PASSWORD_HASH = hashPassword('123456');

// ---------- 工具函数 ----------
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

// ---------- 用户存储（Netlify Blobs）----------
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
      return { statusCode: 400, body: JSON.stringify({ error: '请填写班级、姓名、学号后4位和密码' }) };
    if (!isValidClass(className)) return { statusCode: 400, body: JSON.stringify({ error: '无效的班级' }) };
    if (!/^\d{4}$/.test(last4)) return { statusCode: 400, body: JSON.stringify({ error: '学号后4位应为4位数字' }) };

    const user = await getUser(className, name);
    if (!user) return { statusCode: 401, body: JSON.stringify({ error: '账号不存在，请检查班级和姓名' }) };
    if (user.last4 !== last4) return { statusCode: 401, body: JSON.stringify({ error: '学号后4位不正确' }) };
    if (!verifyPassword(password, user.passwordHash)) return { statusCode: 401, body: JSON.stringify({ error: '密码不正确' }) };

    return { statusCode: 200, body: JSON.stringify({ success: true, token: generateToken(userKey(className, name)), className, name }) };
  } catch (err) { return { statusCode: 500, body: JSON.stringify({ error: err.message }) }; }
}

async function register(event) {
  try {
    const { className, name, last4 } = JSON.parse(event.body || '{}');
    if (!className || !name || !last4)
      return { statusCode: 400, body: JSON.stringify({ error: '请填写班级、姓名和学号后4位' }) };
    if (!isValidClass(className)) return { statusCode: 400, body: JSON.stringify({ error: '无效的班级' }) };
    if (!/^\d{4}$/.test(last4)) return { statusCode: 400, body: JSON.stringify({ error: '学号后4位应为4位数字' }) };

    if (await getUser(className, name))
      return { statusCode: 400, body: JSON.stringify({ error: '该班级和姓名已注册' }) };

    await saveUser({ className, name: name.trim(), last4, passwordHash: DEFAULT_PASSWORD_HASH, createdAt: new Date().toISOString() });
    return { statusCode: 200, body: JSON.stringify({ success: true, token: generateToken(userKey(className, name)), className, name, message: '注册成功！初始密码为 123456' }) };
  } catch (err) { return { statusCode: 500, body: JSON.stringify({ error: err.message }) }; }
}

async function me(event) {
  const user = await getUserFromToken(event);
  if (!user) return { statusCode: 401, body: JSON.stringify({ error: '未登录或登录已过期' }) };
  return { statusCode: 200, body: JSON.stringify({ className: user.className, name: user.name }) };
}

async function changePassword(event) {
  try {
    const u = await getUserFromToken(event);
    if (!u) return { statusCode: 401, body: JSON.stringify({ error: '请先登录' }) };
    const { oldPassword, newPassword } = JSON.parse(event.body || '{}');
    if (!oldPassword || !newPassword) return { statusCode: 400, body: JSON.stringify({ error: '请填写旧密码和新密码' }) };
    if (newPassword.length < 4) return { statusCode: 400, body: JSON.stringify({ error: '新密码至少4位' }) };

    const full = await getUser(u.className, u.name);
    if (!verifyPassword(oldPassword, full.passwordHash)) return { statusCode: 400, body: JSON.stringify({ error: '旧密码不正确' }) };
    full.passwordHash = hashPassword(newPassword);
    await saveUser(full);
    return { statusCode: 200, body: JSON.stringify({ success: true, message: '密码修改成功' }) };
  } catch (err) { return { statusCode: 500, body: JSON.stringify({ error: err.message }) }; }
}

// ========== 路由 ==========
export const handler = async (event) => {
  const path = event.path.replace('/api/auth/', '');
  switch (path) {
    case 'login':            return login({ ...event, httpMethod: event.httpMethod, body: event.body, headers: event.headers });
    case 'register':         return register({ ...event, httpMethod: event.httpMethod, body: event.body, headers: event.headers });
    case 'me':               return me({ ...event, httpMethod: event.httpMethod, headers: event.headers });
    case 'change-password':  return changePassword(event);
    default:                 return { statusCode: 404, body: JSON.stringify({ error: '接口不存在' }) };
  }
};

// 允许的班级列表
const CLASSES = [
  ...Array.from({ length: 24 }, (_, i) => `25${String(i + 1).padStart(2, '0')}`),
  ...Array.from({ length: 25 }, (_, i) => `26${String(i + 1).padStart(2, '0')}`),
];

function isValidClass(className) {
  return CLASSES.includes(className);
}

/**
 * POST /api/auth/register
 * 注册：Supabase Auth + 班级/姓名信息存入 profiles 表
 */
export async function register(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { email, password, className, name, last4 } = JSON.parse(event.body);
    
    if (!email || !password || !className || !name || !last4) {
      return { statusCode: 400, body: JSON.stringify({ error: '请填写所有字段' }) };
    }
    if (!isValidClass(className)) {
      return { statusCode: 400, body: JSON.stringify({ error: '无效的班级' }) };
    }
    if (!/^\d{4}$/.test(last4)) {
      return { statusCode: 400, body: JSON.stringify({ error: '学号后4位应为4位数字' }) };
    }

    const supabase = getSupabase();

    // Supabase Auth 注册
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { className, name, last4 },
      },
    });

    if (authError) throw authError;

    // 写入 profiles 表
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: authData.user.id,
        email,
        class_name: className,
        name: name.trim(),
        last4,
      });

    if (profileError) throw profileError;

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, user: authData.user }),
    };
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: err.message }),
    };
  }
}

/**
 * POST /api/auth/login
 * 登录
 */
export async function login(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { email, password } = JSON.parse(event.body);
    const supabase = getSupabase();

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    // 获取 profile 信息
    const { data: profile } = await supabase
      .from('profiles')
      .select('class_name, name, last4')
      .eq('id', data.user.id)
      .single();

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        session: data.session,
        user: { ...data.user, profile },
      }),
    };
  } catch (err) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: err.message }),
    };
  }
}

/**
 * GET /api/auth/me
 * 获取当前用户信息
 */
export async function me(event) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const authHeader = event.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return { statusCode: 401, body: JSON.stringify({ error: '未登录' }) };
    }

    const token = authHeader.slice(7);
    const supabase = getSupabase();
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      return { statusCode: 401, body: JSON.stringify({ error: '登录已过期' }) };
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('class_name, name, last4')
      .eq('id', user.id)
      .single();

    return {
      statusCode: 200,
      body: JSON.stringify({
        className: profile?.class_name,
        name: profile?.name,
        email: user.email,
      }),
    };
  } catch (err) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: err.message }),
    };
  }
}

export const handler = async (event) => {
  const path = event.path.replace('/api/auth/', '');
  
  switch (path) {
    case 'register':
      return register({ ...event, httpMethod: 'POST', body: event.body });
    case 'login':
      return login({ ...event, httpMethod: 'POST', body: event.body });
    case 'me':
      return me({ ...event, httpMethod: 'GET', headers: event.headers });
    default:
      return { statusCode: 404, body: JSON.stringify({ error: '接口不存在' }) };
  }
};
