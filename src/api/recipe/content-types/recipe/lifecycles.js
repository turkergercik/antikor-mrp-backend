const axios = require('axios');
const { parseString } = require('xml2js');
const { promisify } = require('util');

const parseXML = promisify(parseString);

// Helper function to fetch exchange rates
async function fetchExchangeRates() {
  try {
    const response = await axios.get('https://www.tcmb.gov.tr/kurlar/today.xml', {
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    });

    const result = await parseXML(response.data);
    
    const rates = {
      TRY: 1,
      USD: null,
      EUR: null,
      GBP: null
    };

    if (result && result.Tarih_Date && result.Tarih_Date.Currency) {
      result.Tarih_Date.Currency.forEach(currency => {
        const code = currency.$.CurrencyCode;
        const forexSelling = currency.ForexSelling?.[0];
        
        if (code && forexSelling) {
          const rate = parseFloat(forexSelling);
          if (!isNaN(rate)) {
            rates[code] = rate;
          }
        }
      });
    }

    return rates;
  } catch (error) {
    strapi.log.error('Error fetching exchange rates in recipe lifecycle:', error);
    return null;
  }
}

// Helper function to convert price to USD
function convertToUSD(price, currency, exchangeRates) {
  if (!exchangeRates) return 0;
  
  if (currency === 'USD') {
    return price;
  } else if (currency === 'TRY') {
    return price / exchangeRates.USD;
  } else if (currency === 'EUR') {
    return (price * exchangeRates.EUR) / exchangeRates.USD;
  } else if (currency === 'GBP') {
    return (price * exchangeRates.GBP) / exchangeRates.USD;
  }
  
  // Default to TRY if currency not specified
  return price / exchangeRates.USD;
}

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

  async afterCreate(event) {
    // Recalculate cost after recipe is created (when ingredients are fully saved)
    try {
      const { result } = event;
      if (result && result.id) {
        console.log('afterCreate: Recipe created with ID:', result.id);
        
        // Wait a bit for ingredients to be saved
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Fetch the full recipe with ingredients
        const recipe = await strapi.entityService.findOne('api::recipe.recipe', result.id, {
          populate: { ingredients: { populate: ['rawMaterial'] } }
        });
        
        console.log('afterCreate: Fetched recipe:', recipe?.name, 'Ingredients count:', recipe?.ingredients?.length);
        
        if (recipe && recipe.ingredients && recipe.ingredients.length > 0) {
          const data = {
            ingredients: recipe.ingredients,
            batchSize: recipe.batchSize || 1,
            profitMargin: recipe.profitMargin || 0
          };
          
          await calculateAndSetRecipeCost(data);
          
          console.log('afterCreate: Calculated costs - totalCost:', data.totalCost, 'costPerUnit:', data.costPerUnit, 'sellingPrice:', data.sellingPrice);
          
          // Update the recipe with calculated costs
          await strapi.db.query('api::recipe.recipe').update({
            where: { id: result.id },
            data: {
              totalCost: data.totalCost,
              costPerUnit: data.costPerUnit,
              manufacturingCost: data.costPerUnit, // Same as costPerUnit - calculated from materials
              sellingPrice: data.sellingPrice,
            },
          });
          
          console.log('afterCreate: Recipe costs updated successfully');
        } else {
          console.log('afterCreate: No ingredients found for recipe', result.id);
        }
      }
    } catch (error) {
      console.error('Error calculating recipe cost after creation:', error);
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
        const profitMargin = data.profitMargin !== undefined ? data.profitMargin : existingRecipe?.profitMargin || 0;
        await calculateAndSetRecipeCost({ ...data, batchSize, profitMargin });
      } catch (error) {
        console.error('Error calculating recipe cost before update:', error);
      }
    }
  },
};

async function calculateAndSetRecipeCost(data) {
  try {
    console.log('=== calculateAndSetRecipeCost START ===');
    console.log('Data ingredients count:', data.ingredients?.length);
    
    if (!data.ingredients || data.ingredients.length === 0) {
      console.log('No ingredients found, skipping calculation');
      return;
    }

    // Fetch exchange rates
    const exchangeRates = await fetchExchangeRates();
    
    if (!exchangeRates || !exchangeRates.USD) {
      console.error('Failed to fetch exchange rates in lifecycle, skipping cost calculation');
      return;
    }

    console.log('Exchange rates fetched:', exchangeRates);

    let totalCost = 0;

    // Fetch raw materials and calculate cost for each ingredient in USD
    for (const ingredient of data.ingredients) {
      console.log('Processing ingredient:', ingredient);
      
      if (!ingredient.quantity || ingredient.quantity <= 0) {
        console.log('  - Skipping ingredient with no quantity');
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

        console.log('  - Raw material ID:', rawMaterialId);

        if (!rawMaterialId) {
          console.log('  - Skipping ingredient without raw material ID');
          continue;
        }

        const rawMaterial = await strapi.entityService.findOne(
          'api::raw-material.raw-material',
          rawMaterialId
        );

        if (rawMaterial && rawMaterial.pricePerUnit) {
          // Convert price to USD based on material currency
          const materialCurrency = rawMaterial.currency || 'TRY';
          const priceInUSD = convertToUSD(rawMaterial.pricePerUnit, materialCurrency, exchangeRates);
          const ingredientCost = ingredient.quantity * priceInUSD;
          totalCost += ingredientCost;
          console.log(`  - ${rawMaterial.name}: ${ingredient.quantity} ${ingredient.unit} x ${rawMaterial.pricePerUnit} ${materialCurrency} (${priceInUSD.toFixed(4)} USD) = $${ingredientCost.toFixed(2)}`);
        } else {
          console.log(`  - Raw material ${rawMaterialId} not found or has no price`);
        }
      } catch (error) {
        console.error(`Error fetching raw material:`, error.message);
      }
    }

    // Calculate cost per unit based on batch size (in USD)
    const batchSize = data.batchSize || 1;
    const costPerUnit = totalCost / batchSize;

    // Calculate selling price if profit margin is provided
    const profitMargin = data.profitMargin || 0;
    const sellingPrice = profitMargin > 0 
      ? totalCost * (1 + profitMargin / 100) 
      : totalCost;

    // Set the calculated costs in the data (in USD)
    data.totalCost = parseFloat(totalCost.toFixed(2));
    data.costPerUnit = parseFloat(costPerUnit.toFixed(2));
    data.manufacturingCost = parseFloat(costPerUnit.toFixed(2)); // Same as costPerUnit
    data.sellingPrice = parseFloat(sellingPrice.toFixed(2));

    console.log(`Recipe cost calculated: totalCost=$${data.totalCost} (${batchSize} units), costPerUnit=$${data.costPerUnit}, manufacturingCost=$${data.manufacturingCost}, sellingPrice=$${data.sellingPrice} (margin: ${profitMargin}%)`);
  } catch (error) {
    console.error('Error in calculateAndSetRecipeCost:', error);
  }
}
