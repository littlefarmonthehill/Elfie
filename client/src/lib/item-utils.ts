/** Blue tier: express, overnight, next day, same day, rush */
const EXPRESS_REGEX = /express|overnight|next[\s-]day|same[\s-]day|rush/i;

/** Red tier: priority, expedited, 2-day, 2nd day */
const PRIORITY_REGEX = /priority|expedited|2-day|2nd[\s-]day/i;

/**
 * Returns the shipping urgency tier for a service name.
 * 'express' (blue) beats 'priority' (red) when both keywords appear.
 */
export function shippingTier(service: string | null | undefined): 'express' | 'priority' | null {
  if (!service) return null;
  if (EXPRESS_REGEX.test(service)) return 'express';
  if (PRIORITY_REGEX.test(service)) return 'priority';
  return null;
}

/**
 * Decode common HTML/XML numeric and named entities so PDFs/labels never show
 * raw "&#40;" or "&amp;". BrickLink's API frequently returns parens encoded.
 */
function decodeEntities(s: string): string {
  if (!s) return s;
  return s
    .replace(/&#(\d+);/g, (_, n) => {
      const cp = Number(n);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const cp = parseInt(h, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : _;
    })
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

export function cleanItemName(name: string, partNumber: string | null | undefined): string {
  const decoded = decodeEntities(name || '');
  if (!decoded || !partNumber) return decoded;
  // Strip BL-style prefix: "3001 - Brick 2x4" → "Brick 2x4"
  const prefix = `${partNumber} - `;
  if (decoded.startsWith(prefix)) return decoded.slice(prefix.length).trim();
  // Strip BO-style suffix: "Brick 2x4 (3001)" → "Brick 2x4"
  const suffix = ` (${partNumber})`;
  if (decoded.endsWith(suffix)) return decoded.slice(0, -suffix.length).trim();
  return decoded;
}

export function toggleSetItem<T>(prev: Set<T>, item: T): Set<T> {
  const next = new Set(prev);
  if (next.has(item)) {
    next.delete(item);
  } else {
    next.add(item);
  }
  return next;
}
