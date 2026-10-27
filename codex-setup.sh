#!/usr/bin/env bash
# Paste into the Codex cloud environment's setup script (or let Codex run it).
set -euo pipefail
command -v flock || (apt-get update && apt-get install -y util-linux)
node -v
(cd server && if [ -f package-lock.json ]; then npm ci; else npm install; fi)
(cd web && if [ -f package-lock.json ]; then npm ci; else npm install; fi)
cat >> ~/.bashrc <<'EOF'
export NETWORK=testnet
export LIGHTWALLETD_URL=https://testnet.zec.rocks:443
export STORAGE=auto
export DATA_DIR=/tmp/zecscope-data
export PORT=8787
EOF
