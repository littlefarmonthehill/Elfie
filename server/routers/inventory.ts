import { Router } from 'express';
import { asyncRoute, reqOrgId } from '../lib/routeHelpers';
import { apiErrorHandler } from '../middleware/errorHandler';
import { isApproved } from '../auth';
import { db } from '../db';
import { 
  blInventory, blCatalog, priceGuideCache, blCategories, blColors, 
  appSettings, inventoryHistory, brickanalyzerScans, partIdMappings, 
  blApiCalls, setPartRelationships, partRelationships, inventoryLocations, whBins, whShelves, whAisles,
  orderDetails, orders
} from '@shared/schema';
import { 
  eq, sql, and, desc, asc, inArray, like, ilike, or, isNull, isNotNull, 
  gt, gte, lte, ne, count 
} from 'drizzle-orm';
import { z } from 'zod';
import OpenAI from 'openai';
import { getPlatformOpenAIKey, getPlatformSettings } from '../routes';
import { processImageFromUrl, getProcessedPartImage } from '../services/image-proxy';
import { getImagesForLot, readFromStorage } from '../services/user-image-store';
import { 
  syncBricklinkData, fetchPriceOMagicData, searchBricklinkCatalogItem, 
  bricklinkCatalogRequest, calculateSuggestedPriceWithSupply 
} from '../services/bricklink';
import { checkAutomationLimit } from '../services/tierEnforcement';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const resolvedCatalogItemName = (itemNoRef: any, itemTypeRef: any, colorIdRef: any) =>
  sql<string | null>`COALESCE(
    (SELECT item_name FROM bl_catalog WHERE item_no = ${itemNoRef} AND item_type = ${itemTypeRef} ORDER BY (color_id = ${colorIdRef})::int DESC, color_id ASC LIMIT 1),
    (SELECT item_name FROM price_guide_cache WHERE item_no = ${itemNoRef} AND item_type = ${itemTypeRef} AND item_name IS NOT NULL AND item_name != '' LIMIT 1)
  )`;

/**
 * Returns BrickLink item numbers that are Rebrickable 'A' (Alternate) matches
 * for the given BL item number.  Returns [] when the table is empty or no
 * alternates are found — so existing behaviour is fully preserved.
 */
async function findAlternateBlItemNos(blItemNo: string): Promise<string[]> {
  if (!blItemNo) return [];
  try {
    // 1. Resolve Rebrickable ID for the given BL item number (fall back to same value)
    const [mapping] = await db.select({ rebrickableId: partIdMappings.rebrickableId })
      .from(partIdMappings)
      .where(eq(partIdMappings.blId, blItemNo.toUpperCase()))
      .limit(1);
    const rbId = mapping?.rebrickableId ?? blItemNo;

    // 2. Find all type-A relationships involving this Rebrickable ID
    const alts = await db.select({
        childPartNum: partRelationships.childPartNum,
        parentPartNum: partRelationships.parentPartNum,
      })
      .from(partRelationships)
      .where(and(
        eq(partRelationships.relType, 'A'),
        or(
          eq(partRelationships.childPartNum, rbId),
          eq(partRelationships.parentPartNum, rbId),
        )
      ));

    if (alts.length === 0) return [];

    // 3. Collect alternate Rebrickable IDs (exclude the part itself)
    const altRbIds = new Set<string>();
    for (const alt of alts) {
      if (alt.childPartNum !== rbId) altRbIds.add(alt.childPartNum);
      if (alt.parentPartNum !== rbId) altRbIds.add(alt.parentPartNum);
    }
    if (altRbIds.size === 0) return [];

    // 4. Map Rebrickable IDs → BL IDs via part_id_mappings
    const backMappings = await db.select({ blId: partIdMappings.blId, rebrickableId: partIdMappings.rebrickableId })
      .from(partIdMappings)
      .where(inArray(partIdMappings.rebrickableId, Array.from(altRbIds)));

    const mappedRbIds = new Set(backMappings.map(m => m.rebrickableId).filter(Boolean) as string[]);
    const result = new Set<string>(backMappings.map(m => m.blId).filter(Boolean) as string[]);

    // For unmapped Rebrickable IDs assume BL ID === Rebrickable ID (common for most parts)
    for (const rbAltId of altRbIds) {
      if (!mappedRbIds.has(rbAltId)) result.add(rbAltId);
    }

    result.delete(blItemNo.toUpperCase());
    result.delete(blItemNo);
    return Array.from(result);
  } catch {
    return [];
  }
}

async function getOrgSettings(orgId: string) {
  const [existing] = await db.select().from(appSettings).where(eq(appSettings.id, orgId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(appSettings).values({ id: orgId, orgId, aiEnabled: true })
    .onConflictDoUpdate({ target: appSettings.id, set: { orgId, updatedAt: new Date() } }).returning();
  return created;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// 1. GET /inventory
router.get("/inventory", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const searchQuery = req.query.search as string;
  
  const inventoryItems = searchQuery && searchQuery.trim()
    ? await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          itemType: blInventory.itemType,
          colorId: blInventory.colorId,
          colorName: blColors.name,
          colorRgb: blColors.rgb,
          categoryId: blCatalog.categoryId,
          categoryName: blCategories.name,
          quantity: blInventory.quantity,
          newOrUsed: blInventory.newOrUsed,
          unitPrice: blInventory.unitPrice,
          updatedAt: blInventory.updatedAt,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
        .where(and(eq(blInventory.orgId, orgId), eq(blInventory.itemNo, searchQuery.trim())))
    : await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          itemType: blInventory.itemType,
          colorId: blInventory.colorId,
          colorName: blColors.name,
          colorRgb: blColors.rgb,
          categoryId: blCatalog.categoryId,
          categoryName: blCategories.name,
          quantity: blInventory.quantity,
          newOrUsed: blInventory.newOrUsed,
          unitPrice: blInventory.unitPrice,
          updatedAt: blInventory.updatedAt,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
        .where(eq(blInventory.orgId, orgId))
        .limit(100);

  res.json(inventoryItems);
}));

// 2. GET /inventory/count
router.get("/inventory/count", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const [row] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(blInventory)
    .where(eq(blInventory.orgId, orgId));
  res.json({ count: Number(row?.count ?? 0) });
}));

// 3. GET /inventory/stats
router.get("/inventory/stats", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const [stats, colorCount, categoryCount, soldAvgResult] = await Promise.all([
    db.select({
      totalLots: sql<number>`COUNT(*)`,
      totalParts: sql<number>`SUM(${blInventory.quantity})`,
      totalValue: sql<number>`SUM(${blInventory.quantity} * CAST(${blInventory.unitPrice} AS DECIMAL))`,
      totalCost: sql<number>`SUM(${blInventory.quantity} * COALESCE(CAST(${blInventory.myCost} AS DECIMAL), 0))`,
      newParts: sql<number>`SUM(CASE WHEN ${blInventory.newOrUsed} = 'N' THEN ${blInventory.quantity} ELSE 0 END)`,
      usedParts: sql<number>`SUM(CASE WHEN ${blInventory.newOrUsed} = 'U' THEN ${blInventory.quantity} ELSE 0 END)`,
    }).from(blInventory).where(eq(blInventory.orgId, orgId)),

    db.select({ count: sql<number>`COUNT(DISTINCT ${blInventory.colorId})` })
      .from(blInventory).where(eq(blInventory.orgId, orgId)),

    db.select({ count: sql<number>`COUNT(DISTINCT ${blCatalog.categoryId})` })
      .from(blInventory)
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
      .where(eq(blInventory.orgId, orgId)),

    db.execute(sql`
      SELECT COALESCE(SUM(i.quantity * CAST(p.sold_avg_price AS DECIMAL)), 0) AS sold_avg_value
      FROM bl_inventory i
      INNER JOIN price_guide_cache p
        ON UPPER(i.item_no) = p.item_no
       AND i.item_type = p.item_type
       AND COALESCE(i.color_id, 0) = COALESCE(p.color_id, 0)
       AND i.new_or_used = p.new_or_used
      WHERE i.org_id = ${orgId}
        AND p.sold_avg_price IS NOT NULL
        AND CAST(p.sold_avg_price AS DECIMAL) > 0
        AND i.deleted_at IS NULL
    `),
  ]);

  res.json({
    totalLots: Number(stats[0]?.totalLots) || 0,
    totalParts: Number(stats[0]?.totalParts) || 0,
    totalValue: Number(stats[0]?.totalValue) || 0,
    totalCost: Number(stats[0]?.totalCost) || 0,
    totalColors: Number(colorCount[0]?.count) || 0,
    totalCategories: Number(categoryCount[0]?.count) || 0,
    newParts: Number(stats[0]?.newParts) || 0,
    usedParts: Number(stats[0]?.usedParts) || 0,
    soldAvgValue: Number((soldAvgResult as any).rows[0]?.sold_avg_value) || 0,
  });
}));

