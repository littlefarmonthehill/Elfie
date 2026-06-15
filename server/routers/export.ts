import { Router } from 'express';
import { asyncRoute, reqOrgId } from '../lib/routeHelpers';
import { isApproved } from '../auth';
import { db } from '../db';
import { blInventory } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { generateBrickLinkXML, generateInventoryCSV } from '../services/export';

const router = Router();

// GET /api/export/bricklink-xml
router.get('/export/bricklink-xml', isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const xml = await generateBrickLinkXML(orgId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `elfie-inventory-${timestamp}.xml`;
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(xml);
}));

// GET /api/export/inventory-csv
router.get('/export/inventory-csv', isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const csv = await generateInventoryCSV(orgId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `elfie-inventory-${timestamp}.csv`;
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}));

// GET /api/bricklink-quantity-comparison — compare live BL inventory vs local
router.get('/bricklink-quantity-comparison', isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { bricklinkRequest } = await import('../services/bricklink');
  const { data: blLiveData } = await bricklinkRequest('/inventories', undefined, orgId);
  const blLiveItems: any[] = Array.isArray(blLiveData) ? blLiveData : [];

  const localItems = await db.select().from(blInventory).where(eq(blInventory.orgId, orgId));
  const localMap = new Map<number, typeof localItems[0]>();
  for (const item of localItems) localMap.set(item.id, item);

  const discrepancies: Array<{
    inventoryId: number;
    itemNo: string;
    itemType: string;
    colorId: number;
    condition: string;
    localQty: number | null;
    bricklinkQty: number;
    difference: number;
    unitPrice: string;
    remarks: string;
  }> = [];

  for (const blItem of blLiveItems) {
    const id = blItem.inventory_id;
    const blQty = blItem.quantity ?? 0;
    const local = localMap.get(id);
    const localQty = local ? local.quantity : null;
    if (localQty === null || localQty !== blQty) {
      discrepancies.push({
        inventoryId: id,
        itemNo: blItem.item?.no ?? '',
        itemType: blItem.item?.type ?? '',
        colorId: blItem.color_id ?? 0,
        condition: blItem.new_or_used ?? '',
        localQty,
        bricklinkQty: blQty,
        difference: blQty - (localQty ?? 0),
        unitPrice: blItem.unit_price ?? '',
        remarks: blItem.remarks ?? '',
      });
    }
  }

  discrepancies.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
  res.json({ success: true, total: blLiveItems.length, discrepancies });
}));

export default router;
