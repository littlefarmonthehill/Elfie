import { createHash, randomUUID } from "crypto";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { getRecentLogs, clearLogs } from "./services/server-log-buffer";
import { decodeHTML } from "entities";
import { addConnection, removeConnection, broadcast } from "./sse";

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
import { storage } from "./storage";
import { sendApprovalEmail } from "./email";
import { getEffectiveLimits } from "@shared/tierConfig";
import { setupAuth, isAuthenticated, isApproved, isOrgOwner, getOrgId, isSuperAdmin } from "./auth";
import { syncBricklinkData, fetchPriceOMagicData, searchBricklinkCatalogItem, syncPriceOMagicCache, requestPomSyncStop, bricklinkCatalogRequest, calculateSuggestedPriceWithSupply } from "./services/bricklink";
import { getPomIsRunning, setPomIsRunning } from "./services/pom-scheduler";
import { syncLock } from "./services/sync-lock";
import { syncBrickLinkToBrickOwl, defaultSyncFields, SyncFieldConfig, getBrickOwlApiKey } from "./services/brickowl";
import { generateBrickLinkXML, generateInventoryCSV, listXMLBackups, getXMLBackup, saveXMLBackup } from "./services/export";
import { getProcessedPartImage, processImageFromUrl } from "./services/image-proxy";
import { db, pool } from "./db";
import { users, organizations, orders, orderDetails, blInventory, blCatalog, insertBlCatalogSchema, blCategories, blColors, appSettings, insertAppSettingsSchema, platformSettings, insertPlatformSettingsSchema, conversations, conversationThreads, syncMetadata, inventoryEmbeddings, orderEmbeddings, embeddingJobs, whZones, whAisles, whShelves, whBins, inventoryLocations, picklistItems, insertWhZoneSchema, insertWhAisleSchema, insertWhShelfSchema, insertWhBinSchema, insertInventoryLocationSchema, insertPicklistItemSchema, updateFulfillmentSchema, syncIssues, insertSyncIssueSchema, shipments, eodForms, setPartRelationships, blForumPosts, orderAdjustments, insertOrderAdjustmentSchema, brickanalyzerScans, priceGuideCache, partIdMappings, appFeedback, blCatalogClipEmbeddings, orgIntegrations, blApiCalls, marketNews, businessInsights, supportTickets, PLATFORM_ORG_ID, productVision, productOkrs, productKeyResults, productRoadmapItems, productBacklogItems, productCapabilities, featureVotes, insertProductOkrSchema, insertProductKeyResultSchema, insertProductRoadmapItemSchema, insertProductBacklogItemSchema, insertProductCapabilitySchema, pricingModel, plans, insertPlanSchema, shippingServiceMappings, pushSubscriptions, channelSyncConfig, channelLotLinks, crossPlatformSyncQueue, inventoryHistory, userImages, lotImages, itemTypeImages, insertMarketingOutreachSchema } from "@shared/schema";
import { uploadUserImage, deleteUserImage, assignImageToLot, assignImageToItemType, getImagesForLot, readFromStorage } from "./services/user-image-store";
import { eq, desc, sql, inArray, like, ilike, or, and, isNotNull, isNull, ne, count, gte, gt, lte, asc } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import FormData from "form-data";
import axios from "axios";
import OpenAI from "openai";
import { checkBrickspotterLimit, incrementBrickspotterScan, getOrgWithLimits, checkSeatLimit, checkAutomationLimit } from "./services/tierEnforcement";
import { stripeClient, createCheckoutSession, createCheckoutSessionByPlan, createPortalSession, handleStripeWebhook, changePlan, setAutoRenew, cancelSubscriptionNow } from "./services/stripe";
import billingRouter from "./routers/billing";
import conversationsRouter from "./routers/conversations";
import bulkLotsRouter from "./routers/bulkLots";
import ebayRouter from "./routers/ebay";
import userImagesRouter from "./routers/userImages";
import ordersRouter from "./routers/orders";
import platformAdminRouter from "./routers/platformAdmin";
import warehouseRouter from "./routers/warehouse";
import miscRouter from "./routers/misc";
import aiRouter from "./routers/ai";
import visionRouter from "./routers/vision";
import inventoryRouter from "./routers/inventory";
import pricingRouter from "./routers/pricing";
import syncRouter from "./routers/sync";
import { apiErrorHandler } from "./middleware/errorHandler";

// Decode HTML entities from BrickLink notes for accurate comparison.
// Normalize a note/description for comparison or display — see brickowl.ts for full rationale.
// Uses the `entities` package so ALL named + numeric HTML entities are decoded, not just 9.
// Non-breaking spaces are normalised to ASCII space; CRLF/CR → LF.

// Resolves an item name from bl_catalog with a colorId=0 (Rebrickable universal) fallback,
// then falls back to price_guide_cache.item_name if bl_catalog has no entry at all.
// Exact colorId match wins; if no color-specific row exists (e.g. only Rebrickable seeded
// a colorId=0 row before POM has synced that specific lot), the colorId=0 name is used.
// Used in every SELECT clause that reads item names from bl_catalog.
const resolvedCatalogItemName = (itemNoRef: any, itemTypeRef: any, colorIdRef: any) =>
  sql<string | null>`COALESCE(
    (SELECT item_name FROM bl_catalog WHERE item_no = ${itemNoRef} AND item_type = ${itemTypeRef} ORDER BY (color_id = ${colorIdRef})::int DESC, color_id ASC LIMIT 1),
    (SELECT item_name FROM price_guide_cache WHERE item_no = ${itemNoRef} AND item_type = ${itemTypeRef} AND item_name IS NOT NULL AND item_name != '' LIMIT 1)
  )`;

