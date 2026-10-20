// install-manager.js —— REA 环境的「状态 + 后台安装」宿主侧逻辑。
//
// 职责：
//   * 探测当前安装状态（未装 / 初级版本 / 升级版本 / 部分完成）
//   * 后台启动 install-rea-ghidra.sh（非阻塞），解析日志得到进度
//   * 把状态与进度落盘（供下次启动续传判断）+ 写内存快照（供投影/客户端读取）
//   * 支持取消（kill 进程；保留或清理已下载缓存由调用方决定）
//
// 设计要点：
//   * 安装**不占用工具调用**，因此不受工具超时（1200s）限制 —— 543MB 镜像下载约 20 分钟，
//     正好卡在旧的阻塞式超时临界点，改后台后该问题自然消失。
//   * 状态判断用「三重依据」（状态文件 + 下载缓存残留 + 组件就绪探测），不依赖单一标记。

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

// ---------- 路径常量（与 install-rea-ghidra.sh 保持一致）----------
export const PATHS = {
  ghidraDir: '/opt/ghidra_12.1.4_PUBLIC',
  ghidraMarker: '/opt/ghidra_12.1.4_PUBLIC/Ghidra/application.properties',
  javaHome: '/usr/lib/jvm/java-21-openjdk-arm64',
  jadxJar: '/opt/rea-install-kit/jadx-headless-mcp-0.7.1-all.jar',
  zipCache: '/var/cache/rea-install/ghidra_12.1.4_PUBLIC_20260921.zip',
  decompiler: '/opt/ghidra_12.1.4_PUBLIC/Ghidra/Features/Decompiler/os/linux_arm_64/decompile',
}

// ---------- 体积常量（用于弹窗展示与进度换算，单位 MB）----------
export const SIZES = {
  jdk: 148,
  rea: 50,
  jadx: 41,
  ghidra: 543,
  decompiler: 2,
}

/**
 * 每个阶段对应的「下载输出文件」——用于按文件大小轮询算进度。
 * v0.2.5 修复：旧实现靠正则解析 curl 的 `\r` 进度行，而脚本把 curl 的
 * stderr 丢掉了（`2>/dev/null`），进度行根本到不了这里 → stageMB 恒为 0 →
 * 百分比卡在阶段起点不动，用户看到「进度不动」。
 * 现在改成每 1.5 秒 stat 一次输出文件大小 ÷ 阶段总大小，最可靠。
 */
const STAGE_FILES = {
  ghidra: PATHS.zipCache,
  jadx: PATHS.jadxJar,
}

/** 状态文件：记录用户选择、目标环境、安装阶段。放在插件目录下，随插件走。 */
export function statePath(pluginDir) {
  return path.join(pluginDir, '.rea-install-state.json')
}

function exists(p) {
  try { fs.accessSync(p); return true } catch { return false }
}

/** 探测各组件是否就绪（只看关键文件，毫秒级） */
export function probeComponents() {
  return {
    jdk: exists(PATHS.javaHome),
    rea: exists('/usr/local/bin/rea'),
    jadx: exists(PATHS.jadxJar),
    ghidra: exists(PATHS.ghidraMarker),
  }
}

/**
 * 汇总当前环境状态。
 * tier: 'none' | 'basic' | 'full' | 'partial'
 *   basic = 初级版本（JDK+rea+JADX 齐、无 Ghidra）
 *   full  = 升级版本（再加 Ghidra+反编译器）
 *   partial = 装了一半
 */
export function detectState(pluginDir) {
  const c = probeComponents()
  const baseReady = c.jdk && c.rea && c.jadx
  const ghidraReady = c.ghidra && exists(PATHS.decompiler)

  let tier = 'none'
  if (baseReady && ghidraReady) tier = 'full'
  else if (baseReady) tier = 'basic'
  else if (c.jdk || c.rea || c.jadx || c.ghidra) tier = 'partial'

  let saved = {}
  try { saved = JSON.parse(fs.readFileSync(statePath(pluginDir), 'utf8')) } catch { /* 无状态文件 */ }

  // 是否有未完成的下载缓存（用于判断"中断可续传"）
  let cacheBytes = 0
  try { cacheBytes = fs.statSync(PATHS.zipCache).size } catch { /* 无缓存 */ }

  return {
    tier,
    components: c,
    installed: tier === 'basic' || tier === 'full',
    // 用户此前点过「后台安装」但还没装完 → 下次静默续传
    //
    // v0.2.5 修复无限续传：旧判断只看 `saved.installing === true`，而进程崩溃/被 kill
    // 时 `installing` 会残留 true，下次启动就自动续传 → 再失败 → 再续传，无限循环。
    // 现在额外要求：没有 lastError（上次不是失败退出）+ 失败次数未超上限。
    resumable: saved.installing === true
      && tier !== 'full'
      && !saved.lastError
      && (saved.failCount || 0) < 3,
    dismissed: saved.dismissed === true,
    remembered: saved.remembered || null,
    cacheMB: Math.round(cacheBytes / 1048576),
    lastError: saved.lastError || null,
    failCount: saved.failCount || 0,
  }
}

