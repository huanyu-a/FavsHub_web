#!/bin/bash
# FavsHub Nuxt 构建脚本
set -e

echo "=== 1. 构建 Nuxt 项目 ==="
npx nuxt build

echo "=== 2. 准备部署目录 favshub/ ==="
rm -rf favshub/
mkdir -p favshub

# 复制构建产物（排除 node_modules，Docker 内重新安装）
cp -r .output/server favshub/server
rm -rf favshub/server/node_modules
cp -r .output/public favshub/public 2>/dev/null || true

echo "=== 3. Docker 构建 ==="
docker build -t favshub:latest -f Dockerfile .

echo "=== 构建完成 ==="
# 推送到镜像仓库（按需取消注释）
# docker tag favshub:latest <registry>/favshub:latest
# docker push <registry>/favshub:latest
