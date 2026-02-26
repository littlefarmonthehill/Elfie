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
import { orders, orderDetails, blInventory, blCategories, blColors, appSettings, insertAppSettingsSchema, conversations, syncMetadata, inventoryEmbeddings, orderEmbeddings, embeddingJobs, whAisles, whShelves, whBins, inventoryLocations, picklistItems, insertWhAisleSchema, insertWhShelfSchema, insertWhBinSchema, insertInventoryLocationSchema, insertPicklistItemSchema, updateFulfillmentSchema, syncIssues, insertSyncIssueSchema, shipments, setPartRelationships, blForumPosts, orderAdjustments, insertOrderAdjustmentSchema } from "@shared/schema";
import { eq, desc, sql, inArray, like, or, and, isNotNull } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import FormData from "form-data";
import axios from "axios";

// Decode HTML entities from BrickLink notes for accurate comparison.
// Regex compiled once at module level; single-pass replace with a lookup table.
const HTML_ENTITIES: Record<string, string> = {
  '&#39;': "'", '&#40;': '(', '&#41;': ')', '&quot;': '"',
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#x27;': "'", '&#x2F;': '/',
};
const HTML_ENTITY_RE = new RegExp(
  Object.keys(HTML_ENTITIES).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g'
);
function decodeHtmlEntities(text: string | null | undefined): string {
  if (!text) return '';
  return text.replace(HTML_ENTITY_RE, m => HTML_ENTITIES[m] ?? m);
}