export async function readState(pluginDir) {
  try { return JSON.parse(await fsp.readFile(statePath(pluginDir), 'utf8')) } catch { return {} }
}

export async function writeState(pluginDir, patch) {
  const cur = await readState(pluginDir)
  const next = { ...cur, ...patch }
  try { await fsp.writeFile(statePath(pluginDir), JSON.stringify(next, null, 2)) } catch { /* 写不了不影响功能 */ }
  return next
}

// ---------- 日志解析：把脚本输出转成结构化进度 ----------

/** 从一行日志里提取阶段与百分比信息 */
function parseLine(line, state) {
  const s = { ...state }
  const stageDone = Array.isArray(s.stageDone) ? [...s.stageDone] : []
  const markDone = (k) => { if (k && !stageDone.includes(k)) stageDone.push(k) }

  // 阶段识别：既认「开始下载/安装」也认「已存在/跳过/校验通过」
  //
  // v0.2.5 修复 stageMB 反复清零：旧代码 `if (s.stageMBKey !== key) { s.stageMB = 0 }`
  // 在**同一阶段的多行日志**里都会走一遍 setStage（因为每行都可能命中阶段关键词），
  // 于是 stageMB 被反复重置为 0，进度永远涨不上去。
  // 现在只在**阶段真的变了**时才重置（且不依赖 stageMBKey 这种易被 Object.assign 覆盖的字段）。
  const setStage = (key, label, mb) => {
    const changed = s.stage !== key
    if (changed) {
      // 切换阶段：把之前的阶段标记完成
      if (s.stage) markDone(s.stage)
      s.stage = key
      s.stageLabel = label
      s.stageTotalMB = mb
      s.stageMB = 0          // 只有换阶段才清零
    } else if (!s.stageTotalMB) {
      // 同阶段重复命中：只补全 label/total，不动 stageMB
      s.stageLabel = label
      s.stageTotalMB = mb
    }
  }

  if (/下载 Ghidra|检测到已存在的 Ghidra/.test(line)) setStage('ghidra', 'Ghidra 12.1.4', SIZES.ghidra)
  else if (/下载 JADX|JADX 桥接已存在|JADX 桥接就绪/.test(line)) setStage('jadx', 'JADX 桥接', SIZES.jadx)
  else if (/尝试从仓库拉取|使用预编译反编译器|反编译器已存在|反编译器编译完成/.test(line)) setStage('decompiler', 'arm64 反编译器', SIZES.decompiler)
  else if (/apt 安装 openjdk|未找到 JDK|检测到 Java/.test(line)) setStage('jdk', 'JDK 21', SIZES.jdk)
  else if (/安装 rea-agents|检测到已安装 rea-agents/.test(line)) setStage('rea', 'rea-agents', SIZES.rea)

  // 完成/跳过标记 → 该阶段直接计入已完成
  if (/跳过 Ghidra/.test(line)) markDone('ghidra')
  if (/跳过反编译器/.test(line)) markDone('decompiler')
  if (/跳过 JADX/.test(line)) markDone('jadx')
  if (/检测到已存在的 Ghidra/.test(line)) markDone('ghidra')
  if (/JADX 桥接已存在且校验通过/.test(line)) markDone('jadx')
  if (/反编译器已存在且可执行/.test(line)) markDone('decompiler')
  if (/检测到 Java 21/.test(line)) markDone('jdk')
  if (/检测到已安装 rea-agents/.test(line)) markDone('rea')
  if (/缓存校验通过，直接复用/.test(line)) markDone('ghidra')
  if (/反编译器编译完成|JADX 桥接就绪/.test(line)) markDone(s.stage)

  s.stageDone = stageDone

  // 当前下载源
  const m = line.match(/尝试:\s*(\S+)/)
  if (m) s.source = m[1]

  // 完成标记
  if (/安装完成/.test(line)) {
    s.done = true
    s.percent = 100
    for (const k of ['jdk', 'rea', 'jadx', 'ghidra', 'decompiler']) markDone(k)
    s.stageDone = stageDone
  }

  return s
}

