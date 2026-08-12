'use strict';

const { execFile } = require('child_process');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const FEED_LINKS_PY = path.join(PROJECT_ROOT, 'feed_links.py');
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

module.exports = { extractLinks };
