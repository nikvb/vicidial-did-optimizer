// PM2 Configuration for DID Optimizer Server
// Start with: pm2 start ecosystem.config.cjs
// View logs with: pm2 logs did-optimizer
// Monitor with: pm2 monit

module.exports = {
  apps: [{
    name: 'did-optimizer',
    script: 'server-full.js',

    // Environment variables
    env: {
      PORT: 5000,
      NODE_ENV: 'production'
    },

    // Logging configuration
    error_file: './logs/error.log',
    out_file: './logs/output.log',
    log_file: './logs/combined.log',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

    // Process management
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',

    // Restart on crash
    min_uptime: '10s',
    max_restarts: 10,

    // Time to wait before forcing a reload
    kill_timeout: 5000
  }]
};
