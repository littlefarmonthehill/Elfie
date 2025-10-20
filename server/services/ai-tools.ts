/**
 * AI Tools for E.L.F.I.E.
 * Safe backend functions that the AI assistant can call
 */

import { db } from '../db';
import { blInventory, blColors, blCategories, orders, setPartRelationships } from '@shared/schema';
import { eq, like, or, sql, and, desc } from 'drizzle-orm';
import { searchBricklinkCatalogItem, fetchPriceOMagicData } from './bricklink';
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
    
    case 'get_set_parts':
      return await getSetParts(params);
    
    case 'search_web':
      return await searchWeb(params);
    
    default:
      return {
        success: false,
        message: `Unknown tool: ${toolName}`,
      };
  }
}
