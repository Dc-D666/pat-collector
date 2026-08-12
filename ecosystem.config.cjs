// PM2 部署配置：pm2 start ecosystem.config.cjs
// 敏感配置（DB 密码、TOKEN_SECRET 等）放服务器上的 .env，勿写入本文件/仓库
module.exports = {
  apps: [
    {
      name: 'patplayer',
      script: 'server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production', // 触发 TOKEN_SECRET 缺失时的 fail-fast
      },
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-error.log',
      merge_logs: true,
    },
  ],
};
