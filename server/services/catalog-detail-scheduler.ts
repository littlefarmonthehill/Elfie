import { db } from "../db";
import { appSettings, blCatalog, blInventory, blCategories, blColors, blApiCalls, syncMetadata, PLATFORM_ORG_ID } from "@shared/schema";
import { eq, and, or, isNull, sql, gte, lt, gt, desc } from "drizzle-orm";
import { bricklinkCatalogRequest, bricklinkRequest } from "./bricklink";
import { syncLock } from "./sync-lock";

const ORG_ID = PLATFORM_ORG_ID;
const SYNC_ID = 'catalog_detail_completion';

let shutdownRequested = false;
let stopRequested = false;

export function requestCatalogDetailStop() { stopRequested = true; }
export function requestCatalogDetailShutdown() { shutdownRequested = true; }

export function getCatalogDetailIsRunning() {
  return syncLock.getActive().includes('CatalogDetail');
}

let cdProgress = { active: false, phase: '', itemsProcessed: 0, itemsTotal: 0, apiCallsUsed: 0, apiCallBudget: 0, categoriesDone: false, colorsDone: false };
export function getCatalogDetailProgress() { return { ...cdProgress }; }

export async function startCatalogDetailScheduler() {
  console.log('📖 Catalog Detail scheduler initialized');
  setInterval(async () => { await checkAndRun(); }, 60 * 1000);
}

async function checkAndRun() {
  try {
    const [settings] = await db.select({
      enabled: appSettings.catalogDetailEnabled,
      frequencyHours: appSettings.catalogDetailFrequencyHours,
    }).from(appSettings).where(eq(appSettings.id, ORG_ID)).limit(1);

    if (!settings?.enabled) return;

    const [meta] = await db.select().from(syncMetadata)
      .where(and(eq(syncMetadata.orgId, ORG_ID), eq(syncMetadata.id, SYNC_ID)))
      .limit(1);

    const lastRun = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : 0;
    const intervalMs = (settings.frequencyHours ?? 1) * 60 * 60 * 1000;
    if (Date.now() - lastRun < intervalMs) return;

    if (getCatalogDetailIsRunning()) return;

    await runCatalogDetailSync();
  } catch (error) {
    console.error('[CatalogDetail] Scheduler check error:', error);
  }
}

