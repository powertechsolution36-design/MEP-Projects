#!/bin/bash
# ══════════════════════════════════════════════════════════════
# MEP New App — Rollback Script
# ══════════════════════════════════════════════════════════════
#
# This script ONLY rolls back the NEW APP.
# It does NOT touch:
#   - /var/www/employee-management-system (ems-backend)
#   - /var/www/glampower (glampower)
#   - /var/www/spereon.codes (spereon.codes)
#   - Any existing PM2 processes except mep-new-app
#   - Any existing Nginx server blocks except mep-new-app
#   - Any existing MongoDB databases
#
# Usage:
#   sudo bash deployment/rollback-new-app.sh

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PM2_NAME="mep-new-app"
DEPLOY_DIR="/var/www/mep-new-app"
BACKUP_BASE="/var/www/backups/mep-new-app"

echo ""
echo "══════════════════════════════════════════════════════════════"
echo " MEP New App — Rollback"
echo " $(date)"
echo ""
echo " This will:"
echo "   1. Stop the mep-new-app PM2 process"
echo "   2. Disable the mep-new-app Nginx server block"
echo "   3. Optionally restore from a backup"
echo ""
echo " This will NOT touch:"
echo "   /var/www/employee-management-system (ems-backend)"
echo "   /var/www/glampower (glampower)"
echo "   /var/www/spereon.codes (spereon.codes)"
echo "   Any other PM2 processes (ems-backend, glampower, spereon.codes)"
echo "   Any existing MongoDB databases"
echo "══════════════════════════════════════════════════════════════"
echo ""

read -p "Proceed with rollback? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

# ── Step 1: Stop PM2 process ──
echo ""
echo -e "${CYAN}[→]${NC} Stopping PM2 process..."

if pm2 describe "$PM2_NAME" > /dev/null 2>&1; then
  pm2 stop "$PM2_NAME"
  echo -e "${GREEN}[✓]${NC} $PM2_NAME stopped"

  read -p "Delete PM2 process entry entirely? (yes/no): " DEL_PM2
  if [ "$DEL_PM2" = "yes" ]; then
    pm2 delete "$PM2_NAME"
    pm2 save
    echo -e "${GREEN}[✓]${NC} $PM2_NAME removed from PM2"
  fi
else
  echo -e "${YELLOW}[!]${NC} $PM2_NAME not found in PM2"
fi

# ── Step 2: Disable Nginx server block ──
echo ""
echo -e "${CYAN}[→]${NC} Disabling Nginx server block..."

if [ -L "/etc/nginx/sites-enabled/mep-new-app" ]; then
  rm "/etc/nginx/sites-enabled/mep-new-app"
  echo -e "${GREEN}[✓]${NC} Nginx site disabled"

  if nginx -t 2>&1; then
    systemctl reload nginx
    echo -e "${GREEN}[✓]${NC} Nginx reloaded"
  else
    echo -e "${RED}[✗]${NC} Nginx config invalid after removing site — check manually"
  fi
else
  echo -e "${YELLOW}[!]${NC} No mep-new-app symlink in sites-enabled"
fi

# ── Step 3: Restore from backup (optional) ──
echo ""
echo -e "${CYAN}[→]${NC} Available backups:"

if [ -d "$BACKUP_BASE" ]; then
  ls -lt "$BACKUP_BASE" | grep "^d" | head -10
  echo ""
  read -p "Restore from a backup? (yes/no): " DO_RESTORE
  if [ "$DO_RESTORE" = "yes" ]; then
    read -p "Enter backup directory name (e.g., app_20261006_120000): " BACKUP_NAME
    RESTORE_PATH="$BACKUP_BASE/$BACKUP_NAME"
    if [ -d "$RESTORE_PATH" ]; then
      echo -e "${CYAN}[→]${NC} Restoring from $RESTORE_PATH..."
      rsync -a --delete "$RESTORE_PATH/" "$DEPLOY_DIR/"
      echo -e "${GREEN}[✓]${NC} Restored from backup"
      echo ""
      echo "  To restart the restored version:"
      echo "    cd $DEPLOY_DIR"
      echo "    set -a; source backend/.env; set +a"
      echo "    pm2 start ecosystem.config.js"
      echo "    sudo ln -sf /etc/nginx/sites-available/mep-new-app /etc/nginx/sites-enabled/"
      echo "    sudo nginx -t && sudo systemctl reload nginx"
    else
      echo -e "${RED}[✗]${NC} Backup not found: $RESTORE_PATH"
    fi
  fi
else
  echo -e "${YELLOW}[!]${NC} No backup directory found at $BACKUP_BASE"
fi

echo ""
echo "══════════════════════════════════════════════════════════════"
echo ""
echo -e "${GREEN}[✓]${NC} Rollback complete"
echo ""
echo "  The NEW APP is stopped and its Nginx block is disabled."
echo "  The existing PWA and V2 backend are unaffected."
echo ""
echo "  MongoDB database 'mep_new_app' has NOT been dropped."
echo "  To drop it manually if needed:"
echo "    mongosh mep_new_app --eval 'db.dropDatabase()'"
echo ""
echo "══════════════════════════════════════════════════════════════"
