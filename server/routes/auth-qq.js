'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const config = require('../config');
const { query } = require('../db');
const { issue } = require('../utils/token');
const { asyncHandler } = require('../utils/async');
const { runCli, runCliCaptureRaw, extractOwnTinyId } = require('../qq/proxy');
const qqSessions = require('../qq/sessions');
const { rateLimit } = require('../utils/rateLimit');
const { requireAuth } = require('../middleware/auth');
const { grant } = require('../utils/points');
const { pinyinCandidates } = require('../utils/pinyin');

const router = express.Router();

function publicUser(row) {
  const showReal = row.show_real_name !== 0; // 默认展示真实姓名
  return {
    id: row.id,
    class_name: row.class_name,
    real_name: row.real_name,
    display_name: showReal ? row.real_name : (row.nickname || row.real_name),
    show_real_name: showReal,
    nickname: row.nickname || '',
    points: row.points || 0,
    is_qq_bound: !!row.qq_tiny_id,
    is_admin: row.is_admin === 1,
    status: row.status || 'active',
    created_at: row.created_at,
  };
}

// 管理员引导：tiny_id 命中 ADMIN_QQ_TINY_IDS 白名单 → 自动置 is_admin=1（幂等）
async function maybeGrantAdmin(userId, tinyId) {
  if (!tinyId || !config.adminQqTinyIds.has(String(tinyId))) return;
  await query('UPDATE users SET is_admin = 1 WHERE id = ? AND is_admin = 0', [userId]);
}

const ipKey = (req) => req.ip || req.connection.remoteAddress || 'unknown';

// 检查当前用户 QQ 会话是否仍有效（单设备登录被踢后 token 失效）；失效则清理会话
router.get('/status', requireAuth, asyncHandler(async (req, res) => {
  const rows = await query('SELECT qq_session_id FROM users WHERE id = ?', [req.user.id]);
  if (rows.length === 0 || !rows[0].qq_session_id) {
    return res.json({ valid: false, reason: 'no_session' });
  }
  const sid = rows[0].qq_session_id;
  const s = qqSessions.getSession(sid);
  if (!s || !s.token_obtained) {
    return res.json({ valid: false, reason: 'no_session' });
  }
  try {
    const status = await runCli(['login', 'status'], 10000, qqSessions.sessionEnv(s));
    const valid = !!(status && status.success && status.data && status.data.valid === true);
    if (!valid) {
      qqSessions.cleanupSession(sid);
      await query('UPDATE users SET qq_session_id = NULL WHERE id = ?', [req.user.id]);
    }
    return res.json({ valid });
  } catch (_) {
    return res.json({ valid: false, reason: 'error' });
  }
}));

// 把 QQ 会话关联到用户（不清理，供后续自动/手动识别轻应用使用）；顺带清理该用户旧的会话
async function linkSession(sessionId, userId) {
  const old = await query('SELECT qq_session_id FROM users WHERE id = ?', [userId]);
  if (old.length > 0 && old[0].qq_session_id && old[0].qq_session_id !== sessionId) {
    qqSessions.cleanupSession(old[0].qq_session_id);
  }
  await query('UPDATE users SET qq_session_id = ? WHERE id = ?', [sessionId, userId]);
  const s = qqSessions.getSession(sessionId);
  if (s) s.user_id = userId;
  qqSessions.markDirty();
  qqSessions.saveIndex();
}

// 1. 发起扫码登录：创建隔离会话 → CLI login 拿二维码
router.post(
  '/init',
  rateLimit({ windowMs: 10 * 60 * 1000, max: 30, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const sessionId = qqSessions.createSession();
    const s = qqSessions.getSession(sessionId);
    const qrcodePath = path.join(s.homeDir, 'login-qrcode.png');
    const env = qqSessions.sessionEnv(s);
    const result = await runCli(['login', '--yes', `--qrcode-path=${qrcodePath}`], 30000, env);
    if (!result || result.success === false) {
      qqSessions.cleanupSession(sessionId);
      return res.json({
        session: sessionId,
        error: (result && result.error && result.error.message) || 'CLI 返回未知错误',
        qrcode_base64: '',
        verification_uri: '',
        expires_in_s: 0,
      });
    }
    let qrcodeBase64 = (result.data && result.data.qr_code) || '';
    if (!qrcodeBase64 && fs.existsSync(qrcodePath)) {
      qrcodeBase64 = fs.readFileSync(qrcodePath).toString('base64');
    }
    return res.json({
      session: sessionId,
      verification_uri: (result.data && result.data.verification_uri) || '',
      qrcode_base64: qrcodeBase64,
      expires_in_s: (result.data && result.data.expires_in_s) || 120,
    });
  })
);

