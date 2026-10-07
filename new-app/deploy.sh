#!/bin/bash
# ── MEP New App — Production Deployment Script ──
#
# Usage: bash deploy.sh
#
# Prerequisites:
#   1. Node.js >= 18 installed
#   2. MongoDB running (local or Atlas)
#   3. PM2 installed globally: npm install -g pm2
#   4. Nginx installed and configured (see nginx.conf.example)
#   5. backend/.env file configured (see backend/.env.example)
#
# This script:
#   1. Installs backend dependencies
#   2. Builds the frontend (Vite production build)
#   3. Starts/restarts the backend via PM2

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
echo "=== MEP New App — Deployment ==="
echo "Working directory: $SCRIPT_DIR"

# ── Step 1: Backend dependencies ──
echo ""
echo "── Step 1: Installing backend dependencies ──"
cd "$SCRIPT_DIR/backend"
npm ci --production 2>/dev/null || npm install --production
echo "✓ Backend dependencies installed"

# ── Step 2: Check .env ──
echo ""
echo "── Step 2: Checking backend configuration ──"
if [ ! -f .env ]; then
  echo "✗ ERROR: backend/.env not found!"
  echo "  Copy backend/.env.example to backend/.env and configure it."
  exit 1
fi

# Verify critical vars
source .env 2>/dev/null || true
if [ -z "$MONGODB_URI" ] || [ "$MONGODB_URI" = "" ]; then
  echo "✗ ERROR: MONGODB_URI is not set in backend/.env"
  exit 1
fi
if [ -z "$AUTH_TOKEN_SECRET" ] || [ "$AUTH_TOKEN_SECRET" = "replace-with-a-long-random-per-environment-secret" ]; then
  echo "✗ ERROR: AUTH_TOKEN_SECRET is not set or is still the placeholder"
  exit 1
fi
echo "✓ Configuration validated"

# ── Step 3: Frontend build ──
echo ""
echo "── Step 3: Building frontend ──"
cd "$SCRIPT_DIR/frontend"
npm ci 2>/dev/null || npm install
npx vite build
echo "✓ Frontend built"

# ── Step 4: Create logs directory ──
mkdir -p "$SCRIPT_DIR/logs"

# ── Step 5: PM2 start/restart ──
echo ""
echo "── Step 5: Starting backend via PM2 ──"
cd "$SCRIPT_DIR"

# Load .env into environment for PM2
set -a
source backend/.env
set +a

if pm2 describe mep-new-app > /dev/null 2>&1; then
  pm2 restart ecosystem.config.js
  echo "✓ Backend restarted"
else
  pm2 start ecosystem.config.js
  echo "✓ Backend started"
fi

pm2 save
echo "✓ PM2 process list saved"

echo ""
echo "=== Deployment Complete ==="
echo "  Backend:  http://127.0.0.1:4000 (via PM2)"
echo "  Frontend: Served by Nginx from frontend/dist/"
echo "  Logs:     pm2 logs mep-new-app"
echo "  Status:   pm2 status"
echo ""
echo "Next steps:"
echo "  1. Configure Nginx (see nginx.conf.example)"
echo "  2. Set up SSL: sudo certbot --nginx -d YOUR_DOMAIN"
echo "  3. pm2 startup  (auto-start on boot)"
