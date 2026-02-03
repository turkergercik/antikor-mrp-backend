module.exports = {
  async find(ctx) {
    try {
      // For single types, use findMany which returns the single entry
      const entries = await strapi.entityService.findMany('api::extra-cost.extra-cost');
      return { data: entries };
    } catch (error) {
      console.error('Error finding extra cost:', error);
      ctx.throw(500, error);
    }
  },

  async update(ctx) {
    try {
      const { amount, description } = ctx.request.body;
      
      console.log('Updating extra cost with:', { amount, description });
      
      // Try to find existing entry first
      const existing = await strapi.entityService.findMany('api::extra-cost.extra-cost');
      
      let data;
      if (existing && existing.id) {
        // Update existing entry
        data = await strapi.entityService.update('api::extra-cost.extra-cost', existing.id, {
          data: {
            amount: parseFloat(amount) || 0,
            description,
            lastUpdated: new Date(),
          },
        });
        console.log('Updated extra cost:', data);
      } else {
        // Create new entry if doesn't exist
        data = await strapi.entityService.create('api::extra-cost.extra-cost', {
          data: {
            amount: parseFloat(amount) || 0,
            description,
            lastUpdated: new Date(),
          },
        });
        console.log('Created extra cost:', data);
      }
      
      return { data };
    } catch (error) {
      console.error('Error updating extra cost:', error);
      ctx.throw(500, error);
    }
  },
};
