import { Router } from 'express';
import { asyncRoute, reqOrgId, decodeHtmlEntities, getOrgSettings } from '../lib/routeHelpers';
import { apiErrorHandler } from '../middleware/errorHandler';
import { isApproved, isSuperAdmin } from '../auth';
import { db } from '../db';
import {
  blInventory,
  blCatalog,
  syncMetadata,
  syncIssues,
  insertSyncIssueSchema,
  channelSyncConfig,
  channelLotLinks,
  crossPlatformSyncQueue,
  orgIntegrations,
  inventoryHistory,
  orders,
  orderDetails,
  appSettings,
  platformSettings,
  priceGuideCache,
  PLATFORM_ORG_ID
} from '@shared/schema';
import { eq, sql, and, desc, asc, inArray, isNull, isNotNull, gt, gte, lte, ne, or } from 'drizzle-orm';
import { z } from 'zod';
import { syncLock } from '../services/sync-lock';
import { syncBricklinkData, syncPriceOMagicCache, requestPomSyncStop } from '../services/bricklink';
import { syncBrickLinkToBrickOwl, getBrickOwlApiKey } from '../services/brickowl';
import { getPomIsRunning, setPomIsRunning } from '../services/pom-scheduler';
import { getPlatformSettings } from '../lib/platformSettings';
import { broadcast } from '../sse';
import { getVerifiedNewOrderIds } from '../services/order-sync-core';
import { checkAutomationLimit } from '../services/tierEnforcement';

const router = Router();

