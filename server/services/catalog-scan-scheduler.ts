import { db } from "../db";
import { appSettings, blCatalog, blInventory, priceGuideCache, syncMetadata, PLATFORM_ORG_ID } from "@shared/schema";
import { eq, and, or, isNull, sql, lt, gt, count } from "drizzle-orm";

const ORG_ID = PLATFORM_ORG_ID;
const SYNC_ID = 'catalog_scan';

let running = false;

export function getCatalogScanIsRunning() { return running; }

export async function startCatalogScanScheduler() {
  console.log('🔎 Inventory Catalog Scan scheduler initialized');
  setInterval(async () => { await checkAndRun(); }, 60 * 1000);
}

async function checkAndRun() {
  try {
    const [settings] = await db.select({
      enabled: appSettings.catalogScanEnabled,
      frequencyHours: appSettings.catalogScanFrequencyHours,
    }).from(appSettings).where(eq(appSettings.id, ORG_ID)).limit(1);

    if (!settings?.enabled) return;

    const [meta] = await db.select().from(syncMetadata)
      .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, SYNC_ID)))
      .limit(1);

    const lastRun = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;
    const intervalMs = (settings.frequencyHours ?? 2) * 60 * 60 * 1000;
    if (Date.now() - lastRun < intervalMs) return;

    if (running) return;

    await runCatalogScan();
  } catch (error) {
    console.error('[CatalogScan] Scheduler check error:', error);
  }
}

export interface CatalogScanResult {
  inventoryRowsScanned: number;
  missingCatalogEntries: number;
  catalogEntriesCreated: number;
  staleCatalogDetail: number;
  missingPriceGuide: number;
  stalePriceGuide: number;
}