function decodeHtmlEntities(text: string | null | undefined): string {
  if (!text) return '';
  return decodeHTML(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();
}

// Shared WHERE clause for "active" orders used across picklist routes.
// Returns a new expression each call (Drizzle builders are not reusable across queries).
function activeOrderStatusWhere() {
  return or(
    like(orders.orderStatus, '%awaiting_payment%'),
    like(orders.orderStatus, '%awaiting_shipment%'),
    like(orders.orderStatus, '%awaiting_fulfillment%')
  );
}

// ─── Multi-tenant helpers ─────────────────────────────────────────────────────

/** Get the requesting user's orgId — respects super-admin impersonation. */
function reqOrgId(req: any): string {
  // If a super-admin is impersonating a tenant, use that tenant's orgId
  if (req.session?.impersonatingOrgId) return req.session.impersonatingOrgId;
  return (req.user as any)?.orgId ?? 'org_planetbrick';
}

/**
 * Fetch org's app settings, creating a default row if none exists yet.
 * This is the canonical way to read settings in route handlers.
 */
async function getOrgSettings(orgId: string) {
  const [existing] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, orgId))
    .limit(1);
  if (existing) return existing;
  // Lazy-init: create default settings row for this org
  const [created] = await db
    .insert(appSettings)
    .values({ id: orgId, orgId, aiEnabled: true })
    .onConflictDoUpdate({ target: appSettings.id, set: { orgId, updatedAt: new Date() } })
    .returning();
  return created;
}

async function updateOrgSettings(orgId: string, values: Record<string, unknown>) {
  await db.update(appSettings).set({ ...values as any, updatedAt: new Date() }).where(eq(appSettings.id, orgId));
}

/** Fetch the org's IANA timezone string (default: 'America/Chicago'). */
async function getOrgTimezone(orgId: string): Promise<string> {
  const [row] = await db.select({ tz: appSettings.orgTimezone })
    .from(appSettings)
    .where(eq(appSettings.id, orgId))
    .limit(1);
  return row?.tz ?? 'America/Chicago';
}

/**
 * Returns timezone-aware SQL raw fragments for a date range, anchored to the org's local timezone.
 * Period-aligned ranges (mtd, lastmonth, prevyear) use PostgreSQL AT TIME ZONE so boundaries are
 * computed against the org's local clock, not UTC.
 * Rolling ranges (3months, 1year) use simple NOW() - INTERVAL which is timezone-independent.
 */
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
    case '1y':        return { start: sql.raw(`(NOW() - INTERVAL '1 year')`),   end: null };
    case 'prevyear':  return { start: sql.raw(tzYear(-1)), end: sql.raw(tzYear(0)) };
    default:          return { start: null, end: null };
  }
}

/**
 * Fetch platform-level settings (single row, id='platform').
 * Creates the row on first access if it doesn't exist.
 */
export async function getPlatformSettings() {
  const [existing] = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.id, 'platform'))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(platformSettings)
    .values({ id: 'platform' })
    .onConflictDoUpdate({ target: platformSettings.id, set: { updatedAt: new Date() } })
    .returning();
  return created;
}

/**
 * Get the platform-wide OpenAI API key from the dedicated platform settings row.
 * This is the single source of truth for all OpenAI usage across every org.
 */
export async function getPlatformOpenAIKey(): Promise<string | null> {
  const settings = await getPlatformSettings();
  return settings?.openaiApiKey || null;
}