// MODULE-SCOPE variables
const discrepancyCache = new Map<string, { data: any[]; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;
const boidLookupCache = new Map<string, string | null>();

let colorRepairProgress: {
  active: boolean;
  done: number;
  total: number;
  complete: boolean;
  fixed?: number;
  skipped?: number;
  errors?: string[];
} = { active: false, done: 0, total: 0, complete: false };


async function runColorRepair(orgId: string, lotIdsFilter: Set<string> | null) {
  const { getBrickOwlInventory, createBrickOwlLot, deleteBrickOwlLot, lookupBoid, mapColorId, getBoColorName, getBlColorName, toBOApiCondition } = await import('../services/brickowl');

  const boInventory = await getBrickOwlInventory(false, orgId);
  const taggedLots = boInventory.filter(lot => lot.external_lot_ids?.other);

  const blIds = taggedLots.map(lot => parseInt(lot.external_lot_ids!.other!)).filter(n => !isNaN(n));
  const blItems = await db.select().from(blInventory).where(inArray(blInventory.id, blIds));
  const blMap = new Map(blItems.map(item => [item.id, item]));

  let fixed = 0;
  let skipped = 0;
  const errors: string[] = [];

  colorRepairProgress = { active: true, done: 0, total: lotIdsFilter?.size ?? 0, complete: false };

  for (const lot of taggedLots) {
    const blId = parseInt(lot.external_lot_ids!.other!);
    const blItem = blMap.get(blId);
    if (!blItem || blItem.colorId == null) { skipped++; continue; }

    const expectedBoColorId = await mapColorId(blItem.colorId, orgId);
    if (expectedBoColorId == null) { skipped++; continue; }

    const boidParts = (lot.boid ?? '').split('-');
    const actualBoColorId = boidParts.length >= 2 ? parseInt(boidParts[boidParts.length - 1]) : 0;
    if (actualBoColorId === expectedBoColorId) { skipped++; continue; }

    if (lotIdsFilter && !lotIdsFilter.has(lot.lot_id)) { skipped++; continue; }

    try {
      const boid = await lookupBoid(blItem.itemNo, blItem.itemType ?? 'Part', expectedBoColorId, orgId);
      if (!boid) {
        const msg = `lot ${lot.lot_id} (${blItem.itemNo}): could not resolve boid for color ${expectedBoColorId}`;
        errors.push(msg);
        console.error(`[ColorRepair] Skipping — ${msg}`);
        colorRepairProgress.done++;
        continue;
      }
      await db.update(blInventory).set({ updatedAt: new Date() }).where(eq(blInventory.id, blId));
      await deleteBrickOwlLot(lot.lot_id, orgId);
      const condition = toBOApiCondition(blItem.newOrUsed, blItem.itemType ?? undefined);
      await createBrickOwlLot({
        boid,
        quantity: parseInt(lot.qty),
        price: parseFloat(lot.base_price),
        condition,
        for_sale: typeof lot.for_sale === 'string' ? parseInt(lot.for_sale) : (lot.for_sale as number),
        external_id: lot.external_lot_ids?.other,
        personal_note: lot.personal_note,
        public_note: lot.public_note,
        tier_price: lot.tier_price ?? undefined,
        sale_percentage: lot.sale_percent ? parseFloat(lot.sale_percent) : undefined,
        bulk_qty: lot.bulk_qty ? parseInt(lot.bulk_qty) : undefined,
        lot_weight: lot.lot_weight ? parseFloat(lot.lot_weight) : undefined,
      }, orgId);
      fixed++;
      colorRepairProgress.done++;
      console.log(`[ColorRepair] Fixed lot ${lot.lot_id} (${blItem.itemNo}): boid resolved to ${boid} (color ${expectedBoColorId})`);
    } catch (err: any) {
      const msg = `lot ${lot.lot_id} (${blItem.itemNo}): ${err.message}`;
      errors.push(msg);
      colorRepairProgress.done++;
      console.error(`[ColorRepair] Error fixing ${msg}`);
    }
  }

  colorRepairProgress = { active: false, done: colorRepairProgress.done, total: colorRepairProgress.total, complete: true, fixed, skipped, errors };
  console.log(`[ColorRepair] Complete — ${fixed} fixed, ${skipped} skipped, ${errors.length} errors`);
}

// ROUTES

router.get("/platform-sync/status", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  // Get BrickLink inventory stats (source of truth)
  const blStats = await db
    .select({
      totalLots: sql<number>`COUNT(*)`,
      totalParts: sql<number>`SUM(${blInventory.quantity})`,
    })
    .from(blInventory)
    .where(eq(blInventory.orgId, orgId));

  const brickLinkStats = {
    totalLots: Number(blStats[0]?.totalLots) || 0,
    totalParts: Number(blStats[0]?.totalParts) || 0,
    lastSyncedAt: new Date().toISOString(),
  };

  // Check if BrickOwl API key is configured (credentials live in org_integrations)
  const brickowlEnabled = !!(await getBrickOwlApiKey(orgId));

  // Get actual BrickOwl inventory stats if enabled
  let brickowlStats = {
    totalLots: 0,
    totalParts: 0,
    lastSyncedAt: null as string | null,
  };

  let missingLotsCount = 0;
  let typeMismatchLotsCount = 0;
  let priceDifferencesCount = 0;
  let quantityDifferencesCount = 0;
  let remarksDifferencesCount = 0;
  let descriptionDifferencesCount = 0;
  let unlinkedBoLotsCount = 0;
  let orphanedBoLotsCount = 0;
  let bulkQtyDifferencesCount = 0;
  let lotWeightDifferencesCount = 0;
  let forSaleDifferencesCount = 0;
  let salePercentDifferencesCount = 0;
  let scheduledForDeletionCount = 0;
  let invalidBoidCount = 0;

  if (brickowlEnabled) {
    try {
      const { getBrickOwlInventory, lookupBoid } = await import('../services/brickowl');
      const brickowlInventory = await getBrickOwlInventory(false, orgId); // Get all, not just active
      
      brickowlStats.totalLots = brickowlInventory.length;
      brickowlStats.totalParts = brickowlInventory.reduce((sum: number, lot: any) => {
        const qty = parseInt(lot.qty || lot.quantity || '0');
        return sum + qty;
      }, 0);
      brickowlStats.lastSyncedAt = new Date().toISOString();

      // Cache arrays for detailed discrepancies
      const missingItems: any[] = [];
      const typeMismatchItems: any[] = [];
      const priceDiscrepancies: any[] = [];
      const quantityDiscrepancies: any[] = [];
      const remarksDiscrepancies: any[] = [];
      const descriptionDiscrepancies: any[] = [];
      const unlinkedBoLots: any[] = [];
      const orphanedBoLots: any[] = [];
      const bulkQtyDiscrepancies: any[] = [];
      const lotWeightDiscrepancies: any[] = [];
      const forSaleDiscrepancies: any[] = [];
      const salePercentDiscrepancies: any[] = [];

      // Read the sync config so the discrepancy view matches the sync engine's filters.
      const [syncCfgRow] = await db.select().from(channelSyncConfig)
        .where(and(eq(channelSyncConfig.orgId, orgId), eq(channelSyncConfig.channelKey, 'brickowl'))).limit(1);
      const syncStockroomModes: Record<string, string> = (syncCfgRow?.syncStockroomModes as any) ?? { A: 'skip', B: 'skip', C: 'skip' };
      const syncItemTypesCmp = (syncCfgRow?.syncItemTypes as Record<string, boolean> | null) ?? {};
      const discrepPriceFloor = typeof syncCfgRow?.syncPriceFloor === 'number' ? syncCfgRow.syncPriceFloor : null;

      // Helper: returns true when the sync engine would skip this BL item (stockroom filter).
      // Only 'skip' mode items are excluded — 'hidden', 'sync', and 'active' items appear in reports.
      const isStockroomFiltered = (blItem: any) =>
        !!blItem.isStockRoom && (syncStockroomModes[blItem.stockRoomId ?? ''] ?? 'skip') === 'skip';
      // Helper: returns true if item type is explicitly excluded in the sync config.
      const isItemTypeFiltered = (blItem: any) =>
        Object.keys(syncItemTypesCmp).length > 0 && syncItemTypesCmp[blItem.itemType ?? ''] === false;
      // Helper: returns true if the lot price is below the configured price floor.
      const isPriceFloorFiltered = (blItem: any) =>
        !!discrepPriceFloor && discrepPriceFloor > 0 &&
        (blItem.unitPrice == null || parseFloat(blItem.unitPrice) < discrepPriceFloor);
      // Combined exclusion check — mirrors what the sync engine does.
      const isSyncExcluded = (blItem: any) =>
        isStockroomFiltered(blItem) || isItemTypeFiltered(blItem) || isPriceFloorFiltered(blItem);

      // SIMPLIFIED COMPARISON: Use external_lot_ids.other (BrickLink inventory ID) for matching.
      // Exclude soft-deleted lots — they should not be listed on BO, so missing them is correct.
      const blItemsMap = new Map<number, any>();
      const blItems = await db.select().from(blInventory).where(
        and(eq(blInventory.orgId, orgId), isNull(blInventory.deletedAt))
      );
      
      // Build lookup map: BrickLink inventory ID -> BrickLink item
      for (const blItem of blItems) {
        blItemsMap.set(blItem.id, blItem);
      }

      // Track matched BrickLink inventory IDs
      const matchedBlIds = new Set<number>();
      
      // Compare each BrickOwl lot against BrickLink inventory
      for (const boLot of brickowlInventory) {
        // Extract BrickLink inventory ID from external_lot_ids.other
        const blInventoryId = boLot.external_lot_ids?.other ? 
          parseInt(boLot.external_lot_ids.other) : null;
        
        if (!blInventoryId) {
          // No BrickLink inventory ID linked — collect as unlinked
          unlinkedBoLotsCount++;
          unlinkedBoLots.push({
            lotId:     boLot.lot_id,
            boid:      boLot.boid,
            qty:       parseInt(boLot.qty || '0'),
            price:     parseFloat(boLot.price || '0'),
            condition: boLot.condition,
            fullCon:   boLot.full_con,
          });
          continue;
        }
        
        const blItem = blItemsMap.get(blInventoryId);
        
        if (!blItem) {
          // BO lot has a BL ID tag but that BL lot no longer exists —
          // likely merged/consolidated by BrickLink. Track as orphaned.
          orphanedBoLotsCount++;
          orphanedBoLots.push({
            lotId:      boLot.lot_id,
            boid:       boLot.boid,
            blId:       blInventoryId,
            qty:        parseInt(boLot.qty || '0'),
            price:      parseFloat(boLot.price || '0'),
            condition:  boLot.condition,
            fullCon:    boLot.full_con,
          });
          continue;
        }
        
        matchedBlIds.add(blInventoryId);

        // Skip field comparisons for BL items the sync engine would exclude.
        // (still tracked in matchedBlIds so they don't appear as "missing" either)
        if (isSyncExcluded(blItem)) continue;

        const boQty = parseInt(boLot.qty || '0');
        // Use base_price (the listing price we set) not price (which is sale-adjusted).
        // This matches the channel sync comparison so the report agrees with what sync will do.
        const boPrice = parseFloat((boLot.base_price ?? boLot.price) ?? '0');
        const blPrice = blItem.unitPrice ? parseFloat(blItem.unitPrice) : 0;
        
        // Check for quantity differences
        if (boQty !== blItem.quantity) {
          quantityDifferencesCount++;
          quantityDiscrepancies.push({
            lotId: blItem.id,
            itemNo: blItem.itemNo,
            itemName: blItem.itemName,
            colorName: blItem.colorName,
            condition: blItem.newOrUsed,
            blQuantity: blItem.quantity,
            blPrice,
            boQuantity: boQty,
            boPrice,
            difference: 'quantity',
            qtyDiff: boQty - blItem.quantity,
          });
        }
        
        // Check for price differences (use small epsilon for float comparison)
        if (Math.abs(boPrice - blPrice) > 0.001) {
          priceDifferencesCount++;
          priceDiscrepancies.push({
            lotId: blItem.id,
            itemNo: blItem.itemNo,
            itemName: blItem.itemName,
            colorName: blItem.colorName,
            condition: blItem.newOrUsed,
            blQuantity: blItem.quantity,
            blPrice,
            boQuantity: boQty,
            boPrice,
            difference: 'price',
            priceDiff: boPrice - blPrice,
          });
        }
        
        // Check for personal_note (remarks) differences
        // Decode HTML entities from both sides before comparing and displaying
        const boRemarks = boLot.personal_note || '';
        const blRemarks = blItem.remarks || '';
        const blRemarksDecoded = decodeHtmlEntities(blRemarks);
        const boRemarksDecoded = decodeHtmlEntities(boRemarks);
        if (boRemarksDecoded !== blRemarksDecoded) {
          remarksDifferencesCount++;
          remarksDiscrepancies.push({
            lotId: blItem.id,
            itemNo: blItem.itemNo,
            itemName: blItem.itemName,
            colorName: blItem.colorName,
            condition: blItem.newOrUsed,
            blQuantity: blItem.quantity,
            blPrice,
            boQuantity: boQty,
            boPrice,
            difference: 'remarks',
            blRemarks: blRemarksDecoded,
            boRemarks: boRemarksDecoded,
          });
        }
        
        // Check for public_note (description) differences
        // Decode HTML entities from both sides before comparing and displaying
        const boDescription = boLot.public_note || '';
        const blDescription = blItem.description || '';
        const blDescriptionDecoded = decodeHtmlEntities(blDescription);
        const boDescriptionDecoded = decodeHtmlEntities(boDescription);
        if (boDescriptionDecoded !== blDescriptionDecoded) {
          descriptionDifferencesCount++;
          descriptionDiscrepancies.push({
            lotId: blItem.id,
            itemNo: blItem.itemNo,
            itemName: blItem.itemName,
            colorName: blItem.colorName,
            condition: blItem.newOrUsed,
            blQuantity: blItem.quantity,
            blPrice,
            boQuantity: boQty,
            boPrice,
            difference: 'description',
            blDescription: blDescriptionDecoded,
            boDescription: boDescriptionDecoded,
          });
        }

        // Check for bulk_qty differences (BL bulk vs BO bulk_qty)
        const boBulkQty = parseInt(boLot.bulk_qty ?? '1') || 1;
        const blBulkQty = blItem.bulk ?? 1;
        if (boBulkQty !== blBulkQty) {
          bulkQtyDifferencesCount++;
          bulkQtyDiscrepancies.push({
            lotId: blItem.id,
            itemNo: blItem.itemNo,
            itemName: blItem.itemName,
            colorName: blItem.colorName,
            condition: blItem.newOrUsed,
            blQuantity: blItem.quantity,
            blPrice,
            difference: 'bulk_qty',
            blBulkQty,
            boBulkQty,
            bulkQtyDiff: boBulkQty - blBulkQty,
          });
        }

        // Check for lot_weight differences (BL myWeight vs BO lot_weight)
        const boLotWeight = boLot.lot_weight ? parseFloat(boLot.lot_weight) : 0;
        const blLotWeight = blItem.myWeight ? parseFloat(blItem.myWeight) : 0;
        if (Math.abs(boLotWeight - blLotWeight) > 0.001) {
          lotWeightDifferencesCount++;
          lotWeightDiscrepancies.push({
            lotId: blItem.id,
            itemNo: blItem.itemNo,
            itemName: blItem.itemName,
            colorName: blItem.colorName,
            condition: blItem.newOrUsed,
            blQuantity: blItem.quantity,
            blPrice,
            difference: 'lot_weight',
            blLotWeight,
            boLotWeight,
            weightDiff: boLotWeight - blLotWeight,
          });
        }

        // Check for_sale differences (BL isStockRoom → BO for_sale)
        const boForSale = parseInt(String(boLot.for_sale ?? '1'));
        const blForSale = blItem.isStockRoom ? 0 : 1;
        if (boForSale !== blForSale) {
          forSaleDifferencesCount++;
          forSaleDiscrepancies.push({
            lotId: blItem.id,
            itemNo: blItem.itemNo,
            itemName: blItem.itemName,
            colorName: blItem.colorName,
            condition: blItem.newOrUsed,
            blQuantity: blItem.quantity,
            blPrice,
            difference: 'for_sale',
            blForSale,
            boForSale,
            blIsStockRoom: !!blItem.isStockRoom,
          });
        }

        // Check sale_percent differences (BL saleRate → BO sale_percent)
        // BO inventory returns the field as sale_percent (or sale_percentage); check both.
        const boSalePercent = parseInt(String(boLot.sale_percent ?? boLot.sale_percentage ?? '0')) || 0;
        const blSaleRate = blItem.saleRate ?? 0;
        if (boSalePercent !== blSaleRate) {
          salePercentDifferencesCount++;
          salePercentDiscrepancies.push({
            lotId: blItem.id,
            itemNo: blItem.itemNo,
            itemName: blItem.itemName,
            colorName: blItem.colorName,
            condition: blItem.newOrUsed,
            blQuantity: blItem.quantity,
            blPrice,
            difference: 'sale_percent',
            blSalePercent: blSaleRate,
            boSalePercent,
            saleDiff: boSalePercent - blSaleRate,
          });
        }
      }

      // Find missing items (BrickLink items not matched in BrickOwl)
      // Excludes qty=0 items — BrickOwl doesn't hold 0-qty lots.
      // After the primary tag-based pass we do a secondary BOID lookup for PART items
      // matching the assembly/torso pattern (c0N suffix). BrickLink catalogs these as PART
      // but BrickOwl catalogs them as Minifigure — lookupBoid with type=Part returns null,
      // so they never get tagged and always appear "missing". We retry with type=Minifigure
      // and check against the unlinked BO lot set: a match means the lot IS in BO but has
      // a type mismatch, not a true absence.

      // Fast lookup: unlinked BO lots by boid:condition
      const unlinkedBoidCondSet = new Set(
        unlinkedBoLots.map((ul: any) => `${ul.boid}:${ul.condition}`)
      );

      // Assembly pattern — items BrickLink calls PART that BrickOwl catalogs as Minifigure
      const ASSEMBLY_PATTERN = /c0\d$/i;

      // Collect all unmatched active BL lots
      const unmatchedEntries: [number, any][] = [];
      for (const [inventoryId, blItem] of Array.from(blItemsMap.entries())) {
        if (!matchedBlIds.has(inventoryId) && !isSyncExcluded(blItem) && (blItem.quantity ?? 0) > 0) {
          unmatchedEntries.push([inventoryId, blItem]);
        }
      }

      // Resolve type mismatches in parallel batches of 5.
      // lookupBoid uses an in-process cache — repeat scans are instant.
      // We go straight to MINIFIG type (skipping PART) because these c0N items are
      // cataloged as Minifigure in BO — a PART lookup always returns null for them.
      const assemblyCandidates = unmatchedEntries.filter(
        ([, blItem]) => blItem.itemType === 'PART' && ASSEMBLY_PATTERN.test(blItem.itemNo)
      );
      console.log(`[TypeMismatch] ${unmatchedEntries.length} unmatched BL lots, ${assemblyCandidates.length} c0N PART candidates, ${unlinkedBoidCondSet.size} unlinked BO boid:cond pairs`);
      if (unlinkedBoidCondSet.size > 0) {
        // Log first few entries from the set so we can see the boid format
        const sample = Array.from(unlinkedBoidCondSet).slice(0, 5);
        console.log(`[TypeMismatch] Unlinked set sample: ${sample.join(', ')}`);
      }

      const CONCURRENCY = 5;
      const typeMismatchFlags: boolean[] = new Array(unmatchedEntries.length).fill(false);

      // Only run BOID lookups for assembly candidates
      const assemblyResults: boolean[] = new Array(assemblyCandidates.length).fill(false);
      let boidHits = 0;
      let setHits = 0;
      for (let i = 0; i < assemblyCandidates.length; i += CONCURRENCY) {
        const chunk = assemblyCandidates.slice(i, i + CONCURRENCY);
        const results = await Promise.all(chunk.map(async ([, blItem]) => {
          // Go directly to MINIFIG — Part lookup always returns null for torso assemblies
          const boid = await lookupBoid(blItem.itemNo, 'MINIFIG', undefined, orgId);
          if (!boid) return false;
          boidHits++;
          // BL uses N/U; BO uses 'new'/'usedg'. Also accept bare 'used' as a fallback.
          const condNew = blItem.newOrUsed === 'N';
          const matched =
            unlinkedBoidCondSet.has(`${boid}:${condNew ? 'new' : 'usedg'}`) ||
            unlinkedBoidCondSet.has(`${boid}:${condNew ? 'new' : 'used'}`);
          if (matched) setHits++;
          return matched;
        }));
        for (let j = 0; j < results.length; j++) assemblyResults[i + j] = results[j];
      }
      console.log(`[TypeMismatch] BOID hits: ${boidHits}/${assemblyCandidates.length}, set matches: ${setHits}`);

      // Map assembly results back into typeMismatchFlags (assemblyCandidates is a filtered
      // subset of unmatchedEntries in the same order, so we traverse both together)
      let assemblyIdx = 0;
      for (let i = 0; i < unmatchedEntries.length; i++) {
        const [, blItem] = unmatchedEntries[i];
        if (blItem.itemType === 'PART' && ASSEMBLY_PATTERN.test(blItem.itemNo)) {
          typeMismatchFlags[i] = assemblyResults[assemblyIdx++];
        }
      }

      // Categorise into truly missing vs type mismatch
      let missingCount = 0;
      for (let i = 0; i < unmatchedEntries.length; i++) {
        const [, blItem] = unmatchedEntries[i];
        const blPrice = blItem.unitPrice ? parseFloat(blItem.unitPrice) : 0;
        const entry = {
          lotId:       blItem.id,
          itemNo:      blItem.itemNo,
          itemName:    blItem.itemName,
          colorName:   blItem.colorName,
          condition:   blItem.newOrUsed,
          blQuantity:  blItem.quantity,
          blPrice,
          boQuantity:  0,
          boPrice:     0,
          isStockRoom: !!blItem.isStockRoom,
          stockRoomId: blItem.stockRoomId ?? null,
          difference:  typeMismatchFlags[i] ? 'type_mismatch' : 'missing',
        };
        if (typeMismatchFlags[i]) {
          if (typeMismatchLotsCount < 100) typeMismatchItems.push(entry);
          typeMismatchLotsCount++;
        } else {
          if (missingCount < 100) missingItems.push(entry);
          missingCount++;
        }
      }
      missingLotsCount = missingCount;

      // Cache the detailed discrepancies
      const now = Date.now();
      discrepancyCache.set('BrickOwl:missing',       { data: missingItems,      timestamp: now });
      discrepancyCache.set('BrickOwl:type_mismatch', { data: typeMismatchItems, timestamp: now });
      discrepancyCache.set('BrickOwl:price', { data: priceDiscrepancies, timestamp: now });
      discrepancyCache.set('BrickOwl:quantity', { data: quantityDiscrepancies, timestamp: now });
      discrepancyCache.set('BrickOwl:remarks', { data: remarksDiscrepancies, timestamp: now });
      discrepancyCache.set('BrickOwl:description', { data: descriptionDiscrepancies, timestamp: now });
      discrepancyCache.set('BrickOwl:unlinked', { data: unlinkedBoLots, timestamp: now });
      discrepancyCache.set('BrickOwl:orphaned', { data: orphanedBoLots, timestamp: now });
      discrepancyCache.set('BrickOwl:bulk_qty', { data: bulkQtyDiscrepancies, timestamp: now });
      discrepancyCache.set('BrickOwl:lot_weight', { data: lotWeightDiscrepancies, timestamp: now });
      discrepancyCache.set('BrickOwl:for_sale',       { data: forSaleDiscrepancies,       timestamp: now });
      discrepancyCache.set('BrickOwl:sale_percent',   { data: salePercentDiscrepancies,   timestamp: now });

      // Populate skip-reason tiles from the last channel sync result (transient, per-run)
      try {
        const { getChannelSyncLastResult } = await import('../services/channel-sync-scheduler');
        const lastResult = getChannelSyncLastResult();
        const brickowlResult = lastResult?.perChannel?.['brickowl'];
        const skippedDeletion: any[] = brickowlResult?.skippedScheduledForDeletion ?? [];
        const skippedBoid:     any[] = brickowlResult?.skippedInvalidBoid          ?? [];
        discrepancyCache.set('BrickOwl:scheduled_deletion', { data: skippedDeletion, timestamp: now });
        discrepancyCache.set('BrickOwl:invalid_boid',       { data: skippedBoid,     timestamp: now });
        scheduledForDeletionCount = skippedDeletion.length;
        invalidBoidCount          = skippedBoid.length;
      } catch {
        // non-fatal: tiles just show 0
      }
    } catch (error) {
      console.error('Failed to fetch BrickOwl inventory stats:', error);
    }
  }

  const settings = await getOrgSettings(orgId);
  const rawSyncMode = settings?.channelSyncMode;
  const resolvedSyncMode = rawSyncMode === 'matched_sync' || rawSyncMode === 'quantity_only'
    ? 'matched_sync'
    : rawSyncMode === 'analysis'
    ? 'analysis'
    : 'full_control';

  // Check if eBay is configured via org_integrations
  const ebayIntegration = await db
    .select()
    .from(orgIntegrations)
    .where(and(eq(orgIntegrations.orgId, orgId), eq(orgIntegrations.channel, 'ebay')))
    .limit(1)
    .then(rows => rows[0] ?? null);
  const ebayEnabled = !!(ebayIntegration?.credentials && (ebayIntegration.credentials as any).refreshToken);

  const platformSyncStatus = {
    source: {
      name: 'BrickLink',
      stats: brickLinkStats,
    },
    targets: [
      {
        name: 'BrickOwl',
        enabled: brickowlEnabled,
        syncMode: resolvedSyncMode,
        stats: brickowlStats,
        discrepancies: {
          missingLots: missingLotsCount,
          typeMismatchLots: typeMismatchLotsCount,
          priceDifferences: priceDifferencesCount,
          quantityDifferences: quantityDifferencesCount,
          remarksDifferences: remarksDifferencesCount,
          descriptionDifferences: descriptionDifferencesCount,
          unlinkedBoLots: unlinkedBoLotsCount,
          orphanedBoLots: orphanedBoLotsCount,
          bulkQtyDifferences: bulkQtyDifferencesCount,
          lotWeightDifferences: lotWeightDifferencesCount,
          forSaleDifferences: forSaleDifferencesCount,
          salePercentDifferences: salePercentDifferencesCount,
          scheduledForDeletion: scheduledForDeletionCount,
          invalidBoid: invalidBoidCount,
        },
      },
      {
        name: 'eBay',
        enabled: ebayEnabled,
        // eBay discrepancy reporting not yet implemented
        discrepancies: { missingLots: 0, priceDifferences: 0, quantityDifferences: 0 },
      }
    ],
  };

  res.json(platformSyncStatus);
}));

