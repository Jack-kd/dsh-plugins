// dl-accel lib — 通用 URL 下载加速核心（规则驱动，纯 Node 内置模块，可独立测试）
// 导出: runDownload / runProbe / DEFAULT_RULES / clampInt
// 规则: { match: <正则字符串>, style: 'prefix'|'host', mirrors: [<base url>, ...] }
//   prefix: 新URL = base + 原URL            （gh 代理类）
//   host:   把原URL的 origin 换成 base       （npm/huggingface 镜像类）
// 无规则命中 → 直连 + 多线程分段加速（若支持 Range）

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { pipeline } from 'node:stream/promises';

export const UA = 'dl-accel/1.0.0 (+https://github.com)';

// 内置默认规则（自定义规则会排在前面，优先命中）
// 注意: GitHub 直链走 gh-accel 插件专用路线，这里不设 GitHub 规则（见 url_accel_download 的分流校验）
export const DEFAULT_RULES = [
  {
    match: 'huggingface\\.co|hf\\.co',
    style: 'host',
    mirrors: ['https://hf-mirror.com'],
  },
  {
    match: 'registry\\.npmjs\\.org',
    style: 'host',
    mirrors: ['https://registry.npmmirror.com'],
  },
  // pypi 的 wheel 实际来自 files.pythonhosted.org（无稳定镜像），保持直连分段加速
];

const MIN_DIRECT_OK = 200 * 1024;  // 直连持续带宽高于此值则直连更快
const MIN_MIRROR_OK = 40 * 1024;   // 镜像持续带宽低于此值则放弃该镜像
const PROBE_BUDGET_MS = 3500;      // 每个探测最多 3.5 秒
const PROBE_MAX = 512 * 1024;      // 每个探测最多读 512KB
const SEGMENT_MIN = 4 * 1024 * 1024; // 小于此值不切片
const CONNECT_TIMEOUT = 12_000;

export function clampInt(v, lo, hi) {
  const n = Number.isFinite(v) ? Math.floor(v) : lo;
  return Math.max(lo, Math.min(hi, n));
}

function rewriteFor(url, base, style) {
  try {
    if (style === 'host') {
      const u = new URL(url);
      const b = new URL(base);
      u.protocol = b.protocol;
      u.host = b.host;
      u.port = b.port;
      return u.toString();
    }
    return base + url; // prefix
  } catch {
    return base + url;
  }
}

function matchRule(url, rules) {
  for (const r of rules || []) {
    if (!r || typeof r.match !== 'string' || !Array.isArray(r.mirrors) || !r.mirrors.length) continue;
    try {
      if (new RegExp(r.match).test(url)) return r;
    } catch { /* 非法正则跳过 */ }
  }
  return null;
}

function httpGet(url, { headers = {}, followRedirects = 5, signal, timeoutMs = CONNECT_TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    let req;
    try {
      req = mod.get(url, {
        headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
        signal,
      }, (res) => {
        const status = res.statusCode || 0;
        const loc = res.headers.location;
        if (followRedirects > 0 && status >= 300 && status < 400 && loc) {
          res.resume();
          httpGet(new URL(loc, url).toString(), { headers, followRedirects: followRedirects - 1, signal, timeoutMs })
            .then(resolve, reject);
          return;
        }
        resolve({ status, headers: res.headers, stream: res });
      });
    } catch (e) {
      reject(e);
      return;
    }
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`connect timeout: ${url}`)));
  });
}

export async function probe(url, { followRedirects = 1, signal } = {}) {
  const t0 = Date.now();
  try {
    const { status, headers, stream } = await httpGet(url, {
      headers: { Range: 'bytes=0-1048575' },
      followRedirects,
      signal,
    });
    if (status !== 200 && status !== 206) {
      stream.resume();
      return { bps: 0, size: null, rangeOk: status === 206 };
    }
    let size = null;
    const cr = headers['content-range'];
    if (cr && cr.includes('/')) size = Number(cr.split('/').pop());
    else if (status === 200) size = Number(headers['content-length'] || 0);
    let len = 0;
    let settled = false;
    await new Promise((resolve) => {
      stream.on('data', (c) => {
        if (Date.now() - t0 >= PROBE_BUDGET_MS || len >= PROBE_MAX) {
          if (!settled) { settled = true; stream.destroy(); resolve(); }
          return;
        }
        len += c.length;
      });
      stream.on('end', () => { if (!settled) { settled = true; resolve(); } });
      stream.on('error', () => { if (!settled) { settled = true; resolve(); } });
      stream.on('close', () => { if (!settled) { settled = true; resolve(); } });
    });
    if (len <= 0) return { bps: 0, size, rangeOk: status === 206 };
    const secs = Math.max((Date.now() - t0) / 1000, 0.01);
    return { bps: Math.max(len / secs, 1), size, rangeOk: status === 206 };
  } catch {
    return { bps: 0, size: null, rangeOk: false };
  }
}

