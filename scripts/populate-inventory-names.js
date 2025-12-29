/**
 * Script to populate name field in existing inventory records
 * Run with: node scripts/populate-inventory-names.js
 */

require('dotenv').config({ path: '.env' });
const { Client } = require('pg');

async function main() {
  const client = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: process.env.DATABASE_PORT || 5432,
    user: process.env.DATABASE_USERNAME || 'postgres',
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME || 'strapi',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  try {
    await client.connect();
    console.log('Connected to database');
    console.log('Starting inventory name population...');

    // Get all inventories with their recipes
    const result = await client.query(`
      SELECT 
        i.id, 
        i.name,
        r.id as recipe_id,
        r.name as recipe_name
      FROM inventories i
      LEFT JOIN inventories_recipe_lnk irl ON i.id = irl.inventory_id
      LEFT JOIN recipes r ON irl.recipe_id = r.id
    `);

    console.log(`Found ${result.rows.length} inventory records`);

    let updated = 0;
    let skipped = 0;

    for (const row of result.rows) {
      if (row.name) {
        console.log(`Inventory ${row.id} already has name: ${row.name}`);
        skipped++;
        continue;
      }

      if (!row.recipe_name) {
        console.log(`⚠️ Inventory ${row.id} has no recipe, skipping`);
        skipped++;
        continue;
      }

      await client.query('UPDATE inventories SET name = $1 WHERE id = $2', [row.recipe_name, row.id]);

      console.log(`✓ Updated inventory ${row.id} with name: ${row.recipe_name}`);
      updated++;
    }

    console.log('\n=== Summary ===');
    console.log(`Updated: ${updated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Total: ${result.rows.length}`);
    console.log('✅ Done!');

    await client.end();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }

  process.exit(0);
}

main();
