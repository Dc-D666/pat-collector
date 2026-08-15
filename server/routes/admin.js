'use strict';

// 管理后台 P0：仪表盘 / 用户管理 / 文件管理 / 内容审核。
// 全部接口 requireAdmin（Bearer + is_admin），写操作记 admin_log 审计。

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { query, pool } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAdmin } = require('../middleware/admin');
const { writeAdminLog } = require('../utils/adminLog');
const { grant, revoke } = require('../utils/points');
const { freeDiskBytes } = require('../utils/disk');
const qqSessions = require('../qq/sessions');

const router = express.Router();
router.use(requireAdmin);

// 当前时间 + 偏移毫秒 → 'YYYY-MM-DD HH:mm:ss'（本地时区，与 MySQL 墙钟一致）
function mysqlNow(offsetMs) {
  const d = new Date(Date.now() + (offsetMs || 0));
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---- 仪表盘 ----
router.get('/stats', asyncHandler(async (req, res) => {
  const [u] = await query('SELECT COUNT(*) AS c, COALESCE(SUM(is_admin),0) AS admins FROM users');
  const [uToday] = await query('SELECT COUNT(*) AS c FROM users WHERE DATE(created_at) = CURDATE()');
  const [f] = await query('SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS total FROM files');
  const [fToday] = await query('SELECT COUNT(*) AS c FROM files WHERE DATE(uploaded_at) = CURDATE()');
  const [apps] = await query('SELECT COUNT(*) AS c FROM apps');
  const [pts] = await query('SELECT COALESCE(SUM(points),0) AS total FROM users');
  const [pend] = await query("SELECT COUNT(*) AS c FROM files WHERE audit_status = 'pending'");
  const [flag] = await query("SELECT COUNT(*) AS c FROM files WHERE audit_status = 'flagged'");
  const [ulog] = await query('SELECT COUNT(*) AS c FROM upload_log WHERE DATE(created_at) = CURDATE()');
  res.json({
    users: u.c,
    users_today: uToday.c,
    admins: Number(u.admins),
    files: f.c,
    files_today: fToday.c,
    storage_bytes: Number(f.total),
    disk_free_bytes: freeDiskBytes(config.storageDir),
    apps: apps.c,
    points_total: Number(pts.total),
    audit_pending: pend.c,
    audit_flagged: flag.c,
    uploads_today: ulog.c,
  });
}));

// ---- 用户管理 ----
// q=关键字 role=guest|qq status=disabled|admin token=访客令牌前缀
router.get('/users', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const role = String(req.query.role || '');
  const status = String(req.query.status || '');
  const token = String(req.query.token || '').trim();
  const where = [];
  const params = [];
  if (q) {
    where.push('(u.real_name LIKE ? OR u.nickname LIKE ? OR u.class_name LIKE ?)');
    const like = '%' + q + '%';
    params.push(like, like, like);
  }
  if (token) { where.push('u.guest_token LIKE ?'); params.push(token + '%'); }
  if (role === 'guest') where.push('u.guest_token IS NOT NULL');
  if (role === 'qq') where.push('u.qq_tiny_id IS NOT NULL');
  if (status === 'disabled') where.push("u.status = 'disabled'");
  if (status === 'admin') where.push('u.is_admin = 1');
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await query(
    `SELECT u.id, u.class_name, u.real_name, u.nickname, u.show_real_name, u.qq_tiny_id,
            u.guest_token IS NOT NULL AS is_guest, u.is_admin, u.status, u.points, u.created_at,
       (SELECT COUNT(*) FROM files f WHERE f.user_id = u.id) AS file_count,
       (SELECT COALESCE(SUM(size),0) FROM files f WHERE f.user_id = u.id) AS storage_bytes,
       (SELECT COUNT(*) FROM apps a WHERE a.user_id = u.id) AS app_count,
       (SELECT COUNT(*) FROM upload_log ul WHERE ul.user_id = u.id AND DATE(ul.created_at) = CURDATE()) AS uploads_today
     FROM users u ${whereSql}
     ORDER BY u.id DESC LIMIT 100`,
    params
  );
  res.json({ users: rows });
}));

