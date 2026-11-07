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
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'

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

// apktool 补全所需信息 —— 与 rea-tools 的 install-rea-ghidra.sh 保持同源同版本同源URL。
const APKTOOL_VER = '2.9.3'
const APKTOOL_SHA256 = '7956eb04194300ce0d0a84ad18771eebc94b89fb8d1ddcce8ea4c056818646f4'
const APKTOOL_URL = `https://github.com/Jack-kd/dsh-plugins/releases/download/rea-tools-v0.2.11/apktool_${APKTOOL_VER}.jar`
// 镜像优先（国内首选）→ GitHub 官方源兜底，顺序同 rea-tools 脚本。
const APKTOOL_MIRRORS = [
  `https://ghfast.top/${APKTOOL_URL}`,
  `https://ghproxy.net/${APKTOOL_URL}`,
  `https://gh-proxy.com/${APKTOOL_URL}`,
  APKTOOL_URL,
]

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

// 计算文件 sha256（hex）
function sha256File(p) {
  return new Promise((resolve) => {
    try {
      const h = createHash('sha256')
      const fsStream = createReadStream(p)
      fsStream.on('error', () => resolve(null))
      fsStream.on('data', (c) => h.update(c))
      fsStream.on('end', () => resolve(h.digest('hex')))
    } catch { resolve(null) }
  })
}

// 用 curl 断点续传下载单个文件（镜像优先，低速自动中断换源）。与 rea-tools 脚本同策略。
function curlDownload(url, out) {
  return new Promise((resolve) => {
    try {
      execFile('curl', [
        '-fL', '-C', '-', '--retry', '3', '--connect-timeout', '15', '--retry-delay', '2',
        '--speed-limit', '102400', '--speed-time', '15',
        '--no-progress-meter', '-o', out, url,
      ], { timeout: 180000 }, (err) => resolve(!err))
    } catch { resolve(false) }
  })
}

// 下载并校验 apktool jar 到指定的探测路径。若目标路径已存在且校验通过则跳过（幂等）。
// 返回 { ok, path, skipped, error? }。这个函数被 mix_doctor 在"apktool 缺失"时调用，
// 补全后再注入 craft-anything —— 解决"设置页标红 apktool 却无入口补全"的缺口。
export async function ensureApktool() {
  const target = CANDIDATES.apktool[0] // /opt/rea-install-kit/apktool_2.9.3.jar
  const existing = firstExisting(CANDIDATES.apktool)
  if (existing && (await sha256File(existing)) === APKTOOL_SHA256) {
    return { ok: true, path: existing, skipped: true }
  }

  // 目标路径不存在或校验失败 → 下载（mkdir 父目录）
  try {
    if (!existsSync(target)) mkdirSync(dirname(target), { recursive: true })
  } catch (e) { /* 目录可能不可建，交给 curl 报错 */ }

  for (const url of APKTOOL_MIRRORS) {
    const ok = await curlDownload(url, target)
    if (!ok) continue
    const digest = await sha256File(target)
    if (digest === APKTOOL_SHA256) {
      return { ok: true, path: target, skipped: false }
    }
    // 校验失败 → 清掉坏文件，换下一个源
    try { unlinkSync(target) } catch { /* ignore */ }
  }
  return { ok: false, error: 'apktool 下载失败（镜像与官方源均不可达或校验未通过）' }
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