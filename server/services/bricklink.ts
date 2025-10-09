import { db } from "../db";
import { blCategories, blColors, blInventory } from "@shared/schema";
import { eq } from "drizzle-orm";

export interface BricklinkSyncResult {
  categoriesAdded: number;
  categoriesUpdated: number;
  colorsAdded: number;
  colorsUpdated: number;
  inventoryAdded: number;
  inventoryUpdated: number;
  totalApiCalls: number;
}

export async function syncBricklinkCategories(): Promise<{ added: number; updated: number }> {
  // TODO: Make actual BrickLink API call
  // const response = await fetch('https://api.bricklink.com/api/store/v1/categories', {
  //   headers: { Authorization: `OAuth ${credentials}` }
  // });
  
  // Mock data for now
  const mockCategories = [
    { id: 1, name: 'Brick' },
    { id: 2, name: 'Plate' },
    { id: 3, name: 'Minifig' },
  ];

  let added = 0;
  let updated = 0;

  for (const category of mockCategories) {
    const existing = await db.select().from(blCategories).where(eq(blCategories.id, category.id));
    
    if (existing.length === 0) {
      await db.insert(blCategories).values({
        id: category.id,
        name: category.name,
      });
      added++;
    } else if (existing[0].name !== category.name) {
      await db.update(blCategories)
        .set({ name: category.name, updatedAt: new Date() })
        .where(eq(blCategories.id, category.id));
      updated++;
    }
  }

  return { added, updated };
}

export async function syncBricklinkColors(): Promise<{ added: number; updated: number }> {
  // TODO: Make actual BrickLink API call
  // const response = await fetch('https://api.bricklink.com/api/store/v1/colors', {
  //   headers: { Authorization: `OAuth ${credentials}` }
  // });

  // Mock data for now
  const mockColors = [
    { id: 0, name: 'Black', rgb: '000000', type: 'solid' },
    { id: 1, name: 'Blue', rgb: '0000FF', type: 'solid' },
    { id: 2, name: 'Red', rgb: 'FF0000', type: 'solid' },
  ];

  let added = 0;
  let updated = 0;

  for (const color of mockColors) {
    const existing = await db.select().from(blColors).where(eq(blColors.id, color.id));
    
    if (existing.length === 0) {
      await db.insert(blColors).values({
        id: color.id,
        name: color.name,
        rgb: color.rgb,
        type: color.type,
      });
      added++;
    } else {
      const needsUpdate = existing[0].name !== color.name || 
                          existing[0].rgb !== color.rgb || 
                          existing[0].type !== color.type;
      if (needsUpdate) {
        await db.update(blColors)
          .set({ 
            name: color.name, 
            rgb: color.rgb, 
            type: color.type, 
            updatedAt: new Date() 
          })
          .where(eq(blColors.id, color.id));
        updated++;
      }
    }
  }

  return { added, updated };
}

export async function syncBricklinkInventory(): Promise<{ added: number; updated: number }> {
  // TODO: Make actual BrickLink API call
  // const response = await fetch('https://api.bricklink.com/api/store/v1/inventories', {
  //   headers: { Authorization: `OAuth ${credentials}` }
  // });

  // Mock data for now
  const mockInventory = [
    {
      id: 1001,
      itemNo: '3001',
      itemType: 'PART',
      colorId: 0,
      quantity: 100,
      newOrUsed: 'N',
      unitPrice: '0.25',
      categoryId: 1,
    },
    {
      id: 1002,
      itemNo: '3002',
      itemType: 'PART',
      colorId: 1,
      quantity: 50,
      newOrUsed: 'N',
      unitPrice: '0.30',
      categoryId: 1,
    },
  ];

  let added = 0;
  let updated = 0;

  for (const item of mockInventory) {
    const existing = await db.select().from(blInventory).where(eq(blInventory.id, item.id));
    
    if (existing.length === 0) {
      await db.insert(blInventory).values({
        id: item.id,
        itemNo: item.itemNo,
        itemType: item.itemType,
        colorId: item.colorId,
        quantity: item.quantity,
        newOrUsed: item.newOrUsed,
        unitPrice: item.unitPrice,
        categoryId: item.categoryId,
      });
      added++;
    } else {
      const needsUpdate = existing[0].quantity !== item.quantity || 
                          existing[0].unitPrice !== item.unitPrice;
      if (needsUpdate) {
        await db.update(blInventory)
          .set({ 
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            updatedAt: new Date() 
          })
          .where(eq(blInventory.id, item.id));
        updated++;
      }
    }
  }

  return { added, updated };
}

export async function syncBricklinkData(): Promise<BricklinkSyncResult> {
  // Sync in order: categories, colors, then inventory
  const categoriesResult = await syncBricklinkCategories();
  const colorsResult = await syncBricklinkColors();
  const inventoryResult = await syncBricklinkInventory();

  return {
    categoriesAdded: categoriesResult.added,
    categoriesUpdated: categoriesResult.updated,
    colorsAdded: colorsResult.added,
    colorsUpdated: colorsResult.updated,
    inventoryAdded: inventoryResult.added,
    inventoryUpdated: inventoryResult.updated,
    totalApiCalls: 3, // One call for each: categories, colors, inventory
  };
}
