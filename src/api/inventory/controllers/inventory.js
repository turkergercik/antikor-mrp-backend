/**
 * inventory controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::inventory.inventory', ({ strapi }) => ({
  async find(ctx) {
    // Ensure recipe is populated
    const { query } = ctx;
    
    const entities = await strapi.entityService.findMany('api::inventory.inventory', {
      ...query,
      populate: query.populate || { recipe: true },
    });

    console.log('Inventory find - entities:', entities);
    
    // Calculate actual stock from lots for each inventory item
    const entitiesWithCalculatedStock = await Promise.all(
      entities.map(async (entity) => {
        if (entity.recipe?.id) {
          try {
            // Get all lots for this recipe
            const lots = await strapi.db.query('api::lot.lot').findMany({
              where: { recipe: entity.recipe.id },
            });
            
            console.log(`Recipe ${entity.recipe.id} (${entity.recipe.name}):`);
            console.log(`  Found ${lots.length} lots`);
            lots.forEach(lot => {
              console.log(`    Lot ${lot.lotNumber}: currentQuantity = ${lot.currentQuantity}, unitCost = ${lot.unitCost}, status = ${lot.status}`);
            });
            
            // Filter available lots
            const availableLots = lots.filter(lot => lot.status !== 'depleted' && lot.status !== 'expired');
            
            // Sum up all lot quantities
            const calculatedStock = availableLots.reduce((sum, lot) => {
              return sum + (parseFloat(lot.currentQuantity) || 0);
            }, 0);
            
            // Calculate total value by summing all lot total costs
            const totalValue = availableLots.reduce((sum, lot) => {
              const lotTotalCost = parseFloat(lot.totalCost) || 0;
              return sum + lotTotalCost;
            }, 0);
            
            console.log(`  Calculated stock = ${calculatedStock}, Total value = ${totalValue}`);
            
            // Update the stock field with calculated value
            return {
              ...entity,
              stock: calculatedStock,
              totalValue: totalValue, // Sum of all lot total costs
            };
          } catch (error) {
            console.error(`Error calculating stock for recipe ${entity.recipe.id}:`, error);
            return entity;
          }
        }
        return entity;
      })
    );
    
    const sanitizedEntities = await this.sanitizeOutput(entitiesWithCalculatedStock, ctx);
    return this.transformResponse(sanitizedEntities);
  },
}));
