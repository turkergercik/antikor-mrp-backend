/**
 * Custom order routes
 */

module.exports = {
  routes: [
    {
      method: 'POST',
      path: '/orders/:id/refresh-tracking',
      handler: 'order.refreshTracking',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
