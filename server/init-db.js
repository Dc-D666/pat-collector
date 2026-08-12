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
    console.log('[init-db] ✅ 建表完成：users / files');
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
