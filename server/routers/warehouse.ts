import { Router } from "express";
import { eq, and, asc, ilike, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { asyncRoute, reqOrgId } from "../lib/routeHelpers";
import { isApproved } from "../auth";
import { broadcast } from "../sse";
import {
  organizations, whZones, whAisles, whShelves, whBins, inventoryLocations,
  blInventory, blColors, blCatalog,
  insertWhZoneSchema, insertWhAisleSchema, insertWhShelfSchema, insertWhBinSchema,
  insertInventoryLocationSchema,
} from "@shared/schema";

const router = Router();

// ── Shared helpers ─────────────────────────────────────────────────────────────

const resolvedCatalogItemName = (itemNoRef: any, itemTypeRef: any, colorIdRef: any) =>
  sql<string | null>`COALESCE(
    (SELECT item_name FROM bl_catalog WHERE item_no = ${itemNoRef} AND item_type = ${itemTypeRef} ORDER BY (color_id = ${colorIdRef})::int DESC, color_id ASC LIMIT 1),
    (SELECT item_name FROM price_guide_cache WHERE item_no = ${itemNoRef} AND item_type = ${itemTypeRef} AND item_name IS NOT NULL AND item_name != '' LIMIT 1)
  )`;

// ── Zones ─────────────────────────────────────────────────────────────────────

router.get("/warehouse/zones", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const zones = await db
    .select({
      id: whZones.id,
      orgId: whZones.orgId,
      name: whZones.name,
      description: whZones.description,
      depth: whZones.depth,
      sortOrder: whZones.sortOrder,
      aisleFormat: whZones.aisleFormat,
      shelfFormat: whZones.shelfFormat,
      binFormat: whZones.binFormat,
      createdAt: whZones.createdAt,
      updatedAt: whZones.updatedAt,
      aisleCount: sql<number>`(SELECT COUNT(*) FROM wh_aisles WHERE zone_id = wh_zones.id)`,
      shelfCount: sql<number>`(SELECT COUNT(*) FROM wh_shelves WHERE zone_id = wh_zones.id)`,
      binCount: sql<number>`(SELECT COUNT(*) FROM wh_bins WHERE zone_id = wh_zones.id)`,
      assignedLotCount: sql<number>`(
        SELECT COUNT(DISTINCT il.inventory_id)
        FROM inventory_locations il
        JOIN wh_bins b ON il.bin_id = b.id
        WHERE b.zone_id = wh_zones.id
      )`,
    })
    .from(whZones)
    .where(eq(whZones.orgId, orgId))
    .orderBy(whZones.sortOrder, whZones.name);
  res.json(zones);
}));

router.post("/warehouse/zones", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const data = insertWhZoneSchema.parse({ ...req.body, orgId });
  const [zone] = await db.insert(whZones).values(data as any).returning();
  res.json(zone);
}));

router.put("/warehouse/zones/:id", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const id = parseInt(req.params.id);
  const { name, description, depth, aisleFormat, shelfFormat, binFormat, sortOrder } = req.body;
  const updates: any = { updatedAt: new Date() };
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (depth !== undefined) {
    const d = parseInt(depth);
    if (![1, 2, 3].includes(d)) return res.status(400).json({ error: "depth must be 1, 2, or 3" });
    updates.depth = d;
  }
  const validFormats = ['alpha', 'numeric', 'alphanumeric'];
  if (aisleFormat !== undefined) { if (!validFormats.includes(aisleFormat)) return res.status(400).json({ error: "Invalid aisleFormat" }); updates.aisleFormat = aisleFormat; }
  if (shelfFormat !== undefined) { if (!validFormats.includes(shelfFormat)) return res.status(400).json({ error: "Invalid shelfFormat" }); updates.shelfFormat = shelfFormat; }
  if (binFormat !== undefined)   { if (!validFormats.includes(binFormat))   return res.status(400).json({ error: "Invalid binFormat" });   updates.binFormat = binFormat; }
  if (sortOrder !== undefined) updates.sortOrder = parseInt(sortOrder);
  const [zone] = await db.update(whZones).set(updates).where(and(eq(whZones.id, id), eq(whZones.orgId, orgId))).returning();
  if (!zone) return res.status(404).json({ error: "Zone not found" });
  res.json(zone);
}));

router.delete("/warehouse/zones/:id", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const id = parseInt(req.params.id);
  await db.delete(whZones).where(and(eq(whZones.id, id), eq(whZones.orgId, orgId)));
  res.json({ success: true });
}));

// ── Aisles ─────────────────────────────────────────────────────────────────────

router.get("/warehouse/aisles", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const zoneId = req.query.zoneId ? parseInt(req.query.zoneId as string) : null;
  const aislesWithCounts = await db
    .select({
      id: whAisles.id,
      name: whAisles.name,
      description: whAisles.description,
      zoneId: whAisles.zoneId,
      createdAt: whAisles.createdAt,
      updatedAt: whAisles.updatedAt,
      shelfCount: sql<number>`(SELECT COUNT(*) FROM ${whShelves} WHERE ${whShelves.aisleId} = ${whAisles.id})`,
    })
    .from(whAisles)
    .where(zoneId
      ? and(eq(whAisles.orgId, orgId), eq(whAisles.zoneId, zoneId))
      : eq(whAisles.orgId, orgId))
    .orderBy(whAisles.name);
  res.json(aislesWithCounts);
}));

router.post("/warehouse/aisles", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const data = insertWhAisleSchema.parse(req.body);
  const [aisle] = await db.insert(whAisles).values({ ...data, orgId }).returning();
  res.json(aisle);
}));

router.put("/warehouse/aisles/:id", isApproved, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  const data = insertWhAisleSchema.parse(req.body);
  const [aisle] = await db
    .update(whAisles)
    .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(whAisles.id, id))
    .returning();
  if (!aisle) return res.status(404).json({ error: "Aisle not found" });
  res.json(aisle);
}));

router.delete("/warehouse/aisles/:id", isApproved, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(whAisles).where(eq(whAisles.id, id));
  res.json({ success: true });
}));

// ── Shelves ────────────────────────────────────────────────────────────────────

