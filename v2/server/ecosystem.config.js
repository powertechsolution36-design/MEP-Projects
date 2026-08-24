module.exports = {
  apps: [{
    name: 'mep-projects-api',
    script: './src/index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
      PORT: 4001,
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    time: true,
  }],
};
