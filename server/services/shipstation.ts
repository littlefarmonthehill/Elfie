import { db } from "../db";
import { orders, orderDetails, syncMetadata } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface ShipStationSyncResult {
  ordersAdded: number;
  ordersUpdated: number;
  orderDetailsAdded: number;
  totalApiCalls: number;
}

async function shipStationRequest(endpoint: string): Promise<any> {
  const apiKey = process.env.SHIPSTATION_API_KEY || '';
  const apiSecret = process.env.SHIPSTATION_API_SECRET || '';
  
  if (!apiKey || !apiSecret) {
    throw new Error('ShipStation credentials not configured. Please add them in Settings.');
  }
  
  const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
  
  const response = await fetch(`https://ssapi.shipstation.com${endpoint}`, {
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`ShipStation API error: ${response.statusText}`);
  }

  return await response.json();
}

// Helper function to extract marketplace/platform from ShipStation order data
function extractMarketplace(order: any, debug: boolean = false): string | null {
  const orderId = order.orderId || 'unknown';
  
  // Priority 1: Check advancedOptions.source (most reliable when present)
  if (order.advancedOptions?.source) {
    const source = order.advancedOptions.source.trim();
    // Normalize common variations
    if (source.toLowerCase().includes('bricklink')) {
      if (debug) console.log(`[Marketplace] Order ${orderId}: BrickLink (from source field)`);
      return 'BrickLink';
    }
    if (source.toLowerCase().includes('brickowl') || source.toLowerCase().includes('brick owl')) {
      if (debug) console.log(`[Marketplace] Order ${orderId}: BrickOwl (from source field)`);
      return 'BrickOwl';
    }
    if (source.toLowerCase().includes('ebay')) {
      if (debug) console.log(`[Marketplace] Order ${orderId}: eBay (from source field)`);
      return 'eBay';
    }
    if (source.toLowerCase().includes('amazon')) {
      if (debug) console.log(`[Marketplace] Order ${orderId}: Amazon (from source field)`);
      return 'Amazon';
    }
    if (source.toLowerCase().includes('etsy')) {
      if (debug) console.log(`[Marketplace] Order ${orderId}: Etsy (from source field)`);
      return 'Etsy';
    }
    if (debug) console.log(`[Marketplace] Order ${orderId}: ${source} (from source field)`);
    return source; // Use as-is if it's something else
  }
  
  // Priority 2: Check custom fields (some stores map marketplace here)
  const customFields = [
    order.advancedOptions?.customField1,
    order.advancedOptions?.customField2,
    order.advancedOptions?.customField3
  ].filter(f => f && f.trim());
  
  for (const field of customFields) {
    const lower = field.toLowerCase();
    if (lower.includes('bricklink') || lower === 'bl') return 'BrickLink';
    if (lower.includes('brickowl') || lower === 'bo') return 'BrickOwl';
    if (lower.includes('ebay')) return 'eBay';
    if (lower.includes('amazon') || lower === 'amzn') return 'Amazon';
    if (lower.includes('etsy')) return 'Etsy';
  }
  
  // Priority 3: Analyze orderNumber patterns
  if (order.orderNumber) {
    const orderNum = order.orderNumber.trim();
    
    // Explicit prefix patterns
    if (orderNum.match(/^BL\./i)) return 'BrickLink';
    if (orderNum.match(/^BO\./i)) return 'BrickOwl';
    if (orderNum.match(/^LBS/i)) return 'eBay';
    
    // BrickLink legacy: 7-8 digit numeric
    if (orderNum.match(/^\d{7,8}$/)) return 'BrickLink';
    
    // Amazon: XXX-XXXXXXX-XXXXXXX pattern
    if (orderNum.match(/^\d{3}-\d{7}-\d{7}$/)) return 'Amazon';
    
    // eBay: XX-XXXXX-XXXXX pattern
    if (orderNum.match(/^\d{2}-\d{5}-\d{5}$/)) return 'eBay';
    
    // Long numeric with hyphens (often eBay or other marketplace)
    if (orderNum.match(/^\d{12}-\d{13}$/)) return 'eBay';
  }
  
  // Priority 4: Analyze orderKey patterns
  if (order.orderKey) {
    const orderKey = order.orderKey.trim();
    
    if (orderKey.match(/^BL\./i)) return 'BrickLink';
    if (orderKey.match(/^BO\./i)) return 'BrickOwl';
    
    // Platform prefix with hyphen (EBAY-123, AMZN-456)
    const match = orderKey.match(/^([A-Z]+)-/);
    if (match) {
      const prefix = match[1].toUpperCase();
      const platformMap: { [key: string]: string } = {
        'EBAY': 'eBay',
        'AMZN': 'Amazon',
        'ETSY': 'Etsy',
        'FB': 'Facebook Marketplace',
        'SHOPIFY': 'Shopify',
      };
      if (platformMap[prefix]) return platformMap[prefix];
    }
  }
  
  // Priority 5: Analyze customer email domain (quality assumption)
  if (order.customerEmail) {
    const email = order.customerEmail.toLowerCase();
    
    // BrickLink notifications come from specific domains
    if (email.includes('@bricklink.com') || email.includes('bricklink')) return 'BrickLink';
    if (email.includes('@brickowl.com') || email.includes('brickowl')) return 'BrickOwl';
    
    // Marketplace notification patterns
    if (email.includes('@ebay.com') || email.includes('@marketplace.ebay')) return 'eBay';
    if (email.includes('@amazon.com') || email.includes('@marketplace.amazon')) return 'Amazon';
    if (email.includes('@etsy.com')) return 'Etsy';
  }
  
  // Priority 6: Analyze shipping service/carrier patterns (quality assumption)
  const shippingService = order.requestedShippingService?.toLowerCase() || '';
  const carrierCode = order.carrierCode?.toLowerCase() || '';
  
  // BrickLink typically uses specific shipping methods
  if (shippingService.includes('bricklink') || carrierCode.includes('bricklink')) {
    return 'BrickLink';
  }
  
  // Priority 7: Check storeId or marketplaceId fields if available
  if (order.advancedOptions?.storeId) {
    const storeId = order.advancedOptions.storeId.toString().toLowerCase();
    if (storeId.includes('bricklink') || storeId.includes('bl')) return 'BrickLink';
    if (storeId.includes('brickowl') || storeId.includes('bo')) return 'BrickOwl';
    if (storeId.includes('ebay')) return 'eBay';
    if (storeId.includes('amazon')) return 'Amazon';
  }
  
  // Priority 8: Analyze internal notes for marketplace mentions (last resort)
  const internalNotes = order.internalNotes?.toLowerCase() || '';
  const customerNotes = order.customerNotes?.toLowerCase() || '';
  const combinedNotes = internalNotes + ' ' + customerNotes;
  
  if (combinedNotes.includes('bricklink order') || combinedNotes.includes('from bricklink')) return 'BrickLink';
  if (combinedNotes.includes('brickowl order') || combinedNotes.includes('from brickowl')) return 'BrickOwl';
  if (combinedNotes.includes('ebay order') || combinedNotes.includes('from ebay')) return 'eBay';
  if (combinedNotes.includes('amazon order') || combinedNotes.includes('from amazon')) return 'Amazon';
  
  // Could not determine marketplace from any available field
  return null;
}

