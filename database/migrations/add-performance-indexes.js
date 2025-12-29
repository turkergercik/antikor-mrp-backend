/**
 * Add database indexes for performance optimization
 * Safe to run multiple times (uses IF NOT EXISTS)
 */

module.exports = {
  async up(knex) {
    console.log('Adding performance indexes...');

    // Batches table indexes
    const batchesTableExists = await knex.schema.hasTable('batches');
    if (batchesTableExists) {
      // Index on batch_status for filtering
      await knex.raw(`
        CREATE INDEX IF NOT EXISTS idx_batches_batch_status 
        ON batches(batch_status)
      `);
      
      // Index on production_date for date range queries
      await knex.raw(`
        CREATE INDEX IF NOT EXISTS idx_batches_production_date 
        ON batches(production_date)
      `);
      
      // Index on updated_at for sorting
      await knex.raw(`
        CREATE INDEX IF NOT EXISTS idx_batches_updated_at 
        ON batches(updated_at DESC)
      `);

      // Composite index for common queries
      await knex.raw(`
        CREATE INDEX IF NOT EXISTS idx_batches_status_date 
        ON batches(batch_status, production_date DESC)
      `);
    }

    // Raw materials table indexes
    const rawMaterialsExists = await knex.schema.hasTable('raw_materials');
    if (rawMaterialsExists) {
      await knex.raw(`
        CREATE INDEX IF NOT EXISTS idx_raw_materials_updated_at 
        ON raw_materials(updated_at DESC)
      `);
    }

    // Recipes table indexes
    const recipesExists = await knex.schema.hasTable('recipes');
    if (recipesExists) {
      await knex.raw(`
        CREATE INDEX IF NOT EXISTS idx_recipes_updated_at 
        ON recipes(updated_at DESC)
      `);
    }

    console.log('Performance indexes added successfully!');
  },

  async down(knex) {
    console.log('Removing performance indexes...');
    
    await knex.raw('DROP INDEX IF EXISTS idx_batches_batch_status');
    await knex.raw('DROP INDEX IF EXISTS idx_batches_production_date');
    await knex.raw('DROP INDEX IF EXISTS idx_batches_updated_at');
    await knex.raw('DROP INDEX IF EXISTS idx_batches_status_date');
    await knex.raw('DROP INDEX IF EXISTS idx_raw_materials_updated_at');
    await knex.raw('DROP INDEX IF EXISTS idx_recipes_updated_at');
    
    console.log('Performance indexes removed!');
  },
};
