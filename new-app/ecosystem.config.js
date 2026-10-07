/**
 * PM2 Ecosystem Config — MEP New App
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 stop mep-new-app
 *   pm2 restart mep-new-app
 *   pm2 logs mep-new-app
 *   pm2 save  (persist across reboots)
 *   pm2 startup  (auto-start on boot)
 */
module.exports = {
  apps: [
    {
      name: 'mep-new-app',
      script: 'src/server.js',
      cwd: './backend',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      // Production env vars are read from backend/.env (dotenv or shell export)
      // Do NOT put secrets here — use .env or system environment.
      error_file: './logs/mep-err.log',
      out_file: './logs/mep-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
