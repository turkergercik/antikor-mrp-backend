module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/exchange-rates',
      handler: 'exchange-rate.getRates',
      config: {
        auth: false,
        policies: [],
        middlewares: [],
      },
    },
  ],
};