// 已授权：从会话真实 token 反查 tiny_id + 频道昵称
// 注意：get-user-info（全局/频道）都不返回 tiny_id，只能靠 guild-member-search 拿（字段 tinyid）
// 关键坑：频道 get-user-info 的 nickname 是"频道内显示名"（可能带前缀/与全局昵称不同），
// 用它搜索可能搜不到人；必须把频道昵称、全局昵称、member_name 等全部作为关键词依次尝试。
// 关键修复（2026-08-15）：频道内有大量同名成员（实测 "." 昵称几十个，搜索返回 20+ 全匹配），
// 绝不能盲取 members[0]（会绑定到错误的 tiny_id，可能绑到管理员/他人 → 身份错乱）。
// 流程：精确同名过滤 → 唯一则采用；多个同名则逐个 get-user-info --tiny-id 全字段比对核实。
async function resolveTinyId(s, env) {
  let nickname = '';
  let tinyId = '';
  let reason = ''; // ''=成功 / 'ambiguous'=多个同名成员无法区分 / 'not_found'=未找到匹配成员
  try {
    const globalInfo = await runCli(['manage', 'get-user-info'], 10000, env);
    const gd = (globalInfo && globalInfo.data) || {};
    const globalNick = gd.nickname || gd.global_nickname || '';
    nickname = globalNick;

    if (config.guildId) {
      const guildInfo = await runCli(['manage', 'get-user-info', '--guild-id=' + config.guildId], 10000, env);
      const gi = (guildInfo && guildInfo.data) || {};
      const guildNick = gi.nickname || gi.member_name || gi.global_nickname || '';
      // 频道昵称优先用于展示；搜索关键词集合则同时包含频道/全局昵称
      if (guildNick) nickname = guildNick;

      // ── 首选：直接身份（原始 MCP 响应含本人 tiny_id）──
      // CLI 展示层丢弃 msgUserInfo.uint64MemberTinyid，但原始响应里有（本地代理捕获）。
      // 直接从会话读出本人 tiny_id → 无需成员搜索 → 彻底规避同名歧义（如几十个 "." 昵称）。
      try {
        const raw = await runCliCaptureRaw(['manage', 'get-user-info', '--guild-id=' + config.guildId], 10000, env);
        const directTinyId = extractOwnTinyId(raw.captured);
        if (directTinyId) {
          tinyId = directTinyId;
          // 顺带用原始响应里的昵称字段校正展示名（base64 bytesNickName）
          for (const text of raw.captured) {
            try {
              const data = JSON.parse(text);
              const sc = data && data.result && data.result.structuredContent;
              if (sc && sc.msgUserInfo) {
                const nick = sc.msgUserInfo.bytesNickName || sc.msgUserInfo.bytesMemberName;
                if (nick) {
                  const decoded = Buffer.from(nick, 'base64').toString('utf8').trim();
                  if (decoded) nickname = decoded;
                }
                break;
              }
            } catch (_) { /* 跳过非 JSON */ }
          }
        }
      } catch (_) { /* 代理失败走搜索兜底 */ }

      // ── 兜底：成员搜索 + 精确同名/全字段核实（直取失败时）──
      if (!tinyId) {

      // 搜索关键词去重集合：频道昵称、member_name、全局昵称、去装饰前缀版本、拆词兜底版本
      const kwSet = new Set();
      const add = (v) => {
        const str = String(v || '').trim();
        if (str) kwSet.add(str);
      };
      add(gi.nickname);
      add(gi.member_name);
      add(gi.global_nickname);
      add(gd.nickname);
      add(gd.global_nickname);
      // 对带装饰前缀的昵称（如【摸鱼打杂】Cemetary），追加去前缀版本
      for (const kw of [...kwSet]) {
        const cleaned = kw.replace(/^[【\[\(（][^】\]\)）]+[】\]\)）]\s*/, '').trim();
        if (cleaned && cleaned !== kw) add(cleaned);
      }
      // 拆词兜底：QQ 频道成员搜索对含空格/括号等特殊字符的长昵称匹配不佳
      // （实测 "Screen Rain(Imgreenhand)" 搜 0 结果，但拆词 "Screen" / "Imgreenhand" 能搜到）
      for (const kw of [...kwSet]) {
        for (const frag of String(kw).split(/[^\w\u4e00-\u9fa5]+/)) {
          if (frag && frag.length >= 2) add(frag);
        }
      }

      // 收集候选：按关键词依次搜索，取首个有结果的搜索的全部成员（第一页，够用）
      let members = [];
      for (const kw of kwSet) {
        const searchR = await runCli(
          ['manage', 'guild-member-search', '--guild-id=' + config.guildId, '--keyword=' + kw],
          10000,
          env
        );
        const ms = (searchR && searchR.data && searchR.data.members) || [];
        if (ms.length > 0) { members = ms; break; }
      }

      if (members.length > 0) {
        // ① 先按「频道昵称精确等于本人」过滤候选（排除 "。。"/"。。。" 等相似但不同的昵称）
        const selfNicks = [gi.nickname, gi.member_name].map((v) => String(v || '').trim()).filter(Boolean);
        const candidates = members.filter((m) => selfNicks.includes(String(m.nickname || '').trim()));
        if (candidates.length === 1) {
          tinyId = String(candidates[0].tinyid || candidates[0].tiny_id || '');
        } else if (candidates.length > 1) {
          // ② 多个同名候选：逐个 get-user-info --tiny-id 与本人全字段比对
          //    （全局昵称/性别等通常各不相同，可区分本人；上限 8 个，命中第 2 个即判歧义提前终止）
          const fields = ['nickname', 'member_name', 'global_nickname', 'gender'];
          let verified = null;
          let ambiguous = false;
          for (const c of candidates.slice(0, 8)) {
            const r = await runCli(
              ['manage', 'get-user-info', '--guild-id=' + config.guildId, '--tiny-id=' + (c.tinyid || c.tiny_id)],
              10000,
              env
            );
            const info = (r && r.data) || {};
            const allMatch = fields.every((f) => {
              const a = String(info[f] || '').trim();
              const b = String(gi[f] || '').trim();
              return !a || !b || a === b; // 任一侧缺失该字段则跳过，不当作反证
            });
            if (allMatch) {
              if (verified) { ambiguous = true; break; }
              verified = c;
            }
          }
          if (verified && !ambiguous) {
            tinyId = String(verified.tinyid || verified.tiny_id || '');
          } else if (ambiguous) {
            reason = 'ambiguous';
          } else {
            reason = 'not_found'; // 全部候选都不匹配（本人可能已退频道/改了昵称）
          }
        } else {
          reason = 'not_found'; // 搜索有结果但无精确同名者
        }
      } else {
        reason = 'not_found';
      }
      } // 直取失败才搜索兜底
    }
  } catch (_) { /* 反查失败返回空，调用方处理 */ }

  // 更新 session 并标记（供 bind 复用）
  if (nickname) s.nickname = nickname;
  if (tinyId) s.tiny_id = tinyId;
  return { nickname, tinyId, reason };
}

