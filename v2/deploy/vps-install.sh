#!/bin/bash
# VPS deploy script - run on Hostinger srv1846527
# Usage: bash deploy/vps-install.sh
set -e

APP_DIR="/var/www/mep-projects"
API_PORT=4001
DOMAIN_WEB="mep-projects.spereon.codes"
DOMAIN_API="api.mep-projects.spereon.codes"

echo "=========================================="
echo "  MEP PROJECTS v2 - VPS install"
echo "=========================================="

# Ensure Node 20+
if ! command -v node > /dev/null; then
  echo "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

# Ensure pm2
if ! command -v pm2 > /dev/null; then
  npm install -g pm2
fi

# 1. Install backend
echo ""
echo "[1/5] Installing backend deps..."
cd $APP_DIR/server
npm install --production
mkdir -p logs

# 2. .env file
if [ ! -f .env ]; then
  echo "[2/5] Creating .env from example..."
  cp .env.example .env
  # Generate random JWT secret
  SECRET=$(openssl rand -hex 32)
  sed -i "s/change-this-to-a-long-random-string/$SECRET/" .env
  echo "  Random JWT_SECRET generated"
else
  echo "[2/5] .env exists, skipping"
fi

# 3. Migrate + seed
echo ""
echo "[3/5] Running migration (preserves users)..."
npm run migrate || true
echo "  Running seed (creates DEMO if absent)..."
npm run seed || true

# 4. Build frontend
echo ""
echo "[4/5] Building React frontend..."
cd $APP_DIR/web
npm install
npm run build
echo "  Built to web/dist/"

# 5. PM2 restart
echo ""
echo "[5/5] Restarting PM2..."
cd $APP_DIR/server
pm2 delete mep-projects-api 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash || true

echo ""
echo "=========================================="
echo "  Done!"
echo "=========================================="
echo "  Backend:  http://localhost:$API_PORT/api/health"
echo "  Web dist: $APP_DIR/web/dist"
echo ""
echo "Configure nginx:"
echo "  - $DOMAIN_WEB  -> root $APP_DIR/web/dist  (try_files \$uri /index.html)"
echo "  - $DOMAIN_API  -> proxy_pass http://localhost:$API_PORT (also / with WebSocket upgrade)"
echo ""
pm2 logs mep-projects-api --lines 15 --nostream
