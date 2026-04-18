#!/usr/bin/env bash
# ocean 构建脚本 - 代码更新后运行此脚本重新打包
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.bun/bin:$PATH"
BIN_DIR="$HOME/.local/bin"
EXTERNALS=(
  '@anthropic-ai/bedrock-sdk'
  '@anthropic-ai/foundry-sdk'
  '@anthropic-ai/vertex-sdk'
  '@azure/identity'
  '@aws-sdk/client-sts'
  '@aws-sdk/client-bedrock'
  'turndown'
  'sharp'
  '@opentelemetry/exporter-metrics-otlp-grpc'
  '@opentelemetry/exporter-metrics-otlp-http'
  '@opentelemetry/exporter-metrics-otlp-proto'
  '@opentelemetry/exporter-prometheus'
  '@opentelemetry/exporter-logs-otlp-grpc'
  '@opentelemetry/exporter-logs-otlp-http'
  '@opentelemetry/exporter-logs-otlp-proto'
  '@opentelemetry/exporter-trace-otlp-grpc'
  '@opentelemetry/exporter-trace-otlp-http'
  '@opentelemetry/exporter-trace-otlp-proto'
)

# 1. 清理 bun 缓存和旧产物
echo ">>> 清理缓存 ..."
rm -f ocean.bundle.js
rm -rf "$BIN_DIR/.ocean-bundle.js" "$BIN_DIR/.ocean-bun" "$BIN_DIR/.clmg-bundle.js" "$BIN_DIR/.clmg-bun"

# 2. 打包 JS bundle
echo ">>> 打包 bundle ..."
ext_args=()
for e in "${EXTERNALS[@]}"; do
  ext_args+=(--external "$e")
done
bun build --target=bun --outfile=ocean.bundle.js ./src/dev-entry.ts "${ext_args[@]}"

# 3. 编译 C 启动器
echo ">>> 编译启动器 ..."
cc -O2 -o "$BIN_DIR/ocean" clmg_launcher.c
codesign --force --sign - "$BIN_DIR/ocean"

# 4. 部署 bundle 和 bun runtime
echo ">>> 部署 ..."
cp ocean.bundle.js "$BIN_DIR/.ocean-bundle.js"
cp "$HOME/.bun/bin/bun" "$BIN_DIR/.ocean-bun"

# 5. 修复 sharp libvips 动态库路径
# Bun 的缓存目录命名（@img/sharp-libvips-darwin-arm64@1.2.4@@@1）
# 与 sharp 的 @rpath 期望路径（@img/sharp-libvips-darwin-arm64/lib/）不匹配，
# 导致运行时 dlopen 找不到 libvips-cpp.dylib
echo ">>> 修复 sharp libvips 路径 ..."
SHARP_CACHE_DIR="$HOME/.bun/install/cache/@img"
LIBVIPS_REAL_DIR=$(find "$SHARP_CACHE_DIR" -maxdepth 1 -type d -name 'sharp-libvips-darwin-arm64@*' | sort -V | tail -1)
if [ -n "$LIBVIPS_REAL_DIR" ] && [ -d "$LIBVIPS_REAL_DIR/lib" ]; then
  LIBVIPS_LINK="$SHARP_CACHE_DIR/sharp-libvips-darwin-arm64/lib"
  mkdir -p "$LIBVIPS_LINK" 2>/dev/null || true
  for item in "$LIBVIPS_REAL_DIR/lib/"*; do
    name=$(basename "$item")
    target="$LIBVIPS_LINK/$name"
    if [ ! -e "$target" ]; then
      ln -sf "$item" "$target"
    fi
  done
  echo "    libvips 链接已创建: $LIBVIPS_LINK"
else
  echo "    警告: 未找到 sharp-libvips-darwin-arm64 缓存目录"
fi

# 6. 清除 macOS 隔离属性并重新签名
echo ">>> 签名 ..."
xattr -cr "$BIN_DIR/ocean" "$BIN_DIR/.ocean-bundle.js" "$BIN_DIR/.ocean-bun"
codesign --force --sign - "$BIN_DIR/ocean"
codesign --force --sign - "$BIN_DIR/.ocean-bun"

echo ">>> 完成: $BIN_DIR/ocean"
