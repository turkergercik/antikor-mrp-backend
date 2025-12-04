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
  
  // Check column types
  const columns = await client.query(`
    SELECT column_name, data_type, udt_name, character_maximum_length
    FROM information_schema.columns 
    WHERE table_name = 'batches' 
    AND column_name IN ('status', 'shipment_status')
  `);
  console.log('Column types:');
  console.log(JSON.stringify(columns.rows, null, 2));
  
  // Get all data with exact values
  const data = await client.query('SELECT id, batch_number, status, shipment_status FROM batches');
  console.log('\nBatch data:');
  data.rows.forEach(row => {
    console.log(`ID: ${row.id}, Status: "${row.status}" (length: ${row.status?.length}), ShipmentStatus: "${row.shipment_status}"`);
  });
  
  await client.end();
}

run().catch(console.error);