/**
 * 估算总体百分比。
 * 用「已完成阶段体积 + 当前阶段已下载体积」/ 目标总量。
 */
function computePercent(state, targetTier) {
  const order = targetTier === 'full'
    ? ['jdk', 'rea', 'jadx', 'ghidra', 'decompiler']
    : targetTier === 'ghidra-only'
      ? ['ghidra', 'decompiler']
      : ['jdk', 'rea', 'jadx']
  const sizeOf = { jdk: SIZES.jdk, rea: SIZES.rea, jadx: SIZES.jadx, ghidra: SIZES.ghidra, decompiler: SIZES.decompiler }

  const total = order.reduce((a, k) => a + sizeOf[k], 0)
  let done = 0
  const curIdx = order.indexOf(state.stage)
  for (let i = 0; i < order.length; i++) {
    if (state.stageDone && state.stageDone.includes(order[i])) done += sizeOf[order[i]]
    else if (i < curIdx) done += sizeOf[order[i]]
  }
  if (curIdx >= 0 && state.stageMB) done += Math.min(state.stageMB, sizeOf[order[curIdx]])
  return { total, done, percent: total ? Math.min(99, Math.round((done / total) * 100)) : 0 }
}

// ---------- 后台安装 ----------

/** 当前正在跑的安装进程（同一时间只允许一个） */
let current = null

export function isInstalling() { return current !== null }
export function currentProgress() { return current ? current.progress : null }

/**
 * 后台启动安装。
 * @param {string} pluginDir 插件目录（含 install-rea-ghidra.sh）
 * @param {'basic'|'full'} tier 目标环境
 * @param {(progress:object)=>void} onProgress 进度回调（写投影用）
 * @param {()=>Promise<void>} onDone 结束回调
 */
