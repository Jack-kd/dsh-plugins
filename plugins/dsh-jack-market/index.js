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
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';

const OWNER = 'Jack-kd';
const REPO = 'dsh-plugins';
const REPO_URL = `https://github.com/${OWNER}/${REPO}`;
const API_RELEASES = `https://api.github.com/repos/${OWNER}/${REPO}/releases?per_page=100`;
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

function nodeExecutable() {
  const argv0 = process.argv0;
  if (typeof argv0 === 'string' && argv0 !== '' && isAbsolute(argv0) && existsSync(argv0))
    return argv0;
  return process.execPath;
}

function dshArgv() {
  const entry = process.argv[1];
  if (entry !== undefined && /[\\/](?:bin\.(?:js|ts)|dsh)$/.test(entry)) {
    const abs = resolve(entry);
    return { file: nodeExecutable(), args: [...process.execArgv, abs], cwd: dirname(abs) };
  }
  return { file: 'dsh', args: [], cwd: undefined };
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
      cachedGhJson(API_RELEASES, controller),
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
  if (has('err_pnpm_', 'error:', 'failed', 'denied', 'refused', 'enetdown', 'econnrefused',
          'eacces', 'enoent', 'integrity check failed', 'checksum mismatch', 'tarball integrity',
          'missing_tarball', 'lockfile', 'cannot install', 'frozen-lockfile', '校验失败',
          'pnpm error', 'exit code'))
    return { stage: 'failed', message: text.trim().split('\n').filter(Boolean).slice(-6).join(' | ') };
  if (has('progress:', 'resolved ', 'downloaded ', 'fetching', 'downloading', '下载') && current !== 'installing')
    return { stage: 'downloading', message: '下载中…' };
  if (has('verifying', 'integrity', 'checksum', '校验', 'sha256')) return { stage: 'verifying', message: '校验中…' };
  if (has('installing', 'adding', '安装', 'add ', 'extract', '解压', 'packages')) return { stage: 'installing', message: '安装中…' };
  if (has('added ', 'installed', 'complete', 'done', '完成', 'success', 'done in')) return { stage: 'done', message: '完成' };
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

        // ① 安装前快照 package.json + pnpm-lock.yaml（官方 dsh-plugin-manager 同款）
        // 直接 `pnpm add <url>`（官方做法）。pnpm 对 URL tarball 不写 integrity
        // 是已知行为，失败后靠恢复快照 + frozen-lockfile 重装把坏条目洗掉，
        // 保证后续安装永远干净可重试——不再用 file: 本地引用绕路（v0.4.3/0.4.4
        // 的临时路径/ENOENT/进度卡住都源于那个方向）。
        const dir = profileDir || '/root/.dsh/profiles/web';
        let saved;
        try { saved = await snapshotProfileFiles(dir); } catch { saved = {}; }
        updateTask(key, { stage: 'installing', message: '安装中…', running: true });
        sendJson(response, 202, { status: 'started', target: url, key });

        const { file, args } = dshArgv();
        const finalArgs = [...args, 'plugin', '--profile', profileName, 'add', url];
        const child = spawn(file, finalArgs, {
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
          const stage = classifyStage(`${out}\n${err}`, prevStage);
          updateTask(key, {
            stage,
            message: stage === 'failed'
              ? (String(stage.message || '').trim() || '安装失败')
              : (installTasks.get(key)?.message || '进行中…'),
          });
        };
        child.stdout && child.stdout.on('data', (d) => classifyNow(d, false));
        child.stderr && child.stderr.on('data', (d) => classifyNow(d, true));
        child.on('error', (e) => {
          console.error('[dsh-jack-market] spawn:', e && e.message);
          updateTask(key, { stage: 'failed', message: `启动失败: ${(e && e.message) || 'unknown'}`, running: false });
        });
        child.on('close', async (code) => {
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
