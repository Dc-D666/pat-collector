'use strict';

// 章节任务"状态检测"（/api/learn/*-status 与 /api/points/task 完成核验共用同一套口径）：
// 第2章：是否已发表 AI 应用——**完成须双条件**：posted（频道发帖）+ submitted（本站投稿记录）。
//   - submitted：apps 表有带来源帖（source_feed_id）的记录（导入阶段已核验归属）；
//   - posted：有 submitted 即视为已发帖；否则 CLI 扫描频道最近 7 天/24 条帖子，仅作发帖状态提示。
// 第3章：最近 14 天是否上传过项目文件
const config = require('../config');
const { query } = require('../db');
const qqSessions = require('../qq/sessions');
const { runCli } = require('../qq/proxy');

// 第2章 app-status：已导入（apps 有 source_feed_id，导入阶段已核验归属）直接视为已发帖；
// 未导入则 CLI 扫描频道最近 7 天/24 条帖子给出 posted 状态（不发分依据——发帖须配合本站投稿）。
// user 为 req.user（需含 qq_tiny_id / id）；返回 { posted, post_count, submitted, need_login? }
async function getAppPostedStatus(userId, user) {
  const appRows = await query(
    "SELECT COUNT(*) AS cnt FROM apps WHERE user_id = ? AND source_feed_id IS NOT NULL AND source_feed_id != ''",
    [userId]
  );
  const submittedCount = Number(appRows[0].cnt);
  const submitted = submittedCount > 0;
  if (submitted) {
    return { posted: true, post_count: submittedCount, submitted: true };
  }
  if (!user.qq_tiny_id) {
    return { posted: false, post_count: 0, submitted, need_login: true };
  }
  const rows = await query('SELECT qq_session_id FROM users WHERE id = ?', [userId]);
  const sid = rows.length && rows[0].qq_session_id ? rows[0].qq_session_id : '';
  const s = sid ? qqSessions.getSession(sid) : null;
  if (!s || !s.token_obtained || !s.tiny_id) {
    return { posted: false, post_count: 0, submitted, need_login: true };
  }
  const env = qqSessions.sessionEnv(s);
  let posted = false;
  let postCount = 0;
  try {
    const feedsRes = await runCli(
      ['feed', 'get-guild-feeds', '--guild-id=' + config.guildId, '--get-type=2', '--count=24'],
      15000,
      env
    );
    const feeds = (feedsRes && feedsRes.data && feedsRes.data.feeds) || [];
    const tinyId = s.tiny_id;
    const now = Date.now();
    for (const f of feeds) {
      const aid = String(f.author_id || (f.author && f.author.tiny_id) || '');
      if (aid !== tinyId) continue;
      // 时间窗口：最近 7 天（create_time 兼容秒/毫秒时间戳；字符串或缺失则视为近期）
      let recent = true;
      if (f.create_time) {
        const t = Number(f.create_time);
        if (!isNaN(t) && t > 0) {
          const ms = t < 1e12 ? t * 1000 : t;
          recent = now - ms < 7 * 24 * 3600 * 1000;
        }
      }
      if (recent) postCount++;
    }
    posted = postCount > 0;
  } catch (_) { /* CLI 异常：按未检测到处理，前端可重试 */ }
  return { posted, post_count: postCount, submitted };
}

// 第3章 project-status：最近 14 天内「上传过项目文件」或「提交过 GitHub 项目」任一即达成（无需 QQ 登录）
// 2026-08-25：排除 source='gen'（站内一句话生成物），防第2章生成作品冒充第3章成果
// 2026-08-25（二次改版）：GitHub 项目外链（links 表，verified=1）同样计入，与文件上传互为替代
async function getProjectSubmitted(userId) {
  const [fileRows, linkRows] = await Promise.all([
    query(
      "SELECT COUNT(*) AS cnt FROM files WHERE user_id = ? AND source != 'gen' AND uploaded_at >= (NOW() - INTERVAL 14 DAY)",
      [userId]
    ),
    query(
      "SELECT COUNT(*) AS cnt FROM links WHERE user_id = ? AND verified = 1 AND created_at >= (NOW() - INTERVAL 14 DAY)",
      [userId]
    ),
  ]);
  const fileCnt = fileRows.length ? Number(fileRows[0].cnt) : 0;
  const linkCnt = linkRows.length ? Number(linkRows[0].cnt) : 0;
  return { submitted: fileCnt > 0 || linkCnt > 0, file_count: fileCnt, link_count: linkCnt };
}

// 第2章 gen-status（2026-08-25）：是否提交过站内生成的小程序（不限时间窗，生成过一次即永久达成）
async function getGeneratedAppStatus(userId) {
  const rows = await query(
    "SELECT COUNT(*) AS cnt FROM files WHERE user_id = ? AND source = 'gen'",
    [userId]
  );
  const cnt = rows.length ? Number(rows[0].cnt) : 0;
  return { generated: cnt > 0, gen_count: cnt };
}

module.exports = { getAppPostedStatus, getProjectSubmitted, getGeneratedAppStatus };
