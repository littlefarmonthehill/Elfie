import OpenAI from 'openai';
import { db } from '../db';
import { inventoryEmbeddings, orderEmbeddings, orderDetailEmbeddings, setPartEmbeddings, blInventory, orders, orderDetails, setPartRelationships, appSettings } from '@shared/schema';
import { eq, sql, inArray, and } from 'drizzle-orm';

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
 * Create searchable content from inventory item (ENRICHED with quantitative fields)
 */
export function createInventoryContent(item: any): string {
  const parts = [
    `Item: ${item.itemNo}`,
    item.itemName ? `Name: ${item.itemName}` : '',
    item.itemType ? `Type: ${item.itemType}` : '',
    item.categoryName ? `Category: ${item.categoryName}` : '',
    item.colorName ? `Color: ${item.colorName}` : '',
    item.description ? `Description: ${item.description}` : '',
    item.remarks ? `Remarks: ${item.remarks}` : '',
    `Condition: ${item.newOrUsed === 'N' ? 'New' : 'Used'}`,
    item.quantity ? `Quantity in stock: ${item.quantity}` : '',
    item.unitPrice ? `Base price: $${item.unitPrice}` : '',
    item.myCost ? `Cost: $${item.myCost}` : '',
    item.tierPrice1 && item.tierQuantity1 ? `Tier 1: ${item.tierQuantity1}+ at $${item.tierPrice1}` : '',
    item.tierPrice2 && item.tierQuantity2 ? `Tier 2: ${item.tierQuantity2}+ at $${item.tierPrice2}` : '',
    item.tierPrice3 && item.tierQuantity3 ? `Tier 3: ${item.tierQuantity3}+ at $${item.tierPrice3}` : '',
    item.myWeight ? `Weight: ${item.myWeight}g` : '',
    item.bulk ? `Bulk quantity: ${item.bulk}` : '',
    item.stockRoomId ? `Location: ${item.stockRoomId}` : '',
    item.dateCreated ? `Added: ${new Date(item.dateCreated).toLocaleDateString()}` : '',
  ];
  
  return parts.filter(Boolean).join('. ');
}

/**
 * Create searchable content from order (ENRICHED with order details and metrics)
 */
export function createOrderContent(order: any, items?: any[]): string {
  // Calculate order metrics from items if available
  let itemCount = 0;
  let totalQuantity = 0;
  let categories = new Set<string>();
  
  if (items && items.length > 0) {
    itemCount = items.length;
    totalQuantity = items.reduce((sum, item) => sum + (parseInt(item.quantity) || 0), 0);
    items.forEach(item => {
      if (item.categoryName) categories.add(item.categoryName);
    });
  }
  
  const parts = [
    `Order: ${order.orderNumber}`,
    order.marketplace ? `Platform: ${order.marketplace}` : '',
    order.orderDate ? `Date: ${new Date(order.orderDate).toLocaleDateString()}` : '',
    order.orderStatus ? `Status: ${order.orderStatus}` : '',
    order.customerUsername ? `Customer: ${order.customerUsername}` : '',
    order.orderTotal ? `Total: $${order.orderTotal}` : '',
    order.shippingAmount ? `Shipping: $${order.shippingAmount}` : '',
    order.salesTax ? `Tax: $${order.salesTax}` : '',
    order.paymentMethod ? `Payment: ${order.paymentMethod}` : '',
    itemCount > 0 ? `Line items: ${itemCount}` : '',
    totalQuantity > 0 ? `Total pieces: ${totalQuantity}` : '',
    categories.size > 0 ? `Categories: ${Array.from(categories).join(', ')}` : '',
    items ? `Products: ${items.map(i => i.name || i.sku).join(', ')}` : '',
  ];
  
  return parts.filter(Boolean).join('. ');
}

/**
 * Generate and store embedding for an inventory item
 */
