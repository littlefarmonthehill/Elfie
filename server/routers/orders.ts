import { randomUUID } from "crypto";
import { Router } from "express";
import OpenAI from "openai";
import { z } from "zod";
import { eq, desc, sql, inArray, notInArray, or, and, isNotNull, isNull, ne, like } from "drizzle-orm";
import { db } from "../db";
import { broadcast } from "../sse";
import { asyncRoute, reqOrgId } from "../lib/routeHelpers";
import { apiErrorHandler } from "../middleware/errorHandler";
import { isApproved } from "../auth";
import { getPlatformOpenAIKey } from "../routes";
import {
  orders, orderDetails, blInventory, blCatalog, blCategories, blColors,
  appSettings, insertAppSettingsSchema, orgIntegrations, shipments, eodForms,
  orderAdjustments, insertOrderAdjustmentSchema, updateFulfillmentSchema,
  inventoryLocations, whBins, whShelves, whAisles, picklistItems,
  shippingServiceMappings, pushSubscriptions, channelSyncConfig,
  blApiCalls, syncMetadata, PLATFORM_ORG_ID, insertPicklistItemSchema,
} from "@shared/schema";

const router = Router();

// ── Local helpers (mirrors module-scope functions in routes.ts) ───────────────

function activeOrderStatusWhere() {
  return or(
    like(orders.orderStatus, '%awaiting_payment%'),
    like(orders.orderStatus, '%awaiting_shipment%'),
    like(orders.orderStatus, '%awaiting_fulfillment%')
  );
}

const SECRET_FIELDS = [
  'openaiApiKey',
  'stripeSecretKey',
  'easypostApiKey',
  'easypostTestApiKey',
] as const;

function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.length <= 8) return '········';
  return value.substring(0, 4) + '····' + value.substring(value.length - 4);
}

function maskSettingsSecrets(settings: Record<string, any> | null): Record<string, any> | null {
  if (!settings) return settings;
  const masked = { ...settings };
  for (const field of SECRET_FIELDS) {
    const val = masked[field];
    masked[field] = maskSecret(val);
    masked[`has_${field}`] = !!val;
  }
  return masked;
}

async function getOrgSettings(orgId: string) {
  const [existing] = await db.select().from(appSettings).where(eq(appSettings.id, orgId)).limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(appSettings)
    .values({ id: orgId, orgId, aiEnabled: true })
    .onConflictDoUpdate({ target: appSettings.id, set: { orgId, updatedAt: new Date() } })
    .returning();
  return created;
}

async function getOrgTimezone(orgId: string): Promise<string> {
  const [row] = await db.select({ tz: appSettings.orgTimezone }).from(appSettings).where(eq(appSettings.id, orgId)).limit(1);
  return row?.tz ?? 'America/Chicago';
}

function tzDateBounds(range: string, tz: string): { start: ReturnType<typeof sql.raw> | null; end: ReturnType<typeof sql.raw> | null } {
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
    case '1y':        return { start: sql.raw(`(NOW() - INTERVAL '1 year')`), end: null };
    case 'prevyear':  return { start: sql.raw(tzYear(-1)), end: sql.raw(tzYear(0)) };
    default:          return { start: null, end: null };
  }
}

// LAN printer guard
const isLanIp = (ip: string) =>
  /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|::1$|localhost)/i.test(ip.trim());

const LAN_PRINT_ERROR =
  'Direct ZPL printing from the cloud server cannot reach your local printer. ' +
  'Your printer IP is a private network address that is only accessible from your own device. ' +
  "To print labels: open Settings → Printing and switch to \"Use my device's printer\" (browser print), " +
  'or point the IP to a printer that is publicly accessible on the internet.';

// ── Orders — bulk operations ──────────────────────────────────────────────────

router.get("/orders/closed-preview", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const count = await db.select({ count: sql<number>`count(*)` })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), or(eq(orders.orderStatus, 'shipped'), eq(orders.orderStatus, 'completed'), eq(orders.orderStatus, 'returned'), eq(orders.orderStatus, 'cancelled'), eq(orders.orderStatus, 'Cancelled'))));
  res.json({ count: Number(count[0]?.count) || 0 });
}));

router.delete("/orders/closed", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const result = await db.delete(orders).where(and(eq(orders.orgId, orgId), or(eq(orders.orderStatus, 'shipped'), eq(orders.orderStatus, 'completed'), eq(orders.orderStatus, 'returned'), eq(orders.orderStatus, 'cancelled'), eq(orders.orderStatus, 'Cancelled')))).returning({ id: orders.id });
  res.json({ deleted: result.length });
}));

router.get("/orders/test-preview", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const [countResult, activeResult] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(orders).where(and(eq(orders.orgId, orgId), eq(orders.isTest, true), sql`${orders.orderStatus} != 'purged'`)),
    db.execute(sql`
      SELECT DISTINCT o.id FROM ${orders} o
      INNER JOIN order_details od ON od.order_id = o.id
      WHERE o.org_id = ${orgId} AND o.is_test = true AND o.order_status != 'purged'
    `),
  ]);
  res.json({
    count: Number(countResult[0]?.count) || 0,
    withActiveInventory: (activeResult.rows as any[]).map(r => r.id),
  });
}));

router.delete("/orders/test", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  // Soft-delete: set order_status = 'purged' instead of deleting the row.
  // This prevents the BrickLink/BrickOwl sync from re-importing the orders on
  // the next run — the sync skips any order whose local status is 'purged'.
  const result = await db
    .update(orders)
    .set({ orderStatus: 'purged', updatedAt: new Date() })
    .where(and(eq(orders.orgId, orgId), eq(orders.isTest, true), sql`${orders.orderStatus} != 'purged'`))
    .returning({ id: orders.id });
  res.json({ deleted: result.length });
}));

// ── Orders — list & summary ───────────────────────────────────────────────────

router.get("/orders/summary", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const range = req.query.range as string | undefined;
  const tz = await getOrgTimezone(orgId);
  const { start, end } = tzDateBounds(range ?? '', tz);

  const result = await db.execute(sql`
    SELECT
      o.id,
      o.order_number   AS order_number,
      o.marketplace,
      o.order_date     AS order_date,
      o.order_status   AS order_status,
      o.order_total    AS order_total,
      o.customer_username AS customer_username,
      o.ship_date      AS ship_date
    FROM ${orders} o
    WHERE o.org_id = ${orgId}
      AND o.is_test = false
      AND o.order_status != 'purged'
      ${start ? sql`AND o.order_date >= ${start}` : sql``}
      ${end   ? sql`AND o.order_date < ${end}`   : sql``}
    ORDER BY o.order_date DESC
    LIMIT 10000
  `);
  res.json(result.rows.map((r: any) => ({
    id:               r.id,
    orderNumber:      r.order_number,
    marketplace:      r.marketplace,
    orderDate:        r.order_date,
    orderStatus:      r.order_status,
    orderTotal:       r.order_total,
    customerUsername: r.customer_username,
    shipDate:         r.ship_date,
  })));
}));

router.get("/orders/top-items", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const range = req.query.range as string | undefined;
  const tz = await getOrgTimezone(orgId);
  const { start, end } = tzDateBounds(range ?? '', tz);

  const result = await db.execute(sql`
    SELECT
      bi.item_no AS item_no,
      COALESCE(bc.item_name, od.name) AS name,
      CASE WHEN bi.new_or_used = 'N' THEN 'New' WHEN bi.new_or_used = 'U' THEN 'Used' ELSE NULL END AS condition,
      SUM(od.quantity)::integer AS total_qty,
      SUM(od.quantity * COALESCE(od.unit_price::numeric, 0)) AS total_revenue,
      COUNT(DISTINCT od.order_id)::integer AS order_count
    FROM ${orderDetails} od
    JOIN ${orders} o ON od.order_id = o.id
    LEFT JOIN ${blInventory} bi ON CAST(bi.id AS TEXT) = od.sku
    LEFT JOIN ${blCatalog} bc ON bc.item_no = bi.item_no AND bc.item_type = bi.item_type AND bc.color_id = bi.color_id
    WHERE o.org_id = ${orgId}
      AND o.order_status NOT IN ('cancelled', 'Cancelled', 'returned')
      AND o.is_test = false
      ${start ? sql`AND o.order_date >= ${start}` : sql``}
      ${end   ? sql`AND o.order_date < ${end}`   : sql``}
    GROUP BY bi.item_no, COALESCE(bc.item_name, od.name), bi.new_or_used
    ORDER BY total_revenue DESC
    LIMIT 30
  `);
  res.json(result.rows.map((r: any) => ({
    itemNo:       r.item_no,
    name:         r.name,
    condition:    r.condition,
    totalQty:     Number(r.total_qty),
    totalRevenue: Number(r.total_revenue),
    orderCount:   Number(r.order_count),
  })));
}));

