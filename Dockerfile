# ── Stage 1: Dependencies ──────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat python3 make g++

# Copy workspace config
COPY package.json package-lock.json* ./
COPY packages/ ./packages/
COPY services/${SERVICE_NAME}/package.json ./services/${SERVICE_NAME}/

RUN npm ci --workspace=services/${SERVICE_NAME} --workspace=packages/config --workspace=packages/database --workspace=packages/shared

# ── Stage 2: Builder ───────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY tsconfig.json ./
COPY packages/ ./packages/
COPY services/${SERVICE_NAME}/ ./services/${SERVICE_NAME}/

# Build shared packages first
RUN npx tsc -p packages/config/tsconfig.json 2>/dev/null || true
RUN npx tsc -p packages/database/tsconfig.json 2>/dev/null || true
RUN npx tsc -p packages/shared/tsconfig.json 2>/dev/null || true

# Build the service
RUN npx tsc -p services/${SERVICE_NAME}/tsconfig.json 2>/dev/null || \
    npx ts-node --transpile-only services/${SERVICE_NAME}/src/index.ts --check 2>/dev/null || true

# ── Stage 3: Production ────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Security: run as non-root
RUN addgroup --system --gid 1001 ikonetu && \
    adduser --system --uid 1001 ikonetu

# Copy built application
COPY --from=builder --chown=ikonetu:ikonetu /app/node_modules ./node_modules
COPY --from=builder --chown=ikonetu:ikonetu /app/packages ./packages
COPY --from=builder --chown=ikonetu:ikonetu /app/services/${SERVICE_NAME} ./services/${SERVICE_NAME}

USER ikonetu

ARG SERVICE_NAME
ENV SERVICE_NAME=${SERVICE_NAME}

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3001}/health || exit 1

CMD ["node", "-r", "ts-node/register", "services/${SERVICE_NAME}/src/index.ts"]