// 调整积分（±，原因必填，幂等 ref 每次唯一）
router.post('/users/:id/points', asyncHandler(async (req, res) => {
  const uid = Number(req.params.id);
  // 防自肥：管理员不能调整自己的积分
  if (uid === req.user.id) return res.status(400).json({ error: '不能调整自己的积分' });
  const amount = Number(req.body && req.body.amount);
  const reason = String((req.body && req.body.reason) || '').trim().slice(0, 50);
  if (!Number.isInteger(amount) || amount === 0) return res.status(400).json({ error: '积分变动需为不为 0 的整数' });
  if (Math.abs(amount) > 10000) return res.status(400).json({ error: '单次调整过大（上限 10000）' });
  const [row] = await query('SELECT id FROM users WHERE id = ?', [uid]);
  if (!row) return res.status(404).json({ error: '用户不存在' });

  const ref = 'admin:' + Date.now() + ':' + crypto.randomBytes(4).toString('hex');
  if (amount > 0) {
    await grant(uid, 'admin_adjust', ref, amount);
  } else {
    // 负数：事务扣减（不低于 0），流水按实际扣减记录，保证 points_log 求和 = users.points
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [u] = await conn.execute('SELECT points FROM users WHERE id = ? FOR UPDATE', [uid]);
      const balance = u.length ? Number(u[0].points) : 0;
      const actual = Math.min(balance, -amount); // 实际扣减
      if (actual > 0) {
        await conn.execute('UPDATE users SET points = points - ? WHERE id = ?', [actual, uid]);
        await conn.execute('INSERT INTO points_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)', [uid, -actual, 'admin_adjust', ref]);
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }
  const [after] = await query('SELECT points FROM users WHERE id = ?', [uid]);
  await writeAdminLog(req.user.id, 'user.points.adjust', 'user', uid, { amount, reason }, req);
  res.json({ ok: true, points: after ? after.points : 0, amount, reason });
}));

// 设置 / 取消管理员（仅 QQ 登录用户）
router.post('/users/:id/admin', asyncHandler(async (req, res) => {
  const uid = Number(req.params.id);
  const enabled = !!(req.body && req.body.enabled);
  const [row] = await query('SELECT qq_tiny_id FROM users WHERE id = ?', [uid]);
  if (!row) return res.status(404).json({ error: '用户不存在' });
  if (enabled && !row.qq_tiny_id) return res.status(400).json({ error: '仅 QQ 登录用户可设为管理员' });
  await query('UPDATE users SET is_admin = ? WHERE id = ?', [enabled ? 1 : 0, uid]);
  await writeAdminLog(req.user.id, 'user.admin.set', 'user', uid, { enabled }, req);
  res.json({ ok: true, is_admin: enabled });
}));

// 停用 / 恢复用户
router.post('/users/:id/status', asyncHandler(async (req, res) => {
  const uid = Number(req.params.id);
  const status = String((req.body && req.body.status) || '');
  if (status !== 'active' && status !== 'disabled') return res.status(400).json({ error: '状态仅支持 active / disabled' });
  if (uid === req.user.id) return res.status(400).json({ error: '不能停用自己' });
  await query('UPDATE users SET status = ? WHERE id = ?', [status, uid]);
  await writeAdminLog(req.user.id, 'user.status.set', 'user', uid, { status }, req);
  res.json({ ok: true, status });
}));

// 重置访客删除密码（置回默认）
router.post('/users/:id/guest-pwd-reset', asyncHandler(async (req, res) => {
  const uid = Number(req.params.id);
  await query('UPDATE users SET guest_pwd_hash = NULL WHERE id = ?', [uid]);
  await writeAdminLog(req.user.id, 'user.guest_pwd_reset', 'user', uid, {}, req);
  res.json({ ok: true, message: '已重置为默认密码' });
}));

// 删除用户（级联清数据，物理文件一并删除）
router.delete('/users/:id', asyncHandler(async (req, res) => {
  const uid = Number(req.params.id);
  if (uid === req.user.id) return res.status(400).json({ error: '不能删除自己' });
  const [row] = await query('SELECT id FROM users WHERE id = ?', [uid]);
  if (!row) return res.status(404).json({ error: '用户不存在' });
  const files = await query('SELECT stored_name FROM files WHERE user_id = ?', [uid]);
  await query('DELETE FROM users WHERE id = ?', [uid]); // ON DELETE CASCADE 清 files/apps/流水等
  for (const f of files) {
    fs.promises.unlink(path.join(config.storageDir, f.stored_name)).catch(() => {});
  }
  await writeAdminLog(req.user.id, 'user.delete', 'user', uid, { files: files.length }, req);
  res.json({ ok: true, files_removed: files.length });
}));

// ---- 文件管理 ----
// q=关键字 audit=pending|flagged|reviewed
router.get('/files', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const audit = String(req.query.audit || '');
  const where = [];
  const params = [];
  if (q) {
    where.push('(f.original_name LIKE ? OR f.title LIKE ? OR u.real_name LIKE ? OR u.class_name LIKE ?)');
    const like = '%' + q + '%';
    params.push(like, like, like, like);
  }
  if (audit) {
    where.push('f.audit_status = ?');
    params.push(audit);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await query(
    `SELECT f.id, f.original_name, f.size, f.mime_type, f.title, f.description, f.gameplay,
            f.audit_status, f.audit_reason, f.uploaded_at,
            u.id AS user_id, u.class_name, u.real_name, u.nickname, u.show_real_name
     FROM files f JOIN users u ON u.id = f.user_id
     ${whereSql}
     ORDER BY f.id DESC LIMIT 100`,
    params
  );
  res.json({ files: rows });
}));