router.get("/orders/stats", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const range = req.query.range as string | undefined;
  const tz = await getOrgTimezone(orgId);
  const { start, end } = tzDateBounds(range ?? '', tz);

  const summaryResult = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE o.order_status NOT IN ('cancelled','Cancelled','returned','Returned') AND o.is_test = false) AS total_orders,
      COUNT(*) FILTER (WHERE (o.order_status ILIKE '%awaiting_payment%' OR o.order_status ILIKE '%awaiting_fulfillment%' OR o.order_status ILIKE '%awaiting_shipment%') AND o.is_test = false) AS pending_orders,
      COUNT(*) FILTER (WHERE o.order_status IN ('shipped','Shipped','completed','Completed') AND o.is_test = false) AS shipped_orders,
      COUNT(*) FILTER (WHERE o.order_status IN ('returned','Returned') AND o.is_test = false) AS returned_orders,
      COALESCE(SUM(o.order_total::numeric) FILTER (WHERE (o.order_status ILIKE '%awaiting_payment%' OR o.order_status ILIKE '%awaiting_fulfillment%' OR o.order_status ILIKE '%awaiting_shipment%') AND o.is_test = false), 0) AS pending_revenue,
      COALESCE(SUM(o.order_total::numeric) FILTER (WHERE o.order_status NOT IN ('cancelled','Cancelled','returned','Returned') AND o.is_test = false), 0) AS month_revenue,
      COALESCE((
        SELECT AVG(lot_count) FROM (
          SELECT od.order_id, COUNT(*) AS lot_count
          FROM ${orderDetails} od
          JOIN ${orders} oi ON oi.id = od.order_id
          WHERE oi.org_id = ${orgId}
            AND oi.is_test = false
            AND oi.order_status NOT IN ('cancelled','Cancelled','returned','Returned')
            ${start ? sql`AND oi.order_date >= ${start}` : sql``}
            ${end   ? sql`AND oi.order_date < ${end}`   : sql``}
          GROUP BY od.order_id
        ) sub
      ), 0) AS avg_lots_per_order
    FROM ${orders} o
    WHERE o.org_id = ${orgId}
      ${start ? sql`AND o.order_date >= ${start}` : sql``}
      ${end   ? sql`AND o.order_date < ${end}`   : sql``}
  `);

  const row = (summaryResult.rows[0] as any) ?? {};
  res.json({
    totalOrders:      Number(row.total_orders)       || 0,
    pendingOrders:    Number(row.pending_orders)      || 0,
    shippedOrders:    Number(row.shipped_orders)      || 0,
    returnedOrders:   Number(row.returned_orders)     || 0,
    pendingRevenue:   Number(row.pending_revenue)     || 0,
    monthRevenue:     Number(row.month_revenue)       || 0,
    avgLotsPerOrder:  Number(row.avg_lots_per_order)  || 0,
  });
}));

router.get("/orders/workflow-summary", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const result = await db.execute(sql`
    SELECT workflow_status, COUNT(*) AS count
    FROM ${orders}
    WHERE org_id = ${orgId}
      AND order_status IN ('awaiting_payment','awaiting_fulfillment','awaiting_shipment')
      AND is_test = false
    GROUP BY workflow_status
  `);
  const byStatus: Record<string, number> = {};
  for (const row of result.rows as any[]) {
    byStatus[row.workflow_status ?? 'new'] = Number(row.count);
  }
  res.json({ byStatus });
}));

router.get("/shipments/tracking-summary", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const result = await db.execute(sql`
    SELECT status, COUNT(*) AS count
    FROM (
      SELECT DISTINCT ON (o.id)
        COALESCE(NULLIF(s.tracking_status, 'unknown'), 'pre_transit') AS status
      FROM ${orders} o
      INNER JOIN ${shipments} s ON s.order_id = o.id AND s.status NOT IN ('voided', 'failed')
      WHERE o.org_id = ${orgId}
        AND o.order_status IN ('shipped','completed')
        AND o.is_test = false
      ORDER BY o.id, s.created_at DESC NULLS LAST
    ) sub
    GROUP BY status
  `);
  const byStatus: Record<string, number> = {};
  for (const row of result.rows as any[]) {
    let key: string = row.status;
    if (key === 'pre_transit') key = 'label_created';
    if (key === 'failure')     key = 'failed';
    byStatus[key] = (byStatus[key] ?? 0) + Number(row.count);
  }
  res.json({ byStatus });
}));

router.get("/orders/customer-stats", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const range = req.query.range as string | undefined;
  const tz = await getOrgTimezone(orgId);
  const { start, end } = tzDateBounds(range ?? '', tz);

  const result = await db.execute(sql`
    SELECT
      customer_username,
      COUNT(*) AS order_count,
      COALESCE(SUM(order_total::numeric), 0) AS total_spent
    FROM ${orders}
    WHERE org_id = ${orgId}
      AND is_test = false
      AND order_status NOT IN ('cancelled','Cancelled')
      ${start ? sql`AND order_date >= ${start}` : sql``}
      ${end   ? sql`AND order_date < ${end}`   : sql``}
    GROUP BY customer_username
    ORDER BY total_spent DESC
    LIMIT 50
  `);
  res.json(result.rows);
}));

router.get("/marketing/stock-matches", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const result = await db.execute(sql`
    SELECT
      o.customer_username,
      COUNT(DISTINCT od.item_no) AS match_count
    FROM orders o
    JOIN order_details od ON od.order_id = o.id
    JOIN bl_inventory bi
      ON  bi.item_no  = od.item_no
      AND bi.org_id   = ${orgId}
      AND bi.quantity > 0
      AND bi.deleted_at IS NULL
    WHERE o.org_id   = ${orgId}
      AND o.is_test  = false
      AND o.order_status NOT IN ('cancelled', 'Cancelled')
      AND od.item_no IS NOT NULL
      AND od.item_no != ''
    GROUP BY o.customer_username
    HAVING COUNT(DISTINCT od.item_no) > 0
    ORDER BY match_count DESC
  `);
  res.json(result.rows.map((r: any) => ({
    customerUsername: r.customer_username,
    matchCount: Number(r.match_count),
  })));
}));

router.get("/orders/dashboard", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const withAdjustments = sql`
    WITH adj AS (
      SELECT order_id,
        COALESCE(SUM(ABS(amount::numeric)) FILTER (WHERE type != 'merchant_fee'), 0) AS total_adj
      FROM order_adjustments
      GROUP BY order_id
    )
  `;
  const orderCols = sql`
    o.id, o.order_number, o.order_date, o.order_status,
    o.order_total, o.customer_username, o.marketplace,
    GREATEST(0, o.order_total::numeric - COALESCE(a.total_adj, 0)) AS net_total
  `;
  const [pendingOrders, recentShipments, highValueOrders] = await Promise.all([
    db.execute(sql`${withAdjustments} SELECT ${orderCols} FROM orders o LEFT JOIN adj a ON a.order_id = o.id WHERE o.org_id = ${orgId} AND o.order_status IN ('awaiting_payment','awaiting_shipment') AND o.is_test = false ORDER BY o.order_date DESC LIMIT 5`),
    db.execute(sql`${withAdjustments} SELECT ${orderCols} FROM orders o LEFT JOIN adj a ON a.order_id = o.id WHERE o.org_id = ${orgId} AND o.order_status = 'shipped' AND o.is_test = false ORDER BY o.order_date DESC LIMIT 5`),
    db.execute(sql`${withAdjustments} SELECT ${orderCols} FROM orders o LEFT JOIN adj a ON a.order_id = o.id WHERE o.org_id = ${orgId} AND o.order_total IS NOT NULL AND o.order_total::numeric > 0 AND o.order_status NOT IN ('cancelled','Cancelled') AND o.is_test = false ORDER BY net_total DESC LIMIT 5`),
  ]);
  const mapRow = (r: any) => ({
    id: r.id, orderNumber: r.order_number, orderDate: r.order_date,
    orderStatus: r.order_status, orderTotal: r.order_total, netTotal: r.net_total,
    customerUsername: r.customer_username, marketplace: r.marketplace, items: [],
  });
  res.json({
    pending: pendingOrders.rows.map(mapRow),
    recentShipments: recentShipments.rows.map(mapRow),
    highValue: highValueOrders.rows.map(mapRow),
  });
}));

router.get("/bridge/signals", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const [agingResult, repeatResult, thisWeekResult, lastWeekResult, marketNewsResult, businessIntelResult, trackingErrorResult] = await Promise.all([
    db.execute(sql`SELECT COUNT(*) AS count FROM orders WHERE org_id = ${orgId} AND is_test = false AND order_status IN ('awaiting_payment','awaiting_shipment') AND order_date < NOW() - INTERVAL '24 hours'`),
    db.execute(sql`SELECT COUNT(*) AS count FROM (SELECT customer_username FROM orders WHERE org_id = ${orgId} AND is_test = false AND order_status NOT IN ('cancelled','Cancelled') GROUP BY customer_username HAVING COUNT(*) >= 2) t`),
    db.execute(sql`SELECT COALESCE(SUM(order_total::numeric), 0) AS revenue FROM orders WHERE org_id = ${orgId} AND is_test = false AND order_status NOT IN ('cancelled','Cancelled','returned') AND order_date >= DATE_TRUNC('week', NOW())`),
    db.execute(sql`SELECT COALESCE(SUM(order_total::numeric), 0) AS revenue FROM orders WHERE org_id = ${orgId} AND is_test = false AND order_status NOT IN ('cancelled','Cancelled','returned') AND order_date >= DATE_TRUNC('week', NOW()) - INTERVAL '7 days' AND order_date < DATE_TRUNC('week', NOW())`),
    db.execute(sql`SELECT last_sync_time FROM sync_metadata WHERE id = 'market_news_sync' AND org_id = ${PLATFORM_ORG_ID} LIMIT 1`),
    db.execute(sql`SELECT last_sync_time FROM sync_metadata WHERE id = 'business_intel_sync' AND org_id = ${PLATFORM_ORG_ID} LIMIT 1`),
    // Shipments with a tracking number that haven't been successfully refreshed in 4+ hours
    // (stale beyond 2 automatic refresh cycles) — indicates tracking lookups are failing for them.
    // Only counts shipments older than 4h so brand-new labels don't show as errors.
    db.execute(sql`
      SELECT COUNT(*) AS count
      FROM shipments s
      JOIN orders o ON o.id = s.order_id
      WHERE s.org_id = ${orgId}
        AND s.status IN ('purchased', 'manifested')
        AND s.tracking_number IS NOT NULL
        AND (s.tracking_status IS NULL OR s.tracking_status != 'delivered')
        AND s.created_at < NOW() - INTERVAL '4 hours'
        AND (s.tracking_updated_at IS NULL OR s.tracking_updated_at < NOW() - INTERVAL '4 hours')
        AND o.is_test = false
    `),
  ]);
  const nowMs = Date.now();
  const msDays = (ms: number | null) => ms !== null ? Math.floor((nowMs - ms) / (1000 * 60 * 60 * 24)) : null;
  const marketNewsTime = marketNewsResult.rows[0]?.last_sync_time ? new Date(marketNewsResult.rows[0].last_sync_time as string).getTime() : null;
  const businessIntelTime = businessIntelResult.rows[0]?.last_sync_time ? new Date(businessIntelResult.rows[0].last_sync_time as string).getTime() : null;
  res.json({
    agingOrders: Number((agingResult.rows[0] as any)?.count ?? 0),
    repeatBuyers: Number((repeatResult.rows[0] as any)?.count ?? 0),
    thisWeekRevenue: Number((thisWeekResult.rows[0] as any)?.revenue ?? 0),
    lastWeekRevenue: Number((lastWeekResult.rows[0] as any)?.revenue ?? 0),
    marketNewsFreshDays: msDays(marketNewsTime),
    businessIntelFreshDays: msDays(businessIntelTime),
    trackingErrors: Number((trackingErrorResult.rows[0] as any)?.count ?? 0),
  });
}));

// ── Orders — main listing ─────────────────────────────────────────────────────

router.get("/orders", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const {
    status, marketplace, search, range, page = '1', limit: limitStr = '50',
    sortBy = 'orderDate', sortDir = 'desc',
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page) || 1);
  const pageLimit = Math.min(500, parseInt(limitStr) || 50);
  const offset = (pageNum - 1) * pageLimit;

  const tz = await getOrgTimezone(orgId);
  const { start, end } = tzDateBounds(range ?? '', tz);

  const conditions: any[] = [eq(orders.orgId, orgId), sql`${orders.orderStatus} != 'purged'`];
  if (status && status !== 'all') {
    if (status === 'active') {
      conditions.push(or(eq(orders.orderStatus, 'awaiting_payment'), eq(orders.orderStatus, 'awaiting_fulfillment'), eq(orders.orderStatus, 'awaiting_shipment')));
    } else {
      conditions.push(eq(orders.orderStatus, status));
    }
  }
  if (marketplace && marketplace !== 'all') conditions.push(eq(orders.marketplace, marketplace));
  if (start) conditions.push(sql`${orders.orderDate} >= ${start}`);
  if (end)   conditions.push(sql`${orders.orderDate} < ${end}`);
  if (search?.trim()) {
    const q = `%${search.trim()}%`;
    conditions.push(or(
      sql`${orders.orderNumber} ILIKE ${q}`,
      sql`${orders.customerUsername} ILIKE ${q}`,
      sql`${orders.customerEmail} ILIKE ${q}`,
    ));
  }

  const where = and(...conditions);
  const [totalResult, rows] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(orders).where(where),
    db.select().from(orders).where(where)
      .orderBy(sortDir === 'asc' ? orders.orderDate : desc(orders.orderDate))
      .limit(pageLimit).offset(offset),
  ]);

  res.json({
    orders: rows,
    total: Number(totalResult[0]?.count) || 0,
    page: pageNum,
    limit: pageLimit,
  });
}));

// ── Shipped Orders ────────────────────────────────────────────────────────────

router.get("/orders/shipped", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const searchQuery = req.query.search as string;
  const range = req.query.range as string | undefined;
  const excludeDelivered = req.query.excludeDelivered === 'true';
  const deliveredOnly = req.query.deliveredOnly === 'true';
  const tz = await getOrgTimezone(orgId);
  const { start, end } = tzDateBounds(range ?? '', tz);
  const limit = searchQuery?.trim() ? 500 : 200;
  const searchWhere = searchQuery?.trim()
    ? sql`AND (o.order_number ILIKE ${'%' + searchQuery.trim() + '%'} OR o.customer_username ILIKE ${'%' + searchQuery.trim() + '%'} OR o.customer_email ILIKE ${'%' + searchQuery.trim() + '%'} OR s.tracking_number ILIKE ${'%' + searchQuery.trim() + '%'})`
    : sql``;
  const dateWhere = !excludeDelivered && (start && end)
    ? sql`AND COALESCE(o.ship_date, o.order_date) >= ${start} AND COALESCE(o.ship_date, o.order_date) < ${end}`
    : !excludeDelivered && start
      ? sql`AND COALESCE(o.ship_date, o.order_date) >= ${start}`
      : sql``;
  const deliveredWhere = excludeDelivered
    ? sql`AND COALESCE("trackingStatus", '') <> 'delivered'`
    : deliveredOnly
      ? sql`AND COALESCE("trackingStatus", '') = 'delivered'`
      : sql``;
  const rawRows = await db.execute(sql`
    SELECT * FROM (
      SELECT DISTINCT ON (o.id)
        o.id, o.order_number AS "orderNumber", o.order_date AS "orderDate", o.ship_date AS "shipDate",
        o.customer_username AS "customerUsername", o.customer_email AS "customerEmail",
        o.order_total AS "orderTotal", o.marketplace, o.ship_to AS "shipTo",
        o.order_status AS "orderStatus", o.is_test AS "isTest",
        s.tracking_number AS "trackingNumber", s.tracker_id AS "trackerId",
        s.tracking_status AS "trackingStatus", s.tracking_status_detail AS "trackingStatusDetail",
        s.tracking_updated_at AS "trackingUpdatedAt", s.carrier, s.service,
        s.label_url AS "labelUrl",
        COALESCE(o.ship_date, o.order_date) AS sort_date,
        COALESCE((SELECT SUM(ABS(amount::numeric)) FILTER (WHERE type = 'refund') FROM order_adjustments WHERE order_id = o.id), 0) AS "refundTotal"
      FROM orders o
      LEFT JOIN shipments s ON o.id = s.order_id AND s.status NOT IN ('voided', 'failed')
      WHERE o.org_id = ${orgId}
        AND o.order_status IN ('shipped','completed','returned','cancelled','Cancelled')
        ${dateWhere} ${searchWhere}
      ORDER BY o.id, s.created_at DESC NULLS LAST
    ) sub
    WHERE true ${deliveredWhere}
    ORDER BY sort_date DESC
    LIMIT ${limit}
  `);
  res.json(rawRows.rows);
}));

router.post("/orders/shipped/refresh-tracking", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { orderIds } = req.body as { orderIds?: string[] };
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({ error: "orderIds array required" });
  }
  const allRows = await db.select({
    id: shipments.id, orderId: shipments.orderId, trackingNumber: shipments.trackingNumber,
    carrier: shipments.carrier, trackerId: shipments.trackerId,
    trackingStatus: shipments.trackingStatus, trackingUpdatedAt: shipments.trackingUpdatedAt,
  }).from(shipments).where(and(
    eq(shipments.orgId, orgId),
    inArray(shipments.orderId, orderIds),
    isNotNull(shipments.trackingNumber),
    inArray(shipments.status, ['purchased', 'manifested']),
  )).orderBy(desc(shipments.createdAt));

  const seen = new Set<string>();
  const rows: typeof allRows = [];
  for (const r of allRows) {
    if (!seen.has(r.orderId)) { seen.add(r.orderId); rows.push(r); }
  }

  const RATE_LIMIT_MS = 2 * 60 * 1000;
  const now = Date.now();
  let vendor: any;
  try {
    const { getShippingVendor } = await import('../services/easypost');
    vendor = await getShippingVendor(undefined, orgId);
  } catch (e: any) {
    return res.status(503).json({ error: `EasyPost not configured: ${e.message}` });
  }

  const results: Record<string, { trackingStatus: string; trackingStatusDetail: string; trackingUpdatedAt: string }> = {};
  for (const row of rows) {
    if (row.trackingStatus === 'delivered') {
      results[row.orderId] = { trackingStatus: row.trackingStatus, trackingStatusDetail: '', trackingUpdatedAt: row.trackingUpdatedAt?.toISOString() ?? '' };
      continue;
    }
    if (row.trackingStatus && row.trackingUpdatedAt) {
      const age = now - new Date(row.trackingUpdatedAt).getTime();
      if (age < RATE_LIMIT_MS) {
        results[row.orderId] = { trackingStatus: row.trackingStatus, trackingStatusDetail: '', trackingUpdatedAt: row.trackingUpdatedAt.toISOString() };
        continue;
      }
    }
    try {
      let tracker: { id: string; status: string; statusDetail: string };
      if (row.trackerId) {
        tracker = await vendor.getTracker(row.trackerId);
      } else {
        tracker = await vendor.createOrGetTracker(row.trackingNumber, row.carrier);
      }
      await db.update(shipments).set({ trackerId: tracker.id, trackingStatus: tracker.status, trackingStatusDetail: tracker.statusDetail, trackingUpdatedAt: new Date() }).where(eq(shipments.id, row.id));
      results[row.orderId] = { trackingStatus: tracker.status, trackingStatusDetail: tracker.statusDetail, trackingUpdatedAt: new Date().toISOString() };
    } catch (e: any) {
      console.warn(`[Tracking] Failed to refresh tracking for ${row.trackingNumber}: ${e.message}`);
      results[row.orderId] = { trackingStatus: row.trackingStatus || 'unknown', trackingStatusDetail: '', trackingUpdatedAt: row.trackingUpdatedAt?.toISOString() ?? '' };
    }
  }
  res.json(results);
}));

// ── Order status mutations ────────────────────────────────────────────────────

router.patch("/orders/:id/toggle-test", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const orderId = decodeURIComponent(req.params.id);
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
  if (!order) return res.status(404).json({ error: "Order not found" });

  const isSplitChild = !!order.parentOrderId;
  const isUnshippedReturn = order.orderStatus === 'returned' && !order.shipDate;
  const isUnshippedCancel = order.orderStatus === 'cancelled' && !order.shipDate;
  if (!order.isTest && !isSplitChild && !isUnshippedReturn && !isUnshippedCancel) {
    const adjResult = await db.execute(sql`SELECT COALESCE(SUM(ABS(amount::numeric)) FILTER (WHERE type = 'refund'), 0) AS refund_total FROM order_adjustments WHERE order_id = ${orderId}`);
    const refundTotal = parseFloat((adjResult.rows[0] as any)?.refund_total ?? '0');
    const orderTotal = parseFloat(order.orderTotal ?? '0');
    const netTotal = orderTotal - refundTotal;
    if (refundTotal === 0 || netTotal > 0.01) {
      return res.status(400).json({ error: "Cannot mark as test: order must have a refund and a net total of $0", refundTotal, netTotal });
    }
  }
  const [updated] = await db.update(orders).set({ isTest: !order.isTest, updatedAt: new Date() }).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).returning();
  res.json({ isTest: updated.isTest });
}));

router.post("/orders/:id/reset-to-awaiting", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const orderId = decodeURIComponent(req.params.id);
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.marketplace !== 'BrickOwl') return res.status(400).json({ error: "Only BrickOwl orders can be reset this way" });
  if (order.orderStatus !== 'shipped') return res.status(400).json({ error: `Order is not in shipped status (current: ${order.orderStatus})` });
  const [updated] = await db.update(orders).set({ orderStatus: 'awaiting_shipment', previousStatus: 'shipped', workflowStatus: 'new', shipDate: null, updatedAt: new Date() }).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).returning();
  res.json({ success: true, orderStatus: updated.orderStatus });
}));

router.post("/orders/:id/mark-returned", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const orderId = decodeURIComponent(req.params.id);
  const { refundAmount } = req.body;
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.marketplace !== 'BrickOwl') return res.status(400).json({ error: "Manual returns are only needed for BrickOwl orders" });
  if (order.orderStatus === 'returned') return res.status(400).json({ error: "Order is already marked as returned" });
  const amount = refundAmount != null ? Number(refundAmount) : Number(order.orderTotal ?? 0);
  if (isNaN(amount) || amount < 0) return res.status(400).json({ error: "Invalid refund amount" });
  await db.insert(orderAdjustments).values({ orderId, orgId, type: 'refund', amount: (-amount).toFixed(2), notes: `BrickOwl manual return — refund of $${amount.toFixed(2)}` });
  const { updateOrderStatus } = await import('../services/inventory-adjustment');
  await updateOrderStatus(orderId, 'returned', { skipCrossPlatformSync: true });
  res.json({ success: true, orderStatus: 'returned', refundAmount: amount });
}));

router.post("/orders/:id/return-to-fulfillment", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const orderId = decodeURIComponent(req.params.id);
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
  if (!order) return res.status(404).json({ error: "Order not found" });

  const purchasedShipments = await db.select().from(shipments).where(and(eq(shipments.orderId, orderId), eq(shipments.orgId, orgId), eq(shipments.status, 'purchased')));
  let voidedCount = 0;
  let voidWarning: string | undefined;
  if (purchasedShipments.length > 0) {
    try {
      const { getShippingProvider } = await import("../services/shipping-factory");
      const vendor = await getShippingProvider(orgId);
      for (const shipment of purchasedShipments) {
        if (!shipment.vendorShipmentId) continue;
        try {
          const voidResult = await vendor.voidLabel(shipment.vendorShipmentId);
          await db.update(shipments).set({ status: 'voided', updatedAt: new Date() }).where(eq(shipments.id, shipment.id));
          if (voidResult.success) { voidedCount++; }
          else { console.warn(`⚠️  EasyPost void non-success for ${shipment.vendorShipmentId}: ${voidResult.message}`); }
        } catch (voidErr: any) {
          console.warn(`⚠️  Could not void label ${shipment.vendorShipmentId}: ${voidErr.message}`);
          voidWarning = voidErr.message;
        }
      }
    } catch (vendorErr: any) {
      console.warn(`⚠️  Could not load shipping provider for void: ${vendorErr.message}`);
      voidWarning = vendorErr.message;
    }
  }
  const targetStatus = order.marketplace === 'BrickOwl' ? 'awaiting_shipment' : 'awaiting_fulfillment';
  await db.update(orders).set({ orderStatus: targetStatus, previousStatus: order.orderStatus, workflowStatus: 'new', shipDate: null, updatedAt: new Date() }).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)));
  res.json({ success: true, orderStatus: targetStatus, voidedLabels: voidedCount, voidWarning });
}));

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get("/analytics/categories/:categoryId/items", isApproved, asyncRoute(async (req: any, res) => {
  const categoryId = parseInt(req.params.categoryId);
  const range = req.query.range as string;
  const orgId = reqOrgId(req);
  const tz = await getOrgTimezone(orgId);
  const { start, end } = tzDateBounds(range ?? '', tz);
  let whereConditions = sql`o.order_status NOT IN ('cancelled', 'Cancelled', 'returned') AND o.is_test = false`;
  if (start && !end) { whereConditions = sql`${whereConditions} AND o.order_date >= ${start}`; }
  else if (start && end) { whereConditions = sql`${whereConditions} AND o.order_date >= ${start} AND o.order_date < ${end}`; }
  const result = await db.execute(sql`
    SELECT i.item_no, i.item_name as name,
      COUNT(DISTINCT i.color_name)::integer as color_count,
      SUM(CASE WHEN i.new_or_used = 'N' THEN od.quantity ELSE 0 END)::integer as new_qty,
      SUM(CASE WHEN i.new_or_used = 'U' THEN od.quantity ELSE 0 END)::integer as used_qty,
      SUM(od.quantity)::integer as quantity_sold
    FROM ${orderDetails} od
    JOIN ${orders} o ON od.order_id = o.id
    JOIN ${blInventory} i ON od.sku = CAST(i.id AS TEXT)
    WHERE i.category_id = ${categoryId} AND ${whereConditions}
    GROUP BY i.item_no, i.item_name
    ORDER BY quantity_sold DESC
  `);
  res.json(result.rows);
}));

router.get("/analytics/categories", isApproved, asyncRoute(async (req: any, res) => {
  const range = req.query.range as string;
  let dateFilter: Date | null = null;
  let endDateFilter: Date | null = null;
  if (range && range !== 'all') {
    const now = new Date();
    switch (range) {
      case 'mtd': dateFilter = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'lastmonth': dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, 1); endDateFilter = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case '3months': dateFilter = new Date(now.getFullYear(), now.getMonth() - 3, 1); break;
      case '1year': dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1); break;
      case 'prevyear': dateFilter = new Date(now.getFullYear() - 1, 0, 1); endDateFilter = new Date(now.getFullYear(), 0, 1); break;
    }
  }
  let whereConditions = sql`o.order_status NOT IN ('cancelled', 'Cancelled', 'returned') AND o.is_test = false`;
  if (dateFilter && !endDateFilter) { whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter}`; }
  else if (dateFilter && endDateFilter) { whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter} AND o.order_date < ${endDateFilter}`; }
  const soldSubquery = sql`SELECT i.category_id, SUM(od.quantity) as total_qty FROM ${orderDetails} od JOIN ${orders} o ON od.order_id = o.id JOIN ${blInventory} i ON od.sku = CAST(i.id AS TEXT) WHERE ${whereConditions} GROUP BY i.category_id`;
  const result = await db.execute(sql`
    SELECT c.id as category_id, c.name as category_name,
      COALESCE(sold.total_qty, 0)::integer as total_sold,
      COALESCE(inv.total_qty, 0)::integer as current_inventory,
      CASE WHEN (COALESCE(inv.total_qty, 0) + COALESCE(sold.total_qty, 0)) > 0
        THEN ROUND((COALESCE(sold.total_qty, 0)::numeric / (COALESCE(inv.total_qty, 0) + COALESCE(sold.total_qty, 0))::numeric * 100), 2)
        ELSE 0 END as sell_through_pct
    FROM ${blCategories} c
    LEFT JOIN (SELECT category_id, SUM(quantity) as total_qty FROM ${blInventory} GROUP BY category_id) inv ON c.id = inv.category_id
    LEFT JOIN (${soldSubquery}) sold ON c.id = sold.category_id
    WHERE COALESCE(inv.total_qty, 0) + COALESCE(sold.total_qty, 0) > 0
    ORDER BY sell_through_pct DESC, c.name ASC
  `);
  res.json(result.rows);
}));

router.get("/analytics/product-lines", isApproved, asyncRoute(async (req: any, res) => {
  const range = req.query.range as string;
  let dateFilter: Date | null = null;
  let endDateFilter: Date | null = null;
  if (range && range !== 'all') {
    const now = new Date();
    switch (range) {
      case 'mtd': dateFilter = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'lastmonth': dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, 1); endDateFilter = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case '3months': dateFilter = new Date(now.getFullYear(), now.getMonth() - 3, 1); break;
      case '1year': dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1); break;
      case 'prevyear': dateFilter = new Date(now.getFullYear() - 1, 0, 1); endDateFilter = new Date(now.getFullYear(), 0, 1); break;
    }
  }
  let whereConditions = sql`o.order_status NOT IN ('cancelled', 'Cancelled', 'returned') AND o.is_test = false`;
  if (dateFilter && !endDateFilter) { whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter}`; }
  else if (dateFilter && endDateFilter) { whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter} AND o.order_date < ${endDateFilter}`; }
  const result = await db.execute(sql`
    WITH order_items AS (
      SELECT o.id as order_id, o.marketplace, o.order_total, od.name, od.quantity, od.unit_price
      FROM ${orders} o JOIN ${orderDetails} od ON o.id = od.order_id WHERE ${whereConditions}
    ),
    classified_items AS (
      SELECT order_id, marketplace, quantity, unit_price,
        CASE WHEN name ILIKE '%K''NEX%' OR name ILIKE '%KNEX%' THEN 'K''NEX'
             WHEN name ILIKE '%Erector%' OR name ILIKE '%Meccano%' THEN 'Erector/Meccano'
             WHEN name ILIKE '%Capsela%' THEN 'Capsela'
             WHEN name ILIKE '%Marbleworks%' OR name ILIKE '%Discovery Toys%' THEN 'Marbleworks'
             WHEN name ILIKE '%Little Tikes%' THEN 'Little Tikes'
             WHEN name ILIKE '%Fisher-Price%' THEN 'Fisher-Price'
             ELSE 'LEGO' END as product_line
      FROM order_items
    ),
    platform_aggregates AS (
      SELECT product_line, COALESCE(marketplace, 'Unknown') as marketplace,
        COUNT(DISTINCT order_id) as platform_orders,
        COALESCE(SUM(quantity * COALESCE(unit_price::numeric, 0)), 0) as platform_revenue
      FROM classified_items GROUP BY product_line, marketplace
    )
    SELECT product_line, SUM(platform_orders)::integer as order_count,
      (SELECT SUM(quantity)::integer FROM classified_items ci WHERE ci.product_line = pa.product_line) as total_units,
      SUM(platform_revenue) as total_revenue,
      json_agg(json_build_object('marketplace', marketplace, 'order_count', platform_orders, 'revenue', platform_revenue::text) ORDER BY platform_revenue DESC) as platforms
    FROM platform_aggregates pa GROUP BY product_line ORDER BY SUM(platform_revenue) DESC
  `);
  res.json(result.rows);
}));

// ── Individual order endpoints ────────────────────────────────────────────────

router.get("/orders/marketplace-diagnostic", isApproved, asyncRoute(async (req, res) => {
  const stats = await db.execute(sql`
    SELECT marketplace, COUNT(*) as count,
      ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM orders), 1) as percentage
    FROM orders GROUP BY marketplace ORDER BY count DESC
  `);
  const unknownSamples = await db.execute(sql`
    SELECT id, order_number, marketplace FROM orders
    WHERE marketplace IS NULL OR marketplace NOT IN ('BrickLink','BrickOwl')
    LIMIT 5
  `);
  res.json({ stats: stats.rows, unknownSamples: unknownSamples.rows });
}));

router.get("/orders/feedback-pending", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const range = req.query.range as string | undefined;
  const tz = await getOrgTimezone(orgId);
  const { start, end } = tzDateBounds(range ?? '', tz);
  const result = await db.execute(sql`
    SELECT DISTINCT ON (o.id)
      o.id, o.order_number AS "orderNumber", o.order_date AS "orderDate",
      o.ship_date AS "shipDate", o.customer_username AS "customerUsername",
      o.order_total AS "orderTotal", o.marketplace, o.order_status AS "orderStatus",
      o.is_test AS "isTest", o.feedback_left_at AS "feedbackLeftAt",
      o.ship_to AS "shipTo",
      s.tracking_number AS "trackingNumber", s.carrier, s.tracking_status AS "trackingStatus",
      COALESCE(oc.order_count, 1)::int AS "totalOrderCount"
    FROM orders o
    INNER JOIN shipments s ON s.order_id = o.id
    LEFT JOIN (
      SELECT customer_username, COUNT(*)::int AS order_count
      FROM orders
      WHERE org_id = ${orgId} AND is_test = false AND order_status NOT IN ('cancelled','Cancelled','purged')
      GROUP BY customer_username
    ) oc ON oc.customer_username = o.customer_username
    WHERE o.org_id = ${orgId}
      AND o.is_test = false
      AND o.feedback_left_at IS NULL
      AND o.order_status IN ('shipped','completed')
      ${start ? sql`AND COALESCE(o.ship_date, o.order_date) >= ${start}` : sql``}
      ${end   ? sql`AND COALESCE(o.ship_date, o.order_date) < ${end}`   : sql``}
    ORDER BY o.id, s.created_at DESC NULLS LAST
  `);
  res.json(result.rows);
}));

router.get("/orders/:id", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const orderId = req.params.id;
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
  if (!order) return res.status(404).json({ error: "Order not found" });

  const [items, adjustments, [latestShipment], customerPastOrders] = await Promise.all([
    db.select().from(orderDetails).where(eq(orderDetails.orderId, orderId)),
    db.select().from(orderAdjustments).where(eq(orderAdjustments.orderId, orderId)).orderBy(desc(orderAdjustments.createdAt)),
    db.select().from(shipments).where(and(eq(shipments.orderId, orderId), notInArray(shipments.status, ['voided', 'failed']))).orderBy(desc(shipments.createdAt)).limit(1),
    order.customerUsername
      ? db.select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          orderDate: orders.orderDate,
          orderTotal: orders.orderTotal,
          orderStatus: orders.orderStatus,
        }).from(orders).where(and(
          eq(orders.orgId, orgId),
          eq(orders.customerUsername, order.customerUsername),
          eq(orders.isTest, false),
          sql`${orders.id} != ${orderId}`,
          sql`${orders.orderStatus} != 'purged'`,
        )).orderBy(desc(orders.orderDate)).limit(20)
      : Promise.resolve([]),
  ]);

  // Enrich order items with imageUrl, part number, and colorId by looking up
  // the BrickLink inventory record (and joined bl_catalog entry) for each line item.
  // BrickOwl orders use bricklinkInventoryId; BrickLink orders use the numeric sku.
  const isBrickOwl = order.marketplace === 'BrickOwl';
  const invLookupIds = Array.from(new Set(
    items.map(item => {
      const id = isBrickOwl
        ? item.bricklinkInventoryId
        : (item.sku ? parseInt(item.sku, 10) : NaN);
      return id && !isNaN(Number(id)) ? Number(id) : null;
    }).filter((id): id is number => id !== null)
  ));

  const invDataMap = new Map<number, { itemNo: string; colorId: number | null; imageUrl: string | null; itemType: string | null }>();
  if (invLookupIds.length > 0) {
    const rows = await db
      .select({
        id: blInventory.id,
        itemNo: blInventory.itemNo,
        colorId: blInventory.colorId,
        itemType: blInventory.itemType,
        imageUrl: blCatalog.imageUrl,
      })
      .from(blInventory)
      .leftJoin(blCatalog, and(
        eq(blInventory.itemNo, blCatalog.itemNo),
        eq(blInventory.itemType, blCatalog.itemType),
        eq(blInventory.colorId, blCatalog.colorId),
      ))
      .where(and(eq(blInventory.orgId, orgId), inArray(blInventory.id, invLookupIds)));
    for (const row of rows) invDataMap.set(row.id, row);
  }

  // Parse shipTo JSON into customer object
  let shipToData: any = {};
  try { shipToData = order.shipTo ? JSON.parse(order.shipTo) : {}; } catch {}

  // Map orderStatus → component status enum
  const statusMap: Record<string, string> = {
    awaiting_payment: 'Pending', unpaid: 'Pending',
    awaiting_shipment: 'Paid', awaiting_fulfillment: 'Paid', processing: 'Paid',
    shipped: 'Shipped', completed: 'Shipped',
    cancelled: 'Cancelled', Cancelled: 'Cancelled',
    returned: 'Returned', Returned: 'Returned',
  };

  res.json({
    orderId: order.id,
    orderNumber: order.orderNumber,
    marketplace: order.marketplace,
    status: statusMap[order.orderStatus] ?? 'Paid',
    customer: {
      name: shipToData.name || order.customerUsername || 'Unknown',
      email: order.customerEmail || shipToData.email || '',
      address: shipToData.street1 || '',
      address2: shipToData.street2 || '',
      address3: shipToData.street3 || '',
      city: shipToData.city || '',
      state: shipToData.state || '',
      zip: shipToData.postalCode || shipToData.zip || '',
      country: shipToData.country || '',
    },
    orderDate: order.orderDate,
    shippedDate: order.shipDate,
    shipping: parseFloat(order.shippingAmount ?? '0'),
    tax: parseFloat(order.taxAmount ?? '0'),
    total: parseFloat(order.orderTotal),
    weight: order.weight ? parseFloat(order.weight) : null,
    weightUnits: order.weightUnits ?? 'oz',
    trackingNumber: latestShipment?.trackingNumber ?? null,
    labelUrl: latestShipment?.labelUrl ?? null,
    shippingCarrier: latestShipment?.carrier ?? order.carrierCode ?? null,
    shippingService: latestShipment?.service ?? order.serviceCode ?? null,
    customerNotes: order.customerNotes ?? null,
    internalNotes: order.internalNotes ?? null,
    requestedShippingService: order.requestedShippingService ?? null,
    insuranceAmount: order.insuranceAmount ? parseFloat(order.insuranceAmount) : null,
    mergeGroupId: order.mergeGroupId ?? null,
    items: items.map(item => {
      const invId = isBrickOwl
        ? item.bricklinkInventoryId
        : (item.sku ? parseInt(item.sku, 10) : null);
      const inv = invId ? invDataMap.get(Number(invId)) : undefined;

      // Part number: prefer inventory itemNo, then stored itemNo, then extract from name (BrickOwl)
      let partNumber = inv?.itemNo || item.itemNo || '';
      if (!partNumber && isBrickOwl) {
        const m = (item.name ?? '').match(/\((\d[0-9a-zA-Z]*)/);
        if (m) partNumber = m[1];
      }
      if (!partNumber) partNumber = item.sku || '';

      return {
        partNumber,
        name: item.name,
        quantity: item.quantity,
        price: parseFloat(item.unitPrice ?? '0'),
        colorId: inv?.colorId ?? item.colorId ?? null,
        blInventoryId: item.bricklinkInventoryId ?? null,
        imageUrl: inv?.imageUrl ?? null,
        itemType: inv?.itemType ?? null,
      };
    }),
    adjustments: adjustments.map(a => ({
      id: a.id,
      type: a.type,
      amount: parseFloat(a.amount),
      paymentMethod: a.paymentMethod ?? null,
      externalTransactionId: a.externalTransactionId ?? null,
      reason: a.reason ?? null,
      notes: a.notes ?? null,
      createdAt: a.createdAt,
    })),
    isRepeatCustomer: customerPastOrders.length > 0,
    previousOrders: customerPastOrders.map(o => ({
      orderId: o.id,
      orderNumber: o.orderNumber ?? '',
      orderDate: o.orderDate as unknown as string,
      total: parseFloat(o.orderTotal ?? '0'),
      status: (statusMap[o.orderStatus ?? ''] ?? 'Paid') as 'Pending' | 'Paid' | 'Shipped' | 'Cancelled' | 'Returned',
    })),
  });
}));

router.post("/orders/backfill-weights", isApproved, asyncRoute(async (req, res) => {
  const result = await db.execute(sql`
    UPDATE orders o
    SET weight = sub.total_grams::text, weight_units = 'g'
    FROM (
      SELECT od.order_id,
        SUM(
          CASE WHEN od.weight IS NOT NULL AND CAST(od.weight AS DECIMAL) > 0
               THEN CAST(od.weight AS DECIMAL) * od.quantity
               WHEN bc.bl_catalog_weight IS NOT NULL AND bc.bl_catalog_weight > 0
               THEN bc.bl_catalog_weight * od.quantity
               ELSE 0 END
        ) AS total_grams
      FROM order_details od
      LEFT JOIN bl_inventory bi ON CAST(bi.id AS TEXT) = od.sku
      LEFT JOIN bl_catalog bc ON bc.item_no = bi.item_no AND bc.item_type = bi.item_type AND bc.color_id = bi.color_id
      GROUP BY od.order_id
      HAVING SUM(CASE WHEN od.weight IS NOT NULL AND CAST(od.weight AS DECIMAL) > 0 THEN 1
                      WHEN bc.bl_catalog_weight IS NOT NULL AND bc.bl_catalog_weight > 0 THEN 1
                      ELSE 0 END) > 0
    ) sub
    WHERE o.id = sub.order_id AND (o.weight IS NULL OR o.weight = '')
  `);
  const rowCount = (result as any).rowCount ?? 0;
  res.json({ updated: rowCount, message: `Weight backfilled for ${rowCount} orders` });
}));

router.patch("/orders/:id", isApproved, asyncRoute(async (req: any, res) => {
  const orderId = req.params.id;
  const orgId = reqOrgId(req);
  const { street1, street2, street3, city, state, postalCode, country, phone, weight, weightUnits, packageType, packageLength, packageWidth, packageHeight } = req.body;
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
  if (!order) return res.status(404).json({ error: "Order not found" });
  let shipToData: any = {};
  try { shipToData = order.shipTo ? JSON.parse(order.shipTo) : {}; } catch (e) { }
  if (street1 !== undefined) shipToData.street1 = street1;
  if (street2 !== undefined) shipToData.street2 = street2;
  if (street3 !== undefined) shipToData.street3 = street3;
  if (city !== undefined) shipToData.city = city;
  if (state !== undefined) shipToData.state = state;
  if (postalCode !== undefined) shipToData.postalCode = postalCode;
  if (country !== undefined) shipToData.country = country;
  if (phone !== undefined) shipToData.phone = phone || undefined;
  const updateData: any = { shipTo: JSON.stringify(shipToData) };
  if (weight !== undefined) updateData.weight = weight !== null && weight !== '' ? weight.toString() : null;
  if (weightUnits !== undefined) updateData.weightUnits = weightUnits;
  if (packageType !== undefined) updateData.packageType = packageType || null;
  if (packageLength !== undefined) updateData.packageLength = packageLength !== null && packageLength !== '' ? packageLength.toString() : null;
  if (packageWidth !== undefined) updateData.packageWidth = packageWidth !== null && packageWidth !== '' ? packageWidth.toString() : null;
  if (packageHeight !== undefined) updateData.packageHeight = packageHeight !== null && packageHeight !== '' ? packageHeight.toString() : null;
  await db.update(orders).set(updateData).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)));
  broadcast(orgId, 'order.updated', { orderId });
  res.json({ success: true });
}));

router.post("/orders/:id/status", isApproved, asyncRoute(async (req, res) => {
  const orderId = req.params.id;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "Status is required" });
  const { updateOrderStatus } = await import('../services/inventory-adjustment');
  const result = await updateOrderStatus(orderId, status);
  res.json(result);
}));

router.post("/orders/:id/adjust-inventory", isApproved, asyncRoute(async (req, res) => {
  const orderId = req.params.id;
  const { adjustInventoryForOrder } = await import('../services/inventory-adjustment');
  const result = await adjustInventoryForOrder(orderId, 'manual-api');
  res.json(result);
}));

// ── Order Adjustments ─────────────────────────────────────────────────────────

router.get("/orders/adjustments/by-order", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { dateRange = 'mtd' } = req.query as { dateRange?: string };
  const tz = await getOrgTimezone(orgId);
  const { start, end } = tzDateBounds(dateRange === 'all' ? '' : dateRange, tz);
  const result = await db.execute(sql`
    SELECT oa.order_id, SUM(ABS(oa.amount::numeric)) AS total_refunds
    FROM order_adjustments oa JOIN orders o ON o.id = oa.order_id
    WHERE oa.type = 'refund' AND oa.org_id = ${orgId} AND o.is_test = false
      ${start ? sql`AND o.order_date >= ${start}` : sql``}
      ${end   ? sql`AND o.order_date <  ${end}`   : sql``}
    GROUP BY oa.order_id
  `);
  const refundsByOrder: Record<string, number> = {};
  for (const row of result.rows as any[]) { refundsByOrder[row.order_id] = Number(row.total_refunds); }
  res.json(refundsByOrder);
}));

router.get("/orders/adjustments/summary", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { dateRange = 'mtd' } = req.query as { dateRange?: string };
  const tz = await getOrgTimezone(orgId);
  const { start, end } = tzDateBounds(dateRange === 'all' ? '' : dateRange, tz);
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN oa.type = 'refund' THEN ABS(oa.amount::numeric) ELSE 0 END), 0) AS total_refunds,
      COUNT(DISTINCT CASE WHEN oa.type = 'refund' THEN oa.order_id END) AS refunded_order_count,
      COALESCE(SUM(CASE WHEN oa.type = 'merchant_fee' THEN ABS(oa.amount::numeric) ELSE 0 END), 0) AS total_fees,
      COALESCE(SUM(CASE WHEN oa.type = 'merchant_fee' AND oa.reason LIKE '%BrickLink%' THEN ABS(oa.amount::numeric) ELSE 0 END), 0) AS bricklink_fees,
      COALESCE(SUM(CASE WHEN oa.type = 'merchant_fee' AND oa.reason LIKE '%Stripe%' THEN ABS(oa.amount::numeric) ELSE 0 END), 0) AS stripe_fees,
      COALESCE(SUM(CASE WHEN oa.type = 'shipping_cost' THEN ABS(oa.amount::numeric) ELSE 0 END), 0) AS total_shipping,
      COUNT(DISTINCT CASE WHEN oa.type = 'shipping_cost' THEN oa.order_id END) AS shipped_order_count
    FROM order_adjustments oa JOIN orders o ON o.id = oa.order_id
    WHERE oa.org_id = ${orgId} AND o.is_test = false
      ${start ? sql`AND o.order_date >= ${start}` : sql``}
      ${end   ? sql`AND o.order_date <  ${end}`   : sql``}
  `);
  const row = result.rows[0] as any;
  const totalShipping = Number(row.total_shipping);
  const shippedOrderCount = Number(row.shipped_order_count);
  res.json({
    totalRefunds: Number(row.total_refunds), refundedOrderCount: Number(row.refunded_order_count),
    totalFees: Number(row.total_fees), bricklinkFees: Number(row.bricklink_fees), stripeFees: Number(row.stripe_fees),
    totalShipping, shippedOrderCount, avgShippingPerOrder: shippedOrderCount > 0 ? totalShipping / shippedOrderCount : 0,
  });
}));

