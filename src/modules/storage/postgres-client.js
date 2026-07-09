import pg from 'pg';
import { config } from '../../config/index.js';

const { Pool } = pg;

let pool = null;

/**
 * Shared Postgres connection pool.
 *
 * Every module that needs a database connection (identity, storage,
 * audit) calls getPool() rather than constructing its own pg.Pool.
 * One pool per process, sized via DATABASE_POOL_MAX, avoids connection
 * exhaustion when multiple modules would otherwise each open their own.
 *
 * Lazily initialized so importing this file has no side effects until
 * a connection is actually needed — matters for tests that import
 * modules without wanting a live DB connection.
 */
export function getPool() {
  if (!pool) {
    if (!config.storage.databaseUrl) {
      throw new Error(
        'DATABASE_URL is not set. Cannot initialize Postgres pool.'
      );
    }
    pool = new Pool({
      connectionString: config.storage.databaseUrl,
      max: config.storage.poolMax,
    });
  }
  return pool;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}