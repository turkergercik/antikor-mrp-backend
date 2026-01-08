'use strict';

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/cargo-companies/:id/find-index',
      handler: 'custom.findIndex',
      config: {
        policies: [],
        middlewares: [],
      },
    },
  ],
};
