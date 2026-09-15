// V3 PM2 config — separate process from v2's "mep-projects-api" (port 4001).
// Does not touch, reference, or restart the v2 PM2 app.
module.exports = {
  apps: [{
    name: 'mep-projects-v3-api',
    script: './src/index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 4002,
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    time: true,
  }],
};
