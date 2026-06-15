import type { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { appSettings, orders } from '@shared/schema';
import { eq, sql, like, or } from 'drizzle-orm';
import { decodeHTML } from 'entities';

/**
 * Wraps an async route handler so errors are forwarded to Express's error
 * pipeline instead of requiring a try/catch in every handler.
 */
export function asyncRoute(
  fn: (req: any, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Get the requesting user's orgId — respects super-admin impersonation.
 */
export function reqOrgId(req: any): string {
  if (req.session?.impersonatingOrgId) return req.session.impersonatingOrgId;
  return (req.user as any)?.orgId ?? 'org_planetbrick';
}

// ─── Secret masking ───────────────────────────────────────────────────────────

export const SECRET_FIELDS = [
  'openaiApiKey',
  'stripeSecretKey',
  'easypostApiKey',
  'easypostTestApiKey',
] as const;

export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return '········';
  return value.substring(0, 4) + '····' + value.substring(value.length - 4);
}

export function maskSettingsSecrets(settings: Record<string, any> | null): Record<string, any> | null {
  if (!settings) return settings;
  const masked = { ...settings };
  for (const field of SECRET_FIELDS) {
    const val = masked[field];
    masked[field] = maskSecret(val);
    masked[`has_${field}`] = !!val;
  }
  return masked;
}

// ─── Org settings helpers ─────────────────────────────────────────────────────

/**
 * Fetch org's app settings, creating a default row if none exists yet.
 * This is the canonical way to read settings in route handlers.
 */
export async function getOrgSettings(orgId: string) {
  const [existing] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, orgId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(appSettings)
    .values({ id: orgId, orgId, aiEnabled: true })
    .onConflictDoUpdate({ target: appSettings.id, set: { orgId, updatedAt: new Date() } })
    .returning();
  return created;
}

export async function updateOrgSettings(orgId: string, values: Record<string, unknown>) {
  await db.update(appSettings).set({ ...values as any, updatedAt: new Date() }).where(eq(appSettings.id, orgId));
}

/** Fetch the org's IANA timezone string (default: 'America/Chicago'). */
export async function getOrgTimezone(orgId: string): Promise<string> {
  const [row] = await db.select({ tz: appSettings.orgTimezone })
    .from(appSettings)
    .where(eq(appSettings.id, orgId))
    .limit(1);
  return row?.tz ?? 'America/Chicago';
}

// ─── SQL helpers ──────────────────────────────────────────────────────────────

/**
 * Resolves an item name from bl_catalog with a colorId=0 fallback,
 * then falls back to price_guide_cache.item_name.
 * Used in every SELECT clause that reads item names from bl_catalog.
 */
export const resolvedCatalogItemName = (itemNoRef: any, itemTypeRef: any, colorIdRef: any) =>
  sql<string | null>`COALESCE(
    (SELECT item_name FROM bl_catalog WHERE item_no = ${itemNoRef} AND item_type = ${itemTypeRef} ORDER BY (color_id = ${colorIdRef})::int DESC, color_id ASC LIMIT 1),
    (SELECT item_name FROM price_guide_cache WHERE item_no = ${itemNoRef} AND item_type = ${itemTypeRef} AND item_name IS NOT NULL AND item_name != '' LIMIT 1)
  )`;

/**
 * Shared WHERE clause for "active" orders used across picklist routes.
 * Returns a new expression each call (Drizzle builders are not reusable across queries).
 */
export function activeOrderStatusWhere() {
  return or(
    like(orders.orderStatus, '%awaiting_payment%'),
    like(orders.orderStatus, '%awaiting_shipment%'),
    like(orders.orderStatus, '%awaiting_fulfillment%')
  );
}

// ─── Text utilities ───────────────────────────────────────────────────────────

/**
 * Decode HTML entities from BrickLink/BrickOwl notes for accurate comparison.
 * Uses the `entities` package so ALL named + numeric HTML entities are decoded.
 * Non-breaking spaces are normalised to ASCII space; CRLF/CR → LF.
 */
export function decodeHtmlEntities(text: string | null | undefined): string {
  if (!text) return '';
  return decodeHTML(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

// ─── Date/time helpers ────────────────────────────────────────────────────────

/**
 * Returns timezone-aware SQL raw fragments for a date range, anchored to the
 * org's local timezone. Period-aligned ranges use PostgreSQL AT TIME ZONE so
 * boundaries are computed against the org's local clock, not UTC.
 */
export function tzDateBounds(
  range: string,
  tz: string
): { start: ReturnType<typeof sql.raw> | null; end: ReturnType<typeof sql.raw> | null } {
  const safeTz = /^[A-Za-z0-9/_+\-]+$/.test(tz) ? tz : 'America/Chicago';
  const tzMon = (n: number) => n === 0
    ? `(DATE_TRUNC('month', NOW() AT TIME ZONE '${safeTz}') AT TIME ZONE '${safeTz}')`
    : `(DATE_TRUNC('month', (NOW() AT TIME ZONE '${safeTz}') + INTERVAL '${n} months') AT TIME ZONE '${safeTz}')`;
  const tzYear = (n: number) => n === 0
    ? `(DATE_TRUNC('year', NOW() AT TIME ZONE '${safeTz}') AT TIME ZONE '${safeTz}')`
    : `(DATE_TRUNC('year', (NOW() AT TIME ZONE '${safeTz}') + INTERVAL '${n} years') AT TIME ZONE '${safeTz}')`;
  switch (range) {
    case 'mtd':       return { start: sql.raw(tzMon(0)),  end: null };
    case 'lastmonth': return { start: sql.raw(tzMon(-1)), end: sql.raw(tzMon(0)) };
    case '3months':   return { start: sql.raw(`(NOW() - INTERVAL '3 months')`), end: null };
    case '1year':
    case '1y':        return { start: sql.raw(`(NOW() - INTERVAL '1 year')`),   end: null };
    case 'prevyear':  return { start: sql.raw(tzYear(-1)), end: sql.raw(tzYear(0)) };
    default:          return { start: null, end: null };
  }
}
