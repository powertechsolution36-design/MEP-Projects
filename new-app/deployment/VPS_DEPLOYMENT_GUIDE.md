# MEP New App — VPS Deployment Guide

## Overview

This guide deploys the **MEP New App** alongside the existing production systems.
The existing PWA and V2 backend remain **completely untouched**.

**VPS current state:** The old MEP V2 has already been removed from the VPS (PM2 process removed, port 4001 freed, `/var/www/mep-projects` removed, old Nginx configs disabled, backup at `/root/mep-old-backup/`). Three other applications are running and MUST remain untouched.

| Item | Existing (DO NOT TOUCH) | New App |
|------|------------------------|---------|
| App 1 | `ems-backend` PM2 / `/var/www/employee-management-system` | — |
| App 2 | `glampower` PM2 / `/var/www/glampower` | — |
| App 3 | `spereon.codes` PM2 / `/var/www/spereon.codes` | — |
| New App | — | `/var/www/mep-new-app/frontend/dist` |
| Backend port | (varies per app) | 4000 |
| PM2 process | ems-backend, glampower, spereon.codes | `mep-new-app` |
| Domain | (each has own domain) | `mep-projects.spereon.codes` |
| API domain | — | Same as frontend (same-origin) |
| Database | mep_projects (old, keep untouched) | `mep_new_app` |
| Nginx config | (each has own config) | `mep-new-app` |

---

## Prerequisites

On the VPS, ensure:

- Node.js >= 18: `node --version`
- npm: `npm --version`
- PM2: `pm2 --version` (install: `npm install -g pm2`)
- Nginx: `nginx -v`
- MongoDB 6+ running: `systemctl status mongod` or `mongosh --eval "db.version()"`
- At least 500MB free disk: `df -h /`
- At least 256MB free RAM: `free -h`

---

## §1. Upload New App to VPS

From your **local machine**, upload the `new-app/` directory to the VPS:

```bash
# LOCAL MACHINE
scp -r /path/to/new-app user@YOUR_VPS_IP:/tmp/new-app-upload
```

Or use your preferred method (SFTP, rsync, git clone).

---

## §2. VPS Discovery (Read-Only)

**VPS** — Run these BEFORE changing anything:

```bash
# VPS
echo "=== OS ===" && cat /etc/os-release | head -5
echo "=== Node ===" && node --version
echo "=== npm ===" && npm --version
echo "=== PM2 ===" && pm2 --version
echo "=== Nginx ===" && nginx -v 2>&1
echo "=== MongoDB ===" && mongosh --eval "db.version()" 2>/dev/null || mongo --eval "db.version()" 2>/dev/null || echo "Not found"
echo "=== Disk ===" && df -h /
echo "=== RAM ===" && free -h
echo "=== Ports ===" && ss -tlnp | grep -E ":(80|443|4000|4001|27017) "
echo "=== PM2 processes ===" && pm2 list
echo "=== Nginx sites ===" && ls -la /etc/nginx/sites-enabled/
echo "=== /var/www contents ===" && ls -la /var/www/
```

**Review the output.** Confirm:
- Port 4000 is not in use (the old V2 on port 4001 has been removed)
- `/var/www/mep-new-app` does not already exist, or if it does, understand what's there
- MongoDB is running
- Three existing PM2 apps are online: `ems-backend`, `glampower`, `spereon.codes`
- Three existing paths are intact: `/var/www/employee-management-system`, `/var/www/glampower`, `/var/www/spereon.codes`

---

## §3. Backup

**VPS** — Create backups before any changes:

```bash
# VPS
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/www/backups/mep-new-app"
sudo mkdir -p "$BACKUP_DIR"

# Backup Nginx configs
sudo cp -a /etc/nginx/sites-available/ "$BACKUP_DIR/nginx-sites-available_${TIMESTAMP}"
sudo cp -a /etc/nginx/sites-enabled/ "$BACKUP_DIR/nginx-sites-enabled_${TIMESTAMP}"

# Backup PM2 process list
pm2 list > "$BACKUP_DIR/pm2_list_${TIMESTAMP}.txt"
pm2 save

# Backup existing new-app directory if it exists
if [ -d "/var/www/mep-new-app" ]; then
  sudo cp -a /var/www/mep-new-app "$BACKUP_DIR/app_${TIMESTAMP}"
fi

echo "Backups saved to: $BACKUP_DIR"
ls -la "$BACKUP_DIR"
```

