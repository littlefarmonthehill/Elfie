import { db } from "../db";
import { orders, orderDetails } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface ShipStationSyncResult {
  ordersAdded: number;
  ordersUpdated: number;
  orderDetailsAdded: number;
  totalApiCalls: number;
}

export async function syncShipStationOrders(): Promise<ShipStationSyncResult> {
  // TODO: Make actual ShipStation API call
  // For incremental sync, get orders modified since last sync:
  // const lastSync = await getLastSyncTime('shipstation_orders');
  // const response = await fetch(`https://ssapi.shipstation.com/orders?modifyDateStart=${lastSync}`, {
  //   headers: { 
  //     Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}` 
  //   }
  // });

  // Mock data for now
  const mockOrders = [
    {
      id: 'ss-12345',
      orderNumber: 'SS12345',
      orderKey: 'order-key-1',
      orderDate: new Date('2024-01-20'),
      orderStatus: 'awaiting_shipment',
      customerEmail: 'customer1@example.com',
      shipTo: JSON.stringify({
        name: 'John Doe',
        address: '123 Main St',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62701',
        country: 'US',
      }),
      orderTotal: '156.80',
      shippingAmount: '8.50',
      taxAmount: '12.30',
      items: [
        { lineItemKey: '3001-1', sku: '3001', name: 'Brick 2x4', quantity: 10, unitPrice: '0.35' },
        { lineItemKey: '3002-1', sku: '3002', name: 'Brick 2x2', quantity: 25, unitPrice: '0.25' },
      ],
    },
  ];

  let ordersAdded = 0;
  let ordersUpdated = 0;
  let orderDetailsAdded = 0;

  for (const order of mockOrders) {
    const existing = await db.select().from(orders).where(eq(orders.id, order.id));
    
    if (existing.length === 0) {
      // Insert new order
      await db.insert(orders).values({
        id: order.id,
        orderNumber: order.orderNumber,
        orderKey: order.orderKey,
        orderDate: order.orderDate,
        orderStatus: order.orderStatus,
        customerEmail: order.customerEmail,
        shipTo: order.shipTo,
        orderTotal: order.orderTotal,
        shippingAmount: order.shippingAmount,
        taxAmount: order.taxAmount,
      });
      ordersAdded++;

      // Insert order details with deduplication
      for (const item of order.items) {
        const lineItemKey = item.lineItemKey || `${order.id}-${item.sku}`;
        const existingDetail = await db.select().from(orderDetails).where(eq(orderDetails.lineItemKey, lineItemKey));
        
        if (existingDetail.length === 0) {
          await db.insert(orderDetails).values({
            orderId: order.id,
            lineItemKey,
            sku: item.sku,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
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
          .where(eq(orders.id, order.id));
        ordersUpdated++;
      }
      
      // Update order details if needed (check for quantity/price changes)
      for (const item of order.items) {
        const lineItemKey = item.lineItemKey || `${order.id}-${item.sku}`;
        const existingDetail = await db.select().from(orderDetails).where(eq(orderDetails.lineItemKey, lineItemKey));
        
        if (existingDetail.length === 0) {
          await db.insert(orderDetails).values({
            orderId: order.id,
            lineItemKey,
            sku: item.sku,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          });
          orderDetailsAdded++;
        } else {
          const detailNeedsUpdate = existingDetail[0].quantity !== item.quantity || 
                                     existingDetail[0].unitPrice !== item.unitPrice;
          if (detailNeedsUpdate) {
            await db.update(orderDetails)
              .set({
                quantity: item.quantity,
                unitPrice: item.unitPrice,
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
    totalApiCalls: 1, // Single paginated call for orders
  };
}
