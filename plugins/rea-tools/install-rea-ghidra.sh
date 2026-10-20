#!/usr/bin/env bash
# =============================================================================
# install-rea-ghidra.sh — 一键安装 REA + Ghidra（快速路径，免源码编译）
#
# 背景：官方 Ghidra 发布包只在 x86_64 / Windows 自带反编译器。在 arm64 Linux
# 上需要自己编译（单线程约 15-20 分钟）。本脚本优先使用预编译的 arm64 反编译
# 器包（rea-ghidra-arm64-decompiler-12.1.4.tar.gz，仅 ~2MB），几秒完成。
#
# 三种运行方式：
#   1) 从 GitHub 仓库直接跑（推荐，无需先下载任何东西）：
#        curl -fsSL https://raw.githubusercontent.com/Jack-kd/rea-quick-install/main/install-rea-ghidra.sh | sudo bash
#   2) 本地有套件目录：
#        sudo bash install-rea-ghidra.sh
#   3) 自定义参数：
#        sudo bash install-rea-ghidra.sh --ghidra-zip /path/ghidra_12.1.4_PUBLIC_*.zip   # 用本地 Ghidra 包
#        sudo bash install-rea-ghidra.sh --decompiler-tgz /path/rea-ghidra-arm64-*.tar.gz
#        sudo bash install-rea-ghidra.sh --compile          # 强制源码编译反编译器
#        sudo bash install-rea-ghidra.sh --skip-rea         # 只装 Ghidra
#        sudo bash install-rea-ghidra.sh --skip-ghidra      # 初级版本：只装 JDK+rea+JADX（纯 APK 逆向，省 543MB）
#        sudo bash install-rea-ghidra.sh --install-dir /opt/ghidra_12.1.4_PUBLIC
#        sudo bash install-rea-ghidra.sh --no-cache         # 装完不保留 zip 缓存
#
# 特性：
#   * 断点续传 + zip 缓存复用（网络中断不重来，重装秒过）
#   * **镜像优先**：加速镜像排在官方源之前，并带「慢速放弃」——某源速率持续过低会自动换下一个
#   * 预编译反编译器缺失时自动从仓库拉取
#   * 自动下载 JADX 桥接（REA_JADX_MCP_JAR），装完即可分析 APK
#   * 幂等：已装好的部分自动跳过
#
# v0.1.1 修复（重要）：
#   此前下载源把 GitHub 官方源排在第一位，且 download_resume 只判断「是否报错」不看速率，
#   于是官方源能连上但只有 ~10 KB/s 时会一直挂着慢慢下（543MB 约 13 小时），永不回退到
#   快 40 倍的镜像。现改为：① 镜像排前、官方源兜底；② 连续 DL_SPEED_TIME 秒低于
#   DL_SPEED_LIMIT 即放弃换源。实测：官方源 10 秒放弃，镜像 543MB 约 20 分钟完成。
#   可用环境变量覆盖：DL_SPEED_LIMIT（默认 51200 B/s）、DL_SPEED_TIME（默认 20 秒）。
#
# 前置条件：Linux（x86_64 / aarch64）、root、Node.js 22.19+/24.11+/26+ 与 npm。
# JDK 21 脚本会自动 apt 安装。
# =============================================================================

set -euo pipefail

# ---------- 常量 ----------
GITHUB_REPO="Jack-kd/rea-quick-install"
REPO_BRANCH="main"
RELEASE_TAG="v1.0"
GHIDRA_VERSION="12.1.4"
GHIDRA_RELEASE_TAG="Ghidra_12.1.4_build"
GHIDRA_ZIP_NAME="ghidra_12.1.4_PUBLIC_20260921.zip"
GHIDRA_SHA256="ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db"
TGZ_NAME="rea-ghidra-arm64-decompiler-${GHIDRA_VERSION}.tar.gz"
JADX_VERSION="0.7.1"
JADX_JAR_NAME="jadx-headless-mcp-${JADX_VERSION}-all.jar"
JADX_SHA256="6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75"
JADX_URL="https://github.com/1013503897/jadx-headless-mcp/releases/download/v${JADX_VERSION}/${JADX_JAR_NAME}"
JADX_INSTALL_DIR="${JADX_INSTALL_DIR:-/opt/rea-install-kit}"

