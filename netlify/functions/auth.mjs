// Netlify Functions: 认证相关 API
// 使用 Supabase Auth 进行身份验证

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

function getSupabase() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase 环境变量未配置');
  }
  return createClient(supabaseUrl, supabaseAnonKey);
}

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
