import { db } from "../db";
import { inventoryHistory, InsertInventoryHistory } from "@shared/schema";

export async function recordInventoryChanges(changes: InsertInventoryHistory[]): Promise<void> {
  if (changes.length === 0) return;
  try {
    await db.insert(inventoryHistory).values(changes);
  } catch (err) {
    console.error('[InventoryHistory] Failed to record changes:', err);
  }
}

export function buildChanges(
  existing: Record<string, any>,
  updated: Record<string, any>,
  fields: string[],
  meta: {
    orgId: string;
    inventoryId: number;
    itemNo: string;
    colorId?: number | null;
    source: string;
    sourceRef?: string | null;
  },
): InsertInventoryHistory[] {
  const changedAt = new Date();
  const rows: InsertInventoryHistory[] = [];

  for (const field of fields) {
    const oldRaw = existing[field];
    const newRaw = updated[field];
    const oldStr = oldRaw == null ? null : String(oldRaw);
    const newStr = newRaw == null ? null : String(newRaw);
    if (oldStr !== newStr) {
      rows.push({
        orgId: meta.orgId,
        inventoryId: meta.inventoryId,
        itemNo: meta.itemNo,
        colorId: meta.colorId ?? null,
        changedAt,
        source: meta.source,
        sourceRef: meta.sourceRef ?? null,
        field,
        oldValue: oldStr,
        newValue: newStr,
      });
    }
  }

  return rows;
}
