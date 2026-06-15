import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { bulkLots } from '@shared/schema';
import { isApproved } from '../auth';
import { asyncRoute, reqOrgId } from '../lib/routeHelpers';
import { getPlatformOpenAIKey } from '../lib/platformSettings';
import { trackUsage } from '../services/ai-usage-tracker';

const router = Router();
router.use(isApproved);

// GET /api/bulk-lots/suggestions — AI-suggested lot groupings from inventory
router.get('/suggestions', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const sample = await db.execute(sql`
    SELECT
      inv.id, inv.item_no, inv.item_type, inv.color_id, inv.quantity, inv.unit_price,
      inv.new_or_used, inv.is_stock_room, inv.stock_room_id,
      COALESCE(
        (SELECT item_name FROM bl_catalog WHERE item_no = inv.item_no AND item_type = inv.item_type ORDER BY (color_id = COALESCE(inv.color_id,0))::int DESC LIMIT 1),
        inv.item_no
      ) AS item_name,
      COALESCE((SELECT name FROM bl_colors WHERE id = inv.color_id LIMIT 1), 'No Color') AS color_name,
      COALESCE((SELECT name FROM bl_categories WHERE id = (SELECT category_id FROM bl_catalog WHERE item_no = inv.item_no AND item_type = inv.item_type LIMIT 1)), 'Unknown') AS category_name
    FROM bl_inventory inv
    WHERE inv.org_id = ${orgId}
      AND inv.deleted_at IS NULL
      AND inv.quantity > 0
      AND inv.item_type = 'PART'
    ORDER BY inv.quantity DESC
    LIMIT 80
  `);
  const openaiKey = await getPlatformOpenAIKey();
  if (!openaiKey || sample.rows.length === 0) return res.json({ suggestions: [] });
  const { OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: openaiKey });
  const inventorySummary = sample.rows.slice(0, 60).map((r: any) =>
    `id:${r.id} | ${r.item_name} (${r.item_no}) | Color: ${r.color_name} | Category: ${r.category_name} | Qty: ${r.quantity} | Price: $${r.unit_price ?? '?'}`
  ).join('\n');
  const prompt = `You are a LEGO reseller assistant helping create bulk lot suggestions.

Here is a sample of the seller's current BrickLink inventory (highest quantity lots):
${inventorySummary}

Suggest 3-5 specific bulk lot groupings that would make sense to sell as a bundle on BrickOwl. Each suggestion should:
- Have a descriptive, appealing listing title
- Include specific inventory IDs from the list above (use the id: field)
- Be one of these types: "same_part" (one part, multiple colors) or "mixed_parts" (various parts with a theme)
- Have a brief rationale explaining why this grouping makes commercial sense

Respond ONLY with valid JSON array, no markdown, no explanation:
[
  {
    "title": "...",
    "type": "same_part" | "mixed_parts",
    "rationale": "...",
    "inventoryIds": [123, 456],
    "suggestedPrice": 4.99
  }
]`;
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 1200,
    temperature: 0.7,
  });
  if (completion.usage) trackUsage({ service: 'openai', model: 'gpt-4o-mini', operation: 'bulk-lot-suggestions', inputTokens: completion.usage.prompt_tokens || 0, outputTokens: completion.usage.completion_tokens || 0, totalTokens: completion.usage.total_tokens || 0, orgId });
  const text = completion.choices[0]?.message?.content?.trim() ?? '[]';
  let suggestions: any[] = [];
  try { suggestions = JSON.parse(text); } catch { suggestions = []; }
  const idSet = new Set(sample.rows.map((r: any) => r.id));
  const enriched = suggestions.map((s: any) => ({
    ...s,
    items: (s.inventoryIds ?? []).filter((id: number) => idSet.has(id)).map((id: number) =>
      sample.rows.find((r: any) => r.id === id)
    ).filter(Boolean),
  }));
  res.json({ suggestions: enriched });
}));

// GET /api/bulk-lots/inventory-search
router.get('/inventory-search', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const q = String(req.query.q || '').trim();
  const limit = Math.min(50, parseInt(String(req.query.limit || '30')));
  const itemType = String(req.query.itemType || '');
  const rows = await db.execute(sql`
    SELECT
      inv.id, inv.item_no, inv.item_type, inv.color_id, inv.quantity, inv.unit_price,
      inv.new_or_used, inv.remarks, inv.is_stock_room, inv.stock_room_id,
      COALESCE(
        (SELECT item_name FROM bl_catalog WHERE item_no = inv.item_no AND item_type = inv.item_type ORDER BY (color_id = COALESCE(inv.color_id,0))::int DESC LIMIT 1),
        inv.item_no
      ) AS item_name,
      COALESCE((SELECT name FROM bl_colors WHERE id = inv.color_id LIMIT 1), 'No Color') AS color_name,
      COALESCE((SELECT name FROM bl_categories WHERE id = (SELECT category_id FROM bl_catalog WHERE item_no = inv.item_no AND item_type = inv.item_type LIMIT 1)), '') AS category_name
    FROM bl_inventory inv
    WHERE inv.org_id = ${orgId}
      AND inv.deleted_at IS NULL
      AND inv.quantity > 0
      ${itemType ? sql`AND inv.item_type = ${itemType}` : sql``}
      ${q ? sql`AND (inv.item_no ILIKE ${'%' + q + '%'} OR EXISTS (SELECT 1 FROM bl_catalog c WHERE c.item_no = inv.item_no AND c.item_name ILIKE ${'%' + q + '%'}))` : sql``}
    ORDER BY inv.quantity DESC
    LIMIT ${limit}
  `);
  res.json(rows.rows);
}));