OFFICIAL_URL="https://github.com/NationalSecurityAgency/ghidra/releases/download/${GHIDRA_RELEASE_TAG}/${GHIDRA_ZIP_NAME}"
REPO_RELEASE_URL="https://github.com/${GITHUB_REPO}/releases/download/${RELEASE_TAG}/${GHIDRA_ZIP_NAME}"
REPO_RAW_BASE="https://raw.githubusercontent.com/${GITHUB_REPO}/${REPO_BRANCH}"
# 下载候选（按顺序尝试；可用 GHIDRA_MIRRORS_EXTRA 环境变量在前面追加）
#
# v0.1.1 关键修复：镜像排在官方源**之前**。
# 官方源（github.com / raw.githubusercontent.com）在国内通常极慢（实测 ~10 KB/s，
# 甚至完全超时），而 ghfast.top 等镜像可达 400-3000 KB/s。旧顺序把官方源放第一，
# 配合 download_resume 的"能连上就不回退"行为，会把安装拖到十几小时。
# 官方源仍保留在末尾兜底：万一镜像全部失效、而本机恰好能直连 GitHub，仍可装上。
GHIDRA_MIRRORS=(
  "https://ghfast.top/${OFFICIAL_URL}"                      # ghfast 加速（国内首选）
  "https://ghproxy.net/${OFFICIAL_URL}"                     # ghproxy 加速
  "https://gh-proxy.com/${OFFICIAL_URL}"                    # gh-proxy 加速
  "${REPO_RELEASE_URL}"                                     # 本仓库 Release（若日后上传了该包会自动命中）
  "${OFFICIAL_URL}"                                         # GitHub 官方源（兜底）
)
JADX_MIRRORS=(
  "https://ghfast.top/${JADX_URL}"                          # ghfast 加速（国内首选）
  "https://ghproxy.net/${JADX_URL}"                         # ghproxy 加速
  "https://gh-proxy.com/${JADX_URL}"                        # gh-proxy 加速
  "${JADX_URL}"                                             # GitHub 官方源（兜底）
)
if [[ -n "${GHIDRA_MIRRORS_EXTRA:-}" ]]; then
  read -r -a GHIDRA_MIRRORS_EXTRA_ARR <<< "${GHIDRA_MIRRORS_EXTRA}"
  GHIDRA_MIRRORS=("${GHIDRA_MIRRORS_EXTRA_ARR[@]}" "${GHIDRA_MIRRORS[@]}")
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd 2>/dev/null || echo '')"
if [[ "${SCRIPT_DIR}" == "" || "${SCRIPT_DIR}" == "/dev"* || "${SCRIPT_DIR}" == "-" ]]; then
  SCRIPT_DIR="/tmp/rea-install-run"
  mkdir -p "${SCRIPT_DIR}"
fi
DEFAULT_TGZ="${SCRIPT_DIR}/${TGZ_NAME}"

# ---------- 参数 ----------
INSTALL_DIR="${GHIDRA_INSTALL_DIR:-/opt/ghidra_${GHIDRA_VERSION}_PUBLIC}"
GHIDRA_ZIP=""
DECOMPILER_TGZ="${DEFAULT_TGZ}"
ZIP_CACHE_DIR="${ZIP_CACHE_DIR:-/var/cache/rea-install}"
FORCE_COMPILE=0
SKIP_REA=0
SKIP_GHIDRA=0
KEEP_ZIP=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --ghidra-zip)  GHIDRA_ZIP="$2";  shift 2 ;;
    --decompiler-tgz) DECOMPILER_TGZ="$2"; shift 2 ;;
    --compile)     FORCE_COMPILE=1; shift ;;
    --skip-rea)    SKIP_REA=1; shift ;;
    --skip-ghidra) SKIP_GHIDRA=1; shift ;;
    --no-cache)    KEEP_ZIP=0; shift ;;
    --version)     echo "Ghidra ${GHIDRA_VERSION}"; exit 0 ;;
    -h|--help)     sed -n '2,70p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数: $1 (--help 查看用法)"; exit 1 ;;
  esac
