const strapi = require('@strapi/strapi');

async function fixLotUnitCosts() {
  const appContext = await strapi.default().load();
  const db = appContext.db;

  try {
    console.log('Starting to fix lot unit costs...\n');

    // Get all lots that have $0 or null unit cost
    const lots = await db.query('api::lot.lot').findMany({
      where: {
        $or: [
          { unitCost: 0 },
          { unitCost: null }
        ]
      },
      populate: ['batch', 'recipe']
    });

    console.log(`Found ${lots.length} lots with missing unit costs\n`);

    let fixed = 0;
    let skipped = 0;

    for (const lot of lots) {
      if (!lot.batch) {
        console.log(`⚠️  Lot ${lot.lotNumber}: No batch found, skipping`);
        skipped++;
        continue;
      }

      const batch = lot.batch;
      
      // Calculate unit cost from batch
      let unitCost = 0;
      if (batch.totalCost && batch.quantity && batch.quantity > 0) {
        unitCost = parseFloat(batch.totalCost) / parseFloat(batch.quantity);
      } else if (lot.totalCost && lot.initialQuantity && lot.initialQuantity > 0) {
        // Fallback: calculate from lot's total cost
        unitCost = parseFloat(lot.totalCost) / parseFloat(lot.initialQuantity);
      }

      if (unitCost > 0) {
        // Update the lot
        await db.query('api::lot.lot').update({
          where: { id: lot.id },
          data: { 
            unitCost: unitCost,
            totalCost: unitCost * parseFloat(lot.initialQuantity)
          }
        });

        console.log(`✓ Lot ${lot.lotNumber}: Set unitCost to $${unitCost.toFixed(4)} (batch ${batch.batchNumber})`);
        fixed++;
      } else {
        console.log(`⚠️  Lot ${lot.lotNumber}: Could not calculate unit cost (batch ${batch.batchNumber})`);
        skipped++;
      }
    }

    console.log(`\n=== Summary ===`);
    console.log(`Fixed: ${fixed} lots`);
    console.log(`Skipped: ${skipped} lots`);
    console.log(`Total: ${lots.length} lots`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await appContext.destroy();
  }
}

fixLotUnitCosts();
