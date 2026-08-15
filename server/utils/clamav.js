'use strict';

// ClamAV 恶意程序扫描（R3，2026-08-16）：
// 通过本地 clamd（TCP 3310）的 INSTREAM 协议流式扫描上传文件（含压缩包内容解压扫描）。
// 依赖：EPOL 源安装 `clamd` + `clamav-freshclam`，`systemctl enable --now clamd@scan`。
// 设计：扫描不可用/超时/异常 → 返回 available:false（调用方按 fail-open 放行，不阻断上传）。
const net = require('net');
const fs = require('fs');
const config = require('../config');

const CLAMD_HOST = '127.0.0.1';
const CLAMD_PORT = 3310;
const SCAN_TIMEOUT_MS = 20000;
const CHUNK = 64 * 1024;

function lenBuf(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

/**
 * 流式扫描文件（clamd INSTREAM 协议）
 * @param {string} filePath 磁盘文件路径
 * @returns {Promise<{available: boolean, clean: boolean, virus: string, error: string}>}
 *  available=false 表示 clamd 不可用（调用方放行）；clean=false 表示命中病毒（virus 为签名名）
 */
function scanFile(filePath) {
  return new Promise((resolve) => {
    let settled = false;
    let response = '';
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer = setTimeout(() => {
      try { sock.destroy(); } catch (_) { /* ignore */ }
      done({ available: true, clean: true, virus: '', error: 'scan timeout' });
    }, SCAN_TIMEOUT_MS);

    const sock = net.connect({ host: CLAMD_HOST, port: CLAMD_PORT });
    sock.on('connect', () => {
      sock.write('zINSTREAM\0');
      const rs = fs.createReadStream(filePath, { highWaterMark: CHUNK });
      rs.on('data', (chunk) => {
        if (!sock.write(Buffer.concat([lenBuf(chunk.length), chunk]))) {
          rs.pause();
          sock.once('drain', () => rs.resume());
        }
      });
      rs.on('end', () => {
        try { sock.write(Buffer.from([0, 0, 0, 0])); } catch (_) { /* ignore */ }
      });
      rs.on('error', () => {
        try { sock.destroy(); } catch (_) { /* ignore */ }
        done({ available: false, clean: true, virus: '', error: 'read error' });
      });
    });

    sock.on('data', (d) => { response += d.toString('utf8'); });
    sock.on('end', () => {
      const m = response.match(/stream:\s*([^\r\n]+)/);
      const status = (m && m[1] || response || '').trim();
      const virusMatch = response.match(/([A-Za-z0-9][A-Za-z0-9._-]*)\s+FOUND/i);
      done({
        available: true,
        clean: !/FOUND/i.test(status),
        virus: (virusMatch && virusMatch[1]) || '',
        error: '',
      });
    });
    sock.on('error', () => {
      done({ available: false, clean: true, virus: '', error: 'clamd 不可用' });
    });
  });
}

module.exports = { scanFile };
