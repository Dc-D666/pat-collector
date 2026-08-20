'use strict';

// VirusTotal v3 API 恶意程序扫描（R3；2026-08-20 起为唯一扫描器——本地 ClamAV 需加载 ~600MB 签名库，
// 2GB 小服务器内存吃紧已移除，VT 云查杀零本地内存）：
// 流程：sha256 哈希查询命中直接判 → 未收录且 ≤32MB 才上传 → 分析中/异常/额度耗尽一律放行（fail-open）。
// 免费档：4 次/分、500 次/天；429（额度耗尽）→ 进程内熔断 12h 自动降级放行。
// 隐私提示：上传文件会发送给 VirusTotal（Google 系第三方）；学生代码类作品如介意可关 VIRUSTOTAL_ENABLED=0。
const config = require('../config');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const BASE = 'https://www.virustotal.com/api/v3';
const MAX_UPLOAD = 32 * 1024 * 1024; // 免费档上传上限 32MB
const QUOTA_COOLDOWN_MS = 12 * 3600 * 1000; // 额度耗尽后 12 小时内不再调 VT
const REQ_TIMEOUT_MS = 12000; // 单次 VT 请求超时（防 VT 不可达时上传挂起；超时按 pass 放行）

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
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQ_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(BASE + pathName, {
      ...options,
      signal: ctrl.signal,
      headers: { 'x-apikey': config.virustotal.apiKey, ...((options && options.headers) || {}) },
    });
  } catch (e) {
    return { error: 'VT 请求失败: ' + (e.message || 'timeout') }; // 超时/网络错误 → 上层按 pass 放行
  } finally {
    clearTimeout(timer);
  }
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
 *  clean=VT 明确安全；infected=检出；pass=无结论（未收录/分析未完成/错误，放行）；skip=未启用/额度熔断
 */
async function scanWithVirusTotal(filePath) {
  if (!config.virustotal.apiKey) return { status: 'skip', reason: '未配置 VIRUSTOTAL_API_KEY' };
  // P2 修复（2026-08-21）：原判断 `Date.now() < quotaExhaustedAt` 恒为假（quotaExhaustedAt 是过去时间戳），
  // 12h 熔断从未生效；改为"已熔断且距 429 未满冷却期"才跳过，避免 429 后仍持续打 VT 浪费配额/被限流。
  if (quotaExhaustedAt && Date.now() - quotaExhaustedAt < QUOTA_COOLDOWN_MS) {
    return { status: 'skip', reason: '额度熔断中（12h 内放行）' };
  }
  try {
    // 1. 哈希查询（最快，命中即判）
    const hash = await sha256File(filePath);
    const look = await vtRequest('/files/' + hash);
    if (look.quota) return { status: 'skip', reason: '429 额度耗尽，熔断 12h' };
    if (look.notFound) {
      // 未收录 → 仅 ≤32MB 才上传（大文件/未收录样本直接放行）
      const size = (await fs.promises.stat(filePath)).size;
      if (size > MAX_UPLOAD) return { status: 'pass', reason: '>32MB 不上传 VT' };
      const fd = new FormData();
      fd.append('file', new Blob([await fs.promises.readFile(filePath)]), path.basename(filePath));
      const up = await vtRequest('/files', { method: 'POST', body: fd });
      if (up.quota) return { status: 'skip', reason: '429 额度耗尽，熔断 12h' };
      if (up.error) return { status: 'pass', reason: up.error };
      const v = verdictOf(up.data && up.data.data && up.data.data.attributes);
      if (v && v.malicious > 0) return { status: 'infected', virus: v.virus };
      return { status: 'pass', reason: '新样本分析未完成，暂放行' }; // 上传成功但分析异步
    }
    if (look.error) return { status: 'pass', reason: look.error };
    const v = verdictOf(look.data && look.data.data && look.data.data.attributes);
    if (v && v.malicious > 0) return { status: 'infected', virus: v.virus };
    if (v) return { status: 'clean' };
    return { status: 'pass', reason: '无分析结果' };
  } catch (e) {
    return { status: 'pass', reason: '异常: ' + e.message }; // 任何异常不阻断（fail-open 放行）
  }
}

module.exports = { scanWithVirusTotal, verdictOf, sha256File };