router.get("/orders/:id/adjustments", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const adjustments = await db.select().from(orderAdjustments).where(and(eq(orderAdjustments.orderId, req.params.id), eq(orderAdjustments.orgId, orgId))).orderBy(orderAdjustments.createdAt);
  res.json(adjustments);
}));

router.post("/orders/:id/adjustments", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const parsed = insertOrderAdjustmentSchema.safeParse({ ...req.body, orderId: req.params.id, orgId });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const [adj] = await db.insert(orderAdjustments).values(parsed.data).returning();
  res.json(adj);
}));

router.delete("/orders/:orderId/adjustments/:adjustmentId", isApproved, asyncRoute(async (req, res) => {
  await db.delete(orderAdjustments).where(and(eq(orderAdjustments.id, req.params.adjustmentId), eq(orderAdjustments.orderId, req.params.orderId)));
  res.json({ success: true });
}));

// ── Dashboard stats ───────────────────────────────────────────────────────────

router.get("/dashboard/stats", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const range = req.query.range as string;
  const tz = await getOrgTimezone(orgId);
  const { start, end } = tzDateBounds(range ?? '', tz);
  const orgOrdersWhere = eq(orders.orgId, orgId);
  const ordersWhere = start
    ? end
      ? and(orgOrdersWhere, sql`${orders.orderDate} >= ${start} AND ${orders.orderDate} < ${end}`)
      : and(orgOrdersWhere, sql`${orders.orderDate} >= ${start}`)
    : orgOrdersWhere;
  const [ordersStats, inventoryStats] = await Promise.all([
    db.select({ count: sql<number>`count(*)`, totalSales: sql<number>`COALESCE(sum(${orders.orderTotal}), 0)` }).from(orders).where(ordersWhere),
    db.select({ count: sql<number>`count(*)`, totalQty: sql<number>`COALESCE(sum(${blInventory.quantity}), 0)`, totalValue: sql<number>`COALESCE(sum(${blInventory.quantity} * CAST(${blInventory.unitPrice} AS DECIMAL)), 0)` }).from(blInventory).where(eq(blInventory.orgId, orgId)),
  ]);
  res.json({
    totalOrders: Number(ordersStats[0]?.count) || 0,
    totalInventoryItems: Number(inventoryStats[0]?.count) || 0,
    totalInventoryQuantity: Number(inventoryStats[0]?.totalQty) || 0,
    totalSales: Number(ordersStats[0]?.totalSales) || 0,
    totalInventoryValue: Number(inventoryStats[0]?.totalValue) || 0,
  });
}));