// 4. GET /inventory/tool-stats
router.get("/inventory/tool-stats", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);

  const [warehouseResult, binsResult, shelvesResult, scansResult] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)` })
      .from(blInventory)
      .leftJoin(inventoryLocations, eq(blInventory.id, inventoryLocations.inventoryId))
      .where(and(
        eq(blInventory.orgId, orgId),
        sql`${inventoryLocations.id} IS NULL`,
        sql`${blInventory.quantity} > 0`
      ))
      .then(r => r[0]),
    db.select({ count: sql<number>`COUNT(*)` })
      .from(whBins)
      .where(and(eq(whBins.orgId, orgId), sql`${whBins.shelfId} IS NULL`))
      .then(r => r[0]),
    db.select({ count: sql<number>`COUNT(*)` })
      .from(whShelves)
      .where(and(eq(whShelves.orgId, orgId), sql`${whShelves.aisleId} IS NULL`))
      .then(r => r[0]),
    db.select({ count: sql<number>`COUNT(*)` })
      .from(brickanalyzerScans)
      .where(and(eq(brickanalyzerScans.orgId, orgId), eq(brickanalyzerScans.status, 'complete')))
      .then(r => r[0]),
  ]);

  res.json({
    warehouseUnassigned: Number(warehouseResult?.count ?? 0),
    binsNotOnShelves: Number(binsResult?.count ?? 0),
    shelvesNotInAisles: Number(shelvesResult?.count ?? 0),
    pendingScans: Number(scansResult?.count ?? 0),
  });
}));

// 5. GET /inventory/variants/:itemNo
router.get("/inventory/variants/:itemNo", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { itemNo } = req.params;
  const result = await db.execute(sql`
    SELECT bi.id, bi.item_no, bi.item_type, bi.color_id, bc.name AS color_name, bc.rgb AS color_rgb,
           bi.new_or_used, bi.quantity, bi.unit_price,
           bi.is_stock_room, bi.stock_room_id, bi.date_created
    FROM bl_inventory bi
    LEFT JOIN bl_colors bc ON bi.color_id = bc.id
    WHERE bi.org_id = ${orgId}
      AND LOWER(bi.item_no) = LOWER(${itemNo})
      AND bi.deleted_at IS NULL
    ORDER BY bi.quantity DESC, bi.color_id NULLS LAST, bi.new_or_used
  `);
  const rows = (result as any).rows ?? [];
  res.json(rows);
}));

// 6. GET /inventory/sets-readiness
router.get("/inventory/sets-readiness", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const result = await db.execute(sql`
    SELECT
      bi.id,
      bi.item_no,
      bi.quantity,
      bi.new_or_used,
      bi.unit_price,
      bi.my_cost,
      bi.completeness,
      bi.is_stock_room,
      bi.stock_room_id,
      bi.description,
      bi.remarks,
      bi.date_created,
      bi.has_instructions,
      bi.has_box,
      bi.pct_complete,
      bi.completeness_notes,
      bi.missing_pieces,
      bi.missing_lots,
      bi.sale_location,
      COALESCE(bc_cat.item_name, bi.item_no) AS item_name,
      bc_cat.image_url,
      bc_cat.thumbnail_url,
      bc_cat.year_released,
      pgc.stock_avg_price,
      pgc.stock_min_price,
      pgc.stock_max_price,
      pgc.stock_total_lots,
      pgc.sold_avg_price,
      pgc.sold_min_price,
      pgc.sold_max_price,
      pgc.sold_total_lots,
      pgc.suggested_price,
      (SELECT STRING_AGG(wb.name, ', ' ORDER BY wb.name)
       FROM inventory_locations il
       JOIN wh_bins wb ON wb.id = il.bin_id
       WHERE il.inventory_id = bi.id AND il.org_id = ${orgId}) AS bin_names
    FROM bl_inventory bi
    LEFT JOIN bl_catalog bc_cat
      ON bc_cat.item_no = bi.item_no
      AND bc_cat.item_type = 'SET'
      AND bc_cat.color_id = 0
    LEFT JOIN price_guide_cache pgc
      ON pgc.item_no = bi.item_no
      AND pgc.item_type = 'SET'
      AND pgc.color_id = -1
      AND pgc.new_or_used = bi.new_or_used
    WHERE bi.org_id = ${orgId}
      AND bi.item_type = 'SET'
      AND bi.deleted_at IS NULL
      AND bi.quantity > 0
    ORDER BY bi.item_no, bi.new_or_used, bi.id
  `);
  const rows: any[] = (result as any).rows ?? [];

  const grouped: Record<string, { itemNo: string; itemName: string; imageUrl: string | null; thumbnailUrl: string | null; yearReleased: number | null; lots: any[] }> = {};
  for (const row of rows) {
    if (!grouped[row.item_no]) {
      grouped[row.item_no] = {
        itemNo: row.item_no,
        itemName: row.item_name ?? row.item_no,
        imageUrl: row.image_url ?? null,
        thumbnailUrl: row.thumbnail_url ?? null,
        yearReleased: row.year_released ?? null,
        lots: [],
      };
    }
    grouped[row.item_no].lots.push({
      id: row.id,
      quantity: row.quantity,
      newOrUsed: row.new_or_used,
      unitPrice: row.unit_price,
      myCost: row.my_cost,
      completeness: row.completeness,
      isStockRoom: row.is_stock_room,
      stockRoomId: row.stock_room_id,
      description: row.description,
      remarks: row.remarks,
      dateCreated: row.date_created,
      hasInstructions: row.has_instructions,
      hasBox: row.has_box,
      pctComplete: row.pct_complete,
      completenessNotes: row.completeness_notes ?? '',
      missingPieces: row.missing_pieces,
      missingLots: row.missing_lots,
      saleLocation: row.sale_location ?? '',
      stockAvgPrice: row.stock_avg_price ?? null,
      stockMinPrice: row.stock_min_price ?? null,
      stockMaxPrice: row.stock_max_price ?? null,
      stockTotalLots: row.stock_total_lots ?? null,
      soldAvgPrice: row.sold_avg_price ?? null,
      soldMinPrice: row.sold_min_price ?? null,
      soldMaxPrice: row.sold_max_price ?? null,
      soldTotalLots: row.sold_total_lots ?? null,
      suggestedPrice: row.suggested_price ?? null,
      binNames: row.bin_names ?? null,
    });
  }

  res.json(Object.values(grouped).sort((a, b) => a.itemNo.localeCompare(b.itemNo)));
}));

// 7. GET /inventory/health
router.get("/inventory/health", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const activeBase = and(eq(blInventory.orgId, orgId), isNull(blInventory.deletedAt), gt(blInventory.quantity, 0));

  const [
    softDeletedRows,
    zeroPricedRows,
    missingCostRows,
    negativeMarginRows,
    missingColorRows,
    duplicateResult,
    deadStockResult,
    stockroomRows,
    productMixResult,
    overPricedResult,
    crossConditionResult,
    obsoleteCatalogResult,
    itemTypeBreakdownResult,
    warehouseCoverageResult,
    warehouseAislesResult,
    warehouseBinCountResult,
  ] = await Promise.all([
    db.execute(sql`
      SELECT
        COUNT(*) as count,
        COUNT(CASE WHEN EXISTS (
          SELECT 1 FROM order_details od WHERE od.bricklink_inventory_id = bi.id
        ) THEN 1 END) as linked_count
      FROM bl_inventory bi
      WHERE bi.org_id = ${orgId} AND bi.deleted_at IS NOT NULL
    `),
    db.select({ count: sql<number>`COUNT(*)` })
      .from(blInventory)
      .where(and(activeBase, or(isNull(blInventory.unitPrice), sql`CAST(${blInventory.unitPrice} AS numeric) = 0`))),
    db.select({ count: sql<number>`COUNT(*)` })
      .from(blInventory)
      .where(and(activeBase, isNull(blInventory.myCost))),
    db.select({ count: sql<number>`COUNT(*)` })
      .from(blInventory)
      .where(and(
        activeBase,
        isNotNull(blInventory.unitPrice),
        isNotNull(blInventory.myCost),
        sql`CAST(${blInventory.unitPrice} AS numeric) < CAST(${blInventory.myCost} AS numeric)`
      )),
    db.select({ count: sql<number>`COUNT(*)` })
      .from(blInventory)
      .where(and(
        activeBase,
        or(eq(blInventory.itemType, 'P'), eq(blInventory.itemType, 'M')),
        or(isNull(blInventory.colorId), eq(blInventory.colorId, 0))
      )),
    db.execute(sql`
      SELECT COALESCE(SUM(group_count), 0) as total_lots, COUNT(*) as group_count
      FROM (
        SELECT item_no, color_id, new_or_used, unit_price, COUNT(*) as group_count
        FROM bl_inventory
        WHERE org_id = ${orgId} AND deleted_at IS NULL AND quantity > 0
        GROUP BY item_no, color_id, new_or_used, unit_price
        HAVING COUNT(*) > 1
      ) dups
    `),
    db.execute(sql`
      SELECT COUNT(*) as count FROM bl_inventory bi
      WHERE bi.org_id = ${orgId}
        AND bi.deleted_at IS NULL AND bi.quantity > 0
        AND NOT EXISTS (
          SELECT 1 FROM order_details od WHERE od.bricklink_inventory_id = bi.id
        )
    `),
    db.select({
      isStockRoom: blInventory.isStockRoom,
      stockRoomId: blInventory.stockRoomId,
      lotCount: sql<number>`COUNT(*)`,
      totalQty: sql<number>`SUM(${blInventory.quantity})`,
      totalValue: sql<number>`SUM(COALESCE(CAST(${blInventory.unitPrice} AS numeric), 0) * ${blInventory.quantity})`,
    })
      .from(blInventory)
      .where(and(eq(blInventory.orgId, orgId), isNull(blInventory.deletedAt), gt(blInventory.quantity, 0)))
      .groupBy(blInventory.isStockRoom, blInventory.stockRoomId),
    db.execute(sql`
      SELECT bc.category_id, bcat.name AS category_name,
             COUNT(bi.id) as lot_count,
             SUM(bi.quantity) as total_qty,
             SUM(COALESCE(CAST(bi.unit_price AS numeric), 0) * bi.quantity) as total_value
      FROM bl_inventory bi
      LEFT JOIN bl_catalog bc ON bi.item_no = bc.item_no AND bi.item_type = bc.item_type
        AND COALESCE(bi.color_id, 0) = bc.color_id
      LEFT JOIN bl_categories bcat ON bc.category_id = bcat.id
      WHERE bi.org_id = ${orgId} AND bi.deleted_at IS NULL AND bi.quantity > 0
      GROUP BY bc.category_id, bcat.name
      ORDER BY lot_count DESC
      LIMIT 12
    `),
    db.execute(sql`
      SELECT COUNT(*) as count FROM bl_inventory bi
      JOIN price_guide_cache pgc ON bi.item_no = pgc.item_no
        AND bi.item_type = pgc.item_type
        AND COALESCE(bi.color_id, 0) = COALESCE(pgc.color_id, 0)
        AND bi.new_or_used = pgc.new_or_used
      WHERE bi.org_id = ${orgId}
        AND bi.deleted_at IS NULL AND bi.quantity > 0
        AND CAST(bi.unit_price AS numeric) > 0
        AND CAST(pgc.stock_max_price AS numeric) > 0
        AND CAST(bi.unit_price AS numeric) > CAST(pgc.stock_max_price AS numeric) * 1.5
    `),
    db.execute(sql`
      SELECT COUNT(*) as group_count, COALESCE(SUM(lot_count), 0) as total_lots
      FROM (
        SELECT item_no, color_id, SUM(cnt) as lot_count
        FROM (
          SELECT item_no, color_id, new_or_used, COUNT(*) as cnt
          FROM bl_inventory
          WHERE org_id = ${orgId} AND deleted_at IS NULL AND quantity > 0
            AND new_or_used IN ('N', 'U')
          GROUP BY item_no, color_id, new_or_used
        ) sub
        GROUP BY item_no, color_id
        HAVING COUNT(DISTINCT new_or_used) > 1
      ) grp
    `),
    db.execute(sql`
      SELECT COUNT(*) as count
      FROM bl_inventory bi
      JOIN bl_catalog bc ON bi.item_no = bc.item_no AND bi.item_type = bc.item_type
        AND COALESCE(bi.color_id, 0) = bc.color_id
      WHERE bi.org_id = ${orgId} AND bi.deleted_at IS NULL AND bi.quantity > 0
        AND (bc.is_obsolete = TRUE OR (bc.alternate_no IS NOT NULL AND bc.alternate_no != ''))
    `),
    db.execute(sql`
      SELECT
        bi.item_type,
        COUNT(*) as lot_count,
        SUM(bi.quantity) as total_qty,
        AVG(NULLIF(CAST(bi.unit_price AS numeric), 0)) as avg_price,
        SUM(bi.quantity * COALESCE(NULLIF(CAST(bi.unit_price AS numeric), 0), 0)) as total_value
      FROM bl_inventory bi
      WHERE bi.org_id = ${orgId} AND bi.deleted_at IS NULL AND bi.quantity > 0
      GROUP BY bi.item_type
      ORDER BY lot_count DESC
    `),
    db.execute(sql`
      SELECT
        COUNT(bi.id) as total_active_lots,
        COUNT(il.id) as located_lots,
        COUNT(bi.id) - COUNT(il.id) as unlocated_lots
      FROM bl_inventory bi
      LEFT JOIN inventory_locations il ON il.inventory_id = bi.id
      WHERE bi.org_id = ${orgId} AND bi.deleted_at IS NULL AND bi.quantity > 0
    `),
    db.execute(sql`
      SELECT
        a.id as aisle_id,
        a.name as aisle_name,
        COUNT(DISTINCT b.id) as bin_count,
        COUNT(DISTINCT il.id) as located_lots,
        COALESCE(SUM(bi.quantity), 0) as total_qty
      FROM wh_aisles a
      LEFT JOIN wh_shelves s ON s.aisle_id = a.id
      LEFT JOIN wh_bins b ON b.shelf_id = s.id
      LEFT JOIN inventory_locations il ON il.bin_id = b.id
      LEFT JOIN bl_inventory bi ON bi.id = il.inventory_id
        AND bi.deleted_at IS NULL AND bi.quantity > 0
      WHERE a.org_id = ${orgId}
      GROUP BY a.id, a.name
      ORDER BY a.name
    `),
    db.select({ totalBins: sql<number>`COUNT(*)` })
      .from(whBins)
      .where(eq(whBins.orgId, orgId)),
  ]);

  const stockroom: Record<string, { lotCount: number; totalQty: number; totalValue: number }> = {};
  for (const row of stockroomRows) {
    const key = row.isStockRoom ? (row.stockRoomId ?? 'A') : 'live';
    const bucket = stockroom[key] ?? (stockroom[key] = { lotCount: 0, totalQty: 0, totalValue: 0 });
    bucket.lotCount += Number(row.lotCount);
    bucket.totalQty += Number(row.totalQty);
    bucket.totalValue += Number(row.totalValue ?? 0);
  }

  const mixRows = (productMixResult as any).rows ?? [];
  const totalLots = mixRows.reduce((s: number, r: any) => s + Number(r.lot_count), 0);
  const topCategory = mixRows[0];
  const concentrationPct = totalLots > 0 && topCategory ? Math.round(Number(topCategory.lot_count) / totalLots * 100) : 0;

  const dupResult = (duplicateResult as any).rows?.[0] ?? {};
  const duplicateGroupCount = Number(dupResult.group_count ?? 0);
  const duplicateLotCount = Number(dupResult.total_lots ?? 0);

  const sdRow = (softDeletedRows as any).rows?.[0] ?? {};
  const softDeletedTotal = Number(sdRow.count ?? 0);
  const softDeletedLinked = Number(sdRow.linked_count ?? 0);

  const ccRow = (crossConditionResult as any).rows?.[0] ?? {};
  const crossConditionGroups = Number(ccRow.group_count ?? 0);
  const crossConditionLots = Number(ccRow.total_lots ?? 0);

  const obsoleteCount = Number(((obsoleteCatalogResult as any).rows?.[0]?.count) ?? 0);

  res.json({
    softDeleted: {
      total: softDeletedTotal,
      linked: softDeletedLinked,
      standalone: softDeletedTotal - softDeletedLinked,
    },
    zeroPriced: Number(zeroPricedRows[0]?.count ?? 0),
    missingCost: Number(missingCostRows[0]?.count ?? 0),
    negativeMargin: Number(negativeMarginRows[0]?.count ?? 0),
    missingColor: Number(missingColorRows[0]?.count ?? 0),
    duplicates: { groups: duplicateGroupCount, lots: duplicateLotCount },
    deadStock: Number(((deadStockResult as any).rows?.[0]?.count) ?? 0),
    overpriced: Number(((overPricedResult as any).rows?.[0]?.count) ?? 0),
    crossConditionDupes: { groups: crossConditionGroups, lots: crossConditionLots },
    obsoleteCatalog: obsoleteCount,
    stockroom,
    productMix: {
      totalCategories: mixRows.length,
      topConcentrationPct: concentrationPct,
      rows: mixRows,
    },
    itemTypeBreakdown: ((itemTypeBreakdownResult as any).rows ?? []).map((r: any) => ({
      itemType: r.item_type as string,
      lotCount: Number(r.lot_count),
      totalQty: Number(r.total_qty),
      avgPrice: Number(r.avg_price ?? 0),
      totalValue: Number(r.total_value ?? 0),
    })),
    warehouseLocation: (() => {
      const covRow = (warehouseCoverageResult as any).rows?.[0] ?? {};
      const totalBins = Number(warehouseBinCountResult[0]?.totalBins ?? 0);
      const aisleRows = (warehouseAislesResult as any).rows ?? [];
      return {
        totalActiveLots: Number(covRow.total_active_lots ?? 0),
        locatedLots: Number(covRow.located_lots ?? 0),
        unlocatedLots: Number(covRow.unlocated_lots ?? 0),
        totalBins,
        aisles: aisleRows.map((r: any) => ({
          aisleId: Number(r.aisle_id),
          aisleName: r.aisle_name as string,
          binCount: Number(r.bin_count ?? 0),
          locatedLots: Number(r.located_lots ?? 0),
          totalQty: Number(r.total_qty ?? 0),
        })),
      };
    })(),
  });
}));

// 8. GET /inventory/health/:category
router.get("/inventory/health/:category", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { category } = req.params;
  const page = Math.max(0, Number(req.query.page ?? 0));
  const limit = 50;
  const offset = page * limit;

  const catalogJoin = sql`bl_catalog bc ON bi.item_no = bc.item_no AND bi.item_type = bc.item_type AND COALESCE(bi.color_id, 0) = bc.color_id`;
  const selectCols = sql`
    bi.id, bi.item_no, bi.item_type, bi.color_id, bi.quantity, bi.unit_price, bi.my_cost,
    bi.new_or_used, bi.is_stock_room, bi.stock_room_id, bi.deleted_at, bi.date_created,
    bc.item_name, bc.color_name, bc.category_id
  `;

  let result: any;

  if (category === 'soft_deleted') {
    result = await db.execute(sql`
      SELECT ${selectCols},
             (EXISTS (SELECT 1 FROM order_details od WHERE od.bricklink_inventory_id = bi.id)) as is_linked
      FROM bl_inventory bi LEFT JOIN ${catalogJoin}
      WHERE bi.org_id = ${orgId} AND bi.deleted_at IS NOT NULL
      ORDER BY bi.deleted_at DESC LIMIT ${limit} OFFSET ${offset}
    `);
  } else if (category === 'zero_priced') {
    result = await db.execute(sql`
      SELECT ${selectCols}
      FROM bl_inventory bi LEFT JOIN ${catalogJoin}
      WHERE bi.org_id = ${orgId} AND bi.deleted_at IS NULL AND bi.quantity > 0
        AND (bi.unit_price IS NULL OR CAST(bi.unit_price AS numeric) = 0)
      ORDER BY bi.quantity DESC LIMIT ${limit} OFFSET ${offset}
    `);
  } else if (category === 'missing_cost') {
    result = await db.execute(sql`
      SELECT ${selectCols}
      FROM bl_inventory bi LEFT JOIN ${catalogJoin}
      WHERE bi.org_id = ${orgId} AND bi.deleted_at IS NULL AND bi.quantity > 0
        AND bi.my_cost IS NULL
      ORDER BY COALESCE(CAST(bi.unit_price AS numeric), 0) * bi.quantity DESC LIMIT ${limit} OFFSET ${offset}
    `);
  } else if (category === 'negative_margin') {
    result = await db.execute(sql`
      SELECT ${selectCols},
             CAST(bi.unit_price AS numeric) - CAST(bi.my_cost AS numeric) as margin
      FROM bl_inventory bi LEFT JOIN ${catalogJoin}
      WHERE bi.org_id = ${orgId} AND bi.deleted_at IS NULL AND bi.quantity > 0
        AND bi.unit_price IS NOT NULL AND bi.my_cost IS NOT NULL
        AND CAST(bi.unit_price AS numeric) < CAST(bi.my_cost AS numeric)
      ORDER BY (CAST(bi.unit_price AS numeric) - CAST(bi.my_cost AS numeric)) ASC LIMIT ${limit} OFFSET ${offset}
    `);
  } else if (category === 'missing_color') {
    result = await db.execute(sql`
      SELECT ${selectCols}
      FROM bl_inventory bi LEFT JOIN ${catalogJoin}
      WHERE bi.org_id = ${orgId} AND bi.deleted_at IS NULL AND bi.quantity > 0
        AND bi.item_type IN ('P', 'M')
        AND (bi.color_id IS NULL OR bi.color_id = 0)
      ORDER BY bi.quantity DESC LIMIT ${limit} OFFSET ${offset}
    `);
  } else if (category === 'duplicates') {
    result = await db.execute(sql`
      SELECT ${selectCols}
      FROM bl_inventory bi LEFT JOIN ${catalogJoin}
      WHERE bi.org_id = ${orgId} AND bi.deleted_at IS NULL AND bi.quantity > 0
        AND EXISTS (
          SELECT 1 FROM bl_inventory bi2
          WHERE bi2.org_id = ${orgId} AND bi2.deleted_at IS NULL AND bi2.quantity > 0
            AND bi2.id != bi.id
            AND bi2.item_no = bi.item_no
            AND COALESCE(bi2.color_id, 0) = COALESCE(bi.color_id, 0)
            AND bi2.new_or_used = bi.new_or_used
            AND (bi2.unit_price = bi.unit_price OR (bi2.unit_price IS NULL AND bi.unit_price IS NULL))
        )
      ORDER BY bi.item_no, bi.color_id, bi.new_or_used, bi.unit_price LIMIT ${limit} OFFSET ${offset}
    `);
  } else if (category === 'dead_stock') {
    result = await db.execute(sql`
      SELECT ${selectCols}
      FROM bl_inventory bi LEFT JOIN ${catalogJoin}
      WHERE bi.org_id = ${orgId} AND bi.deleted_at IS NULL AND bi.quantity > 0
        AND NOT EXISTS (SELECT 1 FROM order_details od WHERE od.bricklink_inventory_id = bi.id)
      ORDER BY bi.quantity DESC LIMIT ${limit} OFFSET ${offset}
    `);
  } else if (category === 'overpriced') {
    result = await db.execute(sql`
      SELECT ${selectCols},
             CAST(pgc.stock_max_price AS numeric) as market_ceiling,
             ROUND((CAST(bi.unit_price AS numeric) / CAST(pgc.stock_max_price AS numeric) - 1) * 100, 1) as pct_above
      FROM bl_inventory bi
      LEFT JOIN ${catalogJoin}
      JOIN price_guide_cache pgc ON bi.item_no = pgc.item_no AND bi.item_type = pgc.item_type
        AND COALESCE(bi.color_id, 0) = COALESCE(pgc.color_id, 0)
        AND bi.new_or_used = pgc.new_or_used
      WHERE bi.org_id = ${orgId} AND bi.deleted_at IS NULL AND bi.quantity > 0
        AND CAST(bi.unit_price AS numeric) > 0
        AND CAST(pgc.stock_max_price AS numeric) > 0
        AND CAST(bi.unit_price AS numeric) > CAST(pgc.stock_max_price AS numeric) * 1.5
      ORDER BY pct_above DESC LIMIT ${limit} OFFSET ${offset}
    `);
  } else if (category === 'cross_condition_dupes') {
    result = await db.execute(sql`
      SELECT ${selectCols}
      FROM bl_inventory bi LEFT JOIN ${catalogJoin}
      WHERE bi.org_id = ${orgId} AND bi.deleted_at IS NULL AND bi.quantity > 0
        AND bi.new_or_used IN ('N', 'U')
        AND (bi.item_no, COALESCE(bi.color_id, 0)) IN (
          SELECT item_no, COALESCE(color_id, 0)
          FROM bl_inventory
          WHERE org_id = ${orgId} AND deleted_at IS NULL AND quantity > 0
            AND new_or_used IN ('N', 'U')
          GROUP BY item_no, COALESCE(color_id, 0)
          HAVING COUNT(DISTINCT new_or_used) > 1
        )
      ORDER BY bi.item_no, bi.color_id, bi.new_or_used LIMIT ${limit} OFFSET ${offset}
    `);
  } else if (category === 'obsolete_catalog') {
    result = await db.execute(sql`
      SELECT ${selectCols}, bc.alternate_no, bc.is_obsolete
      FROM bl_inventory bi
      LEFT JOIN bl_catalog bc ON bi.item_no = bc.item_no AND bi.item_type = bc.item_type
        AND COALESCE(bi.color_id, 0) = bc.color_id
      WHERE bi.org_id = ${orgId} AND bi.deleted_at IS NULL AND bi.quantity > 0
        AND (bc.is_obsolete = TRUE OR (bc.alternate_no IS NOT NULL AND bc.alternate_no != ''))
      ORDER BY bi.quantity DESC LIMIT ${limit} OFFSET ${offset}
    `);
  } else {
    return res.status(404).json({ error: 'Unknown health category' });
  }

  const rows = (result as any).rows ?? [];
  res.json({ rows, page, limit });
}));

// 9. GET /inventory/history
router.get("/inventory/history", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const page  = Math.max(0, Number(req.query.page ?? 0));
  const limit = 50;
  const offset = page * limit;
  const source  = req.query.source  as string | undefined;
  const fields  = req.query.fields  as string | undefined;
  const sources = req.query.sources as string | undefined;
  const inventoryId = req.query.inventoryId ? Number(req.query.inventoryId) : null;

  const fieldList  = fields  ? fields.split(',').map(s => s.trim()).filter(Boolean)  : null;
  const sourceList = sources ? sources.split(',').map(s => s.trim()).filter(Boolean) : null;

  const rows = await db.execute(sql`
    SELECT
      ih.id,
      ih.inventory_id,
      ih.item_no,
      ih.color_id,
      ih.changed_at,
      ih.source,
      ih.source_ref,
      ih.field,
      ih.old_value,
      ih.new_value,
      bc.item_name,
      bc.color_name
    FROM inventory_history ih
    LEFT JOIN bl_catalog bc
      ON ih.item_no = bc.item_no
     AND bc.item_type IN ('P','M','S','G','B','C','I','O','U')
     AND COALESCE(ih.color_id, 0) = bc.color_id
    WHERE ih.org_id = ${orgId}
      ${source      ? sql`AND ih.source = ${source}`                                                          : sql``}
      ${sourceList  ? sql`AND ih.source IN (${sql.join(sourceList.map(s => sql`${s}`), sql`, `)})`            : sql``}
      ${fieldList   ? sql`AND ih.field  IN (${sql.join(fieldList.map(f => sql`${f}`),  sql`, `)})`            : sql``}
      ${inventoryId ? sql`AND ih.inventory_id = ${inventoryId}`                                               : sql``}
    ORDER BY ih.changed_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  res.json({ rows: (rows as any).rows ?? [], page, limit });
}));

