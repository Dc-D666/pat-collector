'use strict';

const express = require('express');
const config = require('../config');
const { query, pool } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../utils/rateLimit');
const { runCli } = require('../qq/proxy');
const qqSessions = require('../qq/sessions');
const { extractLinks, resolveShare } = require('../qq/feed-links');
const { grant, revoke } = require('../utils/points');
const { auditDisplayText } = require('../utils/audit');

const router = express.Router();

const ipKey = (req) => req.ip || req.connection.remoteAddress || 'unknown';

// 取用户的 QQ 会话（需已扫码登录且 token 仍在）
async function getUserSession(userId) {
  const rows = await query('SELECT qq_session_id FROM users WHERE id = ?', [userId]);
  if (rows.length === 0 || !rows[0].qq_session_id) return null;
  const s = qqSessions.getSession(rows[0].qq_session_id);
  if (!s || !s.token_obtained || !s.tiny_id) return null;
  return s;
}

// 取帖子详情并校验作者是本人；返回 { ok, title, channelId }
async function verifyOwnFeed(feedId, s, env) {
  const detail = await runCli(['feed', 'get-feed-detail', '--feed-id=' + feedId, '--guild-id=' + config.guildId], 15000, env);
  const dd = (detail && detail.data) || {};
  const feed = dd.feed || dd;
  const authorId = String(feed.author_id || (feed.author && feed.author.tiny_id) || '');
  return {
    ok: authorId !== '' && authorId === s.tiny_id,
    authorId,
    title: feed.title || feed.content || '',
    channelId: String(feed.channel_id || dd.channel_id || ''),
  };
}

// 自动识别：取本人近期帖子，逐个提取轻应用
router.post(
  '/auto-scan',
  requireAuth,
  rateLimit({ windowMs: 60 * 1000, max: 5, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const s = await getUserSession(req.user.id);
    if (!s) {
      return res.status(400).json({ error: '需要 QQ 频道登录才能自动识别，请重新扫码登录' });
    }
    const env = qqSessions.sessionEnv(s);
    const tinyId = s.tiny_id;

    const feedsRes = await runCli(
      ['feed', 'get-guild-feeds', '--guild-id=' + config.guildId, '--get-type=2', '--count=24'],
      15000,
      env
    );
    const feeds = (feedsRes && feedsRes.data && feedsRes.data.feeds) || [];

    // 筛本人帖子（字段兼容 author_id 平铺 / author.tiny_id 嵌套）
    const own = feeds.filter((f) => {
      const aid = String(f.author_id || (f.author && f.author.tiny_id) || '');
      return aid === tinyId;
    });

    const posts = [];
    for (const f of own) {
      try {
        const verify = await verifyOwnFeed(f.feed_id, s, env);
        if (!verify.ok) continue; // 作者校验失败（非本人或无法确定）跳过
        const links = await extractLinks(f.feed_id, s, verify.channelId || f.channel_id || '');
        if (links.length > 0) {
          posts.push({
            feed_id: f.feed_id,
            title: verify.title || f.title || f.content || '',
            content: f.content || '',
            create_time: f.create_time || '',
            channel_id: verify.channelId || f.channel_id || '',
            apps: links,
          });
        }
      } catch (_) { /* 单个帖子识别失败跳过 */ }
    }
    res.json({ posts });
  })
);

