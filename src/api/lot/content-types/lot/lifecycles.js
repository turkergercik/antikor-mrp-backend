module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;
    
    console.log('=== Lot beforeCreate lifecycle triggered ===');
    console.log('Data received:', JSON.stringify(data, null, 2));
    
    // Auto-generate lot number if not provided
    if (!data.lotNumber) {
      const date = new Date();
      const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
      const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase();
      data.lotNumber = `LOT-${dateStr}-${randomStr}`;
      console.log('Generated lot number:', data.lotNumber);
    }

    // Set initial quantity to current quantity if not set
    if (data.initialQuantity && !data.currentQuantity) {
      data.currentQuantity = data.initialQuantity;
    }

    // Calculate total cost
    if (data.unitCost && data.initialQuantity) {
      data.totalCost = parseFloat(data.unitCost) * parseFloat(data.initialQuantity);
      console.log('Calculated total cost:', data.totalCost);
    }

    // Check if lot should be marked as expired
    if (data.expiryDate) {
      const expiryDate = new Date(data.expiryDate);
      const today = new Date();
      if (expiryDate < today) {
        data.status = 'expired';
        console.log('Lot marked as expired');
      }
    }
  },

  async beforeUpdate(event) {
    const { data } = event.params;
    
    console.log('=== Lot beforeUpdate lifecycle triggered ===');
    console.log('Update data:', JSON.stringify(data, null, 2));

    // Recalculate total cost if unit cost or initial quantity changed
    if (data.unitCost !== undefined || data.initialQuantity !== undefined) {
      const lotId = event.params.where.id || event.params.where.documentId;
      const lot = await strapi.entityService.findOne('api::lot.lot', lotId);
      
      const unitCost = data.unitCost !== undefined ? data.unitCost : lot.unitCost;
      const initialQuantity = data.initialQuantity !== undefined ? data.initialQuantity : lot.initialQuantity;
      
      if (unitCost && initialQuantity) {
        data.totalCost = parseFloat(unitCost) * parseFloat(initialQuantity);
        console.log('Recalculated total cost:', data.totalCost);
      }
    }

    // Check if current quantity is depleted
    if (data.currentQuantity !== undefined && parseFloat(data.currentQuantity) <= 0) {
      data.status = 'depleted';
      console.log('Lot marked as depleted');
    }

    // Check if lot should be marked as expired
    if (data.expiryDate) {
      const expiryDate = new Date(data.expiryDate);
      const today = new Date();
      if (expiryDate < today && data.status !== 'recalled') {
        data.status = 'expired';
        console.log('Lot marked as expired');
      }
    }
  },

  async afterUpdate(event) {
    const { result } = event;
    
    console.log('=== Lot afterUpdate lifecycle triggered ===');
    
    // Inventory update is now handled manually in lot service
    // to avoid transaction conflicts during batch completion
    // Update inventory totals
    // if (result.recipe) {
    //   await updateInventoryFromLots(result.recipe.id || result.recipe);
    // }
  },
};

async function updateInventoryFromLots(recipeId) {
  try {
    console.log('--- Updating inventory from lots for recipe:', recipeId);
    
    // Get all lots for this recipe that are available
    const lots = await strapi.entityService.findMany('api::lot.lot', {
      filters: {
        recipe: recipeId,
        status: { $in: ['available', 'reserved'] }
      },
      fields: ['currentQuantity']
    });

    // Calculate total stock from all lots
    const totalStock = lots.reduce((sum, lot) => {
      return sum + parseFloat(lot.currentQuantity || 0);
    }, 0);

    console.log('Total stock from lots:', totalStock);

    // Find or create inventory record
    const inventories = await strapi.entityService.findMany('api::inventory.inventory', {
      filters: { recipe: recipeId },
      populate: ['recipe']
    });

    if (inventories && inventories.length > 0) {
      // Update existing inventory
      await strapi.entityService.update('api::inventory.inventory', inventories[0].id, {
        data: {
          stock: totalStock,
          lastUpdated: new Date()
        }
      });
      console.log('Updated inventory record:', inventories[0].id);
    } else {
      // Create new inventory record
      const recipe = await strapi.entityService.findOne('api::recipe.recipe', recipeId);
      if (recipe) {
        await strapi.entityService.create('api::inventory.inventory', {
          data: {
            name: recipe.name,
            recipe: recipeId,
            stock: totalStock,
            lastUpdated: new Date()
          }
        });
        console.log('Created new inventory record for recipe:', recipeId);
      }
    }
  } catch (error) {
    console.error('Error updating inventory from lots:', error);
  }
}
