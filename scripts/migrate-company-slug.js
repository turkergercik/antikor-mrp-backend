/**
 * SQL migration to add companySlug to cargo_companies
 */

const { Client } = require('pg');
require('dotenv').config();

async function runMigration() {
  const client = new Client({
    host: process.env.DATABASE_HOST,
    port: process.env.DATABASE_PORT,
    database: process.env.DATABASE_NAME,
    user: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('Connected to database');

    // Check if column exists
    const checkColumn = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'cargo_companies' 
      AND column_name = 'company_slug'
    `);

    if (checkColumn.rows.length === 0) {
      console.log('Adding company_slug column...');
      await client.query(`
        ALTER TABLE cargo_companies 
        ADD COLUMN company_slug VARCHAR(255)
      `);
      console.log('✓ company_slug column added successfully');
    } else {
      console.log('✓ company_slug column already exists');
    }

    // Make tracking_url nullable
    console.log('Making tracking_url nullable...');
    await client.query(`
      ALTER TABLE cargo_companies 
      ALTER COLUMN tracking_url DROP NOT NULL
    `);
    console.log('✓ tracking_url is now nullable');

    console.log('\nMigration completed successfully!');
    await client.end();
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error.message);
    await client.end();
    process.exit(1);
  }
}

runMigration();
