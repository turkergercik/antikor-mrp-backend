require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT),
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  
  // Get all columns from batches table
  const columns = await client.query(`
    SELECT column_name 
    FROM information_schema.columns 
    WHERE table_name = 'batches'
    ORDER BY ordinal_position
  `);
  console.log('All columns in batches table:');
  console.log(columns.rows.map(r => r.column_name).join(', '));
  
  // Get the batch data
  const batch = await client.query('SELECT * FROM batches LIMIT 1');
  console.log('\nFull batch record:');
  console.log(JSON.stringify(batch.rows[0], null, 2));
  
  await client.end();
}

run().catch(console.error);
