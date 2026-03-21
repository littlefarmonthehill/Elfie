/**
 * AI Tools for E.L.F.I.E.
 * Safe backend functions that the AI assistant can call
 */

import { db } from '../db';
import { blInventory, blColors, blCategories, blCatalog, orders, orderDetails, setPartRelationships, inventoryEmbeddings, blForumPosts, blForumEmbeddings } from '@shared/schema';
import { eq, like, or, sql, and, desc, inArray } from 'drizzle-orm';

import { generateEmbedding, createInventoryContent, searchInventorySemantic } from './embeddings';
import axios from 'axios';
import * as cheerio from 'cheerio';

// Resolves item name with colorId=0 (Rebrickable universal) fallback — same pattern as routes.ts.
const resolvedCatalogItemName = (itemNoRef: any, itemTypeRef: any, colorIdRef: any) =>
  sql<string | null>`(SELECT item_name FROM bl_catalog WHERE item_no = ${itemNoRef} AND item_type = ${itemTypeRef} ORDER BY (color_id = ${colorIdRef})::int DESC, color_id ASC LIMIT 1)`;

/**
 * Tool: Search local catalog (bl_catalog) for item details, images, dimensions
 */
export async function searchBrickLinkCatalog(params: {
  itemNo: string;
  itemType?: 'PART' | 'SET' | 'MINIFIG';
}) {
  const { itemNo, itemType = 'PART' } = params;
  
  try {
    const rows = await db
      .select()
      .from(blCatalog)
      .where(and(eq(blCatalog.itemNo, itemNo.toUpperCase()), eq(blCatalog.itemType, itemType)))
      .orderBy(sql`(image_url IS NOT NULL AND image_url != '') DESC, color_id ASC`)
      .limit(1);
    
    const row = rows[0];
    if (!row) {
      return {
        success: false,
        message: `Part ${itemNo} not found in local catalog`,
      };
    }
    
    const typePrefix = itemType === 'SET' ? 'SL' : itemType === 'MINIFIG' ? 'ML' : 'PL';
    const fallbackImageUrl = `https://img.bricklink.com/${typePrefix}/${itemNo}.jpg`;
    const fallbackThumbUrl = `https://img.bricklink.com/P/0/${itemNo}.jpg`;

    let imageUrl = row.imageUrl || null;
    let thumbnailUrl = row.thumbnailUrl || null;
    if (imageUrl && !imageUrl.startsWith('http')) imageUrl = `https:${imageUrl}`;
    if (thumbnailUrl && !thumbnailUrl.startsWith('http')) thumbnailUrl = `https:${thumbnailUrl}`;

    return {
      success: true,
      data: {
        itemNo: row.itemNo,
        name: row.itemName,
        type: row.itemType,
        categoryId: row.categoryId,
        thumbnailUrl: thumbnailUrl || fallbackThumbUrl,
        imageUrl: imageUrl || fallbackImageUrl,
        weight: row.blCatalogWeight,
        dimensionX: row.blDimensionX,
        dimensionY: row.blDimensionY,
        dimensionZ: row.blDimensionZ,
        yearReleased: row.yearReleased,
        bricklinkUrl: `https://www.bricklink.com/v2/catalog/catalogitem.page?${itemType[0]}=${itemNo}`,
      },
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message || 'Failed to search local catalog',
    };
  }
}

/**
 * Tool: Get price guide data from local cache (price_guide_cache table)
 */
