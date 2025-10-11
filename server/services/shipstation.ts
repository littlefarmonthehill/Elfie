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

export async function syncShipStationOrders(): Promise<ShipStationSyncResult> {
  const syncId = 'shipstation_orders';
  
  try {
    console.log('Starting ShipStation orders sync...');
    
    // Check for existing sync metadata to determine if we should do full or incremental sync
    const [metadata] = await db.select().from(syncMetadata).where(eq(syncMetadata.id, syncId)).limit(1);
    
    let modifyDateStart: string;
    
    if (!metadata || !metadata.lastSyncTime) {
      // No previous sync or first time - do full historical sync (10 years)
      const tenYearsAgo = new Date();
      tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
      modifyDateStart = tenYearsAgo.toISOString();
      console.log('No previous sync found - performing full historical sync from:', modifyDateStart);
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
          orderDate: new Date(order.orderDate),
          orderStatus: order.orderStatus,
          customerUsername: order.shipTo?.name || order.customerUsername || 'Unknown Customer',
          customerEmail: order.customerEmail,
          shipTo: JSON.stringify(order.shipTo),
          orderTotal: order.orderTotal?.toString() || '0',
          shippingAmount: order.shippingAmount?.toString() || '0',
          taxAmount: order.taxAmount?.toString() || '0',
        }));
        
        await db.insert(orders).values(values);
        ordersAdded += batch.length;
        console.log(`Inserted orders batch ${Math.floor(i / BATCH_SIZE) + 1}: ${ordersAdded}/${newOrders.length} new orders`);
      }
    }

    // Update orders where status changed
    for (const order of ordersToCheck) {
      const orderId = order.orderId.toString();
      const existing = existingOrdersMap.get(orderId);
      
      if (existing && (existing.orderStatus !== order.orderStatus || !existing.customerUsername)) {
        await db.update(orders)
          .set({ 
            orderStatus: order.orderStatus,
            customerUsername: order.shipTo?.name || order.customerUsername || existing.customerUsername || 'Unknown Customer',
            customerEmail: order.customerEmail || existing.customerEmail,
            updatedAt: new Date() 
          })
          .where(eq(orders.id, orderId));
        ordersUpdated++;
      }
    }
    console.log(`Updated ${ordersUpdated} orders with status changes`);

    // Process order details for all orders
    const allItems: any[] = [];
    const orderIdToItems = new Map<string, any[]>();
    
    for (const order of allOrders) {
      const orderId = order.orderId.toString();
      const items = order.items || [];
      orderIdToItems.set(orderId, items);
      
      for (const item of items) {
        const lineItemKey = item.lineItemKey || `${orderId}-${item.sku}`;
        allItems.push({
          orderId,
          lineItemKey,
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice?.toString() || '0',
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
    for (const item of detailsToCheck) {
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
    }
    console.log(`Updated ${detailsUpdated} order details with quantity/price changes`);

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
