import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { syncBricklinkData, fetchPriceOMagicData, searchBricklinkCatalogItem, syncPriceOMagicCache } from "./services/bricklink";
import { syncShipStationOrders } from "./services/shipstation";
import { db } from "./db";
import { orders, orderDetails, blInventory, blCategories, blColors, appSettings, insertAppSettingsSchema, conversations, syncMetadata, inventoryEmbeddings, orderEmbeddings } from "@shared/schema";
import { eq, desc, sql, inArray, like, or, and } from "drizzle-orm";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // Data Fetch Routes
  app.get("/api/orders", async (req, res) => {
    try {
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
        }
      }

      // Fetch orders with optional date filter
      const allOrders = dateFilter
        ? await db.select().from(orders)
            .where(sql`${orders.orderDate} >= ${dateFilter.toISOString()}`)
            .orderBy(desc(orders.orderDate))
        : await db.select().from(orders).orderBy(desc(orders.orderDate));
      
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
      
      res.json(ordersWithDetails);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // Fetch single order by ID with full details
  app.get("/api/orders/:id", async (req, res) => {
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

  app.get("/api/dashboard/stats", async (req, res) => {
    try {
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
        }
      }

      // Get total orders count with date filter
      const orderCount = dateFilter
        ? await db.select({ count: sql<number>`count(*)` }).from(orders)
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
        ? await db.select({
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
  app.get("/api/settings", async (req, res) => {
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
            openrouterApiKey: process.env.OPENROUTER_API_KEY || null,
            selectedModel: 'openai/gpt-4o-mini',
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

  app.post("/api/settings", async (req, res) => {
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

  // OpenRouter Models Route
  app.post("/api/openrouter/models", async (req, res) => {
    try {
      const { apiKey } = req.body;
      
      if (!apiKey) {
        return res.status(400).json({ error: "API key required" });
      }

      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.statusText}`);
      }

      const data = await response.json();
      
      // Format models for the UI
      const models = data.data.map((model: any) => ({
        id: model.id,
        name: model.name || model.id,
      }));

      res.json({ models });
    } catch (error) {
      console.error("Error fetching models:", error);
      res.status(500).json({ error: "Failed to fetch models" });
    }
  });

  // E.L.F.I.E. Chat Route
  app.post("/api/chat", async (req, res) => {
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

      const apiKey = settings?.openrouterApiKey || process.env.OPENROUTER_API_KEY;
      const model = settings?.selectedModel || 'openai/gpt-4o-mini';
      
      if (!apiKey) {
        return res.status(400).json({
          error: "OpenRouter API key not configured",
          message: "Please configure your OpenRouter API key in Settings.",
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
          
          // Get inventory item details to extract itemType and colorId
          const inventoryItem = await db
            .select({
              itemNo: blInventory.itemNo,
              itemType: blInventory.itemType,
              colorId: blInventory.colorId,
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
      const defaultSystemPrompt = `You are E.L.F.I.E. (Expert LEGO Fulfillment & Inventory Engine), an AI assistant for LEGO business operations with DIRECT DATABASE ACCESS.

Current context: ${context}
${databaseContext}
${historyContext}

CRITICAL: You HAVE database access and real data is provided above. Use this data to answer questions accurately.

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

      const systemPrompt = settings?.systemPrompt 
        ? `${settings.systemPrompt}\n\nCurrent context: ${context}\n${databaseContext}` 
        : defaultSystemPrompt;

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://planetbrick.replit.app',
          'X-Title': 'PlanetBrick',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages
          ],
          temperature: 0.7,
          max_tokens: 500,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenRouter API error: ${response.statusText}`);
      }

      const data = await response.json();
      
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
      
      // Re-extract items for frontend display using same search criteria
      // This ensures items shown to user match what AI is describing
      const partNumber = partNumberMatch ? partNumberMatch[1] : null;
      
      if (partNumber || searchKeywords.length > 0) {
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
      
      const assistantMessage = data.choices[0].message.content;

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
        sessionId, // Return session ID for client to use
        bricklinkSearchSuggestion, // Return suggestion if item not found (frontend will render as button)
      });
    } catch (error) {
      console.error("Chat error:", error);
      if (error instanceof Error) {
        console.error("Error stack:", error.stack);
      }
      res.status(500).json({
        error: "Failed to generate response",
        message: "I'm having trouble connecting right now. Please try again.",
      });
    }
  });

  // Semantic Search - Inventory
  app.post("/api/search/inventory/semantic", async (req, res) => {
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
  app.post("/api/search/orders/semantic", async (req, res) => {
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
  app.get("/api/inventory/:id/similar", async (req, res) => {
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

  // Batch Embed Inventory Items
  app.post("/api/embeddings/inventory/batch", async (req, res) => {
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
  app.post("/api/embeddings/inventory/:id", async (req, res) => {
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
  app.get("/api/embeddings/stats", async (req, res) => {
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
  app.get("/api/embeddings/inventory/missing", async (req, res) => {
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
  app.get("/api/embeddings/orders/missing", async (req, res) => {
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
  app.post("/api/embeddings/orders/batch", async (req, res) => {
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
  
  // Start background embedding job
  app.post("/api/embeddings/jobs/start", async (req, res) => {
    try {
      // Validate input
      const validated = startJobSchema.parse(req.body);
      
      const { jobManager } = await import('./services/backgroundJobs');
      const jobId = await jobManager.startEmbeddingJob(validated.type, validated.batchSize);
      
      res.json({ jobId, message: 'Background job started' });
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
  app.post("/api/embeddings/jobs/:jobId/stop", async (req, res) => {
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
  app.get("/api/embeddings/jobs/:jobId", async (req, res) => {
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

  // Get active job for a type
  app.get("/api/embeddings/jobs/active/:type", async (req, res) => {
    try {
      const { type } = req.params;
      
      if (!type || !['inventory', 'orders'].includes(type)) {
        return res.status(400).json({ error: "Invalid job type. Must be 'inventory' or 'orders'" });
      }
      
      const { jobManager } = await import('./services/backgroundJobs');
      const job = jobManager.getActiveJob(type as 'inventory' | 'orders');
      
      res.json(job || null);
    } catch (error) {
      console.error("Get active job error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get active job" 
      });
    }
  });

  // Get all jobs
  app.get("/api/embeddings/jobs", async (req, res) => {
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
  app.get("/api/bricklink/search", async (req, res) => {
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

  // Get Inventory Items
  app.get("/api/inventory", async (req, res) => {
    try {
      const inventoryItems = await db
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
  app.get("/api/inventory/stats", async (req, res) => {
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

  // Get Recently Updated/Added Inventory Items (MUST be before /api/inventory/:id)
  app.get("/api/inventory/recent-updates", async (req, res) => {
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
  app.get("/api/inventory/price-guide/:itemNo/:itemType", async (req, res) => {
    try {
      const { itemNo, itemType } = req.params;
      const colorId = req.query.color_id ? parseInt(req.query.color_id as string) : undefined;
      const premiumPercentage = req.query.premium ? parseInt(req.query.premium as string) : 15;

      if (!itemNo || !itemType) {
        return res.status(400).json({ error: "Item number and type are required" });
      }

      console.log(`[Price-o-Matic] Fetching price guide for ${itemType}/${itemNo}${colorId ? `/${colorId}` : ''}`);

      const priceData = await fetchPriceOMagicData(itemNo, itemType, colorId, premiumPercentage);

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
  app.get("/api/bricklink/catalog/:itemNo/:itemType", async (req, res) => {
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
  app.get("/api/inventory/:id", async (req, res) => {
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
  app.get("/api/inventory/:id/analytics", async (req, res) => {
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
  app.get("/api/bricklink/rate-limit", async (req, res) => {
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
  app.post("/api/sync/bricklink/inventory", async (req, res) => {
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

  app.post("/api/sync/shipstation/orders", async (req, res) => {
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

  // Marketplace diagnostic endpoint
  app.get("/api/orders/marketplace-diagnostic", async (req, res) => {
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
  app.post("/api/sync/priceomatic", async (req, res) => {
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
  app.get("/api/sync/priceomatic/status", async (req, res) => {
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
  app.get("/api/priceomatic/insights", async (req, res) => {
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

  const httpServer = createServer(app);

  return httpServer;
}
