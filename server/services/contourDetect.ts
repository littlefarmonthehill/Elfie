import sharp from 'sharp';

export interface DetectedBox {
  x: number; // % of image width  (0-100)
  y: number; // % of image height (0-100)
  w: number; // % of image width
  h: number; // % of image height
}

/**
 * Detects individual LEGO piece bounding boxes from a photo using classical
 * image processing (no external API):
 *   1. Downsample → grayscale → blur → adaptive threshold
 *   2. Two-pass connected-components labeling
 *   3. Filter by area, merge overlapping blobs
 *   4. Return bounding boxes as percentages of original image dimensions
 */
export async function detectPieceBoundingBoxes(imageBuffer: Buffer): Promise<DetectedBox[]> {
  const WORK_WIDTH = 640;

  const { data, info } = await sharp(imageBuffer)
    .resize(WORK_WIDTH, undefined, { fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .blur(2.5)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;
  const pixels = new Uint8Array(data.buffer);

  // ── Estimate background brightness from image corners ───────────────────
  const sampleRegion = (cx: number, cy: number, r: number): number => {
    let sum = 0, count = 0;
    for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++) {
      for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++) {
        sum += pixels[y * W + x];
        count++;
      }
    }
    return count > 0 ? sum / count : 128;
  };

  const bgBrightness = (
    sampleRegion(15, 15, 12) +
    sampleRegion(W - 15, 15, 12) +
    sampleRegion(15, H - 15, 12) +
    sampleRegion(W - 15, H - 15, 12)
  ) / 4;

  // ── Build binary mask: 1 = piece pixel, 0 = background ─────────────────
  const MARGIN = 45;
  const mask = new Uint8Array(W * H);

  if (bgBrightness > 155) {
    // Light background — pieces are darker
    const thresh = Math.max(60, bgBrightness - MARGIN);
    for (let i = 0; i < W * H; i++) mask[i] = pixels[i] < thresh ? 1 : 0;
  } else if (bgBrightness < 90) {
    // Dark background — pieces are lighter
    const thresh = Math.min(200, bgBrightness + MARGIN);
    for (let i = 0; i < W * H; i++) mask[i] = pixels[i] > thresh ? 1 : 0;
  } else {
    // Mixed — use distance from background color
    for (let i = 0; i < W * H; i++) {
      mask[i] = Math.abs(pixels[i] - bgBrightness) > MARGIN ? 1 : 0;
    }
  }

  // ── Two-pass connected-components (union-find) ──────────────────────────
  const labels = new Int32Array(W * H);
  const parent = new Int32Array(W * H + 2);
  for (let i = 0; i < parent.length; i++) parent[i] = i;

  const find = (n: number): number => {
    while (parent[n] !== n) { parent[n] = parent[parent[n]]; n = parent[n]; }
    return n;
  };
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };

  let nextLabel = 1;

  // First pass: assign provisional labels with union-find
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (mask[idx] === 0) { labels[idx] = 0; continue; }

      const L = x > 0 ? labels[idx - 1] : 0;
      const U = y > 0 ? labels[idx - W] : 0;

      if (L === 0 && U === 0) {
        labels[idx] = nextLabel++;
      } else if (L !== 0 && U === 0) {
        labels[idx] = L;
      } else if (L === 0 && U !== 0) {
        labels[idx] = U;
      } else {
        labels[idx] = L;
        if (L !== U) union(L, U);
      }
    }
  }

  // Second pass: resolve all labels to root
  for (let i = 0; i < W * H; i++) {
    if (labels[i] > 0) labels[i] = find(labels[i]);
  }

  // ── Compute bounding boxes per component ───────────────────────────────
  type Bbox = { x0: number; y0: number; x1: number; y1: number; count: number };
  const bboxMap = new Map<number, Bbox>();

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const lbl = labels[y * W + x];
      if (lbl === 0) continue;
      const root = find(lbl);
      const existing = bboxMap.get(root);
      if (!existing) {
        bboxMap.set(root, { x0: x, y0: y, x1: x, y1: y, count: 1 });
      } else {
        if (x < existing.x0) existing.x0 = x;
        if (y < existing.y0) existing.y0 = y;
        if (x > existing.x1) existing.x1 = x;
        if (y > existing.y1) existing.y1 = y;
        existing.count++;
      }
    }
  }

  // ── Filter by size and convert to % coordinates ────────────────────────
  const totalPx = W * H;
  const MIN_FILL  = totalPx * 0.0008; // 0.08% — shields fragment due to gold areas; keep small blobs so proximity merge can reassemble them
  const MAX_AREA  = totalPx * 0.80;   // 80%  — ignore if it's the whole image
  const MIN_BOX   = 2;                // minimum 2% dimension in either direction

  const raw: DetectedBox[] = [];
  let filteredDust = 0, filteredGiant = 0, filteredTiny = 0;

  const maskFill = Array.from(mask).filter(v => v === 1).length;
  console.log(`[ContourDetect] Image ${W}×${H}, bgBrightness=${bgBrightness.toFixed(1)}, maskFill=${((maskFill/totalPx)*100).toFixed(1)}%, components=${bboxMap.size}`);

  // Giant blobs that span >80% of image area are likely many touching pieces.
  // Grid-subdivide them so Brickognize can still process individual regions.
  const giantBlobs: { x0: number; y0: number; x1: number; y1: number }[] = [];

  for (const [, b] of bboxMap) {
    if (b.count < MIN_FILL) { filteredDust++; continue; }
    const boxArea = (b.x1 - b.x0) * (b.y1 - b.y0);
    if (boxArea > MAX_AREA) {
      filteredGiant++;
      giantBlobs.push(b);
      continue;
    }

    const xPct = (b.x0 / W) * 100;
    const yPct = (b.y0 / H) * 100;
    const wPct = ((b.x1 - b.x0) / W) * 100;
    const hPct = ((b.y1 - b.y0) / H) * 100;

    if (wPct < MIN_BOX || hPct < MIN_BOX) { filteredTiny++; continue; }

    raw.push({ x: xPct, y: yPct, w: wPct, h: hPct });
  }

  // Rescue giant blobs: estimate piece count and grid-subdivide
  if (raw.length === 0 && giantBlobs.length > 0) {
    console.log(`[ContourDetect] Rescuing ${giantBlobs.length} giant blob(s) via grid subdivision`);
    for (const b of giantBlobs) {
      const blobW = b.x1 - b.x0;
      const blobH = b.y1 - b.y0;
      // Estimate ~80px per piece at work resolution
      const cols = Math.max(1, Math.round(blobW / 80));
      const rows = Math.max(1, Math.round(blobH / 80));
      const cellW = blobW / cols;
      const cellH = blobH / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx0 = b.x0 + c * cellW;
          const cy0 = b.y0 + r * cellH;
          raw.push({
            x: (cx0 / W) * 100,
            y: (cy0 / H) * 100,
            w: (cellW / W) * 100,
            h: (cellH / H) * 100,
          });
        }
      }
    }
    console.log(`[ContourDetect] Grid subdivision produced ${raw.length} candidate cells`);
  }

  console.log(`[ContourDetect] Filtered: dust=${filteredDust} giant=${filteredGiant} tiny=${filteredTiny} → ${raw.length} candidates before merge`);

  // ── Pass 1: Merge overlapping blobs (IoU > 15%) ─────────────────────────
  const pass1 = mergeOverlapping(raw, 0.15);

  // ── Pass 2: Proximity merge ──────────────────────────────────────────────
  // Joins blobs that are vertically stacked (head/torso/legs of same minifig)
  // without accidentally joining horizontally adjacent minifigs.
  //
  // Key geometry at ~640px work res with 6 figs/row:
  //   - Head↔torso vertical gap:       0–1% (essentially touching)
  //   - Adjacent minifig horiz gap:     ~3% of image width
  //   - Minifig parts share X ranges (gapX ≈ 0); adjacent figs have gapX ~3%
  //
  // maxGapX=1.5: rejects adjacent figs (gapX ~3%) but accepts intra-fig (gapX ~0%)
  // maxGapY=2.0: bridges head/torso/leg gaps (<1%) with margin
  // maxAreaRatio=1.5: breaks cascade chains — merging spatially distant boxes
  //   creates lots of empty space (ratio >> 1); well-aligned minifig parts
  //   stack tightly (ratio ~1.05–1.15).
  const merged = mergeProximate(pass1, 1.5, 2.0, 1.5);

  console.log(`[ContourDetect] After merge: ${pass1.length} → ${merged.length} boxes`);
  return merged;
}