export async function runCatalogScan(): Promise<CatalogScanResult> {
  if (running) {
    return { inventoryRowsScanned: 0, missingCatalogEntries: 0, catalogEntriesCreated: 0, staleCatalogDetail: 0, missingPriceGuide: 0, stalePriceGuide: 0 };
  }
  running = true;

  const [settings] = await db.select({
    zeroStockSkip: appSettings.catalogScanZeroStockSkip,
    detailFreshnessDays: appSettings.catalogDetailFreshnessDays,
    pomFreshnessDays: appSettings.pomFreshnessDays,
  }).from(appSettings).where(eq(appSettings.id, ORG_ID)).limit(1);

  const zeroStockSkip = settings?.zeroStockSkip ?? true;
  const detailFreshnessDays = settings?.detailFreshnessDays ?? 90;
  const pomFreshnessDays = settings?.pomFreshnessDays ?? 180;

  await db.insert(syncMetadata).values({
    id: SYNC_ID,
    lastSyncStatus: 'in_progress',
    lastSyncTime: new Date(),
    recordsAdded: 0,
    recordsUpdated: 0,
    orgId: ORG_ID,
  }).onConflictDoUpdate({
    target: syncMetadata.id,
    set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date(), errorMessage: null },
  });

  try {
    const quantityFilter = zeroStockSkip ? gt(blInventory.quantity, 0) : sql`true`;

    const [invCount] = await db.select({ count: count() }).from(blInventory).where(quantityFilter);
    const inventoryRowsScanned = Number(invCount?.count || 0);

    const colorMatch = sql`COALESCE(${blInventory.colorId}, 0) = ${blCatalog.colorId}`;

    const missingRows = await db
      .selectDistinctOn([blInventory.itemNo, blInventory.itemType, blInventory.colorId], {
        itemNo: blInventory.itemNo,
        itemType: blInventory.itemType,
        colorId: blInventory.colorId,
      })
      .from(blInventory)
      .leftJoin(blCatalog, and(
        eq(blInventory.itemNo, blCatalog.itemNo),
        eq(blInventory.itemType, blCatalog.itemType),
        colorMatch,
      ))
      .where(and(quantityFilter, isNull(blCatalog.itemNo)));

    const missingCatalogEntries = missingRows.length;

    let catalogEntriesCreated = 0;
    if (missingRows.length > 0) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < missingRows.length; i += BATCH_SIZE) {
        const batch = missingRows.slice(i, i + BATCH_SIZE);
        const inserted = await db.insert(blCatalog)
          .values(batch.map(r => ({
            itemNo: r.itemNo,
            itemType: r.itemType,
            colorId: r.colorId ?? 0,
          })))
          .onConflictDoNothing()
          .returning({ itemNo: blCatalog.itemNo });
        catalogEntriesCreated += inserted.length;
      }
    }

    const detailStaleThreshold = new Date(Date.now() - detailFreshnessDays * 24 * 60 * 60 * 1000);
    const [staleDetailRow] = await db
      .select({ count: sql<number>`count(DISTINCT (${blCatalog.itemNo}, ${blCatalog.itemType}))` })
      .from(blCatalog)
      .innerJoin(blInventory, and(
        eq(blCatalog.itemNo, blInventory.itemNo),
        eq(blCatalog.itemType, blInventory.itemType),
        sql`COALESCE(${blInventory.colorId}, 0) = ${blCatalog.colorId}`,
        ...(zeroStockSkip ? [gt(blInventory.quantity, 0)] : []),
      ))
      .where(or(
        isNull(blCatalog.itemName),
        sql`${blCatalog.itemName} = ''`,
        lt(blCatalog.updatedAt, detailStaleThreshold),
      ));
    const staleCatalogDetail = Number(staleDetailRow?.count || 0);

    const pomStaleThreshold = new Date(Date.now() - pomFreshnessDays * 24 * 60 * 60 * 1000);

    const [missingPgRow] = await db
      .select({ count: sql<number>`count(DISTINCT (${blInventory.itemNo}, ${blInventory.itemType}, ${blInventory.colorId}, ${blInventory.newOrUsed}))` })
      .from(blInventory)
      .leftJoin(priceGuideCache, and(
        eq(blInventory.itemNo, priceGuideCache.itemNo),
        eq(blInventory.itemType, priceGuideCache.itemType),
        sql`(${blInventory.colorId} = ${priceGuideCache.colorId} OR (${blInventory.colorId} IS NULL AND ${priceGuideCache.colorId} IS NULL))`,
        sql`${blInventory.newOrUsed} = ${priceGuideCache.newOrUsed}`,
      ))
      .where(and(quantityFilter, isNull(priceGuideCache.id)));
    const missingPriceGuide = Number(missingPgRow?.count || 0);

    const [stalePgRow] = await db
      .select({ count: sql<number>`count(DISTINCT (${blInventory.itemNo}, ${blInventory.itemType}, ${blInventory.colorId}, ${blInventory.newOrUsed}))` })
      .from(blInventory)
      .innerJoin(priceGuideCache, and(
        eq(blInventory.itemNo, priceGuideCache.itemNo),
        eq(blInventory.itemType, priceGuideCache.itemType),
        sql`(${blInventory.colorId} = ${priceGuideCache.colorId} OR (${blInventory.colorId} IS NULL AND ${priceGuideCache.colorId} IS NULL))`,
        sql`${blInventory.newOrUsed} = ${priceGuideCache.newOrUsed}`,
      ))
      .where(and(quantityFilter, lt(priceGuideCache.fetchedAt, pomStaleThreshold)));
    const stalePriceGuide = Number(stalePgRow?.count || 0);

    const result: CatalogScanResult = {
      inventoryRowsScanned,
      missingCatalogEntries,
      catalogEntriesCreated,
      staleCatalogDetail,
      missingPriceGuide,
      stalePriceGuide,
    };

    console.log(`[CatalogScan] Complete: ${inventoryRowsScanned} inv rows, ${missingCatalogEntries} missing catalog (${catalogEntriesCreated} created), ${staleCatalogDetail} stale detail, ${missingPriceGuide} missing PG, ${stalePriceGuide} stale PG`);

    await db.insert(syncMetadata).values({
      id: SYNC_ID,
      lastSyncStatus: 'success',
      lastSyncTime: new Date(),
      recordsAdded: catalogEntriesCreated,
      recordsUpdated: staleCatalogDetail + missingPriceGuide + stalePriceGuide,
      errorMessage: null,
      orgId: ORG_ID,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncStatus: 'success',
        updatedAt: new Date(),
        recordsAdded: catalogEntriesCreated,
        recordsUpdated: staleCatalogDetail + missingPriceGuide + stalePriceGuide,
        errorMessage: null,
      },
    });

    return result;
  } catch (error: any) {
    console.error('[CatalogScan] Error:', error.message);
    await db.insert(syncMetadata).values({
      id: SYNC_ID,
      lastSyncStatus: 'error',
      lastSyncTime: new Date(),
      recordsAdded: 0,
      recordsUpdated: 0,
      errorMessage: error.message,
      orgId: ORG_ID,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: { lastSyncStatus: 'error', updatedAt: new Date(), errorMessage: error.message },
    });
    return { inventoryRowsScanned: 0, missingCatalogEntries: 0, catalogEntriesCreated: 0, staleCatalogDetail: 0, missingPriceGuide: 0, stalePriceGuide: 0 };
  } finally {
    running = false;
  }
}
