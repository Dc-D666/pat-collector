'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// QQ 扫码登录会话：每会话一个独立 HOME，CLI 凭证写进 $HOME/.qqcli/，实现 token 隔离。
// PatPlayer 只在登录期用到 QQ token，登录绑定后即清理，故仅存内存 + 15min 闲置回收。

const SESSIONS_DIR = config.qqSessionsDir;
const IDLE_TTL_MS = 15 * 60 * 1000;

const sessions = new Map();

function ensureDir() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function createSession() {
  ensureDir();
  const sessionId = crypto.randomBytes(8).toString('hex');
  const homeDir = path.join(SESSIONS_DIR, sessionId);
  fs.mkdirSync(homeDir, { recursive: true });
  sessions.set(sessionId, {
    sessionId,
    homeDir,
    lastActive: Date.now(),
    tiny_id: '',
    nickname: '',
    token_obtained: false,
  });
  return sessionId;
}

function getSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return null;
  s.lastActive = Date.now();
  return s;
}

// 每会话独立 HOME，实现 CLI 凭证隔离
function sessionEnv(s) {
  const env = { HOME: s.homeDir };
  if (process.platform === 'win32') env.USERPROFILE = s.homeDir;
  return env;
}

function cleanupSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  try { fs.rmSync(s.homeDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  sessions.delete(sessionId);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActive > IDLE_TTL_MS) cleanupSession(id);
  }
}, 60 * 1000).unref();

module.exports = { createSession, getSession, sessionEnv, cleanupSession };
