module.exports = [
  'strapi::logger',
  'strapi::errors',
  'strapi::security',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
  {
    name: 'strapi::compression',
    config: {
      threshold: 1024, // Only compress responses > 1KB
      level: 6, // Compression level (1-9, 6 is good balance)
    },
  },
];
