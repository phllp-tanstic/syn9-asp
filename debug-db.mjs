import { getPool } from './src/modules/storage/postgres-client.js';

const pool = getPool();
const res = await pool.query(
  "SELECT allowed_wallets, permission_mode FROM claims ORDER BY created_at DESC LIMIT 3"
);
console.log(JSON.stringify(res.rows, null, 2));
await pool.end();
