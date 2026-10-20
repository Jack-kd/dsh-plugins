// rea-tools —— 把 REA + Ghidra + JADX 的逆向能力包装成 DSH 原生工具。
//
// 设计：刻意做成**薄薄一层命令行胶水**。
// 真正干活的是 rea 命令行（REA / Ghidra / JADX 由同目录 install-rea-ghidra.sh 安装），
// 本插件只负责：参数校验 → 调 rea → 整理输出。不重复实现任何逆向逻辑。
//
// 环境变量（GHIDRA_INSTALL_DIR / JAVA_HOME / REA_JADX_MCP_JAR）在子进程环境里显式设置，
// 不依赖 .bashrc、不依赖外部包装脚本 —— 换新环境装上插件即可用。

import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  detectState, readState, writeState, startInstall, cancelInstall,
  isInstalling, currentProgress, PATHS, SIZES, VERSIONS,
} from './install-manager.js'

export const name = 'rea'
export const inject = ['tools']

const __dirname = dirname(fileURLToPath(import.meta.url))
// v0.2.6：INSTALL_SCRIPT 常量已删除——rea_install 改走 startInstall（install-manager
// 内部自己拼脚本路径），这里不再需要，留着是死代码。

// v0.2.6：环境变量默认值改为从 install-manager 的 PATHS 派生，不再重复硬编码版本号
// （旧版这里写死 12.1.4 / 0.7.1，与 PATHS 重复，升级时容易漏改一处导致探测/运行路径不一致）
const ENV_DEFAULTS = {
  GHIDRA_INSTALL_DIR: PATHS.ghidraDir,
  JAVA_HOME: PATHS.javaHome,
  REA_JADX_MCP_JAR: PATHS.jadxJar,
}

function reaEnv() {
  const env = { ...process.env }
  for (const [k, v] of Object.entries(ENV_DEFAULTS)) {
    if (env[k] === undefined) env[k] = v
  }
  return env
}

function run(cmd, args = [], opts = {}) {
  const { timeoutMs = 600000, maxBuffer = 128 * 1024 * 1024, env = reaEnv() } = opts
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env, timeout: timeoutMs, maxBuffer }, (err, stdout, stderr) => {
      if (err) {
        const tail = String(stderr || stdout || '').slice(-3000)
        reject(new Error(`${err.message}\n${tail}`))
        return
      }
      resolve(stdout)
    })
  })
}

/** 快速判断 rea 是否已装（走 PATH，不启动 Node 慢加载） */
async function reaAvailable() {
  try {
    await run('sh', ['-c', 'command -v rea'], { timeoutMs: 10000 })
    return true
  } catch {
    return false
  }
}

/** 去掉 rea 输出的 {"rea_progress":...} 进度行，只留结果 */
function stripProgress(out) {
  return out.split('\n')
    .filter((l) => !(l.startsWith('{') && l.includes('"rea_progress"')))
    .join('\n')
}

const NOT_INSTALLED = 'rea 尚未安装。请先调用 rea_install 工具（约 3–5 分钟，装 REA + Ghidra + JADX）。'

/** 分析类工具的统一构造：先确认 rea 在，再执行，再去进度行 */
function reaTool(spec) {
  return defineTool({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters || {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      if (!(await reaAvailable())) throw new Error(NOT_INSTALLED)
      const args2 = spec.buildArgs(args)
      if (spec.tolerateExit) {
        // doctor 在环境不全是 healthy 时退出码非 0，但输出仍然有用 —— 容忍该退出码。
        // v0.2.5：不再用裸 `; true`（它会把 OOM killed、段错误、命令不存在等
        // **真正的崩溃**也吞成「正常输出」）。这里显式记录退出码，崩溃时带上提示。
        const cmd = `rea ${args2.map((x) => JSON.stringify(x)).join(' ')}; __rc=$?; if [ "$__rc" -ge 128 ]; then echo "[rea-tools] 命令异常终止（信号 $((__rc-128))），输出可能不完整" >&2; fi; exit 0`
        const out = await run('sh', ['-c', cmd], { timeoutMs: spec.timeoutMs || 600000 })
        return stripProgress(out)
      }
      const out = await run('rea', args2, { timeoutMs: spec.timeoutMs || 600000 })
      return stripProgress(out)
    },
  })
}