done

log()  { printf '\033[1;34m[REA安装]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[警告]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[失败]\033[0m %s\n' "$*" >&2; exit 1; }

has_cmd() { command -v "$1" >/dev/null 2>&1; }

# 快速读取全局 rea-agents 版本（不调用慢速的 npm ls）
rea_version() {
  local pfx="$(dirname "$(dirname "$(command -v node)")")"
  local pkg="${pfx}/lib/node_modules/rea-agents/package.json"
  if [[ -f "${pkg}" ]]; then
    node -p "require('${pkg}').version" 2>/dev/null || true
  fi
}

# 断点续传下载：curl -C - / wget -c；成功返回 0
#
# v0.1.1 关键修复：加入「慢速放弃」（slow-abort）。
# 背景：GitHub 官方源在国内常能连上、但只有 ~10 KB/s。旧实现只判断「是否报错」，
# 于是会一直挂在官方源上慢慢下（543MB 约需 13 小时），永不回退到快 40 倍的镜像。
# 现在：若连续 SPEED_TIME 秒平均速率低于 SPEED_LIMIT，则主动放弃并返回非 0，
# 由调用方换下一个源。已下载的部分保留（-C -），可继续断点续传。
DL_SPEED_LIMIT="${DL_SPEED_LIMIT:-51200}"   # 50 KB/s
DL_SPEED_TIME="${DL_SPEED_TIME:-20}"        # 持续 20 秒低于阈值即放弃
download_resume() {
  local url="$1" out="$2"
  # v0.2.5 修复：不再 `2>/dev/null` 丢弃 curl 的 stderr。
  # 旧写法把**错误信息**（404 / 超时 / TLS 失败）也一起丢了，失败时日志一片空白，
  # 无从判断是「网络问题」还是「源没有这个文件」。
  # 现在用 --no-progress-meter 关掉进度条噪音（进度改由 install-manager 轮询
  # 输出文件大小计算，比解析 curl 的 \r 进度行可靠得多），但保留真正的错误输出。
  if has_cmd curl; then
    curl -fL -C - --retry 3 --connect-timeout 15 --retry-delay 2 \
      --speed-limit "${DL_SPEED_LIMIT}" --speed-time "${DL_SPEED_TIME}" \
      --no-progress-meter \
      -o "${out}" "${url}"
  elif has_cmd wget; then
    # wget 无等价的持续低速判定；用 --timeout 兜住完全卡死的情况
    wget -c -q --tries 3 --timeout 15 -O "${out}" "${url}"
  else
    return 1
  fi
}

# ---------- 0. 磁盘空间预检（v0.2.5）----------
# 完整安装约需 800MB（Ghidra 543 + JDK 148 + JADX 41 + 解压余量）。
# 旧版没有预检：空间不足时下到一半才失败，还留下坏缓存、下次续传又失败。
# 这里在**任何下载开始前**检查目标目录可用空间，不足直接给出明确提示。
check_disk_space() {
  local need_mb="$1" target_dir="$2" label="$3"
  local probe_dir="${target_dir}"
  # 目标目录可能还不存在 → 向上找到第一个存在的父目录再量
  while [[ ! -d "${probe_dir}" && "${probe_dir}" != "/" ]]; do probe_dir="$(dirname "${probe_dir}")"; done
  local avail_mb
  avail_mb="$(df -Pm "${probe_dir}" 2>/dev/null | awk 'NR==2 {print $4}')"
  if [[ -z "${avail_mb}" ]]; then
    warn "无法读取 ${label} 所在磁盘可用空间，跳过预检"
    return 0
  fi
  if [[ "${avail_mb}" -lt "${need_mb}" ]]; then
    die "${label} 空间不足：${probe_dir} 仅剩 ${avail_mb} MB，需要至少 ${need_mb} MB。请清理磁盘后重试。"
  fi
  log "空间预检通过：${label} 可用 ${avail_mb} MB（需要 ${need_mb} MB）"
}
# 下载缓存（/var/cache）与安装目录（/opt）通常同一分区，但分开检查更稳妥
check_disk_space 900 "${ZIP_CACHE_DIR}" "Ghidra 下载缓存"
check_disk_space 500 "${INSTALL_DIR}" "安装目录"

