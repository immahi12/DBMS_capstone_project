const app = require('./src/app');
const env = require('./src/config/env');
const { pool } = require('./src/config/database');

async function startServer() {
  try {
    const res = await pool.query('SELECT current_database() AS db, version() AS pg_version');
    console.log(`[Database] Connected to '${res.rows[0].db}' (${res.rows[0].pg_version.split(',')[0]})`);

    const server = app.listen(env.port, env.host, () => {
      console.log(`[ReLoop Server] Listening on http://${env.host}:${env.port}`);
    });

    const shutdown = async () => {
      console.log('\n[ReLoop Server] Gracefully shutting down...');
      server.close(async () => {
        await pool.end();
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('[Startup Fatal Error]: Unable to connect to PostgreSQL:', err.message);
    process.exit(1);
  }
}

startServer();
