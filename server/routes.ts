import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { syncBricklinkData, fetchPriceOMagicData } from "./services/bricklink";
import { syncShipStationOrders } from "./services/shipstation";
import { db } from "./db";
import { orders, orderDetails, blInventory, blCategories, blColors, appSettings, insertAppSettingsSchema, conversations } from "@shared/schema";
import { eq, desc, sql, inArray, like, or, and } from "drizzle-orm";

export async function registerRoutes(app: Express): Promise<Server> {
  // Data Fetch Routes
  app.get("/api/orders", async (req, res) => {
    try {
      // Fetch all orders
      const allOrders = await db.select().from(orders).orderBy(desc(orders.orderDate));
      
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
      // Get total orders count
      const orderCount = await db.select({ count: sql<number>`count(*)` }).from(orders);
      
      // Get total inventory items count
      const inventoryCount = await db.select({ count: sql<number>`count(*)` }).from(blInventory);
      
      // Get total inventory quantity
      const inventoryQty = await db.select({ 
        total: sql<number>`sum(${blInventory.quantity})` 
      }).from(blInventory);
      
      // Get total sales from orders (guard against empty/null totals)
      const totalSales = await db.select({
        total: sql<number>`sum(case when ${orders.orderTotal} != '' and ${orders.orderTotal} is not null then cast(${orders.orderTotal} as decimal) else 0 end)`
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

      // Search inventory by part number, text query, or general inventory request
      const partNumberMatch = lastUserMessage.match(/\b(\d{4,5})\b/);
      
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
            // No category match - fall back to keyword search across multiple fields
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
        } else {
          // General inventory query
          inventoryResults = await db
            .select({
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

      // Price-O-Magic: Check for pricing queries
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
              console.log('💰 Price-O-Magic data added to context for:', item.itemNo);
            }
          }
        } catch (error) {
          console.error('💰 Error fetching Price-O-Magic data:', error);
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

Keep responses helpful, accurate, and based on the actual data provided.`;

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
      
      // Determine search type - prioritize part number, then keywords
      const partNumber = partNumberMatch ? partNumberMatch[1] : null;
      
      if (partNumber || searchKeywords.length > 0 || lastUserMessage.includes('part') || lastUserMessage.includes('inventory')) {
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
          // Search across ALL fields with OR conditions for each keyword
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

  // Price-O-Magic: Get price guide for inventory item (MUST be before /api/inventory/:id)
  app.get("/api/inventory/price-guide/:itemNo/:itemType", async (req, res) => {
    try {
      const { itemNo, itemType } = req.params;
      const colorId = req.query.color_id ? parseInt(req.query.color_id as string) : undefined;
      const premiumPercentage = req.query.premium ? parseInt(req.query.premium as string) : 15;

      if (!itemNo || !itemType) {
        return res.status(400).json({ error: "Item number and type are required" });
      }

      console.log(`[Price-O-Magic] Fetching price guide for ${itemType}/${itemNo}${colorId ? `/${colorId}` : ''}`);

      const priceData = await fetchPriceOMagicData(itemNo, itemType, colorId, premiumPercentage);

      res.json(priceData);
    } catch (error) {
      console.error("[Price-O-Magic] Error fetching price guide:", error);
      res.status(500).json({ 
        error: "Failed to fetch price guide", 
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
      const result = await syncShipStationOrders();
      res.json({
        success: true,
        data: result,
      });
    } catch (error) {
      console.error("ShipStation sync error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to sync ShipStation orders",
      });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
