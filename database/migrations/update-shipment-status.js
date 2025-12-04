module.exports = {
  async up(knex) {
    // This migration updates the shipmentStatus enum to include new values
    // and migrates any existing null or undefined values to 'yolda'
    
    console.log('Starting shipment status migration...');
    
    try {
      // Update any null shipmentStatus to 'yolda'
      const updatedRows = await knex('batches')
        .whereNull('shipment_status')
        .orWhere('shipment_status', '')
        .update({
          shipment_status: 'yolda'
        });
      
      console.log(`Updated ${updatedRows} batches with null/empty status to 'yolda'`);
      
      // Log current status distribution
      const statusCounts = await knex('batches')
        .select('shipment_status')
        .count('* as count')
        .groupBy('shipment_status');
      
      console.log('Current status distribution:', statusCounts);
      
      console.log('Shipment status migration completed successfully');
    } catch (error) {
      console.error('Migration error:', error);
      throw error;
    }
  },

  async down(knex) {
    console.log('Reverting shipment status migration...');
    // No need to revert data changes
    console.log('Revert completed');
  }
};
