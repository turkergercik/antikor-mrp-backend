/**
 * Custom batch routes
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/batches/:id/refresh-tracking',
      handler: 'batch.refreshTracking',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
