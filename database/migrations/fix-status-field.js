module.exports = {
  async up(knex) {
    // Update all null statuses to 'shipped'
    await knex('batches')
      .whereNull('status')
      .update({ status: 'shipped' });
    
    console.log('✅ Fixed null status values');
  },

  async down() {}
};
