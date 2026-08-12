'use strict';

const crypto = require('crypto');
const config = require('../config');

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64url');
}

function b64urlDecode(str) {
  return Buffer.from(str, 'base64url');
}

// 签发 token：base64url(payload).HMAC-SHA256(payload)
function issue(uid) {
  const payload = { uid, exp: Date.now() + config.tokenTtlMs };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', config.tokenSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

// 校验 token，返回 payload 或 null
function verify(token) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac('sha256', config.tokenSecret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(b64urlDecode(body).toString('utf8'));
    if (!payload.uid || !payload.exp) return null;
    if (Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

module.exports = { issue, verify };
