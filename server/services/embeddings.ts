import OpenAI from 'openai';
import { db } from '../db';
import { inventoryEmbeddings, orderEmbeddings, blInventory, orders, appSettings } from '@shared/schema';
import { eq, sql } from 'drizzle-orm';

/**
 * Get OpenAI client with API key from settings or environment
 */
async function getOpenAIClient(): Promise<OpenAI> {
  // Try to get API key from settings first
  const settings = await db.query.appSettings.findFirst({
    where: eq(appSettings.id, 'default'),
  });
  
  const apiKey = settings?.openaiApiKey || process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    throw new Error('OpenAI API key not configured. Please add it in Settings.');
  }
  
  return new OpenAI({ apiKey });
}

/**
 * Generate an embedding vector for text using OpenAI
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const openai = await getOpenAIClient();
  
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  
  return response.data[0].embedding;
}

/**
 * Create searchable content from inventory item
 */
export function createInventoryContent(item: any): string {
  const parts = [
    `Item: ${item.itemNo}`,
    item.itemName ? `Name: ${item.itemName}` : '',
    item.itemType ? `Type: ${item.itemType}` : '',
    item.colorName ? `Color: ${item.colorName}` : '',
    item.description ? `Description: ${item.description}` : '',
    item.remarks ? `Remarks: ${item.remarks}` : '',
    `Condition: ${item.newOrUsed === 'N' ? 'New' : 'Used'}`,
    item.quantity ? `Quantity: ${item.quantity}` : '',
    item.unitPrice ? `Price: $${item.unitPrice}` : '',
  ];
  
  return parts.filter(Boolean).join('. ');
}

/**
 * Create searchable content from order
 */
export function createOrderContent(order: any, items?: any[]): string {
  const parts = [
    `Order: ${order.orderNumber}`,
    order.marketplace ? `Platform: ${order.marketplace}` : '',
    order.orderDate ? `Date: ${new Date(order.orderDate).toLocaleDateString()}` : '',
    order.orderStatus ? `Status: ${order.orderStatus}` : '',
    order.customerUsername ? `Customer: ${order.customerUsername}` : '',
    order.orderTotal ? `Total: $${order.orderTotal}` : '',
    order.shippingAmount ? `Shipping: $${order.shippingAmount}` : '',
    items ? `Items: ${items.map(i => i.name || i.sku).join(', ')}` : '',
  ];
  
  return parts.filter(Boolean).join('. ');
}

/**
 * Generate and store embedding for an inventory item
 */
