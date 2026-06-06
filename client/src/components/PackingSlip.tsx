import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { cleanItemName, shippingTier } from "@/lib/item-utils";
import { partImageSources } from "@/lib/part-image";
import { formatDate, DEFAULT_ORG_TIMEZONE } from "@/lib/utils";

// ─── Org branding config ──────────────────────────────────────────────────────
export interface OrgBranding {
  name?: string | null;
  address?: string | null;
  logoUrl?: string | null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type PackingSlipOrder = {
  orderNumber: string;
  orderDate: string;
  shipDate: string | null;
  customerUsername: string | null;
  marketplace: string | null;
  requestedService?: string | null;
  carrierCode?: string | null;
  serviceCode?: string | null;
  shipTo: {
    name?: string;
    company?: string;
    street1?: string;
    street2?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  items: Array<{
    inventoryId: string | null;
    bricklinkPartNumber: string | null;
    colorId?: number | null;
    imageUrl?: string | null;
    /** BrickLink item type (PART/MINIFIG/SET/GEAR) — used by global image resolver. */
    itemType?: string | null;
    name: string;
    quantity: number;
    colorName: string | null;
    condition: string | null;
    comment?: string | null;
  }>;
};

interface PackingSlipProps {
  orders: PackingSlipOrder[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MX        = 4;            // left / right margin mm
const MY        = 0;            // top margin mm — as narrow as possible
const PAGE_W    = 215.9;        // letter width mm
const PAGE_H    = 279.4;        // letter height mm
const CONTENT_W = PAGE_W - 2 * MX;
const LOGO_H    = 28;           // target logo height mm

// ─── Helpers ─────────────────────────────────────────────────────────────────

function channelLabel(order: PackingSlipOrder): string {
  return order.marketplace === 'BrickOwl' ? 'BrickOwl' : 'BrickLink';
}

/**
 * Deterministic 4-character shortcode derived from an order number.
 *
 * Purpose: staff communication shorthand between the picklist (warehouse) and
 * the packing slip (customer copy). Instead of reading out "BL 12345678",
 * pickers say "J4KN". Consistent — same order always produces the same code.
 *
 * Alphabet: Crockford-style, minus 0/1/L/U to eliminate common misreads when
 * spoken aloud or written by hand. 30 chars → 30^4 = 810 000 possible codes,
 * far more than enough within a working day's volume.
 *
 * The full order number string (including any BL/BO prefix) is hashed so that
 * BrickLink and BrickOwl orders with the same numeric suffix never collide.
 */
const ALPHA = 'ABCDEFGHJKMPQRSTVWXYZ'; // 21 letters — no I, L, O, N, U

function hashCode(orderNumber: string, len: number): string {
  const s = orderNumber.trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = Math.imul(h, 33) ^ s.charCodeAt(i);
  h = h >>> 0;
  let code = '';
  for (let i = 0; i < len; i++) { code += ALPHA[h % ALPHA.length]; h = Math.floor(h / ALPHA.length); }
  return code;
}

/** For single-order contexts (e.g. packing slip header). Starts at 2 chars. */
export function shortCode(orderNumber: string): string {
  return hashCode(orderNumber, 2);
}

/**
 * Assign short codes to the active orders in this print batch.
 * Codes are ephemeral — reused once an order ships — so sequential
 * assignment is correct. Orders are sorted for stable output across
 * re-prints of the same batch.
 * Starts at 2 chars (AA–ZZ = 441 slots). Only grows to 3 when the
 * batch genuinely exceeds 441 simultaneous active orders.
 */
export function buildShortCodeMap(orderNumbers: string[]): Map<string, string> {
  const unique = [...new Set(orderNumbers.filter(Boolean))].sort();
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const o of unique) {
    let code = '';
    for (let len = 2; len <= 4; len++) {
      const candidate = hashCode(o, len);
      if (!used.has(candidate)) { code = candidate; break; }
    }
    if (!code) code = hashCode(o, 4);
    used.add(code);
    map.set(o, code);
  }
  return map;
}

async function loadLogoInfo(orgLogoUrl?: string | null): Promise<{ dataUrl: string; w: number; h: number } | null> {
  if (!orgLogoUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (!w || !h) { resolve(null); return; }
        // data: URLs are already same-origin — hand them straight to jsPDF,
        // no canvas needed (avoids tainted-canvas / crossOrigin complications).
        if (orgLogoUrl.startsWith('data:')) {
          resolve({ dataUrl: orgLogoUrl, w, h });
          return;
        }
        // External URLs: draw through canvas so jsPDF gets a PNG data URL.
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve({ dataUrl: canvas.toDataURL('image/png'), w, h });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = orgLogoUrl;
  });
}

// ─── Hidden-print helper ──────────────────────────────────────────────────────

function isMobile(): boolean {
  return (
    /Android|iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export function hiddenPrint(blob: Blob, filename = 'document.pdf'): void {
  // Hidden-iframe printing only works reliably on desktop. iOS Safari can't
  // print from a hidden iframe at all, and Android Chrome/Firefox silently
  // block print() from a hidden iframe — so on any phone/tablet we route the
  // PDF through the native share sheet (which exposes Print / Save to PDF /
  // send to a printing app), falling back to a plain download if the browser
  // can't share files.
  if (isMobile()) {
    // Download the PDF so the user can open and print it from their device's
    // PDF viewer. Used both when file-sharing is unsupported and when a share
    // attempt fails for any reason other than the user cancelling.
    const downloadPdf = () => {
      const dlUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = dlUrl;
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => { try { URL.revokeObjectURL(dlUrl); } catch { /* already revoked */ } }, 60_000);
    };

    const file = new File([blob], filename, { type: 'application/pdf' });
    if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
      navigator.share({ files: [file], title: filename.replace(/\.pdf$/i, '') })
        .catch((err: unknown) => {
          // AbortError = user cancelled the share sheet; anything else (e.g.
          // user-activation expired after async PDF generation) falls back to
          // a download so the user always ends up with the file.
          if (err instanceof Error && err.name === 'AbortError') return;
          downloadPdf();
        });
      return;
    }
    downloadPdf();
    return;
  }

  const url = URL.createObjectURL(blob);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText =
    'position:fixed;top:-2400px;left:-2400px;width:816px;height:1056px;border:none;visibility:hidden;';
  document.body.appendChild(iframe);

  const cleanup = () => {
    try { document.body.removeChild(iframe); } catch { /* already removed */ }
    try { URL.revokeObjectURL(url); } catch { /* already revoked */ }
  };

  let printed = false;
  const doPrint = () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch { /* cross-origin guard */ }
    iframe.contentWindow?.addEventListener('afterprint', cleanup, { once: true });
  };

  iframe.addEventListener('load', doPrint, { once: true });
  setTimeout(doPrint, 1500);
  setTimeout(cleanup, 120_000);
  iframe.src = url;
}

// ─── Picklist (half-page panels, 2 per physical page) ────────────────────────

export interface PicklistItem {
  partNumber?: string | null;
  sku?: string | null;
  colorName?: string | null;
  /** BrickLink color ID — used to fetch the part thumbnail via the server proxy. */
  colorId?: number | null;
  condition?: string | null;
  itemName?: string | null;
  quantity: number;
  orderNumber?: string | null;
  marketplace?: string | null;
  inventoryId?: number | null;
  /** BrickLink item type (PART/MINIFIG/SET/GEAR) — used by global image resolver. */
  itemType?: string | null;
  comment?: string | null;
  imageUrl?: string | null;
}

const chanPrefix = (item: PicklistItem) => item.marketplace === 'BrickOwl' ? 'BO' : 'BL';
const condLabel  = (c: string | null | undefined) => c === 'N' ? 'New' : c === 'U' ? 'Used' : (c || '');
const partKey    = (item: PicklistItem) => item.partNumber || item.sku || '';

/**
 * Unified part image loader for PDF embedding (picklist + packing slip + lot labels).
 *
 * Uses the global `partImageSources` resolver — the same source chain that
 * `<PartImage>` uses on screen — so the PDF and the UI always agree on which
 * image to show. Each candidate URL is tried in order until one loads cleanly
 * into a canvas. URLs that taint the canvas (cross-origin without CORS headers
 * — e.g. raw BrickLink CDN) fail naturally and we fall through to the next.
 *
 * The returned data URL is always a SQUARE PNG (the shorter side is padded with
 * transparent pixels). This prevents jsPDF from squishing non-square images when
 * they are drawn into the fixed-size IMG_W × IMG_H cell.
 *
 * Grayscale conversion is applied when grayscale=true.
 */
export async function loadItemImageForPDF(opts: {
  partNumber?: string | null;
  colorId?: number | null;
  imageUrl?: string | null;
  itemType?: string | null;
  lotId?: number | null;
  grayscale?: boolean;
}): Promise<string | null> {
  const { partNumber, colorId, imageUrl, itemType, lotId, grayscale = true } = opts;
  const urls = partImageSources(imageUrl, partNumber, colorId, itemType, lotId);
  for (const url of urls) {
    const dataUrl = await loadUrlToSquarePNG(url, grayscale);
    if (dataUrl) return dataUrl;
  }
  return null;
}

/** Load a URL into a square (padded) grayscale-optional canvas data URL. */
function loadUrlToSquarePNG(url: string, grayscale: boolean): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image();
    // Only request CORS for cross-origin URLs. For same-origin (e.g. our own
    // /api/images/lot/:id endpoint) we deliberately leave crossOrigin unset so
    // the browser sends session cookies — required by auth-gated routes.
    // Same-origin draws never taint the canvas regardless of crossOrigin.
    let isCrossOrigin = false;
    try {
      if (typeof window !== 'undefined' && /^https?:\/\//i.test(url)) {
        isCrossOrigin = new URL(url).origin !== window.location.origin;
      }
    } catch { /* treat as same-origin */ }
    if (isCrossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const w = img.naturalWidth  || img.width  || 0;
        const h = img.naturalHeight || img.height || 0;
        if (!w || !h) { resolve(null); return; }

        // Pad to square so jsPDF renders without squishing
        const sz  = Math.max(w, h);
        const dx  = Math.floor((sz - w) / 2);
        const dy  = Math.floor((sz - h) / 2);

        const canvas = document.createElement('canvas');
        canvas.width  = sz;
        canvas.height = sz;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, dx, dy, w, h);