// Helper function to extract BrickLink data from ShipStation options
function extractBrickLinkData(options: any[]) {
  const result: { inventoryId?: number; colorId?: number; condition?: string } = {};
  
  if (!options || !Array.isArray(options)) return result;
  
  for (const option of options) {
    const name = option.name?.toLowerCase() || '';
    const value = option.value?.toString().trim() || '';
    
    // Try to find inventory ID
    if (name.includes('inventory') && !isNaN(parseInt(value))) {
      result.inventoryId = parseInt(value);
    }
    
    // Try to find color ID
    if (name.includes('color') && !isNaN(parseInt(value))) {
      result.colorId = parseInt(value);
    }
    
    // Try to find condition
    if (name.includes('condition') || name.includes('new') || name.includes('used')) {
      // Normalize to "New" or "Used"
      if (value.toLowerCase() === 'n' || value.toLowerCase() === 'new') {
        result.condition = 'New';
      } else if (value.toLowerCase() === 'u' || value.toLowerCase() === 'used') {
        result.condition = 'Used';
      } else {
        result.condition = value;
      }
    }
  }
  
  return result;
}

export async function syncShipStationOrders(fullSync: boolean = false): Promise<ShipStationSyncResult> {
  const syncId = 'shipstation_orders';
  
  try {
    console.log(`Starting ShipStation orders sync (${fullSync ? 'FULL' : 'incremental'})...`);
    
    // Check for existing sync metadata to determine if we should do full or incremental sync
    const [metadata] = await db.select().from(syncMetadata).where(eq(syncMetadata.id, syncId)).limit(1);
    
    let modifyDateStart: string;
    
    if (!metadata || !metadata.lastSyncTime || fullSync) {
      // No previous sync, first time, or forced full sync - do full historical sync (10 years)
      const tenYearsAgo = new Date();
      tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
      modifyDateStart = tenYearsAgo.toISOString();
      if (fullSync) {
        console.log('FULL SYNC requested - performing complete historical sync from:', modifyDateStart);
      } else {
        console.log('No previous sync found - performing full historical sync from:', modifyDateStart);
      }
    } else {
      // Incremental sync - fetch only orders modified since last successful sync
      // PostgreSQL returns timestamps as strings, so convert to Date first
      const lastSync = new Date(metadata.lastSyncTime);
      modifyDateStart = lastSync.toISOString();
      console.log('Previous sync found - performing incremental sync from:', modifyDateStart);
    }
    
    // Mark sync as in progress
    if (metadata) {
      await db.update(syncMetadata)
        .set({ lastSyncStatus: 'in_progress', updatedAt: new Date() })
        .where(eq(syncMetadata.id, syncId));
    } else {
      await db.insert(syncMetadata).values({
        id: syncId,
        lastSyncTime: null,
        lastSyncStatus: 'in_progress',
      });
    }
    
    let allOrders: any[] = [];
    let currentPage = 1;
    let totalPages = 1;
    let apiCalls = 0;
    
    // Paginate through all orders from API
    while (currentPage <= totalPages) {
      const data = await shipStationRequest(`/orders?modifyDateStart=${modifyDateStart}&pageSize=500&page=${currentPage}`);
      apiCalls++;
      
      if (data.orders && data.orders.length > 0) {
        allOrders = allOrders.concat(data.orders);
      }
      
      totalPages = data.pages || 1;
      currentPage++;
      console.log(`Fetched page ${currentPage - 1}/${totalPages}: ${allOrders.length} orders total`);
    }
    
    console.log(`Received ${allOrders.length} total orders from ShipStation API`);
    
    if (allOrders.length === 0) {
      console.log('No orders to sync - updating metadata and returning');
      
      // Update sync metadata even when no orders found (to mark successful completion)
      const now = new Date();
      await db.update(syncMetadata)
        .set({
          lastSyncTime: now,
          lastSyncStatus: 'success',
          recordsAdded: 0,
          recordsUpdated: 0,
          errorMessage: null,
          updatedAt: now,
        })
        .where(eq(syncMetadata.id, syncId));
      
      return { ordersAdded: 0, ordersUpdated: 0, orderDetailsAdded: 0, totalApiCalls: apiCalls };
    }

    // Fetch all existing orders in one query
    const existingOrders = await db.select().from(orders);
    const existingOrdersMap = new Map(existingOrders.map(o => [o.id, o]));
    console.log(`Found ${existingOrders.length} existing orders in database`);
    
    // Separate into new and existing orders
    const newOrders = allOrders.filter(o => !existingOrdersMap.has(o.orderId.toString()));
    const ordersToCheck = allOrders.filter(o => existingOrdersMap.has(o.orderId.toString()));
    console.log(`Processing: ${newOrders.length} new orders, ${ordersToCheck.length} existing orders to check`);

    let ordersAdded = 0;
    let ordersUpdated = 0;
    let orderDetailsAdded = 0;

    // Batch insert new orders
    if (newOrders.length > 0) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < newOrders.length; i += BATCH_SIZE) {
        const batch = newOrders.slice(i, i + BATCH_SIZE);
        const values = batch.map(order => ({
          id: order.orderId.toString(),
          orderNumber: order.orderNumber,
          orderKey: order.orderKey,
          marketplace: extractMarketplace(order),
          orderDate: new Date(order.orderDate),
          orderStatus: order.orderStatus,
          customerUsername: order.shipTo?.name || order.customerUsername || 'Unknown Customer',
          customerEmail: order.customerEmail,
          shipTo: JSON.stringify(order.shipTo),
          orderTotal: (order.orderTotal?.toString().trim() || '0'),
          shippingAmount: (order.shippingAmount?.toString().trim() || '0'),
          taxAmount: (order.taxAmount?.toString().trim() || '0'),
        }));
        
        await db.insert(orders).values(values);
        ordersAdded += batch.length;
        console.log(`Inserted orders batch ${Math.floor(i / BATCH_SIZE) + 1}: ${ordersAdded}/${newOrders.length} new orders`);
      }
    }

    // Update orders where status changed, marketplace is missing, or during full sync
    for (let i = 0; i < ordersToCheck.length; i++) {
      const order = ordersToCheck[i];
      const orderId = order.orderId.toString();
      const existing = existingOrdersMap.get(orderId);
      const marketplace = extractMarketplace(order);
      
      // Update if: status changed, missing data, or full sync with new marketplace value
      const shouldUpdate = existing && (
        existing.orderStatus !== order.orderStatus || 
        !existing.customerUsername || 
        !existing.marketplace ||
        (fullSync && marketplace && marketplace !== existing.marketplace)
      );
      
      if (shouldUpdate) {
        await db.update(orders)
          .set({ 
            orderStatus: order.orderStatus,
            marketplace: marketplace || existing.marketplace,
            customerUsername: order.shipTo?.name || order.customerUsername || existing.customerUsername || 'Unknown Customer',
            customerEmail: order.customerEmail || existing.customerEmail,
            updatedAt: new Date() 
          })
          .where(eq(orders.id, orderId));
        ordersUpdated++;
      }
      
      // Progress update every 500 orders
      if ((i + 1) % 500 === 0 || i === ordersToCheck.length - 1) {
        console.log(`⏳ Checking orders: ${i + 1}/${ordersToCheck.length} (${ordersUpdated} updated so far)`);
      }
    }
    console.log(`✅ Updated ${ordersUpdated} orders${fullSync ? ' (full sync mode)' : ' with status changes'}`);


    // Process order details for all orders
    const allItems: any[] = [];
    const orderIdToItems = new Map<string, any[]>();
    
    for (const order of allOrders) {
      const orderId = order.orderId.toString();
      const items = order.items || [];
      orderIdToItems.set(orderId, items);
      
      for (const item of items) {
        const lineItemKey = item.lineItemKey || `${orderId}-${item.sku}`;
        const options = item.options || [];
        const description = item.description || null;
        
        // Debug logging for first 3 items to see what data is available
        if (allItems.length < 3) {
          console.log(`\n📦 DEBUG: ShipStation Item Data for "${item.name}":`);
          console.log(`   Description: ${description || 'none'}`);
          console.log(`   Options: ${options.length > 0 ? JSON.stringify(options) : 'none'}`);
          console.log(`   Custom Field 1: ${item.customField1 || 'none'}`);
          console.log(`   Custom Field 2: ${item.customField2 || 'none'}`);
          console.log(`   Custom Field 3: ${item.customField3 || 'none'}`);
        }
        
        const brickLinkData = extractBrickLinkData(options);
        
        allItems.push({
          orderId,
          lineItemKey,
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice?.toString() || '0',
          description,
          options: options.length > 0 ? JSON.stringify(options) : null,
          customField1: item.customField1 || null,
          customField2: item.customField2 || null,
          customField3: item.customField3 || null,
          bricklinkInventoryId: brickLinkData.inventoryId,
          colorId: brickLinkData.colorId,
          condition: brickLinkData.condition,
        });
      }
    }
    
    console.log(`Processing ${allItems.length} total order items`);
    
    // Fetch all existing order details
    const existingDetails = await db.select().from(orderDetails);
    const existingDetailsMap = new Map(existingDetails.map(d => [d.lineItemKey, d]));
    console.log(`Found ${existingDetails.length} existing order details in database`);
    
    // Separate into new and existing details
    const newDetails = allItems.filter(item => !existingDetailsMap.has(item.lineItemKey));
    const detailsToCheck = allItems.filter(item => existingDetailsMap.has(item.lineItemKey));
    console.log(`Processing: ${newDetails.length} new items, ${detailsToCheck.length} existing items to check`);
    
    // Batch insert new order details
    if (newDetails.length > 0) {
      const BATCH_SIZE = 1000;
      for (let i = 0; i < newDetails.length; i += BATCH_SIZE) {
        const batch = newDetails.slice(i, i + BATCH_SIZE);
        await db.insert(orderDetails).values(batch);
        orderDetailsAdded += batch.length;
        console.log(`Inserted order details batch ${Math.floor(i / BATCH_SIZE) + 1}: ${orderDetailsAdded}/${newDetails.length} new items`);
      }
    }
    
    // Update order details that changed
    let detailsUpdated = 0;
    for (let i = 0; i < detailsToCheck.length; i++) {
      const item = detailsToCheck[i];
      const existing = existingDetailsMap.get(item.lineItemKey);
      
      if (existing && (existing.quantity !== item.quantity || existing.unitPrice !== item.unitPrice)) {
        await db.update(orderDetails)
          .set({
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            updatedAt: new Date()
          })
          .where(eq(orderDetails.lineItemKey, item.lineItemKey));
        detailsUpdated++;
      }
      
      // Progress update every 1000 items
      if ((i + 1) % 1000 === 0 || i === detailsToCheck.length - 1) {
        console.log(`⏳ Checking items: ${i + 1}/${detailsToCheck.length} (${detailsUpdated} updated so far)`);
      }
    }
    console.log(`✅ Updated ${detailsUpdated} order details with quantity/price changes`);

    console.log(`ShipStation sync complete: ${ordersAdded} orders added, ${ordersUpdated} orders updated, ${orderDetailsAdded} items added`);

    // Update sync metadata with successful sync
    const now = new Date();
    await db.update(syncMetadata)
      .set({
        lastSyncTime: now,
        lastSyncStatus: 'success',
        recordsAdded: ordersAdded,
        recordsUpdated: ordersUpdated,
        errorMessage: null,
        updatedAt: now,
      })
      .where(eq(syncMetadata.id, syncId));

    console.log(`Sync metadata updated - next incremental sync will start from: ${now.toISOString()}`);

    return {
      ordersAdded,
      ordersUpdated,
      orderDetailsAdded,
      totalApiCalls: apiCalls,
    };
  } catch (error) {
    console.error('Error syncing ShipStation orders:', error);
    
    // Update sync metadata with failure
    try {
      await db.update(syncMetadata)
        .set({
          lastSyncStatus: 'failed',
          errorMessage: error instanceof Error ? error.message : String(error),
          updatedAt: new Date(),
        })
        .where(eq(syncMetadata.id, syncId));
    } catch (metadataError) {
      console.error('Failed to update sync metadata:', metadataError);
    }
    
    throw error;
  }
}