export async function embedInventoryItem(inventoryId: number) {
  try {
    // Get inventory item with category
    const item = await db.query.blInventory.findFirst({
      where: eq(blInventory.id, inventoryId),
      with: {
        category: true,
      },
    });
    
    if (!item) {
      throw new Error(`Inventory item ${inventoryId} not found`);
    }
    
    // Flatten category name for embedding
    const enrichedItem = {
      ...item,
      categoryName: item.category?.name,
    };
    
    // Create searchable content
    const content = createInventoryContent(enrichedItem);
    
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
          embedding: sql.raw(`'${JSON.stringify(embedding)}'::vector`),
          content,
          updatedAt: new Date(),
        })
        .where(eq(inventoryEmbeddings.inventoryId, inventoryId));
    } else {
      // Insert new
      await db.insert(inventoryEmbeddings).values({
        inventoryId,
        embedding: sql.raw(`'${JSON.stringify(embedding)}'::vector`),
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
          embedding: sql.raw(`'${JSON.stringify(embedding)}'::vector`),
          content,
          updatedAt: new Date(),
        })
        .where(eq(orderEmbeddings.orderId, orderId));
    } else {
      // Insert new
      await db.insert(orderEmbeddings).values({
        orderId,
        embedding: sql.raw(`'${JSON.stringify(embedding)}'::vector`),
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
 * Create searchable content from order detail (line item) with inventory enrichment
 */
export function createOrderDetailContent(orderDetail: any, order?: any, inventoryItem?: any): string {
  const parts = [
    `SKU: ${orderDetail.sku}`,
    orderDetail.name ? `Item: ${orderDetail.name}` : '',
    inventoryItem?.categoryName || orderDetail.categoryName ? `Category: ${inventoryItem?.categoryName || orderDetail.categoryName}` : '',
    inventoryItem?.colorName || orderDetail.colorName ? `Color: ${inventoryItem?.colorName || orderDetail.colorName}` : '',
    orderDetail.quantity ? `Quantity sold: ${orderDetail.quantity}` : '',
    orderDetail.unitPrice ? `Price: $${orderDetail.unitPrice}` : '',
    orderDetail.condition ? `Condition: ${orderDetail.condition}` : '',
    order?.orderDate ? `Sale date: ${new Date(order.orderDate).toLocaleDateString()}` : '',
    order?.marketplace ? `Platform: ${order.marketplace}` : '',
    order?.customerUsername ? `Customer: ${order.customerUsername}` : '',
  ];
  
  return parts.filter(Boolean).join('. ');
}

/**
 * Generate and store embedding for an order detail (line item)
 */
export async function embedOrderDetail(orderDetailId: string) {
  try {
    // Get order detail with its parent order
    const orderDetail = await db.query.orderDetails.findFirst({
      where: eq(orderDetails.id, orderDetailId),
      with: { order: true },
    });
    
    if (!orderDetail) {
      throw new Error(`Order detail ${orderDetailId} not found`);
    }
    
    // Try to enrich with inventory data (category/color) by matching SKU
    // SKU is now standardized to BrickLink inventory ID
    let inventoryItem = null;
    if (orderDetail.sku) {
      const inventoryId = parseInt(orderDetail.sku, 10);
      
      if (!isNaN(inventoryId)) {
        // Look up in inventory by ID with category relation
        const foundItem = await db.query.blInventory.findFirst({
          where: eq(blInventory.id, inventoryId),
          with: { category: true },
        });
        
        if (foundItem) {
          inventoryItem = {
            ...foundItem,
            categoryName: foundItem.category?.name,
          };
        }
      }
    }
    
    // Create searchable content
    const content = createOrderDetailContent(orderDetail, orderDetail.order, inventoryItem);
    
    // Generate embedding
    const embedding = await generateEmbedding(content);
    
    // Check if embedding already exists
    const existing = await db.query.orderDetailEmbeddings.findFirst({
      where: eq(orderDetailEmbeddings.orderDetailId, orderDetailId),
    });
    
    if (existing) {
      // Update existing
      await db
        .update(orderDetailEmbeddings)
        .set({
          embedding: sql.raw(`'${JSON.stringify(embedding)}'::vector`),
          content,
          updatedAt: new Date(),
        })
        .where(eq(orderDetailEmbeddings.orderDetailId, orderDetailId));
    } else {
      // Insert new
      await db.insert(orderDetailEmbeddings).values({
        orderDetailId,
        embedding: sql.raw(`'${JSON.stringify(embedding)}'::vector`),
        content,
      });
    }
    
    return { success: true, orderDetailId };
  } catch (error: any) {
    console.error(`Error embedding order detail ${orderDetailId}:`, error);
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
    const results = await db.execute(sql.raw(`
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
        1 - (ie.embedding <=> '${JSON.stringify(queryEmbedding)}'::vector) as similarity
      FROM inventory_embeddings ie
      JOIN bl_inventory bi ON ie.inventory_id = bi.id
      ORDER BY ie.embedding <=> '${JSON.stringify(queryEmbedding)}'::vector
      LIMIT ${limit}
    `));
    
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
    const results = await db.execute(sql.raw(`
      SELECT 
        oe.order_id,
        oe.content,
        o.order_number,
        o.marketplace,
        o.order_date,
        o.order_status,
        o.customer_username,
        o.order_total,
        1 - (oe.embedding <=> '${JSON.stringify(queryEmbedding)}'::vector) as similarity
      FROM order_embeddings oe
      JOIN orders o ON oe.order_id = o.id
      ORDER BY oe.embedding <=> '${JSON.stringify(queryEmbedding)}'::vector
      LIMIT ${limit}
    `));
    
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
 * Batch embed order details for given orders
 */
export async function batchEmbedOrderDetails(orderIds: string[]) {
  const results = [];
  
  // Get all order detail IDs for these orders
  const orderDetailRecords = await db
    .select({ id: orderDetails.id })
    .from(orderDetails)
    .where(sql`${orderDetails.orderId} IN (${sql.join(orderIds.map(id => sql`${id}`), sql`, `)})`);
  
  console.log(`  📋 Found ${orderDetailRecords.length} order details to embed`);
  
  for (const record of orderDetailRecords) {
    const result = await embedOrderDetail(record.id);
    results.push(result);
    
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return results;
}

/**
 * Create searchable content from set-part relationships
 */
export function createSetPartContent(setNum: string, setName: string, parts: any[]): string {
  const partsList = parts.map(p => 
    `${p.partNum} (Color: ${p.colorId}, Qty: ${p.quantity})`
  ).join(', ');
  
  return `Set: ${setNum}. Name: ${setName}. Contains ${parts.length} unique parts: ${partsList}`;
}

/**
 * Generate and store embedding for a LEGO set with all its parts
 */
export async function embedSet(setNum: string) {
  try {
    // Get all parts for this set
    const parts = await db
      .select()
      .from(setPartRelationships)
      .where(eq(setPartRelationships.setNum, setNum));
    
    if (parts.length === 0) {
      console.log(`No parts found for set ${setNum}`);
      return { success: false, error: 'No parts found' };
    }
    
    const setName = parts[0]?.setName || setNum;
    
    // Create searchable content
    const content = createSetPartContent(setNum, setName, parts);
    
    // Generate embedding
    const embedding = await generateEmbedding(content);
    
    // Check if embedding already exists
    const existing = await db.query.setPartEmbeddings.findFirst({
      where: eq(setPartEmbeddings.setNum, setNum),
    });
    
    if (existing) {
      // Update existing
      await db
        .update(setPartEmbeddings)
        .set({
          embedding: sql.raw(`'${JSON.stringify(embedding)}'::vector`),
          content,
          updatedAt: new Date(),
        })
        .where(eq(setPartEmbeddings.setNum, setNum));
    } else {
      // Insert new
      await db.insert(setPartEmbeddings).values({
        setNum,
        embedding: sql.raw(`'${JSON.stringify(embedding)}'::vector`),
        content,
      });
    }
    
    return { success: true, setNum };
  } catch (error: any) {
    console.error(`Error embedding set ${setNum}:`, error);
    return { success: false, error: error.message };
  }
}

/**
 * Batch embed all sets
 */
export async function batchEmbedSets(setNumbers?: string[]) {
  const results = [];
  
  // Get unique set numbers if not provided
  if (!setNumbers) {
    const sets = await db
      .selectDistinct({ setNum: setPartRelationships.setNum })
      .from(setPartRelationships);
    setNumbers = sets.map(s => s.setNum);
  }
  
  console.log(`Embedding ${setNumbers.length} sets...`);
  
  for (const setNum of setNumbers) {
    const result = await embedSet(setNum);
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
  const [
    inventoryCount,
    orderCount,
    setPartCount,
    totalInventory,
    totalOrders,
    totalSets,
    priceSnapshots,
    aiMemories,
  ] = await Promise.all([
    db.execute(sql`SELECT COUNT(*) as count FROM inventory_embeddings`),
    db.execute(sql`SELECT COUNT(*) as count FROM order_embeddings`),
    db.execute(sql`SELECT COUNT(*) as count FROM set_part_embeddings`),
    db.execute(sql`SELECT COUNT(*) as count FROM bl_inventory`),
    db.execute(sql`SELECT COUNT(*) as count FROM orders`),
    db.execute(sql`SELECT COUNT(DISTINCT set_num) as count FROM set_part_relationships`),
    db.execute(sql`SELECT COUNT(*) as count FROM part_price_history`),
    db.execute(sql`SELECT COUNT(*) as count FROM conversations`),
  ]);

  const invCount  = parseInt(String((inventoryCount.rows[0]  as any)?.count || '0'));
  const totalInv  = parseInt(String((totalInventory.rows[0]  as any)?.count || '0'));
  const ordCount  = parseInt(String((orderCount.rows[0]      as any)?.count || '0'));
  const totalOrd  = parseInt(String((totalOrders.rows[0]     as any)?.count || '0'));
  const setCount  = parseInt(String((setPartCount.rows[0]    as any)?.count || '0'));
  const totalSet  = parseInt(String((totalSets.rows[0]       as any)?.count || '0'));
  const priceSnap = parseInt(String((priceSnapshots.rows[0]  as any)?.count || '0'));
  const memories  = parseInt(String((aiMemories.rows[0]      as any)?.count || '0'));

  const pct = (n: number, d: number) => d > 0 ? ((n / d) * 100).toFixed(1) : '0';

  return {
    inventory: { embedded: invCount, total: totalInv, percentage: pct(invCount, totalInv) },
    orders:    { embedded: ordCount, total: totalOrd, percentage: pct(ordCount, totalOrd) },
    sets:      { embedded: setCount, total: totalSet, percentage: pct(setCount, totalSet) },
    priceHistory: { snapshots: priceSnap },
    aiMemories:   { conversations: memories },
  };
}
