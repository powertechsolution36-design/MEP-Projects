# VPS Deployment

## On the VPS (one-time)

```bash
# Get code
cd /var/www
git clone <your-repo>.git mep-projects
cd mep-projects

# Run installer
bash deploy/vps-install.sh

# Setup nginx
cp deploy/nginx-web.conf /etc/nginx/sites-available/mep-projects-web
cp deploy/nginx-api.conf /etc/nginx/sites-available/mep-projects-api
ln -sf /etc/nginx/sites-available/mep-projects-web /etc/nginx/sites-enabled/
ln -sf /etc/nginx/sites-available/mep-projects-api /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# Get SSL (optional but recommended)
certbot --nginx -d mep-projects.spereon.codes -d api.mep-projects.spereon.codes
```

## Updating (subsequent deploys)

```bash
cd /var/www/mep-projects
git pull
bash deploy/vps-install.sh
```

The install script:
1. Installs backend deps
2. Runs migration (preserves users)
3. Builds React frontend to `web/dist`
4. Restarts PM2

## Verify

```bash
curl http://localhost:4001/api/health
pm2 logs mep-projects-api --lines 20
```
