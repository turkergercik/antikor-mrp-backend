module.exports = {
  async up(knex) {
    console.log('🔧 Fixing all enum values in batches table...');
    
    // Get all batches
    const batches = await knex('batches').select('*');
    
    console.log(`Found ${batches.length} batches to check`);
    
    for (const batch of batches) {
      const updates = {};
      
      // Check and fix status
      const validStatuses = ['planned', 'in_progress', 'completed', 'quality_check', 'approved', 'rejected', 'shipped'];
      if (!batch.status || !validStatuses.includes(batch.status)) {
        console.log(`  Batch ${batch.id}: Invalid status "${batch.status}", setting to "planned"`);
        updates.status = 'planned';
      }
      
      // Check and fix unit
      const validUnits = ['liter', 'kg', 'piece'];
      if (!batch.unit || !validUnits.includes(batch.unit)) {
        console.log(`  Batch ${batch.id}: Invalid unit "${batch.unit}", setting to "liter"`);
        updates.unit = 'liter';
      }
      
      // Check and fix qualityCheckResult
      const validQCResults = ['pending', 'passed', 'failed'];
      if (!batch.quality_check_result || !validQCResults.includes(batch.quality_check_result)) {
        console.log(`  Batch ${batch.id}: Invalid quality_check_result "${batch.quality_check_result}", setting to "pending"`);
        updates.quality_check_result = 'pending';
      }
      
      // Check shipmentStatus (optional field, can be null)
      const validShipmentStatuses = ['yolda', 'dagitimda', 'teslim_edildi', 'bulunamadi'];
      if (batch.shipment_status && !validShipmentStatuses.includes(batch.shipment_status)) {
        console.log(`  Batch ${batch.id}: Invalid shipment_status "${batch.shipment_status}", setting to null`);
        updates.shipment_status = null;
      }
      
      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        await knex('batches').where({ id: batch.id }).update(updates);
        console.log(`  ✅ Updated batch ${batch.id}`);
      }
    }
    
    console.log('✅ All enum values fixed');
  },

  async down() {
    // No rollback needed
  }
};
