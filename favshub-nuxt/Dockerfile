FROM node:20-alpine

# 创建工作目录为 /opt/favshub
WORKDIR /opt/favshub

# 复制构建产物
COPY favshub/ ./

# 复制启动脚本
COPY run.sh ./

# 删除可能存在的 Windows 二进制，重新安装原生依赖
RUN rm -rf server/node_modules \
    && apk add --no-cache python3 make g++ \
    && cd server && npm install --production --registry https://registry.npmmirror.com \
    && cd /opt/favshub && apk del python3 make g++

# 暴露挂载路径为 /opt/favshub/data
VOLUME /opt/favshub/data

# 暴露端口为 3000
EXPOSE 3000

# 启动命令为 sh run.sh
CMD ["sh", "run.sh"]
