/**
 * worker-todo service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::worker-todo.worker-todo');