async function pick(url, { rule, directOnly = false, signal } = {}) {
  const cands = [{ u: url, via: 'direct', follow: 0 }];
  if (!directOnly && rule) {
    for (const m of rule.mirrors) {
      cands.push({ u: rewriteFor(url, m, rule.style), via: m, follow: 1 });
    }
  }
  const results = await Promise.allSettled(cands.map((c) => probe(c.u, { followRedirects: c.follow, signal })));
  let best = null;
  cands.forEach((c, i) => {
    const r = results[i].status === 'fulfilled' ? results[i].value : { bps: 0, size: null, rangeOk: false };
    const okMin = c.via === 'direct' ? MIN_DIRECT_OK : MIN_MIRROR_OK;
    if (r.bps >= okMin && (!best || r.bps > best.bps)) {
      best = { u: c.u, via: c.via, speed: r.bps, size: r.size, rangeOk: r.rangeOk };
    }
  });
  return best || { u: url, via: 'direct(fallback)', speed: 0, size: null, rangeOk: false };
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadRange(url, start, end, dest, { retries = 2, signal }) {
  for (let i = 0; i <= retries; i++) {
    try {
      const headers = end == null ? {} : { Range: `bytes=${start}-${end}` };
      const { status, stream } = await httpGet(url, { headers, followRedirects: 5, signal });
      if (status !== 200 && status !== 206) {
        stream.resume();
        throw new Error(`HTTP ${status}`);
      }
      await pipeline(stream, fs.createWriteStream(dest));
      return true;
    } catch {
      if (i === retries) return false;
      await delay(1000 * (i + 1));
    }
  }
  return false;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function runDownload(url, {
  out,
  threads = 8,
  rules = DEFAULT_RULES,
  mirror = null,   // 显式指定镜像 base（含 https://），跳过规则与直连之外的所有
  signal,
} = {}) {
  const t0 = Date.now();
  const rule = matchRule(url, rules);
  const pickOpts = { rule };
  if (mirror) {
    // 显式镜像：按对应规则或假定 prefix 风格
    pickOpts.rule = { style: 'prefix', mirrors: [mirror] };
  }
  if (mirror && !rule) pickOpts.directOnly = true;
  const picked = await pick(url, pickOpts);
  let size = picked.size;
  if (!size) size = await getSize(picked.u, signal);

  if (!size || size <= SEGMENT_MIN || !picked.rangeOk) {
    let lastErr = null;
    for (const t of [picked.u, ...(rule ? rule.mirrors.map((m) => rewriteFor(url, m, rule.style)).filter((x) => x !== picked.u) : [])]) {
      try {
        await downloadRange(t, 0, size ? size - 1 : null, out, { retries: 1, signal });
        return summarize(out, picked.via, size, t0, rule);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('download failed');
  }

  const seg = Math.max(1, Math.floor(size / threads));
  const ranges = [];
  for (let s = 0; s < size; s += seg) ranges.push([s, Math.min(s + seg - 1, size - 1)]);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dlaccel-'));
  const parts = ranges.map((_, i) => path.join(tmp, `seg-${i}`));
  const okFlags = await mapLimit(ranges, threads, (r, i) =>
    downloadRange(picked.u, r[0], r[1], parts[i], { signal }));
  if (okFlags.some((f) => !f)) {
    await fsp.rm(tmp, { recursive: true, force: true });
    throw new Error('部分分片下载失败');
  }
  try {
    await pipeline(
      (async function* merge() {
        for (const p of parts) yield* fs.createReadStream(p);
      })(),
      fs.createWriteStream(out),
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
  const got = (await fsp.stat(out)).size;
  if (size && got !== size) throw new Error(`大小不一致: 预期 ${size} 实际 ${got}`);
  return summarize(out, picked.via, size, t0, rule);
}

function summarize(out, viaUrl, size, t0, rule) {
  const seconds = (Date.now() - t0) / 1000;
  const bytes = fs.existsSync(out) ? fs.statSync(out).size : 0;
  return {
    ok: true,
    path: out,
    bytes,
    seconds: Math.round(seconds * 10) / 10,
    kbPerSec: Math.round(bytes / Math.max(seconds, 0.01) / 1024),
    via: viaUrl,
    ruleMatched: rule ? rule.match : '',
  };
}

export async function getSize(url, signal) {
  try {
    const { status, headers, stream } = await httpGet(url, {
      headers: { Range: 'bytes=0-0' },
      followRedirects: 5,
      signal,
    });
    stream.resume();
    const cr = headers['content-range'];
    if (cr && cr.includes('/')) return Number(cr.split('/').pop());
    if (status === 200) return Number(headers['content-length'] || 0);
    return 0;
  } catch {
    return 0;
  }
}

// 诊断：返回命中的规则 + 各候选取路实测带宽（不下文件）
export async function runProbe(url, { rules = DEFAULT_RULES, signal } = {}) {
  const rule = matchRule(url, rules);
  const cands = [{ u: url, via: 'direct', follow: 0 }];
  if (rule) for (const m of rule.mirrors) cands.push({ u: rewriteFor(url, m, rule.style), via: m, follow: 1 });
  const results = await Promise.allSettled(cands.map((c) => probe(c.u, { followRedirects: c.follow, signal })));
  const routes = cands.map((c, i) => {
    const r = results[i].status === 'fulfilled' ? results[i].value : { bps: 0, size: null, rangeOk: false };
    return { via: c.via, kbPerSec: Math.round(r.bps / 1024), rangeOk: r.rangeOk };
  });
  return { url, ruleMatched: rule ? rule.match : '', routes };
}