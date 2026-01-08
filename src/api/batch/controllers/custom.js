module.exports = {
  async findIndex(ctx) {
    const { id } = ctx.params;

    try {
      // Get the target batch to know its updatedAt
      const targetBatch = await strapi.entityService.findOne('api::batch.batch', id, {
        fields: ['id', 'updatedAt'],
      });

      if (!targetBatch) {
        return ctx.notFound('Batch not found');
      }

      // Count how many batches have updatedAt > targetBatch.updatedAt
      // (these come before it in descending sort)
      const count = await strapi.db.query('api::batch.batch').count({
        where: {
          updatedAt: {
            $gt: targetBatch.updatedAt,
          },
        },
      });

      // Return the index and calculated page number
      ctx.send({
        index: count,
        batchId: id,
        updatedAt: targetBatch.updatedAt,
      });
    } catch (error) {
      ctx.throw(500, error);
    }
  },
};
