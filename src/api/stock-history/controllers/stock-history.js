/**
 * stock-history controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::stock-history.stock-history', ({ strapi }) => ({
  async create(ctx) {
    const { data } = ctx.request.body;
    
    // Security: Calculate pricePerUnit on backend from totalCost and quantity
    if (data.totalCost && data.quantity && parseFloat(data.quantity) > 0) {
      const calculatedPricePerUnit = parseFloat(data.totalCost) / parseFloat(data.quantity);
      data.pricePerUnit = calculatedPricePerUnit;
      strapi.log.info(`Calculated pricePerUnit: ${calculatedPricePerUnit} from totalCost: ${data.totalCost} and quantity: ${data.quantity}`);
    } else if (data.pricePerUnit && data.quantity) {
      // If pricePerUnit is provided, recalculate totalCost to ensure consistency
      data.totalCost = parseFloat(data.pricePerUnit) * parseFloat(data.quantity);
    }
    
    // Call the default create method with modified data
    ctx.request.body.data = data;
    return await super.create(ctx);
  },

  async find(ctx) {
    // Add default population
    if (!ctx.query.populate) {
      ctx.query.populate = {
        rawMaterial: true
      };
    }
    
    const result = await super.find(ctx);
    
    // Calculate running balances for each item
    if (result.data && result.data.length > 0) {
      // Get unique SKU+lot combinations from the result
      const combinations = [...new Set(result.data.map(item => `${item.sku}_${item.lotNumber}`))];
      
      // For each combination, fetch all history and calculate running balances
      for (let combo of combinations) {
        const [sku, lotNumber] = combo.split('_');
        
        // Fetch all transactions for this SKU+lot
        const allTransactions = await strapi.entityService.findMany('api::stock-history.stock-history', {
          filters: {
            sku: sku,
            lotNumber: lotNumber
          },
          sort: { createdAt: 'asc', id: 'asc' }
        });
        
        // Calculate running balance
        let runningBalance = 0;
        const balanceMap = {};
        
        allTransactions.forEach(transaction => {
          const quantity = parseFloat(transaction.quantity || 0);
          if (transaction.transactionType === 'purchase' || transaction.transactionType === 'production' || transaction.transactionType === 'return') {
            runningBalance += quantity;
          } else {
            runningBalance -= quantity;
          }
          balanceMap[transaction.id] = runningBalance;
        });
        
        // Apply calculated balances to result items
        result.data.forEach(item => {
          if (item.sku === sku && item.lotNumber === lotNumber) {
            item.currentBalance = balanceMap[item.id] || 0;
          }
        });
      }
    }
    
    return result;
  },

  async getBySKU(ctx) {
    const { sku } = ctx.params;

    try {
      const history = await strapi.entityService.findMany('api::stock-history.stock-history', {
        filters: {
          sku: sku
        },
        populate: {
          rawMaterial: true
        },
        sort: { createdAt: 'desc' }
      });

      // Calculate current stock from history
      const currentStock = history.reduce((total, record) => {
        if (record.transactionType === 'purchase' || record.transactionType === 'production' || record.transactionType === 'return') {
          return total + parseFloat(record.quantity || 0);
        } else {
          return total - parseFloat(record.quantity || 0);
        }
      }, 0);

      ctx.body = {
        data: history || [],
        meta: {
          currentStock,
          totalTransactions: history.length
        }
      };
    } catch (error) {
      strapi.log.error('Get stock history by SKU error:', error);
      return ctx.badRequest(error.message);
    }
  },

  async getByLot(ctx) {
    const { lotNumber } = ctx.params;

    try {
      const history = await strapi.entityService.findMany('api::stock-history.stock-history', {
        filters: {
          lotNumber: lotNumber
        },
        populate: {
          rawMaterial: true
        },
        sort: { createdAt: 'desc' }
      });

      const currentStock = history.reduce((total, record) => {
        if (record.transactionType === 'purchase' || record.transactionType === 'production' || record.transactionType === 'return') {
          return total + parseFloat(record.quantity || 0);
        } else {
          return total - parseFloat(record.quantity || 0);
        }
      }, 0);

      ctx.body = {
        data: history || [],
        meta: {
          currentStock,
          totalTransactions: history.length
        }
      };
    } catch (error) {
      strapi.log.error('Get stock history by lot error:', error);
      return ctx.badRequest(error.message);
    }
  },

  async getSummaryBySKU(ctx) {
    try {
      const allHistory = await strapi.entityService.findMany('api::stock-history.stock-history', {
        populate: {
          rawMaterial: true
        }
      });

      // Group by SKU and calculate totals
      const summary = {};
      
      allHistory.forEach(record => {
        if (!summary[record.sku]) {
          summary[record.sku] = {
            sku: record.sku,
            rawMaterial: record.rawMaterial,
            lotDetails: {},
            totalStock: 0,
            currentBalance: 0,
            transactions: []
          };
        }

        // Track lot-level details
        if (!summary[record.sku].lotDetails[record.lotNumber]) {
          summary[record.sku].lotDetails[record.lotNumber] = {
            lotNumber: record.lotNumber,
            totalStock: 0,
            currentBalance: 0,
            transactionCount: 0,
            pricePerUnit: 0,
            totalCost: 0,
            currency: record.currency || 'TRY',
            purchaseDate: record.purchaseDate
          };
        }
        
        const quantity = parseFloat(record.quantity || 0);
        
        if (record.transactionType === 'purchase' || record.transactionType === 'production' || record.transactionType === 'return') {
          summary[record.sku].totalStock += quantity;
          summary[record.sku].currentBalance += quantity;
          summary[record.sku].lotDetails[record.lotNumber].totalStock += quantity;
          summary[record.sku].lotDetails[record.lotNumber].currentBalance += quantity;
          
          // Update price info from purchase/production records
          if (record.pricePerUnit) {
            summary[record.sku].lotDetails[record.lotNumber].pricePerUnit = parseFloat(record.pricePerUnit);
            summary[record.sku].lotDetails[record.lotNumber].currency = record.currency || 'TRY';
          }
          if (record.totalCost) {
            summary[record.sku].lotDetails[record.lotNumber].totalCost += parseFloat(record.totalCost || 0);
          }
        } else {
          summary[record.sku].currentBalance -= quantity;
          summary[record.sku].lotDetails[record.lotNumber].currentBalance -= quantity;
        }
        
        summary[record.sku].lotDetails[record.lotNumber].transactionCount += 1;
        summary[record.sku].transactions.push(record);
      });

      // Convert to array and format
      const result = Object.values(summary).map(item => ({
        sku: item.sku,
        rawMaterial: item.rawMaterial,
        lotCount: Object.keys(item.lotDetails).length,
        lots: Object.values(item.lotDetails),
        totalStock: item.totalStock,
        currentBalance: item.currentBalance,
        transactionCount: item.transactions.length,
        lastTransaction: item.transactions[0]?.createdAt
      }));

      ctx.body = { data: result };
    } catch (error) {
      strapi.log.error('Get stock summary error:', error);
      return ctx.badRequest(error.message);
    }
  }
}));
