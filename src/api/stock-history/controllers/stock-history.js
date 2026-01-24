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
    
    // Handle filters from query params
    const filters = ctx.query.filters || {};
    
    // Build query with filters
    const query = {
      populate: ctx.query.populate,
      sort: ctx.query.sort || { createdAt: 'desc' },
      pagination: {
        page: ctx.query.pagination?.page || 1,
        pageSize: ctx.query.pagination?.pageSize || 25
      }
    };
    
    // Apply filters if provided
    if (Object.keys(filters).length > 0) {
      query.filters = filters;
    }
    
    const result = await strapi.entityService.findMany('api::stock-history.stock-history', query);
    const total = await strapi.db.query('api::stock-history.stock-history').count({ where: query.filters });
    
    // Format response
    return {
      data: result,
      meta: {
        pagination: {
          page: query.pagination.page,
          pageSize: query.pagination.pageSize,
          pageCount: Math.ceil(total / query.pagination.pageSize),
          total: total
        }
      }
    };
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

      strapi.log.info(`[STOCK-HISTORY-GETBYSKU] ${sku} Total transactions: ${history.length}`);
      strapi.log.info(`[STOCK-HISTORY-GETBYSKU] ${sku} ALL TRANSACTIONS:`);
      history.forEach((record, index) => {
        strapi.log.info(`  [${index}] Lot ${record.lotNumber}: ${record.transactionType} qty=${record.quantity} currentBalance=${record.currentBalance}`);
      });

      // Calculate current stock from history
      const currentStock = history.reduce((total, record) => {
        if (record.transactionType === 'purchase' || record.transactionType === 'production' || record.transactionType === 'return') {
          return total + parseFloat(record.quantity || 0);
        } else if (record.transactionType === 'usage' || record.transactionType === 'waste' || record.transactionType === 'imha') {
          return total - parseFloat(record.quantity || 0);
        }
        // 'adjustment' doesn't affect stock total
        return total;
      }, 0);
      
      strapi.log.info(`[STOCK-HISTORY-GETBYSKU] ${sku} *** CALCULATED STOCK: ${currentStock} ***`);

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
        },
        sort: { createdAt: 'desc' }
      });

      strapi.log.info(`[STOCK-SUMMARY] Total transactions across all SKUs: ${allHistory.length}`);

      // Group by SKU and lot
      const lotTransactions = {};
      
      allHistory.forEach(record => {
        const key = `${record.sku}-${record.lotNumber}`;
        if (!lotTransactions[key]) {
          lotTransactions[key] = [];
        }
        lotTransactions[key].push(record);
      });

      // Build summary with totalStock (purchases) and currentBalance
      const summary = {};
      
      Object.entries(lotTransactions).forEach(([key, transactions]) => {
        const latestTransaction = transactions[0]; // Already sorted by createdAt desc
        const sku = latestTransaction.sku;
        
        if (!summary[sku]) {
          summary[sku] = {
            sku: sku,
            rawMaterial: latestTransaction.rawMaterial,
            lotDetails: {},
            totalStock: 0,
            currentBalance: 0,
            transactions: []
          };
        }

        // Calculate totalStock (sum of all purchases/production for this lot)
        const totalStock = transactions
          .filter(t => ['purchase', 'production', 'return'].includes(t.transactionType))
          .reduce((sum, t) => sum + parseFloat(t.quantity || 0), 0);
        
        // Calculate currentBalance for THIS LOT ONLY by processing all its transactions
        const lotCurrentBalance = transactions.reduce((balance, t) => {
          if (['purchase', 'production', 'return'].includes(t.transactionType)) {
            return balance + parseFloat(t.quantity || 0);
          } else if (['usage', 'sale', 'waste', 'imha'].includes(t.transactionType)) {
            return balance - parseFloat(t.quantity || 0);
          } else if (t.transactionType === 'adjustment') {
            // Adjustment can be positive or negative
            return balance - parseFloat(t.quantity || 0);
          }
          return balance;
        }, 0);
        
        strapi.log.info(`[STOCK-SUMMARY] ${sku} Lot ${latestTransaction.lotNumber}: totalStock=${totalStock} lotCurrentBalance=${lotCurrentBalance} (calculated from ${transactions.length} transactions)`);
        
        // Log detailed transactions for ready products (pieces)
        if (latestTransaction.unit === 'piece') {
          strapi.log.info(`  [DETAIL] ${sku} Lot ${latestTransaction.lotNumber} transactions:`);
          transactions.forEach((t, idx) => {
            strapi.log.info(`    [${idx}] ${t.transactionType}: ${t.quantity} ${t.unit} at ${t.createdAt}`);
          });
        }
        
        summary[sku].lotDetails[latestTransaction.lotNumber] = {
          lotNumber: latestTransaction.lotNumber,
          totalStock: totalStock,
          currentBalance: lotCurrentBalance,
          transactionCount: transactions.length,
          pricePerUnit: parseFloat(latestTransaction.pricePerUnit || 0),
          totalCost: parseFloat(latestTransaction.totalCost || 0),
          currency: latestTransaction.currency || 'TRY',
          unit: latestTransaction.unit,
          purchaseDate: latestTransaction.purchaseDate,
          lastTransactionDate: latestTransaction.createdAt
        };
        
        // Add to SKU totals
        summary[sku].totalStock += totalStock;
        summary[sku].currentBalance += lotCurrentBalance;
      });

      // Get all transactions for each SKU
      allHistory.forEach(record => {
        if (summary[record.sku]) {
          summary[record.sku].transactions.push(record);
        }
      });

      // Convert to array and format
      const result = Object.values(summary).map(item => {
        strapi.log.info(`[STOCK-SUMMARY] ${item.sku} *** TOTAL currentBalance: ${item.currentBalance} *** (from ${Object.keys(item.lotDetails).length} lots)`);
        return {
          sku: item.sku,
          rawMaterial: item.rawMaterial,
          lotCount: Object.keys(item.lotDetails).length,
          lots: Object.values(item.lotDetails),
          totalStock: item.totalStock,
          currentBalance: item.currentBalance,
          transactionCount: item.transactions.length,
          lastTransaction: item.transactions[0]?.createdAt
        };
      });

      ctx.body = { data: result };
    } catch (error) {
      strapi.log.error('Get stock summary error:', error);
      return ctx.badRequest(error.message);
    }
  }
}));