// 身份反查失败提示：区分「未找到」（引导加入频道/确认昵称）与「同名歧义」（引导改昵称）
function identityFailMsg(reason) {
  if (reason === 'ambiguous') {
    return '频道内有多个与你昵称相同的成员，无法自动识别身份。请在频道内修改一个可区分的昵称后重新扫码授权';
  }
  return '已授权但无法识别你的 QQ 身份（频道成员搜索失败），请确认已加入「南方中学校友频道」后重新扫码，或稍后重试';
}

// 2. 轮询授权状态（扫码期间高频调用，不设限流）
router.post(
  '/poll',
  asyncHandler(async (req, res) => {
    const sessionId = String((req.body && req.body.session) || '');
    if (!sessionId) return res.status(400).json({ error: 'Missing session' });
    const s = qqSessions.getSession(sessionId);
    if (!s) return res.status(404).json({ error: '会话已过期，请重新扫码' });
    if (s.token_obtained) {
      // 快捷分支：已授权。但若 tiny_id 缺失（上次反查失败），必须重查，
      // 否则前端拿到 authorized 但 bind 仍失败 → 用户看到的"弹表单又报扫码"循环
      if (!s.tiny_id) {
        const envRetry = qqSessions.sessionEnv(s);
        const { tinyId: retryTinyId, reason: retryReason } = await resolveTinyId(s, envRetry);
        if (!retryTinyId) {
          return res.json({
            session: sessionId,
            status: 'pending_authorization',
            error: identityFailMsg(retryReason),
            join_hint: retryReason !== 'ambiguous',
          });
        }
      }
      return res.json({
        session: sessionId,
        status: 'authorized',
        tiny_id: s.tiny_id,
        nickname: s.nickname,
        bound: !!s.bound_user,
        user: s.bound_user ? publicUser(s.bound_user) : undefined,
      });
    }
    const env = qqSessions.sessionEnv(s);
    let result;
    try {
      result = await runCli(['login', 'poll-token'], 25000, env);
    } catch (err) {
      return res.json({ session: sessionId, status: 'pending_authorization', error: '令牌检查失败' });
    }
    if (!result || !result.success) {
      return res.json({
        session: sessionId,
        status: 'pending_authorization',
        error: (result && result.error && result.error.message) || '',
      });
    }
    const isAuthorized = (result.data && result.data.status === 'authorized') || result.status === 'authorized';
    if (!isAuthorized) {
      return res.json({ session: sessionId, status: 'pending', error: '' });
    }

    // 已授权：取昵称 + tiny_id
    s.token_obtained = true;
    const { tinyId, reason } = await resolveTinyId(s, env);

    // tiny_id 反查失败：不进入 bind（否则填完班级姓名 bind 才报"请先扫码授权"）。
    // 返回 pending_authorization + 明确错误，前端重试；bind 侧也有兜底重查。
    if (!tinyId) {
      return res.json({
        session: sessionId,
        status: 'pending_authorization',
        error: identityFailMsg(reason),
        join_hint: reason !== 'ambiguous',
      });
    }

    let bound = false;
    let user = null;
    const rows = await query('SELECT * FROM users WHERE qq_tiny_id = ?', [s.tiny_id]);
    if (rows.length > 0) { bound = true; user = rows[0]; }
    s.bound_user = user;
    return res.json({
      session: sessionId,
      status: 'authorized',
      tiny_id: s.tiny_id,
      nickname: s.nickname,
      bound,
      user: user ? publicUser(user) : undefined,
    });
  })
);