---

## §4. MongoDB Setup

**VPS** — Create the dedicated database:

```bash
# VPS
mongosh <<'EOF'
use mep_new_app
db.createCollection("_init")
db._init.drop()
print("Database mep_new_app ready")
show dbs
EOF
```

If using authentication:

```bash
# VPS
mongosh admin <<'EOF'
db.createUser({
  user: "mep_new_app_user",
  pwd: passwordPrompt(),
  roles: [{ role: "readWrite", db: "mep_new_app" }]
})
EOF
```

If using auth, your `MONGODB_URI` will be:
`mongodb://mep_new_app_user:PASSWORD@127.0.0.1:27017/mep_new_app?authSource=admin`

If MongoDB has no authentication enabled (common on single-server setups):
`mongodb://127.0.0.1:27017/mep_new_app`

> **SECURITY NOTE:** This VPS currently has MongoDB running with "Access control is not enabled."
> This means any process on the server can read/write any database without credentials.
> **Post-deployment recommendation:** Enable MongoDB authentication:
> 1. Create an admin user in the `admin` database
> 2. Create a dedicated user for `mep_new_app` (as shown above)
> 3. Enable `security.authorization: enabled` in `/etc/mongod.conf`
> 4. Restart `mongod`
> 5. Update `MONGODB_URI` in `backend/.env` with credentials
> This is not blocking for deployment but should be addressed for production hardening.

**IMPORTANT:** The old `mep_projects` database still exists on this server. Do NOT drop it, modify it, or point the new app at it.

---

## §5. Run the Deployment Script

**VPS:**

```bash
# VPS
cd /tmp/new-app-upload   # or wherever you uploaded new-app/
sudo bash deployment/deploy-new-app.sh
```

The script will:
1. Run safety checks (Node, npm, PM2, Nginx, ports)
2. Show current PM2 processes
3. Ask for confirmation before proceeding
4. Create backups
5. Copy files to `/var/www/mep-new-app`
6. Prompt you to create `backend/.env` if missing
7. Install dependencies
8. Build frontend
9. Start backend via PM2
10. Verify health endpoint
11. Ask for your NEW_APP_DOMAIN and configure Nginx
12. Validate and reload Nginx

**If the script asks you to create `.env`:**

```bash
# VPS (in another terminal)
sudo cp /tmp/new-app-upload/deployment/production.env.example /var/www/mep-new-app/backend/.env

# Generate a secure token secret
openssl rand -hex 48

# Edit .env with the generated secret and correct MongoDB URI
sudo nano /var/www/mep-new-app/backend/.env
```

---

## §6. HTTPS Setup

**VPS** — After DNS for `mep-projects.spereon.codes` points to this server:

```bash
# VPS
# Check if an SSL certificate already exists for this domain (from old V2)
sudo certbot certificates 2>/dev/null | grep -A3 "mep-projects.spereon.codes" || echo "No existing cert found"

# Verify DNS resolution
dig mep-projects.spereon.codes +short

# If DNS is correct, obtain/renew certificate
sudo certbot --nginx -d mep-projects.spereon.codes
```

**NOTE:** An SSL certificate for `mep-projects.spereon.codes` may already exist from the old V2 deployment. Certbot will reuse or renew it automatically when you run the command above. This adds HTTPS to the `mep-new-app` Nginx block only and does not affect certificates for other sites.

---

## §7. Create Initial Super Admin

The Super Admin has `companyId: null` and cannot be created via the API (which requires authentication).
It must be seeded directly in MongoDB.

**VPS:**

```bash
# VPS
# Step 1: Generate a bcrypt hash for your chosen password
node -e "
const bcrypt = require('/var/www/mep-new-app/backend/node_modules/bcryptjs');
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('Enter Super Admin password: ', async (pw) => {
  if (pw.length < 8) { console.error('Password must be at least 8 characters'); process.exit(1); }
  const hash = await bcrypt.hash(pw, 12);
  console.log('\nBcrypt hash (copy this):');
  console.log(hash);
  rl.close();
});
"
```

