'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const authRoutes = require('./routes/auth');
const fileRoutes = require('./routes/files');
const classRoutes = require('./routes/class');

config.assertConfig();

// 确保存储目录存在
fs.mkdirSync(config.storageDir, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/class', classRoutes);

// 未知 API 路径 → 404 JSON
app.use('/api', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 静态资源 + SPA 回退（hash 路由，始终返回 index.html）
app.use(express.static(config.publicDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(config.publicDir, 'index.html'));
});

// 统一错误处理
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] 未处理错误：', err);
  res.status(500).json({ error: '服务器内部错误' });
});

app.listen(config.port, '127.0.0.1', () => {
  console.log(`[server] PatPlayer 已启动：http://127.0.0.1:${config.port}`);
});
