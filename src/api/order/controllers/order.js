/**
 * order controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::order.order', ({ strapi }) => ({
  /**
   * Override create to handle lot-based inventory allocation
   */
  async create(ctx) {
    // Use console.log instead of strapi.log
    console.log('=== Order Create Request (LOT-BASED) ===');
    console.log('ctx.request.body:', ctx.request.body);
    console.log('ctx.request.body JSON:', JSON.stringify(ctx.request.body));
    
    const { data } = ctx.request.body || {};
    
    console.log('Extracted data:', data);
    console.log('Data JSON:', JSON.stringify(data));
    
    if (!data) {
      console.error('No data in request body!');
      return ctx.badRequest('No data provided');
    }

    try {
      const recipeId = data.recipe;
      const orderQuantity = parseFloat(data.quantity);
      
      console.log('Recipe ID:', recipeId);
      console.log('Order quantity:', orderQuantity);

      if (!recipeId) {
        return ctx.badRequest('Recipe is required');
      }
      
      // Verify recipe exists
      const recipe = await strapi.db.query('api::recipe.recipe').findOne({
        where: { documentId: recipeId }
      });
      console.log('Recipe found:', recipe ? `Yes (${recipe.name}, id: ${recipe.id})` : 'No');
      
      if (!recipe) {
        return ctx.badRequest(`Recipe with documentId ${recipeId} not found`);
      }
      
      // Allocate lots using FIFO strategy
      console.log('Allocating lots for order...');
      const allocationResult = await strapi.service('api::lot.lot').allocateLots(recipe.id, orderQuantity);
      
      if (!allocationResult.success) {
        console.error('Lot allocation failed:', allocationResult.message);
        return ctx.badRequest(allocationResult.message);
      }

      console.log('Lots allocated successfully:', allocationResult.allocations.length, 'lots');
      
      // Clean up empty strings and prepare data
      const cleanData = { ...data };
      if (cleanData.customerContact === '') delete cleanData.customerContact;
      if (cleanData.notes === '') delete cleanData.notes;
      if (cleanData.orderCreatedBy === '') delete cleanData.orderCreatedBy;
      delete cleanData.recipe; // Remove recipe from data, we'll link it separately
      
      // Add lot allocations to order data
      cleanData.lotAllocations = JSON.stringify(allocationResult.allocations);
      
      console.log('Cleaned data (without recipe):', JSON.stringify(cleanData));
      
      // Create order without relation first
      const entity = await strapi.db.query('api::order.order').create({
        data: {
          ...cleanData,
          documentId: require('crypto').randomUUID().replace(/-/g, '').substring(0, 24),
          publishedAt: new Date(),
        },
      });
      
      console.log('Order created with id:', entity.id, 'documentId:', entity.documentId);
      
      // Now link the recipe relation using the link table
      await strapi.db.connection.raw(
        'INSERT INTO orders_recipe_lnk (order_id, recipe_id) VALUES (?, ?)',
        [entity.id, recipe.id]
      );
      
      console.log('Recipe linked to order');
      
      // Link lot relations
      for (const allocation of allocationResult.allocations) {
        await strapi.db.connection.raw(
          'INSERT INTO orders_lots_lnk (order_id, lot_id) VALUES (?, ?)',
          [entity.id, allocation.lotId]
        );
      }
      console.log('Lots linked to order');
      
      // Fetch the complete order with recipe and lots
      const completeOrder = await strapi.db.query('api::order.order').findOne({
        where: { id: entity.id },
        populate: ['recipe', 'lots'],
      });
      
      console.log('Order created successfully with ID:', completeOrder.id);

      // Note: Stock deduction from lots happens when order status changes to 'ready' in lifecycle

      return this.transformResponse(completeOrder);
    } catch (error) {
      console.error('Create order error:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error details:', JSON.stringify(error.details, null, 2));
      
      // If it's a validation error, log more details
      if (error.details && error.details.errors) {
        error.details.errors.forEach((err, idx) => {
          console.error(`Validation error ${idx + 1}:`, {
            path: err.path,
            message: err.message,
            name: err.name,
            value: err.value
          });
        });
      }
      
      strapi.log.error('Create order error:', error);
      return ctx.badRequest(error.message);
    }
  },

  /**
   * Custom action to refresh tracking status from cargo company website
   */
  async refreshTracking(ctx) {
    try {
      const { id } = ctx.params;

      if (!id) {
        return ctx.badRequest('Order ID is required');
      }

      // Handle both numeric id and documentId
      let orderId = id;
      
      if (isNaN(id)) {
        const order = await strapi.db.query('api::order.order').findOne({
          where: { documentId: id },
        });
        
        if (!order) {
          return ctx.notFound('Order not found');
        }
        
        orderId = order.id;
      }

      const result = await strapi.service('api::order.order').updateTrackingStatus(orderId);

      if (!result.success) {
        return ctx.send({
          message: result.message || 'Takip bilgisi alınamadı',
          data: result,
        }, 200);
      }

      return ctx.send({
        message: 'Tracking status updated successfully',
        data: result,
      });
    } catch (error) {
      strapi.log.error('Refresh tracking error:', error);
      return ctx.send({
        message: 'Takip bilgisi alınamadı',
        error: error.message
      }, 200);
    }
  },
}));
