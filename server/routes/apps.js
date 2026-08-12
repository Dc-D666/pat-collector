'use strict';

const express = require('express');
const config = require('../config');
const { query } = require('../db');
const { asyncHandler } = require('../utils/async');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../utils/rateLimit');
const { runCli } = require('../qq/proxy');
const qqSessions = require('../qq/sessions');
const { extractLinks } = require('../qq/feed-links');

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
        const links = await extractLinks(f.feed_id, s, f.channel_id || '');
        if (links.length > 0) {
          posts.push({
            feed_id: f.feed_id,
            title: f.title || f.content || '',
            content: f.content || '',
            create_time: f.create_time || '',
            channel_id: f.channel_id || '',
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
      // 2. 分享链接 → 尝试 get-share-info（CLI 实际只返回频道信息，拿不到 feed_id）
      const linkMatch = text.match(/https:\/\/pd\.qq\.com\/s\/[a-zA-Z0-9]+/);
      if (!linkMatch) {
        return res.status(400).json({ error: '未找到帖子ID或分享链接，请粘贴 B_ 开头的帖子ID 或 pd.qq.com/s/ 分享链接' });
      }
      try {
        const info = await runCli(['manage', 'get-share-info', '--url=' + linkMatch[0]], 15000, env);
        const d = (info && info.data) || {};
        feedId = String(d.feed_id || d.feedId || (d.feed && d.feed.feed_id) || '');
      } catch (_) { /* fallthrough */ }
      if (!feedId) {
        return res.status(400).json({
          error: '分享链接只能解析到频道、拿不到帖子ID（CLI 限制）。请改用「自动识别」，或直接粘贴帖子ID（B_ 开头）',
        });
      }
    }

    // 3. 取帖子详情 + 校验作者是本人
    let title = '';
    let channelId = '';
    try {
      const detail = await runCli(['feed', 'get-feed-detail', '--feed-id=' + feedId], 15000, env);
      const dd = (detail && detail.data) || {};
      const feed = dd.feed || dd;
      const authorId = String(feed.author_id || (feed.author && feed.author.tiny_id) || '');
      if (authorId && authorId !== s.tiny_id) {
        return res.status(403).json({ error: '该帖子不是你发布的，请确认粘贴的是自己的帖子' });
      }
      title = feed.title || feed.content || '';
      channelId = String(feed.channel_id || dd.channel_id || '');
    } catch (_) { /* 作者字段缺失时暂不拦截，交给提取 */ }

    // 4. 提取轻应用
    const links = await extractLinks(feedId, s, channelId);
    res.json({ feed_id: feedId, title, apps: links });
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
    const description = String((req.body && req.body.description) || '').trim().slice(0, 2000) || null;
    const gameplay = String((req.body && req.body.gameplay) || '').trim().slice(0, 2000) || null;
    const source_feed_id = String((req.body && req.body.source_feed_id) || '').trim().slice(0, 128) || null;

    const result = await query(
      'INSERT INTO apps (user_id, app_url, title, description, gameplay, source_feed_id) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, app_url, title, description, gameplay, source_feed_id]
    );
    const inserted = await query('SELECT created_at FROM apps WHERE id = ?', [result.insertId]);
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
    res.json({ ok: true });
  })
);

module.exports = router;
