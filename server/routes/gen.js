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

// 每日限流：测试期间禁用（genApp.dailyLimitDisabled），恢复限制时自动生效
const dailyLimitMw = config.genApp.dailyLimitDisabled
  ? (req, res, next) => next()
  : rateLimit({ windowMs: 24 * 3600 * 1000, max: config.genApp.maxPerUserPerDay, keyFn: (r) => 'gen:' + r.user.id });

// 计次（用于前端展示“今天还可生成N次”）：成功产出草稿后记 audit_logs（kind=gen_app）
async function recordGenUsage(userId) {
  try {
    await query("INSERT INTO audit_logs (kind, content, result, user_id, ref_type, ref_id) VALUES ('gen_app', '一句话生成小程序', 'approved', ?, '', 0)", [userId]);
  } catch (err) { console.warn('[gen] 记次失败（不影响生成）：', err.message); }
}
async function getGenUsedToday(userId) {
  const rows = await query("SELECT COUNT(*) AS c FROM audit_logs WHERE user_id = ? AND kind = 'gen_app' AND result = 'approved' AND DATE(created_at) = CURDATE()", [userId]);
  return rows.length ? Number(rows[0].c) : 0;
}

// ---- 创作槽（2026-08-25）：每用户 5 槽，每槽独立对话/版本链 ----
const SLOT_COUNT = 5;
async function ensureSlot(userId, slotNo) {
  await query('INSERT IGNORE INTO gen_slots (user_id, slot_no) VALUES (?, ?)', [userId, slotNo]);
  const rows = await query('SELECT id FROM gen_slots WHERE user_id = ? AND slot_no = ?', [userId, slotNo]);
  return rows[0].id;
}
function slotVersionPath(userId, slotNo, seq) {
  return 'u' + userId + '/s' + slotNo + '/v' + seq + '.html';
}
async function saveSlotVersion(userId, slotNo, idea, html) {
  const slotId = await ensureSlot(userId, slotNo);
  // 同槽并发生成可能算出相同 seq（MAX+1 竞态）撞 uq_slot_seq：最多重试 3 次
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const [r] = await query('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM gen_versions WHERE slot_id = ?', [slotId]);
    const seq = Number(r.next);
    const rel = slotVersionPath(userId, slotNo, seq);
    const abs = path.join(genApp.genStoreDir(), rel);
    await fs.promises.mkdir(path.dirname(abs), { recursive: true });
    try {
      await fs.promises.writeFile(abs, html, 'utf8');
      await query('INSERT INTO gen_versions (slot_id, seq, idea, stored_path) VALUES (?, ?, ?, ?)', [slotId, seq, String(idea).slice(0, 2000), rel]);
      await query('UPDATE gen_slots SET updated_at = NOW() WHERE id = ?', [slotId]);
      const [v] = await query('SELECT id FROM gen_versions WHERE slot_id = ? AND seq = ?', [slotId, seq]);
      return { version_id: v.id, seq };
    } catch (err) {
      lastErr = err;
      fs.promises.unlink(abs).catch(() => {}); // 撞名时清掉本次落盘，换 seq 重来
      if (err.code !== 'ER_DUP_ENTRY') throw err;
    }
  }
  throw lastErr;
}
// 槽内上一版 HTML（改进模式上下文；跨会话也生效）
async function latestSlotHtml(userId, slotNo) {
  try {
    const rows = await query(
      `SELECT v.stored_path FROM gen_versions v JOIN gen_slots s ON s.id = v.slot_id
       WHERE s.user_id = ? AND s.slot_no = ? ORDER BY v.seq DESC LIMIT 1`, [userId, slotNo]);
    if (!rows.length) return '';
    return await fs.promises.readFile(path.join(genApp.genStoreDir(), rows[0].stored_path), 'utf8');
  } catch (_) { return ''; }
}

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
router.post('/app', requireAuth, dailyLimitMw, async (req, res, next) => {
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

// 流式生成（SSE）：逐段推送大模型输出，前端实时展示；完成后推送 draft_token
// 事件格式：data: {"type":"delta","text":"…"} / {"type":"done",draft_token,…} / {"type":"error","message":"…"}
router.post('/app/stream', requireAuth, dailyLimitMw, async (req, res, next) => {
  try {
    if (!(await assertEnabled(res))) return;
    const idea = String((req.body && req.body.idea) || '').trim();
    if (!idea) return res.status(400).json({ error: '请先描述你想做的小程序' });

    await acquire();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.genApp.timeoutMs + 10000);
    let closed = false;
    req.on('close', () => { closed = true; controller.abort(); }); // 客户端断开则中止上游
    const send = (obj) => { if (!closed) res.write('data: ' + JSON.stringify(obj) + '\n\n'); };
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx 不缓冲，保证流式实时到达
    });
    try {
      // 槽号校验（1-5）；改进模式上下文：显式 prev_html 优先，否则取该槽最新版（跨会话生效）
      const slotNo = Math.min(5, Math.max(1, parseInt(req.body && req.body.slot_no, 10) || 1));
      let prevHtml = String((req.body && req.body.prev_html) || '').slice(0, 100000);
      if (!prevHtml && req.body && req.body.slot_no) {
        prevHtml = (await latestSlotHtml(req.user.id, slotNo)).slice(0, 100000);
      }
      const improving = !!prevHtml;
      if (improving) console.log('[gen] 改进模式：携带上一版', Buffer.byteLength(prevHtml), '字节, 槽', slotNo);
      send({ type: 'start', context: improving });
      const html = await genApp.generateAppHtmlStream(
        idea,
        (t, isReasoning) => send({ type: 'delta', text: t, reasoning: !!isReasoning }),
        controller.signal,
        prevHtml,
        req.body.model // 前端选择的模型 id（服务端白名单校验，非法值回默认）
      );
      // 新草稿覆盖旧草稿（一次只保留最新一份）
      await fs.promises.rm(genApp.userDraftDir(req.user.id), { recursive: true, force: true }).catch(() => {});
      await recordGenUsage(req.user.id);
      const ver = await saveSlotVersion(req.user.id, slotNo, idea, html); // 持久化进对话记录
      const filename = await genApp.saveDraft(req.user.id, html); // 临时草稿：供「满意提交」走 commit 流程
      const token = genApp.draftTokenIssue(req.user.id, filename);
      send({
        type: 'done',
        draft_token: token,
        preview_url: '/api/gen/preview/' + encodeURIComponent(token),
        expires_in_minutes: Math.round(config.genApp.draftTtlMs / 60000),
        slot_no: slotNo,
        version_id: ver.version_id,
        version_seq: ver.seq,
      });
    } catch (err) {
      if (closed) return; // 客户端已断开，无需回报
      if (err.name === 'AbortError' || err.code === 'ABORT_ERR') {
        send({ type: 'error', message: '生成超时，请稍后重试' });
      } else if (err.code === 'GEN_FORMAT') {
        send({ type: 'error', message: err.message });
      } else if (err.code === 'GEN_EMPTY' || err.code === 'MODEL_429') {
        // 上游模型限流：不静默回退（用户拍板 2026-08-25），显著提醒更换模型
        console.warn('[gen] 模型限流：', err.message);
        send({ type: 'error', code: 'model_unavailable', message: '该模型暂不可用，请更换模型' });
      } else {
        console.error('[gen] 流式生成失败：', err.message);
        send({ type: 'error', message: '生成服务暂时不可用，请稍后再试' });
      }
    } finally {
      clearTimeout(timer);
      release();
      if (!closed) res.end();
    }
  } catch (err) {
    next(err);
  }
});

