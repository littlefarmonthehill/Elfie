/**
 * Shared image resolution for LEGO parts across all views.
 *
 * Priority order for every inventory item:
 *   1. imageUrl stored in the database (Rebrickable or other corrected source)
 *   2. BrickLink color-specific CDN  (ItemImage/PN/{colorId}/{itemNo}.png)
 *   3. BrickLink shape-only CDN      (PL/{itemNo}.jpg)
 *
 * Rebrickable images must pass through /api/images/proxy because the
 * Rebrickable CDN blocks direct browser requests with CORS/hotlink protection.
 * BrickLink images load directly in <img> tags with no proxy required.
 *
 * ⚠️  PDF / canvas context (printPicklist):
 *   BrickLink CDN does NOT send CORS headers. Loading a BrickLink URL into an
 *   HTMLImageElement and then drawing it to a canvas taints the canvas, making
 *   canvas.toDataURL() throw a SecurityError — even though the image displays
 *   fine in an <img> tag. For PDF generation, ALL images must be fetched
 *   server-side via /api/images/parts/:partNum/:colorId, which proxies the
 *   BrickLink CDN and returns a same-origin PNG. See PackingSlip.tsx and
 *   server/services/image-proxy.ts for the full implementation.
 *
 * ⚠️  bl_catalog.imageUrl reliability (as of March 2026):
 *   ~99% of rows have NULL imageUrl — the field is sparsely populated.
 *   ~22 rows contain legacy protocol-relative //img.bricklink.com/... URLs.
 *   Never rely solely on the stored URL; always fall through to the constructed
 *   BrickLink CDN URLs using partNumber + colorId.
 */

export function proxiedUrl(url: string | null | undefined): string | null {
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
): string[] {
  const srcs: string[] = [];

  // 1. DB image (Rebrickable or other corrected source), proxied if needed
  const primary = proxiedUrl(imageUrl);
  if (primary) srcs.push(primary);

  if (partNumber) {
    const typeCode =
      itemType === 'MINIFIG' ? 'MN' : itemType === 'SET' ? 'SN' : 'PN';

    // 2. BrickLink color-specific CDN (colorId 0 is valid for minifigs)
    if (colorId != null) {
      srcs.push(
        `https://img.bricklink.com/ItemImage/${typeCode}/${colorId}/${partNumber}.png`,
      );
    }

    // 3. BrickLink shape-only CDN (reliable, no color info)
    srcs.push(`https://img.bricklink.com/PL/${partNumber}.jpg`);
  }

  return srcs;
}

/** Single "best" URL for non-React contexts (e.g. print HTML). */
export function resolvePartImageUrl(
  imageUrl: string | null | undefined,
  partNumber?: string | null,
  colorId?: number | null,
  itemType?: string | null,
): string | null {
  const srcs = partImageSources(imageUrl, partNumber, colorId, itemType);
  return srcs[0] ?? null;
}
