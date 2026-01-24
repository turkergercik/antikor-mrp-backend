/**
 * worker-todo controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::worker-todo.worker-todo', ({ strapi }) => ({
  // Get todos for a specific date
  async findByDate(ctx) {
    try {
      const { date } = ctx.query;
      
      if (!date) {
        return ctx.badRequest('Date is required');
      }

      const todos = await strapi.entityService.findMany('api::worker-todo.worker-todo', {
        filters: {
          date: {
            $eq: date,
          },
        },
        populate: {
          batch: {
            populate: {
              recipe: true,
            },
          },
          order: {
            populate: {
              recipe: true,
            },
          },
        },
        sort: [{ priority: 'desc' }, { createdAt: 'asc' }],
      });

      return { data: todos };
    } catch (err) {
      ctx.throw(500, err);
    }
  },

  // Toggle todo completion status
  async toggleComplete(ctx) {
    try {
      const { id } = ctx.params;
      
      const todo = await strapi.entityService.findOne('api::worker-todo.worker-todo', id);
      
      if (!todo) {
        return ctx.notFound('Todo not found');
      }

      const updated = await strapi.entityService.update('api::worker-todo.worker-todo', id, {
        data: {
          completed: !todo.completed,
        },
      });

      return { data: updated };
    } catch (err) {
      ctx.throw(500, err);
    }
  },
}));
