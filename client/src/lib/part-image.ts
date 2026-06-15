/**
 * Shared image resolution for LEGO parts across all views.
 *
 * Priority order for every inventory item:
 *   0. Global lot resolver  /api/images/lot/:lotId
 *        → single source of truth when a BL inventory lot ID is available
 *        → checks user-assigned images (lot-level → item-type-level) first,
 *          then falls back to catalog image (object storage → CDN → processed PNG).
 *        → works for ALL channels: BrickLink orders, BrickOwl orders, inventory, picklist.
 *   1. Server proxy  /api/images/parts/:partNum/:colorId
 *        → checks object storage (L2) first, falls back to BL CDN (L3),
 *          processes PNG (white-bg removal), and caches permanently.
 *        → same bytes the picklist PDF renders — UI and PDF are consistent.
 *   2. Database imageUrl (Rebrickable or BL CDN URL), proxied if needed.
 *   3. BrickLink CDN direct (legacy fallback if proxy unreachable).
 *
 * Note: As of March 2026, bl_catalog.imageUrl is populated for all
 * P/PART/MINIFIG/SET/GEAR rows after the Phase-57 migration.
 *
 * PDF / canvas context (PackingSlip.tsx):
 *   BrickLink CDN does NOT send CORS headers — drawing a BL URL to a canvas
 *   taints it, making canvas.toDataURL() throw a SecurityError. PDF generation
 *   MUST use the server proxy (/api/images/parts/:partNum/:colorId). The proxy
 *   is same-origin and returns processed PNG safe for canvas use.
 */

function proxiedUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.includes('img.bricklink.com')) return url;
  return `/api/images/proxy?url=${encodeURIComponent(url)}`;
}

/** All candidate URLs for a part, in priority order. */
export function partImageSources(
  imageUrl: string | null | undefined,
  partNumber: string | null | undefined,
  colorId: number | null | undefined,
  itemType?: string | null,
  lotId?: number | null,
): string[] {
  const srcs: string[] = [];

  // 0. Global lot resolver — user images + catalog, single entry point by lot ID.
  if (lotId) {
    srcs.push(`/api/images/lot/${lotId}`);
  }

  if (partNumber && colorId != null) {
    // 1. Server proxy — object storage (persistent) → CDN → processed PNG.
    //    Same source as picklist PDF so UI and PDF are always consistent.
    srcs.push(`/api/images/parts/${encodeURIComponent(partNumber)}/${colorId}`);
  }

  // 2. DB image (Rebrickable or BL CDN), proxied through server if needed
  const dbSrc = proxiedUrl(imageUrl);
  if (dbSrc && !srcs.includes(dbSrc)) srcs.push(dbSrc);

  if (partNumber) {
    const typeCode =
      itemType === 'MINIFIG' ? 'MN' : itemType === 'SET' ? 'SN' : 'PN';

    // 3. BrickLink CDN direct (fallback when server proxy is unreachable)
    if (colorId != null) {
      srcs.push(
        `https://img.bricklink.com/ItemImage/${typeCode}/${colorId}/${partNumber}.png`,
      );
    }

    // 4. BrickLink shape-only CDN (no color, last resort)
    srcs.push(`https://img.bricklink.com/PL/${partNumber}.jpg`);
  }

  return srcs;
}

/** Single "best" URL for non-React contexts (e.g. print HTML). */
function resolvePartImageUrl(
  imageUrl: string | null | undefined,
  partNumber?: string | null,
  colorId?: number | null,
  itemType?: string | null,
  lotId?: number | null,
): string | null {
  const srcs = partImageSources(imageUrl, partNumber, colorId, itemType, lotId);
  return srcs[0] ?? null;
}