// Shared WHERE clause for "active" orders used across picklist routes.
// Returns a new expression each call (Drizzle builders are not reusable across queries).
function activeOrderStatusWhere() {
  return or(
    like(orders.orderStatus, '%awaiting_payment%'),
    like(orders.orderStatus, '%awaiting_shipment%'),
    like(orders.orderStatus, '%awaiting_fulfillment%')
  );
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

  // Cleanup: delete stale orders stuck in awaiting_* status, older than a given date
  // ?before=YYYY-MM-DD (default 2 years ago); targets awaiting_payment, awaiting_shipment, awaiting_fulfillment
  app.get("/api/admin/cleanup-old-orders", isApproved, async (req: any, res) => {
    try {
      const beforeDate = req.query.before
        ? new Date(req.query.before as string)
        : new Date(Date.now() - 365 * 2 * 24 * 60 * 60 * 1000); // default: 2 years ago

      const beforeStr = beforeDate.toISOString().split('T')[0];

      const targets = await db.execute(sql.raw(
        `SELECT id, order_number, order_status, order_date FROM orders
         WHERE order_status IN ('awaiting_payment','awaiting_shipment','awaiting_fulfillment','pending')
           AND (order_date IS NULL OR order_date < '${beforeStr}')
         ORDER BY order_date ASC`
      ));
      const rows = targets.rows as any[];
      const ids = rows.map((r: any) => r.id);

      if (ids.length === 0) return res.json({ deleted: 0, before: beforeStr, message: 'Nothing to clean up' });

      const idList = ids.map((id: string) => `'${id}'`).join(',');
      const d1 = await db.execute(sql.raw(`DELETE FROM order_details WHERE order_id IN (${idList})`));
      const d2 = await db.execute(sql.raw(`DELETE FROM order_adjustments WHERE order_id IN (${idList})`));
      const d3 = await db.execute(sql.raw(`DELETE FROM picklist_items WHERE order_id IN (${idList})`));
      const d4 = await db.execute(sql.raw(`DELETE FROM orders WHERE id IN (${idList})`));

      console.log(`🧹 Admin cleanup: removed ${ids.length} stale awaiting orders (before ${beforeStr})`);
      res.json({
        deleted: ids.length,
        before: beforeStr,
        orders: rows.map((r: any) => ({ id: r.id, orderNumber: r.order_number, status: r.order_status, date: r.order_date })),
        detailsDeleted: (d1 as any).rowCount,
        adjustmentsDeleted: (d2 as any).rowCount,
        picklistDeleted: (d3 as any).rowCount,
      });
    } catch (err: any) {
      console.error('Cleanup error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Lightweight endpoint for Sales Dashboard - orders without details
  app.get("/api/orders/summary", isApproved, async (req, res) => {
    try {
      // Parse date range parameter
      const range = req.query.range as string;
      const productLine = req.query.productLine as string;
      const platform = req.query.platform as string;
      let dateFilter: Date | null = null;
      let endDateFilter: Date | null = null;
      
      // Debug logging
      console.log(`📊 Orders Summary API called with range: ${range || 'none'}, productLine: ${productLine || 'none'}, platform: ${platform || 'none'}`);
      
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
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1);
            endDateFilter = new Date(now.getFullYear(), 0, 1);
            break;
        }
      }

      // If filtering by product line, we need to find orders that contain items from that product line
      if (productLine) {
        // Build WHERE conditions for product line classification
        let productLineCondition: any;
        switch (productLine) {
          case 'K\'NEX':
            productLineCondition = sql`(od.name ILIKE '%K''NEX%' OR od.name ILIKE '%KNEX%')`;
            break;
          case 'Erector/Meccano':
            productLineCondition = sql`(od.name ILIKE '%Erector%' OR od.name ILIKE '%Meccano%')`;
            break;
          case 'Capsela':
            productLineCondition = sql`od.name ILIKE '%Capsela%'`;
            break;
          case 'Marbleworks':
            productLineCondition = sql`(od.name ILIKE '%Marbleworks%' OR od.name ILIKE '%Discovery Toys%')`;
            break;
          case 'Little Tikes':
            productLineCondition = sql`od.name ILIKE '%Little Tikes%'`;
            break;
          case 'Fisher-Price':
            productLineCondition = sql`od.name ILIKE '%Fisher-Price%'`;
            break;
          case 'LEGO':
          default:
            // LEGO is the default - any item that doesn't match other product lines
            productLineCondition = sql`NOT (
              (od.name ILIKE '%K''NEX%' OR od.name ILIKE '%KNEX%') OR
              (od.name ILIKE '%Erector%' OR od.name ILIKE '%Meccano%') OR
              od.name ILIKE '%Capsela%' OR
              (od.name ILIKE '%Marbleworks%' OR od.name ILIKE '%Discovery Toys%') OR
              od.name ILIKE '%Little Tikes%' OR
              od.name ILIKE '%Fisher-Price%'
            )`;
            break;
        }

        // Query orders that have at least one item matching the product line
        let whereConditions = sql`o.order_status NOT IN ('cancelled', 'Cancelled') AND ${productLineCondition}`;
        
        if (platform) {
          whereConditions = sql`${whereConditions} AND (o.marketplace = ${platform} OR (o.marketplace IS NULL AND ${platform} = 'Unknown'))`;
        }
        
        if (dateFilter && !endDateFilter) {
          whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter}`;
        } else if (dateFilter && endDateFilter) {
          whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter} AND o.order_date < ${endDateFilter}`;
        }

        const query = sql`
          SELECT DISTINCT o.*
          FROM ${orders} o
          JOIN ${orderDetails} od ON o.id = od.order_id
          WHERE ${whereConditions}
          ORDER BY o.order_date DESC
        `;

        const result = await db.execute(query);
        
        // Map snake_case DB columns to camelCase to match the Order interface
        const mappedOrders = result.rows.map((row: any) => ({
          id: row.id,
          orderNumber: row.order_number,
          marketplace: row.marketplace,
          orderDate: row.order_date,
          orderTotal: row.order_total,
          customerUsername: row.customer_username,
          orderStatus: row.order_status,
          // Include other fields if needed
          blOrderId: row.bl_order_id,
          customerEmail: row.customer_email,
          customerName: row.customer_name,
          paymentStatus: row.payment_status,
          shippingMethod: row.shipping_method,
          trackingNumber: row.tracking_number,
          shippingCost: row.shipping_cost,
          taxAmount: row.tax_amount,
          shippingAddress: row.shipping_address,
          boOrderId: row.bo_order_id,
          boOrderTime: row.bo_order_time,
          shippedDate: row.shipped_date,
        }));
        
        console.log(`📊 Sending ${mappedOrders.length} orders filtered by product line "${productLine}" and platform "${platform || 'all'}"`, 
          mappedOrders.length > 0 ? `Sample: orderNumber=${mappedOrders[0].orderNumber}, orderTotal=${mappedOrders[0].orderTotal}` : '');
        res.json(mappedOrders);
        return;
      }

      // Return only the fields needed by the frontend to avoid large memory spikes.
      // The SalesDashboard only uses: id, orderDate, orderStatus, orderTotal, marketplace, orderNumber.
      const selectFields = {
        id: orders.id,
        orderNumber: orders.orderNumber,
        marketplace: orders.marketplace,
        orderDate: orders.orderDate,
        orderTotal: orders.orderTotal,
        orderStatus: orders.orderStatus,
      };

      const allOrders = dateFilter
        ? endDateFilter
          ? await db.select(selectFields).from(orders)
              .where(sql`${orders.orderDate} >= ${dateFilter.toISOString()} AND ${orders.orderDate} < ${endDateFilter.toISOString()}`)
              .orderBy(desc(orders.orderDate))
          : await db.select(selectFields).from(orders)
              .where(sql`${orders.orderDate} >= ${dateFilter.toISOString()}`)
              .orderBy(desc(orders.orderDate))
        : await db.select(selectFields).from(orders).orderBy(desc(orders.orderDate));
      
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
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1);
            endDateFilter = new Date(now.getFullYear(), 0, 1);
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
      // CTE calculates net total (gross - refunds - fees) per order
      const withAdjustments = sql`
        WITH adj AS (
          SELECT order_id,
            COALESCE(SUM(ABS(amount::numeric)), 0) AS total_adj
          FROM order_adjustments
          GROUP BY order_id
        )
      `;

      const orderCols = sql`
        o.id, o.order_number, o.order_date, o.order_status,
        o.order_total, o.customer_username, o.marketplace,
        GREATEST(0, o.order_total::numeric - COALESCE(a.total_adj, 0)) AS net_total
      `;

      const [pendingOrders, recentShipments, highValueOrders] = await Promise.all([
        db.execute(sql`
          ${withAdjustments}
          SELECT ${orderCols}
          FROM orders o
          LEFT JOIN adj a ON a.order_id = o.id
          WHERE o.order_status IN ('awaiting_payment', 'awaiting_shipment')
          ORDER BY o.order_date DESC
          LIMIT 5
        `),
        db.execute(sql`
          ${withAdjustments}
          SELECT ${orderCols}
          FROM orders o
          LEFT JOIN adj a ON a.order_id = o.id
          WHERE o.order_status = 'shipped'
          ORDER BY o.order_date DESC
          LIMIT 5
        `),
        db.execute(sql`
          ${withAdjustments}
          SELECT ${orderCols}
          FROM orders o
          LEFT JOIN adj a ON a.order_id = o.id
          WHERE o.order_total IS NOT NULL AND o.order_total::numeric > 0
          ORDER BY net_total DESC
          LIMIT 5
        `),
      ]);

      const mapRow = (r: any) => ({
        id: r.id,
        orderNumber: r.order_number,
        orderDate: r.order_date,
        orderStatus: r.order_status,
        orderTotal: r.order_total,
        netTotal: r.net_total,
        customerUsername: r.customer_username,
        marketplace: r.marketplace,
        items: [],
      });

      res.json({
        pending: pendingOrders.rows.map(mapRow),
        recentShipments: recentShipments.rows.map(mapRow),
        highValue: highValueOrders.rows.map(mapRow),
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
      
      // Execute query for shipped orders — limit to 200 most recent to prevent browser crash
      const limit = searchQuery?.trim() ? 500 : 200;
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
        .orderBy(desc(sql`COALESCE(${orders.shipDate}, ${orders.orderDate})`))
        .limit(limit);
      
      res.json(shippedOrders);
    } catch (error) {
      console.error("Error fetching shipped orders:", error);
      res.status(500).json({ error: "Failed to fetch shipped orders" });
    }
  });

  // Get items sold in a specific category
  app.get("/api/analytics/categories/:categoryId/items", isApproved, async (req, res) => {
    try {
      const categoryId = parseInt(req.params.categoryId);
      const range = req.query.range as string;
      let dateFilter: Date | null = null;
      let endDateFilter: Date | null = null;
      
      // Parse date range
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
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1);
            endDateFilter = new Date(now.getFullYear(), 0, 1);
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
      
      // Get items sold in this category with quantities (grouped by part number only)
      const query = sql`
        SELECT 
          i.item_no,
          i.item_name as name,
          COUNT(DISTINCT i.color_name)::integer as color_count,
          SUM(CASE WHEN i.new_or_used = 'N' THEN od.quantity ELSE 0 END)::integer as new_qty,
          SUM(CASE WHEN i.new_or_used = 'U' THEN od.quantity ELSE 0 END)::integer as used_qty,
          SUM(od.quantity)::integer as quantity_sold
        FROM ${orderDetails} od
        JOIN ${orders} o ON od.order_id = o.id
        JOIN ${blInventory} i ON od.sku = CAST(i.id AS TEXT)
        WHERE i.category_id = ${categoryId} AND ${whereConditions}
        GROUP BY i.item_no, i.item_name
        ORDER BY quantity_sold DESC
      `;
      
      const result = await db.execute(query);
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching category items:", error);
      res.status(500).json({ error: "Failed to fetch category items" });
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
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1);
            endDateFilter = new Date(now.getFullYear(), 0, 1);
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
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1);
            endDateFilter = new Date(now.getFullYear(), 0, 1);
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
              WHEN name ILIKE '%K''NEX%' OR name ILIKE '%KNEX%' THEN 'K''NEX'
              WHEN name ILIKE '%Erector%' OR name ILIKE '%Meccano%' THEN 'Erector/Meccano'
              WHEN name ILIKE '%Capsela%' THEN 'Capsela'
              WHEN name ILIKE '%Marbleworks%' OR name ILIKE '%Discovery Toys%' THEN 'Marbleworks'
              WHEN name ILIKE '%Little Tikes%' THEN 'Little Tikes'
              WHEN name ILIKE '%Fisher-Price%' THEN 'Fisher-Price'
              ELSE 'LEGO'
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

      // Fetch adjustments (refunds, credits)
      const adjustments = await db
        .select()
        .from(orderAdjustments)
        .where(eq(orderAdjustments.orderId, orderId))
        .orderBy(orderAdjustments.createdAt);

      // Fetch most recent shipment for tracking number
      const [shipment] = await db
        .select({ trackingNumber: shipments.trackingNumber, labelUrl: shipments.labelUrl, carrier: shipments.carrier, service: shipments.service })
        .from(shipments)
        .where(eq(shipments.orderId, orderId))
        .orderBy(desc(shipments.createdAt))
        .limit(1);
      
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
          address2: shipToData.street2 || '',
          address3: shipToData.street3 || '',
          city: shipToData.city || '',
          state: shipToData.state || '',
          zip: shipToData.postalCode || '',
          country: shipToData.country || '',
        },
        weight: order.weight ? Number(order.weight) : null,
        weightUnits: order.weightUnits || 'oz',
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
        trackingNumber: shipment?.trackingNumber || undefined,
        labelUrl: shipment?.labelUrl || undefined,
        shippingCarrier: shipment?.carrier || undefined,
        shippingService: shipment?.service || undefined,
        isRepeatCustomer: isRepeatCustomer,
        adjustments: adjustments.map(a => ({
          id: a.id,
          type: a.type,
          amount: Number(a.amount),
          paymentMethod: a.paymentMethod,
          externalTransactionId: a.externalTransactionId,
          reason: a.reason,
          notes: a.notes,
          createdAt: a.createdAt.toISOString(),
        })),
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

  // Update order address and weight fields (pre-shipment edits)
  app.patch("/api/orders/:id", isApproved, async (req, res) => {
    try {
      const orderId = req.params.id;
      const { street1, street2, street3, city, state, postalCode, country, weight, weightUnits, packageType, packageLength, packageWidth, packageHeight } = req.body;

      const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Merge updated address fields into existing shipTo JSON
      let shipToData: any = {};
      try {
        shipToData = order.shipTo ? JSON.parse(order.shipTo) : {};
      } catch (e) { /* ignore */ }

      if (street1 !== undefined) shipToData.street1 = street1;
      if (street2 !== undefined) shipToData.street2 = street2;
      if (street3 !== undefined) shipToData.street3 = street3;
      if (city !== undefined) shipToData.city = city;
      if (state !== undefined) shipToData.state = state;
      if (postalCode !== undefined) shipToData.postalCode = postalCode;
      if (country !== undefined) shipToData.country = country;

      const updateData: any = { shipTo: JSON.stringify(shipToData) };
      if (weight !== undefined) updateData.weight = weight !== null && weight !== '' ? weight.toString() : null;
      if (weightUnits !== undefined) updateData.weightUnits = weightUnits;
      if (packageType !== undefined) updateData.packageType = packageType || null;
      if (packageLength !== undefined) updateData.packageLength = packageLength !== null && packageLength !== '' ? packageLength.toString() : null;
      if (packageWidth !== undefined) updateData.packageWidth = packageWidth !== null && packageWidth !== '' ? packageWidth.toString() : null;
      if (packageHeight !== undefined) updateData.packageHeight = packageHeight !== null && packageHeight !== '' ? packageHeight.toString() : null;

      await db.update(orders).set(updateData).where(eq(orders.id, orderId));

      res.json({ success: true });
    } catch (error) {
      console.error("Error updating order:", error);
      res.status(500).json({ error: "Failed to update order" });
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

  // Order Adjustments - Per-order refund totals (for chart deduction)
  app.get("/api/orders/adjustments/by-order", isApproved, async (req, res) => {
    try {
      const { dateRange = 'mtd' } = req.query as { dateRange?: string };
      const now = new Date();
      let sinceDate: Date;
      let endDate: Date | null = null;
      switch (dateRange) {
        case 'lastmonth':
          sinceDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          endDate   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
          break;
        case '3months':  sinceDate = new Date(now.getFullYear(), now.getMonth() - 3, 1); break;
        case '1year':
        case '1y':       sinceDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); break;
        case 'prevyear':
          sinceDate = new Date(now.getFullYear() - 1, 0, 1);
          endDate   = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
          break;
        case 'all':      sinceDate = new Date(2000, 0, 1); break;
        default:         sinceDate = new Date(now.getFullYear(), now.getMonth(), 1); // mtd
      }
      const result = await db.execute(sql`
        SELECT oa.order_id, SUM(ABS(oa.amount::numeric)) AS total_refunds
        FROM order_adjustments oa
        JOIN orders o ON o.id = oa.order_id
        WHERE oa.type = 'refund'
          AND o.order_date >= ${sinceDate}
          ${endDate ? sql`AND o.order_date <= ${endDate}` : sql``}
        GROUP BY oa.order_id
      `);
      const refundsByOrder: Record<string, number> = {};
      for (const row of result.rows as any[]) {
        refundsByOrder[row.order_id] = Number(row.total_refunds);
      }
      res.json(refundsByOrder);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Order Adjustments - Summary (total refunds + fees for a date range)
  app.get("/api/orders/adjustments/summary", isApproved, async (req, res) => {
    try {
      const { dateRange = 'mtd' } = req.query as { dateRange?: string };

      let sinceDate: Date;
      let endDate: Date | null = null;
      const now = new Date();
      switch (dateRange) {
        case 'lastmonth':
          sinceDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          endDate   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
          break;
        case '3months':  sinceDate = new Date(now.getFullYear(), now.getMonth() - 3, 1); break;
        case '1year':
        case '1y':       sinceDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); break;
        case 'prevyear':
          sinceDate = new Date(now.getFullYear() - 1, 0, 1);
          endDate   = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
          break;
        case 'all':      sinceDate = new Date(2000, 0, 1); break;
        default:         sinceDate = new Date(now.getFullYear(), now.getMonth(), 1); // mtd
      }

      const result = await db.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN oa.type = 'refund' THEN ABS(oa.amount::numeric) ELSE 0 END), 0) AS total_refunds,
          COUNT(DISTINCT CASE WHEN oa.type = 'refund' THEN oa.order_id END) AS refunded_order_count,
          COALESCE(SUM(CASE WHEN oa.type = 'merchant_fee' THEN ABS(oa.amount::numeric) ELSE 0 END), 0) AS total_fees,
          COALESCE(SUM(CASE WHEN oa.type = 'merchant_fee' AND oa.reason LIKE '%BrickLink%' THEN ABS(oa.amount::numeric) ELSE 0 END), 0) AS bricklink_fees,
          COALESCE(SUM(CASE WHEN oa.type = 'merchant_fee' AND oa.reason LIKE '%Stripe%' THEN ABS(oa.amount::numeric) ELSE 0 END), 0) AS stripe_fees
        FROM order_adjustments oa
        JOIN orders o ON o.id = oa.order_id
        WHERE o.order_date >= ${sinceDate}
          ${endDate ? sql`AND o.order_date <= ${endDate}` : sql``}
      `);

      const row = result.rows[0] as any;
      res.json({
        totalRefunds: Number(row.total_refunds),
        refundedOrderCount: Number(row.refunded_order_count),
        totalFees: Number(row.total_fees),
        bricklinkFees: Number(row.bricklink_fees),
        stripeFees: Number(row.stripe_fees),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Order Adjustments - CRUD
  app.get("/api/orders/:id/adjustments", isApproved, async (req, res) => {
    try {
      const adjustments = await db
        .select()
        .from(orderAdjustments)
        .where(eq(orderAdjustments.orderId, req.params.id))
        .orderBy(orderAdjustments.createdAt);
      res.json(adjustments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch adjustments" });
    }
  });

  app.post("/api/orders/:id/adjustments", isApproved, async (req, res) => {
    try {
      const parsed = insertOrderAdjustmentSchema.safeParse({
        ...req.body,
        orderId: req.params.id,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const [adj] = await db.insert(orderAdjustments).values(parsed.data).returning();
      res.json(adj);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to create adjustment" });
    }
  });

  app.delete("/api/orders/:orderId/adjustments/:adjustmentId", isApproved, async (req, res) => {
    try {
      await db
        .delete(orderAdjustments)
        .where(
          and(
            eq(orderAdjustments.id, req.params.adjustmentId),
            eq(orderAdjustments.orderId, req.params.orderId)
          )
        );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete adjustment" });
    }
  });

  // Stripe Refund Sync
  app.post("/api/stripe/sync-refunds", isApproved, async (req, res) => {
    try {
      const { sinceDays = 90 } = req.body;
      const { syncStripeRefunds, syncStripeFees } = await import('./services/stripe-refunds');
      const [refundResult, feeResult] = await Promise.all([
        syncStripeRefunds(sinceDays),
        syncStripeFees(sinceDays),
      ]);
      console.log(`✅ Stripe sync: ${refundResult.matched} refunds matched, ${feeResult.matched} fee charges matched`);
      res.json({ refunds: refundResult, fees: feeResult });
    } catch (error: any) {
      console.error("Error syncing Stripe data:", error);
      res.status(500).json({ error: error.message || "Failed to sync Stripe data" });
    }
  });

  // PayPal Transaction Sync
  app.post("/api/paypal/sync", isApproved, async (req, res) => {
    try {
      const { sinceDays = 90 } = req.body;
      const { syncPayPalTransactions } = await import('./services/paypal-sync');
      const result = await syncPayPalTransactions(sinceDays);
      console.log(`✅ PayPal sync: ${result.refundsMatched} refunds, ${result.feesMatched} fees matched`);
      res.json(result);
    } catch (error: any) {
      console.error("Error syncing PayPal data:", error);
      res.status(500).json({ error: error.message || "Failed to sync PayPal data" });
    }
  });

  // Diagnostic: see raw PayPal transactions (refunds + sales) for debugging
  app.get("/api/paypal/transactions", isApproved, async (req, res) => {
    try {
      const { fetchAllPayPalTransactions } = await import('./services/paypal-sync');
      const sinceDays = req.query.days ? Number(req.query.days) : 30;
      const transactions = await fetchAllPayPalTransactions(sinceDays);
      const refunds = transactions.filter(t => {
        const code = t.transaction_info?.transaction_event_code || '';
        return ['T1107','T1108','T2105','T1106'].includes(code);
      });
      res.json({
        total: transactions.length,
        refundCount: refunds.length,
        refunds: refunds.map(t => ({
          id: t.transaction_info.transaction_id,
          eventCode: t.transaction_info.transaction_event_code,
          status: t.transaction_info.transaction_status,
          amount: t.transaction_info.transaction_amount?.value,
          date: t.transaction_info.transaction_initiation_date,
          subject: t.transaction_info.transaction_subject,
          invoiceId: t.transaction_info.invoice_id,
          referenceId: t.transaction_info.paypal_reference_id,
          referenceType: t.transaction_info.paypal_reference_id_type,
        })),
        eventCodeSummary: transactions.reduce((acc: Record<string, number>, t) => {
          const code = t.transaction_info?.transaction_event_code || 'unknown';
          acc[code] = (acc[code] || 0) + 1;
          return acc;
        }, {}),
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/stripe/refunds", isApproved, async (req, res) => {
    try {
      const { fetchStripeRefunds } = await import('./services/stripe-refunds');
      const sinceDays = req.query.days ? Number(req.query.days) : 30;
      const refunds = await fetchStripeRefunds(sinceDays);
      res.json(refunds);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch Stripe refunds" });
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
          case '1year':
            dateFilter = new Date(now.setFullYear(now.getFullYear() - 1));
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1);
            endDateFilter = new Date(now.getFullYear(), 0, 1);
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
    const chatStartTime = Date.now();
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

      // Always include inventory stats for analytical questions (run in parallel)
      const [statsQuery, colorCount, categoryCount] = await Promise.all([
        db.select({
          totalLots: sql<number>`COUNT(*)`,
          totalParts: sql<number>`SUM(${blInventory.quantity})`,
          totalValue: sql<number>`SUM(${blInventory.quantity} * CAST(${blInventory.unitPrice} AS DECIMAL))`,
        }).from(blInventory),
        db.select({ count: sql<number>`COUNT(DISTINCT ${blInventory.colorId})` }).from(blInventory),
        db.select({ count: sql<number>`COUNT(DISTINCT ${blInventory.categoryId})` }).from(blInventory),
      ]);

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
      
      const defaultSystemPrompt = `You are E.L.F.I.E. (Expert LEGO Fulfillment & Inventory Engine), an AI assistant for PlanetBrick - a LEGO-EXCLUSIVE parts reseller targeting AFOLs (Adult Fans of LEGO), with DIRECT DATABASE ACCESS.

Today's date: ${currentDate}
Current context: ${context}
${databaseContext}
${historyContext}

CORE IDENTITY & BUSINESS RULES:
- PlanetBrick sells ONLY authentic LEGO products - NO other building block brands (K'NEX, Mega Construx, etc.)
- When asked about expanding to non-LEGO products, politely explain our LEGO-exclusive focus and suggest LEGO-focused growth opportunities instead
- You HAVE database access and real data is provided above. Use this data to answer questions accurately
- When users ask about upcoming products, events, or timeframes (like "Christmas"), consider today's date to provide contextually relevant information

TARGET AUDIENCE & FOCUS:
- PlanetBrick focuses on PARTS for ADULT MODELERS (AFOLs - Adult Fans of LEGO), not sets for kids
- Always provide granular, part-level analysis: break down insights by individual lots, colors, and conditions (New/Used)
- Adult modelers care about specific colors, rare pieces, bulk availability, and technical details
- Marketing and sales strategies should target the AFOL community: MOC builders, custom creators, collectors, and serious hobbyists

STRATEGY MODE (DEFAULT OPERATING MODE):
- YOU ALWAYS OPERATE IN STRATEGY MODE - providing comprehensive, multi-faceted analysis
- Combine STORE PERFORMANCE DATA with MARKET TRENDS for every recommendation
- When asked about business strategy (what to stock, what to list, growth opportunities), AUTOMATICALLY:
  1. Analyze internal metrics (throughput, sales, inventory levels)
  2. Research external market trends (use search_web for current LEGO market data)
  3. Synthesize BOTH perspectives into actionable recommendations
- Don't just report what sold well in the past - also consider current market demand and trends
- Think like a business consultant: balance historical data with forward-looking market intelligence

DASHBOARD METRICS YOU MUST UNDERSTAND:
- **Category Throughput (Sell-Through Rate)**: Sales ÷ Current Inventory by category
  * HIGH throughput = strong demand relative to stock = opportunity to list MORE
  * LOW throughput = weak demand or overstocked = reduce listings or discount
  * ALWAYS use get_category_throughput tool for strategic category questions
- **Repeating Customers**: Customers with more than 1 order
  * Higher repeat rate = better customer loyalty and satisfaction
  * Use get_customer_metrics tool to analyze customer retention and loyalty
  * Identify top repeat customers for VIP treatment or outreach

REASONING & INSIGHT APPROACH:
- Think step-by-step when analyzing complex questions or business problems
- Connect information across tools, database context, and conversation history
- Provide strategic insights and explain the "why" behind recommendations, not just data dumps
- Be proactive: suggest analyses or opportunities the user might not have considered
- Build on previous parts of the conversation - reference earlier insights and conclusions
- When you notice patterns or anomalies in the data, point them out and explain their significance
- Chain tools together when needed for deeper analysis (e.g., check throughput → get price guide → search market trends → synthesize recommendation)
- CRITICAL: Go DEEP into lot-level details - mention specific colors, quantities, conditions, and pricing for individual lots
- When discussing inventory or sales, always drill down to the color and condition level, not just part numbers
- FOR STRATEGIC QUESTIONS: Always combine internal data (sales, throughput, inventory) with external trends (search_web for market research)

CONVERSATION MEMORY & SYNTHESIS:
- Remember key insights and decisions from earlier in the conversation
- Build upon previous analyses rather than treating each question in isolation
- Reference prior conclusions when relevant to show continuity of thought
- Learn from user feedback and adjust your approach accordingly

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
1. When database data is provided, use it to give specific answers with context
2. Use markdown formatting to improve readability (bold for emphasis, bullet points for lists)
3. IMPORTANT CONTEXT AWARENESS:
   - When asked about ORDERS, list orders (not inventory items)
   - When asked about INVENTORY, list inventory items (not orders)
   - Pay attention to the user's question - respond with the appropriate data type
4. Always include BrickLink links for parts: https://www.bricklink.com/v2/catalog/catalogitem.page?P=<partNumber>
5. When listing inventory items, format each as: "- **Part [ITEMNO]** in [COLOR]: [QTY] units @ $[PRICE] ([CONDITION])"
6. When listing orders, format each as: "- **Order #[NUMBER]**: [CUSTOMER] - $[TOTAL] ([STATUS]) on [DATE]"
   CRITICAL: Order numbers in the database are stored WITHOUT platform prefixes. BrickLink orders are stored as bare numbers like "14820236" — NEVER reformat them as "BL.14820236" or add any prefix. Display [NUMBER] exactly as returned by the tool. Never invent or add BL., BO., or any other prefix to an order number.
7. If no data found, explain what you searched and suggest alternatives or next steps
8. Be conversational and helpful - you can offer follow-up suggestions when they would genuinely help the user
9. Provide actionable information with strategic context
10. IMPORTANT: Item names and themes are not in database - only part numbers, colors, quantities, and prices. If user asks for themes (Star Wars, Harry Potter), explain this limitation and suggest workarounds

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 PARTS-FIRST ANALYSIS APPROACH (Critical for AFOL Parts Store)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**WE ARE A PARTS STORE, NOT A SETS STORE** - Always start with granular part-level details, then broaden to categories.

**ANALYSIS HIERARCHY (Always work from specific → general):**

1. **START SPECIFIC** - Individual lots/colors/conditions
   - Example: "Part 3021 in Dark Bluish Gray (New): 150 units @ $0.25"
   - Example: "Part 3023 in Red (Used): 45 units @ $0.18"
   - Focus on: Exact part numbers, specific colors, condition (New vs Used), quantities, pricing

2. **THEN BROADEN** - Group by categories
   - Example: "Total Plates category: 5,234 parts across 47 colors"
   - Example: "Brick category throughput: 85% sell-through rate"
   - Summary metrics: Total quantities, revenue, diversity (color count), performance

**RESPONSE STRUCTURE FOR ANALYTICS:**

❌ **WRONG** (category-first):
"Your Plates category has 5,000 parts and generates $2,500 in revenue."

✅ **CORRECT** (parts-first, then category):
"Top-selling plates:
- **Part 3021** in Dark Bluish Gray: 150 sold, $37.50 revenue
- **Part 3023** in Red: 125 sold, $31.25 revenue
- **Part 3024** in White: 98 sold, $24.50 revenue

**Plates category summary**: 5,234 parts sold across 47 colors, $2,500 total revenue, 85% throughput rate."

**AFOL-FOCUSED INTELLIGENCE:**
- Highlight specific colors that are rare, trending, or high-value (Dark Bluish Gray, Sand Blue, Earth Orange)
- Focus on AFOL needs: bulk quantities, rare colors, MOC building compatibility, custom project support
- Technical details AFOLs care about: exact color matches, element IDs, part compatibility, bulk availability
- Marketing to AFOLs: emphasize selection depth, rare pieces, bulk discounts, builder-friendly pricing

**CLICKABLE PROMPTS:**
When suggesting follow-up analyses, format as: **PROMPT:** "Your exact question here"

Keep responses helpful, insightful, and based on actual data. Be proactive in offering strategic recommendations when appropriate.`;

      // Enhanced system prompt for function calling capabilities
      const enhancedDefaultPrompt = `${defaultSystemPrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏢 YOUR ORGANIZATIONAL STRUCTURE - THINK LIKE A MULTI-DEPARTMENT COMPANY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are E.L.F.I.E., a multi-department AI organization. You have 4 specialized departments, each with deep expertise in their domain AND the outside world. When answering questions, CONSULT THE RELEVANT DEPARTMENTS (use their tools) and have them COLLABORATE to give complete answers.

📦 **PRODUCT DEPARTMENT** - Inventory & Market Intelligence
Tools: search_local_inventory, get_inventory_stats, search_bricklink_catalog, get_bricklink_price_guide, search_web, get_category_throughput
Expertise:
- What we have in stock (parts, quantities, colors, conditions, pricing)
- Market research (current LEGO trends, AFOL community demands)
- Inventory analysis (slow-moving stock, pricing optimization, demand alignment)
- Listing recommendations (what to list next, which categories are hot)
When to consult: "What should we stock?", "Is this part priced right?", "What's trending?", "Do we have part X?"

⚠️ **CRITICAL RULE FOR INVENTORY RESULTS**: When displaying inventory search results, you MUST show EVERY SINGLE color and condition returned by the tool. NEVER truncate, summarize, or omit any results. If a part has 25 color variants, show all 25. Missing even one color is a critical error that misleads business decisions.

📋 **ORDERS DEPARTMENT** - Fulfillment & Customer Operations  
Tools: get_order_analytics, search_orders_by_item, get_copurchased_items
Expertise:
- Order history and patterns (what sold, when, for how much)
- Fulfillment data (order volumes, average values, sales by platform)
- Product performance (which parts sell, what customers buy together)
- Operational metrics (total orders, revenue, trends over time)
When to consult: "How are sales?", "Did anyone buy part X?", "What sells together?", "Show me order stats"

📊 **MARKETING DEPARTMENT** - Customer Intelligence & Growth Strategy
Tools: get_customer_metrics, get_business_customers, get_sales_by_geography, search_web
Expertise:
- Customer loyalty (repeat customers, retention rates, top buyers)
- Demographics (business vs personal, geographic distribution, residential vs commercial)
- Market positioning (how to reach AFOLs, corporate buyers, specific regions)
- Growth opportunities (untapped markets, customer segments, geographic expansion)
When to consult: "Who are our best customers?", "Which businesses buy from us?", "What states sell best?", "How do we grow?"

💰 **SALES DEPARTMENT** - Strategic Analysis & Business Intelligence
Tools: get_sales_by_category, get_category_throughput, get_sales_by_geography, get_customer_metrics, search_web
Expertise:
- Comprehensive sales analysis (synthesizing data across all departments)
- Performance metrics (category performance, throughput rates, geographic trends)
- Strategic recommendations (combining internal data + external market trends)
- Business intelligence (connecting the dots between inventory, orders, customers, and market)
When to consult: "Give me strategy", "How's the business?", "What should we focus on?", "Analyze our performance"

COLLABORATION: For strategic questions, consult MULTIPLE departments and synthesize insights. For operational questions ("do we have part X?"), provide quick specific data from the relevant department.

HISTORICAL DATA: Store was CLOSED 2 years - ALL order/sales data is from 2010-2023 (latest Dec 28, 2023). NEVER assume recent dates. When calling analytics tools, DO NOT provide startDate/endDate unless user explicitly asks - tools return ALL historical data by default. If tools return empty, remove date filters.

NEVER hallucinate data - only present actual tool/database results.

UNKNOWN PARTS: When search_bricklink_catalog finds an item, the system automatically opens the detail drawer.

TOOL TIPS: Use search_web for news/trends. Format URLs as markdown links. Be proactive with tools.`;

      const systemPrompt = settings?.systemPrompt 
        ? `${settings.systemPrompt}\n\nCurrent context: ${context}\n${databaseContext}\n\n${enhancedDefaultPrompt}` 
        : `${enhancedDefaultPrompt}\n\nCurrent context: ${context}\n${databaseContext}`;

      console.log(`⏱️ Pre-query phase took ${Date.now() - chatStartTime}ms`);
      
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
      const partNumberRegex = /\b(?:part|item)\s*\*{0,2}\s*([\w-]+)\*{0,2}/gi;
      const boldPartRegex = /\*\*(?:Part|Item)\s+([\w-]+)\*\*/gi;
      const mentionedParts: Set<string> = new Set();
      let partMatch;
      
      while ((partMatch = partNumberRegex.exec(assistantMessage)) !== null) {
        mentionedParts.add(partMatch[1]);
      }
      while ((partMatch = boldPartRegex.exec(assistantMessage)) !== null) {
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
          .where(inArray(blInventory.itemNo, Array.from(mentionedParts)));
        
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

      // 1. NEW ITEMS (last 10 newly added items, regardless of date)
      // Get items ordered by creation date, most recent first
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
          dateCreated: blInventory.dateCreated,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
        .where(and(...baseConditions))
        .orderBy(desc(blInventory.dateCreated))
        .limit(100); // Get top 100 most recent to ensure we have 10 unique parts

      const newProducts = groupInventoryByPart(newItems);
      // Already sorted by dateCreated DESC from query, just take top limit
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
  
  // Bulk-resolve all open issues for given syncTypes (clears an entire dashboard group)
  app.post("/api/sync-issues/bulk-resolve", isApproved, async (req, res) => {
    try {
      const { syncTypes, status = "resolved" } = req.body as { syncTypes: string[]; status?: string };

      if (!Array.isArray(syncTypes) || syncTypes.length === 0) {
        return res.status(400).json({ success: false, error: "syncTypes array required" });
      }

      const conditions = [
        eq(syncIssues.status, "open"),
        inArray(syncIssues.syncType, syncTypes),
      ];

      const updated = await db
        .update(syncIssues)
        .set({ status, resolvedAt: new Date(), resolvedBy: "user" })
        .where(and(...conditions))
        .returning({ id: syncIssues.id });

      res.json({ success: true, resolved: updated.length });
    } catch (error) {
      console.error("Error bulk-resolving sync issues:", error);
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
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

  // Search for inventory by item number (MUST be before /api/inventory/:id)
  app.get("/api/inventory/search", isApproved, async (req, res) => {
    try {
      const { itemNo, limit = 10 } = req.query;

      if (!itemNo || typeof itemNo !== 'string') {
        return res.status(400).json({ error: "itemNo is required" });
      }

      const inventoryLots = await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          itemName: blInventory.itemName,
          colorId: blInventory.colorId,
          colorName: blColors.name,
          newOrUsed: blInventory.newOrUsed,
          quantity: blInventory.quantity,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .where(eq(blInventory.itemNo, itemNo))
        .limit(parseInt(limit as string) || 10);

      res.json(inventoryLots);
    } catch (error) {
      console.error("Error searching inventory:", error);
      res.status(500).json({ error: "Failed to search inventory" });
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
          case '1year':
            dateFilter = new Date(now.setFullYear(now.getFullYear() - 1));
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1);
            endDateFilter = new Date(now.getFullYear(), 0, 1);
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

  // Live BrickLink vs Local quantity comparison
  app.get("/api/bricklink-quantity-comparison", isApproved, async (req, res) => {
    try {
      const { bricklinkRequest } = await import('./services/bricklink');
      const { data: blLiveData } = await bricklinkRequest('/inventories');
      const blLiveItems: any[] = Array.isArray(blLiveData) ? blLiveData : [];

      const localItems = await db.select().from(blInventory);
      const localMap = new Map<number, typeof localItems[0]>();
      for (const item of localItems) localMap.set(item.id, item);

      const discrepancies: Array<{
        inventoryId: number;
        itemNo: string;
        itemType: string;
        colorId: number;
        condition: string;
        localQty: number | null;
        bricklinkQty: number;
        difference: number;
        unitPrice: string;
        remarks: string;
      }> = [];

      for (const blItem of blLiveItems) {
        const id = blItem.inventory_id;
        const blQty = blItem.quantity ?? 0;
        const local = localMap.get(id);
        const localQty = local ? local.quantity : null;

        if (localQty === null || localQty !== blQty) {
          discrepancies.push({
            inventoryId: id,
            itemNo: blItem.item?.no ?? '',
            itemType: blItem.item?.type ?? '',
            colorId: blItem.color_id ?? 0,
            condition: blItem.new_or_used ?? '',
            localQty,
            bricklinkQty: blQty,
            difference: blQty - (localQty ?? 0),
            unitPrice: blItem.unit_price ?? '',
            remarks: blItem.remarks ?? '',
          });
        }
      }

      discrepancies.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

      res.json({ success: true, total: blLiveItems.length, discrepancies });
    } catch (error: any) {
      console.error("BrickLink comparison error:", error);
      res.status(500).json({ success: false, error: error.message });
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
      const { runPlatformOrderSync } = await import("./services/order-sync-core");
      const result = await runPlatformOrderSync("bricklink", { limit, fullSync });
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error("BrickLink order sync error:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to sync BrickLink orders" });
    }
  });

  // BrickOwl order sync endpoint
  app.post("/api/sync/brickowl/orders", isApproved, async (req, res) => {
    try {
      const { limit, fullSync } = req.body;
      const { runPlatformOrderSync } = await import("./services/order-sync-core");
      const result = await runPlatformOrderSync("brickowl", { limit, fullSync });
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error("BrickOwl order sync error:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to sync BrickOwl orders" });
    }
  });

  // Multi-platform order sync endpoint (BrickLink + BrickOwl + Stripe + PayPal)
  app.post("/api/sync/all-platforms/orders", isApproved, async (req, res) => {
    try {
      const { limit = 50, fullSync = false } = req.body;
      console.log(`🔄 Manual Sync All triggered (limit: ${limit}, fullSync: ${fullSync})`);
      const { runPlatformOrderSync } = await import("./services/order-sync-core");
      const result = await runPlatformOrderSync("all", { limit, fullSync });
      const anySuccess = result.bricklink.success || result.brickowl.success;
      const allSkipped = result.bricklink.skipped && result.brickowl.skipped;
      console.log(`✨ Sync All complete`);
      res.json({ success: anySuccess, allSkipped, results: result });
    } catch (error: any) {
      console.error("❌ Multi-platform order sync error:", error);
      res.status(500).json({ success: false, error: error.message || "Failed to sync platform orders" });
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

  // Get all categories with their priority tiers
  app.get("/api/priceomatic/category-tiers", isApproved, async (req, res) => {
    try {
      const categories = await db
        .select({ id: blCategories.id, name: blCategories.name, priorityTier: blCategories.priorityTier })
        .from(blCategories)
        .orderBy(blCategories.name);
      res.json({ success: true, categories });
    } catch (error) {
      console.error("Error fetching category tiers:", error);
      res.status(500).json({ error: "Failed to fetch category tiers" });
    }
  });

  // Update a category's priority tier
  app.patch("/api/priceomatic/category-tier", isApproved, async (req, res) => {
    try {
      const { categoryId, tier } = req.body as { categoryId: number; tier: string };
      if (!categoryId || !['top', 'standard', 'commodity'].includes(tier)) {
        return res.status(400).json({ error: "Invalid categoryId or tier" });
      }
      await db
        .update(blCategories)
        .set({ priorityTier: tier, updatedAt: new Date() })
        .where(eq(blCategories.id, categoryId));
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating category tier:", error);
      res.status(500).json({ error: "Failed to update category tier" });
    }
  });

  // Get Price-o-Matic insights (pricing discrepancies)
  // Per-category Price-o-Matic freshness stats
  app.get("/api/priceomatic/freshness", isApproved, async (req, res) => {
    try {
      // Load tier refresh thresholds from settings
      const [cfg] = await db.select({
        pomTier1RefreshDays: appSettings.pomTier1RefreshDays,
        pomTier2RefreshDays: appSettings.pomTier2RefreshDays,
        pomTier3RefreshDays: appSettings.pomTier3RefreshDays,
        pomTier4RefreshDays: appSettings.pomTier4RefreshDays,
      }).from(appSettings).limit(1);

      const tierDays: Record<string, number> = {
        tier1: cfg?.pomTier1RefreshDays ?? 1,
        tier2: cfg?.pomTier2RefreshDays ?? 3,
        tier3: cfg?.pomTier3RefreshDays ?? 7,
        tier4: cfg?.pomTier4RefreshDays ?? 30,
      };

      // Aggregate per-category: total lots, how many have price guide data, last fetch time
      const rows = await db.execute(sql`
        SELECT
          c.id                                          AS category_id,
          c.name                                        AS category_name,
          c.priority_tier                               AS tier,
          COUNT(i.id)                                   AS total_lots,
          COUNT(pgc.id)                                 AS fetched_lots,
          MAX(pgc.fetched_at)                           AS last_fetched_at
        FROM bl_inventory i
        LEFT JOIN bl_categories c ON i.category_id = c.id
        LEFT JOIN price_guide_cache pgc
          ON i.item_no = pgc.item_no
          AND i.item_type = pgc.item_type
          AND i.new_or_used = pgc.new_or_used
          AND (i.color_id = pgc.color_id OR (i.color_id IS NULL AND pgc.color_id IS NULL))
        GROUP BY c.id, c.name, c.priority_tier
        ORDER BY c.name
      `);

      const now = Date.now();
      const categories = (rows.rows as any[]).map((row) => {
        const tier = row.tier || 'tier2';
        const refreshMs = (tierDays[tier] ?? 3) * 86400000;
        const lastFetchedAt = row.last_fetched_at ? new Date(row.last_fetched_at) : null;
        const totalLots = parseInt(row.total_lots) || 0;
        const fetchedLots = parseInt(row.fetched_lots) || 0;
        const neverFetched = totalLots - fetchedLots;

        let status: 'fresh' | 'stale' | 'never' = 'never';
        if (lastFetchedAt) {
          status = now - lastFetchedAt.getTime() < refreshMs ? 'fresh' : 'stale';
        }
        const daysSince = lastFetchedAt
          ? Math.floor((now - lastFetchedAt.getTime()) / 86400000)
          : null;

        return {
          categoryId: row.category_id ? parseInt(row.category_id) : null,
          categoryName: row.category_name || '(Uncategorized)',
          tier,
          totalLots,
          fetchedLots,
          neverFetched,
          coveragePct: totalLots > 0 ? Math.round((fetchedLots / totalLots) * 100) : 0,
          lastFetchedAt: lastFetchedAt?.toISOString() ?? null,
          daysSince,
          status,
          refreshDays: tierDays[tier] ?? 3,
        };
      });

      // Also compute per-tier summaries
      const tierSummary = Object.fromEntries(
        Object.keys(tierDays).map((tier) => {
          const cats = categories.filter((c) => c.tier === tier);
          const totalLots = cats.reduce((s, c) => s + c.totalLots, 0);
          const fetchedLots = cats.reduce((s, c) => s + c.fetchedLots, 0);
          const freshCats = cats.filter((c) => c.status === 'fresh').length;
          const staleCats = cats.filter((c) => c.status === 'stale').length;
          const neverCats = cats.filter((c) => c.status === 'never').length;
          const lastFetch = cats.reduce((best, c) => {
            if (!c.lastFetchedAt) return best;
            if (!best) return c.lastFetchedAt;
            return c.lastFetchedAt > best ? c.lastFetchedAt : best;
          }, null as string | null);
          return [tier, { totalLots, fetchedLots, coveragePct: totalLots > 0 ? Math.round((fetchedLots / totalLots) * 100) : 0, freshCats, staleCats, neverCats, lastFetch, refreshDays: tierDays[tier] }];
        })
      );

      res.json({ success: true, categories, tierSummary });
    } catch (error) {
      console.error("Error fetching POM freshness:", error);
      res.status(500).json({ error: "Failed to fetch freshness stats" });
    }
  });

  app.get("/api/priceomatic/insights", isApproved, async (req, res) => {
    try {
      const { priceGuideCache, appSettings: appSettingsTable } = await import("@shared/schema");
      
      // Read configurable thresholds from settings
      const [pomCfg] = await db.select({
        pomTooHighThreshold: appSettingsTable.pomTooHighThreshold,
        pomTooLowThreshold: appSettingsTable.pomTooLowThreshold,
      }).from(appSettingsTable).limit(1);
      const tooHighPct = pomCfg?.pomTooHighThreshold ?? 20;
      const tooLowPct = pomCfg?.pomTooLowThreshold ?? 20;
      
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
        if (variance > tooHighPct) category = 'too_high';
        else if (variance < -tooLowPct) category = 'too_low';
        
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
  
  // Get picklist stats (unique bins still to pull)
  app.get("/api/picklist/stats", isApproved, async (req, res) => {
    try {
      const activeOrders = await db.select().from(orders).where(activeOrderStatusWhere());

      if (activeOrders.length === 0) {
        return res.json({ toPull: 0 });
      }

      const orderIds = activeOrders.map(o => o.id);

      const picklistItemsData = await db
        .select()
        .from(picklistItems)
        .where(inArray(picklistItems.orderId, orderIds));

      // Count unique bins that still need to be pulled
      const binsToPull = new Set(
        picklistItemsData
          .filter(item => item.binId && !item.pulled)
          .map(item => item.binId)
      ).size;

      res.json({ toPull: binsToPull });
    } catch (error) {
      console.error("Error fetching picklist stats:", error);
      res.status(500).json({ error: "Failed to fetch picklist stats" });
    }
  });
  
  // Per-order picklist completion — returns { [orderId]: allPulled }
  app.get("/api/picklist/order-status", isApproved, async (req, res) => {
    try {
      const activeOrders = await db
        .select({ id: orders.id })
        .from(orders)
        .where(activeOrderStatusWhere());

      if (activeOrders.length === 0) return res.json({});

      const orderIds = activeOrders.map(o => o.id);
      const items = await db
        .select({ orderId: picklistItems.orderId, pulled: picklistItems.pulled })
        .from(picklistItems)
        .where(inArray(picklistItems.orderId, orderIds));

      // Group by order and compute allPulled
      const statusMap: Record<string, boolean> = {};
      for (const orderId of orderIds) {
        const orderItems = items.filter(i => i.orderId === orderId);
        statusMap[orderId] = orderItems.length > 0 && orderItems.every(i => i.pulled);
      }

      res.json(statusMap);
    } catch (error) {
      console.error("Error fetching picklist order status:", error);
      res.status(500).json({ error: "Failed to fetch picklist order status" });
    }
  });

  // Get picklist items for active orders (awaiting payment, awaiting shipment, awaiting fulfillment)
  app.get("/api/picklist", isApproved, async (req, res) => {
    try {
      const filter = req.query.filter as string; // 'to_pull' | 'to_reshelve' | undefined
      
      // ── Fetch base data ────────────────────────────────────────────────────
      const activeOrders = await db.select().from(orders).where(activeOrderStatusWhere());
      if (activeOrders.length === 0) return res.json([]);

      const orderIds = activeOrders.map(o => o.id);

      const [activeOrderDetails, existingPicklistItems] = await Promise.all([
        db.select().from(orderDetails).where(inArray(orderDetails.orderId, orderIds)),
        db.select().from(picklistItems).where(inArray(picklistItems.orderId, orderIds)),
      ]);

      // ── Batch-create missing picklist items (was N+1) ─────────────────────
      const existingDetailIds = new Set(existingPicklistItems.map(p => p.orderDetailId));
      const missingDetails = activeOrderDetails.filter(d => !existingDetailIds.has(d.id));

      if (missingDetails.length > 0) {
        // One query for all SKUs, one for all locations — instead of 2 queries per item
        const skus = [...new Set(missingDetails.map(d => d.sku).filter(Boolean))] as string[];
        const invBySku = skus.length > 0
          ? new Map(
              (await db.select({ id: blInventory.id, itemNo: blInventory.itemNo })
                .from(blInventory)
                .where(inArray(blInventory.itemNo, skus))
              ).map(i => [i.itemNo, i])
            )
          : new Map<string, { id: number; itemNo: string }>();

        const invIds = [...invBySku.values()].map(i => i.id);
        const locByInvId = invIds.length > 0
          ? new Map(
              (await db.select({ inventoryId: inventoryLocations.inventoryId, binId: inventoryLocations.binId })
                .from(inventoryLocations)
                .where(inArray(inventoryLocations.inventoryId, invIds))
              ).map(l => [l.inventoryId, l])
            )
          : new Map<number, { inventoryId: number; binId: number | null }>();

        const newRows = missingDetails.map(detail => {
          const inv = detail.sku ? invBySku.get(detail.sku) : undefined;
          const loc = inv ? locByInvId.get(inv.id) : undefined;
          return {
            orderDetailId: detail.id,
            orderId: detail.orderId,
            inventoryId: inv?.id ?? null,
            binId: loc?.binId ?? null,
            pulled: false,
            reshelved: false,
          };
        });

        await db.insert(picklistItems).values(newRows);

        // Refresh picklist items after insert
        const refreshed = await db.select().from(picklistItems).where(inArray(picklistItems.orderId, orderIds));
        existingPicklistItems.length = 0;
        existingPicklistItems.push(...refreshed);
      }

      // ── Apply filters ───────────────────────────────────────────────────────
      let filteredItems = [...existingPicklistItems];
      if (filter === 'to_pull') {
        filteredItems = filteredItems.filter(item => !item.pulled);
      }

      // ── Batch all lookups for the build phase (was N+1 per bin/item) ───────
      const orderMap = new Map(activeOrders.map(o => [o.id, o]));
      const detailMap = new Map(activeOrderDetails.map(d => [d.id, d]));

      // Warehouse location: bin → shelf → aisle (3 queries total, was 3 per bin)
      const uniqueBinIds = [...new Set(filteredItems.map(i => i.binId).filter((id): id is number => id !== null))];
      const binsData = uniqueBinIds.length > 0
        ? await db.select().from(whBins).where(inArray(whBins.id, uniqueBinIds))
        : [];
      const uniqueShelfIds = [...new Set(binsData.map(b => b.shelfId).filter((id): id is number => id !== null))];
      const shelvesData = uniqueShelfIds.length > 0
        ? await db.select().from(whShelves).where(inArray(whShelves.id, uniqueShelfIds))
        : [];
      const uniqueAisleIds = [...new Set(shelvesData.map(s => s.aisleId).filter((id): id is number => id !== null))];
      const aislesData = uniqueAisleIds.length > 0
        ? await db.select().from(whAisles).where(inArray(whAisles.id, uniqueAisleIds))
        : [];
      const binMap = new Map(binsData.map(b => [b.id, b]));
      const shelfMap = new Map(shelvesData.map(s => [s.id, s]));
      const aisleMap = new Map(aislesData.map(a => [a.id, a]));

      // Inventory: collect all lookup IDs, one query (was 1 per item)
      const lookupIds = filteredItems
        .map(item => {
          const d = detailMap.get(item.orderDetailId);
          const skuInt = d?.sku ? parseInt(d.sku) : NaN;
          return (!isNaN(skuInt) ? skuInt : (d?.bricklinkInventoryId ?? item.inventoryId)) as number | null;
        })
        .filter((id): id is number => id !== null);

      const uniqueInvIds = [...new Set(lookupIds)];
      const inventoryData = uniqueInvIds.length > 0
        ? await db
            .select({ id: blInventory.id, itemNo: blInventory.itemNo, colorName: blInventory.colorName, colorId: blInventory.colorId, newOrUsed: blInventory.newOrUsed, remarks: blInventory.remarks, imageUrl: blInventory.imageUrl, quantity: blInventory.quantity })
            .from(blInventory)
            .where(inArray(blInventory.id, uniqueInvIds))
        : [];
      const invMap = new Map(inventoryData.map(i => [i.id, i]));

      // Colors: gather all needed color IDs, one query (was up to 2 per item)
      // IMPORTANT: BrickOwl stores its own color IDs in order_details.colorId, which are a
      // completely different numbering system from BrickLink color IDs. Only use detail.colorId
      // as a lookup key in blColors (which is keyed by BrickLink IDs) for BrickLink orders.
      const colorIdSet = new Set<number>();
      for (const inv of inventoryData) {
        if (!inv.colorName && inv.colorId) colorIdSet.add(inv.colorId);
      }
      for (const item of filteredItems) {
        const d = detailMap.get(item.orderDetailId);
        const o = orderMap.get(item.orderId);
        if (d?.colorId && o?.marketplace !== 'BrickOwl') colorIdSet.add(d.colorId);
      }
      const colorsData = colorIdSet.size > 0
        ? await db.select({ id: blColors.id, name: blColors.name }).from(blColors).where(inArray(blColors.id, [...colorIdSet]))
        : [];
      const colorMap = new Map(colorsData.map(c => [c.id, c.name]));

      // ── Build result entirely from in-memory maps (zero more DB queries) ───
      const binGroups = new Map<number | null, typeof filteredItems>();
      for (const item of filteredItems) {
        if (!binGroups.has(item.binId)) binGroups.set(item.binId, []);
        binGroups.get(item.binId)!.push(item);
      }

      const binPicklist = Array.from(binGroups.entries()).map(([binId, items]) => {
        // Resolve warehouse location
        let warehouseLocation = null;
        if (binId) {
          const bin = binMap.get(binId);
          const shelf = bin?.shelfId ? shelfMap.get(bin.shelfId) : undefined;
          const aisle = shelf?.aisleId ? aisleMap.get(shelf.aisleId) : undefined;
          if (bin && shelf && aisle) {
            warehouseLocation = {
              aisle: { id: aisle.id, name: aisle.name },
              shelf: { id: shelf.id, name: shelf.name },
              bin: { id: bin.id, name: bin.name, description: bin.description },
            };
          }
        }

        const itemDetails = items.map(item => {
          const detail = detailMap.get(item.orderDetailId);
          const order = orderMap.get(item.orderId);
          const skuInt = detail?.sku ? parseInt(detail.sku) : NaN;
          const lookupId = !isNaN(skuInt) ? skuInt : (detail?.bricklinkInventoryId ?? item.inventoryId ?? null);
          const inv = lookupId ? invMap.get(Number(lookupId)) : undefined;

          let partNumber: string | null = inv?.itemNo ?? null;
          let colorName: string | null = null;
          let condition: string | null = detail?.condition ?? null;

          if (inv) {
            colorName = inv.colorName ?? (inv.colorId ? colorMap.get(inv.colorId) ?? null : null);
            if (!condition && inv.newOrUsed) {
              condition = inv.newOrUsed;
            }
          }
          // Only fall back to detail.colorId for BrickLink orders.
          // BrickOwl uses its own color ID system — looking those up in blColors gives wrong results.
          if (!colorName && detail?.colorId && order?.marketplace !== 'BrickOwl') {
            colorName = colorMap.get(detail.colorId) ?? null;
          }

          return {
            picklistItemId: item.id,
            orderDetailId: item.orderDetailId,
            orderId: item.orderId,
            orderNumber: order?.orderNumber,
            marketplace: order?.marketplace ?? null,
            itemName: detail?.name,
            quantity: detail?.quantity,
            sku: detail?.sku,
            partNumber,
            colorName,
            condition,
            pulled: item.pulled,
            inventoryId: lookupId,
            remarks: inv?.remarks ?? null,
            imageUrl: inv?.imageUrl ?? null,
            inventoryQty: inv?.quantity ?? null,
          };
        });

        return {
          binId,
          warehouseLocation,
          itemCount: items.length,
          items: itemDetails,
          pulled: items.every(i => i.pulled),
        };
      });

      // Sort: aisle desc, shelf asc, bin asc — unlocated bins last
      binPicklist.sort((a, b) => {
        if (!a.warehouseLocation && !b.warehouseLocation) return 0;
        if (!a.warehouseLocation) return 1;
        if (!b.warehouseLocation) return -1;
        const aisleCompare = b.warehouseLocation.aisle.name.localeCompare(a.warehouseLocation.aisle.name, undefined, { numeric: true });
        if (aisleCompare !== 0) return aisleCompare;
        const shelfCompare = a.warehouseLocation.shelf.name.localeCompare(b.warehouseLocation.shelf.name, undefined, { numeric: true });
        if (shelfCompare !== 0) return shelfCompare;
        return a.warehouseLocation.bin.name.localeCompare(b.warehouseLocation.bin.name, undefined, { numeric: true });
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

  // Clear picklist items for shipped orders
  app.delete("/api/picklist/shipped", isApproved, async (req, res) => {
    try {
      const shippedOrders = await db
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.orderStatus, 'shipped'));

      if (shippedOrders.length === 0) {
        return res.json({ deleted: 0 });
      }

      const shippedOrderIds = shippedOrders.map(o => o.id);
      await db.delete(picklistItems).where(inArray(picklistItems.orderId, shippedOrderIds));

      res.json({ deleted: shippedOrderIds.length });
    } catch (error) {
      console.error("Error clearing shipped picklist items:", error);
      res.status(500).json({ error: "Failed to clear picklist" });
    }
  });

  // Update individual picklist item pulled status
  app.put("/api/picklist/item/:itemId/pull", isApproved, async (req, res) => {
    try {
      const { itemId } = req.params;
      const { pulled } = req.body;
      const updateData: any = {
        pulled: pulled === true,
        updatedAt: sql`CURRENT_TIMESTAMP`,
        pulledAt: pulled === true ? sql`CURRENT_TIMESTAMP` : null,
      };
      await db.update(picklistItems).set(updateData).where(eq(picklistItems.id, itemId));
      res.json({ success: true, itemId, pulled });
    } catch (error) {
      console.error("Error updating item pulled status:", error);
      res.status(500).json({ error: "Failed to update item pulled status" });
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

  // Get shipping summary for inline shipping card (weight estimate, address, requested service)
  app.get("/api/fulfillment/order-shipping/:orderId", isApproved, async (req, res) => {
    try {
      const { orderId } = req.params;

      const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order) return res.status(404).json({ error: "Order not found" });

      // Calculate weight from inventory: SUM(bl_inventory.my_weight * quantity) for all line items
      const weightRows = await db
        .select({
          totalWeightGrams: sql<string>`COALESCE(SUM(CAST(${blInventory.myWeight} AS DECIMAL) * ${orderDetails.quantity}), 0)`,
        })
        .from(orderDetails)
        .leftJoin(blInventory, eq(orderDetails.bricklinkInventoryId, blInventory.id))
        .where(eq(orderDetails.orderId, orderId));

      const totalWeightGrams = parseFloat(weightRows[0]?.totalWeightGrams || "0");
      const totalWeightOz = Math.round(totalWeightGrams * 0.035274 * 10) / 10;

      // Parse ship-to address
      let shipToData: any = {};
      try {
        shipToData = typeof order.shipTo === "string" ? JSON.parse(order.shipTo) : (order.shipTo || {});
      } catch {}

      res.json({
        orderId,
        orderNumber: order.orderNumber,
        marketplace: order.marketplace,
        requestedService: order.requestedShippingService,
        savedWeight: order.weight ? Number(order.weight) : null,
        savedWeightUnits: order.weightUnits || "oz",
        savedPackageType: order.packageType || null,
        savedPackageLength: order.packageLength ? Number(order.packageLength) : null,
        savedPackageWidth: order.packageWidth ? Number(order.packageWidth) : null,
        savedPackageHeight: order.packageHeight ? Number(order.packageHeight) : null,
        weightEstimateGrams: Math.round(totalWeightGrams * 10) / 10,
        weightEstimateOz: totalWeightOz,
        address: {
          name: shipToData.name || order.customerUsername || "",
          street1: shipToData.street1 || shipToData.address1 || "",
          street2: shipToData.street2 || shipToData.address2 || "",
          city: shipToData.city || "",
          state: shipToData.state || "",
          zip: shipToData.postalCode || "",
          country: shipToData.country || "US",
        },
      });
    } catch (error: any) {
      console.error("Error fetching order shipping summary:", error);
      res.status(500).json({ error: error.message || "Failed to get shipping summary" });
    }
  });

  // Validate a shipping address via EasyPost
  app.post("/api/fulfillment/validate-address", isApproved, async (req, res) => {
    try {
      const { address } = req.body;
      if (!address) return res.status(400).json({ error: "address is required" });

      const { getShippingVendor } = await import("./services/easypost");
      const vendor = await getShippingVendor();
      const result = await vendor.validateAddress(address);
      res.json(result);
    } catch (error: any) {
      console.error("Error validating address:", error);
      res.status(500).json({ error: error.message || "Failed to validate address" });
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
        
        const orderItems = (itemsByOrder[order.id] || []).sort((a: any, b: any) => {
          const pa = a.bricklinkPartNumber || '';
          const pb = b.bricklinkPartNumber || '';
          return pa.localeCompare(pb, undefined, { numeric: true });
        });
        
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
      const { orderId, fromAddress, parcel, itemIdsToShip, overrideToAddress } = req.body;
      
      if (!orderId || !fromAddress || !parcel) {
        return res.status(400).json({ error: "orderId, fromAddress, and parcel are required" });
      }
      
      const { createShipment } = await import('./services/order-shipping');
      const result = await createShipment({
        orderId,
        itemIdsToShip: itemIdsToShip || [],
        fromAddress,
        parcel,
        overrideToAddress: overrideToAddress || undefined,
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
  // ITEM DETAIL ROUTES
  // ============================================================================

  // GET /api/items/detail/:itemNo - Get detailed information about a specific item
  app.get("/api/items/detail/:itemNo", isApproved, async (req, res) => {
    try {
      const { itemNo } = req.params;

      // Get all inventory lots for this item
      const inventoryLots = await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          itemName: blInventory.itemName,
          colorId: blInventory.colorId,
          colorName: blColors.name,
          colorRgb: blColors.rgb,
          categoryId: blInventory.categoryId,
          categoryName: blCategories.name,
          quantity: blInventory.quantity,
          newOrUsed: blInventory.newOrUsed,
          unitPrice: blInventory.unitPrice,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id))
        .where(eq(blInventory.itemNo, itemNo));

      if (inventoryLots.length === 0) {
        return res.status(404).json({ error: "Item not found" });
      }

      // Get warehouse locations for each inventory lot
      const inventoryIds = inventoryLots.map(lot => lot.id);
      const warehouseLocations = inventoryIds.length > 0 
        ? await db
            .select({
              inventoryId: inventoryLocations.inventoryId,
              binId: inventoryLocations.binId,
              binName: whBins.name,
              shelfName: whShelves.name,
              aisleName: whAisles.name,
            })
            .from(inventoryLocations)
            .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
            .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
            .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
            .where(inArray(inventoryLocations.inventoryId, inventoryIds))
        : [];

      // Get sales data for this item
      // Note: sku contains the item number for most platforms
      const salesData = await db
        .select({
          quantitySold: sql<number>`COALESCE(SUM(${orderDetails.quantity}), 0)`,
          revenue: sql<number>`COALESCE(SUM(CAST(${orderDetails.unitPrice} AS DECIMAL) * ${orderDetails.quantity}), 0)`,
        })
        .from(orderDetails)
        .where(eq(orderDetails.sku, itemNo));

      // Build color variations array with warehouse locations
      const colors = inventoryLots.map(lot => {
        const location = warehouseLocations.find(loc => loc.inventoryId === lot.id);
        let warehouseLocation = null;
        if (location?.binName) {
          const parts = [];
          if (location.aisleName) parts.push(location.aisleName);
          if (location.shelfName) parts.push(location.shelfName);
          parts.push(location.binName);
          warehouseLocation = parts.join(' / ');
        }

        return {
          colorId: lot.colorId || 0,
          colorName: lot.colorName || 'Unknown',
          colorRgb: lot.colorRgb,
          quantity: lot.quantity || 0,
          condition: lot.newOrUsed || 'U',
          price: lot.unitPrice,
          warehouseLocation,
        };
      });

      // Calculate totals
      const totalQuantity = inventoryLots.reduce((sum, lot) => sum + (lot.quantity || 0), 0);
      const newQuantity = inventoryLots
        .filter(lot => lot.newOrUsed === 'N')
        .reduce((sum, lot) => sum + (lot.quantity || 0), 0);
      const usedQuantity = inventoryLots
        .filter(lot => lot.newOrUsed === 'U')
        .reduce((sum, lot) => sum + (lot.quantity || 0), 0);
      
      const colorCount = new Set(inventoryLots.map(lot => lot.colorId).filter(Boolean)).size;

      // Calculate price statistics
      const prices = inventoryLots
        .map(lot => parseFloat(lot.unitPrice || '0'))
        .filter(price => price > 0);
      
      const avgPrice = prices.length > 0 
        ? (prices.reduce((sum, price) => sum + price, 0) / prices.length).toFixed(3)
        : null;
      const minPrice = prices.length > 0 ? Math.min(...prices).toFixed(3) : null;
      const maxPrice = prices.length > 0 ? Math.max(...prices).toFixed(3) : null;

      // Calculate total value
      const totalValue = inventoryLots
        .reduce((sum, lot) => {
          const price = parseFloat(lot.unitPrice || '0');
          const qty = lot.quantity || 0;
          return sum + (price * qty);
        }, 0)
        .toFixed(2);

      const itemDetail = {
        itemNo,
        itemName: inventoryLots[0].itemName,
        categoryName: inventoryLots[0].categoryName,
        totalQuantity,
        newQuantity,
        usedQuantity,
        colorCount,
        avgPrice,
        minPrice,
        maxPrice,
        totalValue,
        quantitySold: Number(salesData[0]?.quantitySold || 0),
        revenue: Number(salesData[0]?.revenue || 0).toFixed(2),
        colors,
      };

      res.json(itemDetail);
    } catch (error) {
      console.error("Error fetching item details:", error);
      res.status(500).json({ error: "Failed to fetch item details" });
    }
  });

  // ============================================================================
  // FORUM NEWS ROUTES
  // ============================================================================

  // GET /api/forum/recent - Get recent forum posts for news notification
  app.get("/api/forum/recent", isApproved, async (req, res) => {
    try {
      const daysAgo = parseInt(req.query.days as string) || 7;
      const limit = parseInt(req.query.limit as string) || 10;
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
      
      const recentPosts = await db
        .select({
          id: blForumPosts.id,
          threadId: blForumPosts.threadId,
          title: blForumPosts.title,
          excerpt: blForumPosts.excerpt,
          username: blForumPosts.username,
          postedAt: blForumPosts.postedAt,
          postUrl: blForumPosts.postUrl,
          threadUrl: blForumPosts.threadUrl,
          hasReplies: blForumPosts.hasReplies,
        })
        .from(blForumPosts)
        .where(sql`${blForumPosts.postedAt} >= ${cutoffDate}`)
        .orderBy(sql`${blForumPosts.postedAt} DESC`)
        .limit(limit);
      
      res.json({
        success: true,
        count: recentPosts.length,
        posts: recentPosts,
        cutoffDate: cutoffDate.toISOString(),
      });
    } catch (error: any) {
      console.error("Error fetching recent forum posts:", error);
      res.status(500).json({ error: error.message || "Failed to fetch recent forum posts" });
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
