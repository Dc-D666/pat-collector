// Netlify Functions: 文件管理 API（使用 Netlify Blobs）
import { getStore } from '@netlify/blobs';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// 文件扩展名白名单
const ALLOWED_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg',
  '.mp4', '.webm', '.mov', '.avi',
  '.mp3', '.wav', '.ogg',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.md', '.csv', '.json', '.xml',
  '.zip', '.rar', '.7z',
  '.py', '.js', '.html', '.css', '.cpp', '.c', '.java',
  '.psd', '.ai', '.blend', '.fbx', '.obj',
];

function isAllowedExtension(filename) {
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

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

function blobKey(user, filename) {
  return `${user.className}/${user.name}/${filename}`;
}

/**
 * POST /api/files/upload
 * 上传文件到 Netlify Blobs
 */
async function upload(event, user) {
  try {
    const { filename, contentType, data, size } = JSON.parse(event.body);

    if (!filename || !data) {
      return { statusCode: 400, body: JSON.stringify({ error: '缺少文件名或数据' }) };
    }
    if (!isAllowedExtension(filename)) {
      return { statusCode: 400, body: JSON.stringify({ error: '不支持的文件类型' }) };
    }

    const store = getStore('patplayer-files');
    const key = blobKey(user, filename);

    // 将 base64 数据转成 Buffer 并存储
    const buffer = Buffer.from(data, 'base64');
    await store.set(key, buffer, { metadata: { contentType } });

    // 保存元数据到 Supabase
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    await supabase.from('file_meta').upsert({
      blob_key: key,
      user_id: user.id,
      class_name: user.className,
      student_name: user.name,
      filename,
      size: size || buffer.length,
      content_type: contentType,
      uploaded_at: new Date().toISOString(),
    }, { onConflict: 'blob_key' });

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, filename, size: buffer.length }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

/**
 * GET /api/files/list
 * 列出当前用户的文件
 */
async function listFiles(event, user) {
  try {
    const store = getStore('patplayer-files');
    const prefix = `${user.className}/${user.name}/`;

    const { blobs } = await store.list({ prefix });

    const files = blobs.map(b => {
      const filename = b.key.replace(prefix, '');
      return {
        name: filename,
        key: b.key,
        size: 0, // Netlify Blobs list 不含大小，需要单独获取
        uploadedAt: null,
      };
    });

    // 从 Supabase file_meta 表获取元数据
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const keys = blobs.map(b => b.key);
    if (keys.length > 0) {
      const { data: metas } = await supabase
        .from('file_meta')
        .select('blob_key, size, uploaded_at')
        .in('blob_key', keys);

      if (metas) {
        const metaMap = {};
        metas.forEach(m => { metaMap[m.blob_key] = m; });
        files.forEach(f => {
          const meta = metaMap[f.key];
          if (meta) {
            f.size = meta.size;
            f.uploadedAt = meta.uploaded_at;
          }
        });
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ files }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

/**
 * DELETE /api/files/delete
 * 删除文件
 */
async function deleteFile(event, user) {
  try {
    const { filename } = JSON.parse(event.body);
    const store = getStore('patplayer-files');
    const key = blobKey(user, filename);

    await store.delete(key);

    // 删除元数据
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    await supabase.from('file_meta').delete().eq('blob_key', key);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

/**
 * GET /api/files/download
 * 下载文件
 */
async function downloadFile(event, user) {
  try {
    const filename = event.queryStringParameters?.filename;
    if (!filename) {
      return { statusCode: 400, body: JSON.stringify({ error: '缺少文件名' }) };
    }

    const store = getStore('patplayer-files');
    const key = blobKey(user, filename);

    // 从 Netlify Blobs 读取文件
    const blob = await store.get(key, { type: 'stream' });
    if (!blob) {
      return { statusCode: 404, body: JSON.stringify({ error: '文件不存在' }) };
    }

    // 读取 stream 为 Buffer
    const chunks = [];
    for await (const chunk of blob) {
      chunks.push(chunk);
    }
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
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}

export const handler = async (event) => {
  // CORS 预检
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*' } };
  }

  const user = await getUserFromToken(event);
  if (!user) {
    return { statusCode: 401, body: JSON.stringify({ error: '请先登录' }) };
  }

  const path = event.path.replace('/api/files/', '');

  switch (path) {
    case 'upload':
      return upload(event, user);
    case 'list':
      return listFiles(event, user);
    case 'delete':
      return deleteFile(event, user);
    case 'download':
      return downloadFile(event, user);
    default:
      return { statusCode: 404, body: JSON.stringify({ error: '接口不存在' }) };
  }
};