// 改作品信息 / 审核状态（管理视角）
router.patch('/files/:id', asyncHandler(async (req, res) => {
  const fid = Number(req.params.id);
  const [row] = await query('SELECT id, user_id, audit_status FROM files WHERE id = ?', [fid]);
  if (!row) return res.status(404).json({ error: '文件不存在' });
  const body = req.body || {};
  const sets = [];
  const params = [];
  if (body.title !== undefined) { sets.push('title = ?'); params.push(String(body.title).trim().slice(0, 255) || null); }
  if (body.description !== undefined) { sets.push('description = ?'); params.push(String(body.description).trim().slice(0, 2000) || null); }
  if (body.gameplay !== undefined) { sets.push('gameplay = ?'); params.push(String(body.gameplay).trim().slice(0, 2000) || null); }
  if (body.audit_status !== undefined) {
    const st = String(body.audit_status);
    if (!['pending', 'reviewed', 'flagged'].includes(st)) return res.status(400).json({ error: '审核状态无效' });
    sets.push('audit_status = ?');
    params.push(st);
    if (body.audit_reason !== undefined) { sets.push('audit_reason = ?'); params.push(String(body.audit_reason).slice(0, 500) || ''); }
  }
  if (!sets.length) return res.status(400).json({ error: '没有要修改的字段' });
  // 从违规改回已通过：补发被回扣的提交积分（与审核"通过"行为一致）
  let restored = 0;
  const targetStatus = body.audit_status !== undefined ? String(body.audit_status) : null;
  if (targetStatus === 'reviewed' && row.audit_status === 'flagged') {
    restored = await restoreFilePoints(row.user_id, fid);
  }
  params.push(fid);
  await query(`UPDATE files SET ${sets.join(', ')} WHERE id = ?`, params);
  await writeAdminLog(req.user.id, 'file.update', 'file', fid, { body, points_restored: restored }, req);
  res.json({ ok: true, points_restored: restored });
}));

// 删除文件（回扣提交积分）
router.delete('/files/:id', asyncHandler(async (req, res) => {
  const fid = Number(req.params.id);
  const rows = await query('SELECT user_id, stored_name FROM files WHERE id = ?', [fid]);
  if (!rows.length) return res.status(404).json({ error: '文件不存在' });
  const f = rows[0];
  await query('DELETE FROM files WHERE id = ?', [fid]);
  const revoked = await revoke(f.user_id, 'file_submit', 'file:' + fid);
  fs.promises.unlink(path.join(config.storageDir, f.stored_name)).catch(() => {});
  await writeAdminLog(req.user.id, 'file.delete', 'file', fid, { user_id: f.user_id }, req);
  res.json({ ok: true, points_revoked: revoked });
}));

// ---- 内容审核 ----
router.get('/audit', asyncHandler(async (req, res) => {
  const status = String(req.query.status || 'pending');
  if (!['pending', 'flagged', 'reviewed'].includes(status)) return res.status(400).json({ error: '审核状态无效' });
  const rows = await query(
    `SELECT f.id, f.original_name, f.size, f.mime_type, f.title, f.description, f.gameplay,
            f.audit_status, f.audit_reason, f.uploaded_at,
            u.id AS user_id, u.class_name, u.real_name, u.nickname, u.show_real_name
     FROM files f JOIN users u ON u.id = f.user_id
     WHERE f.audit_status = ?
     ORDER BY f.id DESC LIMIT 100`,
    [status]
  );
  res.json({ files: rows });
}));

// 审核操作：approve（通过）/ reject（拒绝+原因+回扣）/ delete（删除+回扣）
router.post('/audit/:id/review', asyncHandler(async (req, res) => {
  const fid = Number(req.params.id);
  const action = String((req.body && req.body.action) || '');
  const rows = await query('SELECT user_id, stored_name, audit_status FROM files WHERE id = ?', [fid]);
  if (!rows.length) return res.status(404).json({ error: '文件不存在' });
  const f = rows[0];

  if (action === 'approve') {
    const restored = await restoreFilePoints(f.user_id, fid);
    await query("UPDATE files SET audit_status = 'reviewed', audit_reason = '' WHERE id = ?", [fid]);
    await writeAdminLog(req.user.id, 'audit.approve', 'file', fid, { prev: f.audit_status, points_restored: restored }, req);
    return res.json({ ok: true, points_restored: restored });
  }
  if (action === 'reject') {
    const reason = String((req.body && req.body.reason) || '').trim().slice(0, 500);
    await query("UPDATE files SET audit_status = 'flagged', audit_reason = ? WHERE id = ?", [reason, fid]);
    const revoked = await revoke(f.user_id, 'file_submit', 'file:' + fid);
    await writeAdminLog(req.user.id, 'audit.reject', 'file', fid, { reason, revoked }, req);
    return res.json({ ok: true, points_revoked: revoked });
  }
  if (action === 'delete') {
    await query('DELETE FROM files WHERE id = ?', [fid]);
    const revoked = await revoke(f.user_id, 'file_submit', 'file:' + fid);
    fs.promises.unlink(path.join(config.storageDir, f.stored_name)).catch(() => {});
    await writeAdminLog(req.user.id, 'audit.delete', 'file', fid, { revoked }, req);
    return res.json({ ok: true, points_revoked: revoked });
  }
  return res.status(400).json({ error: '操作无效' });
}));

