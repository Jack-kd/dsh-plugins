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
MIRRORS=(
  "https://ghfast.top/${URL}"
  "https://ghproxy.net/${URL}"
  "https://gh-proxy.com/${URL}"
  "${URL}"
)

echo "[craft] 开始 安装 Craft Anything v${CRAFT_VER} (${CRAFT_ARCH})"

# ---- 幂等：已就绪则跳过 ----
if [ -x "${CRAFT_DEST}/bin/craft-anything-cli" ] && [ -x /usr/local/bin/craft-anything-cli ]; then
  echo "检测到已安装 Craft Anything，跳过"
  echo "安装完成"
  exit 0
fi

# ---- 下载（多镜像回退）----
mkdir -p "${CRAFT_DEST}"
echo "下载 Craft Anything"
ok=0
for u in "${MIRRORS[@]}"; do
  echo "尝试: $u"
  set +e
  curl -fL --retry 2 --connect-timeout 20 --speed-time 60 --speed-limit 10240 \
    -o "${TARBALL}" "$u" 2>/dev/null
  rc=$?
  set -e
  if [ $rc -eq 0 ] && [ -s "${TARBALL}" ]; then ok=1; break; fi
  echo "镜像失败，换下一个"
done
if [ "$ok" -ne 1 ]; then echo "所有镜像下载失败"; exit 1; fi

# ---- SHA256 校验 ----
echo "校验 SHA256"
expected=""
set +e
curl -fsSL "${SHA_URL}" 2>/dev/null | grep "${ASSET}" | awk '{print $1}' | head -n1
sha_remote=$(curl -fsSL "${SHA_URL}" 2>/dev/null | grep "${ASSET}" | awk '{print $1}' | head -n1)
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
