#!/bin/bash
# ══════════════════════════════════════════════════════════════
# MEP New App — Production Health Check
# ══════════════════════════════════════════════════════════════
#
# RUN THIS ON THE VPS after deployment.
#
# Usage:
#   bash deployment/health-check-new-app.sh [DOMAIN]
#
# Examples:
#   bash deployment/health-check-new-app.sh
#   bash deployment/health-check-new-app.sh app.mep-projects.spereon.codes

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASSED=0
FAILED=0
WARNINGS=0

pass() { ((PASSED++)); echo -e "  ${GREEN}✓${NC} $1"; }
fail() { ((FAILED++)); echo -e "  ${RED}✗${NC} $1"; }
warn() { ((WARNINGS++)); echo -e "  ${YELLOW}!${NC} $1"; }

DOMAIN="${1:-}"
BACKEND_PORT=4000
LOCAL_API="http://127.0.0.1:${BACKEND_PORT}"
PM2_NAME="mep-new-app"
DEPLOY_DIR="/var/www/mep-new-app"

echo ""
echo "══════════════════════════════════════════════════════════════"
echo " MEP New App — Health Check"
echo " $(date)"
echo " Hostname: $(hostname)"
echo "══════════════════════════════════════════════════════════════"

# ── 1. INFRASTRUCTURE ──
echo ""
echo "── Infrastructure ──"

# Disk
DISK_PCT=$(df / | awk 'NR==2{print $5}' | tr -d '%')
if [ "$DISK_PCT" -lt 90 ]; then
  pass "Disk usage: ${DISK_PCT}%"
else
  fail "Disk usage: ${DISK_PCT}% (>90%!)"
fi

# Memory
MEM_AVAIL=$(free -m 2>/dev/null | awk 'NR==2{print $7}')
if [ -n "$MEM_AVAIL" ] && [ "$MEM_AVAIL" -gt 100 ]; then
  pass "Available RAM: ${MEM_AVAIL}MB"
else
  warn "Available RAM: ${MEM_AVAIL:-unknown}MB (low)"
fi

# Port
if ss -tlnp 2>/dev/null | grep -q ":${BACKEND_PORT} " || netstat -tlnp 2>/dev/null | grep -q ":${BACKEND_PORT} "; then
  pass "Port ${BACKEND_PORT} is listening"
else
  fail "Port ${BACKEND_PORT} is NOT listening"
fi

# PM2
PM2_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; procs=json.load(sys.stdin); matched=[p for p in procs if p['name']=='$PM2_NAME']; print(matched[0]['pm2_env']['status'] if matched else 'missing')" 2>/dev/null || echo "unknown")
if [ "$PM2_STATUS" = "online" ]; then
  pass "PM2 process '$PM2_NAME': online"
else
  fail "PM2 process '$PM2_NAME': $PM2_STATUS"
fi

# PM2 restarts
PM2_RESTARTS=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; procs=json.load(sys.stdin); matched=[p for p in procs if p['name']=='$PM2_NAME']; print(matched[0]['pm2_env']['restart_time'] if matched else '-1')" 2>/dev/null || echo "-1")
if [ "$PM2_RESTARTS" = "0" ]; then
  pass "PM2 restarts: 0"
elif [ "$PM2_RESTARTS" != "-1" ]; then
  warn "PM2 restarts: $PM2_RESTARTS (check logs)"
fi

# PM2 memory
PM2_MEM=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; procs=json.load(sys.stdin); matched=[p for p in procs if p['name']=='$PM2_NAME']; print(round(matched[0]['monit']['memory']/(1024*1024),1) if matched else 0)" 2>/dev/null || echo "0")
if [ "$PM2_MEM" != "0" ]; then
  pass "PM2 memory: ${PM2_MEM}MB"
fi

# Nginx
if systemctl is-active --quiet nginx 2>/dev/null; then
  pass "Nginx: active"
else
  fail "Nginx: not running"
fi

# ── 2. BACKEND ──
echo ""
echo "── Backend ──"

# Health endpoint
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "${LOCAL_API}/api/health" 2>/dev/null || echo "000")
if [ "$HEALTH" = "200" ]; then
  pass "Health endpoint: 200"
else
  fail "Health endpoint: HTTP $HEALTH"
fi

# Health body
HEALTH_BODY=$(curl -s "${LOCAL_API}/api/health" 2>/dev/null || echo "{}")
if echo "$HEALTH_BODY" | grep -q '"ok":true'; then
  pass "Health body: {ok: true}"
else
  fail "Health body: $HEALTH_BODY"
fi

# ── 3. SECURITY ──
echo ""
echo "── Security ──"

# Unauthenticated API → 401
UNAUTH=$(curl -s -o /dev/null -w "%{http_code}" "${LOCAL_API}/api/users" 2>/dev/null || echo "000")
if [ "$UNAUTH" = "401" ]; then
  pass "Unauthenticated /api/users: 401"
else
  fail "Unauthenticated /api/users: HTTP $UNAUTH (expected 401)"
fi

# Invalid token → 401
BADTOKEN=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer invalid-token-12345" "${LOCAL_API}/api/users" 2>/dev/null || echo "000")
if [ "$BADTOKEN" = "401" ]; then
  pass "Invalid token /api/users: 401"
else
  fail "Invalid token /api/users: HTTP $BADTOKEN (expected 401)"
