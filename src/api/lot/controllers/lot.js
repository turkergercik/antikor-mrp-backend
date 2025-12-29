/**
 * lot controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::lot.lot', ({ strapi }) => ({
  /**
   * Find lots with advanced filtering
   */
  async find(ctx) {
    // Add population by default
    if (!ctx.query.populate) {
      ctx.query.populate = {
        recipe: true,
        batch: true
      };
    }
    
    return await super.find(ctx);
  },

  /**
   * Find one lot with full details
   */
  async findOne(ctx) {
    const { id } = ctx.params;
    
    const entity = await strapi.entityService.findOne('api::lot.lot', id, {
      populate: {
        recipe: {
          populate: {
            ingredients: {
              populate: {
                rawMaterial: true
              }
            }
          }
        },
        batch: true
      }
    });

    const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
    return this.transformResponse(sanitizedEntity);
  },

  /**
   * Get lot transaction history
   */
  async getHistory(ctx) {
    const { id } = ctx.params;

    try {
      // Get lot details
      const lot = await strapi.entityService.findOne('api::lot.lot', id, {
        populate: {
          recipe: true,
          batch: true
        }
      });

      if (!lot) {
        return ctx.notFound('Lot not found');
      }

      // Get all orders that used this lot
      const orders = await strapi.entityService.findMany('api::order.order', {
        filters: {
          lots: {
            id: { $eq: id }
          }
        },
        populate: {
          recipe: true,
          cargoCompany: true
        }
      });

      // Get all shipments that used this lot
      const shipments = await strapi.entityService.findMany('api::shipment.shipment', {
        filters: {
          lots: {
            id: { $eq: id }
          }
        },
        populate: {
          batch: true
        }
      });

      return {
        lot,
        orders: orders || [],
        shipments: shipments || [],
        quantityUsed: parseFloat(lot.initialQuantity) - parseFloat(lot.currentQuantity)
      };
    } catch (error) {
      strapi.log.error('Get lot history error:', error);
      return ctx.badRequest(error.message);
    }
  },

  /**
   * Adjust lot quantity (for stock adjustments, damages, etc.)
   */
  async adjustQuantity(ctx) {
    const { id } = ctx.params;
    const { adjustment, reason, adjustedBy } = ctx.request.body;

    try {
      const lot = await strapi.entityService.findOne('api::lot.lot', id);

      if (!lot) {
        return ctx.notFound('Lot not found');
      }

      const newQuantity = parseFloat(lot.currentQuantity) + parseFloat(adjustment);

      if (newQuantity < 0) {
        return ctx.badRequest('Adjustment would result in negative quantity');
      }

      // Update lot quantity
      const updatedLot = await strapi.entityService.update('api::lot.lot', id, {
        data: {
          currentQuantity: newQuantity,
          notes: `${lot.notes || ''}\n[${new Date().toISOString()}] Adjusted by ${adjustment} (${reason}) - ${adjustedBy}`.trim()
        },
        populate: {
          recipe: true,
          batch: true
        }
      });

      return {
        lot: updatedLot,
        previousQuantity: lot.currentQuantity,
        newQuantity: newQuantity,
        adjustment: adjustment
      };
    } catch (error) {
      strapi.log.error('Adjust lot quantity error:', error);
      return ctx.badRequest(error.message);
    }
  },

  /**
   * Get lots by recipe with availability status
   */
  async getByRecipe(ctx) {
    const { recipeId } = ctx.params;

    try {
      const lots = await strapi.entityService.findMany('api::lot.lot', {
        filters: {
          recipe: recipeId,
          status: { $in: ['available', 'reserved'] },
          currentQuantity: { $gt: 0 }
        },
        populate: {
          recipe: true,
          batch: true
        },
        sort: { expiryDate: 'asc', productionDate: 'asc' }
      });

      return lots || [];
    } catch (error) {
      strapi.log.error('Get lots by recipe error:', error);
      return ctx.badRequest(error.message);
    }
  },

  /**
   * Get expiring lots
   */
  async getExpiring(ctx) {
    const { days = 30 } = ctx.query;

    try {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + parseInt(days));

      const lots = await strapi.entityService.findMany('api::lot.lot', {
        filters: {
          expiryDate: {
            $lte: futureDate.toISOString().split('T')[0],
            $gte: new Date().toISOString().split('T')[0]
          },
          status: { $in: ['available', 'reserved'] },
          currentQuantity: { $gt: 0 }
        },
        populate: {
          recipe: true,
          batch: true
        },
        sort: { expiryDate: 'asc' }
      });

      return lots || [];
    } catch (error) {
      strapi.log.error('Get expiring lots error:', error);
      return ctx.badRequest(error.message);
    }
  }
}));
