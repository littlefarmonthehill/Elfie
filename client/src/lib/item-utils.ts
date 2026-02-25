export const PRIORITY_REGEX = /priority|express|overnight|expedited|2-day|2nd.day|next.day|same.day|rush/i;

export function cleanItemName(name: string, partNumber: string | null | undefined): string {
  if (!name || !partNumber) return name || '';
  const prefix = `${partNumber} - `;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
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
