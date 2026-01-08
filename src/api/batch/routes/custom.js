module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/batches/:id/find-index',
      handler: 'custom.findIndex',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
