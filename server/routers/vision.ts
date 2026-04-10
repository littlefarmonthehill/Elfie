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
      setProgress(scanId, 'Segmenting image', 'Running 4 concurrent detection passes…', 6);
      const pass1: Record<string, any> = { segmenter: 'contour', minSizePct: 0.40, maxSizePct: 55, maxDimFrac: 90, blurRadius: 5, cannyLow: 40, cannyHigh: 130, dilateIter: 4 };
      const pass2: Record<string, any> = { ...settings };
      const pass3: Record<string, any> = { segmenter: 'contour', minSizePct: 0.02, maxSizePct: 5, blurRadius: 3, cannyLow: 25, cannyHigh: 90, dilateIter: 1 };
      const pass4: Record<string, any> = { segmenter: 'contour', minSizePct: 0.02, maxSizePct: 8, blurRadius: 3, cannyLow: 20, cannyHigh: 80, dilateIter: 2, clahe: true };

      const [boxes1, boxes2, boxes3, boxes4] = await Promise.all([
        segmentImage(imageBuffer, pass1 as any),
        segmentImage(imageBuffer, pass2 as any),
        segmentImage(imageBuffer, pass3 as any),
        segmentImage(imageBuffer, pass4 as any),
      ]);

      const merged: { x: number; y: number; w: number; h: number }[] = [];
      for (const box of [...boxes1, ...boxes2, ...boxes3, ...boxes4]) {
        if (!merged.some(m => iouBox(m, box) > 0.25)) merged.push(box);
      }

      const containmentFiltered = merged.filter((box) => {
        const boxArea = box.w * box.h;
        return !merged.some((other) => {
          if (other === box) return false;
          const otherArea = other.w * other.h;
          if (otherArea <= boxArea * 1.5) return false;
          const ix0 = Math.max(box.x, other.x), iy0 = Math.max(box.y, other.y);
          const ix1 = Math.min(box.x + box.w, other.x + other.w), iy1 = Math.min(box.y + box.h, other.y + other.h);
          const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
          return inter / boxArea > 0.85;
        });
      });
      allBoxes = containmentFiltered;
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
        const makeBqForm = (buf: Buffer) => {
          const f = new FormData();
          f.append('query_image', buf, { filename: `piece_${idx}.jpg`, contentType: 'image/jpeg' });
          return f;
        };

        const [figsRes, partsRes] = await Promise.all([
          axios.post('https://api.brickognize.com/predict/figs/', makeBqForm(cropBuffer), { headers: makeBqForm(cropBuffer).getHeaders(), timeout: 8000 }).catch(() => null),
          axios.post('https://api.brickognize.com/predict/parts/', makeBqForm(cropBuffer), { headers: makeBqForm(cropBuffer).getHeaders(), timeout: 8000 }).catch(() => null),
        ]);

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

router.post("/brickanalyzer/segment", brickanalyzerUpload.single('image'), isApproved, asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image provided" });
  const { default: sharp } = await import('sharp');
  let fileBuffer = req.file.buffer;
  try { fileBuffer = await sharp(fileBuffer).rotate().toBuffer(); } catch { }
  const imgMeta = await sharp(fileBuffer).metadata();
  const imgWidth = imgMeta.width || 1000;
  const imgHeight = imgMeta.height || 1000;
  let settings: Record<string, any> = {};
  if (req.body?.settings) { try { settings = JSON.parse(req.body.settings); } catch { } }

  const { segmentImageWithCandidates } = await import('../services/segmentClient.js');
  const result = await segmentImageWithCandidates(fileBuffer, settings as any);

  res.json({
    boxes: result.boxes,
    candidates: result.candidates,
    imgWidth,
    imgHeight,
  });
}));

router.post("/brickanalyzer/detect-at-point", brickanalyzerUpload.single('image'), isApproved, asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image provided" });
  let settings: Record<string, any> = {};
  if (req.body?.settings) { try { settings = JSON.parse(req.body.settings); } catch { } }
  const x = parseFloat(req.body?.x);
  const y = parseFloat(req.body?.y);

  if (isNaN(x) || isNaN(y)) return res.status(400).json({ error: "Invalid coordinates" });

  const { detectPieceAtPoint } = await import('../services/segmentClient.js');
  const result = await detectPieceAtPoint(req.file.buffer, x, y, settings as any);
  res.json(result);
}));

router.post("/brickanalyzer/scan", brickanalyzerUpload.single('image'), isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  if (!req.file) return res.status(400).json({ error: "No image provided" });
  let settings: Record<string, any> = {};
  if (req.body?.settings) { try { settings = JSON.parse(req.body.settings); } catch { } }
  const calibration = req.body?.calibration === 'true';
  let previewBoxes: { x: number; y: number; w: number; h: number }[] | undefined;
  if (req.body?.previewBoxes) { try { previewBoxes = JSON.parse(req.body.previewBoxes); } catch { } }

  const [scan] = await db.insert(brickanalyzerScans).values({ orgId, status: 'pending' }).returning();
  processBrickanalyzerScan(scan.id, req.file.buffer, settings, calibration, previewBoxes, orgId);
  res.json(scan);
}));

router.get("/brickanalyzer/scans", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const rows = await db.select().from(brickanalyzerScans)
    .where(and(eq(brickanalyzerScans.orgId, orgId), ne(brickanalyzerScans.status, 'dismissed')))
    .orderBy(desc(brickanalyzerScans.createdAt))
    .limit(50);
  res.json(rows);
}));

router.get("/brickanalyzer/scans/latest", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const [latest] = await db.select()
    .from(brickanalyzerScans)
    .where(and(eq(brickanalyzerScans.orgId, orgId), ne(brickanalyzerScans.status, 'dismissed')))
    .orderBy(desc(brickanalyzerScans.createdAt))
    .limit(1);
  res.json(latest || null);
}));

