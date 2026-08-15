// LoloShop — PM2 process config
// Build frontend first:  cd frontend && npm run build
// Start both:            pm2 start ecosystem.config.js
// Save + boot on reboot: pm2 save && pm2 startup
//
// ⚠️ TZ IS SET PER PROCESS, NOT ON THE HOST — deliberately, and it must stay that way.
// The shop is in Iraq and every date the business cares about is Baghdad-local: the ممثل
// deadline («آخر موعد»), the بصمة attendance window, and the assistant's daily USD budget
// reset all read server-local time. The old 2 GB box had `timedatectl` set to Asia/Baghdad,
// so this was invisible there. Since 2026-08-16 LoloShop shares a box with another project
// whose host timezone is Europe/Berlin (+02); changing the HOST timezone to fix LoloShop
// would silently move that project's clock by an hour instead. Setting TZ in each app's env
// is the surgical version — PM2 exports it before the process spawns, which is what Node
// needs (assigning process.env.TZ after startup is not reliably picked up).
const TZ = 'Asia/Baghdad';

module.exports = {
  apps: [
    {
      name: 'loloshop-api',
      cwd: './backend',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
        TZ,
      },
      // 300M restart-looped under load (sharp crops spike memory); box has 24GB.
      max_memory_restart: '800M',
    },
    {
      name: 'loloshop-web',
      cwd: './frontend',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        TZ,
      },
      max_memory_restart: '1G',
    },
    {
      // pg-boss consumer: server-side calligraphy generation (close the browser,
      // plates keep generating). Jobs persist in Postgres if this process is down.
      name: 'loloshop-worker',
      cwd: './backend',
      script: 'worker.js',
      env: {
        NODE_ENV: 'production',
        TZ,
      },
      max_memory_restart: '500M', // sharp cropping spikes
    },
  ],
};
