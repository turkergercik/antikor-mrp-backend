/**
 * Generic find-index routes
 */

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/find-index/:contentType/:id',
      handler: 'find-index.findIndex',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
