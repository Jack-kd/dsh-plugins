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
import { existsSync, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import https from 'node:https';
import http from 'node:http';

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
 * 下载 GitHub release 资产到本地稳定路径（跟随重定向，Node 原生实现）。
 * 返回 { dest, bytes }；失败抛错。onProgress 用于阶段/字节反馈。
 * 关键：先下载到本地再用 `file:` 引用安装，避免 pnpm 对 URL tarball
 * 不写 integrity 导致 ERR_PNPM_MISSING_TARBALL_INTEGRITY（pnpm 已知坑）。
 * 目标必须是**稳定路径**（如 <profileDir>/.dsh-market/pkgs/<key>-plugin.tgz），
 * 不能是随机临时目录——pnpm 会把 file: 路径写进 lockfile 并复用，临时文件
 * 被删会导致下次 ENOENT。
 */
async function downloadTgz(url, { dest, signal, onProgress } = {}) {
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
          rejectP(new Error(`下载失败: HTTP ${status}`));
          return;
        }
        const ws = createWriteStream(dest);
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
      req.setTimeout(20_000, () => req.destroy(new Error(`下载超时: ${u}`)));
    };
    run(url, 5);
  });
  return { dest, bytes };
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

        // ① 先下载 tgz 到 profile 目录下的稳定路径（阶段：下载中）
        // 稳定路径（非临时）：pnpm 会把 file: 路径写进 lockfile 并长期复用，
        // 随机临时目录会被删导致下次 ENOENT（v0.4.3 的坑）。
        const pkgsDir = join(profileDir || '/root/.dsh/profiles/web', '.dsh-market', 'pkgs');
        const localTgz = join(pkgsDir, `${key}-plugin.tgz`);
        updateTask(key, { stage: 'downloading', message: '下载中…', running: true });
        sendJson(response, 202, { status: 'started', target: url, key });

        try {
          await mkdir(pkgsDir, { recursive: true });
          await downloadTgz(url, {
            dest: localTgz,
            onProgress: (n) => {
              const cur = installTasks.get(key);
              if (cur && (cur.stage === 'downloading' || cur.stage === 'running')) {
                installTasks.set(key, { ...cur, stage: 'downloading', message: `下载中… ${(n / 1024).toFixed(0)} KB`, at: Date.now() });
              }
            },
          });
        } catch (e) {
          updateTask(key, { stage: 'failed', message: `下载失败: ${(e && e.message) || e}`, running: false });
          console.error('[dsh-jack-market] 下载失败:', e && e.message);
          return;
        }

        // ② 用 file: 本地引用安装（pnpm 对本地 tgz 写 integrity，不再 ERR_PNPM_MISSING_TARBALL_INTEGRITY）
        const { file, args } = dshArgv();
        const finalArgs = [...args, 'plugin', '--profile', profileName, 'add', `file:${localTgz}`];
        updateTask(key, { stage: 'installing', message: '安装中…', running: true });

        const child = spawn(file, finalArgs, {
          cwd: profileDir || undefined,
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
        child.on('close', (code) => {
          console.log(`[dsh-jack-market] install exited ${code} for ${url}`);
          // 注意：不删除下载的 tgz——pnpm 的 file: 引用会长期指向它，
          // 删除会导致下次 ENOENT。pkgs/ 目录留着做稳定缓存。
          const prev = installTasks.get(key) || {};
          // 用分类器对完整输出做一次最终判定（捕获 pnpm 的 ERR_PNPM_* 等）
          const finalStage = classifyStage(`${out}\n${err}`, prev.stage || 'running');
          const failedNow = code !== 0 || prev.stage === 'failed' || finalStage.stage === 'failed';
          if (code !== 0) console.error('[dsh-jack-market] stderr:', err.slice(-4000));
          let message = '安装成功';
          if (failedNow) {
            // 优先取分类器识别到的失败行；无则取 stderr 尾部；再无则给可读提示
            const failLine = String(finalStage.message || '').trim();
            const errTail = err.trim().slice(-400);
            message = failLine && !failLine.includes('安装失败') ? failLine : (errTail || '安装失败（退出码 ' + code + '，详见 pnpm 日志）');
            if (message.length > 500) message = message.slice(0, 500);
          }
          updateTask(key, { stage: failedNow ? 'failed' : 'done', message, running: false });
          // 任务已结束：保留 30 秒（让客户端能轮询到最终 done/failed 状态），
          // 之后清除避免 stale 残留。此前 5 秒太短——客户端 700ms 轮询可能
          // 正好错过 done/failed，拿到 idle 后无法判断结果导致进度条卡住。
          setTimeout(() => { if (installTasks.get(key)?.running === false) installTasks.delete(key); }, 30_000);
        });
      },
    }));

    const dispose = () => { for (const d of disposers) { try { d(); } catch {} } };
    return dispose;
  });
}
