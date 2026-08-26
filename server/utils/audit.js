'use strict';

// DeepSeek 内容审查：上传文本/代码类文件（HTML/PY/JS/TS 等）时调用，
// 判断是否含色情/未成年不宜、违法违规、恶意脚本或恶意代码注入。
// 二进制文件（图片/视频等）不适用文本审查；结果由调用方决定放行/拒绝。
// 展示昵称审查（reviewNickname，2026-08-15）：昵称公开展示在作品展/排行榜等页面，
// 写入前同步审核是否含辱骂/违规/广告引流/冒充官方等，违规拒绝并提示修改。
const config = require('../config');
const { getSetting } = require('./settings');

const SYSTEM_PROMPT = `你是网站内容安全审查员。用户会上传网页源码或程序代码文件，请判断其内容是否包含以下违规类型：
1. 色情/成人内容，尤其是涉及未成年人的内容（如色情图片、露骨文字、成人交友等）
2. 违法违规内容（赌博、诈骗、攻击性政治言论等）
3. 恶意脚本或代码注入（挖矿脚本、XSS 窃取信息、钓鱼页面、恶意下载、跳转恶意网站、窃取凭据、后门/木马代码等）

要求：
- 只标记明确违规的内容；正常的个人网页、小游戏、学习工具、作品展示、普通代码一律判为安全
- 若内容模糊、不确定，判为安全（避免误伤正常学生作品）
- 网页中出现的普通词（如"成人教育"、"儿童"等）不算违规，要结合上下文判断

只输出 JSON 对象：{"safe": true 或 false, "reason": "判断原因，safe 为 true 时填'正常内容'，false 时简要说明违规类型"}`;

const NICK_SYSTEM_PROMPT = `你是校园平台的展示昵称安全审查员，要求从严审查。学生设置的昵称会公开展示在全校作品展、排行榜等页面，任何不当内容都会造成校园舆论与合规风险。

以下昵称一律判为违规（safe=false）：
1. 脏话、辱骂、人身攻击、歧视性言论，**包括谐音/变形/拼音缩写**（如"草泥马""TMD""SB""NMD""你妈""CNM""去死"等）
2. 侮辱性或戏谑辈分的称呼（如"X爸爸""X爹""X爷爷""X儿子""我是你爹""爸爸""爷爷"等自称或自称长辈的昵称）
3. 低俗、色情、擦边、性暗示内容（含谐音擦边）
4. 违法违规内容（赌博、诈骗、攻击性政治言论等）
5. 广告营销/引流（QQ 群、微信号、电话号码、网址链接、交易信息、"代做作业""刷分"等）
6. 冒充官方或他人身份（如昵称包含"管理员""官方""老师"等冒充平台管理方，或冒用他人姓名）
7. 暴力威胁、校园霸凌暗示、自我伤害或自残相关内容

要求：
- 从严：只要存在上述任一类型或其明显谐音/变形/缩写变体，即判违规；不确定时倾向判违规
- 仅以下情况判安全：正常真实姓名、正常中性昵称（如"星辰大海""摸鱼小能手"）、纯字母缩写（如"ZS"）、纯数字
- 切勿把"XX爸爸""XX爹"等辈分自称当作正常昵称放行

只输出 JSON 对象：{"safe": true 或 false, "reason": "判断原因，safe 为 true 时填'正常昵称'，false 时简要说明违规类型"}`;

/**
 * 调用 DeepSeek 审查（共享 HTTP 逻辑）
 * @param {string} text 待审查文本
 * @param {string} systemPrompt 审查规则
 * @param {number} maxLen 送入模型的文本截断长度
 * @returns {Promise<{safe: boolean, reason: string}>}
 * @throws 审查接口不可用/超时/解析失败时抛错（调用方决定降级处理）
 */