export async function runCatalogDetailSync(): Promise<{
  categoriesAdded: number;
  categoriesUpdated: number;
  colorsAdded: number;
  colorsUpdated: number;
  itemsEnriched: number;
  apiCallsUsed: number;
  stopped: boolean;
  stopReason?: string;
}> {
  if (!syncLock.acquire('CatalogDetail')) {
    return { categoriesAdded: 0, categoriesUpdated: 0, colorsAdded: 0, colorsUpdated: 0, itemsEnriched: 0, apiCallsUsed: 0, stopped: true, stopReason: 'Already running' };
  }

  stopRequested = false;
  shutdownRequested = false;

  let categoriesAdded = 0, categoriesUpdated = 0;
  let colorsAdded = 0, colorsUpdated = 0;
  let itemsEnriched = 0;
  let apiCallsUsed = 0;
  let stopped = false;
  let stopReason: string | undefined;

  try {
    const [settings] = await db.select({
      batchSize: appSettings.catalogDetailBatchSize,
      freshnessDays: appSettings.catalogDetailFreshnessDays,
      zeroStockSkip: appSettings.catalogDetailZeroStockSkip,
      blApiCallLimit: appSettings.blApiCallLimit,
      catalogDetailApiBudgetPct: appSettings.catalogDetailApiBudgetPct,
    }).from(appSettings).where(eq(appSettings.id, ORG_ID)).limit(1);

    const batchSize = settings?.batchSize ?? 500;
    const freshnessDays = settings?.freshnessDays ?? 90;
    const zeroStockSkip = settings?.zeroStockSkip ?? true;
    const totalCeiling = settings?.blApiCallLimit ?? 4900;
    const budgetPct = settings?.catalogDetailApiBudgetPct ?? 20;
    const maxCallsThisRun = Math.floor(totalCeiling * budgetPct / 100);

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [usageRow] = await db.select({ count: sql<number>`count(*)` })
      .from(blApiCalls).where(and(eq(blApiCalls.orgId, ORG_ID), gte(blApiCalls.timestamp, twentyFourHoursAgo)));
    const callsLast24h = Number(usageRow?.count) || 0;

    if (callsLast24h >= totalCeiling) {
      syncLock.release('CatalogDetail');
      return { categoriesAdded: 0, categoriesUpdated: 0, colorsAdded: 0, colorsUpdated: 0, itemsEnriched: 0, apiCallsUsed: 0, stopped: true, stopReason: `API limit reached: ${callsLast24h}/${totalCeiling}` };
    }

    const availableTotalCalls = Math.max(0, totalCeiling - callsLast24h);
    const apiCallCeiling = Math.min(maxCallsThisRun, availableTotalCalls);

    cdProgress = { active: true, phase: 'Starting', itemsProcessed: 0, itemsTotal: 0, apiCallsUsed: 0, apiCallBudget: apiCallCeiling, categoriesDone: false, colorsDone: false };
    console.log(`[CatalogDetail] Starting sync (batch: ${batchSize}, freshness: ${freshnessDays}d, zeroStockSkip: ${zeroStockSkip}, API budget: ${apiCallCeiling} this run [${budgetPct}% of ${totalCeiling}], total used: ${callsLast24h}/${totalCeiling})`);

    // Phase 1: Refresh categories (1 API call)
    cdProgress.phase = 'Categories';
    try {
      const { syncBricklinkCategories } = await import('./bricklink');
      const catResult = await syncBricklinkCategories(ORG_ID);
      categoriesAdded = catResult.added;
      categoriesUpdated = catResult.updated;
      apiCallsUsed += catResult.apiCalls;
      cdProgress.apiCallsUsed = apiCallsUsed;
      cdProgress.categoriesDone = true;
      console.log(`[CatalogDetail] Categories: ${catResult.added} added, ${catResult.updated} updated`);
    } catch (error) {
      console.error('[CatalogDetail] Categories sync failed (non-fatal):', error);
    }

    if (stopRequested || shutdownRequested) {
      stopped = true;
      stopReason = shutdownRequested ? 'Shutdown' : 'Stopped by user';
      cdProgress = { ...cdProgress, active: false, phase: 'Stopped' };
      syncLock.release('CatalogDetail');
      return { categoriesAdded, categoriesUpdated, colorsAdded, colorsUpdated, itemsEnriched, apiCallsUsed, stopped, stopReason };
    }

    // Phase 2: Refresh colors (1 API call)
    cdProgress.phase = 'Colors';
    try {
      const { syncBricklinkColors } = await import('./bricklink');
      const colorResult = await syncBricklinkColors(ORG_ID);
      colorsAdded = colorResult.added;
      colorsUpdated = colorResult.updated;
      apiCallsUsed += colorResult.apiCalls;
      cdProgress.apiCallsUsed = apiCallsUsed;
      cdProgress.colorsDone = true;
      console.log(`[CatalogDetail] Colors: ${colorResult.added} added, ${colorResult.updated} updated`);
    } catch (error) {
      console.error('[CatalogDetail] Colors sync failed (non-fatal):', error);
    }

    if (stopRequested || shutdownRequested) {
      stopped = true;
      stopReason = shutdownRequested ? 'Shutdown' : 'Stopped by user';
      cdProgress = { ...cdProgress, active: false, phase: 'Stopped' };
      syncLock.release('CatalogDetail');
      return { categoriesAdded, categoriesUpdated, colorsAdded, colorsUpdated, itemsEnriched, apiCallsUsed, stopped, stopReason };
    }

    // Phase 3: Enrich individual catalog items — items missing detail or stale
    const itemTypeMap: Record<string, string> = {
      'P': 'PART', 'M': 'MINIFIG', 'S': 'SET', 'B': 'BOOK',
      'G': 'GEAR', 'C': 'CATALOG', 'I': 'INSTRUCTION', 'O': 'ORIGINAL_BOX', 'U': 'UNSORTED_LOT',
    };

    const staleThreshold = new Date(Date.now() - freshnessDays * 24 * 60 * 60 * 1000);

    const candidateQuery = db
      .selectDistinctOn([blCatalog.itemNo, blCatalog.itemType], {
        itemNo: blCatalog.itemNo,
        itemType: blCatalog.itemType,
        colorId: blCatalog.colorId,
        itemName: blCatalog.itemName,
        updatedAt: blCatalog.updatedAt,
      })
      .from(blCatalog);

    let candidates;
    if (zeroStockSkip) {
      candidates = await candidateQuery
        .innerJoin(blInventory, and(
          eq(blCatalog.itemNo, blInventory.itemNo),
          eq(blCatalog.itemType, blInventory.itemType),
          eq(blCatalog.colorId, blInventory.colorId),
          gt(blInventory.quantity, 0)
        ))
        .where(
          or(
            isNull(blCatalog.itemName),
            sql`${blCatalog.itemName} = ''`,
            lt(blCatalog.updatedAt, staleThreshold)
          )
        )
        .orderBy(blCatalog.itemNo, blCatalog.itemType, blCatalog.updatedAt)
        .limit(batchSize * 2);
    } else {
      candidates = await candidateQuery
        .where(
          or(
            isNull(blCatalog.itemName),
            sql`${blCatalog.itemName} = ''`,
            lt(blCatalog.updatedAt, staleThreshold)
          )
        )
        .orderBy(blCatalog.itemNo, blCatalog.itemType, blCatalog.updatedAt)
        .limit(batchSize * 2);
    }

    const seen = new Set<string>();
    const uniqueItems = candidates.filter(c => {
      const key = `${c.itemNo}|${c.itemType}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, batchSize);

    const availableApiCalls = Math.max(0, apiCallCeiling - apiCallsUsed);
    const itemsToProcess = uniqueItems.slice(0, availableApiCalls);

    cdProgress.phase = 'Enriching items';
    cdProgress.itemsTotal = itemsToProcess.length;
    cdProgress.itemsProcessed = 0;
    console.log(`[CatalogDetail] Found ${candidates.length} candidates, ${uniqueItems.length} unique items, processing ${itemsToProcess.length} (API budget: ${availableApiCalls})`);

    for (const item of itemsToProcess) {
      if (stopRequested || shutdownRequested) {
        stopped = true;
        stopReason = shutdownRequested ? 'Shutdown interrupted' : 'Stopped by user';
        break;
      }

      try {
        const apiItemType = itemTypeMap[item.itemType.toUpperCase()] || item.itemType.toUpperCase();
        const endpoint = `/items/${apiItemType}/${item.itemNo}`;
        const { data } = await bricklinkCatalogRequest(endpoint, undefined, ORG_ID);
        apiCallsUsed++;
        cdProgress.apiCallsUsed = apiCallsUsed;

        if (data) {
          await db.insert(blCatalog).values({
            itemNo: item.itemNo,
            itemType: item.itemType,
            colorId: item.colorId,
            itemName: data.name || null,
            categoryId: data.category_id || null,
            blCatalogWeight: data.weight ? String(data.weight) : null,
            blDimensionX: data.dim_x ? String(data.dim_x) : null,
            blDimensionY: data.dim_y ? String(data.dim_y) : null,
            blDimensionZ: data.dim_z ? String(data.dim_z) : null,
            yearReleased: data.year_released || null,
            imageUrl: data.image_url || null,
            thumbnailUrl: data.thumbnail_url || null,
          }).onConflictDoUpdate({
            target: [blCatalog.itemNo, blCatalog.itemType, blCatalog.colorId],
            set: {
              itemName: sql`COALESCE(EXCLUDED.item_name, bl_catalog.item_name)`,
              categoryId: sql`COALESCE(EXCLUDED.category_id, bl_catalog.category_id)`,
              blCatalogWeight: sql`COALESCE(EXCLUDED.bl_catalog_weight, bl_catalog.bl_catalog_weight)`,
              blDimensionX: sql`COALESCE(EXCLUDED.bl_dimension_x, bl_catalog.bl_dimension_x)`,
              blDimensionY: sql`COALESCE(EXCLUDED.bl_dimension_y, bl_catalog.bl_dimension_y)`,
              blDimensionZ: sql`COALESCE(EXCLUDED.bl_dimension_z, bl_catalog.bl_dimension_z)`,
              yearReleased: sql`COALESCE(EXCLUDED.year_released, bl_catalog.year_released)`,
              imageUrl: sql`COALESCE(EXCLUDED.image_url, bl_catalog.image_url)`,
              thumbnailUrl: sql`COALESCE(EXCLUDED.thumbnail_url, bl_catalog.thumbnail_url)`,
              updatedAt: sql`NOW()`,
            },
          });

          itemsEnriched++;
        }
        cdProgress.itemsProcessed = itemsEnriched;
      } catch (error: any) {
        cdProgress.itemsProcessed = itemsEnriched;
        console.error(`[CatalogDetail] Error enriching ${item.itemType}/${item.itemNo}:`, error.message || error);
      }
    }

    // Update sync metadata
    await db.insert(syncMetadata).values({
      id: SYNC_ID,
      orgId: ORG_ID,
      lastSyncTime: new Date(),
      lastSyncStatus: stopped ? 'partial' : 'success',
      recordsAdded: itemsEnriched,
      recordsUpdated: categoriesAdded + categoriesUpdated + colorsAdded + colorsUpdated,
      errorMessage: stopReason || null,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncTime: new Date(),
        lastSyncStatus: stopped ? 'partial' : 'success',
        recordsAdded: itemsEnriched,
        recordsUpdated: categoriesAdded + categoriesUpdated + colorsAdded + colorsUpdated,
        errorMessage: stopReason || null,
        updatedAt: new Date(),
      },
    });

    cdProgress = { ...cdProgress, active: false, phase: stopped ? 'Stopped' : 'Complete' };
    console.log(`[CatalogDetail] Complete: ${itemsEnriched} items enriched, ${categoriesAdded}+${categoriesUpdated} categories, ${colorsAdded}+${colorsUpdated} colors, ${apiCallsUsed} API calls${stopped ? ` (${stopReason})` : ''}`);

    return { categoriesAdded, categoriesUpdated, colorsAdded, colorsUpdated, itemsEnriched, apiCallsUsed, stopped, stopReason };
  } catch (error) {
    cdProgress = { ...cdProgress, active: false, phase: 'Error' };
    console.error('[CatalogDetail] Sync error:', error);
    throw error;
  } finally {
    syncLock.release('CatalogDetail');
  }
}
