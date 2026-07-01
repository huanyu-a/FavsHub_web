#!/bin/bash
set -e

SCRIPT_DIR=$(pwd)

# 确保 SQLite 数据库文件存在（首次启动自动初始化）
ensure_db_file() {
    local db_dir="${SCRIPT_DIR}/data"
    local db_file="${db_dir}/favshub.db"

    if [ ! -f "$db_file" ]; then
        echo "Creating database directory and file..."
        mkdir -p "$db_dir"
        touch "$db_file"
    fi
}

# 若存在更新包则解压到脚本所在目录，并在成功后删除压缩包
update() {
    local update_file="${SCRIPT_DIR}/data/update.tar.gz"

    if [ ! -f "$update_file" ]; then
        echo "No update package found, skipping update."
        return 0
    fi

    echo "Update package detected, extracting files..."
    tar -xzf "$update_file" -C "$SCRIPT_DIR" --overwrite
    echo "Update extracted successfully, removing package..."
    rm -f "$update_file"
    echo "Update completed."
}

# 导入当前目录下的 .env 环境变量（如果存在）
if [ -f "${SCRIPT_DIR}/.env" ]; then
    . "${SCRIPT_DIR}/.env"
fi

# 判断用户传递的参数
if [ "$1" = "dev" ]; then
    # 参数为 dev 时，启动开发服务器
    echo "Starting development server..."
    node server/index.mjs
elif [ -z "$1" ]; then
    # 参数为空时，启动生产服务器
    echo "Starting production server..."
    ensure_db_file
    update
    node server/index.mjs
else
    # 参数不合法时报错并退出
    echo "Error: Invalid argument. Only 'dev' or empty allowed."
    exit 1
fi
