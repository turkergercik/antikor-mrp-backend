/**
 * order service
 */

const { createCoreService } = require('@strapi/strapi').factories;
const axios = require('axios');

module.exports = createCoreService('api::order.order', ({ strapi }) => ({
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

      strapi.log.info('Making API request with courierCode:', courierCode, 'trackNo:', trackingNumber);

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

      strapi.log.info('Track123 API Response Code:', response.data?.code);

      // Parse Track123 response
      if (response.data && response.data.code === '00000' && response.data.data && response.data.data.accepted) {
        const trackingData = response.data.data.accepted;
        const transitStatus = trackingData.transitStatus;
        
        strapi.log.info('Transit Status detected:', transitStatus);
        
        if (transitStatus === 'DELIVERED') {
          return 'teslim_edildi';
        } else if (transitStatus === 'IN_TRANSIT') {
          const localInfo = trackingData.localLogisticsInfo;
          if (localInfo && localInfo.trackingDetails && localInfo.trackingDetails.length > 0) {
            const latestEvent = localInfo.trackingDetails[0];
            const eventDetail = latestEvent.eventDetail?.toLowerCase() || '';
            
            if (eventDetail.includes('dağıt') || eventDetail.includes('dagit') || 
                eventDetail.includes('teslimat') || eventDetail.includes('delivery') ||
                eventDetail.includes('çıkış') || eventDetail.includes('cikis')) {
              return 'dagitimda';
            }
          }
          return 'yolda';
        } else if (transitStatus === 'NO_RECORD') {
          return 'bulunamadi';
        } else if (transitStatus === 'EXCEPTION' || transitStatus === 'EXPIRED') {
          return 'bulunamadi';
        }
        
        return 'yolda';
      }

      strapi.log.warn('Track123 API returned empty or invalid response');
      return null;
      
    } catch (error) {
      strapi.log.error('Track123 API error:', error.message);
      return null;
    }
  },

  /**
   * Update order tracking status using Track123 API
   */
  async updateTrackingStatus(orderId) {
    try {
      // Get order with cargo company populated
      const order = await strapi.entityService.findOne('api::order.order', orderId, {
        populate: ['cargoCompany'],
      });

      if (!order) {
        throw new Error('Order not found');
      }

      if (!order.trackingNumber || !order.cargoCompany || !order.cargoCompany.companySlug) {
        throw new Error('Tracking information incomplete');
      }

      // Get tracking status using Track123 API
      const newStatus = await this.getTrackingStatus(
        order.cargoCompany.companySlug,
        order.trackingNumber
      );

      // If API call failed or tracking not found
      if (!newStatus) {
        const updated = await strapi.entityService.update('api::order.order', orderId, {
          data: {
            shipmentStatus: 'bulunamadi',
          },
        });
        
        return {
          success: false,
          message: 'Takip bilgisi bulunamadı',
          order: updated,
        };
      }

      // Update the order with new status
      const updated = await strapi.entityService.update('api::order.order', orderId, {
        data: {
          shipmentStatus: newStatus,
        },
      });

      return {
        success: true,
        status: newStatus,
        order: updated,
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
