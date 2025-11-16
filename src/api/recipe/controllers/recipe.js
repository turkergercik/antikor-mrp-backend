/**
 * recipe controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::recipe.recipe', ({ strapi }) => ({
  // Calculate recipe cost based on ingredients
  async calculateCost(ctx) {
    try {
      const { id } = ctx.params;
      const recipe = await strapi.entityService.findOne('api::recipe.recipe', id, {
        populate: {
          ingredients: {
            populate: ['rawMaterial']
          }
        }
      });

      if (!recipe) {
        return ctx.notFound('Recipe not found');
      }

      let totalCost = 0;
      const ingredients = recipe.ingredients || [];
      const ingredientDetails = [];

      // Calculate cost for each ingredient
      for (const ingredient of ingredients) {
        // Support both component (rawMaterial relation) and JSON (rawMaterialId) formats
        let rawMaterial = null;
        let rawMaterialId = null;

        if (ingredient.rawMaterial) {
          // Component format - rawMaterial is populated or is an ID
          rawMaterialId = typeof ingredient.rawMaterial === 'object' 
            ? ingredient.rawMaterial.id 
            : ingredient.rawMaterial;
          
          if (typeof ingredient.rawMaterial === 'object') {
            rawMaterial = ingredient.rawMaterial;
          }
        } else if (ingredient.rawMaterialId) {
          // JSON format - need to fetch the raw material
          rawMaterialId = ingredient.rawMaterialId;
        }

        // Fetch raw material if not already loaded
        if (!rawMaterial && rawMaterialId) {
          rawMaterial = await strapi.entityService.findOne(
            'api::raw-material.raw-material',
            rawMaterialId
          );
        }

        if (rawMaterial && rawMaterial.pricePerUnit && ingredient.quantity) {
          const ingredientCost = ingredient.quantity * rawMaterial.pricePerUnit;
          totalCost += ingredientCost;
          
          ingredientDetails.push({
            name: rawMaterial.name,
            quantity: ingredient.quantity,
            unit: ingredient.unit,
            pricePerUnit: rawMaterial.pricePerUnit,
            cost: ingredientCost.toFixed(2),
          });
        }
      }

      // Calculate cost per unit
      const costPerUnit = totalCost / recipe.batchSize;
      const profitMargin = recipe.sellingPrice > 0 
        ? parseFloat(((recipe.sellingPrice - costPerUnit) / recipe.sellingPrice * 100).toFixed(2))
        : 0;

      // Update recipe - ONLY update cost-related fields, don't touch ingredients
      const updatedRecipe = await strapi.db.query('api::recipe.recipe').update({
        where: { id: id },
        data: {
          totalCost: parseFloat(totalCost.toFixed(2)),
          costPerUnit: parseFloat(costPerUnit.toFixed(2)),
          profitMargin: profitMargin,
        },
      });

      return {
        data: updatedRecipe,
        breakdown: {
          totalCost: totalCost.toFixed(2),
          costPerUnit: costPerUnit.toFixed(2),
          profitMargin,
          ingredients: ingredientDetails,
        },
      };
    } catch (err) {
      console.error('Calculate cost error:', err);
      ctx.throw(500, err);
    }
  },

  // Check if enough stock is available for recipe
  async checkStock(ctx) {
    try {
      const { id } = ctx.params;
      const { batchMultiplier = 1 } = ctx.query;

      const recipe = await strapi.entityService.findOne('api::recipe.recipe', id, {
        populate: {
          ingredients: {
            populate: ['rawMaterial']
          }
        }
      });

      if (!recipe) {
        return ctx.notFound('Recipe not found');
      }

      const stockStatus = [];
      let canProduce = true;

      for (const ingredient of recipe.ingredients || []) {
        // Support both component (rawMaterial relation) and JSON (rawMaterialId) formats
        let rawMaterial = null;
        let rawMaterialId = null;

        if (ingredient.rawMaterial) {
          rawMaterialId = typeof ingredient.rawMaterial === 'object' 
            ? ingredient.rawMaterial.id 
            : ingredient.rawMaterial;
          
          if (typeof ingredient.rawMaterial === 'object') {
            rawMaterial = ingredient.rawMaterial;
          }
        } else if (ingredient.rawMaterialId) {
          rawMaterialId = ingredient.rawMaterialId;
        }

        // Fetch raw material if not already loaded
        if (!rawMaterial && rawMaterialId) {
          rawMaterial = await strapi.entityService.findOne(
            'api::raw-material.raw-material',
            rawMaterialId
          );
        }

        if (rawMaterial && ingredient.quantity) {
          const requiredQuantity = ingredient.quantity * batchMultiplier;
          const isAvailable = rawMaterial.currentStock >= requiredQuantity;
          
          if (!isAvailable) {
            canProduce = false;
          }

          stockStatus.push({
            materialId: rawMaterial.id,
            materialName: rawMaterial.name,
            required: requiredQuantity,
            available: rawMaterial.currentStock,
            unit: rawMaterial.unit,
            isAvailable,
            shortage: isAvailable ? 0 : requiredQuantity - rawMaterial.currentStock,
          });
        }
      }

      return {
        canProduce,
        batchMultiplier,
        stockStatus,
      };
    } catch (err) {
      console.error('Check stock error:', err);
      ctx.throw(500, err);
    }
  },
}));
