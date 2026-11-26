const { Pool, types } = require('pg');
const env = require('./env');

// Parse PostgreSQL INT8 (OID 20) and NUMERIC (OID 1700) into JavaScript numbers
// for clean JSON API serialization and analytics calculations.
types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));
types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

const pool = new Pool({
  host: env.db.host,
  port: env.db.port,
  database: env.db.database,
  user: env.db.user,
  password: env.db.password,
  max: env.db.max,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[PostgreSQL Pool Error]:', err.message);
});

/**
 * Execute a parameterized raw SQL query using the connection pool.
 */
async function query(sql, params = []) {
  return pool.query(sql, params);
}

/**
 * Execute a multi-step unit of work inside an ACID PostgreSQL transaction.
 * Supports configurable transaction isolation levels, session context GUC variables
 * consumed by PostgreSQL audit & lifecycle triggers, and automatic ROLLBACK on error.
 */
async function withTransaction(workFn, options = {}) {
  const {
    userId = null,
    clientIp = null,
    isolationLevel = 'READ COMMITTED',
  } = options;

  const allowedIsolations = new Set([
    'READ COMMITTED',
    'REPEATABLE READ',
    'SERIALIZABLE',
  ]);
  const safeIsolation = allowedIsolations.has(isolationLevel)
    ? isolationLevel
    : 'READ COMMITTED';

  const client = await pool.connect();
  try {
    await client.query(`BEGIN ISOLATION LEVEL ${safeIsolation}`);

    if (userId !== null && userId !== undefined) {
      await client.query("SELECT set_config('reloop.current_user_id', $1, true)", [
        String(userId),
      ]);
    }
    if (clientIp) {
      await client.query("SELECT set_config('reloop.client_ip', $1, true)", [
        String(clientIp),
      ]);
    }

    const result = await workFn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[Transaction Rollback Error]:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Helper to set lifecycle event metadata inside an open transaction client
 * right before updating devices.current_status.
 */
async function setTransitionContext(client, { userId, referenceEntity, referenceId, notes, timestamp }) {
  if (userId !== undefined && userId !== null) {
    await client.query("SELECT set_config('reloop.current_user_id', $1, true)", [String(userId)]);
  }
  await client.query("SELECT set_config('reloop.reference_entity', $1, true)", [
    referenceEntity ? String(referenceEntity) : '',
  ]);
  await client.query("SELECT set_config('reloop.reference_id', $1, true)", [
    referenceId !== undefined && referenceId !== null ? String(referenceId) : '',
  ]);
  await client.query("SELECT set_config('reloop.transition_notes', $1, true)", [
    notes ? String(notes) : '',
  ]);
  await client.query("SELECT set_config('reloop.event_timestamp', $1, true)", [
    timestamp ? String(timestamp) : '',
  ]);
}

module.exports = {
  pool,
  query,
  withTransaction,
  setTransitionContext,
};