export async function embedInventoryItem(inventoryId: number) {
  try {
    // Get inventory item
    const item = await db.query.blInventory.findFirst({
      where: eq(blInventory.id, inventoryId),
    });
    
    if (!item) {
      throw new Error(`Inventory item ${inventoryId} not found`);
    }
    
    // Create searchable content
    const content = createInventoryContent(item);
    
    // Generate embedding
    const embedding = await generateEmbedding(content);
    
    // Check if embedding already exists
    const existing = await db.query.inventoryEmbeddings.findFirst({
      where: eq(inventoryEmbeddings.inventoryId, inventoryId),
    });
    
    if (existing) {
      // Update existing
      await db
        .update(inventoryEmbeddings)
        .set({
          embedding: sql`${embedding}::vector`,
          content,
          updatedAt: new Date(),
        })
        .where(eq(inventoryEmbeddings.inventoryId, inventoryId));
    } else {
      // Insert new
      await db.insert(inventoryEmbeddings).values({
        inventoryId,
        embedding: sql`${embedding}::vector`,
        content,
      });
    }
    
    return { success: true, inventoryId };
  } catch (error: any) {
    console.error(`Error embedding inventory ${inventoryId}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Generate and store embedding for an order
 */
export async function embedOrder(orderId: string) {
  try {
    // Get order with items
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      with: { items: true },
    });
    
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }
    
    // Create searchable content
    const content = createOrderContent(order, order.items);
    
    // Generate embedding
    const embedding = await generateEmbedding(content);
    
    // Check if embedding already exists
    const existing = await db.query.orderEmbeddings.findFirst({
      where: eq(orderEmbeddings.orderId, orderId),
    });
    
    if (existing) {
      // Update existing
      await db
        .update(orderEmbeddings)
        .set({
          embedding: sql`${embedding}::vector`,
          content,
          updatedAt: new Date(),
        })
        .where(eq(orderEmbeddings.orderId, orderId));
    } else {
      // Insert new
      await db.insert(orderEmbeddings).values({
        orderId,
        embedding: sql`${embedding}::vector`,
        content,
      });
    }
    
    return { success: true, orderId };
  } catch (error: any) {
    console.error(`Error embedding order ${orderId}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Semantic search for inventory items
 */
export async function searchInventorySemantic(query: string, limit: number = 5) {
  try {
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);
    
    // Search using cosine similarity
    const results = await db.execute(sql`
      SELECT 
        ie.inventory_id,
        ie.content,
        bi.item_no,
        bi.item_name,
        bi.item_type,
        bi.color_name,
        bi.quantity,
        bi.unit_price,
        bi.new_or_used,
        1 - (ie.embedding <=> ${queryEmbedding}::vector) as similarity
      FROM inventory_embeddings ie
      JOIN bl_inventory bi ON ie.inventory_id = bi.id
      ORDER BY ie.embedding <=> ${queryEmbedding}::vector
      LIMIT ${limit}
    `);
    
    return results.rows;
  } catch (error: any) {
    console.error('Error in semantic search:', error);
    throw error;
  }
}

/**
 * Semantic search for orders
 */
export async function searchOrders(query: string, limit: number = 5) {
  try {
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);
    
    // Search using cosine similarity
    const results = await db.execute(sql`
      SELECT 
        oe.order_id,
        oe.content,
        o.order_number,
        o.marketplace,
        o.order_date,
        o.order_status,
        o.customer_username,
        o.order_total,
        1 - (oe.embedding <=> ${queryEmbedding}::vector) as similarity
      FROM order_embeddings oe
      JOIN orders o ON oe.order_id = o.id
      ORDER BY oe.embedding <=> ${queryEmbedding}::vector
      LIMIT ${limit}
    `);
    
    return results.rows;
  } catch (error: any) {
    console.error('Error in order search:', error);
    throw error;
  }
}

/**
 * Find similar inventory items to a given item
 */
export async function findSimilarItems(inventoryId: number, limit: number = 5) {
  try {
    const results = await db.execute(sql`
      SELECT 
        bi.id,
        bi.item_no,
        bi.item_name,
        bi.item_type,
        bi.color_name,
        bi.quantity,
        bi.unit_price,
        1 - (ie1.embedding <=> ie2.embedding) as similarity
      FROM inventory_embeddings ie1
      JOIN inventory_embeddings ie2 ON ie1.inventory_id = ${inventoryId}
      JOIN bl_inventory bi ON ie1.inventory_id = bi.id
      WHERE ie1.inventory_id != ${inventoryId}
      ORDER BY ie1.embedding <=> ie2.embedding
      LIMIT ${limit}
    `);
    
    return results.rows;
  } catch (error: any) {
    console.error('Error finding similar items:', error);
    throw error;
  }
}

/**
 * Batch embed inventory items
 */
export async function batchEmbedInventory(inventoryIds: number[]) {
  const results = [];
  
  for (const id of inventoryIds) {
    const result = await embedInventoryItem(id);
    results.push(result);
    
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return results;
}

/**
 * Batch embed orders
 */
export async function batchEmbedOrders(orderIds: string[]) {
  const results = [];
  
  for (const id of orderIds) {
    const result = await embedOrder(id);
    results.push(result);
    
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return results;
}

/**
 * Get embedding statistics
 */
export async function getEmbeddingStats() {
  const inventoryCount = await db.execute(sql`
    SELECT COUNT(*) as count FROM inventory_embeddings
  `);
  
  const orderCount = await db.execute(sql`
    SELECT COUNT(*) as count FROM order_embeddings
  `);
  
  const totalInventory = await db.execute(sql`
    SELECT COUNT(*) as count FROM bl_inventory
  `);
  
  const totalOrders = await db.execute(sql`
    SELECT COUNT(*) as count FROM orders
  `);
  
  const invCount = String((inventoryCount.rows[0] as any)?.count || '0');
  const totalInv = String((totalInventory.rows[0] as any)?.count || '0');
  const ordCount = String((orderCount.rows[0] as any)?.count || '0');
  const totalOrd = String((totalOrders.rows[0] as any)?.count || '0');
  
  return {
    inventory: {
      embedded: parseInt(invCount),
      total: parseInt(totalInv),
      percentage: parseInt(totalInv) > 0 
        ? ((parseInt(invCount) / parseInt(totalInv)) * 100).toFixed(1)
        : '0',
    },
    orders: {
      embedded: parseInt(ordCount),
      total: parseInt(totalOrd),
      percentage: parseInt(totalOrd) > 0
        ? ((parseInt(ordCount) / parseInt(totalOrd)) * 100).toFixed(1)
        : '0',
    },
  };
}
