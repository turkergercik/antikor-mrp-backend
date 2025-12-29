const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { Client } = require('pg');

async function checkConnections() {
  const client = new Client({
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === 'true' ? {
      rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true'
    } : false
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Check current connections
    const result = await client.query(`
      SELECT 
        datname,
        usename,
        application_name,
        client_addr,
        state,
        COUNT(*) as connection_count
      FROM pg_stat_activity
      WHERE datname = $1
      GROUP BY datname, usename, application_name, client_addr, state
      ORDER BY connection_count DESC
    `, [process.env.DATABASE_NAME]);

    console.log('📊 Current Database Connections:');
    console.log('================================\n');
    
    let totalConnections = 0;
    result.rows.forEach(row => {
      console.log(`Application: ${row.application_name || 'Unknown'}`);
      console.log(`User: ${row.usename}`);
      console.log(`State: ${row.state}`);
      console.log(`Connections: ${row.connection_count}`);
      console.log('---');
      totalConnections += parseInt(row.connection_count);
    });

    console.log(`\n📈 Total Active Connections: ${totalConnections}`);

    // Check max connections
    const maxConn = await client.query('SHOW max_connections');
    console.log(`🔢 Max Connections Allowed: ${maxConn.rows[0].max_connections}`);

    if (totalConnections > 15) {
      console.log('\n⚠️  WARNING: High connection count detected!');
      console.log('💡 Recommendation: Reduce connection pool or close unused connections');
    } else {
      console.log('\n✅ Connection count is healthy');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

checkConnections();
