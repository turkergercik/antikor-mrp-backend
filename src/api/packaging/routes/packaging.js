module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/packagings',
      handler: 'packaging.find',
    },
    {
      method: 'GET',
      path: '/packagings/:id',
      handler: 'packaging.findOne',
    },
    {
      method: 'POST',
      path: '/packagings',
      handler: 'packaging.create',
    },
    {
      method: 'PUT',
      path: '/packagings/:id',
      handler: 'packaging.update',
    },
    {
      method: 'DELETE',
      path: '/packagings/:id',
      handler: 'packaging.delete',
    },
  ],
};