# ---------- 1. 平台检测 ----------
ARCH="$(uname -m)"
case "${ARCH}" in
  x86_64|amd64)  GHIDRA_OSDIR="linux_x86_64" ;;
  aarch64|arm64) GHIDRA_OSDIR="linux_arm_64" ;;
  *) die "不支持的架构: ${ARCH}（仅支持 x86_64 / aarch64 Linux）" ;;
esac
log "架构: ${ARCH} → Ghidra 平台目录 os/${GHIDRA_OSDIR}"

# ---------- 2. JDK 21+ ----------
if java -version 2>&1 | grep -qE 'version "([2-9][0-9]|[3-9][0-9]|2[1-9])\.'; then
  JAVA_MAJOR="$(java -version 2>&1 | sed -nE 's/.*version "([0-9]+).*/\1/p')"
  log "检测到 Java ${JAVA_MAJOR}，跳过 JDK 安装"
else
  log "未找到 JDK 21+，尝试通过 apt 安装 openjdk-21-jdk-headless ..."
  if has_cmd apt-get; then
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y openjdk-21-jdk-headless
  else
    die "无 apt 且未安装 JDK 21+，请先安装 JDK 21 或更高版本"
  fi
fi
JAVA_HOME_DEFAULT="$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")"
log "JAVA_HOME 建议: ${JAVA_HOME_DEFAULT}"

# ---------- 3. Node.js + rea-agents ----------
if [[ "${SKIP_REA}" -eq 0 ]]; then
  if ! has_cmd node || ! has_cmd npm; then
    die "未找到 node/npm。请先安装 Node.js 22.x(>=22.19)/24.x(>=24.11)/26+ 再运行"
  fi
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "${NODE_MAJOR}" -lt 22 ]]; then
    die "Node.js 版本过低 (v$(node -v))，REA 需要 22.19+/24.11+/26+"
  fi
  if [[ -z "$(rea_version)" ]]; then
    log "安装 rea-agents（npm，走镜像）..."
    npm install --global rea-agents || npm install --global rea-agents --registry=https://registry.npmmirror.com
  else
    log "检测到已安装 rea-agents: $(rea_version)"
  fi
fi

# ---------- 4. Ghidra 发布包（断点续传 + zip 缓存）----------
# v0.2.0：--skip-ghidra 时整段跳过（初级版本：只装 JDK + rea-agents + JADX，
# 用于纯 APK 逆向。Ghidra 是可选增强，APK 分析完全不依赖它）。
if [[ "${SKIP_GHIDRA}" -eq 1 ]]; then
  log "跳过 Ghidra（--skip-ghidra：初级版本，仅 APK 逆向）"
elif [[ -z "${GHIDRA_ZIP}" && -d "${INSTALL_DIR}" ]]; then
  log "检测到已存在的 Ghidra 安装: ${INSTALL_DIR}，跳过下载"