// 10. GET /images/proxy
router.get("/images/proxy", asyncRoute(async (req, res) => {
  const imageUrl = req.query.url as string;

  if (!imageUrl) {
    return res.status(400).json({ error: "Missing url parameter" });
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
  } catch {
    return res.status(400).json({ error: "Invalid URL format" });
  }

  if (parsedUrl.protocol !== 'https:') {
    return res.status(400).json({ error: "Only HTTPS URLs are allowed" });
  }

  if (parsedUrl.hostname !== 'cdn.rebrickable.com') {
    return res.status(400).json({ error: "Only cdn.rebrickable.com URLs are allowed" });
  }

  const normalizedUrl = parsedUrl.toString();
  const imageBuffer = await processImageFromUrl(normalizedUrl);

  if (!imageBuffer) {
    return res.status(404).json({ error: "Image not found or failed to process" });
  }

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(imageBuffer);
}));

// 11. GET /images/parts/:partNum/:colorId
router.get("/images/parts/:partNum/:colorId", asyncRoute(async (req, res) => {
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
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(imageBuffer);
}));

// GET /images/lot/:lotId — global image resolver
// Priority: user-assigned images (lot-level → item-type-level) → catalog image
// This is the single source of truth for displaying an image for any BL inventory lot.
router.get("/images/lot/:lotId", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const lotId = parseInt(req.params.lotId, 10);
  if (isNaN(lotId)) return res.status(400).json({ error: 'Invalid lot ID' });

  const [lot] = await db
    .select({ itemNo: blInventory.itemNo, itemType: blInventory.itemType, colorId: blInventory.colorId })
    .from(blInventory)
    .where(and(eq(blInventory.id, lotId), eq(blInventory.orgId, orgId)))
    .limit(1);

  if (!lot) return res.status(404).json({ error: 'Lot not found' });

  // Check user-assigned images first (lot-level, then item-type-level)
  try {
    const { lotLevel, itemTypeLevel } = await getImagesForLot({
      orgId,
      blInventoryId: lotId,
      itemNo: lot.itemNo,
      itemType: lot.itemType,
    });
    const userImg = lotLevel[0] ?? itemTypeLevel[0] ?? null;
    if (userImg) {
      const bytes = await readFromStorage(userImg.storageKey);
      if (bytes) {
        res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' });
        return res.end(bytes);
      }
    }
  } catch { /* fall through to catalog */ }

  // Fall back to catalog image
  const imageBuffer = await getProcessedPartImage(lot.itemNo, lot.colorId ?? 0);
  if (!imageBuffer) return res.status(404).json({ error: 'Image not found' });

  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(imageBuffer);
}));

