/**
 * dsh-jack-market — host half.
 *
 * A lightweight "market" for the plugins published in the GitHub repo
 * Jack-kd/dsh-plugins (a monorepo; each plugin is distributed as a
 * `<name>-plugin.tgz` release asset under `releases/download/v<ver>/`).
 *
 * It exposes three HTTP routes on the host webServer and lets the client
 * render a settings page:
 *
 *   GET  /dsh-jack-market/plugins        → list of plugins (latest per plug)
 *   GET  /dsh-jack-market/installed      → names currently installed in profile
 *   POST /dsh-jack-market/install        → run `dsh plugin add <url>`
 */

import { spawn } from 'node:child_process';

const OWNER = 'Jack-kd';
const REPO = 'dsh-plugins';
const REPO_URL = `https://github.com/${OWNER}/${REPO}`;
const API_RELEASES = `https://api.github.com/repos/${OWNER}/${REPO}/releases`;
/**
 * Releases are fetched page by page. A single `?per_page=100` request used to
 * be enough, but this repo is a monorepo whose plugins each cut a release per
 * version: once the total passes 100 entries, the oldest plugins silently
 * disappear from the market (they still have a `plugins/<key>/` directory, so
 * they show up as "未发布包" / not installable). Paginating removes that cliff.
 *
 * Pages are capped so a runaway repo can't turn one market load into dozens of
 * anonymous API calls (the 60 req/hour limit is shared with the dir listing).
 * 5 pages = 500 releases; well beyond the current ~60.
 */
const RELEASES_PER_PAGE = 100;
const RELEASES_MAX_PAGES = 5;
const API_PLUGINS_DIR = `https://api.github.com/repos/${OWNER}/${REPO}/contents/plugins`;

/**
 * Plugins that have been folded into another plugin and need no separate
 * install. Key = the superseded plugin's market key, value = the plugin whose
 * functionality absorbed it (the one users should install instead). The client
 * renders these as "已并入 <mergedInto>，无需单独安装" instead of "未安装".
 *
 * NOTE: a superseded key only shows up in the market if its directory still
 * exists under plugins/. dl-accel 目录早已移除，市场不会再列出它，因此这里
 * 保留空表以记录该机制（将来有真实并入时再填）。
 */
const SUPERSEDED_BY = {
  // 'dl-accel': 'gh-accel',
};

/** Extract a semantic version from a release tag. Accepts both the legacy
 * bare tags (`v2.5.1`) and the new prefixed per-plugin tags
 * (`<plugin>-v2.5.1`, e.g. `our-free-model-v2.5.1`). Returns just the
 * version (e.g. `2.5.1`), or '' when it can't be parsed. */
function versionFromTag(tag) {
  const m = /(?:^|-|v)v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.exec(String(tag || '').trim());
  return m ? m[1] : '';
}

/** In-memory TTL cache for GitHub API responses. The market is read from a
 * browser settings page, which can refresh frequently; GitHub's anonymous
 * rate limit is only 60 requests/hour, and each market load costs 2 calls
 * (dir listing + releases). Caching for 60 s keeps us comfortably under the
 * limit while still refreshing quickly enough to notice new releases. */
const apiCache = new Map();
const API_CACHE_TTL_MS = 60_000;
async function cachedGhJson(url, controller) {
  const cached = apiCache.get(url);
  const now = Date.now();
  if (cached && now - cached.at < API_CACHE_TTL_MS) return cached.value;
  const value = await ghJson(url, controller);
  apiCache.set(url, { at: now, value });
  return value;
}

function resolveProfileName(ctx, config) {
  if (config && typeof config.profile === 'string' && config.profile.trim() !== '')
    return config.profile.trim();
  const profileContext = ctx && ctx.get ? ctx.get('profileContext') : undefined;
  if (profileContext && typeof profileContext.name === 'string' && profileContext.name.trim() !== '')
    return profileContext.name.trim();
  const argv = process.argv;
  const flag = argv.indexOf('--profile');
  if (flag !== -1 && flag + 1 < argv.length && !argv[flag + 1].startsWith('-'))
    return argv[flag + 1];
  return 'web';
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        request.destroy(new Error('body too large'));
        return;
      }
      chunks.push(c);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (error) { reject(error); }
    });
    request.on('error', reject);
  });
}

