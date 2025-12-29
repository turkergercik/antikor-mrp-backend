module.exports = {
  async beforeUpdate(event) {
    console.log('=== ORDER LIFECYCLE beforeUpdate TRIGGERED ===');
    const { data, where } = event.params;
    
    console.log('Event params:', { data, where });
    console.log('data.orderStatus:', data.orderStatus);
    
    // Only proceed if orderStatus is being changed
    if (!data.orderStatus) {
      console.log('⚠️ No orderStatus in data, skipping lifecycle');
      return;
    }

    // Get the current order to check previous status
    // Handle both numeric id and documentId
    let orderId = where.documentId || where.id;
    console.log('Fetching order with ID:', orderId, 'Type:', typeof orderId);
    
    // If we have a numeric id, fetch the documentId first
    let currentOrder;
    if (typeof orderId === 'number' || !isNaN(orderId)) {
      console.log('Numeric ID detected, fetching documentId first');
      const orderRecord = await strapi.db.query('api::order.order').findOne({
        where: { id: orderId },
        populate: ['recipe']
      });
      
      if (!orderRecord) {
        console.log('❌ Order not found with numeric id:', orderId);
        return;
      }
      
      orderId = orderRecord.documentId;
      console.log('Found documentId:', orderId);
      currentOrder = orderRecord;
    } else {
      currentOrder = await strapi.documents('api::order.order').findOne({
        documentId: orderId,
        populate: ['recipe']
      });
    }

    if (!currentOrder) {
      console.log('❌ Order not found:', orderId);
      return;
    }

    console.log('✓ Order found:', currentOrder.id);
    console.log('Current status:', currentOrder.orderStatus, '→ New status:', data.orderStatus);

    // If status is changing to 'ready' from pending
    console.log('Checking status transition:', {
      newStatus: data.orderStatus,
      isReady: data.orderStatus === 'ready',
      currentStatus: currentOrder.orderStatus,
      isPending: currentOrder.orderStatus === 'pending',
      shouldDeductStock: data.orderStatus === 'ready' && currentOrder.orderStatus === 'pending'
    });
    
    if (data.orderStatus === 'ready' && currentOrder.orderStatus === 'pending') {
      console.log('🎯 STATUS TRANSITION MATCHED: pending → ready, proceeding with LOT-BASED stock deduction');
      
      // Check if order has lot allocations
      if (currentOrder.lotAllocations) {
        try {
          const allocations = JSON.parse(currentOrder.lotAllocations);
          console.log('Deducting from lots:', allocations.length, 'allocations');
          
          // Deduct quantities from allocated lots
          await strapi.service('api::lot.lot').deductFromLots(allocations);
          
          console.log('✓ Successfully deducted from lots');
        } catch (error) {
          console.error('Error deducting from lots:', error);
          throw new Error(`Failed to deduct stock from lots: ${error.message}`);
        }
      } else {
        console.warn('⚠️ No lot allocations found for order, falling back to legacy inventory deduction');
        
        const recipeId = currentOrder.recipe?.documentId || currentOrder.recipe?.id;
        
        if (!recipeId) {
          console.error('Recipe not found for order:', currentOrder.id);
          throw new Error('Recipe not found for this order');
        }

        // Fetch the recipe to get its numeric ID for inventory lookup
        const recipe = await strapi.documents('api::recipe.recipe').findOne({
          documentId: recipeId
        });

        if (!recipe) {
          console.error('Recipe document not found:', recipeId);
          throw new Error('Recipe not found');
        }

        // Find inventory record for this recipe
        const inventories = await strapi.db.query('api::inventory.inventory').findMany({
          populate: ['recipe'],
        });
        
        const inventory = inventories.find(inv => inv.recipe && inv.recipe.id === recipe.id);

        if (!inventory) {
          throw new Error('No inventory found for this recipe');
        }

        const orderQuantity = parseFloat(currentOrder.quantity);
        const currentStock = parseFloat(inventory.stock || 0);

        console.log(`Checking stock for recipe ${recipe.name}: Current=${currentStock}, Required=${orderQuantity}`);

        // Check if there's enough stock
        if (currentStock < orderQuantity) {
          throw new Error(`Yetersiz stok! Mevcut: ${currentStock}, Gerekli: ${orderQuantity}`);
        }

        // Deduct stock from inventory
        const newStock = currentStock - orderQuantity;
        
        await strapi.db.query('api::inventory.inventory').update({
          where: { id: inventory.id },
          data: {
            stock: newStock,
            lastUpdated: new Date().toISOString(),
          },
        });

        console.log(`✓ Stock deducted for order ${currentOrder.id}: ${orderQuantity} units. Recipe: ${recipe.name}, New stock: ${newStock}`);
      }
      
      // Deduct packaging materials if packaging is enabled
      console.log('📦 Checking packagingEnabled:', currentOrder.packagingEnabled, 'Type:', typeof currentOrder.packagingEnabled);
      
      if (currentOrder.packagingEnabled === true || currentOrder.packagingEnabled === 1) {
        console.log('📦 Packaging enabled, deducting packaging materials');
        
        // Get all raw materials with packaging capacity
        const packagingMaterials = await strapi.db.query('api::raw-material.raw-material').findMany({
          where: {
            packagingCapacity: { $gt: 0 }
          }
        });
        
        console.log('Found packaging materials:', packagingMaterials.length);
        
        if (packagingMaterials.length > 0) {
          const parcel20 = packagingMaterials.find(m => m.packagingCapacity === 20);
          const parcel100 = packagingMaterials.find(m => m.packagingCapacity === 100);
          const parcel200 = packagingMaterials.find(m => m.packagingCapacity === 200);
          
          // Calculate packaging needed
          const total20Parcels = Math.ceil(orderQuantity / 20);
          const needed200Parcels = Math.floor(total20Parcels / 10);
          let remaining20Parcels = total20Parcels - (needed200Parcels * 10);
          const needed100Parcels = Math.floor(remaining20Parcels / 5);
          remaining20Parcels = remaining20Parcels - (needed100Parcels * 5);
          
          console.log('Packaging calculation:', {
            orderQuantity,
            total20Parcels,
            needed200Parcels,
            needed100Parcels,
            remaining20Parcels
          });
          
          // Deduct 20-piece parcels
          if (parcel20 && total20Parcels > 0) {
            const currentStock20 = parseFloat(parcel20.currentStock || 0);
            const newStock20 = currentStock20 - total20Parcels;
            await strapi.db.query('api::raw-material.raw-material').update({
              where: { id: parcel20.id },
              data: { currentStock: newStock20 }
            });
            console.log(`📦 Deducted ${total20Parcels} x 20-piece parcels. Stock: ${currentStock20} -> ${newStock20}`);
          }
          
          // Deduct 100-piece containers
          if (parcel100 && needed100Parcels > 0) {
            const currentStock100 = parseFloat(parcel100.currentStock || 0);
            const newStock100 = currentStock100 - needed100Parcels;
            await strapi.db.query('api::raw-material.raw-material').update({
              where: { id: parcel100.id },
              data: { currentStock: newStock100 }
            });
            console.log(`📦 Deducted ${needed100Parcels} x 100-piece containers. Stock: ${currentStock100} -> ${newStock100}`);
          }
          
          // Deduct 200-piece containers
          if (parcel200 && needed200Parcels > 0) {
            const currentStock200 = parseFloat(parcel200.currentStock || 0);
            const newStock200 = currentStock200 - needed200Parcels;
            await strapi.db.query('api::raw-material.raw-material').update({
              where: { id: parcel200.id },
              data: { currentStock: newStock200 }
            });
            console.log(`📦 Deducted ${needed200Parcels} x 200-piece containers. Stock: ${currentStock200} -> ${newStock200}`);
          }
        }
      }
    }

    // Prevent cancellation after ready status
    if (data.orderStatus === 'cancelled') {
      if (currentOrder.orderStatus !== 'pending') {
        // If cancelling from ready status, return lots to inventory
        if (currentOrder.orderStatus === 'ready' && currentOrder.lotAllocations) {
          try {
            const allocations = JSON.parse(currentOrder.lotAllocations);
            console.log('Returning lots to inventory for cancelled order:', allocations.length, 'allocations');
            
            await strapi.service('api::lot.lot').returnToLots(allocations);
            
            console.log('✓ Successfully returned lots to inventory');
          } catch (error) {
            console.error('Error returning lots:', error);
            // Continue with cancellation even if return fails
          }
        }
        
        // Allow cancellation but log it
        console.warn('⚠️ Order cancelled from status:', currentOrder.orderStatus);
      }
    }

    // This block is no longer needed since we prevent cancellation after ready
    if (false && data.orderStatus === 'cancelled' && currentOrder.orderStatus === 'ready') {
      const recipeId = currentOrder.recipe?.documentId || currentOrder.recipe?.id;
      
      if (recipeId) {
        // Fetch the recipe with fresh data
        const recipe = await strapi.documents('api::recipe.recipe').findOne({
          documentId: recipeId
        });

        if (recipe) {
          const orderQuantity = parseFloat(currentOrder.quantity);
          const currentStock = parseFloat(recipe.productStock || 0);
          const newStock = currentStock + orderQuantity;
          
          await strapi.documents('api::recipe.recipe').update({
            documentId: recipeId,
            data: {
              productStock: newStock
            }
          });

          console.log(`✓ Stock restored for cancelled order ${currentOrder.id}: ${orderQuantity} units. Recipe: ${recipe.name}, New stock: ${newStock}`);
        }
      }
    }
  }
};