// GET /api/bulk-lots
router.get('/', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const rows = await db.execute(sql`
    SELECT
      bl.id, bl.name, bl.description, bl.bulk_type, bl.unit_price,
      bl.quantity, bl.condition, bl.status,
      bl.bo_boid, bl.bo_lot_id, bl.last_synced_at, bl.sync_error,
      bl.created_at, bl.updated_at,
      COUNT(bli.id)::int AS item_count,
      COALESCE(SUM(bli.quantity), 0)::int AS total_quantity
    FROM bulk_lots bl
    LEFT JOIN bulk_lot_items bli ON bli.bulk_lot_id = bl.id
    WHERE bl.org_id = ${orgId}
    GROUP BY bl.id
    ORDER BY bl.updated_at DESC
  `);
  res.json(rows.rows);
}));

// GET /api/bulk-lots/:id
router.get('/:id', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const [lot] = await db.execute(sql`
    SELECT id, name, description, bulk_type, unit_price, quantity, condition, status,
           bo_boid, bo_lot_id, last_synced_at, sync_error, created_at, updated_at
    FROM bulk_lots WHERE id = ${id} AND org_id = ${orgId}
  `).then(r => r.rows);
  if (!lot) return res.status(404).json({ error: 'Not found' });
  const items = await db.execute(sql`
    SELECT
      bli.id, bli.bl_inventory_id, bli.quantity, bli.created_at,
      inv.item_no, inv.item_type, inv.color_id, inv.quantity AS inv_quantity,
      inv.unit_price AS inv_unit_price, inv.new_or_used, inv.remarks,
      COALESCE(
        (SELECT item_name FROM bl_catalog WHERE item_no = inv.item_no AND item_type = inv.item_type ORDER BY (color_id = COALESCE(inv.color_id,0))::int DESC LIMIT 1),
        inv.item_no
      ) AS item_name,
      COALESCE(
        (SELECT name FROM bl_colors WHERE id = inv.color_id LIMIT 1),
        'No Color'
      ) AS color_name
    FROM bulk_lot_items bli
    JOIN bl_inventory inv ON inv.id = bli.bl_inventory_id
    WHERE bli.bulk_lot_id = ${id}
    ORDER BY bli.created_at
  `);
  res.json({ ...lot, items: items.rows });
}));

// POST /api/bulk-lots
router.post('/', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { name, description, bulkType, unitPrice, status, condition, quantity } = req.body;
  if (!name || !bulkType) return res.status(400).json({ error: 'name and bulkType are required' });
  if (!['same_part', 'mixed_parts'].includes(bulkType)) return res.status(400).json({ error: 'Invalid bulkType' });
  const cond = condition && ['N', 'U'].includes(condition) ? condition : 'U';
  const qty  = quantity && Number.isInteger(Number(quantity)) && Number(quantity) >= 1 ? Number(quantity) : 1;
  const [row] = await db.execute(sql`
    INSERT INTO bulk_lots (org_id, name, description, bulk_type, unit_price, status, condition, quantity)
    VALUES (${orgId}, ${name}, ${description ?? null}, ${bulkType}, ${unitPrice ?? null}, ${status ?? 'draft'}, ${cond}, ${qty})
    RETURNING *
  `).then(r => r.rows);
  res.json(row);
}));

// PATCH /api/bulk-lots/:id
router.patch('/:id', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { name, description, unitPrice, status, quantity, condition } = req.body;
  const patch: Record<string, any> = { updatedAt: new Date() };
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  if (unitPrice !== undefined) patch.unitPrice = unitPrice;
  if (status !== undefined) {
    if (!['draft', 'active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
    patch.status = status;
  }
  if (quantity !== undefined) {
    const qty = parseInt(quantity);
    if (isNaN(qty) || qty < 1) return res.status(400).json({ error: 'quantity must be a positive integer' });
    patch.quantity = qty;
  }
  if (condition !== undefined) {
    if (!['N', 'U'].includes(condition)) return res.status(400).json({ error: 'condition must be N or U' });
    patch.condition = condition;
  }
  if (Object.keys(patch).length === 1) return res.status(400).json({ error: 'No updatable fields provided' });
  const [row] = await db.update(bulkLots)
    .set(patch)
    .where(and(eq(bulkLots.id, id), eq(bulkLots.orgId, orgId)))
    .returning();
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
}));

// DELETE /api/bulk-lots/:id
router.delete('/:id', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = await db.execute(sql`DELETE FROM bulk_lots WHERE id = ${id} AND org_id = ${orgId} RETURNING id`);
  if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
}));

