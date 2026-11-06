// rea-craft-mix —— REA 与 Craft Anything 的融合宿主半部。
//
// 设计（照 rea-tools 的"薄壳胶水"范式）：
//   - 不重复实现任何逆向逻辑。REA 的反编译走 `rea` 命令，Craft Anything 走
//     `craft-anything-cli`，本插件只做：参数校验 → 选路（REA 还是 CA）→ 调 CLI → 整理输出。
//   - 命名分三组：
//       rea_*  → 原样暴露 REA 的能力（深度 APK / 原生反编译）
//       cad_*  → 薄壳包 Craft Anything 高频工具（321 工具里精选，deep 模式读真实内容）
//       mix_*  → 融合专用：状态监测 / 统一引擎就绪
//   - craft-anything 工具在 clean-room 模式默认不读原版内部；本插件统一在分析类工具
//     调用时附加 --deep，让 AI 真正拿到代码/资源（clean-room 语义由用户显式关掉时才有意义）。
//
// 环境：craft-anything 与 REA 的引擎路径由 install-manager.js 统一探测 + 注入。

import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  probeEngines, buildStatus, injectEnginesIntoCraft, missingEngines,
} from './install-manager.js'

export const name = 'rea-craft-mix'
export const inject = ['tools']

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---------- 低层执行封装 ----------
function run(cmd, args = [], opts = {}) {
  const { timeoutMs = 300000, maxBuffer = 128 * 1024 * 1024, env = process.env } = opts
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

async function hasCmd(cmdName) {
  try {
    await run('sh', ['-c', `command -v ${cmdName}`], { timeoutMs: 10000 })
    return true
  } catch { return false }
}

/** 去掉 craft-anything 输出的 evidence JSON 包裹，只留对 agent 有用的部分 */
function stripJsonEnvelope(raw) {
  try {
    const d = JSON.parse(raw)
    // 保留 result 与 summary、subject
    const parts = []
    if (d.result !== undefined) parts.push('Result:\n' + JSON.stringify(d.result, null, 2))
    if (d.summary) parts.push('Summary: ' + d.summary)
    if (d.subject) parts.push('Subject: ' + (d.subject.name || JSON.stringify(d.subject)))
    if (parts.length) return parts.join('\n\n')
    return raw
  } catch {
    return raw
  }
}

// ---------- 工具注册 ----------

export function apply(ctx) {
  const tools = ctx.tools
  if (!tools || typeof tools.register !== 'function') {
    console.warn('[rea-craft-mix] ctx.tools.register 不可用，工具注册中止')
    return
  }

  // ---- mix_doctor：统一引擎就绪 + 注入 REA 引擎路径到 craft-anything ----
  tools.register(defineTool({
    name: 'mix_doctor',
    description:
      'rea-craft-mix 融合自检：探测 REA 与 Craft Anything 两套引擎的安装位置，'
      + '并把 REA 已装的 JADX/Apktool/Ghidra 路径**注入**到 craft-anything 配置里，'
      + '返回统一就绪面板。谁缺会明确标注、给出修复方向。'
      + '首次用融合能力前建议先调一次。',
    parameters: {
      repair: { type: 'boolean', description: '为 true 时顺便执行注入修复（默认 true）' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) {
      const e = await probeEngines()
      const status = buildStatus(e)
      if (!e.craftCli || !e.reaCli) {
        return '未检测到 rea 和/或 craft-anything-cli。请先安装：\n'
          + '  REA → 调 rea_install\n'
          + '  Craft Anything → 调 cad_install\n'
          + '或检查两者是否已在 PATH（rea / craft-anything-cli）。'
          + '\n\n当前探测：\n' + JSON.stringify(e, null, 2)
      }
      const lines = []
      lines.push('## rea-craft-mix 引擎就绪')
      for (const k of ['reaCli', 'craftCli', 'ghidra', 'jadx', 'apktool', 'java']) {
        if (e[k] === undefined) continue
        lines.push(`- ${k}: ${e[k] ? '✅ ' + e[k] : '❌ 未找到'}`)
      }
      lines.push(`\n核心引擎 ${status.satisfied ? '✅ 齐备' : '⚠️ 基本可用'}`)
      if (args.repair === false) {
        lines.push(`\n（本次未执行注入；缺口：${missingEngines(e).join(', ') || '无'}）`)
      } else {
        const injected = await injectEnginesIntoCraft(e)
        lines.push('\n注入结果（同步 REA → craft-anything 配置）：')
        const label = { jadx: 'JADX', apktool: 'Apktool', ghidraJava: 'Ghidra Java' }
        for (const [k, r] of Object.entries(injected.results || {})) {
          const mark = r.ok ? '✅' : (r.optional ? '⚠️(可选)' : '❌')
          lines.push(`  - ${label[k] || k}: ${mark} ${r.error || r.set || ''}`)
        }
        lines.push(injected.ok ? '  → 全部注入完成，两端已共享引擎。' : '  → 部分未注入（多为可选缺件）。')
      }
      return lines.join('\n')
    },
  }))

  // ---- mix_inject：单独重跑引擎路径注入（幂等，UI 按钮同款）----
  tools.register(defineTool({
    name: 'mix_inject',
    description: '把 REA 已装的 JADX / Apktool / Ghidra-java 路径重新注入到 craft-anything 配置里（幂等，用于设置改了路径后同步）。',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute() {
      const engines = await probeEngines()
      const injected = await injectEnginesIntoCraft(engines)
      const lines = []
      const label = { jadx: 'JADX', apktool: 'Apktool', ghidraJava: 'Ghidra Java' }
      for (const [k, r] of Object.entries(injected.results || {})) {
        const done = r.ok ? '✅' : (r.optional ? '⚠️(可选)' : '❌')
        lines.push(`- ${label[k] || k}: ${done} ${r.error || r.set || ''}`)
      }
      lines.push(injected.ok ? '\n已全部注入 craft-anything 配置。' : '\n部分引擎未注入（详见上），多为可选缺件。')
      return lines.join('\n')
    },
  }))

  // ---- 通用 craft-anything 薄壳构造器 ----
  // 每个 spec: { name, description, cli (工具id), params, deep (默认 true), textArgs }
  // 注意：name 是硬依赖 —— DSH 里所有工具名必须唯一且非 undefined，
  // 否则会注册成重复的 `undefined` 工具，污染 request/header 触发
  // `carries non-JSON-serializable data` 崩溃。调用方必须从对象 key 传入 name。
  function caTool(spec) {
    if (!spec || typeof spec.name !== 'string' || !spec.name) {
      throw new Error(`caTool: spec 缺少合法 name（收到 ${String(spec && spec.name)}）`)
    }
    // 由 spec.params 生成 JSON parameters schema。
    // 每个 key 声明为可选 string；flags 里的 key 声明为 optional boolean。
    const paramsSchema = {}
    for (const k of Object.keys(spec.params || {})) {
      const isFlag = spec.flags && spec.flags[k] === true
      paramsSchema[k] = isFlag
        ? { type: 'boolean', description: `可选开关：--${k}` }
        : { type: 'string', description: `参数 --${k}` }
    }
    return defineTool({
      name: spec.name,
      description: spec.description,
      parameters: paramsSchema,
      output: {
        schema: { type: 'string' },
        render: (_a, v) => [{ type: 'text', text: String(v) }],
      },
      async execute(args) {
        if (!(await hasCmd('craft-anything-cli'))) {
          throw new Error('craft-anything-cli 未找到。请先调 cad_install 安装，或确认其在 PATH。')
        }
        const argv = [spec.cli]
        // 位置参数目标：native-functions-list / native-strings-browse 用 <target-path>，
        // 其余命令用带状旗标。path 放位置时跳过旗标。
        const argNames = Object.keys(spec.params || {})
        for (const [k, v] of Object.entries(spec.params || {})) {
          if (v === undefined || v === null || v === false) continue
          argv.push(`--${k}`, String(v))
        }
        // 由 args 提供的同名参数覆盖 —— 参数名蛇形转 kebab（class_name → class-name）
        for (const [k, v] of Object.entries(args || {})) {
          if (v === undefined) continue
          if (spec.flags && spec.flags[k]) {
            if (v === true || v === 'true') argv.push(`--${k}`)
            continue
          }
          const flag = `--${k.replace(/_/g, '-')}`
          if (spec.positionalTarget && k === 'path') { argv.push(String(v)); continue }
          argv.push(flag, String(v))
        }
        // cad_* 默认走 Deep mode（craft-anything 默认 clean_room 会拦截读目标，
        // 必须 --deep 才能分析文件内容）。个别不想用 deep 的 spec 设 deep:false。
        if (spec.deep !== false) argv.push('--deep')
        try {
          const out = await run('craft-anything-cli', argv)
          return stripJsonEnvelope(out)
        } catch (err) {
          throw new Error(`craft-anything ${spec.cli} 失败：${err.message}`)
        }
      },
    })
  }

  // ---- cad_install：检查/引导安装 Craft Anything CLI（可选）----
  // 本机已装（/opt/craft-anything/bin），但其它环境可能没有；这里给出探测与引导。
  tools.register(defineTool({
    name: 'cad_install',
    description:
      '检查 craft-anything-cli 是否已安装，并给出安装指引。'
      + '本机若已装会直接报告路径；未装则提示下载官方 aarch64 release。',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute() {
      const engines = await probeEngines()
      if (engines.craftCli) {
        return `craft-anything-cli 已就绪：${engines.craftCli}\n`
          + `Ghidra（共享 REA）：${engines.ghidra || '未找到'}\n`
          + `JADX（来自 REA）：${engines.jadx || '未找到（可调 rea_install 装）'}`
      }
      return 'craft-anything-cli 未安装。安装方式：\n'
        + '1. 下载官方 release：craft-anything-<ver>-linux-aarch64.tar.gz\n'
        + '2. 解压后把 bin/craft-anything-cli 拷到 /opt/craft-anything/bin 并加执行权限\n'
        + '3. 软链到 /usr/local/bin：ln -s /opt/craft-anything/bin/craft-anything-cli /usr/local/bin/\n'
        + '装完再调 mix_doctor 检查融合状态。'
    },
  }))

  // ---- 精选 craft-anything 工具（cad_*）----
  // cli 名都已在 craft-anything-cli commands 里核对过（真实命令 + 参数格式）。
  // - 大多数带状命令用 --path 传目标。
  // - native-*-show/list 是位置 <target-path>，用 positionalTarget。
  // - 参数名在 execute 里自动转 kebab（class_name → class-name）。
  const cadTools = {
    cad_triage: {
      cli: 'core-target-triage',
      description: '快速识别一个文件/APK/二进制是什么（Craft Anything 内置，读首字节判断格式）。'
        + '调用：cad_triage path=/abs/path。适合分析任何目标前第一步。',
      params: { path: null },
    },
    cad_java_archive: {
      cli: 'java-archive-show',
      description: '看一个 JAR/WAR 的结构：MANIFEST、主类、类清单、内嵌包、嵌套 jar。'
        + '调用：cad_java_archive path=/abs/x.jar。',
      params: { path: null },
    },
    cad_java_method: {
      cli: 'java-method-show',
      description: '反编译 JVM 字节码里的某个方法为伪 Java（Craft Anything 内置反编译器）。'
        + '调用：cad_java_method path=/abs/x.jar class_name=com.Foo method_name=bar decompile=true。'
        + '深 APK 反编译优先用 rea_inspect_apk_method（JADX 更成熟）。',
      params: { path: null, class_name: null, method_name: null, decompile: true },
      flags: { decompile: true },
    },
    cad_native_pseudocode: {
      cli: 'native-function-pseudocode',
      description: '反编译原生二进制里某个函数为伪代码（走 Ghidra，共享 REA 的 Ghidra）。'
        + '调用：cad_native_pseudocode path=/abs/bin function=<函数名或地址>。',
      params: { path: null, function: null },
      positionalTarget: true,
    },
    cad_native_functions: {
      cli: 'native-functions-list',
      description: '列出原生二进制（ELF/so）的函数清单。调用：cad_native_functions path=/abs/bin。',
      params: { path: null },
      positionalTarget: true,
    },
    cad_andro_pkg: {
      cli: 'android-package-show',
      description: '看一个 APK 的包信息：包名、版本、权限、清单摘要（Craft Anything 内置解码器）。'
        + '调用：cad_andro_pkg path=/abs/app.apk。深 APK 逆向仍建议 rea_inspect_apk。',
      params: { path: null },
    },
    cad_res: {
      cli: 'android-resources-read',
      description: '解码 APK 的 resources.arsc：资源类型、配置（locale/密度/night/SDK）、条目值。'
        + '调用：cad_res path=/abs/app.apk。深资源 XML 用 rea/apktool。',
      params: { path: null },
    },
    cad_firmware: {
      cli: 'firmware-image-extract',
      description: '扫描固件镜像的结构与可提取内容（Craft Anything 内置 firmware 解析器）。'
        + '调用：cad_firmware path=/abs/fw.img。',
      params: { path: null },
    },
    cad_pcap: {
      cli: 'packets-capture-show',
      description: '读 pcap 抓包：连接、协议、流（Craft Anything 内置解析器），不需 tshark。'
        + '调用：cad_pcap path=/abs/cap.pcap。',
      params: { path: null },
    },
    cad_sqlite: {
      cli: 'db-sqlite-show',
      description: '读一个 sqlite 数据库文件的表结构（Craft Anything 内置）。调用：cad_sqlite path=/abs/a.db。',
      params: { path: null },
    },
    cad_unity: {
      cli: 'game-unity-list',
      description: '解析 Unity 游戏资源包（Craft Anything 内置）。调用：cad_unity path=/abs/game.unity3d。',
      params: { path: null },
    },
    cad_unreal: {
      cli: 'game-pak-list',
      description: '解析 Unreal 游戏资源包（UE .pak 等，Craft Anything 内置）。调用：cad_unreal path=/abs/game.pak。',
      params: { path: null },
    },
    cad_js_source: {
      cli: 'js-sources-restore',
      description: '把 minified 混淆的 JS bundle 还原成可读源码文件（Craft Anything 内置 oxc 反混淆/未压缩）。'
        + '调用：cad_js_source path=/abs/bundle.js output_directory=/abs/out（输出目录须不存在）。',
      params: { path: null, output_directory: null },
    },
    cad_binary_strings: {
      cli: 'native-strings-browse',
      description: '从原生二进制/镜像里列出字符串（Craft Anything 内置）。调用：cad_binary_strings path=/abs/bin。',
      params: { path: null },
      positionalTarget: true,
    },
  }

  for (const [toolName, spec0] of Object.entries(cadTools)) {
    const spec = { ...spec0, name: toolName }
    try {
      tools.register(caTool(spec))
    } catch (err) {
      console.warn(`[rea-craft-mix] 注册 ${toolName} 失败:`, err && err.message)
    }
  }

  // ---- HTTP 端点（供 client.js 状态面板 / 一键注入）----
  // 必须与 rea-tools 一致：kind:'exact' + (request,response) Node 回调 + sendJson/sameOrigin。
  // 不能返回 {statusCode,headers,body} 对象 —— DSH 内部把这个对象当事件数据序列化时，
  // 会触发 `session event "request/header" carries non-JSON-serializable data` 崩溃。
  const sendJson = (response, code, payload) => {
    try {
      response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify(payload))
    } catch { /* 响应已结束 */ }
  }
  const sameOrigin = (request) => {
    const origin = request.headers.origin
    if (origin === undefined) return true
    const hostHeader = (request.headers.host || '').replace(/[^A-Za-z0-9.:[\]]/g, '')
    try { return new URL(origin).host === hostHeader } catch { return false }
  }
  const readJsonBody = (request) => new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (c) => { size += c.length; if (size > 16 * 1024) { request.destroy(new Error('body too large')); return } chunks.push(c) })
    request.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) } catch (e) { reject(e) } })
    request.on('error', reject)
  })

  try {
    ctx.inject(['webServer'], (ws) => {
      if (!ws || typeof ws.webServer !== 'object') return
      // 只读状态
      const stopState = ws.webServer.register({
        kind: 'exact',
        path: '/rea-craft-mix/state',
        handler: async (request, response) => {
          if (request.method !== 'GET') { sendJson(response, 405, { error: '只支持 GET' }); return }
          if (!sameOrigin(request)) { sendJson(response, 403, { error: '跨源请求已拒绝' }); return }
          try {
            const ex = await probeEngines()
            sendJson(response, 200, { engines: ex, status: buildStatus(ex) })
          } catch (e) {
            sendJson(response, 500, { error: String((e && e.message) || e) })
          }
        },
      })
      // 写动作：一键注入
      const stopAction = ws.webServer.register({
        kind: 'exact',
        path: '/rea-craft-mix/action',
        handler: async (request, response) => {
          if (request.method !== 'POST') { sendJson(response, 405, { error: '只支持 POST' }); return }
          if (!sameOrigin(request)) { sendJson(response, 403, { error: '跨源请求已拒绝' }); return }
          let body
          try { body = await readJsonBody(request) } catch { sendJson(response, 400, { error: '请求体不是合法 JSON' }); return }
          const action = typeof body && body.action === 'string' ? body.action : 'inject'
          try {
            if (action === 'inject') {
              const engines = await probeEngines()
              const injected = await injectEnginesIntoCraft(engines)
              sendJson(response, 200, { ok: injected.ok, results: injected.results })
              return
            }
            sendJson(response, 400, { ok: false, error: '未知动作：' + (action || '(空)') })
          } catch (e) {
            sendJson(response, 500, { ok: false, error: String((e && e.message) || e) })
          }
        },
      })
      ctx.effect(() => () => { try { stopState() } catch {}; try { stopAction() } catch {} }, 'rea-craft-mix: http endpoints')
    })
  } catch (err) {
    console.warn('[rea-craft-mix] HTTP 端点注册失败（设置页按钮将不可点）:', err && err.message)
  }

  // ---- 融合：mix_rebuild（REA 分析 → Craft Anything 重建）----
  // 需要 craft-anything 配了 AI backend（ai detect / ai add）。这里暴露工具，
  // 内部探测 craft-anything 是否就绪，提示缺失项。
  tools.register(defineTool({
    name: 'mix_rebuild',
    description:
      '融合重建：把 REA 分析过的目标（或直接一个路径）交给 Craft Anything，'
      + '由它的 coding agent 按指定技术栈重建一个新项目。'
      + '参数：target(目标文件/目录)、stack(技术栈，如 "rust"/"nextjs")。'
      + '需要 craft-anything 已配置 AI backend（cad_ai_status 可查）。',
    parameters: {
      target: { type: 'string', description: '要重建的目标文件/目录路径' },
      stack: { type: 'string', description: '目标技术栈，如 rust / nextjs / pygame' },
    },
    output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] },
    async execute(args) {
      if (!(await hasCmd('craft-anything-cli'))) throw new Error('craft-anything-cli 未找到')
      const argv = ['rebuild']
      if (args.target) argv.push('--target', args.target)
      if (args.stack) argv.push('--stack', args.stack)
      argv.push('--deep')
      try {
        const out = await run('craft-anything-cli', argv, { timeoutMs: 600000 })
        return String(out).slice(0, 20000)
      } catch (err) {
        // 很多重建失败是因为没配 AI backend
        if (/AI|agent|backend|api/i.test(err.message)) {
          return '重建需要 craft-anything 的 AI backend。运行 `craft-anything-cli ai detect` 与 `ai add` 配置后重试。'
            + '\n底错误：' + err.message
        }
        throw new Error(`重建失败：${err.message}`)
      }
    },
  }))
}

export default { name, inject, apply }