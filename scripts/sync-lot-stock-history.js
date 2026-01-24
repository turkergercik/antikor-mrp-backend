/**
 * Sync script to fix discrepancies between Lot system and Stock History
 * Finds lots that are depleted but still have balance in Stock History
 */

require('dotenv').config();
const { Client } = require('pg');

async function syncLotStockHistory() {
  const client = new Client({
    host: process.env.DATABASE_HOST || 'localhost',
    port: process.env.DATABASE_PORT || 5432,
    user: process.env.DATABASE_USERNAME || 'postgres',
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME || 'antigenix',
    ssl: process.env.DATABASE_SSL === 'true' ? {
      rejectUnauthorized: false
    } : false
  });

  try {
    await client.connect();
    console.log('=== Starting Lot to Stock History Sync ===\n');

    // Get all lots with their recipes
    const lotsResult = await client.query(`
      SELECT 
        l.id, l.lot_number, l.current_quantity, l.unit, l.status,
        r.id as recipe_id, r.code as recipe_code, r.name as recipe_name
      FROM lots l
      LEFT JOIN lots_recipe_lnk lr ON l.id = lr.lot_id
      LEFT JOIN recipes r ON lr.recipe_id = r.id
      ORDER BY l.lot_number
    `);
    
    const lots = lotsResult.rows;
    console.log(`Found ${lots.length} lots to check\n`);

    // Get all stock history records
    const historyResult = await client.query(`
      SELECT 
        id, sku, lot_number, transaction_type, quantity, unit
      FROM stock_histories
      ORDER BY created_at DESC
    `);
    
    const allHistory = historyResult.rows;

    // Build stock history summary by SKU and lot
    const stockHistoryByLot = {};
    allHistory.forEach(record => {
      const key = `${record.sku}-${record.lot_number}`;
      if (!stockHistoryByLot[key]) {
        stockHistoryByLot[key] = {
          transactions: [],
          currentBalance: 0
        };
      }
      stockHistoryByLot[key].transactions.push(record);
    });

    // Calculate current balance for each lot in stock history
    Object.keys(stockHistoryByLot).forEach(key => {
      const data = stockHistoryByLot[key];
      data.currentBalance = data.transactions.reduce((balance, t) => {
        if (['purchase', 'production', 'return'].includes(t.transaction_type)) {
          return balance + parseFloat(t.quantity || 0);
        } else if (['usage', 'sale', 'waste', 'imha'].includes(t.transaction_type)) {
          return balance - parseFloat(t.quantity || 0);
        } else if (t.transaction_type === 'adjustment') {
          return balance - parseFloat(t.quantity || 0);
        }
        return balance;
      }, 0);
    });

    let syncedCount = 0;
    let skippedCount = 0;

    // Check each lot
    for (const lot of lots) {
      const lotKey = `${lot.recipe_code || lot.recipe_name}-${lot.lot_number}`;
      const stockHistoryData = stockHistoryByLot[lotKey];

      if (!stockHistoryData) {
        console.log(`⚠️  Lot ${lot.lot_number} (${lot.recipe_name}): No stock history found, skipping`);
        skippedCount++;
        continue;
      }

      const lotQuantity = parseFloat(lot.current_quantity || 0);
      const stockHistoryBalance = stockHistoryData.currentBalance;

      // Check for discrepancy
      if (Math.abs(lotQuantity - stockHistoryBalance) > 0.01) {
        console.log(`\n🔧 DISCREPANCY FOUND:`);
        console.log(`   Lot: ${lot.lot_number} (${lot.recipe_name})`);
        console.log(`   Lot currentQuantity: ${lotQuantity}`);
        console.log(`   Stock History balance: ${stockHistoryBalance}`);
        console.log(`   Difference: ${stockHistoryBalance - lotQuantity}`);

        // Create adjustment transaction to sync
        const difference = stockHistoryBalance - lotQuantity;
        
        if (difference > 0) {
          // Stock history has more than lot, need to deduct
          console.log(`   Creating 'usage' transaction to deduct ${difference}...`);
          
          await client.query(`
            INSERT INTO stock_histories (
              sku, lot_number, transaction_type, quantity, unit,
              notes, performed_by, current_balance, price_per_unit, total_cost, currency,
              created_at, updated_at, published_at, document_id, locale
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW(), NOW(), gen_random_uuid(), 'en')
          `, [
            lot.recipe_code || lot.recipe_name,
            lot.lot_number,
            'usage',
            difference,
            lot.unit || 'piece',
            'Auto-sync: Lot depleted/used, syncing with actual lot quantity',
            'system-sync',
            lotQuantity,
            0,
            0,
            'USD'
          ]);
          
          console.log(`   ✓ Synced successfully`);
          syncedCount++;
        } else {
          // Lot has more than stock history, need to add
          console.log(`   Creating 'return' transaction to add ${Math.abs(difference)}...`);
          
          await client.query(`
            INSERT INTO stock_histories (
              sku, lot_number, transaction_type, quantity, unit,
              notes, performed_by, current_balance, price_per_unit, total_cost, currency,
              created_at, updated_at, published_at, document_id, locale
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW(), NOW(), gen_random_uuid(), 'en')
          `, [
            lot.recipe_code || lot.recipe_name,
            lot.lot_number,
            'return',
            Math.abs(difference),
            lot.unit || 'piece',
            'Auto-sync: Adjusting stock history to match lot quantity',
            'system-sync',
            lotQuantity,
            0,
            0,
            'USD'
          ]);
          
          console.log(`   ✓ Synced successfully`);
          syncedCount++;
        }
      }
    }

    console.log(`\n=== Sync Complete ===`);
    console.log(`Total lots checked: ${lots.length}`);
    console.log(`Synced: ${syncedCount}`);
    console.log(`Skipped: ${skippedCount}`);
    console.log(`No changes needed: ${lots.length - syncedCount - skippedCount}`);

  } catch (error) {
    console.error('Sync error:', error);
  } finally {
    await client.end();
    process.exit(0);
  }
}

syncLotStockHistory();
