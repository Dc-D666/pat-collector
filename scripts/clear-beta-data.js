'use strict';

// 清内测数据（2026-08-20）：TRUNCATE 全部业务表，保留 articles（教程）与 settings（运行时设置）。
// R2-4（2026-08-21）：同时清空 storage/uploads（作品文件）与 storage/qq-sessions（QQ CLI 会话/token）。
// 用法：node scripts/clear-beta-data.js
// 警告：执行前请先备份（storage/backups/ 已含 pre-clear 快照）；本脚本不可逆。
// 注意：.env 中的凭据（DB 密码/TOKEN_SECRET/VIRUSTOTAL_API_KEY 等）不会被本脚本删除，
//       如需彻底重置请手动处理 .env 与 .env.example 差异。

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../server/config');

// 清空顺序无要求（FOREIGN_KEY_CHECKS=0 下 TRUNCATE），按依赖列出便于阅读
const CLEAR_TABLES = [
  'points_log', 'task_progress', 'likes', 'purchases', 'judge_reviews',
  'upload_log', 'audit_logs', 'admin_log', 'feed_like_snapshots',
  'files', 'apps', 'links', 'users',
];
const KEEP_TABLES = ['articles', 'settings'];

// R2-4：递归清空目录内容（保留目录本身）
function emptyDir(dir) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removed += emptyDir(p);
      fs.rmdirSync(p);
    } else {
      fs.unlinkSync(p);
      removed++;
    }
  }
  return removed;
}

async function countAll(conn, tables) {
  for (const t of tables) {
    const [r] = await conn.query('SELECT COUNT(*) AS c FROM `' + t + '`');
    console.log('  ' + String(t).padEnd(20), r[0].c);
  }
}

async function main() {
  const conn = await mysql.createConnection(config.db);
  try {
    console.log('== 清理前 ==');
    await countAll(conn, [...CLEAR_TABLES, ...KEEP_TABLES]);

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of CLEAR_TABLES) {
      await conn.query('TRUNCATE TABLE `' + t + '`');
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log('== 已 TRUNCATE', CLEAR_TABLES.length, '张业务表 ==');

    // R2-4：清空落盘作品文件与 QQ 会话（否则删库后仍残留隐私数据/CLI token，且留孤儿文件）
    const uploadsRemoved = emptyDir(path.resolve(config.storageDir));
    const sessionsRemoved = emptyDir(path.resolve(config.qqSessionsDir));
    console.log('== 已清理 storage/uploads:', uploadsRemoved, '个文件；storage/qq-sessions:', sessionsRemoved, '个文件 ==');

    console.log('== 清理后 ==');
    await countAll(conn, [...CLEAR_TABLES, ...KEEP_TABLES]);
    console.log('✅ 清理完成（articles 教程与 settings 已保留）');
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('❌ 清理失败：', e.message);
  process.exit(1);
});
