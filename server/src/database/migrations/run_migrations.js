const fs = require('fs');
const path = require('path');
const { pool } = require('../../config/database');

async function runMigrations({ reset = false, closePool = true } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (reset) {
      console.log('[Migrations] Resetting public schema...');
      await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration_name VARCHAR(120) PRIMARY KEY,
        executed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = __dirname;
    const sqlFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of sqlFiles) {
      const check = await client.query(
        'SELECT 1 FROM schema_migrations WHERE migration_name = $1',
        [file]
      );
      if (check.rowCount > 0 && !reset) {
        console.log(`[Migrations] Skipping already applied: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      console.log(`[Migrations] Applying ${file}...`);
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (migration_name) VALUES ($1) ON CONFLICT (migration_name) DO NOTHING',
        [file]
      );
    }

    await client.query('COMMIT');
    console.log('[Migrations] All PostgreSQL migrations completed successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Migrations] Failed:', err);
    throw err;
  } finally {
    client.release();
    if (closePool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  const reset = process.argv.includes('--reset');
  runMigrations({ reset, closePool: true }).catch(() => process.exit(1));
}

module.exports = { runMigrations };