function iou(a: DetectedBox, b: DetectedBox): number {
  const ax2 = a.x + a.w, ay2 = a.y + a.h;
  const bx2 = b.x + b.w, by2 = b.y + b.h;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const unionArea = a.w * a.h + b.w * b.h - inter;
  return unionArea > 0 ? inter / unionArea : 0;
}

function mergePair(a: DetectedBox, b: DetectedBox): DetectedBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

function mergeOverlapping(boxes: DetectedBox[], threshold: number): DetectedBox[] {
  let result = [...boxes];
  let changed = true;
  while (changed) {
    changed = false;
    const next: DetectedBox[] = [];
    const used = new Set<number>();
    for (let i = 0; i < result.length; i++) {
      if (used.has(i)) continue;
      let cur = result[i];
      for (let j = i + 1; j < result.length; j++) {
        if (used.has(j)) continue;
        if (iou(cur, result[j]) > threshold) {
          cur = mergePair(cur, result[j]);
          used.add(j);
          changed = true;
        }
      }
      next.push(cur);
    }
    result = next;
  }
  return result;
}

/**
 * Proximity merge: join two boxes if their nearest edges (in both X and Y)
 * are within `maxGap` percentage points.
 *
 * Why: assembled minifig head/torso/legs are separate color blobs with
 * essentially 0 px gap between them, while adjacent minifigs are 5–15% apart.
 * A 3% threshold bridges intra-figure fragments without joining distinct figs.
 */
