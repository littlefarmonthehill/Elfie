import { Router } from "express";
import { eq, and, desc, isNull, gte, lte, inArray, sql, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { asyncRoute, reqOrgId } from "../lib/routeHelpers";
import { isApproved } from "../auth";
import {
  listingBatches, listingBatchItems, blInventory, blCatalog,
  whBins, whZones, whShelves, whAisles, inventoryLocations, workerMemoryZones,
} from "@shared/schema";

const router = Router();

// ── Listing Batches ──────────────────────────────────────────────────────────

// GET /api/listing-batches — list newest non-deleted batches
router.get("/listing-batches", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const rows = await db
    .select({
      id: listingBatches.id,
      source: listingBatches.source,
      newCount: listingBatches.newCount,
      updatedCount: listingBatches.updatedCount,
      note: listingBatches.note,
      createdAt: listingBatches.createdAt,
    })
    .from(listingBatches)
    .where(and(eq(listingBatches.orgId, orgId), isNull(listingBatches.deletedAt)))
    .orderBy(desc(listingBatches.createdAt))
    .limit(200);
  res.json(rows);
}));

// GET /api/listing-batches/:id — batch detail with items joined to inventory + catalog
router.get("/listing-batches/:id", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const id = String(req.params.id);

  const [batch] = await db
    .select()
    .from(listingBatches)
    .where(and(eq(listingBatches.id, id), eq(listingBatches.orgId, orgId), isNull(listingBatches.deletedAt)))
    .limit(1);
  if (!batch) return res.status(404).json({ error: "Batch not found" });

  const items = await db
    .select({
      id: listingBatchItems.id,
      inventoryId: listingBatchItems.inventoryId,
      changeType: listingBatchItems.changeType,
      qtyDelta: listingBatchItems.qtyDelta,
      assignedBinId: listingBatchItems.assignedBinId,
      itemNo: blInventory.itemNo,
      itemType: blInventory.itemType,
      colorId: blInventory.colorId,
      newOrUsed: blInventory.newOrUsed,
      quantity: blInventory.quantity,
      remarks: blInventory.remarks,
      description: blInventory.description,
      itemName: sql<string | null>`COALESCE(${blCatalog.itemName}, NULL)`,
      colorName: sql<string | null>`COALESCE(${blCatalog.colorName}, NULL)`,
      thumbnailUrl: sql<string | null>`COALESCE(${blCatalog.thumbnailUrl}, ${blCatalog.imageUrl}, NULL)`,
      currentBinId: inventoryLocations.binId,
      currentBinName: whBins.name,
      // Aisle name is shown on the printed label as a pre-sort hint so the
      // filer can grab one tote per aisle and walk the warehouse only once.
      aisleName: whAisles.name,
    })
    .from(listingBatchItems)
    .innerJoin(blInventory, eq(blInventory.id, listingBatchItems.inventoryId))
    .leftJoin(blCatalog, and(
      eq(blCatalog.itemNo, blInventory.itemNo),
      eq(blCatalog.itemType, blInventory.itemType),
      eq(blCatalog.colorId, blInventory.colorId),
    ))
    .leftJoin(inventoryLocations, eq(inventoryLocations.inventoryId, blInventory.id))
    .leftJoin(whBins, eq(whBins.id, inventoryLocations.binId))
    .leftJoin(whShelves, eq(whShelves.id, whBins.shelfId))
    .leftJoin(whAisles, eq(whAisles.id, whShelves.aisleId))
    .where(eq(listingBatchItems.batchId, id));

  res.json({ batch, items });
}));

// DELETE /api/listing-batches/:id — soft-delete
router.delete("/listing-batches/:id", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const id = String(req.params.id);
  await db
    .update(listingBatches)
    .set({ deletedAt: new Date() })
    .where(and(eq(listingBatches.id, id), eq(listingBatches.orgId, orgId)));
  res.json({ ok: true });
}));