export function startInstall(pluginDir, tier, onProgress, onDone) {
  if (current) return { ok: false, error: 'ALREADY_RUNNING' }

  const script = path.join(pluginDir, 'install-rea-ghidra.sh')
  const args = []
  // tier 语义：
  //   basic       = 初级版本（JDK + rea + JADX，跳过 Ghidra）  → --skip-ghidra
  //   full        = 升级版本（+ Ghidra + 反编译器）
  //   ghidra-only = 只装 Ghidra（跳过 rea）                    → --skip-rea
  if (tier === 'basic') args.push('--skip-ghidra')
  else if (tier === 'ghidra-only') args.push('--skip-rea')
  if (process.env.REA_FORCE_COMPILE === '1') args.push('--compile')
  if (process.env.REA_INSTALL_DIR) args.push('--install-dir', process.env.REA_INSTALL_DIR)

  const child = spawn('bash', [script, ...args], {
    cwd: pluginDir,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    // v0.2.5：detached 让 bash 自成进程组，取消时可用 -pid 杀掉整棵进程树
    // （curl / tar / apt-get / npm 都是它的子进程，只 kill bash 会留下孤儿占带宽）
    detached: true,
  })

  const state = {
    tier,
    stage: null,
    stageLabel: null,
    stageMB: 0,
    stageTotalMB: 0,
    stageDone: [],
    source: null,
    percent: 0,
    startedAt: Date.now(),
    logTail: [],
    done: false,
    error: null,
  }

  // 记录上一阶段的完成
  const markStageDone = (st) => { if (st && !state.stageDone.includes(st)) state.stageDone.push(st) }

  // ── 文件大小轮询：可靠地推进 stageMB（P0 修复）────────────────────────
  // 每 1.5 秒 stat 当前阶段对应的输出文件；`bytes / (MB*1048576)` 即为该阶段进度。
  // 这比解析 curl 的 `\r` 进度行可靠（后者在脚本改 --no-progress-meter 后不再输出，
  // 且旧代码把 stderr 丢了根本拿不到）。文件不存在时保持 0。
  const sizeTicker = setInterval(() => {
    const file = STAGE_FILES[state.stage]
    if (!file || !state.stageTotalMB) return
    try {
      const bytes = fs.statSync(file).size
      if (bytes > 0) {
        const mb = state.stageTotalMB
        state.stageMB = Math.round((bytes / 1048576))
        const p = computePercent(state, tier)
        state.percent = state.done ? 100 : p.percent
        state.totalMB = p.total
        state.doneMB = p.done
        state.downloadedMB = Math.round(bytes / 1048576)
        if (onProgress) onProgress({ ...state })
      }
    } catch { /* 文件还没创建 */ }
  }, 1500)

  const handle = (chunk) => {
    const text = String(chunk)
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\u001b\[[0-9;]*m/g, '').trim()
      if (!line) continue
      const before = state.stage
      Object.assign(state, parseLine(line, state))
      if (state.stage && before && state.stage !== before) { markStageDone(before); state.stageMB = 0 }

      // curl 进度行：形如 "  45  234M   45  234M    0     0  1234k ..."
      const pm = line.match(/(\d{1,3})\s+\d+(?:\.\d+)?[kKMGT]?\s+(\d{1,3})?/)
      if (pm && /[kKMGT]/.test(line)) {
        const pct = parseInt(pm[1], 10)
        if (pct >= 0 && pct <= 100 && state.stageTotalMB) state.stageMB = Math.round(state.stageTotalMB * pct / 100)
      }
      // 百分比形式的进度（curl --progress-bar 风格）
      const bm = line.match(/(\d{1,3}(?:\.\d+)?)%/)
      if (bm && state.stageTotalMB) {
        const pct = parseFloat(bm[1])
        if (pct >= 0 && pct <= 100) state.stageMB = Math.round(state.stageTotalMB * pct / 100)
      }

      state.logTail.push(line)
      if (state.logTail.length > 40) state.logTail.shift()

      const p = computePercent(state, tier)
      state.percent = state.done ? 100 : p.percent
      state.totalMB = p.total
      state.doneMB = p.done
    }
    if (onProgress) onProgress({ ...state })
  }

  child.stdout.on('data', handle)
  child.stderr.on('data', handle)

  child.on('error', (e) => {
    clearInterval(sizeTicker)
    state.error = e.message
    state.done = true
    current = null
    if (onProgress) onProgress({ ...state })
    if (onDone) onDone({ ok: false, error: e.message, tier })
  })

  child.on('close', (code) => {
    clearInterval(sizeTicker)
    state.done = true
    state.exitCode = code
    if (code !== 0 && !state.error) state.error = `安装脚本退出码 ${code}`
    current = null
    if (onProgress) onProgress({ ...state })
    if (onDone) onDone({ ok: code === 0, error: state.error, tier })
  })

  current = { child, progress: state, tier, sizeTicker }
  return { ok: true, tier }
}

/** 取消安装。cleanCache=true 时删除已下载的缓存（用户选择"不保留"）。 */
export async function cancelInstall(pluginDir, cleanCache) {
  if (!current) return { ok: false, error: 'NOT_RUNNING' }
  const { child, sizeTicker } = current
  if (sizeTicker) clearInterval(sizeTicker)

  // v0.2.5：杀**整棵进程树**。detached 模式下 bash 是进程组组长（pgid === pid），
  // 用 `-pid` 发信号可一次性带走 curl / tar / apt-get / npm 等子进程；
  // 只 `child.kill()` 会留下孤儿继续占带宽、写文件。
  const pgid = child.pid
  const killGroup = (sig) => {
    if (!pgid) return
    try { process.kill(-pgid, sig) } catch { /* 组已不存在 */ }
    try { child.kill(sig) } catch { /* 已退出 */ }
  }

  killGroup('SIGTERM')
  // 给 2 秒优雅退出，否则强杀
  await new Promise((r) => setTimeout(r, 2000))
  killGroup('SIGKILL')

  if (cleanCache) {
    try { await fsp.rm(PATHS.zipCache, { force: true }) } catch { /* 无缓存 */ }
    try { await fsp.rm('/opt/rea-install-kit', { recursive: true, force: true }) } catch { /* 不存在 */ }
  }
  current = null
  await writeState(pluginDir, { installing: false, cancelledAt: Date.now(), lastError: null })
  return { ok: true, cleaned: !!cleanCache }
}