router.get("/warehouse/shelves", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const aisleId = req.query.aisleId ? parseInt(req.query.aisleId as string) : null;
  const zoneId  = req.query.zoneId  ? parseInt(req.query.zoneId  as string) : null;

  const whereClause = aisleId
    ? and(eq(whShelves.orgId, orgId), eq(whShelves.aisleId, aisleId))
    : zoneId
    ? and(eq(whShelves.orgId, orgId), eq(whShelves.zoneId, zoneId))
    : eq(whShelves.orgId, orgId);

  const shelvesWithCounts = await db
    .select({
      id: whShelves.id,
      name: whShelves.name,
      aisleId: whShelves.aisleId,
      aisleName: whAisles.name,
      zoneId: whShelves.zoneId,
      position: whShelves.position,
      description: whShelves.description,
      createdAt: whShelves.createdAt,
      updatedAt: whShelves.updatedAt,
      binCount: sql<number>`(SELECT COUNT(*) FROM ${whBins} WHERE ${whBins.shelfId} = ${whShelves.id})`,
    })
    .from(whShelves)
    .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
    .where(whereClause)
    .orderBy(whShelves.aisleId, whShelves.position);
  res.json(shelvesWithCounts);
}));

router.post("/warehouse/shelves", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const data = insertWhShelfSchema.parse(req.body);
  // Inherit zoneId from parent aisle when not explicitly provided
  let { zoneId } = data;
  if (!zoneId && data.aisleId) {
    const [parentAisle] = await db.select({ zoneId: whAisles.zoneId }).from(whAisles).where(eq(whAisles.id, data.aisleId));
    if (parentAisle?.zoneId) zoneId = parentAisle.zoneId;
  }
  const [shelf] = await db.insert(whShelves).values({ ...data, zoneId, orgId }).returning();
  res.json(shelf);
}));

router.put("/warehouse/shelves/:id", isApproved, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  const data = insertWhShelfSchema.parse(req.body);
  const [shelf] = await db
    .update(whShelves)
    .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(whShelves.id, id))
    .returning();
  if (!shelf) return res.status(404).json({ error: "Shelf not found" });
  res.json(shelf);
}));

router.delete("/warehouse/shelves/:id", isApproved, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(whShelves).where(eq(whShelves.id, id));
  res.json({ success: true });
}));

// ── Bins ───────────────────────────────────────────────────────────────────────

router.get("/warehouse/bins", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const shelfId = req.query.shelfId ? parseInt(req.query.shelfId as string) : null;
  const zoneId  = req.query.zoneId  ? parseInt(req.query.zoneId  as string) : null;

  const whereClause = shelfId
    ? and(eq(whBins.orgId, orgId), eq(whBins.shelfId, shelfId))
    : zoneId
    ? and(eq(whBins.orgId, orgId), eq(whBins.zoneId, zoneId))
    : eq(whBins.orgId, orgId);

  const binsWithDetails = await db
    .select({
      id: whBins.id,
      name: whBins.name,
      shelfId: whBins.shelfId,
      shelfName: whShelves.name,
      aisleId: whAisles.id,
      aisleName: whAisles.name,
      zoneId: whBins.zoneId,
      position: whBins.position,
      description: whBins.description,
      isFilingQueue: whBins.isFilingQueue,
      createdAt: whBins.createdAt,
      updatedAt: whBins.updatedAt,
      itemCount: sql<number>`(SELECT COUNT(*) FROM ${inventoryLocations} WHERE ${inventoryLocations.binId} = ${whBins.id})`,
    })
    .from(whBins)
    .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
    .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
    .where(whereClause)
    .orderBy(whBins.shelfId, whBins.position);
  res.json(binsWithDetails);
}));

router.post("/warehouse/bins", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const data = insertWhBinSchema.parse(req.body);
  // Inherit zoneId from parent shelf when not explicitly provided
  let { zoneId } = data;
  if (!zoneId && data.shelfId) {
    const [parentShelf] = await db.select({ zoneId: whShelves.zoneId }).from(whShelves).where(eq(whShelves.id, data.shelfId));
    if (parentShelf?.zoneId) zoneId = parentShelf.zoneId;
  }
  const [bin] = await db.insert(whBins).values({ ...data, zoneId, orgId }).returning();
  res.json(bin);
}));

router.put("/warehouse/bins/:id", isApproved, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  const data = insertWhBinSchema.parse(req.body);
  const [bin] = await db
    .update(whBins)
    .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(whBins.id, id))
    .returning();
  if (!bin) return res.status(404).json({ error: "Bin not found" });
  res.json(bin);
}));

router.delete("/warehouse/bins/:id", isApproved, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(whBins).where(eq(whBins.id, id));
  res.json({ success: true });
}));

router.patch("/warehouse/bins/:id/filing-queue", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const id = parseInt(req.params.id);
  const { isFilingQueue } = req.body;
  if (typeof isFilingQueue !== 'boolean') return res.status(400).json({ error: "isFilingQueue must be a boolean" });
  const [bin] = await db
    .update(whBins)
    .set({ isFilingQueue, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(whBins.id, id), eq(whBins.orgId, orgId)))
    .returning();
  if (!bin) return res.status(404).json({ error: "Bin not found" });
  res.json(bin);
}));