export async function getBrickLinkPriceGuide(params: {
  itemNo: string;
  itemType?: 'PART' | 'SET' | 'MINIFIG';
  colorId?: number;
  newOrUsed?: 'N' | 'U';
}) {
  const { itemNo, itemType = 'PART', colorId, newOrUsed = 'N' } = params;
  
  try {
    const result = await db.execute(sql`
      SELECT * FROM price_guide_cache
      WHERE item_no = ${itemNo.toUpperCase()} AND item_type = ${itemType}
        AND color_id = ${colorId ?? -1} AND new_or_used = ${newOrUsed}
      LIMIT 1
    `);
    
    const r = result.rows[0] as any;
    if (!r) {
      return {
        success: false,
        message: `No cached price data for ${itemNo}. Price data is available after a Price-o-Matic sync.`,
      };
    }
    
    return {
      success: true,
      data: {
        itemNo: r.item_no,
        itemName: r.item_name,
        stockAvgPrice: r.stock_avg_price,
        stockMinPrice: r.stock_min_price,
        stockMaxPrice: r.stock_max_price,
        stockTotalLots: r.stock_total_lots,
        stockQuantity: r.stock_quantity,
        soldAvgPrice: r.sold_avg_price,
        soldMinPrice: r.sold_min_price,
        soldMaxPrice: r.sold_max_price,
        soldTotalLots: r.sold_total_lots,
        soldQuantity: r.sold_quantity,
        fetchedAt: r.fetched_at,
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
    limit = itemNo ? 100 : 50,
  } = params;
  
  try {
    let queryBuilder = db
      .select({
        id: blInventory.id,
        itemNo: blInventory.itemNo,
        itemType: blInventory.itemType,
        itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
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
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
      .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id));
    
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
          like(blCatalog.itemName, `%${query}%`),
          like(blInventory.description, `%${query}%`),
          like(blInventory.remarks, `%${query}%`)
        )
      );
    }
    
    if (conditions.length > 0) {
      queryBuilder = queryBuilder.where(and(...conditions)) as any;
    }
    
    queryBuilder = queryBuilder.orderBy(sql`${blInventory.quantity} DESC, ${blInventory.unitPrice} ASC`) as any;
    
    const results = await queryBuilder.limit(limit);
    
    if (itemNo && results.length > 30) {
      const colorSummary = new Map<string, { qty: number; minPrice: number; maxPrice: number; conditions: Set<string>; count: number }>();
      for (const r of results) {
        const key = r.colorName || 'Unknown';
        const existing = colorSummary.get(key);
        const price = parseFloat(r.unitPrice || '0');
        const qty = Number(r.quantity) || 0;
        if (existing) {
          existing.qty += qty;
          existing.count++;
          existing.minPrice = Math.min(existing.minPrice, price);
          existing.maxPrice = Math.max(existing.maxPrice, price);
          if (r.newOrUsed) existing.conditions.add(r.newOrUsed === 'N' ? 'New' : 'Used');
        } else {
          colorSummary.set(key, {
            qty,
            minPrice: price,
            maxPrice: price,
            conditions: new Set(r.newOrUsed ? [r.newOrUsed === 'N' ? 'New' : 'Used'] : []),
            count: 1,
          });
        }
      }

      const byColor = Array.from(colorSummary.entries())
        .sort((a, b) => b[1].qty - a[1].qty)
        .map(([color, d]) => ({
          color,
          totalQuantity: d.qty,
          lots: d.count,
          priceRange: d.minPrice === d.maxPrice ? `$${d.minPrice.toFixed(2)}` : `$${d.minPrice.toFixed(2)}-$${d.maxPrice.toFixed(2)}`,
          conditions: Array.from(d.conditions).join('/'),
        }));

      const totalQty = results.reduce((s, r) => s + (Number(r.quantity) || 0), 0);
      const totalValue = results.reduce((s, r) => s + (Number(r.quantity) || 0) * parseFloat(r.unitPrice || '0'), 0);
      const itemName = results[0]?.itemName || 'Unknown';

      return {
        success: true,
        itemName,
        totalLots: results.length,
        totalQuantity: totalQty,
        totalValue: `$${totalValue.toFixed(2)}`,
        uniqueColors: colorSummary.size,
        byColor,
      };
    }
    
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
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
      .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id));
    
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
  _orgId?: string;
}) {
  const { marketplace, customerUsername, startDate, endDate, _orgId } = params || {};
  
  try {
    const conditions: any[] = [];
    
    if (_orgId) {
      conditions.push(eq(orders.orgId, _orgId));
    }
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
 * Tool: Get inventory aging - analyze how long items have been in stock
 */
export async function getInventoryAging(params?: {
  daysThreshold?: number;
  categoryName?: string;
  limit?: number;
}) {
  const { daysThreshold = 90, categoryName, limit = 20 } = params || {};
  
  try {
    const conditions: any[] = [];
    
    // Calculate date threshold
    const thresholdDate = new Date();
    thresholdDate.setDate(thresholdDate.getDate() - daysThreshold);
    
    if (categoryName) {
      conditions.push(like(blCategories.name, `%${categoryName}%`));
    }
    
    let queryBuilder = db
      .select({
        itemNo: blInventory.itemNo,
        itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
        categoryName: blCategories.name,
        colorName: blColors.name,
        quantity: blInventory.quantity,
        unitPrice: blInventory.unitPrice,
        dateCreated: blInventory.dateCreated,
        daysInStock: sql<number>`CAST(EXTRACT(EPOCH FROM (NOW() - ${blInventory.dateCreated})) / 86400 AS INTEGER)`,
        estimatedValue: sql<number>`${blInventory.quantity} * CAST(${blInventory.unitPrice} AS DECIMAL)`,
      })
      .from(blInventory)
      .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
      .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
      .where(
        conditions.length > 0
          ? and(sql`${blInventory.dateCreated} < ${thresholdDate.toISOString()}`, ...conditions)
          : sql`${blInventory.dateCreated} < ${thresholdDate.toISOString()}`
      )
      .orderBy(sql`EXTRACT(EPOCH FROM (NOW() - ${blInventory.dateCreated})) DESC`)
      .limit(limit);
    
    const agingItems = await queryBuilder;
    
    return {
      success: true,
      data: agingItems.map(item => ({
        itemNo: item.itemNo,
        itemName: item.itemName,
        categoryName: item.categoryName,
        colorName: item.colorName,
        quantity: Number(item.quantity) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        daysInStock: Number(item.daysInStock) || 0,
        estimatedValue: Number(item.estimatedValue) || 0,
      })),
    };
  } catch (error: any) {
    console.error('Error getting inventory aging:', error);
    return {
      success: false,
      message: error.message || 'Failed to get inventory aging',
    };
  }
}

/**
 * Tool: Get sales by category
 */
export async function getSalesByCategory(params?: {
  limit?: number;
  startDate?: string;
  endDate?: string;
}) {
  const { limit = 10, startDate, endDate } = params || {};
  
  try {
    const conditions: any[] = [];
    
    if (startDate) {
      conditions.push(sql`${orders.orderDate} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${orders.orderDate} <= ${endDate}`);
    }
    
    // Join orders -> orderDetails -> blInventory -> blCategories
    // SKU is now standardized to BrickLink inventory ID
    let queryBuilder = db
      .select({
        categoryId: blCategories.id,
        categoryName: blCategories.name,
        totalQuantity: sql<number>`SUM(CAST(${orderDetails.quantity} AS INTEGER))`,
        totalRevenue: sql<number>`SUM(CAST(${orderDetails.quantity} AS INTEGER) * CAST(${orderDetails.unitPrice} AS DECIMAL))`,
        orderCount: sql<number>`COUNT(DISTINCT ${orders.id})`,
      })
      .from(orderDetails)
      .innerJoin(orders, eq(orderDetails.orderId, orders.id))
      .leftJoin(blInventory, sql`${orderDetails.sku} = CAST(${blInventory.id} AS TEXT)`)
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
      .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
      .where(
        conditions.length > 0
          ? and(sql`${blCategories.name} IS NOT NULL`, ...conditions)
          : sql`${blCategories.name} IS NOT NULL`
      )
      .groupBy(blCategories.id, blCategories.name)
      .orderBy(sql`SUM(CAST(${orderDetails.quantity} AS INTEGER) * CAST(${orderDetails.unitPrice} AS DECIMAL)) DESC`)
      .limit(limit);
    
    const categoryStats = await queryBuilder;
    
    return {
      success: true,
      data: categoryStats.map(cat => ({
        categoryName: cat.categoryName,
        totalQuantity: Number(cat.totalQuantity) || 0,
        totalRevenue: Number(cat.totalRevenue) || 0,
        orderCount: Number(cat.orderCount) || 0,
      })),
    };
  } catch (error: any) {
    console.error('Error getting sales by category:', error);
    return {
      success: false,
      message: error.message || 'Failed to get sales by category',
    };
  }
}

/**
 * Tool: Get category throughput (sell-through rate)
 * Compares sales velocity to current inventory levels by category
 */
export async function getCategoryThroughput(params?: {
  startDate?: string;
  endDate?: string;
  limit?: number;
}) {
  const { startDate, endDate, limit = 10 } = params || {};
  
  try {
    // Get sales by category
    const salesConditions: any[] = [];
    
    if (startDate) {
      salesConditions.push(sql`${orders.orderDate} >= ${startDate}`);
    }
    if (endDate) {
      salesConditions.push(sql`${orders.orderDate} <= ${endDate}`);
    }
    
    // Query sales data
    let salesQuery = db
      .select({
        categoryId: blCategories.id,
        categoryName: blCategories.name,
        totalQuantitySold: sql<number>`SUM(CAST(${orderDetails.quantity} AS INTEGER))`,
        totalRevenue: sql<number>`SUM(CAST(${orderDetails.quantity} AS INTEGER) * CAST(${orderDetails.unitPrice} AS DECIMAL))`,
      })
      .from(orderDetails)
      .innerJoin(orders, eq(orderDetails.orderId, orders.id))
      .leftJoin(blInventory, sql`${orderDetails.sku} = CAST(${blInventory.id} AS TEXT)`)
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
      .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
      .where(
        salesConditions.length > 0
          ? and(sql`${blCategories.name} IS NOT NULL`, ...salesConditions)
          : sql`${blCategories.name} IS NOT NULL`
      )
      .groupBy(blCategories.id, blCategories.name);
    
    const categoryStats = await salesQuery;
    
    // Get current inventory by category
    const inventoryStats = await db
      .select({
        categoryId: blCategories.id,
        categoryName: blCategories.name,
        totalQuantityInStock: sql<number>`SUM(${blInventory.quantity})`,
        totalInventoryValue: sql<number>`SUM(${blInventory.quantity} * CAST(${blInventory.unitPrice} AS DECIMAL))`,
      })
      .from(blInventory)
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
      .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
      .where(sql`${blCategories.name} IS NOT NULL`)
      .groupBy(blCategories.id, blCategories.name);
    
    // Combine sales and inventory data
    const throughputData = categoryStats.map(sales => {
      const inventory = inventoryStats.find(inv => inv.categoryId === sales.categoryId);
      const quantitySold = Number(sales.totalQuantitySold) || 0;
      const quantityInStock = Number(inventory?.totalQuantityInStock) || 0;
      
      // Calculate throughput rate (sales / inventory)
      // Higher throughput = higher demand relative to stock
      const throughputRate = quantityInStock > 0 ? quantitySold / quantityInStock : 0;
      
      return {
        categoryName: sales.categoryName,
        quantitySold,
        revenue: Number(sales.totalRevenue) || 0,
        quantityInStock,
        inventoryValue: Number(inventory?.totalInventoryValue) || 0,
        throughputRate: Number(throughputRate.toFixed(4)),
        throughputPercentage: Number((throughputRate * 100).toFixed(2)),
      };
    });
    
    // Sort by throughput rate descending
    const sorted = throughputData.sort((a, b) => b.throughputRate - a.throughputRate).slice(0, limit);
    
    return {
      success: true,
      data: sorted,
      explanation: 'Throughput rate = quantity sold ÷ quantity in stock. Higher throughput means strong demand relative to inventory. Categories with high throughput may need more stock; categories with low throughput may be overstocked.',
    };
  } catch (error: any) {
    console.error('Error getting category throughput:', error);
    return {
      success: false,
      message: error.message || 'Failed to get category throughput',
    };
  }
}

/**
 * Tool: Get sales by geography (state, country)
 */
export async function getSalesByGeography(params?: {
  groupBy?: 'state' | 'country';
  limit?: number;
  startDate?: string;
  endDate?: string;
}) {
  const { groupBy = 'state', limit = 20, startDate, endDate } = params || {};
  
  try {
    const conditions: any[] = [];
    
    if (startDate) {
      conditions.push(sql`${orders.orderDate} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${orders.orderDate} <= ${endDate}`);
    }
    
    // Build conditions including ship_to filter
    const allConditions = [
      sql`${orders.shipTo} IS NOT NULL AND ${orders.shipTo} != ''`,
      ...conditions
    ];
    
    // Get all orders with ship_to data
    const allOrders = await db
      .select({
        shipTo: orders.shipTo,
        orderTotal: orders.orderTotal,
        orderDate: orders.orderDate,
      })
      .from(orders)
      .where(and(...allConditions));
    
    // Parse JSON and aggregate by geography with demographics
    const geoMap = new Map<string, { 
      orderCount: number; 
      totalRevenue: number; 
      customers: Set<string>;
      residentialOrders: number;
      commercialOrders: number;
      hasCompany: number;
      phoneNumbers: Set<string>;
    }>();
    
    allOrders.forEach(order => {
      try {
        const shipToData = JSON.parse(order.shipTo || '{}');
        const geoKey = groupBy === 'state' 
          ? `${shipToData.state || 'Unknown'}, ${shipToData.country || 'Unknown'}`
          : shipToData.country || 'Unknown';
        
        // Skip if no valid geographic data
        if (!shipToData.state && groupBy === 'state') return;
        if (!shipToData.country && groupBy === 'country') return;
        
        const revenue = Number(order.orderTotal) || 0;
        const customerName = shipToData.name || 'Unknown';
        const isResidential = shipToData.residential === true;
        const hasCompany = !!(shipToData.company && shipToData.company.trim());
        const phone = shipToData.phone || '';
        
        const existing = geoMap.get(geoKey);
        if (existing) {
          existing.orderCount++;
          existing.totalRevenue += revenue;
          existing.customers.add(customerName);
          if (isResidential) existing.residentialOrders++;
          else existing.commercialOrders++;
          if (hasCompany) existing.hasCompany++;
          if (phone) existing.phoneNumbers.add(phone);
        } else {
          geoMap.set(geoKey, {
            orderCount: 1,
            totalRevenue: revenue,
            customers: new Set([customerName]),
            residentialOrders: isResidential ? 1 : 0,
            commercialOrders: isResidential ? 0 : 1,
            hasCompany: hasCompany ? 1 : 0,
            phoneNumbers: new Set(phone ? [phone] : []),
          });
        }
      } catch (e) {
        // Skip orders with invalid JSON
      }
    });
    
    // Convert to array and sort by revenue
    const results = Array.from(geoMap.entries())
      .map(([location, data]) => {
        const residentialPercent = data.orderCount > 0 
          ? Number((data.residentialOrders / data.orderCount * 100).toFixed(1))
          : 0;
        
        return {
          location,
          orderCount: data.orderCount,
          totalRevenue: Number(data.totalRevenue.toFixed(2)),
          uniqueCustomers: data.customers.size,
          avgOrderValue: Number((data.totalRevenue / data.orderCount).toFixed(2)),
          demographics: {
            residentialPercent,
            commercialPercent: Number((100 - residentialPercent).toFixed(1)),
            businessOrders: data.hasCompany,
            uniquePhoneNumbers: data.phoneNumbers.size,
          }
        };
      })
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, limit);
    
    return {
      success: true,
      data: results,
      groupBy,
      totalLocations: results.length,
      explanation: groupBy === 'state' 
        ? 'Sales aggregated by state and country with demographic breakdown. Location format: "STATE, COUNTRY". Demographics include residential vs commercial delivery addresses and business indicators.'
        : 'Sales aggregated by country with demographic breakdown. Demographics include residential vs commercial delivery addresses and business indicators.',
    };
  } catch (error: any) {
    console.error('Error getting sales by geography:', error);
    return {
      success: false,
      message: error.message || 'Failed to get sales by geography',
    };
  }
}

/**
 * Tool: Get customer metrics (repeating customers, new customers, etc.)
 */
export async function getCustomerMetrics(params?: {
  startDate?: string;
  endDate?: string;
}) {
  const { startDate, endDate } = params || {};
  
  try {
    const conditions: any[] = [];
    
    if (startDate) {
      conditions.push(sql`${orders.orderDate} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${orders.orderDate} <= ${endDate}`);
    }
    
    // Build conditions including customer username filter
    const allConditions = [
      sql`${orders.customerUsername} IS NOT NULL AND ${orders.customerUsername} != ''`,
      ...conditions
    ];
    
    // Get all orders with filters
    const allOrders = await db
      .select({
        id: orders.id,
        customerUsername: orders.customerUsername,
        orderDate: orders.orderDate,
        orderTotal: orders.orderTotal,
      })
      .from(orders)
      .where(and(...allConditions));
    
    // Group by customer
    const customerMap = new Map<string, { orderCount: number; totalRevenue: number; firstOrder: string; lastOrder: string }>();
    
    allOrders.forEach(order => {
      if (!order.customerUsername) return; // Skip if no customer username
      
      const existing = customerMap.get(order.customerUsername);
      const revenue = Number(order.orderTotal) || 0;
      const orderDate = (order.orderDate instanceof Date ? order.orderDate.toISOString() : order.orderDate) || new Date().toISOString();
      
      if (existing) {
        existing.orderCount++;
        existing.totalRevenue += revenue;
        existing.firstOrder = orderDate < existing.firstOrder ? orderDate : existing.firstOrder;
        existing.lastOrder = orderDate > existing.lastOrder ? orderDate : existing.lastOrder;
      } else {
        customerMap.set(order.customerUsername, {
          orderCount: 1,
          totalRevenue: revenue,
          firstOrder: orderDate,
          lastOrder: orderDate,
        });
      }
    });
    
    // Calculate metrics
    const totalCustomers = customerMap.size;
    const repeatCustomers = Array.from(customerMap.values()).filter(c => c.orderCount > 1).length;
    const repeatCustomerRate = totalCustomers > 0 ? (repeatCustomers / totalCustomers * 100) : 0;
    const totalOrders = allOrders.length;
    const avgOrdersPerCustomer = totalCustomers > 0 ? (totalOrders / totalCustomers) : 0;
    
    // Top repeat customers
    const topRepeatCustomers = Array.from(customerMap.entries())
      .filter(([_, data]) => data.orderCount > 1)
      .map(([username, data]) => ({
        username,
        orderCount: data.orderCount,
        totalRevenue: data.totalRevenue,
        firstOrder: data.firstOrder,
        lastOrder: data.lastOrder,
      }))
      .sort((a, b) => b.orderCount - a.orderCount)
      .slice(0, 10);
    
    // Recent new customers (first order in last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentNewCustomers = Array.from(customerMap.entries())
      .filter(([_, data]) => data.orderCount === 1 && new Date(data.firstOrder) >= thirtyDaysAgo)
      .map(([username, data]) => ({
        username,
        firstOrder: data.firstOrder,
        totalRevenue: data.totalRevenue,
      }))
      .sort((a, b) => new Date(b.firstOrder).getTime() - new Date(a.firstOrder).getTime())
      .slice(0, 10);
    
    return {
      success: true,
      data: {
        totalCustomers,
        repeatCustomers,
        repeatCustomerRate: Number(repeatCustomerRate.toFixed(1)),
        avgOrdersPerCustomer: Number(avgOrdersPerCustomer.toFixed(1)),
        topRepeatCustomers,
        recentNewCustomers,
      },
      explanation: 'Repeat customer rate = (customers with >1 order) ÷ total customers. Higher repeat rates indicate strong customer loyalty and satisfaction.',
    };
  } catch (error: any) {
    console.error('Error getting customer metrics:', error);
    return {
      success: false,
      message: error.message || 'Failed to get customer metrics',
    };
  }
}

/**
 * Tool: Get business customers - list of all customers with company names
 */
export async function getBusinessCustomers(params?: {
  limit?: number;
  sortBy?: 'orderCount' | 'revenue';
}) {
  const { limit = 50, sortBy = 'revenue' } = params || {};
  
  try {
    // Get all orders with company names in ship_to
    const allOrders = await db
      .select({
        orderId: orders.id,
        customerUsername: orders.customerUsername,
        shipTo: orders.shipTo,
        orderTotal: orders.orderTotal,
        orderDate: orders.orderDate,
      })
      .from(orders)
      .where(sql`${orders.shipTo} IS NOT NULL AND ${orders.shipTo} != ''`);
    
    // Extract businesses (those with company names)
    const businessMap = new Map<string, {
      companyName: string;
      customerName: string;
      orderCount: number;
      totalRevenue: number;
      firstOrder: string;
      lastOrder: string;
      locations: Set<string>;
    }>();
    
    allOrders.forEach(order => {
      try {
        const shipToData = JSON.parse(order.shipTo || '{}');
        const companyName = shipToData.company?.trim();
        
        // Only include if there's an actual company name
        if (!companyName) return;
        
        const customerName = shipToData.name || order.customerUsername || 'Unknown';
        const location = shipToData.state && shipToData.country 
          ? `${shipToData.state}, ${shipToData.country}`
          : (shipToData.country || 'Unknown');
        const revenue = Number(order.orderTotal) || 0;
        const orderDate = (order.orderDate instanceof Date ? order.orderDate.toISOString() : order.orderDate) || new Date().toISOString();
        
        const key = `${companyName}|${order.customerUsername}`;
        const existing = businessMap.get(key);
        
        if (existing) {
          existing.orderCount++;
          existing.totalRevenue += revenue;
          existing.firstOrder = orderDate < existing.firstOrder ? orderDate : existing.firstOrder;
          existing.lastOrder = orderDate > existing.lastOrder ? orderDate : existing.lastOrder;
          existing.locations.add(location);
        } else {
          businessMap.set(key, {
            companyName,
            customerName,
            orderCount: 1,
            totalRevenue: revenue,
            firstOrder: orderDate,
            lastOrder: orderDate,
            locations: new Set([location]),
          });
        }
      } catch (e) {
        // Skip orders with invalid JSON
      }
    });
    
    // Convert to array and sort
    const businesses = Array.from(businessMap.values())
      .map(biz => ({
        companyName: biz.companyName,
        customerName: biz.customerName,
        orderCount: biz.orderCount,
        totalRevenue: Number(biz.totalRevenue.toFixed(2)),
        avgOrderValue: Number((biz.totalRevenue / biz.orderCount).toFixed(2)),
        firstOrder: biz.firstOrder,
        lastOrder: biz.lastOrder,
        locations: Array.from(biz.locations),
      }))
      .sort((a, b) => {
        if (sortBy === 'orderCount') {
          return b.orderCount - a.orderCount;
        }
        return b.totalRevenue - a.totalRevenue;
      })
      .slice(0, limit);
    
    return {
      success: true,
      data: businesses,
      totalBusinessCustomers: businesses.length,
      explanation: 'Business customers are identified by having a company name in their shipping address. This list shows all business customers with their order history and locations.',
    };
  } catch (error: any) {
    console.error('Error getting business customers:', error);
    return {
      success: false,
      message: error.message || 'Failed to get business customers',
    };
  }
}

/**
 * Tool: Get margin analysis - analyze profit margins by category or item
 */
export async function getMarginAnalysis(params?: {
  categoryName?: string;
  minMarginPercent?: number;
  limit?: number;
}) {
  const { categoryName, minMarginPercent = 0, limit = 20 } = params || {};
  
  try {
    const conditions: any[] = [
      sql`${blInventory.myCost} IS NOT NULL`,
      sql`${blInventory.unitPrice} IS NOT NULL`,
      sql`CAST(${blInventory.myCost} AS DECIMAL) > 0`, // Defensively handle all zero variants
    ];
    
    if (categoryName) {
      conditions.push(like(blCategories.name, `%${categoryName}%`));
    }
    
    const results = await db
      .select({
        itemNo: blInventory.itemNo,
        itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
        categoryName: blCategories.name,
        colorName: blColors.name,
        quantity: blInventory.quantity,
        unitPrice: blInventory.unitPrice,
        myCost: blInventory.myCost,
        margin: sql<number>`CAST(${blInventory.unitPrice} AS DECIMAL) - CAST(${blInventory.myCost} AS DECIMAL)`,
        marginPercent: sql<number>`((CAST(${blInventory.unitPrice} AS DECIMAL) - CAST(${blInventory.myCost} AS DECIMAL)) / CAST(${blInventory.myCost} AS DECIMAL)) * 100`,
        totalValue: sql<number>`${blInventory.quantity} * CAST(${blInventory.unitPrice} AS DECIMAL)`,
        totalCost: sql<number>`${blInventory.quantity} * CAST(${blInventory.myCost} AS DECIMAL)`,
      })
      .from(blInventory)
      .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
      .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
      .where(and(...conditions))
      .orderBy(sql`((CAST(${blInventory.unitPrice} AS DECIMAL) - CAST(${blInventory.myCost} AS DECIMAL)) / CAST(${blInventory.myCost} AS DECIMAL)) * 100 DESC`)
      .limit(limit);
    
    // Filter by minimum margin percentage
    const filtered = results.filter(item => Number(item.marginPercent) >= minMarginPercent);
    
    return {
      success: true,
      data: filtered.map(item => ({
        itemNo: item.itemNo,
        itemName: item.itemName,
        categoryName: item.categoryName,
        colorName: item.colorName,
        quantity: Number(item.quantity) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        myCost: Number(item.myCost) || 0,
        margin: Number(item.margin) || 0,
        marginPercent: Number(item.marginPercent) || 0,
        totalValue: Number(item.totalValue) || 0,
        totalCost: Number(item.totalCost) || 0,
      })),
    };
  } catch (error: any) {
    console.error('Error getting margin analysis:', error);
    return {
      success: false,
      message: error.message || 'Failed to get margin analysis',
    };
  }
}

/**
 * Tool: Get SKU performance - sales velocity and revenue per SKU
 */
export async function getSkuPerformance(params?: {
  startDate?: string;
  endDate?: string;
  limit?: number;
  minQuantitySold?: number;
}) {
  const { startDate, endDate, limit = 20, minQuantitySold = 1 } = params || {};
  
  try {
    const conditions: any[] = [];
    
    if (startDate) {
      conditions.push(sql`${orders.orderDate} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${orders.orderDate} <= ${endDate}`);
    }
    
    let queryBuilder = db
      .select({
        sku: orderDetails.sku,
        name: orderDetails.name,
        totalQuantity: sql<number>`SUM(CAST(${orderDetails.quantity} AS INTEGER))`,
        totalRevenue: sql<number>`SUM(CAST(${orderDetails.quantity} AS INTEGER) * CAST(${orderDetails.unitPrice} AS DECIMAL))`,
        avgPrice: sql<number>`AVG(CAST(${orderDetails.unitPrice} AS DECIMAL))`,
        orderCount: sql<number>`COUNT(DISTINCT ${orders.id})`,
        firstSale: sql<string>`MIN(${orders.orderDate})`,
        lastSale: sql<string>`MAX(${orders.orderDate})`,
      })
      .from(orderDetails)
      .innerJoin(orders, eq(orderDetails.orderId, orders.id))
      .groupBy(orderDetails.sku, orderDetails.name)
      .orderBy(sql`SUM(CAST(${orderDetails.quantity} AS INTEGER) * CAST(${orderDetails.unitPrice} AS DECIMAL)) DESC`)
      .limit(limit * 2); // Get more initially for filtering
    
    if (conditions.length > 0) {
      queryBuilder = queryBuilder.where(and(...conditions)) as any;
    }
    
    const results = await queryBuilder;
    
    // Filter and calculate velocity
    const filtered = results
      .filter(item => Number(item.totalQuantity) >= minQuantitySold)
      .slice(0, limit)
      .map(item => {
        const firstSale = new Date(item.firstSale);
        const lastSale = new Date(item.lastSale);
        const daysBetween = Math.max(1, Math.ceil((lastSale.getTime() - firstSale.getTime()) / (1000 * 60 * 60 * 24)));
        const velocity = Number(item.totalQuantity) / daysBetween;
        
        return {
          sku: item.sku,
          name: item.name,
          totalQuantity: Number(item.totalQuantity) || 0,
          totalRevenue: Number(item.totalRevenue) || 0,
          avgPrice: Number(item.avgPrice) || 0,
          orderCount: Number(item.orderCount) || 0,
          velocity: velocity, // Units per day
          firstSale: item.firstSale,
          lastSale: item.lastSale,
        };
      });
    
    return {
      success: true,
      data: filtered,
    };
  } catch (error: any) {
    console.error('Error getting SKU performance:', error);
    return {
      success: false,
      message: error.message || 'Failed to get SKU performance',
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

async function searchBrave(query: string, limit: number = 5): Promise<Array<{ title: string; snippet: string; url: string }>> {
  const results: Array<{ title: string; snippet: string; url: string }> = [];
  try {
    const response = await axios.get('https://search.brave.com/search', {
      params: { q: query },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: 15000,
    });
    const $ = cheerio.load(response.data);
    $('.snippet[data-type="web"]').each((index, element) => {
      if (index >= limit) return false;
      const $elem = $(element);
      const url = $elem.find('a[href^="http"]').first().attr('href') || '';
      const title = $elem.find('.search-snippet-title').first().text().trim();
      const desc = $elem.find('.content').first().text().trim();
      if (title && url && !url.includes('brave.com') && !url.includes('search.brave')) {
        results.push({ title, snippet: desc || 'No description available', url });
      }
    });
  } catch (err: any) {
    console.error(`[WebSearch] Brave error:`, err.message);
  }
  return results;
}

async function searchDDG(query: string, limit: number = 5): Promise<Array<{ title: string; snippet: string; url: string }>> {
  const results: Array<{ title: string; snippet: string; url: string }> = [];
  try {
    const response = await axios.get('https://html.duckduckgo.com/html/', {
      params: { q: query },
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      timeout: 15000,
    });
    const $ = cheerio.load(response.data);
    $('.result').each((index, element) => {
      if (index >= limit) return false;
      const $elem = $(element);
      const titleLink = $elem.find('.result__a');
      const title = titleLink.text().trim();
      let rawUrl = titleLink.attr('href') || '';
      let url = '';
      if (rawUrl.includes('uddg=')) {
        try {
          const urlParams = new URLSearchParams(rawUrl.split('?')[1] || '');
          const uddg = urlParams.get('uddg');
          if (uddg) url = decodeURIComponent(uddg);
        } catch { /* skip */ }
      } else {
        url = rawUrl;
      }
      if (url && !url.startsWith('http')) url = 'https://' + url.replace(/^\/+/, '');
      let snippet = $elem.find('.result__snippet').text().trim();
      if (!snippet) snippet = $elem.find('.result__snippet span').text().trim();
      if (!snippet) snippet = $elem.find('.result__extras').text().trim();
      if (title && url && url.startsWith('http') && !url.includes('duckduckgo.com')) {
        results.push({ title, snippet: snippet || 'No description available', url });
      }
    });
  } catch (err: any) {
    console.error(`[WebSearch] DuckDuckGo error:`, err.message);
  }
  return results;
}

/**
 * Tool: Search the web for information (Brave primary, DuckDuckGo fallback)
 */
export async function searchWeb(params: {
  query: string;
}) {
  const { query } = params;
  
  try {
    let results: Array<{ title: string; snippet: string; url: string }> = [];

    results = await searchBrave(query, 5);

    if (results.length === 0) {
      results = await searchDDG(query, 5);
    }
    
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
    console.error('Web search error:', error);
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
    // SKU is now standardized to BrickLink inventory ID
    const inventoryIds = inventoryItems.map(item => item.id.toString());
    
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
      .where(inArray(orderDetails.sku, inventoryIds))
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
        itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
        itemType: blInventory.itemType,
        colorName: blColors.name,
      })
      .from(blInventory)
      .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
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
    // SKU is now standardized to BrickLink inventory ID
    const inventoryIds = inventoryItems.map(item => item.id.toString());
    
    const ordersWithThisPart = await db
      .select({ orderId: orderDetails.orderId })
      .from(orderDetails)
      .where(inArray(orderDetails.sku, inventoryIds))
      .groupBy(orderDetails.orderId);
    
    let exactCopurchases: any[] = [];
    
    if (ordersWithThisPart.length > 0) {
      const orderIds = ordersWithThisPart.map(o => o.orderId);
      
      // Get all items from those orders, joining to inventory to get part numbers
      // SKU is now the inventory ID, so we join directly
      const allItemsInOrders = await db
        .select({
          orderId: orderDetails.orderId,
          sku: orderDetails.sku,
          name: orderDetails.name,
          quantity: orderDetails.quantity,
          itemNo: blInventory.itemNo,
        })
        .from(orderDetails)
        .leftJoin(blInventory, sql`${orderDetails.sku} = CAST(${blInventory.id} AS TEXT)`)
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
        const partNumber = item.itemNo;
        if (!partNumber || partNumber === itemNo) return; // Skip the searched part itself
        
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
  const safeLimit = Math.min(limit, 20);

  // Try vector (semantic) search first; fall back to plain-text if embedding fails
  try {
    const queryEmbedding = await generateEmbedding(query);
    const embeddingVector = JSON.stringify(queryEmbedding);

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
      LIMIT ${safeLimit}
    `);

    if (results.rows.length > 0) {
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
        searchMode: 'semantic',
      };
    }
    // Vector search returned nothing — fall through to text search
  } catch (embeddingErr: any) {
    console.warn('[searchForumDiscussions] Vector search failed, falling back to text search:', embeddingErr.message);
  }

  // Fallback: plain text search on title + excerpt
  try {
    const terms = query.split(/\s+/).filter(Boolean).slice(0, 6);
    const likePattern = `%${terms.join('%')}%`;
    const fallbackResults = await db.execute(sql`
      SELECT id, thread_id, title, excerpt, username, user_feedback_count,
             posted_at, post_url, thread_url, has_replies
      FROM bl_forum_posts
      WHERE title ILIKE ${likePattern}
         OR excerpt ILIKE ${likePattern}
      ORDER BY posted_at DESC
      LIMIT ${safeLimit}
    `);

    if (fallbackResults.rows.length === 0) {
      return {
        success: true,
        message: 'No forum discussions found matching your query. The forum database may be empty or syncing.',
        data: [],
        count: 0,
        searchMode: 'text',
      };
    }

    const posts = (fallbackResults.rows as any[]).map(row => ({
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
      relevance: null,
    }));

    return {
      success: true,
      data: posts,
      count: posts.length,
      message: `Found ${posts.length} forum discussion${posts.length !== 1 ? 's' : ''} (keyword match)`,
      searchMode: 'text',
    };
  } catch (textErr: any) {
    console.error('[searchForumDiscussions] Text search also failed:', textErr.message);
    return {
      success: false,
      message: 'Forum search is temporarily unavailable. Please try again shortly.',
      data: [],
      count: 0,
    };
  }
}

export async function searchMarketNews(params: {
  query: string;
  limit?: number;
}) {
  const { query, limit = 10 } = params;
  const safeLimit = Math.min(limit, 20);

  // Try vector (semantic) search first; fall back to plain-text if embedding fails
  try {
    const queryEmbedding = await generateEmbedding(query);
    const embeddingVector = JSON.stringify(queryEmbedding);

    const results = await db.execute(sql`
      SELECT
        mn.id,
        mn.title,
        mn.snippet,
        mn.url,
        mn.source,
        mn.query as search_query,
        mn.fetched_at,
        1 - (mne.embedding <=> ${embeddingVector}::vector) as relevance
      FROM market_news_embeddings mne
      JOIN market_news mn ON mne.article_id = mn.id
      ORDER BY mne.embedding <=> ${embeddingVector}::vector
      LIMIT ${safeLimit}
    `);

    if (results.rows.length > 0) {
      const articles = (results.rows as any[]).map(row => ({
        id: row.id,
        title: row.title,
        snippet: row.snippet,
        url: row.url,
        source: row.source,
        topic: row.search_query,
        fetchedAt: row.fetched_at,
        relevance: parseFloat(row.relevance || '0').toFixed(3),
      }));
      return {
        success: true,
        data: articles,
        count: articles.length,
        message: `Found ${articles.length} relevant market news article${articles.length !== 1 ? 's' : ''}`,
        searchMode: 'semantic',
      };
    }
    // Vector search returned nothing — fall through to text search
  } catch (embeddingErr: any) {
    // Embedding or vector search failed (API down, quota, no embeddings yet) — fall through to text search
    console.warn('[searchMarketNews] Vector search failed, falling back to text search:', embeddingErr.message);
  }

  // Fallback: plain text search on title + snippet
  try {
    const terms = query.split(/\s+/).filter(Boolean).slice(0, 6);
    const likePattern = `%${terms.join('%')}%`;
    const fallbackResults = await db.execute(sql`
      SELECT id, title, snippet, url, source, query as search_query, fetched_at
      FROM market_news
      WHERE title ILIKE ${likePattern}
         OR snippet ILIKE ${likePattern}
         OR query ILIKE ${likePattern}
      ORDER BY fetched_at DESC
      LIMIT ${safeLimit}
    `);

    if (fallbackResults.rows.length === 0) {
      return {
        success: true,
        message: 'No market news found matching your query. The market news database may be empty — enable Market News sync in Settings > Platform Scheduler > Market.',
        data: [],
        count: 0,
        searchMode: 'text',
      };
    }

    const articles = (fallbackResults.rows as any[]).map(row => ({
      id: row.id,
      title: row.title,
      snippet: row.snippet,
      url: row.url,
      source: row.source,
      topic: row.search_query,
      fetchedAt: row.fetched_at,
      relevance: null,
    }));

    return {
      success: true,
      data: articles,
      count: articles.length,
      message: `Found ${articles.length} market news article${articles.length !== 1 ? 's' : ''} (keyword match)`,
      searchMode: 'text',
    };
  } catch (textErr: any) {
    console.error('[searchMarketNews] Text search also failed:', textErr.message);
    return {
      success: false,
      message: 'Market news search is temporarily unavailable. Please try again shortly.',
      data: [],
      count: 0,
    };
  }
}

/**
 * Tool: Semantic search for inventory items using embeddings
 */
export async function semanticSearchInventory(params: {
  query: string;
  limit?: number;
}) {
  const { query, limit = 15 } = params;

  if (!query || query.trim().length === 0) {
    return {
      success: false,
      message: 'Search query is required for semantic search.',
    };
  }

  try {
    const results = await searchInventorySemantic(query.trim(), limit);

    if (!results || (results as any[]).length === 0) {
      return {
        success: true,
        data: [],
        count: 0,
        message: `No inventory items found matching "${query}". Try different search terms.`,
      };
    }

    const items = (results as any[]).map(row => ({
      itemNo: row.item_no,
      itemName: row.item_name || row.content,
      itemType: row.item_type,
      colorName: row.color_name,
      categoryName: row.category_name,
      quantity: Number(row.quantity) || 0,
      unitPrice: row.unit_price,
      newOrUsed: row.new_or_used === 'N' ? 'New' : 'Used',
      similarity: parseFloat(row.similarity || '0').toFixed(3),
    }));

    return {
      success: true,
      data: items,
      count: items.length,
      message: `Found ${items.length} items matching "${query}" by meaning`,
    };
  } catch (error: any) {
    console.error('Error in semantic inventory search:', error);
    return {
      success: false,
      message: error.message || 'Failed to perform semantic search',
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
      description: 'Search the local BrickLink catalog (bl_catalog table) for item details including images, descriptions, dimensions, and weight. Use this when a user asks to SEE a part, wants visual details, or asks about part specifications.',
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
      description: 'Search the local inventory by exact part number, color, category, or text query. Best for structured lookups. For natural language queries like "red castle pieces" or "spaceship parts", prefer semantic_search instead.',
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
      name: 'get_sales_by_category',
      description: 'Analyze sales performance by product category. Returns top-selling categories with revenue, quantity sold, and order count. Essential for answering "what category sells best", "what should we list next", or category-level sales analysis.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of categories to return (default: 10)',
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
      name: 'get_category_throughput',
      description: 'CRITICAL DASHBOARD METRIC: Calculate category sell-through rates (throughput = sales ÷ inventory). Shows which categories have HIGH DEMAND relative to stock levels. Use this to identify: (1) Categories that are selling well vs their inventory (high throughput = restock opportunity), (2) Categories that are overstocked (low throughput = reduce listings). Essential for strategic inventory decisions and answering "what should we stock more of based on demand" or "which categories have best throughput".',
      parameters: {
        type: 'object',
        properties: {
          startDate: {
            type: 'string',
            description: 'Start date for sales analysis (ISO format)',
          },
          endDate: {
            type: 'string',
            description: 'End date for sales analysis (ISO format)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of categories to return (default: 10)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_customer_metrics',
      description: 'CRITICAL DASHBOARD METRIC: Get customer loyalty and repeat purchase metrics. Returns total customers, repeat customer count, repeat rate percentage, average orders per customer, top repeat buyers, and recent new customers. Use this to understand customer loyalty, identify valuable repeat customers, track new customer acquisition, and answer "how many repeat customers do we have" or "what\'s our customer retention".',
      parameters: {
        type: 'object',
        properties: {
          startDate: {
            type: 'string',
            description: 'Start date for customer analysis (ISO format)',
          },
          endDate: {
            type: 'string',
            description: 'End date for customer analysis (ISO format)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_sales_by_geography',
      description: 'Analyze sales performance by geographic location (state or country). Returns order count, total revenue, unique customers, and average order value for each location. Essential for answering "what states sell best", "where are our customers", "sales by location", or geographic analysis. Use groupBy="state" for state-level analysis or groupBy="country" for country-level analysis.',
      parameters: {
        type: 'object',
        properties: {
          groupBy: {
            type: 'string',
            enum: ['state', 'country'],
            description: 'Group results by state or country (default: state)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of locations to return (default: 20)',
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
      name: 'get_business_customers',
      description: 'CRITICAL FOR DEMOGRAPHICS: Get list of all business/corporate customers with company names, order history, and locations. Returns actual company names extracted from shipping addresses. Essential for answering "what businesses buy from us", "list business customers", "show me company names", or "which corporations purchase from us". Returns company name, customer name, order count, revenue, and locations for each business.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of businesses to return (default: 50)',
          },
          sortBy: {
            type: 'string',
            enum: ['orderCount', 'revenue'],
            description: 'Sort by order count or total revenue (default: revenue)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_inventory_aging',
      description: 'Analyze slow-moving inventory by finding items that have been in stock for a long time. Returns items with days in stock, estimated value. Useful for answering "which items are slow-moving", "what inventory should we discount", or identifying aging stock.',
      parameters: {
        type: 'object',
        properties: {
          daysThreshold: {
            type: 'number',
            description: 'Minimum days in stock to include (default: 90)',
          },
          categoryName: {
            type: 'string',
            description: 'Filter by category name',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of items to return (default: 20)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_margin_analysis',
      description: 'Analyze profit margins by item or category. Returns items with unit price, cost, margin dollar amount and percentage. Essential for answering "which items have best margins", "what\'s most profitable to sell", or margin analysis.',
      parameters: {
        type: 'object',
        properties: {
          categoryName: {
            type: 'string',
            description: 'Filter by category name',
          },
          minMarginPercent: {
            type: 'number',
            description: 'Minimum margin percentage to include (default: 0)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of items to return (default: 20)',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_sku_performance',
      description: 'Analyze SKU-level sales performance including velocity (units per day), total revenue, average price, and order frequency. Essential for answering "which SKUs sell fastest", "best performing products", or sales velocity analysis.',
      parameters: {
        type: 'object',
        properties: {
          startDate: {
            type: 'string',
            description: 'Start date for date range filter (ISO format)',
          },
          endDate: {
            type: 'string',
            description: 'End date for date range filter (ISO format)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of SKUs to return (default: 20)',
          },
          minQuantitySold: {
            type: 'number',
            description: 'Minimum total quantity sold to include (default: 1)',
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
  {
    type: 'function',
    function: {
      name: 'search_market_news',
      description: 'Search market news articles for LEGO industry updates, retirement announcements, pricing trends, collectible value changes, supply chain news, and reseller market insights. This searches a periodically-updated database of web news articles relevant to the LEGO reselling business. Use alongside search_forum_discussions for a complete market picture — forums give community/seller chatter, market news gives industry-level developments.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query (e.g., "LEGO retirement 2026", "BrickLink pricing changes", "LEGO collectible value trends")',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of news articles to return (default: 10, max: 20)',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'semantic_search',
      description: 'Search inventory by meaning using AI embeddings. Use this for natural language queries like "red castle bricks", "spaceship windshields", "small transparent pieces", or any descriptive search where the user describes what they want rather than giving a part number. Returns the most semantically similar items from inventory.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Natural language description of what to find (e.g., "large gray castle wall pieces", "transparent colored slope bricks")',
          },
          limit: {
            type: 'number',
            description: 'Maximum results to return (default: 15)',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_agent_signals',
      description: 'Retrieve the most recent signals generated by the specialist background agents (Inventory, Pricing, Market, Orders, Customer). Each agent continuously monitors its domain and writes specific, data-driven observations. Use this when the user asks about the state of the business, wants a briefing, asks what\'s going on, or when any answer would benefit from knowing what the agents have recently observed. This is your primary way to stay current — agents run continuously and their signals are fresher than your training data. Always call this at the start of broad business questions or when asked "what should I know" / "what\'s happening" / "give me a briefing".',
      parameters: {
        type: 'object',
        properties: {
          agents: {
            type: 'array',
            items: { type: 'string', enum: ['catalog', 'inventory', 'pricing', 'market', 'orders', 'customer'] },
            description: 'Which agents to query. Omit (or pass all 6) for a full briefing including catalog intelligence. Pass a subset when the question is domain-specific (e.g., ["pricing"] for a pricing question, ["inventory","orders"] for fulfillment questions, ["catalog"] for market/acquisition opportunities).',
          },
          limit: {
            type: 'number',
            description: 'Max number of signals to return total (default: 20, max: 40).',
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
    
    case 'get_sales_by_category':
      return await getSalesByCategory(params);
    
    case 'get_category_throughput':
      return await getCategoryThroughput(params);
    
    case 'get_customer_metrics':
      return await getCustomerMetrics(params);
    
    case 'get_sales_by_geography':
      return await getSalesByGeography(params);
    
    case 'get_business_customers':
      return await getBusinessCustomers(params);
    
    case 'get_inventory_aging':
      return await getInventoryAging(params);
    
    case 'get_margin_analysis':
      return await getMarginAnalysis(params);
    
    case 'get_sku_performance':
      return await getSkuPerformance(params);
    
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
    
    case 'search_market_news':
      return await searchMarketNews(params);
    
    case 'semantic_search':
      return await semanticSearchInventory(params);
    
    case 'get_agent_signals': {
      const { getAgentSignals } = await import('./agent-team');
      const targetOrg = params._orgId || params.orgId || 'org_planetbrick';
      const agentIds = Array.isArray(params.agents) && params.agents.length > 0 ? params.agents : undefined;
      const signalLimit = Math.min(params.limit || 20, 40);
      const signals = await getAgentSignals(targetOrg, agentIds, signalLimit);
      if (signals.length === 0) {
        return { message: 'No agent signals available yet. Agents run every few hours — check back shortly after startup completes.', signals: [] };
      }
      const grouped: Record<string, typeof signals> = {};
      for (const s of signals) {
        const key = s.agentId || 'general';
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(s);
      }
      return {
        totalSignals: signals.length,
        byAgent: Object.fromEntries(
          Object.entries(grouped).map(([agent, sigs]) => [
            agent,
            sigs.map(s => ({
              urgency: s.urgency,
              category: s.category,
              title: s.title,
              summary: s.summary,
              details: s.details,
              age: `${Math.round((Date.now() - new Date(s.createdAt).getTime()) / (60 * 1000))}m ago`,
            })),
          ])
        ),
      };
    }
    
    default:
      return {
        success: false,
        message: `Unknown tool: ${toolName}`,
      };
  }
}
