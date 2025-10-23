import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated, isApproved } from "./auth";
import { syncBricklinkData, fetchPriceOMagicData, searchBricklinkCatalogItem, syncPriceOMagicCache } from "./services/bricklink";
import { syncShipStationOrders } from "./services/shipstation";
import { syncBrickLinkToBrickOwl } from "./services/brickowl";
import { generateBrickLinkXML, generateInventoryCSV, listXMLBackups, getXMLBackup } from "./services/export";
import { getProcessedPartImage, processImageFromUrl } from "./services/image-proxy";
import { db } from "./db";
import { orders, orderDetails, blInventory, blCategories, blColors, appSettings, insertAppSettingsSchema, conversations, syncMetadata, inventoryEmbeddings, orderEmbeddings, embeddingJobs, whAisles, whShelves, whBins, inventoryLocations, picklistItems, insertWhAisleSchema, insertWhShelfSchema, insertWhBinSchema, insertInventoryLocationSchema, insertPicklistItemSchema, updateFulfillmentSchema, syncIssues, insertSyncIssueSchema, shipments, setPartRelationships } from "@shared/schema";
import { eq, desc, sql, inArray, like, or, and, isNotNull } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import FormData from "form-data";
import axios from "axios";

// Decode HTML entities from BrickLink notes for accurate comparison
function decodeHtmlEntities(text: string | null | undefined): string {
  if (!text) return '';
  
  const entityMap: Record<string, string> = {
    '&#39;': "'",
    '&#40;': '(',
    '&#41;': ')',
    '&quot;': '"',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&#x27;': "'",
    '&#x2F;': '/',
  };
  
  let decoded = text;
  for (const [entity, char] of Object.entries(entityMap)) {
    decoded = decoded.replace(new RegExp(entity, 'g'), char);
  }
  
  return decoded;
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware setup - Email/Password Authentication
  await setupAuth(app);

  // Auth routes - authenticated but may not be approved
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const user = req.user;
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Admin routes - get all users and manage approvals
  app.get('/api/admin/users', isApproved, async (req: any, res) => {
    try {
      const user = req.user;
      
      // Only admins can access this
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const users = await storage.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch('/api/admin/users/:id/approval', isApproved, async (req: any, res) => {
    try {
      const user = req.user;
      
      // Only admins can access this
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const { id } = req.params;
      const { isApproved } = req.body;
      
      // Validate isApproved
      const approvalSchema = z.object({
        isApproved: z.boolean(),
      });
      
      const validation = approvalSchema.safeParse({ isApproved });
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid approval status. Must be boolean" });
      }
      
      const updatedUser = await storage.updateUserApproval(id, isApproved);
      
      // Check if user was found and updated
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user approval:", error);
      res.status(500).json({ message: "Failed to update user approval" });
    }
  });

  app.patch('/api/admin/users/:id/role', isApproved, async (req: any, res) => {
    try {
      const user = req.user;
      
      // Only admins can access this
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }
      
      const { id } = req.params;
      const { role } = req.body;
      
      // Validate role using enum
      const roleSchema = z.object({
        role: z.enum(['customer', 'employee', 'admin']),
      });
      
      const validation = roleSchema.safeParse({ role });
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid role. Must be customer, employee, or admin" });
      }
      
      const updatedUser = await storage.updateUserRole(id, role);
      
      // Check if user was found and updated
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  // Lightweight endpoint for Sales Dashboard - orders without details
  app.get("/api/orders/summary", isApproved, async (req, res) => {
    try {
      // Parse date range parameter
      const range = req.query.range as string;
      let dateFilter: Date | null = null;
      let endDateFilter: Date | null = null;
      
      // Debug logging
      console.log(`📊 Orders Summary API called with range: ${range || 'none'}`);
      
      if (range && range !== 'all') {
        const now = new Date();
        switch (range) {
          case 'mtd':
            // Month-to-Date: start of current month
            dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'lastmonth':
            // Last Month: entire previous calendar month
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case '3months':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 3, 1);
            break;
          case '6months':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 6, 1);
            break;
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case '2years':
            dateFilter = new Date(now.getFullYear() - 2, now.getMonth(), 1);
            break;
        }
      }

      // Fetch orders WITHOUT details - just headers
      const allOrders = dateFilter
        ? endDateFilter
          ? await db.select().from(orders)
              .where(sql`${orders.orderDate} >= ${dateFilter.toISOString()} AND ${orders.orderDate} < ${endDateFilter.toISOString()}`)
              .orderBy(desc(orders.orderDate))
          : await db.select().from(orders)
              .where(sql`${orders.orderDate} >= ${dateFilter.toISOString()}`)
              .orderBy(desc(orders.orderDate))
        : await db.select().from(orders).orderBy(desc(orders.orderDate));
      
      const responseSize = JSON.stringify(allOrders).length;
      console.log(`📊 Sending ${allOrders.length} order summaries (no details), response size: ${(responseSize / 1024 / 1024).toFixed(2)} MB (dateFilter: ${dateFilter ? 'set' : 'none'})`);
      
      res.json(allOrders);
    } catch (error) {
      console.error("Error fetching order summaries:", error);
      res.status(500).json({ error: "Failed to fetch order summaries" });
    }
  });

  // Data Fetch Routes - all protected by isApproved middleware
  app.get("/api/orders", isApproved, async (req, res) => {
    try {
      // Parse date range parameter
      const range = req.query.range as string;
      let dateFilter: Date | null = null;
      let endDateFilter: Date | null = null;
      
      // Debug logging
      console.log(`📊 Orders API called with range: ${range || 'none'}`);
      
      if (range && range !== 'all') {
        const now = new Date();
        switch (range) {
          case 'mtd':
            // Month-to-Date: start of current month
            dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'lastmonth':
            // Last Month: entire previous calendar month
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case '3months':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 3, 1);
            break;
          case '6months':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 6, 1);
            break;
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case '2years':
            dateFilter = new Date(now.getFullYear() - 2, now.getMonth(), 1);
            break;
        }
      }

      // Fetch orders with optional date filter
      const allOrders = dateFilter
        ? endDateFilter
          ? await db.select().from(orders)
              .where(sql`${orders.orderDate} >= ${dateFilter.toISOString()} AND ${orders.orderDate} < ${endDateFilter.toISOString()}`)
              .orderBy(desc(orders.orderDate))
          : await db.select().from(orders)
              .where(sql`${orders.orderDate} >= ${dateFilter.toISOString()}`)
              .orderBy(desc(orders.orderDate))
        : await db.select().from(orders).orderBy(desc(orders.orderDate));
      
      console.log(`📊 Fetched ${allOrders.length} orders (dateFilter: ${dateFilter ? 'set' : 'none'})`);
      
      if (allOrders.length === 0) {
        res.json([]);
        return;
      }
      
      // Fetch all order details in one query using inArray (works across all DB drivers)
      const orderIds = allOrders.map(o => o.id);
      const allDetails = await db.select()
        .from(orderDetails)
        .where(inArray(orderDetails.orderId, orderIds));
      
      // Group details by order ID
      const detailsByOrder = allDetails.reduce((acc, detail) => {
        if (!acc[detail.orderId]) {
          acc[detail.orderId] = [];
        }
        acc[detail.orderId].push(detail);
        return acc;
      }, {} as Record<string, typeof allDetails>);
      
      // Combine orders with their details
      const ordersWithDetails = allOrders.map(order => ({
        ...order,
        items: detailsByOrder[order.id] || [],
      }));
      
      // Log response size for debugging
      const responseSize = JSON.stringify(ordersWithDetails).length;
      console.log(`📊 Sending ${ordersWithDetails.length} orders, response size: ${(responseSize / 1024 / 1024).toFixed(2)} MB`);
      
      res.json(ordersWithDetails);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // Optimized endpoint for Orders Dashboard - only fetches what's needed
  app.get("/api/orders/dashboard", isApproved, async (req, res) => {
    try {
      // Fetch top 5 pending orders (awaiting_payment or awaiting_shipment)
      const pendingOrders = await db.select()
        .from(orders)
        .where(
          sql`${orders.orderStatus} IN ('awaiting_payment', 'awaiting_shipment')`
        )
        .orderBy(desc(orders.orderDate))
        .limit(5);

      // Fetch top 5 recent shipments (shipped status, sorted by date)
      const recentShipments = await db.select()
        .from(orders)
        .where(eq(orders.orderStatus, 'shipped'))
        .orderBy(desc(orders.orderDate))
        .limit(5);

      // Fetch top 5 high value orders (all statuses, sorted by total)
      const highValueOrders = await db.select()
        .from(orders)
        .where(sql`${orders.orderTotal} IS NOT NULL`)
        .orderBy(sql`CAST(${orders.orderTotal} AS DECIMAL) DESC`)
        .limit(5);

      res.json({
        pending: pendingOrders,
        recentShipments,
        highValue: highValueOrders,
      });
    } catch (error) {
      console.error("Error fetching dashboard orders:", error);
      res.status(500).json({ error: "Failed to fetch dashboard orders" });
    }
  });

  // Get shipped orders with search functionality
  app.get("/api/orders/shipped", isApproved, async (req, res) => {
    try {
      const searchQuery = req.query.search as string;
      
      // Build base query conditions
      let whereConditions = eq(orders.orderStatus, 'shipped');
      
      // Add search filter if provided
      if (searchQuery && searchQuery.trim()) {
        const search = searchQuery.trim();
        const searchConditions = or(
          sql`${orders.orderNumber} ILIKE ${`%${search}%`}`,
          sql`${orders.customerUsername} ILIKE ${`%${search}%`}`,
          sql`${orders.customerEmail} ILIKE ${`%${search}%`}`,
          sql`${shipments.trackingNumber} ILIKE ${`%${search}%`}`
        );
        whereConditions = and(whereConditions, searchConditions)!;
      }
      
      // Execute query for shipped orders
      const shippedOrders = await db
        .select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          orderDate: orders.orderDate,
          shipDate: orders.shipDate,
          customerUsername: orders.customerUsername,
          customerEmail: orders.customerEmail,
          orderTotal: orders.orderTotal,
          marketplace: orders.marketplace,
          shipTo: orders.shipTo,
          orderStatus: orders.orderStatus,
          trackingNumber: shipments.trackingNumber,
          carrier: shipments.carrier,
          service: shipments.service,
          labelUrl: shipments.labelUrl,
        })
        .from(orders)
        .leftJoin(shipments, eq(orders.id, shipments.orderId))
        .where(whereConditions)
        .orderBy(desc(orders.shipDate));
      
      res.json(shippedOrders);
    } catch (error) {
      console.error("Error fetching shipped orders:", error);
      res.status(500).json({ error: "Failed to fetch shipped orders" });
    }
  });

  // Get category analysis (sell-through percentages)
  app.get("/api/analytics/categories", isApproved, async (req, res) => {
    try {
      const range = req.query.range as string;
      let dateFilter: Date | null = null;
      let endDateFilter: Date | null = null;
      
      // Parse date range (same logic as orders endpoint)
      if (range && range !== 'all') {
        const now = new Date();
        switch (range) {
          case 'mtd':
            dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'lastmonth':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case '3months':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 3, 1);
            break;
          case '6months':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 6, 1);
            break;
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case '2years':
            dateFilter = new Date(now.getFullYear() - 2, now.getMonth(), 1);
            break;
        }
      }
      
      // Build SQL query for category sell-through analysis
      // SKU is now standardized to BrickLink inventory ID for both platforms
      
      // Build WHERE conditions for the query
      let whereConditions = sql`o.order_status NOT IN ('cancelled', 'Cancelled')`;
      if (dateFilter && !endDateFilter) {
        whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter}`;
      } else if (dateFilter && endDateFilter) {
        whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter} AND o.order_date < ${endDateFilter}`;
      }
      
      // Get sold quantities by category
      // Now we can directly join sku (BrickLink inventory ID) to bl_inventory.id
      const soldSubquery = sql`
        SELECT i.category_id, SUM(od.quantity) as total_qty
        FROM ${orderDetails} od
        JOIN ${orders} o ON od.order_id = o.id
        JOIN ${blInventory} i ON od.sku = CAST(i.id AS TEXT)
        WHERE ${whereConditions}
        GROUP BY i.category_id
      `;
      
      // Main query combining current inventory and sold data
      const query = sql`
        SELECT 
          c.id as category_id,
          c.name as category_name,
          COALESCE(sold.total_qty, 0)::integer as total_sold,
          COALESCE(inv.total_qty, 0)::integer as current_inventory,
          CASE 
            WHEN COALESCE(inv.total_qty, 0) > 0 
            THEN ROUND((COALESCE(sold.total_qty, 0)::numeric / inv.total_qty::numeric * 100), 2)
            ELSE 0 
          END as sell_through_pct
        FROM ${blCategories} c
        LEFT JOIN (
          SELECT category_id, SUM(quantity) as total_qty
          FROM ${blInventory}
          GROUP BY category_id
        ) inv ON c.id = inv.category_id
        LEFT JOIN (
          ${soldSubquery}
        ) sold ON c.id = sold.category_id
        WHERE COALESCE(inv.total_qty, 0) > 0
        ORDER BY sell_through_pct DESC, c.name ASC
      `;
      
      const result = await db.execute(query);
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching category analysis:", error);
      res.status(500).json({ error: "Failed to fetch category analysis" });
    }
  });

  // Get product line analysis (sales by product type with platform breakdown)
  app.get("/api/analytics/product-lines", isApproved, async (req, res) => {
    try {
      const range = req.query.range as string;
      let dateFilter: Date | null = null;
      let endDateFilter: Date | null = null;
      
      // Parse date range (same logic as other analytics endpoints)
      if (range && range !== 'all') {
        const now = new Date();
        switch (range) {
          case 'mtd':
            dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'lastmonth':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case '3months':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 3, 1);
            break;
          case '6months':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 6, 1);
            break;
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case '2years':
            dateFilter = new Date(now.getFullYear() - 2, now.getMonth(), 1);
            break;
        }
      }
      
      // Build WHERE conditions
      let whereConditions = sql`o.order_status NOT IN ('cancelled', 'Cancelled')`;
      if (dateFilter && !endDateFilter) {
        whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter}`;
      } else if (dateFilter && endDateFilter) {
        whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter} AND o.order_date < ${endDateFilter}`;
      }
      
      // Query to classify orders into product lines based on item names
      const query = sql`
        WITH order_items AS (
          SELECT 
            o.id as order_id,
            o.marketplace,
            o.order_total,
            od.name,
            od.quantity,
            od.unit_price
          FROM ${orders} o
          JOIN ${orderDetails} od ON o.id = od.order_id
          WHERE ${whereConditions}
        ),
        classified_items AS (
          SELECT 
            order_id,
            marketplace,
            quantity,
            unit_price,
            CASE
              WHEN name ILIKE '%LEGO%' THEN 'LEGO'
              WHEN name ILIKE '%K''NEX%' OR name ILIKE '%KNEX%' THEN 'K''NEX'
              WHEN name ILIKE '%Erector%' OR name ILIKE '%Meccano%' THEN 'Erector/Meccano'
              WHEN name ILIKE '%Capsela%' THEN 'Capsela'
              WHEN name ILIKE '%Marbleworks%' OR name ILIKE '%Discovery Toys%' THEN 'Marbleworks'
              WHEN name ILIKE '%Little Tikes%' THEN 'Little Tikes'
              WHEN name ILIKE '%Fisher-Price%' THEN 'Fisher-Price'
              ELSE 'Other'
            END as product_line
          FROM order_items
        ),
        platform_aggregates AS (
          SELECT 
            product_line,
            COALESCE(marketplace, 'Unknown') as marketplace,
            COUNT(DISTINCT order_id) as platform_orders,
            COALESCE(SUM(quantity * COALESCE(unit_price::numeric, 0)), 0) as platform_revenue
          FROM classified_items
          GROUP BY product_line, marketplace
        )
        SELECT 
          product_line,
          SUM(platform_orders)::integer as order_count,
          (SELECT SUM(quantity)::integer FROM classified_items ci WHERE ci.product_line = pa.product_line) as total_units,
          SUM(platform_revenue) as total_revenue,
          json_agg(
            json_build_object(
              'marketplace', marketplace,
              'order_count', platform_orders,
              'revenue', platform_revenue::text
            ) ORDER BY platform_revenue DESC
          ) as platforms
        FROM platform_aggregates pa
        GROUP BY product_line
        ORDER BY SUM(platform_revenue) DESC
      `;
      
      const result = await db.execute(query);
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching product line analysis:", error);
      res.status(500).json({ error: "Failed to fetch product line analysis" });
    }
  });

  // Fetch single order by ID with full details
  app.get("/api/orders/:id", isApproved, async (req, res) => {
    try {
      const orderId = req.params.id;
      
      // Fetch the order
      const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      
      if (!order) {
        res.status(404).json({ error: "Order not found" });
        return;
      }
      
      // Fetch order items
      const items = await db.select().from(orderDetails).where(eq(orderDetails.orderId, orderId));
      
      // Parse shipTo JSON to get customer address
      let shipToData: any = {};
      try {
        shipToData = order.shipTo ? JSON.parse(order.shipTo) : {};
      } catch (e) {
        console.error("Error parsing shipTo JSON:", e);
      }
      
      // Fetch all orders for this customer to show as pills
      const customerUsername = order.customerUsername;
      let allCustomerOrders: any[] = [];
      let isRepeatCustomer = false;
      
      if (customerUsername && customerUsername !== 'Unknown Customer') {
        allCustomerOrders = await db.select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          orderDate: orders.orderDate,
          orderStatus: orders.orderStatus,
          orderTotal: orders.orderTotal,
        })
        .from(orders)
        .where(eq(orders.customerUsername, customerUsername))
        .orderBy(desc(orders.orderDate));
        
        isRepeatCustomer = allCustomerOrders.length > 1;
      }
      
      // Format response to match OrderDetail component expectations
      const formattedOrder = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        platform: 'ShipStation' as const,
        status: order.orderStatus === 'shipped' ? 'Shipped' as const :
                order.orderStatus === 'cancelled' ? 'Cancelled' as const :
                order.orderStatus === 'awaiting_payment' ? 'Pending' as const :
                'Paid' as const,
        customer: {
          name: order.customerUsername || 'Unknown Customer',
          email: order.customerEmail || '',
          address: shipToData.street1 || '',
          city: shipToData.city || '',
          state: shipToData.state || '',
          zip: shipToData.postalCode || '',
          country: shipToData.country || '',
        },
        items: items.map(item => ({
          partNumber: item.sku || '',
          name: item.name,
          quantity: item.quantity,
          price: Number(item.unitPrice) || 0,
        })),
        shipping: Number(order.shippingAmount) || 0,
        tax: Number(order.taxAmount) || 0,
        total: Number(order.orderTotal) || 0,
        orderDate: order.orderDate.toISOString(),
        shippedDate: order.shipDate?.toISOString(),
        trackingNumber: undefined,
        isRepeatCustomer: isRepeatCustomer,
        previousOrders: allCustomerOrders
          .filter(o => o.id !== orderId) // Exclude current order from previous orders
          .map(o => ({
            orderId: o.id,
            orderNumber: o.orderNumber,
            orderDate: o.orderDate.toISOString(),
            total: Number(o.orderTotal) || 0,
            status: o.orderStatus === 'shipped' ? 'Shipped' as const :
                    o.orderStatus === 'cancelled' ? 'Cancelled' as const :
                    o.orderStatus === 'awaiting_payment' ? 'Pending' as const :
                    'Paid' as const,
          })),
      };
      
      res.json(formattedOrder);
    } catch (error) {
      console.error("Error fetching order:", error);
      res.status(500).json({ error: "Failed to fetch order" });
    }
  });

  // Update order status and trigger inventory adjustment
  app.post("/api/orders/:id/status", isApproved, async (req, res) => {
    try {
      const orderId = req.params.id;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ error: "Status is required" });
      }

      const { updateOrderStatus } = await import('./services/inventory-adjustment');
      const result = await updateOrderStatus(orderId, status);

      res.json(result);
    } catch (error) {
      console.error("Error updating order status:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to update order status" 
      });
    }
  });

  // Manual inventory adjustment endpoint (for testing/admin use)
  app.post("/api/orders/:id/adjust-inventory", isApproved, async (req, res) => {
    try {
      const orderId = req.params.id;

      const { adjustInventoryForOrder } = await import('./services/inventory-adjustment');
      const result = await adjustInventoryForOrder(orderId);

      res.json(result);
    } catch (error) {
      console.error("Error adjusting inventory:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to adjust inventory" 
      });
    }
  });

  app.get("/api/dashboard/stats", isApproved, async (req, res) => {
    try {
      // Parse date range parameter
      const range = req.query.range as string;
      let dateFilter: Date | null = null;
      let endDateFilter: Date | null = null;
      
      if (range) {
        const now = new Date();
        switch (range) {
          case 'mtd':
            // Month-to-Date: start of current month
            dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'lastmonth':
            // Last Month: entire previous calendar month
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case '3months':
            dateFilter = new Date(now.setMonth(now.getMonth() - 3));
            break;
          case '6months':
            dateFilter = new Date(now.setMonth(now.getMonth() - 6));
            break;
          case '1year':
            dateFilter = new Date(now.setFullYear(now.getFullYear() - 1));
            break;
          case '2years':
            dateFilter = new Date(now.setFullYear(now.getFullYear() - 2));
            break;
        }
      }

      // Get total orders count with date filter
      const orderCount = dateFilter
        ? endDateFilter
          ? await db.select({ count: sql<number>`count(*)` }).from(orders)
              .where(sql`${orders.orderDate} >= ${dateFilter.toISOString()} AND ${orders.orderDate} < ${endDateFilter.toISOString()}`)
          : await db.select({ count: sql<number>`count(*)` }).from(orders)
              .where(sql`${orders.orderDate} >= ${dateFilter.toISOString()}`)
        : await db.select({ count: sql<number>`count(*)` }).from(orders);
      
      // Get total inventory items count (not date-filtered - inventory is current state)
      const inventoryCount = await db.select({ count: sql<number>`count(*)` }).from(blInventory);
      
      // Get total inventory quantity (not date-filtered - inventory is current state)
      const inventoryQty = await db.select({ 
        total: sql<number>`sum(${blInventory.quantity})` 
      }).from(blInventory);
      
      // Get total sales from orders with date filter
      // orderTotal is already decimal type, so just sum it (COALESCE handles nulls)
      const totalSales = dateFilter
        ? endDateFilter
          ? await db.select({
              total: sql<number>`COALESCE(sum(${orders.orderTotal}), 0)`
            }).from(orders).where(sql`${orders.orderDate} >= ${dateFilter.toISOString()} AND ${orders.orderDate} < ${endDateFilter.toISOString()}`)
          : await db.select({
              total: sql<number>`COALESCE(sum(${orders.orderTotal}), 0)`
            }).from(orders).where(sql`${orders.orderDate} >= ${dateFilter.toISOString()}`)
        : await db.select({
            total: sql<number>`COALESCE(sum(${orders.orderTotal}), 0)`
          }).from(orders);
      
      res.json({
        totalOrders: Number(orderCount[0]?.count) || 0,
        totalInventoryItems: Number(inventoryCount[0]?.count) || 0,
        totalInventoryQuantity: Number(inventoryQty[0]?.total) || 0,
        totalSales: Number(totalSales[0]?.total) || 0,
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // Settings Routes
  app.get("/api/settings", isApproved, async (req, res) => {
    try {
      const [settings] = await db
        .select()
        .from(appSettings)
        .limit(1);

      if (!settings) {
        // Initialize with environment variable if not exists
        const [newSettings] = await db
          .insert(appSettings)
          .values({
            aiEnabled: true,
            selectedModel: 'gpt-4o-mini',
          })
          .returning();
        
        return res.json(newSettings);
      }

      res.json(settings);
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", isApproved, async (req, res) => {
    try {
      const data = insertAppSettingsSchema.parse(req.body);
      
      const [settings] = await db
        .insert(appSettings)
        .values({ ...data, id: 'default' })
        .onConflictDoUpdate({
          target: appSettings.id,
          set: {
            ...data,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        })
        .returning();

      res.json(settings);
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // Export Routes
  app.get("/api/export/bricklink-xml", isApproved, async (req, res) => {
    try {
      const xml = await generateBrickLinkXML();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `planetbrick-inventory-${timestamp}.xml`;
      
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(xml);
    } catch (error) {
      console.error("Error generating BrickLink XML:", error);
      res.status(500).json({ error: "Failed to generate BrickLink XML export" });
    }
  });

  app.get("/api/export/inventory-csv", isApproved, async (req, res) => {
    try {
      const csv = await generateInventoryCSV();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `planetbrick-inventory-${timestamp}.csv`;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      console.error("Error generating inventory CSV:", error);
      res.status(500).json({ error: "Failed to generate inventory CSV export" });
    }
  });

  // List available XML backups
  app.get("/api/backups/list", isApproved, async (req, res) => {
    try {
      const backups = await listXMLBackups();
      res.json({ success: true, backups });
    } catch (error) {
      console.error("Error listing XML backups:", error);
      res.status(500).json({ error: "Failed to list backups" });
    }
  });

  // Download specific XML backup
  app.get("/api/backups/download/:filename", isApproved, async (req, res) => {
    try {
      const { filename } = req.params;
      const xml = await getXMLBackup(filename);
      
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(xml);
    } catch (error) {
      console.error("Error downloading backup:", error);
      res.status(404).json({ error: "Backup file not found" });
    }
  });

  // OpenAI Models Route (simplified - we use specific models)
  app.get("/api/openai/models", isApproved, async (req, res) => {
    try {
      // Return common OpenAI chat models
      const models = [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
      ];

      res.json({ models });
    } catch (error) {
      console.error("Error fetching models:", error);
      res.status(500).json({ error: "Failed to fetch models" });
    }
  });

  // E.L.F.I.E. Chat Route
  app.post("/api/chat", isApproved, async (req, res) => {
    try {
      const { messages, context } = req.body;
      
      console.log('📨 Received request body:', JSON.stringify({ 
        messagesCount: messages?.length, 
        context,
        firstMessage: messages?.[0]
      }));
      
      // Validate messages array
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
          error: "Invalid request",
          message: "Messages array is required and must not be empty.",
        });
      }
      
      // Get API key from settings
      const [settings] = await db
        .select()
        .from(appSettings)
        .limit(1);

      if (!settings?.aiEnabled) {
        return res.status(400).json({
          error: "AI assistant is disabled",
          message: "The AI assistant is currently disabled. Please enable it in Settings.",
        });
      }

      const apiKey = settings?.openaiApiKey || process.env.OPENAI_API_KEY;
      const model = settings?.selectedModel || 'gpt-4o-mini';
      
      if (!apiKey) {
        return res.status(400).json({
          error: "OpenAI API key not configured",
          message: "Please configure your OpenAI API key in Settings.",
        });
      }

      // Generate or retrieve session ID for conversation continuity
      const sessionId = req.headers['x-session-id'] as string || `session-${Date.now()}`;
      
      // Retrieve recent conversation history (last 10 messages) for context
      const recentHistory = await db
        .select()
        .from(conversations)
        .where(eq(conversations.sessionId, sessionId))
        .orderBy(desc(conversations.createdAt))
        .limit(10);
      
      const conversationHistory = recentHistory.reverse().map(conv => ({
        role: conv.role,
        content: conv.content
      }));

      // Query database for relevant data based on user's question
      const lastUserMessageRaw = messages[messages.length - 1]?.content || '';
      const lastUserMessage = lastUserMessageRaw.toLowerCase(); // ALWAYS use this for detection
      console.log('🔍 Backend received user message:', lastUserMessage);
      let databaseContext = '';

      // Check for summary requests
      const isSummaryRequest = lastUserMessage.includes('summary') || lastUserMessage.includes('overview');

      // Provide summary data for inventory
      if (isSummaryRequest && (lastUserMessage.includes('inventory') || context === 'Inventory')) {
        const totalItems = await db.select({ count: sql<number>`COUNT(*)` }).from(blInventory);
        const totalQuantity = await db.select({ sum: sql<number>`SUM(${blInventory.quantity})` }).from(blInventory);
        const totalValue = await db.select({ sum: sql<number>`SUM(${blInventory.quantity} * CAST(${blInventory.unitPrice} AS DECIMAL))` }).from(blInventory);
        const uniqueColors = await db.select({ count: sql<number>`COUNT(DISTINCT ${blInventory.colorId})` }).from(blInventory);
        
        databaseContext += `\n\nINVENTORY SUMMARY:\n`;
        databaseContext += `- Total Lots: ${totalItems[0]?.count || 0}\n`;
        databaseContext += `- Total Parts: ${totalQuantity[0]?.sum || 0}\n`;
        databaseContext += `- Total Value: $${Number(totalValue[0]?.sum || 0).toFixed(2)}\n`;
        databaseContext += `- Unique Colors: ${uniqueColors[0]?.count || 0}\n`;
      }

      // Provide summary data for orders
      if (isSummaryRequest && (lastUserMessage.includes('order') || context === 'Orders')) {
        const totalOrders = await db.select({ count: sql<number>`COUNT(*)` }).from(orders);
        const totalRevenue = await db.select({ 
          sum: sql<number>`SUM(CASE WHEN ${orders.orderTotal} != '' AND ${orders.orderTotal} IS NOT NULL THEN CAST(${orders.orderTotal} AS DECIMAL) ELSE 0 END)` 
        }).from(orders);
        const pendingOrders = await db.select({ count: sql<number>`COUNT(*)` }).from(orders).where(eq(orders.orderStatus, 'Pending'));
        const shippedOrders = await db.select({ count: sql<number>`COUNT(*)` }).from(orders).where(eq(orders.orderStatus, 'Shipped'));
        
        databaseContext += `\n\nORDERS SUMMARY:\n`;
        databaseContext += `- Total Orders: ${totalOrders[0]?.count || 0}\n`;
        databaseContext += `- Total Revenue: $${Number(totalRevenue[0]?.sum || 0).toFixed(2)}\n`;
        databaseContext += `- Pending Orders: ${pendingOrders[0]?.count || 0}\n`;
        databaseContext += `- Shipped Orders: ${shippedOrders[0]?.count || 0}\n`;
      }
      
      // Provide sales-focused data for sales dashboard
      if (isSummaryRequest && (lastUserMessage.includes('sales') || context === 'Sales')) {
        const totalRevenue = await db.select({ 
          sum: sql<number>`SUM(CASE WHEN ${orders.orderTotal} != '' AND ${orders.orderTotal} IS NOT NULL THEN CAST(${orders.orderTotal} AS DECIMAL) ELSE 0 END)` 
        }).from(orders);
        const totalOrders = await db.select({ count: sql<number>`COUNT(*)` }).from(orders);
        const avgOrderValue = Number(totalRevenue[0]?.sum || 0) / (Number(totalOrders[0]?.count) || 1);
        
        // Get top revenue orders (filter out empty/null totals and use safe CAST)
        const topOrders = await db
          .select({
            orderNumber: orders.orderNumber,
            customerUsername: orders.customerUsername,
            orderTotal: orders.orderTotal,
            orderDate: orders.orderDate,
          })
          .from(orders)
          .where(and(
            sql`${orders.orderTotal} IS NOT NULL`,
            sql`${orders.orderTotal} != ''`
          ))
          .orderBy(desc(sql`CASE WHEN ${orders.orderTotal} != '' AND ${orders.orderTotal} IS NOT NULL THEN CAST(${orders.orderTotal} AS DECIMAL) ELSE 0 END`))
          .limit(5);
        
        databaseContext += `\n\nSALES SUMMARY:\n`;
        databaseContext += `- Total Revenue: $${Number(totalRevenue[0]?.sum || 0).toFixed(2)}\n`;
        databaseContext += `- Total Orders: ${totalOrders[0]?.count || 0}\n`;
        databaseContext += `- Average Order Value: $${avgOrderValue.toFixed(2)}\n`;
        
        if (topOrders.length > 0) {
          databaseContext += `\nTop Revenue Orders:\n`;
          topOrders.forEach(order => {
            databaseContext += `- Order #${order.orderNumber}: ${order.customerUsername || 'Customer'} - $${order.orderTotal} on ${new Date(order.orderDate).toLocaleDateString()}\n`;
          });
        }
      }
      
      // Provide marketing-focused data for marketing dashboard
      if (isSummaryRequest && (lastUserMessage.includes('marketing') || lastUserMessage.includes('customer') || context === 'Marketing')) {
        // Get unique customers count
        const uniqueCustomers = await db.select({ 
          count: sql<number>`COUNT(DISTINCT ${orders.customerUsername})` 
        }).from(orders);
        
        // Get top customers by total revenue (guard against empty/null totals)
        const topCustomers = await db
          .select({
            customerUsername: orders.customerUsername,
            totalRevenue: sql<number>`SUM(CASE WHEN ${orders.orderTotal} != '' AND ${orders.orderTotal} IS NOT NULL THEN CAST(${orders.orderTotal} AS DECIMAL) ELSE 0 END)`,
            orderCount: sql<number>`COUNT(*)`,
          })
          .from(orders)
          .groupBy(orders.customerUsername)
          .orderBy(desc(sql`SUM(CASE WHEN ${orders.orderTotal} != '' AND ${orders.orderTotal} IS NOT NULL THEN CAST(${orders.orderTotal} AS DECIMAL) ELSE 0 END)`))
          .limit(5);
        
        // Get repeat customers (customers with more than 1 order)
        const repeatCustomers = await db
          .select({
            count: sql<number>`COUNT(*)`,
          })
          .from(
            db.select({
              customerUsername: orders.customerUsername,
              orderCount: sql<number>`COUNT(*)`.as('order_count'),
            })
            .from(orders)
            .groupBy(orders.customerUsername)
            .having(sql`COUNT(*) > 1`)
            .as('repeat_customers')
          );
        
        databaseContext += `\n\nMARKETING & CUSTOMER INSIGHTS:\n`;
        databaseContext += `- Total Unique Customers: ${uniqueCustomers[0]?.count || 0}\n`;
        databaseContext += `- Repeat Customers: ${repeatCustomers[0]?.count || 0}\n`;
        databaseContext += `- Repeat Rate: ${((Number(repeatCustomers[0]?.count || 0) / Number(uniqueCustomers[0]?.count || 1)) * 100).toFixed(1)}%\n`;
        
        if (topCustomers.length > 0) {
          databaseContext += `\nTop Customers by Revenue:\n`;
          topCustomers.forEach(customer => {
            databaseContext += `- ${customer.customerUsername || 'Unknown'}: $${Number(customer.totalRevenue).toFixed(2)} (${customer.orderCount} orders)\n`;
          });
        }
      }

      // Track if we should suggest BrickLink search (will be returned to frontend)
      let bricklinkSearchSuggestion: { itemNo: string, itemType: string } | null = null;
      
      // Search inventory by part number, text query, or general inventory request
      // Match 4-5 digits optionally followed by hyphen and more characters (e.g., 11013, 11013-1, 3021)
      const partNumberMatch = lastUserMessage.match(/\b(\d{4,5}(?:-[a-z0-9]+)?)\b/i);
      
      // Extract meaningful keywords from message (skip common stop words)
      const stopWords = ['show', 'me', 'find', 'search', 'for', 'get', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'from', 'with', 'have', 'has', 'do', 'does'];
      const extractKeywords = (msg: string): string[] => {
        if (partNumberMatch) return [];
        
        // Remove stop words and extract meaningful keywords
        const words = msg.split(/\s+/).filter(word => 
          word.length >= 3 && !stopWords.includes(word)
        );
        
        return words;
      };
      
      const searchKeywords = extractKeywords(lastUserMessage);
      
      if (partNumberMatch || searchKeywords.length > 0 || lastUserMessage.includes('part') || lastUserMessage.includes('inventory')) {
        const partNumber = partNumberMatch ? partNumberMatch[1] : null;
        
        console.log('🔍 Search params:', { partNumber, keywords: searchKeywords });
        
        // Build query - search across multiple fields
        let inventoryResults;
        if (partNumber) {
          // Search by part number
          inventoryResults = await db
            .select({
              id: blInventory.id,
              itemNo: blInventory.itemNo,
              itemType: blInventory.itemType,
              itemName: blInventory.itemName,
              remarks: blInventory.remarks,
              colorId: blInventory.colorId,
              colorName: blColors.name,
              colorRgb: blColors.rgb,
              categoryName: blCategories.name,
              quantity: blInventory.quantity,
              newOrUsed: blInventory.newOrUsed,
              unitPrice: blInventory.unitPrice,
            })
            .from(blInventory)
            .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
            .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
            .where(like(blInventory.itemNo, `%${partNumber}%`))
            .limit(50);
        } else if (searchKeywords.length > 0) {
          // First try category/theme search - check if keywords match category names
          // Try both combined phrase and individual keywords for better matching
          const categoryConditions = [
            ...searchKeywords.map(keyword => sql`${blCategories.name} ILIKE ${'%' + keyword + '%'}`),
            sql`${blCategories.name} ILIKE ${'%' + searchKeywords.join(' ') + '%'}`,
          ];
          
          const categoryMatches = await db
            .select({
              id: blCategories.id,
              name: blCategories.name,
            })
            .from(blCategories)
            .where(or(...categoryConditions))
            .limit(10);
          
          if (categoryMatches.length > 0) {
            // Found matching categories - search inventory by category
            const categoryIds = categoryMatches.map(cat => cat.id);
            inventoryResults = await db
              .select({
                id: blInventory.id,
                itemNo: blInventory.itemNo,
                itemType: blInventory.itemType,
                itemName: blInventory.itemName,
                remarks: blInventory.remarks,
                colorId: blInventory.colorId,
                colorName: blColors.name,
                colorRgb: blColors.rgb,
                categoryName: blCategories.name,
                quantity: blInventory.quantity,
                newOrUsed: blInventory.newOrUsed,
                unitPrice: blInventory.unitPrice,
              })
              .from(blInventory)
              .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
              .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
              .where(inArray(blInventory.categoryId, categoryIds))
              .limit(50);
            
            console.log(`🔍 Category search: Found ${categoryMatches.length} matching categories:`, categoryMatches.map(c => c.name).join(', '));
          } else {
            // No category match - try semantic search first if embeddings available
            try {
              const { searchInventorySemantic } = await import('./services/embeddings');
              const semanticResults = await searchInventorySemantic(lastUserMessage, 10);
              
              if (semanticResults && semanticResults.length > 0) {
                console.log(`🧠 Semantic search: Found ${semanticResults.length} items`);
                inventoryResults = semanticResults.map((result: any) => ({
                  id: result.inventory_id,
                  itemNo: result.item_no,
                  itemType: result.item_type,
                  itemName: result.item_name,
                  remarks: null,
                  colorId: null,
                  colorName: result.color_name,
                  colorRgb: null,
                  categoryName: null,
                  quantity: result.quantity,
                  newOrUsed: result.new_or_used,
                  unitPrice: result.unit_price,
                }));
              } else {
                throw new Error('No semantic results');
              }
            } catch (semanticError) {
              // Fall back to keyword search across multiple fields
              console.log('Falling back to keyword search');
              const conditions = searchKeywords.flatMap(keyword => {
                const pattern = `%${keyword}%`;
                return [
                  like(blInventory.itemNo, pattern),
                  like(blInventory.itemType, pattern),
                  like(blInventory.itemName, pattern),
                  like(blInventory.remarks, pattern),
                  like(blInventory.description, pattern)
                ];
              });
              
              inventoryResults = await db
                .select({
                  id: blInventory.id,
                  itemNo: blInventory.itemNo,
                  itemType: blInventory.itemType,
                  itemName: blInventory.itemName,
                  remarks: blInventory.remarks,
                  colorId: blInventory.colorId,
                  colorName: blColors.name,
                  colorRgb: blColors.rgb,
                  categoryName: blCategories.name,
                  quantity: blInventory.quantity,
                  newOrUsed: blInventory.newOrUsed,
                  unitPrice: blInventory.unitPrice,
                })
                .from(blInventory)
                .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
                .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
                .where(or(...conditions))
                .limit(50);
            }
          }
        } else {
          // General inventory query
          inventoryResults = await db
            .select({
              id: blInventory.id,
              itemNo: blInventory.itemNo,
              itemType: blInventory.itemType,
              itemName: blInventory.itemName,
              remarks: blInventory.remarks,
              colorId: blInventory.colorId,
              colorName: blColors.name,
              colorRgb: blColors.rgb,
              categoryName: blCategories.name,
              quantity: blInventory.quantity,
              newOrUsed: blInventory.newOrUsed,
              unitPrice: blInventory.unitPrice,
            })
            .from(blInventory)
            .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
            .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
            .limit(50);
        }
        
        const searchTerm = partNumber || searchKeywords.join(' ') || 'general';
        console.log('🔍 Inventory query returned', inventoryResults.length, 'results for:', searchTerm);
        if (inventoryResults.length > 0) {
          databaseContext += `\n\nINVENTORY DATA FROM DATABASE:\n`;
          inventoryResults.forEach(item => {
            databaseContext += `- Part ${item.itemNo} (${item.itemType})`;
            if (item.itemName) databaseContext += ` - ${item.itemName}`;
            databaseContext += `: ${item.quantity} units`;
            if (item.colorName) databaseContext += ` in ${item.colorName}`;
            if (item.categoryName) databaseContext += ` [${item.categoryName}]`;
            if (item.unitPrice) databaseContext += ` @ $${item.unitPrice} each`;
            databaseContext += ` (${item.newOrUsed})`;
            if (item.remarks) databaseContext += ` - ${item.remarks}`;
            databaseContext += `\n`;
          });
          console.log('🔍 Database context length:', databaseContext.length);
        } else if (partNumber || searchKeywords.length > 0) {
          databaseContext += `\n\nINVENTORY SEARCH: No items found for "${searchTerm}" in database.\n`;
          console.log('🔍 No inventory found for:', searchTerm);
          
          // Set BrickLink search suggestion for part numbers not found locally
          if (partNumber) {
            // Detect if it's likely a SET (has hyphen) or PART
            const itemType = partNumber.includes('-') ? 'SET' : 'PART';
            bricklinkSearchSuggestion = { itemNo: partNumber, itemType };
            
            databaseContext += `\nINSTRUCTION: Tell the user that "${partNumber}" is not in inventory and a BrickLink catalog search button will appear below the message.\n`;
            console.log('🔗 Setting BrickLink search suggestion for:', partNumber, 'type:', itemType);
          }
        }
      }

      // Always include inventory stats for analytical questions
      const statsQuery = await db
        .select({
          totalLots: sql<number>`COUNT(*)`,
          totalParts: sql<number>`SUM(${blInventory.quantity})`,
          totalValue: sql<number>`SUM(${blInventory.quantity} * CAST(${blInventory.unitPrice} AS DECIMAL))`,
        })
        .from(blInventory);

      const colorCount = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${blInventory.colorId})` })
        .from(blInventory);

      const categoryCount = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${blInventory.categoryId})` })
        .from(blInventory);

      const statsData = {
        totalLots: Number(statsQuery[0]?.totalLots) || 0,
        totalParts: Number(statsQuery[0]?.totalParts) || 0,
        totalValue: Number(statsQuery[0]?.totalValue) || 0,
        totalColors: Number(colorCount[0]?.count) || 0,
        totalCategories: Number(categoryCount[0]?.count) || 0,
      };

      // Add stats to context for analytical questions
      databaseContext += `\n\nINVENTORY STATISTICS:
- Total lots (unique listings): ${statsData.totalLots}
- Total parts (sum of quantities): ${statsData.totalParts}
- Total inventory value: $${statsData.totalValue.toFixed(2)}
- Number of different colors: ${statsData.totalColors}
- Number of different categories: ${statsData.totalCategories}\n`;

      // Price-o-Matic: Check for pricing queries
      const isPricingQuery = lastUserMessage.includes('price') || lastUserMessage.includes('pricing') || 
                            lastUserMessage.includes('worth') || lastUserMessage.includes('value') ||
                            lastUserMessage.includes('market') || lastUserMessage.includes('sell for');
      
      if (isPricingQuery && partNumberMatch) {
        try {
          const partNumber = partNumberMatch[1];
          
          // Get inventory item details to extract itemType, colorId, and condition
          const inventoryItem = await db
            .select({
              itemNo: blInventory.itemNo,
              itemType: blInventory.itemType,
              colorId: blInventory.colorId,
              newOrUsed: blInventory.newOrUsed,
            })
            .from(blInventory)
            .where(eq(blInventory.itemNo, partNumber))
            .limit(1);
          
          if (inventoryItem.length > 0) {
            const item = inventoryItem[0];
            const priceOMagicData = await fetchPriceOMagicData(
              item.itemNo,
              item.itemType,
              item.colorId || undefined,
              item.newOrUsed, // Use item's condition
              15 // 15% premium
            );
            
            if (priceOMagicData) {
              databaseContext += `\n\nPRICE-O-MAGIC DATA FOR ${item.itemNo}:\n`;
              databaseContext += `- Item: ${priceOMagicData.itemName || item.itemNo}\n`;
              if (priceOMagicData.stockAvgPrice) {
                databaseContext += `- Currently For Sale: Avg $${parseFloat(priceOMagicData.stockAvgPrice).toFixed(3)}`;
                if (priceOMagicData.stockMinPrice && priceOMagicData.stockMaxPrice) {
                  databaseContext += ` (range: $${parseFloat(priceOMagicData.stockMinPrice).toFixed(2)}-$${parseFloat(priceOMagicData.stockMaxPrice).toFixed(2)})`;
                }
                if (priceOMagicData.stockTotalLots) {
                  databaseContext += ` across ${priceOMagicData.stockTotalLots} lots`;
                }
                databaseContext += `\n`;
              }
              if (priceOMagicData.soldAvgPrice) {
                databaseContext += `- Sold (last 6mo): Avg $${parseFloat(priceOMagicData.soldAvgPrice).toFixed(3)}`;
                if (priceOMagicData.soldMinPrice && priceOMagicData.soldMaxPrice) {
                  databaseContext += ` (range: $${parseFloat(priceOMagicData.soldMinPrice).toFixed(2)}-$${parseFloat(priceOMagicData.soldMaxPrice).toFixed(2)})`;
                }
                if (priceOMagicData.soldTotalLots) {
                  databaseContext += ` across ${priceOMagicData.soldTotalLots} lots`;
                }
                databaseContext += `\n`;
              }
              databaseContext += `- SUGGESTED PRICE: $${parseFloat(priceOMagicData.suggestedPrice).toFixed(3)} (includes ${priceOMagicData.premiumPercentage}% premium)\n`;
              if (priceOMagicData.weight) {
                databaseContext += `- Weight: ${parseFloat(priceOMagicData.weight).toFixed(1)}g\n`;
              }
              console.log('💰 Price-o-Matic data added to context for:', item.itemNo);
            }
          }
        } catch (error) {
          console.error('💰 Error fetching Price-o-Matic data:', error);
          // Don't throw - pricing is optional, continue with chat
        }
      }

      // Search orders - check for specific status filters and date ranges
      const orderStatusMap: { [key: string]: string } = {
        'awaiting payment': 'awaiting_payment',
        'awaiting shipment': 'awaiting_shipment',
        'on hold': 'on_hold',
        'shipped': 'shipped',
        'cancelled': 'cancelled',
      };
      
      let statusFilter: string | null = null;
      for (const [keyword, dbStatus] of Object.entries(orderStatusMap)) {
        if (lastUserMessage.includes(keyword)) {
          statusFilter = dbStatus;
          break;
        }
      }
      
      // Check for date-based queries (years ago, months ago, etc.)
      let dateFilter: Date | null = null;
      const yearsAgoMatch = lastUserMessage.match(/(\d+)\s*years?\s*ago/);
      const monthsAgoMatch = lastUserMessage.match(/(\d+)\s*months?\s*ago/);
      
      if (yearsAgoMatch) {
        const years = parseInt(yearsAgoMatch[1]);
        dateFilter = new Date();
        dateFilter.setFullYear(dateFilter.getFullYear() - years);
      } else if (monthsAgoMatch) {
        const months = parseInt(monthsAgoMatch[1]);
        dateFilter = new Date();
        dateFilter.setMonth(dateFilter.getMonth() - months);
      }
      
      // Check for sales-specific queries
      const isTopRevenue = lastUserMessage.includes('top revenue') || lastUserMessage.includes('highest revenue') || lastUserMessage.includes('biggest orders');
      const isRecentSales = lastUserMessage.includes('recent sales') || lastUserMessage.includes('latest sales');
      
      // Check for marketing/customer-specific queries
      const isTopCustomers = lastUserMessage.includes('top customer') || lastUserMessage.includes('best customer');
      const isRepeatCustomers = lastUserMessage.includes('repeat customer') || lastUserMessage.includes('returning customer');
      const isCustomerDemographics = lastUserMessage.includes('customer demographic') || lastUserMessage.includes('customer insight');
      
      if (lastUserMessage.includes('order') || lastUserMessage.includes('sales') || isTopRevenue || isRecentSales || isTopCustomers || isRepeatCustomers || isCustomerDemographics) {
        // Handle customer-specific queries differently
        if (isTopCustomers || isRepeatCustomers || isCustomerDemographics) {
          // Get customer data (guard against empty/null totals)
          const customerResults = await db
            .select({
              customerUsername: orders.customerUsername,
              totalRevenue: sql<number>`SUM(CASE WHEN ${orders.orderTotal} != '' AND ${orders.orderTotal} IS NOT NULL THEN CAST(${orders.orderTotal} AS DECIMAL) ELSE 0 END)`,
              orderCount: sql<number>`COUNT(*)`,
              lastOrderDate: sql<string>`MAX(${orders.orderDate})`,
            })
            .from(orders)
            .groupBy(orders.customerUsername)
            .orderBy(isTopCustomers ? desc(sql`SUM(CASE WHEN ${orders.orderTotal} != '' AND ${orders.orderTotal} IS NOT NULL THEN CAST(${orders.orderTotal} AS DECIMAL) ELSE 0 END)`) : desc(sql`COUNT(*)`))
            .limit(20);
          
          // Filter for repeat customers if requested
          const finalResults = isRepeatCustomers 
            ? customerResults.filter(c => Number(c.orderCount) > 1)
            : customerResults;
          
          if (finalResults.length > 0) {
            databaseContext += `\n\nCUSTOMER DATA FROM DATABASE:\n`;
            finalResults.forEach(customer => {
              databaseContext += `- ${customer.customerUsername || 'Unknown'}: $${Number(customer.totalRevenue).toFixed(2)} total revenue, ${customer.orderCount} orders, last order: ${new Date(customer.lastOrderDate).toLocaleDateString()}\n`;
            });
          } else {
            databaseContext += `\n\nNo customer data found matching your criteria.\n`;
          }
        } else {
          // Handle order queries
          let ordersQuery = db
            .select({
              id: orders.id,
              orderNumber: orders.orderNumber,
              customerUsername: orders.customerUsername,
              orderDate: orders.orderDate,
              orderTotal: orders.orderTotal,
              orderStatus: orders.orderStatus,
            })
            .from(orders);
          
          // Apply status filter if found
          if (statusFilter) {
            ordersQuery = ordersQuery.where(eq(orders.orderStatus, statusFilter)) as any;
          }
          
          // Apply date filter if found
          if (dateFilter) {
            const dateCondition = sql`${orders.orderDate} >= ${dateFilter.toISOString()}`;
            if (statusFilter) {
              ordersQuery = ordersQuery.where(and(eq(orders.orderStatus, statusFilter), dateCondition)) as any;
            } else {
              ordersQuery = ordersQuery.where(dateCondition) as any;
            }
          }
          
          // For revenue sorting, we'll fetch more records and filter/sort in JavaScript to avoid CAST errors
          let ordersResults;
          if (isTopRevenue) {
            // Fetch all orders without revenue sorting
            const allOrders = await ordersQuery
              .orderBy(desc(orders.orderDate))
              .limit(100); // Get more to ensure we have enough valid revenue orders
            
            // Filter and sort in JavaScript
            ordersResults = allOrders
              .filter(order => {
                const total = order.orderTotal;
                // Check if it's a valid number
                return total && total !== '' && !isNaN(Number(total));
              })
              .sort((a, b) => {
                const totalA = Number(a.orderTotal);
                const totalB = Number(b.orderTotal);
                return totalB - totalA; // Descending order
              })
              .slice(0, 20);
          } else {
            ordersResults = await ordersQuery
              .limit(20)
              .orderBy(desc(orders.orderDate));
          }
          
          if (ordersResults.length > 0) {
            databaseContext += `\n\n${statusFilter ? statusFilter.toUpperCase().replace('_', ' ') + ' ' : ''}ORDERS FROM DATABASE:\n`;
            
            // Get order details for each order
            for (const order of ordersResults) {
              const details = await db
                .select({
                  sku: orderDetails.sku,
                  name: orderDetails.name,
                  quantity: orderDetails.quantity,
                  unitPrice: orderDetails.unitPrice,
                })
                .from(orderDetails)
                .where(eq(orderDetails.orderId, order.id))
                .limit(5); // Limit items per order
              
              databaseContext += `- Order #${order.orderNumber}: ${order.customerUsername || 'Customer'} - $${order.orderTotal} (${order.orderStatus}) on ${new Date(order.orderDate).toLocaleDateString()}`;
              
              if (details.length > 0) {
                databaseContext += `\n  Items: `;
                details.forEach((item, idx) => {
                  if (idx > 0) databaseContext += ', ';
                  const displayName = item.sku || item.name;
                  databaseContext += `${item.quantity}x ${displayName} ($${item.unitPrice})`;
                });
              }
              databaseContext += `\n`;
            }
          } else if (statusFilter) {
            databaseContext += `\n\nNo ${statusFilter.replace('_', ' ')} orders found in database.\n`;
          }
        }
      }

      // Build conversation history context
      let historyContext = '';
      if (conversationHistory.length > 0) {
        historyContext = '\n\nRECENT CONVERSATION HISTORY:\n';
        conversationHistory.forEach(msg => {
          historyContext += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}\n`;
        });
      }

      // Use custom system prompt if provided, otherwise use default
      const currentDate = new Date().toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      
      const defaultSystemPrompt = `You are E.L.F.I.E. (Expert LEGO Fulfillment & Inventory Engine), an AI assistant for LEGO business operations with DIRECT DATABASE ACCESS.

Today's date: ${currentDate}
Current context: ${context}
${databaseContext}
${historyContext}

CRITICAL: You HAVE database access and real data is provided above. Use this data to answer questions accurately.
IMPORTANT: When users ask about upcoming products, events, or timeframes (like "Christmas"), consider today's date to provide contextually relevant information.

PRICE-O-MAGIC FEATURE:
- You have access to real-time BrickLink market data including stock prices, sold prices, and suggested pricing
- When price guide data is provided, it includes:
  * Stock (currently for sale) average/min/max prices and lot counts
  * Sold (last 6 months) average/min/max prices and lot counts
  * AI-calculated suggested price with premium percentage for fast turnaround/large inventory
  * Item details including weight, dimensions, images, and BrickLink metadata
- Use this data to provide intelligent pricing recommendations and market insights
- Suggested prices include a premium (typically 15%) for fast turnaround and quality service

RESPONSE GUIDELINES:
1. When database data is provided, use it to give specific answers
2. FORMAT ALL LISTS AS MARKDOWN BULLET POINTS - Each item on its own line with "- " prefix
3. CRITICAL: Do NOT use asterisks (*), bold (**text**), or any markdown formatting in your responses - just plain text
4. IMPORTANT CONTEXT AWARENESS:
   - When asked about ORDERS, list orders (not inventory items)
   - When asked about INVENTORY, list inventory items (not orders)
   - Pay attention to the user's question - respond with the appropriate data type
5. Always include BrickLink links for parts: https://www.bricklink.com/v2/catalog/catalogitem.page?P=<partNumber>
6. When listing inventory items, format each as: "- Part [ITEMNO] in [COLOR]: [QTY] units @ $[PRICE] ([CONDITION])"
7. When listing orders, format each as: "- Order #[NUMBER]: [CUSTOMER] - $[TOTAL] ([STATUS]) on [DATE]"
8. If no data found, explain what you searched and suggest alternatives
9. Be direct and concise (under 5 sentences for intro, then bullet list)
10. Provide actionable information
11. IMPORTANT: Item names and themes are not in database - only part numbers, colors, quantities, and prices. If user asks for themes (Star Wars, Harry Potter), explain this limitation
12. LEARNING: Remember previous conversations and learn from user interactions to provide better assistance over time
13. CRITICAL: NEVER end responses with "Would you like to..." suggestions, follow-up action lists, or any recommendations for next steps. Simply answer the user's question and STOP. Do not offer additional options or suggestions.

FORMATTING EXAMPLES:

User: "Do I have part 3021?"
Good response: "Yes! I found 3 listings for part 3021:

- Part 3021 in Red: 50 units @ $0.25 (New)
- Part 3021 in Blue: 30 units @ $0.20 (New)  
- Part 3021 in Yellow: 10 units @ $0.30 (Used)

View on BrickLink: https://www.bricklink.com/v2/catalog/catalogitem.page?P=3021"

User: "Show me orders from 5 years ago"
Good response: "Here are orders from 5 years ago:

- Order #12345: JohnDoe - $45.50 (shipped) on Jan 15, 2020
- Order #12346: MarySmith - $32.00 (shipped) on Jan 14, 2020
- Order #12347: BobJones - $67.25 (shipped) on Jan 13, 2020"

User: "Show me awaiting shipment orders"
Good response: "Here are your awaiting shipment orders:

- Order #98765: AliceW - $123.45 (awaiting_shipment) on Jan 10, 2025
- Order #98764: BobM - $89.99 (awaiting_shipment) on Jan 9, 2025"

BAD EXAMPLE (DO NOT DO THIS):
User: "Do I have part 3021?"
Bad response: "Yes! I found part 3021 in inventory.

- Part 3021 in Red: 50 units @ $0.25 (New)

Would you like to:
- View similar parts
- Check pricing history  
- See restocking recommendations"

CRITICAL: The above is a BAD example. NEVER include "Would you like to" or any follow-up suggestions. Just answer the question and stop.

Keep responses helpful, accurate, and based on the actual data provided. End your response after providing the requested information.`;

      // Enhanced system prompt for function calling capabilities
      const enhancedDefaultPrompt = `${defaultSystemPrompt}

IMPORTANT: You now have access to tools/functions to enhance your capabilities:

AVAILABLE TOOLS:
1. search_bricklink_catalog - Look up items NOT in local inventory on BrickLink
2. get_bricklink_price_guide - Get current market pricing for any item
3. search_local_inventory - Search local inventory with advanced filters
4. get_inventory_stats - Get inventory statistics (totals, values, etc.)
5. get_order_analytics - Get sales and order analytics
6. search_orders_by_item - Search order history to find if a specific part has been sold
7. get_copurchased_items - Find what other parts customers frequently bought together with a specific part
8. get_set_parts - Get complete parts list with quantities for any LEGO set
9. search_web - Search the internet for current information, news, trends, and research

WHEN TO USE TOOLS:
- If a user asks about a part/set that's NOT in inventory → ALWAYS use search_bricklink_catalog
- If a user asks "what is part X" or "tell me about part X" → use search_bricklink_catalog if not in inventory
- If a user asks "what parts are in set X" or "show me the parts for set X" → use get_set_parts with the set number (e.g., "4709-1")
- If a user asks about pricing/market value → use get_bricklink_price_guide
- If a user wants filtered inventory search → use search_local_inventory
- If a user asks "has anyone purchased this part" or "show me sales for part X" → use search_orders_by_item
- If a user asks "what did people buy with this part" or "what do customers buy together with part X" → use get_copurchased_items
- For business strategy questions → use the relevant analytics tools
- If a user asks about current events, market trends, recent news, or topics requiring up-to-date information → use search_web

CRITICAL BEHAVIOR FOR UNKNOWN PARTS:
When you use search_bricklink_catalog and find an item:
- Tell the user you found it on BrickLink
- Mention the part number and name
- The system will AUTOMATICALLY open the item detail drawer to show more information
- If search_bricklink_catalog returns success: false, let the user know the part wasn't found

TOOL USAGE GUIDELINES:
Be proactive and helpful! Use tools to provide comprehensive answers:

- When users ask about NEWS or TRENDS → use search_web to get current information
- When users ask vague questions like "how are sales?" → make reasonable assumptions (e.g., show current month/year stats)
- When providing web search results → format URLs as markdown links: [Article Title](https://url-here)
- Be helpful and informative - don't hesitate to use tools to give users great insights

You are PROACTIVE, HELPFUL, and INTELLIGENT. Use your tools to provide the best possible assistance.`;

      const systemPrompt = settings?.systemPrompt 
        ? `${settings.systemPrompt}\n\nCurrent context: ${context}\n${databaseContext}\n\n${enhancedDefaultPrompt}` 
        : `${enhancedDefaultPrompt}\n\nCurrent context: ${context}\n${databaseContext}`;

      // Use agent loop with function calling (with error recovery)
      const { runAgentLoop } = await import('./services/ai-agent');
      let assistantMessage: string;
      let bricklinkCatalogItem: any = null;
      
      let ordersFromAgentTools: any[] = [];
      let forumDiscussionsFromAgentTools: any[] = [];
      
      try {
        const agentResult = await runAgentLoop({
          apiKey,
          model,
          systemPrompt,
          messages,
          maxIterations: 5,
        });
        assistantMessage = agentResult.message;
        bricklinkCatalogItem = agentResult.bricklinkItem;
        ordersFromAgentTools = agentResult.ordersFromTool || [];
        forumDiscussionsFromAgentTools = agentResult.forumDiscussionsFromTool || [];
      } catch (agentError: any) {
        // Agent loop failed - return user-friendly error message instead of 500
        console.error('❌ Agent loop error:', agentError);
        
        let errorMessage = "I'm having trouble processing your request right now.";
        if (agentError.message?.includes('timeout')) {
          errorMessage = "The AI service is taking too long to respond. Please try again.";
        } else if (agentError.message?.includes('OpenAI')) {
          errorMessage = "I'm having trouble connecting to the AI service. Please check your OpenAI API key in Settings.";
        } else if (agentError.message?.includes('API key')) {
          errorMessage = "Please configure your OpenAI API key in Settings.";
        } else if (agentError.message?.includes('Invalid response')) {
          errorMessage = "The AI service returned an unexpected response. Please try again.";
        }
        
        // Return error as assistant message instead of throwing 500
        return res.json({
          message: errorMessage,
          items: [],
          orders: [],
          sessionId,
          error: true,
        });
      }
      
      // Extract inventory items from the search for grouped display
      const itemsFound: Array<{
        id: number;
        itemNo: string;
        itemName: string | null;
        colorId: number | null;
        colorName: string | null;
        colorRgb: string | null;
        quantity: number;
        unitPrice: string | null;
        newOrUsed: string;
      }> = [];
      
      // Extract orders for display (includes orders from AI tools like search_orders_by_item)
      const ordersFound: Array<{
        id: string;
        orderNumber: string;
        marketplace: string | null;
        orderDate: string;
        orderTotal: string;
        customerUsername: string;
        orderStatus: string;
      }> = [...ordersFromAgentTools];
      
      // Extract ONLY the specific items mentioned in E.L.F.I.E.'s response
      // This makes part numbers clickable without showing irrelevant items
      // Parse part numbers from the assistant's message (e.g., "Part 4228", "Part 3021 in Red", "part 26047")
      const partNumberRegex = /\b(?:part|item)\s+([\w-]+)/gi;
      const mentionedParts: Set<string> = new Set();
      let partMatch;
      
      while ((partMatch = partNumberRegex.exec(assistantMessage)) !== null) {
        mentionedParts.add(partMatch[1]);
      }
      
      console.log('🔍 Extracted part numbers from AI response:', Array.from(mentionedParts));
      
      // Query database for only the mentioned parts
      if (mentionedParts.size > 0) {
        const items = await db
          .select({
            id: blInventory.id,
            itemNo: blInventory.itemNo,
            itemName: blInventory.itemName,
            colorId: blInventory.colorId,
            colorName: blColors.name,
            colorRgb: blColors.rgb,
            quantity: blInventory.quantity,
            unitPrice: blInventory.unitPrice,
            newOrUsed: blInventory.newOrUsed,
          })
          .from(blInventory)
          .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
          .where(inArray(blInventory.itemNo, Array.from(mentionedParts)))
          .limit(20);
        
        itemsFound.push(...items);
      }
      
      const partNumber = partNumberMatch ? partNumberMatch[1] : null;
      
      // Don't run the old broad search - we only want items E.L.F.I.E. mentioned
      if (partNumber && false) { // Disabled - we extract from E.L.F.I.E.'s response instead
        if (partNumber) {
          const items = await db
            .select({
              id: blInventory.id,
              itemNo: blInventory.itemNo,
              itemName: blInventory.itemName,
              colorId: blInventory.colorId,
              colorName: blColors.name,
              colorRgb: blColors.rgb,
              quantity: blInventory.quantity,
              unitPrice: blInventory.unitPrice,
              newOrUsed: blInventory.newOrUsed,
            })
            .from(blInventory)
            .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
            .where(like(blInventory.itemNo, `%${partNumber}%`))
            .limit(50);
          
          itemsFound.push(...items);
        } else if (searchKeywords.length > 0) {
          // First try category/theme search
          const categoryConditions = [
            ...searchKeywords.map(keyword => sql`${blCategories.name} ILIKE ${'%' + keyword + '%'}`),
            sql`${blCategories.name} ILIKE ${'%' + searchKeywords.join(' ') + '%'}`,
          ];
          
          const categoryMatches = await db
            .select({
              id: blCategories.id,
              name: blCategories.name,
            })
            .from(blCategories)
            .where(or(...categoryConditions))
            .limit(10);
          
          if (categoryMatches.length > 0) {
            // Found matching categories - get items by category
            const categoryIds = categoryMatches.map(cat => cat.id);
            const items = await db
              .select({
                id: blInventory.id,
                itemNo: blInventory.itemNo,
                itemName: blInventory.itemName,
                colorId: blInventory.colorId,
                colorName: blColors.name,
                colorRgb: blColors.rgb,
                quantity: blInventory.quantity,
                unitPrice: blInventory.unitPrice,
                newOrUsed: blInventory.newOrUsed,
              })
              .from(blInventory)
              .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
              .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
              .where(inArray(blInventory.categoryId, categoryIds))
              .limit(50);
            
            itemsFound.push(...items);
          } else {
            // No category match - search across item fields
            const itemConditions = searchKeywords.flatMap(keyword => {
              const pattern = `%${keyword}%`;
              return [
                like(blInventory.itemNo, pattern),
                like(blInventory.itemType, pattern),
                like(blInventory.itemName, pattern),
                like(blInventory.remarks, pattern),
                like(blInventory.description, pattern)
              ];
            });
            
            const items = await db
              .select({
                id: blInventory.id,
                itemNo: blInventory.itemNo,
                itemName: blInventory.itemName,
                colorId: blInventory.colorId,
                colorName: blColors.name,
                colorRgb: blColors.rgb,
                quantity: blInventory.quantity,
                unitPrice: blInventory.unitPrice,
                newOrUsed: blInventory.newOrUsed,
              })
              .from(blInventory)
              .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
              .where(or(...itemConditions))
              .limit(50);
            
            itemsFound.push(...items);
          }
        }
      }
      
      // Extract orders for frontend display based on keywords
      const platformKeywords = ['ebay', 'amazon', 'bricklink', 'brickowl', 'www', 'unknown'];
      const hasPlatformQuery = platformKeywords.some(p => lastUserMessage.includes(p));
      const hasOrderQuery = lastUserMessage.includes('order') || lastUserMessage.includes('sale') || 
                           lastUserMessage.includes('customer') || hasPlatformQuery;
      
      if (hasOrderQuery) {
        let ordersQuery = db
          .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            marketplace: orders.marketplace,
            orderDate: orders.orderDate,
            orderTotal: orders.orderTotal,
            customerUsername: orders.customerUsername,
            orderStatus: orders.orderStatus,
          })
          .from(orders);
        
        const conditions: any[] = [];
        
        // Check for platform/marketplace filter
        for (const platform of platformKeywords) {
          if (lastUserMessage.includes(platform)) {
            const marketplaceName = platform === 'bricklink' ? 'www' : platform;
            conditions.push(eq(orders.marketplace, marketplaceName));
          }
        }
        
        // Check for customer name
        const customerNameMatch = lastUserMessage.match(/\b(from |by |customer |user )([a-zA-Z0-9_-]+)\b/);
        if (customerNameMatch) {
          const customerName = customerNameMatch[2];
          conditions.push(like(orders.customerUsername, `%${customerName}%`));
        }
        
        // Apply conditions if any
        if (conditions.length > 0) {
          ordersQuery = ordersQuery.where(or(...conditions)) as any;
        }
        
        const orderResults = await ordersQuery
          .orderBy(desc(orders.orderDate))
          .limit(20);
        
        // Convert dates to strings for frontend
        ordersFound.push(...orderResults.map(order => ({
          ...order,
          orderDate: order.orderDate instanceof Date ? order.orderDate.toISOString() : String(order.orderDate),
          customerUsername: order.customerUsername || 'Unknown',
        })));
      }

      // Save conversation to database for learning
      try {
        // Save user message (use raw content, not lowercase)
        await db.insert(conversations).values({
          sessionId,
          role: 'user',
          content: lastUserMessageRaw,
          context,
        });

        // Save assistant response
        await db.insert(conversations).values({
          sessionId,
          role: 'assistant',
          content: assistantMessage,
          context,
        });
      } catch (saveError) {
        console.error('Error saving conversation:', saveError);
        // Don't fail the request if saving fails
      }

      res.json({
        message: assistantMessage,
        items: itemsFound,
        orders: ordersFound, // Return orders for frontend display
        forumDiscussions: forumDiscussionsFromAgentTools, // Return forum discussions for frontend display
        sessionId, // Return session ID for client to use
        bricklinkSearchSuggestion, // Return suggestion if item not found (frontend will render as button)
        bricklinkItem: bricklinkCatalogItem, // Return BrickLink catalog item if found (frontend will auto-open drawer)
      });
    } catch (error) {
      console.error("❌ Chat error:", error);
      if (error instanceof Error) {
        console.error("Error name:", error.name);
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
      }
      
      // Provide more specific error messages
      let userMessage = "I'm having trouble connecting right now. Please try again.";
      if (error instanceof Error) {
        if (error.message.includes('OpenAI')) {
          userMessage = "I'm having trouble connecting to the AI service. Please check your API key in Settings.";
        } else if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
          userMessage = "The request timed out. Please try again.";
        } else if (error.message.includes('API key')) {
          userMessage = "Please configure your OpenAI API key in Settings.";
        }
      }
      
      res.status(500).json({
        error: "Failed to generate response",
        message: userMessage,
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Semantic Search - Inventory
  app.post("/api/search/inventory/semantic", isApproved, async (req, res) => {
    try {
      const { query, limit = 5 } = req.body;
      
      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }
      
      const { searchInventorySemantic } = await import('./services/embeddings');
      const results = await searchInventorySemantic(query, limit);
      
      res.json({ results });
    } catch (error) {
      console.error("Semantic search error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Semantic search failed" 
      });
    }
  });

  // Semantic Search - Orders
  app.post("/api/search/orders/semantic", isApproved, async (req, res) => {
    try {
      const { query, limit = 5 } = req.body;
      
      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }
      
      const { searchOrders } = await import('./services/embeddings');
      const results = await searchOrders(query, limit);
      
      res.json({ results });
    } catch (error) {
      console.error("Order semantic search error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Order search failed" 
      });
    }
  });

  // Find Similar Items
  app.get("/api/inventory/:id/similar", isApproved, async (req, res) => {
    try {
      const inventoryId = parseInt(req.params.id);
      const limit = parseInt(req.query.limit as string) || 5;
      
      const { findSimilarItems } = await import('./services/embeddings');
      const results = await findSimilarItems(inventoryId, limit);
      
      res.json({ results });
    } catch (error) {
      console.error("Find similar items error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to find similar items" 
      });
    }
  });

  // Get Sets Containing This Part in a Specific Color
  // Returns sets that contain the part in the specified color
  app.get("/api/inventory/:itemNo/:colorId/sets", isApproved, async (req, res) => {
    try {
      const { itemNo, colorId } = req.params;
      const colorIdNum = parseInt(colorId);
      const limit = parseInt(req.query.limit as string) || 100;
      
      // Get color name for the requested color
      const colorInfo = colorIdNum && colorIdNum > 0
        ? await db
            .select({
              id: blColors.id,
              name: blColors.name,
              rgb: blColors.rgb,
            })
            .from(blColors)
            .where(eq(blColors.id, colorIdNum))
            .limit(1)
        : [];
      
      const requestedColor = colorInfo.length > 0 ? colorInfo[0] : null;
      
      // Get sets containing this part in this specific color
      const rawData = await db
        .select({
          setNum: setPartRelationships.setNum,
          setName: setPartRelationships.setName,
          quantity: setPartRelationships.quantity,
        })
        .from(setPartRelationships)
        .where(
          and(
            eq(setPartRelationships.partNum, itemNo),
            colorIdNum && colorIdNum > 0 
              ? eq(setPartRelationships.colorId, colorIdNum)
              : sql`${setPartRelationships.colorId} IS NULL`
          )
        )
        .orderBy(setPartRelationships.setNum);
      
      // Sort by set name alphabetically (case-insensitive)
      const sortedSets = rawData.sort((a, b) => {
        const nameA = (a.setName || a.setNum).toLowerCase();
        const nameB = (b.setName || b.setNum).toLowerCase();
        return nameA.localeCompare(nameB);
      });
      
      // Apply limit
      const sets = sortedSets.slice(0, limit);
      
      res.json({ 
        sets,
        color: requestedColor ? {
          id: requestedColor.id,
          name: requestedColor.name,
          rgb: requestedColor.rgb,
        } : null
      });
    } catch (error) {
      console.error("Get sets for part error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get sets for part" 
      });
    }
  });

  // Batch Embed Inventory Items
  app.post("/api/embeddings/inventory/batch", isApproved, async (req, res) => {
    try {
      const { inventoryIds } = req.body;
      
      if (!inventoryIds || !Array.isArray(inventoryIds)) {
        return res.status(400).json({ error: "inventoryIds array is required" });
      }
      
      const { batchEmbedInventory } = await import('./services/embeddings');
      const results = await batchEmbedInventory(inventoryIds);
      
      res.json({ results });
    } catch (error) {
      console.error("Batch embedding error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Batch embedding failed" 
      });
    }
  });

  // Embed Single Inventory Item
  app.post("/api/embeddings/inventory/:id", isApproved, async (req, res) => {
    try {
      const inventoryId = parseInt(req.params.id);
      
      const { embedInventoryItem } = await import('./services/embeddings');
      const result = await embedInventoryItem(inventoryId);
      
      res.json(result);
    } catch (error) {
      console.error("Embedding error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Embedding failed" 
      });
    }
  });

  // Get Embedding Statistics
  app.get("/api/embeddings/stats", isApproved, async (req, res) => {
    try {
      const { getEmbeddingStats } = await import('./services/embeddings');
      const stats = await getEmbeddingStats();
      
      res.json(stats);
    } catch (error) {
      console.error("Get embedding stats error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get stats" 
      });
    }
  });

  // Get Inventory Items Without Embeddings
  app.get("/api/embeddings/inventory/missing", isApproved, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      
      // Get inventory items that don't have embeddings yet
      const itemsWithoutEmbeddings = await db
        .select({ id: blInventory.id })
        .from(blInventory)
        .leftJoin(inventoryEmbeddings, eq(blInventory.id, inventoryEmbeddings.inventoryId))
        .where(sql`${inventoryEmbeddings.inventoryId} IS NULL`)
        .limit(limit);
      
      res.json(itemsWithoutEmbeddings);
    } catch (error) {
      console.error("Get missing embeddings error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get missing embeddings" 
      });
    }
  });

  // Get Orders Without Embeddings
  app.get("/api/embeddings/orders/missing", isApproved, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 100;
      
      // Get orders that don't have embeddings yet
      const ordersWithoutEmbeddings = await db
        .select({ id: orders.id })
        .from(orders)
        .leftJoin(orderEmbeddings, eq(orders.id, orderEmbeddings.orderId))
        .where(sql`${orderEmbeddings.orderId} IS NULL`)
        .limit(limit);
      
      res.json(ordersWithoutEmbeddings);
    } catch (error) {
      console.error("Get missing order embeddings error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get missing order embeddings" 
      });
    }
  });

  // Batch Embed Orders
  app.post("/api/embeddings/orders/batch", isApproved, async (req, res) => {
    try {
      const { orderIds } = req.body;
      
      if (!orderIds || !Array.isArray(orderIds)) {
        return res.status(400).json({ error: "orderIds array is required" });
      }
      
      const { batchEmbedOrders } = await import('./services/embeddings');
      const results = await batchEmbedOrders(orderIds);
      
      res.json({ results });
    } catch (error) {
      console.error("Batch order embedding error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Batch order embedding failed" 
      });
    }
  });

  // Background Job Routes
  
  // Validation schema for starting a background job
  const startJobSchema = z.object({
    type: z.enum(['inventory', 'orders']),
    batchSize: z.number().int().min(10).max(100).optional().default(30),
  });
  
  // Start background embedding job (now uses persistent worker)
  app.post("/api/embeddings/jobs/start", isApproved, async (req, res) => {
    try {
      // Validate input
      const validated = startJobSchema.parse(req.body);
      
      // Use the new persistent embedding worker instead of the old in-memory system
      const { createEmbeddingJob } = await import('./services/embedding-worker');
      const job = await createEmbeddingJob(validated.type, 'manual');
      
      res.json({ 
        jobId: job.id, 
        message: 'Background job started - will continue until 100% complete',
        persistent: true
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: "Invalid input", 
          details: error.errors 
        });
      }
      console.error("Start job error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to start background job" 
      });
    }
  });

  // Stop background embedding job
  app.post("/api/embeddings/jobs/:jobId/stop", isApproved, async (req, res) => {
    try {
      const { jobId } = req.params;
      
      const { jobManager } = await import('./services/backgroundJobs');
      const stopped = jobManager.stopJob(jobId);
      
      if (stopped) {
        res.json({ message: 'Job stopped successfully' });
      } else {
        res.status(404).json({ error: 'Job not found or not running' });
      }
    } catch (error) {
      console.error("Stop job error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to stop job" 
      });
    }
  });

  // Get job status
  app.get("/api/embeddings/jobs/:jobId", isApproved, async (req, res) => {
    try {
      const { jobId } = req.params;
      
      const { jobManager } = await import('./services/backgroundJobs');
      const job = jobManager.getJobStatus(jobId);
      
      if (job) {
        res.json(job);
      } else {
        res.status(404).json({ error: 'Job not found' });
      }
    } catch (error) {
      console.error("Get job status error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get job status" 
      });
    }
  });

  // Get active job for a type (now queries database)
  app.get("/api/embeddings/jobs/active/:type", isApproved, async (req, res) => {
    try {
      const { type } = req.params;
      
      if (!type || !['inventory', 'orders', 'sets'].includes(type)) {
        return res.status(400).json({ error: "Invalid job type. Must be 'inventory', 'orders', or 'sets'" });
      }
      
      // Query the persistent database for active jobs
      const [activeJob] = await db
        .select()
        .from(embeddingJobs)
        .where(sql`${embeddingJobs.jobType} = ${type} AND ${embeddingJobs.status} IN ('pending', 'processing')`)
        .orderBy(sql`${embeddingJobs.createdAt} DESC`)
        .limit(1);
      
      res.json(activeJob || null);
    } catch (error) {
      console.error("Get active job error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get active job" 
      });
    }
  });

  // Get all jobs
  app.get("/api/embeddings/jobs", isApproved, async (req, res) => {
    try {
      const { jobManager } = await import('./services/backgroundJobs');
      const jobs = jobManager.getAllJobs();
      
      res.json(jobs);
    } catch (error) {
      console.error("Get all jobs error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get jobs" 
      });
    }
  });

  // BrickLink Catalog Search Endpoint
  app.get("/api/bricklink/search", isApproved, async (req, res) => {
    try {
      const { itemNo, itemType } = req.query;
      
      if (!itemNo || !itemType) {
        return res.status(400).json({ error: "Missing itemNo or itemType parameter" });
      }
      
      console.log('🔗 BrickLink search endpoint called for:', itemNo, 'type:', itemType);
      
      // Search BrickLink catalog
      const catalogItem = await searchBricklinkCatalogItem(itemNo as string, itemType as string);
      
      if (catalogItem) {
        console.log('🔗 BrickLink catalog item found:', catalogItem.itemNo, '-', catalogItem.itemName);
        res.json({ item: catalogItem });
      } else {
        console.log('🔗 BrickLink catalog: item not found');
        res.status(404).json({ error: "Item not found in BrickLink catalog" });
      }
    } catch (error) {
      console.error('🔗 BrickLink search error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to search BrickLink catalog"
      });
    }
  });

  // Brickognize Image Recognition Endpoint
  const upload = multer({ storage: multer.memoryStorage() });
  
  app.post("/api/brickognize/identify", upload.single('image'), isApproved, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }
      
      const itemType = req.body.itemType || 'parts'; // Default to parts
      console.log('📷 Brickognize identify endpoint called for type:', itemType);
      console.log('📷 File info:', {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      });
      
      // Use the form-data package with axios for proper Node.js compatibility
      const formData = new FormData();
      formData.append('query_image', req.file.buffer, {
        filename: req.file.originalname || 'image.jpg',
        contentType: req.file.mimetype || 'image/jpeg',
      });
      
      // Call Brickognize API using axios (handles streams properly)
      const brickognizeUrl = `https://api.brickognize.com/predict/${itemType}/`;
      console.log('📷 Calling Brickognize API:', brickognizeUrl);
      
      const response = await axios.post(brickognizeUrl, formData, {
        headers: formData.getHeaders(),
      });
      
      console.log('📷 Brickognize results:', response.data.items?.length || 0, 'items found');
      
      res.json(response.data);
    } catch (error: any) {
      console.error('📷 Brickognize identification error:', error.response?.data || error.message);
      const statusCode = error.response?.status || 500;
      res.status(statusCode).json({ 
        error: statusCode === 400 
          ? "Brickognize couldn't identify that image. Try a clearer photo!"
          : "Oops! E.L.F.I.E. couldn't identify that LEGO piece. Try again!"
      });
    }
  });

  // Get Inventory Items
  app.get("/api/inventory", isApproved, async (req, res) => {
    try {
      const searchQuery = req.query.search as string;
      
      // Build query conditionally
      const inventoryItems = searchQuery && searchQuery.trim()
        ? await db
            .select({
              id: blInventory.id,
              itemNo: blInventory.itemNo,
              itemType: blInventory.itemType,
              colorId: blInventory.colorId,
              colorName: blColors.name,
              colorRgb: blColors.rgb,
              categoryId: blInventory.categoryId,
              categoryName: blCategories.name,
              quantity: blInventory.quantity,
              newOrUsed: blInventory.newOrUsed,
              unitPrice: blInventory.unitPrice,
              updatedAt: blInventory.updatedAt,
            })
            .from(blInventory)
            .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
            .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
            .where(eq(blInventory.itemNo, searchQuery.trim()))
        : await db
            .select({
              id: blInventory.id,
              itemNo: blInventory.itemNo,
              itemType: blInventory.itemType,
              colorId: blInventory.colorId,
              colorName: blColors.name,
              colorRgb: blColors.rgb,
              categoryId: blInventory.categoryId,
              categoryName: blCategories.name,
              quantity: blInventory.quantity,
              newOrUsed: blInventory.newOrUsed,
              unitPrice: blInventory.unitPrice,
              updatedAt: blInventory.updatedAt,
            })
            .from(blInventory)
            .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
            .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
            .limit(100);

      res.json(inventoryItems);
    } catch (error) {
      console.error("Error fetching inventory:", error);
      res.status(500).json({ error: "Failed to fetch inventory" });
    }
  });

  // Get Inventory Stats (MUST be before /api/inventory/:id to avoid route conflict)
  app.get("/api/inventory/stats", isApproved, async (req, res) => {
    try {
      const stats = await db
        .select({
          totalLots: sql<number>`COUNT(*)`,
          totalParts: sql<number>`SUM(${blInventory.quantity})`,
          totalValue: sql<number>`SUM(${blInventory.quantity} * CAST(${blInventory.unitPrice} AS DECIMAL))`,
          totalCost: sql<number>`SUM(${blInventory.quantity} * COALESCE(CAST(${blInventory.myCost} AS DECIMAL), 0))`,
        })
        .from(blInventory);

      const colorCount = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${blInventory.colorId})` })
        .from(blInventory);

      const categoryCount = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${blInventory.categoryId})` })
        .from(blInventory);

      res.json({
        totalLots: Number(stats[0]?.totalLots) || 0,
        totalParts: Number(stats[0]?.totalParts) || 0,
        totalValue: Number(stats[0]?.totalValue) || 0,
        totalCost: Number(stats[0]?.totalCost) || 0,
        totalColors: Number(colorCount[0]?.count) || 0,
        totalCategories: Number(categoryCount[0]?.count) || 0,
      });
    } catch (error) {
      console.error("Error fetching inventory stats:", error);
      res.status(500).json({ error: "Failed to fetch inventory stats" });
    }
  });

  // Get Shop Inventory (for customer-facing shop page) - PUBLIC endpoint
  // Returns products by category (all if categoryIds specified, otherwise top 12 per category)
  app.get("/api/shop/inventory", async (req, res) => {
    try {
      const itemType = req.query.itemType as string | undefined;
      const categoryIdsParam = req.query.categoryIds as string | undefined;
      
      // Parse category IDs if provided (comma-separated)
      const categoryIds = categoryIdsParam
        ? categoryIdsParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
        : undefined;

      // If categories are specified, fetch ALL products; otherwise fetch top 12 per category
      const lotsPerCategory = categoryIds ? undefined : 12;

      // Build where conditions
      let whereConditions = [sql`${blInventory.quantity} > 0`];
      if (itemType) {
        whereConditions.push(eq(blInventory.itemType, itemType));
      }

      // Get categories to fetch (either specified ones or all)
      let categoryConditions = [...whereConditions];
      if (categoryIds && categoryIds.length > 0) {
        categoryConditions.push(inArray(blInventory.categoryId, categoryIds));
      }
      
      const categories = await db
        .select({
          categoryId: blInventory.categoryId,
          categoryName: blCategories.name,
        })
        .from(blInventory)
        .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
        .where(and(...categoryConditions))
        .groupBy(blInventory.categoryId, blCategories.name)
        .having(sql`COUNT(*) > 0`);

      // Fetch top 12 products (grouped by part number) for each category
      const lotsByCategory = await Promise.all(
        categories.filter(cat => cat.categoryId !== null).map(async (cat) => {
          const categoryConditions = [
            sql`${blInventory.quantity} > 0`,
            sql`${blInventory.categoryId} = ${cat.categoryId}`
          ];
          if (itemType) {
            categoryConditions.push(eq(blInventory.itemType, itemType));
          }
          
          // Get all inventory items for this category
          const allItems = await db
            .select({
              id: blInventory.id,
              itemNo: blInventory.itemNo,
              itemName: blInventory.itemName,
              itemType: blInventory.itemType,
              colorId: blInventory.colorId,
              colorName: blColors.name,
              colorRgb: blColors.rgb,
              categoryId: blInventory.categoryId,
              categoryName: blCategories.name,
              quantity: blInventory.quantity,
              newOrUsed: blInventory.newOrUsed,
              unitPrice: blInventory.unitPrice,
              imageUrl: blInventory.imageUrl,
              thumbnailUrl: blInventory.thumbnailUrl,
            })
            .from(blInventory)
            .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
            .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
            .where(and(...categoryConditions));
          
          // Sort items to ensure consistent variation order (New first, then by quantity descending, then alphabetically)
          allItems.sort((a, b) => {
            // New items first
            if (a.newOrUsed !== b.newOrUsed) {
              return a.newOrUsed === 'N' ? -1 : 1;
            }
            // Higher quantity first
            const qtyDiff = (b.quantity || 0) - (a.quantity || 0);
            if (qtyDiff !== 0) return qtyDiff;
            // Alphabetically by color name
            return (a.colorName || '').localeCompare(b.colorName || '');
          });

          // Group by part number (itemNo) to combine all color/condition variations
          const productMap = new Map<string, any>();
          
          allItems.forEach(item => {
            const key = item.itemNo;
            const priceNum = item.unitPrice ? parseFloat(item.unitPrice.toString()) : 0;
            const variation = {
              color: item.colorName || 'Unknown',
              colorId: item.colorId,
              colorHex: item.colorRgb || '#CCCCCC',
              condition: item.newOrUsed === 'N' ? 'New' : 'Used',
              qty: item.quantity || 0,
              price: `$${priceNum.toFixed(2)}`,
              imageUrl: item.imageUrl,
              thumbnailUrl: item.thumbnailUrl,
            };
            
            if (!productMap.has(key)) {
              productMap.set(key, {
                id: item.id,
                part: item.itemNo,
                name: item.itemName || item.itemNo,
                itemType: item.itemType,
                categoryId: item.categoryId,
                categoryName: item.categoryName,
                variations: [],
                totalQty: 0,
                totalValue: 0,
              });
            }
            
            const product = productMap.get(key)!;
            product.variations.push(variation);
            product.totalQty += item.quantity || 0;
            product.totalValue += priceNum * (item.quantity || 0);
            
            // Use image from first variation (sorted: New first, highest qty, then alphabetically)
            if (!product.imageUrl && item.imageUrl) {
              product.imageUrl = item.imageUrl;
              product.thumbnailUrl = item.thumbnailUrl;
              product.firstColorId = item.colorId;
            }
          });
          
          // Convert map to array and calculate scores
          const products = Array.from(productMap.values()).map(product => {
            // Score formula: (total value * 0.7) + (log10(total quantity + 1) * 0.3)
            const score = (product.totalValue * 0.7) + (Math.log10(product.totalQty + 1) * 0.3);
            return { ...product, score };
          });
          
          // Sort by score and optionally limit results
          products.sort((a, b) => b.score - a.score);
          const topProducts = lotsPerCategory ? products.slice(0, lotsPerCategory) : products;
          
          // Format for response
          return topProducts.map(product => ({
            id: product.id,
            part: product.part,
            name: product.name,
            itemType: product.itemType,
            totalQty: product.totalQty,
            lotCount: product.variations.length,
            category: product.categoryName?.toLowerCase() || 'other',
            categoryId: product.categoryId,
            categoryName: product.categoryName,
            imageUrl: product.imageUrl,
            thumbnailUrl: product.thumbnailUrl,
            firstColorId: product.firstColorId,
            variations: product.variations,
          }));
        })
      );

      // Flatten the results
      const lots = lotsByCategory.flat();

      res.json({ lots });
    } catch (error) {
      console.error("Error fetching shop inventory:", error);
      res.status(500).json({ error: "Failed to fetch shop inventory" });
    }
  });
  
  // Get Shop Categories (for customer-facing shop page) - PUBLIC endpoint
  app.get("/api/shop/categories", async (req, res) => {
    try {
      const itemType = req.query.itemType as string | undefined;

      let whereConditions = [sql`${blInventory.quantity} > 0`];
      
      if (itemType) {
        whereConditions.push(eq(blInventory.itemType, itemType));
      }

      // Get categories with their counts (lots and parts)
      const categories = await db
        .select({
          categoryId: blInventory.categoryId,
          categoryName: blCategories.name,
          lotCount: sql<number>`COUNT(*)`, // Count all inventory rows (lots)
          partCount: sql<number>`SUM(${blInventory.quantity})`, // Sum of quantities (parts)
        })
        .from(blInventory)
        .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
        .where(and(...whereConditions))
        .groupBy(blInventory.categoryId, blCategories.name)
        .having(sql`COUNT(*) > 0`)
        .orderBy(desc(sql`COUNT(*)`));

      // Get available item types (count all lots, not unique parts)
      const itemTypes = await db
        .select({
          itemType: blInventory.itemType,
          count: sql<number>`COUNT(*)`, // Count all inventory rows (lots)
        })
        .from(blInventory)
        .where(sql`${blInventory.quantity} > 0`)
        .groupBy(blInventory.itemType)
        .having(sql`COUNT(*) > 0`)
        .orderBy(desc(sql`COUNT(*)`));

      res.json({
        categories: categories.map(c => ({
          id: c.categoryId,
          name: c.categoryName || 'Other',
          lotCount: Number(c.lotCount),
          partCount: Number(c.partCount),
        })),
        itemTypes: itemTypes.map(t => ({
          type: t.itemType,
          count: Number(t.count),
        })),
      });
    } catch (error) {
      console.error("Error fetching shop categories:", error);
      res.status(500).json({ error: "Failed to fetch shop categories" });
    }
  });

  // Get Shop Stats (for customer-facing shop page) - PUBLIC endpoint
  app.get("/api/shop/stats", async (req, res) => {
    try {
      const stats = await db
        .select({
          totalLots: sql<number>`COUNT(*)`, // Count all inventory rows (each unique part+color+condition = 1 lot)
          totalParts: sql<number>`SUM(${blInventory.quantity})`,
        })
        .from(blInventory)
        .where(sql`${blInventory.quantity} > 0`); // Only count items in stock

      res.json({
        totalLots: Number(stats[0]?.totalLots) || 0,
        totalParts: Number(stats[0]?.totalParts) || 0,
      });
    } catch (error) {
      console.error("Error fetching shop stats:", error);
      res.status(500).json({ error: "Failed to fetch shop stats" });
    }
  });

  // Get Special Groups (New Items, Hot Items, Discounted Items) - PUBLIC endpoint
  app.get("/api/shop/special-groups", async (req, res) => {
    try {
      const itemType = req.query.itemType as string | undefined;
      const limit = 50;

      const groupInventoryByPart = (items: any[]) => {
        const productMap = new Map<string, any>();
        
        items.forEach(item => {
          const key = item.itemNo;
          const priceNum = item.unitPrice ? parseFloat(item.unitPrice.toString()) : 0;
          const variation = {
            color: item.colorName || 'Unknown',
            colorId: item.colorId,
            colorHex: item.colorRgb || '#CCCCCC',
            condition: item.newOrUsed === 'N' ? 'New' : 'Used',
            qty: item.quantity || 0,
            price: `$${priceNum.toFixed(2)}`,
            imageUrl: item.imageUrl,
            thumbnailUrl: item.thumbnailUrl,
          };
          
          if (!productMap.has(key)) {
            productMap.set(key, {
              id: item.id,
              part: item.itemNo,
              name: item.itemName || item.itemNo,
              itemType: item.itemType,
              categoryId: item.categoryId,
              categoryName: item.categoryName,
              variations: [],
              totalQty: 0,
              totalValue: 0,
            });
          }
          
          const product = productMap.get(key)!;
          product.variations.push(variation);
          product.totalQty += item.quantity || 0;
          product.totalValue += priceNum * (item.quantity || 0);
          
          if (!product.imageUrl && item.imageUrl) {
            product.imageUrl = item.imageUrl;
            product.thumbnailUrl = item.thumbnailUrl;
            product.firstColorId = item.colorId;
          }
        });
        
        return Array.from(productMap.values()).map(product => {
          const score = (product.totalValue * 0.7) + (Math.log10(product.totalQty + 1) * 0.3);
          return {
            id: product.id,
            part: product.part,
            name: product.name,
            itemType: product.itemType,
            totalQty: product.totalQty,
            lotCount: product.variations.length,
            category: product.categoryName?.toLowerCase() || 'other',
            categoryId: product.categoryId,
            categoryName: product.categoryName,
            imageUrl: product.imageUrl,
            thumbnailUrl: product.thumbnailUrl,
            firstColorId: product.firstColorId,
            variations: product.variations,
            score,
          };
        });
      };

      let baseConditions = [sql`${blInventory.quantity} > 0`];
      if (itemType) {
        baseConditions.push(eq(blInventory.itemType, itemType));
      }

      // 1. NEW ITEMS (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const newItems = await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          itemName: blInventory.itemName,
          itemType: blInventory.itemType,
          colorId: blInventory.colorId,
          colorName: blColors.name,
          colorRgb: blColors.rgb,
          categoryId: blInventory.categoryId,
          categoryName: blCategories.name,
          quantity: blInventory.quantity,
          newOrUsed: blInventory.newOrUsed,
          unitPrice: blInventory.unitPrice,
          imageUrl: blInventory.imageUrl,
          thumbnailUrl: blInventory.thumbnailUrl,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
        .where(and(...baseConditions, sql`${blInventory.dateCreated} >= ${thirtyDaysAgo}`))
        .limit(500);

      const newProducts = groupInventoryByPart(newItems);
      // Sort by date added (newest first) - using the first variation's created date as proxy
      newProducts.sort((a, b) => {
        // If we had dateCreated, we'd use it. For now, sort by ID (higher ID = newer)
        return b.id - a.id;
      });
      const topNewProducts = newProducts.slice(0, limit);

      // 2. HOT ITEMS (trending by orders)
      const hotItemsQuery = await db
        .select({
          sku: orderDetails.sku,
          totalOrdered: sql<number>`SUM(${orderDetails.quantity})`,
        })
        .from(orderDetails)
        .leftJoin(orders, eq(orderDetails.orderId, orders.id))
        .where(sql`${orders.orderDate} >= ${thirtyDaysAgo}`)
        .groupBy(orderDetails.sku)
        .having(sql`SUM(${orderDetails.quantity}) > 0`)
        .orderBy(desc(sql`SUM(${orderDetails.quantity})`))
        .limit(100);

      const hotSkus = hotItemsQuery.map(h => h.sku).filter(Boolean) as string[];
      
      let hotProducts: any[] = [];
      if (hotSkus.length > 0) {
        const hotInventoryItems = await db
          .select({
            id: blInventory.id,
            itemNo: blInventory.itemNo,
            itemName: blInventory.itemName,
            itemType: blInventory.itemType,
            colorId: blInventory.colorId,
            colorName: blColors.name,
            colorRgb: blColors.rgb,
            categoryId: blInventory.categoryId,
            categoryName: blCategories.name,
            quantity: blInventory.quantity,
            newOrUsed: blInventory.newOrUsed,
            unitPrice: blInventory.unitPrice,
            imageUrl: blInventory.imageUrl,
            thumbnailUrl: blInventory.thumbnailUrl,
          })
          .from(blInventory)
          .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
          .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
          .where(and(...baseConditions, inArray(blInventory.itemNo, hotSkus)));

        hotProducts = groupInventoryByPart(hotInventoryItems);
        // Sort by quantities sold (across all variations) - use the hotItemsQuery order
        hotProducts.sort((a, b) => {
          const aOrderInfo = hotItemsQuery.find(h => h.sku === a.part);
          const bOrderInfo = hotItemsQuery.find(h => h.sku === b.part);
          const aQty = aOrderInfo?.totalOrdered || 0;
          const bQty = bOrderInfo?.totalOrdered || 0;
          return bQty - aQty; // Descending by quantity sold
        });
        hotProducts = hotProducts.slice(0, limit);
      }

      // 3. DISCOUNTED ITEMS (saleRate > 0)
      const discountedItems = await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          itemName: blInventory.itemName,
          itemType: blInventory.itemType,
          colorId: blInventory.colorId,
          colorName: blColors.name,
          colorRgb: blColors.rgb,
          categoryId: blInventory.categoryId,
          categoryName: blCategories.name,
          quantity: blInventory.quantity,
          newOrUsed: blInventory.newOrUsed,
          unitPrice: blInventory.unitPrice,
          imageUrl: blInventory.imageUrl,
          thumbnailUrl: blInventory.thumbnailUrl,
          saleRate: blInventory.saleRate,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
        .where(and(...baseConditions, sql`${blInventory.saleRate} > 0`))
        .limit(500);

      const discountedProducts = groupInventoryByPart(discountedItems).map(product => {
        // Calculate the best discount percentage across all variations
        let maxDiscount = 0;
        discountedItems.forEach(item => {
          if (item.itemNo === product.part && item.saleRate) {
            const discount = parseInt(item.saleRate.toString());
            if (discount > maxDiscount) {
              maxDiscount = discount;
            }
          }
        });
        return {
          ...product,
          maxDiscount,
        };
      });
      
      // Sort by best discount offer (highest discount percentage)
      discountedProducts.sort((a, b) => b.maxDiscount - a.maxDiscount);
      const topDiscountedProducts = discountedProducts.slice(0, limit);

      res.json({
        newItems: topNewProducts,
        hotItems: hotProducts,
        discountedItems: topDiscountedProducts,
      });
    } catch (error) {
      console.error("Error fetching special groups:", error);
      res.status(500).json({ error: "Failed to fetch special groups" });
    }
  });

  // Image proxy route - serves part images with white backgrounds removed
  // Accepts URL parameter for direct image processing
  app.get("/api/images/proxy", async (req, res) => {
    try {
      const imageUrl = req.query.url as string;

      if (!imageUrl) {
        return res.status(400).json({ error: "Missing url parameter" });
      }

      // Strict validation for SSRF protection
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(imageUrl);
      } catch {
        return res.status(400).json({ error: "Invalid URL format" });
      }

      // Only allow HTTPS protocol
      if (parsedUrl.protocol !== 'https:') {
        return res.status(400).json({ error: "Only HTTPS URLs are allowed" });
      }

      // Strict allowlist: only cdn.rebrickable.com domain
      if (parsedUrl.hostname !== 'cdn.rebrickable.com') {
        return res.status(400).json({ error: "Only cdn.rebrickable.com URLs are allowed" });
      }

      // Normalize the URL to prevent bypasses
      const normalizedUrl = parsedUrl.toString();

      const imageBuffer = await processImageFromUrl(normalizedUrl);

      if (!imageBuffer) {
        return res.status(404).json({ error: "Image not found or failed to process" });
      }

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
      res.send(imageBuffer);
    } catch (error) {
      console.error(`Error serving proxied image:`, error);
      res.status(500).json({ error: "Failed to process image" });
    }
  });

  // Legacy route - kept for backward compatibility
  app.get("/api/images/parts/:partNum/:colorId", async (req, res) => {
    try {
      const { partNum, colorId } = req.params;
      const colorIdNum = parseInt(colorId);

      if (isNaN(colorIdNum)) {
        return res.status(400).json({ error: "Invalid color ID" });
      }

      const imageBuffer = await getProcessedPartImage(partNum, colorIdNum);

      if (!imageBuffer) {
        return res.status(404).json({ error: "Image not found" });
      }

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
      res.send(imageBuffer);
    } catch (error) {
      console.error(`Error serving image for ${req.params.partNum} color ${req.params.colorId}:`, error);
      res.status(500).json({ error: "Failed to process image" });
    }
  });

  // In-memory cache for discrepancies (expires after 5 minutes)
  const discrepancyCache = new Map<string, { data: any[]; timestamp: number }>();
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Persistent BOID lookup cache (never expires - reduces API calls)
  const boidLookupCache = new Map<string, string | null>();

  // Get Platform Sync Status
  app.get("/api/platform-sync/status", isApproved, async (req, res) => {
    try {
      // Get BrickLink inventory stats (source of truth)
      const blStats = await db
        .select({
          totalLots: sql<number>`COUNT(*)`,
          totalParts: sql<number>`SUM(${blInventory.quantity})`,
        })
        .from(blInventory);

      const brickLinkStats = {
        totalLots: Number(blStats[0]?.totalLots) || 0,
        totalParts: Number(blStats[0]?.totalParts) || 0,
        lastSyncedAt: new Date().toISOString(),
      };

      // Check if BrickOwl API key is configured
      const [settings] = await db.select().from(appSettings).limit(1);
      const brickowlEnabled = !!settings?.brickowlApiKey;

      // Get actual BrickOwl inventory stats if enabled
      let brickowlStats = {
        totalLots: 0,
        totalParts: 0,
        lastSyncedAt: null as string | null,
      };

      let priceDifferencesCount = 0;
      let quantityDifferencesCount = 0;
      let remarksDifferencesCount = 0;
      let descriptionDifferencesCount = 0;

      if (brickowlEnabled) {
        try {
          const { getBrickOwlInventory, lookupBoid } = await import('./services/brickowl');
          const brickowlInventory = await getBrickOwlInventory(false); // Get all, not just active
          
          brickowlStats.totalLots = brickowlInventory.length;
          brickowlStats.totalParts = brickowlInventory.reduce((sum: number, lot: any) => {
            const qty = parseInt(lot.qty || lot.quantity || '0');
            return sum + qty;
          }, 0);
          brickowlStats.lastSyncedAt = new Date().toISOString();

          // Cache arrays for detailed discrepancies
          const missingItems: any[] = [];
          const priceDiscrepancies: any[] = [];
          const quantityDiscrepancies: any[] = [];
          const remarksDiscrepancies: any[] = [];
          const descriptionDiscrepancies: any[] = [];

          // SIMPLIFIED COMPARISON: Use external_lot_ids.other (BrickLink inventory ID) for matching
          console.log('[Status] Starting simplified comparison using external_lot_ids.other');
          const blItemsMap = new Map<number, any>();
          const blItems = await db.select().from(blInventory);
          
          // Build lookup map: BrickLink inventory ID -> BrickLink item
          for (const blItem of blItems) {
            blItemsMap.set(blItem.id, blItem);
          }
          console.log(`[Status] Built BL map with ${blItemsMap.size} items`);

          // Track matched BrickLink inventory IDs
          const matchedBlIds = new Set<number>();
          
          // Compare each BrickOwl lot against BrickLink inventory
          for (const boLot of brickowlInventory) {
            // Extract BrickLink inventory ID from external_lot_ids.other
            const blInventoryId = boLot.external_lot_ids?.other ? 
              parseInt(boLot.external_lot_ids.other) : null;
            
            if (!blInventoryId) {
              // No BrickLink inventory ID linked - skip
              continue;
            }
            
            const blItem = blItemsMap.get(blInventoryId);
            
            if (!blItem) {
              // BrickOwl lot references non-existent BrickLink item - skip
              continue;
            }
            
            matchedBlIds.add(blInventoryId);
            
            const boQty = parseInt(boLot.qty || '0');
            const boPrice = parseFloat(boLot.price || '0');
            const blPrice = blItem.unitPrice ? parseFloat(blItem.unitPrice) : 0;
            
            // Check for quantity differences
            if (boQty !== blItem.quantity) {
              quantityDifferencesCount++;
              quantityDiscrepancies.push({
                itemNo: blItem.itemNo,
                itemName: blItem.itemName,
                colorName: blItem.colorName,
                blQuantity: blItem.quantity,
                blPrice,
                boQuantity: boQty,
                boPrice,
                difference: 'quantity',
                qtyDiff: boQty - blItem.quantity,
              });
            }
            
            // Check for price differences (use small epsilon for float comparison)
            if (Math.abs(boPrice - blPrice) > 0.001) {
              priceDifferencesCount++;
              priceDiscrepancies.push({
                itemNo: blItem.itemNo,
                itemName: blItem.itemName,
                colorName: blItem.colorName,
                blQuantity: blItem.quantity,
                blPrice,
                boQuantity: boQty,
                boPrice,
                difference: 'price',
                priceDiff: boPrice - blPrice,
              });
            }
            
            // Check for personal_note (remarks) differences
            // Decode HTML entities from both sides before comparing and displaying
            const boRemarks = boLot.personal_note || '';
            const blRemarks = blItem.remarks || '';
            const blRemarksDecoded = decodeHtmlEntities(blRemarks);
            const boRemarksDecoded = decodeHtmlEntities(boRemarks);
            if (boRemarksDecoded !== blRemarksDecoded) {
              remarksDifferencesCount++;
              remarksDiscrepancies.push({
                itemNo: blItem.itemNo,
                itemName: blItem.itemName,
                colorName: blItem.colorName,
                blQuantity: blItem.quantity,
                blPrice,
                boQuantity: boQty,
                boPrice,
                difference: 'remarks',
                blRemarks: blRemarksDecoded,
                boRemarks: boRemarksDecoded,
              });
            }
            
            // Check for public_note (description) differences
            // Decode HTML entities from both sides before comparing and displaying
            const boDescription = boLot.public_note || '';
            const blDescription = blItem.description || '';
            const blDescriptionDecoded = decodeHtmlEntities(blDescription);
            const boDescriptionDecoded = decodeHtmlEntities(boDescription);
            if (boDescriptionDecoded !== blDescriptionDecoded) {
              descriptionDifferencesCount++;
              descriptionDiscrepancies.push({
                itemNo: blItem.itemNo,
                itemName: blItem.itemName,
                colorName: blItem.colorName,
                blQuantity: blItem.quantity,
                blPrice,
                boQuantity: boQty,
                boPrice,
                difference: 'description',
                blDescription: blDescriptionDecoded,
                boDescription: boDescriptionDecoded,
              });
            }
          }

          // Find missing items (BrickLink items not matched in BrickOwl)
          // Limit to 100 for display performance
          let missingCount = 0;
          for (const [inventoryId, blItem] of Array.from(blItemsMap.entries())) {
            if (!matchedBlIds.has(inventoryId)) {
              if (missingCount < 100) {
                const blPrice = blItem.unitPrice ? parseFloat(blItem.unitPrice) : 0;
                missingItems.push({
                  itemNo: blItem.itemNo,
                  itemName: blItem.itemName,
                  colorName: blItem.colorName,
                  blQuantity: blItem.quantity,
                  blPrice,
                  boQuantity: 0,
                  boPrice: 0,
                  difference: 'missing',
                });
              }
              missingCount++;
            }
          }

          // Cache the detailed discrepancies
          const now = Date.now();
          discrepancyCache.set('BrickOwl:missing', { data: missingItems, timestamp: now });
          discrepancyCache.set('BrickOwl:price', { data: priceDiscrepancies, timestamp: now });
          discrepancyCache.set('BrickOwl:quantity', { data: quantityDiscrepancies, timestamp: now });
          discrepancyCache.set('BrickOwl:remarks', { data: remarksDiscrepancies, timestamp: now });
          discrepancyCache.set('BrickOwl:description', { data: descriptionDiscrepancies, timestamp: now });
        } catch (error) {
          console.error('Failed to fetch BrickOwl inventory stats:', error);
        }
      }

      const platformSyncStatus = {
        source: {
          name: 'BrickLink',
          stats: brickLinkStats,
        },
        targets: [
          {
            name: 'BrickOwl',
            enabled: brickowlEnabled,
            stats: brickowlStats,
            discrepancies: {
              missingLots: Math.max(0, brickLinkStats.totalLots - brickowlStats.totalLots),
              missingParts: Math.max(0, brickLinkStats.totalParts - brickowlStats.totalParts),
              priceDifferences: priceDifferencesCount,
              quantityDifferences: quantityDifferencesCount,
              remarksDifferences: remarksDifferencesCount,
              descriptionDifferences: descriptionDifferencesCount,
            },
          },
          {
            name: 'eBay',
            enabled: false,
            stats: {
              totalLots: 0,
              totalParts: 0,
              lastSyncedAt: null,
            },
            discrepancies: {
              missingLots: 0,
              missingParts: 0,
              priceDifferences: 0,
              quantityDifferences: 0,
              remarksDifferences: 0,
              descriptionDifferences: 0,
            },
          },
          {
            name: 'BigCommerce',
            enabled: false,
            stats: {
              totalLots: 0,
              totalParts: 0,
              lastSyncedAt: null,
            },
            discrepancies: {
              missingLots: 0,
              missingParts: 0,
              priceDifferences: 0,
              quantityDifferences: 0,
              remarksDifferences: 0,
              descriptionDifferences: 0,
            },
          },
        ],
        lastSyncStatus: 'idle' as const,
        lastSyncMessage: null,
      };

      res.json(platformSyncStatus);
    } catch (error) {
      console.error("Error fetching platform sync status:", error);
      res.status(500).json({ error: "Failed to fetch platform sync status" });
    }
  });

  // Get detailed discrepancies for a specific platform and type
  app.get("/api/platform-sync/discrepancies/:platform/:type", isApproved, async (req, res) => {
    try {
      const { platform, type } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;

      if (platform !== 'BrickOwl') {
        return res.status(400).json({ error: `Platform ${platform} is not supported yet` });
      }

      const [settings] = await db.select().from(appSettings).limit(1);
      const brickowlEnabled = !!settings?.brickowlApiKey;

      if (!brickowlEnabled) {
        return res.status(400).json({ error: 'BrickOwl API key not configured' });
      }

      // Check cache first
      const cacheKey = `${platform}:${type}`;
      const cached = discrepancyCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        // Return cached data
        const discrepancies = cached.data.slice(0, limit);
        return res.json({ discrepancies, total: cached.data.length });
      }

      // Cache miss or expired - return empty for now (should call status endpoint first)
      res.json({ 
        discrepancies: [], 
        total: 0,
        message: 'Cache expired. Please refresh the platform sync status first.' 
      });
    } catch (error) {
      console.error("Error fetching discrepancies:", error);
      res.status(500).json({ error: "Failed to fetch discrepancies" });
    }
  });

  // Sync BrickLink inventory to platform
  app.post("/api/platform-sync/sync", isApproved, async (req, res) => {
    try {
      const { platform, limit } = req.body;

      if (platform !== 'BrickOwl') {
        return res.status(400).json({ 
          success: false,
          error: `Platform ${platform} is not supported yet. Only BrickOwl is available.` 
        });
      }

      console.log(`[Platform Sync] Starting BrickLink → BrickOwl sync${limit ? ` (limit: ${limit})` : ''}...`);
      
      const result = await syncBrickLinkToBrickOwl(limit);
      
      console.log(`[Platform Sync] Complete: ${result.lotsCreated} created, ${result.lotsUpdated} updated, ${result.lotsSkipped} skipped`);

      res.json({
        success: true,
        platform,
        result,
      });
    } catch (error) {
      console.error("Platform sync error:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to sync platform",
      });
    }
  });

  // Verify BrickOwl lots endpoint
  app.post('/api/platform-sync/verify-lots', isApproved, async (req, res) => {
    try {
      const { externalIds } = req.body;
      
      if (!externalIds || !Array.isArray(externalIds)) {
        return res.status(400).json({ error: 'externalIds array required' });
      }

      // Fetch all BrickOwl inventory
      const { getBrickOwlInventory } = await import('./services/brickowl');
      const brickowlInventory = await getBrickOwlInventory(false);
      
      // Filter for the specific lots
      const verifiedLots = brickowlInventory
        .filter((lot: any) => externalIds.includes(lot.external_id_1))
        .map((lot: any) => ({
          external_id_1: lot.external_id_1,
          boid: lot.boid,
          name: lot.name,
          color: lot.col_name || 'N/A',
          condition: lot.full_con || lot.con,
          quantity: lot.qty,
          price: lot.price,
          lot_id: lot.lot_id,
          url: lot.url,
        }));

      const response = {
        success: true,
        lots: verifiedLots,
        total: verifiedLots.length,
      };
      
      console.log('[Verify Lots] Returning response:', JSON.stringify(response).substring(0, 200));
      return res.json(response);
    } catch (error: any) {
      console.error('[Verify Lots] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  });


  // ============================================
  // Sync Issues Routes
  // ============================================
  
  // Get all sync issues (with optional filters)
  app.get("/api/sync-issues", isApproved, async (req, res) => {
    try {
      const { status, syncType, platform, severity } = req.query;
      
      const conditions = [];
      
      if (status) {
        conditions.push(eq(syncIssues.status, status as string));
      }
      if (syncType) {
        conditions.push(eq(syncIssues.syncType, syncType as string));
      }
      if (platform) {
        conditions.push(eq(syncIssues.platform, platform as string));
      }
      if (severity) {
        conditions.push(eq(syncIssues.severity, severity as string));
      }
      
      let issues;
      if (conditions.length > 0) {
        issues = await db
          .select()
          .from(syncIssues)
          .where(and(...conditions))
          .orderBy(desc(syncIssues.createdAt))
          .limit(100);
      } else {
        issues = await db
          .select()
          .from(syncIssues)
          .orderBy(desc(syncIssues.createdAt))
          .limit(100);
      }
      
      res.json({
        success: true,
        issues,
        count: issues.length,
      });
    } catch (error) {
      console.error("Error fetching sync issues:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch sync issues",
      });
    }
  });
  
  // Get sync issue stats
  app.get("/api/sync-issues/stats", isApproved, async (req, res) => {
    try {
      const openIssues = await db
        .select({ count: sql<number>`count(*)` })
        .from(syncIssues)
        .where(eq(syncIssues.status, 'open'));
      
      const criticalIssues = await db
        .select({ count: sql<number>`count(*)` })
        .from(syncIssues)
        .where(and(eq(syncIssues.status, 'open'), eq(syncIssues.severity, 'critical')));
      
      res.json({
        success: true,
        stats: {
          open: Number(openIssues[0]?.count || 0),
          critical: Number(criticalIssues[0]?.count || 0),
        },
      });
    } catch (error) {
      console.error("Error fetching sync issue stats:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch stats",
      });
    }
  });
  
  // Create a new sync issue
  app.post("/api/sync-issues", isApproved, async (req, res) => {
    try {
      const issue = insertSyncIssueSchema.parse(req.body);
      
      const [newIssue] = await db.insert(syncIssues).values(issue).returning();
      
      res.json({
        success: true,
        issue: newIssue,
      });
    } catch (error) {
      console.error("Error creating sync issue:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to create sync issue",
      });
    }
  });
  
  // Update sync issue (resolve, ignore, etc.)
  app.patch("/api/sync-issues/:id", isApproved, async (req, res) => {
    try {
      const { id } = req.params;
      const { status, resolvedBy } = req.body;
      
      const updates: any = { status };
      
      if (status === 'resolved' || status === 'ignored') {
        updates.resolvedAt = new Date();
        updates.resolvedBy = resolvedBy || 'user';
      }
      
      const [updatedIssue] = await db
        .update(syncIssues)
        .set(updates)
        .where(eq(syncIssues.id, id))
        .returning();
      
      if (!updatedIssue) {
        return res.status(404).json({
          success: false,
          error: "Issue not found",
        });
      }
      
      res.json({
        success: true,
        issue: updatedIssue,
      });
    } catch (error) {
      console.error("Error updating sync issue:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to update issue",
      });
    }
  });
  
  // Delete a sync issue
  app.delete("/api/sync-issues/:id", isApproved, async (req, res) => {
    try {
      const { id } = req.params;
      
      await db.delete(syncIssues).where(eq(syncIssues.id, id));
      
      res.json({
        success: true,
      });
    } catch (error) {
      console.error("Error deleting sync issue:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete issue",
      });
    }
  });

  // Get Recently Updated/Added Inventory Items (MUST be before /api/inventory/:id)
  app.get("/api/inventory/recent-updates", isApproved, async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const type = req.query.type as string; // 'new' or 'updated'
      
      const baseSelect = {
        id: blInventory.id,
        inventoryId: blInventory.id,
        itemNo: blInventory.itemNo,
        itemName: blInventory.itemName,
        colorId: blInventory.colorId,
        colorName: blColors.name,
        colorRgb: blColors.rgb,
        quantity: blInventory.quantity,
        unitPrice: blInventory.unitPrice,
        newOrUsed: blInventory.newOrUsed,
        syncedAt: blInventory.syncedAt,
        updatedAt: blInventory.updatedAt,
      };

      let recentItems;

      if (type === 'new') {
        // Newly added items: syncedAt and updatedAt are very close (within 5 seconds)
        recentItems = await db
          .select(baseSelect)
          .from(blInventory)
          .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
          .where(sql`EXTRACT(EPOCH FROM (${blInventory.updatedAt} - ${blInventory.syncedAt})) < 5`)
          .orderBy(desc(blInventory.syncedAt))
          .limit(limit);
      } else if (type === 'updated') {
        // Updated items: updatedAt is significantly later than syncedAt (more than 5 seconds)
        recentItems = await db
          .select(baseSelect)
          .from(blInventory)
          .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
          .where(sql`EXTRACT(EPOCH FROM (${blInventory.updatedAt} - ${blInventory.syncedAt})) >= 5`)
          .orderBy(desc(blInventory.updatedAt))
          .limit(limit);
      } else {
        // All recent items (default behavior)
        recentItems = await db
          .select(baseSelect)
          .from(blInventory)
          .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
          .orderBy(desc(blInventory.updatedAt))
          .limit(limit);
      }

      res.json(recentItems);
    } catch (error) {
      console.error("Error fetching recent inventory updates:", error);
      res.status(500).json({ error: "Failed to fetch recent updates" });
    }
  });

  // Price-o-Matic: Get price guide for inventory item (MUST be before /api/inventory/:id)
  app.get("/api/inventory/price-guide/:itemNo/:itemType", isApproved, async (req, res) => {
    try {
      const { itemNo, itemType } = req.params;
      const colorId = req.query.color_id ? parseInt(req.query.color_id as string) : undefined;
      const newOrUsed = (req.query.new_or_used as string) || 'N'; // Default to New if not specified
      const premiumPercentage = req.query.premium ? parseInt(req.query.premium as string) : 15;

      if (!itemNo || !itemType) {
        return res.status(400).json({ error: "Item number and type are required" });
      }

      console.log(`[Price-o-Matic] Fetching price guide for ${itemType}/${itemNo}${colorId ? `/${colorId}` : ''}/${newOrUsed}`);

      const priceData = await fetchPriceOMagicData(itemNo, itemType, colorId, newOrUsed, premiumPercentage);

      res.json(priceData);
    } catch (error) {
      console.error("[Price-o-Matic] Error fetching price guide:", error);
      res.status(500).json({ 
        error: "Failed to fetch price guide", 
        message: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  // BrickLink Catalog Search (MUST be before /api/inventory/:id)
  app.get("/api/bricklink/catalog/:itemNo/:itemType", isApproved, async (req, res) => {
    try {
      const { itemNo, itemType } = req.params;

      if (!itemNo || !itemType) {
        return res.status(400).json({ error: "Item number and type are required" });
      }

      console.log(`[BrickLink Catalog] Searching for ${itemType}/${itemNo}`);

      const itemData = await searchBricklinkCatalogItem(itemNo, itemType);

      res.json(itemData);
    } catch (error) {
      console.error("[BrickLink Catalog] Error searching catalog:", error);
      res.status(500).json({ 
        error: "Failed to search BrickLink catalog", 
        message: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  // Get Inventory Item by ID (MUST be after /api/inventory/stats and price-guide to avoid route conflict)
  app.get("/api/inventory/:id", isApproved, async (req, res) => {
    try {
      const itemId = parseInt(req.params.id);
      if (isNaN(itemId)) {
        return res.status(400).json({ error: "Invalid item ID" });
      }

      const items = await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          itemName: blInventory.itemName,
          itemType: blInventory.itemType,
          colorId: blInventory.colorId,
          colorName: blColors.name,
          colorRgb: blColors.rgb,
          categoryId: blInventory.categoryId,
          categoryName: blCategories.name,
          quantity: blInventory.quantity,
          newOrUsed: blInventory.newOrUsed,
          completeness: blInventory.completeness,
          unitPrice: blInventory.unitPrice,
          myCost: blInventory.myCost,
          bindId: blInventory.bindId,
          description: blInventory.description,
          remarks: blInventory.remarks,
          bulk: blInventory.bulk,
          isRetain: blInventory.isRetain,
          isStockRoom: blInventory.isStockRoom,
          stockRoomId: blInventory.stockRoomId,
          dateCreated: blInventory.dateCreated,
          saleRate: blInventory.saleRate,
          tierPrice1: blInventory.tierPrice1,
          tierPrice2: blInventory.tierPrice2,
          tierPrice3: blInventory.tierPrice3,
          tierQuantity1: blInventory.tierQuantity1,
          tierQuantity2: blInventory.tierQuantity2,
          tierQuantity3: blInventory.tierQuantity3,
          myWeight: blInventory.myWeight,
          updatedAt: blInventory.updatedAt,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
        .where(eq(blInventory.id, itemId));

      if (items.length === 0) {
        return res.status(404).json({ error: "Item not found" });
      }

      res.json(items[0]);
    } catch (error) {
      console.error("Error fetching item by ID:", error);
      res.status(500).json({ error: "Failed to fetch item" });
    }
  });

  // Get Item Analytics
  app.get("/api/inventory/:id/analytics", isApproved, async (req, res) => {
    try {
      const itemId = parseInt(req.params.id);
      if (isNaN(itemId)) {
        return res.status(400).json({ error: "Invalid item ID" });
      }

      // Parse date range parameter
      const range = req.query.range as string;
      let dateFilter: Date | null = null;
      
      if (range) {
        const now = new Date();
        switch (range) {
          case '3months':
            dateFilter = new Date(now.setMonth(now.getMonth() - 3));
            break;
          case '6months':
            dateFilter = new Date(now.setMonth(now.getMonth() - 6));
            break;
          case '1year':
            dateFilter = new Date(now.setFullYear(now.getFullYear() - 1));
            break;
          case '2years':
            dateFilter = new Date(now.setFullYear(now.getFullYear() - 2));
            break;
          default:
            dateFilter = null; // 'all' or invalid range
        }
      }

      // Get the inventory item
      const [item] = await db
        .select({ id: blInventory.id, dateCreated: blInventory.dateCreated })
        .from(blInventory)
        .where(eq(blInventory.id, itemId))
        .limit(1);

      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }

      // Build query conditions - match SKU (inventory ID as text) to inventory ID
      // Filter out non-numeric SKUs (custom codes like "M40-1") to avoid cast errors
      // Also filter out SKUs longer than 9 digits to prevent integer overflow (max int is 2,147,483,647)
      const conditions = [
        sql`${orderDetails.sku} ~ '^[0-9]{1,9}$'`, // Only numeric SKUs with max 9 digits
        sql`CAST(${orderDetails.sku} AS INTEGER) = ${item.id}`
      ];
      if (dateFilter) {
        conditions.push(sql`${orders.orderDate} >= ${dateFilter.toISOString()}`);
      }

      // Query all sales for this item (matching SKU to itemNo)
      const sales = await db
        .select({
          orderId: orderDetails.orderId,
          quantity: orderDetails.quantity,
          unitPrice: orderDetails.unitPrice,
          orderDate: orders.orderDate,
          customerUsername: orders.customerUsername,
          customerEmail: orders.customerEmail,
          orderStatus: orders.orderStatus,
        })
        .from(orderDetails)
        .innerJoin(orders, eq(orderDetails.orderId, orders.id))
        .where(and(...conditions))
        .orderBy(desc(orders.orderDate));

      // Calculate analytics metrics
      const totalUnitsSold = sales.reduce((sum, sale) => sum + sale.quantity, 0);
      const totalRevenue = sales.reduce((sum, sale) => sum + (sale.quantity * parseFloat(sale.unitPrice || "0")), 0);
      const averageSellingPrice = totalUnitsSold > 0 ? totalRevenue / totalUnitsSold : 0;

      // Calculate sales by month
      const salesByMonth: Record<string, { units: number; revenue: number }> = {};
      sales.forEach(sale => {
        const monthKey = new Date(sale.orderDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        if (!salesByMonth[monthKey]) {
          salesByMonth[monthKey] = { units: 0, revenue: 0 };
        }
        salesByMonth[monthKey].units += sale.quantity;
        salesByMonth[monthKey].revenue += sale.quantity * parseFloat(sale.unitPrice || "0");
      });

      // Find best selling month
      let bestMonth = { month: '', units: 0 };
      Object.entries(salesByMonth).forEach(([month, data]) => {
        if (data.units > bestMonth.units) {
          bestMonth = { month, units: data.units };
        }
      });

      // Calculate days since last sold
      let daysSinceLastSold = null;
      if (sales.length > 0) {
        const lastSaleDate = new Date(sales[0].orderDate);
        const now = new Date();
        daysSinceLastSold = Math.floor((now.getTime() - lastSaleDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      // Calculate sales velocity (units per month)
      let salesVelocity = 0;
      if (sales.length > 0) {
        const firstSaleDate = new Date(sales[sales.length - 1].orderDate);
        const lastSaleDate = new Date(sales[0].orderDate);
        const monthsDiff = (lastSaleDate.getTime() - firstSaleDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
        salesVelocity = monthsDiff > 0 ? totalUnitsSold / monthsDiff : totalUnitsSold;
      }

      // Identify top customers
      const customerPurchases: Record<string, { name: string; units: number; revenue: number; orders: number }> = {};
      sales.forEach(sale => {
        const customerKey = sale.customerUsername || sale.customerEmail || 'Unknown';
        if (!customerPurchases[customerKey]) {
          customerPurchases[customerKey] = { 
            name: customerKey, 
            units: 0, 
            revenue: 0,
            orders: 0
          };
        }
        customerPurchases[customerKey].units += sale.quantity;
        customerPurchases[customerKey].revenue += sale.quantity * parseFloat(sale.unitPrice || "0");
        customerPurchases[customerKey].orders += 1;
      });

      const topCustomers = Object.values(customerPurchases)
        .sort((a, b) => b.units - a.units)
        .slice(0, 5);

      // Days in inventory
      let daysInInventory = null;
      if (item.dateCreated) {
        const now = new Date();
        const created = new Date(item.dateCreated);
        daysInInventory = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      }

      // Recent sales (last 3 months)
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const recentSales = sales.filter(sale => new Date(sale.orderDate) >= threeMonthsAgo);
      const recentUnitsSold = recentSales.reduce((sum, sale) => sum + sale.quantity, 0);

      res.json({
        totalUnitsSold,
        totalRevenue: totalRevenue.toFixed(2),
        averageSellingPrice: averageSellingPrice.toFixed(2),
        salesVelocity: salesVelocity.toFixed(1),
        daysSinceLastSold,
        daysInInventory,
        bestSellingMonth: bestMonth.month || 'N/A',
        bestSellingMonthUnits: bestMonth.units,
        topCustomers,
        recentSales: {
          last3Months: recentUnitsSold,
          percentOfTotal: totalUnitsSold > 0 ? ((recentUnitsSold / totalUnitsSold) * 100).toFixed(1) : '0'
        },
        salesByMonth: Object.entries(salesByMonth).map(([month, data]) => ({
          month,
          units: data.units,
          revenue: data.revenue.toFixed(2)
        })).reverse().slice(0, 12), // Last 12 months
        totalOrders: sales.length,
      });
    } catch (error) {
      console.error("Error fetching item analytics:", error);
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  });

  // Rate Limit Status
  app.get("/api/bricklink/rate-limit", isApproved, async (req, res) => {
    try {
      const { checkRateLimit } = await import("./services/bricklink");
      const status = await checkRateLimit();
      res.json(status);
    } catch (error) {
      console.error("Error checking rate limit:", error);
      res.status(500).json({ error: "Failed to check rate limit" });
    }
  });

  // Sync Routes
  app.post("/api/sync/bricklink/inventory", isApproved, async (req, res) => {
    try {
      const result = await syncBricklinkData();
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("BrickLink sync error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to sync BrickLink inventory",
      });
    }
  });

  // Bulk Rebrickable Image Sync (one-time operation to fetch all images)
  app.post("/api/sync/rebrickable/bulk-images", isApproved, async (req, res) => {
    console.log('🔍 [DEBUG] Bulk image sync route HIT');
    try {
      const maxBatches = req.body?.maxBatches || 500;
      console.log(`🔍 [DEBUG] maxBatches: ${maxBatches}`);
      
      // Start the sync in background - don't await it
      console.log(`[Rebrickable Bulk Sync] Starting bulk image sync in background (max ${maxBatches} batches)...`);
      
      // Import and start the sync without awaiting
      import("./services/rebrickable-images").then(async ({ bulkSyncRebrickableImages }) => {
        console.log('[Rebrickable Bulk Sync] Background sync process started');
        try {
          const result = await bulkSyncRebrickableImages(maxBatches);
          console.log('[Rebrickable Bulk Sync] Background sync complete:', JSON.stringify(result));
        } catch (error) {
          console.error('[Rebrickable Bulk Sync] Background sync error:', error);
        }
      });
      
      // Return immediately to client
      res.json({
        success: true,
        message: "Image sync started in background. This will continue even if you close this page.",
        data: {
          status: "started",
          maxBatches
        }
      });
    } catch (error) {
      console.error("🔍 [DEBUG] Rebrickable bulk sync error:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to start bulk sync",
      });
    }
  });

  // Get BrickLink sync progress (for real-time UI updates)
  app.get("/api/sync/bricklink/progress", isApproved, async (req, res) => {
    try {
      const { syncProgressTracker } = await import('./services/sync-progress');
      const progress = syncProgressTracker.get();
      res.json(progress);
    } catch (error) {
      console.error("Error fetching sync progress:", error);
      res.status(500).json({ error: "Failed to fetch sync progress" });
    }
  });

  // Get ShipStation sync progress (for real-time UI updates)
  app.get("/api/sync/shipstation/orders/progress", isApproved, async (req, res) => {
    try {
      const [metadata] = await db
        .select()
        .from(syncMetadata)
        .where(eq(syncMetadata.id, 'shipstation_orders'))
        .limit(1);
      
      if (!metadata) {
        res.json({ status: 'idle', progress: null });
        return;
      }
      
      res.json({
        status: metadata.lastSyncStatus,
        progress: metadata.errorMessage ? JSON.parse(metadata.errorMessage) : null,
        lastSync: metadata.lastSyncTime,
        recordsAdded: metadata.recordsAdded,
        recordsUpdated: metadata.recordsUpdated,
      });
    } catch (error) {
      console.error("Error fetching sync progress:", error);
      res.status(500).json({ error: "Failed to fetch sync progress" });
    }
  });

  app.post("/api/sync/shipstation/orders", isApproved, async (req, res) => {
    try {
      // Check for fullSync query parameter
      const fullSync = req.query.fullSync === 'true' || req.body.fullSync === true;
      const result = await syncShipStationOrders(fullSync);
      res.json({
        success: true,
        data: result,
        syncType: fullSync ? 'full' : 'incremental',
      });
    } catch (error) {
      console.error("ShipStation sync error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to sync ShipStation orders",
      });
    }
  });

  // BrickLink order sync endpoint
  app.post("/api/sync/bricklink/orders", isApproved, async (req, res) => {
    try {
      const { limit, fullSync } = req.body;
      
      // Get BrickLink credentials from settings
      const [settings] = await db
        .select()
        .from(appSettings)
        .limit(1);
      
      if (!settings?.bricklinkConsumerKey || !settings?.bricklinkConsumerSecret || 
          !settings?.bricklinkTokenValue || !settings?.bricklinkTokenSecret) {
        return res.status(400).json({
          success: false,
          error: "BrickLink API credentials not configured",
        });
      }
      
      const { syncBrickLinkOrders } = await import("./services/bricklink-order-sync");
      
      const result = await syncBrickLinkOrders(
        settings.bricklinkConsumerKey,
        settings.bricklinkConsumerSecret,
        settings.bricklinkTokenValue,
        settings.bricklinkTokenSecret,
        { limit, fullSync }
      );
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error("BrickLink order sync error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to sync BrickLink orders",
      });
    }
  });

  // BrickOwl order sync endpoint
  app.post("/api/sync/brickowl/orders", isApproved, async (req, res) => {
    try {
      const { limit, fullSync } = req.body;
      
      // Get BrickOwl API key from settings
      const [settings] = await db
        .select()
        .from(appSettings)
        .limit(1);
      
      if (!settings?.brickowlApiKey) {
        return res.status(400).json({
          success: false,
          error: "BrickOwl API key not configured",
        });
      }
      
      const { syncBrickOwlOrders } = await import("./services/brickowl-order-sync");
      
      const result = await syncBrickOwlOrders(
        settings.brickowlApiKey,
        { limit, fullSync }
      );
      
      res.json({
        success: true,
        data: result,
      });
    } catch (error: any) {
      console.error("BrickOwl order sync error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to sync BrickOwl orders",
      });
    }
  });

  // Multi-platform order sync endpoint (BrickLink + BrickOwl)
  app.post("/api/sync/all-platforms/orders", isApproved, async (req, res) => {
    try {
      const { limit = 50, fullSync = false } = req.body; // Default to 50 orders for manual sync
      
      console.log(`🔄 Manual platform sync triggered (limit: ${limit}, fullSync: ${fullSync})`);
      
      // Get API credentials from settings
      const [settings] = await db
        .select()
        .from(appSettings)
        .limit(1);
      
      const results = {
        bricklink: { 
          success: false, 
          data: null as any, 
          error: null as string | null,
          skipped: false,
        },
        brickowl: { 
          success: false, 
          data: null as any, 
          error: null as string | null,
          skipped: false,
        },
      };
      
      // 1. Sync BrickLink orders
      if (settings?.bricklinkConsumerKey && settings?.bricklinkConsumerSecret && 
          settings?.bricklinkTokenValue && settings?.bricklinkTokenSecret) {
        try {
          console.log(`📦 Starting BrickLink sync (limit: ${limit})...`);
          const { syncBrickLinkOrders } = await import("./services/bricklink-order-sync");
          
          const result = await syncBrickLinkOrders(
            settings.bricklinkConsumerKey,
            settings.bricklinkConsumerSecret,
            settings.bricklinkTokenValue,
            settings.bricklinkTokenSecret,
            { limit, fullSync }
          );
          
          results.bricklink.success = true;
          results.bricklink.data = result;
          console.log(`✅ BrickLink sync complete:`, result);
        } catch (error: any) {
          console.error("❌ BrickLink sync failed:", error);
          results.bricklink.error = error.message || "Failed to sync BrickLink orders";
        }
      } else {
        results.bricklink.skipped = true;
        results.bricklink.error = "BrickLink credentials not configured";
        console.log("⏭️ BrickLink skipped - credentials not configured");
      }
      
      // 2. Sync BrickOwl orders
      if (settings?.brickowlApiKey) {
        try {
          console.log(`🦉 Starting BrickOwl sync (limit: ${limit})...`);
          const { syncBrickOwlOrders } = await import("./services/brickowl-order-sync");
          
          const result = await syncBrickOwlOrders(
            settings.brickowlApiKey,
            { limit, fullSync }
          );
          
          results.brickowl.success = true;
          results.brickowl.data = result;
          console.log(`✅ BrickOwl sync complete:`, result);
        } catch (error: any) {
          console.error("❌ BrickOwl sync failed:", error);
          results.brickowl.error = error.message || "Failed to sync BrickOwl orders";
        }
      } else {
        results.brickowl.skipped = true;
        results.brickowl.error = "BrickOwl API key not configured";
        console.log("⏭️ BrickOwl skipped - credentials not configured");
      }
      
      // Determine overall success
      const anySuccess = results.bricklink.success || results.brickowl.success;
      const allSkipped = results.bricklink.skipped && results.brickowl.skipped;
      
      console.log(`✨ Manual platform sync complete (success: ${anySuccess}, allSkipped: ${allSkipped})`);
      
      res.json({
        success: anySuccess,
        allSkipped,
        results,
      });
    } catch (error: any) {
      console.error("❌ Multi-platform order sync error:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to sync platform orders",
      });
    }
  });

  // Get Order Sync Status for all platforms
  app.get("/api/order-sync/status", isApproved, async (req, res) => {
    try {
      // Get local database order stats
      const dbOrderStats = await db
        .select({
          totalOrders: sql<number>`COUNT(*)`,
          totalItems: sql<number>`SUM((SELECT COUNT(*) FROM ${orderDetails} WHERE ${orderDetails.orderId} = ${orders.id}))`,
          pendingOrders: sql<number>`COUNT(CASE WHEN ${orders.orderStatus} IN ('awaiting_payment', 'awaiting_shipment', 'pending') THEN 1 END)`,
          shippedOrders: sql<number>`COUNT(CASE WHEN ${orders.orderStatus} = 'shipped' THEN 1 END)`,
        })
        .from(orders);

      const dbStats = {
        totalOrders: Number(dbOrderStats[0]?.totalOrders) || 0,
        totalItems: Number(dbOrderStats[0]?.totalItems) || 0,
        pendingOrders: Number(dbOrderStats[0]?.pendingOrders) || 0,
        shippedOrders: Number(dbOrderStats[0]?.shippedOrders) || 0,
      };

      // Get settings to check API credentials
      const [settings] = await db.select().from(appSettings).limit(1);
      const bricklinkEnabled = !!(settings?.bricklinkConsumerKey && settings?.bricklinkConsumerSecret && 
        settings?.bricklinkTokenValue && settings?.bricklinkTokenSecret);
      const brickowlEnabled = !!settings?.brickowlApiKey;

      // Get last sync times from sync_metadata
      const [blSyncMeta] = await db
        .select()
        .from(syncMetadata)
        .where(eq(syncMetadata.id, 'bricklink_orders'))
        .limit(1);

      const [boSyncMeta] = await db
        .select()
        .from(syncMetadata)
        .where(eq(syncMetadata.id, 'brickowl_orders'))
        .limit(1);

      // Get BrickLink order stats from local database
      const blLocalStats = await db
        .select({
          totalOrders: sql<number>`COUNT(*)`,
          totalItems: sql<number>`SUM((SELECT COUNT(*) FROM ${orderDetails} WHERE ${orderDetails.orderId} = ${orders.id}))`,
          pendingOrders: sql<number>`COUNT(CASE WHEN ${orders.orderStatus} IN ('awaiting_payment', 'awaiting_shipment', 'pending') THEN 1 END)`,
        })
        .from(orders)
        .where(eq(orders.marketplace, 'BrickLink'));

      const brickLinkStats = {
        totalOrders: Number(blLocalStats[0]?.totalOrders) || 0,
        totalItems: Number(blLocalStats[0]?.totalItems) || 0,
        pendingOrders: Number(blLocalStats[0]?.pendingOrders) || 0,
        lastSyncedAt: blSyncMeta?.lastSyncTime?.toISOString() || null,
      };

      // Get BrickOwl order stats from local database
      const boLocalStats = await db
        .select({
          totalOrders: sql<number>`COUNT(*)`,
          totalItems: sql<number>`SUM((SELECT COUNT(*) FROM ${orderDetails} WHERE ${orderDetails.orderId} = ${orders.id}))`,
          pendingOrders: sql<number>`COUNT(CASE WHEN ${orders.orderStatus} IN ('awaiting_payment', 'awaiting_shipment', 'pending') THEN 1 END)`,
        })
        .from(orders)
        .where(eq(orders.marketplace, 'BrickOwl'));

      const brickOwlStats = {
        totalOrders: Number(boLocalStats[0]?.totalOrders) || 0,
        totalItems: Number(boLocalStats[0]?.totalItems) || 0,
        pendingOrders: Number(boLocalStats[0]?.pendingOrders) || 0,
        lastSyncedAt: boSyncMeta?.lastSyncTime?.toISOString() || null,
      };

      // For now, we can't easily get differentials without making API calls
      // So we'll just return the stats and indicate if API is configured
      const orderSyncStatus = {
        platforms: [
          {
            name: 'BrickLink',
            enabled: bricklinkEnabled,
            stats: brickLinkStats,
            differentials: {
              // These would need API calls to calculate - leaving as 0 for now
              missingOrders: 0,
              statusDifferences: 0,
            },
          },
          {
            name: 'BrickOwl',
            enabled: brickowlEnabled,
            stats: brickOwlStats,
            differentials: {
              // These would need API calls to calculate - leaving as 0 for now
              missingOrders: 0,
              statusDifferences: 0,
            },
          },
        ],
        summary: {
          totalOrders: dbStats.totalOrders,
          totalItems: dbStats.totalItems,
          pendingOrders: dbStats.pendingOrders,
          shippedOrders: dbStats.shippedOrders,
        },
      };

      res.json(orderSyncStatus);
    } catch (error) {
      console.error("Error fetching order sync status:", error);
      res.status(500).json({ error: "Failed to fetch order sync status" });
    }
  });

  // Marketplace diagnostic endpoint
  app.get("/api/orders/marketplace-diagnostic", isApproved, async (req, res) => {
    try {
      // Get summary statistics
      const stats = await db.execute(sql`
        SELECT 
          marketplace,
          COUNT(*) as count,
          ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM orders), 1) as percentage
        FROM orders
        GROUP BY marketplace
        ORDER BY count DESC
      `);

      // Get sample "Unknown" orders with their data
      const unknownSamples = await db.execute(sql`
        SELECT 
          order_number,
          order_key,
          marketplace,
          order_date,
          CASE 
            WHEN order_number ~ '^BL\\.' THEN 'Should be: BrickLink'
            WHEN order_number ~ '^BO\\.' THEN 'Should be: BrickOwl'
            WHEN order_number ~ '^LBS' THEN 'Should be: eBay'
            WHEN order_number ~ '^\\d{7,8}$' THEN 'Should be: BrickLink (numeric)'
            WHEN order_number ~ '^\\d{3}-\\d{7}-\\d{7}$' THEN 'Should be: Amazon'
            WHEN order_number ~ '^\\d{2}-\\d{5}-\\d{5}$' THEN 'Should be: eBay'
            WHEN order_number ~ '^\\d{12}-\\d{13}$' THEN 'Should be: eBay (long format)'
            ELSE 'Pattern not recognized'
          END as detected_pattern
        FROM orders 
        WHERE marketplace IS NULL
        ORDER BY order_date DESC
        LIMIT 20
      `);

      res.json({
        success: true,
        summary: stats.rows,
        unknownSamples: unknownSamples.rows,
        insights: {
          totalOrders: stats.rows.reduce((sum: number, row: any) => sum + Number(row.count), 0),
          unknownCount: stats.rows.find((row: any) => row.marketplace === null)?.count || 0,
          detectionMethods: [
            { priority: 1, method: 'advancedOptions.source', description: 'Most reliable - direct marketplace field' },
            { priority: 2, method: 'Custom Fields', description: 'Check customField1, customField2, customField3' },
            { priority: 3, method: 'Order Number Pattern', description: 'BL., BO., LBS, numeric patterns' },
            { priority: 4, method: 'Order Key Pattern', description: 'EBAY-, AMZN-, etc. prefixes' },
            { priority: 5, method: 'Customer Email Domain', description: 'Marketplace notification emails' },
            { priority: 6, method: 'Shipping Service', description: 'Carrier code or service mentions' },
            { priority: 7, method: 'Store ID', description: 'advancedOptions.storeId references' },
            { priority: 8, method: 'Order Notes', description: 'Internal/customer notes mentioning marketplace' }
          ],
          detectionPatterns: [
            { pattern: 'BL.XXXXXXX', platform: 'BrickLink' },
            { pattern: 'BO.XXXXXXX', platform: 'BrickOwl' },
            { pattern: 'LBS*', platform: 'eBay' },
            { pattern: '7-8 digits', platform: 'BrickLink (legacy)' },
            { pattern: 'XXX-XXXXXXX-XXXXXXX', platform: 'Amazon' },
            { pattern: 'XX-XXXXX-XXXXX', platform: 'eBay' },
            { pattern: '12-13 digit with hyphen', platform: 'eBay (long)' }
          ]
        }
      });
    } catch (error) {
      console.error("Marketplace diagnostic error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to generate marketplace diagnostic",
      });
    }
  });

  // Price-o-Matic sync endpoint
  app.post("/api/sync/priceomatic", isApproved, async (req, res) => {
    try {
      const maxItems = req.body.maxItems || 1500;
      
      // Check if a sync is already in progress
      const [existingSync] = await db
        .select()
        .from(syncMetadata)
        .where(eq(syncMetadata.id, 'priceomatic_cache'))
        .limit(1);
      
      // If sync is in progress and started less than 10 minutes ago, reject
      if (existingSync?.lastSyncStatus === 'in_progress' && existingSync.lastSyncTime) {
        const timeSinceSync = Date.now() - new Date(existingSync.lastSyncTime).getTime();
        const tenMinutesInMs = 10 * 60 * 1000;
        
        if (timeSinceSync < tenMinutesInMs) {
          return res.status(409).json({
            success: false,
            error: 'A sync is already in progress. Please wait for it to complete.',
          });
        }
        // If sync has been in progress for more than 10 minutes, consider it stale and allow new sync
      }
      
      // Update sync metadata to "in_progress"
      await db
        .insert(syncMetadata)
        .values({
          id: 'priceomatic_cache',
          lastSyncStatus: 'in_progress',
          lastSyncTime: new Date(),
          recordsAdded: 0,
          recordsUpdated: 0,
        })
        .onConflictDoUpdate({
          target: syncMetadata.id,
          set: {
            lastSyncStatus: 'in_progress',
            lastSyncTime: new Date(),
            updatedAt: new Date(),
          },
        });

      // Start the sync in the background (don't await)
      syncPriceOMagicCache(maxItems).then(async (result) => {
        // Update sync metadata with results
        await db
          .insert(syncMetadata)
          .values({
            id: 'priceomatic_cache',
            lastSyncStatus: result.stopped && result.stopReason?.includes('limit') ? 'partial' : 'success',
            lastSyncTime: new Date(),
            recordsAdded: 0,
            recordsUpdated: result.itemsUpdated,
            errorMessage: result.stopReason || null,
          })
          .onConflictDoUpdate({
            target: syncMetadata.id,
            set: {
              lastSyncStatus: result.stopped && result.stopReason?.includes('limit') ? 'partial' : 'success',
              lastSyncTime: new Date(),
              recordsUpdated: result.itemsUpdated,
              errorMessage: result.stopReason || null,
              updatedAt: new Date(),
            },
          });
      }).catch(async (error) => {
        console.error("Price-o-Matic background sync error:", error);
        
        // Update sync metadata to failed
        await db
          .insert(syncMetadata)
          .values({
            id: 'priceomatic_cache',
            lastSyncStatus: 'failed',
            lastSyncTime: new Date(),
            recordsAdded: 0,
            recordsUpdated: 0,
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          })
          .onConflictDoUpdate({
            target: syncMetadata.id,
            set: {
              lastSyncStatus: 'failed',
              errorMessage: error instanceof Error ? error.message : 'Unknown error',
              updatedAt: new Date(),
            },
          });
      });

      // Respond immediately that sync has started
      res.json({
        success: true,
        data: {
          message: 'Sync started in background',
          maxItems,
        },
      });
    } catch (error) {
      console.error("Price-o-Matic sync start error:", error);
      
      res.status(500).json({
        success: false,
        error: "Failed to start Price-o-Matic sync",
      });
    }
  });

  // Get Price-o-Matic sync status
  app.get("/api/sync/priceomatic/status", isApproved, async (req, res) => {
    try {
      const [status] = await db
        .select()
        .from(syncMetadata)
        .where(eq(syncMetadata.id, 'priceomatic_cache'))
        .limit(1);

      res.json({
        success: true,
        data: status || {
          id: 'priceomatic_cache',
          lastSyncStatus: 'never',
          lastSyncTime: null,
          recordsUpdated: 0,
        },
      });
    } catch (error) {
      console.error("Error fetching Price-o-Matic status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch sync status",
      });
    }
  });

  // Get Price-o-Matic insights (pricing discrepancies)
  app.get("/api/priceomatic/insights", isApproved, async (req, res) => {
    try {
      const { priceGuideCache } = await import("@shared/schema");
      
      // Join inventory with cached price data to find discrepancies
      const insights = await db
        .select({
          inventoryId: blInventory.id,
          itemNo: blInventory.itemNo,
          itemName: blInventory.itemName,
          itemType: blInventory.itemType,
          colorId: blInventory.colorId,
          colorName: blInventory.colorName,
          newOrUsed: blInventory.newOrUsed,
          currentPrice: blInventory.unitPrice,
          suggestedPrice: priceGuideCache.suggestedPrice,
          stockAvgPrice: priceGuideCache.stockAvgPrice,
          soldAvgPrice: priceGuideCache.soldAvgPrice,
          premiumPercentage: priceGuideCache.premiumPercentage,
          quantity: blInventory.quantity,
          lastFetched: priceGuideCache.fetchedAt,
        })
        .from(blInventory)
        .innerJoin(
          priceGuideCache,
          and(
            eq(blInventory.itemNo, priceGuideCache.itemNo),
            eq(blInventory.itemType, priceGuideCache.itemType),
            sql`(${blInventory.colorId} = ${priceGuideCache.colorId} OR (${blInventory.colorId} IS NULL AND ${priceGuideCache.colorId} IS NULL))`
          )
        )
        .where(sql`${blInventory.unitPrice} IS NOT NULL AND ${priceGuideCache.suggestedPrice} IS NOT NULL`);

      // Calculate price variance and categorize
      const categorizedInsights = insights.map(item => {
        const currentPrice = parseFloat(item.currentPrice || '0');
        const suggestedPrice = parseFloat(item.suggestedPrice || '0');
        const variance = ((currentPrice - suggestedPrice) / suggestedPrice) * 100;
        
        let category: 'too_high' | 'too_low' | 'good' = 'good';
        if (variance > 20) category = 'too_high';
        else if (variance < -20) category = 'too_low';
        
        return {
          ...item,
          variance: Math.round(variance),
          category,
        };
      });

      // Separate into categories
      const tooHigh = categorizedInsights.filter(i => i.category === 'too_high');
      const tooLow = categorizedInsights.filter(i => i.category === 'too_low');
      const wellPriced = categorizedInsights.filter(i => i.category === 'good');

      res.json({
        success: true,
        data: {
          tooHigh,
          tooLow,
          wellPriced,
          summary: {
            total: insights.length,
            tooHigh: tooHigh.length,
            tooLow: tooLow.length,
            wellPriced: wellPriced.length,
          },
        },
      });
    } catch (error) {
      console.error("Error fetching Price-o-Matic insights:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch pricing insights",
      });
    }
  });

  // ========================================
  // WAREHOUSE MANAGEMENT ROUTES
  // ========================================

  // Get all aisles with shelf and bin counts
  app.get("/api/warehouse/aisles", isApproved, async (req, res) => {
    try {
      const aislesWithCounts = await db
        .select({
          id: whAisles.id,
          name: whAisles.name,
          description: whAisles.description,
          createdAt: whAisles.createdAt,
          updatedAt: whAisles.updatedAt,
          shelfCount: sql<number>`(SELECT COUNT(*) FROM ${whShelves} WHERE ${whShelves.aisleId} = ${whAisles.id})`,
        })
        .from(whAisles)
        .orderBy(whAisles.name);

      res.json(aislesWithCounts);
    } catch (error) {
      console.error("Error fetching aisles:", error);
      res.status(500).json({ error: "Failed to fetch aisles" });
    }
  });

  // Create aisle
  app.post("/api/warehouse/aisles", isApproved, async (req, res) => {
    try {
      const data = insertWhAisleSchema.parse(req.body);
      const [aisle] = await db
        .insert(whAisles)
        .values(data)
        .returning();
      res.json(aisle);
    } catch (error) {
      console.error("Error creating aisle:", error);
      res.status(500).json({ error: "Failed to create aisle" });
    }
  });

  // Update aisle
  app.put("/api/warehouse/aisles/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = insertWhAisleSchema.parse(req.body);
      const [aisle] = await db
        .update(whAisles)
        .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(whAisles.id, id))
        .returning();
      
      if (!aisle) {
        return res.status(404).json({ error: "Aisle not found" });
      }
      res.json(aisle);
    } catch (error) {
      console.error("Error updating aisle:", error);
      res.status(500).json({ error: "Failed to update aisle" });
    }
  });

  // Delete aisle
  app.delete("/api/warehouse/aisles/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(whAisles).where(eq(whAisles.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting aisle:", error);
      res.status(500).json({ error: "Failed to delete aisle" });
    }
  });

  // Get all shelves (with optional aisle filter)
  app.get("/api/warehouse/shelves", isApproved, async (req, res) => {
    try {
      const aisleId = req.query.aisleId ? parseInt(req.query.aisleId as string) : null;
      
      const shelvesWithCounts = await db
        .select({
          id: whShelves.id,
          name: whShelves.name,
          aisleId: whShelves.aisleId,
          aisleName: whAisles.name,
          position: whShelves.position,
          description: whShelves.description,
          createdAt: whShelves.createdAt,
          updatedAt: whShelves.updatedAt,
          binCount: sql<number>`(SELECT COUNT(*) FROM ${whBins} WHERE ${whBins.shelfId} = ${whShelves.id})`,
        })
        .from(whShelves)
        .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
        .where(aisleId ? eq(whShelves.aisleId, aisleId) : undefined)
        .orderBy(whShelves.aisleId, whShelves.position);

      res.json(shelvesWithCounts);
    } catch (error) {
      console.error("Error fetching shelves:", error);
      res.status(500).json({ error: "Failed to fetch shelves" });
    }
  });

  // Create shelf
  app.post("/api/warehouse/shelves", isApproved, async (req, res) => {
    try {
      const data = insertWhShelfSchema.parse(req.body);
      const [shelf] = await db
        .insert(whShelves)
        .values(data)
        .returning();
      res.json(shelf);
    } catch (error) {
      console.error("Error creating shelf:", error);
      res.status(500).json({ error: "Failed to create shelf" });
    }
  });

  // Update shelf
  app.put("/api/warehouse/shelves/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = insertWhShelfSchema.parse(req.body);
      const [shelf] = await db
        .update(whShelves)
        .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(whShelves.id, id))
        .returning();
      
      if (!shelf) {
        return res.status(404).json({ error: "Shelf not found" });
      }
      res.json(shelf);
    } catch (error) {
      console.error("Error updating shelf:", error);
      res.status(500).json({ error: "Failed to update shelf" });
    }
  });

  // Delete shelf
  app.delete("/api/warehouse/shelves/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(whShelves).where(eq(whShelves.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting shelf:", error);
      res.status(500).json({ error: "Failed to delete shelf" });
    }
  });

  // Get all bins (with optional shelf filter)
  app.get("/api/warehouse/bins", isApproved, async (req, res) => {
    try {
      const shelfId = req.query.shelfId ? parseInt(req.query.shelfId as string) : null;
      
      const binsWithDetails = await db
        .select({
          id: whBins.id,
          name: whBins.name,
          shelfId: whBins.shelfId,
          shelfName: whShelves.name,
          aisleId: whAisles.id,
          aisleName: whAisles.name,
          position: whBins.position,
          description: whBins.description,
          createdAt: whBins.createdAt,
          updatedAt: whBins.updatedAt,
          itemCount: sql<number>`(SELECT COUNT(*) FROM ${inventoryLocations} WHERE ${inventoryLocations.binId} = ${whBins.id})`,
        })
        .from(whBins)
        .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
        .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
        .where(shelfId ? eq(whBins.shelfId, shelfId) : undefined)
        .orderBy(whBins.shelfId, whBins.position);

      res.json(binsWithDetails);
    } catch (error) {
      console.error("Error fetching bins:", error);
      res.status(500).json({ error: "Failed to fetch bins" });
    }
  });

  // Create bin
  app.post("/api/warehouse/bins", isApproved, async (req, res) => {
    try {
      const data = insertWhBinSchema.parse(req.body);
      const [bin] = await db
        .insert(whBins)
        .values(data)
        .returning();
      res.json(bin);
    } catch (error) {
      console.error("Error creating bin:", error);
      res.status(500).json({ error: "Failed to create bin" });
    }
  });

  // Update bin
  app.put("/api/warehouse/bins/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = insertWhBinSchema.parse(req.body);
      const [bin] = await db
        .update(whBins)
        .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(whBins.id, id))
        .returning();
      
      if (!bin) {
        return res.status(404).json({ error: "Bin not found" });
      }
      res.json(bin);
    } catch (error) {
      console.error("Error updating bin:", error);
      res.status(500).json({ error: "Failed to update bin" });
    }
  });

  // Delete bin
  app.delete("/api/warehouse/bins/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(whBins).where(eq(whBins.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting bin:", error);
      res.status(500).json({ error: "Failed to delete bin" });
    }
  });

  // Get unassigned inventory items (not in any bin)
  app.get("/api/warehouse/unassigned/inventory", isApproved, async (req, res) => {
    try {
      const unassignedItems = await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          itemName: blInventory.itemName,
          colorName: blColors.name,
          newOrUsed: blInventory.newOrUsed,
          quantity: blInventory.quantity,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(inventoryLocations, eq(blInventory.id, inventoryLocations.inventoryId))
        .where(sql`${inventoryLocations.id} IS NULL`)
        .limit(1000); // Limit to avoid performance issues

      res.json(unassignedItems);
    } catch (error) {
      console.error("Error fetching unassigned inventory:", error);
      res.status(500).json({ error: "Failed to fetch unassigned inventory" });
    }
  });

  // Get unassigned bins (not on any shelf)
  app.get("/api/warehouse/unassigned/bins", isApproved, async (req, res) => {
    try {
      const unassignedBins = await db
        .select()
        .from(whBins)
        .where(sql`${whBins.shelfId} IS NULL`);

      res.json(unassignedBins);
    } catch (error) {
      console.error("Error fetching unassigned bins:", error);
      res.status(500).json({ error: "Failed to fetch unassigned bins" });
    }
  });

  // Get unassigned shelves (not in any aisle)
  app.get("/api/warehouse/unassigned/shelves", isApproved, async (req, res) => {
    try {
      const unassignedShelves = await db
        .select()
        .from(whShelves)
        .where(sql`${whShelves.aisleId} IS NULL`);

      res.json(unassignedShelves);
    } catch (error) {
      console.error("Error fetching unassigned shelves:", error);
      res.status(500).json({ error: "Failed to fetch unassigned shelves" });
    }
  });

  // Assign inventory to bin
  app.post("/api/warehouse/assign/inventory", isApproved, async (req, res) => {
    try {
      const data = insertInventoryLocationSchema.parse(req.body);
      const [location] = await db
        .insert(inventoryLocations)
        .values(data)
        .returning();
      res.json(location);
    } catch (error) {
      console.error("Error assigning inventory:", error);
      res.status(500).json({ error: "Failed to assign inventory" });
    }
  });

  // Assign bin to shelf
  app.put("/api/warehouse/assign/bin/:binId/shelf/:shelfId", isApproved, async (req, res) => {
    try {
      const binId = parseInt(req.params.binId);
      const shelfId = parseInt(req.params.shelfId);
      const [bin] = await db
        .update(whBins)
        .set({ shelfId, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(whBins.id, binId))
        .returning();
      
      if (!bin) {
        return res.status(404).json({ error: "Bin not found" });
      }
      res.json(bin);
    } catch (error) {
      console.error("Error assigning bin to shelf:", error);
      res.status(500).json({ error: "Failed to assign bin to shelf" });
    }
  });

  // Assign shelf to aisle
  app.put("/api/warehouse/assign/shelf/:shelfId/aisle/:aisleId", isApproved, async (req, res) => {
    try {
      const shelfId = parseInt(req.params.shelfId);
      const aisleId = parseInt(req.params.aisleId);
      const [shelf] = await db
        .update(whShelves)
        .set({ aisleId, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(whShelves.id, shelfId))
        .returning();
      
      if (!shelf) {
        return res.status(404).json({ error: "Shelf not found" });
      }
      res.json(shelf);
    } catch (error) {
      console.error("Error assigning shelf to aisle:", error);
      res.status(500).json({ error: "Failed to assign shelf to aisle" });
    }
  });

  // Get inventory locations with full details
  app.get("/api/warehouse/locations", isApproved, async (req, res) => {
    try {
      const locations = await db
        .select({
          id: inventoryLocations.id,
          inventoryId: inventoryLocations.inventoryId,
          itemNo: blInventory.itemNo,
          itemName: blInventory.itemName,
          colorName: blColors.name,
          newOrUsed: blInventory.newOrUsed,
          binId: inventoryLocations.binId,
          binName: whBins.name,
          bagLabel: inventoryLocations.bagLabel,
          quantity: inventoryLocations.quantity,
          shelfId: whShelves.id,
          shelfName: whShelves.name,
          aisleId: whAisles.id,
          aisleName: whAisles.name,
          notes: inventoryLocations.notes,
        })
        .from(inventoryLocations)
        .leftJoin(blInventory, eq(inventoryLocations.inventoryId, blInventory.id))
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
        .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
        .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
        .limit(1000);

      res.json(locations);
    } catch (error) {
      console.error("Error fetching locations:", error);
      res.status(500).json({ error: "Failed to fetch locations" });
    }
  });

  // Update inventory location
  app.put("/api/warehouse/locations/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = insertInventoryLocationSchema.parse(req.body);
      const [location] = await db
        .update(inventoryLocations)
        .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(inventoryLocations.id, id))
        .returning();
      
      if (!location) {
        return res.status(404).json({ error: "Location not found" });
      }
      res.json(location);
    } catch (error) {
      console.error("Error updating location:", error);
      res.status(500).json({ error: "Failed to update location" });
    }
  });

  // Delete inventory location (unassign item from bin)
  app.delete("/api/warehouse/locations/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(inventoryLocations).where(eq(inventoryLocations.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting location:", error);
      res.status(500).json({ error: "Failed to delete location" });
    }
  });

  // Picklist Routes
  
  // Get picklist stats (number of pending bins)
  app.get("/api/picklist/stats", isApproved, async (req, res) => {
    try {
      // Get active orders
      const activeOrders = await db
        .select()
        .from(orders)
        .where(
          or(
            like(orders.orderStatus, '%awaiting_payment%'),
            like(orders.orderStatus, '%awaiting_shipment%'),
            like(orders.orderStatus, '%awaiting_fulfillment%')
          )
        );

      if (activeOrders.length === 0) {
        return res.json({ toPull: 0, toReshelve: 0 });
      }

      const orderIds = activeOrders.map(o => o.id);

      // Get picklist items for active orders
      const picklistItemsData = await db
        .select()
        .from(picklistItems)
        .where(inArray(picklistItems.orderId, orderIds));

      // Filter out completed items (both pulled and reshelved)
      const activeItems = picklistItemsData.filter(item => !(item.pulled && item.reshelved));

      // Count unique bins that need to be pulled (not yet pulled)
      const binsToPull = new Set(
        activeItems
          .filter(item => item.binId && !item.pulled)
          .map(item => item.binId)
      ).size;

      // Count unique bins that need to be reshelved (pulled but not reshelved)
      const binsToReshelve = new Set(
        activeItems
          .filter(item => item.binId && item.pulled && !item.reshelved)
          .map(item => item.binId)
      ).size;

      res.json({ toPull: binsToPull, toReshelve: binsToReshelve });
    } catch (error) {
      console.error("Error fetching picklist stats:", error);
      res.status(500).json({ error: "Failed to fetch picklist stats" });
    }
  });
  
  // Get picklist items for active orders (awaiting payment, awaiting shipment, awaiting fulfillment)
  app.get("/api/picklist", isApproved, async (req, res) => {
    try {
      const filter = req.query.filter as string; // 'to_pull' | 'to_reshelve' | undefined
      
      // Get active orders
      const activeOrders = await db
        .select()
        .from(orders)
        .where(
          or(
            like(orders.orderStatus, '%awaiting_payment%'),
            like(orders.orderStatus, '%awaiting_shipment%'),
            like(orders.orderStatus, '%awaiting_fulfillment%')
          )
        );

      if (activeOrders.length === 0) {
        return res.json([]);
      }

      const orderIds = activeOrders.map(o => o.id);

      // Get order details for active orders
      const activeOrderDetails = await db
        .select()
        .from(orderDetails)
        .where(inArray(orderDetails.orderId, orderIds));

      // Get or create picklist items
      const existingPicklistItems = await db
        .select()
        .from(picklistItems)
        .where(inArray(picklistItems.orderId, orderIds));

      // Create missing picklist items
      const existingDetailIds = new Set(existingPicklistItems.map(p => p.orderDetailId));
      const missingDetails = activeOrderDetails.filter(d => !existingDetailIds.has(d.id));

      if (missingDetails.length > 0) {
        // Try to match order details to inventory using SKU (itemNo)
        for (const detail of missingDetails) {
          let inventoryId = null;
          let binId = null;

          if (detail.sku) {
            // Find inventory item by SKU
            const [inventoryItem] = await db
              .select()
              .from(blInventory)
              .where(eq(blInventory.itemNo, detail.sku))
              .limit(1);

            if (inventoryItem) {
              inventoryId = inventoryItem.id;

              // Find bin location for this inventory item
              const [location] = await db
                .select()
                .from(inventoryLocations)
                .where(eq(inventoryLocations.inventoryId, inventoryItem.id))
                .limit(1);

              if (location) {
                binId = location.binId;
              }
            }
          }

          await db.insert(picklistItems).values({
            orderDetailId: detail.id,
            orderId: detail.orderId,
            inventoryId,
            binId,
            pulled: false,
            reshelved: false,
          });
        }

        // Refresh picklist items
        const refreshedPicklistItems = await db
          .select()
          .from(picklistItems)
          .where(inArray(picklistItems.orderId, orderIds));
        
        existingPicklistItems.length = 0;
        existingPicklistItems.push(...refreshedPicklistItems);
      }

      // Apply filters
      let filteredItems = existingPicklistItems;
      if (filter === 'to_pull') {
        filteredItems = existingPicklistItems.filter(item => !item.pulled);
      } else if (filter === 'to_reshelve') {
        filteredItems = existingPicklistItems.filter(item => item.pulled && !item.reshelved);
      }

      // Remove completed items (both pulled and reshelved)
      filteredItems = filteredItems.filter(item => !(item.pulled && item.reshelved));

      // Group items by bin
      const binGroups = new Map<number | null, typeof filteredItems>();
      
      for (const item of filteredItems) {
        const binId = item.binId;
        if (!binGroups.has(binId)) {
          binGroups.set(binId, []);
        }
        binGroups.get(binId)!.push(item);
      }

      // Build bin-level picklist with item details
      const binPicklist = await Promise.all(
        Array.from(binGroups.entries()).map(async ([binId, items]) => {
          let warehouseLocation = null;
          
          if (binId) {
            const [bin] = await db.select().from(whBins).where(eq(whBins.id, binId));
            if (bin && bin.shelfId) {
              const [shelf] = await db.select().from(whShelves).where(eq(whShelves.id, bin.shelfId));
              if (shelf && shelf.aisleId) {
                const [aisle] = await db.select().from(whAisles).where(eq(whAisles.id, shelf.aisleId));
                if (aisle) {
                  warehouseLocation = {
                    aisle: { id: aisle.id, name: aisle.name },
                    shelf: { id: shelf.id, name: shelf.name },
                    bin: { id: bin.id, name: bin.name, description: bin.description },
                  };
                }
              }
            }
          }

          // Get item details for this bin
          const itemDetails = await Promise.all(
            items.map(async (item) => {
              const [detail] = await db
                .select()
                .from(orderDetails)
                .where(eq(orderDetails.id, item.orderDetailId));

              const [order] = await db
                .select()
                .from(orders)
                .where(eq(orders.id, item.orderId));

              return {
                picklistItemId: item.id,
                orderDetailId: item.orderDetailId,
                orderId: item.orderId,
                orderNumber: order?.orderNumber,
                itemName: detail?.name,
                quantity: detail?.quantity,
                sku: detail?.sku,
                pulled: item.pulled,
                reshelved: item.reshelved,
              };
            })
          );

          // Bin status: pulled if ALL items pulled, reshelved if ALL items reshelved
          const allPulled = items.every(item => item.pulled);
          const allReshelved = items.every(item => item.reshelved);

          return {
            binId,
            warehouseLocation,
            itemCount: items.length,
            items: itemDetails,
            pulled: allPulled,
            reshelved: allReshelved,
          };
        })
      );

      // Sort by aisle (desc), shelf (asc), bin (asc)
      binPicklist.sort((a, b) => {
        if (!a.warehouseLocation && !b.warehouseLocation) return 0;
        if (!a.warehouseLocation) return 1;
        if (!b.warehouseLocation) return -1;

        const aisleA = a.warehouseLocation.aisle.name;
        const aisleB = b.warehouseLocation.aisle.name;
        
        // Aisle descending (using localeCompare with numeric option)
        const aisleCompare = aisleB.localeCompare(aisleA, undefined, { numeric: true });
        if (aisleCompare !== 0) return aisleCompare;

        const shelfA = a.warehouseLocation.shelf.name;
        const shelfB = b.warehouseLocation.shelf.name;
        
        // Shelf ascending
        const shelfCompare = shelfA.localeCompare(shelfB, undefined, { numeric: true });
        if (shelfCompare !== 0) return shelfCompare;

        const binA = a.warehouseLocation.bin.name;
        const binB = b.warehouseLocation.bin.name;
        
        // Bin ascending
        return binA.localeCompare(binB, undefined, { numeric: true });
      });

      res.json(binPicklist);
    } catch (error) {
      console.error("Error fetching picklist:", error);
      res.status(500).json({ error: "Failed to fetch picklist" });
    }
  });

  // Update bin pulled status (all items in bin)
  app.put("/api/picklist/bin/:binId/pull", isApproved, async (req, res) => {
    try {
      const binId = parseInt(req.params.binId);
      const { pulled } = req.body;
      
      const updateData: any = {
        pulled: pulled === true,
        updatedAt: sql`CURRENT_TIMESTAMP`
      };
      
      // Set pulledAt timestamp when marking as pulled, clear when unmarking
      if (pulled === true) {
        updateData.pulledAt = sql`CURRENT_TIMESTAMP`;
      } else {
        updateData.pulledAt = null;
      }
      
      // Update all items in this bin
      await db
        .update(picklistItems)
        .set(updateData)
        .where(eq(picklistItems.binId, binId));
      
      res.json({ success: true, binId, pulled });
    } catch (error) {
      console.error("Error updating bin pulled status:", error);
      res.status(500).json({ error: "Failed to update bin pulled status" });
    }
  });

  // Update bin reshelved status (all items in bin)
  app.put("/api/picklist/bin/:binId/reshelve", isApproved, async (req, res) => {
    try {
      const binId = parseInt(req.params.binId);
      const { reshelved } = req.body;
      
      const updateData: any = {
        reshelved: reshelved === true,
        updatedAt: sql`CURRENT_TIMESTAMP`
      };
      
      // Set reshelvedAt timestamp when marking as reshelved, clear when unmarking
      if (reshelved === true) {
        updateData.reshelvedAt = sql`CURRENT_TIMESTAMP`;
      } else {
        updateData.reshelvedAt = null;
      }
      
      // Update all items in this bin
      await db
        .update(picklistItems)
        .set(updateData)
        .where(eq(picklistItems.binId, binId));
      
      res.json({ success: true, binId, reshelved });
    } catch (error) {
      console.error("Error updating bin reshelved status:", error);
      res.status(500).json({ error: "Failed to update bin reshelved status" });
    }
  });

  // Fulfillment Stats - Count unfulfilled orders
  app.get("/api/fulfillment/stats", isApproved, async (req, res) => {
    try {
      // Count orders that are awaiting payment, awaiting fulfillment, or awaiting shipment
      const unfulfilled = await db
        .select({ count: sql<number>`count(DISTINCT ${orders.id})` })
        .from(orders)
        .where(
          or(
            eq(orders.orderStatus, 'awaiting_payment'),
            eq(orders.orderStatus, 'awaiting_fulfillment'),
            eq(orders.orderStatus, 'awaiting_shipment')
          )
        );
      
      res.json({ 
        unfulfilled: Number(unfulfilled[0]?.count || 0)
      });
    } catch (error) {
      console.error("Error fetching fulfillment stats:", error);
      res.status(500).json({ error: "Failed to fetch fulfillment stats" });
    }
  });

  // Get fulfillment data - orders awaiting fulfillment with items grouped by bin
  app.get("/api/fulfillment", isApproved, async (req, res) => {
    try {
      // Fetch orders that need fulfillment
      const fulfillmentOrders = await db
        .select()
        .from(orders)
        .where(
          or(
            eq(orders.orderStatus, 'awaiting_payment'),
            eq(orders.orderStatus, 'awaiting_fulfillment'),
            eq(orders.orderStatus, 'awaiting_shipment')
          )
        )
        .orderBy(orders.orderNumber);
      
      if (fulfillmentOrders.length === 0) {
        res.json({ orders: [], items: [] });
        return;
      }
      
      const orderIds = fulfillmentOrders.map(o => o.id);
      
      // Get all potential items - use stored BrickLink data when available, fallback to parsing
      const allItems = await db
        .select({
          id: orderDetails.id,
          orderId: orderDetails.orderId,
          orderNumber: orders.orderNumber,
          sku: orderDetails.sku,
          bricklinkPartNumber: sql<string>`COALESCE(
            ${blInventory.itemNo},
            TRIM(SUBSTRING(${orderDetails.sku} FROM '.LGO-(.+)$')),
            TRIM(SUBSTRING(${orderDetails.name} FROM 'LEGO-([^ ]+)')),
            TRIM(SUBSTRING(${orderDetails.name} FROM 'Part ([^ ]+)'))
          )`,
          name: orderDetails.name,
          quantity: orderDetails.quantity,
          fulfilled: orderDetails.fulfilled,
          colorName: sql<string>`COALESCE(
            (SELECT bc.name FROM bl_colors bc WHERE bc.id = ${orderDetails.colorId} LIMIT 1),
            ${blColors.name},
            (SELECT bc.name FROM bl_colors bc WHERE order_details.name ILIKE '%' || bc.name || '%' ORDER BY LENGTH(bc.name) DESC LIMIT 1)
          )`,
          condition: sql<string>`COALESCE(
            ${orderDetails.condition},
            CASE 
              WHEN ${orderDetails.name} LIKE '%(Used)%' THEN 'Used'
              WHEN ${orderDetails.name} LIKE '%(New)%' THEN 'New'
              WHEN ${blInventory.newOrUsed} = 'N' THEN 'New'
              WHEN ${blInventory.newOrUsed} = 'U' THEN 'Used'
              ELSE NULL
            END
          )`,
          binId: inventoryLocations.binId,
          binName: whBins.name,
          shelfId: whShelves.id,
          shelfName: whShelves.name,
          aisleId: whAisles.id,
          aisleName: whAisles.name,
        })
        .from(orderDetails)
        .innerJoin(orders, eq(orderDetails.orderId, orders.id))
        .leftJoin(blInventory, eq(sql`CAST(${blInventory.id} AS TEXT)`, orderDetails.sku))
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(inventoryLocations, eq(blInventory.id, inventoryLocations.inventoryId))
        .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
        .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
        .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
        .where(sql`${orderDetails.orderId} IN (${sql.raw(orderIds.map(id => `'${id}'`).join(', '))})`);
      
      // Manually deduplicate: keep first occurrence of each order_detail id
      const seenIds = new Set<string>();
      const items = allItems.filter(item => {
        if (seenIds.has(item.id)) {
          return false;
        }
        seenIds.add(item.id);
        return true;
      });
      
      res.json({ 
        orders: fulfillmentOrders,
        items 
      });
    } catch (error) {
      console.error("Error fetching fulfillment data:", error);
      res.status(500).json({ error: "Failed to fetch fulfillment data" });
    }
  });

  // Update fulfilled status for an order detail item
  app.put("/api/fulfillment/item/:itemId/fulfill", isApproved, async (req, res) => {
    try {
      const itemId = req.params.itemId;
      
      // Validate request body
      const validatedData = updateFulfillmentSchema.parse(req.body);
      const { fulfilled } = validatedData;
      
      const updateData: any = {
        fulfilled: fulfilled === true,
        updatedAt: sql`CURRENT_TIMESTAMP`
      };
      
      // Set fulfilledAt timestamp when marking as fulfilled, clear when unmarking
      if (fulfilled === true) {
        updateData.fulfilledAt = sql`CURRENT_TIMESTAMP`;
      } else {
        updateData.fulfilledAt = null;
      }
      
      await db
        .update(orderDetails)
        .set(updateData)
        .where(eq(orderDetails.id, itemId));
      
      res.json({ success: true, itemId, fulfilled });
    } catch (error) {
      console.error("Error updating item fulfilled status:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request body", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update item fulfilled status" });
    }
  });

  // Get packing slip data for one or more orders
  app.post("/api/fulfillment/packing-slip", isApproved, async (req, res) => {
    try {
      const { orderIds } = req.body;
      
      if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: "orderIds array is required" });
      }
      
      // Fetch orders
      const orderData = await db.select()
        .from(orders)
        .where(inArray(orders.id, orderIds));
      
      if (orderData.length === 0) {
        return res.status(404).json({ error: "No orders found" });
      }
      
      // Fetch order items with inventory data (part number, color, condition)
      const items = await db.select({
        orderId: orderDetails.orderId,
        inventoryId: sql<string>`COALESCE(
          CAST(${orderDetails.bricklinkInventoryId} AS TEXT),
          ${orderDetails.sku}
        )`,
        bricklinkPartNumber: sql<string>`COALESCE(
          ${blInventory.itemNo},
          TRIM(SUBSTRING(${orderDetails.sku} FROM '.LGO-(.+)$')),
          TRIM(SUBSTRING(${orderDetails.name} FROM 'LEGO-([^ ]+)')),
          ${orderDetails.sku}
        )`,
        name: orderDetails.name,
        quantity: orderDetails.quantity,
        colorName: sql<string>`COALESCE(
          (SELECT bc.name FROM bl_colors bc WHERE bc.id = ${orderDetails.colorId} LIMIT 1),
          ${blColors.name}
        )`,
        condition: sql<string>`COALESCE(
          ${orderDetails.condition},
          CASE 
            WHEN ${blInventory.newOrUsed} = 'N' THEN 'New'
            WHEN ${blInventory.newOrUsed} = 'U' THEN 'Used'
            WHEN ${orderDetails.name} LIKE '%(Used)%' THEN 'Used'
            WHEN ${orderDetails.name} LIKE '%(New)%' THEN 'New'
            ELSE NULL
          END
        )`,
      })
        .from(orderDetails)
        .leftJoin(blInventory, eq(sql`CAST(${blInventory.id} AS TEXT)`, orderDetails.sku))
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .where(inArray(orderDetails.orderId, orderIds));
      
      // Group items by order
      const itemsByOrder = items.reduce((acc, item) => {
        if (!acc[item.orderId]) {
          acc[item.orderId] = [];
        }
        acc[item.orderId].push(item);
        return acc;
      }, {} as Record<string, typeof items>);
      
      // Format response
      const packingSlips = orderData.map(order => {
        let shipTo: any = {};
        try {
          shipTo = typeof order.shipTo === 'string' ? JSON.parse(order.shipTo) : order.shipTo;
        } catch (e) {
          console.error('Error parsing shipTo:', e);
        }
        
        const orderItems = itemsByOrder[order.id] || [];
        
        return {
          orderNumber: order.orderNumber,
          orderDate: order.orderDate,
          shipDate: order.shipDate,
          customerUsername: order.customerUsername,
          marketplace: order.marketplace,
          shipTo,
          items: orderItems,
        };
      });
      
      res.json(packingSlips);
    } catch (error) {
      console.error("Error fetching packing slip data:", error);
      res.status(500).json({ error: "Failed to fetch packing slip data" });
    }
  });

  // Shipping Routes
  
  // Preview shipment - check if order will need to be split
  app.post("/api/shipments/preview", isApproved, async (req, res) => {
    try {
      const { orderId, itemIdsToShip } = req.body;
      
      if (!orderId || !itemIdsToShip || !Array.isArray(itemIdsToShip)) {
        return res.status(400).json({ error: "orderId and itemIdsToShip array are required" });
      }
      
      const { previewShipment } = await import('./services/order-shipping');
      const preview = await previewShipment(orderId, itemIdsToShip);
      
      res.json(preview);
    } catch (error: any) {
      console.error("Error previewing shipment:", error);
      res.status(500).json({ error: error.message || "Failed to preview shipment" });
    }
  });
  
  // Split an order
  app.post("/api/orders/:orderId/split", isApproved, async (req, res) => {
    try {
      const { orderId } = req.params;
      const { itemIdsToKeep } = req.body;
      
      if (!itemIdsToKeep || !Array.isArray(itemIdsToKeep)) {
        return res.status(400).json({ error: "itemIdsToKeep array is required" });
      }
      
      const { splitOrder } = await import('./services/order-shipping');
      const result = await splitOrder(orderId, itemIdsToKeep);
      
      res.json(result);
    } catch (error: any) {
      console.error("Error splitting order:", error);
      res.status(500).json({ error: error.message || "Failed to split order" });
    }
  });
  
  // Create shipment and get rates
  app.post("/api/shipments/create", isApproved, async (req, res) => {
    try {
      const { orderId, fromAddress, parcel, itemIdsToShip } = req.body;
      
      if (!orderId || !fromAddress || !parcel) {
        return res.status(400).json({ error: "orderId, fromAddress, and parcel are required" });
      }
      
      const { createShipment } = await import('./services/order-shipping');
      const result = await createShipment({
        orderId,
        itemIdsToShip: itemIdsToShip || [],
        fromAddress,
        parcel,
      });
      
      console.log('📦 Shipment created:', {
        shipmentId: result.shipmentId,
        ratesCount: result.rates?.length || 0,
        rates: result.rates
      });
      
      res.json(result);
    } catch (error: any) {
      console.error("Error creating shipment:", error);
      res.status(500).json({ error: error.message || "Failed to create shipment" });
    }
  });
  
  // Purchase shipping label
  app.post("/api/shipments/purchase", isApproved, async (req, res) => {
    try {
      const { orderId, shipmentId, rateId, insurance } = req.body;
      
      if (!orderId || !shipmentId || !rateId) {
        return res.status(400).json({ error: "orderId, shipmentId, and rateId are required" });
      }
      
      const { purchaseLabel } = await import('./services/order-shipping');
      const result = await purchaseLabel(orderId, shipmentId, rateId, insurance);
      
      res.json(result);
    } catch (error: any) {
      console.error("Error purchasing label:", error);
      res.status(500).json({ error: error.message || "Failed to purchase label" });
    }
  });
  
  // Get shipments for an order
  app.get("/api/shipments/:orderId", isApproved, async (req, res) => {
    try {
      const { orderId } = req.params;
      
      const { shipments } = await import('@shared/schema');
      const orderShipments = await db.select()
        .from(shipments)
        .where(eq(shipments.orderId, orderId))
        .orderBy(desc(shipments.createdAt));
      
      res.json(orderShipments);
    } catch (error: any) {
      console.error("Error fetching shipments:", error);
      res.status(500).json({ error: "Failed to fetch shipments" });
    }
  });

  // Dry-Run Order Sync Tester - Test with historical orders
  app.post("/api/orders/dry-run-test", isApproved, async (req, res) => {
    try {
      const { platform, limit = 5 } = req.body;
      
      // Get API credentials
      const [settings] = await db.select().from(appSettings).limit(1);
      if (!settings) {
        return res.status(400).json({ error: "API credentials not configured" });
      }

      const results: any[] = [];

      // Test BrickLink orders
      if (platform === 'bricklink' || platform === 'both') {
        try {
          if (!settings.bricklinkConsumerKey || !settings.bricklinkConsumerSecret || 
              !settings.bricklinkTokenValue || !settings.bricklinkTokenSecret) {
            console.log('BrickLink API credentials missing - skipping BrickLink');
            // Don't return error - just skip BrickLink if credentials missing
          } else {

          const { getBrickLinkOrders, getBrickLinkOrderItems, mapBrickLinkStatus, mapBrickLinkCondition } = 
            await import('./services/bricklink-orders');

          // Fetch recent PENDING BrickLink orders from ShipStation database
          // Note: BrickLink/BrickOwl APIs may not return items for shipped/completed orders
          console.log('Fetching recent PENDING BrickLink orders from ShipStation...');
          const recentBLOrders = await db.select()
            .from(orders)
            .where(and(
              eq(orders.marketplace, 'BrickLink'),
              or(
                eq(orders.orderStatus, 'awaiting_payment'),
                eq(orders.orderStatus, 'awaiting_fulfillment'),
                eq(orders.orderStatus, 'awaiting_shipment')
              )
            ))
            .orderBy(desc(orders.orderDate))
            .limit(limit);

          console.log(`Found ${recentBLOrders.length} recent BrickLink orders in ShipStation`);

        for (const ssOrder of recentBLOrders) {
          try {
            // Remove "BL." prefix to get BrickLink order ID
            const orderId = ssOrder.orderNumber.replace('BL.', '');
            console.log(`Processing BrickLink order ${orderId}...`);
            
            // Fetch ShipStation order items from database
            const ssItems = await db.select()
              .from(orderDetails)
              .where(eq(orderDetails.orderId, ssOrder.id));
            
            console.log(`ShipStation has ${ssItems.length} items for order ${orderId}`);

            // Try to fetch platform order header and items
            let platformOrder = null;
            let platformItems: any[] = [];
            try {
              // Note: BrickLink API likely won't return items for shipped orders
              // We're just fetching to verify order exists on platform
              platformOrder = {
                orderNumber: orderId,
                marketplace: 'BrickLink',
                orderDate: ssOrder.orderDate,
                orderStatus: ssOrder.orderStatus,
                customerUsername: ssOrder.customerUsername,
                customerEmail: ssOrder.customerEmail,
                orderTotal: ssOrder.orderTotal,
                shippingAmount: ssOrder.shippingAmount,
              };

              // Try to fetch items from BrickLink API
              const { getBrickLinkOrderItems } = await import('./services/bricklink-orders');
              const blItems = await getBrickLinkOrderItems(
                parseInt(orderId),
                settings.bricklinkConsumerKey!,
                settings.bricklinkConsumerSecret!,
                settings.bricklinkTokenValue!,
                settings.bricklinkTokenSecret!
              );
              
              console.log(`BrickLink API returned ${blItems.length} items for order ${orderId}`);

              // Map BrickLink items to common format with warehouse bins
              platformItems = await Promise.all(blItems.map(async (blItem: any) => {
                const inventoryId = blItem.inventory_id;
                const binInfo = await db
                  .select({
                    aisleId: whAisles.id,
                    aisleName: whAisles.name,
                    shelfId: whShelves.id,
                    shelfName: whShelves.name,
                    binId: whBins.id,
                    binName: whBins.name,
                  })
                  .from(inventoryLocations)
                  .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
                  .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
                  .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
                  .where(eq(inventoryLocations.inventoryId, parseInt(inventoryId || '0')))
                  .limit(1);

                return {
                  sku: inventoryId?.toString(),
                  name: `${blItem.item?.no || ''} ${blItem.color_name || ''} ${blItem.new_or_used || ''}`.trim(),
                  quantity: blItem.quantity || 0,
                  unitPrice: parseFloat(blItem.unit_price || '0'),
                  warehouseBin: binInfo[0] || null,
                };
              }));
            } catch (apiErr: any) {
              console.error(`BrickLink API error for order ${orderId}:`, apiErr.message);
            }

            // Map ShipStation items with warehouse bins
            const itemsWithBins = await Promise.all(ssItems.map(async (item: any) => {
              const binInfo = await db
                .select({
                  aisleId: whAisles.id,
                  aisleName: whAisles.name,
                  shelfId: whShelves.id,
                  shelfName: whShelves.name,
                  binId: whBins.id,
                  binName: whBins.name,
                })
                .from(inventoryLocations)
                .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
                .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
                .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
                .where(eq(inventoryLocations.inventoryId, parseInt(item.sku || '0')))
                .limit(1);

              return {
                sku: item.sku,
                name: item.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                warehouseBin: binInfo[0] || null,
              };
            }));

            results.push({
              platform: 'BrickLink',
              shipstationOrder: ssOrder, // ShipStation order with full details
              shipstationItems: itemsWithBins, // ShipStation items from database
              platformOrder: platformOrder, // Platform order header (if available)
              platformItems: platformItems, // Platform items from API (may be empty for shipped orders)
              issues: [],
            });
          } catch (orderError: any) {
            console.error(`Error processing BrickLink order:`, orderError.message || orderError);
          }
        }
          } // end else (credentials check)
        } catch (blError: any) {
          console.error('BrickLink API error:', blError.message || blError);
          // Continue with BrickOwl if "both" is selected
        }
      }

      // Test BrickOwl orders
      if (platform === 'brickowl' || platform === 'both') {
        if (!settings.brickowlApiKey) {
          return res.status(400).json({ error: "BrickOwl API key not configured" });
        }

        const { getBrickOwlOrders, getBrickOwlOrderDetails, mapBrickOwlStatus, mapBrickOwlCondition } = 
          await import('./services/brickowl-orders');

        // Fetch recent PENDING BrickOwl orders from ShipStation database
        // Note: BrickLink/BrickOwl APIs may not return items for shipped/completed orders
        console.log('Fetching recent PENDING BrickOwl orders from ShipStation...');
        const recentBOOrders = await db.select()
          .from(orders)
          .where(and(
            eq(orders.marketplace, 'BrickOwl'),
            or(
              eq(orders.orderStatus, 'awaiting_payment'),
              eq(orders.orderStatus, 'awaiting_fulfillment'),
              eq(orders.orderStatus, 'awaiting_shipment')
            )
          ))
          .orderBy(desc(orders.orderDate))
          .limit(limit);

        console.log(`Found ${recentBOOrders.length} recent BrickOwl orders in ShipStation`);

        for (const ssOrder of recentBOOrders) {
          try {
            // Remove "BO." prefix to get BrickOwl order ID
            const orderId = ssOrder.orderNumber.replace('BO.', '');
            console.log(`Processing BrickOwl order ${orderId}...`);
            
            // Fetch ShipStation order items from database
            const ssItems = await db.select()
              .from(orderDetails)
              .where(eq(orderDetails.orderId, ssOrder.id));
            
            console.log(`ShipStation has ${ssItems.length} items for order ${orderId}`);

            // Try to fetch platform order header and items
            let platformOrder = null;
            let platformItems: any[] = [];
            try {
              const boOrder = await getBrickOwlOrderDetails(settings.brickowlApiKey, orderId);
              platformOrder = {
                orderNumber: orderId,
                marketplace: 'BrickOwl',
                orderDate: new Date(boOrder.order_time * 1000).toISOString(),
                orderStatus: mapBrickOwlStatus(boOrder.status_id),
                customerUsername: boOrder.buyer_name || boOrder.customer_username,
                customerEmail: boOrder.customer_email,
                orderTotal: boOrder.base_order_total || '0',
                shippingAmount: boOrder.ship_total || '0',
              };

              // Map BrickOwl items to common format with warehouse bins
              if (boOrder.items && Array.isArray(boOrder.items)) {
                console.log(`BrickOwl API returned ${boOrder.items.length} items for order ${orderId}`);
                
                platformItems = await Promise.all(boOrder.items.map(async (boItem: any) => {
                  const inventoryId = boItem.external_lot_ids?.other;
                  const binInfo = await db
                    .select({
                      aisleId: whAisles.id,
                      aisleName: whAisles.name,
                      shelfId: whShelves.id,
                      shelfName: whShelves.name,
                      binId: whBins.id,
                      binName: whBins.name,
                    })
                    .from(inventoryLocations)
                    .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
                    .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
                    .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
                    .where(eq(inventoryLocations.inventoryId, parseInt(inventoryId || '0')))
                    .limit(1);

                  return {
                    sku: inventoryId?.toString(),
                    name: `${boItem.boid || ''} ${boItem.color_name || ''} ${boItem.condition || ''}`.trim(),
                    quantity: boItem.ordered_quantity || 0,
                    unitPrice: parseFloat(boItem.base_price || '0'),
                    warehouseBin: binInfo[0] || null,
                  };
                }));
              }
            } catch (apiErr: any) {
              console.error(`BrickOwl API error for order ${orderId}:`, apiErr.message);
            }

            // Map ShipStation items with warehouse bins
            const itemsWithBins = await Promise.all(ssItems.map(async (item: any) => {
              const binInfo = await db
                .select({
                  aisleId: whAisles.id,
                  aisleName: whAisles.name,
                  shelfId: whShelves.id,
                  shelfName: whShelves.name,
                  binId: whBins.id,
                  binName: whBins.name,
                })
                .from(inventoryLocations)
                .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
                .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
                .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
                .where(eq(inventoryLocations.inventoryId, parseInt(item.sku || '0')))
                .limit(1);

              return {
                sku: item.sku,
                name: item.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                warehouseBin: binInfo[0] || null,
              };
            }));

            results.push({
              platform: 'BrickOwl',
              shipstationOrder: ssOrder, // ShipStation order with full details
              shipstationItems: itemsWithBins, // ShipStation items from database
              platformOrder: platformOrder, // Platform order header (if available)
              platformItems: platformItems, // Platform items from API (may be empty for shipped orders)
              issues: [],
            });
          } catch (err: any) {
            console.error(`Error processing BrickOwl order:`, err.message);
          }
        }
      }

      res.json({ success: true, results });
    } catch (error: any) {
      console.error("Error in dry-run test:", error);
      res.status(500).json({ error: error.message || "Failed to run order sync test" });
    }
  });

  // ============================================================================
  // BACKUP & RESTORE ROUTES
  // ============================================================================
  
  // Import backup-restore service
  const backupRestore = await import('./services/backup-restore');
  
  // POST /api/backup/restore - Initiate restore workflow
  app.post("/api/backup/restore", isApproved, async (req, res) => {
    try {
      const { targetTimestamp, skipPlatformSync } = req.body;
      
      if (!targetTimestamp) {
        return res.status(400).json({ error: "targetTimestamp is required" });
      }
      
      const jobId = await backupRestore.initiateRestoreWorkflow(
        targetTimestamp,
        skipPlatformSync || false
      );
      
      res.json({ success: true, jobId });
    } catch (error: any) {
      console.error("Error initiating restore:", error);
      res.status(500).json({ error: error.message || "Failed to initiate restore" });
    }
  });
  
  // GET /api/backup/restore/status/:jobId - Check restore progress
  app.get("/api/backup/restore/status/:jobId", isApproved, async (req, res) => {
    try {
      const { jobId } = req.params;
      const status = await backupRestore.getRestoreStatus(jobId);
      
      if (!status) {
        return res.status(404).json({ error: "Restore job not found" });
      }
      
      res.json(status);
    } catch (error: any) {
      console.error("Error fetching restore status:", error);
      res.status(500).json({ error: error.message || "Failed to fetch restore status" });
    }
  });
  
  // POST /api/backup/differential/analyze - Analyze BrickOwl vs BrickLink differences
  app.post("/api/backup/differential/analyze", isApproved, async (req, res) => {
    try {
      const { jobId } = req.body;
      
      if (!jobId) {
        return res.status(400).json({ error: "jobId is required" });
      }
      
      const analysis = await backupRestore.analyzeDifferential(jobId);
      res.json(analysis);
    } catch (error: any) {
      console.error("Error analyzing differential:", error);
      res.status(500).json({ error: error.message || "Failed to analyze differential" });
    }
  });
  
  // POST /api/backup/differential/apply - Apply differential sync to BrickLink
  app.post("/api/backup/differential/apply", isApproved, async (req, res) => {
    try {
      const { jobId, overrideAnomalies } = req.body;
      
      if (!jobId) {
        return res.status(400).json({ error: "jobId is required" });
      }
      
      const result = await backupRestore.applyDifferentialRecovery(
        jobId,
        overrideAnomalies || false
      );
      
      res.json(result);
    } catch (error: any) {
      console.error("Error applying differential:", error);
      res.status(500).json({ error: error.message || "Failed to apply differential" });
    }
  });
  
  // GET /api/backup/verify/:jobId - Run verification checks
  app.get("/api/backup/verify/:jobId", isApproved, async (req, res) => {
    try {
      const { jobId } = req.params;
      const verification = await backupRestore.verifyRestoration(jobId);
      
      res.json(verification);
    } catch (error: any) {
      console.error("Error verifying restore:", error);
      res.status(500).json({ error: error.message || "Failed to verify restore" });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