// 12. GET /inventory/recent-updates
router.get("/inventory/recent-updates", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
  const type = req.query.type as string; 
  
  const baseSelect = {
    id: blInventory.id,
    inventoryId: blInventory.id,
    itemNo: blInventory.itemNo,
    itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
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
    recentItems = await db
      .select(baseSelect)
      .from(blInventory)
      .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
      .where(and(eq(blInventory.orgId, orgId), sql`EXTRACT(EPOCH FROM (${blInventory.updatedAt} - ${blInventory.syncedAt})) < 5`))
      .orderBy(desc(blInventory.syncedAt))
      .limit(limit);
  } else if (type === 'updated') {
    recentItems = await db
      .select(baseSelect)
      .from(blInventory)
      .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
      .where(and(eq(blInventory.orgId, orgId), sql`EXTRACT(EPOCH FROM (${blInventory.updatedAt} - ${blInventory.syncedAt})) >= 5`))
      .orderBy(desc(blInventory.updatedAt))
      .limit(limit);
  } else {
    recentItems = await db
      .select(baseSelect)
      .from(blInventory)
      .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
      .where(eq(blInventory.orgId, orgId))
      .orderBy(desc(blInventory.updatedAt))
      .limit(limit);
  }

  res.json(recentItems);
}));

// 13. GET /inventory/price-guide/:itemNo/:itemType
router.get("/inventory/price-guide/:itemNo/:itemType", isApproved, asyncRoute(async (req, res) => {
  const { itemNo, itemType } = req.params;
  const colorId = req.query.color_id ? parseInt(req.query.color_id as string) : undefined;
  const newOrUsed = (req.query.new_or_used as string) || 'N';
  const premiumPercentage = req.query.premium ? parseInt(req.query.premium as string) : 15;

  if (!itemNo || !itemType) {
    return res.status(400).json({ error: "Item number and type are required" });
  }

  const priceData = await fetchPriceOMagicData(itemNo, itemType, colorId, newOrUsed, premiumPercentage);
  res.json(priceData);
}));

// 14. GET /inventory/price-guide-full/:itemNo/:itemType
router.get("/inventory/price-guide-full/:itemNo/:itemType", isApproved, asyncRoute(async (req: any, res) => {
  const { itemNo, itemType } = req.params;
  const colorId = req.query.color_id ? parseInt(req.query.color_id as string) : null;
  const myCondition = (req.query.new_or_used as string) || 'N';
  const orgId = reqOrgId(req);

  if (!itemNo || !itemType) {
    return res.status(400).json({ error: "Item number and type are required" });
  }

  const colorCondition = colorId != null && colorId > 0
    ? eq(priceGuideCache.colorId, colorId)
    : sql`${priceGuideCache.colorId} IN (0, -1)`;

  const rows = await db
    .select({
      newOrUsed: priceGuideCache.newOrUsed,
      stockAvgPrice: priceGuideCache.stockAvgPrice,
      stockMinPrice: priceGuideCache.stockMinPrice,
      stockMaxPrice: priceGuideCache.stockMaxPrice,
      stockTotalLots: priceGuideCache.stockTotalLots,
      stockQuantity: sql<number>`${priceGuideCache.stockTotalLots}`,
      soldAvgPrice: priceGuideCache.soldAvgPrice,
      soldMinPrice: priceGuideCache.soldMinPrice,
      soldMaxPrice: priceGuideCache.soldMaxPrice,
      soldTotalLots: priceGuideCache.soldTotalLots,
      soldQuantity: sql<number>`${priceGuideCache.soldTotalLots}`,
      suggestedPrice: priceGuideCache.suggestedPrice,
      premiumPercentage: priceGuideCache.premiumPercentage,
      fetchedAt: priceGuideCache.fetchedAt,
    })
    .from(priceGuideCache)
    .where(and(
      sql`UPPER(${priceGuideCache.itemNo}) = UPPER(${itemNo})`,
      eq(priceGuideCache.itemType, itemType),
      colorCondition,
    ));

  const nRow = rows.find(r => r.newOrUsed === 'N') || null;
  const uRow = rows.find(r => r.newOrUsed === 'U') || null;

  const settings = await getOrgSettings(orgId);
  const wCeiling = settings?.pomWeightCeiling ?? 0.4;
  const wVelocity = settings?.pomWeightVelocity ?? 0.3;
  const wScarcity = settings?.pomWeightScarcity ?? 0.2;
  const wUndercut = settings?.pomWeightUndercut ?? 0.1;

  const myRow = myCondition === 'U' ? uRow : nRow;
  const soldQty = myRow?.soldQuantity ?? null;
  const stockQty = myRow?.stockQuantity ?? null;
  const stockMin = parseFloat(myRow?.stockMinPrice || '0');

  const currentPriceStr = req.query.current_price as string;
  const currentPrice = currentPriceStr ? parseFloat(currentPriceStr) : 0;

  const marketPeakRows = await db
    .select({ peakSold: sql<string>`MAX(${priceGuideCache.soldMaxPrice})` })
    .from(priceGuideCache)
    .where(and(
      sql`UPPER(${priceGuideCache.itemNo}) = UPPER(${itemNo})`,
      eq(priceGuideCache.itemType, itemType),
      colorCondition,
    ));
  const marketPeak = marketPeakRows[0]?.peakSold ? parseFloat(marketPeakRows[0].peakSold) : null;

  const soldAvgForSpot = myRow?.soldAvgPrice ? parseFloat(myRow.soldAvgPrice) : null;
  const soldLotsForSpot = myRow?.soldTotalLots ? Number(myRow.soldTotalLots) : 0;
  const spotConfidence = Math.min(1, soldLotsForSpot / 10);
  const spotBlendedRef = (soldAvgForSpot !== null && marketPeak !== null)
    ? soldAvgForSpot * 0.6 + marketPeak * 0.4
    : (soldAvgForSpot ?? marketPeak);
  const priceCeilingRatio = (spotBlendedRef !== null && spotBlendedRef > 0 && currentPrice > 0)
    ? Number(((spotBlendedRef / currentPrice) * Math.max(0.2, spotConfidence)).toFixed(3))
    : null;
  const demandVelocity = (soldQty != null && stockQty != null && stockQty > 0)
    ? Number((soldQty / stockQty).toFixed(3))
    : null;
  const scarcityDenom = myRow?.stockQuantity ?? myRow?.stockTotalLots ?? null;
  const marketScarcityVal = (scarcityDenom != null && scarcityDenom > 0)
    ? Number((1 / scarcityDenom).toFixed(6))
    : null;
  const undercutRatio = (stockMin > 0 && currentPrice > 0)
    ? Number((currentPrice / stockMin).toFixed(3))
    : null;

  let repricingScore: number | null = null;
  const hasAny = priceCeilingRatio !== null || demandVelocity !== null || marketScarcityVal !== null || undercutRatio !== null;
  if (hasAny) {
    const cC = (priceCeilingRatio ?? 0) * wCeiling;
    const vC = Math.min(1, demandVelocity ?? 0) * wVelocity;
    const sC = (marketScarcityVal ?? 0) * wScarcity;
    const uC = (undercutRatio && undercutRatio > 0) ? (1 - undercutRatio) * wUndercut : 0;
    repricingScore = Number((cC + vC + sC + uC).toFixed(2));
  }

  const computeSuggested = (row: any) => {
    if (!row) return null;
    if (row.suggestedPrice && parseFloat(row.suggestedPrice) > 0) return row.suggestedPrice;
    const soldAvg = parseFloat(row.soldAvgPrice || '0');
    const soldMax = parseFloat(row.soldMaxPrice || '0');
    const stkMin = parseFloat(row.stockMinPrice || '0');
    const sQty = row.soldQuantity ?? null;
    const lQty = row.stockQuantity ?? null;
    if (soldAvg <= 0 && stkMin <= 0) return null;
    const base = (soldAvg > 0 ? soldAvg * 0.5 : 0) + (stkMin > 0 ? stkMin * 0.3 : 0) + (soldMax > 0 ? soldMax * 0.2 : 0);
    if (base <= 0) return null;
    const vel = (sQty != null && lQty != null && lQty > 0) ? sQty / lQty : 0;
    const demandAdj = 1 + vel * 0.25;
    const raw = base * demandAdj;
    const capLimit = stkMin > 0 ? stkMin * 1.15 : raw;
    const cappedRaw = raw <= capLimit ? raw : capLimit + (raw - capLimit) * 0.3;
    const floor = stkMin > 0 ? stkMin * 0.95 : 0;
    const suggested = Math.max(cappedRaw * 1.10, floor);
    return suggested.toFixed(2);
  };

  res.json({
    N: nRow ? {
      soldQty: nRow.soldQuantity ?? null,
      soldTotalLots: nRow.soldTotalLots ?? null,
      soldMin: nRow.soldMinPrice,
      soldAvg: nRow.soldAvgPrice,
      soldMax: nRow.soldMaxPrice,
      listedQty: nRow.stockQuantity ?? null,
      listedTotalLots: nRow.stockTotalLots ?? null,
      listedMin: nRow.stockMinPrice,
      listedAvg: nRow.stockAvgPrice,
      listedMax: nRow.stockMaxPrice,
      suggestedPrice: computeSuggested(nRow),
    } : null,
    U: uRow ? {
      soldQty: uRow.soldQuantity ?? null,
      soldTotalLots: uRow.soldTotalLots ?? null,
      soldMin: uRow.soldMinPrice,
      soldAvg: uRow.soldAvgPrice,
      soldMax: uRow.soldMaxPrice,
      listedQty: uRow.stockQuantity ?? null,
      listedTotalLots: uRow.stockTotalLots ?? null,
      listedMin: uRow.stockMinPrice,
      listedAvg: uRow.stockAvgPrice,
      listedMax: uRow.stockMaxPrice,
      suggestedPrice: computeSuggested(uRow),
    } : null,
    scoring: {
      ceiling: priceCeilingRatio,
      velocity: demandVelocity,
      scarcity: marketScarcityVal,
      undercut: undercutRatio,
      score: repricingScore,
      weights: { wCeiling, wVelocity, wScarcity, wUndercut },
    },
    fetchedAt: myRow?.fetchedAt ?? null,
  });
}));

// 15. GET /colors
router.get("/colors", isApproved, asyncRoute(async (req, res) => {
  const colors = await db
    .select({ id: blColors.id, name: blColors.name, rgb: blColors.rgb })
    .from(blColors)
    .orderBy(blColors.name);
  res.json(colors);
}));

// 16. GET /bricklink/catalog/:itemNo/:itemType
router.get("/bricklink/catalog/:itemNo/:itemType", isApproved, asyncRoute(async (req, res) => {
  const { itemNo, itemType } = req.params;
  if (!itemNo || !itemType) {
    return res.status(400).json({ error: "Item number and type are required" });
  }
  const itemData = await searchBricklinkCatalogItem(itemNo, itemType);
  res.json(itemData);
}));

