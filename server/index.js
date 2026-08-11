// Express 服务主入口
import express from 'express';
import session from 'express-session';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { CONFIG } from './config.js';
import authRoutes from './routes/auth.js';
import fileRoutes from './routes/files.js';
import classRoutes from './routes/class.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// ============ 中间件 ============

// JSON 解析
app.use(express.json());

// Session 配置
app.use(session({
  secret: CONFIG.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: CONFIG.TOKEN_EXPIRE,
    sameSite: 'lax',
  },
}));

// ============ API 路由 ============

app.use('/api/auth', authRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/class', classRoutes);

// ============ 静态文件服务 ============

// Astro 构建产物
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
}

// ============ SPA 回退 ============

// 所有非 API 请求返回 index.html
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '接口不存在' });
  }
  const indexPath = path.join(distDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send(`
      <!DOCTYPE html>
      <html lang="zh-CN">
      <head><meta charset="UTF-8"><title>PatPlayer</title></head>
      <body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">
        <div style="text-align:center">
          <h1>🎬 PatPlayer</h1>
          <p>高中AI社团作品收集管理系统</p>
          <p style="color:#888">请先运行 <code>npm run build</code> 构建前端</p>
        </div>
      </body>
      </html>
    `);
  }
});

// ============ 错误处理 ============

app.use((err, _req, res, _next) => {
  console.error('服务器错误:', err);
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '文件大小超过限制（最大500MB）' });
  }
  if (err.message?.includes('路径越权')) {
    return res.status(403).json({ error: '访问被拒绝' });
  }
  res.status(500).json({ error: err.message || '内部服务器错误' });
});

// ============ 启动服务 ============

// 确保 uploads 目录存在
if (!fs.existsSync(CONFIG.UPLOAD_ROOT)) {
  fs.mkdirSync(CONFIG.UPLOAD_ROOT, { recursive: true });
}

app.listen(CONFIG.PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log('  🎬 PatPlayer 作品收集管理系统');
  console.log(`  服务已启动: http://localhost:${CONFIG.PORT}`);
  console.log(`  上传目录: ${CONFIG.UPLOAD_ROOT}`);
  console.log('========================================');
});