// POST /api/listing-batches/:id/assign-bin
// Lister fast-path: scan a bin's QR (or type its name), pick a zone, all "new"
// lots in this batch get pre-assigned to that bin via inventory_locations.
// Updated lots are untouched (they go back to their existing bins).
const assignBinSchema = z.object({
  binName: z.string().min(1),
  zoneId: z.number().int().positive(),
  itemIds: z.array(z.number().int()).optional(), // optional subset of batch_items.id
});
router.post("/listing-batches/:id/assign-bin", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const id = String(req.params.id);
  const userId = req.user?.id ? String(req.user.id) : null;
  const parsed = assignBinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
  const { binName, zoneId, itemIds } = parsed.data;

  // Verify batch exists for this org
  const [batch] = await db
    .select({ id: listingBatches.id })
    .from(listingBatches)
    .where(and(eq(listingBatches.id, id), eq(listingBatches.orgId, orgId), isNull(listingBatches.deletedAt)))
    .limit(1);
  if (!batch) return res.status(404).json({ error: "Batch not found" });

  // Verify zone belongs to org
  const [zone] = await db
    .select({ id: whZones.id })
    .from(whZones)
    .where(and(eq(whZones.id, zoneId), eq(whZones.orgId, orgId)))
    .limit(1);
  if (!zone) return res.status(400).json({ error: "Invalid zone" });

  // Find existing bin by name in org, or create it (zone set, depth deferred).
  let [bin] = await db
    .select({ id: whBins.id, zoneId: whBins.zoneId })
    .from(whBins)
    .where(and(eq(whBins.orgId, orgId), eq(whBins.name, binName)))
    .limit(1);
  if (!bin) {
    const [created] = await db
      .insert(whBins)
      .values({ name: binName, orgId, zoneId, isFilingQueue: false })
      .returning({ id: whBins.id, zoneId: whBins.zoneId });
    bin = created;
  } else if (bin.zoneId == null) {
    // Bin exists but unzoned — adopt the zone supplied by the lister.
    await db.update(whBins).set({ zoneId, updatedAt: new Date() }).where(eq(whBins.id, bin.id));
    bin.zoneId = zoneId;
  }

  // Select target items: all "new" rows in the batch (optionally narrowed)
  const itemRows = await db
    .select({ id: listingBatchItems.id, inventoryId: listingBatchItems.inventoryId })
    .from(listingBatchItems)
    .where(and(
      eq(listingBatchItems.batchId, id),
      eq(listingBatchItems.changeType, 'new'),
      ...(itemIds && itemIds.length > 0 ? [inArray(listingBatchItems.id, itemIds)] : []),
    ));

  if (itemRows.length === 0) return res.json({ ok: true, assigned: 0, binId: bin.id });

  // Upsert inventory_locations for each lot (one row per lot — co-location handled separately)
  let assigned = 0;
  for (const r of itemRows) {
    const existing = await db
      .select({ id: inventoryLocations.id })
      .from(inventoryLocations)
      .where(eq(inventoryLocations.inventoryId, r.inventoryId))
      .limit(1);
    if (existing.length === 0) {
      await db.insert(inventoryLocations).values({
        inventoryId: r.inventoryId,
        binId: bin.id,
        orgId,
      });
    } else {
      await db.update(inventoryLocations)
        .set({ binId: bin.id, updatedAt: new Date() })
        .where(eq(inventoryLocations.id, existing[0].id));
    }
    assigned++;
  }

  // Mark items as pre-assigned in the batch
  await db.update(listingBatchItems)
    .set({ assignedBinId: bin.id })
    .where(and(
      eq(listingBatchItems.batchId, id),
      inArray(listingBatchItems.inventoryId, itemRows.map(r => r.inventoryId)),
    ));

  // Update lister memory zone for this user
  if (userId) {
    await db.insert(workerMemoryZones)
      .values({ userId, orgId, listerZoneId: zoneId, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: workerMemoryZones.userId,
        set: { listerZoneId: zoneId, orgId, updatedAt: new Date() },
      });
  }

  res.json({ ok: true, assigned, binId: bin.id });
}));

