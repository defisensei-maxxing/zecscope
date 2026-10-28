# One service: API + built web app. Linux + flock gives persistent wallet storage.
# Mount a volume at /app/data so scanned history survives restarts.

FROM node:22.23.4-bookworm AS web
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22.23.4-bookworm
RUN command -v flock || (apt-get update && apt-get install -y util-linux && rm -rf /var/lib/apt/lists/*)
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
COPY --from=web /app/web/dist /app/web/dist
ENV NETWORK=mainnet \
    LIGHTWALLETD_URL=https://zec.rocks:443 \
    STORAGE=filesystem \
    DATA_DIR=/app/data \
    WEB_DIST=/app/web/dist \
    PORT=8787
EXPOSE 8787
CMD ["npx", "tsx", "src/server.ts"]