export async function getPlatformBrickLinkCredentials(): Promise<{
  consumerKey: string;
  consumerSecret: string;
  tokenValue: string;
  tokenSecret: string;
} | null> {
  const [ps] = await db.select().from(platformSettings).where(eq(platformSettings.id, PLATFORM_ORG_ID)).limit(1);
  if (!ps?.blConsumerKey || !ps?.blConsumerSecret || !ps?.blTokenValue || !ps?.blTokenSecret) {
    return null;
  }
  return {
    consumerKey: ps.blConsumerKey,
    consumerSecret: ps.blConsumerSecret,
    tokenValue: ps.blTokenValue,
    tokenSecret: ps.blTokenSecret,
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // ── One-time startup: deduplicate picklist_items ──
  // A race condition in the concurrent batch-create step could produce multiple
  // picklist_items rows sharing the same order_detail_id. Remove any extras,
  // keeping the oldest by created_at. Duplicate prevention at insert time is
  // handled by onConflictDoNothing() in the batch-create path.
  try {
    await db.execute(sql`
      DELETE FROM picklist_items
      WHERE id NOT IN (
        SELECT DISTINCT ON (order_detail_id) id
        FROM picklist_items
        ORDER BY order_detail_id, created_at ASC
      )
    `);
  } catch (e) {
    console.warn('[startup] picklist_items dedup skipped:', (e as Error).message);
  }

  // Auth middleware setup - Email/Password Authentication
  await setupAuth(app);

  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });

  // ── Domain sub-routers ────────────────────────────────────────────────────
  app.use('/api/billing', billingRouter);
  app.use('/api', conversationsRouter);
  app.use('/api/bulk-lots', bulkLotsRouter);
  app.use('/api/ebay', ebayRouter);
  app.use('/api/user-images', userImagesRouter);
  app.use('/api', ordersRouter);
  app.use('/api', platformAdminRouter);
  app.use('/api', warehouseRouter);
  app.use('/api', miscRouter);
  app.use('/api', aiRouter);
  app.use('/api', visionRouter);
  app.use('/api', inventoryRouter);
  app.use('/api', pricingRouter);
  app.use('/api', syncRouter);

  // ── Server-Sent Events ─────────────────────────────────────────────────────
  // One persistent connection per browser tab.  The client (useSSE hook) opens
  // this on mount and uses it to receive invalidation signals so all team
  // members see updates from each other instantly, without tight polling.
  app.get('/api/events', isApproved, (req: any, res) => {
    const orgId = reqOrgId(req);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    addConnection(orgId, res);

    // Keep-alive ping every 25 s — prevents proxies from timing out the connection.
    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
    }, 25000);

    req.on('close', () => {
      clearInterval(ping);
      removeConnection(orgId, res);
    });
  });

  // ── Public static documents ────────────────────────────────────────────────
  app.get('/dbs-service-agreement.html', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Driftless Business Solutions – Service Agreement</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Georgia', serif; font-size: 9pt; color: #1a1a1a; background: #fff; line-height: 1.35; }
    .page { max-width: 720px; margin: 0 auto; padding: 28px 40px 28px; }
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #2c5f8a; padding-bottom: 8px; margin-bottom: 10px; }
    .header-left .company { font-size: 15pt; font-weight: bold; color: #2c5f8a; letter-spacing: 0.04em; text-transform: uppercase; }
    .header-left .tagline { font-size: 8pt; color: #666; font-style: italic; margin-top: 2px; }
    .header-right .doc-title { font-size: 11pt; font-weight: bold; color: #1a1a1a; }
    .header-right .doc-date { font-size: 8.5pt; color: #555; margin-top: 3px; text-align: right; }
    .meta { display: flex; gap: 24px; background: #f5f8fb; border: 1px solid #d0dde8; border-radius: 4px; padding: 6px 12px; margin-bottom: 10px; font-size: 8.5pt; }
    .meta-item label { color: #666; font-style: italic; margin-right: 4px; }
    .meta-item value { font-weight: bold; }
    h2 { font-size: 9.5pt; font-weight: bold; color: #2c5f8a; text-transform: uppercase; letter-spacing: 0.05em; background: #e2e6ea; padding: 3px 8px; border-radius: 3px; margin-top: 10px; margin-bottom: 5px; }
    h3 { font-size: 9pt; font-weight: bold; color: #1a1a1a; margin-top: 7px; margin-bottom: 3px; }
    p { margin-bottom: 4px; }
    ul { padding-left: 15px; margin-bottom: 4px; }
    ul li { margin-bottom: 1px; }
    .two-col-list { columns: 2; column-gap: 20px; padding-left: 15px; margin-bottom: 4px; }
    .two-col-list li { margin-bottom: 1px; break-inside: avoid; }
    .package-choice { display: flex; gap: 10px; margin: 5px 0 6px; }
    .package-box { flex: 1; border: 1.5px solid #2c5f8a; border-radius: 4px; padding: 7px 10px; }
    .package-box .pkg-header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 2px; }
    .package-box .pkg-name { font-weight: bold; font-size: 9.5pt; color: #2c5f8a; display: flex; align-items: center; gap: 6px; }
    .package-box .pkg-price { font-size: 11pt; font-weight: bold; color: #1a1a1a; margin-left: auto; }
    .package-box .pkg-desc { font-size: 8.5pt; color: #444; }
    .checkbox { display: inline-block; width: 11px; height: 11px; border: 1.5px solid #2c5f8a; border-radius: 2px; vertical-align: middle; flex-shrink: 0; }
    .timeline { display: flex; gap: 0; margin: 5px 0 6px; border: 1px solid #d0dde8; border-radius: 4px; overflow: hidden; font-size: 8.5pt; }
    .timeline-step { flex: 1; padding: 5px 8px; border-right: 1px solid #d0dde8; }
    .timeline-step:last-child { border-right: none; }
    .timeline-step .wk { font-weight: bold; color: #2c5f8a; font-size: 8pt; }
    .section { margin-bottom: 8px; }
    .section > h2:first-child { margin-top: 0; }
    .two-col-terms { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin-top: 8px; }
    .term-block h2 { margin-top: 0; }
    .sig-section { margin-top: 10px; border-top: 1px solid #d0dde8; padding-top: 8px; }
    .pkg-select-line { font-size: 9pt; margin-bottom: 10px; }
    .pkg-select-line span { display: inline-block; width: 150px; border-bottom: 1px solid #333; margin-left: 5px; }
    .signature-block { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .sig-party label { display: block; font-size: 7.5pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
    .sig-party .party-name { font-weight: bold; font-size: 9pt; color: #1a1a1a; margin-bottom: 24px; }
    .sig-line { border-top: 1.5px solid #1a1a1a; padding-top: 3px; font-size: 8.5pt; color: #444; }
    .sig-line-2 { margin-top: 16px; border-top: 1px solid #aaa; padding-top: 3px; font-size: 8.5pt; color: #666; }
    .footer { margin-top: 8px; border-top: 1px solid #d0dde8; padding-top: 4px; text-align: center; font-size: 7.5pt; color: #999; }
    @media print {
      body { font-size: 9pt; }
      .page { padding: 16px 28px 16px; max-width: 100%; }
      h2 { page-break-after: avoid; }
      .package-choice { page-break-inside: avoid; }
      .two-col-terms { page-break-inside: avoid; }
      .sig-section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-left">
        <div class="company">Driftless Business Solutions</div>
        <div class="tagline">Customized systems that just work, so you can do the work you love</div>
      </div>
      <div class="header-right">
        <div class="doc-title">Service Agreement</div>
        <div class="doc-date">March 3, 2026</div>
      </div>
    </div>
    <div class="meta">
      <div class="meta-item"><label>Client:</label><value>Minnesota Building Contractors</value></div>
      <div class="meta-item"><label>Service Provider:</label><value>Driftless Business Solutions ("DBS")</value></div>
    </div>

    <div class="section">
      <h2>Scope of Work</h2>
      <ul class="two-col-list">
        <li>Increase residential service inquiries and referrals</li>
        <li>Lead capture and contact forms</li>
        <li>Express the Client's vision, mission, and messaging</li>
        <li>Content assets ready for marketing and social media</li>
        <li>Showcase completed work through galleries, photos, and videos</li>
        <li>MVP of the solution — designed, built, reviewed, and delivered within 4 weeks</li>
      </ul>
    </div>

    <div class="section">
      <h2>1.1 &nbsp; Initial Development</h2>
      <p>DBS will build a custom residential-focused website for <strong>Minnesota Building Contractors</strong>, including:</p>
      <ul class="two-col-list">
        <li>Custom design, layout &amp; mobile display</li>
        <li>Lead capture &amp; contact forms</li>
        <li>Residential-focused copywriting &amp; messaging</li>
        <li>Project showcase (galleries, photos, videos)</li>
      </ul>
      <div class="package-choice">
        <div class="package-box">
          <div class="pkg-header">
            <div class="pkg-name"><span class="checkbox"></span> Starter MVP</div>
            <div class="pkg-price">$1,000</div>
          </div>
          <div class="pkg-desc">Residential site with lead capture, 1–2 lightweight tools, and basic project showcase.</div>
        </div>
        <div class="package-box">
          <div class="pkg-header">
            <div class="pkg-name"><span class="checkbox"></span> Core MVP</div>
            <div class="pkg-price">$2,000</div>
          </div>
          <div class="pkg-desc">Full-featured site with lead capture workflows, enhanced showcase, and marketing-ready messaging assets.</div>
        </div>
      </div>
    </div>

    <div class="section">
      <h2>1.2 &nbsp; Ongoing Support</h2>
      <div class="package-choice">
        <div class="package-box">
          <div class="pkg-header">
            <div class="pkg-name"><span class="checkbox"></span> Starter Support</div>
            <div class="pkg-price">$600/mo</div>
          </div>
          <div class="pkg-desc">4 hrs/month — Technology maintenance, minor updates, content tweaks, messaging adjustments.</div>
        </div>
        <div class="package-box">
          <div class="pkg-header">
            <div class="pkg-name"><span class="checkbox"></span> Core Support</div>
            <div class="pkg-price">$1,250/mo</div>
          </div>
          <div class="pkg-desc">10 hrs/month — Technology maintenance, messaging updates, vendor coordination, media updates.</div>
        </div>
      </div>
      <p style="font-size:8.5pt; color:#555; margin-top:-2px;">Additional hours billed at <strong>$150/hr</strong>.</p>
    </div>

    <div class="two-col-terms">
      <div class="term-block">
        <h2>Payment Terms</h2>
        <ul>
          <li>50% due at signing; 50% upon completion</li>
          <li>Ongoing Support billed monthly</li>
        </ul>
      </div>
      <div class="term-block">
        <h2>Client Responsibilities</h2>
        <ul>
          <li>Provide access to existing site, branding &amp; content</li>
          <li>Respond promptly to approvals; identify preferred vendors</li>
        </ul>
      </div>
      <div class="term-block">
        <h2>Ownership &amp; Rights</h2>
        <ul>
          <li>All work becomes Client property upon final payment</li>
          <li>DBS may showcase work in portfolio materials</li>
        </ul>
      </div>
      <div class="term-block">
        <h2>Termination</h2>
        <ul>
          <li>Either party may terminate with 30 days written notice</li>
          <li>Client pays for all work completed through termination</li>
        </ul>
      </div>
    </div>

    <div class="sig-section">
      <div class="signature-block">
        <div class="sig-party">
          <label>Client</label>
          <div class="party-name">Minnesota Building Contractors</div>
          <div class="sig-line">Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div>
        </div>
        <div class="sig-party">
          <label>Service Provider</label>
          <div class="party-name">Driftless Business Solutions</div>
          <div class="sig-line">Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div>
        </div>
      </div>
    </div>
    <div class="footer">Driftless Business Solutions &nbsp;|&nbsp; Service Agreement &nbsp;|&nbsp; March 3, 2026</div>
  </div>
</body>
</html>`);
  });

  // GET /api/public/organizations — list org names for employee join flow (no auth)
  app.get('/api/public/organizations', async (_req, res) => {
    try {
      const allOrgs = await storage.getAllOrganizations();
      const publicOrgs = allOrgs
        .filter(o => o.isActive && o.id !== PLATFORM_ORG_ID && o.id !== '__platform__')
        .map(o => ({ id: o.id, name: o.name }));
      res.json(publicOrgs);
    } catch (error) {
      console.error("Error listing public orgs:", error);
      res.status(500).json({ message: "Failed to fetch organizations" });
    }
  });

  // GET /api/auth/user — authenticated but may not be approved
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      // Always fetch fresh from DB so superAdmin and other flags are never stale
      const freshUser = await storage.getUser(userId);
      if (!freshUser) return res.status(401).json({ message: "User not found" });
      const { password: _pw, ...safeUser } = freshUser as any;
      res.json(safeUser);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });


  // ─── Billing routes ──────────────────────────────────────────────────────────

  // GET /api/public/plans — unauthenticated endpoint for landing page (live + public plans only)
  app.get('/api/public/plans', async (_req, res) => {
    try {
      const livePlans = await db
        .select()
        .from(plans)
        .where(and(eq(plans.status, 'live'), eq(plans.isPublic, true)))
        .orderBy(asc(plans.basePrice));
      res.json(livePlans);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/plans — return only live + public plans for subscription self-selection (private/invite-only plans hidden)
  app.get('/api/plans', isAuthenticated, async (_req, res) => {
    try {
      const activePlans = await db
        .select()
        .from(plans)
        .where(and(eq(plans.status, 'live'), eq(plans.isPublic, true)))
        .orderBy(asc(plans.id));
      res.json(activePlans);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/auth/preferences — save per-user UI preferences
  app.patch('/api/auth/preferences', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const { heatmapCondition, heatmapSource, heatmapMetric } = req.body;
      const update: Record<string, string> = {};
      if (heatmapCondition === 'new' || heatmapCondition === 'used') update.heatmapCondition = heatmapCondition;
      if (heatmapSource === 'peak' || heatmapSource === 'sold' || heatmapSource === 'listed') update.heatmapSource = heatmapSource;
      if (heatmapMetric === 'max' || heatmapMetric === 'avg') update.heatmapMetric = heatmapMetric;
      if (Object.keys(update).length === 0) return res.json({ success: true });
      await db.update(users).set({ ...update, updatedAt: new Date() }).where(eq(users.id, userId));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error saving preferences:", error);
      res.status(500).json({ message: "Failed to save preferences" });
    }
  });

  // ─── Org routes ────────────────────────────────────────────────────────────

  // GET /api/org — current user's org details
  app.get('/api/org', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(404).json({ message: "No organization" });
      const org = await storage.getOrganization(orgId);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      res.json(org);
    } catch (error) {
      console.error("Error fetching org:", error);
      res.status(500).json({ message: "Failed to fetch organization" });
    }
  });

  // POST /api/org/factory-reset — org owner wipes all operational data and restarts onboarding
  // Keeps the org record, users, and billing. Deletes everything else.
  app.post('/api/org/factory-reset', isAuthenticated, isOrgOwner, async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(404).json({ message: "No organization" });

      await storage.factoryResetOrganization(orgId);

      console.log(`[Org] Factory reset by owner for org ${orgId}`);
      res.json({ success: true });
    } catch (error) {
      console.error("Error during factory reset:", error);
      res.status(500).json({ message: "Failed to factory reset" });
    }
  });

  // PATCH /api/org — org owner can update org profile
  app.patch('/api/org', isAuthenticated, isOrgOwner, async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(404).json({ message: "No organization" });
      const { name, address, phone, website, onboardingCompleted } = req.body;
      if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2)) {
        return res.status(400).json({ message: "Name must be at least 2 characters" });
      }
      const updates: Record<string, any> = {};
      if (name !== undefined) updates.name = name.trim();
      if (address !== undefined) updates.address = address || null;
      if (phone !== undefined) updates.phone = phone || null;
      if (website !== undefined) updates.website = website || null;
      if (onboardingCompleted !== undefined) updates.onboardingCompleted = !!onboardingCompleted;
      const org = await storage.updateOrganization(orgId, updates);
      res.json(org);
    } catch (error) {
      console.error("Error updating org:", error);
      res.status(500).json({ message: "Failed to update organization" });
    }
  });

  // POST /api/org/logo — upload org logo (stored as base64 data URL)
  const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
  app.post('/api/org/logo', isAuthenticated, logoUpload.single('logo'), async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(404).json({ message: "No organization" });
      if (!req.file) return res.status(400).json({ message: "No file provided" });
      if (!req.file.mimetype.startsWith('image/')) {
        return res.status(400).json({ message: "Only image files are allowed" });
      }
      const base64 = req.file.buffer.toString('base64');
      const logoUrl = `data:${req.file.mimetype};base64,${base64}`;
      const org = await storage.updateOrganization(orgId, { logoUrl });
      res.json({ logoUrl: org?.logoUrl });
    } catch (error) {
      console.error("Error uploading logo:", error);
      res.status(500).json({ message: "Failed to upload logo" });
    }
  });

  // DELETE /api/org/logo — remove org logo
  app.delete('/api/org/logo', isAuthenticated, isOrgOwner, async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(404).json({ message: "No organization" });
      await storage.updateOrganization(orgId, { logoUrl: null });
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting logo:", error);
      res.status(500).json({ message: "Failed to delete logo" });
    }
  });

  // DELETE /api/org — permanently delete the org and all its data (owner only)
  app.delete('/api/org', isAuthenticated, isOrgOwner, async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(404).json({ message: "No organization" });
      await storage.deleteOrganization(orgId);
      // If a super-admin was impersonating this org, just clear the impersonation — don't
      // log them out so they're returned to their own (PlanetBrick) admin context.
      if (req.session?.impersonatingOrgId === orgId) {
        delete req.session.impersonatingOrgId;
        delete req.session.impersonatingOrgName;
        return res.json({ success: true, wasImpersonating: true });
      }
      // Normal case: org owner deletes their own org — destroy session so they're logged out.
      req.logout?.(() => {});
      req.session?.destroy?.(() => {});
      res.json({ success: true, wasImpersonating: false });
    } catch (error) {
      console.error("Error deleting organization:", error);
      res.status(500).json({ message: "Failed to delete organization" });
    }
  });

  // ─── Admin routes ───────────────────────────────────────────────────────────

  // GET /api/admin/organizations — list all orgs with user count
  app.get('/api/admin/organizations', isApproved, async (req: any, res) => {
    try {
      const user = req.user as any;
      if (user.role !== 'admin') return res.status(403).json({ message: "Admin access required" });
      const orgs = await storage.getAllOrganizations();
      // Attach user counts
      const counts = await db
        .select({ orgId: users.orgId, count: sql<number>`count(*)::int` })
        .from(users)
        .groupBy(users.orgId);
      const countMap = new Map(counts.map(r => [r.orgId, r.count]));
      const result = orgs.map(o => ({ ...o, userCount: countMap.get(o.id) ?? 0 }));
      res.json(result);
    } catch (error) {
      console.error("Error listing orgs:", error);
      res.status(500).json({ message: "Failed to list organizations" });
    }
  });

  // PATCH /api/admin/organizations/:id — admin update plan or deactivate
  app.patch('/api/admin/organizations/:id', isApproved, async (req: any, res) => {
    try {
      const user = req.user as any;
      if (user.role !== 'admin') return res.status(403).json({ message: "Admin access required" });
      const { id } = req.params;
      const update: Record<string, any> = {};
      if (req.body.plan && ['free', 'pro', 'enterprise'].includes(req.body.plan)) update.plan = req.body.plan;
      if (typeof req.body.isActive === 'boolean') update.isActive = req.body.isActive;
      if (req.body.name && typeof req.body.name === 'string') update.name = req.body.name.trim();
      if (Object.keys(update).length === 0) return res.status(400).json({ message: "No valid fields to update" });
      const org = await storage.updateOrganization(id, update);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      res.json(org);
    } catch (error) {
      console.error("Error updating org:", error);
      res.status(500).json({ message: "Failed to update organization" });
    }
  });

  // Admin routes - get all users and manage approvals
  app.get('/api/admin/users', isApproved, async (req: any, res) => {
    try {
      const user = req.user;
      
      // Only admins can access this
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const orgId = reqOrgId(req);
      const allUsers = await storage.getAllUsers();
      // Filter to only users belonging to this org
      res.json(allUsers.filter(u => u.orgId === orgId));
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: "Failed to fetch users" });
    }
  });

  app.patch('/api/admin/users/:id/approval', isApproved, async (req: any, res) => {
    try {
      const user = req.user;
      
      // Only admins can access this
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { id } = req.params;
      const { isApproved } = req.body;

      // Ensure the target user belongs to the same org
      const orgId = reqOrgId(req);
      const targetUser = await storage.getUser(id);
      if (!targetUser || targetUser.orgId !== orgId) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Validate isApproved
      const approvalSchema = z.object({
        isApproved: z.boolean(),
      });
      
      const validation = approvalSchema.safeParse({ isApproved });
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid approval status. Must be boolean" });
      }
      
      const updatedUser = await storage.updateUserApproval(id, isApproved);
      
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }

      // Send approval email when a user is newly approved
      if (isApproved && updatedUser.email && process.env.RESEND_API_KEY) {
        try {
          const displayName = updatedUser.firstName || updatedUser.email.split("@")[0];
          let orgName = "your organization";
          if (updatedUser.orgId) {
            const org = await storage.getOrganization(updatedUser.orgId);
            if (org?.name) orgName = org.name;
          }
          const baseUrl = process.env.REPLIT_DOMAINS
            ? `https://${process.env.REPLIT_DOMAINS.split(",")[0].trim()}`
            : `http://localhost:${process.env.PORT || 5000}`;
          await sendApprovalEmail(updatedUser.email, displayName, orgName, `${baseUrl}/login`);
        } catch (emailErr) {
          console.error("[Approval] Failed to send approval email:", emailErr);
        }
      }

      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user approval:", error);
      res.status(500).json({ message: "Failed to update user approval" });
    }
  });

  app.patch('/api/admin/users/:id/role', isApproved, async (req: any, res) => {
    try {
      const user = req.user;
      
      // Only admins can access this
      if (user?.role !== 'admin') {
        return res.status(403).json({ message: "Admin access required" });
      }

      const { id } = req.params;
      const { role } = req.body;

      // Ensure the target user belongs to the same org
      const orgId = reqOrgId(req);
      const targetUserCheck = await storage.getUser(id);
      if (!targetUserCheck || targetUserCheck.orgId !== orgId) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Validate role using enum
      const roleSchema = z.object({
        role: z.enum(['customer', 'employee', 'admin']),
      });
      
      const validation = roleSchema.safeParse({ role });
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid role. Must be customer, employee, or admin" });
      }
      
      // Guardrail: if demoting an admin, ensure at least one other admin remains
      if (role !== 'admin') {
        const allUsers = await storage.getAllUsers();
        const targetUser = allUsers.find(u => u.id === id && u.orgId === orgId);
        if (targetUser?.role === 'admin') {
          const otherAdmins = allUsers.filter(u => u.id !== id && u.orgId === orgId && u.role === 'admin' && u.isApproved);
          if (otherAdmins.length === 0) {
            return res.status(400).json({ message: "Cannot remove the last admin. Promote another user to Admin first." });
          }
        }
      }
      
      const updatedUser = await storage.updateUserRole(id, role);
      
      // Check if user was found and updated
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating user role:", error);
      res.status(500).json({ message: "Failed to update user role" });
    }
  });

  app.post("/api/admin/users", isApproved, async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      if (!orgId) return res.status(403).json({ message: "No organization" });
      const { email, firstName, lastName, role } = req.body;
      if (!email || typeof email !== "string") {
        return res.status(400).json({ message: "Email is required" });
      }
      const normalizedEmail = email.toLowerCase().trim();
      const existing = await storage.getUserByEmail(normalizedEmail);
      if (existing) {
        return res.status(400).json({ message: "A user with this email already exists" });
      }
      const bcrypt = await import("bcryptjs");
      const tempPassword = Math.random().toString(36).slice(-10) + "A1!";
      const hashedPassword = await bcrypt.hash(tempPassword, 10);
      const user = await storage.createUser({
        email: normalizedEmail,
        password: hashedPassword,
        firstName: firstName || null,
        lastName: lastName || null,
        isApproved: true,
        role: role || "employee",
        orgId,
        orgRole: null,
        superAdmin: false,
      });
      res.json({ ...user, tempPassword });
    } catch (error) {
      console.error("Error creating user:", error);
      res.status(500).json({ message: "Failed to create user" });
    }
  });

  // POST /api/admin/backfill-bo-bl-links
  // For each BO order_detail whose bricklink_inventory_id is NULL or points to a non-existent BL lot,
  // look up the BO lot ID from lineItemKey and resolve the real BL inventory ID via live BO inventory.
  app.post("/api/admin/backfill-bo-bl-links", isApproved, async (req: any, res) => {
    const orgId = reqOrgId(req);
    try {
      const { getBrickOwlInventory } = await import('./services/brickowl');

      // Step 1: Build boLotId → BL inventory ID map from live BO inventory
      const boInventory = await getBrickOwlInventory(false, orgId);
      const boLotToBlInvId = new Map<string, number>();
      for (const lot of boInventory) {
        const blInvIdStr = lot.external_lot_ids?.other;
        if (blInvIdStr && lot.lot_id) {
          const parsed = parseInt(blInvIdStr, 10);
          if (!isNaN(parsed)) boLotToBlInvId.set(String(lot.lot_id), parsed);
        }
      }

      // Step 2: Find BO order_details with a broken or missing BL inventory link
      const brokenRows = await db.execute(sql`
        SELECT od.id, od.order_id, od.line_item_key, od.sku, od.bricklink_inventory_id
        FROM order_details od
        JOIN orders o ON o.id = od.order_id
        WHERE o.marketplace = 'BrickOwl'
          AND (
            od.bricklink_inventory_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM bl_inventory bi WHERE bi.id = od.bricklink_inventory_id
            )
          )
      `);

      let fixed = 0;
      const failures: string[] = [];

      for (const row of (brokenRows as any).rows) {
        // lineItemKey format: '{boOrderId}-{boLotId}'
        const key: string = row.line_item_key || '';
        const dashIdx = key.indexOf('-');
        const boLotId = dashIdx >= 0 ? key.slice(dashIdx + 1) : null;

        if (!boLotId) {
          failures.push(`id=${row.id}: cannot extract lot from key '${key}'`);
          continue;
        }

        const blInvId = boLotToBlInvId.get(boLotId);
        if (!blInvId) {
          failures.push(`id=${row.id}: BO lot ${boLotId} not found in live inventory`);
          continue;
        }

        await db.execute(sql`
          UPDATE order_details
          SET bricklink_inventory_id = ${blInvId},
              sku                    = ${String(blInvId)},
              color_id               = NULL,
              condition              = NULL
          WHERE id = ${row.id}
        `);
        fixed++;
      }

      console.log(`[Admin] backfill-bo-bl-links: ${fixed} rows fixed, ${failures.length} could not be resolved`);
      res.json({
        ok: true,
        inventoryLotsInMap: boLotToBlInvId.size,
        brokenFound: (brokenRows as any).rows.length,
        fixed,
        failures,
      });
    } catch (err: any) {
      console.error('[Admin] backfill-bo-bl-links error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/cleanup-duplicate-picklist-items
  // Removes duplicate picklist_items rows (same order_detail_id), keeping the most-progressed one.
  app.post("/api/admin/cleanup-duplicate-picklist-items", isApproved, async (req: any, res) => {
    try {
      const result = await db.execute(sql`
        DELETE FROM picklist_items
        WHERE id IN (
          SELECT id FROM (
            SELECT id,
                   ROW_NUMBER() OVER (
                     PARTITION BY order_detail_id
                     ORDER BY pulled DESC, created_at ASC
                   ) AS rn
            FROM picklist_items
          ) ranked
          WHERE rn > 1
        )
      `);
      const deleted = (result as any).rowCount ?? 0;
      console.log(`[Admin] cleanup-duplicate-picklist-items: removed ${deleted} duplicate rows`);
      res.json({ ok: true, deleted });
    } catch (err: any) {
      console.error('[Admin] cleanup-duplicate-picklist-items error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/fix-bo-visibility — set a specific BO lot invisible by BL inventory ID
  // Body: { blInventoryId: number, forSale: 0|1 }
  app.post("/api/admin/fix-bo-visibility", isApproved, async (req: any, res) => {
    const { blInventoryId, forSale = 0 } = req.body;
    if (!blInventoryId) return res.status(400).json({ error: 'blInventoryId required' });
    const orgId = reqOrgId(req);
    try {
      const { getBrickOwlInventory, updateBrickOwlLot } = await import('./services/brickowl');
      const inventory = await getBrickOwlInventory(false, orgId);
      const lot = inventory.find((l: any) => l.external_lot_ids?.other === String(blInventoryId));
      if (!lot) return res.status(404).json({ error: `No BrickOwl lot found tagged with BL inv ID ${blInventoryId}` });
      const updateResult = await updateBrickOwlLot({ lot_id: lot.lot_id, for_sale: forSale }, orgId);
      console.log(`[Admin] fix-bo-visibility: BL inv ${blInventoryId} → BO lot ${lot.lot_id} set for_sale=${forSale}`);
      res.json({ ok: true, boLotId: lot.lot_id, blInventoryId, forSale, updateResult });
    } catch (err: any) {
      console.error('[Admin] fix-bo-visibility error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/cleanup-old-orders", isApproved, async (req: any, res) => {
    try {
      const beforeDate = req.query.before
        ? new Date(req.query.before as string)
        : new Date(Date.now() - 365 * 2 * 24 * 60 * 60 * 1000); // default: 2 years ago

      const beforeStr = beforeDate.toISOString().split('T')[0];

      const targets = await db.execute(sql.raw(
        `SELECT id, order_number, order_status, order_date FROM orders
         WHERE order_status IN ('awaiting_payment','awaiting_shipment','awaiting_fulfillment','pending')
           AND (order_date IS NULL OR order_date < '${beforeStr}')
         ORDER BY order_date ASC`
      ));
      const rows = targets.rows as any[];
      const ids = rows.map((r: any) => r.id);

      if (ids.length === 0) return res.json({ deleted: 0, before: beforeStr, message: 'Nothing to clean up' });

      const idList = ids.map((id: string) => `'${id}'`).join(',');
      const d1 = await db.execute(sql.raw(`DELETE FROM order_details WHERE order_id IN (${idList})`));
      const d2 = await db.execute(sql.raw(`DELETE FROM order_adjustments WHERE order_id IN (${idList})`));
      const d3 = await db.execute(sql.raw(`DELETE FROM picklist_items WHERE order_id IN (${idList})`));
      const d4 = await db.execute(sql.raw(`DELETE FROM orders WHERE id IN (${idList})`));

      res.json({
        deleted: ids.length,
        before: beforeStr,
        orders: rows.map((r: any) => ({ id: r.id, orderNumber: r.order_number, status: r.order_status, date: r.order_date })),
        detailsDeleted: (d1 as any).rowCount,
        adjustmentsDeleted: (d2 as any).rowCount,
        picklistDeleted: (d3 as any).rowCount,
      });
    } catch (err: any) {
      console.error('Cleanup error:', err);
      res.status(500).json({ error: err.message });
    }
  });


  app.patch("/api/org/integrations/:id", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      const { credentials, isConnected, displayName } = req.body as {
        credentials?: Record<string, string>;
        isConnected?: boolean;
        displayName?: string;
      };
      const [row] = await db
        .update(orgIntegrations)
        .set({
          ...(credentials !== undefined && { credentials }),
          ...(isConnected !== undefined && { isConnected }),
          ...(displayName !== undefined && { displayName }),
          updatedAt: sql`NOW()`,
        })
        .where(and(eq(orgIntegrations.id, id), eq(orgIntegrations.orgId, orgId)))
        .returning();
      if (!row) return res.status(404).json({ error: "Integration not found" });
      res.json({ success: true, integration: row });
    } catch (error: any) {
      console.error("Error updating org integration:", error);
      res.status(500).json({ error: "Failed to update integration" });
    }
  });

  app.delete("/api/org/integrations/:id", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
      await db.delete(orgIntegrations).where(
        and(eq(orgIntegrations.id, id), eq(orgIntegrations.orgId, orgId))
      );
      res.json({ success: true });
    } catch (error: any) {
      console.error("Error deleting org integration:", error);
      res.status(500).json({ error: "Failed to delete integration" });
    }
  });

  // Export Routes
  app.get("/api/export/bricklink-xml", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const xml = await generateBrickLinkXML(orgId);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `elfie-inventory-${timestamp}.xml`;
      
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(xml);
    } catch (error) {
      console.error("Error generating BrickLink XML:", error);
      res.status(500).json({ error: "Failed to generate BrickLink XML export" });
    }
  });

  app.get("/api/export/inventory-csv", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const csv = await generateInventoryCSV(orgId);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const filename = `elfie-inventory-${timestamp}.csv`;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csv);
    } catch (error) {
      console.error("Error generating inventory CSV:", error);
      res.status(500).json({ error: "Failed to generate inventory CSV export" });
    }
  });

  app.get("/api/bricklink-quantity-comparison", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { bricklinkRequest } = await import('./services/bricklink');
      const { data: blLiveData } = await bricklinkRequest('/inventories', undefined, orgId);
      const blLiveItems: any[] = Array.isArray(blLiveData) ? blLiveData : [];

      const localItems = await db.select().from(blInventory).where(eq(blInventory.orgId, orgId));
      const localMap = new Map<number, typeof localItems[0]>();
      for (const item of localItems) localMap.set(item.id, item);

      const discrepancies: Array<{
        inventoryId: number;
        itemNo: string;
        itemType: string;
        colorId: number;
        condition: string;
        localQty: number | null;
        bricklinkQty: number;
        difference: number;
        unitPrice: string;
        remarks: string;
      }> = [];

      for (const blItem of blLiveItems) {
        const id = blItem.inventory_id;
        const blQty = blItem.quantity ?? 0;
        const local = localMap.get(id);
        const localQty = local ? local.quantity : null;

        if (localQty === null || localQty !== blQty) {
          discrepancies.push({
            inventoryId: id,
            itemNo: blItem.item?.no ?? '',
            itemType: blItem.item?.type ?? '',
            colorId: blItem.color_id ?? 0,
            condition: blItem.new_or_used ?? '',
            localQty,
            bricklinkQty: blQty,
            difference: blQty - (localQty ?? 0),
            unitPrice: blItem.unit_price ?? '',
            remarks: blItem.remarks ?? '',
          });
        }
      }

      discrepancies.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

      res.json({ success: true, total: blLiveItems.length, discrepancies });
    } catch (error: any) {
      console.error("BrickLink comparison error:", error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ── Marketing Outreach ────────────────────────────────────────────────────────
  app.get('/api/marketing/outreach', isAuthenticated, isApproved, async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      const records = await storage.getMarketingOutreach(orgId);
      res.json(records);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/marketing/outreach', isAuthenticated, isApproved, async (req: any, res) => {
    try {
      const orgId = getOrgId(req);
      const parsed = insertMarketingOutreachSchema.safeParse({ ...req.body, orgId });
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
      const record = await storage.createMarketingOutreach(parsed.data);
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Bulk Rebrickable Image Sync (one-time operation to fetch all images)
  app.use(apiErrorHandler);

  const httpServer = createServer(app);

  return httpServer;
}
