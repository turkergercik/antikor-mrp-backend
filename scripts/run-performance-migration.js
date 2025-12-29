const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Create Knex instance with your database config
const knex = require('knex')({
  client: 'pg',
  connection: {
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT),
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    ssl: process.env.DATABASE_SSL === 'true' ? {
      rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED === 'true'
    } : false
  }
});

async function runMigration() {
  try {
    console.log('🚀 Starting performance optimization migration...\n');

    const migration = require('../database/migrations/add-performance-indexes');
    await migration.up(knex);

    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await knex.destroy();
  }
}

runMigration();
