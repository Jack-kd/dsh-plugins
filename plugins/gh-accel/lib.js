// gh-accel lib — GitHub 加速下载核心逻辑（纯 Node 内置模块，可独立测试）
// 导出: runDownload / runClone / runPush / rewrite / DEFAULT_MIRRORS

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';

export const UA = 'gh-accel/1.0 (+https://github.com)';
export const DEFAULT_MIRRORS = [
  'https://ghfast.top/',
  'https://gh-proxy.com/',
  'https://ghproxy.net/',
];
export const GIT_REWRITE_KEY = 'url.https://ghfast.top/https://github.com/.insteadOf';

const MIN_DIRECT_OK = 60 * 1024;   // 直连持续带宽低于此值则放弃
const MIN_MIRROR_OK = 20 * 1024;   // 镜像持续带宽低于此值则放弃
const PROBE_BUDGET_MS = 4000;      // 每个探测最多 4 秒
const PROBE_MAX = 1024 * 1024;     // 每个探测最多读 1MB
const SEGMENT_MIN = 2 * 1024 * 1024; // 小于此值不切片
const CONNECT_TIMEOUT = 15_000;

export function clampInt(v, lo, hi) {
  const n = Number.isFinite(v) ? Math.floor(v) : lo;
  return Math.max(lo, Math.min(hi, n));
}

export function rewrite(url, mirror) {
  if (url.startsWith(mirror)) return url;
  for (const pre of [
    'https://github.com/',
    'https://raw.githubusercontent.com/',
    'https://codeload.github.com/',
    'https://objects.githubusercontent.com/',
  ]) {
    if (url.startsWith(pre)) return mirror + url;
  }
  return url;
}

function httpGet(url, { headers = {}, followRedirects = 5, signal, timeoutMs = CONNECT_TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    let req;
    const mod = url.startsWith('https:') ? https : http;
    try {
      req = mod.get(url, {
        headers: { 'User-Agent': UA, Accept: '*/*', ...headers },
        signal,
      }, (res) => {
        const status = res.statusCode || 0;
        const loc = res.headers.location;
        if (followRedirects > 0 && status >= 300 && status < 400 && loc) {
          res.resume();
          const next = new URL(loc, url).toString();
          httpGet(next, { headers, followRedirects: followRedirects - 1, signal, timeoutMs }).then(resolve, reject);
          return;
        }
        resolve({ status, headers: res.headers, stream: res, finalUrl: url });
      });
    } catch (e) {
      reject(e);
      return;
    }
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`connect timeout: ${url}`)));
  });
}

