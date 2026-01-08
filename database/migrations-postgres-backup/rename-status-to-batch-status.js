/**
 * Migration to rename 'status' column to 'batch_status'
 * This avoids conflicts with Strapi's internal 'status' system for draft/publish
 */

module.exports = {
  async up(knex) {
    console.log('Starting migration: rename status to batch_status');
    
    // Check if the old column exists
    const hasStatusColumn = await knex.schema.hasColumn('batches', 'status');
    const hasBatchStatusColumn = await knex.schema.hasColumn('batches', 'batch_status');
    
    if (hasStatusColumn && !hasBatchStatusColumn) {
      console.log('Renaming status column to batch_status');
      await knex.schema.table('batches', (table) => {
        table.renameColumn('status', 'batch_status');
      });
      console.log('✓ Column renamed successfully');
    } else if (hasBatchStatusColumn) {
      console.log('batch_status column already exists, skipping');
    } else {
      console.log('WARNING: status column does not exist');
    }
  },

  async down(knex) {
    console.log('Rolling back: rename batch_status back to status');
    
    const hasBatchStatusColumn = await knex.schema.hasColumn('batches', 'batch_status');
    const hasStatusColumn = await knex.schema.hasColumn('batches', 'status');
    
    if (hasBatchStatusColumn && !hasStatusColumn) {
      await knex.schema.table('batches', (table) => {
        table.renameColumn('batch_status', 'status');
      });
      console.log('✓ Column renamed back to status');
    }
  },
};