// ── Settings ──────────────────────────────────────────────────────────────────

router.get("/settings", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const settings = await getOrgSettings(orgId);
  const masked = maskSettingsSecrets(settings as any);
  res.json({ ...masked, brickowlConnectedViaEnv: !!process.env.BRICKOWL_API_KEY });
}));

router.post("/settings", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const data = insertAppSettingsSchema.parse(req.body);
  for (const field of SECRET_FIELDS) {
    const val = (data as any)[field];
    if (val && typeof val === 'string' && val.includes('····')) { delete (data as any)[field]; }
  }
  const [settings] = await db.insert(appSettings).values({ ...data, id: orgId, orgId })
    .onConflictDoUpdate({ target: appSettings.id, set: { ...data, updatedAt: sql`CURRENT_TIMESTAMP` } })
    .returning();
  res.json(maskSettingsSecrets(settings as any));
}));

// ── Shipping service mappings ─────────────────────────────────────────────────

router.get("/shipping/service-mappings", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const rows = await db.select().from(shippingServiceMappings).where(eq(shippingServiceMappings.orgId, orgId));
  const map: Record<string, string> = {};
  for (const row of rows) map[row.label] = row.easypostService;
  res.json(map);
}));

router.post("/shipping/service-mappings", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { label, easypostService } = req.body;
  if (!label || !easypostService) return res.status(400).json({ error: "label and easypostService required" });
  await db.insert(shippingServiceMappings).values({ orgId, label, easypostService })
    .onConflictDoUpdate({ target: [shippingServiceMappings.orgId, shippingServiceMappings.label], set: { easypostService, updatedAt: sql`CURRENT_TIMESTAMP` } });
  res.json({ ok: true });
}));

// ── Push Notifications ────────────────────────────────────────────────────────

router.get("/notifications/vapid-public-key", isApproved, (_req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
});

router.post("/notifications/subscribe", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const userId = req.user?.id ?? null;
  const { endpoint, keys, notifyAllOrders = true, notifyPriorityOrders = true } = req.body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: "Invalid subscription" });
  await db.insert(pushSubscriptions).values({ orgId, userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, notifyAllOrders, notifyPriorityOrders })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { orgId, userId, notifyAllOrders, notifyPriorityOrders } });
  res.json({ ok: true });
}));

router.put("/notifications/subscription", isApproved, asyncRoute(async (req: any, res) => {
  const { endpoint, notifyAllOrders, notifyPriorityOrders } = req.body;
  if (!endpoint) return res.status(400).json({ error: "endpoint required" });
  await db.update(pushSubscriptions).set({ notifyAllOrders, notifyPriorityOrders }).where(eq(pushSubscriptions.endpoint, endpoint));
  res.json({ ok: true });
}));

router.delete("/notifications/unsubscribe", isApproved, asyncRoute(async (req: any, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: "endpoint required" });
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  res.json({ ok: true });
}));

router.post("/notifications/test", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.orgId, orgId));
  if (subs.length === 0) return res.status(404).json({ error: "No subscriptions found for this org" });
  const webpush = (await import('web-push')).default;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(
      process.env.VAPID_EMAIL || 'mailto:admin@planetbrick.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );
  }
  let sent = 0;
  const stale: number[] = [];
  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ title: 'E.L.F.I.E. · Test Notification', body: 'Comms check, Commander! If you can read this, the notification pipeline is fully operational.', tag: 'elfie-test', url: '/' }));
      sent++;
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) stale.push(sub.id);
    }
  }
  for (const id of stale) { await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id)); }
  res.json({ ok: true, sent, stale: stale.length });
}));

// ── Provider Registry ─────────────────────────────────────────────────────────

router.get("/providers", asyncRoute(async (_req, res) => {
  const { getAllProviders } = await import("../services/provider-registry");
  res.json({ providers: getAllProviders() });
}));

router.get("/providers/active", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { getAllProviders } = await import("../services/provider-registry");
  const allProviders = getAllProviders();
  const rows = await db.select().from(orgIntegrations).where(eq(orgIntegrations.orgId, orgId));
  const connected = new Map(rows.map(r => [r.channel, r]));
  const result = allProviders.map(p => ({
    ...p,
    integration: connected.has(p.key) ? { id: connected.get(p.key)!.id, isConnected: connected.get(p.key)!.isConnected, displayName: connected.get(p.key)!.displayName, lastTestedAt: connected.get(p.key)!.lastTestedAt } : null,
  }));
  res.json({ providers: result });
}));

// ── Org Integrations ──────────────────────────────────────────────────────────

router.get("/org/integrations", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const integrations = await db.select().from(orgIntegrations).where(eq(orgIntegrations.orgId, orgId));
  const sanitized = integrations.map(i => ({
    ...i,
    credentials: Object.fromEntries(Object.entries((i.credentials as Record<string, string>) || {}).map(([k, v]) => [k, v ? '••••••' : ''])),
  }));
  res.json(sanitized);
}));

router.post("/org/integrations", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { channel, type, displayName, credentials, isConnected } = req.body as { channel: string; type: 'sales_channel' | 'shipping' | 'payment'; displayName?: string; credentials?: Record<string, string>; isConnected?: boolean };
  if (!channel || !type) return res.status(400).json({ error: "channel and type are required" });
  const [row] = await db.insert(orgIntegrations).values({ orgId, channel, type, displayName: displayName ?? channel, credentials: credentials ?? {}, isConnected: isConnected ?? false }).returning();
  if (channel === 'ebay' && type === 'sales_channel') {
    try {
      await db.insert(channelSyncConfig).values({ orgId, channelKey: 'ebay' }).onConflictDoNothing();
    } catch (e: any) {
      console.warn('[eBay] Could not auto-create channelSyncConfig (non-fatal):', e.message);
    }
  }
  res.json({ success: true, integration: row });
}));

// ── EOD / SCAN form ───────────────────────────────────────────────────────────

router.get("/shipments/end-of-day", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const cfg = await getOrgSettings(orgId);
  const currentIsTest = (cfg?.easypostKeyMode ?? 'test') !== 'production';
  const eligibleShipments = await db.select().from(shipments).where(and(eq(shipments.orgId, orgId), eq(shipments.vendorCode, 'easypost'), eq(shipments.status, 'purchased'), eq(shipments.isTest, currentIsTest), isNull(shipments.eodFormId)));
  res.json({ count: eligibleShipments.length, shipments: eligibleShipments.map(s => ({ id: s.id, orderId: s.orderId, trackingNumber: s.trackingNumber, carrier: s.carrier, service: s.service, purchasedAt: s.purchasedAt })) });
}));

router.post("/shipments/scan-form", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const cfg2 = await getOrgSettings(orgId);
  const currentIsTest2 = (cfg2?.easypostKeyMode ?? 'test') !== 'production';
  const eligibleShipments = await db.select().from(shipments).where(and(eq(shipments.orgId, orgId), eq(shipments.vendorCode, 'easypost'), eq(shipments.status, 'purchased'), eq(shipments.isTest, currentIsTest2), isNull(shipments.eodFormId)));
  const vendorIds = eligibleShipments.map(s => s.vendorShipmentId).filter(Boolean);
  if (vendorIds.length === 0) return res.status(400).json({ error: 'No eligible EasyPost shipments for an EOD form' });
  const cfg = await getOrgSettings(orgId);
  const apiKey = cfg?.easypostKeyMode === 'production' ? cfg?.easypostApiKey : cfg?.easypostTestApiKey;
  if (!apiKey) return res.status(400).json({ error: 'EasyPost API key not configured' });
  const auth = Buffer.from(`${apiKey}:`).toString('base64');
  let activeVendorIds = [...vendorIds];
  let scanForm: any = null;
  let skippedIds: string[] = [];
  let hadAlreadyManifested = false;
  const MAX_EOD_ATTEMPTS = 10;
  for (let attempt = 0; attempt < MAX_EOD_ATTEMPTS; attempt++) {
    const epRes = await fetch('https://api.easypost.com/v2/scan_forms', { method: 'POST', headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ shipments: activeVendorIds.map(id => ({ id })) }) });
    if (epRes.ok) { scanForm = await epRes.json(); break; }
    const err = await epRes.json().catch(() => ({}));
    const errMsg: string = (typeof err.error === 'string' ? err.error : err.error?.message) || '';
    const badIdsMatch = errMsg.match(/(?:not found|already been manifested):\s*(shp_[a-f0-9]+(?:[,\s]+shp_[a-f0-9]+)*)/i);
    const roundManifested = /already been manifested/i.test(errMsg);
    if (badIdsMatch) {
      const badIds = badIdsMatch[1].split(/[,\s]+/).map((s: string) => s.trim()).filter(Boolean);
      skippedIds = [...skippedIds, ...badIds];
      if (roundManifested) hadAlreadyManifested = true;
      activeVendorIds = activeVendorIds.filter(id => !badIds.includes(id as string));
      if (roundManifested && badIds.length > 0) {
        const alreadyManifShipments = eligibleShipments.filter(s => s.vendorShipmentId && badIds.includes(s.vendorShipmentId));
        if (alreadyManifShipments.length > 0) { await db.update(shipments).set({ status: 'manifested' }).where(inArray(shipments.id, alreadyManifShipments.map(s => s.id))); }
      }
      if (!roundManifested && badIds.length > 0) {
        const notFoundShipments = eligibleShipments.filter(s => s.vendorShipmentId && badIds.includes(s.vendorShipmentId));
        if (notFoundShipments.length > 0) { await db.update(shipments).set({ status: 'voided', updatedAt: new Date() }).where(inArray(shipments.id, notFoundShipments.map(s => s.id))); }
      }
      if (activeVendorIds.length === 0) {
        const [lastForm] = await db.select().from(eodForms).where(eq(eodForms.orgId, orgId)).orderBy(desc(eodForms.createdAt)).limit(1);
        return res.json({ alreadyManifested: hadAlreadyManifested, allVoided: !hadAlreadyManifested, shipmentCount: 0, skippedCount: skippedIds.length, formUrl: lastForm?.formUrl ?? null, scanFormId: lastForm?.scanFormId ?? null, eodFormId: lastForm?.id ?? null });
      }
      continue;
    }
    return res.status(400).json({ error: errMsg || 'EasyPost SCAN form creation failed' });
  }
  if (!scanForm) return res.status(400).json({ error: 'EasyPost SCAN form creation failed after retry' });
  const formUrl: string = scanForm.form_url;
  const epScanFormId: string = scanForm.id;
  const [eodFormRecord] = await db.insert(eodForms).values({ formUrl, scanFormId: epScanFormId, shipmentCount: activeVendorIds.length, orgId }).returning();
  const acceptedShipments = eligibleShipments.filter(s => s.vendorShipmentId && activeVendorIds.includes(s.vendorShipmentId));
  if (acceptedShipments.length > 0) { await db.update(shipments).set({ eodFormId: eodFormRecord.id }).where(inArray(shipments.id, acceptedShipments.map(s => s.id))); }
  res.json({ formUrl, scanFormId: epScanFormId, eodFormId: eodFormRecord.id, shipmentCount: activeVendorIds.length, skippedCount: skippedIds.length });
}));

router.post("/shipments/clear-eod-backlog", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const result = await db.update(shipments).set({ status: 'manifested' }).where(and(eq(shipments.orgId, orgId), eq(shipments.vendorCode, 'easypost'), eq(shipments.status, 'purchased'), isNull(shipments.eodFormId))).returning({ id: shipments.id });
  res.json({ cleared: result.length });
}));

router.get("/orders/:orderId/eod-form", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { orderId } = req.params;
  const shipmentRow = await db.select().from(shipments).where(and(eq(shipments.orgId, orgId), eq(shipments.orderId, orderId), isNotNull(shipments.eodFormId))).limit(1);
  if (shipmentRow.length && shipmentRow[0].eodFormId) {
    const eodFormRow = await db.select().from(eodForms).where(eq(eodForms.id, shipmentRow[0].eodFormId)).limit(1);
    if (eodFormRow.length) {
      return res.json({ formUrl: eodFormRow[0].formUrl, eodFormId: eodFormRow[0].id, shipmentCount: eodFormRow[0].shipmentCount, createdAt: eodFormRow[0].createdAt });
    }
  }
  const manifestedShipment = await db.select().from(shipments).where(and(eq(shipments.orgId, orgId), eq(shipments.orderId, orderId), eq(shipments.vendorCode, 'easypost'), eq(shipments.status, 'manifested'))).limit(1);
  if (!manifestedShipment.length) return res.status(404).json({ error: 'No EOD form found for this order' });
  const [lastForm] = await db.select().from(eodForms).where(eq(eodForms.orgId, orgId)).orderBy(desc(eodForms.createdAt)).limit(1);
  if (!lastForm) return res.status(404).json({ error: 'No EOD form found for this order' });
  res.json({ formUrl: lastForm.formUrl, eodFormId: lastForm.id, shipmentCount: lastForm.shipmentCount, createdAt: lastForm.createdAt });
}));

// ── Fulfillment ───────────────────────────────────────────────────────────────

router.get("/fulfillment/stats", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const [unfulfilledRows, feedbackRows] = await Promise.all([
    db.select({ count: sql<number>`count(DISTINCT ${orders.id})` }).from(orders).where(and(eq(orders.orgId, orgId), eq(orders.isTest, false), or(eq(orders.orderStatus, 'awaiting_payment'), eq(orders.orderStatus, 'awaiting_fulfillment'), eq(orders.orderStatus, 'awaiting_shipment')))),
    db.select({ count: sql<number>`count(DISTINCT ${orders.id})` }).from(orders).innerJoin(shipments, eq(shipments.orderId, orders.id)).where(and(eq(orders.orgId, orgId), eq(orders.isTest, false), isNull(orders.feedbackLeftAt), inArray(orders.orderStatus, ['shipped', 'completed']))),
  ]);
  res.json({ unfulfilled: Number(unfulfilledRows[0]?.count || 0), feedbackPending: Number(feedbackRows[0]?.count || 0) });
}));

router.get("/fulfillment", isApproved, asyncRoute(async (req: any, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const orgId = reqOrgId(req);
  const fulfillmentOrders = await db.select().from(orders).where(and(eq(orders.orgId, orgId), eq(orders.isTest, false), or(eq(orders.orderStatus, 'awaiting_payment'), eq(orders.orderStatus, 'awaiting_fulfillment'), eq(orders.orderStatus, 'awaiting_shipment')))).orderBy(orders.orderNumber);
  if (fulfillmentOrders.length === 0) { res.json({ orders: [], items: [] }); return; }
  const orderIds = fulfillmentOrders.map(o => o.id);
  const allItems = await db.select({
    id: orderDetails.id, orderId: orderDetails.orderId, orderNumber: orders.orderNumber, sku: orderDetails.sku,
    bricklinkPartNumber: sql<string>`COALESCE(CASE WHEN ${orders.marketplace} = 'BrickLink' THEN ${blInventory.itemNo} ELSE NULL END, TRIM(SUBSTRING(${orderDetails.sku} FROM '.LGO-(.+)$')), TRIM(SUBSTRING(${orderDetails.name} FROM 'LEGO-([^ ]+)')), TRIM(SUBSTRING(${orderDetails.name} FROM 'Part ([^ ]+)')), TRIM(SUBSTRING(${orderDetails.name} FROM '\\(([0-9][0-9a-zA-Z]*)')) )`,
    name: orderDetails.name, quantity: orderDetails.quantity, fulfilled: orderDetails.fulfilled,
    colorName: sql<string>`COALESCE(CASE WHEN ${orders.marketplace} = 'BrickLink' THEN (SELECT bc.name FROM bl_colors bc WHERE bc.id = ${orderDetails.colorId} LIMIT 1) ELSE NULL END, ${blColors.name}, (SELECT bc.name FROM bl_colors bc WHERE order_details.name ILIKE '%' || bc.name || '%' ORDER BY LENGTH(bc.name) DESC LIMIT 1))`,
    condition: sql<string>`COALESCE(${orderDetails.condition}, CASE WHEN ${orderDetails.name} LIKE '%(Used)%' THEN 'Used' WHEN ${orderDetails.name} LIKE '%(New)%' THEN 'New' WHEN ${blInventory.newOrUsed} = 'N' THEN 'New' WHEN ${blInventory.newOrUsed} = 'U' THEN 'Used' ELSE NULL END)`,
    binId: inventoryLocations.binId, binName: whBins.name, shelfId: whShelves.id, shelfName: whShelves.name, aisleId: whAisles.id, aisleName: whAisles.name,
  })
    .from(orderDetails)
    .innerJoin(orders, eq(orderDetails.orderId, orders.id))
    .leftJoin(blInventory, and(eq(sql`CAST(${blInventory.id} AS TEXT)`, orderDetails.sku), eq(orders.marketplace, 'BrickLink')))
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(inventoryLocations, eq(blInventory.id, inventoryLocations.inventoryId))
    .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
    .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
    .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
    .where(sql`${orderDetails.orderId} IN (${sql.raw(orderIds.map(id => `'${id}'`).join(', '))})`);

  const seenIds = new Set<string>();
  const items = allItems.filter(item => { if (seenIds.has(item.id)) return false; seenIds.add(item.id); return true; });
  res.json({ orders: fulfillmentOrders, items });
}));

