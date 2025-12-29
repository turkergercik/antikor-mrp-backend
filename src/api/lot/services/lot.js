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
      const lots = await strapi.entityService.findMany('api::lot.lot', {
        filters: {
          recipe: recipeId,
          status: 'available',
          currentQuantity: { $gt: 0 }
        },
        sort: { expiryDate: 'asc', productionDate: 'asc' }
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
  async deductFromLots(allocations) {
    try {
      console.log('--- Deducting quantities from lots ---');

      for (const allocation of allocations) {
        const lot = await strapi.entityService.findOne('api::lot.lot', allocation.lotId);

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
  async returnToLots(allocations) {
    try {
      console.log('--- Returning quantities to lots ---');

      for (const allocation of allocations) {
        const lot = await strapi.entityService.findOne('api::lot.lot', allocation.lotId);

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

      // Generate lot number
      const date = new Date();
      const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
      const batchPrefix = batch.batchNumber ? batch.batchNumber.substring(0, 6) : 'BATCH';
      const randomSuffix = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const lotNumber = `LOT-${batchPrefix}-${dateStr}-${randomSuffix}`;

      console.log('Generated lot number:', lotNumber);

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
      const expiryDate = new Date(batch.productionDate);
      expiryDate.setFullYear(expiryDate.getFullYear() + 1);

      const lotData = {
        lotNumber,
        recipe: recipeId,
        batch: batch.id,
        productionDate: batch.productionDate,
        expiryDate: expiryDate.toISOString().split('T')[0],
        initialQuantity: parseFloat(quantity),
        currentQuantity: parseFloat(quantity),
        availableQuantity: parseFloat(quantity),
        unit: batch.unit || 'piece',
        unitCost: parseFloat(unitCost) || (batch.totalCost / batch.quantity),
        totalCost: parseFloat(unitCost) ? parseFloat(unitCost) * parseFloat(quantity) : batch.totalCost,
        status: 'available',
        qualityCheckResult: batch.qualityCheckResult || 'passed',
        qualityCheckNotes: batch.qualityCheckNotes || '',
        createdBy: batch.productionCompletedBy || batch.orderCreatedBy || 'system'
      };

      console.log('Creating lot with data:', JSON.stringify(lotData, null, 2));

      const lot = await strapi.entityService.create('api::lot.lot', {
        data: lotData
      });

      console.log('✓ Lot created successfully:', lot.lotNumber);
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
          qualityCheckNotes: batch.qualityCheckNotes || '',
          createdBy: batch.productionCompletedBy || batch.orderCreatedBy || 'system'
        };

        const lot = await strapi.entityService.create('api::lot.lot', {
          data: lotData
        });

        console.log('✓ Lot created successfully with unique number:', lot.lotNumber);
        return lot;
      }
      
      console.error('Error creating lot record:', error);
      throw error;
    }
  }
}));
