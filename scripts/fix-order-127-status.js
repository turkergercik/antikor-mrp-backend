const strapi = require('@strapi/strapi');

async function fixOrder127Status() {
  const app = await strapi().load();
  
  try {
    // Find order 127
    const order = await strapi.db.query('api::order.order').findOne({
      where: { id: 127 },
      populate: ['recipe']
    });
    
    if (!order) {
      console.log('❌ Order 127 not found');
      return;
    }
    
    console.log('📋 Order 127 current status:', {
      orderStatus: order.orderStatus,
      deliveryDateStatus: order.deliveryDateStatus,
      fulfillmentMethod: order.fulfillmentMethod,
      quantityToBeProduced: order.quantityToBeProduced,
      quantityFromStock: order.quantityFromStock
    });
    
    // Check if order needs production
    const needsProduction = (order.fulfillmentMethod === 'mixed' || order.fulfillmentMethod === 'to_be_produced') 
                          && (order.quantityToBeProduced > 0);
    
    if (needsProduction && order.orderStatus !== 'planned') {
      console.log('🔧 Fixing order status to "planned"...');
      
      await strapi.db.query('api::order.order').update({
        where: { id: 127 },
        data: {
          orderStatus: 'planned'
        }
      });
      
      console.log('✅ Order 127 status updated to "planned"');
      
      // Fetch updated order
      const updatedOrder = await strapi.db.query('api::order.order').findOne({
        where: { id: 127 },
        populate: ['recipe', 'lots']
      });
      
      console.log('📋 Updated order status:', updatedOrder.orderStatus);
      
      // Emit socket event
      const socketIO = require('../src/extensions/socket');
      socketIO.emitOrderUpdated(updatedOrder);
      console.log('📡 Socket event emitted');
    } else {
      console.log('ℹ️ Order 127 does not need status update');
    }
    
  } catch (error) {
    console.error('❌ Error fixing order 127:', error);
  } finally {
    await app.destroy();
  }
}

fixOrder127Status();
