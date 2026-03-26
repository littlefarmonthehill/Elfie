/** Blue tier: express, overnight, next day, same day, rush */
export const EXPRESS_REGEX = /express|overnight|next[\s-]day|same[\s-]day|rush/i;

/** Red tier: priority, expedited, 2-day, 2nd day */
export const PRIORITY_REGEX = /priority|expedited|2-day|2nd[\s-]day/i;

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

export function cleanItemName(name: string, partNumber: string | null | undefined): string {
  if (!name || !partNumber) return name || '';
  // Strip BL-style prefix: "3001 - Brick 2x4" → "Brick 2x4"
  const prefix = `${partNumber} - `;
  if (name.startsWith(prefix)) return name.slice(prefix.length);
  // Strip BO-style suffix: "Brick 2x4 (3001)" → "Brick 2x4"
  const suffix = ` (${partNumber})`;
  if (name.endsWith(suffix)) return name.slice(0, -suffix.length).trim();
  return name;
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