// 17. GET /inventory/browse
router.get("/inventory/browse", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const type = (req.query.type as string) || 'lots';
  const page = Math.max(0, parseInt(req.query.page as string) || 0);
  const limit = 100;
  const offset = page * limit;
  const search = (req.query.search as string || '').trim();

  if (type === 'categories') {
    const searchWhere = search
      ? and(eq(blInventory.orgId, orgId), ilike(blCategories.name, `%${search}%`))
      : eq(blInventory.orgId, orgId);
    const rows = await db
      .select({
        categoryId: blCatalog.categoryId,
        categoryName: blCategories.name,
        lotCount: count(blInventory.id),
        totalQty: sql<number>`SUM(${blInventory.quantity})`,
      })
      .from(blInventory)
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
      .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
      .where(searchWhere)
      .groupBy(blCatalog.categoryId, blCategories.name)
      .orderBy(asc(blCategories.name))
      .limit(limit)
      .offset(offset);
    const [{ total }] = await db
      .select({ total: sql<number>`COUNT(DISTINCT ${blCatalog.categoryId})` })
      .from(blInventory)
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
      .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
      .where(searchWhere);
    return res.json({ rows, total, page, limit });
  }

  const searchWhere = search
    ? and(
        eq(blInventory.orgId, orgId),
        or(
          ilike(blInventory.itemNo, `%${search}%`),
          ilike(blCatalog.itemName, `%${search}%`),
          ilike(blColors.name, `%${search}%`),
          sql`${blInventory.id}::text ILIKE ${'%' + search + '%'}`,
        )
      )
    : eq(blInventory.orgId, orgId);

  const orderBy = type === 'parts'
    ? desc(blInventory.quantity)
    : asc(blInventory.itemNo);

  // Shared select shape
  const browseSelect = {
    id: blInventory.id,
    itemNo: blInventory.itemNo,
    itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
    itemType: blInventory.itemType,
    colorId: blInventory.colorId,
    colorName: blColors.name,
    colorRgb: blColors.rgb,
    categoryName: blCategories.name,
    quantity: blInventory.quantity,
    newOrUsed: blInventory.newOrUsed,
    unitPrice: blInventory.unitPrice,
  };

  const rows = await db
    .select(browseSelect)
    .from(blInventory)
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
    .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
    .where(searchWhere)
    .orderBy(orderBy)
    .limit(limit)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: sql<number>`COUNT(*)` })
    .from(blInventory)
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
    .where(searchWhere);

  // When search looks like an exact part number, fetch alternate lots as a bonus section
  // (doesn't affect pagination — appended after primary results)
  let alternateRows: (typeof rows[number] & { alternateOf?: string })[] = [];
  const looksLikePartNo = search && /^[a-zA-Z0-9][a-zA-Z0-9\-_]{0,24}$/.test(search) && !search.includes(' ');
  if (looksLikePartNo && page === 0) {
    const altItemNos = await findAlternateBlItemNos(search);
    if (altItemNos.length > 0) {
      const existingIds = new Set(rows.map(r => r.id));
      const altWhere = and(eq(blInventory.orgId, orgId), inArray(blInventory.itemNo, altItemNos));
      const altResults = await db
        .select(browseSelect)
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
        .where(altWhere)
        .orderBy(asc(blInventory.itemNo))
        .limit(50);
      alternateRows = altResults
        .filter(r => !existingIds.has(r.id))
        .map(r => ({ ...r, alternateOf: search.toUpperCase() }));
    }
  }

  res.json({ rows: [...rows, ...alternateRows], total, page, limit });
}));

// 18. GET /inventory/search
router.get("/inventory/search", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { itemNo, colorId, limit = 10 } = req.query;

  if (!itemNo || typeof itemNo !== 'string') {
    return res.status(400).json({ error: "itemNo is required" });
  }

  const parsedColorId = colorId ? parseInt(colorId as string) : null;

  const whereClause = parsedColorId != null
    ? and(eq(blInventory.orgId, orgId), eq(blInventory.itemNo, itemNo), eq(blInventory.colorId, parsedColorId))
    : and(eq(blInventory.orgId, orgId), eq(blInventory.itemNo, itemNo));

  const searchSelect = {
    id: blInventory.id,
    itemNo: blInventory.itemNo,
    itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
    colorId: blInventory.colorId,
    colorName: blColors.name,
    newOrUsed: blInventory.newOrUsed,
    quantity: blInventory.quantity,
  };

  const inventoryLots = await db
    .select(searchSelect)
    .from(blInventory)
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
    .where(whereClause)
    .limit(parseInt(limit as string) || 10);

  // Append alternates so callers (e.g. catalog click) can find existing lots for alternate part numbers
  const altItemNos = await findAlternateBlItemNos(itemNo);
  let alternateLots: (typeof inventoryLots[number] & { isAlternate?: boolean; alternateOf?: string })[] = [];
  if (altItemNos.length > 0) {
    const existingIds = new Set(inventoryLots.map(l => l.id));
    const altWhere = parsedColorId != null
      ? and(eq(blInventory.orgId, orgId), inArray(blInventory.itemNo, altItemNos), eq(blInventory.colorId, parsedColorId))
      : and(eq(blInventory.orgId, orgId), inArray(blInventory.itemNo, altItemNos));
    const altResults = await db
      .select(searchSelect)
      .from(blInventory)
      .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
      .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
      .where(altWhere)
      .limit(20);
    alternateLots = altResults
      .filter(l => !existingIds.has(l.id))
      .map(l => ({ ...l, isAlternate: true, alternateOf: itemNo }));
  }

  res.json([...inventoryLots, ...alternateLots]);
}));

// 19. GET /catalog/lookup/:itemType/:itemNo
router.get("/catalog/lookup/:itemType/:itemNo", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { itemType, itemNo } = req.params;
  const colorId = req.query.colorId !== undefined ? parseInt(req.query.colorId as string) : undefined;

  const itemTypeMap: Record<string, string> = {
    PART: 'PART', MINIFIG: 'MINIFIG', SET: 'SET', BOOK: 'BOOK', GEAR: 'GEAR', CATALOG: 'CATALOG', INSTRUCTION: 'INSTRUCTION',
  };
  const itemTypePrefix: Record<string, string> = {
    PART: 'P', MINIFIG: 'M', SET: 'S', BOOK: 'B', GEAR: 'G', CATALOG: 'C', INSTRUCTION: 'I',
  };
  const blUrlPrefix = itemTypePrefix[itemType?.toUpperCase()] ?? 'P';
  const apiItemType = itemTypeMap[itemType?.toUpperCase()] ?? itemType?.toUpperCase();

  const catalogRow = await db.select()
    .from(blCatalog)
    .where(and(
      eq(blCatalog.itemNo, itemNo),
      eq(blCatalog.itemType, itemType),
      colorId != null ? eq(blCatalog.colorId, colorId) : eq(blCatalog.colorId, 0)
    ))
    .limit(1);
  let catalog = catalogRow[0];

  if (!catalog?.imageUrl) {
    try {
      const { data } = await bricklinkCatalogRequest(`/items/${apiItemType}/${itemNo}`, undefined, orgId);
      if (data) {
        const rawImage = data.image_url as string | null | undefined;
        const rawThumb = data.thumbnail_url as string | null | undefined;
        const imageUrl = rawImage?.startsWith('//') ? `https:${rawImage}` : (rawImage ?? null);
        const thumbnailUrl = rawThumb?.startsWith('//') ? `https:${rawThumb}` : (rawThumb ?? null);

        await db.insert(blCatalog).values({
          itemNo,
          itemType,
          colorId: colorId ?? 0,
          itemName: data.name || null,
          categoryId: data.category_id || null,
          blCatalogWeight: data.weight ? String(data.weight) : null,
          yearReleased: data.year_released || null,
          imageUrl,
          thumbnailUrl,
        }).onConflictDoUpdate({
          target: [blCatalog.itemNo, blCatalog.itemType, blCatalog.colorId],
          set: {
            itemName: sql`COALESCE(EXCLUDED.item_name, bl_catalog.item_name)`,
            categoryId: sql`COALESCE(EXCLUDED.category_id, bl_catalog.category_id)`,
            imageUrl: sql`COALESCE(EXCLUDED.image_url, bl_catalog.image_url)`,
            thumbnailUrl: sql`COALESCE(EXCLUDED.thumbnail_url, bl_catalog.thumbnail_url)`,
            yearReleased: sql`COALESCE(EXCLUDED.year_released, bl_catalog.year_released)`,
            updatedAt: sql`NOW()`,
          },
        });

        const refreshed = await db.select().from(blCatalog)
          .where(and(
            eq(blCatalog.itemNo, itemNo),
            eq(blCatalog.itemType, itemType),
            colorId != null ? eq(blCatalog.colorId, colorId) : eq(blCatalog.colorId, 0)
          ))
          .limit(1);
        catalog = refreshed[0] ?? catalog;
      }
    } catch (blErr: any) {
      console.warn(`[catalog/lookup] BL API item detail fetch failed for ${itemType}/${itemNo}:`, blErr.message);
    }
  }

  const pomData = await fetchPriceOMagicData(
    itemNo, itemType, colorId, 'N', 15, null, false, undefined, undefined, orgId
  );

  let colorName: string | null = null;
  let colorRgb: string | null = null;
  if (colorId != null && colorId > 0) {
    const colorRow = await db.select({ name: blColors.name, rgb: blColors.rgb })
      .from(blColors)
      .where(eq(blColors.id, colorId))
      .limit(1);
    if (colorRow.length > 0) {
      colorName = colorRow[0].name;
      colorRgb = colorRow[0].rgb ?? null;
    }
  }

  const resolvedImageUrl = catalog?.imageUrl ?? pomData.imageUrl ?? null;
  const resolvedThumbnailUrl = catalog?.thumbnailUrl ?? pomData.thumbnailUrl ?? null;

  const responseData = {
    id: `catalog-${itemType}-${itemNo}__c${colorId ?? 0}`,
    itemNo,
    itemName: catalog?.itemName ?? pomData.itemName ?? itemNo,
    itemType,
    categoryId: catalog?.categoryId ?? pomData.categoryId ?? null,
    categoryName: null,
    colorId: colorId ?? null,
    colorName: catalog?.colorName ?? colorName ?? null,
    colorRgb,
    quantity: 0,
    newOrUsed: 'N',
    unitPrice: '0.00',
    myCost: null,
    description: null,
    remarks: null,
    myWeight: catalog?.blCatalogWeight ? String(catalog.blCatalogWeight) : (pomData.weight ? String(pomData.weight) : null),
    isBrickLinkCatalog: true,
    imageUrl: resolvedImageUrl,
    thumbnailUrl: resolvedThumbnailUrl,
    bricklinkUrl: `https://www.bricklink.com/v2/catalog/catalogitem.page?${blUrlPrefix}=${itemNo}`,
    loadingPriceOMagic: false,
    priceOMagic: {
      stockAvgPrice: pomData.stockAvgPrice ?? null,
      stockMinPrice: pomData.stockMinPrice ?? null,
      stockMaxPrice: pomData.stockMaxPrice ?? null,
      stockTotalLots: pomData.stockTotalLots ?? null,
      soldAvgPrice: pomData.soldAvgPrice ?? null,
      soldMinPrice: pomData.soldMinPrice ?? null,
      soldMaxPrice: pomData.soldMaxPrice ?? null,
      soldTotalLots: pomData.soldTotalLots ?? null,
      suggestedPrice: pomData.suggestedPrice ?? null,
      itemName: catalog?.itemName ?? pomData.itemName ?? null,
      imageUrl: resolvedImageUrl,
      thumbnailUrl: resolvedThumbnailUrl,
    },
  };

  res.json(responseData);
}));

// 20. GET /inventory/:id
router.get("/inventory/:id", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const itemId = parseInt(req.params.id);
  if (isNaN(itemId)) {
    return res.status(400).json({ error: "Invalid item ID" });
  }

  const items = await db
    .select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
      itemType: blInventory.itemType,
      colorId: blInventory.colorId,
      colorName: blColors.name,
      colorRgb: blColors.rgb,
      categoryId: blCatalog.categoryId,
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
      hasInstructions: blInventory.hasInstructions,
      hasBox: blInventory.hasBox,
      pctComplete: blInventory.pctComplete,
      completenessNotes: blInventory.completenessNotes,
      missingPieces: blInventory.missingPieces,
      missingLots: blInventory.missingLots,
      saleLocation: blInventory.saleLocation,
    })
    .from(blInventory)
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
    .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
    .where(and(eq(blInventory.orgId, orgId), eq(blInventory.id, itemId)));

  if (items.length === 0) {
    return res.status(404).json({ error: "Item not found" });
  }

  res.json(items[0]);
}));

