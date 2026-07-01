#!/bin/bash
# FavsHub 部署脚本（对标 zmark 命名规范）
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 生成随机项目名后缀（首次部署时）
ENV_FILE="$SCRIPT_DIR/.env"
if [ ! -f "$ENV_FILE" ] || ! grep -q "^COMPOSE_PROJECT_NAME=" "$ENV_FILE"; then
    RAND_SUFFIX=$(head -c 4 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 4)
    PROJECT_NAME="favshub_${RAND_SUFFIX}"
    echo "COMPOSE_PROJECT_NAME=$PROJECT_NAME" > "$ENV_FILE"
    echo "Generated project name: $PROJECT_NAME"
else
    PROJECT_NAME=$(grep "^COMPOSE_PROJECT_NAME=" "$ENV_FILE" | cut -d= -f2)
    echo "Using existing project name: $PROJECT_NAME"
fi

# 拉取最新镜像并重启
docker compose pull
docker compose up -d --remove-orphans

echo ""
echo "=== 部署完成 ==="
docker compose ps
