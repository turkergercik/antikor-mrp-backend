/**
 * stock-history controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::stock-history.stock-history', ({ strapi }) => ({
  async find(ctx) {
    // Add default population
    if (!ctx.query.populate) {
      ctx.query.populate = {
        rawMaterial: true
      };
    }
    
    return await super.find(ctx);
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
        if (record.transactionType === 'purchase' || record.transactionType === 'return') {
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
        if (record.transactionType === 'purchase' || record.transactionType === 'return') {
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
            lots: new Set(),
            totalStock: 0,
            transactions: []
          };
        }

        summary[record.sku].lots.add(record.lotNumber);
        
        if (record.transactionType === 'purchase' || record.transactionType === 'return') {
          summary[record.sku].totalStock += parseFloat(record.quantity || 0);
        } else {
          summary[record.sku].totalStock -= parseFloat(record.quantity || 0);
        }
        
        summary[record.sku].transactions.push(record);
      });

      // Convert to array and format
      const result = Object.values(summary).map(item => ({
        sku: item.sku,
        rawMaterial: item.rawMaterial,
        lotCount: item.lots.size,
        lots: Array.from(item.lots),
        totalStock: item.totalStock,
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
