'use strict';

// 「一句话生成小程序」路由（/api/gen，AI 小学堂第2章，2026-08-25）
// 两段式：POST /app 生成草稿（暂存 tmp-gen）→ 满意后 POST /commit 落库。
// 仅 QQ 登录用户可用（requireAuth；guest_token 访客不经过本路由）。
// 运行时开关 settings.genapp_enabled（默认开）：故障 kill-switch。
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../utils/rateLimit');
const { getSetting } = require('../utils/settings');
const { reviewContent } = require('../utils/audit');
const { grant } = require('../utils/points');
const genApp = require('../utils/genApp');

const router = express.Router();

// 全局并发信号量：同时生成中的请求数 ≤ maxConcurrent（防模型接口被并发打爆）
let running = 0;
const waiters = [];
function acquire() {
  if (running < config.genApp.maxConcurrent) {
    running++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}
function release() {
  const next = waiters.shift();
  if (next) next(); // 直接把名额交给下一个等待者
  else running--;
}

async function assertEnabled(res) {
  const flag = await getSetting('genapp_enabled');
  if (flag === '0') {
    res.status(503).json({ error: '「一句话生成小程序」暂时关闭维护中，请稍后再试' });
    return false;
  }
  return true;
}

// 生成草稿：{idea} → {draft_token, preview_url}
router.post('/app', requireAuth, rateLimit({ windowMs: 24 * 3600 * 1000, max: config.genApp.maxPerUserPerDay, keyFn: (r) => 'gen:' + r.user.id }), async (req, res, next) => {
  try {
    if (!(await assertEnabled(res))) return;
    const idea = String((req.body && req.body.idea) || '').trim();
    if (!idea) return res.status(400).json({ error: '请先描述你想做的小程序' });

    await acquire();
    let html;
    try {
      html = await genApp.generateAppHtml(idea);
    } catch (err) {
      if (err.code === 'GEN_FORMAT') return res.status(422).json({ error: err.message });
      console.error('[gen] 生成失败：', err.message);
      return res.status(502).json({ error: '生成服务暂时不可用，请稍后再试' });
    } finally {
      release();
    }
    // 新草稿生成成功后清理该用户旧草稿（一次只保留最新一份）
    await fs.promises.rm(genApp.userDraftDir(req.user.id), { recursive: true, force: true }).catch(() => {});
    const filename = await genApp.saveDraft(req.user.id, html);
    const token = genApp.draftTokenIssue(req.user.id, filename);
    res.json({
      draft_token: token,
      preview_url: '/api/gen/preview/' + encodeURIComponent(token),
      expires_in_minutes: Math.round(config.genApp.draftTtlMs / 60000),
    });
  } catch (err) {
    next(err);
  }
});

// 草稿预览（sandbox iframe 加载）：校验签名 + 归属
router.get('/preview/:draft_token', requireAuth, async (req, res, next) => {
  try {
    const payload = genApp.draftTokenVerify(req.params.draft_token, req.user.id);
    if (!payload) return res.status(404).json({ error: '草稿不存在或已过期，请重新生成' });
    const p = genApp.draftPath(req.user.id, payload.fn);
    if (!p || !fs.existsSync(p)) return res.status(404).json({ error: '草稿文件已丢失，请重新生成' });
    // 安全口径对齐现有 HTML 预览：CSP 禁外联 + sandbox 响应头（前端 iframe 另加 sandbox 属性）
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:",
      'X-Content-Type-Options': 'nosniff',
    });
    res.send(await fs.promises.readFile(p, 'utf8'));
  } catch (err) {
    next(err);
  }
});

