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

export const name = 'rea'
export const inject = ['tools']

const __dirname = dirname(fileURLToPath(import.meta.url))
const INSTALL_SCRIPT = join(__dirname, 'install-rea-ghidra.sh')

// 与 install-rea-ghidra.sh 的默认安装位置保持一致
const ENV_DEFAULTS = {
  GHIDRA_INSTALL_DIR: '/opt/ghidra_12.1.4_PUBLIC',
  JAVA_HOME: '/usr/lib/jvm/java-21-openjdk-arm64',
  REA_JADX_MCP_JAR: '/opt/rea-install-kit/jadx-headless-mcp-0.7.1-all.jar',
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
        // doctor 在环境不全是 healthy 时退出码非 0，但输出仍然有用 —— 吞掉退出码
        const out = await run('sh', ['-c', `rea ${args2.map((x) => JSON.stringify(x)).join(' ')}; true`], { timeoutMs: spec.timeoutMs || 600000 })
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
        + '全新环境第一步先调这个。约 3–5 分钟（下载 Ghidra 543MB，断点续传）。'
        + '装完会运行 rea doctor 验证。',
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
        const a = ['bash', INSTALL_SCRIPT]
        if (args.skip_rea) a.push('--skip-rea')
        if (args.compile) a.push('--compile')
        if (args.install_dir) a.push('--install-dir', args.install_dir)
        const out = await run('sh', ['-c', `bash ${JSON.stringify(INSTALL_SCRIPT)} ${a.slice(2).map((x) => JSON.stringify(x)).join(' ')}`], { timeoutMs: 1200000 })
        return out
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
    fs.writeFileSync('/tmp/rea-plugin-selfcheck.json', JSON.stringify({
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
}
