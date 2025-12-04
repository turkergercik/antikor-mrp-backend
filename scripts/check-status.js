require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true' } : false,
  });

  await client.connect();
  const result = await client.query('SELECT id, batch_number, status, shipment_status FROM batches ORDER BY id');
  console.log(JSON.stringify(result.rows, null, 2));
  await client.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
