module.exports = {
  async up(knex) {
    // Update the quantity column to support higher precision
    await knex.schema.alterTable('components_recipe_ingredients', (table) => {
      table.decimal('quantity', 10, 4).alter();
    });
  },

  async down(knex) {
    // Revert back to default precision
    await knex.schema.alterTable('components_recipe_ingredients', (table) => {
      table.decimal('quantity').alter();
    });
  }
};