else
  if [[ -n "${GHIDRA_ZIP}" ]]; then
    [[ -f "${GHIDRA_ZIP}" ]] || die "本地 Ghidra zip 不存在: ${GHIDRA_ZIP}"
    log "使用本地 Ghidra 包: ${GHIDRA_ZIP}"
  else
    mkdir -p "${ZIP_CACHE_DIR}"
    ZIP_CACHE="${ZIP_CACHE_DIR}/${GHIDRA_ZIP_NAME}"
    if [[ -f "${ZIP_CACHE}" ]]; then
      log "发现 zip 缓存: ${ZIP_CACHE}"
      if has_cmd sha256sum; then
        if [[ "$(sha256sum "${ZIP_CACHE}" | awk '{print $1}')" == "${GHIDRA_SHA256}" ]]; then
          log "缓存校验通过，直接复用（无需重新下载）"
        else
          warn "缓存校验失败，删除后重新下载"
          rm -f "${ZIP_CACHE}"
        fi
      fi
    fi
    if [[ ! -f "${ZIP_CACHE}" ]]; then
      log "下载 Ghidra ${GHIDRA_VERSION} (${GHIDRA_ZIP_NAME}, ~543MB，断点续传) ..."
      ok=0
      for url in "${GHIDRA_MIRRORS[@]}"; do
        log "  尝试: ${url}"
        if download_resume "${url}" "${ZIP_CACHE}"; then
          if has_cmd sha256sum && [[ "$(sha256sum "${ZIP_CACHE}" | awk '{print $1}')" == "${GHIDRA_SHA256}" ]]; then
            ok=1; break
          else
            warn "下载完成但校验失败，清理后换下一个源"
            rm -f "${ZIP_CACHE}"
          fi
        fi
      done
      [[ "${ok}" -eq 1 ]] || die "所有下载源都失败了（残留文件已保留在 ${ZIP_CACHE}，可断点重跑本脚本继续）"
    fi
    GHIDRA_ZIP="${ZIP_CACHE}"
  fi
  log "校验 SHA-256 ..."
  if has_cmd sha256sum && [[ -n "${GHIDRA_SHA256}" ]]; then
    echo "${GHIDRA_SHA256}  ${GHIDRA_ZIP}" | sha256sum -c - || die "Ghidra zip SHA-256 校验失败"
  fi
  log "解压到 ${INSTALL_DIR} ..."
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  if has_cmd unzip; then
    unzip -q "${GHIDRA_ZIP}" -d "$(dirname "${INSTALL_DIR}")"
  elif has_cmd jar; then
    mkdir -p "${INSTALL_DIR}" && cd "${INSTALL_DIR}" && jar xf "${GHIDRA_ZIP}"
  else
    die "无 unzip/jar，无法解压"
  fi
  [[ -d "${INSTALL_DIR}" ]] || die "解压后未找到 ${INSTALL_DIR}"
  if [[ "${KEEP_ZIP}" -eq 0 ]]; then
    rm -f "${ZIP_CACHE}"
    log "已按要求删除 zip 缓存"
  fi
fi

# ---------- 4.5 JADX 桥接（REA APK 分析依赖 REA_JADX_MCP_JAR）----------
JADX_JAR_PATH="${JADX_INSTALL_DIR}/${JADX_JAR_NAME}"
if [[ "${SKIP_REA}" -eq 1 ]]; then
  log "跳过 JADX（--skip-rea）"
elif [[ -f "${JADX_JAR_PATH}" ]] && echo "${JADX_SHA256}  ${JADX_JAR_PATH}" | sha256sum -c - >/dev/null 2>&1; then
  log "JADX 桥接已存在且校验通过: ${JADX_JAR_PATH}"
else
  log "下载 JADX 桥接（REA APK 分析用，40MB，断点续传）..."
  mkdir -p "${JADX_INSTALL_DIR}"
  ok=0
  for url in "${JADX_MIRRORS[@]}"; do
    log "  尝试: ${url}"
    if download_resume "${url}" "${JADX_JAR_PATH}"; then
      if echo "${JADX_SHA256}  ${JADX_JAR_PATH}" | sha256sum -c - >/dev/null 2>&1; then
        ok=1; break
      else
        warn "JADX 下载完成但校验失败，清理后换下一个源"
        rm -f "${JADX_JAR_PATH}"
      fi
    fi
  done
  [[ "${ok}" -eq 1 ]] || die "JADX 桥接下载失败（残留文件在 ${JADX_JAR_PATH}，可断点重跑）"
  log "JADX 桥接就绪: ${JADX_JAR_PATH}"
fi

# ---------- 5. 反编译器（decompile + sleigh）----------
DECOMPILER_DIR="${INSTALL_DIR}/Ghidra/Features/Decompiler/os/${GHIDRA_OSDIR}"

