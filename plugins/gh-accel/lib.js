// gh-accel v2.0.0 lib — 合并版下载加速核心（GitHub + 通用，规则驱动，纯 Node 内置模块）
// 导出: runDownload / runProbe / runClone / runPush / setupGlobal /
//       DEFAULT_RULES / GIT_REWRITE_KEY / clampInt
// 规则: { match: <正则>, style: 'prefix'|'host', mirrors: [base...] }
//   prefix: 新URL = base + 原URL   （gh 代理类）
//   host:   把原URL 的 origin 换成 base （npm/huggingface 镜像类）
// 无规则命中 → 直连 + 多线程分段加速（若支持 Range）

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';

export const UA = 'gh-accel/2.0.0 (+https://github.com)';

// 内置默认规则（自定义规则排在前面，优先命中）
export const DEFAULT_RULES = [
  {
    match: 'github\\.com/|githubusercontent\\.com/|codeload\\.github\\.com/',
    style: 'prefix',
    mirrors: [
      'https://ghfast.top/',
      'https://github.geekery.cn/',
      'https://down.mxw.xx.kg/',
      'https://gh.monlor.com/',
      'https://js.jiangss.shop/',
      'https://github.mxw.qzz.io/',
      'https://gh.acmsz.top/',
      'https://ghproxy.felicity.land/',
      'https://gh-proxy.com/',
      'https://ghproxy.net/',
    ],
  },
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
];

export const GIT_REWRITE_KEY = 'url.https://ghfast.top/https://github.com/.insteadOf';

const MIN_DIRECT_OK = 200 * 1024;  // 直连持续带宽高于此值则直连更快
const MIN_MIRROR_OK = 40 * 1024;   // 镜像持续带宽低于此值则放弃该镜像
const PROBE_BUDGET_MS = 3500;      // 每个探测最多 3.5 秒
const PROBE_MAX = 512 * 1024;      // 每个探测最多读 512KB
const SEGMENT_MIN = 4 * 1024 * 1024; // 小于此值不切片
const CONNECT_TIMEOUT = 12_000;

// ── 下载优先策略（prefer）───────────────────────────────────────────────
// 'mirror'：镜像优先 —— 只要任一镜像测速达标就用镜像，直连仅作兜底（门槛很高）。
//           国内访问 GitHub 慢、镜像普遍可达时最合适；对镜像按历史速度排序后
//           逐个测、命中即用（early-exit），不再 10 个镜像全量并行测速。
// 'smart'：公平比较（默认，v2.8.0 调阈值）—— 直连与镜像用**同一把尺子**
//           （≥40KB/s 即参与比较），**谁快选谁**。旧版直连门槛 120KB/s、镜像
//           门槛 150KB/s 不对称：对直连放水、对镜像严苛，导致「镜像其实更快但
//           没到 150 门槛」的边界情况被直连抢走。现统一为只挡死路（<40KB/s）。
// 'direct'：直连优先（老行为）—— 直连 200 KB/s 门槛，镜像仅 40 KB/s 兜底。
const PREFER_PRESETS = {
  mirror: { mirrorMin: MIN_MIRROR_OK, directMin: 800 * 1024, probeMs: 5000, maxProbes: 4, earlyExit: true },
  smart:  { mirrorMin: MIN_MIRROR_OK, directMin: MIN_MIRROR_OK, probeMs: 5000, maxProbes: 6, earlyExit: false },
  direct: { mirrorMin: MIN_MIRROR_OK, directMin: MIN_DIRECT_OK, probeMs: 3500, maxProbes: 10, earlyExit: false },
};

// 镜像历史测速缓存：进程内记住每个镜像最近一次的实测带宽，用于下次排序预热
// （快的镜像排前面先测；mirror 档命中即用）。5 分钟过期，避免陈旧数据误导。
const mirrorSpeedCache = new Map(); // normBase(mirror) -> { bps, at }
const MIRROR_CACHE_TTL_MS = 5 * 60_000;

export function clampInt(v, lo, hi) {
  const n = Number.isFinite(v) ? Math.floor(v) : lo;
  return Math.max(lo, Math.min(hi, n));
}

