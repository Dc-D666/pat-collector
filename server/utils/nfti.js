'use strict';

// NFTI 体验判定（只读 nfti 库）：/api/learn/nfti-status 与任务完成核验共用
const mysql = require('mysql2/promise');
const config = require('../config');

// 判定用户在 NFTI 是否已完成过人格测试
async function hasNftiExperience(tinyId) {
  if (!config.nftiDb.password || !tinyId) return false;
  const conn = await mysql.createConnection(config.nftiDb);
  try {
    const [rows] = await conn.execute(
      "SELECT COUNT(*) AS cnt FROM test_results WHERE tiny_id = ? AND assessment_type = 'nfti'",
      [String(tinyId)]
    );
    return rows.length > 0 && Number(rows[0].cnt) > 0;
  } finally {
    await conn.end();
  }
}

module.exports = { hasNftiExperience };