build_decompiler_from_source() {
  local cpp="${INSTALL_DIR}/Ghidra/Features/Decompiler/src/decompile/cpp"
  [[ -d "${cpp}" ]] || die "未找到反编译器源码目录: ${cpp}"
  has_cmd g++ || die "需要 g++ 编译器（apt-get install -y g++ make zlib1g-dev bison flex）"
  cd "${cpp}"
  mkdir -p "${DECOMPILER_DIR}"
  log "编译 decompile（并行 make -j$(nproc)）..."
  make ghidra_opt OSDIR="${GHIDRA_OSDIR}" ARCH_TYPE= -j"$(nproc)"
  cp ghidra_opt "${DECOMPILER_DIR}/decompile"
  log "编译 sleigh（并行 make -j$(nproc)）..."
  make sleigh_opt OSDIR="${GHIDRA_OSDIR}" ARCH_TYPE= -j"$(nproc)"
  cp sleigh_opt "${DECOMPILER_DIR}/sleigh"
  chmod +x "${DECOMPILER_DIR}/decompile" "${DECOMPILER_DIR}/sleigh"
  log "反编译器编译完成"
}

if [[ "${SKIP_GHIDRA}" -eq 1 ]]; then
  log "跳过反编译器（--skip-ghidra）"
elif [[ "${FORCE_COMPILE}" -eq 1 ]]; then
  build_decompiler_from_source
elif [[ "${GHIDRA_OSDIR}" == "linux_x86_64" ]]; then
  log "x86_64 发布包自带反编译器，无需处理"
elif [[ -x "${DECOMPILER_DIR}/decompile" && -x "${DECOMPILER_DIR}/sleigh" ]]; then
  log "反编译器已存在且可执行，跳过"
else
  # 预编译包：本地目录 → 仓库 raw（curl|bash 场景）
  if [[ ! -f "${DECOMPILER_TGZ}" ]]; then
    log "未在本目录找到 ${TGZ_NAME}，尝试从仓库拉取..."
    TGZ_TMP="$(mktemp -d)"
    ok=0
    # v0.1.1：镜像排前、raw 官方源兜底（与 GHIDRA_MIRRORS 同样的理由）
    for base in "https://ghfast.top/${REPO_RAW_BASE}" "https://ghproxy.net/${REPO_RAW_BASE}" "${REPO_RAW_BASE}"; do
      log "  尝试: ${base}/${TGZ_NAME}"
      if download_resume "${base}/${TGZ_NAME}" "${TGZ_TMP}/${TGZ_NAME}"; then ok=1; break; fi
    done
    [[ "${ok}" -eq 1 ]] || die "预编译反编译器下载失败，可改用 --compile 从源码编译"
    DECOMPILER_TGZ="${TGZ_TMP}/${TGZ_NAME}"
  fi
  if [[ -f "${DECOMPILER_TGZ}" ]]; then
    log "使用预编译反编译器包: ${DECOMPILER_TGZ}"
    mkdir -p "${DECOMPILER_DIR}"
    tar xzf "${DECOMPILER_TGZ}" -C "${DECOMPILER_DIR}" --strip-components=1
    chmod +x "${DECOMPILER_DIR}/decompile" "${DECOMPILER_DIR}/sleigh" 2>/dev/null || true
    if [[ -f "${DECOMPILER_DIR}/checksums.txt" ]]; then
      (cd "${DECOMPILER_DIR}" && sha256sum -c checksums.txt) || warn "预编译包校验失败，建议改用 --compile"
    fi
  fi
fi