router.get("/platform-sync/discrepancies/:platform/:type", isApproved, asyncRoute(async (req: any, res) => {
  const { platform, type } = req.params;
  const limit = parseInt(req.query.limit as string) || 50;
  const orgId = reqOrgId(req);

  if (platform !== 'BrickOwl') {
    return res.status(400).json({ error: `Platform ${platform} is not supported yet` });
  }

  const boApiKey = await getBrickOwlApiKey(orgId);
  if (!boApiKey) {
    return res.status(400).json({ error: 'BrickOwl API key not configured' });
  }

  // Check cache first
  const cacheKey = `${platform}:${type}`;
  const cached = discrepancyCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
    // Return cached data
    const discrepancies = cached.data.slice(0, limit);
    return res.json({ discrepancies, total: cached.data.length });
  }

  // Cache miss or expired - return empty for now (should call status endpoint first)
  res.json({ 
    discrepancies: [], 
    total: 0,
    message: 'Cache expired. Please refresh the platform sync status first.' 
  });
}));

router.get("/channel-sync/updated-items", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const [meta] = await db.select().from(syncMetadata)
    .where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, 'channel_sync')))
    .limit(1);
  if (!meta?.lastSyncMetaJson) return res.json({ updatedItems: [] });
  const parsed = JSON.parse(meta.lastSyncMetaJson);
  return res.json({ updatedItems: parsed.updatedItems ?? [] });
}));

router.post("/channel-sync/stop", isApproved, asyncRoute(async (req, res) => {
  const { getChannelSyncIsRunning } = await import("../services/channel-sync-scheduler");
  const { requestChannelSyncStop } = await import('../services/brickowl');
  const { requestEbayAbort } = await import('../services/ebay');
  if (!getChannelSyncIsRunning()) {
    return res.json({ success: false, message: 'No sync is currently running.' });
  }
  requestChannelSyncStop();
  requestEbayAbort();
  console.log('[ChannelSync] Stop requested by user');
  res.json({ success: true, message: 'Stop signal sent — sync will finish its current batch then halt.' });
}));

router.post("/channel-sync/preview", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const { syncBrickLinkToBrickOwl, defaultSyncFields } = await import('../services/brickowl');

  // Optional inline syncFields from request body (used during onboarding before config row is saved).
  const bodySyncFields = req.body?.syncFields as Partial<typeof defaultSyncFields> | undefined;

  let syncFields: typeof defaultSyncFields;
  if (bodySyncFields) {
    syncFields = {
      price:            bodySyncFields.price            ?? defaultSyncFields.price,
      remarks:          bodySyncFields.remarks          ?? defaultSyncFields.remarks,
      description:      bodySyncFields.description      ?? defaultSyncFields.description,
      tierPrice:        bodySyncFields.tierPrice        ?? defaultSyncFields.tierPrice,
      salePercent:      bodySyncFields.salePercent      ?? defaultSyncFields.salePercent,
      bulkQty:          bodySyncFields.bulkQty          ?? defaultSyncFields.bulkQty,
      lotWeight:        bodySyncFields.lotWeight        ?? defaultSyncFields.lotWeight,
      stockroomModes:   bodySyncFields.stockroomModes   ?? defaultSyncFields.stockroomModes,
      syncItemTypes:    (bodySyncFields as any).syncItemTypes ?? defaultSyncFields.syncItemTypes,
      priceFloor:       (bodySyncFields as any).priceFloor   ?? defaultSyncFields.priceFloor,
    };
  } else {
    const [cfgRow] = await db.select().from(channelSyncConfig)
      .where(and(eq(channelSyncConfig.orgId, orgId), eq(channelSyncConfig.channelKey, 'brickowl'))).limit(1);
    syncFields = cfgRow ? {
      price:            cfgRow.syncPrice,
      remarks:          cfgRow.syncRemarks,
      description:      cfgRow.syncDescription,
      tierPrice:        cfgRow.syncTierPrice,
      salePercent:      cfgRow.syncSalePercent,
      bulkQty:          cfgRow.syncBulkQty,
      lotWeight:        cfgRow.syncLotWeight,
      stockroomModes:   (cfgRow.syncStockroomModes as Record<string, 'skip'|'hidden'|'active'|'sync'>) ?? { A: 'skip', B: 'skip', C: 'skip' },
      syncItemTypes:    (cfgRow.syncItemTypes as Record<string, boolean>) ?? {},
      priceFloor:       typeof cfgRow.syncPriceFloor === 'number' ? cfgRow.syncPriceFloor : null,
    } : { ...defaultSyncFields };
  }

  // Always run in analysis mode (read-only) regardless of the org's configured sync mode.
  const result = await syncBrickLinkToBrickOwl(undefined, 'analysis', undefined, syncFields);

  res.json({ success: true, preview: result.preview });
}));