router.put("/fulfillment/order/:orderId/workflow-status", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { orderId } = req.params;
  const { status } = req.body;
  const valid = ['new', 'processing', 'bump', 'issue', 'on_hold', 'done'];
  if (!status || !valid.includes(status)) return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` });
  await db.update(orders).set({ workflowStatus: status, updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)));
  broadcast(orgId, 'order.workflow_changed', { orderId, status });
  res.json({ success: true });
}));

router.post("/orders/:orderId/dismiss-merge", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = req.user?.orgId;
  const { orderId } = req.params;
  await db.update(orders).set({ mergeDetectedAt: null, updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)));
  res.json({ success: true });
}));

router.post("/orders/:orderId/link-merge", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { orderId } = req.params;
  const { targetOrderId } = req.body;
  if (!targetOrderId || typeof targetOrderId !== 'string') return res.status(400).json({ error: "targetOrderId required" });
  if (targetOrderId === orderId) return res.status(400).json({ error: "Cannot merge an order with itself" });
  const [sourceOrder] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, mergeGroupId: orders.mergeGroupId }).from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
  const [targetOrder] = await db.select({ id: orders.id, orderNumber: orders.orderNumber, mergeGroupId: orders.mergeGroupId }).from(orders).where(and(eq(orders.id, targetOrderId), eq(orders.orgId, orgId))).limit(1);
  if (!sourceOrder || !targetOrder) return res.status(404).json({ error: "Order not found" });
  const mergeGroupId = sourceOrder.mergeGroupId || targetOrder.mergeGroupId || randomUUID();
  const mergeDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  await db.update(orders).set({ mergeGroupId, updatedAt: new Date(), internalNotes: sql`CASE WHEN ${orders.internalNotes} IS NULL OR ${orders.internalNotes} = '' THEN ${`[${mergeDate}] Merged with ${targetOrder.orderNumber} — items shipping together`} ELSE ${orders.internalNotes} || E'\n' || ${`[${mergeDate}] Merged with ${targetOrder.orderNumber} — items shipping together`} END` }).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)));
  await db.update(orders).set({ mergeGroupId, updatedAt: new Date(), internalNotes: sql`CASE WHEN ${orders.internalNotes} IS NULL OR ${orders.internalNotes} = '' THEN ${`[${mergeDate}] Merged with ${sourceOrder.orderNumber} — items shipping together`} ELSE ${orders.internalNotes} || E'\n' || ${`[${mergeDate}] Merged with ${sourceOrder.orderNumber} — items shipping together`} END` }).where(and(eq(orders.id, targetOrderId), eq(orders.orgId, orgId)));
  res.json({ success: true, mergeGroupId });
}));

router.post("/orders/:orderId/unlink-merge", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { orderId } = req.params;
  const [order] = await db.select({ id: orders.id, mergeGroupId: orders.mergeGroupId }).from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
  if (!order) return res.status(404).json({ error: "Order not found" });
  await db.update(orders).set({ mergeGroupId: null, updatedAt: new Date() }).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)));
  res.json({ success: true });
}));

router.put("/fulfillment/item/:itemId/fulfill", isApproved, asyncRoute(async (req: any, res) => {
  const itemId = req.params.itemId;
  const validatedData = updateFulfillmentSchema.parse(req.body);
  const { fulfilled } = validatedData;
  const updateData: any = { fulfilled: fulfilled === true, updatedAt: sql`CURRENT_TIMESTAMP` };
  if (fulfilled === true) { updateData.fulfilledAt = sql`CURRENT_TIMESTAMP`; } else { updateData.fulfilledAt = null; }
  await db.update(orderDetails).set(updateData).where(eq(orderDetails.id, itemId));
  broadcast(reqOrgId(req), 'picklist.fulfilled', { itemId, fulfilled });
  res.json({ success: true, itemId, fulfilled });
}));

router.get("/fulfillment/order-shipping/:orderId", isApproved, asyncRoute(async (req: any, res) => {
  const { orderId } = req.params;
  const orgId = reqOrgId(req);
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return res.status(404).json({ error: "Order not found" });
  const [weightRows, [settings]] = await Promise.all([
    db.select({
      totalWeightGrams: sql<string>`COALESCE(SUM(CASE WHEN ${orderDetails.weight} IS NOT NULL AND CAST(${orderDetails.weight} AS DECIMAL) > 0 THEN CAST(${orderDetails.weight} AS DECIMAL) * ${orderDetails.quantity} WHEN ${blCatalog.blCatalogWeight} IS NOT NULL AND ${blCatalog.blCatalogWeight} > 0 THEN ${blCatalog.blCatalogWeight} * ${orderDetails.quantity} ELSE 0 END), 0)`,
      lotCount: sql<string>`COUNT(*)`,
    }).from(orderDetails).leftJoin(blInventory, eq(orderDetails.bricklinkInventoryId, blInventory.id)).leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId))).where(eq(orderDetails.orderId, orderId)),
    db.select({ defaultWeightMode: appSettings.defaultWeightMode, defaultWeightPerLotOz: appSettings.defaultWeightPerLotOz, defaultWeightPlusAmount: appSettings.defaultWeightPlusAmount }).from(appSettings).where(eq(appSettings.orgId, orgId)).limit(1),
  ]);
  const totalWeightGrams = parseFloat(weightRows[0]?.totalWeightGrams || "0");
  const lotCount = parseInt(weightRows[0]?.lotCount || "0", 10);
  const rawWeightOz = Math.round(totalWeightGrams * 0.035274 * 10) / 10;
  // Apply org's shipping weight formula if configured
  const weightMode = settings?.defaultWeightMode ?? 'none';
  const perLotOz  = parseFloat((settings as any)?.defaultWeightPerLotOz ?? '0') || 0;
  const plusOz    = parseFloat(settings?.defaultWeightPlusAmount ?? '0') || 0;
  let suggestedWeightOz = rawWeightOz;
  const weightModeActive = weightMode === 'order' || weightMode === 'order_plus';
  const lotAddOz = Math.round(lotCount * perLotOz * 1000) / 1000;
  if (weightModeActive && (rawWeightOz > 0 || lotAddOz > 0 || plusOz > 0)) {
    suggestedWeightOz = Math.round((rawWeightOz + lotAddOz + plusOz) * 10) / 10;
  }
  const totalWeightOz = rawWeightOz; // keep raw for reference
  let shipToData: any = {};
  try { shipToData = typeof order.shipTo === "string" ? JSON.parse(order.shipTo) : (order.shipTo || {}); } catch {}
  let linkedOrderRef: string | null = null;
  let linkedOrderNumber: string | null = null;
  if (order.mergeGroupId) {
    const linkedOrder = await db.select({ id: orders.id, orderNumber: orders.orderNumber, marketplace: orders.marketplace }).from(orders).where(and(eq(orders.mergeGroupId, order.mergeGroupId), sql`${orders.id} != ${orderId}`)).limit(1).then(rows => rows[0] ?? null);
    if (linkedOrder) {
      linkedOrderNumber = linkedOrder.orderNumber;
      const prefix = linkedOrder.marketplace === 'BrickOwl' ? 'BO.' : 'BL.';
      const num = (linkedOrder.orderNumber || '').replace(/^(BL\.|BO\.)/i, '');
      linkedOrderRef = `${prefix}${num}`;
    }
  }
  res.json({
    orderId, orderNumber: order.orderNumber, marketplace: order.marketplace, mergeGroupId: order.mergeGroupId ?? null,
    linkedOrderRef, linkedOrderNumber, requestedService: order.requestedShippingService,
    savedWeight: order.weight ? Number(order.weight) : null, savedWeightUnits: order.weightUnits || "oz",
    savedPackageType: order.packageType || null,
    savedPackageLength: order.packageLength ? Number(order.packageLength) : null,
    savedPackageWidth: order.packageWidth ? Number(order.packageWidth) : null,
    savedPackageHeight: order.packageHeight ? Number(order.packageHeight) : null,
    weightEstimateGrams: Math.round(totalWeightGrams * 10) / 10, weightEstimateOz: totalWeightOz,
    suggestedWeightOz,
    address: { name: shipToData.name || "", company: shipToData.company || "", street1: shipToData.street1 || shipToData.address1 || "", street2: shipToData.street2 || shipToData.address2 || "", city: shipToData.city || "", state: shipToData.state || "", zip: shipToData.postalCode || "", country: shipToData.country || "US", phone: shipToData.phone || "" },
  });
}));

router.get("/shipping/parcel-templates", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { appSettings: appSettingsTable, orgIntegrations: orgIntegrationsTable } = await import('@shared/schema');
  const [integration] = await db.select().from(orgIntegrationsTable).where(and(eq(orgIntegrationsTable.orgId, orgId), eq(orgIntegrationsTable.type, 'shipping'), eq(orgIntegrationsTable.isConnected, true))).limit(1);
  let apiKey: string | undefined;
  if (integration?.channel === 'easypost') {
    const creds = (integration.credentials as Record<string, string>) ?? {};
    apiKey = creds.mode === 'production' ? creds.apiKey : creds.testApiKey;
  }
  if (!apiKey) {
    const [cfg] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.orgId, orgId)).limit(1);
    const keyMode = cfg?.easypostKeyMode ?? 'test';
    apiKey = keyMode === 'production' ? cfg?.easypostApiKey ?? undefined : cfg?.easypostTestApiKey ?? undefined;
  }
  if (!apiKey) return res.json([]);
  const epRes = await fetch('https://api.easypost.com/v2/parcel_templates', { headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}` } });
  if (!epRes.ok) return res.json([]);
  const body = await epRes.json() as { parcel_templates?: any[] };
  const templates = (body.parcel_templates ?? []).filter((t: any) => !t.carrier_accounts || t.carrier_accounts.length === 0).map((t: any) => ({ id: t.id, name: t.name, length: t.length, width: t.width, height: t.height, predefined: t.predefined_package ?? null }));
  res.json(templates);
}));

router.post("/fulfillment/validate-address", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: "address is required" });
  const { getShippingProvider } = await import("../services/shipping-factory");
  const vendor = await getShippingProvider(orgId);
  if (!vendor.validateAddress) return res.status(400).json({ error: "Address validation not supported by this shipping provider" });
  const result = await vendor.validateAddress(address);
  res.json(result);
}));

router.post("/fulfillment/packing-slip", isApproved, asyncRoute(async (req, res) => {
  const { orderIds } = req.body;
  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) return res.status(400).json({ error: "orderIds array is required" });
  const orderData = await db.select().from(orders).where(inArray(orders.id, orderIds));
  if (orderData.length === 0) return res.status(404).json({ error: "No orders found" });
  const items = await db.select({
    orderId: orderDetails.orderId,
    inventoryId: sql<string>`COALESCE(CAST(${orderDetails.bricklinkInventoryId} AS TEXT), ${orderDetails.sku})`,
    bricklinkPartNumber: sql<string>`COALESCE(${blInventory.itemNo}, TRIM(SUBSTRING(${orderDetails.sku} FROM '.LGO-(.+)$')), TRIM(SUBSTRING(${orderDetails.name} FROM 'LEGO-([^ ]+)')), ${orderDetails.sku})`,
    name: orderDetails.name, quantity: orderDetails.quantity,
    colorName: sql<string>`COALESCE((SELECT bc.name FROM bl_colors bc WHERE bc.id = ${orderDetails.colorId} LIMIT 1), ${blColors.name})`,
    condition: sql<string>`COALESCE(${orderDetails.condition}, CASE WHEN ${blInventory.newOrUsed} = 'N' THEN 'New' WHEN ${blInventory.newOrUsed} = 'U' THEN 'Used' WHEN ${orderDetails.name} LIKE '%(Used)%' THEN 'Used' WHEN ${orderDetails.name} LIKE '%(New)%' THEN 'New' ELSE NULL END)`,
    comment: blInventory.description, colorId: sql<number>`COALESCE(${orderDetails.colorId}, ${blInventory.colorId})`, imageUrl: blCatalog.imageUrl,
  }).from(orderDetails)
    .leftJoin(blInventory, or(eq(blInventory.id, orderDetails.bricklinkInventoryId), and(isNull(orderDetails.bricklinkInventoryId), eq(sql`CAST(${blInventory.id} AS TEXT)`, orderDetails.sku))))
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
    .where(inArray(orderDetails.orderId, orderIds));
  const itemsByOrder = items.reduce((acc, item) => { if (!acc[item.orderId]) acc[item.orderId] = []; acc[item.orderId].push(item); return acc; }, {} as Record<string, typeof items>);
  const packingSlips = orderData.map(order => {
    let shipTo: any = {};
    try { shipTo = typeof order.shipTo === 'string' ? JSON.parse(order.shipTo) : order.shipTo; } catch (e) {}
    const orderItems = (itemsByOrder[order.id] || []).sort((a: any, b: any) => {
      const pCmp = (a.bricklinkPartNumber || '').localeCompare(b.bricklinkPartNumber || '', undefined, { numeric: true });
      if (pCmp !== 0) return pCmp;
      const cCmp = (a.condition || '').localeCompare(b.condition || '');
      if (cCmp !== 0) return cCmp;
      return (a.colorName || '').localeCompare(b.colorName || '');
    });
    if (!shipTo.name) shipTo.name = order.customerUsername || '';
    return { orderNumber: order.orderNumber, orderDate: order.orderDate, shipDate: order.shipDate, customerUsername: order.customerUsername, marketplace: order.marketplace, requestedService: order.requestedShippingService || null, carrierCode: order.carrierCode || null, serviceCode: order.serviceCode || null, shipTo, items: orderItems };
  });
  res.json(packingSlips);
}));

// ── Shipments ─────────────────────────────────────────────────────────────────

router.post("/shipments/preview", isApproved, asyncRoute(async (req, res) => {
  const { orderId, itemIdsToShip } = req.body;
  if (!orderId || !itemIdsToShip || !Array.isArray(itemIdsToShip)) return res.status(400).json({ error: "orderId and itemIdsToShip array are required" });
  const { previewShipment } = await import('../services/order-shipping');
  const preview = await previewShipment(orderId, itemIdsToShip);
  res.json(preview);
}));

router.post("/orders/:orderId/split", isApproved, asyncRoute(async (req, res) => {
  const { orderId } = req.params;
  const { itemIdsToKeep } = req.body;
  if (!itemIdsToKeep || !Array.isArray(itemIdsToKeep)) return res.status(400).json({ error: "itemIdsToKeep array is required" });
  const { splitOrder } = await import('../services/order-shipping');
  const result = await splitOrder(orderId, itemIdsToKeep);
  res.json(result);
}));

router.post("/shipments/create", isApproved, asyncRoute(async (req, res) => {
  const { orderId, fromAddress, parcel, itemIdsToShip, overrideToAddress, customsDescription, contentsType } = req.body;
  if (!orderId || !fromAddress || !parcel) return res.status(400).json({ error: "orderId, fromAddress, and parcel are required" });
  const { createShipment } = await import('../services/order-shipping');
  const result = await createShipment({ orderId, itemIdsToShip: itemIdsToShip || [], fromAddress, parcel, overrideToAddress: overrideToAddress || undefined, customsDescription: typeof customsDescription === 'string' ? customsDescription : undefined, contentsType: typeof contentsType === 'string' ? contentsType as any : undefined });
  res.json(result);
}));

router.post("/shipments/purchase", isApproved, asyncRoute(async (req: any, res) => {
  const { orderId, shipmentId, rateId, insurance } = req.body;
  if (!orderId || !shipmentId || !rateId) return res.status(400).json({ error: "orderId, shipmentId, and rateId are required" });
  const orgId = reqOrgId(req);
  const { purchaseLabel } = await import('../services/order-shipping');
  try {
    const result = await purchaseLabel(orderId, shipmentId, rateId, orgId, insurance);
    res.json(result);
  } catch (err: any) {
    const errorMessage = err.message || 'Unknown error purchasing label';
    console.error(`[Purchase Failed] orderId=${orderId} shipmentId=${shipmentId} rateId=${rateId} orgId=${orgId}: ${errorMessage}`);
    // Record the failed attempt in the shipments table for later diagnosis
    try {
      const { shipments: shipmentsTable } = await import('@shared/schema');
      await db.insert(shipmentsTable).values({
        orderId, orgId, vendorCode: 'easypost', vendorShipmentId: shipmentId,
        status: 'failed', errorMessage,
      });
    } catch (_dbErr) {}
    return res.status(500).json({ error: errorMessage });
  }
}));

router.post("/orders/:orderId/retrigger-platform-sync", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { orderId } = req.params;
  const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.orderStatus !== 'shipped' && order.orderStatus !== 'completed') return res.status(400).json({ error: "Order is not in a shipped or completed state" });
  const { shipments: shipmentsTable } = await import('@shared/schema');
  const [shipment] = await db.select().from(shipmentsTable).where(eq(shipmentsTable.orderId, orderId)).orderBy(desc(shipmentsTable.purchasedAt)).limit(1);
  const trackingNumber = shipment?.trackingNumber || '';
  const carrier = shipment?.carrier || order.carrierCode || '';
  const { syncShippedStatus } = await import('../services/order-shipping');
  await syncShippedStatus(order, trackingNumber, carrier);
  res.json({ success: true, message: `Drive-through synced for order ${order.orderNumber}` });
}));

router.post("/orders/:orderId/ship-without-label", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { orderId } = req.params;
  const { trackingNumber = '', note = '' } = req.body;
  const [order] = await db.select({ id: orders.id, orgId: orders.orgId }).from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
  if (!order) return res.status(404).json({ error: "Order not found" });
  const { shipWithoutLabel } = await import('../services/order-shipping');
  await shipWithoutLabel(orderId, orgId, String(trackingNumber).trim(), String(note).trim());
  res.json({ success: true });
}));

router.get("/shipments/:orderId", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { orderId } = req.params;
  const { shipments: shipmentsTable } = await import('@shared/schema');
  const orderShipments = await db.select().from(shipmentsTable).where(and(eq(shipmentsTable.orgId, orgId), eq(shipmentsTable.orderId, orderId))).orderBy(desc(shipmentsTable.createdAt));
  res.json(orderShipments);
}));

// ── Label Printing ────────────────────────────────────────────────────────────