// 今日生成次数（前端卡片展示“今天还可生成N次”；测试期间不限次）
router.get('/quota', requireAuth, async (req, res, next) => {
  try {
    const used = await getGenUsedToday(req.user.id);
    res.json(config.genApp.dailyLimitDisabled
      ? { unlimited: true, used_today: used }
      : { unlimited: false, used_today: used, max_per_day: config.genApp.maxPerUserPerDay });
  } catch (err) { next(err); }
});

// 创作槽概览：5 个槽各自的版本链（对话记录）
router.get('/slots', requireAuth, async (req, res, next) => {
  try {
    const slots = await query('SELECT id, slot_no FROM gen_slots WHERE user_id = ? ORDER BY slot_no', [req.user.id]);
    const byNo = {};
    for (const sl of slots) byNo[sl.slot_no] = { slot_no: sl.slot_no, versions: [] };
    if (slots.length) {
      const ids = slots.map((x) => x.id);
      const ph = ids.map(() => '?').join(',');
      const vers = await query(
        `SELECT v.id, v.slot_id, v.seq, v.idea, v.created_at FROM gen_versions v WHERE v.slot_id IN (${ph}) ORDER BY v.seq DESC LIMIT 300`, ids);
      for (const v of vers) {
        const no = slots.find((x) => x.id === v.slot_id).slot_no;
        byNo[no].versions.push({ id: v.id, seq: v.seq, idea: String(v.idea || '').slice(0, 120), created_at: v.created_at });
      }
    }
    // 补齐空槽（保证前端始终拿到 5 个）
    const list = [];
    for (let n = 1; n <= SLOT_COUNT; n++) list.push(byNo[n] || { slot_no: n, versions: [] });
    res.json({ slot_count: SLOT_COUNT, slots: list });
  } catch (err) { next(err); }
});

