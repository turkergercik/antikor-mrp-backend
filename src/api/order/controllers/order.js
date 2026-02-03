/**
 * order controller
 */

const { createCoreController } = require('@strapi/strapi').factories;

module.exports = createCoreController('api::order.order', ({ strapi }) => ({
  /**
   * Override update to handle documentId
   */
  async update(ctx) {
    const { id } = ctx.params;
    const { data } = ctx.request.body || {};

    try {
      console.log('=== Order Update Request ===');
      console.log('ID:', id);
      console.log('Data:', JSON.stringify(data));

      // Handle both numeric id and documentId
      let orderId = id;

      if (isNaN(id)) {
        const order = await strapi.db.query('api::order.order').findOne({
          where: { documentId: id },
        });

        if (!order) {
          return ctx.notFound('Order not found');
        }

        orderId = order.id;
        console.log('Converted documentId to numeric id:', orderId);
      }

      // Update the order
      // Custom logic: If updating deliveryDateStatus to 'confirmed' or 'approved', check if we can make it ready
      if (data.deliveryDateStatus && ['confirmed', 'approved'].includes(data.deliveryDateStatus)) {
        // Fetch current order to check lots and quantities
        const currentOrder = await strapi.entityService.findOne('api::order.order', orderId, {
          populate: ['lots']
        });

        // Calculate TOTAL allocated quantity
        let totalAllocated = 0;
        if (currentOrder.lotAllocations) {
          try {
            const allocations = typeof currentOrder.lotAllocations === 'string'
              ? JSON.parse(currentOrder.lotAllocations)
              : currentOrder.lotAllocations;

            if (Array.isArray(allocations)) {
              totalAllocated = allocations.reduce((sum, alloc) => sum + (parseFloat(alloc.quantity) || 0), 0);
            }
          } catch (e) {
            console.error('Error parsing allocations for auto-ready check:', e);
          }
        }

        const orderQuantity = parseFloat(currentOrder.quantity) || 0;
        console.log(`🔍 Auto-Ready Check: Status=${data.deliveryDateStatus}, TotalAllocated=${totalAllocated}, OrderQty=${orderQuantity}`);

        // ONLY set to ready if fully allocated
        if (totalAllocated >= orderQuantity && totalAllocated > 0) {
          data.orderStatus = 'ready';
          data.readyBy = ctx.state.user?.username || ctx.state.user?.email || 'System';
          data.readyAt = new Date();
          console.log(`📦 Auto-updating order to READY via generic update (Date confirmed + Fully Allocated)`);
        } else {
          console.log(`⚠️ Order NOT ready: Quantity mismatch or zero (${totalAllocated}/${orderQuantity})`);
        }
      }

      const entity = await strapi.entityService.update('api::order.order', orderId, {
        data: data,
        populate: ['recipe', 'cargoCompany', 'lots'],
      });

      console.log('Order updated successfully');

      // Emit Socket.IO event for real-time updates
      const socketIO = require('../../../extensions/socket');
      socketIO.emitOrderUpdated(entity);

      return this.transformResponse(entity);
    } catch (error) {
      console.error('Update order error:', error);
      strapi.log.error('Update order error:', error);
      return ctx.badRequest(error.message);
    }
  },

  /**
   * Override create to handle lot-based inventory allocation
   */
  async create(ctx) {
    // Use console.log instead of strapi.log
    console.log('=== Order Create Request (LOT-BASED) ===');
    console.log('ctx.request.body:', ctx.request.body);
    console.log('ctx.request.body JSON:', JSON.stringify(ctx.request.body));

    const { data } = ctx.request.body || {};

    console.log('Extracted data:', data);
    console.log('Data JSON:', JSON.stringify(data));

    if (!data) {
      console.error('No data in request body!');
      return ctx.badRequest('No data provided');
    }

    try {
      const recipeId = data.recipe;
      const orderQuantity = parseFloat(data.quantity);

      console.log('Recipe ID:', recipeId);
      console.log('Order quantity:', orderQuantity);

      if (!recipeId) {
        return ctx.badRequest('Recipe is required');
      }

      // Verify recipe exists
      const recipe = await strapi.db.query('api::recipe.recipe').findOne({
        where: { documentId: recipeId }
      });
      console.log('Recipe found:', recipe ? `Yes (${recipe.name}, id: ${recipe.id})` : 'No');

      if (!recipe) {
        return ctx.badRequest(`Recipe with documentId ${recipeId} not found`);
      }

      let allocationResult;

      // For production-only orders, skip lot allocation entirely
      if (data.fulfillmentMethod === 'to_be_produced') {
        console.log('📝 Production-only order - skipping lot allocation');
        allocationResult = {
          success: true,
          allocations: [],
          insufficientStock: false,
          isProductionOnly: true // Flag to indicate no lots should be allocated
        };
      } else if (data.manualLotSelection && Array.isArray(data.manualLotSelection)) {
        console.log('Using manual lot selection:', data.manualLotSelection);

        const allocations = [];
        let totalAllocated = 0;
        let hasInsufficientStock = false;
        let insufficientMessage = '';

        // Process each lot allocation (now with specific quantities)
        for (const allocation of data.manualLotSelection) {
          const lotNumber = allocation.lotNumber;
          const requestedQty = parseFloat(allocation.quantity);

          const lot = await strapi.db.query('api::lot.lot').findOne({
            where: { lotNumber: lotNumber }
          });

          if (!lot) {
            console.warn(`Lot ${lotNumber} not found - will create planned order`);
            hasInsufficientStock = true;
            insufficientMessage = `Lot ${lotNumber} not found`;
            continue;
          }

          if (requestedQty > lot.currentQuantity) {
            console.warn(`Lot ${lotNumber}: Requested ${requestedQty} but only ${lot.currentQuantity} available - will create planned order`);
            hasInsufficientStock = true;
            insufficientMessage = `Lot ${lotNumber}: Requested ${requestedQty} but only ${lot.currentQuantity} available`;
            continue;
          }

          const unitCost = lot.averageUnitCost || lot.unitCost || 0;
          allocations.push({
            lotId: lot.id,
            lotNumber: lot.lotNumber,
            quantity: requestedQty,
            cost: unitCost,
            totalCost: unitCost * requestedQty
          });

          totalAllocated += requestedQty;
        }

        // Check if this is a mixed fulfillment order (karma mode)
        const isMixedFulfillment = data.fulfillmentMethod === 'mixed';

        // If insufficient stock or allocations don't match, mark as planned
        // UNLESS it's mixed fulfillment mode where partial allocation is expected
        if (hasInsufficientStock || (totalAllocated !== orderQuantity && !isMixedFulfillment)) {
          console.log('⚠️ Manual lot selection has insufficient stock - will create as PLANNED order');
          allocationResult = {
            success: true,
            allocations: [],
            insufficientStock: true,
            message: insufficientMessage || `Total allocated quantity (${totalAllocated}) does not match order quantity (${orderQuantity})`
          };
        } else {
          // In mixed mode, accept partial allocations
          if (isMixedFulfillment && totalAllocated < orderQuantity) {
            console.log(`✓ Mixed fulfillment: ${totalAllocated} from stock, ${orderQuantity - totalAllocated} to be produced`);
          }
          allocationResult = {
            success: true,
            allocations: allocations,
            insufficientStock: false
          };
        }

        console.log('Manual lot allocations:', allocationResult);
      } else {
        // Allocate lots using FIFO strategy
        console.log('Allocating lots using FIFO for order...');
        allocationResult = await strapi.service('api::lot.lot').allocateLots(recipe.id, orderQuantity);

        if (!allocationResult.success) {
          console.log('⚠️ Insufficient stock for order - will create as PLANNED order');
          console.log('Allocation result:', allocationResult.message);

          // Allow order creation but with planned status and no lot allocations
          allocationResult = {
            success: true,
            allocations: [],
            insufficientStock: true,
            message: allocationResult.message
          };
        } else {
          console.log('Lots allocated successfully:', allocationResult.allocations.length, 'lots');
        }
      }

      // Clean up empty strings and prepare data
      const cleanData = { ...data };
      if (cleanData.customerContact === '') delete cleanData.customerContact;
      if (cleanData.notes === '') delete cleanData.notes;
      if (cleanData.orderCreatedBy === '') delete cleanData.orderCreatedBy;
      delete cleanData.recipe; // Remove recipe from data, we'll link it separately
      delete cleanData.manualLotSelection; // Remove manual lot selection (already processed)

      // If insufficient stock, set order status to 'planned'
      if (allocationResult.insufficientStock) {
        console.log('📝 Setting order status to PLANNED due to insufficient stock');
        cleanData.orderStatus = 'planned';
        cleanData.notes = cleanData.notes
          ? `${cleanData.notes}\n\n⚠️ Insufficient stock: ${allocationResult.message}`
          : `⚠️ Insufficient stock: ${allocationResult.message}`;
      } else if (allocationResult.allocations && allocationResult.allocations.length > 0 && !allocationResult.isProductionOnly) {
        // Add allocation tracking metadata only if lots were actually allocated
        // Don't set for production-only orders where no lots are allocated
        cleanData.lotsAllocatedBy = cleanData.orderCreatedBy || 'System';
        cleanData.lotsAllocatedAt = new Date();
      }

      // Add lot allocations to order data
      cleanData.lotAllocations = JSON.stringify(allocationResult.allocations);

      // Calculate subcontractor pricing based on selected price type
      const priceType = data.priceType || 'bayi';
      const manufacturingCost = parseFloat(recipe.manufacturingCost) || 0;
      let selectedPrice = 0;
      
      // Get the selected price tier from recipe
      if (priceType === 'bayi') {
        selectedPrice = parseFloat(recipe.bayiFiyati) || 0;
      } else if (priceType === 'son_kullanici') {
        selectedPrice = parseFloat(recipe.sonKullaniciFiyati) || 0;
      } else if (priceType === 'yurtdisi') {
        selectedPrice = parseFloat(recipe.yurtdisiFiyati) || 0;
      }
      
      // Calculate subcontractor cost: (Selected Price - Manufacturing Cost) + 30% markup
      let subcontractorCostPerUnit = 0;
      if (selectedPrice > 0 && manufacturingCost > 0) {
        const difference = selectedPrice - manufacturingCost;
        subcontractorCostPerUnit = difference + (difference * 0.30); // +30% markup
        console.log(`🏭 Subcontractor pricing - Price: ${selectedPrice}, Manufacturing: ${manufacturingCost}, Difference: ${difference}, +30%: ${subcontractorCostPerUnit.toFixed(2)}`);
      }
      
      cleanData.subcontractorCost = subcontractorCostPerUnit * orderQuantity;
      console.log(`🏭 Total subcontractor cost for ${orderQuantity} units: ${cleanData.subcontractorCost.toFixed(2)}`);

      // Recalculate totalCost from lot allocations - cost should be based on selected lots
      if (allocationResult.allocations && allocationResult.allocations.length > 0) {
        const totalCostFromLots = allocationResult.allocations.reduce((sum, alloc) => sum + (alloc.totalCost || 0), 0);
        cleanData.totalCost = totalCostFromLots;
        const allocatedQuantity = allocationResult.allocations.reduce((sum, alloc) => sum + parseFloat(alloc.quantity), 0);
        console.log(`💰 Order creation - Allocated ${allocatedQuantity} items from lots, totalCost from lots: $${totalCostFromLots.toFixed(2)}`);
        console.log(`💰 Final prices - Cost: $${totalCostFromLots.toFixed(2)}, Selling: $${data.totalSellingPrice?.toFixed(2) || 0}, Profit: $${data.totalProfit?.toFixed(2) || 0}`);
      }

      // For mixed fulfillment, calculate and store stock vs production quantities
      if (data.fulfillmentMethod === 'mixed' && allocationResult.allocations.length > 0) {
        const totalFromStock = allocationResult.allocations.reduce((sum, alloc) => sum + parseFloat(alloc.quantity), 0);
        cleanData.quantityFromStock = totalFromStock;
        cleanData.quantityToBeProduced = orderQuantity - totalFromStock;
        console.log(`📦 Mixed fulfillment quantities - From stock: ${totalFromStock}, To be produced: ${cleanData.quantityToBeProduced}`);
      } else if (data.fulfillmentMethod === 'from_stock') {
        cleanData.quantityFromStock = orderQuantity;
        cleanData.quantityToBeProduced = 0;
      } else if (data.fulfillmentMethod === 'to_be_produced') {
        cleanData.quantityFromStock = 0;
        cleanData.quantityToBeProduced = orderQuantity;
      }

      console.log('Cleaned data (without recipe):', JSON.stringify(cleanData));

      // Auto-generate order number if missing
      if (!cleanData.orderNumber || cleanData.orderNumber.trim() === '') {
        const date = new Date();
        const yy = String(date.getFullYear()).slice(2);
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const prefix = `S${yy}${mm}${dd}`;

        const count = await strapi.db.query('api::order.order').count({
          where: {
            orderNumber: { $startsWith: prefix }
          }
        });

        const seq = String(count + 1).padStart(3, '0');
        cleanData.orderNumber = `${prefix}${seq}`;
        console.log(`🔢 Auto-generated order number: ${cleanData.orderNumber} (Count: ${count})`);
      }

      // Create order without relation first
      const entity = await strapi.db.query('api::order.order').create({
        data: {
          ...cleanData,
          documentId: require('crypto').randomUUID().replace(/-/g, '').substring(0, 24),
          publishedAt: new Date(),
        },
      });

      console.log('Order created with id:', entity.id, 'documentId:', entity.documentId);

      // Now link the recipe relation using the link table
      await strapi.db.connection.raw(
        'INSERT INTO orders_recipe_lnk (order_id, recipe_id) VALUES (?, ?)',
        [entity.id, recipe.id]
      );

      console.log('Recipe linked to order');

      // Link lot relations (only if there are allocations)
      if (allocationResult.allocations && allocationResult.allocations.length > 0) {
        for (const allocation of allocationResult.allocations) {
          await strapi.db.connection.raw(
            'INSERT INTO orders_lots_lnk (order_id, lot_id) VALUES (?, ?)',
            [entity.id, allocation.lotId]
          );
        }
        console.log('Lots linked to order');
      } else {
        console.log('No lots to link (insufficient stock - order marked as planned)');
      }

      // Fetch the complete order with recipe and lots
      const completeOrder = await strapi.db.query('api::order.order').findOne({
        where: { id: entity.id },
        populate: ['recipe', 'lots'],
      });

      console.log('Order created successfully with ID:', completeOrder.id);

      // Emit Socket.IO event with complete order data
      const socketIO = require('../../../extensions/socket');
      socketIO.emitOrderCreated(completeOrder);

      // Note: Stock deduction from lots happens when order status changes to 'ready' in lifecycle

      return this.transformResponse(completeOrder);
    } catch (error) {
      console.error('Create order error:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error details:', JSON.stringify(error.details, null, 2));

      // If it's a validation error, log more details
      if (error.details && error.details.errors) {
        error.details.errors.forEach((err, idx) => {
          console.error(`Validation error ${idx + 1}:`, {
            path: err.path,
            message: err.message,
            name: err.name,
            value: err.value
          });
        });
      }

      strapi.log.error('Create order error:', error);
      return ctx.badRequest(error.message);
    }
  },

  /**
   * Custom action to refresh tracking status from cargo company website
   */
  async refreshTracking(ctx) {
    try {
      const { id } = ctx.params;

      if (!id) {
        return ctx.badRequest('Order ID is required');
      }

      // Handle both numeric id and documentId
      let orderId = id;

      if (isNaN(id)) {
        const order = await strapi.db.query('api::order.order').findOne({
          where: { documentId: id },
        });

        if (!order) {
          return ctx.notFound('Order not found');
        }

        orderId = order.id;
      }

      const result = await strapi.service('api::order.order').updateTrackingStatus(orderId);

      if (!result.success) {
        return ctx.send({
          message: result.message || 'Takip bilgisi alınamadı',
          data: result,
        }, 200);
      }

      return ctx.send({
        message: 'Tracking status updated successfully',
        data: result,
      });
    } catch (error) {
      strapi.log.error('Refresh tracking error:', error);
      return ctx.send({
        message: 'Takip bilgisi alınamadı',
        error: error.message
      }, 200);
    }
  },

  /**
   * Approve delivery date and create batch if needed
   */
  async approveDeliveryDate(ctx) {
    try {
      const { id } = ctx.params;
      const {
        approvedBy,
        fulfillmentMethod,
        quantityFromStock,
        quantityToBeProduced,
        fulfillmentNotes
      } = ctx.request.body || {};

      console.log('=== Approve Delivery Date Request ===');
      console.log('Order ID:', id);
      console.log('Fulfillment method:', fulfillmentMethod);
      console.log('From stock:', quantityFromStock);
      console.log('To be produced:', quantityToBeProduced);

      // Handle both numeric id and documentId
      let orderId = id;
      if (isNaN(id)) {
        const order = await strapi.db.query('api::order.order').findOne({
          where: { documentId: id },
          populate: ['recipe'],
        });
        if (!order) {
          return ctx.notFound('Order not found');
        }
        orderId = order.id;
      }

      // Get the order
      const order = await strapi.entityService.findOne('api::order.order', orderId, {
        populate: ['recipe'],
      });

      if (!order) {
        return ctx.notFound('Order not found');
      }

      const updateData = {
        deliveryDateStatus: 'approved',
        deliveryDateApprovedBy: approvedBy,
        deliveryDateApprovedAt: new Date(),
        fulfillmentMethod: fulfillmentMethod || 'to_be_produced',
        quantityFromStock: parseFloat(quantityFromStock) || 0,
        quantityToBeProduced: parseFloat(quantityToBeProduced) || 0,
        remainingQuantity: parseFloat(order.quantity),
        fulfillmentStatus: 'not_fulfilled',
        fulfillmentNotes: fulfillmentNotes || '',
      };

      // Determine order status based on production needs and lot allocations
      const qtyToBeProduced = parseFloat(quantityToBeProduced) || 0;

      // Check if lots are already allocated
      let hasLotAllocations = false;
      if (order.lotAllocations) {
        try {
          const allocations = typeof order.lotAllocations === 'string'
            ? JSON.parse(order.lotAllocations)
            : order.lotAllocations;
          hasLotAllocations = Array.isArray(allocations) && allocations.length > 0;
        } catch (e) {
          console.error('Error parsing lotAllocations:', e);
        }
      }

      if (qtyToBeProduced > 0) {
        // Production is needed - set to 'planned'
        updateData.orderStatus = 'planned';
        console.log(`📝 Setting order status to 'planned' - production needed: ${qtyToBeProduced} units`);
      } else if (hasLotAllocations && fulfillmentMethod === 'from_stock') {
        // No production needed and lots are already allocated - set to 'ready'
        updateData.orderStatus = 'ready';
        // Set ready details automatically
        updateData.readyBy = approvedBy;
        updateData.readyAt = updateData.deliveryDateApprovedAt;
        console.log(`📝 Setting order status to 'ready' - lots already allocated, no production needed (Auto-confirmed)`);
      } else {
        // No production needed but lots not yet allocated - stay in 'approved'
        updateData.orderStatus = 'approved';
        console.log(`📝 Setting order status to 'approved' - waiting for lot allocation`);
      }

      // If production is needed, create a batch
      const linkedBatches = [];
      if (qtyToBeProduced > 0 && order.confirmedDeliveryDate) {
        try {
          // Generate batch number
          const batchCount = await strapi.db.query('api::batch.batch').count();
          const batchNumber = `BATCH-${new Date().getFullYear()}-${String(batchCount + 1).padStart(4, '0')}`;

          // Create batch
          const batch = await strapi.entityService.create('api::batch.batch', {
            data: {
              batchNumber: batchNumber,
              recipe: order.recipe.id,
              quantity: parseFloat(quantityToBeProduced),
              unit: order.recipe.unit || 'liter',
              batchStatus: 'planned',
              productionDate: order.confirmedDeliveryDate,
              totalCost: 0,
              notes: `Sipariş için otomatik oluşturuldu: ${order.orderNumber || order.id}`,
            },
          });

          linkedBatches.push({
            batchId: batch.id,
            batchNumber: batch.batchNumber,
            quantity: parseFloat(quantityToBeProduced),
            createdAt: new Date(),
          });

          console.log('Batch created:', batch.batchNumber);
        } catch (error) {
          console.error('Error creating batch:', error);
        }
      }

      updateData.linkedBatches = linkedBatches;

      // Update the order
      const updatedOrder = await strapi.entityService.update('api::order.order', orderId, {
        data: updateData,
        populate: ['recipe', 'cargoCompany', 'lots'],
      });

      // Emit Socket.IO event
      const socketIO = require('../../../extensions/socket');
      socketIO.emitOrderUpdated(updatedOrder);

      return this.transformResponse(updatedOrder);
    } catch (error) {
      console.error('Approve delivery date error:', error);
      strapi.log.error('Approve delivery date error:', error);
      return ctx.badRequest(error.message);
    }
  },

  /**
   * Ship partial or full quantity
   */
  async shipPartial(ctx) {
    try {
      const { id } = ctx.params;
      const {
        quantity,
        shippedBy,
        cargoCompany,
        trackingNumber,
        shipmentStatus,
        lotAllocations
      } = ctx.request.body || {};

      console.log('=== Ship Partial Request ===');
      console.log('Order ID:', id);
      console.log('Quantity:', quantity);

      // Handle both numeric id and documentId
      let orderId = id;
      if (isNaN(id)) {
        const order = await strapi.db.query('api::order.order').findOne({
          where: { documentId: id },
        });
        if (!order) {
          return ctx.notFound('Order not found');
        }
        orderId = order.id;
      }

      // Get the order
      const order = await strapi.entityService.findOne('api::order.order', orderId, {
        populate: ['recipe', 'cargoCompany'],
      });

      if (!order) {
        return ctx.notFound('Order not found');
      }

      const shipQuantity = parseFloat(quantity);
      const previousShipped = parseFloat(order.shippedQuantity) || 0;
      const totalOrdered = parseFloat(order.quantity);
      const newShippedQuantity = previousShipped + shipQuantity;
      const newRemainingQuantity = totalOrdered - newShippedQuantity;

      // Validate quantity
      if (newRemainingQuantity < -0.01) {
        return ctx.badRequest('Sevk edilen miktar siparişi aşıyor');
      }

      // DEDUCT INVENTORY FROM LOTS AT SHIPMENT TIME
      console.log('📦 Deducting inventory for shipped lots:', lotAllocations);

      if (lotAllocations && Array.isArray(lotAllocations) && lotAllocations.length > 0) {
        try {
          const orderInfo = {
            customerName: order.customerName,
            quantity: shipQuantity,
            notes: order.notes,
            shippedBy: shippedBy
          };

          await strapi.service('api::lot.lot').deductFromLots(lotAllocations, orderInfo);
          console.log('✓ Successfully deducted inventory from lots at shipment time');
        } catch (error) {
          console.error('Error deducting inventory during partial shipment:', error);
          return ctx.badRequest(`Stok düşülemedi: ${error.message}`);
        }
      } else {
        console.warn('⚠️ No lot allocations provided for partial shipment');
        return ctx.badRequest('Lot allocations are required for partial shipment');
      }

      // Add to partial shipments array
      // Ensure partialShipments is always an array
      const partialShipments = Array.isArray(order.partialShipments)
        ? order.partialShipments
        : [];
      partialShipments.push({
        quantity: shipQuantity,
        shippedBy: shippedBy,
        shippedAt: new Date(),
        cargoCompany: cargoCompany,
        trackingNumber: trackingNumber,
        shipmentStatus: shipmentStatus || 'yolda',
        lotAllocations: lotAllocations || [],
      });

      // Determine fulfillment status and order status
      let fulfillmentStatus = 'partially_fulfilled';
      let orderStatus = 'ready'; // Keep as ready during partial shipments

      if (newRemainingQuantity < 0.01) {
        fulfillmentStatus = 'fully_fulfilled';
        orderStatus = 'shipped';
      }

      const updateData = {
        shippedQuantity: newShippedQuantity,
        remainingQuantity: newRemainingQuantity,
        partialShipments: partialShipments,
        fulfillmentStatus: fulfillmentStatus,
        orderStatus: orderStatus,
        shippedBy: shippedBy,
        shippedAt: new Date(),
      };

      // Update cargo info if provided
      if (cargoCompany) {
        updateData.cargoCompany = cargoCompany;
      }
      if (trackingNumber) {
        updateData.trackingNumber = trackingNumber;
      }
      if (shipmentStatus) {
        updateData.shipmentStatus = shipmentStatus;
      }

      // Update the order
      const updatedOrder = await strapi.entityService.update('api::order.order', orderId, {
        data: updateData,
        populate: ['recipe', 'cargoCompany', 'lots'],
      });

      // Emit Socket.IO event
      const socketIO = require('../../../extensions/socket');
      socketIO.emitOrderUpdated(updatedOrder);

      return this.transformResponse(updatedOrder);
    } catch (error) {
      console.error('Ship partial error:', error);
      strapi.log.error('Ship partial error:', error);
      return ctx.badRequest(error.message);
    }
  },

  /**
   * Allocate lots to an existing order (for planned orders)
   */
  async allocateLots(ctx) {
    try {
      const { id } = ctx.params;
      const { manualLotSelection } = ctx.request.body || {};

      console.log('=== Allocate Lots to Order Request ===');
      console.log('Order ID:', id);
      console.log('Manual lot selection:', manualLotSelection);

      // Handle both numeric id and documentId
      let orderId = id;
      if (isNaN(id)) {
        const order = await strapi.db.query('api::order.order').findOne({
          where: { documentId: id },
          populate: ['recipe'],
        });
        if (!order) {
          return ctx.notFound('Order not found');
        }
        orderId = order.id;
      }

      // Get the order
      const order = await strapi.entityService.findOne('api::order.order', orderId, {
        populate: ['recipe'],
      });

      if (!order) {
        return ctx.notFound('Order not found');
      }

      const orderQuantity = parseFloat(order.quantity);

      if (!manualLotSelection || !Array.isArray(manualLotSelection) || manualLotSelection.length === 0) {
        return ctx.badRequest('Manual lot selection is required');
      }

      // Process manual lot allocations
      const allocations = [];
      let totalAllocated = 0;
      let hasInsufficientStock = false;
      let insufficientMessage = '';

      // Fetch extraCost from database
      let extraCostPerUnit = 0;
      try {
        const extraCostEntry = await strapi.db.query('api::extra-cost.extra-cost').findOne({});
        extraCostPerUnit = parseFloat(extraCostEntry?.amount || 0);
        console.log(`📊 Extra cost per unit: $${extraCostPerUnit.toFixed(2)}`);
      } catch (error) {
        console.warn('Could not fetch extra cost, using 0:', error.message);
      }

      for (const allocation of manualLotSelection) {
        const lotNumber = allocation.lotNumber;
        const requestedQty = parseFloat(allocation.quantity);

        const lot = await strapi.db.query('api::lot.lot').findOne({
          where: { lotNumber: lotNumber }
        });

        if (!lot) {
          console.warn(`Lot ${lotNumber} not found`);
          hasInsufficientStock = true;
          insufficientMessage = `Lot ${lotNumber} not found`;
          continue;
        }

        if (requestedQty > lot.currentQuantity) {
          console.warn(`Lot ${lotNumber}: Requested ${requestedQty} but only ${lot.currentQuantity} available`);
          hasInsufficientStock = true;
          insufficientMessage = `Lot ${lotNumber}: Requested ${requestedQty} but only ${lot.currentQuantity} available`;
          continue;
        }

        const unitCost = lot.averageUnitCost || lot.unitCost || 0;
        // Add extraCost to unitCost before multiplying by quantity
        const unitCostWithExtra = unitCost + extraCostPerUnit;
        const lotTotalCost = unitCostWithExtra * requestedQty;

        console.log(`📊 Lot ${lotNumber} cost calculation:`, {
          averageUnitCost: lot.averageUnitCost,
          unitCost: lot.unitCost,
          extraCost: extraCostPerUnit,
          finalUnitCost: unitCost,
          unitCostWithExtra: unitCostWithExtra,
          quantity: requestedQty,
          totalCost: lotTotalCost
        });

        allocations.push({
          lotId: lot.id,
          lotNumber: lot.lotNumber,
          quantity: requestedQty,
          unitCost: unitCost,
          extraCost: extraCostPerUnit,
          cost: unitCostWithExtra, // This is used for backward compatibility
          totalCost: lotTotalCost
        });

        totalAllocated += requestedQty;
      }

      // Allow partial allocation for mixed fulfillment orders
      // Also allow if order was 'to_be_produced' - it will be converted to 'mixed'
      const isMixedFulfillment = order.fulfillmentMethod === 'mixed' || order.fulfillmentMethod === 'to_be_produced';

      if (hasInsufficientStock) {
        return ctx.badRequest(insufficientMessage);
      }

      if (totalAllocated > orderQuantity) {
        return ctx.badRequest(`Total allocated quantity (${totalAllocated}) exceeds order quantity (${orderQuantity})`);
      }

      if (totalAllocated < orderQuantity && !isMixedFulfillment) {
        return ctx.badRequest(`Total allocated quantity (${totalAllocated}) does not match order quantity (${orderQuantity})`);
      }

      // If order was 'to_be_produced' and we're allocating partial lots, convert to 'mixed'
      if (order.fulfillmentMethod === 'to_be_produced' && totalAllocated < orderQuantity) {
        console.log(`📝 Converting order from 'to_be_produced' to 'mixed' (allocating ${totalAllocated} from stock, ${orderQuantity - totalAllocated} to be produced)`);
      }

      console.log(`📊 Order packaging cost: $${order.packagingCost}, Profit margin: ${order.profitMargin}%`);

      // Recalculate totalCost from lot allocations - cost should be based on selected lots
      const totalCostFromLots = allocations.reduce((sum, alloc) => sum + (alloc.totalCost || 0), 0);
      const totalSellingPrice = order.totalSellingPrice;

      console.log(`💰 Cost calculation - Total from lots: $${totalCostFromLots.toFixed(2)}, Selling: $${totalSellingPrice.toFixed(2)}`);

      // NOTE: Stock deduction happens at SHIPMENT time, not allocation time
      // This allows proper tracking of inventory and supports partial shipments
      // See order lifecycle beforeUpdate for shipment-time deduction
      console.log('📦 Lots allocated - stock will be deducted at shipment time');

      // Update order with lot allocations
      const updateData = {
        lotAllocations: JSON.stringify(allocations),
        totalCost: totalCostFromLots, // Update cost based on allocated lots
        lotsAllocatedBy: ctx.state.user?.username || ctx.state.user?.email || 'System',
        lotsAllocatedAt: new Date()
      };

      // For mixed fulfillment or converting to mixed, update quantities and fulfillment method
      if (isMixedFulfillment && totalAllocated < orderQuantity) {
        updateData.fulfillmentMethod = 'mixed'; // Convert to mixed if partial allocation
        updateData.quantityFromStock = totalAllocated;
        updateData.quantityToBeProduced = orderQuantity - totalAllocated;
        updateData.orderStatus = 'planned'; // Keep as planned when production is still needed
        console.log(`📦 Mixed fulfillment update - From stock: ${totalAllocated}, To be produced: ${updateData.quantityToBeProduced}, Status: planned`);
      } else if (totalAllocated === orderQuantity) {
        // Full allocation
        // ALWAYS preserve the original fulfillmentMethod - user explicitly chose it
        // Don't convert to from_stock just because lots were allocated
        updateData.fulfillmentMethod = order.fulfillmentMethod;
        console.log(`📦 Preserving original fulfillment method '${order.fulfillmentMethod}' (user's choice) even though fully allocated`);

        updateData.quantityFromStock = orderQuantity;
        updateData.quantityToBeProduced = 0;

        // Only set to 'ready' if delivery date is approved OR confirmed, otherwise stay in 'pending'
        if (['approved', 'confirmed'].includes(order.deliveryDateStatus)) {
          updateData.orderStatus = 'ready';
          // Set ready details automatically
          updateData.readyBy = ctx.state.user?.username || ctx.state.user?.email || 'System';
          updateData.readyAt = new Date();
          console.log(`📦 Full allocation with approved/confirmed delivery date - Status: ready (Auto-confirmed)`);
        } else {
          updateData.orderStatus = 'pending';
          console.log(`📦 Full allocation but delivery date not approved/confirmed - Status: pending (waiting for delivery date)`);
        }
      }

      // Update the order
      console.log('📝 Updating order with data:', updateData);

      await strapi.db.query('api::order.order').update({
        where: { id: orderId },
        data: updateData
      });

      console.log('✅ Order updated successfully');

      // Link lot relations
      // First, remove existing lot links
      await strapi.db.connection.raw(
        'DELETE FROM orders_lots_lnk WHERE order_id = ?',
        [orderId]
      );

      // Then add new lot links
      for (const allocation of allocations) {
        await strapi.db.connection.raw(
          'INSERT INTO orders_lots_lnk (order_id, lot_id) VALUES (?, ?)',
          [orderId, allocation.lotId]
        );
      }

      console.log('Lots allocated successfully to order');

      // Fetch the updated order
      const updatedOrder = await strapi.db.query('api::order.order').findOne({
        where: { id: orderId },
        populate: ['recipe', 'lots'],
      });

      console.log('📤 Returning updated order:', {
        id: updatedOrder.id,
        totalCost: updatedOrder.totalCost,
        totalSellingPrice: updatedOrder.totalSellingPrice,
        totalProfit: updatedOrder.totalProfit
      });

      // Emit Socket.IO event
      const socketIO = require('../../../extensions/socket');
      socketIO.emitOrderUpdated(updatedOrder);

      return this.transformResponse(updatedOrder);
    } catch (error) {
      console.error('Allocate lots error:', error);
      strapi.log.error('Allocate lots error:', error);
      return ctx.badRequest(error.message);
    }
  },
}));