/** 归一化 prefer 参数，非法值回退 smart（保持向后兼容）。 */
export function normalizePrefer(v) {
  return v === 'mirror' || v === 'smart' || v === 'direct' ? v : 'smart';
}

/** 记住某个镜像的实测带宽（供下次排序预热）。 */
function rememberMirrorSpeed(base, bps) {
  if (!base || base === 'direct' || !Number.isFinite(bps) || bps <= 0) return;
  try { mirrorSpeedCache.set(normBase(base), { bps, at: Date.now() }); } catch { /* no-op */ }
}

/** 按历史速度把镜像从快到慢排序；无缓存记录的新镜像按原顺序排在缓存之后。 */
function sortMirrorsByHistory(mirrors) {
  const now = Date.now();
  return [...mirrors].sort((a, b) => {
    const ca = mirrorSpeedCache.get(normBase(a));
    const cb = mirrorSpeedCache.get(normBase(b));
    const va = ca && now - ca.at < MIRROR_CACHE_TTL_MS ? ca.bps : 0;
    const vb = cb && now - cb.at < MIRROR_CACHE_TTL_MS ? cb.bps : 0;
    return vb - va;
  });
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

// 归一化镜像 base，便于比较（去尾部斜杠、统一小写 host）
function normBase(base) {
  try {
    const u = new URL(String(base));
    return (u.protocol + '//' + u.host + u.pathname).replace(/\/+$/, '');
  } catch {
    return String(base || '').replace(/\/+$/, '');
  }
}

// 推断显式 mirror 的改写样式：
//   1) 命中任一规则 mirrors 列表里的镜像 → 沿用该规则的 style（npmmirror/hf-mirror 等 host 型由此识别）；
//   2) 否则回退 'prefix'（保持向后兼容：GitHub 代理类镜像历来按 prefix 拼接）。
// 注意：显式 mirror 早期被硬编码为 prefix，导致 host 型镜像（如 registry.npmmirror.com）
// 被拼成 "https://registry.npmmirror.comhttps://registry.npmjs.org/..." 这种非法主机名，
// 选不到合格候选后静默回退直连——镜像未生效却不报错。
export function inferMirrorStyle(url, base, rules) {
  const target = normBase(base);
  for (const r of rules || []) {
    if (!r || !Array.isArray(r.mirrors)) continue;
    for (const m of r.mirrors) {
      if (normBase(m) === target) return r.style === 'host' ? 'host' : 'prefix';
    }
  }
  return 'prefix';
}

export function matchRule(url, rules) {
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

export async function probe(url, { followRedirects = 1, signal, budgetMs = PROBE_BUDGET_MS, maxBytes = PROBE_MAX } = {}) {
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
        if (Date.now() - t0 >= budgetMs || len >= maxBytes) {
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

/**
 * 选路核心：按 prefer 策略在「直连 + 镜像」之间挑最快的可用路线。
 *
 * - direct 档：老行为，直连 200 KB/s 门槛优先。
 * - smart 档：直连降到 120 KB/s、镜像提到 150 KB/s，测速 5s（大文件更准）。
 * - mirror 档：镜像优先，按历史速度排序后逐个测、命中即用（early-exit），
 *   直连门槛 800 KB/s 只作强兜底（镜像全挂才轮到它）。
 *
 * 返回 { u, via, speed, size, rangeOk }；完全无合格候选时回退直连。
 */
async function pick(url, { rule, directOnly = false, signal, prefer = 'smart', fileSizeHint = null } = {}) {
  const presets = PREFER_PRESETS[prefer] || PREFER_PRESETS.smart;
  // 测速预算：小文件（<5MB，或未知大小）用短预算快速决策；大文件用长预算测准。
  const isSmall = fileSizeHint != null && fileSizeHint > 0 && fileSizeHint < SEGMENT_MIN;
  const budgetMs = isSmall ? 2500 : presets.probeMs;

  // 直连候选
  const direct = { u: url, via: 'direct', follow: 0, min: presets.directMin };

  // 镜像候选（mirror 档先按历史速度排序）
  let mirrorCands = [];
  if (!directOnly && rule) {
    const mirrors = prefer === 'mirror' ? sortMirrorsByHistory(rule.mirrors) : rule.mirrors;
    mirrorCands = mirrors
      .slice(0, presets.maxProbes) // 并行探针减负：最多测前 N 个
      .map((m) => ({ u: rewriteFor(url, m, rule.style), via: m, follow: 1, min: presets.mirrorMin }));
  }

  // mirror 档：逐个测、命中即用（early-exit），不并行
  if (prefer === 'mirror' && mirrorCands.length) {
    for (const c of mirrorCands) {
      const r = await probe(c.u, { followRedirects: c.follow, signal, budgetMs });
      if (r.bps >= c.min) {
        rememberMirrorSpeed(c.via, r.bps);
        return { u: c.u, via: c.via, speed: r.bps, size: r.size, rangeOk: r.rangeOk };
      }
      rememberMirrorSpeed(c.via, r.bps); // 低于门槛也记，供下次排序参考
    }
    // 所有镜像都低于门槛：直连门槛较高（800KB/s），此处直接回退直连探测
    const dr = await probe(direct.u, { followRedirects: 0, signal, budgetMs });
    if (dr.bps >= direct.min) return { u: direct.u, via: 'direct', speed: dr.bps, size: dr.size, rangeOk: dr.rangeOk };
    // 直连也不达标：仍选镜像中最快的（好过没有），并保留直连作为最终兜底
    return { u: mirrorCands[0].u, via: mirrorCands[0].via, speed: 0, size: null, rangeOk: false };
  }

  // smart / direct 档：并行测速，取达标中带宽最高者
  const cands = [direct, ...mirrorCands];
  const results = await Promise.allSettled(cands.map((c) => probe(c.u, { followRedirects: c.follow, signal, budgetMs })));
  let best = null;
  cands.forEach((c, i) => {
    const r = results[i].status === 'fulfilled' ? results[i].value : { bps: 0, size: null, rangeOk: false };
    if (r.bps >= c.min && (!best || r.bps > best.bps)) {
      best = { u: c.u, via: c.via, speed: r.bps, size: r.size, rangeOk: r.rangeOk };
    }
    if (c.via !== 'direct') rememberMirrorSpeed(c.via, r.bps);
  });
  if (best) return best;
  // 无合格候选：回退直连（保持老行为），若连直连都失败由上层报错
  return { u: url, via: 'direct(fallback)', speed: 0, size: null, rangeOk: false };
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// 字节统计 Transform：每流过 chunk 就回调累计已下载字节（用于实时速度/进度）
function countingStream(onBytes) {
  return new Transform({
    transform(chunk, _enc, cb) {
      try { onBytes(chunk.length); } catch { /* 上报失败不影响下载 */ }
      cb(null, chunk);
    },
  });
}

async function downloadRange(url, start, end, dest, { retries = 2, signal, onBytes }) {
  for (let i = 0; i <= retries; i++) {
    try {
      const headers = end == null ? {} : { Range: `bytes=${start}-${end}` };
      const { status, stream } = await httpGet(url, { headers, followRedirects: 5, signal });
      if (status !== 200 && status !== 206) {
        stream.resume();
        throw new Error(`HTTP ${status}`);
      }
      // 无进度回调时保持原行为（纯管线直写）
      if (typeof onBytes !== 'function') {
        await pipeline(stream, fs.createWriteStream(dest));
        return true;
      }
      await pipeline(stream, countingStream(onBytes), fs.createWriteStream(dest));
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
  mirror = null,        // 显式指定镜像 base，跳过规则全表
  mirrorStyle = null,   // 可选：显式指定 mirror 的改写样式 'prefix' | 'host'；缺省按已知规则自动识别
  prefer = 'smart',     // 下载优先策略：'mirror' | 'smart' | 'direct'
  signal,
  onProgress,           // 可选：进度上报回调 ({ doneB, totalB, kbPerSec })
} = {}) {
  const t0 = Date.now();
  const pref = normalizePrefer(prefer);
  // 已下载字节累计（多线程分片并发时各分片 onBytes 并发回调，用闭包共享计数）
  let done = 0;
  let lastEmit = 0;
  const reportProgress = (total) => {
    if (typeof onProgress !== 'function') return;
    const now = Date.now();
    // 节流：至少 200ms 上报一次，让胶囊进度/速度更顺滑（200ms 仍远低于下载压力）
    if (now - lastEmit < 200 && done < total) return;
    lastEmit = now;
    const elapsed = Math.max(now - t0, 1) / 1000;
    const kbPerSec = Math.round(done / Math.max(elapsed, 0.01) / 1024);
    onProgress({ doneB: done, totalB: total, kbPerSec });
  };
  const sumBytes = (n) => { done += n; };
  const rule = mirror
    ? {
        style: mirrorStyle === 'host' || mirrorStyle === 'prefix'
          ? mirrorStyle
          : inferMirrorStyle(url, mirror, rules),
        mirrors: [mirror],
      }
    : matchRule(url, rules);

  // 先探测拿 size（供选路判断小文件、以及分片决策）；选路用同一轮探测结果避免重复请求
  const picked = await pick(url, { rule, directOnly: !rule, signal, prefer: pref });
  let size = picked.size;
  if (!size) size = await getSize(picked.u, signal);

  // 周期性进度上报：下载进行中每 400ms 发一次实时速度/进度
  // （onBytes 只累计字节，不触发上报；靠这个 interval 定时把 done 送给前端）
  const reporter = typeof onProgress === 'function'
    ? setInterval(() => { if (size) reportProgress(size); }, 200)
    : null;
  const stopReporter = () => { if (reporter) clearInterval(reporter); };

  // 候选下载路线（按「镜像历史速度从快到慢」排列，供失败降级）
  // mirror 档 pick 已经 early-exit，但下载中途失败仍要按速度降级到下一个镜像。
  const candidates = (() => {
    if (mirror) return [rewriteFor(url, mirror, rule.style)];
    if (!rule) return [picked.u];
    const mirrorUrls = sortMirrorsByHistory(rule.mirrors).map((m) => rewriteFor(url, m, rule.style));
    const directFirst = pref === 'direct' ? [url] : [];
    // 已选中路线放最前（首试），其余镜像按历史速度降序，直连兜底放最后
    return [...directFirst, picked.u, ...mirrorUrls.filter((x) => x !== picked.u), ...(pref !== 'direct' ? [url] : [])];
  })();

  if (!size || size <= SEGMENT_MIN || !picked.rangeOk) {
    let lastErr = null;
    for (const t of candidates) {
      try {
        // downloadRange 失败返回 false（不抛错），必须显式检查——否则会"假成功"
        const okDl = await downloadRange(t, 0, size ? size - 1 : null, out, { retries: 1, signal, onBytes: sumBytes });
        if (!okDl) {
          lastErr = new Error(`下载失败: ${t}`);
          continue;
        }
        // 下载完成：上报 100%（进度收尾）
        stopReporter();
        const fin = fs.existsSync(out) ? fs.statSync(out).size : done;
        if (typeof onProgress === 'function') onProgress({ doneB: fin, totalB: size || fin, kbPerSec: 0 });
        return summarize(out, t === url ? 'direct' : t, size, t0, rule);
      } catch (e) {
        lastErr = e;
      }
    }
    stopReporter();
    throw lastErr || new Error('download failed');
  }

  const seg = Math.max(1, Math.floor(size / threads));
  const ranges = [];
  for (let s = 0; s < size; s += seg) ranges.push([s, Math.min(s + seg - 1, size - 1)]);
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ghaccel-'));
  const parts = ranges.map((_, i) => path.join(tmp, `seg-${i}`));
  let okFlags = await mapLimit(ranges, threads, (r, i) =>
    downloadRange(picked.u, r[0], r[1], parts[i], { signal, onBytes: sumBytes }));

  // 失败降级：分片有失败时，把整个任务切到「下一个候选镜像」重试一次。
  // （部分镜像对 Range 多线程支持不完整，换路线常能恢复。）
  if (okFlags.some((f) => !f)) {
    const next = candidates.find((x) => x !== picked.u);
    if (next) {
      await fsp.rm(tmp, { recursive: true, force: true });
      const tmp2 = await fsp.mkdtemp(path.join(os.tmpdir(), 'ghaccel-'));
      const parts2 = ranges.map((_, i) => path.join(tmp2, `seg-${i}`));
      okFlags = await mapLimit(ranges, threads, (r, i) =>
        downloadRange(next, r[0], r[1], parts2[i], { signal, onBytes: sumBytes }));
      if (okFlags.some((f) => !f)) {
        stopReporter();
        await fsp.rm(tmp2, { recursive: true, force: true });
        throw new Error('部分分片下载失败（含降级后重试）');
      }
      // 合并降级路线产物
      await fsp.rm(tmp, { recursive: true, force: true });
      try {
        await pipeline(
          (async function* merge() {
            for (const p of parts2) yield* fs.createReadStream(p);
          })(),
          fs.createWriteStream(out),
        );
      } finally {
        await fsp.rm(tmp2, { recursive: true, force: true });
      }
      const got = (await fsp.stat(out)).size;
      if (size && got !== size) throw new Error(`大小不一致: 预期 ${size} 实际 ${got}`);
      stopReporter();
      if (typeof onProgress === 'function') onProgress({ doneB: size, totalB: size, kbPerSec: 0 });
      return summarize(out, next === url ? 'direct' : next, size, t0, rule);
    }
    stopReporter();
    await fsp.rm(tmp, { recursive: true, force: true });
    throw new Error('部分分片下载失败');
  }
  // 分片下载阶段已完成（done ≈ size），进合并前上报 100%
  stopReporter();
  if (typeof onProgress === 'function') onProgress({ doneB: size, totalB: size, kbPerSec: 0 });
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
  // 真实性兜底：文件必须真实存在且非空，否则按失败处理（杜绝"假成功"）
  let bytes = 0;
  try {
    bytes = fs.statSync(out).size;
  } catch {
    throw new Error('下载未产生文件（源不可达或返回空），已中止');
  }
  if (bytes <= 0) throw new Error('下载文件为空，已中止');
  return {
    ok: true,
    path: out,
    bytes,
    seconds: Math.round(seconds * 10) / 10,
    kbPerSec: Math.round(bytes / Math.max(seconds, 0.01) / 1024),
    via: viaUrl,
    // 用 mirror 参数显式指定镜像时，rule 是构造的 { style, mirrors }、没有 match 字段，
    // 直接写 rule.match 会得到 undefined —— 而工具 output.schema 声明本字段为 string，
    // DSH 的 lossless JSON 校验会因该键在序列化中丢失而判定整个下载结果无效。
    ruleMatched: (rule && rule.match) || '',
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
export async function runProbe(url, { rules = DEFAULT_RULES, signal, prefer = 'smart' } = {}) {
  const pref = normalizePrefer(prefer);
  const rule = matchRule(url, rules);
  const mirrorCands = rule
    ? sortMirrorsByHistory(rule.mirrors).map((m) => ({ u: rewriteFor(url, m, rule.style), via: m, follow: 1 }))
    : [];
  const cands = [{ u: url, via: 'direct', follow: 0 }, ...mirrorCands];
  const results = await Promise.allSettled(cands.map((c) => probe(c.u, { followRedirects: c.follow, signal, budgetMs: 3500 })));
  const routes = cands.map((c, i) => {
    const r = results[i].status === 'fulfilled' ? results[i].value : { bps: 0, size: null, rangeOk: false };
    if (c.via !== 'direct') rememberMirrorSpeed(c.via, r.bps);
    return { via: c.via, kbPerSec: Math.round(r.bps / 1024), rangeOk: r.rangeOk };
  });
  // 策略建议：根据实测数据给出当前 prefer 档下的最优选择
  const best = [...routes].sort((a, b) => b.kbPerSec - a.kbPerSec)[0] || { via: 'direct', kbPerSec: 0 };
  const p = PREFER_PRESETS[pref];
  const mirrorRoutes = routes.filter((r) => r.via !== 'direct');
  const fastMirror = mirrorRoutes.find((r) => r.kbPerSec * 1024 >= p.mirrorMin);
  let suggestion;
  if (fastMirror) suggestion = `建议 prefer=${pref === 'mirror' ? 'mirror（已在用）' : 'mirror'}：镜像 ${fastMirror.via} 达 ${fastMirror.kbPerSec} KB/s`;
  else if (best.via === 'direct' && best.kbPerSec * 1024 >= p.directMin) suggestion = `建议 prefer=direct：直连 ${best.kbPerSec} KB/s 已达标`;
  else if (mirrorRoutes.length && best.kbPerSec > 0) suggestion = `建议保持 ${pref}：最快路线 ${best.via} ${best.kbPerSec} KB/s（未达镜像门槛，可考虑 direct）`;
  else suggestion = `建议 prefer=mirror：当前网络直连/镜像均慢，镜像优先更稳`;
  return { url, ruleMatched: rule ? rule.match : '', routes, prefer: pref, suggestion };
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

export async function runClone(url, { dest, depth = true, rules = DEFAULT_RULES, signal } = {}) {
  const rule = matchRule(url, rules) || {};
  const picked = await pick(url, { rule: rule.style ? rule : null, directOnly: !rule.style, signal });
  const dir = dest || url.replace(/\.git$/, '').split('/').pop() || 'repo';
  const args = ['clone'];
  if (depth) args.push('--depth', '1');
  args.push(picked.u, dir);
  const out = await run('git', args);
  // 修复: 克隆完成后把 origin 设回原始地址——
  //   fetch/pull 依赖全局 insteadOf 自动改写走加速镜像；
  //   push 依赖 github_accel_push（临时摘除改写直推真实 GitHub）。
  //   （git remote -v 显示改写后的镜像前缀属正常显示行为，存储值仍为原始地址）
  await run('git', ['remote', 'set-url', 'origin', url], dir).catch(() => {});
  // 避免 "dubious ownership"：把克隆目录加入全局 safe.directory（尽力而为）
  await run('git', ['config', '--global', '--add', 'safe.directory', path.resolve(dir)]).catch(() => {});
  return { ok: true, dir, url, repoUrl: url, mirror: picked.u, output: out.trim() };
}

export async function runPush({ dir, remote = 'origin', branch, signal } = {}) {
  const unset = () => run('git', ['config', '--global', '--unset-all', GIT_REWRITE_KEY]).catch(() => {});
  const set = () => run('git', ['config', '--global', '--add', GIT_REWRITE_KEY, 'https://github.com/']).catch(() => {});
  await unset();
  let output = '';
  let failed = false;
  try {
    if (dir) await run('git', ['config', '--global', '--add', 'safe.directory', path.resolve(dir)]).catch(() => {});
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

export async function setupGlobal({
  gitRewrite = true,
  pipMirror = 'https://pypi.tuna.tsinghua.edu.cn/simple',
  hfMirror = 'https://hf-mirror.com',
  npmMirror = 'https://registry.npmmirror.com',
} = {}) {
  const applied = [];
  try {
    if (gitRewrite) {
      // 先彻底清除旧条目再写一条：早期版本用 --add 且每次启动都执行，
      // 会让 insteadOf 在 ~/.gitconfig 里重复累积（功能不受影响，但不干净）。
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

    // HuggingFace：huggingface_hub 通过 HF_ENDPOINT 环境变量选择镜像端点。
    // 关键：本环境的 bash 工具是 DSH 进程的子进程，且 `bash -c` 不读任何 rc 文件，
    // 所以写 ~/.bashrc 之类对 `huggingface-cli` 无效——必须直接写进本进程 process.env，
    // 之后由 DSH 派生的命令才能继承到。
    if (hfMirror) {
      process.env.HF_ENDPOINT = hfMirror;
      applied.push('HF_ENDPOINT(进程内)');
    }

    // npm：写用户级 ~/.npmrc，对 npm / pnpm / npx 均生效。
    if (npmMirror) {
      const npmrc = path.join(home, '.npmrc');
      let existing = '';
      try { existing = await fsp.readFile(npmrc, 'utf8'); } catch { /* 不存在则新建 */ }
      const lines = existing.split('\n').filter((l) => l.trim() && !/^\s*registry\s*=/.test(l));
      lines.push(`registry=${npmMirror}`);
      await fsp.writeFile(npmrc, lines.join('\n') + '\n');
      applied.push('npmrc');
    }
  } catch (e) {
    console.error('[gh-accel] 全局配置未完成:', e.message);
  }
  return applied;
}