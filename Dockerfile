# Production image for the video platform. Build: `docker compose build` (see README → Deploy).

# Production dependencies only. better-sqlite3 ships prebuilt binaries (linux x64/arm64);
# it is compiled only on a platform without one.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && (node -e "new (require('better-sqlite3'))(':memory:').close()" \
    || (apt-get update && apt-get install -y --no-install-recommends python3 make g++ && npm rebuild better-sqlite3))

# The web pages, built once into dist/.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY vite.config.ts tsconfig.json ./
COPY shared ./shared
COPY web ./web
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json tsconfig.json ./
COPY shared ./shared
COPY server ./server
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/config').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "--import", "tsx", "server/main.ts", "--production"]