        if (grayscale) {
          const imageData = ctx.getImageData(0, 0, sz, sz);
          const d = imageData.data;
          for (let i = 0; i < d.length; i += 4) {
            const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
            d[i] = d[i + 1] = d[i + 2] = g;
          }
          ctx.putImageData(imageData, 0, 0);
        }

        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function printPicklist(items: PicklistItem[]): Promise<void> {
  if (items.length === 0) return;

  // ── Layout constants ────────────────────────────────────────────────────────
  const SC_W       = 14;    // shortcode column width mm (left of image)
  const SC_GAP     = 2;     // gap between shortcode column and image mm
  const IMG_W      = 13.5;  // image cell width mm  (18 × 0.75)
  const IMG_H      = 13.5;  // image cell height mm (18 × 0.75)
  const IMG_GAP    = 3;     // gap between image and text block mm
  const BASE_ROW_H = 24;    // row height mm (slightly taller for prominence)
  const CMT_LINE_H = 5;     // mm per extra comment line below color/condition
  const PAGE_PAD   = 6;     // breathing room at top/bottom of each page mm
  const IMG_X      = MX + SC_W + SC_GAP;               // image left edge
  const TEXT_X     = IMG_X + IMG_W + IMG_GAP;           // text block left edge
  const TEXT_W     = CONTENT_W - SC_W - SC_GAP - IMG_W - IMG_GAP;
  const RIGHT_X    = MX + CONTENT_W;

  // ── Pre-load all images concurrently ───────────────────────────────────────
  const imageDataUrls = await Promise.all(
    items.map(item =>
      loadItemImageForPDF({
        partNumber: item.partNumber,
        colorId:    item.colorId,
        imageUrl:   item.imageUrl,
        itemType:   item.itemType,
        lotId:      item.inventoryId,
      })
    )
  );

  // Build collision-free short codes for all orders in this batch.
  // Starts at 2 chars; expands to 3 only if two orders hash to the same code.
  const codeMap = buildShortCodeMap(items.map(i => i.orderNumber).filter(Boolean) as string[]);


  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  let y = PAGE_PAD;

  const advancePage = () => {
    doc.addPage();
    y = PAGE_PAD;
  };

  // Compute each item's actual height.
  // L1: part + name + ×qty (always BASE_ROW_H)
  // L2: color · condition + order ref (fits in BASE_ROW_H)
  // L3+: comment lines (each CMT_LINE_H extra)
  const calcItemH = (item: PicklistItem): number => {
    if (!item.comment) return BASE_ROW_H;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'oblique');
    const lineCount = (doc.splitTextToSize(item.comment, TEXT_W) as string[]).length;
    return BASE_ROW_H + lineCount * CMT_LINE_H;
  };

