'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('./config');
const authRoutes = require('./routes/auth');
const authQqRoutes = require('./routes/auth-qq');
const fileRoutes = require('./routes/files');
const classRoutes = require('./routes/class');
const appRoutes = require('./routes/apps');
const learnRoutes = require('./routes/learn');
const pointsRoutes = require('./routes/points');
const guestRoutes = require('./routes/guest');
const adminRoutes = require('./routes/admin');
const { startJobs } = require('./jobs');

config.assertConfig();

// 确保存储目录存在
fs.mkdirSync(config.storageDir, { recursive: true });

// 后台任务：过期频道置顶/精华自动回收
startJobs();

const app = express();
app.disable('x-powered-by');
// 经 nginx 反代（deploy/pat.weaxi.cn.conf 已设 X-Forwarded-For）：开启后 req.ip 才取真实客户端 IP，
// 否则所有基于 IP 的速率限制退化为全局单桶（全部命中 127.0.0.1）。
// 只信任一跳（本机 nginx），服务本身仅监听 127.0.0.1。
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));

// API 路由
app.use('/api/auth/qq', authQqRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/class', classRoutes);
app.use('/api/apps', appRoutes);
app.use('/api/learn', learnRoutes);
app.use('/api/points', pointsRoutes);
app.use('/api/guest', guestRoutes);
app.use('/api/admin', adminRoutes);

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
