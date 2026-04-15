# syntax=docker/dockerfile:1.7
# ─── Stage 1: build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Install pnpm via corepack (ships with Node 22)
RUN corepack enable

# Install dependencies first for better layer caching
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

# Copy sources and build
COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

# Prune dev deps for the runtime layer
RUN pnpm prune --prod

# ─── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

# Run as a non-root user
RUN addgroup -S app && adduser -S app -G app

# Bring over only what runtime needs
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/dist ./dist
COPY --from=builder --chown=app:app /app/package.json ./package.json

# Make sure /data exists and is owned by the app user (done as root before switching)
RUN mkdir -p /data && chown -R app:app /data
VOLUME ["/data"]

USER app

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
