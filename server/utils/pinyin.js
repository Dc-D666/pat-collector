'use strict';

// 姓名 → 拼音首字母候选（昵称方案二：多音字展开全部读音）
// 调 python3 pinyin_initials.py（依赖 pypinyin，pip 已装），失败降级返回空候选。
const { execFile } = require('child_process');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', '..', 'pinyin_initials.py');

/**
 * @param {string} name 真实姓名
 * @returns {Promise<{name: string, candidates: string[]}>}
 */
function pinyinCandidates(name) {
  return new Promise((resolve) => {
    const arg = String(name || '').slice(0, 64);
    execFile('python3', [SCRIPT, arg], { timeout: 10000 }, (err, stdout) => {
      if (err) {
        resolve({ name: arg, candidates: [] });
        return;
      }
      try {
        const parsed = JSON.parse(String(stdout || '').trim());
        resolve({
          name: arg,
          candidates: Array.isArray(parsed.candidates) ? parsed.candidates.slice(0, 6) : [],
        });
      } catch (_) {
        resolve({ name: arg, candidates: [] });
      }
    });
  });
}

module.exports = { pinyinCandidates };