export async function probe(url, { followRedirects = 1, budgetMs = PROBE_BUDGET_MS, signal } = {}) {
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
        if (Date.now() - t0 >= budgetMs || len >= PROBE_MAX) {
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

export async function pick(url, { mirrors = DEFAULT_MIRRORS, forceMirror = false, signal } = {}) {
  const cands = forceMirror ? [] : [{ u: url, via: 'direct', follow: 0 }];
  for (const m of mirrors) cands.push({ u: rewrite(url, m), via: m, follow: 1 });
  const results = await Promise.allSettled(cands.map((c) => probe(c.u, { followRedirects: c.follow, signal })));
  let best = null;
  cands.forEach((c, i) => {
    const r = results[i].status === 'fulfilled' ? results[i].value : { bps: 0, size: null, rangeOk: false };
    const okMin = c.via === 'direct' ? MIN_DIRECT_OK : MIN_MIRROR_OK;
    if (r.bps >= okMin && (!best || r.bps > best.bps)) {
      best = { u: c.u, via: c.via, speed: r.bps, size: r.size, rangeOk: r.rangeOk };
    }
  });
  return best
    ? best
    : { u: url, via: 'direct(fallback)', speed: 0, size: null, rangeOk: false };
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

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadRange(url, start, end, dest, { retries = 2, signal }) {
  for (let i = 0; i <= retries; i++) {
    try {
      const headers = end == null ? {} : { Range: `bytes=${start}-${end}` };
      const { status, stream } = await httpGet(url, {
        headers,
        followRedirects: 5,
        signal,
      });
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
  forceMirror = false,
  mirrors = DEFAULT_MIRRORS,
  signal,
} = {}) {
  const t0 = Date.now();
  const picked = await pick(url, { mirrors, forceMirror, signal });
  let size = picked.size;
  if (!size) size = await getSize(picked.u, signal);

  if (!size || size <= SEGMENT_MIN || !picked.rangeOk) {
    // 小文件 / 未知大小 / 不支持 Range → 单流，失败后轮换镜像
    let lastErr = null;
    const targets = [picked.u, ...mirrors.filter((m) => rewrite(url, m) !== picked.u).map((m) => rewrite(url, m))];
    for (const t of targets) {
      try {
        await downloadRange(t, 0, size ? size - 1 : undefined, out, { retries: 1, signal });
        return summarize(out, t, size, t0, picked.via);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('download failed');
  }

  // 分段并发
  const seg = Math.max(1, Math.floor(size / threads));
  const ranges = [];
  for (let s = 0; s < size; s += seg) ranges.push([s, Math.min(s + seg - 1, size - 1)]);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ghaccel-'));
  const parts = ranges.map((_, i) => path.join(tmp, `seg-${i}`));
  const okFlags = await mapLimit(ranges, threads, (r, i) =>
    downloadRange(picked.u, r[0], r[1], parts[i], { signal }));
  if (okFlags.some((f) => !f)) {
    await fsp.rm(tmp, { recursive: true, force: true });
    throw new Error('部分分片下载失败');
  }
  const ws = fs.createWriteStream(out);
  try {
    await pipeline(
      (async function* merge() {
        for (const p of parts) {
          yield* fs.createReadStream(p);
        }
      })(),
      ws,
    );
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
  const got = (await fsp.stat(out)).size;
  if (size && got !== size) throw new Error(`大小不一致: 预期 ${size} 实际 ${got}`);
  return summarize(out, picked.u, size, t0, picked.via);
}

function summarize(out, viaUrl, size, t0, via) {
  const seconds = (Date.now() - t0) / 1000;
  const bytes = fs.existsSync(out) ? fs.statSync(out).size : 0;
  return {
    ok: true,
    path: out,
    bytes,
    seconds: Math.round(seconds * 10) / 10,
    kbPerSec: Math.round(bytes / Math.max(seconds, 0.01) / 1024),
    via,
  };
}

/* ---------------- git 相关 ---------------- */

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim().split('\n').slice(-8).join('\n')));
      else resolve(stdout);
    });
  });
}

export async function runClone(url, { dest, depth = true, mirrors = DEFAULT_MIRRORS, signal } = {}) {
  const picked = await pick(url, { mirrors, forceMirror: true, signal });
  const dir = dest || url.replace(/\.git$/, '').split('/').pop() || 'repo';
  const args = ['clone'];
  if (depth) args.push('--depth', '1');
  args.push(picked.u, dir);
  const out = await run('git', args);
  return { ok: true, dir, url: picked.u, repoUrl: url, output: out.trim() };
}

export async function runPush({ dir, remote = 'origin', branch, signal } = {}) {
  const unset = () => run('git', ['config', '--global', '--unset-all', GIT_REWRITE_KEY]).catch(() => {});
  const set = () => run('git', ['config', '--global', '--add', GIT_REWRITE_KEY, 'https://github.com/']).catch(() => {});
  await unset();
  let output = '';
  let failed = false;
  try {
    const args = ['push', remote];
    if (branch) args.push(branch);
    output = (await run('git', args, dir)).trim();
  } catch (e) {
    failed = true;
    output = e.message;
  } finally {
    await set();
  }
  return { ok: !failed, output, rewriteRestored: true };
}

export async function setupGlobal({ gitRewrite = true, pipMirror = 'https://pypi.tuna.tsinghua.edu.cn/simple' } = {}) {
  const applied = [];
  try {
    if (gitRewrite) {
      await run('git', ['config', '--global', '--unset-all', GIT_REWRITE_KEY]).catch(() => {});
      await run('git', ['config', '--global', '--add', GIT_REWRITE_KEY, 'https://github.com/']);
      applied.push('git insteadOf');
    }
    const home = os.homedir();
    const dir = path.join(home, '.config', 'pip');
    await fsp.mkdir(dir, { recursive: true });
    let host;
    try { host = new URL(pipMirror).hostname; } catch { host = pipMirror; }
    await fsp.writeFile(path.join(dir, 'pip.conf'),
      `[global]\nindex-url = ${pipMirror}\ntrusted-host = ${host}\ntimeout = 60\n`);
    applied.push('pip.conf');
  } catch (e) {
    console.error('[gh-accel] 全局配置未完成:', e.message);
  }
  return applied;
}