// ── Move location to a different zone ──────────────────────────────────────────
router.post("/warehouse/move", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { type, id, targetZoneId } = req.body;
  if (!type || !id || !targetZoneId) return res.status(400).json({ error: "type, id, and targetZoneId are required" });

  const [targetZone] = await db
    .select({ id: whZones.id, name: whZones.name, depth: whZones.depth })
    .from(whZones)
    .where(and(eq(whZones.id, parseInt(targetZoneId)), eq(whZones.orgId, orgId)));
  if (!targetZone) return res.status(404).json({ error: "Target zone not found" });

  if (type === 'bin') {
    const [bin] = await db.select().from(whBins).where(and(eq(whBins.id, parseInt(id)), eq(whBins.orgId, orgId)));
    if (!bin) return res.status(404).json({ error: "Bin not found" });
    await db.update(whBins)
      .set({ zoneId: targetZone.id, shelfId: null, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(whBins.id, bin.id));
    return res.json({ success: true, moved: 1 });
  }

  if (type === 'shelf') {
    if (targetZone.depth < 2) {
      return res.status(400).json({
        error: `Zone "${targetZone.name}" only supports bins (depth 1). Moving a shelf requires a zone with depth 2 (shelves + bins) or deeper.`
      });
    }
    const [shelf] = await db.select().from(whShelves).where(and(eq(whShelves.id, parseInt(id)), eq(whShelves.orgId, orgId)));
    if (!shelf) return res.status(404).json({ error: "Shelf not found" });
    await db.update(whShelves)
      .set({ zoneId: targetZone.id, aisleId: null, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(whShelves.id, shelf.id));
    await db.update(whBins)
      .set({ zoneId: targetZone.id, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(whBins.shelfId, shelf.id), eq(whBins.orgId, orgId)));
    return res.json({ success: true });
  }

  if (type === 'aisle') {
    if (targetZone.depth < 3) {
      const what = targetZone.depth === 1 ? 'bins only' : 'shelves and bins';
      return res.status(400).json({
        error: `Zone "${targetZone.name}" supports ${what} (depth ${targetZone.depth}). Moving an aisle requires a zone with full depth 3 (aisles + shelves + bins).`
      });
    }
    const [aisle] = await db.select().from(whAisles).where(and(eq(whAisles.id, parseInt(id)), eq(whAisles.orgId, orgId)));
    if (!aisle) return res.status(404).json({ error: "Aisle not found" });
    await db.update(whAisles)
      .set({ zoneId: targetZone.id, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(whAisles.id, aisle.id));
    // Move all shelves in this aisle
    await db.update(whShelves)
      .set({ zoneId: targetZone.id, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(whShelves.aisleId, aisle.id), eq(whShelves.orgId, orgId)));
    // Move all bins belonging to shelves in this aisle
    const aisleShelfIds = await db
      .select({ id: whShelves.id })
      .from(whShelves)
      .where(and(eq(whShelves.aisleId, aisle.id), eq(whShelves.orgId, orgId)));
    if (aisleShelfIds.length > 0) {
      await db.update(whBins)
        .set({ zoneId: targetZone.id, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(inArray(whBins.shelfId, aisleShelfIds.map(s => s.id)), eq(whBins.orgId, orgId)));
    }
    return res.json({ success: true });
  }

  return res.status(400).json({ error: "type must be aisle, shelf, or bin" });
}));

// Bulk create bins
router.post("/warehouse/bins/bulk", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { prefix, start, end, padLength, shelfId, zoneId } = req.body;
  if (prefix == null || start == null || end == null) return res.status(400).json({ error: "start and end are required" });
  const from = parseInt(start);
  const to = parseInt(end);
  if (isNaN(from) || isNaN(to) || from > to || to - from > 499) {
    return res.status(400).json({ error: "Invalid range (max 500 bins at once)" });
  }
  const pad = parseInt(padLength) || 0;
  const resolvedShelfId = shelfId ? parseInt(shelfId) : null;
  const resolvedZoneId = zoneId ? parseInt(zoneId) : null;

  const candidates: string[] = [];
  for (let i = from; i <= to; i++) {
    const num = pad > 0 ? String(i).padStart(pad, '0') : String(i);
    candidates.push(`${prefix}${num}`);
  }

  const existingQuery = db
    .select({ name: whBins.name })
    .from(whBins)
    .where(
      resolvedShelfId != null
        ? and(eq(whBins.orgId, orgId), eq(whBins.shelfId, resolvedShelfId), inArray(whBins.name, candidates))
        : and(eq(whBins.orgId, orgId), isNull(whBins.shelfId), inArray(whBins.name, candidates))
    );
  const existing = await existingQuery;
  const existingNames = new Set(existing.map((b: { name: string }) => b.name.toLowerCase()));

  const rows = candidates
    .filter(name => !existingNames.has(name.toLowerCase()))
    .map(name => ({ name, shelfId: resolvedShelfId, zoneId: resolvedZoneId, orgId }));

  if (rows.length === 0) {
    return res.json({ created: 0, skipped: candidates.length, bins: [] });
  }

  const created = await db.insert(whBins).values(rows).returning();
  res.json({ created: created.length, skipped: candidates.length - created.length, bins: created });
}));

// ── Inventory Search ───────────────────────────────────────────────────────────

// ── Counts — correct totals using COUNT queries (not limited array length) ──────
router.get("/warehouse/counts", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const [[{ total }], [{ assigned }]] = await Promise.all([
    db.select({ total: sql<number>`COUNT(*)` }).from(blInventory)
      .where(eq(blInventory.orgId, orgId)),
    db.select({ assigned: sql<number>`COUNT(DISTINCT ${inventoryLocations.inventoryId})` })
      .from(inventoryLocations).where(eq(inventoryLocations.orgId, orgId)),
  ]);
  const totalNum = Number(total);
  const assignedNum = Number(assigned);
  res.json({ totalLots: totalNum, assignedLots: assignedNum, unassignedLots: totalNum - assignedNum });
}));

