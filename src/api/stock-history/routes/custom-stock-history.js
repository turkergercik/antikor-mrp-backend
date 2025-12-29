/**
 * Custom stock-history routes
 */

module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/stock-histories/sku/:sku',
      handler: 'stock-history.getBySKU',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/stock-histories/lot/:lotNumber',
      handler: 'stock-history.getByLot',
      config: {
        auth: false,
      },
    },
    {
      method: 'GET',
      path: '/stock-histories/summary',
      handler: 'stock-history.getSummaryBySKU',
      config: {
        auth: false,
      },
    },
  ],
};