```bash
# VPS
# Step 2: Insert the super admin into MongoDB
# Replace PASTE_HASH_HERE with the hash from Step 1
mongosh mep_new_app <<'EOF'
db.users.insertOne({
  companyId: null,
  name: "Super Admin",
  role: "super",
  username: "superadmin",
  passwordHash: "PASTE_HASH_HERE",
  active: true,
  createdAt: new Date(),
  updatedAt: new Date()
})
print("Super Admin created. Username: superadmin")
EOF
```

**Verify login:**

```bash
# VPS
curl -s -X POST http://127.0.0.1:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"superadmin","password":"YOUR_PASSWORD"}' | python3 -m json.tool
```

You should see a response with `token`, `expiresAt`, and `user.role: "super"`.

---

## §8. Seed Default Plans

**VPS:**

```bash
# VPS
# Use the token from the super admin login above
TOKEN="paste-token-here"

curl -s -X POST http://127.0.0.1:4000/api/subscriptions/plans/seed \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

This creates the 7 default subscription plans:
- HVAC Starter
- Solar Starter
- MEP Starter
- MEP + HVAC Pro
- MEP + Solar Pro
- Solar + HVAC Pro
- Full Enterprise

---

## §9. Create Your First Company

**VPS:**

```bash
# VPS
TOKEN="paste-super-admin-token-here"

curl -s -X POST http://127.0.0.1:4000/api/companies \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "company": {
      "name": "MEP Powertech Pvt Ltd",
      "displayName": "MEP Powertech Pvt Ltd",
      "divisions": ["HVAC", "Solar", "MEP"]
    },
    "admin": {
      "name": "Admin User",
      "username": "admin",
      "password": "YOUR_ADMIN_PASSWORD"
    }
  }' | python3 -m json.tool
```

This creates the company AND its first admin user in one call.

**Then assign a subscription plan:**

```bash
# VPS
COMPANY_ID="paste-company-id-from-above"

curl -s -X POST http://127.0.0.1:4000/api/subscriptions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{
    \"companyId\": \"$COMPANY_ID\",
    \"planCode\": \"FULL_ENTERPRISE\",
    \"status\": \"active\"
  }" | python3 -m json.tool
```

---

## §10. Production Smoke Tests

After setup, run the health check script:

```bash
# VPS
cd /tmp/new-app-upload
bash deployment/health-check-new-app.sh NEW_APP_DOMAIN
```

### Manual API Smoke Tests

```bash
# VPS
# Login as admin
TOKEN=$(curl -s -X POST http://127.0.0.1:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_ADMIN_PASSWORD","companyId":"COMPANY_ID"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

echo "Token: $TOKEN"

# Create HVAC quotation
curl -s -X POST http://127.0.0.1:4000/api/quotations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "division": "HVAC",
    "customerName": "Test Customer HVAC",
    "subject": "Test HVAC Quotation",
    "equipmentItems": [
      {"description": "Test Equipment", "unit": "No", "qty": 1, "supplyRate": 100000, "installationRate": 10000}
    ],
    "gstPercent": 18
  }' | python3 -m json.tool

# List quotations
curl -s http://127.0.0.1:4000/api/quotations \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Check divisions
curl -s http://127.0.0.1:4000/api/subscriptions/my-divisions \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Item library
curl -s "http://127.0.0.1:4000/api/item-names?division=HVAC" \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# AMC templates
curl -s http://127.0.0.1:4000/api/amc-documents/templates \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Contracts
curl -s http://127.0.0.1:4000/api/contracts \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Projects
curl -s http://127.0.0.1:4000/api/projects \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Inventory categories
curl -s http://127.0.0.1:4000/api/inventory/categories \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Payments
curl -s http://127.0.0.1:4000/api/payments \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Notifications
curl -s http://127.0.0.1:4000/api/notifications \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool

# Service calls
curl -s http://127.0.0.1:4000/api/service-calls \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Tenant Isolation Test