// 21. PATCH /inventory/:id/readiness
router.patch("/inventory/:id/readiness", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const itemId = parseInt(req.params.id);
  if (isNaN(itemId)) return res.status(400).json({ error: "Invalid item ID" });

  const {
    hasInstructions,
    hasBox,
    pctComplete,
    completenessNotes,
    missingPieces,
    missingLots,
    saleLocation,
  } = req.body;

  const updates: Record<string, any> = {};
  if (hasInstructions !== undefined) updates.hasInstructions = hasInstructions;
  if (hasBox !== undefined) updates.hasBox = hasBox;
  if (pctComplete !== undefined) updates.pctComplete = pctComplete === null ? null : Math.min(100, Math.max(0, Number(pctComplete)));
  if (completenessNotes !== undefined) updates.completenessNotes = completenessNotes ? String(completenessNotes).slice(0, 50) : null;
  if (missingPieces !== undefined) updates.missingPieces = missingPieces === null ? null : Number(missingPieces);
  if (missingLots !== undefined) updates.missingLots = missingLots === null ? null : Number(missingLots);
  if (saleLocation !== undefined) updates.saleLocation = saleLocation ? String(saleLocation).slice(0, 5).toUpperCase() : null;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  await db
    .update(blInventory)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(eq(blInventory.orgId, orgId), eq(blInventory.id, itemId)));

  res.json({ success: true });
}));

// 21b. GET /inventory/sets/:setNo/composition — what's in this set vs. what I own
router.get("/inventory/sets/:setNo/composition", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const setNoRaw = String(req.params.setNo || '').trim();
  if (!setNoRaw) return res.status(400).json({ error: "Invalid set number" });

  // Rebrickable stores sets like "10179-1"; BL inventory often stores "10179"
  // or "10179-1". Try every reasonable variant and pick the one with rows.
  const stripped = setNoRaw.replace(/-\d+$/, '');
  const variants = Array.from(new Set([
    setNoRaw,
    setNoRaw.toLowerCase(),
    setNoRaw.toUpperCase(),
    stripped,
    `${stripped}-1`,
  ])).filter(Boolean);

  const matches = await db
    .select({ setNum: setPartRelationships.setNum, n: sql<number>`count(*)::int` })
    .from(setPartRelationships)
    .where(inArray(setPartRelationships.setNum, variants))
    .groupBy(setPartRelationships.setNum);

  const best = matches.sort((a, b) => Number(b.n) - Number(a.n))[0];
  const setNo = best?.setNum ?? setNoRaw;

  const rows = await db.execute<{
    part_num: string;
    color_id: number | null;
    needed: number;
    part_name: string | null;
    color_name: string | null;
    color_rgb: string | null;
    thumbnail_url: string | null;
    stored_image_key: string | null;
    owned: number;
    lots: number;
    inv_ids: number[] | null;
  }>(sql`
    SELECT
      sp.part_num,
      sp.color_id,
      sp.quantity::int                                AS needed,
      cat.item_name                                   AS part_name,
      col.name                                        AS color_name,
      col.rgb                                         AS color_rgb,
      cat.thumbnail_url                               AS thumbnail_url,
      cat.stored_image_key                            AS stored_image_key,
      COALESCE(SUM(inv.quantity), 0)::int             AS owned,
      COUNT(inv.id)::int                              AS lots,
      COALESCE(array_agg(inv.id) FILTER (WHERE inv.id IS NOT NULL), '{}') AS inv_ids
    FROM set_part_relationships sp
    LEFT JOIN bl_catalog cat
      ON cat.item_no = sp.part_num
     AND cat.item_type = 'PART'
     AND cat.color_id = COALESCE(sp.color_id, 0)
    LEFT JOIN bl_colors col
      ON col.id = sp.color_id
    LEFT JOIN bl_inventory inv
      ON inv.item_no  = sp.part_num
     AND inv.item_type = 'PART'
     AND inv.color_id = sp.color_id
     AND inv.org_id   = ${orgId}
     AND COALESCE(inv.is_stock_room, false) = false
    WHERE sp.set_num = ${setNo}
    GROUP BY sp.part_num, sp.color_id, sp.quantity, cat.item_name,
             col.name, col.rgb, cat.thumbnail_url, cat.stored_image_key
    ORDER BY (COALESCE(SUM(inv.quantity), 0) >= sp.quantity) ASC,
             (COALESCE(SUM(inv.quantity), 0) > 0) ASC,
             sp.color_id NULLS LAST, sp.part_num
  `);

  const parts = (rows as any[]).map(r => ({
    partNum: r.part_num,
    colorId: r.color_id,
    needed: Number(r.needed) || 0,
    owned: Number(r.owned) || 0,
    lots: Number(r.lots) || 0,
    partName: r.part_name,
    colorName: r.color_name,
    colorRgb: r.color_rgb,
    thumbnailUrl: r.thumbnail_url,
    storedImageKey: r.stored_image_key,
    inventoryIds: Array.isArray(r.inv_ids) ? r.inv_ids.filter((x: any) => x != null) : [],
  }));

  const totals = parts.reduce((acc, p) => {
    acc.uniqueParts += 1;
    acc.piecesNeeded += p.needed;
    acc.piecesOwned += Math.min(p.owned, p.needed);
    if (p.owned >= p.needed) acc.completeParts += 1;
    else if (p.owned > 0)    acc.partialParts += 1;
    else                     acc.missingParts += 1;
    return acc;
  }, { uniqueParts: 0, completeParts: 0, partialParts: 0, missingParts: 0, piecesNeeded: 0, piecesOwned: 0 });

  res.json({ setNo, resolved: parts.length > 0, parts, totals });
}));

// 22. GET /inventory/:id/analytics
router.get("/inventory/:id/analytics", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const itemId = parseInt(req.params.id);
  if (isNaN(itemId)) {
    return res.status(400).json({ error: "Invalid item ID" });
  }

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
      default:
        dateFilter = null;
    }
  }

  const [item] = await db
    .select({ id: blInventory.id, dateCreated: blInventory.dateCreated })
    .from(blInventory)
    .where(and(eq(blInventory.orgId, orgId), eq(blInventory.id, itemId)))
    .limit(1);

  if (!item) {
    return res.status(404).json({ error: "Item not found" });
  }

  const conditions = [
    sql`${orderDetails.sku} ~ '^[0-9]{1,9}$'`,
    sql`CAST(${orderDetails.sku} AS INTEGER) = ${item.id}`
  ];
  if (dateFilter) {
    conditions.push(sql`${orders.orderDate} >= ${dateFilter.toISOString()}`);
  }

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

  const totalUnitsSold = sales.reduce((sum, sale) => sum + sale.quantity, 0);
  const totalRevenue = sales.reduce((sum, sale) => sum + (sale.quantity * parseFloat(sale.unitPrice || "0")), 0);
  const averageSellingPrice = totalUnitsSold > 0 ? totalRevenue / totalUnitsSold : 0;

  const salesByMonth: Record<string, { units: number; revenue: number }> = {};
  sales.forEach(sale => {
    const monthKey = new Date(sale.orderDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    if (!salesByMonth[monthKey]) {
      salesByMonth[monthKey] = { units: 0, revenue: 0 };
    }
    salesByMonth[monthKey].units += sale.quantity;
    salesByMonth[monthKey].revenue += sale.quantity * parseFloat(sale.unitPrice || "0");
  });

  let bestMonth = { month: '', units: 0 };
  Object.entries(salesByMonth).forEach(([month, data]) => {
    if (data.units > bestMonth.units) {
      bestMonth = { month, units: data.units };
    }
  });

  let daysSinceLastSold = null;
  if (sales.length > 0) {
    const lastSaleDate = new Date(sales[0].orderDate);
    const now = new Date();
    daysSinceLastSold = Math.floor((now.getTime() - lastSaleDate.getTime()) / (1000 * 60 * 60 * 24));
  }

  let salesVelocity = 0;
  if (sales.length > 0) {
    const firstSaleDate = new Date(sales[sales.length - 1].orderDate);
    const lastSaleDate = new Date(sales[0].orderDate);
    const monthsDiff = (lastSaleDate.getTime() - firstSaleDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
    salesVelocity = monthsDiff > 0 ? totalUnitsSold / monthsDiff : totalUnitsSold;
  }

  const customerPurchases: Record<string, { name: string; units: number; revenue: number; orders: number }> = {};
  sales.forEach(sale => {
    const customerKey = sale.customerUsername || sale.customerEmail || 'Unknown';
    if (!customerPurchases[customerKey]) {
      customerPurchases[customerKey] = { name: customerKey, units: 0, revenue: 0, orders: 0 };
    }
    customerPurchases[customerKey].units += sale.quantity;
    customerPurchases[customerKey].revenue += sale.quantity * parseFloat(sale.unitPrice || "0");
    customerPurchases[customerKey].orders += 1;
  });

  const topCustomers = Object.values(customerPurchases)
    .sort((a, b) => b.units - a.units)
    .slice(0, 5);

  let daysInInventory = null;
  if (item.dateCreated) {
    const now = new Date();
    const created = new Date(item.dateCreated);
    daysInInventory = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
  }

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
    })).reverse().slice(0, 12),
    totalOrders: sales.length,
  });
}));

