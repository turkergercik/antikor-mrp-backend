const { Client } = require('pg');
require('dotenv').config();

async function checkLot777() {
  const client = new Client({
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT,
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  });

  try {
    await client.connect();
    console.log('Connected to database\n');

    const result = await client.query(`
      SELECT 
        id,
        created_at,
        transaction_type,
        quantity,
        current_balance,
        lot_number
      FROM stock_histories 
      WHERE lot_number = '777'
      ORDER BY created_at DESC
      LIMIT 15
    `);

    console.log('=== Lot 777 Transactions (Latest First) ===\n');
    result.rows.forEach(t => {
      console.log(`ID: ${t.id} | Date: ${t.created_at} | Type: ${t.transaction_type} | Qty: ${t.quantity} | Balance: ${t.current_balance}`);
    });
    
    console.log(`\nTotal transactions found: ${result.rows.length}`);
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
    process.exit(0);
  }
}

checkLot777();
