#!/usr/bin/env bash
# install-craft.sh —— 安装 Craft Anything CLI（storytold/craft-anything）
# 幂等：已装且版本就绪则跳过。
# 用法：bash install-craft.sh
#   --bench 打印诊断（默认关闭）
set -uo pipefail

CRAFT_VER="0.4.0"
CRAFT_DEST="/opt/craft-anything"
SHA_URL="https://github.com/storytold/craft-anything/releases/download/v${CRAFT_VER}/SHA256SUMS.txt"

# 架构 → 官方 release 资产后缀
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) CRAFT_ARCH="linux-aarch64" ;;
  x86_64|amd64)  CRAFT_ARCH="linux-x86_64" ;;
  riscv64)       CRAFT_ARCH="linux-riscv64" ;;
  *) echo "不支持的架构: $ARCH"; exit 1 ;;
esac

TARBALL="${CRAFT_DEST}/craft-anything-${CRAFT_VER}-${CRAFT_ARCH}.tar.gz"
ASSET="craft-anything-${CRAFT_VER}-${CRAFT_ARCH}.tar.gz"
URL="https://github.com/storytold/craft-anything/releases/download/v${CRAFT_VER}/${ASSET}"

# 镜像列表（github 加速）
# 2026-11 实测：剔除死链 ghproxy.net（HTTP 000，旧版每次安装都白等一次超时）。
# 顺序仅作启发；真正的选路由下方「内置加速模块」的并发竞速决定。
MIRRORS=(
  "https://gh.jjj.gv.uy/${URL}"
  "https://gh.acmsz.top/${URL}"
  "https://github.chenc.dev/${URL}"
  "https://gh-proxy.com/${URL}"
  "https://cfgh.ikgy.top/${URL}"
  "https://ghfast.top/${URL}"
  "https://ghproxy.icu/${URL}"
  "https://ghgo.de5.net/${URL}"
  "${URL}"
)

echo "[craft] 开始 安装 Craft Anything v${CRAFT_VER} (${CRAFT_ARCH})"

# ---- 幂等：已就绪则跳过 ----
if [ -x "${CRAFT_DEST}/bin/craft-anything-cli" ] && [ -x /usr/local/bin/craft-anything-cli ]; then
  echo "检测到已安装 Craft Anything，跳过"
  echo "安装完成"
  exit 0
fi

# ---- 下载（① 内置加速模块 → ② 多镜像 curl 回退）----
mkdir -p "${CRAFT_DEST}"
echo "下载 Craft Anything"

ACCEL_JS="$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")/installer/accel-download.mjs"
ok=0
# ① 内置加速模块（不依赖 gh-accel 插件）：多线程分片 + 并发竞速选路 + 断点续传
#    模块失败不影响后续：会自动回落到下面的 curl 多镜像逻辑。
if command -v node >/dev/null 2>&1 && [ -f "${ACCEL_JS}" ] && [ "${SUPER_RE_NO_ACCEL:-0}" != "1" ]; then
  echo "加速下载（多线程 + 动态选路）"
  set +e
  node "${ACCEL_JS}" --url "${URL}" --out "${TARBALL}" --threads "${ACCEL_THREADS:-8}" --prefer mirror
  rc=$?
  set -e
  if [ $rc -eq 0 ] && [ -s "${TARBALL}" ]; then ok=1; fi
  [ "$ok" -eq 1 ] || echo "加速模块未成功，回落到 curl 多镜像"
fi

# ② curl 多镜像回退（原逻辑，补两点：失败时删掉半截文件、加 -C - 断点续传）
if [ "$ok" -ne 1 ]; then
  for u in "${MIRRORS[@]}"; do
    echo "尝试: $u"
    set +e
    # v0.2.3：加 -C - 断点续传（原来换镜像要从 0 重下 62MB）。
    # 注：曾试过 --resolve 跳过系统 DNS，实测反而更慢甚至失败（GitHub 多 IP，
    # 预绑的那个未必最优），故不采用。
    curl -fL -C - --retry 2 --connect-timeout 20 --speed-time 60 --speed-limit 10240 \
      -o "${TARBALL}" "$u" 2>/dev/null
    rc=$?
    set -e
    if [ $rc -eq 0 ] && [ -s "${TARBALL}" ]; then ok=1; break; fi
    echo "镜像失败，换下一个"
    # 失败时清掉半截文件，避免下一个镜像「续传」到一段不属于它的垃圾数据
    rm -f "${TARBALL}" 2>/dev/null || true
  done
fi
if [ "$ok" -ne 1 ]; then echo "所有镜像下载失败"; exit 1; fi

# ---- SHA256 校验 ----
echo "校验 SHA256"
# v0.2.3 修复：原来这里有**两次相同的 curl**（第一行取值没赋给变量、纯浪费一次
# 网络请求），在 DNS 慢的环境里等于多等一倍。现在只请求一次并复用结果。
set +e
sha_remote=$(curl -fsSL --connect-timeout 15 "${SHA_URL}" 2>/dev/null \
  | grep "${ASSET}" | awk '{print $1}' | head -n1)
set -e
actual=$(sha256sum "${TARBALL}" | awk '{print $1}')
if [ -n "$sha_remote" ] && [ "$sha_remote" != "$actual" ]; then
  echo "SHA256 校验失败: 期望 $sha_remote 实际 $actual"
  exit 1
fi

# ---- 解压到 /opt/craft-anything ----
echo "解压到 ${CRAFT_DEST}"
tar xzf "${TARBALL}" -C "${CRAFT_DEST}" 2>/dev/null || tar xzf "${TARBALL}" -C "${CRAFT_DEST}" --strip-components=1
chmod -R a+rX "${CRAFT_DEST}"

# ---- 软链到 /usr/local/bin ----
echo "软链 craft-anything-cli / craft-anything"
ln -sf "${CRAFT_DEST}/bin/craft-anything-cli" /usr/local/bin/craft-anything-cli
ln -sf "${CRAFT_DEST}/bin/craft-anything" /usr/local/bin/craft-anything

if [ -x "${CRAFT_DEST}/bin/craft-anything-cli" ]; then
  echo "Craft Anything 安装完成"
  echo "安装完成"
  exit 0
fi
echo "安装失败：未找到 craft-anything-cli"
exit 1
