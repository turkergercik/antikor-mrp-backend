/**
 * worker-todo router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/worker-todos/by-date',
      handler: 'worker-todo.findByDate',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'PUT',
      path: '/worker-todos/:id/toggle',
      handler: 'worker-todo.toggleComplete',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};

module.exports.default = createCoreRouter('api::worker-todo.worker-todo');
