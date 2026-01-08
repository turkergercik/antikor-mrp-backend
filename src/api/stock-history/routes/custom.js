module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/stock-histories/:id/find-index',
      handler: 'custom.findIndex',
      config: {
        auth: false,
      },
    },
  ],
};