router.get("/brickanalyzer/scan/:id/progress", isApproved, asyncRoute(async (req, res) => {
  const scanId = parseInt(req.params.id);
  const progress = brickanalyzerProgressMap.get(scanId);
  res.json(progress || null);
}));

router.get("/brickanalyzer/scan/:id", isApproved, asyncRoute(async (req, res) => {
  const scanId = parseInt(req.params.id);
  const [scan] = await db.select().from(brickanalyzerScans).where(eq(brickanalyzerScans.id, scanId)).limit(1);
  if (!scan) return res.status(404).json({ error: "Scan not found" });
  res.json(scan);
}));

router.get("/brickanalyzer/scan/:id/image", isApproved, asyncRoute(async (req, res) => {
  const scanId = parseInt(req.params.id);
  const cached = brickanalyzerImageCache.get(scanId);
  if (cached) {
    res.setHeader('Content-Type', 'image/jpeg');
    return res.send(cached);
  }
  const [scan] = await db.select({ imageData: brickanalyzerScans.imageData }).from(brickanalyzerScans).where(eq(brickanalyzerScans.id, scanId)).limit(1);
  if (!scan?.imageData) return res.status(404).json({ error: "Image not found" });
  res.setHeader('Content-Type', 'image/jpeg');
  res.send(scan.imageData);
}));

router.get("/brickanalyzer/scan/:id/crop/:index", isApproved, asyncRoute(async (req, res) => {
  const scanId = parseInt(req.params.id);
  const cropIdx = parseInt(req.params.index);
  const crops = brickanalyzerCropCache.get(scanId);
  if (!crops || !crops[cropIdx]) return res.status(404).json({ error: "Crop not found" });
  res.setHeader('Content-Type', 'image/jpeg');
  res.send(crops[cropIdx]);
}));

router.delete("/brickanalyzer/scan/:id", isApproved, asyncRoute(async (req, res) => {
  const scanId = parseInt(req.params.id);
  await db.update(brickanalyzerScans).set({ status: 'dismissed' }).where(eq(brickanalyzerScans.id, scanId));
  brickanalyzerCropCache.delete(scanId);
  brickanalyzerImageCache.delete(scanId);
  brickanalyzerImageMeta.delete(scanId);
  brickanalyzerProgressMap.delete(scanId);
  res.json({ ok: true });
}));

router.post("/brickanalyzer/scan/:id/retry", isApproved, asyncRoute(async (req, res) => {
  const scanId = parseInt(req.params.id);
  const orgId = reqOrgId(req);
  const [scan] = await db.select().from(brickanalyzerScans).where(eq(brickanalyzerScans.id, scanId)).limit(1);
  if (!scan) return res.status(404).json({ error: "Scan not found" });
  if (!scan.imageData) return res.status(400).json({ error: "No image data to retry" });
  
  await db.update(brickanalyzerScans).set({ status: 'pending', errorMessage: null, results: null }).where(eq(brickanalyzerScans.id, scanId));
  processBrickanalyzerScan(scanId, scan.imageData as Buffer, {}, false, undefined, orgId);
  res.json({ ok: true });
}));

router.get("/brickspotter/python-status", isApproved, asyncRoute(async (_req, res) => {
  try {
    const { getSegmenterStatus } = await import('../services/segmentClient.js');
    const status = await getSegmenterStatus();
    res.json(status);
  } catch (err: any) {
    res.json({ running: false, error: err.message });
  }
}));

router.get("/brickspotter/catalog-status", isApproved, asyncRoute(async (_req, res) => {
  const [counts] = await db.select({
    total: sql<number>`COUNT(*)`,
    embedded: sql<number>`COUNT(embedding)`,
  }).from(blCatalogClipEmbeddings);
  res.json({
    total: Number(counts?.total ?? 0),
    embedded: Number(counts?.embedded ?? 0),
    ready: Number(counts?.total ?? 0) > 0 && Number(counts?.total) === Number(counts?.embedded)
  });
}));

router.post("/brickspotter/confirm-embedding", isApproved, asyncRoute(async (req, res) => {
  const { scanId, cropIndex, itemNo, itemType, colorId } = req.body;
  if (!scanId || cropIndex === undefined || !itemNo) return res.status(400).json({ error: "Missing required fields" });
  
  const crops = brickanalyzerCropCache.get(Number(scanId));
  const cropBuffer = crops ? crops[Number(cropIndex)] : null;
  if (!cropBuffer) return res.status(404).json({ error: "Crop buffer not found in memory" });

  const { generateEmbedding } = await import('../services/embeddings');
  const embedding = await generateEmbedding(cropBuffer);
  
  await db.insert(blCatalogClipEmbeddings).values({
    itemNo,
    itemType: itemType || 'PART',
    colorId: colorId || 0,
    embedding: sql`vector(${JSON.stringify(embedding)})`,
  }).onConflictDoUpdate({
    target: [blCatalogClipEmbeddings.itemNo, blCatalogClipEmbeddings.itemType, blCatalogClipEmbeddings.colorId],
    set: { embedding: sql`vector(${JSON.stringify(embedding)})`, updatedAt: new Date() }
  });

  res.json({ ok: true });
}));

router.post("/brickspotter/build-catalog", isApproved, asyncRoute(async (req, res) => {
  const { force } = req.body;
  const { startCatalogIndexing } = await import('../services/brickspotter');
  startCatalogIndexing(!!force);
  res.json({ ok: true, message: "Catalog indexing started" });
}));

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
