const { default: strapi } = require('@strapi/strapi');

async function runMigration() {
  const appContext = await strapi({ autoReload: false }).register();
  
  try {
    console.log('Loading migration...');
    const migration = require('./database/migrations/rename-status-to-batch-status.js');
    
    console.log('Running UP migration...');
    await migration.up(appContext.db.connection);
    
    console.log('✓ Migration completed successfully');
  } catch (error) {
    console.error('✗ Migration failed:', error);
  } finally {
    await appContext.destroy();
    process.exit(0);
  }
}

runMigration();
