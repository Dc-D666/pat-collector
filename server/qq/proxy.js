'use strict';

const { execFile } = require('child_process');
const fs = require('fs');
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

module.exports = { runCli, CLI };
