module.exports = (plugin) => {
  const originalUpdate = plugin.controllers['collection-types'].update;
  const originalFindOne = plugin.controllers['collection-types'].findOne;

  // Override findOne - currently just passes through
  plugin.controllers['collection-types'].findOne = async (ctx) => {
    return originalFindOne(ctx);
  };

  plugin.controllers['collection-types'].update = async (ctx) => {
    const uid = ctx?.params?.model;
    
    // Only intercept batch updates
    if (uid !== 'api::batch.batch') {
      return originalUpdate(ctx);
    }
    
    try {
      const bodyData = ctx.request.body || {};
      
      // Define all valid enum values
      const enumValidations = {
        batchStatus: {
          valid: ['planned', 'in_progress', 'completed', 'quality_check', 'approved', 'rejected', 'shipped'],
          default: null // If null, remove from update to keep existing value
        },
        shipmentStatus: {
          valid: ['yolda', 'dagitimda', 'teslim_edildi', 'bulunamadi'],
          default: null // optional field, remove if null
        },
        unit: {
          valid: ['liter', 'kg', 'piece'],
          default: null // If null, remove from update to keep existing value
        },
        qualityCheckResult: {
          valid: ['pending', 'passed', 'failed'],
          default: null // If null, remove from update to keep existing value
        }
      };
      
      // Fix enum fields: if null or empty string, remove from update
      for (const [field, config] of Object.entries(enumValidations)) {
        if (field in bodyData) {
          const value = bodyData[field];
          
          // If value is null or empty string, remove it (keep existing DB value)
          if (value === null || value === '') {
            delete bodyData[field];
          }
          // If value is invalid, remove it or set default
          else if (!config.valid.includes(value)) {
            delete bodyData[field];
          }
        }
      }
      
      // Also check ingredientsUsed component for unit enum
      if (bodyData.ingredientsUsed && Array.isArray(bodyData.ingredientsUsed)) {
        const validIngredientUnits = ['liter', 'kg', 'gram', 'ml', 'piece'];
        bodyData.ingredientsUsed = bodyData.ingredientsUsed.map((ingredient, index) => {
          if (ingredient.unit !== undefined) {
            if (ingredient.unit === null || ingredient.unit === '' || !validIngredientUnits.includes(ingredient.unit)) {
              delete ingredient.unit;
            }
          }
          return ingredient;
        });
      }
      
      // Update the request body with cleaned data
      ctx.request.body = bodyData;
      
      // Call original update with cleaned data
      return originalUpdate(ctx);
      
    } catch (error) {
      strapi.log.error('[content-manager override] Batch update error:', error.message);
      
      ctx.status = 400;
      return ctx.send({
        error: {
          status: 400,
          name: error.name || 'ValidationError', 
          message: error.message || 'Update failed',
          details: error.details || {}
        }
      });
    }
  };

  return plugin;
};
