// LoloShop — PM2 process config
// Build frontend first:  cd frontend && npm run build
// Start both:            pm2 start ecosystem.config.js
// Save + boot on reboot: pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'loloshop-api',
      cwd: './backend',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      max_memory_restart: '300M',
    },
    {
      name: 'loloshop-web',
      cwd: './frontend',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      max_memory_restart: '500M',
    },
  ],
};
