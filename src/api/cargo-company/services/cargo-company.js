'use strict';

/**
 * cargo-company service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::cargo-company.cargo-company');
