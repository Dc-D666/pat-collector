'use strict';

const { execFile } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const FEED_LINKS_PY = path.join(PROJECT_ROOT, 'feed_links.py');
const SHARE_RESOLVE_PY = path.join(PROJECT_ROOT, 'share_resolve.py');
const CLI_BIN_DIR = (() => {
  const isWin = process.platform === 'win32';
  return isWin
    ? path.join(PROJECT_ROOT, 'node_modules', 'tencent-channel-cli-win32-x64', 'bin')
    : path.join(PROJECT_ROOT, 'node_modules', 'tencent-channel-cli-linux-x64', 'bin');
})();

// 用 feed_links.py 提取某帖子里的 AI 轻应用链接。
// 需要用户的 QQ 会话（token 在 session.homeDir/.qqcli/.env），脚本内部会起代理捕获原始 MCP 响应。
function extractLinks(feedId, session, channelId) {
  return new Promise((resolve, reject) => {
    const args = [FEED_LINKS_PY, feedId];
    if (channelId) args.push(channelId);
    const env = {
      ...process.env,
      HOME: session.homeDir,
      PATH: CLI_BIN_DIR + path.delimiter + (process.env.PATH || ''),
    };
    if (process.platform === 'win32') env.USERPROFILE = session.homeDir;

    execFile(
      'python3',
      args,
      { env, timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          return reject(new Error('识别失败：' + ((stderr && stderr.trim().slice(0, 200)) || error.message)));
        }
        // 输出：每行 `displayText<TAB>url` 或单独一个 url
        const links = [];
        for (const line of (stdout || '').split('\n')) {
          const l = line.trim();
          if (!l) continue;
          const idx = l.indexOf('\t');
          if (idx >= 0) {
            links.push({ text: l.slice(0, idx).trim(), url: l.slice(idx + 1).trim() });
          } else if (/^https?:\/\//.test(l)) {
            links.push({ text: '', url: l });
          }
        }
        resolve(links);
      }
    );
  });
}

// 用 share_resolve.py 把 pd.qq.com/s/ 短链解析成帖子 ID（BID）。
// 脚本内部用 curl + 浏览器 UA 拉取 Nuxt SSR 页面提取 feedId。
function resolveShare(shortUrl) {
  return new Promise((resolve, reject) => {
    execFile(
      'python3',
      [SHARE_RESOLVE_PY, shortUrl],
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          return reject(new Error('解析失败：' + ((stderr && stderr.trim().slice(0, 200)) || error.message)));
        }
        const out = stdout || '';
        const bids = [];
        for (const line of out.split('\n')) {
          const m = line.match(/^BID\s*:\s*(B_[a-zA-Z0-9]+)/);
          if (m) bids.push(m[1]);
        }
        if (bids.length === 0) {
          const hint = out.split('\n').filter((l) => l.startsWith('错误') || l.startsWith('未解析')).join(' ');
          return reject(new Error(hint || '未解析到帖子ID'));
        }
        resolve(bids[0]);
      }
    );
  });
}

module.exports = { extractLinks, resolveShare };