fi

# Unauthenticated quotations → 401
UNAUTH_Q=$(curl -s -o /dev/null -w "%{http_code}" "${LOCAL_API}/api/quotations" 2>/dev/null || echo "000")
if [ "$UNAUTH_Q" = "401" ]; then
  pass "Unauthenticated /api/quotations: 401"
else
  fail "Unauthenticated /api/quotations: HTTP $UNAUTH_Q (expected 401)"
fi

# ── 4. FRONTEND ──
echo ""
echo "── Frontend ──"

# Check dist exists
if [ -f "$DEPLOY_DIR/frontend/dist/index.html" ]; then
  pass "Frontend dist/index.html exists"
else
  fail "Frontend dist/index.html missing"
fi

# Check assets
ASSET_COUNT=$(ls "$DEPLOY_DIR/frontend/dist/assets/" 2>/dev/null | wc -l)
if [ "$ASSET_COUNT" -gt 0 ]; then
  pass "Frontend assets: $ASSET_COUNT files"
else
  fail "Frontend assets: none found"
fi

# ── 5. DOMAIN (if provided) ──
if [ -n "$DOMAIN" ]; then
  echo ""
  echo "── Domain: $DOMAIN ──"

  # HTTP response
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -L "http://$DOMAIN" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "302" ]; then
    pass "HTTP $DOMAIN: $HTTP_CODE"
  else
    fail "HTTP $DOMAIN: $HTTP_CODE"
  fi

  # HTTPS response
  HTTPS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN" 2>/dev/null || echo "000")
  if [ "$HTTPS_CODE" = "200" ]; then
    pass "HTTPS $DOMAIN: $HTTPS_CODE"
  elif [ "$HTTPS_CODE" = "000" ]; then
    warn "HTTPS $DOMAIN: not available (certificate not yet configured?)"
  else
    fail "HTTPS $DOMAIN: $HTTPS_CODE"
  fi

  # API via domain
  DOMAIN_HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/api/health" 2>/dev/null || echo "000")
  if [ "$DOMAIN_HEALTH" = "200" ]; then
    pass "HTTPS API health via domain: 200"
  elif [ "$DOMAIN_HEALTH" = "000" ]; then
    DOMAIN_HEALTH_HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://$DOMAIN/api/health" 2>/dev/null || echo "000")
    if [ "$DOMAIN_HEALTH_HTTP" = "200" ]; then
      pass "HTTP API health via domain: 200 (HTTPS not yet configured)"
    else
      fail "API health via domain: HTTP $DOMAIN_HEALTH_HTTP"
    fi
  else
    fail "API health via domain: HTTPS $DOMAIN_HEALTH"
  fi

  # Frontend loads via domain
  DOMAIN_HTML=$(curl -s "http://$DOMAIN" 2>/dev/null || echo "")
  if echo "$DOMAIN_HTML" | grep -q '<div id="root"'; then
    pass "Frontend HTML loads via domain (has #root)"
  elif echo "$DOMAIN_HTML" | grep -q '<script'; then
    pass "Frontend HTML loads via domain (has scripts)"
  else
    warn "Frontend HTML may not be loading correctly via domain"
  fi
fi

# ── 6. EXISTING SYSTEMS (PROTECTED) ──
echo ""
echo "── Protected Systems ──"

# Check ems-backend
if [ -d "/var/www/employee-management-system" ]; then
  pass "ems-backend /var/www/employee-management-system: intact"
else
  warn "/var/www/employee-management-system not found"
fi

# Check glampower
if [ -d "/var/www/glampower" ]; then
  pass "glampower /var/www/glampower: intact"
else
  warn "/var/www/glampower not found"
fi

# Check spereon.codes
if [ -d "/var/www/spereon.codes" ]; then
  pass "spereon.codes /var/www/spereon.codes: intact"
else
  warn "/var/www/spereon.codes not found"
fi

# Check other PM2 processes are still running
for PROC_NAME in ems-backend glampower spereon.codes; do
  PROC_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; procs=json.load(sys.stdin); matched=[p for p in procs if p['name']=='$PROC_NAME']; print(matched[0]['pm2_env']['status'] if matched else 'missing')" 2>/dev/null || echo "unknown")
  if [ "$PROC_STATUS" = "online" ]; then
    pass "PM2 $PROC_NAME: online (untouched)"
  elif [ "$PROC_STATUS" = "missing" ]; then
    warn "PM2 $PROC_NAME: not found (may use different name)"
  else
    fail "PM2 $PROC_NAME: $PROC_STATUS (was it affected?)"
  fi
done

# ── SUMMARY ──
echo ""
echo "══════════════════════════════════════════════════════════════"
echo ""
TOTAL=$((PASSED + FAILED))
echo -e "  ${GREEN}Passed:${NC}   $PASSED"
echo -e "  ${RED}Failed:${NC}   $FAILED"
echo -e "  ${YELLOW}Warnings:${NC} $WARNINGS"
echo -e "  Total:    $TOTAL checks"
echo ""

if [ "$FAILED" -eq 0 ]; then
  echo -e "  ${GREEN}HEALTH CHECK: ALL PASSED${NC}"
else
  echo -e "  ${RED}HEALTH CHECK: $FAILED FAILURE(S)${NC}"
fi
echo ""
echo "══════════════════════════════════════════════════════════════"

exit $FAILED
