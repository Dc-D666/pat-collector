'use strict';

// DeepSeek 内容审查：上传文本/代码类文件（HTML/PY/JS/TS 等）时调用，
// 判断是否含色情/未成年不宜、违法违规、恶意脚本或恶意代码注入。
// 二进制文件（图片/视频等）不适用文本审查；结果由调用方决定放行/拒绝。
const config = require('../config');

const SYSTEM_PROMPT = `你是网站内容安全审查员。用户会上传网页源码或程序代码文件，请判断其内容是否包含以下违规类型：
1. 色情/成人内容，尤其是涉及未成年人的内容（如色情图片、露骨文字、成人交友等）
2. 违法违规内容（赌博、诈骗、攻击性政治言论等）
3. 恶意脚本或代码注入（挖矿脚本、XSS 窃取信息、钓鱼页面、恶意下载、跳转恶意网站、窃取凭据、后门/木马代码等）

要求：
- 只标记明确违规的内容；正常的个人网页、小游戏、学习工具、作品展示、普通代码一律判为安全
- 若内容模糊、不确定，判为安全（避免误伤正常学生作品）
- 网页中出现的普通词（如"成人教育"、"儿童"等）不算违规，要结合上下文判断

只输出 JSON 对象：{"safe": true 或 false, "reason": "判断原因，safe 为 true 时填'正常内容'，false 时简要说明违规类型"}`;

/**
 * 审查文本/代码内容
 * @param {string} content 文件文本内容
 * @returns {Promise<{safe: boolean, reason: string}>}
 * @throws 审查接口不可用/超时/解析失败时抛错（调用方决定降级处理）
 */
async function reviewContent(content) {
  const cfg = config.deepseek;
  if (!cfg.apiKey) throw new Error('未配置 DEEPSEEK_API_KEY');
  const text = String(content || '').slice(0, cfg.maxChars);

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
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: '以下是待审查的文件内容：\n\n' + text },
        ],
        temperature: 0.1,
        max_tokens: 300,
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

module.exports = { reviewContent, SYSTEM_PROMPT };