async function ghJson(url, controller) {
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'dsh-jack-market' },
    signal: controller.signal,
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} ${response.statusText}`);
  return response.json();
}

/** Fetch every release, page by page, until a short page is returned or the
 * cap is hit. Returns a flat array. Mirrors GitHub's Link-free contract: a page
 * with fewer than RELEASES_PER_PAGE entries means we've reached the end. */
async function fetchAllReleases(controller) {
  const all = [];
  for (let page = 1; page <= RELEASES_MAX_PAGES; page++) {
    const batch = await cachedGhJson(
      `${API_RELEASES}?per_page=${RELEASES_PER_PAGE}&page=${page}`,
      controller,
    );
    const list = Array.isArray(batch) ? batch : [];
    all.push(...list);
    if (list.length < RELEASES_PER_PAGE) break;
  }
  return all;
}

async function fetchPlugins() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    // Preferred source of truth: the plugins/<key> directories in the repo,
    // which reflect only the currently-shipped plugins (README install quick
    // list). Directories whose name also matches a published `<key>-plugin.tgz`
    // release asset yield an installable card; directory-only plugins (patch
    // not yet released) are shown but marked not-installable.
    const [dirEntries, releases] = await Promise.all([
      cachedGhJson(API_PLUGINS_DIR, controller),
      fetchAllReleases(controller),
    ]);
    const dirKeys = new Set(
      (Array.isArray(dirEntries) ? dirEntries : [])
        .filter((e) => e && e.type === 'dir' && /^[A-Za-z0-9._-]+$/.test(e.name))
        .map((e) => e.name),
    );

    // Map key -> latest release info from every `<key>-plugin.tgz` asset.
    const byKey = new Map();
    for (const release of Array.isArray(releases) ? releases : []) {
      for (const asset of release.assets || []) {
        const match = /^([A-Za-z0-9._-]+?)-plugin\.tgz$/.exec(asset.name);
        if (!match || typeof release.published_at !== 'string') continue;
        const key = match[1];
        if (!dirKeys.has(key)) continue; // only keep currently-shipped plugins
        const existing = byKey.get(key);
        if (existing && existing.publishedAt && release.published_at &&
            existing.publishedAt >= release.published_at) continue;
        byKey.set(key, {
          key,
          name: asset.name,
          version: versionFromTag(release.tag_name),
          tag: release.tag_name,
          url: asset.browser_download_url,
          note: typeof release.body === 'string' ? release.body : '',
          publishedAt: release.published_at,
          supersededBy: SUPERSEDED_BY[key] || null,
        });
      }
    }

    // Directory-only plugins (in repo but not yet released as a tgz) stay
    // visible so the user knows they exist, but cannot be installed here yet.
    for (const key of dirKeys) {
      if (byKey.has(key)) continue;
      byKey.set(key, {
        key,
        name: '',
        version: '',
        tag: '',
        url: '',
        note: '此插件已在仓库中，但尚未发布可安装的 release 包；请在仓库查看安装说明。',
        publishedAt: '',
        supersededBy: SUPERSEDED_BY[key] || null,
        installable: false,
      });
    }

    return [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  } finally {
    clearTimeout(timer);
  }
}

async function handleList(request, response) {
  if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); response.end(); return; }
  try {
    const plugins = await fetchPlugins();
    sendJson(response, 200, { repo: REPO_URL, plugins, now: new Date().toISOString() });
  } catch (error) {
    sendJson(response, 502, { error: String((error && error.message) || error) });
  }
}

async function handleInstalled(request, response, profileDir) {
  if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); response.end(); return; }
  let result = [];
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const candidates = [profileDir, path.join(process.env.DSH_HOME || '/root/.dsh', 'profiles', 'web')].filter(Boolean);
    for (const dir of candidates) {
      const file = path.join(dir, 'package.json');
      if (fs.existsSync(file)) {
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        const deps = manifest && manifest.dependencies && typeof manifest.dependencies === 'object'
          ? manifest.dependencies
          : {};
        const names = Object.keys(deps);
        // Resolve the actually-installed version from node_modules/<name>/package.json
        const nodeModules = path.join(dir, 'node_modules');
        const readVersion = (name) => {
          try {
            const pkgFile = path.join(nodeModules, ...name.split('/'), 'package.json');
            if (fs.existsSync(pkgFile)) {
              const v = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).version;
              return typeof v === 'string' ? v : '';
            }
          } catch { /* no-op */ }
          return '';
        };
        result = names.map((name) => ({ name, version: readVersion(name) }));
        break;
      }
    }
  } catch {
    result = [];
  }
  sendJson(response, 200, { installed: result });
}

// ── 安装任务进度跟踪 ────────────────────────────────────────────────────
// host 端把每次「dsh plugin add」子进程的 stdout/stderr 采集起来，按关键词
// 归类成阶段（下载/校验/安装/完成/失败），供客户端轮询显示实时进度。
// key: 插件市场 key；只保留最近一个任务（同一插件重复安装覆盖旧状态）。
const installTasks = new Map(); // key -> { stage, message, at, running }

// ── 审计日志（诊断「安装卡住」等隐蔽问题）──────────────────────────────
// 无论用户是否点「记录」都持续写入（环形 2000 条）；客户端「导出日志」
// 时取回全部。每条带单调时间戳与相对起始时间的毫秒数，用于还原时间线。
const auditLog = [];
const AUDIT_MAX = 2000;
let auditStart = Date.now();
function audit(category, detail) {
  const now = Date.now();
  auditLog.push({
    t: new Date(now).toISOString().slice(11, 23),   // HH:MM:SS.mmm
    ms: now - auditStart,                            // 距首次记录 ms
    c: category,
    d: typeof detail === 'string' ? detail.slice(0, 500) : JSON.stringify(detail),
  });
  if (auditLog.length > AUDIT_MAX) auditLog.splice(0, auditLog.length - AUDIT_MAX);
}
function auditLogText() {
  return auditLog.map((e) => `[${e.t} +${e.ms}ms] ${e.c}: ${e.d}`).join('\n');
}

/**
 * 下载 GitHub release 资产到本地稳定路径——带「加速器式」多节点选路。
 * 返回 { dest, bytes, via }；全部节点失败抛错。
 *
 * 关键（2026-10-18 审计日志实证）：本机直连 `github.com/releases/download`
 * 会超时（retry-count 9KB 都 30s 下不完），而加速镜像（ghfast.top 等）稳定。
 * 因此移植 gh-accel 的选路逻辑：并行测速直连 + 全部镜像，选最快节点下载；
 * 选中的节点失败时自动降级到下一个最快节点，不再只死磕直连。
 *
 * 另一关键：市场安装必须「下载到本地 → `pnpm add file:<稳定路径>`」而不是
 * `pnpm add <url>`（pnpm 对 URL tarball 在网络慢/CI 下不写 integrity 必失败）；
 * 稳定路径（profile/.dsh-market/pkgs/）不能删——pnpm 的 file: 引用长期指向它。
 */

// 加速镜像列表（复用 gh-accel 实测可用节点；prefix 拼接）
const GH_MIRRORS = [
  'https://ghfast.top/',
  'https://gh.monlor.com/',
  'https://down.mxw.xx.kg/',
  'https://github.geekery.cn/',
  'https://js.jiangss.shop/',
  'https://github.mxw.qzz.io/',
  'https://gh.acmsz.top/',
  'https://ghproxy.net/',
  'https://gh-proxy.com/',
];

/** prefix 改写：镜像 base 拼在原 URL 前（gh 代理类）。 */
function rewriteViaMirror(url, base) {
  try {
    const u = new URL(url);
    if (!/^https?:\/\//i.test(base)) return url;
    const b = new URL(base);
    // prefix 代理格式：镜像 base（**保留尾斜杠**）+ 完整原 URL
    // 例：https://ghfast.top/ + https://github.com/a/b → https://ghfast.top/https://github.com/a/b
    // （v0.6.3 曾误删尾斜杠，拼成 ghfast.tophttps://... 域名解析失败 ENOTFOUND）
    return b.toString() + u.toString();
  } catch {
    return base + url;
  }
}

/** 单节点测速：3 秒预算内读前 256KB，算持续带宽 bps（gh-accel probe 同款）。 */
async function probeNode(url, { signal, budgetMs = 3000, maxBytes = 256 * 1024 } = {}) {
  const https = await import('node:https');
  const http = await import('node:http');
  const mod = url.startsWith('https:') ? https : http;
  const t0 = Date.now();
  return new Promise((resolveP) => {
    let len = 0;
    let settled = false;
    let req;
    try {
      req = mod.get(url, {
        headers: { 'user-agent': 'dsh-jack-market', accept: '*/*', range: 'bytes=0-1048575' },
        signal,
      }, (res) => {
        const status = res.statusCode || 0;
        const loc = res.headers.location;
        if (status >= 300 && status < 400 && loc) {
          res.resume();
          // 跟随一次重定向后重试（避免递归过深）
          probeNode(new URL(loc, url).toString(), { signal, budgetMs, maxBytes })
            .then((r) => { if (!settled) { settled = true; resolveP(r); } }, () => { if (!settled) { settled = true; resolveP({ bps: 0, ok: false }); } });
          return;
        }
        if (status !== 200 && status !== 206) {
          res.resume();
          if (!settled) { settled = true; resolveP({ bps: 0, ok: false }); }
          return;
        }
        res.on('data', (c) => {
          if (Date.now() - t0 >= budgetMs || len >= maxBytes) {
            if (!settled) { settled = true; res.destroy(); resolveP({ bps: Math.max(len / Math.max((Date.now() - t0) / 1000, 0.01), 1), ok: len > 0 }); }
            return;
          }
          len += c.length;
        });
        res.on('end', () => { if (!settled) { settled = true; resolveP({ bps: Math.max(len / Math.max((Date.now() - t0) / 1000, 0.01), 1), ok: len > 0 }); } });
        res.on('error', () => { if (!settled) { settled = true; resolveP({ bps: 0, ok: false }); } });
      });
      req.on('error', () => { if (!settled) { settled = true; resolveP({ bps: 0, ok: false }); } });
      req.setTimeout(5000, () => req.destroy(new Error('probe timeout')));
    } catch {
      if (!settled) { settled = true; resolveP({ bps: 0, ok: false }); }
    }
  });
}

/** 选路：并行测速直连 + 全部镜像，按带宽降序返回候选 URL 列表（含直连兜底）。 */
async function pickFastest(url, { signal } = {}) {
  const cands = [
    { u: url, via: 'direct' },
    ...GH_MIRRORS.map((m) => ({ u: rewriteViaMirror(url, m), via: m })),
  ];
  const results = await Promise.allSettled(cands.map((c) => probeNode(c.u, { signal })));
  const ranked = cands
    .map((c, i) => ({ u: c.u, via: c.via, bps: results[i].status === 'fulfilled' ? results[i].value.bps : 0 }))
    .sort((a, b) => b.bps - a.bps);
  // 直连恒在最后兜底（镜像都失败时用原 URL）
  const direct = ranked.find((r) => r.via === 'direct');
  const mirrors = ranked.filter((r) => r.via !== 'direct' && r.bps > 0);
  const order = [...mirrors, direct ? { ...direct, via: 'direct(fallback)' } : null].filter(Boolean);
  return order.length ? order : [{ u: url, via: 'direct', bps: 0 }];
}

/** 从单个 URL 下载到 dest（失败抛错；onProgress 字节回调）。 */
async function downloadFrom(url, dest, { signal, onProgress } = {}) {
  const https = await import('node:https');
  const http = await import('node:http');
  const fs = await import('node:fs');
  const mod = url.startsWith('https:') ? https : http;
  let bytes = 0;
  let lastEmit = 0;
  await new Promise((resolveP, rejectP) => {
    const run = (u, redirects) => {
      const req = mod.get(u, { headers: { 'user-agent': 'dsh-jack-market', accept: '*/*' }, signal }, (res) => {
        const status = res.statusCode || 0;
        const loc = res.headers.location;
        if (status >= 300 && status < 400 && loc && redirects > 0) {
          res.resume();
          run(new URL(loc, u).toString(), redirects - 1);
          return;
        }
        if (status !== 200) {
          res.resume();
          rejectP(new Error(`HTTP ${status}`));
          return;
        }
        const ws = fs.createWriteStream(dest);
        res.on('data', (c) => {
          bytes += c.length;
          if (typeof onProgress === 'function') {
            const now = Date.now();
            if (now - lastEmit >= 300) { lastEmit = now; onProgress(bytes); }
          }
        });
        res.pipe(ws);
        ws.on('finish', () => resolveP());
        ws.on('error', rejectP);
        res.on('error', rejectP);
      });
      req.on('error', rejectP);
      req.setTimeout(30_000, () => req.destroy(new Error(`下载超时: ${u}`)));
    };
    run(url, 5);
  });
  return bytes;
}

/** 总入口：按序尝试全部节点（直连 + 全部镜像，probe 只排序不过滤），成功即停。 */
async function downloadTgz(url, { dest, signal, onProgress } = {}) {
  const fsp = await import('node:fs/promises');
  await fsp.mkdir((await import('node:path')).dirname(dest), { recursive: true });
  // probe 测速排序（镜像快→慢，直连最后兜底）；**不因 bps=0 过滤节点**——
  // 镜像 probe 可能因 Range 不支持/首字慢而测为 0，但实际下载可用
  // （2026-10-18 实测：直连 probe 4.7KB/s 排第一但下载 redirect 后 socket hang up，
  //  镜像 probe 可能低但下载 0.6s 成功——所以全部节点都要试）。
  const ranked = await pickFastest(url, { signal });
  // pickFastest 已把 bps=0 的镜像过滤了 → 这里强制补回全部镜像
  const seen = new Set(ranked.map((r) => r.via));
  const direct = ranked.find((r) => r.via === 'direct' || r.via === 'direct(fallback)');
  const mirrorCands = GH_MIRRORS
    .map((m) => ({ u: rewriteViaMirror(url, m), via: m, bps: 0 }))
    .filter((m) => !seen.has(m.via));
  const order = [...ranked.filter((r) => r.via !== 'direct' && r.via !== 'direct(fallback)'), ...mirrorCands, direct || { u: url, via: 'direct', bps: 0 }];
  let lastErr = null;
  for (const cand of order) {
    audit('download.try', `${cand.via} bps=${Math.round(cand.bps)}`);
    try {
      const t0 = Date.now();
      const bytes = await downloadFrom(cand.u, dest, { signal, onProgress });
      // 下载完成但文件可能是坏的/空的 → 校验非空
      const size = (await fsp.stat(dest)).size;
      if (size <= 0) throw new Error('下载文件为空');
      audit('download.done', `via=${cand.via} bytes=${size} 耗时=${Date.now() - t0}ms`);
      return { dest, bytes, via: cand.via };
    } catch (e) {
      lastErr = e;
      audit('download.nodeFail', `${cand.via} err=${(e && e.message) || e}`);
      await fsp.rm(dest, { force: true }).catch(() => {});
    }
  }
  throw lastErr || new Error('下载失败: 所有节点不可达');
}

/**
 * 安装前快照 profile 的 package.json 与 pnpm-lock.yaml（内存字符串）。
 * 官方 dsh-plugin-manager 同款策略：pnpm 失败会污染 lockfile（URL tarball
 * 条目缺 integrity 或残留坏条目），失败后 restore() 恢复快照，再用
 * `pnpm install --frozen-lockfile` 按原 lockfile 重装，洗掉污染条目，
 * 保证后续安装永远干净可重试。
 */
async function snapshotProfileFiles(profileDir) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const files = ['package.json', 'pnpm-lock.yaml'];
  const saved = {};
  for (const name of files) {
    const file = path.join(profileDir, name);
    if (fs.existsSync(file)) saved[name] = fs.readFileSync(file, 'utf8');
  }
  return saved;
}

async function restoreProfileFiles(profileDir, saved) {
  const fs = await import('node:fs');
  const fsp = await import('node:fs/promises');
  const path = await import('node:path');
  for (const [name, text] of Object.entries(saved)) {
    const file = path.join(profileDir, name);
    if (text === undefined) continue;
    try { await fsp.writeFile(file, text, { mode: 0o600 }); } catch { /* no-op */ }
  }
}

/** 按恢复后的 lockfile 重装 node_modules（官方同款 repair 步骤）。 */
async function repairProfile(profileDir, env) {
  const path = await import('node:path');
  const fs = await import('node:fs');
  const hadLockfile = fs.existsSync(path.join(profileDir, 'pnpm-lock.yaml'));
  const args = ['install', hadLockfile ? '--frozen-lockfile' : '--config.lockfile=false'];
  return new Promise((resolveP) => {
    const child = spawn('pnpm', args, { cwd: profileDir, stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '';
    child.stdout && child.stdout.on('data', (d) => { out += d; });
    child.stderr && child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolveP({ code, out }));
    child.on('error', (e) => resolveP({ code: -1, out: String((e && e.message) || e) }));
  });
}

/** 从 pnpm 输出归类失败类型（官方 install-failure.js 的简化版）。 */
function classifyFailure(log) {
  const t = String(log || '');
  if (/ERR_PNPM_TARBALL_INTEGRITY|ERR_PNPM_BAD_TARBALL_SIZE|\bEINTEGRITY\b/i.test(t)) return 'integrity';
  if (/ERR_PNPM_IGNORED_BUILDS|Ignored build scripts/i.test(t)) return 'build-blocked';
  if (/ERR_PNPM_FETCH_404|\bE404\b|404 Not Found/i.test(t)) return 'not-found';
  if (/ERR_PNPM_NO_MATCHING_VERSION|\bETARGET\b|No matching version/i.test(t)) return 'no-matching-version';
  if (/\bENOSPC\b|no space left on device/i.test(t)) return 'disk-full';
  if (/\bEACCES\b|\bEPERM\b|permission denied/i.test(t)) return 'permission';
  if (/\bENOTFOUND\b|\bECONNRESET\b|\bETIMEDOUT\b|\bECONNREFUSED\b|\bEAI_AGAIN\b|ERR_PNPM_META_FETCH_FAIL|ERR_PNPM_FETCH_5\d\d|socket hang up|Could not resolve host/i.test(t)) return 'network';
  return 'unknown';
}

/** 从子进程输出行归类出阶段。无精确匹配时维持当前阶段；有失败关键词即标 failed。
 * 针对 dsh plugin add（内部是 pnpm）的实际输出做了适配：
 *   - 失败：ERR_PNPM_* / pnpm 的 WARN+ERR 组合 / 常见网络与校验错误；
 *   - 下载：pnpm 的 `Progress: resolved…, downloaded…` 行；
 *   - 校验：integrity / checksum / lockfile 校验相关；
 *   - 完成：`added N packages` 等 pnpm 成功标志。 */
function classifyStage(text, current) {
  const t = String(text || '').toLowerCase();
  const has = (...kws) => kws.some((k) => t.includes(k));
  // 失败优先（稳定）
  if (has('err_pnpm_', 'error:', 'failed', 'denied', 'refused', 'enetdown', 'econnrefused',
          'eacces', 'enoent', 'integrity check failed', 'checksum mismatch', 'tarball integrity',
          'missing_tarball', 'lockfile', 'cannot install', 'frozen-lockfile', '校验失败',
          'pnpm error', 'exit code'))
    return { stage: 'failed', message: text.trim().split('\n').filter(Boolean).slice(-6).join(' | ') };
  // pnpm 的 Progress 行（每行都带 resolved/reused/downloaded/added 计数）——
  // 一律归为「安装中」，不能当成完成（其中 `added N` 不是完成标志）。
  if (has('progress:')) return { stage: 'installing', message: '安装中…' };
  // 真正完成标志：`Done in` / `added N packages` / `Already up to date`
  if (has('done in', 'already up to date') || /added \d+ packages/.test(t))
    return { stage: 'done', message: '完成' };
  if (has('downloading', 'fetching', '下载') && current !== 'installing')
    return { stage: 'downloading', message: '下载中…' };
  if (has('verifying', 'integrity', 'checksum', '校验', 'sha256')) return { stage: 'verifying', message: '校验中…' };
  if (has('installing', 'adding', '安装', 'add ', 'extract', '解压', 'packages')) return { stage: 'installing', message: '安装中…' };
  if (has('added ', 'installed', 'complete', '完成', 'success')) return { stage: 'done', message: '完成' };
  return current || 'running';
}

function updateTask(key, patch) {
  const prev = installTasks.get(key) || { stage: 'running', message: '启动中…', at: Date.now(), running: true };
  const next = { ...prev, ...patch, at: Date.now() };
  installTasks.set(key, next);
}

/** GET /dsh-jack-market/task?key=<key> → 该插件当前安装任务进度（无任务返回 idle）。 */
async function handleTask(request, response) {
  if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); response.end(); return; }
  try {
    const url = new URL(request.url, 'http://localhost');
    const key = url.searchParams.get('key') || '';
    if (!key) { sendJson(response, 400, { error: 'missing key' }); return; }
    const task = installTasks.get(key);
    if (!task) { sendJson(response, 200, { key, stage: 'idle', message: '', running: false, at: 0 }); return; }
    sendJson(response, 200, { key, ...task });
  } catch (e) {
    sendJson(response, 500, { error: String((e && e.message) || e) });
  }
}

export const name = 'dsh-jack-market';
export const inject = ['webServer'];

export function apply(ctx, config) {
  ctx.inject(['webServer'], (host) => {
    const profileName = resolveProfileName(ctx, config);
    const profileCtx = typeof ctx.get === 'function' ? ctx.get('profileContext') : undefined;
    let profileDir = typeof profileCtx?.dir === 'string' && profileCtx.dir
      ? profileCtx.dir
      : undefined;
    if (!profileDir && profileName) {
      profileDir = [process.env.DSH_HOME || '/root/.dsh', 'profiles', profileName].join('/');
    }
    const disposers = [];

    disposers.push(host.webServer.register({
      kind: 'exact',
      path: '/dsh-jack-market/plugins',
      handler: handleList,
    }));
    disposers.push(host.webServer.register({
      kind: 'exact',
      path: '/dsh-jack-market/installed',
      handler: (req, res) => handleInstalled(req, res, profileDir),
    }));
    disposers.push(host.webServer.register({
      kind: 'exact',
      path: '/dsh-jack-market/task',
      handler: handleTask,
    }));
    // 审计日志导出：返回全部记录（text/plain，便于保存为文件诊断）
    disposers.push(host.webServer.register({
      kind: 'exact',
      path: '/dsh-jack-market/log',
      handler: (request, response) => {
        if (request.method !== 'GET') { response.writeHead(405, { allow: 'GET' }); response.end(); return; }
        try {
          const text = auditLogText();
          response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
          response.end(`# dsh-jack-market 审计日志\n# 共 ${auditLog.length} 条记录\n\n${text}\n`);
        } catch (e) {
          response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
          response.end(`导出失败: ${String((e && e.message) || e)}`);
        }
      },
    }));

    disposers.push(host.webServer.register({
      kind: 'exact',
      path: '/dsh-jack-market/install',
      handler: async (request, response) => {
        if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return; }
        const origin = request.headers.origin;
        if (origin !== undefined) {
          const hostHeader = (request.headers.host || '').replace(/[^A-Za-z0-9.:[\]]/g, '');
          try {
            const o = new URL(origin);
            const e = new URL(`http://${hostHeader}`);
            if (o.origin !== e.origin) {
              sendJson(response, 403, { error: '跨源请求已拒绝 / cross-origin request refused' });
              return;
            }
          } catch {
            sendJson(response, 403, { error: '无法校验请求来源 / cannot verify request origin' });
            return;
          }
        }
        let body;
        try { body = await readJsonBody(request); }
        catch { sendJson(response, 400, { error: 'invalid JSON body' }); return; }
        const url = typeof body?.url === 'string' ? body.url.trim() : '';
        const safeUrlPrefix = `https://github.com/${OWNER}/${REPO}/releases/download/`;
        if (!url.startsWith(safeUrlPrefix) || !/\.tgz$/i.test(url)) {
          sendJson(response, 400, { error: '只允许安装本仓库的 Release 插件包 / only this repo\'s release tarballs are accepted' });
          return;
        }
        const key = typeof body?.key === 'string' && body.key ? body.key : 'unknown';
        audit('install.request', `${key} url=${url}`);

        // ① 安装前快照 package.json + pnpm-lock.yaml（官方 dsh-plugin-manager 同款）
        // 失败后恢复快照，防止污染后续安装。
        const dir = profileDir || '/root/.dsh/profiles/web';
        let saved;
        try { saved = await snapshotProfileFiles(dir); } catch { saved = {}; }
        audit('install.snapshot', `dir=${dir} saved=${Object.keys(saved).join(',')}`);
        updateTask(key, { stage: 'downloading', message: '下载中…', running: true });
        sendJson(response, 202, { status: 'started', target: url, key });

        // ② 下载 tgz 到 profile 下的稳定路径（.dsh-market/pkgs/<key>-plugin.tgz）
        // 实测（2026-10-18）：pnpm 对 URL tarball 在网络慢/CI 下不写 integrity →
        // ERR_PNPM_MISSING_TARBALL_INTEGRITY 反复失败；file: 本地引用永远稳定。
        // 稳定路径不删除（pnpm 的 file: 引用长期指向它）。
        const pathMod = await import('node:path');
        const pkgsDir = pathMod.join(dir, '.dsh-market', 'pkgs');
        const localTgz = pathMod.join(pkgsDir, `${key}-plugin.tgz`);
        const tDlStart = Date.now();
        audit('download.start', `dest=${localTgz}`);
        try {
          await downloadTgz(url, {
            dest: localTgz,
            onProgress: (n) => {
              const cur = installTasks.get(key);
              if (cur && (cur.stage === 'downloading' || cur.stage === 'running')) {
                installTasks.set(key, { ...cur, stage: 'downloading', message: `下载中… ${(n / 1024).toFixed(0)} KB`, at: Date.now() });
              }
            },
          });
          audit('download.done', `${key} bytes=${(await import('node:fs')).statSync(localTgz).size} 耗时=${Date.now() - tDlStart}ms`);
        } catch (e) {
          audit('download.fail', `${key} err=${(e && e.message) || e} 耗时=${Date.now() - tDlStart}ms`);
          updateTask(key, { stage: 'failed', message: `下载失败: ${(e && e.message) || e}`, running: false });
          console.error('[dsh-jack-market] 下载失败:', e && e.message);
          return;
        }

        // ③ `pnpm add file:<稳定路径>` —— 稳定写 integrity、成功
        updateTask(key, { stage: 'installing', message: '安装中…', running: true });
        const tPnpmStart = Date.now();
        audit('pnpm.spawn', `cmd=pnpm add file:${localTgz} cwd=${dir}`);
        const child = spawn('pnpm', ['add', `file:${localTgz}`], {
          cwd: dir,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, CI: 'true' },
        });
        let out = '';
        let err = '';
        let lastClassify = 0;
        const classifyNow = (chunk, isErr) => {
          if (isErr) err += chunk; else out += chunk;
          const now = Date.now();
          // 节流：最多 300ms 更新一次任务状态，避免高频写 Map（失败行不节流，立即呈现）
          if (now - lastClassify < 300 && !/err_pnpm_|error:|\bfailed\b/i.test(String(chunk || ''))) return;
          lastClassify = now;
          const prevStage = installTasks.get(key)?.stage || 'running';
          const cls = classifyStage(`${out}\n${err}`, prevStage);
          const newStage = cls.stage;
          const stageMsg = cls.message;
          updateTask(key, {
            stage: newStage,
            message: newStage === 'failed'
              ? (String(stageMsg || '').trim() || '安装失败')
              : (installTasks.get(key)?.message || '进行中…'),
          });
          // 记录阶段变化（只记变化，不刷屏）
          if (newStage !== prevStage) audit('pnpm.stage', `${key} ${prevStage}→${newStage}`);
        };
        child.stdout && child.stdout.on('data', (d) => { audit('pnpm.out', String(d).slice(0, 300)); classifyNow(d, false); });
        child.stderr && child.stderr.on('data', (d) => { audit('pnpm.err', String(d).slice(0, 300)); classifyNow(d, true); });
        child.on('error', (e) => {
          console.error('[dsh-jack-market] spawn:', e && e.message);
          audit('pnpm.spawnFail', `${key} err=${(e && e.message) || 'unknown'}`);
          updateTask(key, { stage: 'failed', message: `启动失败: ${(e && e.message) || 'unknown'}`, running: false });
        });
        child.on('close', async (code) => {
          audit('pnpm.close', `${key} code=${code} 耗时=${Date.now() - tPnpmStart}ms`);
          console.log(`[dsh-jack-market] install exited ${code} for ${url}`);
          const prev = installTasks.get(key) || {};
          const fullLog = `${out}\n${err}`;
          const finalStage = classifyStage(fullLog, prev.stage || 'running');
          const failedNow = code !== 0 || prev.stage === 'failed' || finalStage.stage === 'failed';
          let message = '安装成功';
          if (failedNow) {
            const kind = classifyFailure(fullLog);
            const errTail = err.trim().slice(-400);
            message = kind !== 'unknown' ? `安装失败（${kind}）` : (errTail || `安装失败（退出码 ${code}，详见 pnpm 日志）`);
            if (errTail && message.length > 500) message = message.slice(0, 500);
            // ② 失败：恢复快照（洗掉 pnpm 写入的坏 lockfile 条目），再按原 lockfile 重装
            try {
              await restoreProfileFiles(dir, saved);
              const repaired = await repairProfile(dir, { ...process.env, CI: 'true' });
              console.log(`[dsh-jack-market] 已恢复 profile 快照, repair exit=${repaired.code}`);
            } catch (e) {
              console.error('[dsh-jack-market] 恢复快照失败:', e && e.message);
            }
          }
          updateTask(key, { stage: failedNow ? 'failed' : 'done', message, running: false });
          audit('install.final', `${key} ${failedNow ? 'failed' : 'done'} msg=${message.slice(0, 200)}`);
          // 任务已结束：保留 30 秒（让客户端能轮询到最终 done/failed 状态），
          // 之后清除避免 stale 残留。
          setTimeout(() => { if (installTasks.get(key)?.running === false) installTasks.delete(key); }, 30_000);
        });
      },
    }));

    const dispose = () => { for (const d of disposers) { try { d(); } catch {} } };
    return dispose;
  });
}
