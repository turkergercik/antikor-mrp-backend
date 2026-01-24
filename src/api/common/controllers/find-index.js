/**
 * Generic find-index controller for all content types
 */

module.exports = {
  async findIndex(ctx) {
    const { contentType, id } = ctx.params;

    try {
      console.log(`[Find-Index] Looking for ${contentType} ID:`, id);

      // Map content type names to API names
      const contentTypeMap = {
        'batches': 'api::batch.batch',
        'orders': 'api::order.order',
        'lots': 'api::lot.lot',
        'inventories': 'api::inventory.inventory',
        'cargo-companies': 'api::cargo-company.cargo-company',
        'stock-histories': 'api::stock-history.stock-history',
        'raw-materials': 'api::raw-material.raw-material',
        'recipes': 'api::recipe.recipe',
        'shipments': 'api::order.order',
      };

      // Sort configurations for each content type
      const sortConfigs = {
        'batches': { field: 'batchNumber', order: 'desc' },
        'orders': { field: 'createdAt', order: 'desc' },
        'lots': { field: 'createdAt', order: 'desc' },
        'inventories': { field: 'createdAt', order: 'desc' },
        'cargo-companies': { field: 'name', order: 'asc' },
        'stock-histories': { field: 'transactionDate', order: 'desc' },
        'raw-materials': { field: 'updatedAt', order: 'desc' },
        'recipes': { field: 'updatedAt', order: 'desc' },
        'shipments': { field: 'shippedAt', order: 'desc' },
      };

      const apiName = contentTypeMap[contentType];
      const sortConfig = sortConfigs[contentType];

      if (!apiName || !sortConfig) {
        return ctx.badRequest(`Invalid content type: ${contentType}`);
      }

      // Get the entity
      const entity = await strapi.entityService.findOne(apiName, id, {
        fields: ['id', sortConfig.field, ...(sortConfig.fallbackFields || [])],
      });

      if (!entity) {
        console.error(`[Find-Index] ${contentType} not found:`, id);
        return ctx.notFound(`${contentType} not found`);
      }

      console.log(`[Find-Index] ${contentType} found, numeric ID:`, entity.id);

      // Handle special case for orders with computed delivery date
      if (contentType === 'orders') {
        const allOrders = await strapi.entityService.findMany(apiName, {
          fields: ['id', 'confirmedDeliveryDate', 'requestedDeliveryDate', 'deliveryDate'],
          limit: 10000,
        });

        allOrders.sort((a, b) => {
          const dateA = new Date(a.confirmedDeliveryDate || a.requestedDeliveryDate || a.deliveryDate || '2099-12-31');
          const dateB = new Date(b.confirmedDeliveryDate || b.requestedDeliveryDate || b.deliveryDate || '2099-12-31');
          
          if (dateA.getTime() !== dateB.getTime()) {
            return dateA - dateB;
          }
          return a.id - b.id;
        });

        const index = allOrders.findIndex(o => o.id === entity.id);
        console.log(`[Find-Index] Index:`, index);

        return {
          index: index >= 0 ? index : 0,
          entityId: entity.id,
        };
      }

      // For all other content types, use standard counting
      const sortValue = entity[sortConfig.field];
      const isAscending = sortConfig.order === 'asc';

      const whereClause = {
        $or: [
          {
            [sortConfig.field]: {
              [isAscending ? '$lt' : '$gt']: sortValue,
            },
          },
          {
            [sortConfig.field]: sortValue,
            id: {
              [isAscending ? '$gt' : '$lt']: entity.id,
            },
          },
        ],
      };

      // For shipments, only count shipped orders
      if (contentType === 'shipments') {
        whereClause.orderStatus = 'shipped';
      }

      const count = await strapi.db.query(apiName).count({ where: whereClause });

      console.log(`[Find-Index] Index:`, count);

      return {
        index: count,
        entityId: entity.id,
      };
    } catch (error) {
      console.error('[Find-Index] Error:', error);
      return ctx.badRequest('Failed to find index', { error: error.message });
    }
  },
};
