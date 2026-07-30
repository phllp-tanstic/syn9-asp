import { getPool } from './src/modules/storage/postgres-client.js';

const pool = getPool();
const res = await pool.query(
  'SELECT claim_id, permission_mode, allowed_wallets, writer_identity_id FROM claims WHERE claim_id = ',
  ['syn9_claim_I827k0b3lWRB6uBBgZqauA']
);
console.log(JSON.stringify(res.rows[0], null, 2));
await pool.end();
