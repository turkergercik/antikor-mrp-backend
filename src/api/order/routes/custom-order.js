/**
 * Custom order routes
 */

module.exports = {
  routes: [
    {
      method: 'PUT',
      path: '/orders/:id/approve-delivery',
      handler: 'order.approveDeliveryDate',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/orders/:id/ship-partial',
      handler: 'order.shipPartial',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/orders/:id/refresh-tracking',
      handler: 'order.refreshTracking',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'POST',
      path: '/orders/:id/allocate-lots',
      handler: 'order.allocateLots',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