function boxEdgeGap(a: DetectedBox, b: DetectedBox): { gapX: number; gapY: number } {
  const ax2 = a.x + a.w, ay2 = a.y + a.h;
  const bx2 = b.x + b.w, by2 = b.y + b.h;
  const gapX = Math.max(0, Math.max(a.x, b.x) - Math.min(ax2, bx2));
  const gapY = Math.max(0, Math.max(a.y, b.y) - Math.min(ay2, by2));
  return { gapX, gapY };
}

function mergeProximate(boxes: DetectedBox[], maxGapX: number, maxGapY: number, maxAreaRatio: number): DetectedBox[] {
  let result = [...boxes];
  let changed = true;
  while (changed) {
    changed = false;
    const next: DetectedBox[] = [];
    const used = new Set<number>();
    for (let i = 0; i < result.length; i++) {
      if (used.has(i)) continue;
      let cur = result[i];
      for (let j = i + 1; j < result.length; j++) {
        if (used.has(j)) continue;
        const { gapX, gapY } = boxEdgeGap(cur, result[j]);
        if (gapX > maxGapX || gapY > maxGapY) continue;
        // Area ratio guard: merged bounding box vs sum of individual areas.
        // Tightly-stacked minifig parts → ratio ~1.05–1.15 (almost no wasted space).
        // Spatially distant blobs → ratio >> 1.5 (large empty region in merged box).
        const r = result[j];
        const mergedW = Math.max(cur.x + cur.w, r.x + r.w) - Math.min(cur.x, r.x);
        const mergedH = Math.max(cur.y + cur.h, r.y + r.h) - Math.min(cur.y, r.y);
        const mergedArea = mergedW * mergedH;
        const sumArea = (cur.w * cur.h) + (r.w * r.h);
        if (sumArea > 0 && mergedArea / sumArea > maxAreaRatio) continue;
        cur = mergePair(cur, result[j]);
        used.add(j);
        changed = true;
      }
      next.push(cur);
    }
    result = next;
  }
  return result;
}