```bash
# VPS
# Create a second company
curl -s -X POST http://127.0.0.1:4000/api/companies \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SUPER_TOKEN" \
  -d '{
    "company": {"name": "Tenant Test Co", "divisions": ["HVAC"]},
    "admin": {"name": "Tenant Admin", "username": "tenant_admin", "password": "YOUR_TENANT_ADMIN_PASSWORD"}
  }' | python3 -m json.tool

# Login as tenant_admin
TENANT_TOKEN=$(curl -s -X POST http://127.0.0.1:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"tenant_admin","password":"YOUR_TENANT_ADMIN_PASSWORD","companyId":"TENANT_COMPANY_ID"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Try to access Company A's quotations — should return empty list (not Company A's data)
curl -s http://127.0.0.1:4000/api/quotations \
  -H "Authorization: Bearer $TENANT_TOKEN" | python3 -m json.tool
```

---

## §11. PM2 Persistence

**VPS:**

```bash
# VPS
pm2 save
pm2 startup
```

Follow the output of `pm2 startup` — it prints a command you must run with sudo.
This ensures `mep-new-app` restarts automatically after server reboot.

---

## §12. Rollback Procedure

If anything goes wrong, run:

```bash
# VPS
sudo bash /tmp/new-app-upload/deployment/rollback-new-app.sh
```

This will:
1. Stop `mep-new-app` PM2 process
2. Disable the `mep-new-app` Nginx server block
3. Optionally restore from backup

The rollback does **NOT** touch:
- `/var/www/employee-management-system` (ems-backend)
- `/var/www/glampower` (glampower)
- `/var/www/spereon.codes` (spereon.codes)
- Any other PM2 processes (ems-backend, glampower, spereon.codes)
- Any existing MongoDB databases (mep_projects, etc.)

To manually rollback individual steps:

```bash
# Stop only the new app
pm2 stop mep-new-app

# Disable only the new app Nginx config
sudo rm /etc/nginx/sites-enabled/mep-new-app
sudo nginx -t && sudo systemctl reload nginx

# The mep_new_app database is untouched (drop manually only if needed)
# mongosh mep_new_app --eval "db.dropDatabase()"
```

---

## §13. Log Inspection

**VPS:**

```bash
# VPS
# PM2 logs
pm2 logs mep-new-app --lines 50 --nostream

# Nginx error log
sudo tail -50 /var/log/nginx/error.log

# Check for crash loops
pm2 jlist | python3 -c "
import sys, json
procs = json.load(sys.stdin)
for p in procs:
  if p['name'] == 'mep-new-app':
    print(f\"Status: {p['pm2_env']['status']}\")
    print(f\"Restarts: {p['pm2_env']['restart_time']}\")
    print(f\"Memory: {round(p['monit']['memory']/(1024*1024),1)}MB\")
    print(f\"CPU: {p['monit']['cpu']}%\")
"
```

---

## Execution Order Summary

1. Upload `new-app/` to VPS
2. Run VPS Discovery commands (§2) — read-only, inspect everything
3. Create backups (§3)
4. Set up MongoDB database (§4)
5. Run `deploy-new-app.sh` (§5) — installs, builds, starts, configures Nginx
6. Create `.env` when prompted (§5)
7. Set up HTTPS after DNS propagation (§6)
8. Create Super Admin (§7)
9. Seed default plans (§8)
10. Create your company (§9)
11. Run health check and smoke tests (§10)
12. Configure PM2 persistence (§11)
13. Inspect logs (§13)

---

## Variables You Must Set

| Variable | Where | Example |
|----------|-------|---------|
| `NEW_APP_DOMAIN` | Nginx config / deploy script prompt | `mep-projects.spereon.codes` |
| `MONGODB_URI` | `backend/.env` | `mongodb://127.0.0.1:27017/mep_new_app` |
| `AUTH_TOKEN_SECRET` | `backend/.env` | Output of `openssl rand -hex 48` |
| `AUTH_TOKEN_EXPIRY` | `backend/.env` | `15m` |
| `PORT` | `backend/.env` | `4000` |
| Super Admin password | MongoDB seed (§7) | Your choice (min 8 chars) |
| Admin password | Company creation (§9) | Your choice |