async function _review(text, systemPrompt, maxLen) {
  const cfg = config.deepseek;
  if (!cfg.apiKey) throw new Error('未配置 DEEPSEEK_API_KEY');
  const content = String(text || '').slice(0, maxLen || 64);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '以下是待审查的内容：\n\n' + content },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('审查接口 HTTP ' + res.status + ' ' + body.slice(0, 200));
    }
    const data = await res.json();
    const out = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const m = String(out || '').match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : null;
    return {
      safe: !!(parsed && parsed.safe !== false),
      reason: (parsed && parsed.reason) ? String(parsed.reason).slice(0, 200) : '',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 审查文本/代码内容（上传文件用）
 */
async function reviewContent(content) {
  return _review(content, SYSTEM_PROMPT, config.deepseek.maxChars);
}

/**
 * 审查展示昵称（公开展示前调用）
 */
async function reviewNickname(nickname) {
  return _review(nickname, NICK_SYSTEM_PROMPT, 64);
}

const TEXT_SYSTEM_PROMPT = `你是校园作品展示平台的内容安全审查员，要求从严审查。学生的作品标题、简介、玩法说明会公开展示在全校作品展，请判断是否包含以下违规类型：
1. 辱骂、人身攻击、歧视、低俗色情内容（含谐音/拼音缩写/变形）
2. 违法违规内容（赌博、诈骗、攻击性政治言论等）
3. 广告营销/引流（QQ 群、微信号、电话号码、网址链接、交易信息、"代做作业""刷分"等）
4. 冒充官方或他人身份
5. 暴力威胁、校园霸凌暗示、自我伤害或自残内容

要求：
- 从严：存在上述任一类型或其明显变体即判违规；不确定时倾向判违规
- 正常作品介绍、技术描述、学习心得、游戏玩法说明、项目功能描述一律判为安全

只输出 JSON 对象：{"safe": true 或 false, "reason": "判断原因，safe 为 true 时填'正常内容'，false 时简要说明违规类型"}`;

/**
 * 审查展示文本（作品标题/简介/玩法，公开展示前调用）
 */
async function reviewDisplayText(text) {
  return _review(text, TEXT_SYSTEM_PROMPT, 2000);
}

// 「一句话生成小程序」请求预检（2026-08-25）：生成前先判定
//   1) is_app_request：是否为应用生成式命令（闲聊如"你好"判 false，不浪费生成资源）
//   2) safe：提示词本身是否违规（违规不放行给生成模型）
const GEN_PRECHECK_SYSTEM_PROMPT = `你是「一句话生成小程序」功能的请求预检员。该功能只接受"用一句话描述一个网页小程序/小游戏/小工具的需求，由 AI 生成它"的指令。请对用户输入做两项判定：

1. is_app_request：是否为明确的小程序/网页应用/小游戏/小工具的生成或迭代修改需求（如"做一个贪吃蛇游戏""做个番茄钟""给计算器加历史记录功能"）。纯闲聊、打招呼、提问咨询、与生成应用无关的请求（如"你好""今天天气怎么样""你是谁""帮我写作文"）判为 false。
2. safe：内容是否合规。包含色情低俗、违法违规（赌博/诈骗/攻击性政治言论）、暴力血腥、辱骂歧视、广告营销引流等内容判为 false；其余一律判为 true。

要求：
- 判定 is_app_request 时适度宽松：只要能合理理解为对某个应用的需求（哪怕描述很短很简陋，如"做个计算器"）即判 true，避免误伤学生创意
- 迭代修改指令（如"背景改成蓝色""加个音效""重新生成"）也是有效的应用需求，判 true
- safe 判定从严：存在上述任一违规类型或其明显谐音/变形变体即判 false

只输出 JSON 对象：{"is_app_request": true 或 false, "safe": true 或 false, "reason": "简要判断原因"}`;

/**
 * 调 DeepSeek 预检生成请求（返回三字段原始结果）
 * @returns {Promise<{isAppRequest: boolean, safe: boolean, reason: string}>}
 * @throws 接口不可用/超时/解析失败时抛错（调用方决定降级处理）
 */
async function reviewGenRequest(idea) {
  const cfg = config.deepseek;
  if (!cfg.apiKey) throw new Error('未配置 DEEPSEEK_API_KEY');
  const content = String(idea || '').slice(0, 500);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    const res = await fetch(cfg.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: GEN_PRECHECK_SYSTEM_PROMPT },
          { role: 'user', content: '以下是待预检的用户输入：\n\n' + content },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error('预检接口 HTTP ' + res.status + ' ' + body.slice(0, 200));
    }
    const data = await res.json();
    const out = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const m = String(out || '').match(/\{[\s\S]*\}/);
    const parsed = m ? JSON.parse(m[0]) : null;
    return {
      isAppRequest: !!(parsed && parsed.is_app_request !== false), // 解析失败按是需求处理，只靠 safe 拦截
      safe: !!(parsed && parsed.safe !== false),
      reason: (parsed && parsed.reason) ? String(parsed.reason).slice(0, 200) : '',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 「一句话生成小程序」请求预检统一入口（/api/gen/app 与 /app/stream 共用）：
 * 尊重 DEEPSEEK_AUDIT 与 settings.audit_enabled 开关；AI 不可用时降级放行（与其它审查一致）。
 * 被拒请求写入 audit_logs（kind='gen_precheck'）可追溯。
 * @returns {Promise<{ok: boolean, type?: 'not_app'|'unsafe', reason?: string}>}
 */
async function auditGenIdea(idea, meta) {
  const t = String(idea || '').trim();
  if (!t) return { ok: true };
  if (!config.deepseek.auditEnabled) return { ok: true };
  let auditOn = true;
  try {
    const auditRuntime = await getSetting('audit_enabled');
    if (auditRuntime === '0') auditOn = false;
  } catch (_) { /* 设置读取失败按开启处理 */ }
  if (!auditOn) return { ok: true };
  try {
    const r = await reviewGenRequest(t);
    if (r.safe && r.isAppRequest) return { ok: true };
    const type = r.safe ? 'not_app' : 'unsafe'; // 合规但非应用需求 → not_app；违规 → unsafe
    // 落库可追溯（O3 同口径）；记录失败不影响主流程
    try {
      const { query } = require('../db');
      await query(
        'INSERT INTO audit_logs (kind, content, result, reason, user_id, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['gen_precheck', t.slice(0, 500), 'rejected', type + ': ' + (r.reason || ''), (meta && meta.userId) || null, '', 0]
      );
    } catch (_) {}
    return { ok: false, type, reason: r.reason || '' };
  } catch (_) {
    return { ok: true }; // AI 不可用/超时降级放行
  }
}

/**
 * 昵称合规审查统一入口（QQ 绑定 / 访客登记 / 修改资料共用）：
 * 尊重 DEEPSEEK_AUDIT 与 settings.audit_enabled 运行时开关；
 * AI 不可用/超时/未配置时降级放行（与文件审查一致），不阻断用户操作。
 * @returns {Promise<{ok: boolean, reason?: string}>} ok=false 表示违规拒绝
 */
async function auditNickname(nickname) {
  const nick = String(nickname || '').trim();
  if (!nick) return { ok: true };
  if (!config.deepseek.auditEnabled) return { ok: true };
  try {
    const auditRuntime = await getSetting('audit_enabled');
    if (auditRuntime === '0') return { ok: true };
  } catch (_) { /* 设置读取失败按开启处理 */ }
  try {
    const r = await reviewNickname(nick);
    return r.safe ? { ok: true } : { ok: false, reason: r.reason || '昵称不合规' };
  } catch (_) {
    return { ok: true }; // AI 不可用降级放行
  }
}

/**
 * 展示文本合规审查统一入口（作品标题/简介/玩法，R2）：
 * 尊重开关、AI 不可用降级放行；违规时同时写入内容审查记录（O3）。
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function auditDisplayText(text, meta) {
  const t = String(text || '').trim();
  if (!t) return { ok: true };
  if (!config.deepseek.auditEnabled) return { ok: true };
  let auditOn = true;
  try {
    const auditRuntime = await getSetting('audit_enabled');
    if (auditRuntime === '0') auditOn = false;
  } catch (_) { /* 设置读取失败按开启处理 */ }
  if (!auditOn) return { ok: true };
  try {
    const r = await reviewDisplayText(t);
    if (r.safe) return { ok: true };
    // O3：违规内容落库可追溯
    try {
      const { query } = require('../db');
      await query(
        'INSERT INTO audit_logs (kind, content, result, reason, user_id, ref_type, ref_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['display_text', t.slice(0, 500), 'rejected', r.reason || '', (meta && meta.userId) || null, (meta && meta.refType) || null, (meta && meta.refId) || null]
      );
    } catch (_) { /* 记录失败不影响主流程 */ }
    return { ok: false, reason: r.reason || '内容不合规' };
  } catch (_) {
    return { ok: true }; // AI 不可用降级放行
  }
}

module.exports = { reviewContent, reviewNickname, reviewDisplayText, auditNickname, auditDisplayText, reviewGenRequest, auditGenIdea, SYSTEM_PROMPT, NICK_SYSTEM_PROMPT, TEXT_SYSTEM_PROMPT, GEN_PRECHECK_SYSTEM_PROMPT };