  for (let i = 0; i < items.length; i++) {
    const item    = items[i];
    const imgData = imageDataUrls[i];
    const itemH   = calcItemH(item);

    if (y + itemH > PAGE_H - PAGE_PAD) advancePage();

    const rowY = y;

    // ── Baselines ─────────────────────────────────────────────────────────────
    // Three-line hierarchy: L1 (part+qty), L2 (color+condition), L3 (comment)
    // Block: cap13pt≈4.6 + gap5.5 + cap11pt≈3.9 ≈ 14mm centred in BASE_ROW_H
    const L1_Y = rowY + (BASE_ROW_H - 14) / 2 + 4.6;
    const L2_Y = L1_Y + 5.5; // gap between part line and color/condition line
    const L3_Y = L2_Y + 5;   // gap for comment line(s)

    // ── Shortcode column — left of image, large and bold ─────────────────────
    const sc = item.orderNumber ? (codeMap.get(item.orderNumber) ?? shortCode(item.orderNumber)) : '';
    if (sc) {
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 15, 15);
      // Centre horizontally within SC_W; vertically centred in the row
      const scW = doc.getTextWidth(sc);
      const SC_Y = rowY + BASE_ROW_H / 2 + 2.5; // 2.5 ≈ half cap-height of 14pt
      doc.text(sc, MX + (SC_W - scW) / 2, SC_Y);
    }

    // ── Image — centred vertically in base row height, after SC column ────────
    const imgY = rowY + (BASE_ROW_H - IMG_H) / 2;
    if (imgData) {
      try {
        doc.addImage(imgData, 'PNG', IMG_X, imgY, IMG_W, IMG_H);
      } catch { /* skip if image data is invalid */ }
    } else {
      doc.setDrawColor(210, 210, 210);
      doc.setLineWidth(0.15);
      doc.setFillColor(248, 248, 248);
      doc.roundedRect(IMG_X, imgY, IMG_W, IMG_H, 1, 1, 'FD');
    }

    // ── Line 1: PartNo (bold) · Name (gray) — all left ──────────────────────
    const partStr = partKey(item);

    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 15, 15);
    doc.text(partStr, TEXT_X, L1_Y);
    const partStrW = doc.getTextWidth(partStr);

    const rawName = item.itemName
      ? cleanItemName(item.itemName, item.partNumber || '')
      : '';
    if (rawName) {
      const maxNameW = TEXT_W - partStrW - 4;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      let name = rawName;
      while (doc.getTextWidth(name) > maxNameW && name.length > 4)
        name = name.slice(0, -1);
      if (name.length < rawName.length) name = name.slice(0, -1) + '\u2026';
      doc.text('\u00a0\u00a0' + name, TEXT_X + partStrW, L1_Y);
    }

    // ── Line 2: ×Qty · Color · Condition (11pt bold) then · OrderRef (8pt gray) ──
    // Key picker/customer info is prominent; order ref is subdued but left-aligned.
    const rawOrder = (item.orderNumber || '').replace(/^(BL|BO)/i, '').trim();
    const orderRef = rawOrder ? `${chanPrefix(item)}.${rawOrder}` : '';

    const prominentParts = [
      `\u00d7${item.quantity}`,
      item.colorName,
      item.condition ? condLabel(item.condition) : null,
    ].filter(Boolean).join('  \u00b7  ');

    let L2_cursor = TEXT_X;
    if (prominentParts) {
      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(25, 25, 25);
      doc.text(prominentParts, L2_cursor, L2_Y);
      L2_cursor += doc.getTextWidth(prominentParts);
    }

    if (orderRef) {
      const lotLabel = item.inventoryId != null ? `  \u00b7  Lot ${item.inventoryId}` : '';
      const sep = prominentParts ? '  \u00b7  ' : '';
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(40, 40, 40);
      doc.text(sep + orderRef + lotLabel, L2_cursor, L2_Y);
    }

    // ── Line 3+: Comment (italic, yellow highlight) — only if present ─────────
    if (item.comment) {
      doc.setFontSize(9);
      doc.setFont('helvetica', 'oblique');
      const lines = doc.splitTextToSize(item.comment, TEXT_W) as string[];
      // Yellow highlight rect behind comment
      const hlH = lines.length * CMT_LINE_H;
      doc.setFillColor(255, 245, 100);
      doc.rect(TEXT_X - 1, L3_Y - 3.5, TEXT_W + 2, hlH + 0.5, 'F');
      doc.setTextColor(40, 40, 40);
      lines.forEach((line, idx) => {
        doc.text(line, TEXT_X, L3_Y + idx * CMT_LINE_H);
      });
    }

    y = rowY + itemH;
  }

  hiddenPrint(doc.output('blob'), 'picklist.pdf');
}

