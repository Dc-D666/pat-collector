// Netlify Functions: 班级作品墙 & 提交总览 API
import { getStore } from '@netlify/blobs';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

async function getUserFromToken(event) {
  const authHeader = event.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;

    const { data: profile } = await supabase
      .from('profiles')
      .select('class_name, name')
      .eq('id', user.id)
      .single();

    return profile ? { id: user.id, className: profile.class_name, name: profile.name } : null;
  } catch {
    return null;
  }
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
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const allKeys = blobs.map(b => b.key);
    let metasMap = {};
    if (allKeys.length > 0) {
      const { data: metas } = await supabase
        .from('file_meta')
        .select('blob_key, size, uploaded_at')
        .in('blob_key', allKeys);
      if (metas) {
        metas.forEach(m => { metasMap[m.blob_key] = m; });
      }
    }

    const students = Object.entries(studentMap)
      .map(([name, files]) => {
        const enrichedFiles = files.map(f => {
          const meta = metasMap[f.key];
          return {
            name: f.name,
            size: meta?.size || 0,
            modifiedAt: meta?.uploaded_at || null,
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

    // 获取所有 profiles
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('class_name, name');

    // 获取元数据
    const allKeys = blobs.map(b => b.key);
    let metasMap = {};
    if (allKeys.length > 0) {
      const { data: metas } = await supabase
        .from('file_meta')
        .select('blob_key, size, uploaded_at')
        .in('blob_key', allKeys);
      if (metas) {
        metas.forEach(m => { metasMap[m.blob_key] = m; });
      }
    }

    // 按班级-学生 组织
    const classMap = {};
    const classStudentSet = {}; // 记录每个班级有哪些学生（即使没提交文件）

    if (profiles) {
      profiles.forEach(p => {
        if (!classStudentSet[p.class_name]) classStudentSet[p.class_name] = new Set();
        classStudentSet[p.class_name].add(p.name);
      });
    }

    for (const blob of blobs) {
      const parts = blob.key.split('/');
      if (parts.length < 3) continue;
      const [className, studentName, filename] = parts;

      if (!classMap[className]) classMap[className] = {};
      if (!classMap[className][studentName]) classMap[className][studentName] = [];
      classMap[className][studentName].push({
        name: filename,
        key: blob.key,
        ...(metasMap[blob.key] || {}),
      });
    }

    // 确保所有有学生的班级都出现
    for (const [className, students] of Object.entries(classStudentSet)) {
      if (!classMap[className]) classMap[className] = {};
    }

    const result = Object.entries(classMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([className, studentMap]) => {
        const students = Object.entries(studentMap)
          .sort(([a], [b]) => a.localeCompare(b, 'zh-CN'))
          .map(([name, files]) => {
            const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
            return {
              name,
              fileCount: files.length,
              totalSize,
              files: files.sort((a, b) => new Date(b.uploaded_at || 0) - new Date(a.uploaded_at || 0)),
            };
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