router.post("/print/label", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { labelUrl } = req.body as { labelUrl: string };
  if (!labelUrl) return res.status(400).json({ error: 'labelUrl required' });
  const allowedHosts = ['easypost.com', 'assets.easypost.com', 'cargo.easypost.com'];
  const parsedUrl = new URL(labelUrl);
  if (!allowedHosts.some(h => parsedUrl.hostname.endsWith(h))) return res.status(400).json({ error: 'Label URL is not from a trusted provider' });
  const { appSettings: appSettingsTable } = await import('@shared/schema');
  const [cfg] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.orgId, orgId)).limit(1);
  if (!cfg?.labelPrinterIp) return res.status(400).json({ error: 'No printer IP configured. Set it in Settings → Printing.' });
  if (isLanIp(cfg.labelPrinterIp)) return res.status(400).json({ error: LAN_PRINT_ERROR, code: 'LAN_PRINTER' });
  const { sendZplToPrinter, fetchZplFromUrl } = await import('../services/print-service');
  const zpl = await fetchZplFromUrl(labelUrl);
  await sendZplToPrinter(cfg.labelPrinterIp, cfg.labelPrinterPort ?? 9100, zpl);
  res.json({ ok: true });
}));

router.post("/print/test", isApproved, asyncRoute(async (req: any, res) => {
  const { ip, port, labelSize } = req.body as { ip: string; port?: number; labelSize?: string };
  if (!ip) return res.status(400).json({ error: 'ip required' });
  if (isLanIp(ip)) return res.status(400).json({ error: LAN_PRINT_ERROR, code: 'LAN_PRINTER' });
  const { sendZplToPrinter, buildTestZpl } = await import('../services/print-service');
  const zpl = buildTestZpl((labelSize as '4x6' | '2x7') || '4x6');
  await sendZplToPrinter(ip, port ?? 9100, zpl);
  res.json({ ok: true });
}));

// ── Customer Feedback ─────────────────────────────────────────────────────────

router.post("/orders/:orderId/feedback-generate", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { orderId } = req.params;
  const { rating } = req.body as { rating?: 'positive' | 'neutral' | 'negative' };
  const apiKey = await getPlatformOpenAIKey();
  if (!apiKey) return res.status(400).json({ error: "OpenAI API key not configured" });
  const [order] = await db.select({ orderNumber: orders.orderNumber, marketplace: orders.marketplace, customerUsername: orders.customerUsername, orderTotal: orders.orderTotal, shipDate: orders.shipDate, orderDate: orders.orderDate }).from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
  if (!order) return res.status(404).json({ error: "Order not found" });
  let repeatCount = 0;
  if (order.customerUsername) {
    const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(orders).where(and(eq(orders.orgId, orgId), eq(orders.customerUsername, order.customerUsername), eq(orders.isTest, false)));
    repeatCount = countRow?.count ?? 1;
  }
  const ratingLabels: Record<string, string> = {
    positive: 'Positive (Praise) — the transaction went smoothly, buyer paid promptly, no issues',
    neutral:  'Neutral — the transaction was acceptable but not exceptional',
    negative: 'Negative (Complaint) — the transaction had problems such as non-payment, returns, or communication issues',
  };
  const marketplace = order.marketplace ?? 'the marketplace';
  const buyer = order.customerUsername ?? 'the buyer';
  const total = order.orderTotal ? `$${parseFloat(String(order.orderTotal)).toFixed(2)}` : 'unknown total';
  const shipDate = order.shipDate ? new Date(order.shipDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null;
  const isRepeat = repeatCount > 1;
  const DEFAULT_FEEDBACK_SYSTEM_PROMPT = `You are E.L.F.I.E., the AI assistant for a LEGO reselling store that operates on BrickLink and BrickOwl.\nGenerate a brief, genuine seller feedback comment (1–2 sentences, max 200 characters) that the store owner will post on ${marketplace} for this buyer.\nRequirements:\n- Match the tone exactly to the rating — positive is warm and appreciative, neutral is matter-of-fact, negative is professional but firm\n- Be specific: mention the buyer by username, reference the transaction if relevant\n- Do NOT use clichés like "Great buyer!" alone or "Would recommend!"\n- If the buyer is a repeat customer, briefly acknowledge their loyalty in a positive rating\n- Output ONLY the comment text — no quotes, no explanation, no JSON`;
  const [orgSettings] = await db.select({ feedbackPrompt: appSettings.feedbackPrompt }).from(appSettings).where(eq(appSettings.orgId, orgId)).limit(1);
  const systemPrompt = orgSettings?.feedbackPrompt?.trim()
    ? `${orgSettings.feedbackPrompt.trim()}\n\nIMPORTANT: Output ONLY the comment text — no quotes, no explanation, no JSON. Max 200 characters.`
    : DEFAULT_FEEDBACK_SYSTEM_PROMPT;
  const userPrompt = `Rating: ${ratingLabels[rating ?? 'positive'] ?? ratingLabels.positive}\nBuyer: ${buyer}\nMarketplace: ${marketplace}\nOrder total: ${total}${shipDate ? `\nShipped: ${shipDate}` : ''}\n${isRepeat ? `Repeat customer: Yes — this buyer has placed ${repeatCount} orders from our store` : 'First-time buyer'}\n\nWrite a 1–2 sentence feedback comment for this order.`;
  const completionModel = "gpt-4o-mini";
  const client = new OpenAI({ apiKey: String(apiKey) });
  const completion = await client.chat.completions.create({ model: completionModel, messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }], temperature: 0.5, max_tokens: 120 });
  if (completion.usage) {
    const { trackUsage } = await import('../services/ai-usage-tracker');
    trackUsage({ service: 'openai', model: completionModel, operation: 'order-feedback-generate', inputTokens: completion.usage.prompt_tokens || 0, outputTokens: completion.usage.completion_tokens || 0, totalTokens: completion.usage.total_tokens || 0, orgId: orgId || null });
  }
  const comment = completion.choices[0]?.message?.content?.trim() ?? '';
  res.json({ comment });
}));

router.post("/orders/:orderId/feedback-left", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { orderId } = req.params;
  const { rating, comment, skip } = req.body as { rating?: string; comment?: string; skip?: boolean };
  const warnings: string[] = [];
  const [order] = await db.select({ marketplace: orders.marketplace, orderNumber: orders.orderNumber, customerEmail: orders.customerEmail, customerUsername: orders.customerUsername, orderTotal: orders.orderTotal }).from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (!skip && rating && order.marketplace && order.orderNumber) {
    try {
      const { getChannelAdapter } = await import('../services/channel-factory.js');
      const adapter = getChannelAdapter(order.marketplace);
      if (adapter.postFeedback) {
        const result = await adapter.postFeedback(orgId, { channelOrderId: order.orderNumber, rating: rating as 'positive' | 'neutral' | 'negative', comment: comment ?? '' });
        if (!result.ok) { warnings.push(`Feedback comment not posted to ${order.marketplace}: ${result.message ?? 'Unknown error'}`); }
      }
    } catch (adapterErr: any) {
      warnings.push(`Feedback comment not posted to ${order.marketplace}: ${adapterErr.message ?? 'Unknown error'}`);
    }
  }
  if (!skip && order.marketplace === 'BrickLink' && order.orderNumber) {
    try {
      const { getBricklinkCredentials } = await import('../services/bricklink.js');
      const blCreds = await getBricklinkCredentials(orgId).catch(() => null);
      if (blCreds) {
        const { updateBrickLinkOrderToCompleted } = await import('../services/bricklink-orders.js');
        await updateBrickLinkOrderToCompleted(order.orderNumber, blCreds.consumerKey, blCreds.consumerSecret, blCreds.tokenValue, blCreds.tokenSecret);
      }
    } catch (blErr: any) {
      warnings.push(`Order not marked Completed on BrickLink: ${blErr.message ?? 'Unknown error'}`);
    }
    try {
      await db.update(orders).set({ orderStatus: 'completed' }).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)));
    } catch (dbErr: any) {
      console.warn(`[Feedback] Local status update failed for order ${orderId}:`, dbErr.message);
    }
  }
  const [updated] = await db.update(orders).set({ feedbackLeftAt: new Date() }).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).returning({ id: orders.id, feedbackLeftAt: orders.feedbackLeftAt });
  if (!updated) return res.status(404).json({ error: "Order not found" });
  res.json({ ...updated, warnings });
}));

router.post("/orders/:orderId/feedback-undo", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { orderId } = req.params;
  const [updated] = await db.update(orders).set({ feedbackLeftAt: null }).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).returning({ id: orders.id });
  if (!updated) return res.status(404).json({ error: "Order not found" });
  res.json(updated);
}));

// ── Picklist ──────────────────────────────────────────────────────────────────

router.get("/picklist/stats", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const activeOrders = await db.select().from(orders).where(and(eq(orders.orgId, orgId), activeOrderStatusWhere()));
  if (activeOrders.length === 0) return res.json({ toPull: 0 });

  const orderIds = activeOrders.map(o => o.id);
  const picklistItemsData = await db.select().from(picklistItems).where(inArray(picklistItems.orderId, orderIds));

  const binsToPull = new Set(
    picklistItemsData
      .filter(item => item.binId && !item.pulled)
      .map(item => item.binId)
  ).size;

  res.json({ toPull: binsToPull });
}));

router.get("/picklist/order-status", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const activeOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), activeOrderStatusWhere()));

  if (activeOrders.length === 0) return res.json({});

  const orderIds = activeOrders.map(o => o.id);
  const items = await db
    .select({ orderId: picklistItems.orderId, pulled: picklistItems.pulled })
    .from(picklistItems)
    .where(inArray(picklistItems.orderId, orderIds));

  const statusMap: Record<string, boolean> = {};
  for (const orderId of orderIds) {
    const orderItems = items.filter(i => i.orderId === orderId);
    statusMap[orderId] = orderItems.length > 0 && orderItems.every(i => i.pulled);
  }
  res.json(statusMap);
}));

router.get("/picklist", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const filter = req.query.filter as string;

  const activeOrders = await db.select().from(orders).where(and(eq(orders.orgId, orgId), activeOrderStatusWhere()));
  if (activeOrders.length === 0) return res.json([]);

  const orderIds = activeOrders.map(o => o.id);

  const [activeOrderDetails, existingPicklistItems] = await Promise.all([
    db.select().from(orderDetails).where(inArray(orderDetails.orderId, orderIds)),
    db.select().from(picklistItems).where(inArray(picklistItems.orderId, orderIds)),
  ]);

  // Deduplicate — keep most-progressed item (pulled > older)
  const dedupedPicklistMap = new Map<string, typeof existingPicklistItems[0]>();
  for (const item of existingPicklistItems) {
    const existing = dedupedPicklistMap.get(item.orderDetailId);
    if (!existing || (item.pulled && !existing.pulled) || (!item.pulled && !existing.pulled && item.createdAt < existing.createdAt)) {
      dedupedPicklistMap.set(item.orderDetailId, item);
    }
  }
  const dedupedPicklistItems = Array.from(dedupedPicklistMap.values());

  // Batch-create missing picklist items
  const existingDetailIds = new Set(dedupedPicklistItems.map(p => p.orderDetailId));
  const missingDetails = activeOrderDetails.filter(d => !existingDetailIds.has(d.id));

  if (missingDetails.length > 0) {
    const skus = Array.from(new Set(missingDetails.map(d => d.sku).filter(Boolean))) as string[];
    const skuNums = skus.map(s => parseInt(s, 10)).filter(n => !isNaN(n));
    const invBySku = skuNums.length > 0
      ? new Map(
          (await db.select({ id: blInventory.id, itemNo: blInventory.itemNo })
            .from(blInventory)
            .where(and(eq(blInventory.orgId, orgId), inArray(blInventory.id, skuNums)))
          ).map(i => [String(i.id), i])
        )
      : new Map<string, { id: number; itemNo: string }>();

    const invIds = Array.from(invBySku.values()).map(i => i.id);
    const locByInvId = invIds.length > 0
      ? new Map(
          (await db.select({ inventoryId: inventoryLocations.inventoryId, binId: inventoryLocations.binId })
            .from(inventoryLocations)
            .where(and(eq(inventoryLocations.orgId, orgId), inArray(inventoryLocations.inventoryId, invIds)))
          ).map(l => [l.inventoryId, l])
        )
      : new Map<number, { inventoryId: number; binId: number | null }>();

    const newRows = missingDetails.map(detail => {
      const inv = detail.sku ? invBySku.get(detail.sku) : undefined;
      const loc = inv ? locByInvId.get(inv.id) : undefined;
      return {
        orderDetailId: detail.id,
        orderId: detail.orderId,
        inventoryId: inv?.id ?? null,
        binId: loc?.binId ?? null,
        pulled: false,
        reshelved: false,
      };
    });

    await db.insert(picklistItems).values(newRows).onConflictDoNothing();

    const refreshed = await db.select().from(picklistItems).where(inArray(picklistItems.orderId, orderIds));
    const refreshedDedupMap = new Map<string, typeof refreshed[0]>();
    for (const item of refreshed) {
      const ex = refreshedDedupMap.get(item.orderDetailId);
      if (!ex || (item.pulled && !ex.pulled) || (!item.pulled && !ex.pulled && item.createdAt < ex.createdAt)) {
        refreshedDedupMap.set(item.orderDetailId, item);
      }
    }
    dedupedPicklistItems.length = 0;
    dedupedPicklistItems.push(...Array.from(refreshedDedupMap.values()));
  }

  let filteredItems = [...dedupedPicklistItems];
  if (filter === 'to_pull') filteredItems = filteredItems.filter(item => !item.pulled);

  const orderMap = new Map(activeOrders.map(o => [o.id, o]));
  const detailMap = new Map(activeOrderDetails.map(d => [d.id, d]));

  const uniqueBinIds = Array.from(new Set(filteredItems.map(i => i.binId).filter((id): id is number => id !== null)));
  const binsData = uniqueBinIds.length > 0
    ? await db.select().from(whBins).where(and(eq(whBins.orgId, orgId), inArray(whBins.id, uniqueBinIds)))
    : [];
  const uniqueShelfIds = Array.from(new Set(binsData.map(b => b.shelfId).filter((id): id is number => id !== null)));
  const shelvesData = uniqueShelfIds.length > 0
    ? await db.select().from(whShelves).where(and(eq(whShelves.orgId, orgId), inArray(whShelves.id, uniqueShelfIds)))
    : [];
  const uniqueAisleIds = Array.from(new Set(shelvesData.map(s => s.aisleId).filter((id): id is number => id !== null)));
  const aislesData = uniqueAisleIds.length > 0
    ? await db.select().from(whAisles).where(and(eq(whAisles.orgId, orgId), inArray(whAisles.id, uniqueAisleIds)))
    : [];
  const binMap    = new Map(binsData.map(b => [b.id, b]));
  const shelfMap  = new Map(shelvesData.map(s => [s.id, s]));
  const aisleMap  = new Map(aislesData.map(a => [a.id, a]));

  const lookupIds = filteredItems
    .map(item => {
      const d = detailMap.get(item.orderDetailId);
      const o = orderMap.get(item.orderId);
      if (o?.marketplace === 'BrickOwl') {
        return (d?.bricklinkInventoryId ?? item.inventoryId ?? null) as number | null;
      }
      const skuInt = d?.sku ? parseInt(d.sku) : NaN;
      return (!isNaN(skuInt) ? skuInt : (d?.bricklinkInventoryId ?? item.inventoryId)) as number | null;
    })
    .filter((id): id is number => id !== null);

  const uniqueInvIds = Array.from(new Set(lookupIds));
  const inventoryData = uniqueInvIds.length > 0
    ? await db
        .select({ id: blInventory.id, itemNo: blInventory.itemNo, colorName: blColors.name, colorId: blInventory.colorId, newOrUsed: blInventory.newOrUsed, remarks: blInventory.remarks, description: blInventory.description, imageUrl: blCatalog.imageUrl, quantity: blInventory.quantity })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .where(and(eq(blInventory.orgId, orgId), inArray(blInventory.id, uniqueInvIds)))
    : [];
  const invMap = new Map(inventoryData.map(i => [i.id, i]));

  const colorIdSet = new Set<number>();
  for (const inv of inventoryData) { if (!inv.colorName && inv.colorId) colorIdSet.add(inv.colorId); }
  for (const item of filteredItems) {
    const d = detailMap.get(item.orderDetailId);
    const o = orderMap.get(item.orderId);
    if (d?.colorId && o?.marketplace !== 'BrickOwl') colorIdSet.add(d.colorId);
  }
  const colorsData = colorIdSet.size > 0
    ? await db.select({ id: blColors.id, name: blColors.name }).from(blColors).where(inArray(blColors.id, Array.from(colorIdSet)))
    : [];
  const colorMap = new Map(colorsData.map(c => [c.id, c.name]));

  const binGroups = new Map<number | null, typeof filteredItems>();
  for (const item of filteredItems) {
    if (!binGroups.has(item.binId)) binGroups.set(item.binId, []);
    binGroups.get(item.binId)!.push(item);
  }

  const binPicklist = Array.from(binGroups.entries()).map(([binId, items]) => {
    let warehouseLocation = null;
    if (binId) {
      const bin = binMap.get(binId);
      const shelf = bin?.shelfId ? shelfMap.get(bin.shelfId) : undefined;
      const aisle = shelf?.aisleId ? aisleMap.get(shelf.aisleId) : undefined;
      if (bin && shelf && aisle) {
        warehouseLocation = {
          aisle: { id: aisle.id, name: aisle.name },
          shelf: { id: shelf.id, name: shelf.name },
          bin: { id: bin.id, name: bin.name, description: bin.description },
        };
      }
    }

    const itemDetails = items.map(item => {
      const detail = detailMap.get(item.orderDetailId);
      const order = orderMap.get(item.orderId);
      let lookupId: number | null;
      if (order?.marketplace === 'BrickOwl') {
        lookupId = (detail?.bricklinkInventoryId ?? item.inventoryId ?? null) as number | null;
      } else {
        const skuInt = detail?.sku ? parseInt(detail.sku) : NaN;
        lookupId = (!isNaN(skuInt) ? skuInt : (detail?.bricklinkInventoryId ?? item.inventoryId)) as number | null;
      }
      const inv = lookupId ? invMap.get(Number(lookupId)) : undefined;

      let partNumber: string | null = inv?.itemNo ?? null;
      let colorName: string | null = null;
      let condition: string | null = detail?.condition ?? null;

      if (inv) {
        colorName = inv.colorName ?? (inv.colorId ? colorMap.get(inv.colorId) ?? null : null);
        if (!condition && inv.newOrUsed) condition = inv.newOrUsed;
      }
      if (!colorName && detail?.colorId && order?.marketplace !== 'BrickOwl') {
        colorName = colorMap.get(detail.colorId) ?? null;
      }

      if (order?.marketplace === 'BrickOwl') {
        const name = detail?.name ?? '';
        if (!partNumber) { const m = name.match(/\((\d[0-9a-zA-Z]*)/); if (m) partNumber = m[1]; }
        if (!condition) {
          if (/^\(New\)/i.test(name)) condition = 'New';
          else if (/^\(Used\)/i.test(name)) condition = 'Used';
        }
      }

      return {
        picklistItemId: item.id,
        orderDetailId: item.orderDetailId,
        orderId: item.orderId,
        orderNumber: order?.orderNumber,
        marketplace: order?.marketplace ?? null,
        customerNotes: order?.customerNotes ?? null,
        itemName: detail?.name,
        quantity: detail?.quantity,
        sku: detail?.sku,
        partNumber,
        colorName,
        colorId: inv?.colorId ?? null,
        condition,
        pulled: item.pulled,
        inventoryId: lookupId,
        remarks: inv?.remarks ?? null,
        comment: inv?.description ?? null,
        imageUrl: inv?.imageUrl ?? null,
        inventoryQty: inv?.quantity ?? null,
      };
    });

    return {
      binId,
      warehouseLocation,
      itemCount: items.length,
      items: itemDetails,
      pulled: items.every(i => i.pulled),
    };
  });

  binPicklist.sort((a, b) => {
    if (!a.warehouseLocation && !b.warehouseLocation) return 0;
    if (!a.warehouseLocation) return 1;
    if (!b.warehouseLocation) return -1;
    const aisleCompare = b.warehouseLocation.aisle.name.localeCompare(a.warehouseLocation.aisle.name, undefined, { numeric: true });
    if (aisleCompare !== 0) return aisleCompare;
    const shelfCompare = a.warehouseLocation.shelf.name.localeCompare(b.warehouseLocation.shelf.name, undefined, { numeric: true });
    if (shelfCompare !== 0) return shelfCompare;
    return a.warehouseLocation.bin.name.localeCompare(b.warehouseLocation.bin.name, undefined, { numeric: true });
  });

  res.json(binPicklist);
}));

