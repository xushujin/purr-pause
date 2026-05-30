#!/usr/bin/env bash
# 一键打包 PurrPause 的 Linux .deb 安装包。
#
# 用法：
#   ./scripts/build-deb.sh           # 打包 deb
#   bash scripts/build-deb.sh        # 同上（无执行权限时）
#
# 说明：
#   - 等价于 npm run build:linux（electron-builder --linux deb），
#     额外做了：自动定位项目根目录、检查 node/npm、缺依赖时自动 npm install、
#     结束后打印产物路径与大小。
#   - 额外参数会透传给 electron-builder，例如：./scripts/build-deb.sh --publish never
set -euo pipefail

# 始终切到项目根目录（脚本可从任意位置调用）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

log() { echo "胖猫暂停一下（PurrPause） $*"; }

# 1) 基本环境检查
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node，请先安装 Node.js（建议 18+）。" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "未找到 npm，请先安装 Node.js / npm。" >&2
  exit 1
fi
if [ "$(uname -s)" != "Linux" ]; then
  log "提示：当前系统不是 Linux，electron-builder 在非 Linux 上打 .deb 可能需要 Docker。"
fi

# 2) 依赖未安装时自动安装（首次会下载 Electron 二进制，需联网）
if [ ! -d node_modules ]; then
  log "未检测到 node_modules，开始安装依赖（首次会下载 Electron，需联网）..."
  npm install
fi

VERSION="$(node -p "require('./package.json').version")"
DEB="dist/purr-pause_${VERSION}_amd64.deb"

log "开始打包 .deb（版本 ${VERSION}）..."
npm run build:linux -- "$@"

# 3) 校验产物
if [ -f "$DEB" ]; then
  SIZE="$(du -h "$DEB" | cut -f1)"
  log "✓ 打包完成：$ROOT_DIR/$DEB（${SIZE}）"
else
  # 兜底：dist 下可能有其它命名的 .deb
  FOUND="$(ls -1t dist/*.deb 2>/dev/null | head -n1 || true)"
  if [ -n "$FOUND" ]; then
    SIZE="$(du -h "$FOUND" | cut -f1)"
    log "✓ 打包完成：$ROOT_DIR/$FOUND（${SIZE}）"
  else
    echo "打包似乎已结束，但未在 dist/ 找到 .deb 文件，请检查上方 electron-builder 输出。" >&2
    exit 1
  fi
fi
