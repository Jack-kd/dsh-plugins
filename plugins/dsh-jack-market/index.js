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
import nodeHttps from 'node:https';
import nodeHttp from 'node:http';

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
// v0.7.5：每页条数 100 → 30。
//
// 实测：per_page=100 返回 160KB、耗时 12.9 秒；per_page=30 返回 148KB、10.6 秒。
// 本仓库现有 32 条 release，而插件只有 9~10 个 —— **30 条已覆盖全部插件的
// 最新版本**（实测：30 条覆盖到 10 个 key，目录里也只有 9 个插件）。
// 拉 100 条纯属浪费带宽与时间。
//
// 注意：per_page 同时是「是否还有下一页」的判据（不足一页即到底）。改成 30 后，
// 满 30 条会误判「还有下一页」。因此翻页判据改为「只看 links 是否含 next」不可行
// （GitHub 对匿名请求也给 Link 头，但这里没解析），改用更保守的策略：
// 最多取 2 页（60 条），且第二页只在前一页恰好满页时才请求。
const RELEASES_PER_PAGE = 30;
const RELEASES_MAX_PAGES = 2;
const API_PLUGINS_DIR = `https://api.github.com/repos/${OWNER}/${REPO}/contents/plugins`;
// 根 README：插件简介的唯一来源（v0.7.0）
// 每个插件是 <details> 块：summary 里「插件名 · 一句话简介」，正文第一段 `>`
// 引用块是完整介绍。市场 note 显示这个简介，而不是 release.body（版本更新细节）。
const API_README = `https://api.github.com/repos/${OWNER}/${REPO}/contents/README.md`;

/**
 * README 显示名 → 市场目录 key 的映射（v0.7.0）。
 * README 的 summary 用展示名（如「加速器」），而市场 key 是 plugins/ 下的目录名
 * （如 gh-accel）。只有不匹配的才需要列；其余 README 名 == 目录名。
 */
const README_KEY_ALIAS = {
  '加速器': 'gh-accel',
};

/**
 * 拉取根 README 并解析每个插件段落的简介。
 * 返回 Map<插件目录名, { summary, intro }>：
 *   summary = summary 行里「· 」之后的短语（一句话简介）
 *   intro   = 正文第一段 `>` 引用块（完整介绍，去掉版本更新行）
 * 解析失败返回空 Map（不影响市场主流程，note 回退到 release.body）。
 */
async function fetchReadmeIntros(controller) {
  const out = new Map();
  try {
    const resp = await cachedGhJson(API_README, controller);
    if (!resp || typeof resp.content !== 'string') return out;
    const text = Buffer.from(resp.content, 'base64').toString('utf8');
    // 按 <details> 块切分
    const blocks = text.match(/<details>[\s\S]*?<\/details>/g) || [];
    for (const block of blocks) {
      // summary 行：<summary><b>▶ 插件名 · 简介</b>　<code>vX</code></summary>
      const sm = block.match(/<summary><b>▶\s*([^·<]+?)\s*·\s*([^<]*?)<\/b>/);
      if (!sm) continue;
      const displayName = sm[1].trim();
      // 显示名 → 目录 key（别名表；无别名时显示名即 key）
      const key = README_KEY_ALIAS[displayName] || displayName;
      const summary = sm[2].trim();
      // 正文第一段 > 引用块（插件介绍；跳过以 **v 开头的版本更新行）
      let intro = '';
      const lines = block.split('\n');
      for (const line of lines) {
        const t = line.trim();
        if (t.startsWith('> **v') || t.startsWith('> **V')) continue; // 版本更新行
        if (t.startsWith('>') && t.length > 2) {
          const content = t.replace(/^>\s*/, '').trim();
          if (content) { intro = content; break; }
        }
      }
      if (key) out.set(key, { summary, intro });
    }
  } catch (e) {
    console.warn('[dsh-jack-market] 拉取 README 简介失败:', e && e.message ? e.message : e);
  }
  return out;
}

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
/**
 * 从 Release 资产 URL 反查它的 sha256 digest（v0.7.3）。
 *
 * GitHub Release API 的每个 asset 都带 `digest: "sha256:<hex>"`。
 * 我们在下载前拿到它，作为**镜像内容的强校验基准** —— 第三方镜像理论上
 * 可以替换/截断内容，旧实现只查「文件非空」，等于不设防。
 *
 * URL 形态：.../releases/download/<tag>/<asset>
 * 查不到就返回 null（调用方降级为只校验大小，行为与旧版一致，不会因此失败）。
 *
 * @param {string} assetUrl Release 下载直链
 * @returns {Promise<string|null>} 64 位 hex，或 null
 */
