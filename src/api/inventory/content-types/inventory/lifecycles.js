module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;
    
    // Auto-populate name from recipe if not provided
    if (data.recipe && !data.name) {
      const recipe = await strapi.db.query('api::recipe.recipe').findOne({
        where: { id: data.recipe },
        select: ['name']
      });
      
      if (recipe) {
        data.name = recipe.name;
        console.log(`✓ Inventory name set to: ${data.name}`);
      }
    }
  },

  async beforeUpdate(event) {
    const { data, where } = event.params;
    
    // Auto-update name if recipe is being changed
    if (data.recipe && !data.name) {
      const recipe = await strapi.db.query('api::recipe.recipe').findOne({
        where: { id: data.recipe },
        select: ['name']
      });
      
      if (recipe) {
        data.name = recipe.name;
        console.log(`✓ Inventory name updated to: ${data.name}`);
      }
    }
  }
};
