/**
 * batch service
 */

const { createCoreService } = require('@strapi/strapi').factories;
const axios = require('axios');

module.exports = createCoreService('api::batch.batch', ({ strapi }) => ({
  /**
   * Get tracking status using Track123 API
   */
  async getTrackingStatus(courierCode, trackingNumber) {
    try {
      strapi.log.info(`Fetching tracking for: ${trackingNumber} via courier: ${courierCode}`);
      
      const apiSecret = process.env.Track123_Api_Secret;
      
      if (!apiSecret) {
        strapi.log.error('Track123 API secret not found in environment variables');
        return null;
      }

      strapi.log.info('Making API request with courierCode:', courierCode, 'trackNo:', trackingNumber, 'apiSecretLength:', apiSecret.length);

      const response = await axios.post(
        'https://api.track123.com/gateway/open-api/tk/v2.1/track/query-realtime',
        {
          courierCode: courierCode,
          trackNo: trackingNumber
        },
        {
          headers: {
            'Track123-Api-Secret': apiSecret,
            'accept': 'application/json',
            'content-type': 'application/json'
          },
          timeout: 10000
        }
      );

      strapi.log.info('=== TRACK123 API RAW RESPONSE ===');
      strapi.log.info('Status Code:', response.status);
      strapi.log.info('Response Code:', response.data?.code);
      strapi.log.info('Response Message:', response.data?.msg);
      if (response.data) {
        console.log('Full Response Data:', JSON.stringify(response.data, null, 2));
      }
      strapi.log.info('=== END TRACKING API RESPONSE ===');

      // Parse Track123 response
      if (response.data && response.data.code === '00000' && response.data.data && response.data.data.accepted) {
        const trackingData = response.data.data.accepted;
        
        console.log('Tracking Data Found:');
        console.log('  trackNo:', trackingData.trackNo);
        console.log('  transitStatus:', trackingData.transitStatus);
        console.log('  transitSubStatus:', trackingData.transitSubStatus);
        console.log('  deliveredTime:', trackingData.deliveredTime);
        console.log('  lastTrackingTime:', trackingData.lastTrackingTime);
        
        // Get transitStatus from Track123
        // transitStatus values: DELIVERED, IN_TRANSIT, EXCEPTION, etc.
        const transitStatus = trackingData.transitStatus;
        
        strapi.log.info('Transit Status detected:', transitStatus);
        
        if (transitStatus === 'DELIVERED') {
          strapi.log.info('Detected status: teslim_edildi (delivered)');
          return 'teslim_edildi';
        } else if (transitStatus === 'IN_TRANSIT') {
          // Check latest tracking event for more details
          const localInfo = trackingData.localLogisticsInfo;
          if (localInfo && localInfo.trackingDetails && localInfo.trackingDetails.length > 0) {
            const latestEvent = localInfo.trackingDetails[0];
            const eventDetail = latestEvent.eventDetail?.toLowerCase() || '';
            
            // Check if out for delivery (dağıtımda)
            if (eventDetail.includes('dağıt') || eventDetail.includes('dagit') || 
                eventDetail.includes('teslimat') || eventDetail.includes('delivery') ||
                eventDetail.includes('çıkış') || eventDetail.includes('cikis')) {
              strapi.log.info('Detected status: dagitimda (out for delivery)');
              return 'dagitimda';
            }
          }
          
          strapi.log.info('Detected status: yolda (in-transit)');
          return 'yolda';
        } else if (transitStatus === 'NO_RECORD') {
          strapi.log.info('Detected status: bulunamadi (no record found)');
          return 'bulunamadi';
        } else if (transitStatus === 'EXCEPTION' || transitStatus === 'EXPIRED') {
          strapi.log.info('Detected status: bulunamadi (exception/expired)');
          return 'bulunamadi';
        }
        
        strapi.log.info('Detected status: yolda (default)');
        return 'yolda';
      }

      strapi.log.warn('Track123 API returned empty or invalid response');
      return null;
      
    } catch (error) {
      strapi.log.error('Track123 API error:', error.message);
      if (error.response) {
        strapi.log.error('Error Status:', error.response.status);
        strapi.log.error('Error Data:', JSON.stringify(error.response.data, null, 2));
        strapi.log.error('Error Headers:', JSON.stringify(error.response.headers, null, 2));
      } else if (error.request) {
        strapi.log.error('No response received from API');
        strapi.log.error('Request details:', error.request);
      } else {
        strapi.log.error('Request setup error:', error.message);
      }
      return null;
    }
  },

  /**
   * Update batch tracking status using Track123 API
   */
  async updateTrackingStatus(batchId) {
    try {
      // Get batch with cargo company populated
      const batch = await strapi.entityService.findOne('api::batch.batch', batchId, {
        populate: ['cargoCompany'],
      });

      if (!batch) {
        throw new Error('Batch not found');
      }

      if (!batch.trackingNumber || !batch.cargoCompany || !batch.cargoCompany.companySlug) {
        throw new Error('Tracking information incomplete');
      }

      // Get tracking status using Track123 API with courierCode from companySlug
      const newStatus = await this.getTrackingStatus(
        batch.cargoCompany.companySlug,
        batch.trackingNumber
      );

      // If API call failed or tracking not found, don't update
      if (!newStatus) {
        // Update status to 'bulunamadi' (not found)
        const updated = await strapi.entityService.update('api::batch.batch', batchId, {
          data: {
            batchStatus: batch.batchStatus,
            shipmentStatus: 'bulunamadi',
          },
        });
        
        return {
          success: false,
          message: 'Takip bilgisi bulunamadı',
          batch: updated,
        };
      }

      // Update the batch with new status (keep existing batchStatus field)
      const updated = await strapi.entityService.update('api::batch.batch', batchId, {
        data: {
          batchStatus: batch.batchStatus,
          shipmentStatus: newStatus,
        },
      });

      return {
        success: true,
        status: newStatus,
        batch: updated,
      };
    } catch (error) {
      strapi.log.error('Update tracking status error:', error);
      return {
        success: false,
        message: 'Takip bilgisi alınamadı',
        error: error.message,
      };
    }
  },
}));
