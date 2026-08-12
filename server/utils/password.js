'use strict';

const crypto = require('crypto');

// scrypt 加盐哈希，存储格式：salt:derived（均 base64url）
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = crypto.scryptSync(password, salt, 64).toString('base64url');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const idx = stored.indexOf(':');
  if (idx < 0) return false;
  const salt = stored.slice(0, idx);
  const expected = stored.slice(idx + 1);
  const derived = crypto.scryptSync(password, salt, 64);
  const expBuf = Buffer.from(expected, 'base64url');
  return derived.length === expBuf.length && crypto.timingSafeEqual(derived, expBuf);
}

module.exports = { hashPassword, verifyPassword };
