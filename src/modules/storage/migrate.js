import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { config } from '../../config/index.js';

const { Client } = pg;

const MIGRATIONS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations'
);

/**
 * Minimal migration runner.
 *
 * Tracks applied migrations in a schema_migrations table, applies only
 * what's pending, in filename order, each wrapped in its own transaction
 * so a failure partway through a single migration doesn't leave that
 * migration half-applied. This is intentionally simple — no rollback
 * support, no branching — because Syn9's schema evolves linearly during
 * a hackathon build. Revisit if the project outlives that assumption.
 */
async function migrate() {
  if (!config.storage.databaseUrl) {
    console.error('DATABASE_URL is not set. Check your .env file.');
    process.exit(1);
  }

  const client = new Client({ connectionString: config.storage.databaseUrl });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename    TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    const { rows: appliedRows } = await client.query(
      'SELECT filename FROM schema_migrations'
    );
    const applied = new Set(appliedRows.map((r) => r.filename));

    const allFiles = await readdir(MIGRATIONS_DIR);
    const pending = allFiles
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .filter((f) => !applied.has(f));

    if (pending.length === 0) {
      console.log('No pending migrations.');
      return;
    }

    for (const filename of pending) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');
      console.log(`Applying ${filename}...`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename]
        );
        await client.query('COMMIT');
        console.log(`  done`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  failed: ${err.message}`);
        throw err;
      }
    }

    console.log(`Applied ${pending.length} migration(s).`);
  } finally {
    await client.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});