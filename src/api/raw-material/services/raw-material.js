/**
 * raw-material service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::raw-material.raw-material');