// 23. GET /inventory/:id/item-insights
router.get("/inventory/:id/item-insights", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const itemId = parseInt(req.params.id);
  if (isNaN(itemId)) return res.status(400).json({ error: "Invalid item ID" });

  const [item] = await db
    .select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      itemType: blInventory.itemType,
      itemName: blCatalog.itemName,
      categoryName: blCategories.name,
      colorName: blCatalog.colorName,
      quantity: blInventory.quantity,
      unitPrice: blInventory.unitPrice,
      newOrUsed: blInventory.newOrUsed,
      dateCreated: blInventory.dateCreated,
      myCost: blInventory.myCost,
    })
    .from(blInventory)
    .leftJoin(blCatalog, and(
      eq(blInventory.itemNo, blCatalog.itemNo),
      eq(blInventory.itemType, blCatalog.itemType),
      sql`CASE WHEN ${blInventory.colorId} = 0 THEN -1 ELSE ${blInventory.colorId} END = ${blCatalog.colorId}`,
    ))
    .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
    .where(and(eq(blInventory.orgId, orgId), eq(blInventory.id, itemId)))
    .limit(1);

  if (!item) return res.status(404).json({ error: "Item not found" });
  if (!item.itemNo) return res.status(400).json({ error: "Item has no part number" });

  const pgResult = await db.execute(sql`
    SELECT stock_avg_price, stock_min_price, stock_max_price, stock_total_lots,
           sold_avg_price, sold_min_price, sold_max_price, sold_total_lots
    FROM price_guide_cache
    WHERE item_no = ${item.itemNo.toUpperCase()}
      AND item_type = ${item.itemType || 'PART'}
      AND new_or_used = ${item.newOrUsed || 'N'}
    LIMIT 1
  `);
  const pgRow = pgResult.rows[0] as any;

  const stockGuide = pgRow ? { avgPrice: pgRow.stock_avg_price, minPrice: pgRow.stock_min_price, maxPrice: pgRow.stock_max_price, totalLots: pgRow.stock_total_lots } : null;
  const soldGuide = pgRow ? { avgPrice: pgRow.sold_avg_price, minPrice: pgRow.sold_min_price, maxPrice: pgRow.sold_max_price, totalLots: pgRow.sold_total_lots } : null;

  const salesData = await db
    .select({
      quantity: orderDetails.quantity,
      unitPrice: orderDetails.unitPrice,
      orderDate: orders.orderDate,
      customerUsername: orders.customerUsername,
    })
    .from(orderDetails)
    .innerJoin(orders, eq(orderDetails.orderId, orders.id))
    .where(and(
      sql`${orderDetails.sku} ~ '^[0-9]{1,9}$'`,
      sql`CAST(${orderDetails.sku} AS INTEGER) = ${item.id}`,
    ))
    .orderBy(desc(orders.orderDate))
    .limit(50);

  const totalSold = salesData.reduce((s, r) => s + r.quantity, 0);
  const totalRev = salesData.reduce((s, r) => s + r.quantity * parseFloat(r.unitPrice || '0'), 0);
  let velocity = 0;
  if (salesData.length > 0) {
    const first = new Date(salesData[salesData.length - 1].orderDate);
    const last = new Date(salesData[0].orderDate);
    const months = (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24 * 30);
    velocity = months > 0 ? totalSold / months : totalSold;
  }
  let daysSinceLastSold: number | null = null;
  if (salesData.length > 0) {
    daysSinceLastSold = Math.floor((Date.now() - new Date(salesData[0].orderDate).getTime()) / (1000 * 60 * 60 * 24));
  }

  const searchQuery = `${item.itemName || item.itemNo} ${item.categoryName || ''} LEGO`;

  let marketNewsResults: any[] = [];
  let forumResults: any[] = [];
  try {
    const { searchMarketNews, searchForumDiscussions } = await import('../services/ai-tools.js');
    const [newsRes, forumRes] = await Promise.all([
      searchMarketNews({ query: searchQuery, limit: 5 }),
      searchForumDiscussions({ query: searchQuery, limit: 5 }),
    ]);
    marketNewsResults = newsRes.data || [];
    forumResults = forumRes.data || [];
  } catch (e: any) {
    console.warn('[ItemInsights] Embedding search error (non-fatal):', e.message);
  }

  const apiKey = await getPlatformOpenAIKey();
  if (!apiKey) return res.status(500).json({ error: "No AI API key configured" });

  const prompt = `You are a LEGO/BrickLink business advisor. Analyze this specific inventory item and provide actionable business insights.

ITEM DATA:
- Name: ${item.itemName || item.itemNo}
- Part/Set Number: ${item.itemNo}
- Type: ${item.itemType}
- Category: ${item.categoryName || 'Unknown'}
- Color: ${item.colorName || 'N/A'}
- Condition: ${item.newOrUsed === 'N' ? 'New' : 'Used'}
- Quantity in stock: ${item.quantity}
- Listed price: $${item.unitPrice || '0'}
- My cost: $${item.myCost || 'Unknown'}
- Days in inventory: ${item.dateCreated ? Math.floor((Date.now() - new Date(item.dateCreated).getTime()) / 86400000) : 'Unknown'}

SALES HISTORY:
- Total units sold: ${totalSold}
- Total revenue: $${totalRev.toFixed(2)}
- Sales velocity: ${velocity.toFixed(1)} units/month
- Days since last sold: ${daysSinceLastSold ?? 'Never sold'}

MARKET DATA:
- Current stock avg price: $${stockGuide?.avgPrice || 'N/A'} (${stockGuide?.totalLots || 0} sellers)
- Current stock min: $${stockGuide?.minPrice || 'N/A'}, max: $${stockGuide?.maxPrice || 'N/A'}
- Recent sold avg price: $${soldGuide?.avgPrice || 'N/A'} (${soldGuide?.totalLots || 0} transactions)
- Recent sold min: $${soldGuide?.minPrice || 'N/A'}, max: $${soldGuide?.maxPrice || 'N/A'}

RELEVANT MARKET NEWS:
${marketNewsResults.length > 0 ? marketNewsResults.map(n => `- ${n.title}: ${n.snippet || ''}`).join('\n') : 'No relevant news found.'}

RELEVANT FORUM DISCUSSIONS:
${forumResults.length > 0 ? forumResults.map(f => `- ${f.title}: ${f.excerpt || ''}`).join('\n') : 'No relevant discussions found.'}

Provide exactly 4-6 insights as a JSON array. Each insight must have:
- "category": one of "pricing", "movement", "market", "category_trend", "opportunity", "risk"
- "urgency": "high", "medium", or "low"
- "title": short actionable headline (max 60 chars)
- "summary": 1-2 sentence explanation with specific numbers/data
- "source": what data informed this insight ("sales", "market_data", "news", "forum", "inventory")

Focus on:
1. Pricing strategy (is the item priced competitively? above/below market?)
2. Movement strategy (how to move slow stock or capitalize on fast sellers)
3. Market trends (any relevant news or forum chatter about this item/category?)
4. Category insights (how does this item fit in its category's market?)
5. Opportunities or risks (retirement rumors, supply changes, demand shifts)

Be specific with numbers. Reference actual data points. If market news or forum data is empty, focus on pricing and sales data instead.
Return ONLY a JSON array, no markdown, no explanation.`;

  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 2000,
  });

  const responseText = completion.choices[0]?.message?.content || '';
  let insights: any[] = [];
  try {
    const trimmed = responseText.trim();
    const parsed = JSON.parse(trimmed);
    insights = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const codeBlock = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) {
      try {
        const inner = JSON.parse(codeBlock[1].trim());
        insights = Array.isArray(inner) ? inner : [inner];
      } catch {}
    }
  }

  const VALID_CATEGORIES = ['pricing', 'movement', 'market', 'category_trend', 'opportunity', 'risk'];
  const VALID_URGENCIES = ['high', 'medium', 'low'];
  insights = insights
    .filter(i => i.title && i.summary)
    .map(i => ({
      category: VALID_CATEGORIES.includes(i.category) ? i.category : 'market',
      urgency: VALID_URGENCIES.includes(i.urgency) ? i.urgency : 'medium',
      title: String(i.title).slice(0, 100),
      summary: String(i.summary).slice(0, 500),
      source: i.source || 'inventory',
    }));

  res.json({
    insights,
    meta: {
      newsCount: marketNewsResults.length,
      forumCount: forumResults.length,
      salesCount: salesData.length,
      hasPriceGuide: !!(stockGuide || soldGuide),
    },
  });
}));

// 24. GET /catalog/item-insights
router.get("/catalog/item-insights", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { itemNo, itemType, colorId: colorIdStr } = req.query as { itemNo?: string; itemType?: string; colorId?: string };
  if (!itemNo || !itemType) return res.status(400).json({ error: "itemNo and itemType are required" });
  const colorId = colorIdStr !== undefined ? parseInt(colorIdStr) : -1;
  const effectiveColorId = isNaN(colorId) ? -1 : colorId === 0 ? -1 : colorId;

  const [catalogItem] = await db
    .select({
      itemNo: blCatalog.itemNo,
      itemType: blCatalog.itemType,
      itemName: blCatalog.itemName,
      colorName: blCatalog.colorName,
      categoryName: blCategories.name,
    })
    .from(blCatalog)
    .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
    .where(and(
      eq(blCatalog.itemNo, itemNo.toUpperCase()),
      eq(blCatalog.itemType, itemType.toUpperCase()),
      eq(blCatalog.colorId, effectiveColorId),
    ))
    .limit(1);

  const pgResult = await db.execute(sql`
    SELECT stock_avg_price, stock_min_price, stock_max_price, stock_total_lots,
           sold_avg_price, sold_min_price, sold_max_price, sold_total_lots
    FROM price_guide_cache
    WHERE item_no = ${itemNo.toUpperCase()}
      AND item_type = ${itemType.toUpperCase()}
      AND new_or_used = 'N'
    LIMIT 1
  `);
  const pgRow = pgResult.rows[0] as any;
  const stockGuide = pgRow ? { avgPrice: pgRow.stock_avg_price, minPrice: pgRow.stock_min_price, maxPrice: pgRow.stock_max_price, totalLots: pgRow.stock_total_lots } : null;
  const soldGuide = pgRow ? { avgPrice: pgRow.sold_avg_price, minPrice: pgRow.sold_min_price, maxPrice: pgRow.sold_max_price, totalLots: pgRow.sold_total_lots } : null;

  const salesData = await db
    .select({
      quantity: orderDetails.quantity,
      unitPrice: orderDetails.unitPrice,
      orderDate: orders.orderDate,
    })
    .from(orderDetails)
    .innerJoin(orders, and(eq(orderDetails.orderId, orders.id), eq(orders.orgId, orgId)))
    .where(sql`UPPER(${orderDetails.itemNo}) = ${itemNo.toUpperCase()}`)
    .orderBy(desc(orders.orderDate))
    .limit(50);

  const totalSold = salesData.reduce((s, r) => s + r.quantity, 0);
  const totalRev = salesData.reduce((s, r) => s + r.quantity * parseFloat(r.unitPrice || '0'), 0);
  let velocity = 0;
  if (salesData.length > 0) {
    const first = new Date(salesData[salesData.length - 1].orderDate);
    const last = new Date(salesData[0].orderDate);
    const months = (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24 * 30);
    velocity = months > 0 ? totalSold / months : totalSold;
  }
  let daysSinceLastSold: number | null = null;
  if (salesData.length > 0) {
    daysSinceLastSold = Math.floor((Date.now() - new Date(salesData[0].orderDate).getTime()) / (1000 * 60 * 60 * 24));
  }

  const displayName = catalogItem?.itemName || itemNo;
  const searchQuery = `${displayName} ${catalogItem?.categoryName || ''} LEGO`;

  let marketNewsResults: any[] = [];
  let forumResults: any[] = [];
  try {
    const { searchMarketNews, searchForumDiscussions } = await import('../services/ai-tools.js');
    const [newsRes, forumRes] = await Promise.all([
      searchMarketNews({ query: searchQuery, limit: 5 }),
      searchForumDiscussions({ query: searchQuery, limit: 5 }),
    ]);
    marketNewsResults = newsRes.data || [];
    forumResults = forumRes.data || [];
  } catch (e: any) {
    console.warn('[CatalogInsights] Embedding search error (non-fatal):', e.message);
  }

  const apiKey = await getPlatformOpenAIKey();
  if (!apiKey) return res.status(500).json({ error: "No AI API key configured" });

  const prompt = `You are a LEGO/BrickLink business advisor. This is a catalog item the seller does NOT currently have in inventory. Analyze the market data and provide insights to help them decide whether to source and sell this item.

ITEM DATA:
- Name: ${displayName}
- Part/Set Number: ${itemNo}
- Type: ${itemType}
- Category: ${catalogItem?.categoryName || 'Unknown'}
- Color: ${catalogItem?.colorName || 'N/A'}

PAST SALES (from this seller's order history):
- Total units sold previously: ${totalSold}
- Total revenue generated: $${totalRev.toFixed(2)}
- Sales velocity: ${velocity.toFixed(1)} units/month
- Days since last sold: ${daysSinceLastSold ?? 'Never sold'}

MARKET DATA (BrickLink):
- Current stock avg price: $${stockGuide?.avgPrice || 'N/A'} (${stockGuide?.totalLots || 0} sellers)
- Current stock min: $${stockGuide?.minPrice || 'N/A'}, max: $${stockGuide?.maxPrice || 'N/A'}
- Recent sold avg price: $${soldGuide?.avgPrice || 'N/A'} (${soldGuide?.totalLots || 0} transactions)
- Recent sold min: $${soldGuide?.minPrice || 'N/A'}, max: $${soldGuide?.maxPrice || 'N/A'}

RELEVANT MARKET NEWS:
${marketNewsResults.length > 0 ? marketNewsResults.map(n => `- ${n.title}: ${n.snippet || ''}`).join('\n') : 'No relevant news found.'}

RELEVANT FORUM DISCUSSIONS:
${forumResults.length > 0 ? forumResults.map(f => `- ${f.title}: ${f.excerpt || ''}`).join('\n') : 'No relevant discussions found.'}

Provide exactly 4-6 insights as a JSON array. Each insight must have:
- "category": one of "pricing", "movement", "market", "category_trend", "opportunity", "risk"
- "urgency": "high", "medium", or "low"
- "title": short actionable headline (max 60 chars)
- "summary": 1-2 sentence explanation with specific numbers/data
- "source": what data informed this insight ("sales", "market_data", "news", "forum", "inventory")

Focus on:
1. Is this item worth sourcing? (demand signal from past sales + market liquidity)
2. What price point makes sense? (based on market data)
3. Market trends for this item or its category
4. Any opportunities or risks (retirement, demand spikes, saturation)
5. Sourcing urgency (high velocity + low stock = source now vs. wait)

Be specific with numbers. Reference actual data points. Return ONLY a JSON array, no markdown, no explanation.`;

  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 2000,
  });

  const responseText = completion.choices[0]?.message?.content || '';
  let insights: any[] = [];
  try {
    const trimmed = responseText.trim();
    const parsed = JSON.parse(trimmed);
    insights = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const codeBlock = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlock) {
      try {
        const inner = JSON.parse(codeBlock[1].trim());
        insights = Array.isArray(inner) ? inner : [inner];
      } catch {}
    }
  }

  const VALID_CATEGORIES = ['pricing', 'movement', 'market', 'category_trend', 'opportunity', 'risk'];
  const VALID_URGENCIES = ['high', 'medium', 'low'];
  insights = insights
    .filter(i => i.title && i.summary)
    .map(i => ({
      category: VALID_CATEGORIES.includes(i.category) ? i.category : 'market',
      urgency: VALID_URGENCIES.includes(i.urgency) ? i.urgency : 'medium',
      title: String(i.title).slice(0, 100),
      summary: String(i.summary).slice(0, 500),
      source: i.source || 'market_data',
    }));

  res.json({
    insights,
    meta: {
      newsCount: marketNewsResults.length,
      forumCount: forumResults.length,
      salesCount: salesData.length,
      hasPriceGuide: !!(stockGuide || soldGuide),
      isCatalog: true,
    },
  });
}));

