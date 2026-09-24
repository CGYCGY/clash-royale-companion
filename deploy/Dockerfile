# syntax=docker/dockerfile:1

FROM oven/bun:1.4 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# The app runs TypeScript directly (no bundle): src/ is loaded as-is and migrations are read
# from src/db/migrations at startup, so src/ must be copied whole.
FROM oven/bun:1.4-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/app.db
WORKDIR /app

# The image ships a non-root `bun` user (uid 1000). /data must exist and be owned by it before
# VOLUME, otherwise a fresh named volume is created root-owned and SQLite can't write.
RUN mkdir -p /data && chown bun:bun /data

COPY --from=deps --chown=bun:bun /app/node_modules ./node_modules
COPY --chown=bun:bun package.json bun.lock tsconfig.json ./
COPY --chown=bun:bun src ./src
COPY --chown=bun:bun public ./public

USER bun
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["bun", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# Exec form so bun is PID 1 and receives SIGTERM directly (server.ts closes the DB on it).
CMD ["bun", "src/server.ts"]
