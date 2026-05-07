# FlashFire dashboard backend image.
# Node 20 alpine — supports every dep in package.json (engines >=18). Smaller
# attack surface than full debian, includes apk for bcrypt build deps.
FROM node:20-alpine

# Build deps for native modules (bcrypt) + curl for healthcheck + tini for
# proper PID 1 signal handling.
RUN apk add --no-cache python3 make g++ curl tini

WORKDIR /app

# Copy manifests first so npm ci layer caches when only source changes.
COPY package*.json ./

# Production install. Native deps (bcrypt) compile here.
RUN npm ci --omit=dev && npm cache clean --force

# Copy source.
COPY . .

# Logs dir + non-root user.
RUN mkdir -p logs \
    && addgroup -g 1001 -S nodejs \
    && adduser -S nodejs -u 1001 \
    && chown -R nodejs:nodejs /app
USER nodejs

# Default port — index.js reads process.env.PORT (defaults to 8086).
EXPOSE 8086

# Healthcheck — index.js exposes GET /health returning 200.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://localhost:${PORT:-8086}/health" || exit 1

# tini = PID 1 → reaps zombies, forwards SIGTERM cleanly so node exits fast
# under docker stop / restart.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.js"]
