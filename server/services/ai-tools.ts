/**
 * AI Tools for E.L.F.I.E.
 * Safe backend functions that the AI assistant can call
 */

import { db } from '../db';
import { blInventory, blColors, blCategories, orders, orderDetails, setPartRelationships, inventoryEmbeddings, blForumPosts, blForumEmbeddings } from '@shared/schema';
import { eq, like, or, sql, and, desc, inArray } from 'drizzle-orm';
import { searchBricklinkCatalogItem, fetchPriceOMagicData } from './bricklink';
import { generateEmbedding, createInventoryContent } from './embeddings';
import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Tool: Search BrickLink catalog for items NOT in local inventory
 */
export async function searchBrickLinkCatalog(params: {
  itemNo: string;
  itemType?: 'PART' | 'SET' | 'MINIFIG';
}) {
  const { itemNo, itemType = 'PART' } = params;
  
  try {
    const result = await searchBricklinkCatalogItem(itemNo, itemType);
    
    if (!result) {
      return {
        success: false,
        message: `Part ${itemNo} not found in BrickLink catalog`,
      };
    }
    
    return {
      success: true,
      data: {
        itemNo: result.no,
        name: result.name,
        type: result.type,
        categoryId: result.category_id,
        thumbnailUrl: result.thumbnail_url,
        imageUrl: result.image_url,
        weight: result.weight,
        dimensionX: result.dim_x,
        dimensionY: result.dim_y,
        dimensionZ: result.dim_z,
        bricklinkUrl: `https://www.bricklink.com/v2/catalog/catalogitem.page?${itemType[0]}=${itemNo}`,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Failed to search BrickLink catalog',
    };
  }
}

/**
 * Tool: Get price guide data for any item
 */
export async function getBrickLinkPriceGuide(params: {
  itemNo: string;
  itemType?: 'PART' | 'SET' | 'MINIFIG';
  colorId?: number;
  newOrUsed?: 'N' | 'U';
  premiumPercentage?: number;
}) {
  const { itemNo, itemType = 'PART', colorId, newOrUsed = 'N', premiumPercentage = 15 } = params;
  
  try {
    const priceData = await fetchPriceOMagicData(itemNo, itemType, colorId, newOrUsed, premiumPercentage);
    
    if (!priceData) {
      return {
        success: false,
        message: `No price data available for ${itemNo}`,
      };
    }
    
    return {
      success: true,
      data: {
        itemNo: priceData.itemNo,
        itemName: priceData.itemName,
        stockAvgPrice: priceData.stockAvgPrice,
        stockMinPrice: priceData.stockMinPrice,
        stockMaxPrice: priceData.stockMaxPrice,
        stockTotalLots: priceData.stockTotalLots,
        soldAvgPrice: priceData.soldAvgPrice,
        soldMinPrice: priceData.soldMinPrice,
        soldMaxPrice: priceData.soldMaxPrice,
        soldTotalLots: priceData.soldTotalLots,
        suggestedPrice: priceData.suggestedPrice,
        premiumPercentage: priceData.premiumPercentage,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Failed to get price guide data',
    };
  }
}

/**
 * Tool: Search local inventory with enhanced capabilities
 */
export async function searchLocalInventory(params: {
  query?: string;
  itemNo?: string;
  colorName?: string;
  category?: string;
  minQuantity?: number;
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
}) {
  const {
    query,
    itemNo,
    colorName,
    category,
    minQuantity,
    minPrice,
    maxPrice,
    limit = 20,
  } = params;
  
  try {
    let queryBuilder = db
      .select({
        id: blInventory.id,
        itemNo: blInventory.itemNo,
        itemType: blInventory.itemType,
        itemName: blInventory.itemName,
        colorName: blColors.name,
        colorRgb: blColors.rgb,
        categoryName: blCategories.name,
        quantity: blInventory.quantity,
        unitPrice: blInventory.unitPrice,
        newOrUsed: blInventory.newOrUsed,
        remarks: blInventory.remarks,
      })
      .from(blInventory)
      .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
      .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id));
    
    const conditions: any[] = [];
    
    // Part number search
    if (itemNo) {
      conditions.push(like(blInventory.itemNo, `%${itemNo}%`));
    }
    
    // Color filter
    if (colorName) {
      conditions.push(like(blColors.name, `%${colorName}%`));
    }
    
    // Category filter
    if (category) {
      conditions.push(like(blCategories.name, `%${category}%`));
    }
    
    // Quantity filter
    if (minQuantity !== undefined) {
      conditions.push(sql`${blInventory.quantity} >= ${minQuantity}`);
    }
    
    // Price filters
    if (minPrice !== undefined) {
      conditions.push(sql`CAST(${blInventory.unitPrice} AS DECIMAL) >= ${minPrice}`);
    }
    if (maxPrice !== undefined) {
      conditions.push(sql`CAST(${blInventory.unitPrice} AS DECIMAL) <= ${maxPrice}`);
    }
    
    // General text search
    if (query && !itemNo) {
      conditions.push(
        or(
          like(blInventory.itemNo, `%${query}%`),
          like(blInventory.itemName, `%${query}%`),
          like(blInventory.description, `%${query}%`),
          like(blInventory.remarks, `%${query}%`)
        )
      );
    }
    
    if (conditions.length > 0) {
      queryBuilder = queryBuilder.where(and(...conditions)) as any;
    }
    
    const results = await queryBuilder.limit(limit);
    
    return {
      success: true,
      data: results,
      count: results.length,
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Failed to search inventory',
    };
  }
}