// ==================== P1 ====================

// 曾被拒绝回扣过的文件，重新通过时补发 +30（reason 用 file_submit_restore，不占 file_submit 的 5 个名额）
async function restoreFilePoints(userId, fileId) {
  const rv = await query(
    "SELECT id FROM points_log WHERE user_id = ? AND reason = 'file_submit_revoke' AND ref_id = ?",
    [userId, 'file:' + fileId]
  );
  if (!rv.length) return 0;
  return (await grant(userId, 'file_submit_restore', 'file:' + fileId + ':restore', 30)) || 0;
}

// ---- 积分管理 ----
const REASON_TEXT = {
  first_login: '首次登录奖励', read_article: '阅读课程', task: '完成任务',
  app_submit: '提交 AI 轻应用', file_submit: '提交作品文件', like_give: '点赞他人',
  like_receive: '作品被点赞', graduate: '课程毕业奖励', easter_egg: '彩蛋奖励',
  purchase: '积分商城兑换', admin_adjust: '管理员调整', file_submit_restore: '审核通过补发',
  file_submit_revoke: '删除作品文件（回扣）', app_submit_revoke: '删除轻应用（回扣）',
};

router.get('/points/leaderboard', asyncHandler(async (req, res) => {
  const rows = await query(
    'SELECT id, class_name, real_name, nickname, show_real_name, points, is_admin, status FROM users ORDER BY points DESC, id ASC LIMIT 50'
  );
  res.json({ users: rows });
}));

// 积分流水检索：?user_id=&reason=&limit=100
router.get('/points/logs', asyncHandler(async (req, res) => {
  const where = [];
  const params = [];
  const uid = Number(req.query.user_id || 0);
  const reason = String(req.query.reason || '').trim();
  if (uid) { where.push('pl.user_id = ?'); params.push(uid); }
  if (reason) { where.push('pl.reason = ?'); params.push(reason); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  // LIMIT 需为正整数（NaN/负数会 SQL 报错），clamp 到 [1, 500]
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
  const rows = await query(
    `SELECT pl.id, pl.user_id, pl.amount, pl.reason, pl.ref_id, pl.created_at,
            u.class_name, u.real_name, u.nickname
     FROM points_log pl JOIN users u ON u.id = pl.user_id
     ${whereSql}
     ORDER BY pl.id DESC LIMIT ${limit}`,
    params
  );
  res.json({
    logs: rows.map((l) => ({ ...l, reason_text: REASON_TEXT[l.reason] || l.reason })),
  });
}));

// ---- 轻应用管理 ----
router.get('/apps', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const where = [];
  const params = [];
  if (q) {
    where.push('(a.title LIKE ? OR a.app_url LIKE ? OR u.real_name LIKE ? OR u.class_name LIKE ?)');
    const like = '%' + q + '%';
    params.push(like, like, like, like);
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await query(
    `SELECT a.id, a.app_url, a.title, a.description, a.gameplay, a.source_feed_id, a.created_at,
            u.id AS user_id, u.class_name, u.real_name, u.nickname, u.show_real_name
     FROM apps a JOIN users u ON u.id = a.user_id
     ${whereSql}
     ORDER BY a.id DESC LIMIT 100`,
    params
  );
  res.json({ apps: rows });
}));

// 删除轻应用（回扣 +25 提交积分——普通用户路径未回扣，管理端补齐）
router.delete('/apps/:id', asyncHandler(async (req, res) => {
  const aid = Number(req.params.id);
  const rows = await query('SELECT user_id FROM apps WHERE id = ?', [aid]);
  if (!rows.length) return res.status(404).json({ error: '轻应用不存在' });
  await query('DELETE FROM apps WHERE id = ?', [aid]);
  const revoked = await revoke(rows[0].user_id, 'app_submit', 'app:' + aid);
  await writeAdminLog(req.user.id, 'app.delete', 'app', aid, { user_id: rows[0].user_id }, req);
  res.json({ ok: true, points_revoked: revoked });
}));

