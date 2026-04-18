import { Router } from "express";
import { isApproved } from "../auth";
import { asyncRoute, reqOrgId } from "../lib/routeHelpers";
import { db } from "../db";
import { 
  brickanalyzerScans, 
  syncIssues, 
  blCatalog, 
  blColors, 
  appSettings, 
  platformSettings, 
  syncMetadata, 
  priceGuideCache, 
  partIdMappings, 
  blCatalogClipEmbeddings, 
  blInventory, 
  PLATFORM_ORG_ID,
  inventoryLocations,
  whBins,
  whShelves
} from "@shared/schema";
import { eq, and, sql, inArray, ne, gt, isNull, or, isNotNull } from "drizzle-orm";
import multer from "multer";
import { createHash } from "crypto";
import axios from "axios";
import FormData from "form-data";
import { 
  searchBricklinkCatalogItem, 
  fetchPriceOMagicData, 
  bricklinkCatalogRequest, 
  calculateSuggestedPriceWithSupply 
} from "../services/bricklink";
import { apiErrorHandler } from "../middleware/errorHandler";
import { getPlatformOpenAIKey, getPlatformSettings } from "../routes";

const router = Router();

// ── Shared geometry helpers ───────────────────────────────────────────────────

/**
 * Merge boxes that are directly stacked on top of each other — e.g. a minifig
 * head box above a torso box above a legs box. Runs iteratively until stable.
 */
function mergeStackedBoxes(
  boxes: { x: number; y: number; w: number; h: number }[],
  gapPct       = 1.2,   // max vertical gap (% of image). Neck/hip joints = ~0.2%,
                         // crowded-tray figure spacing = ~1.5–3%, so 1.2% is tight enough
                         // to bridge sub-parts without grabbing separate figures.
  horizOverlap = 0.55,  // fraction of narrower box width that must overlap in X
  maxMergedH   = 22.0,  // merged box height ceiling in %. A single minifig should be ≤20%
                         // of image height; rejecting merges above 22% prevents two figures
                         // that happen to be vertically aligned from fusing.
): { x: number; y: number; w: number; h: number }[] {
  let current = [...boxes];
  let changed  = true;

  while (changed) {
    changed = false;
    outer: for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const a = current[i], b = current[j];
        const top = a.y <= b.y ? a : b;
        const bot = a.y <= b.y ? b : a;

        // Vertical gap in % coords
        const gap = bot.y - (top.y + top.h);
        if (gap < -1.5 || gap > gapPct) continue; // -1.5 allows hairline overlaps only

        // Horizontal overlap: narrower box must overlap by ≥ horizOverlap fraction
        const overlapX = Math.min(top.x + top.w, bot.x + bot.w) - Math.max(top.x, bot.x);
        const narrowerW = Math.min(top.w, bot.w);
        if (narrowerW === 0 || overlapX / narrowerW < horizOverlap) continue;

        // Reject if the merged box would exceed the single-figure height ceiling
        const mh = (bot.y + bot.h) - top.y;
        if (mh > maxMergedH) continue;

        // Merge
        const mx  = Math.min(top.x, bot.x);
        const my  = top.y;
        const mw  = Math.max(top.x + top.w, bot.x + bot.w) - mx;
        current = current.filter((_, k) => k !== i && k !== j);
        current.push({ x: mx, y: my, w: mw, h: mh });
        changed = true;
        break outer;
      }
    }
  }
  return current;
}

// ─── Brickanalyzer: Multi-piece scan endpoints ────────────────────────────

// Module-scope Maps (moved from registerRoutes)
const brickanalyzerCropCache    = new Map<number, Buffer[]>();
const brickanalyzerImageCache   = new Map<number, Buffer>();
const brickanalyzerImageMeta    = new Map<number, { width: number; height: number }>();
const brickanalyzerProgressMap  = new Map<number, { step: string; detail: string; pct: number; startedAt: number; stepAt: number }>();

const setProgress = (id: number, step: string, detail: string, pct: number) => {
  const existing = brickanalyzerProgressMap.get(id);
  brickanalyzerProgressMap.set(id, { step, detail, pct, startedAt: existing?.startedAt ?? Date.now(), stepAt: Date.now() });
};

// ── Helpers ──

const resolvedCatalogItemName = (itemNoRef: any, itemTypeRef: any, colorIdRef: any) =>
  sql<string | null>`COALESCE(
    (SELECT item_name FROM bl_catalog WHERE item_no = ${itemNoRef} AND item_type = ${itemTypeRef} ORDER BY (color_id = ${colorIdRef})::int DESC, color_id ASC LIMIT 1),
    (SELECT item_name FROM price_guide_cache WHERE item_no = ${itemNoRef} AND item_type = ${itemTypeRef} AND item_name IS NOT NULL AND item_name != '' LIMIT 1)
  )`;

async function getOrgSettings(orgId: string) {
  const [existing] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, orgId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(appSettings)
    .values({ id: orgId, orgId, aiEnabled: true })
    .onConflictDoUpdate({ target: appSettings.id, set: { orgId, updatedAt: new Date() } })
    .returning();
  return created;
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => { const n = c / 255; return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); };
  const rl = lin(r), gl = lin(g), bl = lin(b);
  const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
  const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.1804375) / 1.00000;
  const z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const [L1, a1, b1l] = rgbToLab(r1, g1, b1);
  const [L2, a2, b2l] = rgbToLab(r2, g2, b2);
  return Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1l - b2l) ** 2);
}

