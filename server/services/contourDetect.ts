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

  // No column splitting here — routes.ts classifies large blobs and sends
  // them to GPT-4o for accurate sub-piece detection.
  console.log(`[ContourDetect] ${W}×${H} bg=${bgBrightness.toFixed(0)} → ${bboxMap.size} components → ${boxes.length} sized → ${filtered.length} returned`);
  return filtered;
}

/**
 * Given a small sub-image (already cropped from the full photo), find the
 * single dominant LEGO piece and return its tight bounding box as a % of
 * the sub-image dimensions. Returns null if nothing substantial is found.
 *
 * Used in the hybrid pipeline: GPT-4o locates pieces approximately, then
 * this function refines the exact boundary within each GPT-4o region.
 */
export async function detectLargestPiece(subImageBuffer: Buffer): Promise<DetectedBox | null> {
  const WORK_WIDTH = 400;

  const { data, info } = await sharp(subImageBuffer)
    .resize(WORK_WIDTH, undefined, { fit: 'inside', withoutEnlargement: true })
    .grayscale()
    .blur(1.5)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const W = info.width;
  const H = info.height;
  const pixels = new Uint8Array(data.buffer);

  // Background from corners
  const sample = (cx: number, cy: number, r: number) => {
    let s = 0, n = 0;
    for (let y = Math.max(0, cy - r); y <= Math.min(H - 1, cy + r); y++)
      for (let x = Math.max(0, cx - r); x <= Math.min(W - 1, cx + r); x++)
        { s += pixels[y * W + x]; n++; }
    return n > 0 ? s / n : 128;
  };
  const bg = (sample(10,10,8)+sample(W-10,10,8)+sample(10,H-10,8)+sample(W-10,H-10,8))/4;

  const MARGIN = 38;
  const mask = new Uint8Array(W * H);
  if (bg > 140) {
    const t = bg - MARGIN;
    for (let i = 0; i < W*H; i++) mask[i] = pixels[i] < t ? 1 : 0;
  } else if (bg < 100) {
    const t = bg + MARGIN;
    for (let i = 0; i < W*H; i++) mask[i] = pixels[i] > t ? 1 : 0;
  } else {
    for (let i = 0; i < W*H; i++) mask[i] = Math.abs(pixels[i]-bg) > MARGIN ? 1 : 0;
  }

  // Connected components
  const labels = new Int32Array(W * H);
  const parent = new Int32Array(W * H + 2);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (n: number): number => { while (parent[n]!==n){parent[n]=parent[parent[n]];n=parent[n];}return n; };
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };

  let next = 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y*W+x;
      if (!mask[idx]) { labels[idx]=0; continue; }
      const L = x>0?labels[idx-1]:0, U = y>0?labels[idx-W]:0;
      if (!L&&!U) labels[idx]=next++;
      else if (L&&!U) labels[idx]=L;
      else if (!L&&U) labels[idx]=U;
      else { labels[idx]=L; if(L!==U) union(L,U); }
    }
  }
  for (let i = 0; i < W*H; i++) if (labels[i]>0) labels[i]=find(labels[i]);

  type Bbox = {x0:number;y0:number;x1:number;y1:number;count:number};
  const bm = new Map<number,Bbox>();
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = find(labels[y*W+x]);
      if (!r) continue;
      const e = bm.get(r);
      if (!e) bm.set(r,{x0:x,y0:y,x1:x,y1:y,count:1});
      else { if(x<e.x0)e.x0=x;if(y<e.y0)e.y0=y;if(x>e.x1)e.x1=x;if(y>e.y1)e.y1=y;e.count++; }
    }
  }

  // Find the largest component that isn't the whole sub-image background
  const MIN_FILL = W * H * 0.02; // at least 2% of pixels
  const MAX_BOX  = W * H * 0.85;
  let best: Bbox | null = null;
  for (const [,b] of bm) {
    if (b.count < MIN_FILL) continue;
    if ((b.x1-b.x0)*(b.y1-b.y0) > MAX_BOX) continue;
    if (!best || b.count > best.count) best = b;
  }

  if (!best) return null;
  return {
    x: (best.x0 / W) * 100,
    y: (best.y0 / H) * 100,
    w: ((best.x1 - best.x0) / W) * 100,
    h: ((best.y1 - best.y0) / H) * 100,
  };
}
