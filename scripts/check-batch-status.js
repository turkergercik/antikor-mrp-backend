const { Client } = require('pg');

async function checkBatchStatus() {
  const client = new Client({
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT,
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Connected to database');

    const result = await client.query(`
      SELECT 
        batch_number,
        status,
        shipment_status,
        document_id,
        published_at,
        locale
      FROM batches 
      WHERE document_id = 'dc6hxxpdycpsl676u6wnsc6q'
    `);

    console.log('\n=== Batch Status Check ===');
    console.log(JSON.stringify(result.rows[0], null, 2));

  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.end();
  }
}

checkBatchStatus();
