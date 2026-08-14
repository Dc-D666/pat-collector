'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// QQ 会话：每会话一个独立 HOME（CLI 凭证写进 $HOME/.qqcli/），token 天然隔离。
// 会话需要长期存活（自动/手动识别轻应用都要用 token），故持久化索引 + 30 天闲置回收。
// token 本体在会话目录的 .qqcli/.env 里，目录不删则 token 持久化。

const SESSIONS_DIR = config.qqSessionsDir;
const INDEX_FILE = path.join(SESSIONS_DIR, 'index.json');
const IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 天

const sessions = new Map();
let dirty = false;

function ensureDir() {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

function loadIndex() {
  try {
    if (!fs.existsSync(INDEX_FILE)) return {};
    return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveIndex() {
  ensureDir();
  const toSave = {};
  for (const [id, s] of sessions) {
    if (!s.homeDir || !fs.existsSync(s.homeDir)) continue;
    toSave[id] = {
      sessionId: s.sessionId,
      homeDir: s.homeDir,
      tiny_id: s.tiny_id || '',
      nickname: s.nickname || '',
      user_id: s.user_id || null,
      token_obtained: !!s.token_obtained,
    };
  }
  try {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(toSave, null, 2));
  } catch (_) { /* 磁盘写失败不致命 */ }
}

// 启动恢复
ensureDir();
for (const [id, d] of Object.entries(loadIndex())) {
  if (d.homeDir && fs.existsSync(d.homeDir)) {
    sessions.set(id, { ...d, lastActive: Date.now() });
  }
}

function markDirty() {
  dirty = true;
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
    user_id: null,
  });
  markDirty();
  return sessionId;
}

function getSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return null;
  s.lastActive = Date.now();
  return s;
}

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
  markDirty();
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastActive > IDLE_TTL_MS) cleanupSession(id);
  }
  if (dirty) {
    saveIndex();
    dirty = false;
  }
}, 60 * 1000).unref();

module.exports = {
  createSession,
  getSession,
  sessionEnv,
  cleanupSession,
  markDirty,
  saveIndex,
  // 管理后台用：内存会话快照（含最后活跃时间）
  listSessions: () => {
    const out = [];
    for (const [id, s] of sessions) {
      out.push({
        sessionId: id,
        tiny_id: s.tiny_id || '',
        nickname: s.nickname || '',
        user_id: s.user_id || null,
        token_obtained: !!s.token_obtained,
        homeDir: s.homeDir || '',
        last_active: s.lastActive || 0,
      });
    }
    return out;
  },
};
