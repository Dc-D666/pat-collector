'use strict';

// 进程内滑动窗口限流（单机够用），key 由 keyFn 提供
function rateLimit({ windowMs, max, keyFn }) {
  const hits = new Map();
  const cleanup = () => {
    const now = Date.now();
    for (const [key, arr] of hits) {
      const kept = arr.filter((t) => now - t < windowMs);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    }
  };
  const timer = setInterval(cleanup, windowMs);
  if (timer.unref) timer.unref();

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    arr.push(now);
    hits.set(key, arr);
    next();
  };
}

module.exports = { rateLimit };