// 3. 绑定：已绑定则直接登录；未绑定需班级+姓名
router.post(
  '/bind',
  rateLimit({ windowMs: 10 * 60 * 1000, max: 30, keyFn: ipKey }),
  asyncHandler(async (req, res) => {
    const sessionId = String((req.body && req.body.session) || '');
    const s = qqSessions.getSession(sessionId);
    if (!s || !s.token_obtained) {
      return res.status(401).json({ error: '请先完成扫码授权' });
    }

    // 兜底：tiny_id 缺失时（poll 阶段反查失败/超时），用会话真实 token 再查一次
    if (!s.tiny_id) {
      const env = qqSessions.sessionEnv(s);
      const { tinyId, reason } = await resolveTinyId(s, env);
      if (!tinyId) {
        return res.status(401).json({ error: identityFailMsg(reason) });
      }
    }

    let class_name = String((req.body && req.body.class_name) || '').trim();
    let real_name = String((req.body && req.body.real_name) || '').trim();

    // 展示名授权：默认展示真实姓名；选「否」时昵称 = 姓名拼音首字母（方案二，选定后不可更改）
    const showReal = req.body && req.body.show_real_name !== false && req.body.show_real_name !== 0 && req.body.show_real_name !== '0';
    let nickname = String((req.body && req.body.nickname) || '').trim().slice(0, 32) || null;
    if (!showReal) {
      if (!real_name) {
        return res.status(400).json({ error: '选择只展示昵称后，请填写姓名以生成昵称缩写' });
      }
      const pc = await pinyinCandidates(real_name);
      if (!pc.candidates.length) {
        return res.status(400).json({ error: '无法生成姓名缩写昵称，请选择展示真实姓名' });
      }
      if (!nickname || !pc.candidates.includes(nickname)) {
        return res.status(400).json({ error: '昵称须为姓名拼音首字母，请从候选中选择' });
      }
    }

    // 该 tiny_id 已绑定 → 直接登录（无需再填班级姓名）
    const byQq = await query('SELECT * FROM users WHERE qq_tiny_id = ?', [s.tiny_id]);
    if (byQq.length > 0) {
      // 停用用户：拒绝登录
      if (byQq[0].status !== 'active') {
        return res.status(403).json({ error: '账号已停用' });
      }
      await maybeGrantAdmin(byQq[0].id, s.tiny_id);
      await linkSession(sessionId, byQq[0].id);
      const fresh = await query('SELECT * FROM users WHERE id = ?', [byQq[0].id]);
      return res.json({ token: issue(byQq[0].id), user: publicUser(fresh[0]) });
    }

    class_name = config.normalizeClass(class_name);
    const isStandard = config.isStandardClass(class_name);
    // 「其他」年级：班级必填，仅接受 4 位班级号（毕业生）或 0（外校）
    if (!isStandard && (class_name !== '0' && !/^\d{4}$/.test(class_name))) {
      return res.status(400).json({ error: '毕业生请填自己班级（4 位数字），外校请填 0' });
    }
    if (isStandard && !real_name) {
      return res.status(400).json({ error: '请输入姓名' });
    }
    if (real_name.length > 32) {
      return res.status(400).json({ error: '姓名过长' });
    }
    if (!real_name) real_name = s.nickname || '同学';

    const byName = await query(
      'SELECT * FROM users WHERE class_name = ? AND real_name = ?',
      [class_name, real_name]
    );
    if (byName.length > 0) {
      const u = byName[0];
      // 停用用户：拒绝绑定登录
      if (u.status !== 'active') {
        return res.status(403).json({ error: '账号已停用' });
      }
      if (u.qq_tiny_id && u.qq_tiny_id !== s.tiny_id) {
        return res.status(409).json({ error: '该姓名已绑定其他 QQ，请勿冒用' });
      }
      // 接管访客身份：清除遗留的 guest 凭据——QQ 绑定后该身份不再允许访客登记（L2），
      // 旧 guest_token 若曾被分享/冒名获取，继续有效等于遗留后门，一并作废（该用户此后用 QQ 登录）
      await query('UPDATE users SET qq_tiny_id = ?, guest_token = NULL, guest_pwd_hash = NULL WHERE id = ?', [s.tiny_id, u.id]);
      u.qq_tiny_id = s.tiny_id;
      await maybeGrantAdmin(u.id, s.tiny_id);
      await linkSession(sessionId, u.id);
      const fresh = await query('SELECT * FROM users WHERE id = ?', [u.id]);
      return res.json({ token: issue(u.id), user: publicUser(fresh[0]) });
    }

    const result = await query(
      'INSERT INTO users (class_name, real_name, qq_tiny_id, show_real_name, nickname) VALUES (?, ?, ?, ?, ?)',
      [class_name, real_name, s.tiny_id, showReal ? 1 : 0, nickname]
    );
    const created = { id: result.insertId, class_name, real_name, qq_tiny_id: s.tiny_id, show_real_name: showReal ? 1 : 0, nickname, points: 0, created_at: new Date() };
    // 首次登录奖励
    await grant(created.id, 'first_login', 'once');
    await maybeGrantAdmin(created.id, s.tiny_id);
    const fresh = await query('SELECT points, is_admin, status FROM users WHERE id = ?', [created.id]);
    created.points = fresh.length ? fresh[0].points : 0;
    created.is_admin = fresh.length ? fresh[0].is_admin : 0;
    created.status = fresh.length ? fresh[0].status : 'active';
    await linkSession(sessionId, created.id);
    return res.json({ token: issue(created.id), user: publicUser(created) });
  })
);

module.exports = router;
