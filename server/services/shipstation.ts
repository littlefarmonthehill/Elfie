import { db } from "../db";
import { orders, orderDetails } from "@shared/schema";
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
  try {
    // For complete historical sync, use a date far in the past (10 years)
    // ShipStation API requires modifyDateStart parameter
    // In production, store lastSyncTime in DB and use it for incremental syncs
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);
    const modifyDateStart = tenYearsAgo.toISOString();
    
    let allOrders: any[] = [];
    let currentPage = 1;
    let totalPages = 1;
    let apiCalls = 0;
    
    // Paginate through all orders
    while (currentPage <= totalPages) {
      const data = await shipStationRequest(`/orders?modifyDateStart=${modifyDateStart}&pageSize=500&page=${currentPage}`);
      apiCalls++;
      
      if (data.orders && data.orders.length > 0) {
        allOrders = allOrders.concat(data.orders);
      }
      
      totalPages = data.pages || 1;
      currentPage++;
    }
    
    const apiOrders = allOrders;

    let ordersAdded = 0;
    let ordersUpdated = 0;
    let orderDetailsAdded = 0;

    for (const order of apiOrders) {
      const orderId = order.orderId.toString();
      const existing = await db.select().from(orders).where(eq(orders.id, orderId));
      
      if (existing.length === 0) {
        // Insert new order
        await db.insert(orders).values({
          id: orderId,
          orderNumber: order.orderNumber,
          orderKey: order.orderKey,
          orderDate: new Date(order.orderDate),
          orderStatus: order.orderStatus,
          customerEmail: order.customerEmail,
          shipTo: JSON.stringify(order.shipTo),
          orderTotal: order.orderTotal?.toString() || '0',
          shippingAmount: order.shippingAmount?.toString() || '0',
          taxAmount: order.taxAmount?.toString() || '0',
        });
        ordersAdded++;

        // Insert order details with deduplication
        for (const item of order.items || []) {
          const lineItemKey = item.lineItemKey || `${orderId}-${item.sku}`;
          const existingDetail = await db.select().from(orderDetails).where(eq(orderDetails.lineItemKey, lineItemKey));
          
          if (existingDetail.length === 0) {
            await db.insert(orderDetails).values({
              orderId: orderId,
              lineItemKey,
              sku: item.sku,
              name: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice?.toString() || '0',
            });
            orderDetailsAdded++;
          }
        }
      } else {
        // Update existing order
        const needsUpdate = existing[0].orderStatus !== order.orderStatus;
        if (needsUpdate) {
          await db.update(orders)
            .set({ 
              orderStatus: order.orderStatus,
              updatedAt: new Date() 
            })
            .where(eq(orders.id, orderId));
          ordersUpdated++;
        }
        
        // Update order details if needed (check for quantity/price changes)
        for (const item of order.items || []) {
          const lineItemKey = item.lineItemKey || `${orderId}-${item.sku}`;
          const existingDetail = await db.select().from(orderDetails).where(eq(orderDetails.lineItemKey, lineItemKey));
          
          if (existingDetail.length === 0) {
            await db.insert(orderDetails).values({
              orderId: orderId,
              lineItemKey,
              sku: item.sku,
              name: item.name,
              quantity: item.quantity,
              unitPrice: item.unitPrice?.toString() || '0',
            });
            orderDetailsAdded++;
          } else {
            const detailNeedsUpdate = existingDetail[0].quantity !== item.quantity || 
                                       existingDetail[0].unitPrice !== (item.unitPrice?.toString() || '0');
            if (detailNeedsUpdate) {
              await db.update(orderDetails)
                .set({
                  quantity: item.quantity,
                  unitPrice: item.unitPrice?.toString() || '0',
                  updatedAt: new Date()
                })
                .where(eq(orderDetails.lineItemKey, lineItemKey));
            }
          }
        }
      }
    }

    return {
      ordersAdded,
      ordersUpdated,
      orderDetailsAdded,
      totalApiCalls: apiCalls,
    };
  } catch (error) {
    console.error('Error syncing ShipStation orders:', error);
    throw error;
  }
}