// 丢弃草稿
router.delete('/draft/:draft_token', requireAuth, async (req, res, next) => {
  try {
    const payload = genApp.draftTokenVerify(req.params.draft_token, req.user.id);
    if (!payload) return res.status(404).json({ error: '草稿不存在或已过期' });
    const p = genApp.draftPath(req.user.id, payload.fn);
    if (p) await fs.promises.unlink(p).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// 提交落库：{draft_token, title} → files(source='gen')。
// 积分口径（2026-08-25 用户拍板，取代方案原 D3）：站内生成作品与腾讯频道轻应用**完全等价**——
// 发放同一个 app_submit（+15⭐），共用「每人最多计 3 个」名额（REASON_CAPS）：
// 如已传 2 个频道轻应用，则最多再计 1 个生成作品后不再计分；幂等 + 计数上限由 points.grant 统一保证。
router.post('/commit', requireAuth, async (req, res, next) => {
  try {
    if (!(await assertEnabled(res))) return;
    const token = String((req.body && req.body.draft_token) || '');
    const title = String((req.body && req.body.title) || '').trim();
    if (!title || title.length > 100) return res.status(400).json({ error: '请填写作品标题（100 字以内）' });
    const payload = genApp.draftTokenVerify(token, req.user.id);
    if (!payload) return res.status(410).json({ error: '草稿不存在或已过期（30 分钟），请重新生成' });
    const srcPath = genApp.draftPath(req.user.id, payload.fn);
    if (!srcPath || !fs.existsSync(srcPath)) return res.status(410).json({ error: '草稿文件已丢失，请重新生成' });

    // 配额原子复查（口径对齐 upload 管线：每人 ≤maxFilesPerUser 个 / ≤maxUserStorageBytes）
    const [cntRow] = await query('SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS total FROM files WHERE user_id = ?', [req.user.id]);
    if (Number(cntRow.c) >= config.maxFilesPerUser) {
      return res.status(413).json({ error: `作品文件总数已达上限（${config.maxFilesPerUser} 个），请删除部分文件后重试` });
    }
    const html = await fs.promises.readFile(srcPath, 'utf8');
    const size = Buffer.byteLength(html, 'utf8');
    if (Number(cntRow.total) + size > config.maxUserStorageBytes) {
      return res.status(413).json({ error: `超出个人存储配额，请删除部分文件后重试` });
    }

    // 内容安全审查（DeepSeek）：违规即拒、删草稿不留垃圾数据；
    // 审查服务不可用时降级为 pending 待审放行（对齐 upload 管线的容错口径），不阻塞提交
    let auditStatus = 'reviewed';
    try {
      const r = await reviewContent(html);
      if (!r.safe) {
        await fs.promises.unlink(srcPath).catch(() => {});
        return res.status(400).json({ error: '内容未通过审核：' + (r.reason || '可能包含违规内容（如色情、违法内容或恶意代码）') });
      }
    } catch (err) {
      console.warn('[gen] 内容审查失败（降级 pending 放行）：', err.message);
      auditStatus = 'pending';
    }

    // 落盘 + 入库（stored_name 与上传管线同格式：uuid.html）
    const storedName = path.basename(srcPath);
    const destDir = path.resolve(config.storageDir);
    await fs.promises.mkdir(destDir, { recursive: true });
    let storedNameFinal = storedName;
    const dest = path.join(destDir, storedNameFinal);
    await fs.promises.rename(srcPath, dest).catch(async () => {
      // 极小概率撞名（uuid 理论不会）：换个名字再试一次
      storedNameFinal = require('crypto').randomUUID() + '.html';
      await fs.promises.copyFile(srcPath, path.join(destDir, storedNameFinal));
      await fs.promises.unlink(srcPath).catch(() => {});
    });

    const originalName = title.endsWith('.html') ? title : title + '.html';
    try {
      await query(
        `INSERT INTO files (user_id, stored_name, original_name, size, mime_type, title, audit_status, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'gen')`,
        [req.user.id, storedNameFinal, originalName, size, 'text/html', title, auditStatus]
      );
    } catch (err) {
      // 同名冲突等入库失败：回滚落盘
      fs.promises.unlink(path.join(destDir, storedNameFinal)).catch(() => {});
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: '同名作品已存在，请换一个标题' });
      }
      throw err;
    }
    const [row] = await query('SELECT id, uploaded_at FROM files WHERE user_id = ? AND original_name = ? ORDER BY id DESC LIMIT 1', [req.user.id, originalName]);
    // 等价计分：与频道轻应用同用 app_submit 名额（幂等 ref=file:<id>；容错：发分失败不阻塞已入库的作品）
    let pointsGranted = null;
    if (row && row.id) {
      try {
        pointsGranted = await grant(req.user.id, 'app_submit', 'file:' + row.id);
      } catch (err) {
        console.error('[gen] 发放 app_submit 积分失败（文件已入库）：', err && err.message);
      }
    }
    res.json({
      file: { id: row ? row.id : null, original_name: originalName, size, mime_type: 'text/html', title, audit_status: auditStatus, source: 'gen', uploaded_at: row ? row.uploaded_at : null },
      points_granted: pointsGranted,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
