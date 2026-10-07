#!/bin/bash
# ══════════════════════════════════════════════════════════════
# MEP New App — Safe Production Deployment Script
# ══════════════════════════════════════════════════════════════
#
# RUN THIS ON THE VPS ONLY.
# Do NOT run on your local machine.
#
# Prerequisites:
#   1. Node.js >= 18
#   2. MongoDB running (local or Atlas)
#   3. PM2 installed globally: npm install -g pm2
#   4. Nginx installed
#   5. new-app/ directory uploaded to VPS
#
# Usage:
#   cd /path/to/uploaded/new-app
#   bash deployment/deploy-new-app.sh
#
# This script will NOT:
#   - Stop or modify any existing PM2 processes (ems-backend, glampower, spereon.codes)
#   - Delete or overwrite /var/www/employee-management-system, /var/www/glampower, /var/www/spereon.codes
#   - Modify existing Nginx configurations for other sites
#   - Touch existing MongoDB databases (mep_projects or any other)

set -euo pipefail

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

log()   { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${YELLOW}[!]${NC} $1"; }
err()   { echo -e "${RED}[✗]${NC} $1"; }
info()  { echo -e "${CYAN}[→]${NC} $1"; }

DEPLOY_DIR="/var/www/mep-new-app"
PM2_NAME="mep-new-app"
BACKEND_PORT=4000
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "══════════════════════════════════════════════════════════════"
echo " MEP New App — Production Deployment"
echo " Timestamp: $(date)"
echo " Hostname:  $(hostname)"
echo " Source:    $SCRIPT_DIR"
echo " Target:    $DEPLOY_DIR"
echo "══════════════════════════════════════════════════════════════"
echo ""

# ══════════════════════════════════════════════════════════════
# STEP 1: SAFETY CHECKS
# ══════════════════════════════════════════════════════════════
info "Step 1: Safety checks"

# Confirm VPS
echo ""
echo "  Hostname: $(hostname)"
echo "  OS:       $(cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '"' || uname -s)"
echo "  Kernel:   $(uname -r)"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
  err "Node.js is not installed. Install Node.js >= 18 first."
  exit 1
fi
NODE_VER=$(node --version)
info "Node.js: $NODE_VER"

# Check npm
if ! command -v npm &>/dev/null; then
  err "npm is not installed."
  exit 1
fi
info "npm: $(npm --version)"

# Check PM2
if ! command -v pm2 &>/dev/null; then
  err "PM2 is not installed. Run: npm install -g pm2"
  exit 1
fi
info "PM2: $(pm2 --version)"

# Check Nginx
if ! command -v nginx &>/dev/null; then
  err "Nginx is not installed."
  exit 1
fi
info "Nginx: $(nginx -v 2>&1 | cut -d/ -f2)"

# Check MongoDB connectivity
if command -v mongosh &>/dev/null; then
  info "mongosh available"
elif command -v mongo &>/dev/null; then
  info "mongo shell available"
else
  warn "Neither mongosh nor mongo CLI found. MongoDB connectivity will be verified via the application."
fi

# Check disk space
DISK_AVAIL=$(df -h / | awk 'NR==2{print $4}')
info "Available disk: $DISK_AVAIL"

# Check RAM
MEM_AVAIL=$(free -h 2>/dev/null | awk 'NR==2{print $7}' || echo "unknown")
info "Available RAM: $MEM_AVAIL"

# ══════════════════════════════════════════════════════════════
# STEP 2: INSPECT EXISTING PM2 PROCESSES
# ══════════════════════════════════════════════════════════════
echo ""
info "Step 2: Current PM2 processes"
pm2 list || true
echo ""

# Check if port 4000 is in use
if ss -tlnp 2>/dev/null | grep -q ":${BACKEND_PORT} " || netstat -tlnp 2>/dev/null | grep -q ":${BACKEND_PORT} "; then
  warn "Port ${BACKEND_PORT} is currently in use!"
  echo ""
  ss -tlnp 2>/dev/null | grep ":${BACKEND_PORT} " || netstat -tlnp 2>/dev/null | grep ":${BACKEND_PORT} " || true
  echo ""
  echo "  If this is a previous mep-new-app process, it will be restarted."
  echo "  If this is a DIFFERENT application, deployment must use a different port."
  echo ""
  read -p "  Continue with port ${BACKEND_PORT}? (yes/no): " PORT_CONFIRM
  if [ "$PORT_CONFIRM" != "yes" ]; then
    err "Aborted. Change BACKEND_PORT in this script or free port ${BACKEND_PORT}."
    exit 1
  fi
fi

# ══════════════════════════════════════════════════════════════
# STEP 3: INSPECT TARGET DIRECTORY
# ══════════════════════════════════════════════════════════════
echo ""
info "Step 3: Inspect target directory"

if [ -d "$DEPLOY_DIR" ]; then
  warn "$DEPLOY_DIR already exists!"
  echo ""
  echo "  Contents:"
  ls -la "$DEPLOY_DIR" | head -15
  echo ""
  echo "  This deployment will UPDATE the existing installation."
  echo "  A backup will be created first."
  echo ""
  read -p "  Continue and update $DEPLOY_DIR? (yes/no): " DIR_CONFIRM
  if [ "$DIR_CONFIRM" != "yes" ]; then
    err "Aborted."
    exit 1
  fi
fi

# ══════════════════════════════════════════════════════════════
# STEP 4: CONFIRMATION
# ══════════════════════════════════════════════════════════════
echo ""
echo "══════════════════════════════════════════════════════════════"
echo " DEPLOYMENT SUMMARY"
echo ""
echo "  Source:     $SCRIPT_DIR"
echo "  Target:     $DEPLOY_DIR"
echo "  PM2 name:   $PM2_NAME"
echo "  Port:       $BACKEND_PORT"
echo ""
echo "  WILL NOT TOUCH:"
echo "    /var/www/employee-management-system (ems-backend)"
echo "    /var/www/glampower (glampower)"
echo "    /var/www/spereon.codes (spereon.codes)"
echo "    Any existing PM2 processes except $PM2_NAME"
echo "    Any existing Nginx server blocks for other sites"
echo "    Any existing MongoDB databases (mep_projects, etc.)"
echo "══════════════════════════════════════════════════════════════"
echo ""
read -p "DEPLOY NEW APP ONLY? Type YES to continue: " FINAL_CONFIRM
if [ "$FINAL_CONFIRM" != "YES" ]; then
  err "Aborted by user."
  exit 1
fi

# ══════════════════════════════════════════════════════════════
# STEP 5: BACKUP (if target exists)
# ══════════════════════════════════════════════════════════════
echo ""
info "Step 5: Backup"

BACKUP_BASE="/var/www/backups/mep-new-app"
mkdir -p "$BACKUP_BASE"

# Backup existing deployment if present
if [ -d "$DEPLOY_DIR" ]; then
  BACKUP_PATH="${BACKUP_BASE}/app_${TIMESTAMP}"
  info "Backing up $DEPLOY_DIR → $BACKUP_PATH"
  cp -a "$DEPLOY_DIR" "$BACKUP_PATH"
  log "Application backup: $BACKUP_PATH"
fi

# Backup current Nginx configs
NGINX_BACKUP="${BACKUP_BASE}/nginx_${TIMESTAMP}"
mkdir -p "$NGINX_BACKUP"
cp -a /etc/nginx/sites-available/ "$NGINX_BACKUP/sites-available" 2>/dev/null || true
cp -a /etc/nginx/sites-enabled/ "$NGINX_BACKUP/sites-enabled" 2>/dev/null || true
log "Nginx backup: $NGINX_BACKUP"

# Backup PM2 process list
pm2 save 2>/dev/null || true
pm2 list > "${BACKUP_BASE}/pm2_list_${TIMESTAMP}.txt" 2>/dev/null || true
log "PM2 list backup: ${BACKUP_BASE}/pm2_list_${TIMESTAMP}.txt"

echo ""
log "All backups stored under: $BACKUP_BASE"

# ══════════════════════════════════════════════════════════════
# STEP 6: COPY APPLICATION FILES
# ══════════════════════════════════════════════════════════════
echo ""
info "Step 6: Deploy application files"

mkdir -p "$DEPLOY_DIR"

# Copy backend
info "Copying backend..."
rsync -a --delete "$SCRIPT_DIR/backend/" "$DEPLOY_DIR/backend/" \
  --exclude node_modules \
  --exclude .env \
  --exclude logs
log "Backend files deployed"

# Copy frontend source (for build)
info "Copying frontend..."
rsync -a --delete "$SCRIPT_DIR/frontend/" "$DEPLOY_DIR/frontend/" \
  --exclude node_modules \
  --exclude dist
log "Frontend files deployed"

# Copy deployment configs
cp "$SCRIPT_DIR/ecosystem.config.js" "$DEPLOY_DIR/"
log "ecosystem.config.js deployed"

# Create logs directory
mkdir -p "$DEPLOY_DIR/logs"

# ══════════════════════════════════════════════════════════════
# STEP 7: ENVIRONMENT CONFIGURATION
# ══════════════════════════════════════════════════════════════
echo ""
info "Step 7: Environment configuration"

if [ ! -f "$DEPLOY_DIR/backend/.env" ]; then
  warn "backend/.env does not exist!"
  echo ""
  echo "  You must create $DEPLOY_DIR/backend/.env before proceeding."
  echo "  Template: $SCRIPT_DIR/deployment/production.env.example"
  echo ""
  echo "  Required values:"
  echo "    MONGODB_URI=mongodb://127.0.0.1:27017/mep_new_app"
  echo "    AUTH_TOKEN_SECRET=<generate with: openssl rand -hex 48>"
  echo "    AUTH_TOKEN_EXPIRY=15m"
  echo "    PORT=$BACKEND_PORT"
  echo ""
  read -p "  Create .env now and press Enter to continue, or Ctrl+C to abort: "
fi

# Validate .env
if [ ! -f "$DEPLOY_DIR/backend/.env" ]; then
  err "backend/.env still missing. Cannot continue."
  exit 1
fi

# Source and validate
set +u
source "$DEPLOY_DIR/backend/.env" 2>/dev/null || true
set -u

if [ -z "${MONGODB_URI:-}" ]; then
  err "MONGODB_URI is not set in backend/.env"
  exit 1
fi

if [ -z "${AUTH_TOKEN_SECRET:-}" ] || [ "${AUTH_TOKEN_SECRET:-}" = "replace-with-a-long-random-per-environment-secret" ]; then
  err "AUTH_TOKEN_SECRET is not set or is still the placeholder value."
  echo "  Generate one: openssl rand -hex 48"
  exit 1
fi

log "Environment configuration validated"

# ══════════════════════════════════════════════════════════════
# STEP 8: INSTALL BACKEND DEPENDENCIES
# ══════════════════════════════════════════════════════════════
echo ""
info "Step 8: Backend dependencies"
cd "$DEPLOY_DIR/backend"
npm ci --production 2>/dev/null || npm install --production
log "Backend dependencies installed"

# ══════════════════════════════════════════════════════════════
# STEP 9: FRONTEND BUILD
# ══════════════════════════════════════════════════════════════
echo ""
info "Step 9: Frontend build"
cd "$DEPLOY_DIR/frontend"

# Create/verify production env
echo 'VITE_API_BASE_URL=' > .env.production

npm ci 2>/dev/null || npm install
npx vite build

# Verify build output
if [ ! -f "$DEPLOY_DIR/frontend/dist/index.html" ]; then
  err "Frontend build failed — dist/index.html not found!"
  exit 1
fi

ASSET_COUNT=$(ls "$DEPLOY_DIR/frontend/dist/assets/" 2>/dev/null | wc -l)
if [ "$ASSET_COUNT" -eq 0 ]; then
  err "Frontend build failed — no assets generated!"
  exit 1
fi

log "Frontend built: $ASSET_COUNT asset files"

# Verify no dev URLs leaked
if grep -q '"http://localhost:[0-9]*"' "$DEPLOY_DIR/frontend/dist/assets/"*.js 2>/dev/null; then
  err "WARNING: Development localhost URLs found in production build!"
  exit 1
fi

log "No development URLs in production build"

# ══════════════════════════════════════════════════════════════
# STEP 10: START/RESTART BACKEND VIA PM2
# ══════════════════════════════════════════════════════════════
echo ""
info "Step 10: Backend startup"
cd "$DEPLOY_DIR"

# Load .env into environment for PM2
set -a
source backend/.env
set +a

if pm2 describe "$PM2_NAME" > /dev/null 2>&1; then
  info "Restarting existing $PM2_NAME process..."
  pm2 restart ecosystem.config.js
  log "Backend restarted"
else
  info "Starting new $PM2_NAME process..."
  pm2 start ecosystem.config.js
  log "Backend started"
fi

pm2 save
log "PM2 process list saved"

# Wait for startup
sleep 3

# Verify health
HEALTH_RESP=$(curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:${BACKEND_PORT}/api/health" 2>/dev/null || echo "000")
if [ "$HEALTH_RESP" = "200" ]; then
  log "Backend health check: 200 OK"
else
  err "Backend health check failed: HTTP $HEALTH_RESP"
  echo ""
  echo "  Check logs: pm2 logs $PM2_NAME --lines 30"
  echo ""
  pm2 logs "$PM2_NAME" --lines 15 --nostream 2>/dev/null || true
  exit 1
fi

# ══════════════════════════════════════════════════════════════
# STEP 11: NGINX CONFIGURATION
# ══════════════════════════════════════════════════════════════
echo ""
info "Step 11: Nginx configuration"

NGINX_CONF="/etc/nginx/sites-available/mep-new-app"

if [ -f "$NGINX_CONF" ]; then
  warn "Nginx config $NGINX_CONF already exists."
  echo "  It will be updated. Backup was already created."
fi

echo ""
echo "  The Nginx configuration requires your NEW APP domain."
echo "  This is the domain where the new application will be accessible."
echo ""
read -p "  Enter NEW APP domain (e.g., app.mep-projects.spereon.codes): " NEW_APP_DOMAIN

if [ -z "$NEW_APP_DOMAIN" ]; then
  warn "No domain entered. Nginx configuration skipped."
  warn "You must configure Nginx manually using: $SCRIPT_DIR/deployment/nginx-new-app.conf.example"
else
  # Generate Nginx config from template
  sed "s/NEW_APP_DOMAIN/$NEW_APP_DOMAIN/g" \
    "$SCRIPT_DIR/deployment/nginx-new-app.conf.example" \
    > "$NGINX_CONF"

  # Enable site
  ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/mep-new-app

  # Validate
  if nginx -t 2>&1; then
    log "Nginx configuration valid"
    systemctl reload nginx
    log "Nginx reloaded"
  else
    err "Nginx configuration INVALID — not reloaded!"
    echo "  Fix the config at: $NGINX_CONF"
    echo "  Then run: sudo nginx -t && sudo systemctl reload nginx"
  fi

  echo ""
  info "To enable HTTPS after DNS propagation:"
  echo "  sudo certbot --nginx -d $NEW_APP_DOMAIN"
  echo ""
  echo "  This will NOT affect existing certificates for other sites."
fi

# ══════════════════════════════════════════════════════════════
# STEP 12: FINAL STATUS
# ══════════════════════════════════════════════════════════════
echo ""
echo "══════════════════════════════════════════════════════════════"
echo ""
log "DEPLOYMENT COMPLETE"
echo ""
echo "  Application:  $DEPLOY_DIR"
echo "  PM2 process:  $PM2_NAME"
echo "  Backend:      http://127.0.0.1:${BACKEND_PORT}"
echo "  Health:       http://127.0.0.1:${BACKEND_PORT}/api/health"
echo "  Frontend:     $DEPLOY_DIR/frontend/dist/"
echo "  Logs:         pm2 logs $PM2_NAME"
echo "  Status:       pm2 status"
echo "  Backups:      $BACKUP_BASE"
echo ""
echo "  NEXT STEPS:"
echo "  1. Create initial Super Admin (see VPS_DEPLOYMENT_GUIDE.md §13)"
echo "  2. Seed default plans: POST /api/subscriptions/plans/seed"
echo "  3. Configure DNS for ${NEW_APP_DOMAIN:-NEW_APP_DOMAIN}"
echo "  4. Enable HTTPS: sudo certbot --nginx -d ${NEW_APP_DOMAIN:-NEW_APP_DOMAIN}"
echo "  5. Run health check: bash deployment/health-check-new-app.sh"
echo ""
echo "  PROTECTED (untouched):"
echo "    /var/www/employee-management-system (ems-backend)"
echo "    /var/www/glampower (glampower)"
echo "    /var/www/spereon.codes (spereon.codes)"
echo "    Existing PM2 processes: ems-backend, glampower, spereon.codes"
echo "    Existing MongoDB databases (mep_projects, etc.)"
echo ""
echo "══════════════════════════════════════════════════════════════"
