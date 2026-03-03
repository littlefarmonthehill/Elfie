import sharp from 'sharp';

export interface DetectedBox {
  x: number; // % of image width  (0-100)
  y: number; // % of image height (0-100)
  w: number; // % of image width
  h: number; // % of image height
}

/**
 * Finds individual LEGO piece bounding boxes using connected-component labeling.
 * Simple pipeline: threshold → components → size filter → return boxes.
 * No merging, no proximity detection, no subdivision — just the raw regions.
 */
export async function detectPieceBoundingBoxes(imageBuffer: Buffer): Promise<DetectedBox[]> {
  const WORK_WIDTH = 800;

  const { data, info } = await sharp(imageBuffer)
    .resize(WORK_WIDTH, undefined, { fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .blur(1.5)
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

  // Sample more corners + edges to get a robust background estimate
  const bgBrightness = (
    sampleRegion(20, 20, 15) +
    sampleRegion(W - 20, 20, 15) +
    sampleRegion(20, H - 20, 15) +
    sampleRegion(W - 20, H - 20, 15) +
    sampleRegion(W >> 1, 10, 15) +
    sampleRegion(W >> 1, H - 10, 15)
  ) / 6;

  // ── Build binary mask ───────────────────────────────────────────────────
  // Pieces are anything that contrasts with the background by > MARGIN
  const MARGIN = 40;
  const mask = new Uint8Array(W * H);

  if (bgBrightness > 140) {
    // Light background — pieces are darker
    const thresh = bgBrightness - MARGIN;
    for (let i = 0; i < W * H; i++) mask[i] = pixels[i] < thresh ? 1 : 0;
  } else if (bgBrightness < 100) {
    // Dark background — pieces are lighter
    const thresh = bgBrightness + MARGIN;
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
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      if (mask[idx] === 0) { labels[idx] = 0; continue; }
      const L = x > 0 ? labels[idx - 1] : 0;
      const U = y > 0 ? labels[idx - W] : 0;
      if (L === 0 && U === 0) { labels[idx] = nextLabel++; }
      else if (L !== 0 && U === 0) { labels[idx] = L; }
      else if (L === 0 && U !== 0) { labels[idx] = U; }
      else { labels[idx] = L; if (L !== U) union(L, U); }
    }
  }
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

  // ── Filter by size ──────────────────────────────────────────────────────
  // MIN_FILL: enough pixels to be a real piece (not a speck)
  // MAX_BOX_FRACTION: not the entire image background
  const MIN_FILL = W * H * 0.001;   // 0.1% of pixels
  const MAX_BOX  = W * H * 0.70;    // box covering >70% of image = background noise
  const MIN_DIM  = 3;               // at least 3% in each direction

  const boxes: DetectedBox[] = [];
  for (const [, b] of bboxMap) {
    if (b.count < MIN_FILL) continue;
    const boxArea = (b.x1 - b.x0) * (b.y1 - b.y0);
    if (boxArea > MAX_BOX) continue;
    const wPct = ((b.x1 - b.x0) / W) * 100;
    const hPct = ((b.y1 - b.y0) / H) * 100;
    if (wPct < MIN_DIM || hPct < MIN_DIM) continue;
    boxes.push({
      x: (b.x0 / W) * 100,
      y: (b.y0 / H) * 100,
      w: wPct,
      h: hPct,
    });
  }

  // ── Sort by area descending ─────────────────────────────────────────────
  boxes.sort((a, b) => (b.w * b.h) - (a.w * a.h));

  // ── Drop sub-fragments: remove any box that is ≥70% contained inside a ──
  // larger box. Printed pieces (shields, tiles) generate many internal color  
  // regions as separate components. Those inner regions are entirely within   
  // the outer piece bbox — dropping them avoids sending piece fragments to    
  // Brickognize, which always returns empty for partial views.
  const keep: boolean[] = new Array(boxes.length).fill(true);
  for (let i = boxes.length - 1; i >= 1; i--) {       // smaller to larger
    const s = boxes[i];
    for (let j = 0; j < i; j++) {                      // compare with each larger box
      if (!keep[j]) continue;
      const l = boxes[j];
      // Intersection area
      const ix = Math.max(0, Math.min(s.x + s.w, l.x + l.w) - Math.max(s.x, l.x));
      const iy = Math.max(0, Math.min(s.y + s.h, l.y + l.h) - Math.max(s.y, l.y));
      const inter = ix * iy;
      const sArea = s.w * s.h;
      if (sArea > 0 && inter / sArea >= 0.55) { keep[i] = false; break; }
    }
  }
  const filtered = boxes.filter((_, i) => keep[i]);

  console.log(`[ContourDetect] ${W}×${H} bg=${bgBrightness.toFixed(0)} → ${bboxMap.size} components → ${boxes.length} sized → ${filtered.length} after sub-fragment removal`);
  return filtered;
}
