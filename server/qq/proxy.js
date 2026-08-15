'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

// 定位 tencent-channel-cli 原生二进制（平台差异）
const CLI = (() => {
  const isWin = process.platform === 'win32';
  const root = path.resolve(__dirname, '..', '..');
  const candidates = isWin
    ? [
        path.resolve(root, 'node_modules', 'tencent-channel-cli-win32-x64', 'bin', 'tencent-channel-cli.exe'),
        path.resolve(root, 'node_modules', '.bin', 'tencent-channel-cli.cmd'),
        'tencent-channel-cli',
      ]
    : [
        path.resolve(root, 'node_modules', 'tencent-channel-cli-linux-x64', 'bin', 'tencent-channel-cli'),
        path.resolve(root, 'node_modules', 'tencent-channel-cli-linux-arm64', 'bin', 'tencent-channel-cli'),
        path.resolve(root, 'node_modules', '.bin', 'tencent-channel-cli'),
        'tencent-channel-cli',
      ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
})();

// 执行 CLI，追加 --json，解析最后一行的 JSON 结果
function runCli(args, timeoutMs = 60000, env) {
  return new Promise((resolve, reject) => {
    const fullArgs = [...args, '--json'];
    const options = { timeout: timeoutMs };
    if (env) options.env = { ...process.env, ...env };

    execFile(CLI, fullArgs, options, (error, stdout, stderr) => {
      const jsonLines = (stdout || '').split('\n').filter((l) => l.trim().startsWith('{'));
      if (jsonLines.length > 0) {
        try {
          resolve(JSON.parse(jsonLines[jsonLines.length - 1]));
          return;
        } catch (_) { /* fallthrough */ }
      }
      if (error) {
        if (error.code === 'ETIMEDOUT' || error.killed) {
          resolve({ success: false, data: { status: 'pending_authorization' }, _timeout: true });
          return;
        }
        return reject(new Error(`CLI error: ${error.message}\nstderr: ${stderr}`));
      }
      reject(new Error(`Invalid JSON output. stdout: ${stdout}\nstderr: ${stderr}`));
    });
  });
}

module.exports = { runCli, runCliCaptureRaw, extractOwnTinyId, CLI };

// ─── 原始 MCP 响应捕获（身份直取用）───
// CLI 的 get-user-info 展示层丢弃 msgUserInfo.uint64MemberTinyid（本人 tiny_id），
// 但底层 MCP 网关原始响应包含完整字段（feed_links.py 同款代理手法，已验证可捕获）。
// 通过本地代理转发 CLI 请求并捕获原始响应 → 无需成员搜索即可拿到本人 tiny_id，
// 彻底规避同名成员歧义（如频道内几十个 "." 昵称）。

// QQ MCP 网关地址（CLI 默认目标）
const MCP_TARGET = 'https://graph.qq.com/mcp_gateway/open_platform_agent_mcp/mcp';

/**
 * 运行 CLI 并捕获原始 MCP 响应。
 * @returns {Promise<{stdout: string, captured: string[], error: Error|null}>}
 * captured 为代理转发的每个原始响应文本（含 CLI 展示层丢弃的字段）。
 */
function runCliCaptureRaw(args, timeoutMs = 60000, env) {
  return new Promise((resolve, reject) => {
    const captured = [];
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        const headers = {};
        for (const [k, v] of Object.entries(req.headers)) {
          if (['host', 'content-length', 'connection', 'accept-encoding'].includes(k)) continue;
          headers[k] = v;
        }
        const preq = https.request(MCP_TARGET, { method: 'POST', headers }, (pres) => {
          const rchunks = [];
          pres.on('data', (c) => rchunks.push(c));
          pres.on('end', () => {
            const rbody = Buffer.concat(rchunks);
            captured.push(rbody.toString('utf8'));
            res.writeHead(pres.statusCode || 200, {
              'Content-Type': 'application/json',
              'Content-Length': rbody.length,
            });
            res.end(rbody);
          });
        });
        preq.on('error', () => {
          res.writeHead(502, { 'Content-Length': '0' });
          res.end();
        });
        preq.write(body);
        preq.end();
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const runEnv = {
        ...process.env,
        ...(env || {}),
        QQ_AI_CONNECT_MCP_URL: `http://127.0.0.1:${port}/mcp`,
      };
      execFile(CLI, [...args, '--json'], { timeout: timeoutMs, env: runEnv }, (error, stdout) => {
        try { server.close(); } catch (_) { /* 已关闭 */ }
        resolve({ stdout: stdout || '', captured, error });
      });
    });
  });
}

/**
 * 从原始 MCP 响应中提取本人 tiny_id（get-user-info 场景）。
 * 字段 uint64MemberTinyid 即当前会话（token）所属账号的 tiny_id，无同名歧义。
 */
function extractOwnTinyId(captured) {
  for (const text of captured || []) {
    try {
      const data = JSON.parse(text);
      const sc = data && data.result && data.result.structuredContent;
      if (sc && sc.msgUserInfo && sc.msgUserInfo.uint64MemberTinyid) {
        return String(sc.msgUserInfo.uint64MemberTinyid);
      }
    } catch (_) { /* 非 JSON 跳过 */ }
    const m = text.match(/"uint64MemberTinyid"\s*:\s*"(\d+)"/);
    if (m) return m[1];
  }
  return '';
}
