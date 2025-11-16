/**
 * quality-control service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::quality-control.quality-control');
