#!/usr/bin/env bash
# clmg 构建脚本 - 代码更新后运行此脚本重新打包
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

# 1. 打包 JS bundle
echo ">>> 打包 bundle ..."
ext_args=()
for e in "${EXTERNALS[@]}"; do
  ext_args+=(--external "$e")
done
bun build --target=bun --outfile=clmg.bundle.js ./src/dev-entry.ts "${ext_args[@]}"

# 2. 编译 C 启动器
echo ">>> 编译启动器 ..."
cc -O2 -o "$BIN_DIR/clmg" clmg_launcher.c
codesign --force --sign - "$BIN_DIR/clmg"

# 3. 部署 bundle 和 bun runtime
echo ">>> 部署 ..."
cp clmg.bundle.js "$BIN_DIR/.clmg-bundle.js"
cp "$HOME/.bun/bin/bun" "$BIN_DIR/.clmg-bun"

# 4. 清除 macOS 隔离属性并重新签名
echo ">>> 签名 ..."
xattr -cr "$BIN_DIR/clmg" "$BIN_DIR/.clmg-bun" "$BIN_DIR/.clmg-bundle.js"
codesign --force --sign - "$BIN_DIR/clmg"
codesign --force --sign - "$BIN_DIR/.clmg-bun"

echo ">>> 完成: $BIN_DIR/clmg"
