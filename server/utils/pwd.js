'use strict';

// 访客删除安全密码：scrypt 加盐哈希存储 + 常量时间比较（Node 内置 crypto，无新依赖）
const crypto = require('crypto');

const SALT_BYTES = 16;
const KEY_LEN = 64;

// 哈希密码 → "saltHex:hashHex"；返回 null 表示空密码（不存哈希）
function hashPassword(pwd) {
  const s = String(pwd == null ? '' : pwd);
  if (!s) return null;
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(s, salt, KEY_LEN);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

// 校验密码是否匹配存储的 "salt:hash"
function verifyPassword(pwd, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const idx = stored.indexOf(':');
  if (idx < 0) return false;
  const salt = Buffer.from(stored.slice(0, idx), 'hex');
  const expected = Buffer.from(stored.slice(idx + 1), 'hex');
  if (expected.length !== KEY_LEN) return false;
  const actual = crypto.scryptSync(String(pwd == null ? '' : pwd), salt, KEY_LEN);
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
