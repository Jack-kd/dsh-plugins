// rea-craft-mix —— 统一引擎登记（环境配置层）
//
// 职责（这是整个融合插件的"环境"核心）：
//   1. 探测 REA 与 Craft Anything 两套引擎的真实安装位置（探测，不重复定义）；
//   2. 把 REA 已装的引擎（JADX / Apktool / Ghidra）路径**注入**到 craft-anything 的
//      settings 配置里 —— 实现两套工具真正复用同一批逆向引擎；
//   3. 给出统一的就绪状态（供 mix_doctor / client.js UI 展示，谁缺补谁）。
//
// 关键实测依据（本机已验证）：
//   - craft-anything 的 doctor 已经能自动发现共享的 Ghidra（/opt/ghidra_12.1.4_PUBLIC）
//   - 但 JADX / Apktool 不会自动扫 REA 的 /opt/rea-install-kit —— 必须显式配置。
//   - 注入方式：craft-anything-cli settings-set --key engines.tools.<jadx|apktool>。
//   - 环境变量（JADX_JAR / APKTOOL_JAR）对 craft-anything 无效，别依赖。

import { execFile } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

// 常见安装路径（探测候选）。优先真实存在者；探不到则该引擎标记 null。
const CANDIDATES = {
  ghidra: [
    '/opt/ghidra_12.1.4_PUBLIC',
    '/opt/ghidra_12.1.4_PUBLIC/support/analyzeHeadless',
  ],
  jadx: [
    '/opt/rea-install-kit/jadx-headless-mcp-0.7.1-all.jar',
  ],
  apktool: [
    '/opt/rea-install-kit/apktool_2.9.3.jar',
    '/opt/craft-anything/apktool_2.9.3.jar',
  ],
}

// 在 PATH 里找命令的绝对路径（同步）
function which(cmd) {
  if (!cmd) return null
  try {
    const out = execFileSync('sh', ['-c', `command -v ${JSON.stringify(cmd)}`], {
      timeout: 10000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out.trim() || null
  } catch {
    return null
  }
}

function firstExisting(list) {
  for (const p of list) {
    try { if (existsSync(p)) return p } catch { /* 忽略单路径错误 */ }
  }
  return null
}

// 探测并返回两套引擎的路径。只做探测，不做假设；某路径探测不到则该字段为 null。
export function probeEngines() {
  const reaCli = which('rea')
  const craftCli = which('craft-anything-cli')
  const ghidra = firstExisting(CANDIDATES.ghidra)
  const jadx = firstExisting(CANDIDATES.jadx)
  const apktool = firstExisting(CANDIDATES.apktool)
  const java = which('java')

  return { reaCli, craftCli, ghidra, jadx, apktool, java }
}

// 就绪状态：两套引擎各自的可用性 + 缺口。
export function buildStatus(engines) {
  const s = {
    engines,
    ready: {
      rea: !!engines.reaCli,
      craft: !!engines.craftCli,
      ghidra: !!engines.ghidra,
      jadx: !!engines.jadx,
      apktool: !!engines.apktool,
      java: !!engines.java,
    },
    satisfied: false,
  }
  const coreOk = s.ready.ghidra && s.ready.jadx
  s.satisfied = coreOk && s.ready.craft
  return s
}

// 判断 craft-anything 还缺哪些引擎（只报非可选的硬缺口）
export function missingEngines(engines) {
  const missing = []
  if (!engines.jadx) missing.push('jadx')
  return missing
}

// 单次 craft-anything settings-set 调用（异步）
function caSettingsSet(craftCli, key, value) {
  return new Promise((resolve) => {
    execFile(craftCli, ['settings-set', '--key', key, '--value', JSON.stringify(value)], {
      timeout: 30000, maxBuffer: 16 * 1024 * 1024,
    }, (err, stdout) => {
      if (err) return resolve({ ok: false, error: err.message })
      try {
        const d = JSON.parse(stdout)
        const set = d && typeof d === 'object' && d.result && d.result.set
          ? d.result.set : (d && typeof d === 'object' && d.set ? d.set : null)
        resolve({ ok: !!set, set })
      } catch {
        resolve({ ok: !!stdout, raw: stdout })
      }
    })
  })
}

// 把 REA 已装的引擎路径注入到 craft-anything 配置。
// 幂等：已注入过也再设一次（无害）。返回每项注入结果。
export async function injectEnginesIntoCraft(engines) {
  const craft = engines.craftCli
  if (!craft) return { ok: false, results: { craft: { ok: false, error: 'craft-anything-cli 未找到' } } }

  const results = {}

  if (engines.jadx) {
    results.jadx = await caSettingsSet(craft, 'engines.tools.jadx', engines.jadx)
  } else {
    results.jadx = { ok: false, error: 'JADX jar 未找到（由 REA 安装，可调 rea_install）' }
  }

  if (engines.apktool) {
    results.apktool = await caSettingsSet(craft, 'engines.tools.apktool', engines.apktool)
  } else {
    results.apktool = { ok: false, optional: true, error: 'Apktool jar 未找到（可选增强，不影响核心）' }
  }

  if (engines.java) {
    results.ghidraJava = await caSettingsSet(craft, 'engines.ghidra.java_home', engines.java)
  }

  const ok = Object.values(results).every((r) => r.ok || r.optional)
  return { ok, results }
}

// 顶层：探测 + 状态（不自动注入，由调用方决定是否注入）
export async function fullCheck() {
  const engines = probeEngines()
  const status = buildStatus(engines)
  return { engines, status }
}