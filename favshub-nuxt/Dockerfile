# ─── 构建阶段 ────────────────────────────────────────────────
#
# Node 版本：这里用 20，而 CI（.github/workflows/docker-publish.yml 的 setup-node）
# 用 22 —— 两条链路是**独立**的：镜像自己 install + build，且 .dockerignore 排除了
# `node_modules` / `.output`，所以 CI 用 22 产生的产物不会进镜像。
# 实测评测：镜像内 install/build/runtime 三者同为 20（当前 20.20.2），ABI 一致。
# 跨版本的后果是真实的：Node 22 构建出的 better_sqlite3.node 是 ABI 127，
# 在 Node 20（ABI 115）下无法加载 —— 正因为 dockerignore 挡住了，才没出事。
#
# ⚠️ package.json 的 `engines` 在这里**只是弱约束**：pnpm 不满足时只打 WARN、
#    仍然 exit 0。已在 node:20-alpine 容器里实测（故意写 `"node": ">=999.0.0"`）：
#      WARN  Unsupported engine: wanted: {"node":">=999.0.0"} (current: {"node":"v20.20.2"})
#      exit=0
#    所以**不要指望 engines 拦住版本错误**。真要强制，得加 pnpm 的
#    `--engine-strict`（或 `engine-strict=true` in .npmrc）。当前刻意不加：
#    node:20-alpine 的 20.20.2 本就落在声明范围内，没有拦的需求。
FROM node:20-alpine AS builder

# 安装原生模块编译工具 + pnpm
RUN apk add --no-cache python3 make g++ \
    && corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /build

# 先复制 lockfile + package.json，利用 Docker 缓存层
COPY package.json pnpm-lock.yaml* ./

# 安装依赖（含 devDependencies，用于构建；better-sqlite3 需要编译）
RUN pnpm install --frozen-lockfile --registry https://registry.npmmirror.com

# 复制源码
COPY . .

# 构建（Nitro node-server 预设会 externalize 运行时依赖到 .output/server/node_modules）
RUN pnpm build

# ─── 生产阶段 ────────────────────────────────────────────────
FROM node:20-alpine

# 中文字体：服务端分享卡片渲染（server/utils/deal-card.ts）需要 CJK 字形，
# 否则中文会渲染成豆腐块。font-noto-cjk 含 Regular/Bold 的 Sans + Serif。
RUN apk add --no-cache font-noto-cjk \
    && fc-cache -f >/dev/null 2>&1 || true

WORKDIR /opt/favshub
RUN mkdir -p /opt/favshub/data

# 只复制 Nitro 构建产物（已包含 .output/server/node_modules 精简运行时）
COPY --from=builder /build/.output ./.output

VOLUME /opt/favshub/data
EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", ".output/server/index.mjs"]
