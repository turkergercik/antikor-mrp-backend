/**
 * batch controller
 */

// @ts-nocheck
const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::batch.batch', ({ strapi }) => ({
  /**
   * Override create to handle packaging inventory deduction
   */
  async create(ctx) {
    const { data } = ctx.request.body;

    strapi.log.info('=== Batch Create Request ===');
    strapi.log.info('Data:', JSON.stringify(data, null, 2));

    try {
      // Create the batch without deducting stock
      // Stock will be deducted when production starts (status changes to in_progress)
      const entity = await strapi.entityService.create('api::batch.batch', {
        data: data,
        populate: ['recipe', 'cargoCompany'],
      });

      const sanitizedEntity = await this.sanitizeOutput(entity, ctx);
      return this.transformResponse(sanitizedEntity);
    } catch (error) {
      strapi.log.error('Create batch error:', error);
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
        return ctx.badRequest('Batch ID is required');
      }

      // Handle both numeric id and documentId
      let batchId = id;
      
      if (isNaN(id)) {
        const batch = await strapi.db.query('api::batch.batch').findOne({
          where: { documentId: id },
        });
        
        if (!batch) {
          return ctx.notFound('Batch not found');
        }
        
        batchId = batch.id;
      }

      const result = await strapi.service('api::batch.batch').updateTrackingStatus(batchId);

      if (!result.success) {
        return ctx.send({
          message: result.message || 'Takip bilgisi alınamadı',
          data: result,
        }, 200); // Return 200 instead of error
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
      }, 200); // Return 200 instead of error
    }
  },

  /**
   * Override update to handle partial updates without strict validation
   */
  async update(ctx) {
    const { id } = ctx.params;
    const { data } = ctx.request.body;

    // Log incoming data for debugging
    strapi.log.info('=== Batch Update Request ===');
    strapi.log.info('ID:', id);
    strapi.log.info('Data:', JSON.stringify(data, null, 2));

    try {
      // Handle both numeric id and documentId
      let batchId = id;
      
      // If id is not a number, it's likely a documentId, so find the numeric id
      if (isNaN(id)) {
        const batch = await strapi.db.query('api::batch.batch').findOne({
          where: { documentId: id },
        });
        
        if (!batch) {
          return ctx.notFound('Batch not found');
        }
        
        batchId = batch.id;
      }

      // Get current batch data
      const currentBatch = await strapi.entityService.findOne('api::batch.batch', batchId, {
        populate: {
          recipe: {
            populate: {
              ingredients: {
                populate: ['rawMaterial']
              }
            }
          }
        }
      });

      // Check if status is changing to in_progress and deduct stock
      const newStatus = data.batchStatus || data.status;
      const currentStatus = currentBatch.batchStatus || currentBatch.status;
      
      strapi.log.info('=== Status Check ===');
      strapi.log.info('Current Status:', currentStatus);
      strapi.log.info('New Status:', newStatus);
      strapi.log.info('Packaging Value:', currentBatch.packaging);
      
      if (newStatus === 'in_progress' && currentStatus !== 'in_progress') {
        strapi.log.info('Status changing to in_progress, deducting stock...');

        // Deduct recipe ingredients
        if (currentBatch.recipe && currentBatch.recipe.ingredients && currentBatch.recipe.ingredients.length > 0) {
          const batchQuantity = parseFloat(currentBatch.quantity);
          
          for (const ingredient of currentBatch.recipe.ingredients) {
            const rawMaterialId = ingredient.rawMaterial.id;
            const requiredAmount = parseFloat(ingredient.quantity) * batchQuantity;
            
            // Get current stock
            const material = await strapi.entityService.findOne('api::raw-material.raw-material', rawMaterialId, {
              fields: ['id', 'name', 'currentStock', 'unit']
            });
            
            if (!material) {
              return ctx.badRequest(`Malzeme bulunamadı: ${ingredient.rawMaterial.name}`);
            }
            
            strapi.log.info(`${material.name}: Required: ${requiredAmount}, Stock: ${material.currentStock}`);
            
            // Check if enough stock
            if (material.currentStock < requiredAmount) {
              return ctx.badRequest(`Yetersiz ${material.name} stoku. Gerekli: ${requiredAmount}, Mevcut: ${material.currentStock}`);
            }
            
            // Deduct from stock
            await strapi.entityService.update('api::raw-material.raw-material', rawMaterialId, {
              data: {
                currentStock: material.currentStock - requiredAmount
              }
            });
            
            strapi.log.info(`Deducted ${requiredAmount} ${material.unit} of ${material.name} from inventory`);
          }
        }

        // Deduct packaging materials only if packaging is enabled
        if (currentBatch.packaging === true) {
          strapi.log.info('Packaging enabled, deducting packaging materials...');
          
          const allMaterials = await strapi.entityService.findMany('api::raw-material.raw-material', {
            filters: {
              packagingCapacity: { $gt: 0 }
            },
            fields: ['id', 'name', 'currentStock', 'packagingCapacity', 'unit']
          });

          if (allMaterials && allMaterials.length > 0) {
            const quantity = parseFloat(currentBatch.quantity);
            
            // First, calculate how many 100-piece parcels are needed
            let small100Parcels = 0;
            const smallParcel = allMaterials.find(m => m.packagingCapacity === 100);
            if (smallParcel) {
              small100Parcels = Math.ceil(quantity / 100);
            }

            // Calculate required packaging for each size
            for (const material of allMaterials) {
              const capacity = material.packagingCapacity;
              let requiredPackages = 0;

              if (capacity === 100) {
                requiredPackages = Math.ceil(quantity / 100);
              } else if (capacity === 200) {
                requiredPackages = small100Parcels >= 2 ? Math.ceil(small100Parcels / 2) : 0;
              } else {
                requiredPackages = Math.ceil(quantity / capacity);
              }

              if (requiredPackages > 0) {
                strapi.log.info(`${material.name} (${capacity}): Required: ${requiredPackages}, Stock: ${material.currentStock}`);

                // Check stock availability
                if (material.currentStock < requiredPackages) {
                  return ctx.badRequest(`Yetersiz ${material.name} stoku. Gerekli: ${requiredPackages}, Mevcut: ${material.currentStock}`);
                }

                // Deduct from stock
                await strapi.entityService.update('api::raw-material.raw-material', material.id, {
                  data: {
                    currentStock: material.currentStock - requiredPackages
                  }
                });
                strapi.log.info(`Deducted ${requiredPackages} ${material.name} from inventory`);
              }
            }
          }
        } else {
          strapi.log.info('Packaging not enabled, skipping packaging deduction');
        }
      }

      // Validate production status if provided
      if (data.status !== undefined) {
        const validProductionStatuses = ['planned', 'in_progress', 'completed', 'quality_check', 'approved', 'rejected', 'shipped'];
        
        // If null or empty, set to default
        if (!data.status) {
          strapi.log.warn('Empty production status, setting to "planned"');
          data.status = 'planned';
        } else if (!validProductionStatuses.includes(data.status)) {
          strapi.log.warn(`Invalid production status: ${data.status}, setting to "planned"`);
          data.status = 'planned';
        }
      }

      // Validate shipmentStatus if provided (including null/empty checks)
      if (data.shipmentStatus !== undefined) {
        const validStatuses = ['yolda', 'dagitimda', 'teslim_edildi', 'bulunamadi'];
        
        // If null or empty, remove it (field is optional)
        if (!data.shipmentStatus) {
          delete data.shipmentStatus;
        } else if (!validStatuses.includes(data.shipmentStatus)) {
          strapi.log.warn(`Invalid shipmentStatus: ${data.shipmentStatus}, setting to 'yolda'`);
          data.shipmentStatus = 'yolda';
        }
      }

      const updatedBatch = await strapi.entityService.update('api::batch.batch', batchId, {
        data: data,
        populate: ['recipe', 'cargoCompany'],
      });

      return ctx.send({ data: updatedBatch });
    } catch (error) {
      strapi.log.error('Update batch error:', error);
      strapi.log.error('Error details:', error.details);
      
      // Check if it's a validation error
      if (error.message && (error.message.includes('status') || error.message.includes('Status'))) {
        strapi.log.error('Status validation error, trying to fix...');
        
        // Remove problematic status fields and set defaults
        const cleanData = { ...data };
        
        // Fix production status
        if (cleanData.status !== undefined) {
          delete cleanData.status;
          cleanData.status = 'planned';
        }
        
        // Remove shipmentStatus if problematic
        if (cleanData.shipmentStatus !== undefined) {
          delete cleanData.shipmentStatus;
        }
        
        try {
          const updatedBatch = await strapi.entityService.update('api::batch.batch', batchId, {
            data: cleanData,
            populate: ['recipe', 'cargoCompany'],
          });
          return ctx.send({ data: updatedBatch });
        } catch (retryError) {
          strapi.log.error('Retry failed:', retryError);
          return ctx.badRequest(retryError.message);
        }
      }
      
      return ctx.badRequest(error.message);
    }
  },
}));
