import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// ─── Shared number & currency formatters ───────────────────────────────────────
// Import from here instead of defining formatCurrency / formatNumber per-component.

const _currencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const _currencyFmtCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Format a number or numeric string as US currency.
 * Returns "$0.00" for null/undefined/NaN values.
 * @param compact  When true, omits cents (e.g. "$1,234" instead of "$1,234.00").
 */
export function formatCurrency(value: number | string | null | undefined, compact = false): string {
  const n = typeof value === 'string' ? parseFloat(value) : (value ?? 0);
  if (isNaN(n) || value == null) return '$0.00';
  return compact ? _currencyFmtCompact.format(n) : _currencyFmt.format(n);
}

/**
 * Format a number with locale-aware thousands separators.
 * Returns "0" for null/undefined/NaN values.
 */
export function formatNumber(value: number | null | undefined, decimals?: number): string {
  if (value == null || isNaN(value)) return '0';
  if (decimals !== undefined) return value.toFixed(decimals);
  return value.toLocaleString('en-US');
}

/**
 * Format a number as a percentage string, e.g. "12.3%".
 * Returns "0.0%" for null/undefined/NaN values.
 */
export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value == null || isNaN(value)) return `0.${'0'.repeat(decimals)}%`;
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format a delta with a leading "+" for positive values, e.g. "+5.2%" or "-3.1%".
 */
export function formatDelta(value: number | null | undefined, decimals = 1, suffix = '%'): string {
  if (value == null || isNaN(value)) return `0.${'0'.repeat(decimals)}${suffix}`;
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}${suffix}`;
}

/**
 * Truncate a string to maxLength characters, appending "…" when truncated.
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - 1) + '…';
}

/**
 * Format a sync change-log value for display.
 * Handles currency fields, booleans, null/empty, and long strings.
 * Used by ChannelSyncPanel and BrickLinkSyncPanel — do not duplicate locally.
 */
export function fmtChangeVal(field: string, value: string | null | undefined): string {
  if (value == null || value === '' || value === 'null') return '—';
  if (field === 'unitPrice' || field.includes('Price') || field.includes('price')) {
    const n = parseFloat(value);
    return isNaN(n) ? value : `$${n.toFixed(2)}`;
  }
  if (value === 'true') return 'Yes';
  if (value === 'false') return 'No';
  if (value.length > 32) return value.slice(0, 30) + '…';
  return value;
}
