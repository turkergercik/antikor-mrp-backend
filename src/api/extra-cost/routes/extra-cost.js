module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/extra-cost',
      handler: 'extra-cost.find',
      config: {
        policies: [],
        middlewares: [],
      },
    },
    {
      method: 'PUT',
      path: '/extra-cost',
      handler: 'extra-cost.update',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
