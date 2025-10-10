import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { syncBricklinkData } from "./services/bricklink";
import { syncShipStationOrders } from "./services/shipstation";
import { db } from "./db";
import { orders, orderDetails, blInventory, blCategories, blColors, appSettings, insertAppSettingsSchema } from "@shared/schema";
import { eq, desc, sql, inArray, like } from "drizzle-orm";

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
      
      // Get total sales from orders
      const totalSales = await db.select({
        total: sql<number>`sum(cast(${orders.orderTotal} as decimal))`
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

      // Query database for relevant data based on user's question
      const lastUserMessage = messages[messages.length - 1]?.content?.toLowerCase() || '';
      console.log('🔍 Backend received user message:', lastUserMessage);
      console.log('🔍 Full message content:', messages[messages.length - 1]?.content);
      let databaseContext = '';

      // Search inventory by part number or item number
      const partNumberMatch = lastUserMessage.match(/\b(\d{4,5})\b/);
      if (partNumberMatch || lastUserMessage.includes('part') || lastUserMessage.includes('inventory')) {
        const partNumber = partNumberMatch ? partNumberMatch[1] : null;
        
        // Build query - apply where before joins
        let inventoryResults;
        if (partNumber) {
          inventoryResults = await db
            .select({
              itemNo: blInventory.itemNo,
              itemType: blInventory.itemType,
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
        } else {
          inventoryResults = await db
            .select({
              itemNo: blInventory.itemNo,
              itemType: blInventory.itemType,
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
        
        console.log('🔍 Inventory query returned', inventoryResults.length, 'results for part number:', partNumber);
        if (inventoryResults.length > 0) {
          databaseContext += `\n\nINVENTORY DATA FROM DATABASE:\n`;
          inventoryResults.forEach(item => {
            databaseContext += `- Part ${item.itemNo} (${item.itemType}): ${item.quantity} units`;
            if (item.colorName) databaseContext += ` in ${item.colorName}`;
            if (item.categoryName) databaseContext += ` [${item.categoryName}]`;
            if (item.unitPrice) databaseContext += ` @ $${item.unitPrice} each`;
            databaseContext += ` (${item.newOrUsed})\n`;
          });
          console.log('🔍 Database context length:', databaseContext.length);
        } else if (partNumber) {
          databaseContext += `\n\nINVENTORY SEARCH: No items found for part ${partNumber} in database.\n`;
          console.log('🔍 No inventory found for part:', partNumber);
        }
      }

      // Search orders
      if (lastUserMessage.includes('order')) {
        const ordersResults = await db
          .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            customerUsername: orders.customerUsername,
            orderDate: orders.orderDate,
            orderTotal: orders.orderTotal,
            orderStatus: orders.orderStatus,
          })
          .from(orders)
          .limit(20)
          .orderBy(desc(orders.orderDate));
        
        if (ordersResults.length > 0) {
          databaseContext += `\n\nRECENT ORDERS FROM DATABASE:\n`;
          
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
        }
      }

      // Use custom system prompt if provided, otherwise use default
      const defaultSystemPrompt = `You are E.L.F.I.E. (Expert LEGO Fulfillment & Inventory Engine), an AI assistant for LEGO business operations with DIRECT DATABASE ACCESS.

Current context: ${context}
${databaseContext}

CRITICAL: You HAVE database access and real data is provided above. Use this data to answer questions accurately.

RESPONSE GUIDELINES:
1. When database data is provided, use it to give specific answers
2. Always include BrickLink links for parts: https://www.bricklink.com/v2/catalog/catalogitem.page?P=<partNumber>
3. If no data found, explain what you searched and suggest alternatives
4. Be direct and concise (under 5 sentences)
5. Provide actionable information

EXAMPLES:

User: "Do I have part 3021?"
With data: "Yes! You have 3 listings for part 3021: 50 units in Red @ $0.25 each (New), 30 units in Blue @ $0.20 each (New), and 10 units in Yellow @ $0.30 each (Used). View on BrickLink: https://www.bricklink.com/v2/catalog/catalogitem.page?P=3021"
Without data: "I don't see part 3021 in your current inventory. You may need to sync your BrickLink data or check if it's listed under a different number. BrickLink page: https://www.bricklink.com/v2/catalog/catalogitem.page?P=3021"

User: "How many orders do I have?"
With data: "You have 15 recent orders. Most recent: Order #12345 from JohnDoe ($45.50, shipped) on Jan 15, 2025. You can view all orders in your Orders dashboard."

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
      res.json({
        message: data.choices[0].message.content,
      });
    } catch (error) {
      console.error("Chat error:", error);
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

  // Get Inventory Stats
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