router.put("/picklist/bin/:binId/pull", isApproved, asyncRoute(async (req, res) => {
  const binId = parseInt(req.params.binId);
  const { pulled } = req.body;
  const updateData: any = { pulled: pulled === true, updatedAt: sql`CURRENT_TIMESTAMP` };
  if (pulled === true) { updateData.pulledAt = sql`CURRENT_TIMESTAMP`; } else { updateData.pulledAt = null; }
  await db.update(picklistItems).set(updateData).where(eq(picklistItems.binId, binId));
  broadcast(reqOrgId(req as any), 'picklist.pulled', { binId, pulled });
  res.json({ success: true, binId, pulled });
}));

router.delete("/picklist/shipped", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const shippedOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), eq(orders.orderStatus, 'shipped')));
  if (shippedOrders.length === 0) return res.json({ deleted: 0 });
  const shippedOrderIds = shippedOrders.map(o => o.id);
  await db.delete(picklistItems).where(inArray(picklistItems.orderId, shippedOrderIds));
  res.json({ deleted: shippedOrderIds.length });
}));

router.put("/picklist/item/:itemId/pull", isApproved, asyncRoute(async (req, res) => {
  const { itemId } = req.params;
  const { pulled } = req.body;
  const updateData: any = {
    pulled: pulled === true,
    updatedAt: sql`CURRENT_TIMESTAMP`,
    pulledAt: pulled === true ? sql`CURRENT_TIMESTAMP` : null,
  };
  await db.update(picklistItems).set(updateData).where(eq(picklistItems.id, itemId));
  broadcast(reqOrgId(req as any), 'picklist.pulled', { itemId, pulled });
  res.json({ success: true, itemId, pulled });
}));

// ── Dry-Run Order Sync Test ────────────────────────────────────────────────────

router.post("/orders/dry-run-test", isApproved, asyncRoute(async (req: any, res) => {
  const { platform, limit = 5 } = req.body;
  const orgId = reqOrgId(req);
  const settings = await getOrgSettings(orgId);
  if (!settings) return res.status(400).json({ error: "API credentials not configured" });

  const results: any[] = [];

  if (platform === 'bricklink' || platform === 'both') {
    try {
      const { getBricklinkCredentials: getBLCreds } = await import('../services/bricklink');
      const blCreds = await getBLCreds(orgId).catch(() => null);
      if (blCreds) {
        const recentBLOrders = await db.select()
          .from(orders)
          .where(and(
            eq(orders.marketplace, 'BrickLink'),
            or(
              eq(orders.orderStatus, 'awaiting_payment'),
              eq(orders.orderStatus, 'awaiting_fulfillment'),
              eq(orders.orderStatus, 'awaiting_shipment')
            )
          ))
          .orderBy(desc(orders.orderDate))
          .limit(limit);

        for (const ssOrder of recentBLOrders) {
          try {
            const orderId = ssOrder.orderNumber.replace('BL.', '');
            const ssItems = await db.select().from(orderDetails).where(eq(orderDetails.orderId, ssOrder.id));

            let platformOrder: any = null;
            let platformItems: any[] = [];
            try {
              platformOrder = {
                orderNumber: orderId,
                marketplace: 'BrickLink',
                orderDate: ssOrder.orderDate,
                orderStatus: ssOrder.orderStatus,
                customerUsername: ssOrder.customerUsername,
                customerEmail: ssOrder.customerEmail,
                orderTotal: ssOrder.orderTotal,
                shippingAmount: ssOrder.shippingAmount,
              };

              const { getBrickLinkOrderItems } = await import('../services/bricklink-orders');
              const blItems = await getBrickLinkOrderItems(
                parseInt(orderId),
                blCreds.consumerKey, blCreds.consumerSecret, blCreds.tokenValue, blCreds.tokenSecret
              );

              platformItems = await Promise.all(blItems.map(async (blItem: any) => {
                const inventoryId = blItem.inventory_id;
                const binInfo = await db
                  .select({ aisleId: whAisles.id, aisleName: whAisles.name, shelfId: whShelves.id, shelfName: whShelves.name, binId: whBins.id, binName: whBins.name })
                  .from(inventoryLocations)
                  .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
                  .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
                  .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
                  .where(and(eq(inventoryLocations.orgId, orgId), eq(inventoryLocations.inventoryId, parseInt(inventoryId || '0'))))
                  .limit(1);
                return {
                  sku: inventoryId?.toString(),
                  name: `${blItem.item?.no || ''} ${blItem.color_name || ''} ${blItem.new_or_used || ''}`.trim(),
                  quantity: blItem.quantity || 0,
                  unitPrice: parseFloat(blItem.unit_price || '0'),
                  warehouseBin: binInfo[0] || null,
                };
              }));
            } catch (apiErr: any) {
              console.error(`BrickLink API error for order ${orderId}:`, apiErr.message);
            }

            const itemsWithBins = await Promise.all(ssItems.map(async (item: any) => {
              const binInfo = await db
                .select({ aisleId: whAisles.id, aisleName: whAisles.name, shelfId: whShelves.id, shelfName: whShelves.name, binId: whBins.id, binName: whBins.name })
                .from(inventoryLocations)
                .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
                .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
                .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
                .where(and(eq(inventoryLocations.orgId, orgId), eq(inventoryLocations.inventoryId, parseInt(item.sku || '0'))))
                .limit(1);
              return { sku: item.sku, name: item.name, quantity: item.quantity, unitPrice: item.unitPrice, warehouseBin: binInfo[0] || null };
            }));

            results.push({ platform: 'BrickLink', localOrder: ssOrder, localItems: itemsWithBins, platformOrder, platformItems, issues: [] });
          } catch (orderError: any) {
            console.error(`Error processing BrickLink order:`, orderError.message || orderError);
          }
        }
      }
    } catch (blError: any) {
      console.error('BrickLink API error:', blError.message || blError);
    }
  }

  if (platform === 'brickowl' || platform === 'both') {
    const { getBrickOwlApiKey } = await import('../services/brickowl');
    const boApiKey = await getBrickOwlApiKey(orgId);
    if (!boApiKey) return res.status(400).json({ error: "BrickOwl API key not configured" });

    const { getBrickOwlOrderDetails, mapBrickOwlStatus } = await import('../services/brickowl-orders');

    const recentBOOrders = await db.select()
      .from(orders)
      .where(and(
        eq(orders.marketplace, 'BrickOwl'),
        or(
          eq(orders.orderStatus, 'awaiting_payment'),
          eq(orders.orderStatus, 'awaiting_fulfillment'),
          eq(orders.orderStatus, 'awaiting_shipment')
        )
      ))
      .orderBy(desc(orders.orderDate))
      .limit(limit);

    for (const ssOrder of recentBOOrders) {
      try {
        const orderId = ssOrder.orderNumber.replace('BO.', '');
        const ssItems = await db.select().from(orderDetails).where(eq(orderDetails.orderId, ssOrder.id));

        let platformOrder: any = null;
        let platformItems: any[] = [];
        try {
          const boOrder = await getBrickOwlOrderDetails(boApiKey, orderId);
          platformOrder = {
            orderNumber: orderId,
            marketplace: 'BrickOwl',
            orderDate: new Date(boOrder.order_time * 1000).toISOString(),
            orderStatus: mapBrickOwlStatus(boOrder.status_id),
            customerUsername: boOrder.buyer_name || boOrder.customer_username,
            customerEmail: boOrder.customer_email,
            orderTotal: boOrder.base_order_total || '0',
            shippingAmount: boOrder.ship_total || '0',
          };

          if (boOrder.items && Array.isArray(boOrder.items)) {
            platformItems = await Promise.all(boOrder.items.map(async (boItem: any) => {
              const inventoryId = boItem.external_lot_ids?.other;
              const binInfo = await db
                .select({ aisleId: whAisles.id, aisleName: whAisles.name, shelfId: whShelves.id, shelfName: whShelves.name, binId: whBins.id, binName: whBins.name })
                .from(inventoryLocations)
                .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
                .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
                .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
                .where(and(eq(inventoryLocations.orgId, orgId), eq(inventoryLocations.inventoryId, parseInt(inventoryId || '0'))))
                .limit(1);
              return {
                sku: inventoryId?.toString(),
                name: `${boItem.boid || ''} ${boItem.color_name || ''} ${boItem.condition || ''}`.trim(),
                quantity: boItem.ordered_quantity || 0,
                unitPrice: parseFloat(boItem.base_price || '0'),
                warehouseBin: binInfo[0] || null,
              };
            }));
          }
        } catch (apiErr: any) {
          console.error(`BrickOwl API error for order ${orderId}:`, apiErr.message);
        }

        const itemsWithBins = await Promise.all(ssItems.map(async (item: any) => {
          const binInfo = await db
            .select({ aisleId: whAisles.id, aisleName: whAisles.name, shelfId: whShelves.id, shelfName: whShelves.name, binId: whBins.id, binName: whBins.name })
            .from(inventoryLocations)
            .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
            .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
            .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
            .where(and(eq(inventoryLocations.orgId, orgId), eq(inventoryLocations.inventoryId, parseInt(item.sku || '0'))))
            .limit(1);
          return { sku: item.sku, name: item.name, quantity: item.quantity, unitPrice: item.unitPrice, warehouseBin: binInfo[0] || null };
        }));

        results.push({ platform: 'BrickOwl', localOrder: ssOrder, localItems: itemsWithBins, platformOrder, platformItems, issues: [] });
      } catch (err: any) {
        console.error(`Error processing BrickOwl order:`, err.message);
      }
    }
  }

  res.json({ success: true, results });
}));

// ── Picklist ────────────────────────────────────────────────────────────────

// Get picklist stats (unique bins still to pull)
router.get("/api/picklist/stats", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const activeOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), activeOrderStatusWhere()));

  if (activeOrders.length === 0) return res.json({ toPull: 0, toReshelve: 0 });

  const orderIds = activeOrders.map(o => o.id);
  const picklistItemsData = await db
    .select()
    .from(picklistItems)
    .where(inArray(picklistItems.orderId, orderIds));

  const stats = {
    toPull: new Set(
      picklistItemsData
        .filter(i => !i.pulled && i.binId !== null)
        .map(i => i.binId)
    ).size,
    toReshelve: picklistItemsData.filter(i => i.reshelved).length,
  };

  res.json(stats);
}));

// Per-order picklist completion — returns { [orderId]: allPulled }
router.get("/api/picklist/order-status", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const activeOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), activeOrderStatusWhere()));

  if (activeOrders.length === 0) return res.json({});

  const orderIds = activeOrders.map(o => o.id);
  const items = await db
    .select({ orderId: picklistItems.orderId, pulled: picklistItems.pulled })
    .from(picklistItems)
    .where(inArray(picklistItems.orderId, orderIds));

  // Group by order and compute allPulled
  const statusMap: Record<string, boolean> = {};
  for (const orderId of orderIds) {
    const orderItems = items.filter(i => i.orderId === orderId);
    statusMap[orderId] = orderItems.length > 0 && orderItems.every(i => i.pulled);
  }

  res.json(statusMap);
}));

