'use strict';

// 运行时设置读取（管理后台 settings 表）：进程内短缓存（30s），改设置后最多 30s 生效，无需重启
const { query } = require('../db');

const CACHE_TTL_MS = 30 * 1000;
let cache = null;
let cacheAt = 0;

async function refresh() {
  const rows = await query('SELECT skey, svalue FROM settings');
  const map = {};
  for (const r of rows) map[r.skey] = r.svalue;
  cache = map;
  cacheAt = Date.now();
}

// 读一个设置；不存在返回 null；读失败返回 null（不阻塞主流程）
async function getSetting(key) {
  try {
    if (!cache || Date.now() - cacheAt > CACHE_TTL_MS) await refresh();
    return cache[key] != null ? cache[key] : null;
  } catch (err) {
    console.warn('[settings] 读取失败（降级为默认）：', err.message);
    return null;
  }
}

// 强制刷新缓存（管理后台写设置后调用，立即可见）
async function invalidate() {
  cache = null;
  cacheAt = 0;
  await refresh().catch(() => {});
}

module.exports = { getSetting, invalidate };
