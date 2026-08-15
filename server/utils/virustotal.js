'use strict';

// VirusTotal v3 API 恶意程序扫描（R3 补充，2026-08-16）：
// 与 ClamAV 双扫描——先 ClamAV（本地、必扫），再 VT（哈希查询命中直接判、未收录则上传 ≤32MB）。
// 免费档：4 次/分、500 次/天；429（额度耗尽）→ 进程内熔断 12h 自动降级为只跑 ClamAV。
// 隐私提示：上传文件会发送给 VirusTotal（Google 系第三方）；学生代码类作品如介意可关 VIRUSTOTAL_ENABLED=0。
const config = require('../config');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.virustotal.com/api/v3';
const MAX_UPLOAD = 32 * 1024 * 1024; // 免费档上传上限 32MB
const QUOTA_COOLDOWN_MS = 12 * 3600 * 1000; // 额度耗尽后 12 小时内不再调 VT

let quotaExhaustedAt = 0;

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const rs = fs.createReadStream(filePath);
    rs.on('data', (c) => h.update(c));
    rs.on('end', () => resolve(h.digest('hex')));
    rs.on('error', reject);
  });
}

async function vtRequest(pathName, options) {
  const res = await fetch(BASE + pathName, {
    ...options,
    headers: { 'x-apikey': config.virustotal.apiKey, ...((options && options.headers) || {}) },
  });
  if (res.status === 429) {
    quotaExhaustedAt = Date.now();
    return { quota: true };
  }
  if (res.status === 404) return { notFound: true };
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { error: 'VT HTTP ' + res.status + ' ' + body.slice(0, 120) };
  }
  return { data: await res.json() };
}

function verdictOf(attrs) {
  if (!attrs || !attrs.last_analysis_stats) return null;
  const s = attrs.last_analysis_stats;
  const malicious = Number(s.malicious || 0) + Number(s.suspicious || 0);
  if (malicious <= 0) return { malicious: 0 };
  let name = '';
  try {
    const results = attrs.last_analysis_results || {};
    for (const eng of Object.values(results)) {
      if (eng && (eng.category === 'malicious' || eng.category === 'suspicious') && eng.result) {
        name = String(eng.result).slice(0, 80);
        break;
      }
    }
  } catch (_) { /* ignore */ }
  return { malicious, virus: name || 'VirusTotal 检出恶意' };
}

/**
 * 用 VirusTotal 扫描文件
 * @returns {Promise<{status:'clean'|'infected'|'pass'|'skip', virus?:string, reason?:string}>}
 *  clean=VT 明确安全；infected=检出；pass=无结论（未收录/分析未完成/错误，交给 ClamAV）；skip=未启用/额度熔断
 */
async function scanWithVirusTotal(filePath) {
  if (!config.virustotal.apiKey) return { status: 'skip', reason: '未配置 VIRUSTOTAL_API_KEY' };
  if (Date.now() < quotaExhaustedAt) return { status: 'skip', reason: '额度熔断中（只跑 ClamAV）' };
  try {
    // 1. 哈希查询（最快，命中即判）
    const hash = await sha256File(filePath);
    const look = await vtRequest('/files/' + hash);
    if (look.quota) return { status: 'skip', reason: '429 额度耗尽，熔断 12h' };
    if (look.notFound) {
      // 未收录 → 仅 ≤32MB 才上传（大文件交给 ClamAV）
      const size = (await fs.promises.stat(filePath)).size;
      if (size > MAX_UPLOAD) return { status: 'pass', reason: '>32MB 不上传 VT' };
      const fd = new FormData();
      fd.append('file', new Blob([await fs.promises.readFile(filePath)]), path.basename(filePath));
      const up = await vtRequest('/files', { method: 'POST', body: fd });
      if (up.quota) return { status: 'skip', reason: '429 额度耗尽，熔断 12h' };
      if (up.error) return { status: 'pass', reason: up.error };
      const v = verdictOf(up.data && up.data.data && up.data.data.attributes);
      if (v && v.malicious > 0) return { status: 'infected', virus: v.virus };
      return { status: 'pass', reason: '新样本分析未完成，ClamAV 兜底' }; // 上传成功但分析异步
    }
    if (look.error) return { status: 'pass', reason: look.error };
    const v = verdictOf(look.data && look.data.data && look.data.data.attributes);
    if (v && v.malicious > 0) return { status: 'infected', virus: v.virus };
    if (v) return { status: 'clean' };
    return { status: 'pass', reason: '无分析结果' };
  } catch (e) {
    return { status: 'pass', reason: '异常: ' + e.message }; // 任何异常不阻断（ClamAV 兜底）
  }
}

module.exports = { scanWithVirusTotal, verdictOf, sha256File };