// POST /api/bulk-lots/:id/items
router.post('/:id/items', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const bulkLotId = parseInt(req.params.id);
  if (isNaN(bulkLotId)) return res.status(400).json({ error: 'Invalid id' });
  const { blInventoryId, quantity } = req.body;
  if (!blInventoryId) return res.status(400).json({ error: 'blInventoryId required' });
  const [lot] = await db.execute(sql`SELECT id FROM bulk_lots WHERE id = ${bulkLotId} AND org_id = ${orgId}`).then(r => r.rows);
  if (!lot) return res.status(404).json({ error: 'Bulk lot not found' });
  const [inv] = await db.execute(sql`SELECT id, quantity FROM bl_inventory WHERE id = ${blInventoryId} AND org_id = ${orgId} AND deleted_at IS NULL`).then(r => r.rows);
  if (!inv) return res.status(404).json({ error: 'Inventory lot not found' });
  const qty = Math.max(1, parseInt(quantity) || 1);
  const [row] = await db.execute(sql`
    INSERT INTO bulk_lot_items (bulk_lot_id, bl_inventory_id, quantity)
    VALUES (${bulkLotId}, ${blInventoryId}, ${qty})
    ON CONFLICT DO NOTHING
    RETURNING *
  `).then(r => r.rows);
  await db.execute(sql`UPDATE bulk_lots SET updated_at = now() WHERE id = ${bulkLotId}`);
  res.json(row ?? { bulkLotId, blInventoryId, quantity: qty });
}));

// DELETE /api/bulk-lots/:id/items/:itemId
router.delete('/:id/items/:itemId', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const bulkLotId = parseInt(req.params.id);
  const itemId = parseInt(req.params.itemId);
  if (isNaN(bulkLotId) || isNaN(itemId)) return res.status(400).json({ error: 'Invalid id' });
  const [lot] = await db.execute(sql`SELECT id FROM bulk_lots WHERE id = ${bulkLotId} AND org_id = ${orgId}`).then(r => r.rows);
  if (!lot) return res.status(404).json({ error: 'Bulk lot not found' });
  await db.execute(sql`DELETE FROM bulk_lot_items WHERE id = ${itemId} AND bulk_lot_id = ${bulkLotId}`);
  await db.execute(sql`UPDATE bulk_lots SET updated_at = now() WHERE id = ${bulkLotId}`);
  res.json({ ok: true });
}));

// POST /api/bulk-lots/:id/sync-to-bo
router.post('/:id/sync-to-bo', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const [lot] = await db.execute(sql`
    SELECT id, name, description, bulk_type, unit_price, quantity, condition,
           status, bo_boid, bo_lot_id
    FROM bulk_lots WHERE id = ${id} AND org_id = ${orgId}
  `).then(r => r.rows) as any[];
  if (!lot) return res.status(404).json({ error: 'Not found' });
  if (!lot.unit_price) return res.status(400).json({ error: 'Set a price before syncing to BrickOwl' });

  const { createBrickOwlLot, updateBrickOwlLot, toBOApiCondition } = await import('../services/brickowl');
  const boCondition = toBOApiCondition(lot.condition ?? 'U', undefined);

  if (lot.bo_lot_id) {
    await updateBrickOwlLot({
      lot_id: lot.bo_lot_id,
      absolute_quantity: lot.quantity ?? 1,
      price: parseFloat(lot.unit_price),
      public_note: lot.description ?? undefined,
      condition: boCondition,
      for_sale: lot.status === 'active' ? 1 : 0,
    }, orgId);
    await db.execute(sql`
      UPDATE bulk_lots
      SET last_synced_at = now(), sync_error = null, updated_at = now()
      WHERE id = ${id}
    `);
    return res.json({ ok: true, boLotId: lot.bo_lot_id, boBoid: lot.bo_boid });
  }

  let boBoid = lot.bo_boid as string | null;
  if (!boBoid) {
    const { randomUUID } = await import('crypto');
    boBoid = `ELFIE-BULK-${randomUUID()}`;
    await db.execute(sql`UPDATE bulk_lots SET bo_boid = ${boBoid} WHERE id = ${id}`);
  }

  try {
    const boResult = await createBrickOwlLot({
      boid:        boBoid,
      quantity:    lot.quantity ?? 1,
      price:       parseFloat(lot.unit_price),
      condition:   boCondition,
      for_sale:    lot.status === 'active' ? 1 : 0,
      public_note: lot.description ?? undefined,
      external_id: String(id),
    }, orgId);
    const boLotId = boResult?.lot_id ? String(boResult.lot_id) : null;
    await db.execute(sql`
      UPDATE bulk_lots
      SET bo_lot_id = ${boLotId}, bo_boid = ${boBoid},
          last_synced_at = now(), sync_error = null, updated_at = now()
      WHERE id = ${id}
    `);
    res.json({ ok: true, boLotId, boBoid });
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : String(err);
    await db.execute(sql`UPDATE bulk_lots SET sync_error = ${msg}, updated_at = now() WHERE id = ${id}`).catch(() => {});
    throw err;
  }
}));

export default router;