async function fetchAssetDigest(assetUrl, controller) {
  try {
    const m = /\/releases\/download\/([^/]+)\/([^/?#]+)/i.exec(String(assetUrl || ''));
    if (!m) return null;
    const tag = decodeURIComponent(m[1]);
    const name = decodeURIComponent(m[2]);
    const api = `https://api.github.com/repos/${OWNER}/${REPO}/releases/tags/${encodeURIComponent(tag)}`;
    const data = await cachedGhJson(api, controller);
    const asset = (data?.assets || []).find((a) => a && a.name === name);
    const digest = asset?.digest;
    if (typeof digest !== 'string') return null;
    const hex = digest.replace(/^sha256:/i, '');
    return /^[a-f0-9]{64}$/i.test(hex) ? hex.toLowerCase() : null;
  } catch {
    // 拿不到 digest（限流/离线/私有库）不阻断下载：降级为只校验大小。
    return null;
  }
}

// ── GitHub API 缓存（v0.7.4：让「打开市场」不再每次都等 10 秒）─────────────
//
// 实测（2026-10-30，本机）：列表页三个 API（目录 / README / releases）
// 每个 TTFB 就要 5.8~6.9 秒，其中 releases 还要再传 155KB（合计 11.4 秒）。
// 三者并行，冷启动总耗时实测 **10.3 秒**；而缓存命中时 **0.005 秒**。
//
// 旧策略 TTL 只有 60 秒 —— 用户每隔一分钟再打开就要重新等 10 秒，体感很差。
// 而插件列表的真实变化频率是「按天/按周」（每次发版才变），60 秒纯属浪费。
//
// 新策略：
//   * **新鲜期 15 分钟**：期内直接用缓存，零网络。
//   * **陈旧期（15 分钟~24 小时）**：**立即返回旧数据**，同时后台静默刷新
//     （stale-while-revalidate）。用户永远不用为「刷新」等待。
//   * 超过 24 小时才强制等网络（避免拿几天前的旧列表装已删除的插件）。
//
// 另外给首次启动做**预热**：插件加载 3 秒后主动拉一次，等用户点开市场时
// 多半已命中缓存。
const apiCache = new Map();
const API_FRESH_MS = 15 * 60 * 1000;        // 15 分钟内直接用
const API_STALE_MS = 24 * 60 * 60 * 1000;   // 24 小时内可先返回旧值并后台刷新

/** 后台静默刷新（不阻塞调用方，失败也不影响已返回的旧值）。 */
function backgroundRefresh(url) {
  const hit = apiCache.get(url);
  if (hit && hit.refreshing) return;
  if (hit) hit.refreshing = true;
  ghJson(url)
    .then((value) => { apiCache.set(url, { at: Date.now(), value, refreshing: false }); })
    .catch(() => { if (hit) hit.refreshing = false; });
}

async function cachedGhJson(url, controller) {
  const cached = apiCache.get(url);
  const age = cached ? Date.now() - cached.at : Infinity;

  // 新鲜期：直接命中
  if (cached && age < API_FRESH_MS) return cached.value;

  // 陈旧但可接受：先返回旧值，后台刷新（用户零等待）
  if (cached && age < API_STALE_MS) {
    backgroundRefresh(url);
    return cached.value;
  }

  // 无缓存或过期太久：必须等网络
  const value = await ghJson(url, controller);
  apiCache.set(url, { at: Date.now(), value });
  return value;
}

/** 预热：插件加载后后台拉一次列表，让用户首次打开市场时命中缓存。 */
export function warmApiCache() {
  const now = Date.now();
  for (const url of [API_PLUGINS_DIR, API_README, `${API_RELEASES}?per_page=${RELEASES_PER_PAGE}&page=1`]) {
    // v0.7.4：先看缓存 —— 新鲜期内完全不发请求（避免每次重启都白拉 3 次 6 秒的
    // 请求，也省 GitHub 匿名额度：60 次/小时）。
    const hit = apiCache.get(url);
    if (hit && now - hit.at < API_FRESH_MS) continue;
    ghJson(url)
      .then((value) => { apiCache.set(url, { at: Date.now(), value }); })
      .catch(() => { /* 预热失败无所谓，用户打开时会自己拉 */ });
  }
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

/**
 * api.github.com 的代理节点 —— **默认关闭**（v0.7.4 实测后决定）。
 *
 * 实测数据（2026-10-30）：
 *   直连 api.github.com      TTFB 6.07s / 6.89s
 *   gh.acmsz.top 代理        TTFB 5.52s / 6.32s   （只快 ~0.5s，收益极小）
 *   而且 gh.acmsz.top 对 API 路径返回 **HTTP 200 + body "ok"**（2 字节假响应），
 *   若只看 response.ok 会把垃圾写进缓存，导致列表空白且极难排查。
 *
 * 结论：API 走镜像「收益接近零、风险不小」，不值得。列表加速的收益来自
 * **缓存策略**（见下方 apiCache），而不是换节点。这里保留空表与回退逻辑，
 * 将来若找到真正可靠的 API 代理，填进来即可自动生效。
 */
const API_MIRROR_BASES = [];

/**
 * 用原生 https 取一个 URL 的文本（v0.7.4 重写）。
 *
 * 为什么不用 `fetch`：实测本环境下 undici 的 `fetch` 拉 160KB 的
 * `releases?per_page=100` 会 **`TypeError: fetch failed`**（10.5 秒后崩），
 * 而同一请求用 curl / 原生 https 都成功。这是 undici 连接复用在该网络下的
 * 兼容问题 —— 它正是「插件列表加载失败 / HTTP 502」的直接来源。
 *
 * 关键技巧：加 `connection: close`。实测同一请求
 *   默认（复用连接）  6622ms
 *   connection: close   255ms
 * 连接复用在这种弱网/代理环境下反而拖慢并极易失败，干脆每次新建连接。
 */
function httpsText(url, { signal, timeoutMs = 25_000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? nodeHttps : nodeHttp;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const onOuterAbort = () => ac.abort();
    if (signal) {
      if (signal.aborted) { clearTimeout(timer); reject(new Error('已取消')); return; }
      signal.addEventListener('abort', onOuterAbort, { once: true });
    }
    const done = (fn, arg) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onOuterAbort);
      fn(arg);
    };

    const run = (u, redirects) => {
      let req;
      try {
        req = mod.get(u, {
          headers: { ...headers, connection: 'close' },
          signal: ac.signal,
        }, (res) => {
          const status = res.statusCode || 0;
          const loc = res.headers.location;
          if (status >= 300 && status < 400 && loc && redirects > 0) {
            res.resume();
            run(new URL(loc, u).toString(), redirects - 1);
            return;
          }
          if (status !== 200) {
            res.resume();
            done(reject, new Error(`GitHub API ${status}`));
            return;
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => { body += c; });
          res.on('end', () => done(resolve, body));
          res.on('error', (e) => done(reject, e));
        });
      } catch (e) { done(reject, e); return; }
      req.on('error', (e) => {
        if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) {
          done(reject, new Error(`超时(${timeoutMs}ms): ${u}`));
          return;
        }
        done(reject, e);
      });
    };
    run(url, 5);
  });
}