// GET /api/listing-batches/range/labels — returns lots in a date range for label print
// Uses bl_inventory.synced_at by default (covers both new + qty-updated). Includes
// already-filed lots (the lister prints labels for the new physical bags).
router.get("/listing-batches/range/labels", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const from = req.query.from ? new Date(String(req.query.from)) : null;
  const to = req.query.to ? new Date(String(req.query.to)) : null;
  if (!from || !to || isNaN(from.getTime()) || isNaN(to.getTime())) {
    return res.status(400).json({ error: "from and to are required ISO dates" });
  }

  const rows = await db
    .select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      itemType: blInventory.itemType,
      colorId: blInventory.colorId,
      newOrUsed: blInventory.newOrUsed,
      quantity: blInventory.quantity,
      remarks: blInventory.remarks,
      description: blInventory.description,
      dateCreated: blInventory.dateCreated,
      itemName: sql<string | null>`COALESCE(${blCatalog.itemName}, NULL)`,
      colorName: sql<string | null>`COALESCE(${blCatalog.colorName}, NULL)`,
      thumbnailUrl: sql<string | null>`COALESCE(${blCatalog.thumbnailUrl}, ${blCatalog.imageUrl}, NULL)`,
      // Aisle of the lot's current bin (if any) — for pre-sort label hints.
      aisleName: whAisles.name,
    })
    .from(blInventory)
    .leftJoin(blCatalog, and(
      eq(blCatalog.itemNo, blInventory.itemNo),
      eq(blCatalog.itemType, blInventory.itemType),
      eq(blCatalog.colorId, blInventory.colorId),
    ))
    .leftJoin(inventoryLocations, eq(inventoryLocations.inventoryId, blInventory.id))
    .leftJoin(whBins, eq(whBins.id, inventoryLocations.binId))
    .leftJoin(whShelves, eq(whShelves.id, whBins.shelfId))
    .leftJoin(whAisles, eq(whAisles.id, whShelves.aisleId))
    .where(and(
      eq(blInventory.orgId, orgId),
      isNull(blInventory.deletedAt),
      gte(blInventory.syncedAt, from),
      lte(blInventory.syncedAt, to),
    ))
    .limit(2000);

  // Derive changeType from the lot's BrickLink creation date relative to the
  // requested window. A lot whose dateCreated falls inside the range is "new"
  // (was first listed in this window); anything older was already on the shelf
  // and merely had its quantity touched, i.e. "qty_updated".
  const fromMs = from.getTime();
  const enriched = rows.map(r => ({
    ...r,
    changeType: r.dateCreated && r.dateCreated.getTime() >= fromMs
      ? 'new' as const
      : 'qty_updated' as const,
  }));

  res.json(enriched);
}));

// ── Worker memory zones ──────────────────────────────────────────────────────

router.get("/worker/memory-zone", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const userId = req.user?.id ? String(req.user.id) : null;
  if (!userId) return res.json({ listerZoneId: null, filerZoneId: null, filerLastBinId: null });
  const [row] = await db
    .select()
    .from(workerMemoryZones)
    .where(and(eq(workerMemoryZones.userId, userId), eq(workerMemoryZones.orgId, orgId)))
    .limit(1);
  res.json(row ?? { listerZoneId: null, filerZoneId: null, filerLastBinId: null });
}));

const memoryZonePatchSchema = z.object({
  listerZoneId: z.number().int().nullable().optional(),
  filerZoneId: z.number().int().nullable().optional(),
  filerLastBinId: z.number().int().nullable().optional(),
});
router.patch("/worker/memory-zone", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const userId = req.user?.id ? String(req.user.id) : null;
  if (!userId) return res.status(401).json({ error: "Not authenticated" });
  const parsed = memoryZonePatchSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
  const set: any = { orgId, updatedAt: new Date() };
  if (parsed.data.listerZoneId !== undefined) set.listerZoneId = parsed.data.listerZoneId;
  if (parsed.data.filerZoneId !== undefined) set.filerZoneId = parsed.data.filerZoneId;
  if (parsed.data.filerLastBinId !== undefined) set.filerLastBinId = parsed.data.filerLastBinId;
  await db.insert(workerMemoryZones)
    .values({ userId, orgId, ...set })
    .onConflictDoUpdate({ target: workerMemoryZones.userId, set });
  res.json({ ok: true });
}));

export default router;