// ---- 运营（置顶 / 称号 / 商城开关）----
router.get('/purchases', asyncHandler(async (req, res) => {
  const status = String(req.query.status || 'active');
  const where = [];
  const params = [];
  if (status === 'active' || status === 'expired') { where.push('p.status = ?'); params.push(status); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = await query(
    `SELECT p.id, p.item, p.cost, p.ref_type, p.ref_id, p.feed_id, p.title, p.status, p.created_at, p.expires_at,
            u.id AS user_id, u.class_name, u.real_name, u.nickname
     FROM purchases p JOIN users u ON u.id = p.user_id
     ${whereSql}
     ORDER BY p.id DESC LIMIT 100`,
    params
  );
  res.json({ purchases: rows });
}));

// 手动过期一条购买记录（置顶/称号/精华）
router.post('/purchases/:id/expire', asyncHandler(async (req, res) => {
  const pid = Number(req.params.id);
  const [row] = await query('SELECT id FROM purchases WHERE id = ?', [pid]);
  if (!row) return res.status(404).json({ error: '记录不存在' });
  await query("UPDATE purchases SET status = 'expired' WHERE id = ?", [pid]);
  await writeAdminLog(req.user.id, 'purchase.expire', 'purchase', pid, {}, req);
  res.json({ ok: true });
}));

// 手动置顶作品（免费 wall_top，24h 起）：{ ref_type: 'file'|'app', ref_id, hours=24 }
router.post('/pins', asyncHandler(async (req, res) => {
  const refType = String((req.body && req.body.ref_type) || '');
  const refId = Number(req.body && req.body.ref_id);
  const hours = Math.min(Math.max(Number(req.body && req.body.hours) || 24, 1), 168);
  if (refType !== 'file' && refType !== 'app') return res.status(400).json({ error: 'ref_type 仅支持 file / app' });
  if (!refId) return res.status(400).json({ error: '缺少目标 id' });
  const table = refType === 'file' ? 'files' : 'apps';
  const [t] = await query(`SELECT user_id FROM ${table} WHERE id = ?`, [refId]);
  if (!t) return res.status(404).json({ error: '目标作品不存在' });
  // 注意：INSERT 返回 ResultSetHeader（对象），不可解构 [ins]（坑 #29）；INTERVAL 参数化在预处理语句不可用，到期时间用 JS 计算
  const expiresAt = mysqlNow(hours * 3600 * 1000);
  const ins = await query(
    "INSERT INTO purchases (user_id, item, cost, ref_type, ref_id, status, expires_at) VALUES (?, 'wall_top', 0, ?, ?, 'active', ?)",
    [t.user_id, refType, refId, expiresAt]
  );
  await writeAdminLog(req.user.id, 'pin.create', 'purchase', ins.insertId, { ref_type: refType, ref_id: refId, hours }, req);
  res.json({ ok: true, purchase_id: ins.insertId, expires_at: expiresAt });
}));

// 发放专属称号（免费 title，30 天起）：{ user_id, title, days=30 }
router.post('/titles', asyncHandler(async (req, res) => {
  const uid = Number(req.body && req.body.user_id);
  const title = String((req.body && req.body.title) || '').trim().slice(0, 64);
  const days = Math.min(Math.max(Number(req.body && req.body.days) || 30, 1), 365);
  const [u] = await query('SELECT id FROM users WHERE id = ?', [uid]);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  if (!title) return res.status(400).json({ error: '请填写称号' });
  const expiresAt = mysqlNow(days * 24 * 3600 * 1000);
  const ins = await query(
    "INSERT INTO purchases (user_id, item, cost, title, status, expires_at) VALUES (?, 'title', 0, ?, 'active', ?)",
    [uid, title, expiresAt]
  );
  await writeAdminLog(req.user.id, 'title.create', 'purchase', ins.insertId, { user_id: uid, title, days }, req);
  res.json({ ok: true, purchase_id: ins.insertId });
}));

// 运行时设置：GET 全部 / PUT :key
router.get('/settings', asyncHandler(async (req, res) => {
  const rows = await query('SELECT skey, svalue, updated_at FROM settings ORDER BY skey');
  const settings = {};
  for (const r of rows) settings[r.skey] = r.svalue;
  res.json({ settings });
}));

router.put('/settings/:key', asyncHandler(async (req, res) => {
  const key = String(req.params.key || '').trim().slice(0, 64);
  if (!/^[a-z0-9_]+$/i.test(key)) return res.status(400).json({ error: '设置键格式无效' });
  const value = String((req.body && req.body.value) == null ? '' : req.body.value).slice(0, 500);
  await query('INSERT INTO settings (skey, svalue) VALUES (?, ?) ON DUPLICATE KEY UPDATE svalue = VALUES(svalue)', [key, value]);
  // 清运行时设置缓存，立即生效
  const { invalidate } = require('../utils/settings');
  await invalidate();
  await writeAdminLog(req.user.id, 'setting.update', 'setting', 0, { key, value }, req);
  res.json({ ok: true, key, value });
}));

// ---- 存储与会话 ----
router.get('/storage', asyncHandler(async (req, res) => {
  // SELECT 多行返回行数组，直接接收（解构 [x] 会只取首行——坑 #29）
  const byClass = await query(
    `SELECT u.class_name, COUNT(DISTINCT u.id) AS users, COUNT(f.id) AS files, COALESCE(SUM(f.size),0) AS bytes
     FROM users u LEFT JOIN files f ON f.user_id = u.id
     GROUP BY u.class_name ORDER BY bytes DESC LIMIT 30`
  );
  const bigFiles = await query(
    `SELECT f.id, f.original_name, f.size, f.uploaded_at, u.class_name, u.real_name
     FROM files f JOIN users u ON u.id = f.user_id ORDER BY f.size DESC LIMIT 20`
  );
  const [totals] = await query('SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM files');
  res.json({
    by_class: byClass,
    big_files: bigFiles,
    totals: { files: totals.files, bytes: Number(totals.bytes) },
    disk_free_bytes: freeDiskBytes(config.storageDir),
  });
}));

// QQ 会话列表（读取 sessions 模块内存快照）
router.get('/sessions', asyncHandler(async (req, res) => {
  const { listSessions } = require('../qq/sessions');
  res.json({ sessions: listSessions() });
}));

// 使 QQ 会话失效（删除会话目录 + 内存移除）
router.post('/sessions/:id/invalidate', asyncHandler(async (req, res) => {
  const sid = String(req.params.id || '');
  qqSessions.cleanupSession(sid);
  await writeAdminLog(req.user.id, 'session.invalidate', 'session', 0, { session_id: sid }, req);
  res.json({ ok: true });
}));

// ---- 审计日志 ----
router.get('/logs', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const adminId = Number(req.query.admin_id || 0);
  const where = [];
  const params = [];
  if (q) { where.push('(l.action LIKE ? OR l.detail LIKE ? OR l.target_type LIKE ?)'); const like = '%' + q + '%'; params.push(like, like, like); }
  if (adminId) { where.push('l.admin_id = ?'); params.push(adminId); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  // LIMIT 需为正整数（NaN/负数会 SQL 报错），clamp 到 [1, 500]
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
  const rows = await query(
    `SELECT l.id, l.admin_id, l.action, l.target_type, l.target_id, l.detail, l.ip, l.created_at,
            u.real_name AS admin_name
     FROM admin_log l JOIN users u ON u.id = l.admin_id
     ${whereSql}
     ORDER BY l.id DESC LIMIT ${limit}`,
    params
  );
  res.json({ logs: rows });
}));

