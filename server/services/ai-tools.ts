/**
 * AI Tools for E.L.F.I.E.
 * Safe backend functions that the AI assistant can call
 */

import { db } from '../db';
import { blInventory, blColors, blCategories, orders } from '@shared/schema';
import { eq, like, or, sql, and, desc } from 'drizzle-orm';
import { searchBricklinkCatalogItem, fetchPriceOMagicData } from './bricklink';

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
  premiumPercentage?: number;
}) {
  const { itemNo, itemType = 'PART', colorId, premiumPercentage = 15 } = params;
  
  try {
    const priceData = await fetchPriceOMagicData(itemNo, itemType, colorId, premiumPercentage);
    
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
            description: 'New or Used condition',
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
    
    default:
      return {
        success: false,
        message: `Unknown tool: ${toolName}`,
      };
  }
}