/**
 * Tool: Get inventory statistics and analytics
 */
export async function getInventoryStats(params?: {
  category?: string;
  colorName?: string;
}) {
  const { category, colorName } = params || {};
  
  try {
    let conditions: any[] = [];
    
    if (category) {
      conditions.push(like(blCategories.name, `%${category}%`));
    }
    if (colorName) {
      conditions.push(like(blColors.name, `%${colorName}%`));
    }
    
    let queryBuilder = db
      .select({
        totalLots: sql<number>`COUNT(*)`,
        totalParts: sql<number>`SUM(${blInventory.quantity})`,
        totalValue: sql<number>`SUM(${blInventory.quantity} * CAST(${blInventory.unitPrice} AS DECIMAL))`,
      })
      .from(blInventory)
      .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
      .leftJoin(blCategories, eq(blInventory.categoryId, blCategories.id));
    
    if (conditions.length > 0) {
      queryBuilder = queryBuilder.where(and(...conditions)) as any;
    }
    
    const stats = await queryBuilder;
    
    return {
      success: true,
      data: {
        totalLots: Number(stats[0]?.totalLots) || 0,
        totalParts: Number(stats[0]?.totalParts) || 0,
        totalValue: Number(stats[0]?.totalValue) || 0,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Failed to get inventory stats',
    };
  }
}

/**
 * Tool: Get order analytics
 */
export async function getOrderAnalytics(params?: {
  marketplace?: string;
  customerUsername?: string;
  startDate?: string;
  endDate?: string;
}) {
  const { marketplace, customerUsername, startDate, endDate } = params || {};
  
  try {
    const conditions: any[] = [];
    
    if (marketplace) {
      conditions.push(eq(orders.marketplace, marketplace));
    }
    if (customerUsername) {
      conditions.push(like(orders.customerUsername, `%${customerUsername}%`));
    }
    if (startDate) {
      conditions.push(sql`${orders.orderDate} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${orders.orderDate} <= ${endDate}`);
    }
    
    let queryBuilder = db
      .select({
        totalOrders: sql<number>`COUNT(*)`,
        totalRevenue: sql<number>`SUM(CASE WHEN ${orders.orderTotal} != '' AND ${orders.orderTotal} IS NOT NULL THEN CAST(${orders.orderTotal} AS DECIMAL) ELSE 0 END)`,
        avgOrderValue: sql<number>`AVG(CASE WHEN ${orders.orderTotal} != '' AND ${orders.orderTotal} IS NOT NULL THEN CAST(${orders.orderTotal} AS DECIMAL) ELSE 0 END)`,
      })
      .from(orders);
    
    if (conditions.length > 0) {
      queryBuilder = queryBuilder.where(and(...conditions)) as any;
    }
    
    const stats = await queryBuilder;
    
    return {
      success: true,
      data: {
        totalOrders: Number(stats[0]?.totalOrders) || 0,
        totalRevenue: Number(stats[0]?.totalRevenue) || 0,
        avgOrderValue: Number(stats[0]?.avgOrderValue) || 0,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Failed to get order analytics',
    };
  }
}

/**
 * Tool: Get parts in a LEGO set with quantities
 */
export async function getSetParts(params: {
  setNum: string;
}) {
  const { setNum } = params;
  
  try {
    // Query set-part relationships for this set (no limit - return complete parts list)
    const parts = await db
      .select({
        partNum: setPartRelationships.partNum,
        colorId: setPartRelationships.colorId,
        quantity: setPartRelationships.quantity,
        setName: setPartRelationships.setName,
      })
      .from(setPartRelationships)
      .where(eq(setPartRelationships.setNum, setNum));
    
    if (parts.length === 0) {
      return {
        success: false,
        message: `No parts found for set ${setNum}. This set may not be in the Rebrickable database.`,
      };
    }
    
    // Get color names for the parts (only if there are colorIds)
    const colorIds = Array.from(new Set(parts.map(p => p.colorId).filter(id => id !== null)));
    let colorMap = new Map<number, string>();
    
    if (colorIds.length > 0) {
      const colors = await db
        .select({
          id: blColors.id,
          name: blColors.name,
        })
        .from(blColors)
        .where(sql`${blColors.id} IN (${sql.join(colorIds.map(id => sql`${id}`), sql`, `)})`);
      
      colorMap = new Map(colors.map(c => [c.id, c.name]));
    }
    
    // Enrich parts with color names
    const enrichedParts = parts.map(part => ({
      partNum: part.partNum,
      colorId: part.colorId,
      colorName: part.colorId ? colorMap.get(part.colorId) || 'Unknown' : 'N/A',
      quantity: part.quantity,
    }));
    
    return {
      success: true,
      data: {
        setNum,
        setName: parts[0].setName,
        parts: enrichedParts,
        totalParts: enrichedParts.reduce((sum, p) => sum + p.quantity, 0),
        uniqueParts: enrichedParts.length,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Failed to get set parts',
    };
  }
}

/**
 * Tool: Search the web for information
 */
export async function searchWeb(params: {
  query: string;
}) {
  const { query } = params;
  
  try {
    // Use DuckDuckGo's HTML search (no API key required)
    const response = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 15000, // 15 second timeout
    });
    
    // Use cheerio to parse HTML
    const $ = cheerio.load(response.data);
    const results: Array<{
      title: string;
      snippet: string;
      url: string;
    }> = [];
    
    // Extract search result items
    $('.result').each((index, element) => {
      if (index >= 5) return false; // Limit to 5 results
      
      const $elem = $(element);
      
      // Extract title and URL from the result title link
      const titleLink = $elem.find('.result__a');
      const title = titleLink.text().trim();
      let rawUrl = titleLink.attr('href') || '';
      
      // DuckDuckGo wraps URLs in redirect format: /l/?uddg=<encoded_url>&...
      // Need to extract the uddg parameter which contains the actual destination URL
      let url = '';
      if (rawUrl.includes('uddg=')) {
        try {
          // Parse the uddg parameter from the redirect URL
          const urlParams = new URLSearchParams(rawUrl.split('?')[1] || '');
          const uddg = urlParams.get('uddg');
          if (uddg) {
            url = decodeURIComponent(uddg);
          }
        } catch (error) {
          console.error('Failed to parse DuckDuckGo redirect URL:', rawUrl);
        }
      } else {
        // Direct URL (rare but possible)
        url = rawUrl;
      }
      
      // Ensure URL has protocol
      if (url && !url.startsWith('http')) {
        url = 'https://' + url.replace(/^\/+/, '');
      }
      
      // Extract snippet (try multiple selectors for robustness)
      let snippet = $elem.find('.result__snippet').text().trim();
      if (!snippet) {
        snippet = $elem.find('.result__snippet span').text().trim();
      }
      if (!snippet) {
        snippet = $elem.find('.result__extras').text().trim();
      }
      
      // Only add if we have valid data (title, URL, and not a duckduckgo.com link)
      if (title && url && url.startsWith('http') && !url.includes('duckduckgo.com')) {
        results.push({ title, snippet: snippet || 'No description available', url });
      }
    });
    
    if (results.length === 0) {
      return {
        success: false,
        message: `No results found for: ${query}. Try a different search query.`,
      };
    }
    
    return {
      success: true,
      data: {
        query,
        results,
        summary: `Found ${results.length} results for "${query}". ${results.map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`).join(' ')}`,
      },
    };
  } catch (error: any) {
    console.error('❌ Web search error:', error);
    return {
      success: false,
      message: `Failed to search the web: ${error.message || 'Unknown error'}`,
    };
  }
}

/**
 * Search orders by item number to find sales history
 */
export async function searchOrdersByItem(params: {
  itemNo: string;
  colorId?: number;
  condition?: string;
  limit?: number;
}) {
  const { itemNo, colorId, condition, limit = 50 } = params;
  
  try {
    // STEP 1: Find all inventory IDs for this part number
    // SKUs are formatted as "{inventory_id}.LGO-{part_number}"
    // So we need to find the inventory IDs first, then search for them in SKUs
    const inventoryConditions: any[] = [eq(blInventory.itemNo, itemNo)];
    
    if (colorId !== undefined) {
      inventoryConditions.push(eq(blInventory.colorId, colorId));
    }
    
    if (condition) {
      const conditionCode = condition === 'New' ? 'N' : 'U';
      inventoryConditions.push(eq(blInventory.newOrUsed, conditionCode));
    }
    
    const inventoryItems = await db
      .select({ id: blInventory.id })
      .from(blInventory)
      .where(and(...inventoryConditions));
    
    if (inventoryItems.length === 0) {
      return {
        success: true,
        data: [],
        count: 0,
        message: `No inventory found for item ${itemNo}`,
      };
    }
    
    // STEP 2: Search for orders containing these inventory IDs in their SKU
    // SKU format: "16-{inventory_id}.LGO-{part_number}"
    const inventoryIds = inventoryItems.map(item => item.id.toString());
    const skuPatterns = inventoryIds.map(id => 
      like(orderDetails.sku, `%-${id}.LGO-%`)
    );
    
    const results = await db
      .select({
        orderId: orderDetails.orderId,
        orderNumber: orders.orderNumber,
        orderDate: orders.orderDate,
        marketplace: orders.marketplace,
        customerUsername: orders.customerUsername,
        orderTotal: orders.orderTotal,
        orderStatus: orders.orderStatus,
        itemName: orderDetails.name,
        sku: orderDetails.sku,
        quantity: orderDetails.quantity,
        unitPrice: orderDetails.unitPrice,
        colorId: orderDetails.colorId,
        condition: orderDetails.condition,
      })
      .from(orderDetails)
      .innerJoin(orders, eq(orderDetails.orderId, orders.id))
      .where(or(...skuPatterns))
      .orderBy(desc(orders.orderDate))
      .limit(limit);
    
    if (results.length === 0) {
      return {
        success: true,
        data: [],
        count: 0,
        message: `No sales history found for item ${itemNo}`,
      };
    }
    
    // Calculate summary stats
    const totalQuantity = results.reduce((sum, r) => sum + (r.quantity || 0), 0);
    const totalRevenue = results.reduce((sum, r) => 
      sum + ((r.quantity || 0) * parseFloat(r.unitPrice || '0')), 0
    );
    const avgPrice = totalRevenue / totalQuantity;
    
    return {
      success: true,
      data: results,
      count: results.length,
      summary: {
        totalOrders: results.length,
        totalQuantitySold: totalQuantity,
        totalRevenue: totalRevenue.toFixed(2),
        averagePrice: avgPrice.toFixed(2),
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Failed to search orders by item',
    };
  }
}

/**
 * Get items that were frequently purchased together with a specific part
 * Uses HYBRID approach: SQL for exact co-purchases + embeddings for semantic similarity
 */
export async function getCopurchasedItems(params: {
  itemNo: string;
  limit?: number;
}) {
  const { itemNo, limit = 20 } = params;
  
  try {
    // STEP 1: Find all inventory IDs for this part number
    const inventoryItems = await db
      .select({ 
        id: blInventory.id,
        itemName: blInventory.itemName,
        itemType: blInventory.itemType,
        colorName: blInventory.colorName,
      })
      .from(blInventory)
      .where(eq(blInventory.itemNo, itemNo));
    
    if (inventoryItems.length === 0) {
      return {
        success: true,
        data: [],  // Backward compatible
        exactCopurchases: [],
        similarItems: [],
        count: 0,
        message: `No inventory found for item ${itemNo}`,
      };
    }
    
    // STEP 2: SQL-based exact co-purchases
    const inventoryIds = inventoryItems.map(item => item.id.toString());
    const skuPatterns = inventoryIds.map(id => 
      like(orderDetails.sku, `%-${id}.LGO-%`)
    );
    
    const ordersWithThisPart = await db
      .select({ orderId: orderDetails.orderId })
      .from(orderDetails)
      .where(or(...skuPatterns))
      .groupBy(orderDetails.orderId);
    
    let exactCopurchases: any[] = [];
    
    if (ordersWithThisPart.length > 0) {
      const orderIds = ordersWithThisPart.map(o => o.orderId);
      
      // Get all items from those orders
      const allItemsInOrders = await db
        .select({
          orderId: orderDetails.orderId,
          sku: orderDetails.sku,
          name: orderDetails.name,
          quantity: orderDetails.quantity,
        })
        .from(orderDetails)
        .where(inArray(orderDetails.orderId, orderIds));
      
      // Aggregate co-purchased items (counting unique orders)
      interface CopurchaseItem {
        itemNo: string;
        name: string;
        totalQuantity: number;
        orderCount: number;
        orderIds: Set<string>;
      }
      
      const copurchaseMap = new Map<string, CopurchaseItem>();
      
      allItemsInOrders.forEach(item => {
        const match = item.sku?.match(/\.LGO-([^-]+)/);
        if (!match) return;
        
        const partNumber = match[1];
        if (partNumber === itemNo) return; // Skip the searched part itself
        
        if (!copurchaseMap.has(partNumber)) {
          copurchaseMap.set(partNumber, {
            itemNo: partNumber,
            name: item.name || 'Unknown',
            totalQuantity: 0,
            orderCount: 0,
            orderIds: new Set(),
          });
        }
        
        const existing = copurchaseMap.get(partNumber)!;
        existing.totalQuantity += item.quantity || 0;
        if (!existing.orderIds.has(item.orderId)) {
          existing.orderIds.add(item.orderId);
          existing.orderCount += 1;
        }
      });
      
      // Sort by frequency
      exactCopurchases = Array.from(copurchaseMap.values())
        .sort((a, b) => b.orderCount - a.orderCount)
        .slice(0, limit)
        .map(({ itemNo, name, totalQuantity, orderCount }) => ({
          itemNo,
          name,
          totalQuantity,
          orderCount,
          source: 'exact_copurchase',
        }));
    }
    
    // STEP 3: Embedding-based semantic similarity
    let similarItems: any[] = [];
    
    try {
      // Create query content from the first inventory item
      const sampleItem = inventoryItems[0];
      const queryContent = `Item: ${itemNo}. Name: ${sampleItem.itemName || 'Unknown'}. Type: ${sampleItem.itemType || ''}. Color: ${sampleItem.colorName || ''}`;
      
      // Generate query embedding
      const queryEmbedding = await generateEmbedding(queryContent);
      
      // Search using cosine similarity with parameterized query
      const embeddingVector = JSON.stringify(queryEmbedding);
      const searchLimit = Math.min(limit || 20, 10);
      
      const embeddingResults = await db.execute(sql`
        SELECT 
          ie.inventory_id,
          bi.item_no,
          bi.item_name,
          bi.item_type,
          bi.color_name,
          bi.quantity,
          1 - (ie.embedding <=> ${embeddingVector}::vector) as similarity
        FROM inventory_embeddings ie
        JOIN bl_inventory bi ON ie.inventory_id = bi.id
        WHERE bi.item_no != ${itemNo}
        ORDER BY ie.embedding <=> ${embeddingVector}::vector
        LIMIT ${searchLimit}
      `);
      
      similarItems = (embeddingResults.rows as any[]).map(row => ({
        itemNo: row.item_no,
        name: row.item_name || 'Unknown',
        itemType: row.item_type,
        colorName: row.color_name,
        similarity: parseFloat(row.similarity || '0').toFixed(3),
        source: 'semantic_similarity',
      }));
    } catch (embeddingError: any) {
      console.error('⚠️ Embedding search failed (continuing with SQL results):', embeddingError.message);
    }
    
    // Combine both results for backward compatibility (data field)
    // Also provide separate arrays for richer AI responses
    const combinedData = [
      ...exactCopurchases.map(item => ({ ...item, category: 'bought_together' as const })),
      ...similarItems.map(item => ({ ...item, category: 'similar_item' as const })),
    ];
    
    return {
      success: true,
      data: combinedData,  // Backward compatible: combined results
      exactCopurchases,    // New: items bought in same orders
      similarItems,        // New: semantically similar via AI
      count: combinedData.length,
      summary: {
        searchedPart: itemNo,
        totalOrdersAnalyzed: ordersWithThisPart.length,
        exactCopurchasesFound: exactCopurchases.length,
        similarItemsFound: similarItems.length,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Failed to get co-purchased items',
    };
  }
}

/**
 * Tool: Search BrickLink forum discussions
 */
export async function searchForumDiscussions(params: {
  query: string;
  limit?: number;
}) {
  const { query, limit = 10 } = params;
  
  try {
    // Generate embedding for the search query
    const queryEmbedding = await generateEmbedding(query);
    const embeddingVector = JSON.stringify(queryEmbedding);
    
    // Search using cosine similarity
    const results = await db.execute(sql`
      SELECT 
        fp.id,
        fp.thread_id,
        fp.title,
        fp.excerpt,
        fp.username,
        fp.user_feedback_count,
        fp.posted_at,
        fp.post_url,
        fp.thread_url,
        fp.has_replies,
        1 - (fe.embedding <=> ${embeddingVector}::vector) as relevance
      FROM bl_forum_embeddings fe
      JOIN bl_forum_posts fp ON fe.post_id = fp.id
      ORDER BY fe.embedding <=> ${embeddingVector}::vector
      LIMIT ${Math.min(limit, 20)}
    `);
    
    if (results.rows.length === 0) {
      return {
        success: true,
        message: 'No forum discussions found matching your query. The forum database may be empty or syncing.',
        data: [],
        count: 0,
      };
    }
    
    const posts = (results.rows as any[]).map(row => ({
      id: row.id,
      threadId: row.thread_id,
      title: row.title,
      excerpt: row.excerpt,
      username: row.username,
      userFeedbackRating: row.user_feedback_count || 0,
      postedAt: row.posted_at,
      postUrl: row.post_url,
      threadUrl: row.thread_url,
      hasReplies: row.has_replies,
      relevance: parseFloat(row.relevance || '0').toFixed(3),
    }));
    
    return {
      success: true,
      data: posts,
      count: posts.length,
      message: `Found ${posts.length} relevant forum discussion${posts.length !== 1 ? 's' : ''}`,
    };
  } catch (error: any) {
    console.error('Error searching forum discussions:', error);
    return {
      success: false,
      message: error.message || 'Failed to search forum discussions',
      data: [],
      count: 0,
    };
  }
}

/**
 * Tool definitions for OpenRouter function calling
 */
export const AI_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_bricklink_catalog',
      description: 'Search the BrickLink catalog for items NOT in local inventory. Use this when a user asks about a part/set/minifig that is not found in the local database.',
      parameters: {
        type: 'object',
        properties: {
          itemNo: {
            type: 'string',
            description: 'The BrickLink item number (e.g., "3001", "6086-1", "fig-001234")',
          },
          itemType: {
            type: 'string',
            enum: ['PART', 'SET', 'MINIFIG'],
            description: 'The type of item to search for. Default is PART.',
          },
        },
        required: ['itemNo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_bricklink_price_guide',
      description: 'Get current market pricing data from BrickLink for any item. Use this for pricing recommendations and market analysis.',
      parameters: {
        type: 'object',
        properties: {
          itemNo: {
            type: 'string',
            description: 'The BrickLink item number',
          },
          itemType: {
            type: 'string',
            enum: ['PART', 'SET', 'MINIFIG'],
            description: 'The type of item',
          },
          colorId: {
            type: 'number',
            description: 'BrickLink color ID (optional, for parts)',
          },
          newOrUsed: {
            type: 'string',
            enum: ['N', 'U'],
            description: 'Item condition: N for New, U for Used (default: N)',
          },
          premiumPercentage: {
            type: 'number',
            description: 'Premium percentage to add to average sold price for suggested retail (default: 15)',
          },
        },
        required: ['itemNo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_local_inventory',
      description: 'Search the local inventory database with advanced filtering. Use this to find items in stock.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'General text search query',
          },
          itemNo: {
            type: 'string',
            description: 'Specific part number to search for',
          },
          colorName: {
            type: 'string',
            description: 'Filter by color name (e.g., "Red", "Blue")',
          },
          category: {
            type: 'string',
            description: 'Filter by category (e.g., "Brick", "Plate", "Minifig")',
          },
          minQuantity: {
            type: 'number',
            description: 'Minimum quantity in stock',
          },
          minPrice: {
            type: 'number',
            description: 'Minimum unit price',
          },
          maxPrice: {
            type: 'number',
            description: 'Maximum unit price',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 20)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_inventory_stats',
      description: 'Get aggregate statistics about inventory (total lots, parts, value). Useful for answering "how much" and "how many" questions.',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            description: 'Filter stats by category',
          },
          colorName: {
            type: 'string',
            description: 'Filter stats by color',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_order_analytics',
      description: 'Get sales and order analytics (total orders, revenue, average order value). Useful for business performance questions.',
      parameters: {
        type: 'object',
        properties: {
          marketplace: {
            type: 'string',
            description: 'Filter by marketplace/platform',
          },
          customerUsername: {
            type: 'string',
            description: 'Filter by customer username',
          },
          startDate: {
            type: 'string',
            description: 'Start date for date range filter (ISO format)',
          },
          endDate: {
            type: 'string',
            description: 'End date for date range filter (ISO format)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_orders_by_item',
      description: 'Search order history to find if a specific part/item has been sold. Returns sales history including dates, quantities, prices, and customers. Use this to answer "has anyone purchased this part" or "show me sales for part X".',
      parameters: {
        type: 'object',
        properties: {
          itemNo: {
            type: 'string',
            description: 'The item number/SKU to search for (e.g., "26047", "3001")',
          },
          colorId: {
            type: 'number',
            description: 'Optional: Filter by BrickLink color ID',
          },
          condition: {
            type: 'string',
            description: 'Optional: Filter by condition (e.g., "New", "Used")',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results to return (default: 50)',
          },
        },
        required: ['itemNo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_copurchased_items',
      description: 'Find what other parts customers bought together with a specific part using HYBRID analysis: (1) SQL for exact co-purchases from order history, and (2) AI embeddings for semantically similar items. Returns both exact co-purchases (items literally bought in same orders) AND similar items (semantically related via AI). Use this to answer "what did people buy along with this part", "what do customers buy together with part X", or "show me related items".',
      parameters: {
        type: 'object',
        properties: {
          itemNo: {
            type: 'string',
            description: 'The part number to analyze co-purchases for (e.g., "3001", "32039")',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of co-purchased items to return per category (default: 20)',
          },
        },
        required: ['itemNo'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_set_parts',
      description: 'Get the complete list of ALL parts and quantities in a LEGO set. Returns the full inventory with no limits. Use this when user asks "what parts are in set X" or "show me the parts list for set X".',
      parameters: {
        type: 'object',
        properties: {
          setNum: {
            type: 'string',
            description: 'The set number (e.g., "4709-1", "10179-1", "75192-1"). Must include the variant number after the dash.',
          },
        },
        required: ['setNum'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_web',
      description: 'Search the internet for current information, news, trends, or research when the topic requires up-to-date or external knowledge beyond your training data. Use this when discussing current events, market trends, recent LEGO releases, industry news, or any topic where internet research would provide valuable context.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query (e.g., "LEGO market trends 2024", "BrickLink recent updates", "current LEGO set prices")',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_forum_discussions',
      description: 'Search BrickLink forum discussions for community knowledge, questions, tips, seller experiences, buyer feedback, marketplace trends, and general LEGO collecting wisdom. Use this when users ask about community insights, common issues, marketplace practices, or want to know what other sellers/buyers are discussing.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query (e.g., "shipping to Canada", "payment issues", "pricing strategies", "inventory management tips")',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of forum posts to return (default: 10, max: 20)',
          },
        },
        required: ['query'],
      },
    },
  },
];

/**
 * Execute a tool function call from the AI
 */
export async function executeToolCall(toolName: string, params: any): Promise<any> {
  console.log(`🔧 Executing tool: ${toolName}`, params);
  
  switch (toolName) {
    case 'search_bricklink_catalog':
      return await searchBrickLinkCatalog(params);
    
    case 'get_bricklink_price_guide':
      return await getBrickLinkPriceGuide(params);
    
    case 'search_local_inventory':
      return await searchLocalInventory(params);
    
    case 'get_inventory_stats':
      return await getInventoryStats(params);
    
    case 'get_order_analytics':
      return await getOrderAnalytics(params);
    
    case 'search_orders_by_item':
      return await searchOrdersByItem(params);
    
    case 'get_copurchased_items':
      return await getCopurchasedItems(params);
    
    case 'get_set_parts':
      return await getSetParts(params);
    
    case 'search_web':
      return await searchWeb(params);
    
    case 'search_forum_discussions':
      return await searchForumDiscussions(params);
    
    default:
      return {
        success: false,
        message: `Unknown tool: ${toolName}`,
      };
  }
}