/** 兼容旧签名：控制器可空，内部自己走原生 https + JSON 校验。 */
async function ghJson(url, controller) {
  const signal = controller && controller.signal ? controller.signal : undefined;
  const headers = { accept: 'application/vnd.github+json', 'user-agent': 'dsh-jack-market' };

  // API 镜像默认关闭（见 API_MIRROR_BASES 的说明）；保留回退结构以备将来。
  const candidates = [];
  if (/^https:\/\/api\.github\.com\//i.test(url)) {
    for (const base of API_MIRROR_BASES) candidates.push(base + url);
  }
  candidates.push(url);

  let lastErr = null;
  for (const target of candidates) {
    try {
      const text = await httpsText(target, { signal, headers });
      // 强校验：必须是 JSON。防止「HTTP 200 + body 'ok'」这类假响应被当数据缓存。
      if (!text || (text[0] !== '{' && text[0] !== '[')) {
        throw new Error('返回内容非 JSON（疑似错误页/假响应）');
      }
      return JSON.parse(text);
    } catch (e) {
      lastErr = e;
      if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) throw e;
    }
  }
  throw lastErr || new Error('GitHub API 不可达');
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
    // 拉取根 README 的插件简介（v0.7.0：note 显示插件介绍，而非版本更新细节）
    const [dirEntries, releases, readmeIntros] = await Promise.all([
      cachedGhJson(API_PLUGINS_DIR, controller),
      fetchAllReleases(controller),
      fetchReadmeIntros(controller),
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
        // v0.7.0：note 优先用根 README 的插件简介（intro）；README 没收录时
        // 回退到 release.body（版本更新说明）。README 简介才是「这插件干嘛的」。
        const readmeIntro = readmeIntros.get(key);
        const note = (readmeIntro && readmeIntro.intro)
          ? readmeIntro.intro
          : (typeof release.body === 'string' ? release.body : '');
        byKey.set(key, {
          key,
          name: asset.name,
          version: versionFromTag(release.tag_name),
          tag: release.tag_name,
          url: asset.browser_download_url,
          note,
          summary: readmeIntro ? readmeIntro.summary : '',
          publishedAt: release.published_at,
          supersededBy: SUPERSEDED_BY[key] || null,
        });
      }
    }

    // Directory-only plugins (in repo but not yet released as a tgz) stay
    // visible so the user knows they exist, but cannot be installed here yet.
    for (const key of dirKeys) {
      if (byKey.has(key)) continue;
      const readmeIntro = readmeIntros.get(key);
      byKey.set(key, {
        key,
        name: '',
        version: '',
        tag: '',
        url: '',
        note: readmeIntro && readmeIntro.intro
          ? readmeIntro.intro
          : '此插件已在仓库中，但尚未发布可安装的 release 包；请在仓库查看安装说明。',
        summary: readmeIntro ? readmeIntro.summary : '',
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
        // v0.7.1：同时读 bundles，让客户端能区分「已安装」与「已启用」。
        // 只看 dependencies 会把「装好了但没进运行时」误报成「已安装」，
        // 用户看到的按钮是灰的「已安装」，功能却根本没加载。
        const enabledNames = new Set(manifest?.dsh?.profile?.bundles ?? []);
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
        result = names.map((name) => ({ name, version: readVersion(name), enabled: enabledNames.has(name) }));
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
 * 下载 GitHub release 资产到本地稳定路径（v0.7.3：竞速 + 校验）。
 *
 * ── 为什么改成「并行竞速」而不是「先探测再串行下载」────────────────────
 * 实测（2026-10-30，本机、40KB 的 rea-tools 包）：
 *
 *   节点 TTFB（等首字节）  5.4 ~ 7.1 秒
 *   实际传输耗时          0.02 ~ 0.13 秒
 *
 * 也就是说「7 KB/s」这个速度是**假象**——它把 5 秒的等待摊进了速度里。
 * 真实现象是「延迟主导」，不是「带宽不足」。
 *
 * 旧实现有两个致命缺陷：
 *   ① `probeNode` 用 3s 读取预算 + 5s 强制超时，而节点 TTFB 就要 5.4s+。
 *      实测：8 个可用节点**全部被判 bps=0**（把好节点全判死）。
 *   ② 判死之后仍串联逐个重试，每个失败等满超时。审计日志实测：10 个节点
 *      约 98 秒全灭，第二轮才偶然成功 —— 这就是用户看到的「下载慢/失败」。
 *
 * 新实现直接把「探测」和「下载」合并：前 3 个节点同时开始**下载真文件**，
 * 谁先完整拿到就用谁，其余立即 abort。探测本来只为排序，而排序省下的时间
 * 远小于探测本身花掉的 5 秒。
 *
 * 实测竞速 3 次：5.99s / 5.75s / 5.52s（都命中 ghgo.de5.net），
 * 对比旧实现约 98 秒 —— 约 16 倍。
 *
 * ── 校验（安全）─────────────────────────────────────────────────────
 * GitHub Release API 的资产自带 `digest: sha256:...`。下载后比对，不符就换
 * 下一个节点。旧实现只检查「文件非空」，第三方镜像内容被替换/截断也会被当成成功。
 *
 * 另一关键：市场安装必须「下载到本地 → `pnpm add file:<稳定路径>`」而不是
 * `pnpm add <url>`（pnpm 对 URL tarball 在网络慢/CI 下不写 integrity 必失败）；
 * 稳定路径（profile/.dsh-market/pkgs/）不能删——pnpm 的 file: 引用长期指向它。
 */

// 加速镜像列表（v0.7.3：实测筛选，按 TTFB 从快到慢）
//
// 依据：2026-10-30 对 82 个候选节点（来自 github.akams.cn 的 ghproxy-next 节点表）
// 逐个实测可用性，其中 39 个可用；再对其中最靠前的做 3 次 TTFB 采样，
// 取中位数排序。**不整体照搬 82 个**：竞速只用前 3 个，多余节点不参与也
// 没有收益，且那些节点是网友贡献、以周为单位的频率在失效。
//
// 已删除（实测失效，保留只会让每次安装白等超时）：
//   github.geekery.cn      404，返回 629 字节错误页
//   js.jiangss.shop        连不上（code=000）
//   ghproxy.net            超时
//   ghproxy.felicity.land  连不上（code=000）
const GH_MIRRORS = [
  'https://ghgo.de5.net/',          // 5.69s
  'https://gh.acmsz.top/',          // 5.78s
  'https://github.chenc.dev/',      // 5.78s
  'https://gh.jjj.gv.uy/',          // 5.80s
  'https://gh-proxy.com/',          // 6.01s
  'https://down.mxw.xx.kg/',        // 6.11s
  'https://free.cn.eu.org/',        // 6.13s
  'https://github.mxw.qzz.io/',     // 6.22s
  'https://ghproxy.icu/',           // 6.30s
  'https://ghfast.top/',            // 6.78s
  'https://gh.monlor.com/',         // 6.79s
  'https://cfgh.ikgy.top/',         // 7.07s
];

/** 单次竞速同时发起几个节点（再多了边际收益很小，反而抬高失败重置成本）。 */
const RACE_WIDTH = 3;
/** 单个节点的整体下载超时（含 TTFB）；TTFB 实测 5.4~7.1s，留足余量。 */
const NODE_TIMEOUT_MS = 20_000;

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

/**
 * 从单个 URL 下载到 dest（失败抛错；onProgress 字节回调）。
 * 支持跟随重定向（镜像常先 3xx）。
 */
async function downloadFrom(url, dest, { signal, onProgress } = {}) {
  const https = await import('node:https');
  const http = await import('node:http');
  const fs = await import('node:fs');
  const mod = url.startsWith('https:') ? https : http;
  let bytes = 0;
  let lastEmit = 0;
  await new Promise((resolveP, rejectP) => {
    const run = (u, redirects) => {
      // 组合两个取消源：调用方的 signal + 本节点的整体超时。
      const timeoutSignal = AbortSignal.timeout(NODE_TIMEOUT_MS);
      const combined = (typeof AbortSignal.any === 'function' && signal)
        ? AbortSignal.any([signal, timeoutSignal])
        : (signal || timeoutSignal);
      const req = mod.get(u, { headers: { 'user-agent': 'dsh-jack-market', accept: '*/*' }, signal: combined }, (res) => {
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
      req.on('error', (e) => {
        // AbortSignal 触发时是 AbortError，转成带 URL 的可读信息
        if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) {
          rejectP(new Error(`下载超时: ${u}`));
          return;
        }
        rejectP(e);
      });
      // v0.7.3：超时改由 AbortSignal 统一控制（见下）。
      // 实测坑：在 Node 24 + 本环境下 `req.setTimeout(20000)` **不生效**，
      // 请求仍在约 5 秒处报超时（复现：传 20s/30s 都 5043ms/5007ms 触发）。
      // 而节点 TTFB 实测 5.9~9.1 秒 → 5 秒上限会把好节点全判死。
      // 这正是旧版「第一轮全灭」的隐藏元凶之一。AbortSignal.timeout 可靠。
    };
    run(url, 5);
  });
  return bytes;
}

/** 计算 sha256（用于与 GitHub Release 的 digest 比对）。 */
async function sha256Of(file) {
  const fsp = await import('node:fs/promises');
  const crypto = await import('node:crypto');
  const buf = await fsp.readFile(file);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * 竞速下载：从候选节点中并行发起 RACE_WIDTH 个，第一个**完整且校验通过**的胜出。
 *
 * @param {string[]} cands 候选 URL（已按优先级排好）
 * @param {string} dest 目标文件
 * @param {object} opts
 * @param {string} [opts.expectSha256] 期望的 sha256（来自 GitHub digest，可空）
 * @returns {Promise<{ via: string, bytes: number, sha256: string }>}
 */
async function raceDownload(cands, dest, { signal, onProgress, expectSha256 } = {}) {
  const fsp = await import('node:fs/promises');
  if (cands.length === 0) throw new Error('没有可用的下载节点');

  // 关键（v0.7.3）：**首个成功即返回**，不等同批其它节点。
  //
  // 旧写法用 `Promise.allSettled` 等整批结束才取冠军 —— 实际表现是
  // 「最快的 6 秒就好了，却要陪跑等最慢的等到 20 秒超时」，实测 12~19 秒。
  // 现在用显式 resolve：谁先完整下载并通过校验就立刻结算，其余 abort。
  const tryBatch = (batch, attempt) => new Promise((resolve, reject) => {
    const controllers = batch.map(() => new AbortController());
    let settled = false;
    let pending = batch.length;
    const failures = [];

    const finish = () => {
      // 结算后统一 abort 其余请求（包括已成功的，避免占带宽）
      for (const c of controllers) { try { c.abort() } catch { /* 已结束 */ } }
    };

    const onOuterAbort = () => {
      if (settled) return;
      settled = true;
      finish();
      reject(new Error('下载已取消'));
    };
    if (signal) {
      if (signal.aborted) { onOuterAbort(); return; }
      signal.addEventListener('abort', onOuterAbort, { once: true });
    }

    batch.forEach((cand, i) => {
      const tmp = `${dest}.r${attempt}_${i}`;
      (async () => {
        try {
          await downloadFrom(cand.u, tmp, { signal: controllers[i].signal });
          const size = (await fsp.stat(tmp)).size;
          if (size <= 0) throw new Error('下载文件为空');
          const got = await sha256Of(tmp);
          if (expectSha256 && got !== expectSha256) {
            throw new Error(`校验不符（${got.slice(0, 12)}≠${expectSha256.slice(0, 12)}）`);
          }
          if (settled) { await fsp.rm(tmp, { force: true }).catch(() => {}); return; }
          settled = true;
          finish();
          if (signal) signal.removeEventListener('abort', onOuterAbort);
          // 其余临时文件清理（不阻塞返回）
          for (let j = 0; j < controllers.length; j++) {
            if (j !== i) fsp.rm(`${dest}.r${attempt}_${j}`, { force: true }).catch(() => {});
          }
          resolve({ via: cand.via, tmp, size, sha256: got });
        } catch (e) {
          await fsp.rm(tmp, { force: true }).catch(() => {});
          if (settled) return;
          failures.push(`${cand.via}: ${(e && e.message) || e}`);
          pending -= 1;
          if (pending === 0) {
            settled = true;
            finish();
            if (signal) signal.removeEventListener('abort', onOuterAbort);
            reject(new Error('本批全部失败：' + failures.join(' / ')));
          }
        }
      })();
    });
  });

  let lastErr = null;
  let attempt = 0;
  // 按批推进：每批 RACE_WIDTH 个并行。任一批出现成功者立刻返回。
  // 注意：这里用「批内全失败才进下一批」，避免一次把 12 个节点全打出去
  // （公共镜像被并发打满反而会集体变慢/限流）。
  for (let base = 0; base < cands.length; base += RACE_WIDTH) {
    attempt += 1;
    const batch = cands.slice(base, base + RACE_WIDTH);
    try {
      const w = await tryBatch(batch, attempt);
      await fsp.rename(w.tmp, dest);
      if (typeof onProgress === 'function') onProgress(w.size);
      return { via: w.via, bytes: w.size, sha256: w.sha256 };
    } catch (e) {
      lastErr = e;
      audit('download.batchFail', `第${attempt}批 ${batch.map((b) => b.via).join(',')} -> ${(e && e.message) || e}`);
    }
  }
  throw lastErr || new Error('下载失败: 所有节点不可达');
}

/**
 * 下载 GitHub release 资产到本地稳定路径。
 * 返回 { dest, bytes, via }；全部节点失败抛错。
 *
 * @param {object} opts
 * @param {string} [opts.expectSha256] 期望 sha256（GitHub Release digest），用于强校验
 */
async function downloadTgz(url, { dest, signal, onProgress, expectSha256 } = {}) {
  const fsp = await import('node:fs/promises');
  await fsp.mkdir((await import('node:path')).dirname(dest), { recursive: true });

  // 候选顺序：全部镜像（按 TTFB 实测排序）+ 直连兜底。
  // 直连放最后：实测直连 TTFB 7.8s 且偶发 14s，但它不会带上第三方，
  // 作为「镜像全灭」时的最后手段。
  const cands = [
    ...GH_MIRRORS.map((m) => ({ u: rewriteViaMirror(url, m), via: m })),
    { u: url, via: 'direct' },
  ];

  const t0 = Date.now();
  const r = await raceDownload(cands, dest, { signal, onProgress, expectSha256 });
  audit('download.done', `via=${r.via} bytes=${r.bytes} 耗时=${Date.now() - t0}ms 校验=${expectSha256 ? 'sha256' : 'size'}`);
  return { dest, bytes: r.bytes, via: r.via };
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

/**
 * 读出 profile 里「已装」与「已启用」两个集合（v0.7.1）。
 *
 * 关键区别（这是「装完还要手动启用」的根因）：
 *   dependencies  = pnpm 装到了磁盘上
 *   dsh.profile.bundles = 被加载进运行时（就是「插件」页面那个开关）
 * 本市场走的是 `pnpm add`，pnpm 只写前者，**从不写 bundles**，所以装完必须由
 * 我们自己补一步，否则用户永远要去「插件」页面手动启用一次。
 *
 * @returns {{ installed: Set<string>, enabled: Set<string>, manifest: object }}
 */
async function readProfileState(profileDir) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const file = path.join(profileDir, 'package.json');
  if (!fs.existsSync(file)) return { installed: new Set(), enabled: new Set(), manifest: null };
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const installed = new Set(Object.keys(manifest?.dependencies ?? {}));
  const enabled = new Set(manifest?.dsh?.profile?.bundles ?? []);
  return { installed, enabled, manifest };
}

/**
 * 自愈 pnpm-lock.yaml 里「tarball 条目缺 integrity」的问题（v0.7.2）。
 *
 * 背景：pnpm-lock 的 packages 段若某个 tarball 依赖长这样——
 *
 *   foo@https://….tgz:
 *     resolution: {tarball: https://….tgz}     ← 没有 integrity
 *
 * pnpm 会在**任何**一次安装开始前直接拒绝，报
 * `ERR_PNPM_MISSING_TARBALL_INTEGRITY Cannot install package "foo"`。
 * 它拒的是 foo，但用户正在装的是另一个插件 —— 报错完全指错对象。
 *
 * 这个函数扫一遍 lockfile：
 *   * `file:` 指向本机文件 → 读文件算 sha512 补进 integrity；
 *   * 其它 URL → 用已下载的本地副本（.dsh-market/pkgs 里的同名 tgz）补；
 *   * 都补不了 → 整条移除（让 pnpm 重新解析），并计入 removed。
 *
 * 只动「缺 integrity」的条目，其它内容原样保留；无变化则不写盘。
 *
 * @returns {Promise<{ changed: boolean, fixed: number, removed: number }>}
 */
async function healLockfileIntegrity(profileDir) {
  const fs = await import('node:fs');
  const fsp = await import('node:fs/promises');
  const path = await import('node:path');
  const crypto = await import('node:crypto');

  const lockPath = path.join(profileDir, 'pnpm-lock.yaml');
  const manifestPath = path.join(profileDir, 'package.json');
  if (!fs.existsSync(lockPath) || !fs.existsSync(manifestPath)) {
    return { changed: false, fixed: 0, removed: 0, rewritten: 0 };
  }
  const crypto512 = (buf) => 'sha512-' + crypto.createHash('sha512').update(buf).digest('base64');
  const pkgsDir = path.join(profileDir, '.dsh-market', 'pkgs');

  // ── 真正的病根：`package.json` 里用 **http(s) URL** 作为依赖 specifier ──
  //
  // pnpm 对 URL specifier 会写成 `foo@<url>: resolution: {integrity: …, tarball: <url>}`
  // 起初还好；但一旦该 Release 资产被重传/替换，或网络超时导致 pnpm 拿不到
  // 内容，它就会把这条记录退化成**没有 integrity** 的形态。之后每一次安装
  // （哪怕装的是完全不相干的插件）都会在开跑前直接抛：
  //
  //   ERR_PNPM_MISSING_TARBALL_INTEGRITY
  //   Cannot install package "<那个 URL 包>": its lockfile entry has no "integrity"
  //
  // 报错指的是 A，用户装的是 B —— 指错对象，极难排查。
  //
  // 本市场本来就先把 tgz 下到本机固定路径、再用 `pnpm add file:…`，
  // 所以正确形态应始终是 `file:` 本地引用。这里把 manifest 里仍指向本仓库
  // Release 的 URL 依赖改写成本地 file: 路径；本地副本不存在就跳过（不动它）。
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let rewritten = 0;
  const deps = manifest?.dependencies;
  if (deps && typeof deps === 'object') {
    for (const [name, spec] of Object.entries(deps)) {
      if (typeof spec !== 'string' || !/^https?:\/\//i.test(spec)) continue;
      if (!/\/releases\/download\/[^/]+\/([^/]+)\.tgz(?:[?#]|$)/i.test(spec)) continue;
      const m = /\/releases\/download\/[^/]+\/([^/]+)\.tgz(?:[?#]|$)/i.exec(spec);
      const base = m ? m[1] : name.replace(/^@[^/]+\//, '') + '-plugin';
      const cands = [
        path.join(pkgsDir, `${base}.tgz`),
        path.join(pkgsDir, `${name.replace(/^@[^/]+\//, '')}-plugin.tgz`),
      ];
      const local = cands.find((c) => fs.existsSync(c));
      if (!local) continue;                       // 本地没副本就不动，避免制造坏引用
      deps[name] = 'file:' + local;
      rewritten += 1;
    }
    if (rewritten > 0) {
      const tmpM = manifestPath + '.market-heal';
      await fsp.writeFile(tmpM, JSON.stringify(manifest, void 0, 2) + '\n', { mode: 0o600 });
      await fsp.rename(tmpM, manifestPath);
    }
  }

  // ── 退而求其次：修 lockfile 里仍缺 integrity 的 tarball 条目 ──
  // 上面改写后 pnpm 会重新解析，这些坏条目通常会被自然替换掉；但若本轮
  // 没能改写 manifest（例如本地副本缺失），至少让 lockfile 本身不再致命。
  const text = fs.readFileSync(lockPath, 'utf8');
  const lines = text.split('\n');
  const out = [];
  let fixed = 0;
  let removed = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headMatch = /^(\s{2})([^\s:]+)@(https?:|file:)(\S+):\s*$/.exec(line);
    if (!headMatch) { out.push(line); continue; }

    const resLine = lines[i + 1] || '';
    const resMatch = /^(\s{4})resolution:\s*\{([^}]*)\}\s*$/.exec(resLine);
    if (!resMatch || /\bintegrity\b/.test(resMatch[2])) { out.push(line); continue; }

    const scheme = headMatch[3];
    const spec = headMatch[4];
    let integrity = '';
    try {
      if (scheme === 'file:') {
        const abs = spec.startsWith('/') ? spec : path.join(profileDir, spec);
        if (fs.existsSync(abs)) integrity = crypto512(fs.readFileSync(abs));
      } else {
        const name = headMatch[2].replace(/^@[^/]+\//, '');
        for (const c of [path.join(pkgsDir, `${name}-plugin.tgz`), path.join(pkgsDir, `${name}.tgz`)]) {
          if (fs.existsSync(c)) { integrity = crypto512(fs.readFileSync(c)); break; }
        }
      }
    } catch { integrity = ''; }

    if (!integrity) {
      removed += 1;
      i += 2;
      continue;
    }

    out.push(line);
    out.push(`    resolution: {integrity: ${integrity}, ${resMatch[2].trim()}}`);
    if (/^\s{4}version:/.test(lines[i + 2] || '')) { out.push(lines[i + 2]); i += 2; }
    else { i += 1; }
    fixed += 1;
  }

  const changed = rewritten > 0 || fixed > 0 || removed > 0;
  if (rewritten === 0 && (fixed > 0 || removed > 0)) {
    const next = out.join('\n');
    const tmp = lockPath + '.market-heal';
    await fsp.writeFile(tmp, next, { mode: 0o600 });
    await fsp.rename(tmp, lockPath);
  }
  if (changed) {
    // pnpm 的私锁会覆盖主 lockfile，删掉让它按修好的 manifest 重建。
    try { await fsp.rm(path.join(profileDir, 'node_modules', '.pnpm', 'lock.yaml'), { force: true }); } catch { /* 无此文件 */ }
  }
  return { changed, fixed, removed, rewritten };
}


/**
 * 把一个已安装的包写进 `dsh.profile.bundles`，即「启用」。
 *
 * 复刻官方 dsh-plugin-manager 的 `selectBundle(name, true)` 行为（见
 * dsh-plugin-manager/lib/index.js:1800 安装收尾的 `if (options?.enabled !== false)
 * await this.selectBundle(name, true)`）：只往 bundles 数组追加，不动别的字段。
 *
 * 安全约束：
 *   * 只在包**确实已在 dependencies** 时才启用（避免把拼写错误的名字写进去）；
 *   * 幂等：已在 bundles 里就原样返回；
 *   * 只改 bundles 一个数组，其它字段（含用户自己的 patchReload、别人的顺序）原样保留。
 *
 * @returns {Promise<{ changed: boolean, name: string, reason?: string }>}
 */
async function enableBundle(profileDir, name) {
  const fs = await import('node:fs');
  const fsp = await import('node:fs/promises');
  const path = await import('node:path');
  if (typeof name !== 'string' || !name) return { changed: false, name: '', reason: 'empty-name' };
  const file = path.join(profileDir, 'package.json');
  if (!fs.existsSync(file)) return { changed: false, name, reason: 'no-manifest' };
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!manifest?.dependencies || !Object.hasOwn(manifest.dependencies, name)) {
    return { changed: false, name, reason: 'not-installed' };
  }
  const profile = manifest.dsh?.profile;
  if (profile === undefined) return { changed: false, name, reason: 'no-profile' };
  const previous = profile.bundles ?? [];
  if (previous.includes(name)) return { changed: false, name, reason: 'already-enabled' };
  profile.bundles = [...previous, name];
  // 原子写：先写临时文件再 rename，避免中途断电/被杀留下半截 package.json，
  // 那会让整个 profile 起不来（官方同样用 writeFileAtomic）。
  const tmp = file + '.market-tmp';
  await fsp.writeFile(tmp, JSON.stringify(manifest, void 0, 2) + '\n', { mode: 0o600 });
  await fsp.rename(tmp, file);
  return { changed: true, name };
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
  // v0.7.4：插件加载后延迟预热列表缓存，让用户首次打开市场时多半已命中。
  // 延迟 3 秒，避免和启动时的其它插件抢网络/CPU。
  try {
    const t = setTimeout(() => { try { warmApiCache() } catch { /* 预热失败不影响功能 */ } }, 3000);
    if (typeof t.unref === 'function') t.unref();
    ctx.effect(() => () => clearTimeout(t), 'dsh-jack-market: warm api cache');
  } catch { /* ctx 无 effect 时跳过预热 */ }

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

    // v0.7.1：手动启用端点 —— 给「已安装但未启用」的历史插件用一键补启用。
    // 只接受 profile 里**确实已经安装**的包名，不接受任意字符串，避免被
    // 当成写 package.json 的通用入口。
    disposers.push(host.webServer.register({
      kind: 'exact',
      path: '/dsh-jack-market/enable',
      handler: async (request, response) => {
        if (request.method !== 'POST') { response.writeHead(405, { allow: 'POST' }); response.end(); return; }
        const origin = request.headers.origin;
        if (origin !== undefined) {
          const hostHeader = (request.headers.host || '').replace(/[^A-Za-z0-9.:[\]]/g, '');
          try {
            const o = new URL(origin);
            const e = new URL(`http://${hostHeader}`);
            if (o.origin !== e.origin) { sendJson(response, 403, { error: '跨源请求已拒绝' }); return; }
          } catch { sendJson(response, 403, { error: '无法校验请求来源' }); return; }
        }
        let body;
        try { body = await readJsonBody(request); }
        catch { sendJson(response, 400, { error: 'invalid JSON body' }); return; }
        const name = typeof body?.name === 'string' ? body.name.trim() : '';
        if (!name) { sendJson(response, 400, { error: '缺少插件名' }); return; }
        const dir = profileDir || '/root/.dsh/profiles/web';
        try {
          const r = await enableBundle(dir, name);
          audit('enable.request', `${name} changed=${r.changed} reason=${r.reason || ''}`);
          sendJson(response, r.changed ? 200 : 200, {
            ok: r.changed || r.reason === 'already-enabled',
            changed: r.changed,
            reason: r.reason || '',
            message: r.changed
              ? `已启用 ${name}；重启 App 后生效`
              : r.reason === 'already-enabled' ? `${name} 本就已启用` : `未能启用 ${name}：${r.reason}`,
          });
        } catch (e) {
          sendJson(response, 500, { ok: false, error: String((e && e.message) || e) });
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
        // v0.7.3：GitHub 官方 sha256 digest 作强校验基准。
        //
        // 性能取舍（实测）：digest 请求本身要 ~5.5 秒（GitHub API 延迟），
        // 下载也要 ~6 秒。两者**并行**可把首次总耗时从 ~11.5s 压到 ~6.5s：
        //   * 先启动 digest 请求（不 await），同时开始竞速下载；
        //   * 下载落到临时文件后，再等 digest 回来做校验 —— 校验通过才改名为正式文件。
        // 这样「校验」仍然严格（不是先信后验），但等待被重叠掉了。
        const digestPromise = fetchAssetDigest(url).catch(() => null);
        try {
          const dl = await downloadTgz(url, {
            dest: `${localTgz}.unverified`,
            expectSha256: null,   // 本步只下载；校验在 digest 到达后统一做

            onProgress: (n) => {
              const cur = installTasks.get(key);
              if (cur && (cur.stage === 'downloading' || cur.stage === 'running')) {
                installTasks.set(key, { ...cur, stage: 'downloading', message: `下载中… ${(n / 1024).toFixed(0)} KB`, at: Date.now() });
              }
            },
          });
          // 校验阶段：等 digest（多数情况已被 API 缓存命中，几乎不等）
          const expectSha256 = await digestPromise;
          audit('download.digest', expectSha256 ? `sha256=${expectSha256.slice(0, 16)}…` : '未取到（降级为大小校验）');
          const fspV = await import('node:fs/promises');
          if (expectSha256) {
            const got = await (async () => {
              const buf = await fspV.readFile(`${localTgz}.unverified`);
              const crypto = await import('node:crypto');
              return crypto.createHash('sha256').update(buf).digest('hex');
            })();
            if (got !== expectSha256) {
              await fspV.rm(`${localTgz}.unverified`, { force: true }).catch(() => {});
              throw new Error(`下载内容校验失败（${got.slice(0, 12)}≠${expectSha256.slice(0, 12)}），可能镜像内容被替换`);
            }
          }
          await fspV.rename(`${localTgz}.unverified`, localTgz);
          audit('download.done', `${key} via=${dl.via} bytes=${(await import('node:fs')).statSync(localTgz).size} 耗时=${Date.now() - tDlStart}ms 校验=${expectSha256 ? 'sha256✓' : 'size'}`);
        } catch (e) {
          audit('download.fail', `${key} err=${(e && e.message) || e} 耗时=${Date.now() - tDlStart}ms`);
          updateTask(key, { stage: 'failed', message: `下载失败: ${(e && e.message) || e}`, running: false });
          console.error('[dsh-jack-market] 下载失败:', e && e.message);
          return;
        }

        // ③ `pnpm add file:<稳定路径>` —— 稳定写 integrity、成功
        updateTask(key, { stage: 'installing', message: '安装中…', running: true });

        // ③-b v0.7.2：安装前先自愈 lockfile。
        //
        // 实测踩过的坑（2026-10-30）：profile 的 pnpm-lock.yaml 里只要**任意一条
        // tarball 依赖缺 integrity**（典型是某个用 URL 装进来的插件，pnpm 写
        // `resolution: {tarball: ...}` 而漏了 integrity），pnpm 就会在真正开始
        // 安装前直接抛：
        //
        //   ERR_PNPM_MISSING_TARBALL_INTEGRITY
        //   Cannot install package "<别的包>": its lockfile entry has no "integrity"
        //
        // 注意它拒的是**别的包**，用户却在装 A 插件 —— 于是表现为「装 A 失败，
        // 报错里提到的却是 B」，极难排查。这个坏条目通常由 https 直装
        // （`pnpm add <github-url>`）产生，而本市场从 URL 装过一次市场自己就会留下。
        //
        // 处理：把缺 integrity 的 tarball 条目补算 integrity；补不了的
        // （远端不可达 / 非本机文件）就整条移除，交给 pnpm 下次重新解析。
        // 改完若没有任何变化就不写盘，避免无意义抖动。
        let lockHealed = null;
        try {
          lockHealed = await healLockfileIntegrity(dir);
          audit('lockfile.heal', lockHealed.changed
            ? `修复 ${lockHealed.fixed} 条、移除 ${lockHealed.removed} 条`
            : 'lockfile 无需修复');
        } catch (e) {
          // 自愈失败不阻断安装：pnpm 自己会报它原本的错误，用户仍能看到真实原因。
          audit('lockfile.healFail', `${(e && e.message) || e}`);
        }

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

          // ④ v0.7.1：安装成功 → **自动写 bundles 启用**（否则装完还要去「插件」
          // 页面手动点一次启用）。这是官方 dsh-plugin-manager 安装收尾
          // `selectBundle(name, true)` 的等价补步；pnpm 只写 dependencies，不会写 bundles。
          //
          // 插件名不写死为 key：市场 key 是仓库目录名，而 npm 包名可能带 scope
          // （@local/gh-accel）或 dsh- 前缀，因此用「装之前 vs 装之后」的
          // dependencies 差集来精确定位这次新装/更新的包名。
          if (!failedNow) {
            try {
              const before = Object.keys(saved['package.json']
                ? (JSON.parse(saved['package.json']).dependencies ?? {})
                : {});
              const after = await readProfileState(dir);
              const newlyAdded = [...after.installed].filter((name) => !before.includes(name));
              // 更新场景（同名包已存在）不会出现在差集里，此时按 key 的候选名兜底匹配
              let target = newlyAdded.length === 1 ? newlyAdded[0] : '';
              if (!target) {
                const candidates = [key];
                const bare = String(key || '').replace(/^@[^/]+\//, '');
                for (const cand of [
                  `@local/${bare}`, bare, `dsh-${bare.replace(/^dsh-/, '')}`,
                  bare.startsWith('dsh-') ? bare : `dsh-${bare}`,
                ]) {
                  if (after.installed.has(cand)) { target = cand; break; }
                }
                if (!target && newlyAdded.length > 0) target = newlyAdded[0];
              }
              if (target) {
                const r = await enableBundle(dir, target);
                audit('install.enable', r.changed
                  ? `已启用 ${target}（写入 bundles）`
                  : `无需启用 ${target}：${r.reason || 'unknown'}`);
                if (r.changed) message += `，已自动启用（重启 App 后生效）`;
                else if (r.reason === 'already-enabled') message += `，已启用`;
              } else {
                audit('install.enable', `未能定位包名，跳过自动启用（key=${key}）`);
              }
            } catch (e) {
              // 启用失败不能让「已装好」的结果变成失败：包确实装上了，
              // 只是需要用户去「插件」页面手动启用。把原因带进消息里。
              audit('install.enableFail', `${key} err=${(e && e.message) || e}`);
              console.error('[dsh-jack-market] 自动启用失败:', e && e.message);
              message += `（自动启用失败：${(e && e.message) || '未知错误'}，可到「插件」页面手动启用）`;
            }
          }

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