// ─── Per-order bag labels (thermal, 2" × 3") ─────────────────────────────────
// Each label is a bag slip for one lot in a customer's order — the thermal
// equivalent of cutting a single row off the picklist sheet.
// Layout: shortcode header → image + part# + name → ×qty·color·condition →
//         order ref + lot ID → comment (yellow).  No bin/QR — this is for
//         packing, not warehouse picking.

export interface LotLabelItem {
  partNumber?: string | null;
  sku?: string | null;
  itemName?: string | null;
  colorName?: string | null;
  colorId?: number | null;
  condition?: string | null;
  quantity: number;
  inventoryId?: number | null;
  imageUrl?: string | null;
  /** BrickLink item type (PART/MINIFIG/SET/GEAR) — used by global image resolver. */
  itemType?: string | null;
  /** Order number this lot belongs to — used for order ref + shortcode. */
  orderNumber?: string | null;
  /** Channel marketplace ('BrickLink' | 'BrickOwl') — for ref prefix. */
  marketplace?: string | null;
  /** Seller note / lot remark — shown with yellow highlight, same as picklist. */
  comment?: string | null;
  /** Alias for `comment` — field name on PicklistBinItem. */
  remarks?: string | null;
  // kept for API compat but unused in bag-slip layout:
  binLocation?: string | null;
}

/**
 * Brother QL-800 label presets. The QL-800 maxes out at 62 mm wide rolls.
 * Width is the tape width (short side); length is the printable label length
 * (long side). Continuous tape uses a fixed length here so each label ejects
 * at a consistent size. `showImage` is dropped on narrow tapes where there's
 * no room for a thumbnail next to the text.
 */
export interface LabelPreset {
  id: string;
  /** Brother SKU, e.g. "DK-1209". Shown as the primary line in the picker. */
  sku: string;
  /** Short human description, e.g. "Small address". */
  desc: string;
  /** Tape kind — used to group items in the picker. */
  kind: 'die-cut' | 'continuous';
  widthMm: number;     // tape width (short side)
  lengthMm: number;    // label length (long side, landscape)
  showImage: boolean;
  /** True for the curated default list shown without "Show more sizes". */
  common: boolean;
}

// Brother QL series DK label catalog. Die-cut labels (DK-1xxx) have a fixed
// length; continuous tape (DK-2xxx) is cut to the length below. The picker
// shows `common` items by default and reveals the rest behind a toggle.
// Maximum label length supported by this setup is just under 3" (76 mm), so
// the catalog is limited to die-cut presets that fall within that and to
// continuous-tape cuts capped at 76 mm.
export const LABEL_PRESETS: LabelPreset[] = [
  // Die-cut
  { id: 'dk-1204', sku: 'DK-1204', desc: 'Multi-purpose',     kind: 'die-cut',    widthMm: 17,   lengthMm: 54,    showImage: true,  common: false },
  { id: 'dk-1209', sku: 'DK-1209', desc: 'Small address',     kind: 'die-cut',    widthMm: 29,   lengthMm: 62,    showImage: true,  common: true  },
  { id: 'dk-1201', sku: 'DK-1201', desc: 'Standard address',  kind: 'die-cut',    widthMm: 29,   lengthMm: 90,    showImage: true,  common: true  },
  // Continuous tape — cut length ≈ 50 mm
  { id: 'dk-2210', sku: 'DK-2210', desc: 'Continuous tape',   kind: 'continuous', widthMm: 29,   lengthMm: 50,    showImage: true,  common: true  },
  { id: 'dk-2225', sku: 'DK-2225', desc: 'Continuous tape',   kind: 'continuous', widthMm: 38,   lengthMm: 50,    showImage: true,  common: true  },
  { id: 'dk-2205', sku: 'DK-2205', desc: 'Continuous tape',   kind: 'continuous', widthMm: 62,   lengthMm: 25,    showImage: true,  common: true  },
];

export const DEFAULT_LABEL_PRESET_ID = 'dk-1209';

export function getLabelPreset(id: string | null | undefined): LabelPreset {
  return LABEL_PRESETS.find(p => p.id === id) ?? LABEL_PRESETS[0];
}

