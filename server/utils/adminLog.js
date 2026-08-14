'use strict';

// 管理后台操作审计：管理员每次写操作记一行（谁/何时/对什么/做了什么/IP）
const { query } = require('../db');

// detail 可为字符串或对象（对象自动 JSON 序列化，截断防超长）
async function writeAdminLog(adminId, action, targetType, targetId, detail, req) {
  let detailStr = '';
  if (detail != null) {
    detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail);
    if (detailStr.length > 1000) detailStr = detailStr.slice(0, 1000);
  }
  const ip = req && (req.ip || (req.connection && req.connection.remoteAddress) || '') || '';
  try {
    await query(
      'INSERT INTO admin_log (admin_id, action, target_type, target_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?)',
      [adminId, action, String(targetType || ''), Number(targetId || 0), detailStr, String(ip).slice(0, 64)]
    );
  } catch (err) {
    // 审计失败不阻断主流程，但要打日志便于发现
    console.error('[adminLog] 写入审计失败：', err.message);
  }
}

module.exports = { writeAdminLog };
