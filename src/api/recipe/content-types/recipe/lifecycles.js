module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;
    
    // Calculate cost before recipe is created
    if (data.ingredients && data.ingredients.length > 0) {
      try {
        await calculateAndSetRecipeCost(data);
      } catch (error) {
        console.error('Error calculating recipe cost before creation:', error);
      }
    }
  },

  async beforeUpdate(event) {
    const { data } = event.params;
    
    // Calculate cost if ingredients changed
    if (data.ingredients !== undefined && data.ingredients && data.ingredients.length > 0) {
      try {
        // Get existing recipe to get batchSize if not provided in update
        const recipeId = event.params.where.id || event.params.where.documentId;
        const existingRecipe = await strapi.entityService.findOne('api::recipe.recipe', recipeId);
        
        const batchSize = data.batchSize !== undefined ? data.batchSize : existingRecipe?.batchSize || 1;
        await calculateAndSetRecipeCost({ ...data, batchSize });
      } catch (error) {
        console.error('Error calculating recipe cost before update:', error);
      }
    }
  },
};

async function calculateAndSetRecipeCost(data) {
  try {
    if (!data.ingredients || data.ingredients.length === 0) {
      return;
    }

    let totalCost = 0;

    // Fetch raw materials and calculate cost for each ingredient
    // Support both old JSON format and new component format
    for (const ingredient of data.ingredients) {
      if (!ingredient.quantity || ingredient.quantity <= 0) {
        continue;
      }

      try {
        // Get raw material ID - support both formats:
        // New format: { rawMaterial: id, quantity, unit }
        // Old format: { rawMaterialId: id, quantity, unit }
        let rawMaterialId = null;
        
        if (ingredient.rawMaterial) {
          rawMaterialId = typeof ingredient.rawMaterial === 'object' 
            ? ingredient.rawMaterial.id 
            : ingredient.rawMaterial;
        } else if (ingredient.rawMaterialId) {
          rawMaterialId = ingredient.rawMaterialId;
        }

        if (!rawMaterialId) {
          console.log('  - Skipping ingredient without raw material ID');
          continue;
        }

        const rawMaterial = await strapi.entityService.findOne(
          'api::raw-material.raw-material',
          rawMaterialId
        );

        if (rawMaterial && rawMaterial.pricePerUnit) {
          const ingredientCost = ingredient.quantity * rawMaterial.pricePerUnit;
          totalCost += ingredientCost;
          console.log(`  - ${rawMaterial.name}: ${ingredient.quantity} ${ingredient.unit} x ₺${rawMaterial.pricePerUnit} = ₺${ingredientCost.toFixed(2)}`);
        } else {
          console.log(`  - Raw material ${rawMaterialId} not found or has no price`);
        }
      } catch (error) {
        console.error(`Error fetching raw material:`, error.message);
      }
    }

    // Calculate cost per unit based on batch size
    const batchSize = data.batchSize || 1;
    const costPerUnit = totalCost / batchSize;

    // Set the calculated costs in the data
    data.totalCost = parseFloat(totalCost.toFixed(2));
    data.costPerUnit = parseFloat(costPerUnit.toFixed(2));

    console.log(`Recipe cost calculated: totalCost=₺${data.totalCost} (${batchSize} units), costPerUnit=₺${data.costPerUnit}`);
  } catch (error) {
    console.error('Error in calculateAndSetRecipeCost:', error);
  }
}