async function detectDominantRgb(cropBuffer: Buffer): Promise<{ r: number; g: number; b: number } | null> {
  try {
    const { default: sharp } = await import('sharp');
    const { data: pixels, info } = await sharp(cropBuffer)
      .resize(60, 60, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const ch = info.channels as number;
    const counts = new Map<string, { rSum: number; gSum: number; bSum: number; n: number }>();

    for (let i = 0; i < pixels.length; i += ch) {
      const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
      if (r > 215 && g > 215 && b > 215) continue;
      if (r < 15  && g < 15  && b < 15)  continue;
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      const bucket = counts.get(key) ?? { rSum: 0, gSum: 0, bSum: 0, n: 0 };
      bucket.rSum += r; bucket.gSum += g; bucket.bSum += b; bucket.n++;
      counts.set(key, bucket);
    }

    if (counts.size === 0) return null;

    let best = { rSum: 0, gSum: 0, bSum: 0, n: 0 };
    for (const b of Array.from(counts.values())) { if (b.n > best.n) best = b; }
    return {
      r: Math.round(best.rSum / best.n),
      g: Math.round(best.gSum / best.n),
      b: Math.round(best.bSum / best.n),
    };
  } catch {
    return null;
  }
}

async function processBrickanalyzerScan(scanId: number, imageBuffer: Buffer, settings: Record<string, number> = {}, calibration = false, previewBoxes?: { x: number; y: number; w: number; h: number }[], orgId: string = 'org_planetbrick') {
  const { incrementActiveScan, decrementActiveScan } = await import('../services/segmentClient.js');
  incrementActiveScan();
  const blApiCallsCounter = { count: 0 };
  try {
    const { default: sharp } = await import('sharp');
    try {
      imageBuffer = await sharp(imageBuffer).rotate().toBuffer();
    } catch { /* ignore */ }

    const imgMeta = await sharp(imageBuffer).metadata();
    const imgWidth = imgMeta.width || 1000;
    const imgHeight = imgMeta.height || 1000;

    setProgress(scanId, 'Loading image', 'Decoding and resizing…', 4);

    try {
      const resized = await sharp(imageBuffer)
        .resize({ width: 1400, withoutEnlargement: true })
        .jpeg({ quality: 78 })
        .toBuffer();
      brickanalyzerImageCache.set(scanId, resized);
      brickanalyzerImageMeta.set(scanId, { width: imgWidth, height: imgHeight });
      db.update(brickanalyzerScans)
        .set({ imageData: resized })
        .where(eq(brickanalyzerScans.id, scanId))
        .catch(() => { });
    } catch { }

    if (calibration) {
      settings = {
        ...settings,
        maxSizePct: 99,
        maxDimFrac: 99,
        minSizePct: 0.5,
      };
      console.log('[Brickanalyzer] Calibration mode: using multi-pass segmentation (same as scan)');
    }

    const { segmentImage } = await import('../services/segmentClient.js');

    const iouBox = (a: any, b: any): number => {
      const ix0 = Math.max(a.x, b.x), iy0 = Math.max(a.y, b.y);
      const ix1 = Math.min(a.x + a.w, b.x + b.w), iy1 = Math.min(a.y + a.h, b.y + b.h);
      const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
      if (inter === 0) return 0;
      return inter / (a.w * a.h + b.w * b.h - inter);
    };

    let allBoxes: { x: number; y: number; w: number; h: number }[];

    if (previewBoxes && previewBoxes.length > 0) {
      console.log(`[Brickanalyzer] Using ${previewBoxes.length} user-approved preview boxes (skipping segmentation)`);
      setProgress(scanId, 'Using preview boxes', `${previewBoxes.length} region${previewBoxes.length !== 1 ? 's' : ''} from your selection`, 15);
      allBoxes = previewBoxes;
    } else if (settings.multiPass) {
      setProgress(scanId, 'Segmenting image', 'Running detection passes (large objects first)…', 6);

      // Pass 1 — LARGE objects first via BLOB detection.
      // Thresholds image into foreground/background then applies morphological CLOSING
      // with a large kernel to fill the gaps between minifig body parts (neck gap between
      // head and torso, hip gap between torso and legs) so the whole figure becomes one
      // connected blob.  Edge-based contour detection cannot do this reliably because it
      // sees the joint outlines as separate objects.  closeK=25px bridges a ~12px gap at
      // 1600px image width; closeIter=3 ensures gaps are fully filled even when the figure
      // is slightly turned or partially shadowed.
      const pass1: Record<string, any> = { segmenter: 'blob', minSizePct: 0.40, maxSizePct: 55, maxDimFrac: 90, blurRadius: 5, closeK: 11, closeIter: 2, satThresh: 40 };
      // Pass 2 — user's current settings (watershed or contour with their tuning)
      const pass2: Record<string, any> = { ...settings };
      // Pass 3 & 4 — SMALL objects: tight size ceiling so they only fire on genuine
      // small pieces (studs, 1×1 plates, etc.) not on sub-parts of larger items.
      const pass3: Record<string, any> = { segmenter: 'contour', minSizePct: 0.02, maxSizePct: 5, blurRadius: 3, cannyLow: 25, cannyHigh: 90, dilateIter: 1 };
      const pass4: Record<string, any> = { segmenter: 'contour', minSizePct: 0.02, maxSizePct: 8, blurRadius: 3, cannyLow: 20, cannyHigh: 80, dilateIter: 2, clahe: true };

      // Run pass 1 first so its large-object boxes are available for the priority NMS
      // below. Passes 2-4 run concurrently to keep total time low.
      const boxes1 = await segmentImage(imageBuffer, pass1 as any);
      const [boxes2, boxes3, boxes4] = await Promise.all([
        segmentImage(imageBuffer, pass2 as any),
        segmentImage(imageBuffer, pass3 as any),
        segmentImage(imageBuffer, pass4 as any),
      ]);

      // Merge all boxes, deduping close duplicates (IoU > 0.25)
      const merged: { x: number; y: number; w: number; h: number }[] = [];
      for (const box of [...boxes1, ...boxes2, ...boxes3, ...boxes4]) {
        if (!merged.some(m => iouBox(m, box) > 0.25)) merged.push(box);
      }

      // Priority NMS — sort largest area first, then suppress any smaller box that is
      // >60% contained within an already-accepted larger box. This directly implements
      // "once a large object is found (e.g. whole minifig), don't keep sub-part
      // detections (torso, legs) found by the fine-grained passes."
      const sortedByArea = [...merged].sort((a, b) => (b.w * b.h) - (a.w * a.h));
      const kept: typeof merged = [];
      for (const box of sortedByArea) {
        const boxArea = box.w * box.h;
        const dominated = kept.some(large => {
          const ix0 = Math.max(box.x, large.x), iy0 = Math.max(box.y, large.y);
          const ix1 = Math.min(box.x + box.w, large.x + large.w);
          const iy1 = Math.min(box.y + box.h, large.y + large.h);
          const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
          return inter / boxArea > 0.60;
        });
        if (!dominated) kept.push(box);
      }
      // Vertical-stacking merge: fuse head+torso+legs sub-boxes into whole-figure boxes
      allBoxes = mergeStackedBoxes(kept);
      console.log(`[BrickScan] multi-pass nms=${kept.length} → stacked=${allBoxes.length}`);
    } else {
      setProgress(scanId, 'Segmenting image', 'Single-pass contour detection…', 6);
      allBoxes = await segmentImage(imageBuffer, settings as any);
      if (allBoxes.length === 0) allBoxes = [{ x: 2, y: 2, w: 96, h: 96 }];
    }

    const maxPieces = settings.maxPieces ?? 50;
    const clampedBoxes = allBoxes.slice(0, maxPieces);
    const pieces: any[] = clampedBoxes.map(b => ({ ...b, colorName: '', roughName: '', confidence: 'medium', note: '' }));

    if (pieces.length === 0) {
      await db.insert(syncIssues).values({
        syncType: 'brickanalyzer_scan',
        platform: 'local',
        itemId: String(scanId),
        issueType: 'no_pieces_detected',
        issueDescription: 'Brick Spotter could not detect any LEGO pieces. Try a clearer photo with pieces spread out on a contrasting background.',
        severity: 'medium',
        status: 'open',
        metadata: JSON.stringify({ scanId }),
        orgId,
      });
    }

    const PADDING = 0.006;
    setProgress(scanId, 'Building crops', `Cropping ${pieces.length} piece region${pieces.length !== 1 ? 's' : ''} from image…`, 18);
    if (!brickanalyzerCropCache.has(scanId)) brickanalyzerCropCache.set(scanId, []);

    const cropData = await Promise.all(pieces.map(async (piece: any, idx: number) => {
      try {
        const x0 = Math.max(0, Math.round(((piece.x ?? 0) / 100 - PADDING) * imgWidth));
        const y0 = Math.max(0, Math.round(((piece.y ?? 0) / 100 - PADDING) * imgHeight));
        const x1 = Math.min(imgWidth,  Math.round((((piece.x ?? 0) + (piece.w ?? 20)) / 100 + PADDING) * imgWidth));
        const y1 = Math.min(imgHeight, Math.round((((piece.y ?? 0) + (piece.h ?? 20)) / 100 + PADDING) * imgHeight));
        const cropWidth  = x1 - x0;
        const cropHeight = y1 - y0;

        if (cropWidth < 12 || cropHeight < 12) return { cropBuffer: null, earlyResult: [{ partNo: '', partName: piece.roughName || 'Unknown', colorName: piece.colorName || '', confidence: 'low', note: 'crop region too small', cropIndex: idx, bboxX: piece.x, bboxY: piece.y, bboxW: piece.w, bboxH: piece.h }] };

        const cropBuffer = await sharp(imageBuffer)
          .extract({ left: x0, top: y0, width: cropWidth, height: cropHeight })
          .jpeg({ quality: 90 })
          .toBuffer();

        brickanalyzerCropCache.get(scanId)![idx] = cropBuffer;
        const detectedRgb = await detectDominantRgb(cropBuffer);
        if (detectedRgb) piece.detectedRgb = detectedRgb;
        return { cropBuffer };
      } catch (err: any) {
        return { cropBuffer: null, earlyResult: [{ partNo: '', partName: piece.roughName || 'Unknown', colorName: piece.colorName || '', confidence: 'low', note: 'crop error', cropIndex: idx, bboxX: piece.x, bboxY: piece.y, bboxW: piece.w, bboxH: piece.h }] };
      }
    }));

    setProgress(scanId, 'Crops ready', `${pieces.length} crops built — sending to AI…`, 19);

    const bqDedupeCache = new Map<string, any[]>();
    const identified: any[] = [];
    let lastBqCallAt = 0;
    const BQ_MIN_GAP_MS = 400;

    for (let idx = 0; idx < pieces.length; idx++) {
      const piece = pieces[idx];
      const entry = cropData[idx] as any;
      if (entry.earlyResult) { identified.push(...entry.earlyResult); continue; }
      const cropBuffer = entry.cropBuffer!;
      const cropHash = createHash('sha256').update(cropBuffer).digest('hex');

      if (bqDedupeCache.has(cropHash)) {
        identified.push(...bqDedupeCache.get(cropHash)!.map((r: any) => ({ ...r, cropIndex: idx, bboxX: piece.x, bboxY: piece.y, bboxW: piece.w, bboxH: piece.h })));
        continue;
      }

      const wait = BQ_MIN_GAP_MS - (Date.now() - lastBqCallAt);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      lastBqCallAt = Date.now();

      try {
        // Each request needs its OWN FormData instance so the boundary in the
        // Content-Type header matches the boundary actually written into the body.
        // Calling makeBqForm() a second time to get headers creates a different
        // boundary, causing a multipart mismatch that hangs the remote server.
        const makeBqForm = (buf: Buffer) => {
          const f = new FormData();
          f.append('query_image', buf, { filename: `piece_${idx}.jpg`, contentType: 'image/jpeg' });
          return f;
        };

        const bqTimeout = (ms: number) => {
          const ctrl = new AbortController();
          const id = setTimeout(() => ctrl.abort(), ms);
          return { signal: ctrl.signal, clear: () => clearTimeout(id) };
        };

        const figsForm  = makeBqForm(cropBuffer);
        const partsForm = makeBqForm(cropBuffer);
        const ft = bqTimeout(8000);
        const pt = bqTimeout(8000);
        const [figsRes, partsRes] = await Promise.all([
          axios.post('https://api.brickognize.com/predict/figs/',  figsForm,  { headers: figsForm.getHeaders(),  timeout: 8000, signal: ft.signal }).catch(() => null),
          axios.post('https://api.brickognize.com/predict/parts/', partsForm, { headers: partsForm.getHeaders(), timeout: 8000, signal: pt.signal }).catch(() => null),
        ]);
        ft.clear();
        pt.clear();

        const results: any[] = [];
        const topFig = figsRes?.data?.items?.[0];
        const topPart = partsRes?.data?.items?.[0];

        if (topFig && topFig.score > 0.3) {
          results.push({ partNo: topFig.id, partName: topFig.name, itemType: 'MINIFIG', confidence: topFig.score > 0.8 ? 'high' : 'medium' });
        } else if (topPart) {
          results.push({ partNo: topPart.id, partName: topPart.name, itemType: 'PART', confidence: topPart.score > 0.8 ? 'high' : 'medium' });
        } else {
          results.push({ partNo: '', partName: 'Unknown Part', confidence: 'low', note: 'AI could not identify' });
        }

        const pieceResults = results.map(r => ({ ...r, cropIndex: idx, bboxX: piece.x, bboxY: piece.y, bboxW: piece.w, bboxH: piece.h }));
        bqDedupeCache.set(cropHash, pieceResults);
        identified.push(...pieceResults);
      } catch (err) {
        identified.push({ partNo: '', partName: 'Unknown Part', confidence: 'low', note: 'AI service error', cropIndex: idx, bboxX: piece.x, bboxY: piece.y, bboxW: piece.w, bboxH: piece.h });
      }
    }

    const clipFallbackSet = new Set<number>();
    const filteredIdentified = identified.filter(p => p.partNo || p.note !== 'AI could not identify');
    
    // Fallback to CLIP if needed (skipped for now for simplicity, keeping sequential structure)

    setProgress(scanId, 'Enriching results', `Processing ${filteredIdentified.length} piece${filteredIdentified.length !== 1 ? 's' : ''}…`, 80);
    const localPomItemData = new Map();
    const rbImageMap = new Map();

    const enriched = await Promise.all(filteredIdentified.map(async (piece: any) => {
      try {
        let colorId: number | null = null;
        let colorRgb: string | null = null;
        let thumbnailUrl: string | null = null;
        let marketSoldMaxNew: number | null = null;
        let marketSoldMaxUsed: number | null = null;
        let marketSoldAvgNew: number | null = null;
        let marketSoldAvgUsed: number | null = null;
        let stockAvgPriceN: number | null = null;
        let stockAvgPriceU: number | null = null;
        let stockMaxPriceN: number | null = null;
        let stockMaxPriceU: number | null = null;
        let suggestedPriceNew: number | null = null;
        let suggestedPriceUsed: number | null = null;
        let ourPriceNew: number | null = null;
        let ourQtyNew = 0;
        let ourPriceUsed: number | null = null;
        let ourQtyUsed = 0;
        let inventoryId: number | null = null;
        const blItemType = piece.itemType || 'PART';

        const activeInvRows = await db.select({
          id: blInventory.id,
          newOrUsed: blInventory.newOrUsed,
          quantity: blInventory.quantity,
          unitPrice: blInventory.unitPrice,
          colorId: blInventory.colorId,
          categoryId: blCatalog.categoryId
        }).from(blInventory)
          .leftJoin(blCatalog, eq(blInventory.itemNo, blCatalog.itemNo))
          .where(and(eq(blInventory.orgId, orgId), eq(blInventory.itemNo, piece.partNo), isNull(blInventory.deletedAt), gt(blInventory.quantity, 0)));

        for (const row of activeInvRows) {
          if (row.newOrUsed === 'N') { ourQtyNew += row.quantity || 0; if (ourPriceNew === null) ourPriceNew = Number(row.unitPrice); }
          else { ourQtyUsed += row.quantity || 0; if (ourPriceUsed === null) ourPriceUsed = Number(row.unitPrice); }
          if (!inventoryId) inventoryId = row.id;
        }

        if (piece.partNo) {
          const pgDataN = await fetchPriceOMagicData(piece.partNo, blItemType, 0, 'N', undefined, undefined, false, undefined, blApiCallsCounter);
          if (pgDataN) {
            marketSoldMaxNew = pgDataN.soldMaxPrice ? Number(pgDataN.soldMaxPrice) : null;
            marketSoldAvgNew = pgDataN.soldAvgPrice ? Number(pgDataN.soldAvgPrice) : null;
            stockAvgPriceN = pgDataN.stockAvgPrice ? Number(pgDataN.stockAvgPrice) : null;
            thumbnailUrl = pgDataN.thumbnailUrl || pgDataN.imageUrl || null;
          }
          const pgDataU = await fetchPriceOMagicData(piece.partNo, blItemType, 0, 'U', undefined, undefined, false, undefined, blApiCallsCounter);
          if (pgDataU) {
            marketSoldMaxUsed = pgDataU.soldMaxPrice ? Number(pgDataU.soldMaxPrice) : null;
            marketSoldAvgUsed = pgDataU.soldAvgPrice ? Number(pgDataU.soldAvgPrice) : null;
            stockAvgPriceU = pgDataU.stockAvgPrice ? Number(pgDataU.stockAvgPrice) : null;
          }
        }

        if (stockAvgPriceN !== null || marketSoldAvgNew !== null) suggestedPriceNew = calculateSuggestedPriceWithSupply(stockAvgPriceN, marketSoldAvgNew, 0, 10, blItemType);
        if (stockAvgPriceU !== null || marketSoldAvgUsed !== null) suggestedPriceUsed = calculateSuggestedPriceWithSupply(stockAvgPriceU, marketSoldAvgUsed, 0, 10, blItemType);

        const bestPrice = ourPriceNew ?? ourPriceUsed ?? marketSoldMaxNew ?? marketSoldMaxUsed ?? stockAvgPriceN;

        return {
          ...piece,
          colorId, colorRgb, thumbnailUrl, marketSoldMaxNew, marketSoldMaxUsed, marketSoldAvgNew, marketSoldAvgUsed,
          stockAvgPriceN, stockAvgPriceU, stockMaxPriceN, stockMaxPriceU, suggestedPriceNew, suggestedPriceUsed,
          ourPriceNew, ourQtyNew, ourPriceUsed, ourQtyUsed, inventoryId, bestPrice,
          detectionSource: clipFallbackSet.has(piece.cropIndex) ? 'elfie' : 'brickognize'
        };
      } catch (err) {
        return { ...piece, detectionSource: 'error' };
      }
    }));

    const totalValue = enriched.reduce((sum, p) => sum + (p.bestPrice || 0), 0);
    await db.update(brickanalyzerScans).set({
      status: 'complete',
      totalPieces: enriched.length,
      identifiedPieces: enriched.filter(p => p.partNo).length,
      estimatedValue: totalValue.toFixed(2),
      results: enriched as any,
      completedAt: new Date(),
      blApiCalls: blApiCallsCounter.count,
    }).where(eq(brickanalyzerScans.id, scanId));

    setProgress(scanId, 'Complete', `${enriched.length} piece${enriched.length !== 1 ? 's' : ''} identified · $${totalValue.toFixed(2)} est. value`, 100);
    setTimeout(() => brickanalyzerProgressMap.delete(scanId), 8000);
  } catch (err: any) {
    setProgress(scanId, 'Error', err.message, 0);
    await db.update(brickanalyzerScans).set({ status: 'failed', errorMessage: err.message, completedAt: new Date() }).where(eq(brickanalyzerScans.id, scanId));
  } finally {
    decrementActiveScan();
  }
}

// ── Routes ──

const brickanalyzerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post("/brickanalyzer/segment", brickanalyzerUpload.single('image'), isApproved, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image provided" });
    const { default: sharp } = await import('sharp');
    let fileBuffer = req.file.buffer;
    try { fileBuffer = await sharp(fileBuffer).rotate().toBuffer(); } catch { }
    const imgMeta = await sharp(fileBuffer).metadata();
    const imgWidth = imgMeta.width || 1000;
    const imgHeight = imgMeta.height || 1000;
    let settings: Record<string, any> = {};
    if (req.body?.settings) { try { settings = JSON.parse(req.body.settings); } catch { } }

    const { segmentImage, segmentImageWithCandidates } = await import('../services/segmentClient.js');

    // Shared IoU helper
    const iouBox = (a: any, b: any): number => {
      const ix0 = Math.max(a.x, b.x), iy0 = Math.max(a.y, b.y);
      const ix1 = Math.min(a.x + a.w, b.x + b.w), iy1 = Math.min(a.y + a.h, b.y + b.h);
      const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
      if (inter === 0) return 0;
      return inter / (a.w * a.h + b.w * b.h - inter);
    };

    // Run blob pass (large whole-objects) and the normal contour pass concurrently
    const blobPass: Record<string, any> = { segmenter: 'blob', minSizePct: 0.40, maxSizePct: 55, maxDimFrac: 90, blurRadius: 5, closeK: 11, closeIter: 2, satThresh: 40 };
    const [blobBoxes, contourResult] = await Promise.all([
      segmentImage(fileBuffer, blobPass as any),
      segmentImageWithCandidates(fileBuffer, settings as any),
    ]);

    // Merge blob + contour boxes, deduping with IoU > 0.25
    const merged: { x: number; y: number; w: number; h: number }[] = [];
    for (const box of [...blobBoxes, ...contourResult.boxes]) {
      if (!merged.some(m => iouBox(m, box) > 0.25)) merged.push(box);
    }

    // Priority NMS: largest-first, suppress smaller boxes that are >60% inside a larger kept box
    const sortedByArea = [...merged].sort((a, b) => (b.w * b.h) - (a.w * a.h));
    const kept: typeof merged = [];
    for (const box of sortedByArea) {
      const boxArea = box.w * box.h;
      const dominated = kept.some(large => {
        const ix0 = Math.max(box.x, large.x), iy0 = Math.max(box.y, large.y);
        const ix1 = Math.min(box.x + box.w, large.x + large.w);
        const iy1 = Math.min(box.y + box.h, large.y + large.h);
        const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
        return inter / boxArea > 0.60;
      });
      if (!dominated) kept.push(box);
    }

    // Vertical-stacking merge: combine head+torso+legs sub-boxes into whole-figure boxes
    const stacked = mergeStackedBoxes(kept);

    // Strip candidates that overlap any final box
    const finalCandidates = contourResult.candidates.filter(
      (c: any) => !stacked.some(k => iouBox(c, k) > 0.10)
    );

    console.log(`[Brickanalyzer] Preview segment: blob=${blobBoxes.length} contour=${contourResult.boxes.length} merged=${merged.length} nms=${kept.length} stacked=${stacked.length}`);

    res.json({
      boxes: stacked,
      candidates: finalCandidates,
      imgWidth,
      imgHeight,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── POST /api/brickanalyzer/detect-at-point ───────────────────────────────────
// Accepts: multipart with optional 'image', tapX, tapY (all in % 0-100),
// and optional cropX/Y/W/H hint. Returns { box: {x,y,w,h} | null }.
router.post("/brickanalyzer/detect-at-point", brickanalyzerUpload.single('image'), isApproved, async (req, res) => {
  try {
    const tapX = parseFloat(req.body?.tapX ?? '50');
    const tapY = parseFloat(req.body?.tapY ?? '50');

    const { default: sharp } = await import('sharp');

    let imageBuffer: Buffer | undefined;
    if (req.file) {
      try { imageBuffer = await sharp(req.file.buffer).rotate().toBuffer(); } catch { imageBuffer = req.file.buffer; }
    }
    if (!imageBuffer) {
      const latestScanId = [...brickanalyzerImageCache.keys()].sort((a, b) => b - a)[0];
      if (latestScanId !== undefined) imageBuffer = brickanalyzerImageCache.get(latestScanId);
    }
    if (!imageBuffer) return res.json({ box: null });

    const imgMeta = await sharp(imageBuffer).metadata();
    const imgWidth = imgMeta.width ?? 1000;
    const imgHeight = imgMeta.height ?? 1000;

    const cropX = parseFloat(req.body?.cropX ?? 'NaN');
    const cropY = parseFloat(req.body?.cropY ?? 'NaN');
    const cropW = parseFloat(req.body?.cropW ?? 'NaN');
    const cropH = parseFloat(req.body?.cropH ?? 'NaN');

    let regionBuffer = imageBuffer;
    let regionOffsetX = 0, regionOffsetY = 0;
    let regionW = 100, regionH = 100;

    if (!isNaN(cropX) && !isNaN(cropY) && !isNaN(cropW) && !isNaN(cropH)) {
      const px = Math.max(0, Math.round((cropX / 100) * imgWidth));
      const py = Math.max(0, Math.round((cropY / 100) * imgHeight));
      const pw = Math.min(imgWidth - px, Math.round((cropW / 100) * imgWidth));
      const ph = Math.min(imgHeight - py, Math.round((cropH / 100) * imgHeight));
      regionBuffer = await sharp(imageBuffer).extract({ left: px, top: py, width: pw, height: ph }).toBuffer();
      regionOffsetX = cropX; regionOffsetY = cropY;
      regionW = cropW; regionH = cropH;
    } else {
      const windowW = 50, windowH = 50;
      const wx = Math.max(0, Math.min(tapX - windowW / 2, 100 - windowW));
      const wy = Math.max(0, Math.min(tapY - windowH / 2, 100 - windowH));
      const px = Math.round((wx / 100) * imgWidth);
      const py = Math.round((wy / 100) * imgHeight);
      const pw = Math.round((windowW / 100) * imgWidth);
      const ph = Math.round((windowH / 100) * imgHeight);
      regionBuffer = await sharp(imageBuffer).extract({ left: px, top: py, width: pw, height: ph }).toBuffer();
      regionOffsetX = wx; regionOffsetY = wy;
      regionW = windowW; regionH = windowH;
    }

    const { segmentImageWithCandidates } = await import('../services/segmentClient.js');
    const result = await segmentImageWithCandidates(regionBuffer, {});

    const tapInRegionX = ((tapX - regionOffsetX) / regionW) * 100;
    const tapInRegionY = ((tapY - regionOffsetY) / regionH) * 100;

    const toFullImg = (box: { x: number; y: number; w: number; h: number }) => ({
      x: regionOffsetX + (box.x / 100) * regionW,
      y: regionOffsetY + (box.y / 100) * regionH,
      w: (box.w / 100) * regionW,
      h: (box.h / 100) * regionH,
    });

    const boxes: { x: number; y: number; w: number; h: number }[] = result.boxes ?? [];
    let bestBox: { x: number; y: number; w: number; h: number } | null = null;

    for (const box of boxes) {
      if (tapInRegionX >= box.x && tapInRegionX <= box.x + box.w &&
          tapInRegionY >= box.y && tapInRegionY <= box.y + box.h) {
        bestBox = toFullImg(box);
        break;
      }
    }

    if (!bestBox && boxes.length > 0) {
      let nearestDist = Infinity;
      for (const box of boxes) {
        const cx = box.x + box.w / 2;
        const cy = box.y + box.h / 2;
        const d = Math.hypot(tapInRegionX - cx, tapInRegionY - cy);
        if (d < nearestDist) { nearestDist = d; bestBox = toFullImg(box); }
      }
    }

    res.json({ box: bestBox });
  } catch { res.json({ box: null }); }
});

router.post("/brickanalyzer/scan", brickanalyzerUpload.single('image'), isApproved, async (req, res) => {
  try {
    const orgId = reqOrgId(req);
    if (!req.file) return res.status(400).json({ error: "No image provided" });
    let settings: Record<string, any> = {};
    if (req.body?.settings) { try { settings = JSON.parse(req.body.settings); } catch { } }
    const calibration = req.body?.calibration === 'true';
    let previewBoxes: { x: number; y: number; w: number; h: number }[] | undefined;
    if (req.body?.previewBoxes) { try { previewBoxes = JSON.parse(req.body.previewBoxes); } catch { } }

    const [scan] = await db.insert(brickanalyzerScans).values({ orgId, status: 'pending' }).returning();
    processBrickanalyzerScan(scan.id, req.file.buffer, settings, calibration, previewBoxes, orgId);
    res.json({ ...scan, scanId: scan.id });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── GET /api/brickanalyzer/scans  — history (all non-dismissed) ──────────────
router.get("/brickanalyzer/scans", isApproved, async (req, res) => {
  const orgId = reqOrgId(req);
  const rows = await db.select()
    .from(brickanalyzerScans)
    .where(and(eq(brickanalyzerScans.orgId, orgId), ne(brickanalyzerScans.status, 'dismissed')))
    .orderBy(sql`${brickanalyzerScans.createdAt} DESC`)
    .limit(50);
  res.json(rows);
});

// ── GET /api/brickanalyzer/scans/latest ──────────────────────────────────────
router.get("/brickanalyzer/scans/latest", isApproved, async (req, res) => {
  const orgId = reqOrgId(req);
  const [latest] = await db.select()
    .from(brickanalyzerScans)
    .where(and(eq(brickanalyzerScans.orgId, orgId), ne(brickanalyzerScans.status, 'dismissed')))
    .orderBy(sql`${brickanalyzerScans.createdAt} DESC`)
    .limit(1);
  if (!latest) return res.status(404).json({ error: "No scans found" });
  res.json(latest);
});

// ── GET /api/brickanalyzer/scan/:id — fetch a single scan ────────────────────
router.get("/brickanalyzer/scan/:id", isApproved, async (req, res) => {
  const scanId = parseInt(req.params.id);
  const [scan] = await db.select().from(brickanalyzerScans).where(eq(brickanalyzerScans.id, scanId)).limit(1);
  if (!scan) return res.status(404).json({ error: "Scan not found" });
  res.json(scan);
});

// ── GET /api/brickanalyzer/scan/:id/progress ─────────────────────────────────
router.get("/brickanalyzer/scan/:id/progress", isApproved, async (req, res) => {
  const scanId = parseInt(req.params.id);
  const progress = brickanalyzerProgressMap.get(scanId);
  const [scan] = await db.select().from(brickanalyzerScans).where(eq(brickanalyzerScans.id, scanId)).limit(1);
  if (!scan) return res.status(404).json({ error: "Scan not found" });
  const isActive = scan.status === 'pending' || scan.status === 'processing';
  const isComplete = scan.status === 'complete';
  res.json({
    status: scan.status,
    step: progress?.step ?? (isComplete ? 'Complete' : 'Starting…'),
    detail: progress?.detail ?? '',
    pct: progress?.pct ?? (isComplete ? 100 : 0),
    stepAt: progress?.stepAt ?? null,
    startedAt: progress?.startedAt ?? (scan.createdAt ? new Date(scan.createdAt).getTime() : null),
    now: Date.now(),
    active: isActive,
    scan,
  });
});

// ── DELETE /api/brickanalyzer/scan/:id — dismiss ─────────────────────────────
router.delete("/brickanalyzer/scan/:id", isApproved, async (req, res) => {
  const scanId = parseInt(req.params.id);
  await db.update(brickanalyzerScans).set({ status: 'dismissed' }).where(eq(brickanalyzerScans.id, scanId));
  brickanalyzerCropCache.delete(scanId);
  brickanalyzerImageCache.delete(scanId);
  brickanalyzerImageMeta.delete(scanId);
  brickanalyzerProgressMap.delete(scanId);
  res.json({ ok: true });
});

// ── POST /api/brickanalyzer/scan/:id/retry ───────────────────────────────────
router.post("/brickanalyzer/scan/:id/retry", isApproved, async (req, res) => {
  const scanId = parseInt(req.params.id);
  const [scan] = await db.select().from(brickanalyzerScans).where(eq(brickanalyzerScans.id, scanId)).limit(1);
  if (!scan) return res.status(404).json({ error: "Scan not found" });
  const cachedImage = brickanalyzerImageCache.get(scanId);
  if (!cachedImage) {
    // Image no longer in memory — check DB
    const [withImg] = await db.select({ imageData: brickanalyzerScans.imageData }).from(brickanalyzerScans).where(eq(brickanalyzerScans.id, scanId)).limit(1);
    if (!withImg?.imageData) return res.status(410).json({ error: "Image no longer available — please re-upload" });
    await db.update(brickanalyzerScans).set({ status: 'pending', errorMessage: null, completedAt: null }).where(eq(brickanalyzerScans.id, scanId));
    const previewBoxes = (scan.results as any[])?.length ? undefined : undefined;
    processBrickanalyzerScan(scanId, withImg.imageData as Buffer, {}, false, undefined, scan.orgId || 'org_planetbrick');
    return res.json({ ok: true, scanId });
  }
  await db.update(brickanalyzerScans).set({ status: 'pending', errorMessage: null, completedAt: null }).where(eq(brickanalyzerScans.id, scanId));
  processBrickanalyzerScan(scanId, cachedImage, {}, false, undefined, scan.orgId || 'org_planetbrick');
  res.json({ ok: true, scanId });
});

// ── GET /api/brickanalyzer/scan/:scanId/image ─────────────────────────────────
router.get("/brickanalyzer/scan/:scanId/image", isApproved, async (req, res) => {
  const scanId = parseInt(req.params.scanId);
  const cached = brickanalyzerImageCache.get(scanId);
  if (cached) { res.setHeader('Content-Type', 'image/jpeg'); return res.send(cached); }
  const [scan] = await db.select({ imageData: brickanalyzerScans.imageData }).from(brickanalyzerScans).where(eq(brickanalyzerScans.id, scanId)).limit(1);
  if (!scan?.imageData) return res.status(404).json({ error: "Image not found" });
  res.setHeader('Content-Type', 'image/jpeg');
  res.send(scan.imageData);
});

// ── GET /api/brickanalyzer/scan/:scanId/crop/:cropIndex ───────────────────────
router.get("/brickanalyzer/scan/:scanId/crop/:cropIndex", isApproved, async (req, res) => {
  const scanId = parseInt(req.params.scanId);
  const cropIdx = parseInt(req.params.cropIndex);
  const crops = brickanalyzerCropCache.get(scanId);
  if (!crops || !crops[cropIdx]) {
    const [scan] = await db.select({ results: brickanalyzerScans.results }).from(brickanalyzerScans).where(eq(brickanalyzerScans.id, scanId)).limit(1);
    if (!scan?.results) return res.status(404).json({ error: "Crop not in memory and no scan results" });
    const piece = (scan.results as any[]).find(p => p.cropIndex === cropIdx);
    if (!piece || piece.bboxX == null) return res.status(404).json({ error: "Crop not found" });
    return res.status(404).json({ error: "Crop expired from memory" });
  }
  res.setHeader('Content-Type', 'image/jpeg');
  res.send(crops[cropIdx]);
});

// ── Keep old aliases for backward compatibility ───────────────────────────────
router.get("/brickanalyzer/status/:id", isApproved, async (req, res) => {
  const scanId = parseInt(req.params.id);
  const progress = brickanalyzerProgressMap.get(scanId);
  const [scan] = await db.select().from(brickanalyzerScans).where(eq(brickanalyzerScans.id, scanId)).limit(1);
  if (!scan) return res.status(404).json({ error: "Scan not found" });
  res.json({ status: scan.status, progress: progress || (scan.status === 'complete' ? { pct: 100, step: 'Complete' } : null), scan });
});
router.get("/brickanalyzer/latest", isApproved, async (req, res) => {
  const orgId = reqOrgId(req);
  const [latest] = await db.select().from(brickanalyzerScans).where(and(eq(brickanalyzerScans.orgId, orgId), ne(brickanalyzerScans.status, 'dismissed'))).orderBy(sql`${brickanalyzerScans.createdAt} DESC`).limit(1);
  res.json(latest || null);
});
router.post("/brickanalyzer/dismiss/:id", isApproved, async (req, res) => {
  const scanId = parseInt(req.params.id);
  await db.update(brickanalyzerScans).set({ status: 'dismissed' }).where(eq(brickanalyzerScans.id, scanId));
  brickanalyzerCropCache.delete(scanId); brickanalyzerImageCache.delete(scanId); brickanalyzerImageMeta.delete(scanId); brickanalyzerProgressMap.delete(scanId);
  res.json({ ok: true });
});
router.get("/brickanalyzer/image/:scanId", isApproved, async (req, res) => {
  const scanId = parseInt(req.params.scanId);
  const cached = brickanalyzerImageCache.get(scanId);
  if (cached) { res.setHeader('Content-Type', 'image/jpeg'); return res.send(cached); }
  const [scan] = await db.select({ imageData: brickanalyzerScans.imageData }).from(brickanalyzerScans).where(eq(brickanalyzerScans.id, scanId)).limit(1);
  if (!scan?.imageData) return res.status(404).json({ error: "Image not found" });
  res.setHeader('Content-Type', 'image/jpeg'); res.send(scan.imageData);
});
router.get("/brickanalyzer/crop/:scanId/:cropIndex", isApproved, async (req, res) => {
  const scanId = parseInt(req.params.scanId); const cropIdx = parseInt(req.params.cropIndex);
  const crops = brickanalyzerCropCache.get(scanId);
  if (!crops || !crops[cropIdx]) return res.status(404).json({ error: "Crop expired from memory" });
  res.setHeader('Content-Type', 'image/jpeg'); res.send(crops[cropIdx]);
});

router.get("/brickspotter/python-status", isApproved, async (_req, res) => {
  const { isPythonServiceReady } = await import('../services/segmentClient.js');
  res.json({ ready: isPythonServiceReady() });
});

router.get("/brickspotter/history", isApproved, async (req, res) => {
  const orgId = reqOrgId(req);
  const rows = await db.select()
    .from(brickanalyzerScans)
    .where(and(eq(brickanalyzerScans.orgId, orgId), eq(brickanalyzerScans.status, 'complete')))
    .orderBy(sql`${brickanalyzerScans.createdAt} DESC`)
    .limit(50);
  res.json(rows);
});

router.get("/brickspotter/universal-catalog/status", isApproved, async (req, res) => {
  try {
    const orgId = PLATFORM_ORG_ID;
    const [meta] = await db.select().from(syncMetadata).where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, 'universal_clip_catalog'))).limit(1);
    const [counts] = await db.select({
      total: sql<number>`COUNT(*)`,
    }).from(blCatalogClipEmbeddings);

    const { getUniversalCatalogState } = await import('../services/universal-clip-catalog.js');
    const workerState: any = getUniversalCatalogState() || { running: false, lastPulse: null, currentItem: null };
    const base = {
      totalItems: Number(counts?.total ?? 0),
      workerRunning: workerState.running,
      workerLastPulse: workerState.lastPulse ?? null,
      workerCurrentItem: workerState.currentItem ?? null,
    };

    const platSettings = await getPlatformSettings();
    const months = (platSettings as any)?.universalCatalogRefreshMonths ?? 6;
    const lastRunMs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : null;
    const nextRunMs = lastRunMs ? lastRunMs + months * 30 * 24 * 60 * 60 * 1000 : null;

    res.json({
      ...base,
      scheduleEnabled: (platSettings as any)?.universalCatalogScheduleEnabled ?? false,
      refreshMonths: months,
      retryDays: (platSettings as any)?.universalCatalogRetryDays ?? 30,
      lastScheduledRun: lastRunMs,
      nextScheduledRun: nextRunMs,
      lastScheduleStatus: meta?.lastSyncStatus ?? null,
    });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/brickspotter/universal-catalog/import", isApproved, async (_req, res) => {
  try {
    const { importFromRebrickable, isUniversalImporting } = await import('../services/universal-clip-catalog.js');
    if (isUniversalImporting()) return res.status(409).json({ error: 'Import already in progress' });
    res.json({ ok: true, message: 'Import started in background' });
    importFromRebrickable().catch(e => console.error('[Universal Catalog] Import failed:', e.message));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/brickspotter/universal-catalog/start", isApproved, async (_req, res) => {
  try {
    const { startUniversalWorker, getUniversalCatalogState } = await import('../services/universal-clip-catalog.js');
    if (getUniversalCatalogState()?.running) return res.status(409).json({ error: 'Worker already running' });
    res.json({ ok: true });
    startUniversalWorker().catch(e => console.error('[Universal Catalog] Start failed:', e.message));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/brickspotter/universal-catalog/stop", isApproved, async (_req, res) => {
  try {
    const { stopUniversalWorker } = await import('../services/universal-clip-catalog.js');
    stopUniversalWorker();
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.post("/brickspotter/universal-catalog/retry", isApproved, async (req, res) => {
  try {
    const { retryStaleItems } = await import('../services/universal-clip-catalog.js');
    const olderThanDays = Number(req.body?.olderThanDays ?? 30);
    const count = await retryStaleItems(olderThanDays);
    res.json({ ok: true, reset: count });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

router.use(apiErrorHandler);

export default router;