export function apply(ctx) {
  const tools = [
    // 安装器：不走 reaAvailable 门（它本身就是来装 rea 的）
    defineTool({
      name: 'rea_install',
      description: '安装 / 更新 REA + Ghidra + JADX 逆向工具链（幂等：已装好的部分自动跳过）。'
        + '全新环境第一步先调这个。**后台安装、立即返回**（不阻塞工具调用）：'
        + '543MB 的 Ghidra 约需 10–20 分钟，进度可在输入框上方胶囊、或再调 rea_status 查看。'
        + '装完不会自动跑 rea doctor，需要时再调 rea_doctor 验证。',
      parameters: {
        skip_rea: { type: 'boolean', description: '只装 Ghidra，跳过 rea（默认 false）' },
        compile: { type: 'boolean', description: '强制从源码编译反编译器（默认 false，用预编译包）' },
        install_dir: { type: 'string', description: '自定义 Ghidra 安装目录（默认 /opt/ghidra_12.1.4_PUBLIC）' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(args) {
        // v0.2.5 关键修复：改为**后台非阻塞**。
        // 旧实现 `await run(..., timeoutMs: 1200000)` 同步阻塞 20 分钟，
        // 543MB 下载正好卡在超时临界点——超时即被 kill、下载中断，
        // 与 install-manager.js 头注释「安装不占用工具调用」的设计自相矛盾。
        // 现在统一走 startInstall（后台 + 进度投影），立即返回。
        if (isInstalling()) {
          const p = currentProgress()
          return `已有安装正在进行中（${p && p.percent ? p.percent + '%' : '启动中'}）。`
            + '可在输入框上方胶囊查看进度，或再调 rea_status。'
        }
        // --skip-rea / --compile / --install-dir 仍通过环境变量传给脚本（startInstall 只区分 tier）
        if (args.skip_rea) process.env.REA_SKIP_REA = '1'
        if (args.compile) process.env.REA_FORCE_COMPILE = '1'
        if (args.install_dir) process.env.REA_INSTALL_DIR = args.install_dir

        const tier = args.skip_rea ? 'ghidra-only' : 'full'
        await writeState(__dirname, { installing: true, targetTier: tier, dismissed: true, lastError: null })
        ui.dismissed = true
        ui.showDialog = false
        const r = startInstall(__dirname, args.skip_rea ? 'ghidra-only' : 'full', syncProgress, onInstallDone)
        if (!r.ok) {
          ui.installing = false
          await writeState(__dirname, { installing: false })
          return `启动后台安装失败：${r.error || '未知错误'}`
        }
        publish()
        return '已开始**后台安装**（不阻塞本次调用）。\n'
          + '· Ghidra 543MB 经加速镜像约需 10–20 分钟；JADX 41MB 约 1–2 分钟。\n'
          + '· 进度看输入框上方胶囊，或再调 rea_status 查询。\n'
          + '· 装完可调 rea_doctor 验证；中途可用设置页「取消安装」停止。'
      },
    }),

    reaTool({
      name: 'rea_doctor',
      description: '检查 REA 就绪状态（node / ghidra / 反编译器 / JADX 等项是否 healthy）。'
        + '分析前建议先调一次确认。约 30 秒。'
        + '注意：有非 healthy 项时命令仍会返回完整检查报告（此时退出码非 0，插件已处理）。',
      buildArgs: () => ['doctor'],
      tolerateExit: true,
      timeoutMs: 120000,
    }),

    reaTool({
      name: 'rea_analyze',
      description: '分析一个原生二进制 / 应用，返回整体概览（段、函数数、字符串数、符号等）。',
      parameters: {
        path: { type: 'string', required: true, description: '目标二进制 / 应用路径（绝对路径）' },
      },
      buildArgs: (a) => ['analyze', a.path, '--format', 'json'],
      timeoutMs: 600000,
    }),

    reaTool({
      name: 'rea_function',
      description: '反编译 / 分析单个函数，返回伪代码、汇编、调用关系（走 Ghidra）。',
      parameters: {
        path: { type: 'string', required: true, description: '目标二进制路径（绝对路径）' },
        procedure: { type: 'string', required: true, description: '函数名或地址，如 secret_add 或 0x1008a8' },
      },
      buildArgs: (a) => ['function', a.path, '--procedure', a.procedure, '--format', 'json'],
      timeoutMs: 600000,
    }),

    reaTool({
      name: 'rea_inspect_apk',
      description: '分析一个 APK：包名 / 版本 / 权限 / Manifest / 类与资源统计（静态逆向，不运行目标代码）。',
      parameters: {
        apk: { type: 'string', required: true, description: 'APK 文件路径（绝对路径）' },
      },
      buildArgs: (a) => ['inspect-android-package', a.apk, '--format', 'json'],
      timeoutMs: 600000,
    }),

    reaTool({
      name: 'rea_inspect_apk_class',
      description: '查看 APK 中某个类的成员清单（方法 / 字段 / 内部类）。先 rea_inspect_apk 拿包信息。',
      parameters: {
        apk: { type: 'string', required: true, description: 'APK 文件路径' },
        class_name: { type: 'string', required: true, description: '完整限定类名，如 org.schabi.newpipe.MainActivity' },
      },
      buildArgs: (a) => ['inspect-android-class', a.apk, a.class_name, '--format', 'json'],
      timeoutMs: 600000,
    }),

    reaTool({
      name: 'rea_inspect_apk_method',
      description: '反编译 APK 中某个方法为 Java 代码。先 rea_inspect_apk_class 确认方法名。',
      parameters: {
        apk: { type: 'string', required: true, description: 'APK 文件路径' },
        class_name: { type: 'string', required: true, description: '完整限定类名' },
        method_name: { type: 'string', required: true, description: '方法名，如 onCreate' },
        overload_index: { type: 'number', description: '重载方法下标（0 起），有同名重载且歧义时指定' },
      },
      buildArgs: (a) => {
        const cmd = ['inspect-android-method', a.apk, a.class_name, a.method_name]
        if (a.overload_index !== undefined) cmd.push('--overload-index', String(a.overload_index))
        cmd.push('--format', 'json')
        return cmd
      },
      timeoutMs: 600000,
    }),
  ]

  // 逐个注册，并把结果写成自检文件（"装上了" ≠ "真的注册成功"，留个可读证据）
  // v0.2.5：改写到插件目录（随插件走），不再写 /tmp（重启会被清、多用户会冲突）。
  let ok = 0
  const failed = []
  for (const t of tools) {
    try {
      ctx.tools.register(t)
      ok++
    } catch (e) {
      failed.push(`${t.name}: ${e && e.message ? e.message : String(e)}`)
    }
  }
  try {
    fs.writeFileSync(join(__dirname, '.rea-plugin-selfcheck.json'), JSON.stringify({
      plugin: '@local/rea-tools',
      time: new Date().toISOString(),
      registered: ok,
      total: tools.length,
      failed,
    }, null, 2))
  } catch { /* 自检文件写不了不影响插件功能 */ }

  if (failed.length > 0) {
    throw new Error(`rea-tools 部分工具注册失败: ${failed.join('; ')}`)
  }

  // ========================================================================
  // v0.2.0 UI 支撑：环境状态 + 后台安装
  //
  // 设计：安装**不占用工具调用**，因此不受工具超时（1200s）限制。
  // 543MB 经镜像约需 20 分钟，正好卡在旧的阻塞式超时临界点，改后台后该问题消失。
  // 客户端通过 sessionProjections 读取状态，不做轮询。
  // ========================================================================

  // 内存中的状态快照（投影与命令都读它；落盘只用于跨重启的续传判断）
  const ui = {
    tier: 'none',
    installing: false,
    percent: 0,
    stageLabel: null,
    source: null,
    doneMB: 0,
    totalMB: 0,
    targetTier: null,
    doneStages: [],
    logTail: [],
    lastError: null,
    dismissed: false,
    showDialog: false,   // 客户端据此决定是否弹窗
  }

  const refreshFromDisk = () => {
    const st = detectState(__dirname)
    ui.tier = st.tier
    ui.dismissed = st.dismissed
    ui.resumable = st.resumable
    ui.cacheMB = st.cacheMB
    ui.lastError = ui.lastError || st.lastError
    // 仅首次（未装、未忽略、未在装）才弹窗
    ui.showDialog = st.tier === 'none' && !st.dismissed && !st.installing && !isInstalling()
  }
  refreshFromDisk()

  const syncProgress = (p) => {
    ui.installing = true
    ui.percent = p.percent || 0
    ui.stageLabel = p.stageLabel || p.stage || null
    ui.source = p.source
    ui.doneMB = p.doneMB || 0
    ui.totalMB = p.totalMB || 0
    ui.logTail = p.logTail || []
    if (p.tier) ui.targetTier = p.tier
    ui.doneStages = Array.isArray(p.stageDone) ? p.stageDone : []
  }

  const onInstallDone = async ({ ok, error, tier }) => {
    ui.installing = false
    // v0.2.6：安装结束给一次性提示（旧版胶囊直接消失，用户不知道成没成）
    ui.justFinished = ok ? 'success' : 'error'
    ui.finishText = ok ? 'REA 逆向环境已就绪' : ('安装失败：' + (error || '未知错误'))
    if (ok) {
      ui.percent = 100
      ui.lastError = null
      // 成功 → 清零失败计数，避免历史失败影响下次续传判断
      await writeState(__dirname, { installing: false, installedTier: tier, installedAt: Date.now(), lastError: null, failCount: 0 })
    } else {
      ui.lastError = error || '安装失败'
      // v0.2.5：累计失败次数（上限判断在 detectState.resumable，防止失败后无限自动续传）
      const cur = await readState(__dirname)
      await writeState(__dirname, { installing: false, lastError: ui.lastError, failCount: (cur.failCount || 0) + 1 })
    }
    refreshFromDisk()
    ui.showDialog = false   // 无论成败都不再弹窗（失败可在入口里重试）
    publish()
    // 15 秒后清除完成提示（避免长期挂在胶囊上）
    setTimeout(() => { ui.justFinished = null; ui.finishText = null; publish() }, 15_000)
  }

  // ---- 投影：客户端用 useProjection('rea') 读取 ----
  const anySchema = { parse: (v) => v }
  let listeners = []
  const publish = () => { for (const fn of listeners) { try { fn() } catch { /* 忽略 */ } } }

  // 事件驱动：任一个 rea_* 工具被调用 → 置「REA 逆向中」，返回后清除
  // （与 gh-accel 同一套投影机制，由框架投喂 tool/call、tool/result 事件）
  const REA_TOOLS = ['rea_install', 'rea_doctor', 'rea_analyze', 'rea_function',
    'rea_inspect_apk', 'rea_inspect_apk_class', 'rea_inspect_apk_method', 'rea_status']

  // 工具名 → 胶囊上的中文操作描述
  const REA_LABELS = {
    rea_install: '安装环境',
    rea_doctor: '环境检查',
    rea_analyze: '分析二进制',
    rea_function: '反编译函数',
    rea_inspect_apk: '分析 APK',
    rea_inspect_apk_class: '分析 APK 类',
    rea_inspect_apk_method: '反编译 APK 方法',
    rea_status: '环境状态',
  }

  const projection = {
    key: 'rea',
    stateVersion: 4,
    stateSchema: anySchema,
    init: () => ({ calls: [] }),
    apply(state, event) {
      if (event.type === 'tool/call') {
        const { callId, name, arguments: argsRaw } = event.data || {}
        if (!REA_TOOLS.includes(name) || !callId) return state
        const exists = Array.isArray(state.calls) && state.calls.some((c) => (typeof c === 'object' && c !== null) ? c.callId === callId : c === callId)
        if (exists) return state
        // 从参数里取文件路径（apk / path）→ basename，作为胶囊上的目标文件名
        let target = null
        try {
          const args = (typeof argsRaw === 'string' ? JSON.parse(argsRaw) : (argsRaw || {}))
          const p = args && typeof args.apk === 'string' ? args.apk
            : (args && typeof args.path === 'string' ? args.path : null)
          if (typeof p === 'string' && p.trim()) {
            target = p.split(/[\\/]/).pop() || p
          }
        } catch { /* 参数解析失败不影响胶囊 */ }
        const entry = { callId, name, target }
        return { calls: Array.isArray(state.calls) ? [...state.calls, entry] : [entry] }
      }
      if (event.type === 'tool/result') {
        const callId = event.data?.message?.toolCallId
        if (!callId || !Array.isArray(state.calls)) return state
        const has = state.calls.some((c) => (typeof c === 'object' && c !== null) ? c.callId === callId : c === callId)
        if (!has) return state
        return { calls: state.calls.filter((c) => (typeof c === 'object' && c !== null) ? c.callId !== callId : c !== callId) }
      }
      return state
    },
    wire: {
      viewSchema: anySchema,
      view: (state) => {
        const calls = (state && Array.isArray(state.calls)) ? state.calls : []
        const active = calls.length > 0
        // 取最近一个正在执行的 rea 工具的中文操作描述
        const last = calls.length ? calls[calls.length - 1] : null
        const activeLabel = last ? (REA_LABELS[last.name] || last.name) : null
        const activeTarget = (last && last.target) || null
        return {
          tier: ui.tier,
          installing: ui.installing,
          percent: ui.percent,
          stageLabel: ui.stageLabel,
          source: ui.source,
          doneMB: ui.doneMB,
          totalMB: ui.totalMB,
          logTail: ui.logTail,
          lastError: ui.lastError,
          dismissed: ui.dismissed,
          showDialog: ui.showDialog,
          resumable: ui.resumable || false,
          cacheMB: ui.cacheMB || 0,
          targetTier: ui.targetTier || null,
          doneStages: ui.doneStages || [],
          // v0.2.6：安装结束的一次性提示（客户端据此显示「✓ 已就绪」或「✗ 失败」）
          justFinished: ui.justFinished || null,
          finishText: ui.finishText || null,
          active,
          activeLabel,
          activeTarget,
          sizes: SIZES,
          versions: VERSIONS,
        }
      },
    },
  }

  const registerProjection = (p) => {
    try {
      ctx.effect(() => p.register(projection, 'rea: 环境状态与安装进度'))
    } catch (e) {
      console.warn('[rea-tools] 投影注册失败:', e && e.message ? e.message : e)
    }
  }
  try {
    const projections = ctx.get('sessionProjections')
    if (projections !== undefined) registerProjection(projections)
    else if (typeof ctx.inject === 'function') {
      ctx.inject(['sessionProjections'], (inner) => {
        const p = inner.get('sessionProjections')
        if (p !== undefined) registerProjection(p)
      })
    }
  } catch (e) {
    console.warn('[rea-tools] 获取 sessionProjections 失败:', e && e.message ? e.message : e)
  }

  // ---- 会话命令：客户端 UI 通过 ctx.remote.commands.execute() 调用 ----
  // 文档指定的 UI→宿主 调用方式（references/user-actions.md）。
  const doInstall = async (tier, remember = true) => {
    if (isInstalling()) return { kind: 'error', text: '已有安装在进行中' }
    const t = tier === 'full' ? 'full' : (tier === 'ghidra-only' ? 'ghidra-only' : 'basic')
    // v0.2.6：respect「记住我的选择」——勾选才写 dismissed=true（以后不再弹窗）；
    // 未勾选则保持 dismissed 原值，下次启动仍会询问。
    const patch = { installing: true, targetTier: t, lastError: null }
    if (remember) patch.dismissed = true
    await writeState(__dirname, patch)
    if (remember) ui.dismissed = true
    ui.showDialog = false
    ui.lastError = null
    const r = startInstall(__dirname, t, syncProgress, onInstallDone)
    if (!r.ok) {
      ui.installing = false
      await writeState(__dirname, { installing: false })
      return { kind: 'error', text: '启动失败：' + (r.error || '未知错误') }
    }
    publish()
    const label = t === 'basic' ? '初级版本（APK 逆向）'
      : t === 'ghidra-only' ? '仅 Ghidra（原生二进制）' : '升级版本（+ 原生二进制）'
    return { kind: 'success', text: `已开始后台安装 ${label}，可在输入框上方查看进度。` }
  }

  const doDismiss = async () => {
    await writeState(__dirname, { dismissed: true })
    ui.dismissed = true
    ui.showDialog = false
    publish()
    return { kind: 'success', text: '已跳过。之后可在「设置 → 通用 → REA 逆向环境」中安装。' }
  }

  const doCancel = async (keepCache) => {
    if (!isInstalling()) return { kind: 'error', text: '当前没有进行中的安装' }
    await cancelInstall(__dirname, keepCache === false)
    ui.installing = false
    ui.lastError = keepCache === false ? '已取消安装，并清理了已下载的缓存' : '已取消安装，已下载的部分已保留'
    refreshFromDisk()
    publish()
    return { kind: 'success', text: ui.lastError }
  }

  try {
    ctx.inject(['commands'], (c) => {
      const reg = (name, description, handler) => {
        try {
          ctx.effect(() => c.commands.register({
            definitionId: `@local/rea-tools#${name}`,
            name,
            description,
            handler,
          }))
        } catch (e) {
          console.warn(`[rea-tools] 注册命令 ${name} 失败:`, e && e.message ? e.message : e)
        }
      }
      // v0.2.6：handler 接收调用参数串，「--no-remember」表示不记忆选择
      const rememberOf = (argsRaw) => !(typeof argsRaw === 'string' && /--no-remember/.test(argsRaw))
      reg('rea-install-basic', '后台安装 REA 初级版本（APK 逆向）', async (argsRaw) => doInstall('basic', rememberOf(argsRaw)))
      reg('rea-install-full', '后台安装 REA 升级版本（含 Ghidra）', async (argsRaw) => doInstall('full', rememberOf(argsRaw)))
      reg('rea-dismiss', '忽略 REA 环境安装提示', async () => doDismiss())
      reg('rea-cancel', '取消正在进行的 REA 安装（保留已下载缓存）', async () => doCancel(true))
      reg('rea-cancel-clean', '取消 REA 安装并清理已下载缓存', async () => doCancel(false))
    })
  } catch (e) {
    console.warn('[rea-tools] 命令注册不可用:', e && e.message ? e.message : e)
  }

  // ---- 工具：让 AI 也能查询/启动安装（与 UI 走同一套逻辑）----
  try {
    ctx.tools.register(defineTool({
      name: 'rea_status',
      description: '查询 REA 逆向环境状态（未安装 / 初级版本 / 升级版本 / 安装中）与下载进度。'
        + '轻量（毫秒级），可在分析前先调一次判断是否需要安装。',
      parameters: {},
      output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
      async execute() {
        const st = detectState(__dirname)
        const p = currentProgress()
        const lines = [
          `状态: ${st.tier === 'none' ? '未安装' : st.tier === 'basic' ? '初级版本（APK 逆向）' : st.tier === 'full' ? '升级版本（APK + 原生二进制）' : '部分安装'}`,
          `组件: JDK=${st.components.jdk ? '✔' : '✘'} rea=${st.components.rea ? '✔' : '✘'} JADX=${st.components.jadx ? '✔' : '✘'} Ghidra=${st.components.ghidra ? '✔' : '✘'}`,
        ]
        if (st.cacheMB > 0 && st.tier !== 'full') lines.push(`已下载缓存: ${st.cacheMB} MB（可续传）`)
        if (p && ui.installing) lines.push(`安装中: ${p.percent || 0}%（${p.stageLabel || '准备中'}）`)
        if (st.lastError) lines.push(`上次错误: ${st.lastError}`)
        if (st.tier === 'none') lines.push('提示: 可调用 rea_install 安装（初级版本省 543MB，仅 APK 逆向足够）。')
        else if (st.tier === 'basic') lines.push('提示: 如需原生二进制逆向（rea_analyze / rea_function），可升级安装 Ghidra。')
        return lines.join('\n')
      },
    }))
  } catch (e) {
    console.warn('[rea-tools] rea_status 注册失败:', e && e.message ? e.message : e)
  }

  // ---- 启动时：若上次点了后台安装但没装完 → 静默续传（不弹窗）----
  ctx.effect(() => {
    const t = setTimeout(async () => {
      try {
        const st = detectState(__dirname)
        if (st.resumable && st.tier !== 'full' && !isInstalling()) {
          console.log('[rea-tools] 检测到未完成的安装，静默续传…')
          const saved = await readState(__dirname)
          await doInstall(saved.targetTier || 'basic')
        }
      } catch (e) {
        console.warn('[rea-tools] 续传检查失败:', e && e.message ? e.message : e)
      }
    }, 3000)
    return () => clearTimeout(t)
  }, 'rea-tools: 续传检查')
}