// ── Unified lots endpoint — filter=all|assigned|unassigned|filing-queue, optional q and range ─
router.get("/warehouse/lots", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const filterParam = (String(req.query.filter ?? 'all')) as 'all' | 'assigned' | 'unassigned' | 'filing-queue';
  const q = String(req.query.q ?? '').trim();
  const fromRaw = String(req.query.from ?? '').trim();
  const toRaw = String(req.query.to ?? '').trim();
  const limit = Math.min(parseInt(String(req.query.limit ?? '200')), 500);

  const assignedExpr = sql<boolean>`EXISTS (
    SELECT 1 FROM inventory_locations il WHERE il.inventory_id = ${blInventory.id} AND il.org_id = ${orgId}
  )`;
  // binName: the first bin for this lot (any bin, incl. filing queue) — used for queue list display
  const binNameExpr = sql<string | null>`(
    SELECT wb.name FROM inventory_locations il JOIN wh_bins wb ON wb.id = il.bin_id
    WHERE il.inventory_id = ${blInventory.id} AND il.org_id = ${orgId} LIMIT 1
  )`;
  // locationLabel: aggregated path of all NON-filing-queue locations, e.g. "A / 1 / 24"
  // Shows "unassigned" intent when null (lot has no permanent home yet)
  const locationLabelExpr = sql<string | null>`(
    SELECT string_agg(concat_ws(' / ', wa.name, ws.name, wb.name), ' | ' ORDER BY wa.name, ws.name, wb.name)
    FROM inventory_locations il
    JOIN wh_bins wb ON wb.id = il.bin_id AND wb.is_filing_queue = false
    LEFT JOIN wh_shelves ws ON ws.id = wb.shelf_id
    LEFT JOIN wh_aisles wa ON wa.id = ws.aisle_id
    WHERE il.inventory_id = ${blInventory.id} AND il.org_id = ${orgId}
  )`;
  const isFilingQueueExpr = sql<boolean>`EXISTS (
    SELECT 1 FROM inventory_locations il JOIN wh_bins wb ON wb.id = il.bin_id
    WHERE il.inventory_id = ${blInventory.id} AND il.org_id = ${orgId} AND wb.is_filing_queue = true
  )`;

  const conditions: any[] = [eq(blInventory.orgId, orgId)];

  if (filterParam === 'assigned') {
    conditions.push(sql`EXISTS (SELECT 1 FROM inventory_locations il WHERE il.inventory_id = ${blInventory.id} AND il.org_id = ${orgId})`);
  } else if (filterParam === 'unassigned') {
    conditions.push(sql`NOT EXISTS (SELECT 1 FROM inventory_locations il WHERE il.inventory_id = ${blInventory.id} AND il.org_id = ${orgId})`);
  } else if (filterParam === 'filing-queue') {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM inventory_locations il JOIN wh_bins wb ON wb.id = il.bin_id
      WHERE il.inventory_id = ${blInventory.id} AND il.org_id = ${orgId} AND wb.is_filing_queue = true
    )`);
  }

  if (q) {
    conditions.push(sql`(${blInventory.itemNo} ILIKE ${'%' + q + '%'} OR EXISTS (
      SELECT 1 FROM bl_catalog bc WHERE bc.item_no = ${blInventory.itemNo} AND bc.item_type = ${blInventory.itemType}
        AND bc.item_name ILIKE ${'%' + q + '%'}
    ))`);
  }

  if (fromRaw && toRaw) {
    const fromNorm = normalizeBLItemNo(fromRaw);
    const toNorm = normalizeBLItemNo(toRaw);
    const pureNumeric = /^\d+$/.test(fromNorm) && /^\d+$/.test(toNorm);
    if (pureNumeric) {
      const fromNum = parseInt(fromNorm, 10);
      const toNum = parseInt(toNorm, 10);
      if (!isNaN(fromNum) && !isNaN(toNum) && fromNum <= toNum) {
        conditions.push(sql`(regexp_match(${blInventory.itemNo}, '^([0-9]+)'))[1]::integer BETWEEN ${fromNum} AND ${toNum}`);
      }
    } else if (fromNorm <= toNorm) {
      conditions.push(sql`${normalizeItemNoSql(blInventory.itemNo)} >= ${fromNorm} AND ${normalizeItemNoSql(blInventory.itemNo)} <= ${toNorm}`);
    }
  }

  const rows = await db
    .select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      itemType: blInventory.itemType,
      itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
      colorName: blColors.name,
      newOrUsed: blInventory.newOrUsed,
      quantity: blInventory.quantity,
      assigned: assignedExpr,
      binName: binNameExpr,
      locationLabel: locationLabelExpr,
      isFilingQueue: isFilingQueueExpr,
    })
    .from(blInventory)
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(
      eq(blInventory.itemNo, blCatalog.itemNo),
      eq(blInventory.itemType, blCatalog.itemType),
      eq(blInventory.colorId, blCatalog.colorId),
    ))
    .where(and(...conditions))
    .orderBy(
      q
        ? sql`CASE WHEN LOWER(${blInventory.itemNo}) = LOWER(${q}) THEN 0
               WHEN LOWER(${blInventory.itemNo}) LIKE LOWER(${q + '%'}) THEN 1
               ELSE 2 END`
        : (fromRaw && toRaw
            ? sql`(regexp_match(${blInventory.itemNo}, '^([0-9]+)'))[1]::integer, ${normalizeItemNoSql(blInventory.itemNo)}`
            : asc(blInventory.itemNo)),
      asc(blInventory.itemNo)
    )
    .limit(fromRaw && toRaw ? 1000 : limit);

  res.json(rows);
}));

router.get("/warehouse/inventory/search", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const q = ((req.query.q as string) || '').trim();
  if (q.length < 1) return res.json([]);

  const assignedExpr = (id: any) => sql<boolean>`EXISTS (
    SELECT 1 FROM inventory_locations il
    WHERE il.inventory_id = ${id} AND il.org_id = ${orgId}
  )`;

  const commonJoins = (qb: any) => qb
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(
      eq(blInventory.itemNo, blCatalog.itemNo),
      eq(blInventory.itemType, blCatalog.itemType),
      eq(blInventory.colorId, blCatalog.colorId)
    ));

  const [prefixMatches, nameMatches] = await Promise.all([
    commonJoins(db.select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      itemType: blInventory.itemType,
      itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
      colorName: blColors.name,
      newOrUsed: blInventory.newOrUsed,
      quantity: blInventory.quantity,
      assigned: assignedExpr(blInventory.id),
    }).from(blInventory))
      .where(and(eq(blInventory.orgId, orgId), ilike(blInventory.itemNo, `${q}%`)))
      .orderBy(asc(blInventory.itemNo))
      .limit(50),

    commonJoins(db.select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      itemType: blInventory.itemType,
      itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
      colorName: blColors.name,
      newOrUsed: blInventory.newOrUsed,
      quantity: blInventory.quantity,
      assigned: assignedExpr(blInventory.id),
    }).from(blInventory))
      .where(and(
        eq(blInventory.orgId, orgId),
        ilike(blCatalog.itemName, `%${q}%`),
        sql`${blInventory.itemNo} NOT ILIKE ${q + '%'}`
      ))
      .orderBy(asc(blCatalog.itemName))
      .limit(25),
  ]);

  res.json([...prefixMatches, ...nameMatches]);
}));

// ── Unassigned ─────────────────────────────────────────────────────────────────

router.get("/warehouse/unassigned/inventory", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const unassignedItems = await db
    .select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      itemType: blInventory.itemType,
      itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
      colorName: blColors.name,
      newOrUsed: blInventory.newOrUsed,
      quantity: blInventory.quantity,
    })
    .from(blInventory)
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
    .leftJoin(inventoryLocations, eq(blInventory.id, inventoryLocations.inventoryId))
    .where(and(eq(blInventory.orgId, orgId), sql`${inventoryLocations.id} IS NULL`))
    .orderBy(asc(blInventory.itemNo))
    .limit(2000);
  res.json(unassignedItems);
}));

// Search unassigned inventory by part number or name — bypasses the 2000-row preload cap
router.get("/warehouse/unassigned/search", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.json([]);

  const rows = await db
    .select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      itemType: blInventory.itemType,
      itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
      colorName: blColors.name,
      newOrUsed: blInventory.newOrUsed,
      quantity: blInventory.quantity,
    })
    .from(blInventory)
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
    .leftJoin(inventoryLocations, eq(blInventory.id, inventoryLocations.inventoryId))
    .where(and(
      eq(blInventory.orgId, orgId),
      sql`${inventoryLocations.id} IS NULL`,
      sql`(${blInventory.itemNo} ILIKE ${'%' + q + '%'} OR COALESCE(
        (SELECT item_name FROM bl_catalog WHERE item_no = ${blInventory.itemNo} AND item_type = ${blInventory.itemType} LIMIT 1),
        (SELECT item_name FROM price_guide_cache WHERE item_no = ${blInventory.itemNo} AND item_type = ${blInventory.itemType} AND item_name IS NOT NULL LIMIT 1)
      ) ILIKE ${'%' + q + '%'})`
    ))
    .orderBy(
      sql`CASE
        WHEN LOWER(${blInventory.itemNo}) = LOWER(${q}) THEN 0
        WHEN LOWER(${blInventory.itemNo}) LIKE LOWER(${q + '%'}) THEN 1
        WHEN LOWER(${blInventory.itemNo}) LIKE LOWER(${'%' + q + '%'}) THEN 2
        ELSE 3
      END`,
      asc(blInventory.itemNo)
    )
    .limit(30);
  res.json(rows);
}));

// Range fill: find unassigned lots whose leading part number falls between `from` and `to`
// e.g. "974" – "2335" matches 974, 974pb01, 975, 975x01, ..., 2335, 2335a
/**
 * Normalize a BrickLink item_no for range comparison.
 * Pads the trailing digit run to 4 digits so string ordering matches numeric ordering.
 * e.g.  973px3   → 973px0003
 *        973pb100 → 973pb0100
 *        973px114 → 973px0114
 */
function normalizeBLItemNo(s: string): string {
  return s.trim().toLowerCase()
    .replace(/([a-z]+)(\d+)$/, (_, letters: string, digits: string) =>
      `${letters}${digits.padStart(4, '0')}`);
}

/**
 * SQL expression that applies the same trailing-digit normalization to a column.
 * Extracts everything after the last non-digit character as the trailing number,
 * pads it to 4 digits, and re-attaches the prefix.
 * e.g.  973px3 → 973px0003,  973px114 → 973px0114
 */
const normalizeItemNoSql = (col: any) => sql<string>`(
  LEFT(LOWER(${col}),
    GREATEST(0, LENGTH(LOWER(${col})) - LENGTH(REGEXP_REPLACE(LOWER(${col}), '^.*[^0-9]', '')))
  ) || LPAD(REGEXP_REPLACE(LOWER(${col}), '^.*[^0-9]', ''), 4, '0')
)`;

router.get("/warehouse/unassigned/range", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const fromNorm = normalizeBLItemNo(String(req.query.from ?? ''));
  const toNorm   = normalizeBLItemNo(String(req.query.to   ?? ''));
  if (!fromNorm || !toNorm) return res.json([]);

  const pureNumeric = /^\d+$/.test(fromNorm) && /^\d+$/.test(toNorm);
  const fromNum = pureNumeric ? parseInt(fromNorm, 10) : NaN;
  const toNum   = pureNumeric ? parseInt(toNorm,   10) : NaN;

  // Validate ordering
  if (pureNumeric && (isNaN(fromNum) || isNaN(toNum) || fromNum > toNum)) return res.json([]);
  if (!pureNumeric && fromNorm > toNorm) return res.json([]);

  const rangeCondition = pureNumeric
    ? sql`(regexp_match(${blInventory.itemNo}, '^([0-9]+)'))[1]::integer BETWEEN ${fromNum} AND ${toNum}`
    : sql`${normalizeItemNoSql(blInventory.itemNo)} >= ${fromNorm} AND ${normalizeItemNoSql(blInventory.itemNo)} <= ${toNorm}`;

  const rows = await db
    .select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      itemType: blInventory.itemType,
      itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
      colorName: blColors.name,
      newOrUsed: blInventory.newOrUsed,
      quantity: blInventory.quantity,
      binName: whBins.name,
    })
    .from(blInventory)
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
    .leftJoin(inventoryLocations, eq(blInventory.id, inventoryLocations.inventoryId))
    .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
    .where(and(
      eq(blInventory.orgId, orgId),
      rangeCondition
    ))
    .orderBy(
      sql`(regexp_match(${blInventory.itemNo}, '^([0-9]+)'))[1]::integer`,
      normalizeItemNoSql(blInventory.itemNo)
    );
  res.json(rows);
}));

router.get("/warehouse/unassigned/bins", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const unassignedBins = await db
    .select()
    .from(whBins)
    .where(and(eq(whBins.orgId, orgId), sql`${whBins.shelfId} IS NULL`));
  res.json(unassignedBins);
}));

router.get("/warehouse/unassigned/shelves", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const unassignedShelves = await db
    .select()
    .from(whShelves)
    .where(and(eq(whShelves.orgId, orgId), sql`${whShelves.aisleId} IS NULL`));
  res.json(unassignedShelves);
}));

// ── Assignments ────────────────────────────────────────────────────────────────

router.post("/warehouse/assign/inventory", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const data = insertInventoryLocationSchema.parse(req.body);
  const [location] = await db.insert(inventoryLocations).values({ ...data, orgId }).returning();
  res.json(location);
}));

router.put("/warehouse/assign/bin/:binId/shelf/:shelfId", isApproved, asyncRoute(async (req, res) => {
  const binId = parseInt(req.params.binId);
  const shelfId = parseInt(req.params.shelfId);
  const [bin] = await db
    .update(whBins)
    .set({ shelfId, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(whBins.id, binId))
    .returning();
  if (!bin) return res.status(404).json({ error: "Bin not found" });
  res.json(bin);
}));

router.put("/warehouse/assign/shelf/:shelfId/aisle/:aisleId", isApproved, asyncRoute(async (req, res) => {
  const shelfId = parseInt(req.params.shelfId);
  const aisleId = parseInt(req.params.aisleId);
  const [shelf] = await db
    .update(whShelves)
    .set({ aisleId, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(whShelves.id, shelfId))
    .returning();
  if (!shelf) return res.status(404).json({ error: "Shelf not found" });
  res.json(shelf);
}));

// ── Locations ──────────────────────────────────────────────────────────────────

router.get("/warehouse/locations", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const locations = await db
    .select({
      id: inventoryLocations.id,
      inventoryId: inventoryLocations.inventoryId,
      itemNo: blInventory.itemNo,
      itemType: blInventory.itemType,
      itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
      colorName: blColors.name,
      newOrUsed: blInventory.newOrUsed,
      binId: inventoryLocations.binId,
      binName: whBins.name,
      bagLabel: inventoryLocations.bagLabel,
      quantity: inventoryLocations.quantity,
      shelfId: whShelves.id,
      shelfName: whShelves.name,
      aisleId: whAisles.id,
      aisleName: whAisles.name,
      notes: inventoryLocations.notes,
    })
    .from(inventoryLocations)
    .leftJoin(blInventory, eq(inventoryLocations.inventoryId, blInventory.id))
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
    .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
    .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
    .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
    .where(eq(inventoryLocations.orgId, orgId))
    .limit(1000);
  res.json(locations);
}));

router.get("/warehouse/locations/bin/:binId", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const binId = parseInt(req.params.binId);
  if (isNaN(binId)) return res.status(400).json({ error: 'Invalid binId' });
  const locs = await db
    .select({
      id: inventoryLocations.id,
      inventoryId: inventoryLocations.inventoryId,
      itemNo: blInventory.itemNo,
      itemType: blInventory.itemType,
      itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
      colorId: blInventory.colorId,
      colorName: blColors.name,
      newOrUsed: blInventory.newOrUsed,
      unitPrice: blInventory.unitPrice,
      quantity: sql<number>`COALESCE(${inventoryLocations.quantity}, ${blInventory.quantity})`,
      lotQuantity: blInventory.quantity,
      bagLabel: inventoryLocations.bagLabel,
      notes: inventoryLocations.notes,
      binId: inventoryLocations.binId,
    })
    .from(inventoryLocations)
    .leftJoin(blInventory, eq(inventoryLocations.inventoryId, blInventory.id))
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
    .where(and(eq(inventoryLocations.orgId, orgId), eq(inventoryLocations.binId, binId)))
    .orderBy(blInventory.itemNo, blInventory.colorId);
  res.json(locs);
}));

router.get("/warehouse/locations/inventory/:inventoryId", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const inventoryId = parseInt(req.params.inventoryId);
  const locs = await db
    .select({
      id: inventoryLocations.id,
      inventoryId: inventoryLocations.inventoryId,
      binId: inventoryLocations.binId,
      binName: whBins.name,
      shelfId: whShelves.id,
      shelfName: whShelves.name,
      aisleId: whAisles.id,
      aisleName: whAisles.name,
      zoneId: whZones.id,
      zoneName: whZones.name,
      zoneDepth: whZones.depth,
      quantity: inventoryLocations.quantity,
      bagLabel: inventoryLocations.bagLabel,
      notes: inventoryLocations.notes,
    })
    .from(inventoryLocations)
    .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
    .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
    .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
    .leftJoin(whZones, eq(whBins.zoneId, whZones.id))
    .where(and(eq(inventoryLocations.orgId, orgId), eq(inventoryLocations.inventoryId, inventoryId)));
  res.json(locs);
}));

router.put("/warehouse/locations/:id", isApproved, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  const data = insertInventoryLocationSchema.parse(req.body);
  const [location] = await db
    .update(inventoryLocations)
    .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(eq(inventoryLocations.id, id))
    .returning();
  if (!location) return res.status(404).json({ error: "Location not found" });
  res.json(location);
}));

router.delete("/warehouse/locations/:id", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const id = parseInt(req.params.id);
  await db.delete(inventoryLocations).where(eq(inventoryLocations.id, id));
  broadcast(orgId, 'warehouse.location_changed', { locationId: id });
  res.json({ success: true });
}));

// ── Scan ───────────────────────────────────────────────────────────────────────

router.get("/warehouse/scan/resolve", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const code  = String(req.query.code || '').trim();
  if (!code) return res.status(400).json({ error: 'code required' });

  if (code.startsWith('BIN:')) {
    const binName = code.slice(4);
    const [bin] = await db
      .select({
        id:        whBins.id,
        name:      whBins.name,
        shelfName: whShelves.name,
        aisleName: whAisles.name,
        itemCount: sql<number>`(SELECT COUNT(*) FROM inventory_locations WHERE bin_id = ${whBins.id})`,
      })
      .from(whBins)
      .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
      .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
      .where(and(eq(whBins.orgId, orgId), eq(whBins.name, binName)));
    if (!bin) return res.status(404).json({ error: `Bin "${binName}" not found` });
    return res.json({ type: 'bin', ...bin });
  }

  if (code.startsWith('LOT:')) {
    const lotId = parseInt(code.slice(4));
    if (isNaN(lotId)) return res.status(400).json({ error: 'Invalid LOT code' });

    const [lot] = await db
      .select({
        id:        blInventory.id,
        itemNo:    blInventory.itemNo,
        itemType:  blInventory.itemType,
        colorId:   blInventory.colorId,
        colorName: blColors.name,
        newOrUsed: blInventory.newOrUsed,
        quantity:  blInventory.quantity,
        price:     blInventory.price,
        remarks:   blInventory.remarks,
        itemName:  resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
      })
      .from(blInventory)
      .leftJoin(blColors, eq(blInventory.colorId, blColors.colorId))
      .where(and(eq(blInventory.orgId, orgId), eq(blInventory.id, lotId)));
    if (!lot) return res.status(404).json({ error: `Lot ${lotId} not found` });

    const locations = await db
      .select({
        id:        inventoryLocations.id,
        binId:     inventoryLocations.binId,
        binName:   whBins.name,
        shelfName: whShelves.name,
        aisleName: whAisles.name,
        bagLabel:  inventoryLocations.bagLabel,
        quantity:  inventoryLocations.quantity,
      })
      .from(inventoryLocations)
      .leftJoin(whBins,    eq(inventoryLocations.binId,   whBins.id))
      .leftJoin(whShelves, eq(whBins.shelfId,             whShelves.id))
      .leftJoin(whAisles,  eq(whShelves.aisleId,          whAisles.id))
      .where(and(eq(inventoryLocations.orgId, orgId), eq(inventoryLocations.inventoryId, lotId)));

    return res.json({ type: 'lot', ...lot, locations });
  }

  return res.status(400).json({ error: `Unrecognized code format` });
}));

// Move a lot to a bin — clears existing locations respecting filing-queue rules
router.post("/warehouse/scan/assign", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { inventoryId, binId } = req.body as { inventoryId: number; binId: number };
  if (!inventoryId || !binId) return res.status(400).json({ error: 'inventoryId and binId required' });

  // Load org setting and target bin type in parallel
  const [[org], [targetBin]] = await Promise.all([
    db.select({ oneLotPerBin: organizations.oneLotPerBin })
      .from(organizations).where(eq(organizations.id, orgId)),
    db.select({ isFilingQueue: whBins.isFilingQueue })
      .from(whBins).where(eq(whBins.id, binId)),
  ]);
  const strict = org?.oneLotPerBin ?? true;
  const targetIsFilingQueue = targetBin?.isFilingQueue ?? false;

  // Skip if already in this exact bin
  const [existing] = await db.select({ id: inventoryLocations.id })
    .from(inventoryLocations)
    .where(and(
      eq(inventoryLocations.orgId, orgId),
      eq(inventoryLocations.inventoryId, inventoryId),
      eq(inventoryLocations.binId, binId),
    ));
  if (existing) return res.json({ alreadyAssigned: true, inventoryId, binId });

  if (strict) {
    if (targetIsFilingQueue) {
      // Filing-queue exception: preserve existing non-filing-queue locations (the lot's
      // permanent filed home). Only remove any other filing-queue locations for this lot.
      await db.execute(sql`
        DELETE FROM inventory_locations
        WHERE org_id = ${orgId}
          AND inventory_id = ${inventoryId}
          AND bin_id IN (
            SELECT id FROM wh_bins WHERE is_filing_queue = true
          )
      `);
    } else {
      // Regular bin: full move — clear all existing locations
      await db.delete(inventoryLocations)
        .where(and(eq(inventoryLocations.orgId, orgId), eq(inventoryLocations.inventoryId, inventoryId)));
    }
  }
  // Loose mode: just add (dedup already handled above)

  const [location] = await db.insert(inventoryLocations)
    .values({ inventoryId, binId, orgId })
    .returning();

  broadcast(orgId, 'warehouse.location_changed', { inventoryId, binId });
  res.json(location);
}));

// ── Labels ─────────────────────────────────────────────────────────────────────

router.get("/warehouse/labels/qr", asyncRoute(async (req, res) => {
  const data = String(req.query.data || '');
  const size = Math.min(300, Math.max(50, parseInt(String(req.query.size || '120'))));
  if (!data) return res.status(400).json({ error: 'data required' });
  const QRCode = await import('qrcode');
  const svg = await QRCode.toString(data, { type: 'svg', width: size, margin: 1, color: { dark: '#000000', light: '#ffffff' } });
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(svg);
}));

// ── Settings ───────────────────────────────────────────────────────────────────

router.get("/warehouse/settings", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const [org] = await db.select({
    warehouseDepth: organizations.warehouseDepth,
    aisleFormat: organizations.aisleFormat,
    shelfFormat: organizations.shelfFormat,
    binFormat: organizations.binFormat,
    oneLotPerBin: organizations.oneLotPerBin,
  }).from(organizations).where(eq(organizations.id, orgId));
  res.json({
    depth: org?.warehouseDepth ?? 3,
    aisleFormat: org?.aisleFormat ?? 'numeric',
    shelfFormat: org?.shelfFormat ?? 'alpha',
    binFormat: org?.binFormat ?? 'numeric',
    oneLotPerBin: org?.oneLotPerBin ?? true,
  });
}));

router.patch("/warehouse/settings", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { depth, aisleFormat, shelfFormat, binFormat, oneLotPerBin } = req.body;
  const validFormats = ['alpha', 'numeric', 'alphanumeric'];
  const updates: any = { updatedAt: new Date() };
  if (depth !== undefined) {
    const d = parseInt(depth);
    if (![1, 2, 3].includes(d)) return res.status(400).json({ error: "depth must be 1, 2, or 3" });
    updates.warehouseDepth = d;
  }
  if (aisleFormat !== undefined) { if (!validFormats.includes(aisleFormat)) return res.status(400).json({ error: "Invalid aisleFormat" }); updates.aisleFormat = aisleFormat; }
  if (shelfFormat !== undefined) { if (!validFormats.includes(shelfFormat)) return res.status(400).json({ error: "Invalid shelfFormat" }); updates.shelfFormat = shelfFormat; }
  if (binFormat !== undefined)   { if (!validFormats.includes(binFormat))   return res.status(400).json({ error: "Invalid binFormat" });   updates.binFormat = binFormat; }
  if (oneLotPerBin !== undefined) updates.oneLotPerBin = Boolean(oneLotPerBin);
  await db.update(organizations).set(updates).where(eq(organizations.id, orgId));
  const [updated] = await db.select({
    warehouseDepth: organizations.warehouseDepth,
    aisleFormat: organizations.aisleFormat,
    shelfFormat: organizations.shelfFormat,
    binFormat: organizations.binFormat,
    oneLotPerBin: organizations.oneLotPerBin,
  }).from(organizations).where(eq(organizations.id, orgId));
  res.json({
    depth: updated.warehouseDepth,
    aisleFormat: updated.aisleFormat,
    shelfFormat: updated.shelfFormat,
    binFormat: updated.binFormat,
    oneLotPerBin: updated.oneLotPerBin,
  });
}));

// ── CSV Imports ────────────────────────────────────────────────────────────────

router.post("/warehouse/import/csv", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { csvText } = req.body;
  if (!csvText || typeof csvText !== 'string') return res.status(400).json({ error: "csvText is required" });

  const lines = csvText.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
  if (lines.length < 2) return res.status(400).json({ error: "CSV must have a header row and at least one data row" });

  const headers = lines[0].split(',').map((h: string) => h.trim().toLowerCase());
  const aisleIdx = headers.indexOf('aisle');
  const shelfIdx = headers.indexOf('shelf');
  const binIdx = headers.indexOf('bin');
  if (binIdx === -1) return res.status(400).json({ error: "CSV must have at least a 'bin' column" });

  const aisleCache = new Map<string, number>();
  const shelfCache = new Map<string, number>();
  const binCache = new Map<string, number>();

  const existingAisles = await db.select().from(whAisles).where(eq(whAisles.orgId, orgId));
  const existingShelves = await db.select().from(whShelves).where(eq(whShelves.orgId, orgId));
  const existingBins = await db.select().from(whBins).where(eq(whBins.orgId, orgId));
  existingAisles.forEach((a: any) => aisleCache.set(a.name.toLowerCase(), a.id));
  existingShelves.forEach((s: any) => shelfCache.set(s.name.toLowerCase(), s.id));
  existingBins.forEach((b: any) => binCache.set(b.name.toLowerCase(), b.id));

  const stats = { aisles: 0, shelves: 0, bins: 0, skipped: 0 };
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c: string) => c.trim());
    const aisleName = aisleIdx >= 0 ? (cols[aisleIdx] || '') : '';
    const shelfName = shelfIdx >= 0 ? (cols[shelfIdx] || '') : '';
    const binName   = binIdx >= 0   ? (cols[binIdx]   || '') : '';
    if (!binName) { stats.skipped++; continue; }

    try {
      let aisleId: number | null = null;
      if (aisleName) {
        const key = aisleName.toLowerCase();
        if (aisleCache.has(key)) {
          aisleId = aisleCache.get(key)!;
        } else {
          const [a] = await db.insert(whAisles).values({ name: aisleName, orgId }).returning();
          aisleId = a.id;
          aisleCache.set(key, aisleId);
          stats.aisles++;
        }
      }

      let shelfId: number | null = null;
      if (shelfName) {
        const key = shelfName.toLowerCase();
        if (shelfCache.has(key)) {
          shelfId = shelfCache.get(key)!;
        } else {
          const [s] = await db.insert(whShelves).values({ name: shelfName, aisleId, orgId }).returning();
          shelfId = s.id;
          shelfCache.set(key, shelfId);
          stats.shelves++;
        }
      }

      const binKey = binName.toLowerCase();
      if (binCache.has(binKey)) {
        stats.skipped++;
      } else {
        const [b] = await db.insert(whBins).values({ name: binName, shelfId, orgId }).returning();
        binCache.set(binKey, b.id);
        stats.bins++;
      }
    } catch (rowErr) {
      errors.push(`Row ${i + 1} (${binName}): ${rowErr instanceof Error ? rowErr.message : 'unknown error'}`);
    }
  }

  res.json({ ok: true, created: stats, errors });
}));

router.post("/warehouse/import/lot-assignments", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { csvText } = req.body;
  if (!csvText || typeof csvText !== 'string') return res.status(400).json({ error: "csvText is required" });

  const lines = csvText.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
  if (lines.length < 2) return res.status(400).json({ error: "CSV must have a header row and at least one data row" });

  const headers = lines[0].split(',').map((h: string) => h.trim().toLowerCase().replace(/[\s_-]/g, '_'));
  const partIdx = ['part_number', 'part', 'item_no', 'itemno', 'sku'].map(k => headers.indexOf(k)).find(i => i >= 0) ?? -1;
  const binIdx  = headers.indexOf('bin');
  const colorIdx = ['color_id', 'colorid', 'color'].map(k => headers.indexOf(k)).find(i => i >= 0) ?? -1;
  const condIdx  = ['condition', 'new_or_used', 'newused', 'cond'].map(k => headers.indexOf(k)).find(i => i >= 0) ?? -1;
  const qtyIdx   = ['qty', 'quantity'].map(k => headers.indexOf(k)).find(i => i >= 0) ?? -1;

  if (partIdx === -1) return res.status(400).json({ error: "CSV must have a 'part_number' column (also accepted: part, item_no, sku)" });
  if (binIdx === -1)  return res.status(400).json({ error: "CSV must have a 'bin' column" });

  const orgBins = await db.select({ id: whBins.id, name: whBins.name }).from(whBins).where(eq(whBins.orgId, orgId));
  const binCache = new Map(orgBins.map(b => [b.name.toLowerCase(), b.id]));

  const existingAssignments = await db
    .select({ inventoryId: inventoryLocations.inventoryId, binId: inventoryLocations.binId })
    .from(inventoryLocations)
    .where(eq(inventoryLocations.orgId, orgId));
  const assignedSet = new Set(existingAssignments.map(a => `${a.inventoryId}:${a.binId}`));

  const stats = { assigned: 0, skipped: 0, notFound: 0 };
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c: string) => c.trim());
    const partNumber = cols[partIdx] || '';
    const binName    = cols[binIdx]  || '';
    if (!partNumber || !binName) { stats.skipped++; continue; }

    const binId = binCache.get(binName.toLowerCase());
    if (!binId) { errors.push(`Row ${i + 1}: bin "${binName}" not found`); stats.notFound++; continue; }

    const rawCondition = condIdx >= 0 ? (cols[condIdx] || '').toUpperCase() : '';
    const condition = rawCondition === 'N' || rawCondition === 'U' ? rawCondition : null;

    const inventoryRows = await db
      .select({ id: blInventory.id, colorId: blInventory.colorId, newOrUsed: blInventory.newOrUsed })
      .from(blInventory)
      .where(and(eq(blInventory.orgId, orgId), eq(blInventory.itemNo, partNumber)));

    if (inventoryRows.length === 0) {
      errors.push(`Row ${i + 1}: part "${partNumber}" not found in inventory`);
      stats.notFound++;
      continue;
    }

    let filtered = inventoryRows;
    if (colorIdx >= 0 && cols[colorIdx]) {
      const colorId = parseInt(cols[colorIdx]);
      if (!isNaN(colorId)) filtered = filtered.filter(r => r.colorId === colorId);
    }
    if (condition) filtered = filtered.filter(r => r.newOrUsed === condition);
    if (filtered.length === 0) filtered = inventoryRows;

    const qty = qtyIdx >= 0 ? parseInt(cols[qtyIdx]) || null : null;

    for (const inv of filtered) {
      const key = `${inv.id}:${binId}`;
      if (assignedSet.has(key)) { stats.skipped++; continue; }
      try {
        await db.insert(inventoryLocations).values({ inventoryId: inv.id, binId, orgId, quantity: qty });
        assignedSet.add(key);
        stats.assigned++;
      } catch (rowErr) {
        errors.push(`Row ${i + 1} (${partNumber} → ${binName}): ${rowErr instanceof Error ? rowErr.message : 'error'}`);
      }
    }
  }

  res.json({ ok: true, stats, errors });
}));

export default router;