// 历史版本预览令牌：iframe 无法带 Bearer，签发短时自证令牌（30 分钟）
router.get('/version/:id/token', requireAuth, async (req, res, next) => {
  try {
    const vid = Number(req.params.id);
    const rows = await query(
      'SELECT v.id FROM gen_versions v JOIN gen_slots s ON s.id = v.slot_id WHERE v.id = ? AND s.user_id = ?', [vid, req.user.id]);
    if (!rows.length) return res.status(404).json({ error: '版本不存在' });
    const vt = genApp.signToken({ kind: 'genver', uid: req.user.id, vid }, 30 * 60 * 1000);
    res.json({ preview_url: '/api/gen/version-preview/' + encodeURIComponent(vt), expires_in_minutes: 30 });
  } catch (err) { next(err); }
});

// 版本预览（凭自证令牌；安全头同草稿预览）
router.get('/version-preview/:vtoken', async (req, res, next) => {
  try {
    const payload = genApp.verifyTokenSelf(req.params.vtoken);
    if (!payload || payload.kind !== 'genver') return res.status(404).json({ error: '链接已失效，请刷新对话记录' });
    const rows = await query(
      'SELECT v.stored_path FROM gen_versions v JOIN gen_slots s ON s.id = v.slot_id WHERE v.id = ? AND s.user_id = ?',
      [Number(payload.vid), payload.uid]);
    if (!rows.length) return res.status(404).json({ error: '版本不存在' });
    const abs = path.join(genApp.genStoreDir(), rows[0].stored_path);
    if (!fs.existsSync(abs)) return res.status(404).json({ error: '文件已丢失' });
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
    });
    res.send(await fs.promises.readFile(abs, 'utf8'));
  } catch (err) { next(err); }
});

// 清空某个创作槽
router.post('/slots/:no/clear', requireAuth, async (req, res, next) => {
  try {
    const no = Math.min(5, Math.max(1, parseInt(req.params.no, 10) || 0));
    const rows = await query('SELECT id FROM gen_slots WHERE user_id = ? AND slot_no = ?', [req.user.id, no]);
    if (rows.length) {
      const vers = await query('SELECT stored_path FROM gen_versions WHERE slot_id = ?', [rows[0].id]);
      for (const v of vers) fs.promises.unlink(path.join(genApp.genStoreDir(), v.stored_path)).catch(() => {});
      await query('DELETE FROM gen_slots WHERE id = ?', [rows[0].id]); // 级联删 versions
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// 草稿预览（sandbox iframe 加载）：凭 draft_token 自证身份，不走 Bearer——
// iframe 的 src 是浏览器原生导航，无法携带 Authorization 头（fetch 才行）。
// draft_token 本身即能力令牌：HMAC 签名 + 内含 userId + 30min 过期 + 文件名白名单，
// 拿到链接者仅能在有效期内查看该份草稿，风险可控。仍保留 CSP 禁外联防 XSS。
router.get('/preview/:draft_token', async (req, res, next) => {
  try {
    const payload = genApp.draftTokenVerifySelf(req.params.draft_token);
    if (!payload) return res.status(404).json({ error: '草稿不存在或已过期，请重新生成' });
    const p = genApp.draftPath(payload.uid, payload.fn); // 路径由令牌内的 uid 解析，令牌即身份
    if (!p || !fs.existsSync(p)) return res.status(404).json({ error: '草稿文件已丢失，请重新生成' });
    // 安全口径：CSP 禁外联 + sandbox 响应头；X-Frame-Options 覆盖全局中间件的 DENY——
    // 本端点设计给自己页面 iframe 同源嵌入，改 SAMEORIGIN 仍防第三方站嵌套。
    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'SAMEORIGIN',
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