// 内容审查记录（O3）：AI 拒绝的展示文本（作品标题/简介/玩法），供管理后台追溯
router.get('/audit-logs', asyncHandler(async (req, res) => {
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
  const rows = await query(
    `SELECT id, kind, content, result, reason, user_id, ref_type, ref_id, created_at
     FROM audit_logs ORDER BY id DESC LIMIT ${limit}`
  );
  res.json({ logs: rows });
}));

// ==================== P3 评委评审（2026-08-16）====================
// 维度与权重：创意与创新 30% / 内容质量 25% / 完成度与实现 25% / 价值观与合规 20%
// 综合分 = Σ(维度分×权重)，0-10；积分 = round(综合分×30)，满分 300；综合分 <6 不兑现。
// 每个项目一条评审（重新评审覆盖并自动补/扣差额积分）；points_log 记 reason='judge_review'，ref 带时间戳保证唯一。

const JUDGE_DIMS = [
  { key: 'creativity', label: '创意与创新', weight: 0.30 },
  { key: 'content', label: '内容质量', weight: 0.25 },
  { key: 'completeness', label: '完成度与实现', weight: 0.25 },
  { key: 'values', label: '价值观与合规', weight: 0.20 },
];

function judgeTotal(scores) {
  let t = 0;
  for (const d of JUDGE_DIMS) {
    const v = Number(scores[d.key]);
    if (!Number.isInteger(v) || v < 0 || v > 10) return null; // 非法分数
    t += v * d.weight;
  }
  return Math.round(t * 100) / 100;
}

// 发放/回补评审积分（delta 可为负）；事务 + 用户行锁
async function applyJudgePoints(userId, delta, ref) {
  if (!delta) return;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [userId]);
    await conn.execute(
      'INSERT INTO points_log (user_id, amount, reason, ref_id) VALUES (?, ?, ?, ?)',
      [userId, delta, 'judge_review', ref]
    );
    await conn.execute('UPDATE users SET points = points + ? WHERE id = ?', [delta, userId]);
    await conn.commit();
  } catch (e) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw e;
  } finally {
    conn.release();
  }
}

