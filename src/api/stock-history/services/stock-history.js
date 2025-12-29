/**
 * stock-history service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::stock-history.stock-history', ({ strapi }) => ({
  async addStock(data) {
    try {
      const { rawMaterialId, sku, lotNumber, quantity, unit, pricePerUnit, supplier, purchaseDate, expiryDate, location, notes, performedBy } = data;

      // Calculate total cost
      const totalCost = parseFloat(quantity) * parseFloat(pricePerUnit || 0);

      // Get current balance for this SKU
      const currentBalance = await this.getCurrentBalance(sku);
      const newBalance = currentBalance + parseFloat(quantity);

      const record = await strapi.entityService.create('api::stock-history.stock-history', {
        data: {
          rawMaterial: rawMaterialId,
          sku,
          lotNumber,
          transactionType: 'purchase',
          quantity,
          unit,
          pricePerUnit: pricePerUnit || 0,
          totalCost,
          supplier,
          purchaseDate,
          expiryDate,
          location,
          notes,
          performedBy,
          currentBalance: newBalance
        },
        populate: {
          rawMaterial: true
        }
      });

      return record;
    } catch (error) {
      console.error('Error adding stock:', error);
      throw error;
    }
  },

  async deductStock(data) {
    try {
      const { rawMaterialId, sku, lotNumber, quantity, unit, referenceNumber, referenceType, notes, performedBy } = data;

      const currentBalance = await this.getCurrentBalance(sku);
      const newBalance = currentBalance - parseFloat(quantity);

      const record = await strapi.entityService.create('api::stock-history.stock-history', {
        data: {
          rawMaterial: rawMaterialId,
          sku,
          lotNumber,
          transactionType: 'usage',
          quantity,
          unit,
          referenceNumber,
          referenceType,
          notes,
          performedBy,
          currentBalance: newBalance
        },
        populate: {
          rawMaterial: true
        }
      });

      return record;
    } catch (error) {
      console.error('Error deducting stock:', error);
      throw error;
    }
  },

  async adjustStock(data) {
    try {
      const { rawMaterialId, sku, lotNumber, quantity, unit, notes, performedBy } = data;

      const currentBalance = await this.getCurrentBalance(sku);
      const newBalance = currentBalance + parseFloat(quantity);

      const record = await strapi.entityService.create('api::stock-history.stock-history', {
        data: {
          rawMaterial: rawMaterialId,
          sku,
          lotNumber,
          transactionType: 'adjustment',
          quantity: Math.abs(parseFloat(quantity)),
          unit,
          notes,
          performedBy,
          currentBalance: newBalance
        },
        populate: {
          rawMaterial: true
        }
      });

      return record;
    } catch (error) {
      console.error('Error adjusting stock:', error);
      throw error;
    }
  },

  async getCurrentBalance(sku) {
    try {
      const history = await strapi.entityService.findMany('api::stock-history.stock-history', {
        filters: {
          sku: sku
        },
        sort: { createdAt: 'desc' },
        limit: 1
      });

      if (history && history.length > 0) {
        return parseFloat(history[0].currentBalance || 0);
      }

      return 0;
    } catch (error) {
      console.error('Error getting current balance:', error);
      return 0;
    }
  },

  async getStockByLots(sku) {
    try {
      const history = await strapi.entityService.findMany('api::stock-history.stock-history', {
        filters: {
          sku: sku
        }
      });

      const lotBalances = {};

      history.forEach(record => {
        if (!lotBalances[record.lotNumber]) {
          lotBalances[record.lotNumber] = {
            lotNumber: record.lotNumber,
            balance: 0,
            expiryDate: record.expiryDate,
            location: record.location,
            transactions: []
          };
        }

        if (record.transactionType === 'purchase' || record.transactionType === 'return') {
          lotBalances[record.lotNumber].balance += parseFloat(record.quantity || 0);
        } else {
          lotBalances[record.lotNumber].balance -= parseFloat(record.quantity || 0);
        }

        lotBalances[record.lotNumber].transactions.push(record);
      });

      return Object.values(lotBalances).filter(lot => lot.balance > 0);
    } catch (error) {
      console.error('Error getting stock by lots:', error);
      throw error;
    }
  }
}));
