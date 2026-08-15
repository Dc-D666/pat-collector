'use strict';

// 阅读打卡服务端计时（L7 修复）：文章详情加载（GET /api/learn/:slug，带 Bearer）时记录开始时间，
// POST /api/points/read 打卡时校验已阅读时长 ≥60s，杜绝"直接 POST 刷 +10⭐"。
// 进程内 Map（单进程部署够用）：key = userId:articleId，value = 开始时间戳。
// 记录保留（不消费）：防重由 points_log 唯一键兜底，保留可容忍打卡接口偶发失败后的重试。

const MAX_AGE_MS = 3 * 60 * 60 * 1000; // 单次阅读会话最长 3 小时
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const starts = new Map();

// 记录用户开始阅读某文章（幂等：已有未过期的进行中记录则不重置，避免重复加载刷新计时）
function markStart(userId, articleId) {
  const key = userId + ':' + articleId;
  const now = Date.now();
  const prev = starts.get(key);
  if (prev && now - prev < MAX_AGE_MS) return;
  starts.set(key, now);
  if (starts.size > 5000) sweep();
}

// 校验是否已阅读至少 minMs 毫秒（不消费记录）
function checkElapsed(userId, articleId, minMs) {
  const start = starts.get(userId + ':' + articleId);
  if (start == null) return false;
  return Date.now() - start >= minMs;
}

function sweep() {
  const now = Date.now();
  for (const [k, v] of starts) {
    if (now - v > MAX_AGE_MS) starts.delete(k);
  }
}

const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
if (timer.unref) timer.unref();

module.exports = { markStart, checkElapsed };
