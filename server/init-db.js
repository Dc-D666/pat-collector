'use strict';

// 一次性初始化：建表 + 创建存储目录。npm run init-db
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./config');

async function main() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const conn = await mysql.createConnection(config.db);
  try {
    // 先去整行注释，再按分号切（本文件无存储过程/触发器，够用）
    const withoutComments = schema
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    const statements = withoutComments
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      await conn.query(stmt);
    }
    // 存量库迁移：users 表补 guest_token 列（MySQL 不支持 ADD COLUMN IF NOT EXISTS，先查 information_schema）
    const [cols] = await conn.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'guest_token'"
    );
    if (cols.length === 0) {
      await conn.query(
        'ALTER TABLE users ADD COLUMN guest_token VARCHAR(64) NULL COMMENT \'访客直传项目地址令牌（长随机串，无过期）\' AFTER nickname, ADD UNIQUE KEY uq_guest (guest_token)'
      );
      console.log('[init-db] ✅ users.guest_token 列已补充（存量库迁移）');
    }
    // 存量库迁移：users 表补 guest_pwd_hash 列（访客删除安全密码哈希）
    const [pwdCols] = await conn.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'guest_pwd_hash'"
    );
    if (pwdCols.length === 0) {
      await conn.query(
        'ALTER TABLE users ADD COLUMN guest_pwd_hash VARCHAR(200) NULL COMMENT \'访客删除安全密码哈希（scrypt salt:hash；空=默认密码）\' AFTER guest_token'
      );
      console.log('[init-db] ✅ users.guest_pwd_hash 列已补充（存量库迁移）');
    }
    // 存量库迁移：users 表补 is_admin / status 列（管理后台）
    const [adminCols] = await conn.query(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_admin'"
    );
    if (adminCols.length === 0) {
      await conn.query(
        "ALTER TABLE users ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0 COMMENT '管理员（仅 QQ 登录用户可为）' AFTER guest_pwd_hash, ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'active' COMMENT 'active / disabled（停用：禁登录/上传）' AFTER is_admin"
      );
      console.log('[init-db] ✅ users.is_admin / status 列已补充（存量库迁移）');
    }
    console.log('[init-db] ✅ 建表完成：users / files / admin_log');
  } finally {
    await conn.end();
  }
  fs.mkdirSync(config.storageDir, { recursive: true });
  console.log('[init-db] ✅ 存储目录就绪：' + config.storageDir);
}

main().catch((err) => {
  console.error('[init-db] ❌ 初始化失败：', err.message);
  process.exit(1);
});
