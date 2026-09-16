#!/bin/bash
# title: FavsHub 部署
# desc: docker compose 部署 FavsHub，首次运行自动生成随机项目名写入 .env。

# FavsHub 部署脚本（对标 zmark 命名规范）
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 生成随机项目名后缀（首次部署时）
ENV_FILE="$SCRIPT_DIR/.env"
if [ ! -f "$ENV_FILE" ] || ! grep -q "^COMPOSE_PROJECT_NAME=" "$ENV_FILE"; then
    RAND_SUFFIX=$(head -c 16 /dev/urandom | base64 | tr -dc 'a-z0-9' | head -c 4)
    PROJECT_NAME="favshub_${RAND_SUFFIX}"
    echo "COMPOSE_PROJECT_NAME=$PROJECT_NAME" > "$ENV_FILE"
    echo "Generated project name: $PROJECT_NAME"
else
    PROJECT_NAME=$(grep "^COMPOSE_PROJECT_NAME=" "$ENV_FILE" | cut -d= -f2)
    echo "Using existing project name: $PROJECT_NAME"
fi

# 启动服务（如需更新镜像请先手动执行: docker compose pull）
docker compose up -d --remove-orphans

echo ""
echo "=== 部署完成 ==="
docker compose ps