# ---------- 6. rea 包装脚本（固化环境变量）----------
# DSH/容器 shell 不加载 .bashrc，普通环境变量无法持久化，用包装脚本解决
if [[ "${SKIP_REA}" -eq 0 ]]; then
  REA_BIN="$(command -v rea || true)"
  if [[ -n "${REA_BIN}" ]]; then
    # 判断 REA_BIN 是否已是本脚本生成的包装脚本（而非原始的 .mjs 软链）
    IS_WRAPPER=0
    grep -q "REA wrapper: guarantees Ghidra + JADX env" "${REA_BIN}" 2>/dev/null && IS_WRAPPER=1

    if [[ "${IS_WRAPPER}" -eq 0 ]]; then
      # 首次安装：rea 指向 .mjs（软链或普通文件），取出真实脚本路径
      REA_SCRIPT="$(readlink -f "${REA_BIN}" 2>/dev/null || true)"
      if [[ -z "${REA_SCRIPT}" || ! -f "${REA_SCRIPT}" ]]; then
        REA_SCRIPT="${REA_BIN}"
      fi
    else
      # 已存在包装脚本：从里面取回它 exec 的 .mjs 路径，避免自我嵌套
      REA_SCRIPT="$(sed -n 's/^exec \/usr\/bin\/env node "\(.*\)" "\$@"$/\1/p' "${REA_BIN}" | head -1)"
      [[ -n "${REA_SCRIPT}" && -f "${REA_SCRIPT}" ]] || REA_SCRIPT=""
    fi

    # v0.2.0 修复：只要目标是包装脚本就重写一次（而非仅在首次安装时写）。
    # 否则「初级版本 → 升级到升级版本」时，旧包装脚本不含 GHIDRA_INSTALL_DIR 且永不刷新，
    # 导致 shell 里直接跑 `rea analyze` 找不到 Ghidra。
    if [[ -n "${REA_SCRIPT}" && "${REA_SCRIPT}" == *.mjs ]]; then
      rm -f "${REA_BIN}"
      # --skip-ghidra 时不导出 GHIDRA_INSTALL_DIR，避免把 rea 指向不存在的安装目录
      if [[ "${SKIP_GHIDRA}" -eq 1 ]]; then
        GHIDRA_EXPORT_LINE="# 初级版本：未安装 Ghidra，不设置 GHIDRA_INSTALL_DIR"
      else
        GHIDRA_EXPORT_LINE="export GHIDRA_INSTALL_DIR=\"\${GHIDRA_INSTALL_DIR:-${INSTALL_DIR}}\""
      fi
      cat > "${REA_BIN}" <<WRAPPER
#!/usr/bin/env bash
# REA wrapper: guarantees Ghidra + JADX env for analysis in DSH shells.
${GHIDRA_EXPORT_LINE}
export JAVA_HOME="\${JAVA_HOME:-${JAVA_HOME_DEFAULT}}"
export REA_JADX_MCP_JAR="\${REA_JADX_MCP_JAR:-${JADX_JAR_PATH}}"
exec /usr/bin/env node "${REA_SCRIPT}" "\$@"
WRAPPER
      chmod +x "${REA_BIN}"
      if [[ "${SKIP_GHIDRA}" -eq 1 ]]; then
        log "已为 rea 创建环境变量包装脚本（初级版本：GHIDRA_INSTALL_DIR 未设置，REA_JADX_MCP_JAR=${JADX_JAR_PATH}）"
      else
        log "已为 rea 创建环境变量包装脚本（GHIDRA_INSTALL_DIR=${INSTALL_DIR}，REA_JADX_MCP_JAR=${JADX_JAR_PATH}）"
      fi
    fi
  fi
fi

# ---------- 7. 验证 ----------
log "运行 rea doctor 验证..."
rea doctor 2>&1 | grep -E "healthy:|  - name: (ghidra|ghidra-native_decompiler|ghidra-version)|ok: (true|false)" | head -16 || true

log "===================================================="
if [[ "${SKIP_GHIDRA}" -eq 1 ]]; then
  log " 安装完成！（初级版本：仅 APK 逆向）"
  log "   JADX 桥接:  ${JADX_JAR_PATH}"
  log "   rea:       $(rea_version || echo '(未安装 rea)')"
  log "   注意:      未安装 Ghidra，原生二进制分析（rea_analyze / rea_function）不可用"
  log "              如需升级，可在「设置 → 通用 → REA 逆向环境」中安装升级版本"
  log " 快速上手:"
  log "   APK:    rea inspect-android-package <apk>; rea inspect-android-class <apk> <类名>"
else
  log " 安装完成！（升级版本：APK + 原生二进制）"
  log "   Ghidra:     ${INSTALL_DIR}"
  log "   反编译器:  ${DECOMPILER_DIR}/decompile"
  log "   JADX 桥接:  ${JADX_JAR_PATH}"
  log "   rea:       $(rea_version || echo '(未安装 rea)')"
  log " 快速上手:"
  log "   原生:   rea analyze <二进制路径>; rea function <路径> --procedure <函数名>"
  log "   APK:    rea inspect-android-package <apk>; rea inspect-android-class <apk> <类名>"
fi
log "===================================================="