export async function printLotLabels(
  items: LotLabelItem[],
  org?: OrgBranding,
  preset: LabelPreset = LABEL_PRESETS[0],
): Promise<void> {
  if (items.length === 0) return;

  // Geometry derived from the chosen preset. Long side runs left→right
  // (landscape feed direction on the QL-800).
  const LBL_W   = preset.lengthMm;
  const LBL_H   = preset.widthMm;
  const tiny    = preset.widthMm < 22;   // DK-1204 17-mm only
  const small   = preset.widthMm < 32;   // tiny + 29-mm DK tapes
  const LM      = 1;
  // QL-800 leaves ~1.5 mm unprintable on the leading/trailing edge — bump the
  // right margin on the 29-mm tapes so the rightmost glyph isn't shaved off.
  const RM      = tiny ? 1   : (small ? 2 : 1);
  // QL-800 has a ~1.5 mm unprintable top/bottom edge — keep margins ≥ 2 mm
  // so the first/last line never gets shaved.
  const TM      = tiny ? 2   : 3;
  const BM      = tiny ? 2   : 3;
  const SC_W    = tiny ? 5   : (small ? 6 : 9);       // shortcode column (≈ 2-char width)
  const SC_GAP  = tiny ? 0.5 : (small ? 0.8 : 1);
  const LBL_CH  = LBL_H - TM - BM;
  // Square thumbnail: smaller on the 29-mm tape so the text column has room
  // for the part name + ×qty·color·condition without clipping.
  const IMG_W   = preset.showImage
    ? (small ? Math.max(8, Math.min(11, LBL_CH - 3))
             : Math.max(8, Math.min(14, LBL_CH - 3)))
    : 0;
  const IMG_H   = IMG_W;
  const IMG_GAP = preset.showImage ? (small ? 1.2 : 2) : 0;
  const TEXT_X  = LM + SC_W + SC_GAP + IMG_W + IMG_GAP;
  const TEXT_W  = LBL_W - RM - TEXT_X;

  // Build collision-free short codes for all orders in this label batch
  const orderNumbers = items.map(i => i.orderNumber).filter(Boolean) as string[];
  const codeMap = buildShortCodeMap(orderNumbers);

  const imgDataUrls = preset.showImage
    ? await Promise.all(
        items.map(item =>
          loadItemImageForPDF({ partNumber: item.partNumber, colorId: item.colorId, imageUrl: item.imageUrl, itemType: item.itemType, lotId: item.inventoryId })
        )
      )
    : items.map(() => null);

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [LBL_H, LBL_W],   // jsPDF format is [shorter, longer] for landscape
  });

  for (let i = 0; i < items.length; i++) {
    if (i > 0) doc.addPage([LBL_H, LBL_W], 'landscape');

    const item    = items[i];
    const imgData = imgDataUrls[i];
    const partStr = item.partNumber || item.sku || '';
    const condStr = item.condition ? condLabel(item.condition) : '';
    // Public buyer-facing comment only — never the private seller remarks,
    // matching the picklist sheet which uses bl_inventory.description.
    const noteText = (item.comment || '').trim();

    // Order ref helpers — same logic as picklist
    const chanPfx = item.marketplace === 'BrickOwl' ? 'BO' : 'BL';
    const rawOrder = (item.orderNumber || '').replace(/^(BL|BO)/i, '').trim();
    const orderRef = rawOrder ? `${chanPfx}.${rawOrder}` : '';
    const sc = item.orderNumber
      ? (codeMap.get(item.orderNumber) ?? shortCode(item.orderNumber))
      : '';

    // ── Shortcode column — vertically centred, bold (matches picklist) ────────
    if (sc) {
      // Tiered down for narrow tapes so the shortcode doesn't dominate the
      // label height: 17-mm tape gets 8 pt, 29-mm gets 11 pt, ≥38-mm gets 14 pt.
      const scPt = preset.widthMm < 22 ? 7 : preset.widthMm < 32 ? 8 : 11;
      doc.setFontSize(scPt);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(15, 15, 15);
      const scW = doc.getTextWidth(sc);
      const scX = LM + (SC_W - scW) / 2;
      const scY = TM + LBL_CH / 2 + scPt * 0.18;
      doc.text(sc, scX, scY);
    }

    // Vertical divider between shortcode col and image/text
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.15);
    const divX = LM + SC_W + SC_GAP / 2;
    doc.line(divX, TM, divX, TM + LBL_CH);

    // ── Thumbnail — vertically centred (only on wider tapes) ──────────────────
    if (preset.showImage) {
      const imgX = LM + SC_W + SC_GAP;
      const imgY = TM + (LBL_CH - IMG_H) / 2;
      if (imgData) {
        try { doc.addImage(imgData, 'PNG', imgX, imgY, IMG_W, IMG_H); } catch { /* skip */ }
      } else {
        doc.setDrawColor(210, 210, 210);
        doc.setFillColor(248, 248, 248);
        doc.roundedRect(imgX, imgY, IMG_W, IMG_H, 1, 1, 'FD');
      }
      // Warehouse location under the image (skip on the tiny 17-mm tape — no room).
      const locStr = (item.binLocation ?? '').trim();
      if (locStr && !tiny) {
        // Bin location is the picker's primary anchor — bumped up so it's
        // legible at arm's length. Auto-shrinks if a long bin name overflows.
        let locPt = preset.widthMm < 32 ? 9 : 11;
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(40, 40, 40);
        const maxW = IMG_W + 2;
        doc.setFontSize(locPt);
        while (doc.getTextWidth(locStr) > maxW && locPt > 6) {
          locPt -= 0.5;
          doc.setFontSize(locPt);
        }
        const lw = doc.getTextWidth(locStr);
        const lx = imgX + (IMG_W - lw) / 2;
        const ly = Math.min(imgY + IMG_H + locPt * 0.42 + 0.8, TM + LBL_CH - 0.3);
        doc.text(locStr, lx, ly);
      }
    }

    // ── Picklist-sheet text recipe, scaled to label size ─────────────────────
    // Same layout as `printPicklist`:
    //   L1: bold dark Part#  +  gray Name (char-by-char ellipsis)
    //   L2: bold dark ×Qty · Color · Condition  +  dark-gray · OrderRef · Lot N
    //   L3: italic note over a yellow highlight rect
    // Font sizes are picklist's 12/9/11/8/9 scaled down a step on the 29-mm tape.
    const partPt = tiny ? 8   : (small ? 10  : 12);
    const namePt = tiny ? 6   : (small ? 7.5 : 9);
    const qtyPt  = tiny ? 7   : (small ? 9   : 11);
    const refPt  = tiny ? 6   : (small ? 7   : 8);
    const notePt = tiny ? 6   : (small ? 7.5 : 9);
    // Picklist uses CMT_LINE_H = 5 mm for 9pt comments → 0.555 × pt
    const cmtScale = notePt / 9;
    const CMT_LINE_H = 5 * cmtScale;
    const lineGap = tiny ? 0.9 : (small ? 1.4 : 2.0);

    // ── Line 1: Part# (bold) + Name (gray, ellipsis-truncated) ───────────────
    let ty = TM + (tiny ? 2.0 : 3.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(partPt);
    doc.setTextColor(15, 15, 15);
    doc.text(partStr, TEXT_X, ty);
    const partStrW = doc.getTextWidth(partStr);

    const rawName = item.itemName ? cleanItemName(item.itemName, partStr) : '';
    if (rawName) {
      const firstW = TEXT_W - partStrW - 2;       // room next to Part#
      const restW  = TEXT_W;                       // full width on wrap row
      doc.setFontSize(namePt);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      // Word-wrap into up to 2 lines, ellipsising the last if it overflows.
      const words = rawName.split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let cur = '';
      let limit = firstW;
      for (const w of words) {
        const trial = cur ? cur + ' ' + w : w;
        if (doc.getTextWidth(trial) <= limit) {
          cur = trial;
        } else {
          if (cur) lines.push(cur);
          if (lines.length >= 2) break;
          cur = w;
          limit = restW;
        }
      }
      if (cur && lines.length < 2) lines.push(cur);
      // Ellipsise final line if there were leftover words.
      const consumed = lines.join(' ').split(/\s+/).filter(Boolean).length;
      if (consumed < words.length && lines.length) {
        let last = lines[lines.length - 1];
        const lineLimit = lines.length === 1 ? firstW : restW;
        while (doc.getTextWidth(last + '\u2026') > lineLimit && last.length > 2)
          last = last.slice(0, -1);
        lines[lines.length - 1] = last + '\u2026';
      }
      // Render line 1 inline next to Part#; line 2 (if any) on its own row.
      if (lines[0]) doc.text('\u00a0\u00a0' + lines[0], TEXT_X + partStrW, ty);
      if (lines[1]) {
        const ty2 = ty + namePt * 0.36 + 0.7;
        doc.text(lines[1], TEXT_X, ty2);
        ty = ty2;
      }
    }
    ty += partPt * 0.36 + lineGap;

    // ── Line 2: ×Qty · Color · Condition ─────────────────────────────────────
    // Color and Condition are non-negotiable on a fulfillment label — picker
    // needs both to grab the right lot. So instead of ellipsising (which used
    // to chop the condition off entirely on long color names), we:
    //   1. Try the natural font size.
    //   2. If it overflows, shrink font down to ~70% to fit on one line.
    //   3. If it still overflows, wrap onto a second line with the same style.
    const qtyPart   = `\u00d7${item.quantity}`;
    const colorPart = item.colorName || '';
    const condPart  = condStr || '';
    const SEP = '  \u00b7  ';
    const prominentParts = [qtyPart, colorPart, condPart].filter(Boolean).join(SEP);

    if (prominentParts) {
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(25, 25, 25);
      // Step 1: try natural; step 2: shrink to a floor (don't go smaller than refPt)
      let pt = qtyPt;
      const minPt = Math.max(refPt, qtyPt * 0.7);
      doc.setFontSize(pt);
      while (doc.getTextWidth(prominentParts) > TEXT_W && pt > minPt) {
        pt = Math.max(minPt, pt - 0.5);
        doc.setFontSize(pt);
      }
      if (doc.getTextWidth(prominentParts) <= TEXT_W) {
        doc.text(prominentParts, TEXT_X, ty);
        ty += pt * 0.36 + lineGap;
      } else {
        // Step 3: split — keep ×Qty + Color together on row 1, Condition on row 2.
        // (If color alone still overflows, fall back to PDF word-wrap so we
        //  show as much as possible without ever dropping the condition.)
        const row1 = [qtyPart, colorPart].filter(Boolean).join(SEP);
        const wrapped = doc.splitTextToSize(row1, TEXT_W) as string[];
        wrapped.forEach((ln, i) => doc.text(ln, TEXT_X, ty + i * (pt * 0.36 + lineGap)));
        ty += wrapped.length * (pt * 0.36 + lineGap);
        if (condPart) {
          doc.text(condPart, TEXT_X, ty);
          ty += pt * 0.36 + lineGap;
        }
      }
    } else {
      ty += qtyPt * 0.36 + lineGap;
    }

    // ── Line 3: OrderRef · Lot N — own line, dark gray ───────────────────────
    const refTail = [
      orderRef || null,
      item.inventoryId != null ? `Lot ${item.inventoryId}` : null,
    ].filter(Boolean).join('  \u00b7  ');
    if (refTail) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(refPt);
      doc.setTextColor(40, 40, 40);
      let r = refTail;
      while (doc.getTextWidth(r) > TEXT_W && r.length > 4) r = r.slice(0, -1);
      if (r.length < refTail.length) r = r.slice(0, -1) + '\u2026';
      doc.text(r, TEXT_X, ty);
      ty += refPt * 0.36 + lineGap;
    }

    // ── Line 4: Comment (italic over yellow highlight) ───────────────────────
    if (noteText) {
      const maxNoteLines = small ? 1 : 3;
      doc.setFont('helvetica', 'oblique');
      doc.setFontSize(notePt);
      const lines = (doc.splitTextToSize(noteText, TEXT_W) as string[]).slice(0, maxNoteLines);
      const hlH = lines.length * CMT_LINE_H;
      // Skip the highlight if it would overflow the label height
      if (ty + hlH - 3.5 * cmtScale <= TM + LBL_CH) {
        doc.setFillColor(255, 245, 100);
        doc.rect(TEXT_X - 1, ty - 3.5 * cmtScale, TEXT_W + 2, hlH + 0.5 * cmtScale, 'F');
        doc.setTextColor(40, 40, 40);
        lines.forEach((line, idx) => doc.text(line, TEXT_X, ty + idx * CMT_LINE_H));
      }
    }

    // ── Org name — tiny, bottom-right (suppressed on the smallest tapes) ─────
    const orgName = (org?.name || '').trim();
    if (orgName && preset.widthMm >= 38) {
      doc.setFontSize(5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(190, 190, 190);
      const onW = doc.getTextWidth(orgName.toUpperCase());
      doc.text(orgName.toUpperCase(), LBL_W - RM - onW, LBL_H - BM + 1.5);
    }
  }

  hiddenPrint(doc.output('blob'), 'lot-labels.pdf');
}

