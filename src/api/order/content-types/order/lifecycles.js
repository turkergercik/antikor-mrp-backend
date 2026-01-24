module.exports = {
  async beforeUpdate(event) {
    console.log('=== ORDER LIFECYCLE beforeUpdate TRIGGERED ===');
    const { data, where } = event.params;
    
    console.log('Event params:', { data, where });
    console.log('data.orderStatus:', data.orderStatus);
    
    // Only proceed if orderStatus is being changed to a production-related status, ready, or shipped
    if (!data.orderStatus || !['processing', 'production', 'completed', 'ready', 'shipped'].includes(data.orderStatus)) {
      console.log('⚠️ No production-related orderStatus change, skipping inventory operations');
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
    
    // INVENTORY DEDUCTION MOVED TO SHIPMENT TIME (not at 'ready' status)
    // This supports partial deliveries where inventory should be deducted as products are actually shipped
    if (false && data.orderStatus === 'ready' && currentOrder.orderStatus === 'pending') {
      console.log('🎯 STATUS TRANSITION MATCHED: pending → ready, SKIPPING stock deduction (will deduct at shipment time)');
      
      // Get order quantity for packaging calculation (used later)
      const orderQuantity = parseFloat(currentOrder.quantity);
      
      // Check if order has lot allocations
      if (currentOrder.lotAllocations) {
        try {
          // Handle both string and already-parsed object
          let allocations;
          if (typeof currentOrder.lotAllocations === 'string') {
            allocations = JSON.parse(currentOrder.lotAllocations);
          } else {
            allocations = currentOrder.lotAllocations;
          }
          
          console.log('Deducting from lots:', allocations.length, 'allocations');
          console.log('Allocations:', JSON.stringify(allocations, null, 2));
          
          // Prepare order info for stock history
          const orderInfo = {
            customerName: currentOrder.customerName,
            quantity: currentOrder.quantity,
            notes: currentOrder.notes,
            readyBy: data.readyBy || 'system'
          };
          
          // Deduct quantities from allocated lots with order context
          await strapi.service('api::lot.lot').deductFromLots(allocations, orderInfo);
          
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
        
        const currentUser = data.readyBy || 'Sistem';
        
        // Helper function to deduct packaging from FIFO stock history lots
        const deductPackagingFromLots = async (material, quantityNeeded, packageType, performedBy) => {
          try {
            const sku = material.sku || material.name;
            
            // Get all purchase transactions sorted by date (FIFO)
            const purchases = await strapi.db.query('api::stock-history.stock-history').findMany({
              where: {
                sku: sku,
                transactionType: 'purchase',
                lotNumber: { $ne: null }
              },
              orderBy: { createdAt: 'asc' }
            });
            
            if (purchases.length === 0) {
              console.warn(`⚠️ No purchase history found for packaging: ${sku}`);
              return null;
            }
            
            // Use the oldest lot (FIFO)
            const oldestLot = purchases[0];
            const lotNumber = oldestLot.lotNumber;
            
            // Get current balance for this lot from latest transaction
            const latestTransaction = await strapi.db.query('api::stock-history.stock-history').findMany({
              where: {
                sku: sku,
                lotNumber: lotNumber
              },
              orderBy: { createdAt: 'desc' },
              limit: 1
            });
            
            console.log(`📦 DEBUG ${packageType} - Latest transaction for Lot ${lotNumber}:`, latestTransaction.length > 0 ? {
              id: latestTransaction[0].id,
              type: latestTransaction[0].transactionType,
              quantity: latestTransaction[0].quantity,
              balance: latestTransaction[0].currentBalance,
              date: latestTransaction[0].createdAt
            } : 'NONE');
            
            const currentBalance = latestTransaction.length > 0 ? parseFloat(latestTransaction[0].currentBalance || 0) : 0;
            const newBalance = currentBalance - quantityNeeded;
            
            console.log(`📦 ${packageType}: Lot ${lotNumber}, Balance: ${currentBalance} -> ${newBalance}, Deduct: ${quantityNeeded}`);
            
            // Create stock history entry for usage
            await strapi.documents('api::stock-history.stock-history').create({
              data: {
                rawMaterial: material.documentId,
                sku: sku,
                lotNumber: lotNumber,
                transactionType: 'usage',
                quantity: quantityNeeded,
                unit: material.unit || 'piece',
                pricePerUnit: oldestLot.pricePerUnit || 0,
                currency: oldestLot.currency || 'USD',
                totalCost: (oldestLot.pricePerUnit || 0) * quantityNeeded,
                supplier: `Sipariş: ${currentOrder.customerName}`,
                referenceNumber: String(currentOrder.orderNumber || currentOrder.id),
                referenceType: 'packaging',
                purchaseDate: new Date().toISOString().split('T')[0],
                notes: `Paketleme malzemesi kullanıldı (${packageType}): ${orderQuantity} adet sipariş`,
                performedBy: performedBy,
                currentBalance: newBalance
              }
            });
            
            return { lotNumber, oldBalance: currentBalance, newBalance };
          } catch (error) {
            console.error(`Error deducting packaging ${packageType}:`, error);
            return null;
          }
        };
        
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
            await deductPackagingFromLots(parcel20, total20Parcels, "20'lik", currentUser);
          }
          
          // Deduct 100-piece containers
          if (parcel100 && needed100Parcels > 0) {
            await deductPackagingFromLots(parcel100, needed100Parcels, "100'lük", currentUser);
          }
          
          // Deduct 200-piece containers
          if (parcel200 && needed200Parcels > 0) {
            await deductPackagingFromLots(parcel200, needed200Parcels, "200'lük", currentUser);
          }
        }
      }
    }

    // DEDUCT INVENTORY WHEN ORDER IS MARKED AS SHIPPED (full shipment via standard update)
    // This handles the case where an order is marked as shipped directly without using the partial shipment endpoint
    // IMPORTANT: Skip this if order has partial shipments, as inventory is deducted incrementally with each partial shipment
    if (data.orderStatus === 'shipped' && currentOrder.orderStatus === 'ready') {
      // Check if this is a partial shipment completion (has partialShipments array)
      const hasPartialShipments = currentOrder.partialShipments && 
                                  Array.isArray(currentOrder.partialShipments) && 
                                  currentOrder.partialShipments.length > 0;
      
      if (hasPartialShipments) {
        console.log('🚚 STATUS TRANSITION: ready → shipped via partial shipments');
        console.log('⚠️ Skipping inventory deduction - already deducted incrementally with each partial shipment');
        // Inventory was deducted incrementally with each partial shipment
        // This final status change just marks the order as complete
      } else {
        console.log('🚚 STATUS TRANSITION: ready → shipped, deducting full order inventory');
        
        const orderQuantity = parseFloat(currentOrder.quantity);
        
        // Check if order has lot allocations
        if (currentOrder.lotAllocations) {
          try {
            // Handle both string and already-parsed object
            let allocations;
            if (typeof currentOrder.lotAllocations === 'string') {
              allocations = JSON.parse(currentOrder.lotAllocations);
            } else {
              allocations = currentOrder.lotAllocations;
            }
            
            console.log('Deducting full order from lots:', allocations.length, 'allocations');
            console.log('Allocations:', JSON.stringify(allocations, null, 2));
            
            // Prepare order info for stock history
            const orderInfo = {
              customerName: currentOrder.customerName,
              quantity: currentOrder.quantity,
              notes: currentOrder.notes,
              readyBy: data.shippedBy || 'system'
            };
            
            // Deduct quantities from allocated lots with order context
            await strapi.service('api::lot.lot').deductFromLots(allocations, orderInfo);
            
            console.log('✓ Successfully deducted full order inventory at shipment time');
          } catch (error) {
            console.error('Error deducting inventory during full shipment:', error);
            throw new Error(`Failed to deduct stock from lots: ${error.message}`);
          }
        } else {
          console.warn('⚠️ No lot allocations found for order - cannot deduct inventory');
          throw new Error('No lot allocations found for this order. Cannot ship without lot allocations.');
        }
      }
    }

    // Prevent cancellation after ready status
    if (data.orderStatus === 'cancelled') {
      if (currentOrder.orderStatus !== 'pending') {
        // If cancelling from ready status, return lots to inventory
        if (currentOrder.orderStatus === 'ready' && currentOrder.lotAllocations) {
          try {
            // Handle both string and already-parsed object
            let allocations;
            if (typeof currentOrder.lotAllocations === 'string') {
              allocations = JSON.parse(currentOrder.lotAllocations);
            } else {
              allocations = currentOrder.lotAllocations;
            }
            
            console.log('Returning lots to inventory for cancelled order:', allocations.length, 'allocations');
            
            // Prepare return info for stock history
            const returnInfo = {
              customerName: currentOrder.customerName,
              cancellationReason: data.cancellationReason || 'Order cancelled',
              cancelledBy: data.cancelledBy || 'system'
            };
            
            await strapi.service('api::lot.lot').returnToLots(allocations, returnInfo);
            
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
  },

  async afterCreate(event) {
    // NOTE: Socket.IO event is now emitted from the controller after recipe is linked
    // Keeping this empty to maintain lifecycle structure
  },

  async afterUpdate(event) {
    const { result } = event;
    
    try {
      // Fetch the order with populated recipe to include full data
      const fullOrder = await strapi.db.query('api::order.order').findOne({
        where: { id: result.id },
        populate: ['recipe']
      });
      
      // Emit Socket.IO event for real-time updates
      const socketIO = require('../../../../extensions/socket');
      socketIO.emitOrderUpdated(fullOrder || result);
    } catch (error) {
      console.error('Error in afterUpdate lifecycle:', error);
      const socketIO = require('../../../../extensions/socket');
      socketIO.emitOrderUpdated(result);
    }
  },

  async afterDelete(event) {
    const { result } = event;
    
    // Emit Socket.IO event for real-time updates
    const socketIO = require('../../../../extensions/socket');
    socketIO.emitOrderDeleted(result.id);
  }
};
