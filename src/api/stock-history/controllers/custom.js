module.exports = {
  async findIndex(ctx) {
    const { id } = ctx.params;

    try {
      console.log('[Stock History findIndex] Looking for ID:', id);
      
      // Get the target stock history to know its createdAt
      const targetHistory = await strapi.entityService.findOne('api::stock-history.stock-history', id, {
        fields: ['id', 'createdAt'],
      });

      if (!targetHistory) {
        console.log('[Stock History findIndex] Not found with ID:', id);
        return ctx.notFound('Stock history not found');
      }

      console.log('[Stock History findIndex] Found history:', targetHistory);

      // Count how many stock histories have createdAt > targetHistory.createdAt
      // (these come before it in descending sort)
      const count = await strapi.db.query('api::stock-history.stock-history').count({
        where: {
          createdAt: {
            $gt: targetHistory.createdAt,
          },
        },
      });

      console.log('[Stock History findIndex] Count:', count);

      // Return the index
      ctx.send({
        index: count,
        historyId: id,
        createdAt: targetHistory.createdAt,
      });
    } catch (error) {
      console.error('[Stock History findIndex] Error:', error);
      ctx.throw(500, error);
    }
  },
};
