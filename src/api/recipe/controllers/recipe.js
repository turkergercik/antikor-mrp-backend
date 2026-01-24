/**
 * recipe controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
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
    strapi.log.error('Error fetching exchange rates in recipe controller:', error);
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

module.exports = createCoreController('api::recipe.recipe', ({ strapi }) => ({
  // Calculate recipe cost based on ingredients (in USD)
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

      // Fetch exchange rates
      const exchangeRates = await fetchExchangeRates();
      
      if (!exchangeRates || !exchangeRates.USD) {
        strapi.log.error('Failed to fetch exchange rates');
        return ctx.badRequest('Unable to fetch exchange rates');
      }

      let totalCost = 0;
      const ingredients = recipe.ingredients || [];
      const ingredientDetails = [];

      // Calculate cost for each ingredient in USD
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
          // Convert price to USD based on material currency
          const materialCurrency = rawMaterial.currency || 'TRY';
          const priceInUSD = convertToUSD(rawMaterial.pricePerUnit, materialCurrency, exchangeRates);
          const ingredientCost = ingredient.quantity * priceInUSD;
          totalCost += ingredientCost;
          
          ingredientDetails.push({
            name: rawMaterial.name,
            quantity: ingredient.quantity,
            unit: ingredient.unit,
            pricePerUnit: rawMaterial.pricePerUnit,
            currency: materialCurrency,
            priceInUSD: priceInUSD.toFixed(4),
            cost: ingredientCost.toFixed(2),
          });
        }
      }

      // Calculate cost per unit (in USD)
      const costPerUnit = totalCost / recipe.batchSize;
      const profitMargin = recipe.sellingPrice > 0 
        ? parseFloat(((recipe.sellingPrice - costPerUnit) / recipe.sellingPrice * 100).toFixed(2))
        : 0;

      // Update recipe - ONLY update cost-related fields, don't touch ingredients (all in USD)
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
          exchangeRates,
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

      // In Strapi v5, id in the URL is the documentId
      const recipe = await strapi.db.query('api::recipe.recipe').findOne({
        where: { documentId: id },
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
        let rawMaterialDocumentId = null;

        if (ingredient.rawMaterial) {
          // In Strapi v5, relation can be documentId string or object
          rawMaterialDocumentId = typeof ingredient.rawMaterial === 'object' 
            ? ingredient.rawMaterial.documentId 
            : ingredient.rawMaterial;
          
          if (typeof ingredient.rawMaterial === 'object') {
            rawMaterial = ingredient.rawMaterial;
          }
        } else if (ingredient.rawMaterialId) {
          rawMaterialDocumentId = ingredient.rawMaterialId;
        }

        // Fetch raw material if not already loaded
        if (!rawMaterial && rawMaterialDocumentId) {
          rawMaterial = await strapi.db.query('api::raw-material.raw-material').findOne({
            where: { documentId: rawMaterialDocumentId }
          });
        }

        if (rawMaterial && ingredient.quantity) {
          const requiredQuantity = ingredient.quantity * batchMultiplier;
          
          // Calculate current stock from stock-history using currentBalance from DB
          let currentStock = 0;
          try {
            const stockHistory = await strapi.entityService.findMany('api::stock-history.stock-history', {
              filters: {
                sku: rawMaterial.sku || rawMaterial.name
              },
              sort: { createdAt: 'desc' }
            });

            strapi.log.info(`[CHECK-STOCK] ${rawMaterial.sku} Total transactions: ${stockHistory.length}`);
            strapi.log.info(`[CHECK-STOCK] ${rawMaterial.sku} ALL TRANSACTIONS FROM DB:`);
            stockHistory.forEach((record, index) => {
              strapi.log.info(`  [${index}] Lot ${record.lotNumber}: ${record.transactionType} qty=${record.quantity} currentBalance=${record.currentBalance} date=${record.createdAt}`);
            });

            // Group by lot and use latest currentBalance per lot (sorted desc, so first is latest)
            const lotBalances = {};
            stockHistory.forEach(record => {
              if (!(record.lotNumber in lotBalances)) {
                lotBalances[record.lotNumber] = parseFloat(record.currentBalance || 0);
                strapi.log.info(`[CHECK-STOCK] ${rawMaterial.sku} Lot ${record.lotNumber}: ✓ Using latest currentBalance=${record.currentBalance} from ${record.transactionType}`);
              }
            });
            
            strapi.log.info(`[CHECK-STOCK] ${rawMaterial.sku} Final lot balances:`, lotBalances);
            
            // Sum all lot balances
            currentStock = Object.values(lotBalances).reduce((sum, balance) => sum + balance, 0);
            strapi.log.info(`[CHECK-STOCK] ${rawMaterial.sku} *** TOTAL STOCK: ${currentStock} ***`);
          } catch (error) {
            strapi.log.error('Error fetching stock history:', error);
            // If stock-history doesn't exist yet, use old currentStock field as fallback
            currentStock = rawMaterial.currentStock || 0;
          }
          
          const isAvailable = currentStock >= requiredQuantity;
          
          if (!isAvailable) {
            canProduce = false;
          }

          stockStatus.push({
            materialId: rawMaterial.id,
            materialName: rawMaterial.name,
            required: requiredQuantity,
            available: currentStock,
            unit: rawMaterial.unit,
            isAvailable,
            shortage: isAvailable ? 0 : requiredQuantity - currentStock,
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