// 查询单个项目评审（预填用）或最近评审列表
router.get('/judge', asyncHandler(async (req, res) => {
  const refType = String(req.query.ref_type || '');
  const refId = Number(req.query.ref_id || 0);
  if (refType && ['file', 'app'].includes(refType) && refId > 0) {
    const rows = await query(
      'SELECT * FROM judge_reviews WHERE ref_type = ? AND ref_id = ?',
      [refType, refId]
    );
    return res.json({ review: rows.length ? rows[0] : null });
  }
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 20, 100));
  const rows = await query(
    `SELECT j.*, u.real_name AS owner_name, u.class_name,
            COALESCE(f.title, f.original_name, '') AS file_title,
            a.title AS app_title
     FROM judge_reviews j
     LEFT JOIN users u ON u.id = j.owner_user_id
     LEFT JOIN files f ON f.id = j.ref_id AND j.ref_type = 'file'
     LEFT JOIN apps a ON a.id = j.ref_id AND j.ref_type = 'app'
     ORDER BY j.updated_at DESC LIMIT ${limit}`
  );
  res.json({ reviews: rows });
}));

// 提交/覆盖评审：打分 → 自动折算 → 发放/回补积分
router.post('/judge', asyncHandler(async (req, res) => {
  const refType = String((req.body && req.body.ref_type) || '');
  const refId = parseInt(req.body && req.body.ref_id, 10);
  const scores = (req.body && req.body.scores) || {};
  if (!['file', 'app'].includes(refType) || !refId) {
    return res.status(400).json({ error: '参数错误：请选择作品' });
  }
  const total = judgeTotal(scores);
  if (total === null) {
    return res.status(400).json({ error: '每个维度请输入 0-10 的整数分数' });
  }
  // 目标作品存在性 + 作者
  const ownerRows = refType === 'file'
    ? await query('SELECT user_id FROM files WHERE id = ?', [refId])
    : await query('SELECT user_id FROM apps WHERE id = ?', [refId]);
  if (!ownerRows.length) return res.status(404).json({ error: '作品不存在' });
  const ownerId = ownerRows[0].user_id;

  const points = total < 6 ? 0 : Math.round(Math.round(total * 100) * 30 / 100); // 整数化防浮点漂移
  const existing = await query(
    'SELECT id, points FROM judge_reviews WHERE ref_type = ? AND ref_id = ?',
    [refType, refId]
  );
  const oldPoints = existing.length ? Number(existing[0].points) : 0;
  const delta = points - oldPoints;

  const scoresJson = JSON.stringify({
    creativity: Number(scores.creativity), content: Number(scores.content),
    completeness: Number(scores.completeness), values: Number(scores.values),
  });
  if (existing.length) {
    await query(
      'UPDATE judge_reviews SET scores = ?, total = ?, points = ?, judge_user_id = ? WHERE id = ?',
      [scoresJson, total, points, req.user.id, existing[0].id]
    );
  } else {
    const ins = await query(
      'INSERT INTO judge_reviews (ref_type, ref_id, scores, total, points, judge_user_id, owner_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [refType, refId, scoresJson, total, points, req.user.id, ownerId]
    );
    existing[0] = { id: ins.insertId };
  }
  // 差额发放（ref 带时间戳保证 points_log 唯一键不冲突）
  if (delta !== 0) {
    await applyJudgePoints(ownerId, delta, refType + ':' + refId + ':j' + Date.now());
  }
  await writeAdminLog(req.user.id, 'judge.review', refType, refId, {
    scores: scoresJson, total, points, delta, reason: '评委评审',
  });
  res.json({
    review: { ref_type: refType, ref_id: refId, scores: JSON.parse(scoresJson), total, points, delta },
    message: points > 0 ? `已发放 ${points} ⭐ 评审积分` : (delta === 0 ? '已更新（无积分变动）' : '综合分低于 6 分，未兑现积分'),
  });
}));

// ==================== P2 ====================

// ---- 学AI 教程管理（在线编辑，库为准；seed-articles.js 仅作初始种子）----
// tasks 校验：须为 JSON 数组（任务对象数组）
function parseTasks(raw) {
  if (raw == null || raw === '') return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_) { return null; }
  if (!Array.isArray(parsed)) return null;
  return parsed;
}

router.get('/articles', asyncHandler(async (req, res) => {
  const rows = await query(
    'SELECT id, slug, chapter, title, summary, sort_order, updated_at FROM articles ORDER BY chapter ASC, sort_order ASC, id ASC'
  );
  res.json({ articles: rows });
}));

