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
      const lot = await strapi.entityService.findOne('api::lot.lot', id, {
        populate: {
          recipe: true,
          batch: true
        }
      });

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
          status: newQuantity === 0 ? 'depleted' : lot.status,
          notes: `${lot.notes || ''}\n[${new Date().toISOString()}] Adjusted by ${adjustment} (${reason}) - ${adjustedBy}`.trim()
        },
        populate: {
          recipe: true,
          batch: true
        }
      });

      // Sync with stock history
      try {
        const sku = lot.recipe?.code || lot.recipe?.name;
        
        // Get current stock history balance for this lot
        const stockHistory = await strapi.entityService.findMany('api::stock-history.stock-history', {
          filters: {
            sku: sku,
            lotNumber: lot.lotNumber
          },
          sort: { createdAt: 'desc' }
        });
        
        // Calculate current balance from stock history
        let stockHistoryBalance = stockHistory.reduce((balance, t) => {
          if (['purchase', 'production', 'return'].includes(t.transactionType)) {
            return balance + parseFloat(t.quantity || 0);
          } else if (['usage', 'sale', 'waste', 'imha'].includes(t.transactionType)) {
            return balance - parseFloat(t.quantity || 0);
          } else if (t.transactionType === 'adjustment') {
            return balance - parseFloat(t.quantity || 0);
          }
          return balance;
        }, 0);
        
        strapi.log.info(`[LOT-ADJUSTMENT] Lot ${lot.lotNumber}: currentQuantity=${lot.currentQuantity} -> ${newQuantity}, stockHistoryBalance=${stockHistoryBalance}`);
        
        // Create stock history transaction to match the lot adjustment
        const adjustmentQty = parseFloat(adjustment);
        const transactionType = adjustmentQty < 0 ? 'usage' : 'return';
        const absAdjustment = Math.abs(adjustmentQty);
        
        await strapi.entityService.create('api::stock-history.stock-history', {
          data: {
            rawMaterial: lot.recipe?.id,
            sku: sku,
            lotNumber: lot.lotNumber,
            transactionType: transactionType,
            quantity: absAdjustment,
            unit: lot.unit || 'piece',
            notes: `Lot adjustment: ${reason}`,
            performedBy: adjustedBy || 'system',
            currentBalance: newQuantity,
            pricePerUnit: 0,
            totalCost: 0,
            currency: 'USD'
          }
        });
        
        strapi.log.info(`[LOT-ADJUSTMENT] Created stock history transaction: ${transactionType} ${absAdjustment} ${lot.unit}`);
      } catch (syncError) {
        strapi.log.error('Failed to sync stock history:', syncError);
        // Don't fail the whole operation if sync fails
      }

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
      // Try to find recipe first to get its numeric ID if documentId was provided
      let recipeFilter = recipeId;
      
      // If it looks like a documentId (contains letters), try to find the recipe
      if (isNaN(recipeId)) {
        const recipe = await strapi.db.query('api::recipe.recipe').findOne({
          where: { documentId: recipeId }
        });
        
        if (recipe) {
          recipeFilter = recipe.id;
        }
      }

      const lots = await strapi.entityService.findMany('api::lot.lot', {
        filters: {
          recipe: recipeFilter
        },
        populate: {
          recipe: true,
          batch: true
        },
        sort: { expiryDate: 'asc', productionDate: 'asc' }
      });

      strapi.log.info(`Found ${lots?.length || 0} lots for recipe ${recipeId} (filter: ${recipeFilter})`);

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
      
      const todayStr = new Date().toISOString().split('T')[0];
      const futureStr = futureDate.toISOString().split('T')[0];

      strapi.log.info(`Expiring lots query - today: ${todayStr}, future: ${futureStr}`);

      // Get lots that are either expiring soon OR have 0 quantity
      const lots = await strapi.entityService.findMany('api::lot.lot', {
        filters: {
          $or: [
            {
              // Expiring soon
              expiryDate: {
                $lte: futureStr,
                $gte: todayStr
              }
            },
            {
              // Zero quantity (depleted)
              currentQuantity: 0
            }
          ]
        },
        populate: {
          recipe: true,
          batch: true
        },
        sort: { expiryDate: 'asc' }
      });

      strapi.log.info(`Found ${lots.length} expiring/depleted lots`);
      lots.forEach(lot => {
        strapi.log.info(`  Lot: ${lot.lotNumber}, Qty: ${lot.currentQuantity}, Expiry: ${lot.expiryDate}, Status: ${lot.status}`);
      });

      return lots || [];
    } catch (error) {
      strapi.log.error('Get expiring lots error:', error);
      return ctx.badRequest(error.message);
    }
  }
}));
