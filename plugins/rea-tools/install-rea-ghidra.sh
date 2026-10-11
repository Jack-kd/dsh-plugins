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
#        sudo bash install-rea-ghidra.sh --install-dir /opt/ghidra_12.1.4_PUBLIC
#        sudo bash install-rea-ghidra.sh --no-cache         # 装完不保留 zip 缓存
#
# 特性：
#   * 断点续传 + zip 缓存复用（网络中断不重来，重装秒过）
#   * Ghidra 下载走 GitHub 官方源 + 加速镜像，自动逐个尝试
#   * 预编译反编译器缺失时自动从仓库拉取
#   * 自动下载 JADX 桥接（REA_JADX_MCP_JAR），装完即可分析 APK
#   * 幂等：已装好的部分自动跳过
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
GHIDRA_MIRRORS=(
  "${OFFICIAL_URL}"                                         # GitHub 官方源
  "https://ghfast.top/${OFFICIAL_URL}"                      # ghfast 加速
  "https://ghproxy.net/${OFFICIAL_URL}"                     # ghproxy 加速
  "https://gh-proxy.com/${OFFICIAL_URL}"                    # gh-proxy 加速
  "${REPO_RELEASE_URL}"                                     # 本仓库 Release（若日后上传了该包会自动命中）
)
JADX_MIRRORS=(
  "${JADX_URL}"                                             # GitHub 官方源
  "https://ghfast.top/${JADX_URL}"                          # ghfast 加速
  "https://ghproxy.net/${JADX_URL}"                         # ghproxy 加速
  "https://gh-proxy.com/${JADX_URL}"                        # gh-proxy 加速
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
KEEP_ZIP=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    --ghidra-zip)  GHIDRA_ZIP="$2";  shift 2 ;;
    --decompiler-tgz) DECOMPILER_TGZ="$2"; shift 2 ;;
    --compile)     FORCE_COMPILE=1; shift ;;
    --skip-rea)    SKIP_REA=1; shift ;;
    --no-cache)    KEEP_ZIP=0; shift ;;
    --version)     echo "Ghidra ${GHIDRA_VERSION}"; exit 0 ;;
    -h|--help)     sed -n '2,60p' "${BASH_SOURCE[0]}"; exit 0 ;;
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
download_resume() {
  local url="$1" out="$2"
  if has_cmd curl; then
    curl -fL -C - --retry 3 --connect-timeout 15 --retry-delay 2 -o "${out}" "${url}" 2>/dev/null
  elif has_cmd wget; then
    wget -c -q --tries 3 --timeout 15 -O "${out}" "${url}" 2>/dev/null
  else
    return 1
  fi
}

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
if [[ -z "${GHIDRA_ZIP}" && -d "${INSTALL_DIR}" ]]; then
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

if [[ "${FORCE_COMPILE}" -eq 1 ]]; then
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
    for base in "${REPO_RAW_BASE}" "https://ghfast.top/${REPO_RAW_BASE}" "https://ghproxy.net/${REPO_RAW_BASE}"; do
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
    REA_SCRIPT="$(readlink -f "${REA_BIN}" 2>/dev/null || true)"
    if [[ -z "${REA_SCRIPT}" || ! -f "${REA_SCRIPT}" ]]; then
      REA_SCRIPT="${REA_BIN}"
    fi
    if [[ "${REA_SCRIPT}" == *.mjs ]]; then
      rm -f "${REA_BIN}"
      cat > "${REA_BIN}" <<WRAPPER
#!/usr/bin/env bash
# REA wrapper: guarantees Ghidra + JADX env for analysis in DSH shells.
export GHIDRA_INSTALL_DIR="\${GHIDRA_INSTALL_DIR:-${INSTALL_DIR}}"
export JAVA_HOME="\${JAVA_HOME:-${JAVA_HOME_DEFAULT}}"
export REA_JADX_MCP_JAR="\${REA_JADX_MCP_JAR:-${JADX_JAR_PATH}}"
exec /usr/bin/env node "${REA_SCRIPT}" "\$@"
WRAPPER
      chmod +x "${REA_BIN}"
      log "已为 rea 创建环境变量包装脚本（GHIDRA_INSTALL_DIR=${INSTALL_DIR}，REA_JADX_MCP_JAR=${JADX_JAR_PATH}）"
    fi
  fi
fi

# ---------- 7. 验证 ----------
log "运行 rea doctor 验证..."
rea doctor 2>&1 | grep -E "healthy:|  - name: (ghidra|ghidra-native_decompiler|ghidra-version)|ok: (true|false)" | head -16 || true

log "===================================================="
log " 安装完成！"
log "   Ghidra:     ${INSTALL_DIR}"
log "   反编译器:  ${DECOMPILER_DIR}/decompile"
log "   JADX 桥接:  ${JADX_JAR_PATH}"
log "   rea:       $(rea_version || echo '(未安装 rea)')"
log " 快速上手:"
log "   原生:   rea analyze <二进制路径>; rea function <路径> --procedure <函数名>"
log "   APK:    rea inspect-android-package <apk>; rea inspect-android-class <apk> <类名>"
log "===================================================="