router.get('/articles/:id', asyncHandler(async (req, res) => {
  const [row] = await query('SELECT * FROM articles WHERE id = ?', [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: '文章不存在' });
  res.json({ article: row });
}));

// 新建 / 更新共用校验与 upsert
async function upsertArticle(body, existingId) {
  const slug = String(body.slug || '').trim().slice(0, 64);
  const chapter = Number(body.chapter);
  const title = String(body.title || '').trim().slice(0, 128);
  const summary = String(body.summary || '').trim().slice(0, 300) || null;
  const content = String(body.content || '');
  const sortOrder = Number(body.sort_order) || 0;
  if (!slug) return { error: '请填写 slug（URL 标识）' };
  if (!/^[a-z0-9-]+$/i.test(slug)) return { error: 'slug 仅支持字母/数字/连字符' };
  if (!Number.isInteger(chapter) || chapter < 0 || chapter > 99) return { error: '章节号需为 0-99 的整数' };
  if (!title) return { error: '请填写标题' };
  const tasks = parseTasks(body.tasks);
  if (tasks === null) return { error: '任务须为 JSON 数组' };

  // slug 唯一性（排除自身）
  const dup = await query('SELECT id FROM articles WHERE slug = ? AND id <> ?', [slug, existingId || 0]);
  if (dup.length) return { error: 'slug 已存在，请换一个' };

  const tasksJson = JSON.stringify(tasks);
  if (existingId) {
    await query(
      'UPDATE articles SET slug = ?, chapter = ?, title = ?, summary = ?, content = ?, tasks = ?, sort_order = ? WHERE id = ?',
      [slug, chapter, title, summary, content, tasksJson, sortOrder, existingId]
    );
    return { id: existingId };
  }
  const ins = await query(
    'INSERT INTO articles (slug, chapter, title, summary, content, tasks, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [slug, chapter, title, summary, content, tasksJson, sortOrder]
  );
  return { id: ins.insertId };
}

router.post('/articles', asyncHandler(async (req, res) => {
  const r = await upsertArticle(req.body || {}, 0);
  if (r.error) return res.status(400).json({ error: r.error });
  await writeAdminLog(req.user.id, 'article.create', 'article', r.id, { slug: String((req.body && req.body.slug) || '') }, req);
  res.json({ ok: true, id: r.id });
}));

router.put('/articles/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await query('SELECT id FROM articles WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '文章不存在' });
  const r = await upsertArticle(req.body || {}, id);
  if (r.error) return res.status(400).json({ error: r.error });
  await writeAdminLog(req.user.id, 'article.update', 'article', id, { slug: String((req.body && req.body.slug) || '') }, req);
  res.json({ ok: true, id });
}));

router.delete('/articles/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await query('SELECT slug FROM articles WHERE id = ?', [id]);
  if (!row) return res.status(404).json({ error: '文章不存在' });
  await query('DELETE FROM articles WHERE id = ?', [id]); // task_progress 级联删除
  await writeAdminLog(req.user.id, 'article.delete', 'article', id, { slug: row.slug }, req);
  res.json({ ok: true });
}));

// ---- 审核批量操作（approve / delete）----
router.post('/audit/batch', asyncHandler(async (req, res) => {
  const action = String((req.body && req.body.action) || '');
  const ids = Array.isArray(req.body && req.body.ids)
    ? [...new Set((req.body.ids).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200)
    : [];
  if (action !== 'approve' && action !== 'delete') return res.status(400).json({ error: '操作仅支持 approve / delete' });
  if (!ids.length) return res.status(400).json({ error: '请选择要操作的文件' });

  let ok = 0;
  let pointsRestored = 0;
  for (const fid of ids) {
    try {
      if (action === 'delete') {
        const rows = await query('SELECT user_id, stored_name FROM files WHERE id = ?', [fid]);
        if (!rows.length) continue;
        await query('DELETE FROM files WHERE id = ?', [fid]);
        await revoke(rows[0].user_id, 'file_submit', 'file:' + fid);
        fs.promises.unlink(path.join(config.storageDir, rows[0].stored_name)).catch(() => {});
      } else {
        const rows = await query('SELECT user_id FROM files WHERE id = ?', [fid]);
        if (!rows.length) continue;
        const restored = await restoreFilePoints(rows[0].user_id, fid);
        pointsRestored += restored;
        await query("UPDATE files SET audit_status = 'reviewed', audit_reason = '' WHERE id = ?", [fid]);
      }
      ok++;
    } catch (err) {
      console.warn('[admin] 批量操作单条失败 id=' + fid + ':', err.message);
    }
  }
  await writeAdminLog(req.user.id, 'audit.batch', 'file', 0, { action, ids, ok }, req);
  res.json({ ok: true, processed: ok, points_restored: pointsRestored });
}));

module.exports = router;