// ─── Packing slips ────────────────────────────────────────────────────────────

export async function printPackingSlips(orders: PackingSlipOrder[], org?: OrgBranding, tz: string = DEFAULT_ORG_TIMEZONE): Promise<void> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const logo = await loadLogoInfo(org?.logoUrl);
  let logoW = 0;
  if (logo && logo.w > 0 && logo.h > 0) {
    logoW = (logo.w / logo.h) * LOGO_H;
  }

  const companyName    = org?.name    || 'Your Company';
  const companyAddress = org?.address || '';
  const addressLines   = companyAddress.split('\n').map(l => l.trim()).filter(Boolean);

  const slipCodeMap = buildShortCodeMap(orders.map(o => o.orderNumber).filter(Boolean));

  // Sort by shortcode so slips print in ref-code order (AA … ZZ)
  const sortedForPrint = [...orders].sort((a, b) => {
    const ca = slipCodeMap.get(a.orderNumber) ?? shortCode(a.orderNumber);
    const cb = slipCodeMap.get(b.orderNumber) ?? shortCode(b.orderNumber);
    return ca.localeCompare(cb);
  });

  for (let idx = 0; idx < sortedForPrint.length; idx++) {
    const order = sortedForPrint[idx];
    if (idx > 0) doc.addPage();
    const orderStartPage = (doc.internal as any).getNumberOfPages();
    // Explicitly switch to this order's starting page so the footer loop's
    // setPage() calls don't leave the cursor on the wrong page for the next order.
    doc.setPage(orderStartPage);
    let y = MY;

    // Pre-load grayscale images for all items in this order
    const itemImageUrls = await Promise.all(
      order.items.map(item =>
        loadItemImageForPDF({
          partNumber: item.bricklinkPartNumber,
          colorId:    item.colorId,
          imageUrl:   item.imageUrl,
          itemType:   item.itemType,
          lotId:      item.inventoryId ? parseInt(item.inventoryId, 10) || null : null,
        })
      )
    );

    // ── Company info (left) + logo (right) ──────────────────────────────────
    const headerTopY = y;
    const headerH    = Math.max(LOGO_H, 23);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(19);
    doc.setFont('helvetica', 'bold');
    doc.text(companyName, MX, y + 5);
    const companyNameW = doc.getTextWidth(companyName);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 51, 51);
    let addrLineY = y + 12;
    let maxAddrW  = 0;
    addressLines.forEach(line => {
      doc.text(line, MX, addrLineY);
      const w = doc.getTextWidth(line);
      if (w > maxAddrW) maxAddrW = w;
      addrLineY += 6;
    });

    if (logo && logoW > 0) {
      doc.addImage(logo.dataUrl, 'PNG', MX + CONTENT_W - logoW, headerTopY, logoW, LOGO_H);
    }

    // ── Shortcode stamp — placed just to the right of the company name/address
    const sc          = slipCodeMap.get(order.orderNumber) ?? shortCode(order.orderNumber);
    const STAMP_PT    = 42;
    const STAMP_CAP   = STAMP_PT * 0.352 * 0.70;   // cap-height in mm
    const sPad    = 4;                              // padding inside border

    doc.setFontSize(STAMP_PT);
    doc.setFont('helvetica', 'bold');
    const scTextW = doc.getTextWidth(sc);
    const boxW    = scTextW + sPad * 2;
    const boxH    = STAMP_CAP + sPad * 2;
    // Anchor to the right edge of the company-name/address block, with a small
    // gap. Falls back gracefully if the logo would overlap.
    const nameBlockW = Math.max(companyNameW, maxAddrW);
    const logoLeftX  = (logo && logoW > 0) ? (MX + CONTENT_W - logoW) : (MX + CONTENT_W);
    const desiredX   = MX + nameBlockW + 6;
    const boxX       = Math.min(desiredX, logoLeftX - boxW - 4);
    const boxY    = headerTopY + 1;                // top-aligned in header
    const stampY  = boxY + sPad + STAMP_CAP;       // text baseline inside box

    const stampTier = shippingTier(order.requestedService);
    if (stampTier === 'express') {
      doc.setFillColor(144, 202, 249); // Material Blue-200 — noticeable, black text reads fine
    } else if (stampTier === 'priority') {
      doc.setFillColor(239, 154, 154); // Material Red-200 — noticeable, black text reads fine
    } else {
      doc.setFillColor(248, 248, 248);
    }
    doc.setDrawColor(35, 35, 35);
    doc.setLineWidth(1.4);
    doc.roundedRect(boxX, boxY, boxW, boxH, 2, 2, 'FD');

    doc.setTextColor(15, 15, 15);
    doc.text(sc, boxX + boxW / 2, stampY, { align: 'center' });

    // Small caption below stamp
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text('for internal use only', boxX + boxW / 2, boxY + boxH + 3.5, { align: 'center' });

    y += headerH + 3;

    // ── Divider ─────────────────────────────────────────────────────────────
    doc.setDrawColor(170, 170, 170);
    doc.setLineWidth(0.2);
    doc.line(MX, y, MX + CONTENT_W, y);
    y += 5;

    // ── Ship To (left) + Order meta (right) ─────────────────────────────────
    const infoTopY = y;
    const { shipTo } = order;
    const street1  = shipTo.street1 || (shipTo as any).address1 || '';
    const street2  = shipTo.street2 || (shipTo as any).address2 || '';
    const cityLine = [shipTo.city, shipTo.state, shipTo.postalCode].filter(Boolean).join(' ');
    const showCtry = shipTo.country && shipTo.country !== 'US';

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('Ship To', MX, y + 5);

    doc.setFont('helvetica', 'normal');
    const shipAddrLines = [
      shipTo.name, shipTo.company, street1, street2, cityLine,
      showCtry ? shipTo.country : undefined,
    ].filter(Boolean) as string[];

    let shipAddrY = y + 11;
    shipAddrLines.forEach(line => { doc.text(line, MX, shipAddrY); shipAddrY += 5.5; });

    const metaX  = MX + CONTENT_W;
    const labelX = metaX - 48;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(85, 85, 85);
    doc.text(`${channelLabel(order)} Order #`, labelX, infoTopY + 5,  { align: 'right' });
    doc.text('Date',                           labelX, infoTopY + 11, { align: 'right' });
    if (order.requestedService) {
      doc.text('Ship Via', labelX, infoTopY + 17, { align: 'right' });
    }

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text(order.orderNumber, metaX, infoTopY + 5,  { align: 'right' });
    const dateStr = order.orderDate ? formatDate(order.orderDate, tz) : '';
    doc.text(dateStr, metaX, infoTopY + 11, { align: 'right' });
    const serviceDisplay = (() => {
      // Prefer the clean EasyPost carrier + service fields written when a label is purchased
      const fromEasyPost = [order.carrierCode, order.serviceCode].filter(Boolean).join(' ');
      if (fromEasyPost) return fromEasyPost;
      // Fall back to stripping cost/packaging noise from the raw BrickLink service string
      if (!order.requestedService) return null;
      const cut = order.requestedService.search(/ \$\d| - \$| \(\$| {2,}\(|\|/);
      return (cut > 0 ? order.requestedService.slice(0, cut) : order.requestedService).trim();
    })();
    let svcLines: string[] = [];
    if (serviceDisplay) {
      // Wrap service text to fit within the value column (48mm wide).
      const maxSvcW = 48 - 1; // 1mm margin
      svcLines = doc.splitTextToSize(serviceDisplay, maxSvcW);
      // Draw a single highlight rect behind ALL wrapped lines when priority/express
      if (stampTier && svcLines.length > 0) {
        const maxLineW = Math.max(...svcLines.map((l: string) => doc.getTextWidth(l)));
        const firstLineY = infoTopY + 17;
        const totalH = (svcLines.length - 1) * 5 + 4.6;
        doc.setFillColor(255, 235, 59);
        doc.setDrawColor(255, 235, 59);
        doc.rect(metaX - maxLineW - 1.5, firstLineY - 3.2, maxLineW + 3, totalH, 'F');
      }
      doc.setTextColor(0, 0, 0);
      svcLines.forEach((line: string, i: number) => {
        const lineY = infoTopY + 17 + i * 5;
        doc.text(line, metaX, lineY, { align: 'right' });
      });
      doc.setDrawColor(170, 170, 170);
    }

    const svcExtraLines = Math.max(0, svcLines.length - 1);
    y = Math.max(shipAddrY, infoTopY + (svcLines.length > 0 ? 24 + svcExtraLines * 5 : 18)) + 3;

    // ── Items table ──────────────────────────────────────────────────────────
    const IMG_COL = 14; // mm reserved on the left of the description cell for the image
    const rows = order.items.map(item => {
      const base  = cleanItemName(item.name, item.bricklinkPartNumber);
      const part  = item.bricklinkPartNumber ? ` (${item.bricklinkPartNumber})` : '';
      const name  = `${base}${part}`;
      const metaParts = [
        item.colorName ? `Color: ${item.colorName}`     : '',
        item.condition ? `Condition: ${item.condition}` : '',
      ].filter(Boolean);
      const meta    = metaParts.length > 0 ? metaParts.join(', ') : '';
      const comment = item.comment?.trim() || '';
      const line2   = [meta, comment].filter(Boolean).join('  \u00b7  ');
      return [line2 ? `${name}\n${line2}` : name, String(item.quantity)];
    });

    autoTable(doc, {
      startY: y,
      margin: { left: MX, right: MX },
      head: [['Description', 'Qty']],
      body: rows,
      styles: {
        fontSize:    11,
        cellPadding: { top: 3.5, right: 3.5, bottom: 3.5, left: 3.5 },
        textColor:   [0, 0, 0],
        lineColor:   [220, 220, 220],
        lineWidth:   0.1,
        overflow:    'linebreak',
      },
      headStyles: {
        fillColor:   [255, 255, 255],
        textColor:   [0, 0, 0],
        fontStyle:   'bold',
        fontSize:    10,
        lineColor:   [85, 85, 85],
        lineWidth:   { bottom: 0.4 },
      },
      bodyStyles: {
        minCellHeight: 14,
      },
      alternateRowStyles: { fillColor: [245, 245, 245] },
      columnStyles: {
        0: { cellWidth: 'auto', cellPadding: { top: 3.5, right: 3.5, bottom: 3.5, left: IMG_COL + 2 } },
        1: { cellWidth: 18, halign: 'right', fontStyle: 'bold' },
      },
      didDrawCell: (data: any) => {
        if (data.column.index === 0 && data.row.section === 'body') {
          const imgUrl = itemImageUrls[data.row.index];
          if (imgUrl) {
            const imgSize = 12;
            const imgX = data.cell.x + 1;
            const imgY = data.cell.y + (data.cell.height - imgSize) / 2;
            try { doc.addImage(imgUrl, 'PNG', imgX, imgY, imgSize, imgSize); } catch {}
          }
        }
      },
    });

    // ── Footer: Page X of Y on every page for this order ────────────────────
    const orderEndPage   = (doc.internal as any).getNumberOfPages();
    const orderPageTotal = orderEndPage - orderStartPage + 1;
    const footerLabel    = `${channelLabel(order)} Order # ${order.orderNumber}  \u00b7  Ref ${sc}`;

    for (let p = orderStartPage; p <= orderEndPage; p++) {
      doc.setPage(p);
      const pageInOrder = p - orderStartPage + 1;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(102, 102, 102);
      doc.text(
        `${footerLabel}  \u00b7  Page ${pageInOrder} of ${orderPageTotal}`,
        PAGE_W / 2,
        PAGE_H - 2,
        { align: 'center' },
      );
    }
  }

  hiddenPrint(doc.output('blob'), 'packing-slips.pdf');
}

export default function PackingSlip({ orders }: PackingSlipProps) {
  return null;
}
