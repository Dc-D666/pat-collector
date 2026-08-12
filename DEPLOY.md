# 部署指南

目标环境：腾讯云轻量（宝塔面板）`pat.weaxi.cn` → `49.232.252.213`。

## 0. 前置确认

- 机器时区为北京时间：`timedatectl set-timezone Asia/Shanghai`
- 已安装 Node.js ≥ 18、MySQL 5.7+、PM2、nginx
- 已在 MySQL 建库并授权（应用账号，utf8mb4）

## 1. 上传代码并安装

```bash
cd /home/PatPlayer
git pull   # 或 scp 上传
npm install --production
```

## 2. 初始化数据库

```bash
mysql -u <user> -p <db> < server/schema.sql
# 或 npm run init-db（读 server/schema.sql）
```

## 3. 配置 .env（关键！）

```bash
cp .env.example .env
vim .env
```

必须设置：

| 变量 | 值 |
| --- | --- |
| `NODE_ENV` | `production`（缺失时密钥 fail-fast 不生效） |
| `DB_HOST` / `DB_NAME` / `DB_USER` / `DB_PASSWORD` | 生产库连接 |
| `TOKEN_SECRET` | **强随机值**（如 `openssl rand -hex 32`），缺失/示例值将拒绝启动 |
| `MAX_UPLOAD_MB` | 与 nginx `client_max_body_size` 对齐（默认 200） |

## 4. 启动（PM2）

```bash
# 首次（或改了 ecosystem 配置后）需 delete 再 start：
pm2 delete patplayer 2>/dev/null || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # 开机自启（按提示执行输出命令）
```

> 注意：`pm2 restart` 不会重读 ecosystem 文件；改动配置用 `pm2 delete` + `pm2 start`。

## 5. 配置 nginx 反代

参考 `deploy/pat.weaxi.cn.conf`：80 → 301 → 443 → `127.0.0.1:3001`，`client_max_body_size 200m`。

```bash
cp deploy/pat.weaxi.cn.conf /www/server/panel/vhost/nginx/patplayer.conf
nginx -t && nginx -s reload
```

## 6. 验证

```bash
curl -I https://pat.weaxi.cn            # 200
curl -s https://pat.weaxi.cn/api/auth/me # 未登录应 401
```

浏览器打开 `https://pat.weaxi.cn`，注册一个账号（默认密码 `123456`，首登强制改密），上传/下载/班级墙/总览各走一遍。

## 回滚

旧版本若用 PM2 管理：`pm2 stop patplayer` 即可停止；数据在 MySQL 与 `storage/uploads/`，删除需谨慎。