router.get('/channel-sync/scope', isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const channelKey = (req.query.channel as string) || 'brickowl';

  const [cfgRow] = await db.select().from(channelSyncConfig)
    .where(and(eq(channelSyncConfig.orgId, orgId), eq(channelSyncConfig.channelKey, channelKey))).limit(1);
  const stockroomModes: Record<string, 'skip' | 'hidden' | 'active'> =
    (cfgRow?.syncStockroomModes as any) ?? { A: 'skip', B: 'skip', C: 'skip' };

  // Unfiltered total — matches what the inventory dashboard shows (includes soft-deleted).
  const [allLotsRow] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(blInventory)
    .where(eq(blInventory.orgId, orgId));
  const totalLotsAll = Number(allLotsRow?.count) || 0;

  // Count active lots per stockroom bucket, plus zero-qty within each.
  const rows = await db
    .select({
      isStockRoom: blInventory.isStockRoom,
      stockRoomId: blInventory.stockRoomId,
      totalLots: sql<number>`COUNT(*)`,
      zeroQtyLots: sql<number>`SUM(CASE WHEN ${blInventory.quantity} <= 0 THEN 1 ELSE 0 END)`,
    })
    .from(blInventory)
    .where(and(eq(blInventory.orgId, orgId), isNull(blInventory.deletedAt)))
    .groupBy(blInventory.isStockRoom, blInventory.stockRoomId);

  let activeTotalLots = 0;
  let skipLots = 0;
  let hiddenLots = 0;
  let activeLots = 0;
  let mainStoreLots = 0;
  let zeroQtyInScope = 0;

  const stockroomBreakdown: Array<{ id: string; mode: string; lots: number; zeroQtyLots: number }> = [];

  for (const row of rows) {
    const lots = Number(row.totalLots) || 0;
    const zeroQty = Number(row.zeroQtyLots) || 0;
    activeTotalLots += lots;

    if (row.isStockRoom && row.stockRoomId) {
      const mode = stockroomModes[row.stockRoomId] ?? 'skip';
      stockroomBreakdown.push({ id: row.stockRoomId, mode, lots, zeroQtyLots: zeroQty });
      if (mode === 'skip') {
        skipLots += lots;
      } else if (mode === 'hidden') {
        hiddenLots += lots;
        zeroQtyInScope += zeroQty;
      } else {
        activeLots += lots;
        zeroQtyInScope += zeroQty;
      }
    } else {
      mainStoreLots += lots;
      zeroQtyInScope += zeroQty;
    }
  }

  const softDeletedLots = totalLotsAll - activeTotalLots;

  // Item-type exclusion: count non-deleted, non-stockroom-skipped lots whose item_type
  // is explicitly false in syncItemTypes config
  const syncItemTypesCfg = (cfgRow?.syncItemTypes as Record<string, boolean> | null) ?? {};
  const excludedItemTypes = Object.entries(syncItemTypesCfg)
    .filter(([, v]) => v === false)
    .map(([k]) => k);

  // Safe JSON string of stockroom modes for use in SQL JSONB expressions
  const stockroomModesJson = JSON.stringify(stockroomModes);

  let itemTypeExcludedLots = 0;
  if (excludedItemTypes.length > 0) {
    // Exclude stockroom-skip items by checking the per-row stockroom condition
    const itResult = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM bl_inventory
      WHERE org_id = ${orgId}
        AND deleted_at IS NULL
        AND item_type = ANY(${excludedItemTypes})
        AND NOT (
          is_stock_room = TRUE
          AND stock_room_id IS NOT NULL
          AND (${stockroomModesJson}::jsonb->>stock_room_id) = 'skip'
        )
    `);
    const itRow = (itResult as any).rows?.[0] ?? (itResult as any)[0];
    itemTypeExcludedLots = Number((itRow as any)?.cnt ?? 0);
  }

  // Price floor exclusion: count non-deleted lots below the floor (not already type-excluded or stockroom-skipped)
  const priceFloor = typeof cfgRow?.syncPriceFloor === 'number' ? cfgRow.syncPriceFloor : null;
  let priceFloorExcludedLots = 0;
  if (priceFloor && priceFloor > 0) {
    const pfResult = await db.execute(sql`
      SELECT COUNT(*) AS cnt
      FROM bl_inventory
      WHERE org_id = ${orgId}
        AND deleted_at IS NULL
        AND (unit_price IS NULL OR CAST(unit_price AS NUMERIC) < ${priceFloor})
        AND NOT (
          is_stock_room = TRUE
          AND stock_room_id IS NOT NULL
          AND (${stockroomModesJson}::jsonb->>stock_room_id) = 'skip'
        )
    `);
    const pfRow = (pfResult as any).rows?.[0] ?? (pfResult as any)[0];
    priceFloorExcludedLots = Number((pfRow as any)?.cnt ?? 0);
  }

  const inScopeLots = activeTotalLots - skipLots - itemTypeExcludedLots - priceFloorExcludedLots;

  // Build exclusion breakdown for UI display
  const exclusions: Array<{ reason: string; count: number }> = [];
  if (skipLots > 0)               exclusions.push({ reason: 'Stockroom (Skip mode)', count: skipLots });
  if (itemTypeExcludedLots > 0)   exclusions.push({ reason: 'Item type excluded', count: itemTypeExcludedLots });
  if (priceFloorExcludedLots > 0) exclusions.push({ reason: `Price floor (< $${priceFloor?.toFixed(2)})`, count: priceFloorExcludedLots });

  res.json({
    totalLots: totalLotsAll,       // unfiltered — matches inventory dashboard
    activeTotalLots,               // non-deleted
    inScopeLots,                   // what the sync engine will actually process
    softDeletedLots,
    skipLots,
    hiddenLots,
    activeLots,
    mainStoreLots,
    zeroQtyInScope,
    itemTypeExcludedLots,
    priceFloorExcludedLots,
    priceFloor,
    excludedItemTypes,
    stockroomModes,
    stockroomBreakdown: stockroomBreakdown.sort((a, b) => a.id.localeCompare(b.id)),
    exclusions,
  });
}));

router.post("/platform-sync/sync", isApproved, asyncRoute(async (req, res) => {
  const { platform, limit } = req.body;

  if (platform !== 'BrickOwl') {
    return res.status(400).json({ 
      success: false,
      error: `Platform ${platform} is not supported yet. Only BrickOwl is available.` 
    });
  }

  const orgId = reqOrgId(req);
  const [settingsRow] = await db.select({ channelSyncMode: appSettings.channelSyncMode })
    .from(appSettings).where(eq(appSettings.orgId, orgId)).limit(1);
  const rawMode = settingsRow?.channelSyncMode;
  const syncMode = (rawMode === 'matched_sync' || rawMode === 'quantity_only' ? 'matched_sync' : rawMode === 'analysis' ? 'analysis' : 'full_control') as 'analysis' | 'full_control' | 'matched_sync';

  const [cfgRow] = await db.select().from(channelSyncConfig)
    .where(and(eq(channelSyncConfig.orgId, orgId), eq(channelSyncConfig.channelKey, 'brickowl'))).limit(1);
  const syncFields = cfgRow ? {
    price:            cfgRow.syncPrice,
    remarks:          cfgRow.syncRemarks,
    description:      cfgRow.syncDescription,
    tierPrice:        cfgRow.syncTierPrice,
    salePercent:      cfgRow.syncSalePercent,
    bulkQty:          cfgRow.syncBulkQty,
    lotWeight:        cfgRow.syncLotWeight,
    stockroomModes:   (cfgRow.syncStockroomModes as Record<string, 'skip'|'hidden'|'active'|'sync'>) ?? { A: 'skip', B: 'skip', C: 'skip' },
    syncItemTypes:    (cfgRow.syncItemTypes as Record<string, boolean> | null) ?? {},
    priceFloor:       typeof cfgRow.syncPriceFloor === 'number' ? cfgRow.syncPriceFloor : null,
  } : {
    price: true,
    remarks: true,
    description: true,
    tierPrice: true,
    salePercent: true,
    bulkQty: true,
    lotWeight: true,
    stockroomModes: { A: 'skip', B: 'skip', C: 'skip' },
    syncItemTypes: {},
    priceFloor: null
  };

  const modesStr = Object.entries(syncFields.stockroomModes).map(([k, v]) => `${k}:${v}`).join(',');
  console.log(`[Platform Sync] Starting BrickLink → BrickOwl sync${limit ? ` (limit: ${limit})` : ''} (mode: ${syncMode}, fields: price=${syncFields.price} remarks=${syncFields.remarks} desc=${syncFields.description} tier=${syncFields.tierPrice} sale=${syncFields.salePercent} stockrooms=[${modesStr}])...`);
  
  const result = await syncBrickLinkToBrickOwl(limit, syncMode, undefined, syncFields as any);
  
  console.log(`[Platform Sync] Complete: ${result.lotsCreated} created, ${result.lotsUpdated} updated, ${result.lotsSkipped} skipped`);

  res.json({
    success: true,
    platform,
    result,
  });
}));

router.get('/channel-sync/config', isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const channelKey = (req.query.channel as string) || 'brickowl';
  const [row] = await db.select().from(channelSyncConfig)
    .where(and(eq(channelSyncConfig.orgId, orgId), eq(channelSyncConfig.channelKey, channelKey))).limit(1);
  if (row) return res.json(row);
  // Return defaults — no row yet
  return res.json({
    orgId,
    syncPrice:        true,
    syncRemarks:      true,
    syncDescription:  true,
    syncTierPrice:    true,
    syncSalePercent:  true,
    syncBulkQty:      true,
    syncLotWeight:    true,
    syncStockroomModes: { A: 'skip', B: 'skip', C: 'skip' },
    syncItemTypes:    {},
    syncPriceFloor:   null,
    syncBulkLots:     false,
  });
}));

router.patch('/channel-sync/config', isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const channelKey = (req.query.channel as string) || (req.body.channelKey as string) || 'brickowl';
  const boolAllowed = ['syncPrice', 'syncRemarks', 'syncDescription', 'syncTierPrice', 'syncSalePercent', 'syncBulkQty', 'syncLotWeight', 'syncBulkLots'] as const;
  const patch: Record<string, boolean | number | null | Record<string, string>> = {};
  for (const key of boolAllowed) {
    if (key in req.body && typeof req.body[key] === 'boolean') patch[key] = req.body[key];
  }
  // syncPriceFloor: null (clear) or a non-negative number
  if ('syncPriceFloor' in req.body) {
    const raw = req.body.syncPriceFloor;
    if (raw === null) {
      patch.syncPriceFloor = null;
    } else if (typeof raw === 'number' && isFinite(raw) && raw >= 0) {
      patch.syncPriceFloor = raw;
    } else {
      console.warn(`[ChannelSyncConfig] PATCH rejected invalid syncPriceFloor for ${reqOrgId(req)}:`, raw);
    }
  }
  // syncStockroomModes: { A: 'skip'|'hidden'|'active'|'sync'|'sync', B: ..., C: ... }
  if ('syncStockroomModes' in req.body) {
    const raw = req.body.syncStockroomModes;
    const validModes = new Set(['skip', 'hidden', 'active', 'sync']);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) &&
        Object.values(raw).every((v: unknown) => typeof v === 'string' && validModes.has(v as string))) {
      patch.syncStockroomModes = raw as Record<string, string>;
    } else {
      console.warn(`[ChannelSyncConfig] PATCH rejected invalid syncStockroomModes for ${orgId}:`, JSON.stringify(raw));
    }
  }
  // syncItemTypes: { 'P': false, 'M': true, ... } — per-item-type sync inclusion
  if ('syncItemTypes' in req.body) {
    const raw = req.body.syncItemTypes;
    if (raw && typeof raw === 'object' && !Array.isArray(raw) &&
        Object.values(raw).every((v: unknown) => typeof v === 'boolean')) {
      (patch as any).syncItemTypes = raw as Record<string, boolean>;
    } else {
      console.warn(`[ChannelSyncConfig] PATCH rejected invalid syncItemTypes for ${orgId}:`, JSON.stringify(raw));
    }
  }
  // channelConfig: partial JSONB merge for channel-specific settings (e.g. eBay syncImages, ebayBlIdField)
  if ('channelConfig' in req.body) {
    const raw = req.body.channelConfig;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      // Read existing row to merge
      const [existingRow] = await db.select({ channelConfig: channelSyncConfig.channelConfig })
        .from(channelSyncConfig)
        .where(and(eq(channelSyncConfig.orgId, orgId), eq(channelSyncConfig.channelKey, channelKey)))
        .limit(1);
      const existing = (existingRow?.channelConfig as Record<string, unknown>) ?? {};
      patch.channelConfig = { ...existing, ...raw };
    } else {
      console.warn(`[ChannelSyncConfig] PATCH rejected invalid channelConfig for ${orgId}:`, JSON.stringify(raw));
    }
  }
  if (Object.keys(patch).length === 0) {
    console.warn(`[ChannelSyncConfig] PATCH 400 for ${orgId} — no valid fields in body:`, JSON.stringify(req.body));
    return res.status(400).json({ error: 'No valid fields provided' });
  }
  console.log(`[ChannelSyncConfig] PATCH for ${orgId} — applying:`, JSON.stringify(patch));

  // Upsert — scoped to (orgId, channelKey)
  const whereClause = and(eq(channelSyncConfig.orgId, orgId), eq(channelSyncConfig.channelKey, channelKey));
  const [existing] = await db.select({ id: channelSyncConfig.id }).from(channelSyncConfig).where(whereClause).limit(1);
  if (existing) {
    const [updated] = await db.update(channelSyncConfig).set({ ...patch, updatedAt: new Date() }).where(whereClause).returning();
    console.log(`[ChannelSyncConfig] PATCH updated [${channelKey}] — syncStockroomModes now:`, JSON.stringify(updated?.syncStockroomModes));
    return res.json(updated);
  } else {
    const patchAny = patch as any;
    const [inserted] = await db.insert(channelSyncConfig).values({
      orgId,
      channelKey,
      syncPrice:        (patchAny.syncPrice        as boolean)  ?? true,
      syncRemarks:      (patchAny.syncRemarks       as boolean)  ?? true,
      syncDescription:  (patchAny.syncDescription   as boolean)  ?? true,
      syncTierPrice:    (patchAny.syncTierPrice      as boolean)  ?? true,
      syncSalePercent:  (patchAny.syncSalePercent    as boolean)  ?? true,
      syncBulkQty:      (patchAny.syncBulkQty        as boolean)  ?? true,
      syncLotWeight:    (patchAny.syncLotWeight       as boolean)  ?? true,
      syncStockroomModes: (patchAny.syncStockroomModes as Record<string, 'skip'|'hidden'|'active'|'sync'>) ?? { A: 'skip', B: 'skip', C: 'skip' },
      syncItemTypes:    (patchAny.syncItemTypes as unknown as Record<string, boolean>) ?? {},
      syncPriceFloor:   (patchAny.syncPriceFloor as number | null) ?? null,
    } as any).returning();
    console.log(`[ChannelSyncConfig] PATCH inserted — syncStockroomModes:`, JSON.stringify(inserted?.syncStockroomModes), 'syncItemTypes:', JSON.stringify(inserted?.syncItemTypes));
    return res.json(inserted);
  }
}));

router.post('/platform-sync/verify-lots', isApproved, asyncRoute(async (req: any, res) => {
  const { externalIds } = req.body;
  
  if (!externalIds || !Array.isArray(externalIds)) {
    return res.status(400).json({ error: 'externalIds array required' });
  }

  // Fetch all BrickOwl inventory
  const orgId = reqOrgId(req);
  const { getBrickOwlInventory } = await import('../services/brickowl');
  const brickowlInventory = await getBrickOwlInventory(false, orgId);
  
  // Filter for the specific lots
  const verifiedLots = brickowlInventory
    .filter((lot: any) => externalIds.includes(lot.external_id_1))
    .map((lot: any) => ({
      external_id_1: lot.external_id_1,
      boid: lot.boid,
      name: lot.name,
      color: lot.col_name || 'N/A',
      condition: lot.full_con || lot.con,
      quantity: lot.qty,
      price: lot.price,
      lot_id: lot.lot_id,
      url: lot.url,
    }));

  const response = {
    success: true,
    lots: verifiedLots,
    total: verifiedLots.length,
  };
  
  return res.json(response);
}));

router.get("/sync-issues", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { status, syncType, platform, severity } = req.query;
  
  const conditions = [eq(syncIssues.orgId, orgId)];
  
  if (status) {
    conditions.push(eq(syncIssues.status, status as string));
  }
  if (syncType) {
    conditions.push(eq(syncIssues.syncType, syncType as string));
  }
  if (platform) {
    conditions.push(eq(syncIssues.platform, platform as string));
  }
  if (severity) {
    conditions.push(eq(syncIssues.severity, severity as string));
  }
  
  const issues = await db
    .select()
    .from(syncIssues)
    .where(and(...conditions))
    .orderBy(desc(syncIssues.createdAt))
    .limit(100);
  
  res.json({
    success: true,
    issues,
    count: issues.length,
  });
}));

router.get("/sync-issues/stats", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const openIssues = await db
    .select({ count: sql<number>`count(*)` })
    .from(syncIssues)
    .where(and(eq(syncIssues.orgId, orgId), eq(syncIssues.status, 'open')));
  
  const criticalIssues = await db
    .select({ count: sql<number>`count(*)` })
    .from(syncIssues)
    .where(and(eq(syncIssues.orgId, orgId), eq(syncIssues.status, 'open'), eq(syncIssues.severity, 'critical')));
  
  res.json({
    success: true,
    stats: {
      open: Number(openIssues[0]?.count || 0),
      critical: Number(criticalIssues[0]?.count || 0),
    },
  });
}));

router.post("/sync-issues", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const issue = insertSyncIssueSchema.parse(req.body);
  
  const [newIssue] = await db.insert(syncIssues).values({ ...issue, orgId }).returning();
  
  res.json({
    success: true,
    issue: newIssue,
  });
}));

router.patch("/sync-issues/:id", isApproved, asyncRoute(async (req: any, res) => {
  const { id } = req.params;
  const { status, resolvedBy } = req.body;
  
  const updates: any = { status };
  
  if (status === 'resolved' || status === 'ignored') {
    updates.resolvedAt = new Date();
    updates.resolvedBy = resolvedBy || 'user';
  }
  
  const [updatedIssue] = await db
    .update(syncIssues)
    .set(updates)
    .where(eq(syncIssues.id, id))
    .returning();
  
  if (!updatedIssue) {
    return res.status(404).json({
      success: false,
      error: "Issue not found",
    });
  }
  
  res.json({
    success: true,
    issue: updatedIssue,
  });
}));

router.get("/sync-queue", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const rows = await db
    .select({
      id: crossPlatformSyncQueue.id,
      blInventoryId: crossPlatformSyncQueue.blInventoryId,
      targetPlatform: crossPlatformSyncQueue.targetPlatform,
      sourcePlatform: crossPlatformSyncQueue.sourcePlatform,
      sourceOrderId: crossPlatformSyncQueue.sourceOrderId,
      quantityDelta: crossPlatformSyncQueue.quantityDelta,
      status: crossPlatformSyncQueue.status,
      retryCount: crossPlatformSyncQueue.retryCount,
      lastAttemptAt: crossPlatformSyncQueue.lastAttemptAt,
      lastError: crossPlatformSyncQueue.lastError,
      createdAt: crossPlatformSyncQueue.createdAt,
      itemNo: blInventory.itemNo,
    })
    .from(crossPlatformSyncQueue)
    .leftJoin(blInventory, eq(blInventory.id, crossPlatformSyncQueue.blInventoryId))
    .where(eq(crossPlatformSyncQueue.orgId, orgId))
    .orderBy(desc(crossPlatformSyncQueue.createdAt))
    .limit(200);

  const pending = rows.filter(r => r.status === 'pending').length;
  const abandoned = rows.filter(r => r.status === 'abandoned').length;
  const done = rows.filter(r => r.status === 'done').length;

  res.json({ success: true, items: rows, stats: { pending, abandoned, done, total: rows.length } });
}));

router.patch("/sync-queue/:id", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const id = parseInt(req.params.id, 10);
  const { status } = req.body as { status: 'done' | 'abandoned' };
  if (!['done', 'abandoned'].includes(status)) {
    return res.status(400).json({ success: false, error: "status must be 'done' or 'abandoned'" });
  }
  const [updated] = await db
    .update(crossPlatformSyncQueue)
    .set({ status, lastAttemptAt: new Date() })
    .where(and(eq(crossPlatformSyncQueue.id, id), eq(crossPlatformSyncQueue.orgId, orgId)))
    .returning();
  if (!updated) return res.status(404).json({ success: false, error: "Queue item not found" });
  res.json({ success: true, item: updated });
}));

router.post("/sync-queue/:id/retry", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const id = parseInt(req.params.id, 10);
  // Reset the item to pending so the next retry runner picks it up
  const [updated] = await db
    .update(crossPlatformSyncQueue)
    .set({ status: 'pending', retryCount: 0, lastError: null })
    .where(and(eq(crossPlatformSyncQueue.id, id), eq(crossPlatformSyncQueue.orgId, orgId)))
    .returning();
  if (!updated) return res.status(404).json({ success: false, error: "Queue item not found" });

  // Fire the retry runner immediately in the background
  const { retryFailedCrossPlatformSyncs } = await import("../services/cross-platform-retry");
  retryFailedCrossPlatformSyncs(orgId).catch(err =>
    console.error(`Manual retry runner error: ${err.message}`)
  );

  res.json({ success: true, message: "Retry triggered", item: updated });
}));

router.post("/sync-issues/bulk-resolve", isApproved, asyncRoute(async (req, res) => {
  const { syncTypes, status = "resolved" } = req.body as { syncTypes: string[]; status?: string };

  if (!Array.isArray(syncTypes) || syncTypes.length === 0) {
    return res.status(400).json({ success: false, error: "syncTypes array required" });
  }

  const conditions = [
    eq(syncIssues.status, "open"),
    inArray(syncIssues.syncType, syncTypes),
  ];

  const updated = await db
    .update(syncIssues)
    .set({ status, resolvedAt: new Date(), resolvedBy: "user" })
    .where(and(...conditions))
    .returning({ id: syncIssues.id });

  res.json({ success: true, resolved: updated.length });
}));

router.delete("/sync-issues/:id", isApproved, asyncRoute(async (req, res) => {
  const { id } = req.params;
  
  await db.delete(syncIssues).where(eq(syncIssues.id, id));
  
  res.json({
    success: true,
  });
}));

router.post("/sync/bricklink/inventory", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const SYNC_ID = 'bricklink_inventory';
  if (syncLock.isBlockedFor('Inventory Sync')) {
    const blocker = syncLock.getBlockersFor('Inventory Sync').join(', ');
    return res.status(409).json({ success: false, error: `Cannot start BrickLink Inventory Sync: ${blocker} is already running.` });
  }
  try {
    await db.insert(syncMetadata).values({
      id: SYNC_ID, orgId, lastSyncStatus: 'in_progress', lastSyncTime: new Date(),
      recordsAdded: 0, recordsUpdated: 0,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date(), errorMessage: null },
    });

    const result = await syncBricklinkData(orgId);

    await db.insert(syncMetadata).values({
      id: SYNC_ID, orgId, lastSyncStatus: 'success', lastSyncTime: new Date(),
      recordsAdded: result.inventoryAdded ?? 0, recordsUpdated: result.inventoryUpdated ?? 0, errorMessage: null,
    }).onConflictDoUpdate({
      target: syncMetadata.id,
      set: { lastSyncStatus: 'success', lastSyncTime: new Date(), updatedAt: new Date(),
        recordsAdded: result.inventoryAdded ?? 0, recordsUpdated: result.inventoryUpdated ?? 0, errorMessage: null },
    });

    res.json({ success: true, data: result });

    // Fire-and-forget: embed any new items that don't yet have a CLIP catalog embedding.
    (async () => {
      try {
        const { buildCatalogEmbeddings } = await import('../services/clip-search.js');
        const rows = await db.select({ itemNo: blInventory.itemNo, colorId: blInventory.colorId }).from(blInventory).where(eq(blInventory.orgId, orgId));
        const items = rows.map((r) => ({ itemNo: r.itemNo, colorId: Number(r.colorId), itemType: 'PART' }));
        if (items.length === 0) return;
        const built = await buildCatalogEmbeddings(items);
        if (built.done > 0) console.log(`[CLIP Auto] Manual sync: ${built.done} new catalog embeddings added`);
      } catch (e: any) {
        console.warn('[CLIP Auto] Post-manual-sync catalog update failed (non-fatal):', e.message);
      }
    })();
  } catch (error: any) {
    console.error("BrickLink sync error:", error);
    const alreadyRunning = error.message?.includes('already in progress') || error.message?.includes('already running');
    if (!alreadyRunning) {
      await db.insert(syncMetadata).values({
        id: SYNC_ID, orgId, lastSyncStatus: 'error', lastSyncTime: new Date(),
        recordsAdded: 0, recordsUpdated: 0, errorMessage: error.message,
      }).onConflictDoUpdate({
        target: syncMetadata.id,
        set: { lastSyncStatus: 'error', lastSyncTime: new Date(), updatedAt: new Date(), errorMessage: error.message },
      }).catch(() => {});
    }
    res.status(alreadyRunning ? 409 : 500).json({ success: false, error: alreadyRunning ? error.message : "Failed to sync BrickLink inventory" });
  }
}));

router.get('/sync/bricklink/recent-changes', isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const type = (req.query.type as string) === 'updated' ? 'updated' : 'added';
  const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);

  const [meta] = await db.select().from(syncMetadata).where(eq(syncMetadata.id, 'bricklink_inventory')).limit(1);

  const items = await db
    .select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      colorId: blInventory.colorId,
      quantity: blInventory.quantity,
      unitPrice: blInventory.unitPrice,
      newOrUsed: blInventory.newOrUsed,
      isStockRoom: blInventory.isStockRoom,
      syncedAt: blInventory.syncedAt,
      updatedAt: blInventory.updatedAt,
      itemName: blCatalog.itemName,
      colorName: blCatalog.colorName,
    })
    .from(blInventory)
    .leftJoin(blCatalog, and(
      eq(blInventory.itemNo, blCatalog.itemNo),
      eq(blInventory.itemType, blCatalog.itemType),
      eq(sql`COALESCE(${blInventory.colorId}, 0)`, sql`COALESCE(${blCatalog.colorId}, 0)`),
    ))
    .where(and(eq(blInventory.orgId, orgId), isNull(blInventory.deletedAt)))
    .orderBy(type === 'added' ? desc(blInventory.syncedAt) : desc(blInventory.updatedAt))
    .limit(limit);

  // For "updated" type, fetch the most recent change per field from inventory_history
  let itemsWithChanges: any[] = items;
  if (type === 'updated' && items.length > 0) {
    const itemIds = items.map(i => i.id);
    const historyRows = await db
      .select({
        inventoryId: inventoryHistory.inventoryId,
        field: inventoryHistory.field,
        oldValue: inventoryHistory.oldValue,
        newValue: inventoryHistory.newValue,
        changedAt: inventoryHistory.changedAt,
      })
      .from(inventoryHistory)
      .where(and(
        eq(inventoryHistory.orgId, orgId),
        inArray(inventoryHistory.inventoryId, itemIds),
        eq(inventoryHistory.source, 'bricklink_sync'),
      ))
      .orderBy(desc(inventoryHistory.changedAt));

    // Group by inventoryId, keep the most recent change per field
    const historyByItem: Record<number, { field: string; oldValue: string | null; newValue: string | null }[]> = {};
    for (const row of historyRows) {
      if (!historyByItem[row.inventoryId]) historyByItem[row.inventoryId] = [];
      if (!historyByItem[row.inventoryId].some(h => h.field === row.field)) {
        historyByItem[row.inventoryId].push({ field: row.field, oldValue: row.oldValue, newValue: row.newValue });
      }
    }

    itemsWithChanges = items.map(item => ({
      ...item,
      changes: historyByItem[item.id] ?? [],
    }));
  }

  res.json({
    items: itemsWithChanges,
    lastSyncTime: meta?.lastSyncTime ?? null,
    totalCount: type === 'added' ? (meta?.recordsAdded ?? 0) : (meta?.recordsUpdated ?? 0),
  });
}));

router.get('/sync/channel/recent-changes', isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const type = (req.query.type as string) === 'updated' ? 'updated' : 'created';
  const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);

  const [meta] = await db.select().from(syncMetadata).where(eq(syncMetadata.id, 'channel_sync')).limit(1);

  const items = await db
    .select({
      blInvId: channelLotLinks.blInvId,
      channelLotId: channelLotLinks.channelLotId,
      linkedAt: channelLotLinks.syncedAt,
      itemNo: blInventory.itemNo,
      colorId: blInventory.colorId,
      quantity: blInventory.quantity,
      unitPrice: blInventory.unitPrice,
      newOrUsed: blInventory.newOrUsed,
      updatedAt: blInventory.updatedAt,
      itemName: blCatalog.itemName,
      colorName: blCatalog.colorName,
    })
    .from(channelLotLinks)
    .leftJoin(blInventory, eq(channelLotLinks.blInvId, blInventory.id))
    .leftJoin(blCatalog, and(
      eq(blInventory.itemNo, blCatalog.itemNo),
      eq(blInventory.itemType, blCatalog.itemType),
      eq(sql`COALESCE(${blInventory.colorId}, 0)`, sql`COALESCE(${blCatalog.colorId}, 0)`),
    ))
    .where(and(eq(channelLotLinks.orgId, orgId), eq(channelLotLinks.channel, 'brickowl')))
    .orderBy(type === 'created' ? desc(channelLotLinks.syncedAt) : desc(blInventory.updatedAt))
    .limit(limit);

  // For "updated" items, attach recent field-level change history from inventory_history
  let itemsOut: any[] = items;
  if (type === 'updated' && items.length > 0) {
    const blInvIds = items.map((i) => i.blInvId).filter(Boolean) as number[];
    if (blInvIds.length > 0) {
      const histRows = await db
        .select({
          inventoryId: inventoryHistory.inventoryId,
          field: inventoryHistory.field,
          oldValue: inventoryHistory.oldValue,
          newValue: inventoryHistory.newValue,
          changedAt: inventoryHistory.changedAt,
        })
        .from(inventoryHistory)
        .where(and(
          eq(inventoryHistory.orgId, orgId),
          inArray(inventoryHistory.inventoryId, blInvIds),
        ))
        .orderBy(desc(inventoryHistory.changedAt));

      // Keep only the most-recent change per (inventoryId, field)
      const latestByItemField = new Map<string, typeof histRows[0]>();
      for (const row of histRows) {
        const key = `${row.inventoryId}::${row.field}`;
        if (!latestByItemField.has(key)) latestByItemField.set(key, row);
      }

      // Group by inventoryId
      const changesByItem = new Map<number, { field: string; oldValue: string | null; newValue: string | null }[]>();
      for (const row of Array.from(latestByItemField.values())) {
        if (!changesByItem.has(row.inventoryId)) changesByItem.set(row.inventoryId, []);
        changesByItem.get(row.inventoryId)!.push({
          field: row.field,
          oldValue: row.oldValue,
          newValue: row.newValue,
        });
      }

      itemsOut = items.map((item) => ({
        ...item,
        changes: item.blInvId != null ? (changesByItem.get(item.blInvId) ?? []) : [],
      }));
    }
  }

  res.json({
    items: itemsOut,
    lastSyncTime: meta?.lastSyncTime ?? null,
    totalCount: type === 'created' ? (meta?.recordsAdded ?? 0) : (meta?.recordsUpdated ?? 0),
  });
}));

router.post("/sync/rebrickable/bulk-images", isApproved, asyncRoute(async (req, res) => {
  const maxBatches = req.body?.maxBatches || 500;
  
  // Start the sync in background - don't await it
  console.log(`[Rebrickable Bulk Sync] Starting bulk image sync in background (max ${maxBatches} batches)...`);
  
  // Import and start the sync without awaiting
  import("../services/rebrickable-images").then(async ({ bulkSyncRebrickableImages }) => {
    console.log('[Rebrickable Bulk Sync] Background sync process started');
    try {
      const result = await bulkSyncRebrickableImages(maxBatches);
      console.log('[Rebrickable Bulk Sync] Background sync complete:', JSON.stringify(result));
    } catch (error) {
      console.error('[Rebrickable Bulk Sync] Background sync error:', error);
    }
  });
  
  // Return immediately to client
  res.json({
    success: true,
    message: "Image sync started in background. This will continue even if you close this page.",
    data: {
      status: "started",
      maxBatches
    }
  });
}));

router.post("/sync/rebrickable/set-parts", isApproved, asyncRoute(async (req: any, res) => {
  const { force = false } = req.body || {};
  const { syncRebrickableSetParts, getRebrickableSyncIsRunning } = await import('../services/rebrickable.js');
  if (getRebrickableSyncIsRunning()) {
    return res.status(409).json({ success: false, error: 'Rebrickable sync already running' });
  }
  // Fire-and-forget — returns immediately
  syncRebrickableSetParts(force).catch((err: any) => {
    console.error('[Rebrickable API] Sync error:', err.message);
  });
  res.json({ success: true, message: 'Rebrickable set-parts sync started', force });
}));

// Unified Rebrickable lane: Colors → Set Parts → Set Minifigs
router.post("/sync/rebrickable/all", isApproved, asyncRoute(async (req: any, res) => {
  const { force = false } = req.body || {};
  const { syncRebrickableAll, getRebrickableAllRunning } = await import('../services/rebrickable.js');
  if (getRebrickableAllRunning()) {
    return res.status(409).json({ success: false, error: 'Rebrickable sync already running' });
  }
  syncRebrickableAll(force).catch((err: any) => {
    console.error('[Rebrickable Lane] Failed:', err.message);
  });
  res.json({
    success: true,
    message: force ? 'Full Rebrickable rebuild started — this will take 5–10 minutes.' : 'Rebrickable sync started — this will take 2–4 minutes.',
    force,
  });
}));

router.post("/sync/rebrickable/colors", isApproved, asyncRoute(async (req: any, res) => {
  const { syncRebrickableColors, getRbColorsSyncIsRunning } = await import('../services/rebrickable.js');
  if (getRbColorsSyncIsRunning()) {
    return res.status(409).json({ success: false, error: 'Rebrickable colors sync already running' });
  }
  try {
    const result = await syncRebrickableColors();
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
}));

router.post("/sync/rebrickable/set-minifigs", isApproved, asyncRoute(async (req: any, res) => {
  const { syncRebrickableSetMinifigs, getMinifigSyncIsRunning } = await import('../services/rebrickable.js');
  if (getMinifigSyncIsRunning()) {
    return res.status(409).json({ success: false, error: 'Rebrickable minifig sync already running' });
  }
  syncRebrickableSetMinifigs().catch((err: any) => {
    console.error('[Rebrickable Minifigs] Sync error:', err.message);
  });
  res.json({ success: true, message: 'Rebrickable set-minifigs sync started' });
}));

router.post("/sync/rebrickable/part-relationships", isApproved, asyncRoute(async (req: any, res) => {
  const { force = false } = req.body || {};
  const { syncRebrickablePartRelationships, getPartRelSyncIsRunning } = await import('../services/rebrickable.js');
  if (getPartRelSyncIsRunning()) {
    return res.status(409).json({ success: false, error: 'Part relationships sync already running' });
  }
  syncRebrickablePartRelationships(force).then((result) => {
    console.log(`[PartRel API] Sync complete: ${result.rowsInserted} rows`);
  }).catch((err: any) => {
    console.error('[PartRel API] Sync error:', err.message);
  });
  res.json({ success: true, message: 'Part relationships sync started', force });
}));

router.get("/sync/bricklink/progress", isApproved, asyncRoute(async (req, res) => {
  const { syncProgressTracker } = await import('../services/sync-progress');
  const progress = syncProgressTracker.get();
  res.json(progress);
}));

router.get("/sync/bricklink/orders/progress", isApproved, asyncRoute(async (_req, res) => {
  const { getOrderSyncProgress } = await import("../services/order-sync-core");
  res.json(getOrderSyncProgress('bricklink'));
}));

router.get("/sync/brickowl/orders/progress", isApproved, asyncRoute(async (_req, res) => {
  const { getOrderSyncProgress } = await import("../services/order-sync-core");
  res.json(getOrderSyncProgress('brickowl'));
}));

router.get('/sync/orders/recent', isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const platform = (req.query.platform as string) || 'bricklink';
  const type = (req.query.type as string) || 'added';
  const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);

  const syncId = platform === 'bricklink' ? 'bricklink_orders' : 'brickowl_orders';
  const prefix = platform === 'bricklink' ? 'bl-' : 'bo-';

  const [meta] = await db.select().from(syncMetadata).where(and(eq(syncMetadata.id, syncId), eq(syncMetadata.orgId, orgId))).limit(1);

  const totalCount = type === 'added' ? (meta?.recordsAdded ?? 0) : (meta?.recordsUpdated ?? 0);

  let rows: any[];
  if (type === 'added') {
    rows = await db.select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      orderStatus: orders.orderStatus,
      customerUsername: orders.customerUsername,
      orderTotal: orders.orderTotal,
      orderDate: orders.orderDate,
      syncedAt: orders.syncedAt,
    }).from(orders)
      .where(and(
        eq(orders.orgId, orgId),
        sql`${orders.id} LIKE ${prefix + '%'}`,
        eq(orders.isTest, false),
        sql`${orders.orderStatus} != 'purged'`,
      ))
      .orderBy(desc(orders.syncedAt))
      .limit(limit);
  } else {
    rows = await db.select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      orderStatus: orders.orderStatus,
      previousStatus: orders.previousStatus,
      customerUsername: orders.customerUsername,
      orderTotal: orders.orderTotal,
      orderDate: orders.orderDate,
      updatedAt: orders.updatedAt,
      syncedAt: orders.syncedAt,
    }).from(orders)
      .where(and(
        eq(orders.orgId, orgId),
        sql`${orders.id} LIKE ${prefix + '%'}`,
        eq(orders.isTest, false),
        sql`${orders.orderStatus} != 'purged'`,
        sql`${orders.updatedAt} > ${orders.syncedAt}`,
      ))
      .orderBy(desc(orders.updatedAt))
      .limit(limit);
  }

  res.json({ items: rows, totalCount, lastSyncTime: meta?.lastSyncTime ?? null });
}));

router.get("/debug/bl-order-detail/:orderId", asyncRoute(async (_req: any, res) => {
  if (_req.query.secret !== 'ELFIE_DEBUG_2026') return res.status(403).json({ error: "Forbidden" });
  const { getBrickLinkOrderDetail } = await import("../services/bricklink-orders");
  const { getPlatformBrickLinkCredentials } = await import('../routes');
  const creds = await getPlatformBrickLinkCredentials();
  if (!creds) return res.status(400).json({ error: "No BL credentials" });
  const raw = await getBrickLinkOrderDetail(
    parseInt(_req.params.orderId), creds.consumerKey, creds.consumerSecret, creds.tokenValue, creds.tokenSecret
  );
  res.json(raw);
}));

router.post("/sync/bricklink/orders", isApproved, asyncRoute(async (req: any, res) => {
  if (syncLock.isBlockedFor('Order Sync')) {
    const blocker = syncLock.getBlockersFor('Order Sync').join(', ');
    return res.status(409).json({ success: false, error: `Cannot start BrickLink order sync: ${blocker} is already running.` });
  }
  const { limit, fullSync, sinceDate } = req.body;
  const { runPlatformOrderSync } = await import("../services/order-sync-core");
  const result = await runPlatformOrderSync("bricklink", { limit, fullSync, sinceDate });
  const orgId = reqOrgId(req);
  res.json({ success: true, data: result });
  const added = result.bricklink.ordersAdded ?? 0;
  if (added > 0) {
    broadcast(orgId, 'order.synced', { platform: 'bricklink', added });
  }
  const newOrderIds = getVerifiedNewOrderIds(result.bricklink);
  if (newOrderIds.length > 0) {
    const { sendOrderSyncNotifications } = await import("../services/push-notifications");
    const newRows = await db.select({
      orderNumber: orders.orderNumber,
      shippingTier: orders.requestedShippingService,
    })
      .from(orders)
      .where(and(eq(orders.orgId, orgId), eq(orders.marketplace, 'BrickLink'), inArray(orders.id, newOrderIds)));
    sendOrderSyncNotifications(orgId, newRows).catch(() => {});
  }
}));

router.post("/sync/brickowl/orders", isApproved, asyncRoute(async (req: any, res) => {
  if (syncLock.isBlockedFor('Order Sync')) {
    const blocker = syncLock.getBlockersFor('Order Sync').join(', ');
    return res.status(409).json({ success: false, error: `Cannot start BrickOwl order sync: ${blocker} is already running.` });
  }
  const { limit, fullSync, sinceDate } = req.body;
  const { runPlatformOrderSync } = await import("../services/order-sync-core");
  const result = await runPlatformOrderSync("brickowl", { limit, fullSync, sinceDate });
  const orgId = reqOrgId(req);
  res.json({ success: true, data: result });
  const added = result.brickowl.ordersAdded ?? 0;
  if (added > 0) {
    broadcast(orgId, 'order.synced', { platform: 'brickowl', added });
  }
  const newOrderIds = getVerifiedNewOrderIds(result.brickowl);
  if (newOrderIds.length > 0) {
    const { sendOrderSyncNotifications } = await import("../services/push-notifications");
    const newRows = await db.select({
      orderNumber: orders.orderNumber,
      shippingTier: orders.requestedShippingService,
    })
      .from(orders)
      .where(and(eq(orders.orgId, orgId), eq(orders.marketplace, 'BrickOwl'), inArray(orders.id, newOrderIds)));
    sendOrderSyncNotifications(orgId, newRows).catch(() => {});
  }
}));

router.post("/sync/ebay/orders", isApproved, asyncRoute(async (req: any, res) => {
  if (syncLock.isBlockedFor('Order Sync')) {
    const blocker = syncLock.getBlockersFor('Order Sync').join(', ');
    return res.status(409).json({ success: false, error: `Cannot start eBay order sync: ${blocker} is already running.` });
  }
  const { limit, fullSync, sinceDate } = req.body;
  const { runPlatformOrderSync } = await import("../services/order-sync-core");
  const result = await runPlatformOrderSync("ebay", { limit, fullSync, sinceDate });
  const orgId = reqOrgId(req);
  res.json({ success: true, data: result });
  const added = result.ebay?.ordersAdded ?? 0;
  if (added > 0) {
    broadcast(orgId, 'order.synced', { platform: 'ebay', added });
  }
  const newOrderIds = getVerifiedNewOrderIds(result.ebay);
  if (newOrderIds.length > 0) {
    const { sendOrderSyncNotifications } = await import("../services/push-notifications");
    const newRows = await db.select({
      orderNumber: orders.orderNumber,
      shippingTier: orders.requestedShippingService,
    })
      .from(orders)
      .where(and(eq(orders.orgId, orgId), eq(orders.marketplace, 'eBay'), inArray(orders.id, newOrderIds)));
    sendOrderSyncNotifications(orgId, newRows).catch(() => {});
  }
}));

router.post("/sync/all-platforms/orders", isApproved, asyncRoute(async (req: any, res) => {
  if (syncLock.isBlockedFor('Order Sync')) {
    const blocker = syncLock.getBlockersFor('Order Sync').join(', ');
    return res.status(409).json({ success: false, error: `Cannot start order sync: ${blocker} is already running.` });
  }
  const { limit = 50, fullSync = false } = req.body;
  const { runPlatformOrderSync } = await import("../services/order-sync-core");
  const result = await runPlatformOrderSync("all", { limit, fullSync });
  const orgId = reqOrgId(req);
  const outcomes: any[] = Object.values(result);
  const anySuccess = outcomes.some(o => o.success);
  const allSkipped = outcomes.every(o => o.skipped);
  const totalAdded = outcomes.reduce((sum, o) => sum + (o.ordersAdded ?? 0), 0);
  res.json({ success: anySuccess, allSkipped, results: result });
  if (totalAdded > 0) {
    broadcast(orgId, 'order.synced', { platform: 'all', added: totalAdded });
  }
  const newOrderIds = [...new Set(outcomes.flatMap(o => getVerifiedNewOrderIds(o)))];
  if (newOrderIds.length > 0) {
    const { sendOrderSyncNotifications } = await import("../services/push-notifications");
    const newRows = await db.select({
      orderNumber: orders.orderNumber,
      shippingTier: orders.requestedShippingService,
    })
      .from(orders)
      .where(and(eq(orders.orgId, orgId), inArray(orders.id, newOrderIds)));
    sendOrderSyncNotifications(orgId, newRows).catch(() => {});
  }
}));

router.get("/order-sync/running", isApproved, asyncRoute(async (req, res) => {
  const { getOrderSyncIsRunning } = await import("../services/order-sync-core");
  res.json({ running: getOrderSyncIsRunning() });
}));

router.post("/platform-admin/sync/clear-lock", isSuperAdmin, asyncRoute(async (_req, res) => {
  const active = syncLock.getActive();
  for (const name of active) {
    syncLock.release(name);
    console.warn(`[Admin] Force-released stuck sync lock: ${name}`);
  }
  res.json({ cleared: active });
}));

router.get("/channel-sync/running", isApproved, asyncRoute(async (req, res) => {
  const { getChannelSyncIsRunning } = await import("../services/channel-sync-scheduler");
  res.json({ running: getChannelSyncIsRunning() });
}));

router.get("/channel-sync/progress", isApproved, asyncRoute(async (req, res) => {
  const { getChannelSyncProgress } = await import("../services/channel-sync-scheduler");
  const channel = typeof req.query.channel === 'string' ? req.query.channel : undefined;
  res.json(getChannelSyncProgress(channel));
}));

router.get("/channel-sync/last-result", isApproved, asyncRoute(async (req, res) => {
  const { getChannelSyncLastResult } = await import("../services/channel-sync-scheduler");
  const result = getChannelSyncLastResult();
  res.json(result ?? null);
}));

router.post("/channel-sync/test-price-update", isApproved, asyncRoute(async (req: any, res) => {
  const { lot_id, test_price } = req.body;
  if (!lot_id) return res.status(400).json({ error: 'lot_id required' });
  const orgId = reqOrgId(req);
  const { getBrickOwlInventory, updateBrickOwlLot } = await import('../services/brickowl');

  // 1. Fetch current state from BrickOwl
  const inventory = await getBrickOwlInventory(false, orgId);
  const lot = inventory.find((l: any) => String(l.lot_id) === String(lot_id));
  if (!lot) return res.status(404).json({ error: `lot_id ${lot_id} not found in BrickOwl inventory` });

  const priceBefore = parseFloat(lot.price || '0');
  const sendPrice   = test_price ?? parseFloat((priceBefore + 0.001).toFixed(3));

  // 2. Send price-only update
  const updateResponse = await updateBrickOwlLot({
    lot_id: String(lot_id),
    price: sendPrice,
  }, orgId);

  // 3. Re-fetch from BrickOwl to see if it stuck
  await new Promise(r => setTimeout(r, 2000));
  const inventoryAfter = await getBrickOwlInventory(false, orgId);
  const lotAfter = inventoryAfter.find((l: any) => String(l.lot_id) === String(lot_id));
  const priceAfter = parseFloat(lotAfter?.price || '0');

  res.json({
    lot_id,
    price_before:   priceBefore,
    sale_pct_before: lot.sale_percentage ?? lot.sale_percent ?? 0,
    price_sent:     sendPrice,
    price_after:    priceAfter,
    sale_pct_after: lotAfter?.sale_percentage ?? lotAfter?.sale_percent ?? 0,
    price_changed:  Math.abs(priceAfter - sendPrice) < 0.001,
    brickowl_response: updateResponse,
    lot_before: lot,
    lot_after:  lotAfter ?? null,
  });
}));

router.post("/sync/channel", isApproved, asyncRoute(async (req, res) => {
  if (syncLock.isBlockedFor('Channel Sync')) {
    const blocker = syncLock.getBlockersFor('Channel Sync').join(', ');
    return res.status(409).json({ success: false, error: `Cannot start Channel Sync: ${blocker} is already running.` });
  }
  const { runChannelSyncForOrg } = await import("../services/channel-sync-scheduler");
  const forceFullScan = req.body?.fullScan === true;
  const targetChannel: string | undefined = req.body?.channel || undefined;
  const orgId = reqOrgId(req);
  await runChannelSyncForOrg(orgId, forceFullScan, targetChannel);
  res.json({ success: true });
}));

router.get("/repair/brickowl-colors/progress", isApproved, asyncRoute(async (_req, res) => {
  res.json(colorRepairProgress);
}));

router.post("/repair/brickowl-colors", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { getBrickOwlInventory, mapColorId, getBoColorName, getBlColorName } = await import('../services/brickowl');
  const dryRun: boolean = req.body?.dryRun === true;
  const lotIdsFilter: Set<string> | null = Array.isArray(req.body?.lotIds) && req.body.lotIds.length > 0
    ? new Set(req.body.lotIds as string[])
    : null;

  if (!dryRun) {
    // Guard: don't start a second repair while one is running.
    if (colorRepairProgress.active) {
      return res.status(409).json({ error: 'A repair is already running.' });
    }
    // Fire and forget
    runColorRepair(orgId, lotIdsFilter).catch(err => {
      console.error('[ColorRepair] Unhandled error in background repair:', err);
      colorRepairProgress = { active: false, done: colorRepairProgress.done, total: colorRepairProgress.total, complete: true, fixed: 0, skipped: 0, errors: [String(err?.message ?? err)] };
    });
    return res.json({ started: true });
  }

  // Dry-run: scan synchronously and return mismatches.
  const boInventory = await getBrickOwlInventory(false, orgId);
  const taggedLots = boInventory.filter(lot => lot.external_lot_ids?.other);

  if (taggedLots.length === 0) {
    return res.json({ dryRun: true, mismatchCount: 0, skipped: 0, mismatches: [], message: 'No tagged lots found' });
  }

  const blIds = taggedLots.map(lot => parseInt(lot.external_lot_ids!.other!)).filter(n => !isNaN(n));
  const blItems = await db.select().from(blInventory).where(inArray(blInventory.id, blIds));
  const blMap = new Map(blItems.map(item => [item.id, item]));

  let skipped = 0;
  const mismatches: any[] = [];

  for (const lot of taggedLots) {
    const blId = parseInt(lot.external_lot_ids!.other!);
    const blItem = blMap.get(blId);
    if (!blItem || blItem.colorId == null) { skipped++; continue; }

    const expectedBoColorId = await mapColorId(blItem.colorId, orgId);
    if (expectedBoColorId == null) { skipped++; continue; }

    const boidParts = (lot.boid ?? '').split('-');
    const actualBoColorId = boidParts.length >= 2 ? parseInt(boidParts[boidParts.length - 1]) : 0;

    if (actualBoColorId === expectedBoColorId) { skipped++; continue; }

    mismatches.push({
      lotId: lot.lot_id,
      blId,
      itemNo: blItem.itemNo,
      currentColorId: actualBoColorId,
      currentColorName: getBoColorName(actualBoColorId),
      expectedColorId: expectedBoColorId,
      expectedColorName: blItem.colorId != null ? getBlColorName(blItem.colorId) : getBoColorName(expectedBoColorId),
    });
  }

  console.log(`[ColorRepair] Dry-run — ${mismatches.length} mismatches found, ${skipped} already correct`);
  return res.json({ dryRun: true, mismatchCount: mismatches.length, skipped, mismatches });
}));

router.get("/sync/statuses", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const ids = ['bricklink_inventory', 'priceomatic_cache', 'channel_sync', 'bricklink_orders', 'brickowl_orders', 'rebrickable_set_parts', 'channel_sync_brickowl', 'channel_sync_ebay'];
  const rows = await db.select().from(syncMetadata).where(and(eq(syncMetadata.orgId, orgId), inArray(syncMetadata.id, ids)));

  // Cross-check in_progress records against live in-memory state.
  const { getPomIsRunning } = await import("../services/pom-scheduler");
  const { getChannelSyncIsRunning } = await import("../services/channel-sync-scheduler");
  const { getOrderSyncIsRunning } = await import("../services/order-sync-core");
  const { getRebrickableSyncIsRunning } = await import("../services/rebrickable.js");
  const isActuallyRunning: Record<string, boolean> = {
    bricklink_inventory:    syncLock.getActive().includes('Inventory Sync'),
    priceomatic_cache:      getPomIsRunning(),
    channel_sync:           getChannelSyncIsRunning(),
    channel_sync_brickowl:  getChannelSyncIsRunning(),
    channel_sync_ebay:      getChannelSyncIsRunning(),
    bricklink_orders:       getOrderSyncIsRunning(),
    brickowl_orders:        getOrderSyncIsRunning(),
    rebrickable_set_parts:  getRebrickableSyncIsRunning(),
  };
  for (const row of rows) {
    if (row.lastSyncStatus === 'in_progress' && !isActuallyRunning[row.id]) {
      await db.update(syncMetadata)
        .set({ lastSyncStatus: 'error', errorMessage: 'Sync interrupted by server restart.', updatedAt: new Date() })
        .where(eq(syncMetadata.id, row.id));
      row.lastSyncStatus = 'error';
      row.errorMessage = 'Sync interrupted by server restart.';
      console.log(`[Statuses] Cleared stale in_progress for ${row.id}`);
    }
  }

  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  const pick = (id: string) => {
    const r = byId[id];
    if (!r) return null;
    return {
      lastSyncTime: r.lastSyncTime?.toISOString() ?? null,
      lastSyncStatus: r.lastSyncStatus,
      recordsAdded: r.recordsAdded ?? 0,
      recordsUpdated: r.recordsUpdated ?? 0,
      errorMessage: r.errorMessage ?? null,
    };
  };
  // Merge BL + BO orders: pick whichever ran more recently
  const blOrders = byId['bricklink_orders'];
  const boOrders = byId['brickowl_orders'];
  let ordersMeta = null;
  if (blOrders || boOrders) {
    const latest = (!blOrders?.lastSyncTime) ? boOrders :
                   (!boOrders?.lastSyncTime) ? blOrders :
                   (new Date(blOrders.lastSyncTime) > new Date(boOrders.lastSyncTime) ? blOrders : boOrders);
    if (latest) {
      const blAdded = blOrders?.recordsAdded ?? 0;
      const boAdded = boOrders?.recordsAdded ?? 0;
      const blUpdated = blOrders?.recordsUpdated ?? 0;
      const boUpdated = boOrders?.recordsUpdated ?? 0;
      ordersMeta = {
        lastSyncTime: latest.lastSyncTime?.toISOString() ?? null,
        lastSyncStatus: latest.lastSyncStatus,
        recordsAdded: blAdded + boAdded,
        recordsUpdated: blUpdated + boUpdated,
        errorMessage: latest.errorMessage ?? null,
      };
    }
  }
  const channelAggregate = pick('channel_sync');
  res.json({
    inventory: pick('bricklink_inventory'),
    priceomatic: pick('priceomatic_cache'),
    channel: channelAggregate,
    channels: {
      brickowl: pick('channel_sync_brickowl') ?? channelAggregate,
      ebay:     pick('channel_sync_ebay'),
    },
    orders: ordersMeta,
    bricklink_orders: pick('bricklink_orders'),
    brickowl_orders: pick('brickowl_orders'),
    rebrickable: pick('rebrickable_set_parts'),
  });
}));

router.get("/sync/recent-errors", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(syncMetadata)
    .where(
      and(
        eq(syncMetadata.orgId, orgId),
        inArray(syncMetadata.lastSyncStatus, ['error', 'failed', 'partial']),
        sql`${syncMetadata.lastSyncTime} >= ${since}`,
        sql`${syncMetadata.id} != 'priceomatic_cache'`
      )
    );

  const SYNC_LABELS: Record<string, string> = {
    bricklink_inventory: 'Inventory Sync',
    bricklink_orders:    'Order Sync (BrickLink)',
    brickowl_orders:     'Order Sync (BrickOwl)',
    priceomatic_cache:   'Price-o-Matic',
    channel_sync:        'Channel Sync',
  };

  const errors = rows.map(r => ({
    id: r.id,
    label: SYNC_LABELS[r.id] ?? r.id,
    status: r.lastSyncStatus,
    message: r.errorMessage ?? 'Unknown error',
    time: r.lastSyncTime?.toISOString() ?? null,
  }));

  res.json({ errors });
}));

router.get("/order-sync/status", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  // Get local database order stats
  const dbOrderStats = await db
    .select({
      totalOrders: sql<number>`COUNT(*)`,
      totalItems: sql<number>`SUM((SELECT COUNT(*) FROM ${orderDetails} WHERE ${orderDetails.orderId} = ${orders.id}))`,
      pendingOrders: sql<number>`COUNT(CASE WHEN ${orders.orderStatus} IN ('awaiting_payment', 'awaiting_shipment', 'pending') THEN 1 END)`,
      shippedOrders: sql<number>`COUNT(CASE WHEN ${orders.orderStatus} = 'shipped' THEN 1 END)`,
    })
    .from(orders)
    .where(eq(orders.orgId, orgId));

  const dbStats = {
    totalOrders: Number(dbOrderStats[0]?.totalOrders) || 0,
    totalItems: Number(dbOrderStats[0]?.totalItems) || 0,
    pendingOrders: Number(dbOrderStats[0]?.pendingOrders) || 0,
    shippedOrders: Number(dbOrderStats[0]?.shippedOrders) || 0,
  };

  // Get settings to check API credentials
  const { getBricklinkCredentials } = await import('../services/bricklink');
  const bricklinkEnabled = await getBricklinkCredentials(orgId).then(() => true).catch(() => false);
  const brickowlEnabled = !!(await getBrickOwlApiKey(orgId));

  // Get last sync times from sync_metadata
  const [blSyncMeta] = await db
    .select()
    .from(syncMetadata)
    .where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, 'bricklink_orders')))
    .limit(1);

  const [boSyncMeta] = await db
    .select()
    .from(syncMetadata)
    .where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, 'brickowl_orders')))
    .limit(1);

  // Get BrickLink order stats from local database
  const blLocalStats = await db
    .select({
      totalOrders: sql<number>`COUNT(*)`,
      totalItems: sql<number>`SUM((SELECT COUNT(*) FROM ${orderDetails} WHERE ${orderDetails.orderId} = ${orders.id}))`,
      pendingOrders: sql<number>`COUNT(CASE WHEN ${orders.orderStatus} IN ('awaiting_payment', 'awaiting_shipment', 'pending') THEN 1 END)`,
    })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), eq(orders.marketplace, 'BrickLink')));

  const brickLinkStats = {
    totalOrders: Number(blLocalStats[0]?.totalOrders) || 0,
    totalItems: Number(blLocalStats[0]?.totalItems) || 0,
    pendingOrders: Number(blLocalStats[0]?.pendingOrders) || 0,
    lastSyncedAt: blSyncMeta?.lastSyncTime?.toISOString() || null,
  };

  // Get BrickOwl order stats from local database
  const boLocalStats = await db
    .select({
      totalOrders: sql<number>`COUNT(*)`,
      totalItems: sql<number>`SUM((SELECT COUNT(*) FROM ${orderDetails} WHERE ${orderDetails.orderId} = ${orders.id}))`,
      pendingOrders: sql<number>`COUNT(CASE WHEN ${orders.orderStatus} IN ('awaiting_payment', 'awaiting_shipment', 'pending') THEN 1 END)`,
    })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), eq(orders.marketplace, 'BrickOwl')));

  const brickOwlStats = {
    totalOrders: Number(boLocalStats[0]?.totalOrders) || 0,
    totalItems: Number(boLocalStats[0]?.totalItems) || 0,
    pendingOrders: Number(boLocalStats[0]?.pendingOrders) || 0,
    lastSyncedAt: boSyncMeta?.lastSyncTime?.toISOString() || null,
  };

  const orderSyncStatus = {
    platforms: [
      {
        name: 'BrickLink',
        enabled: bricklinkEnabled,
        stats: brickLinkStats,
        differentials: {
          missingOrders: 0,
          statusDifferences: 0,
        },
      },
      {
        name: 'BrickOwl',
        enabled: brickowlEnabled,
        stats: brickOwlStats,
        differentials: {
          missingOrders: 0,
          statusDifferences: 0,
        },
      },
    ],
    summary: {
      totalOrders: dbStats.totalOrders,
      totalItems: dbStats.totalItems,
      pendingOrders: dbStats.pendingOrders,
      shippedOrders: dbStats.shippedOrders,
    },
  };

  res.json(orderSyncStatus);
}));

router.post("/sync/priceomatic", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  // Fast in-memory check — blocks if an incompatible sync is already running
  if (syncLock.isBlockedFor('Price-o-Matic')) {
    const blocker = syncLock.getBlockersFor('Price-o-Matic').join(', ');
    return res.status(409).json({
      success: false,
      error: `Cannot start Price-o-Matic: ${blocker} is already running. Please wait for it to complete.`,
    });
  }

  // Use pomBatchSize (manual sync setting) — never the scheduler's pomScheduleBatchSize
  // POM is a platform-level job, so always read from the platform settings row
  const pomSettings = await getOrgSettings(PLATFORM_ORG_ID);
  const maxItems = req.body.maxItems ?? pomSettings?.pomBatchSize ?? 1500;
  
  // DB-level check as secondary guard (survives server restarts)
  const [existingSync] = await db
    .select()
    .from(syncMetadata)
    .where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'priceomatic_cache')))
    .limit(1);
  
  if (existingSync?.lastSyncStatus === 'in_progress' && existingSync.lastSyncTime) {
    const timeSinceSync = Date.now() - new Date(existingSync.lastSyncTime).getTime();
    const tenMinutesInMs = 10 * 60 * 1000;
    if (timeSinceSync < tenMinutesInMs) {
      return res.status(409).json({
        success: false,
        error: 'A sync is already in progress. Please wait for it to complete.',
      });
    }
    // Stale (>10 min) — allow override
  }

  // Claim the global lock (race-condition guard — another sync may have started since the check above)
  if (!setPomIsRunning(true)) {
    const blocker = syncLock.getActive().join(', ');
    return res.status(409).json({
      success: false,
      error: `Cannot start Price-o-Matic: ${blocker} is already running.`,
    });
  }
  
  // Update sync metadata to "in_progress"
  await db
    .insert(syncMetadata)
    .values({
      id: 'priceomatic_cache',
      lastSyncStatus: 'in_progress',
      lastSyncTime: new Date(),
      recordsAdded: 0,
      recordsUpdated: 0,
      orgId: PLATFORM_ORG_ID,
    })
    .onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncStatus: 'in_progress',
        lastSyncTime: new Date(),
        updatedAt: new Date(),
      },
    });

  // Start the sync in the background (don't await)
  syncPriceOMagicCache(maxItems).then(async (result) => {
    setPomIsRunning(false);
    await db
      .insert(syncMetadata)
      .values({
        id: 'priceomatic_cache',
        lastSyncStatus: result.stopped && result.stopReason?.includes('limit') ? 'partial' : 'success',
        lastSyncTime: new Date(),
        recordsAdded: 0,
        recordsUpdated: result.itemsUpdated,
        errorMessage: result.stopReason || null,
        orgId: PLATFORM_ORG_ID,
      })
      .onConflictDoUpdate({
        target: syncMetadata.id,
        set: {
          lastSyncStatus: result.stopped && result.stopReason?.includes('limit') ? 'partial' : 'success',
          lastSyncTime: new Date(),
          recordsUpdated: result.itemsUpdated,
          errorMessage: result.stopReason || null,
          updatedAt: new Date(),
        },
      });
  }).catch(async (error) => {
    setPomIsRunning(false);
    console.error("Price-o-Matic background sync error:", error);
    await db
      .insert(syncMetadata)
      .values({
        id: 'priceomatic_cache',
        lastSyncStatus: 'failed',
        lastSyncTime: new Date(),
        recordsAdded: 0,
        recordsUpdated: 0,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        orgId: PLATFORM_ORG_ID,
      })
      .onConflictDoUpdate({
        target: syncMetadata.id,
        set: {
          lastSyncStatus: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          updatedAt: new Date(),
        },
      });
  });

  // Respond immediately that sync has started
  res.json({
    success: true,
    data: {
      message: 'Sync started in background',
      maxItems,
    },
  });
}));

router.get("/sync/priceomatic/status", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const [status] = await db
    .select()
    .from(syncMetadata)
    .where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'priceomatic_cache')))
    .limit(1);

  const { checkRateLimit, getPomSyncProgress } = await import("../services/bricklink");
  const { getPomIsRunning } = await import("../services/pom-scheduler");
  const rateLimit = await checkRateLimit(orgId);
  const liveProgress = getPomSyncProgress();

  const [pomSettings] = await db.select({
    apiCeiling: platformSettings.blApiCallLimit,
    pomApiBudgetPct: platformSettings.pomApiBudgetPct,
  }).from(platformSettings).where(eq(platformSettings.id, PLATFORM_ORG_ID)).limit(1);

  const pomBudgetedCeiling = Math.floor((pomSettings?.apiCeiling ?? 4900) * (pomSettings?.pomApiBudgetPct ?? 70) / 100);

  const [unenrichedRow] = await db.select({
    count: sql<number>`COUNT(*)`,
  }).from(blInventory)
    .leftJoin(
      priceGuideCache,
      and(
        sql`UPPER(${blInventory.itemNo}) = ${priceGuideCache.itemNo}`,
        eq(blInventory.itemType, priceGuideCache.itemType),
        sql`CASE WHEN COALESCE(${blInventory.colorId}, 0) = 0 THEN ${priceGuideCache.colorId} IN (0, -1) ELSE ${blInventory.colorId} = ${priceGuideCache.colorId} END`,
        sql`${blInventory.newOrUsed} = ${priceGuideCache.newOrUsed}`
      )
    )
    .where(and(gt(blInventory.quantity, 0), sql`${priceGuideCache.id} IS NULL`));

  let resolvedStatus = status;
  if (status?.lastSyncStatus === 'in_progress' && !getPomIsRunning()) {
    const staleFix = {
      lastSyncStatus: 'error' as const,
      errorMessage: 'Sync interrupted — server was restarted or sync was killed mid-run.',
      updatedAt: new Date(),
    };
    await db.update(syncMetadata).set(staleFix).where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'priceomatic_cache')));
    resolvedStatus = { ...status, ...staleFix };
    console.log('[POM] Cleared stale in_progress status from previous run');
  }

  res.json({
    success: true,
    data: {
      ...(resolvedStatus || {
        id: 'priceomatic_cache',
        lastSyncStatus: 'never',
        lastSyncTime: null,
        recordsUpdated: 0,
      }),
      callsLast24h: rateLimit.callsLast24h,
      apiCeiling: pomBudgetedCeiling,
      unenrichedCount: unenrichedRow?.count ?? 0,
      oldestCallTime: rateLimit.oldestCallTime ?? null,
      newestCallTime: rateLimit.newestCallTime ?? null,
      hourlyBuckets: rateLimit.hourlyBuckets ?? [],
      liveProgress,
    },
  });
}));

router.post("/sync/priceomatic/stop", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  requestPomSyncStop();
  // Mark the sync as stopped in the DB so the UI reflects it immediately
  await db
    .insert(syncMetadata)
    .values({
      id: 'priceomatic_cache',
      lastSyncStatus: 'stopped',
      lastSyncTime: new Date(),
      errorMessage: 'Sync stopped by user request.',
      orgId,
    })
    .onConflictDoUpdate({
      target: syncMetadata.id,
      set: {
        lastSyncStatus: 'stopped',
        errorMessage: 'Sync stopped by user request.',
        updatedAt: new Date(),
      },
    });
  console.log('[Price-o-Matic] Stop requested by user');
  res.json({ success: true, message: 'Stop signal sent — sync will halt before the next item.' });
}));

router.get("/sync/catalog-detail/status", isSuperAdmin, asyncRoute(async (req: any, res) => {
  const [status] = await db.select().from(syncMetadata)
    .where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'catalog_detail_completion')))
    .limit(1);
  const { getCatalogDetailProgress, getCatalogDetailIsRunning } = await import('../services/catalog-detail-scheduler.js');
  const liveProgress = getCatalogDetailProgress();
  let resolvedStatus = status;
  if (status?.lastSyncStatus === 'in_progress' && !getCatalogDetailIsRunning()) {
    const staleFix = { lastSyncStatus: 'error' as const, errorMessage: 'Sync interrupted — server restarted mid-run.', updatedAt: new Date() };
    await db.update(syncMetadata).set(staleFix).where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'catalog_detail_completion')));
    resolvedStatus = { ...status, ...staleFix };
  }
  res.json({ success: true, data: { ...(resolvedStatus || { id: 'catalog_detail_completion', lastSyncStatus: 'never', lastSyncTime: null }), liveProgress } });
}));

router.get("/sync/catalog-scan/status", isSuperAdmin, asyncRoute(async (req: any, res) => {
  const [status] = await db.select().from(syncMetadata)
    .where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'catalog_scan')))
    .limit(1);
  const { getCatalogScanProgress, getCatalogScanIsRunning } = await import('../services/catalog-scan-scheduler.js');
  const liveProgress = getCatalogScanProgress();
  let resolvedStatus = status;
  if (status?.lastSyncStatus === 'in_progress' && !getCatalogScanIsRunning()) {
    const staleFix = { lastSyncStatus: 'error' as const, errorMessage: 'Scan interrupted — server restarted mid-run.', updatedAt: new Date() };
    await db.update(syncMetadata).set(staleFix).where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'catalog_scan')));
    resolvedStatus = { ...status, ...staleFix };
  }
  res.json({ success: true, data: { ...(resolvedStatus || { id: 'catalog_scan', lastSyncStatus: 'never', lastSyncTime: null }), liveProgress } });
}));

router.delete("/sync/priceomatic/cache", isApproved, asyncRoute(async (req: any, res) => {
  const result = await db.execute(sql`DELETE FROM price_guide_cache`);
  const deleted = (result as any).rowCount ?? 0;

  // Reset sync metadata so the dashboard shows 'never'
  await db.delete(syncMetadata).where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'priceomatic_cache')));

  console.log(`[Price-o-Matic] Cache cleared: ${deleted} rows deleted`);
  res.json({ success: true, deleted });
}));

router.use(apiErrorHandler);
export default router;
