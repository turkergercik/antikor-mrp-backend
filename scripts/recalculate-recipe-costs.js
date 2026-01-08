const strapi = require('@strapi/strapi');
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
    console.error('Error fetching exchange rates:', error);
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

async function recalculateRecipeCosts() {
  const appContext = await strapi.compile();
  const app = await strapi(appContext).load();

  try {
    console.log('Starting recipe cost recalculation...\n');

    // Fetch exchange rates
    const exchangeRates = await fetchExchangeRates();
    
    if (!exchangeRates || !exchangeRates.USD) {
      console.error('Failed to fetch exchange rates. Exiting.');
      process.exit(1);
    }

    console.log('Exchange rates:', exchangeRates);
    console.log('');

    // Fetch all recipes with ingredients
    const recipes = await strapi.entityService.findMany('api::recipe.recipe', {
      populate: { ingredients: { populate: ['rawMaterial'] } }
    });

    console.log(`Found ${recipes.length} recipes to process\n`);

    let updated = 0;
    let failed = 0;

    for (const recipe of recipes) {
      try {
        console.log(`Processing recipe: ${recipe.name} (ID: ${recipe.id})`);

        if (!recipe.ingredients || recipe.ingredients.length === 0) {
          console.log('  - No ingredients, skipping\n');
          continue;
        }

        let totalCost = 0;

        for (const ingredient of recipe.ingredients) {
          if (!ingredient.quantity || ingredient.quantity <= 0) {
            continue;
          }

          let rawMaterialId = null;
          
          if (ingredient.rawMaterial) {
            rawMaterialId = typeof ingredient.rawMaterial === 'object' 
              ? ingredient.rawMaterial.id 
              : ingredient.rawMaterial;
          }

          if (!rawMaterialId) {
            console.log(`  - Ingredient has no raw material, skipping`);
            continue;
          }

          const rawMaterial = await strapi.entityService.findOne(
            'api::raw-material.raw-material',
            rawMaterialId
          );

          if (rawMaterial && rawMaterial.pricePerUnit) {
            const materialCurrency = rawMaterial.currency || 'TRY';
            const priceInUSD = convertToUSD(rawMaterial.pricePerUnit, materialCurrency, exchangeRates);
            const ingredientCost = ingredient.quantity * priceInUSD;
            totalCost += ingredientCost;
            console.log(`  - ${rawMaterial.name}: ${ingredient.quantity} ${ingredient.unit} x $${priceInUSD.toFixed(4)} = $${ingredientCost.toFixed(2)}`);
          } else {
            console.log(`  - Raw material ${rawMaterialId} not found or has no price`);
          }
        }

        // Calculate cost per unit based on batch size
        const batchSize = recipe.batchSize || 1;
        const costPerUnit = totalCost / batchSize;

        // Calculate selling price if profit margin exists
        const profitMargin = recipe.profitMargin || 0;
        const sellingPrice = profitMargin > 0 
          ? totalCost * (1 + profitMargin / 100) 
          : totalCost;

        // Update the recipe with calculated costs
        await strapi.db.query('api::recipe.recipe').update({
          where: { id: recipe.id },
          data: {
            totalCost: parseFloat(totalCost.toFixed(2)),
            costPerUnit: parseFloat(costPerUnit.toFixed(2)),
            sellingPrice: parseFloat(sellingPrice.toFixed(2)),
          },
        });

        console.log(`  ✓ Updated: totalCost=$${totalCost.toFixed(2)}, costPerUnit=$${costPerUnit.toFixed(2)}, sellingPrice=$${sellingPrice.toFixed(2)}\n`);
        updated++;

      } catch (error) {
        console.error(`  ✗ Error processing recipe ${recipe.name}:`, error.message, '\n');
        failed++;
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Total recipes: ${recipes.length}`);
    console.log(`Updated: ${updated}`);
    console.log(`Failed: ${failed}`);

  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    await app.destroy();
    process.exit(0);
  }
}

recalculateRecipeCosts();
