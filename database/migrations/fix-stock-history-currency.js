/**
 * Migration to fix stock-history currency field
 * Changes all TRY currency records to USD where the prices are actually in USD
 */

module.exports = {
  async up(knex) {
    console.log('Starting stock-history currency fix...');
    
    try {
      // Update all stock-history records with currency TRY to USD
      const result = await knex('stock_histories')
        .where('currency', 'TRY')
        .update({
          currency: 'USD',
          updated_at: new Date()
        });
      
      console.log(`✅ Updated ${result} stock-history records from TRY to USD`);
      return result;
    } catch (error) {
      console.error('❌ Error updating stock-history currency:', error);
      throw error;
    }
  },

  async down(knex) {
    console.log('Reverting stock-history currency fix...');
    
    try {
      // Revert back to TRY if needed
      const result = await knex('stock_histories')
        .where('currency', 'USD')
        .update({
          currency: 'TRY',
          updated_at: new Date()
        });
      
      console.log(`✅ Reverted ${result} stock-history records from USD to TRY`);
      return result;
    } catch (error) {
      console.error('❌ Error reverting stock-history currency:', error);
      throw error;
    }
  }
};
