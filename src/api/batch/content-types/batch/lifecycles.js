module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;
    
    console.log('=== Batch beforeCreate lifecycle triggered ===');
    console.log('Data received:', JSON.stringify(data, null, 2));
    
    // Don't recalculate cost - frontend already sends the correct cost based on lot pricing
    // The lifecycle hook was overwriting the frontend's lot-based calculation with current material prices
    console.log('Batch totalCost from frontend (lot-based):', data.totalCost);
  },

  async beforeUpdate(event) {
    const { data } = event.params;
    
    console.log('=== Batch beforeUpdate lifecycle triggered ===');
    console.log('Update data:', JSON.stringify(data, null, 2));
    
    // Define all valid enum values
    const enumValidations = {
      batchStatus: {
        valid: ['planned', 'in_progress', 'completed', 'quality_check', 'approved', 'rejected', 'shipped'],
        default: 'planned'
      },
      shipmentStatus: {
        valid: ['yolda', 'dagitimda', 'teslim_edildi', 'bulunamadi'],
        default: null // optional - will be deleted if invalid
      },
      unit: {
        valid: ['liter', 'kg', 'piece'],
        default: 'liter'
      },
      qualityCheckResult: {
        valid: ['pending', 'passed', 'failed'],
        default: 'pending'
      }
    };
    
    // Validate and fix all enum fields
    for (const [field, config] of Object.entries(enumValidations)) {
      if (data[field] !== undefined) {
        console.log(`Checking ${field}:`, data[field], 'type:', typeof data[field]);
        
        if (data[field] === null || data[field] === '' || !config.valid.includes(data[field])) {
          if (config.default === null) {
            console.log(`Removing invalid ${field}: "${data[field]}"`);
            delete data[field];
          } else {
            console.log(`Fixing invalid ${field}: "${data[field]}" to "${config.default}"`);
            data[field] = config.default;
          }
        }
      }
    }
    
    // Don't recalculate cost - the cost was already calculated correctly during batch creation
    // Recalculating would use current material prices instead of the lot prices that were actually used
  },

  async afterUpdate(event) {
    const { result, params } = event;
    
    console.log('=== Batch afterUpdate lifecycle triggered ===');
    console.log('Result status:', result.batchStatus);
    console.log('Previous data:', params.data);
    
    // Lot creation moved to batch controller's complete() method
    // to avoid database transaction conflicts
  },
};

async function calculateBatchCost(data) {
  try {
    console.log('--- calculateBatchCost called ---');
    console.log('Recipe:', data.recipe, 'Quantity:', data.quantity);
    
    if (!data.recipe || !data.quantity) {
      console.log('Missing recipe or quantity, skipping calculation');
      return;
    }

    // Handle different recipe formats
    let recipeId;
    if (typeof data.recipe === 'object') {
      if (data.recipe.set && Array.isArray(data.recipe.set) && data.recipe.set.length > 0) {
        // Strapi v5 relation format: { set: [{ id: 6 }] }
        recipeId = data.recipe.set[0].id;
      } else if (data.recipe.id) {
        // Direct object: { id: 6 }
        recipeId = data.recipe.id;
      }
    } else {
      // Simple ID: 6
      recipeId = data.recipe;
    }
    
    console.log('Recipe ID:', recipeId);
    
    if (!recipeId) {
      console.error('Could not extract recipe ID from:', data.recipe);
      return;
    }
    
    const recipe = await strapi.entityService.findOne('api::recipe.recipe', recipeId, {
      populate: {
        ingredients: {
          populate: ['rawMaterial']
        }
      }
    });

    if (!recipe) {
      console.error('Recipe not found for batch cost calculation');
      return;
    }

    console.log('Recipe found:', recipe.name);
    console.log('Recipe costPerUnit:', recipe.costPerUnit);
    console.log('Recipe totalCost:', recipe.totalCost);
    console.log('Recipe batchSize:', recipe.batchSize);

    // Use recipe's costPerUnit if available
    let costPerUnit = 0;
    
    if (recipe.costPerUnit && recipe.costPerUnit > 0) {
      costPerUnit = parseFloat(recipe.costPerUnit);
      console.log('Using recipe costPerUnit:', costPerUnit);
    } else if (recipe.totalCost && recipe.totalCost > 0 && recipe.batchSize && recipe.batchSize > 0) {
      costPerUnit = parseFloat(recipe.totalCost) / parseFloat(recipe.batchSize);
      console.log('Calculated costPerUnit from totalCost/batchSize:', costPerUnit);
    }
    // Note: Ingredient cost calculation removed - prices now managed in stock history

    const totalCost = costPerUnit * parseFloat(data.quantity);
    
    // Set the calculated total cost in the data
    data.totalCost = parseFloat(totalCost.toFixed(2));
    
    console.log(`✓ Batch cost calculated: costPerUnit=₺${costPerUnit.toFixed(2)}, quantity=${data.quantity}, totalCost=₺${data.totalCost}`);
  } catch (error) {
    console.error('Error in calculateBatchCost:', error);
  }
}
