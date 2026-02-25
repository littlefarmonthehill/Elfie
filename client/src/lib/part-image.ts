/**
 * Shared image resolution for LEGO parts across all views.
 *
 * Priority order for every inventory item:
 *   1. imageUrl stored in the database (Rebrickable or other corrected source)
 *   2. BrickLink color-specific CDN  (ItemImage/PN/{colorId}/{itemNo}.png)
 *   3. BrickLink shape-only CDN      (PL/{itemNo}.jpg)
 *
 * Rebrickable images must pass through our server proxy because the
 * Rebrickable CDN blocks direct browser requests with CORS/hotlink protection.
 * BrickLink images load directly with no proxy required.
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

    // 2. BrickLink color-specific CDN
    if (colorId) {
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