// 25. POST /inventory/acquisition-evaluate
router.post("/inventory/acquisition-evaluate", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { items } = req.body as {
    items: { itemNo: string; colorId: number; colorName?: string; condition: string; quantity: number; price?: number }[];
  };
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "No items provided" });
  }

  type SellerItem = { itemNo: string; colorId: number; colorName?: string; condition: string; quantity: number; price?: number; _pricedQty?: number };
  const consolidatedMap = new Map<string, SellerItem>();
  for (const item of items) {
    const key = `${item.itemNo}|${item.colorId ?? 0}|${item.condition}`;
    const ex = consolidatedMap.get(key);
    if (ex) {
      if (item.price != null && ex.price != null) {
        const pricedQty = ex._pricedQty ?? ex.quantity;
        ex.price = (ex.price * pricedQty + item.price * item.quantity) / (pricedQty + item.quantity);
        ex._pricedQty = pricedQty + item.quantity;
      } else if (item.price != null) {
        ex.price = item.price;
        ex._pricedQty = item.quantity;
      }
      ex.quantity += item.quantity;
    } else {
      consolidatedMap.set(key, { ...item, _pricedQty: item.price != null ? item.quantity : 0 });
    }
  }
  const sellerItems = Array.from(consolidatedMap.values()).map(({ _pricedQty: _, ...rest }) => rest);

  const allColors = await db.select({ id: blColors.id, name: blColors.name }).from(blColors);
  const colorByName = new Map<string, number>();
  for (const c of allColors) {
    colorByName.set(c.name.toLowerCase().trim(), c.id);
  }

  for (const item of sellerItems) {
    if ((item.colorId ?? 0) === 0 && item.colorName) {
      const resolved = colorByName.get(item.colorName.toLowerCase().trim());
      if (resolved != null) item.colorId = resolved;
    }
  }

  const orgInv = await db
    .select({
      itemNo: blInventory.itemNo,
      colorId: blInventory.colorId,
      condition: blInventory.newOrUsed,
      quantity: blInventory.quantity,
      unitPrice: blInventory.unitPrice,
    })
    .from(blInventory)
    .where(and(eq(blInventory.orgId, orgId), isNull(blInventory.deletedAt)));

  const orgMap = new Map<string, { quantity: number; unitPrice: string | null }>();
  for (const lot of orgInv) {
    const key = `${lot.itemNo}|${lot.colorId ?? 0}|${lot.condition}`;
    const existing = orgMap.get(key);
    if (existing) {
      existing.quantity += lot.quantity;
    } else {
      orgMap.set(key, { quantity: lot.quantity, unitPrice: lot.unitPrice });
    }
  }

  const uniqueItemNos = Array.from(new Set(sellerItems.map(i => i.itemNo)));

  const catalogRows = await db
    .select({ itemNo: blCatalog.itemNo, colorId: blCatalog.colorId, itemName: blCatalog.itemName, colorName: blCatalog.colorName })
    .from(blCatalog)
    .where(inArray(blCatalog.itemNo, uniqueItemNos));
  const catalogMap = new Map<string, { itemName: string | null; colorName: string | null }>();
  for (const r of catalogRows) {
    catalogMap.set(`${r.itemNo}|${r.colorId ?? 0}`, { itemName: r.itemName, colorName: r.colorName });
  }

  const priceRows = await db
    .select({
      itemNo: priceGuideCache.itemNo,
      colorId: priceGuideCache.colorId,
      newOrUsed: priceGuideCache.newOrUsed,
      stockAvgPrice: priceGuideCache.stockAvgPrice,
    })
    .from(priceGuideCache)
    .where(inArray(priceGuideCache.itemNo, uniqueItemNos));
  const priceMap = new Map<string, number | null>();
  for (const r of priceRows) {
    const k = `${r.itemNo}|${r.colorId ?? 0}|${r.newOrUsed}`;
    priceMap.set(k, r.stockAvgPrice ? parseFloat(r.stockAvgPrice) : null);
  }

  const common: any[] = [];
  const newItems: any[] = [];

  let totalSellerQty = 0;
  let totalSellerValue = 0;
  let hasSellerValue = false;
  let commonSellerQty = 0;
  let commonSellerValue = 0;
  let commonOrgListValue = 0;
  let newSellerQty = 0;
  let newSellerValue = 0;
  let newEstMarketValue = 0;
  let hasNewEstMarket = false;

  for (const item of sellerItems) {
    const key = `${item.itemNo}|${item.colorId ?? 0}|${item.condition}`;
    const catKey = `${item.itemNo}|${item.colorId ?? 0}`;
    const cat = catalogMap.get(catKey) ?? { itemName: null, colorName: null };
    const marketNew = priceMap.get(`${item.itemNo}|${item.colorId ?? 0}|N`) ?? null;
    const marketUsed = priceMap.get(`${item.itemNo}|${item.colorId ?? 0}|U`) ?? null;

    totalSellerQty += item.quantity;
    if (item.price != null) {
      totalSellerValue += item.price * item.quantity;
      hasSellerValue = true;
    }

    const orgLot = orgMap.get(key);
    if (orgLot) {
      commonSellerQty += item.quantity;
      if (item.price != null) { commonSellerValue += item.price * item.quantity; }
      if (orgLot.unitPrice != null) { commonOrgListValue += parseFloat(orgLot.unitPrice) * orgLot.quantity; }
      common.push({
        itemNo: item.itemNo,
        colorId: item.colorId ?? 0,
        colorName: cat.colorName,
        itemName: cat.itemName,
        condition: item.condition,
        sellerQty: item.quantity,
        sellerPrice: item.price ?? null,
        orgQty: orgLot.quantity,
        orgPrice: orgLot.unitPrice != null ? parseFloat(orgLot.unitPrice) : null,
        marketAvgNew: marketNew,
        marketAvgUsed: marketUsed,
      });
    } else {
      newSellerQty += item.quantity;
      if (item.price != null) { newSellerValue += item.price * item.quantity; hasSellerValue = true; }
      const mktPrice = item.condition === 'N' ? marketNew : marketUsed;
      if (mktPrice != null) { newEstMarketValue += mktPrice * item.quantity; hasNewEstMarket = true; }
      newItems.push({
        itemNo: item.itemNo,
        colorId: item.colorId ?? 0,
        colorName: cat.colorName,
        itemName: cat.itemName,
        condition: item.condition,
        sellerQty: item.quantity,
        sellerPrice: item.price ?? null,
        marketAvgNew: marketNew,
        marketAvgUsed: marketUsed,
      });
    }
  }

  res.json({
    summary: {
      totalSellerLots: sellerItems.length,
      totalSellerQty,
      totalSellerValue: hasSellerValue ? Math.round(totalSellerValue * 100) / 100 : null,
      commonLots: common.length,
      commonSellerQty,
      commonSellerValue: commonSellerValue > 0 ? Math.round(commonSellerValue * 100) / 100 : null,
      commonOrgListValue: commonOrgListValue > 0 ? Math.round(commonOrgListValue * 100) / 100 : null,
      newLots: newItems.length,
      newSellerQty,
      newSellerValue: newSellerValue > 0 ? Math.round(newSellerValue * 100) / 100 : null,
      newEstMarketValue: hasNewEstMarket ? Math.round(newEstMarketValue * 100) / 100 : null,
    },
    common,
    newItems,
  });
}));

// 26. POST /inventory/acquisition-snapshot
router.post("/inventory/acquisition-snapshot", isApproved, asyncRoute(async (req: any, res) => {
  const { text } = req.body as { text: string };
  if (!text || text.trim().length < 10) return res.status(400).json({ error: "No store text provided." });

  const orgId = reqOrgId(req);
  const { ieStrategies } = await import('@shared/schema');
  const stratRow = await db.select().from(ieStrategies).where(eq(ieStrategies.orgId, orgId)).limit(1);
  const stratContext = stratRow[0]
    ? [
        stratRow[0].inventoryStrategy ? `Inventory strategy: ${stratRow[0].inventoryStrategy}` : '',
        stratRow[0].pricingStrategy   ? `Pricing strategy: ${stratRow[0].pricingStrategy}`    : '',
      ].filter(Boolean).join('\n')
    : '';

  const { default: AnthropicSDK } = await import("@anthropic-ai/sdk");
  const client = new (AnthropicSDK as any)({
    apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  });

  const prompt = `You are an expert LEGO reseller business analyst helping evaluate whether to acquire inventory from another BrickLink store.

${stratContext ? `BUYER'S STRATEGY CONTEXT:\n${stratContext}\n\n` : ''}SELLER'S STORE INVENTORY OVERVIEW:
${text.trim().slice(0, 4000)}

Analyze this store's inventory and respond with ONLY a valid JSON object (no markdown, no extra text) with this exact structure:
{
  "storeProfile": "2-3 sentence overview of what kind of store this is and what they specialize in",
  "acquisitionScore": <integer 1-10, where 10 is highly attractive>,
  "scoringRationale": "1-2 sentences explaining the score",
  "highlights": [<up to 5 strings, each a specific notable strength or interesting category>],
  "concerns": [<up to 4 strings, each a potential risk or downside>],
  "focusAreas": [<up to 5 strings: specific categories or themes the buyer should prioritize when reviewing>],
  "negotiatingPoints": [<up to 3 strings: data-backed points to use when negotiating price>],
  "recommendation": "Buy" | "Negotiate" | "Pass" | "Selective"
}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }]
  });

  const raw = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '{}';
  let analysis: Record<string, unknown>;
  try { analysis = JSON.parse(raw); }
  catch {
    const match = raw.match(/\{[\s\S]+\}/);
    try { analysis = match ? JSON.parse(match[0]) : { error: "Could not parse AI response" }; }
    catch { analysis = { error: "Could not parse AI response" }; }
  }
  res.json(analysis);
}));

// 27. GET /bricklink/rate-limit
router.get("/bricklink/rate-limit", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const { checkRateLimit } = await import("../services/bricklink");
  const status = await checkRateLimit(orgId);
  res.json(status);
}));

// 28. GET /items/detail/:itemNo
router.get("/items/detail/:itemNo", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { itemNo } = req.params;

  const inventoryLots = await db
    .select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      itemType: blInventory.itemType,
      itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
      colorId: blInventory.colorId,
      colorName: blColors.name,
      colorRgb: blColors.rgb,
      categoryId: blCatalog.categoryId,
      categoryName: blCategories.name,
      quantity: blInventory.quantity,
      newOrUsed: blInventory.newOrUsed,
      unitPrice: blInventory.unitPrice,
    })
    .from(blInventory)
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
    .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
    .where(and(eq(blInventory.orgId, orgId), eq(blInventory.itemNo, itemNo)));

  if (inventoryLots.length === 0) {
    return res.status(404).json({ error: "Item not found" });
  }

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
        .where(and(eq(inventoryLocations.orgId, orgId), inArray(inventoryLocations.inventoryId, inventoryIds)))
    : [];

  const salesData = await db
    .select({
      quantitySold: sql<number>`COALESCE(SUM(${orderDetails.quantity}), 0)`,
      revenue: sql<number>`COALESCE(SUM(CAST(${orderDetails.unitPrice} AS DECIMAL) * ${orderDetails.quantity}), 0)`,
    })
    .from(orderDetails)
    .where(eq(orderDetails.sku, itemNo));

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

  const totalQuantity = inventoryLots.reduce((sum, lot) => sum + (lot.quantity || 0), 0);
  const newQuantity = inventoryLots
    .filter(lot => lot.newOrUsed === 'N')
    .reduce((sum, lot) => sum + (lot.quantity || 0), 0);
  const usedQuantity = inventoryLots
    .filter(lot => lot.newOrUsed === 'U')
    .reduce((sum, lot) => sum + (lot.quantity || 0), 0);
  
  const colorCount = new Set(inventoryLots.map(lot => lot.colorId).filter(Boolean)).size;

  res.json({
    itemNo,
    itemName: inventoryLots[0].itemName,
    categoryName: inventoryLots[0].categoryName,
    totalQuantity,
    newQuantity,
    usedQuantity,
    colorCount,
    colors,
    totalSold: salesData[0]?.quantitySold || 0,
    totalRevenue: salesData[0]?.revenue || 0,
  });
}));

router.use(apiErrorHandler);
export default router;
