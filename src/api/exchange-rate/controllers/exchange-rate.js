const axios = require('axios');
const { parseString } = require('xml2js');
const { promisify } = require('util');

const parseXML = promisify(parseString);

module.exports = {
  async getRates(ctx) {
    try {
      // Fetch exchange rates from TCMB
      const response = await axios.get('https://www.tcmb.gov.tr/kurlar/today.xml', {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });

      // Parse XML
      const result = await parseXML(response.data);
      
      const rates = {
        TRY: 1,
        USD: 34.5, // fallback
        EUR: 37.8, // fallback
        GBP: 43.2  // fallback
      };

      // Extract rates from XML
      if (result && result.Tarih_Date && result.Tarih_Date.Currency) {
        result.Tarih_Date.Currency.forEach(currency => {
          const code = currency.$.CurrencyCode;
          const forexSelling = currency.ForexSelling?.[0];
          
          if (code && forexSelling) {
            const rate = parseFloat(forexSelling);
            if (!isNaN(rate)) {
              rates[code] = rate;
            }
          }
        });
      }

      strapi.log.info('Exchange rates fetched:', rates);

      ctx.body = {
        data: rates,
        success: true,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      strapi.log.error('Error fetching exchange rates:', error);
      
      // Return fallback rates
      ctx.body = {
        data: {
          TRY: 1,
          USD: 34.5,
          EUR: 37.8,
          GBP: 43.2
        },
        success: true,
        fallback: true,
        timestamp: new Date().toISOString()
      };
    }
  },
};
