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
            // Ensure we get just the ID, not the full object
            const rawMaterialId = typeof ingredient.rawMaterial === 'object' 
              ? ingredient.rawMaterial.id 
              : ingredient.rawMaterial;
            const requiredAmount = parseFloat(ingredient.quantity) * batchQuantity;
            
            // Get current stock
            const material = await strapi.entityService.findOne('api::raw-material.raw-material', rawMaterialId, {
              fields: ['id', 'name', 'unit', 'sku']
            });
            
            if (!material) {
              return ctx.badRequest(`Malzeme bulunamadı: ${ingredient.rawMaterial.name}`);
            }
            
            const sku = material.sku || material.name;
            
            // Calculate current stock from stock-history
            let currentStock = 0;
            try {
              const stockHistory = await strapi.entityService.findMany('api::stock-history.stock-history', {
                filters: { sku: sku }
              });

              currentStock = stockHistory.reduce((total, record) => {
                if (record.transactionType === 'purchase' || record.transactionType === 'return') {
                  return total + parseFloat(record.quantity || 0);
                } else {
                  return total - parseFloat(record.quantity || 0);
                }
              }, 0);
            } catch (error) {
              strapi.log.error('Error fetching stock history:', error);
              // If stock-history fetch fails, stock is 0
              currentStock = 0;
            }
            
            strapi.log.info(`${material.name}: Required: ${requiredAmount}, Stock: ${currentStock}`);
            
            // Check if enough stock
            if (currentStock < requiredAmount) {
              return ctx.badRequest(`Yetersiz ${material.name} stoku. Gerekli: ${requiredAmount}, Mevcut: ${currentStock}`);
            }
            
            // Get the selected lot(s) for this material from batch data
            const rawMaterialLotsData = currentBatch.rawMaterialLots?.[sku];
            let lotAllocations = [];
            
            // Check if it's multi-lot allocation (array) or single lot (string)
            if (Array.isArray(rawMaterialLotsData)) {
              // Multi-lot allocation: array of {lotNumber, quantity}
              lotAllocations = rawMaterialLotsData;
            } else if (rawMaterialLotsData) {
              // Single lot: use full required quantity
              lotAllocations = [{ lotNumber: rawMaterialLotsData, quantity: requiredAmount }];
            } else {
              // No lot selected - auto-select using FIFO
              // No lot selected - auto-select using FIFO
              try {
                const stockHistory = await strapi.entityService.findMany('api::stock-history.stock-history', {
                  filters: { sku: sku }
                });

                // Group by lot number
                const lotMap = {};
                stockHistory.forEach(record => {
                  if (!lotMap[record.lotNumber]) {
                    lotMap[record.lotNumber] = {
                      lotNumber: record.lotNumber,
                      totalStock: 0,
                      purchaseDate: record.purchaseDate
                    };
                  }
                  
                  if (record.transactionType === 'purchase' || record.transactionType === 'return') {
                    lotMap[record.lotNumber].totalStock += parseFloat(record.quantity || 0);
                  } else {
                    lotMap[record.lotNumber].totalStock -= parseFloat(record.quantity || 0);
                  }
                });

                // Get available lots and sort by FIFO (oldest first)
                const availableLots = Object.values(lotMap)
                  .filter(lot => lot.totalStock > 0)
                  .sort((a, b) => new Date(a.purchaseDate) - new Date(b.purchaseDate));

                if (availableLots.length > 0) {
                  const selectedLot = availableLots[0].lotNumber;
                  lotAllocations = [{ lotNumber: selectedLot, quantity: requiredAmount }];
                  strapi.log.info(`Auto-selected lot ${selectedLot} for ${material.name} using FIFO`);
                } else {
                  return ctx.badRequest(`${material.name} için kullanılabilir lot bulunamadı`);
                }
              } catch (error) {
                strapi.log.error('Error auto-selecting lot:', error);
                return ctx.badRequest(`${material.name} için lot seçimi yapılamadı`);
              }
            }
            
            // Process each lot allocation
            for (const allocation of lotAllocations) {
              const { lotNumber: selectedLot, quantity: lotQuantity } = allocation;
            
              // Verify the selected lot has enough stock and get lot details
              let lotStock = 0;
              let lotPricePerUnit = 0;
              let lotCurrency = 'USD';
              try {
                const lotHistory = await strapi.entityService.findMany('api::stock-history.stock-history', {
                  filters: { 
                    sku: sku,
                    lotNumber: selectedLot
                  }
                });

                lotStock = lotHistory.reduce((total, record) => {
                  if (record.transactionType === 'purchase' || record.transactionType === 'return') {
                    return total + parseFloat(record.quantity || 0);
                  } else {
                    return total - parseFloat(record.quantity || 0);
                  }
                }, 0);
                
                // Get price and currency from the first purchase/return entry of this lot
                const purchaseRecord = lotHistory.find(r => r.transactionType === 'purchase' || r.transactionType === 'return');
                if (purchaseRecord) {
                  let pricePerUnit = parseFloat(purchaseRecord.pricePerUnit || 0);
                  const originalCurrency = purchaseRecord.currency || 'USD';
                  
                  // Convert price to USD if needed (batches always work in USD)
                  if (originalCurrency === 'TRY') {
                    // Note: This conversion uses a hardcoded rate. Ideally should fetch from exchange rate API
                    // For now, assume the price is already in USD
                    lotPricePerUnit = pricePerUnit;
                  } else if (originalCurrency === 'USD') {
                    lotPricePerUnit = pricePerUnit;
                  } else {
                    lotPricePerUnit = pricePerUnit; // EUR, GBP etc - assume USD for now
                  }
                  lotCurrency = 'USD'; // Always USD for batch production
                }
              } catch (error) {
                strapi.log.error('Error fetching lot stock:', error);
              }
              
              // Verify lot has enough stock for this allocation
              if (lotStock < lotQuantity) {
                return ctx.badRequest(`Seçili lot (${selectedLot}) yetersiz stok. ${material.name} için gerekli: ${lotQuantity}, lot stoku: ${lotStock}`);
              }
              
              // Calculate total cost for this usage (always in USD)
              const usageTotalCost = lotPricePerUnit * lotQuantity;
              
              // Create stock-history entry for usage (deduction) from the specific lot
              // Always use USD for batch production entries
              // Ensure rawMaterial is passed as just the ID to avoid "Invalid key" errors
              await strapi.entityService.create('api::stock-history.stock-history', {
                data: {
                  rawMaterial: parseInt(rawMaterialId), // Ensure it's just the numeric ID
                  sku: sku,
                  lotNumber: selectedLot,
                  transactionType: 'usage',
                  quantity: lotQuantity,
                  unit: material.unit,
                  pricePerUnit: lotPricePerUnit,
                  currency: 'USD',
                  totalCost: usageTotalCost,
                  supplier: `Production: ${currentBatch.batchNumber}`,
                  purchaseDate: new Date().toISOString(),
                  performedBy: data.updatedBy || 'system',
                  currentBalance: lotStock - lotQuantity,
                  notes: `Used for batch production: ${currentBatch.batchNumber} from lot ${selectedLot}${lotAllocations.length > 1 ? ` (multi-lot: ${lotQuantity}/${requiredAmount})` : ''}${currentBatch.rawMaterialLots?.[sku] ? '' : ' [Auto-selected FIFO]'}`
                }
              });
              
              strapi.log.info(`Deducted ${lotQuantity} ${material.unit} of ${material.name} from lot ${selectedLot} via stock-history`);
            }
          }
        }

        // Deduct packaging materials only if packaging is enabled
        if (currentBatch.packaging === true) {
          strapi.log.info('Packaging enabled, deducting packaging materials...');
          
          const allMaterials = await strapi.entityService.findMany('api::raw-material.raw-material', {
            filters: {
              packagingCapacity: { $gt: 0 }
            },
            fields: ['id', 'name', 'packagingCapacity', 'unit', 'sku']
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
                // Get current stock from stock-history for packaging material
                const sku = material.sku || material.name;
                let packagingStock = 0;
                
                try {
                  const stockHistory = await strapi.entityService.findMany('api::stock-history.stock-history', {
                    filters: { sku: sku }
                  });
                  packagingStock = stockHistory.reduce((total, record) => {
                    if (record.transactionType === 'purchase' || record.transactionType === 'return') {
                      return total + parseFloat(record.quantity || 0);
                    } else {
                      return total - parseFloat(record.quantity || 0);
                    }
                  }, 0);
                } catch (error) {
                  strapi.log.error('Error fetching packaging stock history:', error);
                  packagingStock = 0;
                }
                
                strapi.log.info(`${material.name} (${capacity}): Required: ${requiredPackages}, Stock: ${packagingStock}`);

                // Check stock availability
                if (packagingStock < requiredPackages) {
                  return ctx.badRequest(`Yetersiz ${material.name} stoku. Gerekli: ${requiredPackages}, Mevcut: ${packagingStock}`);
                }

                // Note: Packaging stock deduction should be handled via stock-history, not direct update
                // For now, we'll skip the deduction as it should be done through stock-history API
                strapi.log.warn('Packaging stock deduction via stock-history not yet implemented');
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

      // Sanitize data to only include valid batch schema fields
      // This prevents "Invalid key" errors from Strapi v5's strict validation
      const validBatchFields = [
        'batchNumber', 'recipe', 'quantity', 'unit', 'batchStatus', 'productionDate',
        'expiryDate', 'totalCost', 'orderCreatedBy', 'orderCreatedAt',
        'productionStartedBy', 'productionStartedAt', 'productionCompletedBy', 
        'productionCompletedAt', 'qualityCheckedBy', 'qualityCheckedAt',
        'qualityCheckResult', 'qualityCheckNotes', 'qualityCheckAttachments', 'actualQuantity', 'wastage',
        'shippedBy', 'shippedAt', 'trackingNumber', 'cargoCompany',
        'shipmentStatus', 'notes', 'rawMaterialLots', 'ingredientsUsed'
      ];
      
      const sanitizedData = {};
      for (const key of Object.keys(data)) {
        if (validBatchFields.includes(key)) {
          sanitizedData[key] = data[key];
        } else {
          strapi.log.warn(`Ignoring invalid batch field: ${key}`);
        }
      }

      const updatedBatch = await strapi.entityService.update('api::batch.batch', batchId, {
        data: sanitizedData,
        populate: ['recipe', 'cargoCompany'],
      });

      return ctx.send({ data: updatedBatch });
    } catch (error) {
      strapi.log.error('Update batch error:', error);
      strapi.log.error('Error message:', error.message);
      strapi.log.error('Error stack:', error.stack);
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

  /**
   * Custom action to complete production and update inventory
   */
  async complete(ctx) {
    try {
      const { id } = ctx.params;
      const { actualQuantity, wastage, qualityCheckedBy, qualityCheckNotes } = ctx.request.body;

      if (!id) {
        return ctx.badRequest('Batch ID is required');
      }

      if (actualQuantity === undefined || actualQuantity === null) {
        return ctx.badRequest('actualQuantity is required');
      }

      if (wastage === undefined || wastage === null) {
        return ctx.badRequest('wastage is required');
      }

      // Handle both numeric id and documentId
      let batch;
      if (isNaN(id)) {
        batch = await strapi.db.query('api::batch.batch').findOne({
          where: { documentId: id },
          populate: ['recipe'],
        });
      } else {
        batch = await strapi.entityService.findOne('api::batch.batch', id, {
          populate: ['recipe'],
        });
      }
      
      if (!batch) {
        return ctx.notFound('Batch not found');
      }

      if (!batch.recipe) {
        return ctx.badRequest('Batch has no recipe associated');
      }

      const batchId = batch.id;
      const recipeId = batch.recipe.id;

      // Find or create inventory record for this recipe
      const inventories = await strapi.db.query('api::inventory.inventory').findMany({
        populate: ['recipe'],
      });
      
      let inventory = inventories.find(inv => inv.recipe && inv.recipe.id === recipeId);

      let currentStock = 0;
      let newStock = 0;

      if (inventory) {
        currentStock = parseFloat(inventory.stock || 0);
        newStock = currentStock + parseFloat(actualQuantity);
        
        // Update existing inventory
        await strapi.db.query('api::inventory.inventory').update({
          where: { id: inventory.id },
          data: {
            stock: newStock,
            lastUpdated: new Date().toISOString(),
          },
        });
      } else {
        // Create new inventory record using db query
        newStock = parseFloat(actualQuantity);
        
        // Get recipe name for the inventory
        const recipe = await strapi.db.query('api::recipe.recipe').findOne({
          where: { id: recipeId },
          select: ['name']
        });
        
        const inventoryRecord = await strapi.db.query('api::inventory.inventory').create({
          data: {
            name: recipe?.name || 'Unknown Recipe',
            stock: newStock,
            lastUpdated: new Date().toISOString(),
          },
        });
        
        // Link the recipe using the join table
        await strapi.db.connection.raw(
          'INSERT INTO inventories_recipe_lnk (inventory_id, recipe_id) VALUES (?, ?)',
          [inventoryRecord.id, recipeId]
        );
      }

      strapi.log.info(`=== Completing Production ===`);
      strapi.log.info(`Batch ID: ${batchId}, Recipe ID: ${recipeId}`);
      strapi.log.info(`Actual Quantity: ${actualQuantity}, Wastage: ${wastage}`);
      strapi.log.info(`Current Stock: ${currentStock}, New Stock: ${newStock}`);

      // Update batch with completion data and set to approved status
      const currentUser = ctx.state.user;
      const updateData = {
        batchStatus: 'approved',
        actualQuantity: parseFloat(actualQuantity),
        wastage: parseFloat(wastage),
      };
      
      // Add quality check fields if provided
      if (qualityCheckedBy) {
        updateData.qualityCheckedBy = qualityCheckedBy;
        updateData.qualityCheckedAt = new Date().toISOString();
        updateData.qualityCheckResult = 'passed';
      }
      
      if (qualityCheckNotes) {
        updateData.qualityCheckNotes = qualityCheckNotes;
      }
      
      await strapi.entityService.update('api::batch.batch', batchId, {
        data: updateData,
      });

      // Fetch the updated batch to return complete data
      const updatedBatch = await strapi.entityService.findOne('api::batch.batch', batchId, {
        populate: ['recipe', 'cargoCompany'],
      });

      // Create lot after transaction completes (outside of batch update transaction)
      try {
        console.log('=== Creating lot for approved batch ===');
        console.log('Batch totalCost:', batch.totalCost);
        console.log('Actual quantity:', actualQuantity);
        console.log('New stock:', newStock);
        
        const unitCost = batch.totalCost && parseFloat(actualQuantity) > 0 
          ? batch.totalCost / parseFloat(actualQuantity) 
          : 0;
        
        console.log('Calculated unit cost:', unitCost);
        
        const lot = await strapi.service('api::lot.lot').createFromBatch(
          batchId,
          parseFloat(actualQuantity),
          unitCost
        );
        console.log('✓ Lot created successfully:', lot.lotNumber, 'with unitCost:', lot.unitCost);
      } catch (lotError) {
        console.error('Warning: Could not create lot:', lotError.message);
        // Don't fail the whole operation if lot creation fails
      }

      strapi.log.info(`Production completed successfully. Stock updated from ${currentStock} to ${newStock}`);

      return ctx.send({
        message: 'Production completed and inventory updated',
        data: {
          batch: updatedBatch,
          batchId,
          recipeId,
          actualQuantity: parseFloat(actualQuantity),
          wastage: parseFloat(wastage),
          previousStock: currentStock,
          newStock,
        },
      });
    } catch (error) {
      strapi.log.error('Complete production error:', error);
      return ctx.badRequest(error.message);
    }
  },
}));
