# ─── 构建阶段 ────────────────────────────────────────────────
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
