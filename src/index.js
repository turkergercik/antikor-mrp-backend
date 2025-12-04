'use strict';

const path = require('path');

// Explicitly load environment variables from .env file with absolute path
require('dotenv').config({ 
  path: path.join(__dirname, '..', '.env'),
  override: true // Override any existing environment variables
});

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/*{ strapi }*/) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  bootstrap({ strapi }) {
    // Log environment variables to verify they're loaded
    const envPath = path.join(__dirname, '..', '.env');
    strapi.log.info(`[BOOTSTRAP] Loading .env from: ${envPath}`);
    strapi.log.info('[BOOTSTRAP] GROQ_API_KEY loaded:', !!process.env.GROQ_API_KEY);
    strapi.log.info('[BOOTSTRAP] GROQ_API_KEY value:', process.env.GROQ_API_KEY?.substring(0, 20) + '...');
  },
};
