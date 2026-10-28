# API server. Linux + flock gives persistent wallet storage (STORAGE=auto -> filesystem).
FROM node:22.23.4-bookworm
RUN command -v flock || (apt-get update && apt-get install -y util-linux && rm -rf /var/lib/apt/lists/*)
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --omit=dev
COPY server/ ./
ENV NETWORK=mainnet \
    LIGHTWALLETD_URL=https://zec.rocks:443 \
    STORAGE=auto \
    DATA_DIR=/app/data \
    PORT=8787
VOLUME /app/data
EXPOSE 8787
CMD ["npx", "tsx", "src/server.ts"]
