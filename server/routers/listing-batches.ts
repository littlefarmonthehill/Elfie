import { Router } from "express";
import { eq, and, isNull, gte, lte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { asyncRoute, reqOrgId } from "../lib/routeHelpers";
import { isApproved } from "../auth";
import { blInventory, blCatalog, workerMemoryZones } from "@shared/schema";

const router = Router();

// Resolve the aisle hint ("rtf N") for a lot using a hierarchical fallback so
// brand-new lots inherit the tote of the bins that already hold their siblings.
// Filing rules: a part may live in one bin (part only), split into new/used
// (part+condition), or further split by color (part+condition+color). A new
// lot with no bin of its own should still pre-file into the bag that already
// holds its closest sibling.
//
// Priority (highest first):
//   0. this lot's own bin (exact part+color+condition)
//   1. sibling lot with same part+color+condition
//   2. sibling lot with same part+condition (any color)
//   3. sibling lot with same part (any condition, any color)
export const lotAisleHintSql = sql<string | null>`(
  SELECT wa.name
  FROM bl_inventory sib
  JOIN inventory_locations il ON il.inventory_id = sib.id
  JOIN wh_bins wb ON wb.id = il.bin_id
  JOIN wh_shelves ws ON ws.id = wb.shelf_id
  JOIN wh_aisles wa ON wa.id = ws.aisle_id
  WHERE sib.org_id = ${blInventory.orgId}
    AND sib.item_no = ${blInventory.itemNo}
    AND sib.item_type = ${blInventory.itemType}
    AND sib.deleted_at IS NULL
    AND wa.name IS NOT NULL
  ORDER BY
    CASE
      WHEN sib.id = ${blInventory.id} THEN 0
      WHEN sib.color_id IS NOT DISTINCT FROM ${blInventory.colorId}
        AND sib.new_or_used = ${blInventory.newOrUsed} THEN 1
      WHEN sib.new_or_used = ${blInventory.newOrUsed} THEN 2
      ELSE 3
    END,
    wa.name ASC
  LIMIT 1
)`;

// POST /api/listing-batches/mark-rtf — record an aisle-keyed Ready-to-File
// hint on a set of lots after their labels have been printed during the
// listing flow. The label PDF is the source of truth for which physical bag
// went into which pre-file tote, so the client just echoes that back here.
const markRtfSchema = z.object({
  items: z.array(z.object({
    inventoryId: z.number().int().positive(),
    rtfBin: z.string().min(1).max(32),
  })).min(1).max(2000),
});
router.post("/listing-batches/mark-rtf", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const parsed = markRtfSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body", details: parsed.error.format() });
  // Group by rtfBin value so we can do one UPDATE per distinct tote.
  const byBin = new Map<string, number[]>();
  for (const it of parsed.data.items) {
    const arr = byBin.get(it.rtfBin) ?? [];
    arr.push(it.inventoryId);
    byBin.set(it.rtfBin, arr);
  }
  const now = new Date();
  let updated = 0;
  for (const [rtfBin, ids] of byBin.entries()) {
    const result = await db.update(blInventory)
      .set({ rtfBin, labelPrintedAt: now })
      .where(and(eq(blInventory.orgId, orgId), inArray(blInventory.id, ids)));
    updated += (result as any)?.rowCount ?? ids.length;
  }
  res.json({ ok: true, updated });
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

  // One row per lot — pull the aisle hint via a hierarchical scalar subquery
  // so a brand-new color/condition lot inherits the tote of its closest
  // sibling (part+condition first, then part-only) instead of falling through
  // to "rtf 0". Sort by aisle then item_no so the printed run is in a
  // predictable physical order for the filer.
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
      labelPrintedAt: blInventory.labelPrintedAt,
      itemName: sql<string | null>`COALESCE(${blCatalog.itemName}, NULL)`,
      colorName: sql<string | null>`COALESCE(${blCatalog.colorName}, NULL)`,
      thumbnailUrl: sql<string | null>`COALESCE(${blCatalog.thumbnailUrl}, ${blCatalog.imageUrl}, NULL)`,
      // Aisle hint for pre-sort labels, falling back to part+condition then
      // part-only siblings so new colors land with their existing bins.
      aisleName: lotAisleHintSql.as('aisle_name'),
    })
    .from(blInventory)
    .leftJoin(blCatalog, and(
      eq(blCatalog.itemNo, blInventory.itemNo),
      eq(blCatalog.itemType, blInventory.itemType),
      eq(blCatalog.colorId, blInventory.colorId),
    ))
    .where(and(
      eq(blInventory.orgId, orgId),
      isNull(blInventory.deletedAt),
      gte(blInventory.syncedAt, from),
      lte(blInventory.syncedAt, to),
    ))
    .orderBy(sql`aisle_name NULLS LAST`, blInventory.itemNo, blInventory.colorId)
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