// Get picklist items for active orders (awaiting payment, awaiting shipment, awaiting fulfillment)
router.get("/api/picklist", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const filter = req.query.filter as string; // 'to_pull' | 'to_reshelve' | undefined
  
  // ── Fetch base data ────────────────────────────────────────────────────
  const activeOrders = await db.select().from(orders).where(and(eq(orders.orgId, orgId), activeOrderStatusWhere()));
  if (activeOrders.length === 0) return res.json([]);

  const orderIds = activeOrders.map(o => o.id);

  const [activeOrderDetails, existingPicklistItems] = await Promise.all([
    db.select().from(orderDetails).where(inArray(orderDetails.orderId, orderIds)),
    db.select().from(picklistItems).where(inArray(picklistItems.orderId, orderIds)),
  ]);

  // ── Deduplicate picklist items by orderDetailId ────────────────────────
  // Guard against race-condition duplicates that may exist in the DB.
  // Keep the most-progressed item (pulled preferred, then oldest createdAt).
  const dedupedPicklistMap = new Map<string, typeof existingPicklistItems[0]>();
  for (const item of existingPicklistItems) {
    const existing = dedupedPicklistMap.get(item.orderDetailId);
    if (!existing || (item.pulled && !existing.pulled) || (!item.pulled && !existing.pulled && item.createdAt < existing.createdAt)) {
      dedupedPicklistMap.set(item.orderDetailId, item);
    }
  }
  const dedupedPicklistItems = Array.from(dedupedPicklistMap.values());

  // ── Batch-create missing picklist items (was N+1) ─────────────────────
  const existingDetailIds = new Set(dedupedPicklistItems.map(p => p.orderDetailId));
  const missingDetails = activeOrderDetails.filter(d => !existingDetailIds.has(d.id));

  if (missingDetails.length > 0) {
    // One query for all SKUs (by numeric inventory lot ID), one for all locations.
    // BrickLink order_details.sku stores the BrickLink inventory lot ID (integer),
    // so we look up bl_inventory by id, not itemNo.
    const skus = Array.from(new Set(missingDetails.map(d => d.sku).filter(Boolean))) as string[];
    const skuNums = skus.map(s => parseInt(s, 10)).filter(n => !isNaN(n));
    const invBySku = skuNums.length > 0
      ? new Map(
          (await db.select({ id: blInventory.id, itemNo: blInventory.itemNo })
            .from(blInventory)
            .where(and(eq(blInventory.orgId, orgId), inArray(blInventory.id, skuNums)))
          ).map(i => [String(i.id), i])
        )
      : new Map<string, { id: number; itemNo: string }>();

    const invIds = Array.from(invBySku.values()).map(i => i.id);
    const locByInvId = invIds.length > 0
      ? new Map(
          (await db.select({ inventoryId: inventoryLocations.inventoryId, binId: inventoryLocations.binId })
            .from(inventoryLocations)
            .where(and(eq(inventoryLocations.orgId, orgId), inArray(inventoryLocations.inventoryId, invIds)))
          ).map(l => [l.inventoryId, l])
        )
      : new Map<number, { inventoryId: number; binId: number | null }>();

    const newRows = missingDetails.map(detail => {
      const inv = detail.sku ? invBySku.get(detail.sku) : undefined;
      const loc = inv ? locByInvId.get(inv.id) : undefined;
      return {
        orderDetailId: detail.id,
        orderId: detail.orderId,
        inventoryId: inv?.id ?? null,
        binId: loc?.binId ?? null,
        pulled: false,
        reshelved: false,
      };
    });

    // onConflictDoNothing guards against the race condition where two concurrent
    // requests both pass the existingDetailIds check before either insert commits.
    await db.insert(picklistItems).values(newRows).onConflictDoNothing();

    // Refresh picklist items after insert and re-deduplicate
    const refreshed = await db.select().from(picklistItems).where(inArray(picklistItems.orderId, orderIds));
    const refreshedDedupMap = new Map<string, typeof refreshed[0]>();
    for (const item of refreshed) {
      const ex = refreshedDedupMap.get(item.orderDetailId);
      if (!ex || (item.pulled && !ex.pulled) || (!item.pulled && !ex.pulled && item.createdAt < ex.createdAt)) {
        refreshedDedupMap.set(item.orderDetailId, item);
      }
    }
    dedupedPicklistItems.length = 0;
    dedupedPicklistItems.push(...Array.from(refreshedDedupMap.values()));
  }

  // ── Apply filters ───────────────────────────────────────────────────────
  let filteredItems = [...dedupedPicklistItems];
  if (filter === 'to_pull') {
    filteredItems = filteredItems.filter(item => !item.pulled);
  }

  // ── Batch all lookups for the build phase (was N+1 per bin/item) ───────
  const orderMap = new Map(activeOrders.map(o => [o.id, o]));
  const detailMap = new Map(activeOrderDetails.map(d => [d.id, d]));

  // Warehouse location: bin → shelf → aisle (3 queries total, was 3 per bin)
  const uniqueBinIds = Array.from(new Set(filteredItems.map(i => i.binId).filter((id): id is number => id !== null)));
  const binsData = uniqueBinIds.length > 0
    ? await db.select().from(whBins).where(and(eq(whBins.orgId, orgId), inArray(whBins.id, uniqueBinIds)))
    : [];
  const uniqueShelfIds = Array.from(new Set(binsData.map(b => b.shelfId).filter((id): id is number => id !== null)));
  const shelvesData = uniqueShelfIds.length > 0
    ? await db.select().from(whShelves).where(and(eq(whShelves.orgId, orgId), inArray(whShelves.id, uniqueShelfIds)))
    : [];
  const uniqueAisleIds = Array.from(new Set(shelvesData.map(s => s.aisleId).filter((id): id is number => id !== null)));
  const aislesData = uniqueAisleIds.length > 0
    ? await db.select().from(whAisles).where(and(eq(whAisles.orgId, orgId), inArray(whAisles.id, uniqueAisleIds)))
    : [];
  const binMap = new Map(binsData.map(b => [b.id, b]));
  const shelfMap = new Map(shelvesData.map(s => [s.id, s]));
  const aisleMap = new Map(aislesData.map(a => [a.id, a]));

  // Inventory: collect all lookup IDs, one query (was 1 per item)
  // IMPORTANT: For BrickOwl orders the SKU is the BO inventory ID — NOT a BL inventory ID.
  // Only use parseInt(sku) as a BL inventory lookup key for BrickLink orders.
  const lookupIds = filteredItems
    .map(item => {
      const d = detailMap.get(item.orderDetailId);
      const o = orderMap.get(item.orderId);
      if (o?.marketplace === 'BrickOwl') {
        return (d?.bricklinkInventoryId ?? item.inventoryId ?? null) as number | null;
      }
      const skuInt = d?.sku ? parseInt(d.sku) : NaN;
      return (!isNaN(skuInt) ? skuInt : (d?.bricklinkInventoryId ?? item.inventoryId)) as number | null;
    })
    .filter((id): id is number => id !== null);

  const uniqueInvIds = Array.from(new Set(lookupIds));
  const inventoryData = uniqueInvIds.length > 0
    ? await db
        .select({ id: blInventory.id, itemNo: blInventory.itemNo, colorName: blColors.name, colorId: blInventory.colorId, newOrUsed: blInventory.newOrUsed, remarks: blInventory.remarks, description: blInventory.description, imageUrl: blCatalog.imageUrl, quantity: blInventory.quantity })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .where(and(eq(blInventory.orgId, orgId), inArray(blInventory.id, uniqueInvIds)))
    : [];
  const invMap = new Map(inventoryData.map(i => [i.id, i]));

  // Colors: gather all needed color IDs, one query (was up to 2 per item)
  // IMPORTANT: BrickOwl stores its own color IDs in order_details.colorId, which are a
  // completely different numbering system from BrickLink color IDs. Only use detail.colorId
  // as a lookup key in blColors (which is keyed by BrickLink IDs) for BrickLink orders.
  const colorIdSet = new Set<number>();
  for (const inv of inventoryData) {
    if (!inv.colorName && inv.colorId) colorIdSet.add(inv.colorId);
  }
  for (const item of filteredItems) {
    const d = detailMap.get(item.orderDetailId);
    const o = orderMap.get(item.orderId);
    if (d?.colorId && o?.marketplace !== 'BrickOwl') colorIdSet.add(d.colorId);
  }
  const colorsData = colorIdSet.size > 0
    ? await db.select({ id: blColors.id, name: blColors.name }).from(blColors).where(inArray(blColors.id, Array.from(colorIdSet)))
    : [];
  const colorMap = new Map(colorsData.map(c => [c.id, c.name]));

  // ── Build result entirely from in-memory maps (zero more DB queries) ───
  const binGroups = new Map<number | null, typeof filteredItems>();
  for (const item of filteredItems) {
    if (!binGroups.has(item.binId)) binGroups.set(item.binId, []);
    binGroups.get(item.binId)!.push(item);
  }

  const binPicklist = Array.from(binGroups.entries()).map(([binId, items]) => {
    // Resolve warehouse location
    let warehouseLocation = null;
    if (binId) {
      const bin = binMap.get(binId);
      const shelf = bin?.shelfId ? shelfMap.get(bin.shelfId) : undefined;
      const aisle = shelf?.aisleId ? aisleMap.get(shelf.aisleId) : undefined;
      if (bin && shelf && aisle) {
        warehouseLocation = {
          aisle: { id: aisle.id, name: aisle.name },
          shelf: { id: shelf.id, name: shelf.name },
          bin: { id: bin.id, name: bin.name, description: bin.description },
        };
      }
    }

    const itemDetails = items.map(item => {
      const detail = detailMap.get(item.orderDetailId);
      const order = orderMap.get(item.orderId);
      // For BrickOwl orders the SKU is a BO inventory ID — do NOT use it as a BL inventory key.
      let lookupId: number | null;
      if (order?.marketplace === 'BrickOwl') {
        lookupId = (detail?.bricklinkInventoryId ?? item.inventoryId ?? null) as number | null;
      } else {
        const skuInt = detail?.sku ? parseInt(detail.sku) : NaN;
        lookupId = (!isNaN(skuInt) ? skuInt : (detail?.bricklinkInventoryId ?? item.inventoryId)) as number | null;
      }
      const inv = lookupId ? invMap.get(Number(lookupId)) : undefined;

      let partNumber: string | null = inv?.itemNo ?? null;
      let colorName: string | null = null;
      let condition: string | null = detail?.condition ?? null;

      if (inv) {
        colorName = inv.colorName ?? (inv.colorId ? colorMap.get(inv.colorId) ?? null : null);
        if (!condition && inv.newOrUsed) {
          condition = inv.newOrUsed;
        }
      }
      // Only fall back to detail.colorId for BrickLink orders.
      // BrickOwl uses its own color ID system — looking those up in blColors gives wrong results.
      if (!colorName && detail?.colorId && order?.marketplace !== 'BrickOwl') {
        colorName = colorMap.get(detail.colorId) ?? null;
      }

      // BrickOwl: extract part number and condition from item name when not resolved from inventory.
      // BO name format: "(New)  LEGO Black Plate 1 x 2 with Horizontal Clips (60470)" or
      //                 "961948-38 - LEGO Black Plate 1 x 1 Round (6141 / 30057)"
      // Condition is at the start in parens: (New) / (Used).
      // Part number is the first digit-starting token inside parentheses.
      if (order?.marketplace === 'BrickOwl') {
        const name = detail?.name ?? '';
        if (!partNumber) {
          // Match first (NNN...) where NNN starts with a digit — skips (New) and (Used)
          const m = name.match(/\((\d[0-9a-zA-Z]*)/);
          if (m) partNumber = m[1];
        }
        if (!condition) {
          if (/^\(New\)/i.test(name)) condition = 'New';
          else if (/^\(Used\)/i.test(name)) condition = 'Used';
        }
      }

      return {
        picklistItemId: item.id,
        orderDetailId: item.orderDetailId,
        orderId: item.orderId,
        orderNumber: order?.orderNumber,
        marketplace: order?.marketplace ?? null,
        customerNotes: order?.customerNotes ?? null,
        itemName: detail?.name,
        quantity: detail?.quantity,
        sku: detail?.sku,
        partNumber,
        colorName,
        // BrickLink color ID from bl_inventory — used by the PDF image proxy
        // (/api/images/parts/:partNum/:colorId) to construct the correct CDN URL.
        colorId: inv?.colorId ?? null,
        condition,
        pulled: item.pulled,
        inventoryId: lookupId,
        remarks: inv?.remarks ?? null,
        comment: inv?.description ?? null,
        imageUrl: inv?.imageUrl ?? null,
        inventoryQty: inv?.quantity ?? null,
      };
    });

    return {
      binId,
      warehouseLocation,
      itemCount: items.length,
      items: itemDetails,
      pulled: items.every(i => i.pulled),
    };
  });

  // Sort: aisle desc, shelf asc, bin asc — unlocated bins last
  binPicklist.sort((a, b) => {
    if (!a.warehouseLocation && !b.warehouseLocation) return 0;
    if (!a.warehouseLocation) return 1;
    if (!b.warehouseLocation) return -1;
    const aisleCompare = b.warehouseLocation.aisle.name.localeCompare(a.warehouseLocation.aisle.name, undefined, { numeric: true });
    if (aisleCompare !== 0) return aisleCompare;
    const shelfCompare = a.warehouseLocation.shelf.name.localeCompare(b.warehouseLocation.shelf.name, undefined, { numeric: true });
    if (shelfCompare !== 0) return shelfCompare;
    return a.warehouseLocation.bin.name.localeCompare(b.warehouseLocation.bin.name, undefined, { numeric: true });
  });

  res.json(binPicklist);
}));

// Update bin pulled status (all items in bin)
router.put("/api/picklist/bin/:binId/pull", isApproved, asyncRoute(async (req, res) => {
  const binId = parseInt(req.params.binId);
  const { pulled } = req.body;
  
  const updateData: any = {
    pulled: pulled === true,
    updatedAt: sql`CURRENT_TIMESTAMP`
  };
  
  // Set pulledAt timestamp when marking as pulled, clear when unmarking
  if (pulled === true) {
    updateData.pulledAt = sql`CURRENT_TIMESTAMP`;
  } else {
    updateData.pulledAt = null;
  }
  
  // Update all items in this bin
  await db
    .update(picklistItems)
    .set(updateData)
    .where(eq(picklistItems.binId, binId));

  broadcast(reqOrgId(req as any), 'picklist.pulled', { binId, pulled });
  res.json({ success: true, binId, pulled });
}));

// Clear picklist items for shipped orders
router.delete("/api/picklist/shipped", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const shippedOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.orgId, orgId), eq(orders.orderStatus, 'shipped')));

  if (shippedOrders.length === 0) {
    return res.json({ deleted: 0 });
  }

  const shippedOrderIds = shippedOrders.map(o => o.id);
  await db.delete(picklistItems).where(inArray(picklistItems.orderId, shippedOrderIds));

  res.json({ deleted: shippedOrderIds.length });
}));

// Update individual picklist item pulled status
router.put("/api/picklist/item/:itemId/pull", isApproved, asyncRoute(async (req, res) => {
  const { itemId } = req.params;
  const { pulled } = req.body;
  const updateData: any = {
    pulled: pulled === true,
    updatedAt: sql`CURRENT_TIMESTAMP`,
    pulledAt: pulled === true ? sql`CURRENT_TIMESTAMP` : null,
  };
  await db.update(picklistItems).set(updateData).where(eq(picklistItems.id, itemId));
  broadcast(reqOrgId(req as any), 'picklist.pulled', { itemId, pulled });
  res.json({ success: true, itemId, pulled });
}));

// Dry-Run Order Sync Tester - Test with historical orders
router.post("/api/orders/dry-run-test", isApproved, asyncRoute(async (req: any, res) => {
  const { platform, limit = 5 } = req.body;
  const orgId = reqOrgId(req);
  // Get API credentials
  const settings = await getOrgSettings(orgId);
  if (!settings) {
    return res.status(400).json({ error: "API credentials not configured" });
  }

  const results: any[] = [];

  // Test BrickLink orders
  if (platform === 'bricklink' || platform === 'both') {
    try {
      const { getBricklinkCredentials: getBLCreds } = await import('../services/bricklink');
      const blCreds = await getBLCreds(orgId).catch(() => null);
      if (!blCreds) {
        console.log('BrickLink API credentials missing - skipping BrickLink');
        // Don't return error - just skip BrickLink if credentials missing
      } else {

      const { getBrickLinkOrders, getBrickLinkOrderItems, mapBrickLinkStatus, mapBrickLinkCondition } = 
        await import('../services/bricklink-orders');

      // Fetch recent PENDING BrickLink orders from our local database
      // Note: BrickLink/BrickOwl APIs may not return items for shipped/completed orders
      console.log('Fetching recent PENDING BrickLink orders from local database...');
      const recentBLOrders = await db.select()
        .from(orders)
        .where(and(
          eq(orders.marketplace, 'BrickLink'),
          or(
            eq(orders.orderStatus, 'awaiting_payment'),
            eq(orders.orderStatus, 'awaiting_fulfillment'),
            eq(orders.orderStatus, 'awaiting_shipment')
          )
        ))
        .orderBy(desc(orders.orderDate))
        .limit(limit);

      console.log(`Found ${recentBLOrders.length} recent BrickLink orders in local database`);

    for (const ssOrder of recentBLOrders) {
      try {
        // Remove "BL." prefix to get BrickLink order ID
        const orderId = ssOrder.orderNumber.replace('BL.', '');
        console.log(`Processing BrickLink order ${orderId}...`);
        
        // Fetch local order items from database
        const ssItems = await db.select()
          .from(orderDetails)
          .where(eq(orderDetails.orderId, ssOrder.id));
        
        console.log(`Local DB has ${ssItems.length} items for order ${orderId}`);

        // Try to fetch platform order header and items
        let platformOrder = null;
        let platformItems: any[] = [];
        try {
          // Note: BrickLink API likely won't return items for shipped orders
          // We're just fetching to verify order exists on platform
          platformOrder = {
            orderNumber: orderId,
            marketplace: 'BrickLink',
            orderDate: ssOrder.orderDate,
            orderStatus: ssOrder.orderStatus,
            customerUsername: ssOrder.customerUsername,
            customerEmail: ssOrder.customerEmail,
            orderTotal: ssOrder.orderTotal,
            shippingAmount: ssOrder.shippingAmount,
          };

          // Try to fetch items from BrickLink API
          const { getBrickLinkOrderItems } = await import('../services/bricklink-orders');
          const blItems = await getBrickLinkOrderItems(
            parseInt(orderId),
            blCreds.consumerKey,
            blCreds.consumerSecret,
            blCreds.tokenValue,
            blCreds.tokenSecret
          );
          
          console.log(`BrickLink API returned ${blItems.length} items for order ${orderId}`);

          // Map BrickLink items to common format with warehouse bins
          platformItems = await Promise.all(blItems.map(async (blItem: any) => {
            const inventoryId = blItem.inventory_id;
            const binInfo = await db
              .select({
                aisleId: whAisles.id,
                aisleName: whAisles.name,
                shelfId: whShelves.id,
                shelfName: whShelves.name,
                binId: whBins.id,
                binName: whBins.name,
              })
              .from(inventoryLocations)
              .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
              .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
              .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
              .where(and(eq(inventoryLocations.orgId, orgId), eq(inventoryLocations.inventoryId, parseInt(inventoryId || '0'))))
              .limit(1);

            return {
              sku: inventoryId?.toString(),
              name: `${blItem.item?.no || ''} ${blItem.color_name || ''} ${blItem.new_or_used || ''}`.trim(),
              quantity: blItem.quantity || 0,
              unitPrice: parseFloat(blItem.unit_price || '0'),
              warehouseBin: binInfo[0] || null,
            };
          }));
        } catch (apiErr: any) {
          console.error(`BrickLink API error for order ${orderId}:`, apiErr.message);
        }

        const itemsWithBins = await Promise.all(ssItems.map(async (item: any) => {
          const binInfo = await db
            .select({ aisleId: whAisles.id, aisleName: whAisles.name, shelfId: whShelves.id, shelfName: whShelves.name, binId: whBins.id, binName: whBins.name })
            .from(inventoryLocations)
            .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
            .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
            .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
            .where(and(eq(inventoryLocations.orgId, orgId), eq(inventoryLocations.inventoryId, parseInt(item.sku || '0'))))
            .limit(1);
          return { sku: item.sku, name: item.name, quantity: item.quantity, unitPrice: item.unitPrice, warehouseBin: binInfo[0] || null };
        }));

        results.push({ platform: 'BrickLink', localOrder: ssOrder, localItems: itemsWithBins, platformOrder, platformItems, issues: [] });
      } catch (err: any) {
        console.error(`Error processing BrickLink order:`, err.message);
      }
    }
  }
} catch (e: any) {
  console.error('Error importing bricklink-orders service:', e.message);
}
}

  // Test BrickOwl orders
  if (platform === 'brickowl' || platform === 'both') {
    try {
      const { getBrickOwlApiKey } = await import('../services/brickowl');
      const boKey = await getBrickOwlApiKey(orgId).catch(() => null);
      if (!boKey) {
        console.log('BrickOwl API key missing - skipping BrickOwl');
      } else {

      const { getBrickOwlOrders, getBrickOwlOrderDetails, mapBrickOwlStatus, mapBrickOwlCondition } = 
        await import('../services/brickowl-orders');

      // Fetch recent BrickOwl orders from local database
      const recentBOOrders = await db.select()
        .from(orders)
        .where(and(
          eq(orders.marketplace, 'BrickOwl'),
          or(
            eq(orders.orderStatus, 'awaiting_payment'),
            eq(orders.orderStatus, 'awaiting_fulfillment'),
            eq(orders.orderStatus, 'awaiting_shipment')
          )
        ))
        .orderBy(desc(orders.orderDate))
        .limit(limit);

      for (const ssOrder of recentBOOrders) {
        try {
          const orderId = ssOrder.orderNumber.replace('BO.', '');
          
          const ssItems = await db.select()
            .from(orderDetails)
            .where(eq(orderDetails.orderId, ssOrder.id));

          let platformOrder = null;
          let platformItems: any[] = [];
          try {
            platformOrder = {
              orderNumber: orderId,
              marketplace: 'BrickOwl',
              orderDate: ssOrder.orderDate,
              orderStatus: ssOrder.orderStatus,
              customerUsername: ssOrder.customerUsername,
              customerEmail: ssOrder.customerEmail,
              orderTotal: ssOrder.orderTotal,
              shippingAmount: ssOrder.shippingAmount,
            };

            const boItems = await getBrickOwlOrderDetails(boKey, orderId);
            
            platformItems = await Promise.all(boItems.map(async (boItem: any) => {
              const inventoryId = boItem.bricklink_inventory_id || boItem.lot_id;
              const binInfo = await db
                .select({ aisleId: whAisles.id, aisleName: whAisles.name, shelfId: whShelves.id, shelfName: whShelves.name, binId: whBins.id, binName: whBins.name })
                .from(inventoryLocations)
                .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
                .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
                .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
                .where(and(eq(inventoryLocations.orgId, orgId), eq(inventoryLocations.inventoryId, parseInt(inventoryId || '0'))))
                .limit(1);
              return {
                sku: inventoryId?.toString(),
                name: `${boItem.boid || ''} ${boItem.color_name || ''} ${boItem.condition || ''}`.trim(),
                quantity: boItem.ordered_quantity || 0,
                unitPrice: parseFloat(boItem.base_price || '0'),
                warehouseBin: binInfo[0] || null,
              };
            }));
          } catch (apiErr: any) {
            console.error(`BrickOwl API error for order ${orderId}:`, apiErr.message);
          }

        const itemsWithBins = await Promise.all(ssItems.map(async (item: any) => {
          const binInfo = await db
            .select({ aisleId: whAisles.id, aisleName: whAisles.name, shelfId: whShelves.id, shelfName: whShelves.name, binId: whBins.id, binName: whBins.name })
            .from(inventoryLocations)
            .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
            .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
            .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
            .where(and(eq(inventoryLocations.orgId, orgId), eq(inventoryLocations.inventoryId, parseInt(item.sku || '0'))))
            .limit(1);
          return { sku: item.sku, name: item.name, quantity: item.quantity, unitPrice: item.unitPrice, warehouseBin: binInfo[0] || null };
        }));

        results.push({ platform: 'BrickOwl', localOrder: ssOrder, localItems: itemsWithBins, platformOrder, platformItems, issues: [] });
      } catch (err: any) {
        console.error(`Error processing BrickOwl order:`, err.message);
      }
    }
  }
} catch (e: any) {
  console.error('Error importing brickowl-orders service:', e.message);
}
}

  res.json({ success: true, results });
}));

router.use(apiErrorHandler);
export default router;
