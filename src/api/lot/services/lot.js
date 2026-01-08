/**
 * lot service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::lot.lot', ({ strapi }) => ({
  /**
   * Allocate quantity from lots for an order (FIFO - First In, First Out)
   */
  async allocateLots(recipeId, requiredQuantity) {
    try {
      console.log(`--- Allocating lots for recipe ${recipeId}, quantity: ${requiredQuantity} ---`);

      // Get available lots sorted by production date (FIFO) and expiry date
      // Using createdAt as final tiebreaker to ensure consistent FIFO ordering
      const lots = await strapi.entityService.findMany('api::lot.lot', {
        filters: {
          recipe: recipeId,
          status: 'available',
          currentQuantity: { $gt: 0 }
        },
        sort: { productionDate: 'asc', expiryDate: 'asc', createdAt: 'asc' }
      });

      if (!lots || lots.length === 0) {
        return {
          success: false,
          message: 'No available lots found for this product',
          allocations: []
        };
      }

      let remainingQuantity = parseFloat(requiredQuantity);
      const allocations = [];

      // Allocate from lots using FIFO
      for (const lot of lots) {
        if (remainingQuantity <= 0) break;

        const availableInLot = parseFloat(lot.currentQuantity);
        const toAllocate = Math.min(availableInLot, remainingQuantity);

        allocations.push({
          lotId: lot.id,
          lotNumber: lot.lotNumber,
          quantity: toAllocate,
          unitCost: lot.unitCost,
          productionDate: lot.productionDate,
          expiryDate: lot.expiryDate
        });

        remainingQuantity -= toAllocate;
      }

      if (remainingQuantity > 0) {
        return {
          success: false,
          message: `Insufficient stock. Available: ${parseFloat(requiredQuantity) - remainingQuantity}, Required: ${requiredQuantity}`,
          allocations: [],
          shortfall: remainingQuantity
        };
      }

      return {
        success: true,
        allocations
      };
    } catch (error) {
      console.error('Error allocating lots:', error);
      throw error;
    }
  },

  /**
   * Deduct quantity from lots
   */
  async deductFromLots(allocations, orderInfo = null) {
    try {
      console.log('--- Deducting quantities from lots ---');
      
      // Track which recipes need inventory updates
      const recipesToUpdate = new Set();

      for (const allocation of allocations) {
        const lot = await strapi.entityService.findOne('api::lot.lot', allocation.lotId, {
          populate: ['recipe', 'batch']
        });

        if (!lot) {
          throw new Error(`Lot ${allocation.lotId} not found`);
        }

        const newQuantity = parseFloat(lot.currentQuantity) - parseFloat(allocation.quantity);

        if (newQuantity < 0) {
          throw new Error(`Insufficient quantity in lot ${lot.lotNumber}`);
        }

        await strapi.entityService.update('api::lot.lot', allocation.lotId, {
          data: {
            currentQuantity: newQuantity,
            status: newQuantity === 0 ? 'depleted' : lot.status
          }
        });

        console.log(`Deducted ${allocation.quantity} from lot ${lot.lotNumber}, new quantity: ${newQuantity}`);
        
        // Create stock history entry for the deduction (sale/shipment)
        if (lot.recipe) {
          const recipeId = lot.recipe.id || lot.recipe;
          recipesToUpdate.add(recipeId);
          
          // Get recipe details for SKU
          const recipe = await strapi.db.query('api::recipe.recipe').findOne({
            where: { id: recipeId },
            select: ['name', 'code']
          });

          if (recipe) {
            const sku = recipe.code || recipe.name || `RECIPE-${recipeId}`;
            
            // Create stock history entry for sale/order
            await strapi.db.query('api::stock-history.stock-history').create({
              data: {
                sku: sku,
                lotNumber: lot.lotNumber,
                transactionType: 'sale', // Deduction for order/sale
                quantity: parseFloat(allocation.quantity),
                unit: lot.unit || 'piece',
                pricePerUnit: lot.unitCost || 0,
                currency: 'USD',
                totalCost: (lot.unitCost || 0) * parseFloat(allocation.quantity),
                supplier: orderInfo ? `Order: ${orderInfo.customerName || 'Customer'}` : 'Order',
                purchaseDate: new Date().toISOString(),
                performedBy: orderInfo?.readyBy || 'system',
                currentBalance: newQuantity,
                notes: orderInfo 
                  ? `Sold to ${orderInfo.customerName}. Order quantity: ${orderInfo.quantity}${orderInfo.notes ? '. ' + orderInfo.notes : ''}`
                  : `Deducted from lot ${lot.lotNumber}`
              }
            });
            
            console.log('✓ Stock history entry created for sale from lot:', lot.lotNumber);
          }
        }
      }

      // Update inventory for all affected recipes
      for (const recipeId of recipesToUpdate) {
        await this.updateInventoryFromLots(recipeId);
      }

      return { success: true };
    } catch (error) {
      console.error('Error deducting from lots:', error);
      throw error;
    }
  },

  /**
   * Return quantity to lots (for order cancellations, returns)
   */
  async returnToLots(allocations, returnInfo = null) {
    try {
      console.log('--- Returning quantities to lots ---');
      
      // Track which recipes need inventory updates
      const recipesToUpdate = new Set();

      for (const allocation of allocations) {
        const lot = await strapi.entityService.findOne('api::lot.lot', allocation.lotId, {
          populate: ['recipe']
        });

        if (!lot) {
          console.warn(`Lot ${allocation.lotId} not found, skipping return`);
          continue;
        }

        const newQuantity = parseFloat(lot.currentQuantity) + parseFloat(allocation.quantity);

        await strapi.entityService.update('api::lot.lot', allocation.lotId, {
          data: {
            currentQuantity: newQuantity,
            status: 'available'
          }
        });

        console.log(`Returned ${allocation.quantity} to lot ${lot.lotNumber}, new quantity: ${newQuantity}`);
        
        // Create stock history entry for the return
        if (lot.recipe) {
          const recipeId = lot.recipe.id || lot.recipe;
          recipesToUpdate.add(recipeId);
          
          // Get recipe details for SKU
          const recipe = await strapi.db.query('api::recipe.recipe').findOne({
            where: { id: recipeId },
            select: ['name', 'code']
          });

          if (recipe) {
            const sku = recipe.code || recipe.name || `RECIPE-${recipeId}`;
            
            // Create stock history entry for return
            await strapi.db.query('api::stock-history.stock-history').create({
              data: {
                sku: sku,
                lotNumber: lot.lotNumber,
                transactionType: 'return', // Return from cancelled order
                quantity: parseFloat(allocation.quantity),
                unit: lot.unit || 'piece',
                pricePerUnit: lot.unitCost || 0,
                currency: 'USD',
                totalCost: (lot.unitCost || 0) * parseFloat(allocation.quantity),
                supplier: returnInfo ? `Return from: ${returnInfo.customerName || 'Customer'}` : 'Return',
                purchaseDate: new Date().toISOString(),
                performedBy: returnInfo?.cancelledBy || 'system',
                currentBalance: newQuantity,
                notes: returnInfo 
                  ? `Returned from cancelled order. Customer: ${returnInfo.customerName}${returnInfo.cancellationReason ? '. Reason: ' + returnInfo.cancellationReason : ''}`
                  : `Returned to lot ${lot.lotNumber}`
              }
            });
            
            console.log('✓ Stock history entry created for return to lot:', lot.lotNumber);
          }
        }
      }

      // Update inventory for all affected recipes
      for (const recipeId of recipesToUpdate) {
        await this.updateInventoryFromLots(recipeId);
      }

      return { success: true };
    } catch (error) {
      console.error('Error returning to lots:', error);
      throw error;
    }
  },

  /**
   * Create lot from batch
   */
  async createFromBatch(batchId, quantity, unitCost) {
    try {
      console.log(`--- Creating lot from batch ${batchId} ---`);

      const batch = await strapi.entityService.findOne('api::batch.batch', batchId, {
        populate: ['recipe']
      });

      if (!batch) {
        throw new Error('Batch not found');
      }

      if (!batch.recipe) {
        throw new Error('Batch has no recipe');
      }

      // Get recipe ID - handle both object and direct ID
      const recipeId = typeof batch.recipe === 'object' ? batch.recipe.id : batch.recipe;

      if (!recipeId) {
        throw new Error('Could not determine recipe ID');
      }

      // Use batch number as lot number directly
      const lotNumber = batch.batchNumber;

      console.log('Using batch number as lot number:', lotNumber);

      // Skip duplicate check - let database unique constraint handle it
      // The createLotRecord function will retry with timestamp suffix if needed
      return await this.createLotRecord(batch, recipeId, lotNumber, quantity, unitCost);
    } catch (error) {
      console.error('Error creating lot from batch:', error);
      strapi.log.error('Lot creation error details:', {
        error: error.message,
        stack: error.stack,
        batchId,
        quantity,
        unitCost
      });
      throw error;
    }
  },

  async createLotRecord(batch, recipeId, lotNumber, quantity, unitCost) {
    try {
      // Calculate expiry date (assuming 1 year shelf life)
      const productionDate = batch.productionDate || new Date().toISOString().split('T')[0];
      const expiryDate = new Date(productionDate);
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);

      const calculatedUnitCost = parseFloat(unitCost) || (batch.totalCost && batch.quantity ? batch.totalCost / batch.quantity : 0);

      const lotData = {
        lotNumber,
        recipe: recipeId,
        batch: batch.id,
        productionDate: productionDate,
        expiryDate: expiryDate.toISOString().split('T')[0],
        initialQuantity: parseFloat(quantity),
        currentQuantity: parseFloat(quantity),
        availableQuantity: parseFloat(quantity),
        unit: batch.unit || 'piece',
        unitCost: calculatedUnitCost,
        totalCost: calculatedUnitCost * parseFloat(quantity),
        status: 'available',
        qualityCheckResult: batch.qualityCheckResult || 'passed',
        qualityCheckNotes: batch.qualityCheckNotes || ''
        // createdBy is automatically handled by Strapi's created_by_id field
      };

      console.log('=== Creating lot with data ===');
      console.log('Batch productionDate:', batch.productionDate);
      console.log('Calculated productionDate:', productionDate);
      console.log('Calculated expiryDate:', lotData.expiryDate);
      console.log('Unit cost:', calculatedUnitCost);
      console.log('Total cost:', lotData.totalCost);
      console.log('Full lot data:', JSON.stringify(lotData, null, 2));

      // Use db.query instead of entityService to avoid lifecycle hooks during transaction
      const lot = await strapi.db.query('api::lot.lot').create({
        data: lotData
      });

      console.log('✓ Lot created successfully:', lot.lotNumber);
      
      // Create stock history entry for finished product
      try {
        await this.createStockHistoryForLot(lot, batch, recipeId);
      } catch (histError) {
        console.error('Warning: Could not create stock history:', histError.message);
      }
      
      // Note: Inventory is already updated by batch controller
      // No need to update it again here to avoid race conditions
      
      return lot;
    } catch (error) {
      // If it's a duplicate key error, try with a unique suffix
      if (error.message && (error.message.includes('duplicate') || error.message.includes('unique'))) {
        console.log('Duplicate lot number detected, retrying with timestamp suffix');
        const timestamp = Date.now().toString().slice(-4);
        const uniqueLotNumber = `${lotNumber}-${timestamp}`;
        
        const lotData = {
          lotNumber: uniqueLotNumber,
          recipe: recipeId,
          batch: batch.id,
          productionDate: batch.productionDate,
          expiryDate: new Date(new Date(batch.productionDate).setFullYear(new Date(batch.productionDate).getFullYear() + 1)).toISOString().split('T')[0],
          initialQuantity: parseFloat(quantity),
          currentQuantity: parseFloat(quantity),
          availableQuantity: parseFloat(quantity),
          unit: batch.unit || 'piece',
          unitCost: parseFloat(unitCost) || (batch.totalCost / batch.quantity),
          totalCost: parseFloat(unitCost) ? parseFloat(unitCost) * parseFloat(quantity) : batch.totalCost,
          status: 'available',
          qualityCheckResult: batch.qualityCheckResult || 'passed',
          qualityCheckNotes: batch.qualityCheckNotes || ''
          // createdBy is automatically handled by Strapi's created_by_id field
        };

        // Use db.query instead of entityService to avoid lifecycle hooks during transaction
        const lot = await strapi.db.query('api::lot.lot').create({
          data: lotData
        });

        console.log('✓ Lot created successfully with unique number:', lot.lotNumber);
        
        // Create stock history entry for finished product
        try {
          await this.createStockHistoryForLot(lot, batch, recipeId);
        } catch (histError) {
          console.error('Warning: Could not create stock history:', histError.message);
        }
        
        // Note: Inventory is already updated by batch controller
        // No need to update it again here to avoid race conditions
        
        return lot;
      }
      
      console.error('Error creating lot record:', error);
      throw error;
    }
  },

  async updateInventoryFromLots(recipeId) {
    try {
      console.log('--- Updating inventory from lots for recipe:', recipeId);
      
      // Get all lots for this recipe that are available  
      const lots = await strapi.db.query('api::lot.lot').findMany({
        where: {
          recipe: recipeId,
          status: { $in: ['available', 'reserved'] }
        },
        select: ['currentQuantity']
      });

      console.log('Found lots:', lots);

      // Calculate total stock from all lots
      const totalStock = lots.reduce((sum, lot) => {
        return sum + parseFloat(lot.currentQuantity || 0);
      }, 0);

      console.log('Total stock from lots:', totalStock);

      // Find inventory record using raw query to avoid relation issues
      const inventories = await strapi.db.connection.raw(
        'SELECT i.id, i.name, i.stock FROM inventories i INNER JOIN inventories_recipe_lnk r ON i.id = r.inventory_id WHERE r.recipe_id = ?',
        [recipeId]
      );

      const inventoryRows = inventories.rows || inventories[0] || [];
      console.log('Found inventory records:', inventoryRows);

      if (inventoryRows.length > 0) {
        // Update existing inventory
        await strapi.db.query('api::inventory.inventory').update({
          where: { id: inventoryRows[0].id },
          data: {
            stock: totalStock,
            lastUpdated: new Date()
          }
        });
        console.log(`Updated inventory record ${inventoryRows[0].id}: stock updated to ${totalStock}`);
      } else {
        // Create new inventory record if it doesn't exist
        console.log('Creating new inventory record for recipe:', recipeId);
        
        const recipe = await strapi.db.query('api::recipe.recipe').findOne({
          where: { id: recipeId },
          select: ['name', 'code']
        });
        
        if (recipe) {
          const inventoryRecord = await strapi.db.query('api::inventory.inventory').create({
            data: {
              name: recipe.name || 'Unknown Recipe',
              stock: totalStock,
              lastUpdated: new Date()
            }
          });
          
          // Link the recipe using the join table
          await strapi.db.connection.raw(
            'INSERT INTO inventories_recipe_lnk (inventory_id, recipe_id) VALUES (?, ?)',
            [inventoryRecord.id, recipeId]
          );
          
          console.log(`Created new inventory record ${inventoryRecord.id}: stock set to ${totalStock}`);
        }
      }
    } catch (error) {
      console.error('Error updating inventory from lots:', error);
      throw error;
    }
  },

  async createStockHistoryForLot(lot, batch, recipeId) {
    try {
      console.log('--- Creating stock history for finished product lot:', lot.lotNumber);
      
      // Get recipe details to use as SKU
      const recipe = await strapi.db.query('api::recipe.recipe').findOne({
        where: { id: recipeId },
        select: ['name', 'code']
      });

      if (!recipe) {
        console.warn('Recipe not found for stock history');
        return;
      }

      const sku = recipe.code || recipe.name || `RECIPE-${recipeId}`;

      // Create stock history entry for finished product (production)
      await strapi.db.query('api::stock-history.stock-history').create({
        data: {
          sku: sku,
          lotNumber: lot.lotNumber,
          transactionType: 'production', // Finished product from manufacturing
          quantity: parseFloat(lot.initialQuantity),
          unit: lot.unit || 'piece',
          pricePerUnit: lot.unitCost || 0,
          currency: 'USD', // Batches are always calculated in USD
          totalCost: lot.totalCost || 0,
          supplier: `Production: Batch ${batch.batchNumber}`,
          purchaseDate: lot.productionDate || new Date().toISOString(),
          performedBy: batch.qualityCheckedBy || 'system',
          currentBalance: parseFloat(lot.currentQuantity),
          notes: `Finished product lot created from batch ${batch.batchNumber}. Recipe: ${recipe.name}`
        }
      });

      console.log('✓ Stock history entry created for lot:', lot.lotNumber);
    } catch (error) {
      console.error('Error creating stock history for lot:', error);
      throw error;
    }
  }
}));