// 手动识别：粘贴 Share Text / Share Link → 转 BID → 提取轻应用
router.post(
  '/manual-scan',
  requireAuth,
  rateLimit({ windowMs: 60 * 1000, max: 10, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const s = await getUserSession(req.user.id);
    if (!s) {
      return res.status(400).json({ error: '需要 QQ 频道登录才能识别，请重新扫码登录' });
    }
    const text = String((req.body && req.body.text) || '').trim();
    if (!text) return res.status(400).json({ error: '请粘贴帖子ID（B_ 开头）或分享链接' });

    const env = qqSessions.sessionEnv(s);
    let feedId = '';

    // 1. 优先识别 BID（帖子ID）
    const bidMatch = text.match(/B_[a-zA-Z0-9]+/);
    if (bidMatch) {
      feedId = bidMatch[0];
    } else {
      // 2. 分享链接 → 用 share_resolve.py 解析出 BID
      const linkMatch = text.match(/https:\/\/pd\.qq\.com\/s\/[a-zA-Z0-9]+/);
      if (!linkMatch) {
        return res.status(400).json({ error: '未找到帖子ID或分享链接，请粘贴 B_ 开头的帖子ID 或 pd.qq.com/s/ 分享链接' });
      }
      try {
        feedId = await resolveShare(linkMatch[0]);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    }

    // 3. 校验作者是本人
    const verify = await verifyOwnFeed(feedId, s, env);
    if (!verify.ok) {
      return res.status(403).json({ error: '该帖子不是你发布的，请确认粘贴的是自己的帖子' });
    }

    // 4. 提取轻应用
    const links = await extractLinks(feedId, s, verify.channelId);
    res.json({ feed_id: feedId, title: verify.title, apps: links });
  })
);

// 提交轻应用
router.post(
  '/',
  requireAuth,
  rateLimit({ windowMs: 60 * 1000, max: 20, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const app_url = String((req.body && req.body.app_url) || '').trim();
    if (!app_url) return res.status(400).json({ error: '缺少应用链接' });
    if (!/^https?:\/\//.test(app_url)) return res.status(400).json({ error: '应用链接格式不正确' });
    if (app_url.length > 512) return res.status(400).json({ error: '链接过长' });

    const title = String((req.body && req.body.title) || '').trim().slice(0, 255);
    if (!title) return res.status(400).json({ error: '请输入应用名称' });
    const description = String((req.body && req.body.description) || '').trim().slice(0, 2000) || null;
    const gameplay = String((req.body && req.body.gameplay) || '').trim().slice(0, 2000) || null;
    const source_feed_id = String((req.body && req.body.source_feed_id) || '').trim().slice(0, 128) || null;

    // R2（2026-08-15）：轻应用标题/简介/玩法公开展示，同步 AI 审查；违规拒绝，AI 不可用降级放行
    const displayText = [title, description, gameplay].filter(Boolean).join('\n');
    const d = await auditDisplayText(displayText, { userId: req.user.id, refType: 'app', refId: 0 });
    if (!d.ok) {
      return res.status(400).json({ error: '应用信息不合规（' + (d.reason || '请修改后重试') + '）' });
    }

    // 每人轻应用总数上限（删除可释放名额）：检查与插入同事务 + 用户行锁，防并发突破上限（L4 修复）
    const conn = await pool.getConnection();
    let result;
    try {
      await conn.beginTransaction();
      await conn.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.id]);
      const [appCnt] = await conn.execute('SELECT COUNT(*) AS c FROM apps WHERE user_id = ?', [req.user.id]);
      if (Number(appCnt[0].c) >= config.maxAppsPerUser) {
        await conn.rollback();
        conn.release(); // 提前返回必须释放连接，否则池耗尽
        return res.status(400).json({ error: `轻应用总数已达上限（${config.maxAppsPerUser} 个），请删除部分后重试，或联系频道主扩容` });
      }
      const ins = await conn.execute(
        'INSERT INTO apps (user_id, app_url, title, description, gameplay, source_feed_id) VALUES (?, ?, ?, ?, ?, ?)',
        [req.user.id, app_url, title, description, gameplay, source_feed_id]
      );
      result = { insertId: ins[0].insertId };
      await conn.commit();
    } catch (err) {
      try { await conn.rollback(); } catch (_) { /* ignore */ }
      conn.release();
      throw err;
    }
    conn.release();
    const inserted = await query('SELECT created_at FROM apps WHERE id = ?', [result.insertId]);
    // 提交 AI 轻应用奖励（每个作品一次）
    await grant(req.user.id, 'app_submit', 'app:' + result.insertId);
    res.json({
      app: {
        id: result.insertId, app_url, title, description, gameplay, source_feed_id,
        created_at: inserted[0].created_at,
      },
    });
  })
);

// 我的轻应用列表
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query(
      'SELECT id, app_url, title, description, gameplay, source_feed_id, created_at FROM apps WHERE user_id = ? ORDER BY created_at DESC, id DESC',
      [req.user.id]
    );
    res.json({ apps: rows });
  })
);

// 删除
router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rows = await query('SELECT id FROM apps WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (rows.length === 0) return res.status(404).json({ error: '应用不存在' });
    await query('DELETE FROM apps WHERE id = ?', [req.params.id]);
    // 删除轻应用回扣提交积分（与文件删除一致）
    const revoked = await revoke(req.user.id, 'app_submit', 'app:' + req.params.id);
    res.json({ ok: true, points_revoked: revoked });
  })
);

module.exports = router;
