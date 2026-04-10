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
import { users, organizations, orders, orderDetails, blInventory, blCatalog, insertBlCatalogSchema, blCategories, blColors, appSettings, insertAppSettingsSchema, platformSettings, insertPlatformSettingsSchema, conversations, conversationThreads, syncMetadata, inventoryEmbeddings, orderEmbeddings, embeddingJobs, whZones, whAisles, whShelves, whBins, inventoryLocations, picklistItems, insertWhZoneSchema, insertWhAisleSchema, insertWhShelfSchema, insertWhBinSchema, insertInventoryLocationSchema, insertPicklistItemSchema, updateFulfillmentSchema, syncIssues, insertSyncIssueSchema, shipments, eodForms, setPartRelationships, blForumPosts, orderAdjustments, insertOrderAdjustmentSchema, brickanalyzerScans, priceGuideCache, partIdMappings, appFeedback, blCatalogClipEmbeddings, orgIntegrations, blApiCalls, marketNews, businessInsights, supportTickets, PLATFORM_ORG_ID, productVision, productOkrs, productKeyResults, productRoadmapItems, productBacklogItems, productCapabilities, featureVotes, insertProductOkrSchema, insertProductKeyResultSchema, insertProductRoadmapItemSchema, insertProductBacklogItemSchema, insertProductCapabilitySchema, pricingModel, plans, insertPlanSchema, shippingServiceMappings, pushSubscriptions, channelSyncConfig, channelLotLinks, crossPlatformSyncQueue, inventoryHistory, userImages, lotImages, itemTypeImages } from "@shared/schema";
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

  // ─── Brickanalyzer: Multi-piece scan endpoints ────────────────────────────

  // Background processor: Contour detection → Brickognize → POM price lookup → update DB
  // In-memory crop cache: scanId → array of JPEG Buffers (one per detected region).
  // Lives only in this process; cleared when the scan is dismissed.
  const brickanalyzerCropCache    = new Map<number, Buffer[]>();
  const brickanalyzerImageCache   = new Map<number, Buffer>();
  const brickanalyzerImageMeta    = new Map<number, { width: number; height: number }>();
  const brickanalyzerProgressMap  = new Map<number, { step: string; detail: string; pct: number; startedAt: number; stepAt: number }>();
  const setProgress = (id: number, step: string, detail: string, pct: number) => {
    const existing = brickanalyzerProgressMap.get(id);
    brickanalyzerProgressMap.set(id, { step, detail, pct, startedAt: existing?.startedAt ?? Date.now(), stepAt: Date.now() });
  };

  // Sample the dominant non-background color from a crop and return its raw RGB.
  // Color-to-BrickLink-name resolution is deferred to the enrichment stage, where
  // the match is constrained to colors the specific part actually exists in.
  // Perceptual color distance using CIE LAB Delta-E
  // Much more accurate than RGB Euclidean for human-visible color differences
  function rgbToLab(r: number, g: number, b: number): [number, number, number] {
    const lin = (c: number) => { const n = c / 255; return n <= 0.04045 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); };
    const rl = lin(r), gl = lin(g), bl = lin(b);
    const x = (rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375) / 0.95047;
    const y = (rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750) / 1.00000;
    const z = (rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041) / 1.08883;
    const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  }
  function deltaE(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
    const [L1, a1, b1l] = rgbToLab(r1, g1, b1);
    const [L2, a2, b2l] = rgbToLab(r2, g2, b2);
    return Math.sqrt((L1 - L2) ** 2 + (a1 - a2) ** 2 + (b1l - b2l) ** 2);
  }

  async function detectDominantRgb(
    cropBuffer: Buffer
  ): Promise<{ r: number; g: number; b: number } | null> {
    try {
      const { default: sharp } = await import('sharp');
      const { data: pixels, info } = await sharp(cropBuffer)
        .resize(60, 60, { fit: 'cover' })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const ch = info.channels as number;
      const counts = new Map<string, { rSum: number; gSum: number; bSum: number; n: number }>();

      for (let i = 0; i < pixels.length; i += ch) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        // Skip near-white backgrounds and pure shadows
        if (r > 215 && g > 215 && b > 215) continue;
        if (r < 15  && g < 15  && b < 15)  continue;
        // Quantize to 16-step bins for bucketing
        const key = `${r >> 4},${g >> 4},${b >> 4}`;
        const bucket = counts.get(key) ?? { rSum: 0, gSum: 0, bSum: 0, n: 0 };
        bucket.rSum += r; bucket.gSum += g; bucket.bSum += b; bucket.n++;
        counts.set(key, bucket);
      }

      if (counts.size === 0) return null;

      let best = { rSum: 0, gSum: 0, bSum: 0, n: 0 };
      for (const b of counts.values()) { if (b.n > best.n) best = b; }
      return {
        r: Math.round(best.rSum / best.n),
        g: Math.round(best.gSum / best.n),
        b: Math.round(best.bSum / best.n),
      };
    } catch {
      return null;
    }
  }

  // BrickSpotter always uses the platform BrickLink account for all catalog/price API calls.
  // The orgId param is used only for DB operations (tracking scans, storing results).
  // All bricklinkCatalogRequest calls below intentionally omit orgId so they default to
  // PLATFORM_ORG_ID — never pass orgId to those calls here.
  async function processBrickanalyzerScan(scanId: number, imageBuffer: Buffer, settings: Record<string, number> = {}, calibration = false, previewBoxes?: { x: number; y: number; w: number; h: number }[], orgId: string = 'org_planetbrick') {
    const { incrementActiveScan, decrementActiveScan } = await import('./services/segmentClient.js');
    incrementActiveScan();
    const blApiCallsCounter = { count: 0 };
    try {
      const { default: sharp } = await import('sharp');

      // Normalize EXIF orientation — mobile cameras embed rotation in EXIF metadata rather than
      // physically rotating pixels. sharp.rotate() (no args) reads the EXIF orientation tag,
      // physically reorients the pixel grid, and strips the tag. This ensures the segment
      // service, crop extraction, and display image all share the same coordinate space.
      try {
        imageBuffer = await sharp(imageBuffer).rotate().toBuffer();
      } catch { /* leave imageBuffer as-is if normalization fails */ }

      // Get image dimensions for coordinate conversion
      const imgMeta = await sharp(imageBuffer).metadata();
      const imgWidth = imgMeta.width || 1000;
      const imgHeight = imgMeta.height || 1000;

      // Initialise progress inside the processing task
      setProgress(scanId, 'Loading image', 'Decoding and resizing…', 4);

      // Cache a resized version of the original image for the film-strip overlay
      // Also persist to DB so the image survives server restarts
      try {
        const resized = await sharp(imageBuffer)
          .resize({ width: 1400, withoutEnlargement: true })
          .jpeg({ quality: 78 })
          .toBuffer();
        brickanalyzerImageCache.set(scanId, resized);
        brickanalyzerImageMeta.set(scanId, { width: imgWidth, height: imgHeight });
        db.update(brickanalyzerScans)
          .set({ imageData: resized })
          .where(eq(brickanalyzerScans.id, scanId))
          .catch(() => { /* non-fatal */ });
      } catch { /* non-fatal */ }

      // ── Calibration mode: same 4-pass segmentation as scan ─────────────────
      // Calibration supports multiple pieces in one photo (batch cataloging).
      // Size limits are relaxed so pieces that fill most of the frame are still detected.
      if (calibration) {
        settings = {
          ...settings,
          // No multiPass override — calibration now uses the same 4-pass logic as scan
          // so it can detect and catalog multiple pieces in one photo
          maxSizePct: 99,     // piece can fill virtually the entire frame
          maxDimFrac: 99,     // bbox can span virtually the full image width/height
          minSizePct: 0.5,    // 0.5% minimum — filters pure noise without rejecting small pieces
        };
        console.log('[Brickanalyzer] Calibration mode: using multi-pass segmentation (same as scan)');
      }

      // ── Step 1: Segmentation (single or multi-pass) ──────────────────────
      const { segmentImage } = await import('./services/segmentClient.js');

      const iouBox = (a: any, b: any): number => {
        const ix0 = Math.max(a.x, b.x), iy0 = Math.max(a.y, b.y);
        const ix1 = Math.min(a.x + a.w, b.x + b.w), iy1 = Math.min(a.y + a.h, b.y + b.h);
        const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
        if (inter === 0) return 0;
        return inter / (a.w * a.h + b.w * b.h - inter);
      };

      let allBoxes: { x: number; y: number; w: number; h: number }[];

      // If the client passed user-approved preview boxes, use them directly —
      // skipping re-segmentation ensures the full scan processes exactly the
      // zones the user reviewed and approved in the preview step.
      if (previewBoxes && previewBoxes.length > 0) {
        console.log(`[Brickanalyzer] Using ${previewBoxes.length} user-approved preview boxes (skipping segmentation)`);
        setProgress(scanId, 'Using preview boxes', `${previewBoxes.length} region${previewBoxes.length !== 1 ? 's' : ''} from your selection`, 15);
        allBoxes = previewBoxes;
      } else if (settings.multiPass) {
        console.log('[Brickanalyzer] Step 1: Smart Multi-Pass — running 3 concurrent segmentation passes...');
        setProgress(scanId, 'Segmenting image', 'Running 4 concurrent detection passes…', 6);

        // Pass 1 — Large pieces / Minifigs
        // Catches large LEGO objects (baseplates, big builds, minifigs) that can occupy
        // 25-55% of the frame.  maxDimFrac:90 prevents the Python default 38% cap from
        // silently rejecting wide or tall objects.
        const pass1: Record<string, any> = {
          segmenter: 'contour',
          minSizePct: 0.40,   // only genuine large objects — ignores tiny surface noise
          maxSizePct: 55,     // raised from 14 → covers objects filling up to half the frame
          maxDimFrac: 90,     // raised from Python default 38 → allows wide/tall bounding boxes
          blurRadius: 5,      // moderate blur — smooth noise on large surfaces
          cannyLow: 40,       // moderate edge sensitivity
          cannyHigh: 130,
          dilateIter: 4,      // close more gaps — large piece outlines have lots of detail
        };

        // Pass 2 — Standard (user's own settings, unchanged)
        const pass2: Record<string, any> = { ...settings };

        // Pass 3 — Small / Fine pieces
        // Contour tuned to catch 1×1 tiles, clips, small plates watershed merges or misses
        const pass3: Record<string, any> = {
          segmenter: 'contour',
          minSizePct: 0.02,   // very small minimum — catch tiny pieces
          maxSizePct: 5,      // up from 3 — catch medium shields between pass1/pass2
          blurRadius: 3,      // less blur to preserve fine detail
          cannyLow: 25,       // more sensitive to weak edges
          cannyHigh: 90,
          dilateIter: 1,      // minimal dilation — preserve small piece boundaries
        };

        // Pass 4 — CLAHE contrast-boosted pass for dark/shadowed areas
        // Phone camera vignette and dark table surfaces reduce local contrast,
        // causing standard Canny to miss pieces near image edges or on dark backgrounds.
        // CLAHE (Contrast Limited Adaptive Histogram Equalization) normalizes local
        // brightness before edge detection so these pieces become visible.
        const pass4: Record<string, any> = {
          segmenter: 'contour',
          minSizePct: 0.02,
          maxSizePct: 8,
          blurRadius: 3,
          cannyLow: 20,       // very sensitive — dark areas have weak edges
          cannyHigh: 80,
          dilateIter: 2,
          clahe: true,        // enables CLAHE preprocessing in Python service
        };

        const [boxes1, boxes2, boxes3, boxes4] = await Promise.all([
          segmentImage(imageBuffer, pass1 as any),
          segmentImage(imageBuffer, pass2 as any),
          segmentImage(imageBuffer, pass3 as any),
          segmentImage(imageBuffer, pass4 as any),
        ]);

        console.log(`[Brickanalyzer] Multi-pass results — pass1(minifig/large)=${boxes1.length}, pass2(standard)=${boxes2.length}, pass3(small/fine)=${boxes3.length}, pass4(clahe/dark)=${boxes4.length}`);

        // Merge with IoU deduplication — priority: pass1 > pass2 > pass3 > pass4
        // Threshold 0.25: slightly tighter than 0.35 so nearby-but-distinct items
        // (e.g. two adjacent shields) are more likely to stay separate.
        const merged: { x: number; y: number; w: number; h: number }[] = [];
        for (const box of [...boxes1, ...boxes2, ...boxes3, ...boxes4]) {
          if (!merged.some(m => iouBox(m, box) > 0.25)) merged.push(box);
        }

        const totalBoxes = boxes1.length + boxes2.length + boxes3.length + boxes4.length;
        console.log(`[Brickanalyzer] Multi-pass merged: ${totalBoxes} total → ${merged.length} unique regions`);
        setProgress(scanId, 'Merging detections', `${totalBoxes} raw detections → ${merged.length} unique regions`, 12);

        // Containment suppression — "minifig rule":
        // If a smaller box is >85% contained within a larger box, suppress it.
        // Threshold raised from 65% → 85% so that adjacent small pieces whose bounding
        // boxes happen to be near a larger detection are NOT wrongly suppressed.
        // A second post-Brickognize zone suppression cleans up any remaining PART boxes
        // that overlap a box ultimately identified as a MINIFIG.
        const containmentFiltered = merged.filter((box) => {
          const boxArea = box.w * box.h;
          return !merged.some((other) => {
            if (other === box) return false;
            const otherArea = other.w * other.h;
            if (otherArea <= boxArea * 1.5) return false; // only suppress if other is meaningfully larger
            const ix0 = Math.max(box.x, other.x), iy0 = Math.max(box.y, other.y);
            const ix1 = Math.min(box.x + box.w, other.x + other.w), iy1 = Math.min(box.y + box.h, other.y + other.h);
            const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
            return inter / boxArea > 0.85; // raised from 0.65 → avoids eating adjacent small pieces
          });
        });

        if (containmentFiltered.length < merged.length) {
          console.log(`[Brickanalyzer] Containment suppression: removed ${merged.length - containmentFiltered.length} sub-regions → ${containmentFiltered.length} final boxes`);
          setProgress(scanId, 'Filtering sub-regions', `${merged.length} → ${containmentFiltered.length} after containment check`, 13);
        }

        allBoxes = containmentFiltered;

      } else {
        console.log('[Brickanalyzer] Step 1: Single-pass segmentation...');
        setProgress(scanId, 'Segmenting image', 'Single-pass contour detection…', 6);
        allBoxes = await segmentImage(imageBuffer, settings as any);

        // Safety net: if nothing survived all passes, show the full frame so the user
        // can still confirm/dismiss rather than getting a blank result.
        if (allBoxes.length === 0) {
          console.log('[Brickanalyzer] 0 boxes after all passes — using full-frame fallback');
          allBoxes = [{ x: 2, y: 2, w: 96, h: 96 }];
        }
      }

      const maxPieces = settings.maxPieces ?? 50;
      const clampedBoxes = allBoxes.slice(0, maxPieces);
      if (clampedBoxes.length < allBoxes.length) {
        console.log(`[Brickanalyzer] Capped at ${maxPieces} pieces (${allBoxes.length} detected)`);
      }

      console.log(`[Brickanalyzer] Step 1 complete: ${clampedBoxes.length} pieces detected`);
      setProgress(scanId, 'Pieces detected', `Found ${clampedBoxes.length} piece${clampedBoxes.length !== 1 ? 's' : ''} — building crops…`, 15);
      const pieces: any[] = clampedBoxes.map(b => ({
        ...b, colorName: '', roughName: '', confidence: 'medium', note: '',
      }));

      if (pieces.length === 0) {
        await db.insert(syncIssues).values({
          syncType: 'brickanalyzer_scan',
          platform: 'local',
          itemId: String(scanId),
          issueType: 'no_pieces_detected',
          issueDescription: 'Brick Spotter could not detect any LEGO pieces. Try a clearer photo with pieces spread out on a contrasting background.',
          severity: 'medium',
          status: 'open',
          metadata: JSON.stringify({ scanId }),
          orgId,
        });
      }
      console.log(`[Brickanalyzer] ${pieces.length} refined regions ready for Brickognize`);

      // ── Step 2: Crop all pieces in parallel, then send to Brickognize ────
      // Padding is expressed as a fraction of image DIMENSIONS (not piece size).
      // 0.006 = 0.6% of image width/height ≈ 34px on a 5712px image.
      const PADDING = 0.006;

      // Phase 2a — Build ALL crops + detect colors in parallel.
      // Sharp extracts and color sampling are CPU/disk-bound with no external rate limits,
      // so running them all at once is safe and removes crop latency from the BQ critical path.
      console.log('[Brickanalyzer] Step 2a: Building all crops in parallel...');
      setProgress(scanId, 'Building crops', `Cropping ${pieces.length} piece region${pieces.length !== 1 ? 's' : ''} from image…`, 18);
      if (!brickanalyzerCropCache.has(scanId)) brickanalyzerCropCache.set(scanId, []);
      type CropEntry = { cropBuffer: Buffer; earlyResult?: undefined } | { cropBuffer: null; earlyResult: any[] };
      const cropData: CropEntry[] = await Promise.all(
        pieces.map(async (piece: any, idx: number): Promise<CropEntry> => {
          try {
            const x0 = Math.max(0, Math.round(((piece.x ?? 0) / 100 - PADDING) * imgWidth));
            const y0 = Math.max(0, Math.round(((piece.y ?? 0) / 100 - PADDING) * imgHeight));
            const x1 = Math.min(imgWidth,  Math.round((((piece.x ?? 0) + (piece.w ?? 20)) / 100 + PADDING) * imgWidth));
            const y1 = Math.min(imgHeight, Math.round((((piece.y ?? 0) + (piece.h ?? 20)) / 100 + PADDING) * imgHeight));
            const cropWidth  = x1 - x0;
            const cropHeight = y1 - y0;

            if (cropWidth < 12 || cropHeight < 12) {
              console.warn(`[Brickanalyzer] Piece ${idx}: crop too small (${cropWidth}×${cropHeight}), skipping`);
              return { cropBuffer: null, earlyResult: [{ partNo: '', partName: piece.roughName || 'Unknown', colorName: piece.colorName || '', confidence: 'low', note: 'crop region too small', cropIndex: idx, bboxX: piece.x, bboxY: piece.y, bboxW: piece.w, bboxH: piece.h }] };
            }
            console.log(`[Brickanalyzer] Piece ${idx}: crop ${cropWidth}×${cropHeight}px @ (${x0},${y0})`);

            const cropBuffer = await sharp(imageBuffer)
              .extract({ left: x0, top: y0, width: cropWidth, height: cropHeight })
              .jpeg({ quality: 90 })
              .toBuffer();

            brickanalyzerCropCache.get(scanId)![idx] = cropBuffer;

            // Sample dominant RGB — deferred color resolution happens in enrichment
            // where it's constrained to colors the part actually exists in on BrickLink.
            const detectedRgb = await detectDominantRgb(cropBuffer);
            if (detectedRgb) piece.detectedRgb = detectedRgb;

            return { cropBuffer };
          } catch (err: any) {
            console.warn(`[Brickanalyzer] Piece ${idx} crop failed:`, err.message);
            return { cropBuffer: null, earlyResult: [{ partNo: '', partName: piece.roughName || 'Unknown', colorName: piece.colorName || '', confidence: 'low', note: 'crop error', cropIndex: idx, bboxX: piece.x, bboxY: piece.y, bboxW: piece.w, bboxH: piece.h }] };
          }
        })
      );

      // Phase 2b — Send crops to Brickognize one piece at a time (sequential).
      // Parallel sending (even with a rate limiter) causes Brickognize to queue
      // requests internally, leading to 429s → exponential backoff → 20 s timeouts.
      // Sequential ensures at most 2 active BQ requests at any moment (figs + parts
      // for the current piece), so each piece gets a fast, clean response.
      const earlyResultCount = cropData.filter((c: any) => c.earlyResult).length;
      setProgress(scanId, 'Crops ready', `${pieces.length} crops built${earlyResultCount > 0 ? ` (${earlyResultCount} skipped — too small)` : ''} — sending to AI…`, 19);

      const phase2bStart = Date.now();
      console.log(`[Brickanalyzer] Step 2b: Sending ${pieces.length} crops to Brickognize (sequential)...`);

      // Single Brickognize POST — no retries on 429.
      // Retrying a 429 just burns the timeout (8s) before failing anyway; the sibling
      // endpoint (figs or parts) usually succeeds, so the piece is still identified.
      async function bqPost(url: string, form: FormData, pieceIdx: number): Promise<any> {
        try {
          return await axios.post(url, form, { headers: form.getHeaders(), timeout: 8000 });
        } catch (e: any) {
          if (e.response?.status === 429) {
            console.warn(`[Brickognize] 429 rate-limit piece ${pieceIdx} — skipping endpoint`);
            return null;
          }
          throw e;
        }
      }

      // Rate gate: enforce a minimum gap between actual BQ calls so rapid cache-hit
      // sequences don't burst Brickognize into a 429 on the next real piece.
      const BQ_MIN_GAP_MS = 400;
      let lastBqCallAt = 0;
      async function bqRateGate() {
        const wait = BQ_MIN_GAP_MS - (Date.now() - lastBqCallAt);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        lastBqCallAt = Date.now();
      }

      // Deduplication: if two crops have identical bytes (same piece photographed twice
      // at identical position/lighting), skip the second BQ call and reuse the result.
      // Uses a per-scan map so no state leaks between scans.
      const bqDedupeCache = new Map<string, any[]>();

      // CLIP embedding is intentionally NOT run per-piece here.
      // CLIP inference on CPU takes ~5s per image in the single-threaded Python service.
      // Batching 4 pieces simultaneously causes Flask to queue them: 5+5+5+5 = 20s per batch.
      // Brickognize alone takes ~1s per piece and drives all identification + pricing,
      // so CLIP is deferred to a non-blocking post-scan pass instead.

      // Process pieces sequentially — each piece sends figs + parts in parallel (2 simultaneous
      // requests). Processing one piece at a time avoids Brickognize 429 rate-limits that
      // occur when BQ_BATCH=4 floods the API with 8 concurrent uploads per batch.
      const BQ_BATCH = 1;
      const identified: any[] = [];
      for (let b = 0; b < pieces.length; b += BQ_BATCH) {
        const batchPieces = pieces.slice(b, b + BQ_BATCH);
        const batchResults = await Promise.all(batchPieces.map(async (piece, bi): Promise<any[]> => {
          const idx = b + bi;
          const entry = cropData[idx];
          if (entry.earlyResult) return entry.earlyResult;
          const cropBuffer = entry.cropBuffer!;

          const cropHash = createHash('sha256').update(cropBuffer).digest('hex');
          if (bqDedupeCache.has(cropHash)) {
            const cached = bqDedupeCache.get(cropHash)!;
            console.log(`[Brickognize] Piece ${idx}: dedup hit (${cropHash.slice(0, 8)}), reusing result`);
            return cached.map((r: any) => ({ ...r, cropIndex: idx, bboxX: piece.x, bboxY: piece.y, bboxW: piece.w, bboxH: piece.h }));
          }

          const pieceStart = Date.now();
          try {
            const makeBqForm = (buf: Buffer) => {
              const f = new FormData();
              f.append('query_image', buf, { filename: `piece_${idx}.jpg`, contentType: 'image/jpeg' });
              return f;
            };
            const figsForm  = makeBqForm(cropBuffer);
            const partsForm = makeBqForm(cropBuffer);

            await bqRateGate();
            const [figsRes, partsRes] = await Promise.all([
              bqPost('https://api.brickognize.com/predict/figs/',  figsForm, idx)
                .catch((e: any) => { console.warn(`[Brickognize] figs piece ${idx} failed: ${e.message} (HTTP ${e.response?.status ?? 'N/A'})`); return null; }),
              bqPost('https://api.brickognize.com/predict/parts/', partsForm, idx)
                .catch((e: any) => { console.warn(`[Brickognize] parts piece ${idx} failed: ${e.message} (HTTP ${e.response?.status ?? 'N/A'})`); return null; }),
            ]);

            const clipMatches: any[] = []; // CLIP runs post-scan, not per-piece

            const bqCallCount = (figsRes ? 1 : 0) + (partsRes ? 1 : 0);
            if (bqCallCount > 0) {
              const { trackUsage } = await import('./services/ai-usage-tracker');
              for (let bqi = 0; bqi < bqCallCount; bqi++) {
                trackUsage({
                  service: 'brickognize',
                  model: 'brickognize-v1',
                  operation: 'brickspotter-scan',
                  inputTokens: 0,
                  outputTokens: 0,
                  totalTokens: 0,
                  orgId,
                });
              }
            }

            const figTop  = figsRes?.data?.items?.[0]  ?? null;
            const partTop = partsRes?.data?.items?.[0] ?? null;
            const figScore  = figTop?.score  ?? -1;
            const partScore = partTop?.score ?? -1;
            const topItem   = figScore >= partScore ? figTop : partTop;
            const itemType: 'MINIFIG' | 'PART' = figScore >= partScore ? 'MINIFIG' : 'PART';

            const minConfidence = settings.minConfidence ?? 0;
            if (minConfidence > 0 && topItem && topItem.score < minConfidence) {
              console.log(`[Brickanalyzer] Piece ${idx} (${itemType}): ${topItem.id} score=${topItem.score.toFixed(2)} below threshold ${minConfidence.toFixed(2)} — discarded`);
              const result = [{ partNo: '', partName: 'Unknown', colorName: '', itemType: 'PART' as const, confidence: 'low' as const, note: `Score ${topItem.score.toFixed(2)} below threshold`, clipMatches }];
              bqDedupeCache.set(cropHash, result);
              return result;
            }

            if (topItem) {
              const pieceMs = Date.now() - pieceStart;
              console.log(`[Brickanalyzer] Piece ${idx} (${itemType}): ${topItem.id} "${topItem.name}" score=${topItem.score.toFixed(2)} [fig=${figScore.toFixed(2)} part=${partScore.toFixed(2)}] — ${pieceMs}ms`);
              const confidence = topItem.score >= 0.7 ? 'high' : topItem.score >= 0.4 ? 'medium' : 'low';
              const result = [{
                partNo: topItem.id || '',
                partName: topItem.name || piece.roughName || 'Unknown',
                colorName: itemType === 'MINIFIG' ? '' : (piece.colorName || ''),
                itemType,
                confidence,
                bqScore: Math.round(topItem.score * 100) / 100,
                note: piece.note || '',
                detectedRgb: piece.detectedRgb ?? null,
                cropIndex: idx,
                bboxX: piece.x, bboxY: piece.y, bboxW: piece.w, bboxH: piece.h,
                clipMatches,
              }];
              bqDedupeCache.set(cropHash, result);
              return result;
            }
            const pieceMs = Date.now() - pieceStart;
            console.log(`[Brickanalyzer] Piece ${idx} (${piece.roughName || 'unknown'}): both endpoints empty — ${pieceMs}ms`);
            const emptyResult = [{ partNo: '', partName: piece.roughName || 'Unknown', colorName: piece.colorName || '', itemType: 'PART' as const, confidence: 'low', note: 'Brickognize: no match', cropIndex: idx, bboxX: piece.x, bboxY: piece.y, bboxW: piece.w, bboxH: piece.h, clipMatches }];
            bqDedupeCache.set(cropHash, emptyResult);
            return emptyResult;

          } catch (err: any) {
            const pieceMs = Date.now() - pieceStart;
            console.warn(`[Brickanalyzer] Piece ${idx} failed (${pieceMs}ms):`, err.message);
            return [{ partNo: '', partName: piece.roughName || 'Unknown', colorName: piece.colorName || '', confidence: 'low', note: 'identification error', cropIndex: idx, bboxX: piece.x, bboxY: piece.y, bboxW: piece.w, bboxH: piece.h }];
          }
        }));
        identified.push(...batchResults.flat());
        // Update progress after each batch — show the last identified name and elapsed time
        const doneCount = Math.min(b + BQ_BATCH, pieces.length);
        const lastNames = batchResults.flat().map((r: any) => r.partName).filter((n: string) => n && n !== 'Unknown');
        const lastName  = lastNames[lastNames.length - 1] ?? '';
        const elapsedS  = ((Date.now() - phase2bStart) / 1000).toFixed(1);
        const pct = 20 + Math.round((doneCount / pieces.length) * 58);
        setProgress(scanId,
          `Identifying piece ${doneCount} of ${pieces.length}`,
          `${lastName || 'Waiting for result…'} · ${elapsedS}s elapsed`,
          pct,
        );
      }
      const bqElapsed = ((Date.now() - phase2bStart) / 1000).toFixed(1);
      console.log(`[Brickanalyzer] Step 2b complete: ${pieces.length} pieces in ${bqElapsed}s`);

      // ── Zone suppression: if a MINIFIG and one or more PARTs share the same
      // detection zone (significant bbox overlap), keep only the MINIFIG ──
      const iou = (ax: number, ay: number, aw: number, ah: number,
                   bx: number, by: number, bw: number, bh: number): number => {
        const ix0 = Math.max(ax, bx), iy0 = Math.max(ay, by);
        const ix1 = Math.min(ax + aw, bx + bw), iy1 = Math.min(ay + ah, by + bh);
        const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
        if (inter === 0) return 0;
        return inter / (aw * ah + bw * bh - inter);
      };
      const minifigItems = identified.filter((p: any) => p.itemType === 'MINIFIG' && p.partNo);
      const suppressedCropIndexes = new Set<number>();
      for (const fig of minifigItems) {
        const fx = fig.bboxX ?? 0, fy = fig.bboxY ?? 0, fw = fig.bboxW ?? 0, fh = fig.bboxH ?? 0;
        for (const part of identified) {
          if (part.itemType === 'MINIFIG' || part.cropIndex === fig.cropIndex) continue;
          const px = part.bboxX ?? 0, py = part.bboxY ?? 0, pw = part.bboxW ?? 0, ph = part.bboxH ?? 0;

          // Standard IoU overlap — catches torso/head sub-boxes inside the minifig zone
          const overlap = iou(fx, fy, fw, fh, px, py, pw, ph);
          if (overlap > 0.3) {
            console.log(`[Brickanalyzer] Zone suppress (IoU): crop ${part.cropIndex} (${part.partNo}) overlaps MINIFIG ${fig.partNo} (IoU=${overlap.toFixed(2)})`);
            suppressedCropIndexes.add(part.cropIndex);
            continue;
          }

          // Feet-zone suppress — catches feet, legs, and display stands that sit below the minifig.
          // These score near-zero IoU with the body box, so we use a positional test:
          //   • Part top is in the lower 50% of the minifig box or below it (within 150% of fig height)
          //     — wide range covers stands placed on the table beneath the fig
          //   • Part shares >30% of its own width with the minifig box horizontally
          const figBottom = fy + fh;
          const inFeetZoneVertically = py >= fy + fh * 0.50 && py <= figBottom + fh * 1.50;
          if (inFeetZoneVertically) {
            const horizOverlap = Math.max(0, Math.min(px + pw, fx + fw) - Math.max(px, fx));
            if (pw > 0 && horizOverlap / pw > 0.30) {
              console.log(`[Brickanalyzer] Zone suppress (feet): crop ${part.cropIndex} (${part.partNo}) below MINIFIG ${fig.partNo}`);
              suppressedCropIndexes.add(part.cropIndex);
            }
          }
        }
      }
      const filteredIdentified = suppressedCropIndexes.size > 0
        ? identified.filter((p: any) => !suppressedCropIndexes.has(p.cropIndex))
        : identified;
      setProgress(scanId, 'AI identification done', `${filteredIdentified.length} of ${identified.length} piece${identified.length !== 1 ? 's' : ''} identified in ${bqElapsed}s — resolving part IDs…`, 79);

      // ── Step 2b: Resolve LEGO part numbers → BrickLink part numbers via Rebrickable ──
      // Also capture Rebrickable part images as a fallback for when we have no thumbnail.
      const rbImageMap = new Map<string, string>(); // BL partNo (upper) → image URL from Rebrickable
      {
        const REBRICKABLE_API_KEY = process.env.REBRICKABLE_API_KEY;
        // Get all unique part numbers from identified pieces (PART type only)
        const uniquePartNos = [...new Set(filteredIdentified.filter(p => p.partNo && p.itemType !== 'MINIFIG').map(p => p.partNo as string))];
        if (uniquePartNos.length > 0) {
          const upperList = uniquePartNos.map(p => p.toUpperCase());

          // ── Check 1: part_id_mappings cache (LEGO → BL, populated by prior scans) ──
          const cachedMappings = await db.select({ legoId: partIdMappings.legoId, blId: partIdMappings.blId })
            .from(partIdMappings)
            .where(sql`upper(${partIdMappings.legoId}) IN (${sql.join(upperList.map(p => sql`${p}`), sql`, `)})`);
          const cachedMap = new Map(cachedMappings.filter(r => r.legoId && r.blId).map(r => [r.legoId!.toUpperCase(), r.blId!]));
          if (cachedMap.size > 0) console.log(`[Brickanalyzer] Cache hit for ${cachedMap.size} part(s): ${[...cachedMap.entries()].map(([l,b]) => `${l}→${b}`).join(', ')}`);

          // ── Check 2: which are already known BL part numbers in blInventory ──
          const knownRows = await db.select({ itemNo: blInventory.itemNo })
            .from(blInventory)
            .where(and(eq(blInventory.orgId, orgId), sql`upper(${blInventory.itemNo}) IN (${sql.join(upperList.map(p => sql`${p}`), sql`, `)})`));
          const knownSet = new Set(knownRows.map(r => r.itemNo?.toUpperCase()));

          // Needs Rebrickable: not in cache and not a known BL number
          const needsRebrickable = uniquePartNos.filter(p => !cachedMap.has(p.toUpperCase()) && !knownSet.has(p.toUpperCase()));

          // ── Check 3: Rebrickable API for remaining unknowns ──
          // Skip during calibration — we only need detection accuracy, not part-number resolution.
          if (!calibration && needsRebrickable.length > 0 && REBRICKABLE_API_KEY) {
            console.log(`[Brickanalyzer] Resolving ${needsRebrickable.length} unknown LEGO part(s) via Rebrickable: ${needsRebrickable.join(', ')}`);

            await Promise.all(needsRebrickable.map(async (legoPartNo) => {
              try {
                const rbRes = await axios.get(
                  `https://rebrickable.com/api/v3/lego/parts/${encodeURIComponent(legoPartNo)}/`,
                  { params: { key: REBRICKABLE_API_KEY }, timeout: 8000 }
                );
                const partImgUrl: string | null = rbRes.data?.part_img_url ?? null;
                const rbPartNum: string | null = rbRes.data?.part_num ?? null;
                const blIds: string[] = rbRes.data?.external_ids?.BrickLink?.ext_ids ?? [];

                let resolvedBlId: string | null = null;
                if (blIds.length > 0) {
                  console.log(`[Brickanalyzer] Rebrickable mapped ${legoPartNo} → BL: ${blIds.join(', ')}`);
                  for (const blId of blIds) {
                    const blCheck = await db.select({ itemNo: blInventory.itemNo }).from(blInventory)
                      .where(and(eq(blInventory.orgId, orgId), sql`upper(${blInventory.itemNo}) = upper(${blId})`)).limit(1);
                    if (blCheck.length > 0) { resolvedBlId = blCheck[0].itemNo!; break; }
                  }
                  if (!resolvedBlId) resolvedBlId = blIds[0];
                }

                // Save to part_id_mappings for future scans
                try {
                  await db.insert(partIdMappings).values({
                    legoId: legoPartNo,
                    blId: resolvedBlId ?? undefined,
                    rebrickableId: rbPartNum ?? undefined,
                  }).onConflictDoNothing();
                } catch { /* ignore dupe */ }

                if (resolvedBlId) {
                  cachedMap.set(legoPartNo.toUpperCase(), resolvedBlId);
                  if (partImgUrl) rbImageMap.set(resolvedBlId.toUpperCase(), partImgUrl);
                } else if (partImgUrl) {
                  rbImageMap.set(legoPartNo.toUpperCase(), partImgUrl);
                }
              } catch (err: any) {
                if (err?.response?.status !== 404) {
                  console.warn(`[Brickanalyzer] Rebrickable lookup failed for ${legoPartNo}:`, err.message);
                }
              }
            }));
          }

          // Apply all resolutions (from cache or fresh Rebrickable call) to identified pieces
          for (const piece of filteredIdentified) {
            if (piece.partNo && piece.itemType !== 'MINIFIG') {
              const resolved = cachedMap.get(piece.partNo.toUpperCase());
              if (resolved && resolved.toUpperCase() !== piece.partNo.toUpperCase()) {
                console.log(`[Brickanalyzer] Part number corrected: ${piece.partNo} → ${resolved}`);
                piece.partNo = resolved;
              }
            }
          }
        }
      }

      // ── Step 2c: CLIP fallback for unrecognized crops ──────────────────────
      // Pieces where Brickognize returned no part number (partNo === '') get run
      // through CLIP visual search. If a match is found above the similarity
      // threshold, we populate the piece with the CLIP result and tag it as
      // detectionSource: 'elfie'. Only runs if the Python service is available
      // and there are CLIP embeddings in the database to search against.
      const clipFallbackSet = new Set<number>();
      if (!calibration) {
        const unrecognized = filteredIdentified.filter((p: any) => !p.partNo && p.cropIndex != null);
        if (unrecognized.length > 0) {
          try {
            const { isPythonServiceReady, embedCrop: _embedCropFn } = await import('./services/segmentClient.js');
            const { findNearestParts: _findNearest, getCatalogEmbeddingStats } = await import('./services/clip-search.js');
            const stats = await getCatalogEmbeddingStats();
            const totalEmbeddings = stats.total ?? 0;
            if (isPythonServiceReady() && totalEmbeddings > 0) {
              setProgress(scanId, 'E.L.F.I.E. visual search', `Running CLIP on ${unrecognized.length} unrecognized piece${unrecognized.length !== 1 ? 's' : ''}…`, 79);
              console.log(`[Brickanalyzer] CLIP fallback: ${unrecognized.length} unrecognized crops, ${totalEmbeddings} embeddings available`);
              const cropCache = brickanalyzerCropCache.get(scanId);
              const CLIP_MIN_SIMILARITY = 0.60;
              let clipHits = 0;
              let clipFails = 0;
              const CLIP_CONCURRENCY = 2;
              for (let ci = 0; ci < unrecognized.length; ci += CLIP_CONCURRENCY) {
                const batch = unrecognized.slice(ci, ci + CLIP_CONCURRENCY);
                await Promise.all(batch.map(async (piece: any) => {
                  try {
                    const cropBuf = cropCache?.[piece.cropIndex];
                    if (!cropBuf) return;
                    const embedding = await _embedCropFn(cropBuf);
                    const matches = await _findNearest(embedding, 3, CLIP_MIN_SIMILARITY);
                    const { trackUsage: trackClipUsage } = await import('./services/ai-usage-tracker');
                    trackClipUsage({
                      service: 'clip',
                      model: 'clip-vit-base-patch32',
                      operation: 'brickspotter-scan',
                      inputTokens: 0,
                      outputTokens: 0,
                      totalTokens: 0,
                      orgId,
                    });
                    if (matches.length > 0) {
                      const best = matches[0];
                      piece.partNo = best.itemNo;
                      piece.itemType = best.itemType || 'PART';
                      piece.confidence = best.similarity >= 0.80 ? 'high' : best.similarity >= 0.70 ? 'medium' : 'low';
                      piece.note = `CLIP match ${(best.similarity * 100).toFixed(0)}%`;
                      piece.detectionSource = 'elfie';
                      clipFallbackSet.add(piece.cropIndex);
                      clipHits++;
                      console.log(`[Brickanalyzer] CLIP hit crop ${piece.cropIndex}: ${best.itemNo} (${(best.similarity * 100).toFixed(1)}% sim)`);
                    }
                  } catch (clipErr: any) {
                    clipFails++;
                    console.warn(`[Brickanalyzer] CLIP fallback failed for crop ${piece.cropIndex}:`, clipErr.message);
                  }
                }));
                setProgress(scanId, 'E.L.F.I.E. visual search', `CLIP ${Math.min(ci + CLIP_CONCURRENCY, unrecognized.length)}/${unrecognized.length} · ${clipHits} matched`, 79);
              }
              console.log(`[Brickanalyzer] CLIP fallback: ${clipHits} matched, ${clipFails} failed, ${unrecognized.length - clipHits - clipFails} no match out of ${unrecognized.length} crops`);
            }
          } catch (clipSetupErr: any) {
            console.warn(`[Brickanalyzer] CLIP fallback setup failed:`, clipSetupErr.message);
          }
        }
      }

      const pomSettings = await getOrgSettings(orgId);

      // Progress: enrichment phase
      console.log(`[Brickanalyzer] Enrichment phase: ${filteredIdentified.length} pieces, calibration=${calibration}`);
      setProgress(scanId, 'Looking up prices', `Fetching market data for ${filteredIdentified.length} piece${filteredIdentified.length !== 1 ? 's' : ''}…`, 80);
      let enrichDone = 0;
      let blFetchCount = 0;

      // For each identified part: inventory lookup + POM price + image
      const enriched = await Promise.all(filteredIdentified.map(async (piece: any) => {
        try {
        let ourPriceNew: number | null = null;
        let ourQtyNew = 0;
        let ourPriceUsed: number | null = null;
        let ourQtyUsed = 0;
        let inventoryId: number | null = null;
        let thumbnailUrl: string | null = null;
        let marketSoldMaxNew: number | null = null;
        let marketSoldMaxUsed: number | null = null;
        let marketSoldAvgNew: number | null = null;
        let marketSoldAvgUsed: number | null = null;
        let colorId: number | null = null;
        let colorRgb: string | null = null;
        let activeInvRows: any[] = [];
        const blItemType = piece.itemType || 'PART'; // hoisted — used in color variants + image fallback sections
        // Hoisted outside if(piece.partNo) so inventoryLots section below can read them
        let catalogColorMap = new Map<number, { name: string | null; rgb: string | null }>();
        let catalogColorsList: { color_id: number; color_name: string }[] = [];
        // Stock (current listing) average/max price — used by heatmap filters
        let stockAvgPriceN: number | null = null;
        let stockAvgPriceU: number | null = null;
        let stockMaxPriceN: number | null = null;
        let stockMaxPriceU: number | null = null;
        let suggestedPriceNew: number | null = null;
        let suggestedPriceUsed: number | null = null;

        let localPomItemData: { name: string | null; imageUrl: string | null; thumbnailUrl: string | null; categoryId: number | null } = {
          name: piece.partName || null,
          imageUrl: null,
          thumbnailUrl: null,
          categoryId: null,
        };

        if (piece.partNo) {
          // 1. Look up our inventory listings — all conditions for this partNo
          const invRows = await db.select({
            id: blInventory.id,
            unitPrice: blInventory.unitPrice,
            quantity: blInventory.quantity,
            colorName: blColors.name,
            colorId: blInventory.colorId,
            itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
            thumbnailUrl: blCatalog.thumbnailUrl,
            imageUrl: blCatalog.imageUrl,
            newOrUsed: blInventory.newOrUsed,
            categoryId: blCatalog.categoryId,
          })
          .from(blInventory)
          .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
          .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
          .where(and(
            eq(blInventory.orgId, orgId),
            eq(blInventory.itemNo, piece.partNo),
            sql`${blInventory.quantity} > 0`
          ))
          .limit(20);

          // Helper: check if two part names share enough words to be the same part
          const namesSimilar = (a: string, b: string): boolean => {
            if (!a || !b) return true;
            const wordsA = a.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2);
            const wordsB = b.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(w => w.length > 2);
            if (wordsA.length === 0 || wordsB.length === 0) return true;
            const shared = wordsA.filter(w => wordsB.includes(w)).length;
            return shared / Math.min(wordsA.length, wordsB.length) >= 0.4;
          };

          activeInvRows = invRows;

          // If we got inventory rows but the names don't match the AI's name,
          // the AI gave a wrong part number — try a name-based search instead
          if (invRows.length > 0 && piece.partName) {
            const repName = invRows[0]?.itemName || '';
            if (!namesSimilar(repName, piece.partName)) {
              console.log(`[Brickanalyzer] Name mismatch: AI="${piece.partName}" inv="${repName}" for partNo=${piece.partNo} — searching by name`);
              const nameRows = await db.select({
                id: blInventory.id,
                itemNo: blInventory.itemNo,
                unitPrice: blInventory.unitPrice,
                quantity: blInventory.quantity,
                colorName: blColors.name,
                colorId: blInventory.colorId,
                itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
                thumbnailUrl: blCatalog.thumbnailUrl,
                imageUrl: blCatalog.imageUrl,
                newOrUsed: blInventory.newOrUsed,
              })
              .from(blInventory)
              .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
              .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
              .where(and(
                eq(blInventory.orgId, orgId),
                sql`lower(${blCatalog.itemName}) like lower(${'%' + piece.partName.replace(/[%_]/g, '') + '%'})`,
                sql`${blInventory.quantity} > 0`
              ))
              .limit(20);

              if (nameRows.length > 0) {
                const resolvedPartNo = nameRows[0].itemNo;
                console.log(`[Brickanalyzer] Corrected partNo: ${piece.partNo} → ${resolvedPartNo} (from name match)`);
                piece.partNo = resolvedPartNo;
                activeInvRows = nameRows;
              } else {
                activeInvRows = [];
              }
            }
          }

          // 2a. Early catalog-constrained color detection (PARTs only, when colorId still unknown)
          // Must run BEFORE inventory color-matching so colorId is available for the strict match.
          // catalogColorMap/catalogColorsList are declared above (outside this block) so they are
          // readable by the inventoryLots section that runs after if(piece.partNo) closes.
          //
          // Strategy:
          //   • 1 catalog color → use it unconditionally (printed/patterned parts are color 0)
          //   • Multiple catalog colors + detectedRgb → Delta-E pick
          //   • Multiple catalog colors + no detectedRgb → leave colorId null (can't determine)
          if (piece.partNo && blItemType === 'PART' && !colorId) {
            try {
              const { data: blColorsEarly } = await bricklinkCatalogRequest(`/items/PART/${piece.partNo}/colors`);
              blApiCallsCounter.count += 1;
              catalogColorsList = Array.isArray(blColorsEarly) ? blColorsEarly : [];
              if (catalogColorsList.length > 0) {
                const earlyIds = catalogColorsList.map((c: { color_id: number }) => c.color_id);
                const earlyRows = await db.select({ id: blColors.id, name: blColors.name, rgb: blColors.rgb })
                  .from(blColors).where(inArray(blColors.id, earlyIds));
                catalogColorMap = new Map(earlyRows.map(r => [r.id, { name: r.name ?? null, rgb: r.rgb ?? null }]));

                if (catalogColorsList.length === 1) {
                  // Only one possible color — use it unconditionally (handles colorId=0 printed parts)
                  const solo = catalogColorsList[0];
                  colorId = solo.color_id;
                  const soloRow = catalogColorMap.get(colorId);
                  piece.colorName = soloRow?.name ?? solo.color_name ?? '';
                  colorRgb = soloRow?.rgb ?? null;
                  console.log(`[ColorDetect/early] ${piece.partNo}: single catalog color → "${piece.colorName}" id=${colorId}`);
                } else if (piece.detectedRgb) {
                  // Multiple catalog colors — use Delta-E to find closest match
                  const { r: dr, g: dg, b: db } = piece.detectedRgb;
                  let closestId: number | null = null, closestName: string | null = null, closestDist = Infinity;
                  for (const [cid, col] of catalogColorMap.entries()) {
                    if (!col.rgb || col.rgb.length !== 6) continue;
                    const cr = parseInt(col.rgb.slice(0, 2), 16);
                    const cg = parseInt(col.rgb.slice(2, 4), 16);
                    const cb = parseInt(col.rgb.slice(4, 6), 16);
                    const dist = deltaE(dr, dg, db, cr, cg, cb);
                    if (dist < closestDist) { closestDist = dist; closestId = cid; closestName = col.name; }
                  }
                  if (closestId) {
                    colorId = closestId;
                    piece.colorName = closestName || '';
                    colorRgb = catalogColorMap.get(closestId)?.rgb ?? null;
                    console.log(`[ColorDetect/early] ${piece.partNo}: RGB=(${dr},${dg},${db}) → "${closestName}" id=${colorId} ΔE=${closestDist.toFixed(1)} (${catalogColorsList.length} catalog colors)`);
                  }
                }
              }
            } catch (earlyErr: any) {
              console.warn(`[ColorDetect/early] catalog fetch failed for ${piece.partNo}:`, earlyErr.message);
            }
          }

          // 2b. Match inventory rows against detected colorId.
          // When colorId is known: strict match on color, then fall back to any row for name/thumb.
          // When colorId is unknown (BL API rate-limited, no catalog data, etc.): accept any color
          // in inventory so the piece still registers as "in stock."
          if (activeInvRows.length > 0) {
            const matchColor = (r: any) => !colorId || r.colorId === colorId;

            const colorMatchNew  = activeInvRows.filter((r: any) => r.newOrUsed === 'N').find(matchColor);
            const colorMatchUsed = activeInvRows.filter((r: any) => r.newOrUsed === 'U').find(matchColor);
            const anyNew  = activeInvRows.find((r: any) => r.newOrUsed === 'N');
            const anyUsed = activeInvRows.find((r: any) => r.newOrUsed === 'U');
            const newMatch  = colorMatchNew ?? anyNew;
            const usedMatch = colorMatchUsed ?? anyUsed;
            const nameSrc   = newMatch || usedMatch;

            if (nameSrc) {
              if (!piece.partName && nameSrc.itemName) piece.partName = nameSrc.itemName;
              if (!thumbnailUrl) thumbnailUrl = nameSrc.thumbnailUrl || nameSrc.imageUrl || null;
            }
            if (newMatch) {
              ourPriceNew = newMatch.unitPrice ? Number(newMatch.unitPrice) : null;
              ourQtyNew   = newMatch.quantity || 0;
              inventoryId = newMatch.id;
              if (!colorId && newMatch.colorId) {
                // Adopt the inventory color when we couldn't detect it via RGB
                colorId = newMatch.colorId;
                piece.colorName = newMatch.colorName || '';
              }
            }
            if (usedMatch) {
              ourPriceUsed = usedMatch.unitPrice ? Number(usedMatch.unitPrice) : null;
              ourQtyUsed   = usedMatch.quantity || 0;
              if (!inventoryId) inventoryId = usedMatch.id;
              if (!colorId && usedMatch.colorId) {
                colorId = usedMatch.colorId;
                piece.colorName = usedMatch.colorName || '';
              }
            }

            // Fetch colorRgb if colorId came from inventory and rgb is not yet resolved
            if (colorId && colorRgb === null) {
              const rgbRows = await db.select({ rgb: blColors.rgb })
                .from(blColors).where(eq(blColors.id, colorId)).limit(1);
              if (rgbRows.length > 0) colorRgb = rgbRows[0].rgb ?? null;
            }
          }

          // Build localItemData from what we already know — avoids the item-details BL API call
          // inside fetchPriceOMagicData (saves 1 call per piece on cache misses).
          // Brickognize already gave us the name; blInventory already has thumbnail/image URLs.
          localPomItemData = {
            name: piece.partName || activeInvRows[0]?.itemName || null,
            imageUrl: activeInvRows[0]?.imageUrl || null,
            thumbnailUrl: activeInvRows[0]?.thumbnailUrl || null,
            categoryId: activeInvRows[0]?.categoryId ?? null,
          };

          // 3. BrickLink price guide — always fresh API call for each identified piece.
          // forceRefresh=true bypasses the POM 6-month cache; we always hit BL's sold + stock endpoints.
          // Results are written to priceGuideCache + partPriceHistory inside fetchPriceOMagicData.
          if (!calibration) {
            blFetchCount++;
            try {
              console.log(`[Brickanalyzer] Live BL fetch (new) for ${piece.partNo} color ${colorId ?? 'any'} type ${blItemType}`);
              const pgDataN = await fetchPriceOMagicData(
                piece.partNo, blItemType as any, blItemType === 'PART' ? (colorId ?? undefined) : undefined,
                'N', undefined, undefined, false, localPomItemData, blApiCallsCounter, orgId, true
              );
              if (pgDataN) {
                marketSoldMaxNew = pgDataN.soldMaxPrice && Number(pgDataN.soldMaxPrice) > 0 ? Number(pgDataN.soldMaxPrice) : null;
                marketSoldAvgNew = pgDataN.soldAvgPrice != null && Number(pgDataN.soldAvgPrice) > 0 ? Number(pgDataN.soldAvgPrice) : null;
                if (pgDataN.stockAvgPrice != null && Number(pgDataN.stockAvgPrice) > 0 && stockAvgPriceN === null) stockAvgPriceN = Number(pgDataN.stockAvgPrice);
                if (pgDataN.stockMaxPrice != null && Number(pgDataN.stockMaxPrice) > 0 && stockMaxPriceN === null) stockMaxPriceN = Number(pgDataN.stockMaxPrice);
                if (!thumbnailUrl) thumbnailUrl = pgDataN.thumbnailUrl || pgDataN.imageUrl || null;
                if (!piece.partName && pgDataN.itemName) piece.partName = pgDataN.itemName;
              }
            } catch (pgErrN: any) {
              console.error(`[Brickanalyzer] Live BL fetch (new) FAILED for ${piece.partNo}:`, pgErrN.message);
            }
            try {
              console.log(`[Brickanalyzer] Live BL fetch (used) for ${piece.partNo} color ${colorId ?? 'any'} type ${blItemType}`);
              const pgDataU = await fetchPriceOMagicData(
                piece.partNo, blItemType as any, blItemType === 'PART' ? (colorId ?? undefined) : undefined,
                'U', undefined, undefined, false, localPomItemData, blApiCallsCounter, orgId, true
              );
              if (pgDataU) {
                marketSoldMaxUsed = pgDataU.soldMaxPrice && Number(pgDataU.soldMaxPrice) > 0 ? Number(pgDataU.soldMaxPrice) : null;
                marketSoldAvgUsed = pgDataU.soldAvgPrice != null && Number(pgDataU.soldAvgPrice) > 0 ? Number(pgDataU.soldAvgPrice) : null;
                if (pgDataU.stockAvgPrice != null && Number(pgDataU.stockAvgPrice) > 0) stockAvgPriceU = Number(pgDataU.stockAvgPrice);
                if (pgDataU.stockMaxPrice != null && Number(pgDataU.stockMaxPrice) > 0) stockMaxPriceU = Number(pgDataU.stockMaxPrice);
                if (!thumbnailUrl) thumbnailUrl = pgDataU.thumbnailUrl || pgDataU.imageUrl || null;
                if (!piece.partName && pgDataU.itemName) piece.partName = pgDataU.itemName;
              }
            } catch (pgErrU: any) {
              console.error(`[Brickanalyzer] Live BL fetch (used) FAILED for ${piece.partNo}:`, pgErrU.message);
            }
          }

          // Catalog-color fallback: if the detected colorId yielded no market data AND the BL catalog
          // says this printed part only comes in exactly ONE color, re-run POM with the correct color.
          // This fixes printed shields / tiles where Delta-E picks the wrong base color.
          // Skip entirely during calibration — no price data needed.
          if (
            !calibration &&
            piece.partNo &&
            blItemType === 'PART' &&
            marketSoldMaxNew === null && marketSoldMaxUsed === null && stockAvgPriceN === null &&
            catalogColorsList.length === 1 &&
            catalogColorsList[0].color_id !== colorId
          ) {
            const correctColorId = catalogColorsList[0].color_id;
            const correctColorName = catalogColorMap.get(correctColorId)?.name ?? catalogColorsList[0].color_name ?? '';
            console.log(`[Brickanalyzer] Catalog-color fallback for ${piece.partNo}: retrying POM with colorId=${correctColorId} "${correctColorName}" (was ${colorId ?? 'null'})`);
            try {
              const fbN = await fetchPriceOMagicData(piece.partNo, blItemType as any, correctColorId, 'N', undefined, undefined, false, localPomItemData, blApiCallsCounter, orgId, true);
              if (fbN) {
                marketSoldMaxNew = fbN.soldMaxPrice && Number(fbN.soldMaxPrice) > 0 ? Number(fbN.soldMaxPrice) : null;
                marketSoldAvgNew = fbN.soldAvgPrice != null && Number(fbN.soldAvgPrice) > 0 ? Number(fbN.soldAvgPrice) : null;
                if (fbN.stockAvgPrice != null && Number(fbN.stockAvgPrice) > 0 && stockAvgPriceN === null) stockAvgPriceN = Number(fbN.stockAvgPrice);
                if (fbN.stockMaxPrice != null && Number(fbN.stockMaxPrice) > 0 && stockMaxPriceN === null) stockMaxPriceN = Number(fbN.stockMaxPrice);
                if (!thumbnailUrl) thumbnailUrl = fbN.thumbnailUrl || fbN.imageUrl || null;
                if (!piece.partName && fbN.itemName) piece.partName = fbN.itemName;
              }
              const fbU = await fetchPriceOMagicData(piece.partNo, blItemType as any, correctColorId, 'U', undefined, undefined, false, localPomItemData, blApiCallsCounter, orgId, true);
              if (fbU) {
                marketSoldMaxUsed = fbU.soldMaxPrice && Number(fbU.soldMaxPrice) > 0 ? Number(fbU.soldMaxPrice) : null;
                marketSoldAvgUsed = fbU.soldAvgPrice != null && Number(fbU.soldAvgPrice) > 0 ? Number(fbU.soldAvgPrice) : null;
                if (fbU.stockAvgPrice != null && Number(fbU.stockAvgPrice) > 0 && stockAvgPriceU === null) stockAvgPriceU = Number(fbU.stockAvgPrice);
                if (fbU.stockMaxPrice != null && Number(fbU.stockMaxPrice) > 0 && stockMaxPriceU === null) stockMaxPriceU = Number(fbU.stockMaxPrice);
              }
              // Only adopt the correct color if it returned actual pricing data
              if (marketSoldMaxNew !== null || marketSoldMaxUsed !== null || stockAvgPriceN !== null) {
                colorId = correctColorId;
                piece.colorName = correctColorName;
                colorRgb = catalogColorMap.get(correctColorId)?.rgb ?? colorRgb;
              }
            } catch (fbErr: any) {
              console.warn(`[Brickanalyzer] Catalog-color fallback POM failed for ${piece.partNo}:`, fbErr.message);
            }
          }
        }

        // Compute suggested price using same formula as POM
        if (stockAvgPriceN !== null || marketSoldAvgNew !== null) {
          const pgN = stockAvgPriceN; const sN = marketSoldAvgNew;
          // stockTotalLots from pgDataN cache row — extract from the last fetch result
          suggestedPriceNew = calculateSuggestedPriceWithSupply(pgN, sN, 0, 10, blItemType);
        }
        if (stockAvgPriceU !== null || marketSoldAvgUsed !== null) {
          suggestedPriceUsed = calculateSuggestedPriceWithSupply(stockAvgPriceU, marketSoldAvgUsed, 0, 10, blItemType);
        }

        const bestPrice = ourPriceNew ?? ourPriceUsed ?? marketSoldMaxNew ?? marketSoldMaxUsed ?? stockAvgPriceN;

        // Build color variants from BrickLink catalog — shows every known color for this part
        // Minifigs don't have color variants, so skip the catalog call for them
        // catalogColorMap / catalogColorsList may already be populated by the early color
        // detection block (2a) above — if so, reuse them to avoid a second BL API call.
        let inventoryLots: { colorId: number | null; colorName: string | null; colorRgb: string | null; imageUrl: string | null; qtyNew: number; priceNew: number | null; qtyUsed: number; priceUsed: number | null; peakNew: number | null; peakUsed: number | null }[] = [];
        if (piece.partNo && blItemType === 'PART') {
          try {
            // Only fetch catalog colors if not already populated by early detection block
            if (catalogColorsList.length === 0) {
              const { data: blColors_data } = await bricklinkCatalogRequest(`/items/PART/${piece.partNo}/colors`);
              blApiCallsCounter.count += 1;
              console.log(`[Brickanalyzer] BL colors for ${piece.partNo}: ${JSON.stringify(blColors_data)?.slice(0, 200)}`);
              catalogColorsList = Array.isArray(blColors_data) ? blColors_data : [];
              if (catalogColorsList.length > 0) {
                const ids = catalogColorsList.map(c => c.color_id);
                const rows = await db.select({ id: blColors.id, name: blColors.name, rgb: blColors.rgb })
                  .from(blColors).where(inArray(blColors.id, ids));
                catalogColorMap = new Map(rows.map(r => [r.id, { name: r.name ?? null, rgb: r.rgb ?? null }]));
              }
            }
            const catalogColors = catalogColorsList;
            const colorMap = catalogColorMap;
            if (catalogColors.length > 0) {
              // Build an inventory lookup map from activeInvRows for O(1) access
              const invByColorId = new Map<number, { qtyNew: number; priceNew: number | null; qtyUsed: number; priceUsed: number | null }>();
              for (const row of activeInvRows) {
                const cid = row.colorId;
                if (cid == null) continue;
                if (!invByColorId.has(cid)) invByColorId.set(cid, { qtyNew: 0, priceNew: null, qtyUsed: 0, priceUsed: null });
                const inv = invByColorId.get(cid)!;
                if (row.newOrUsed === 'N') { inv.qtyNew += row.quantity || 0; if (inv.priceNew === null && row.unitPrice) inv.priceNew = Number(row.unitPrice); }
                else if (row.newOrUsed === 'U') { inv.qtyUsed += row.quantity || 0; if (inv.priceUsed === null && row.unitPrice) inv.priceUsed = Number(row.unitPrice); }
              }
              const catalogColorIds = catalogColors.map(c => c.color_id);

              // ── Catalog-constrained color detection (only if not already resolved by early block) ──
              // Use detected RGB to pick the closest color from the real BrickLink catalog
              // for this part — the definitive list of all colors it was ever made in.
              if (piece.detectedRgb && !colorId) {
                const { r: dr, g: dg, b: db } = piece.detectedRgb;
                let closestId: number | null = null;
                let closestName: string | null = null;
                let closestDist = Infinity;
                for (const [cid, col] of colorMap.entries()) {
                  if (!col.rgb || col.rgb.length !== 6) continue;
                  const cr = parseInt(col.rgb.slice(0, 2), 16);
                  const cg = parseInt(col.rgb.slice(2, 4), 16);
                  const cb = parseInt(col.rgb.slice(4, 6), 16);
                  const dist = deltaE(dr, dg, db, cr, cg, cb);
                  if (dist < closestDist) { closestDist = dist; closestId = cid; closestName = col.name; }
                }
                if (closestId) {
                  colorId = closestId;
                  piece.colorName = closestName || '';
                  colorRgb = colorMap.get(closestId)?.rgb ?? null;
                  console.log(`[ColorDetect] catalog match ${piece.partNo}: RGB=(${dr},${dg},${db}) → "${closestName}" (ΔE=${closestDist.toFixed(1)}, from ${catalogColors.length} BL color(s))`);
                }
              }

              // Fetch peak prices from local priceGuideCache for each color (both conditions)
              const peakRows = await db.select({
                colorId: priceGuideCache.colorId,
                newOrUsed: priceGuideCache.newOrUsed,
                soldMaxPrice: priceGuideCache.soldMaxPrice,
              }).from(priceGuideCache).where(and(
                eq(priceGuideCache.itemNo, piece.partNo.toUpperCase()),
                eq(priceGuideCache.itemType, 'PART'),
                inArray(priceGuideCache.colorId, catalogColorIds)
              ));
              const peakByColor = new Map<number, { peakNew: number | null; peakUsed: number | null }>();
              for (const r of peakRows) {
                if (r.colorId == null) continue;
                if (!peakByColor.has(r.colorId)) peakByColor.set(r.colorId, { peakNew: null, peakUsed: null });
                const p = peakByColor.get(r.colorId)!;
                if (r.newOrUsed === 'N') p.peakNew = r.soldMaxPrice ? Number(r.soldMaxPrice) : null;
                else if (r.newOrUsed === 'U') p.peakUsed = r.soldMaxPrice ? Number(r.soldMaxPrice) : null;
              }
              inventoryLots = catalogColors.map(c => {
                const inv = invByColorId.get(c.color_id) ?? { qtyNew: 0, priceNew: null, qtyUsed: 0, priceUsed: null };
                const col = colorMap.get(c.color_id);
                const pk = peakByColor.get(c.color_id) ?? { peakNew: null, peakUsed: null };
                const imageUrl = `https://img.bricklink.com/PN/${c.color_id}/${piece.partNo}.png`;
                return { colorId: c.color_id, colorName: col?.name ?? null, colorRgb: col?.rgb ?? null, imageUrl, ...inv, ...pk };
              });

              // For ≤5 catalog color parts: fetch live POM for any lot with no cached peak data.
              // This is the core of the simplified architecture — all variants get real market prices,
              // not just the detected color. Printed parts (1 color) are the primary beneficiary.
              if (catalogColors.length <= 5 && piece.partNo) {
                for (const lot of inventoryLots) {
                  if (lot.colorId == null) continue;
                  if (lot.peakNew !== null || lot.peakUsed !== null) continue; // already cached
                  try {
                    const liveN = await fetchPriceOMagicData(piece.partNo, blItemType as any, lot.colorId, 'N', undefined, undefined, false, localPomItemData, blApiCallsCounter);
                    if (liveN) {
                      lot.peakNew = liveN.soldMaxPrice ? Number(liveN.soldMaxPrice) : null;
                      if (lot.peakNew === null && liveN.stockAvgPrice != null && Number(liveN.stockAvgPrice) > 0) lot.peakNew = Number(liveN.stockAvgPrice);
                      if (!thumbnailUrl) thumbnailUrl = liveN.thumbnailUrl || liveN.imageUrl || null;
                      if (!piece.partName && liveN.itemName) piece.partName = liveN.itemName;
                    }
                    const liveU = await fetchPriceOMagicData(piece.partNo, blItemType as any, lot.colorId, 'U', undefined, undefined, false, localPomItemData, blApiCallsCounter);
                    if (liveU) lot.peakUsed = liveU.soldMaxPrice ? Number(liveU.soldMaxPrice) : null;
                    console.log(`[Brickanalyzer] Lot POM ${piece.partNo}/${lot.colorId} "${lot.colorName}": peakN=${lot.peakNew} peakU=${lot.peakUsed}`);
                  } catch (lotErr: any) {
                    console.warn(`[Brickanalyzer] Lot POM failed ${piece.partNo}/${lot.colorId}:`, lotErr.message);
                  }
                }

                // Promote best-match lot peak to piece level if piece-level prices are still null.
                // This handles printed parts where the catalog color was always correct but the
                // early detection block detected the wrong color (e.g. shield Light Gray → Red).
                if (marketSoldMaxNew === null && marketSoldMaxUsed === null) {
                  const bestLot = inventoryLots.find(l => l.colorId === colorId) ?? inventoryLots[0];
                  if (bestLot) {
                    if (bestLot.peakNew !== null) { marketSoldMaxNew = bestLot.peakNew; colorId = bestLot.colorId; piece.colorName = bestLot.colorName || piece.colorName; }
                    if (bestLot.peakUsed !== null) { marketSoldMaxUsed = bestLot.peakUsed; }
                    if (marketSoldMaxNew !== null || marketSoldMaxUsed !== null) {
                      colorRgb = catalogColorMap.get(bestLot.colorId ?? -1)?.rgb ?? colorRgb;
                      console.log(`[Brickanalyzer] Promoted lot peak to piece level: ${piece.partNo}/${bestLot.colorId} "${bestLot.colorName}" N=${marketSoldMaxNew} U=${marketSoldMaxUsed}`);
                    }
                  }
                }
              }
            }
          } catch (blErr: any) {
            console.warn(`[Brickanalyzer] BL color variants failed for ${piece.partNo}:`, blErr.message);
          }
        }

        // ── Image fallback: if no thumbnail from inventory/POM, try Rebrickable image cache ──
        // BrickLink catalog URLs are constructed directly in the frontend
        // (BL API returns protocol-relative URLs that fail URL validation in the proxy)
        if (!thumbnailUrl && piece.partNo) {
          const rbImg = rbImageMap.get(piece.partNo.toUpperCase());
          if (rbImg) {
            console.log(`[Brickanalyzer] Using Rebrickable image for ${piece.partNo}`);
            thumbnailUrl = rbImg;
          }
        }

        const enrichIdx = ++enrichDone;
        setProgress(scanId,
          'Looking up prices',
          `Piece ${enrichIdx} of ${filteredIdentified.length}${piece.partNo ? ` · ${piece.partNo}` : ''}${piece.partName && piece.partName !== 'Unknown Part' ? ` — ${piece.partName}` : ''}`,
          80 + Math.round(enrichIdx / filteredIdentified.length * 17),
        );

        // Enrich bl_catalog with BL CDN image URL for every identified piece — no extra API calls.
        // This means ALL items in a scan frame are enriched, not just ones the user taps.
        // COALESCE keeps any higher-quality image already written by the catalog-detail scheduler.
        if (piece.partNo && blItemType) {
          try {
            const typeCode = blItemType === 'MINIFIG' ? 'MN' : blItemType === 'SET' ? 'SN' : 'PN';
            const effectiveColorId = blItemType === 'PART' ? (colorId ?? 0) : 0;
            const cdnImageUrl = `https://img.bricklink.com/ItemImage/${typeCode}/${effectiveColorId}/${piece.partNo}.png`;
            await db.insert(blCatalog).values({
              itemNo: piece.partNo,
              itemType: blItemType,
              colorId: effectiveColorId,
              itemName: piece.partName || null,
              imageUrl: cdnImageUrl,
              thumbnailUrl: cdnImageUrl,
            }).onConflictDoUpdate({
              target: [blCatalog.itemNo, blCatalog.itemType, blCatalog.colorId],
              set: {
                itemName: sql`COALESCE(bl_catalog.item_name, EXCLUDED.item_name)`,
                imageUrl: sql`COALESCE(bl_catalog.image_url, EXCLUDED.image_url)`,
                thumbnailUrl: sql`COALESCE(bl_catalog.thumbnail_url, EXCLUDED.thumbnail_url)`,
              },
            });
          } catch (blCatalogImgErr: any) {
            console.warn(`[Brickanalyzer] bl_catalog CDN write failed for ${blItemType}/${piece.partNo}:`, blCatalogImgErr.message);
          }
        }

        const detectionSource = clipFallbackSet.has(piece.cropIndex) ? 'elfie' : 'brickognize';
        return {
          partNo: piece.partNo || '',
          partName: piece.partName || 'Unknown Part',
          itemType: piece.itemType || 'PART',
          colorName: piece.colorName || '',
          colorId,
          confidence: piece.confidence || 'low',
          note: piece.note || '',
          ourPriceNew,
          ourQtyNew,
          ourPriceUsed,
          ourQtyUsed,
          inventoryId,
          marketSoldMaxNew,
          marketSoldMaxUsed,
          marketSoldAvgNew,
          marketSoldAvgUsed,
          stockAvgPriceN,
          stockAvgPriceU,
          stockMaxPriceN,
          stockMaxPriceU,
          suggestedPriceNew,
          suggestedPriceUsed,
          colorRgb,
          thumbnailUrl,
          bestPrice,
          categoryId: activeInvRows[0]?.categoryId ?? null,
          inventoryLots,
          cropIndex: piece.cropIndex ?? null,
          bboxX: (piece as any).bboxX ?? null,
          bboxY: (piece as any).bboxY ?? null,
          bboxW: (piece as any).bboxW ?? null,
          bboxH: (piece as any).bboxH ?? null,
          detectionSource,
        };
        } catch (enrichErr: any) {
          console.error(`[Brickanalyzer] Enrichment failed for piece ${piece.partNo || '(unknown)'}:`, enrichErr.message);
          return {
            partNo: piece.partNo || '',
            partName: piece.partName || 'Unknown Part',
            itemType: piece.itemType || 'PART',
            colorName: piece.colorName || '',
            colorId: null,
            confidence: piece.confidence || 'low',
            note: piece.note || '',
            ourPriceNew: null, ourQtyNew: 0, ourPriceUsed: null, ourQtyUsed: 0,
            inventoryId: null,
            marketSoldMaxNew: null, marketSoldMaxUsed: null,
            marketSoldAvgNew: null, marketSoldAvgUsed: null,
            stockAvgPriceN: null, stockAvgPriceU: null,
            stockMaxPriceN: null, stockMaxPriceU: null,
            suggestedPriceNew: null, suggestedPriceUsed: null,
            colorRgb: null, thumbnailUrl: null, bestPrice: null,
            categoryId: null, inventoryLots: [],
            cropIndex: piece.cropIndex ?? null,
            bboxX: (piece as any).bboxX ?? null,
            bboxY: (piece as any).bboxY ?? null,
            bboxW: (piece as any).bboxW ?? null,
            bboxH: (piece as any).bboxH ?? null,
            detectionSource: clipFallbackSet.has(piece.cropIndex) ? 'elfie' : 'brickognize',
          };
        }
      }));

      const pricedCount = enriched.filter((p: any) =>
        p.marketSoldMaxNew !== null || p.marketSoldMaxUsed !== null ||
        p.marketSoldAvgNew !== null || p.marketSoldAvgUsed !== null ||
        p.stockAvgPriceN !== null || p.stockAvgPriceU !== null ||
        p.stockMaxPriceN !== null || p.stockMaxPriceU !== null
      ).length;
      console.log(`[Brickanalyzer] Enrichment complete: ${enriched.length} pieces, ${blFetchCount}/${filteredIdentified.length} attempted BL fetch, ${pricedCount} with market data, ${blApiCallsCounter.count} total BL API calls`);

      // Sort by peak price desc
      enriched.sort((a, b) => {
        const ap = Math.max((a as any).marketSoldMaxNew ?? 0, (a as any).marketSoldMaxUsed ?? 0, (a as any).stockAvgPriceN ?? 0);
        const bp = Math.max((b as any).marketSoldMaxNew ?? 0, (b as any).marketSoldMaxUsed ?? 0, (b as any).stockAvgPriceN ?? 0);
        return bp - ap;
      });

      // Deduplicate: GPT-4o gives one box per fig, but the wider fig crop padding means
      // adjacent fig boxes can overlap and both return the same fig ID. Keep only the first (highest-priced).
      // For parts, duplicate part numbers with different colors are legitimate — only dedup if same color too.
      const seen = new Map<string, boolean>();
      const deduped = enriched.filter(p => {
        // Fig-component sub-crops only appear if Brickognize returned a part number
        if (!p.partNo && p.note === 'fig-component') return false;
        if (!p.partNo) return true; // always show other unidentified pieces
        const key = p.itemType === 'MINIFIG' ? p.partNo : `${p.partNo}|${p.colorId ?? ''}`;
        if (seen.has(key)) return false;
        seen.set(key, true);
        return true;
      });

      if (deduped.length < enriched.length) {
        console.log(`[Brickanalyzer] Deduplicated ${enriched.length} → ${deduped.length} results`);
      }

      const totalValue = deduped.reduce((sum, p) => sum + (p.ourPriceNew ?? p.ourPriceUsed ?? p.marketSoldMaxNew ?? 0), 0);
      const identifiedWithPrice = deduped.filter(p => p.ourPriceNew !== null || p.ourPriceUsed !== null || p.marketSoldMaxNew !== null).length;

      setProgress(scanId, 'Saving results', `${deduped.length} piece${deduped.length !== 1 ? 's' : ''} · est. $${totalValue.toFixed(2)}`, 98);

      const cropCount = brickanalyzerCropCache.get(scanId)?.filter(Boolean).length ?? 0;
      const savedMeta = brickanalyzerImageMeta.get(scanId);
      await db.update(brickanalyzerScans).set({
        status: 'complete',
        totalPieces: deduped.length,
        identifiedPieces: identifiedWithPrice,
        estimatedValue: totalValue.toFixed(2),
        results: deduped as any,
        imgWidth: savedMeta?.width ?? null,
        imgHeight: savedMeta?.height ?? null,
        completedAt: new Date(),
        blApiCalls: blApiCallsCounter.count,
      }).where(eq(brickanalyzerScans.id, scanId));

      setProgress(scanId, 'Complete', `${deduped.length} piece${deduped.length !== 1 ? 's' : ''} identified · $${totalValue.toFixed(2)} est. value`, 100);
      setTimeout(() => brickanalyzerProgressMap.delete(scanId), 8000);
      console.log(`🔍 Brickanalyzer scan ${scanId} complete: ${deduped.length} pieces, $${totalValue.toFixed(2)} estimated value`);

      if (deduped.length === 0 && pieces.length > 0) {
        await db.insert(syncIssues).values({
          syncType: 'brickanalyzer_scan',
          platform: 'brickognize',
          itemId: String(scanId),
          issueType: 'brickognize_no_results',
          issueDescription: `Brick Spotter detected ${pieces.length} region(s) but Brickognize could not identify any parts. Pieces may be too small, blurry, or not recognized. Try photographing fewer pieces at a time.`,
          severity: 'medium',
          status: 'open',
          metadata: JSON.stringify({ scanId, regionsDetected: pieces.length }),
          orgId,
        });
      }
    } catch (err: any) {
      brickanalyzerProgressMap.delete(scanId);
      console.error(`🔍 Brickanalyzer scan ${scanId} failed:`, err.message);
      await db.update(brickanalyzerScans).set({
        status: 'failed',
        errorMessage: err.message,
        completedAt: new Date(),
      }).where(eq(brickanalyzerScans.id, scanId));
      await db.insert(syncIssues).values({
        syncType: 'brickanalyzer_scan',
        platform: 'brickognize',
        itemId: String(scanId),
        issueType: 'scan_failed',
        issueDescription: `Brick Spotter scan ${scanId} crashed: ${err.message}`,
        severity: 'high',
        status: 'open',
        metadata: JSON.stringify({ scanId, error: err.message }),
        orgId,
      }).catch(() => {});
    } finally {
      decrementActiveScan();
    }
  }

  // POST /api/brickanalyzer/segment — preview only: run segmentation, return bounding boxes (no Brickognize)
  const brickanalyzerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
  app.post("/api/brickanalyzer/segment", brickanalyzerUpload.single('image'), isApproved, async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      const { default: sharp } = await import('sharp');
      // Normalize EXIF orientation so segmentation boxes align with the display image
      let fileBuffer = req.file.buffer;
      try { fileBuffer = await sharp(fileBuffer).rotate().toBuffer(); } catch { /* leave as-is */ }
      const imgMeta = await sharp(fileBuffer).metadata();
      const imgWidth = imgMeta.width || 1000;
      const imgHeight = imgMeta.height || 1000;
      let settings: Record<string, any> = {};
      if (req.body?.settings) { try { settings = JSON.parse(req.body.settings); } catch {} }

      // Apply same calibration overrides as the full scan.
      // No multiPass override — calibration uses the same 4-pass logic as scan.
      if (req.body?.calibration === 'true') {
        settings = {
          ...settings,
          maxSizePct: 99,
          maxDimFrac: 99,
          minSizePct: 0.5,
        };
      }

      const { segmentImageWithCandidates } = await import('./services/segmentClient.js');
      const iouBox2 = (a: any, b: any): number => {
        const ix0 = Math.max(a.x, b.x), iy0 = Math.max(a.y, b.y);
        const ix1 = Math.min(a.x + a.w, b.x + b.w), iy1 = Math.min(a.y + a.h, b.y + b.h);
        const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
        if (inter === 0) return 0;
        return inter / (a.w * a.h + b.w * b.h - inter);
      };

      type SegBox = { x: number; y: number; w: number; h: number };
      let allBoxes: SegBox[] = [];
      let allCandidates: SegBox[] = [];

      // ── Exact same segmentation logic as processBrickanalyzerScan ──────────
      // This ensures the preview shows precisely the boxes that will be used.
      if (settings.multiPass) {
        // 4-pass — mirrors the full scan exactly (same passes, same IoU threshold)
        const pass1 = { segmenter: 'contour', minSizePct: 0.40, maxSizePct: 55, maxDimFrac: 90, blurRadius: 5, cannyLow: 40, cannyHigh: 130, dilateIter: 4 };
        const pass2 = { ...settings };
        const pass3 = { segmenter: 'contour', minSizePct: 0.02, maxSizePct: 5, blurRadius: 3, cannyLow: 25, cannyHigh: 90, dilateIter: 1 };
        const pass4 = { segmenter: 'contour', minSizePct: 0.02, maxSizePct: 8, blurRadius: 3, cannyLow: 20, cannyHigh: 80, dilateIter: 2, clahe: true };
        const [r1, r2, r3, r4] = await Promise.all([
          segmentImageWithCandidates(fileBuffer, pass1 as any),
          segmentImageWithCandidates(fileBuffer, pass2 as any),
          segmentImageWithCandidates(fileBuffer, pass3 as any),
          segmentImageWithCandidates(fileBuffer, pass4 as any),
        ]);
        // IoU 0.25 — matches full scan (less aggressive dedup = more separate boxes)
        const merged: SegBox[] = [];
        for (const box of [...r1.boxes, ...r2.boxes, ...r3.boxes, ...r4.boxes]) {
          if (!merged.some(m => iouBox2(m, box) > 0.25)) merged.push(box);
        }
        // Containment suppression — same rule as full scan (threshold raised 65%→85%)
        allBoxes = merged.filter((box) => {
          const boxArea = box.w * box.h;
          return !merged.some((other) => {
            if (other === box) return false;
            if (other.w * other.h <= boxArea * 1.5) return false;
            const ix0 = Math.max(box.x, other.x), iy0 = Math.max(box.y, other.y);
            const ix1 = Math.min(box.x + box.w, other.x + other.w), iy1 = Math.min(box.y + box.h, other.y + other.h);
            return Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0) / boxArea > 0.85;
          });
        });
        // Aggregate candidates across all passes: dedup at IoU 0.20, then filter
        // against accepted boxes (IoU 0.10) to avoid overlap with confirmed pieces.
        const rawCands = [...r1.candidates, ...r2.candidates, ...r3.candidates, ...r4.candidates];
        const dedupCands: SegBox[] = [];
        for (const c of rawCands) {
          if (!dedupCands.some(d => iouBox2(d, c) > 0.20)) dedupCands.push(c);
        }
        allCandidates = dedupCands.filter(c => !allBoxes.some(b => iouBox2(c, b) > 0.10));
      } else {
        const result = await segmentImageWithCandidates(fileBuffer, settings as any);
        allBoxes      = result.boxes;
        allCandidates = result.candidates;

        // Safety net: if nothing detected, show full frame as a fallback box.
        if (allBoxes.length === 0) {
          allBoxes = [{ x: 2, y: 2, w: 96, h: 96 }];
        }
      }

      // ── Junk filter: move suspicious boxes to candidates ────────────────────
      // Very tiny boxes (area < 20 in %-space ≈ 4.5%×4.5%) or extremely elongated
      // boxes (aspect ratio < 0.2 or > 5) are almost always surface-texture fragments
      // or image-edge artifacts, not real LEGO pieces.  Moving them to candidates
      // means the user must explicitly tap to include them rather than tap-to-remove.
      const isJunk = (b: SegBox) => {
        const ar = b.w / Math.max(b.h, 0.01);
        return ar < 0.20 || ar > 5.0 || b.w * b.h < 20;
      };
      const junkBoxes = allBoxes.filter(isJunk);
      allBoxes = allBoxes.filter(b => !isJunk(b));
      junkBoxes.forEach(j => {
        if (!allCandidates.some(c => iouBox2(c, j) > 0.10)) allCandidates.push(j);
      });
      if (junkBoxes.length > 0) {
        console.log(`[Brickanalyzer] Preview junk filter: moved ${junkBoxes.length} suspicious box(es) to candidates`);
      }

      const maxPieces = Number(settings.maxPieces ?? 100);
      res.json({
        boxes:       allBoxes.slice(0, maxPieces),
        candidates:  allCandidates,
        imageWidth:  imgWidth,
        imageHeight: imgHeight,
      });
    } catch (err: any) {
      console.error('[Brickanalyzer] Segment preview error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/brickanalyzer/detect-at-point — run segmentation on a crop centered on
  // a user-tapped point and return the best-fit contour box in full-image %-coordinates.
  // Used by the preview tap-to-detect feature when no candidate is near the tap.
  app.post("/api/brickanalyzer/detect-at-point", brickanalyzerUpload.single('image'), isApproved, async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      const tapX = parseFloat(req.body?.tapX ?? '50');
      const tapY = parseFloat(req.body?.tapY ?? '50');
      // Optional: caller can pass an explicit crop region (e.g. an existing grouped box)
      // so we segment exactly within that area instead of a fixed 50%×50% window.
      const hasCropHint = req.body?.cropX != null && req.body?.cropW != null;
      const hintX = hasCropHint ? parseFloat(req.body.cropX) : null;
      const hintY = hasCropHint ? parseFloat(req.body.cropY) : null;
      const hintW = hasCropHint ? parseFloat(req.body.cropW) : null;
      const hintH = hasCropHint ? parseFloat(req.body.cropH) : null;

      const { default: sharp } = await import('sharp');
      let buf = req.file.buffer;
      try { buf = await sharp(buf).rotate().toBuffer(); } catch {}
      const meta = await sharp(buf).metadata();
      const W = meta.width || 1000, H = meta.height || 1000;

      // Use the caller-supplied box if present, otherwise fall back to 50%×50% centred on tap
      let cropLeft: number, cropTop: number, cropW: number, cropH: number;
      if (hasCropHint && hintX != null && hintY != null && hintW != null && hintH != null) {
        cropLeft = Math.max(0, Math.round(hintX / 100 * W));
        cropTop  = Math.max(0, Math.round(hintY / 100 * H));
        cropW    = Math.min(Math.round(hintW / 100 * W), W - cropLeft);
        cropH    = Math.min(Math.round(hintH / 100 * H), H - cropTop);
      } else {
        cropW = Math.round(W * 0.50);
        cropH = Math.round(H * 0.50);
        const cx = Math.round(tapX / 100 * W);
        const cy = Math.round(tapY / 100 * H);
        cropLeft = Math.max(0, Math.min(cx - Math.round(cropW / 2), W - cropW));
        cropTop  = Math.max(0, Math.min(cy - Math.round(cropH / 2), H - cropH));
      }

      const cropBuf = await sharp(buf)
        .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
        .toBuffer();

      const { segmentImage } = await import('./services/segmentClient.js');
      const cropBoxes = await segmentImage(cropBuf, {
        segmenter:  'contour',
        minSizePct: 0.3,   // at least 0.3% of crop area — filters tiny noise
        maxSizePct: 90,    // piece can fill most of the crop
        maxDimFrac: 95,
        blurRadius: 3,
        cannyLow:   25,
        cannyHigh:  80,
        dilateIter: 2,
      } as any);

      if (!cropBoxes.length) return res.json({ box: null });

      // Pick the box whose center is closest to the crop center (50,50 in %-space)
      const best = cropBoxes.reduce((a, b) => {
        const da = Math.hypot((a.x + a.w / 2) - 50, (a.y + a.h / 2) - 50);
        const db = Math.hypot((b.x + b.w / 2) - 50, (b.y + b.h / 2) - 50);
        return da <= db ? a : b;
      });

      // Map from crop %-space back to full-image %-space
      const fullX = (cropLeft + best.x / 100 * cropW) / W * 100;
      const fullY = (cropTop  + best.y / 100 * cropH) / H * 100;
      const fullW = best.w / 100 * cropW / W * 100;
      const fullH = best.h / 100 * cropH / H * 100;

      res.json({ box: { x: fullX, y: fullY, w: fullW, h: fullH } });
    } catch (err: any) {
      console.error('[Brickanalyzer] detect-at-point error:', err.message);
      res.json({ box: null });
    }
  });

  // POST /api/brickanalyzer/scan — upload image, start background job
  app.post("/api/brickanalyzer/scan", brickanalyzerUpload.single('image'), isApproved, async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No image provided" });
      const orgId = reqOrgId(req);

      // Check BrickSpotter limit
      const limitCheck = await checkBrickspotterLimit(orgId);
      if (!limitCheck.allowed) {
        return res.status(429).json({ 
          error: limitCheck.message,
          nudge: (limitCheck as any).nudgeLevel,
          upgradeUrl: "/settings?tab=billing" 
        });
      }

      const [scan] = await db.insert(brickanalyzerScans).values({
        status: 'processing',
        orgId,
      }).returning();

      // Increment scan count
      await incrementBrickspotterScan(orgId);

      // If approaching limit, add nudge header
      if ((limitCheck as any).nudgeLevel !== 'none') {
        res.setHeader('X-Tier-Nudge', (limitCheck as any).nudgeLevel);
        res.setHeader('X-Tier-Message', limitCheck.message || '');
      }

      // Parse scan settings passed as a JSON string form field
      let settings: Record<string, number> = {};
      if (req.body?.settings) {
        try { settings = JSON.parse(req.body.settings); } catch {}
      }
      const calibration = req.body?.calibration === 'true';

      // Parse user-approved preview boxes — if present, skip re-segmentation
      let previewBoxes: { x: number; y: number; w: number; h: number }[] | undefined;
      if (req.body?.previewBoxes) {
        try { previewBoxes = JSON.parse(req.body.previewBoxes); } catch {}
      }

      // Seed the progress map before the client even makes its first poll
      brickanalyzerProgressMap.set(scan.id, { step: 'Queued', detail: 'Waiting to start…', pct: 2, startedAt: Date.now(), stepAt: Date.now() });

      // Fire and forget — client gets scanId immediately
      processBrickanalyzerScan(scan.id, req.file.buffer, settings, calibration, previewBoxes, orgId).catch(() => {});

      res.json({ scanId: scan.id });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/brickanalyzer/scans — paginated batch list (metadata only, no imageData/results)
  app.get("/api/brickanalyzer/scans", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const scans = await db.select({
        id: brickanalyzerScans.id,
        status: brickanalyzerScans.status,
        totalPieces: brickanalyzerScans.totalPieces,
        identifiedPieces: brickanalyzerScans.identifiedPieces,
        estimatedValue: brickanalyzerScans.estimatedValue,
        createdAt: brickanalyzerScans.createdAt,
        completedAt: brickanalyzerScans.completedAt,
      })
        .from(brickanalyzerScans)
        .where(eq(brickanalyzerScans.orgId, orgId))
        .orderBy(desc(brickanalyzerScans.createdAt))
        .limit(50);
      res.json(scans);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/brickanalyzer/scans/latest — for dashboard polling
  // Returns the most recent scan that is not "failed" (complete or processing).
  // A newer failed scan should not overwrite an older successful scan that may
  // have an outstanding action-items notification pointing to it.
  app.get("/api/brickanalyzer/scans/latest", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const [scan] = await db.select().from(brickanalyzerScans)
        .where(and(eq(brickanalyzerScans.orgId, orgId), ne(brickanalyzerScans.status, 'failed')))
        .orderBy(desc(brickanalyzerScans.createdAt))
        .limit(1);
      if (!scan) return res.json(null);
      const crops = brickanalyzerCropCache.get(scan.id);
      const meta  = brickanalyzerImageMeta.get(scan.id);
      res.json({ ...scan, cropCount: crops ? crops.filter(Boolean).length : 0, imgWidth: meta?.width ?? scan.imgWidth ?? null, imgHeight: meta?.height ?? scan.imgHeight ?? null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/brickanalyzer/scan/:id/progress — lightweight polling endpoint for scan progress
  app.get("/api/brickanalyzer/scan/:id/progress", isApproved, async (req: any, res) => {
    try {
      const scanId = Number(req.params.id);
      const prog = brickanalyzerProgressMap.get(scanId);
      if (!prog) {
        return res.json({ step: 'Processing…', detail: '', pct: 0, startedAt: null, stepAt: null, active: false });
      }
      return res.json({ ...prog, now: Date.now(), active: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });

  // GET /api/brickanalyzer/scan/:id — full results (includes cropCount from cache)
  app.get("/api/brickanalyzer/scan/:id", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const [scan] = await db.select().from(brickanalyzerScans)
        .where(and(eq(brickanalyzerScans.orgId, orgId), eq(brickanalyzerScans.id, Number(req.params.id))));
      if (!scan) return res.status(404).json({ error: "Scan not found" });
      const crops = brickanalyzerCropCache.get(scan.id);
      const meta  = brickanalyzerImageMeta.get(scan.id);

      // Hydrate any results missing pricing fields from the price guide cache
      // Backfills stock AND sold prices so the heatmap always shows full catalog info
      let results = scan.results as any[] | null;
      const hasEmpty = (v: any) => v === undefined || v === null || v === 0;
      if (Array.isArray(results)) {
        const needsHydration = results.filter(r =>
          r.partNo && (
            hasEmpty(r.stockAvgPriceN) || hasEmpty(r.stockAvgPriceU) ||
            hasEmpty(r.stockMaxPriceN) || hasEmpty(r.stockMaxPriceU) ||
            hasEmpty(r.marketSoldMaxNew) || hasEmpty(r.marketSoldMaxUsed) ||
            hasEmpty(r.marketSoldAvgNew) || hasEmpty(r.marketSoldAvgUsed)
          )
        );
        if (needsHydration.length > 0) {
          const partNos = [...new Set(needsHydration.map((r: any) => r.partNo as string))];
          const cacheRows = await db.select({
            itemNo: priceGuideCache.itemNo,
            itemType: priceGuideCache.itemType,
            colorId: priceGuideCache.colorId,
            newOrUsed: priceGuideCache.newOrUsed,
            stockAvgPrice: priceGuideCache.stockAvgPrice,
            stockMaxPrice: priceGuideCache.stockMaxPrice,
            soldAvgPrice: priceGuideCache.soldAvgPrice,
            soldMaxPrice: priceGuideCache.soldMaxPrice,
          })
          .from(priceGuideCache)
          .where(inArray(priceGuideCache.itemNo, partNos.map(p => p.toUpperCase())));

          const stockAvgMap = new Map<string, number | null>();
          const stockMaxMap = new Map<string, number | null>();
          const soldAvgMap = new Map<string, number | null>();
          const soldMaxMap = new Map<string, number | null>();
          for (const row of cacheRows) {
            const cid = row.colorId === -1 ? 'null' : String(row.colorId ?? 'null');
            const key = `${row.itemNo?.toUpperCase()}|${cid}|${row.newOrUsed}`;
            stockAvgMap.set(key, row.stockAvgPrice != null && Number(row.stockAvgPrice) > 0 ? Number(row.stockAvgPrice) : null);
            stockMaxMap.set(key, row.stockMaxPrice != null && Number(row.stockMaxPrice) > 0 ? Number(row.stockMaxPrice) : null);
            soldAvgMap.set(key, row.soldAvgPrice != null && Number(row.soldAvgPrice) > 0 ? Number(row.soldAvgPrice) : null);
            soldMaxMap.set(key, row.soldMaxPrice != null && Number(row.soldMaxPrice) > 0 ? Number(row.soldMaxPrice) : null);
          }

          results = results.map((r: any) => {
            if (!r.partNo) return r;
            const colorKey = r.colorId != null ? String(r.colorId) : 'null';
            const keyN = `${r.partNo.toUpperCase()}|${colorKey}|N`;
            const keyU = `${r.partNo.toUpperCase()}|${colorKey}|U`;
            const updated = { ...r };
            const empty = (v: any) => v === undefined || v === null || v === 0;
            if (empty(r.stockAvgPriceN)) updated.stockAvgPriceN = stockAvgMap.get(keyN) ?? r.stockAvgPriceN ?? null;
            if (empty(r.stockAvgPriceU)) updated.stockAvgPriceU = stockAvgMap.get(keyU) ?? r.stockAvgPriceU ?? null;
            if (empty(r.stockMaxPriceN)) updated.stockMaxPriceN = stockMaxMap.get(keyN) ?? r.stockMaxPriceN ?? null;
            if (empty(r.stockMaxPriceU)) updated.stockMaxPriceU = stockMaxMap.get(keyU) ?? r.stockMaxPriceU ?? null;
            if (empty(r.marketSoldMaxNew)) updated.marketSoldMaxNew = soldMaxMap.get(keyN) ?? r.marketSoldMaxNew ?? null;
            if (empty(r.marketSoldMaxUsed)) updated.marketSoldMaxUsed = soldMaxMap.get(keyU) ?? r.marketSoldMaxUsed ?? null;
            if (empty(r.marketSoldAvgNew)) updated.marketSoldAvgNew = soldAvgMap.get(keyN) ?? r.marketSoldAvgNew ?? null;
            if (empty(r.marketSoldAvgUsed)) updated.marketSoldAvgUsed = soldAvgMap.get(keyU) ?? r.marketSoldAvgUsed ?? null;
            return updated;
          });
        }
      }

      // After cache hydration, check for results STILL missing prices.
      // Kick off background live BL API fetches so next load has data.
      if (Array.isArray(results)) {
        const stillMissing = results.filter((r: any) =>
          r.partNo && (
            hasEmpty(r.marketSoldMaxNew) && hasEmpty(r.marketSoldMaxUsed) &&
            hasEmpty(r.marketSoldAvgNew) && hasEmpty(r.marketSoldAvgUsed) &&
            hasEmpty(r.stockAvgPriceN) && hasEmpty(r.stockAvgPriceU) &&
            hasEmpty(r.stockMaxPriceN) && hasEmpty(r.stockMaxPriceU)
          )
        );
        if (stillMissing.length > 0) {
          const orgId = (req as any).orgId || 'platform';
          const counter = { count: 0 };
          (async () => {
            for (const r of stillMissing) {
              try {
                const blType = r.itemType === 'MINIFIG' ? 'MINIFIG' : 'PART';
                const cid = blType === 'PART' ? (r.colorId ?? undefined) : undefined;
                console.log(`[Brickanalyzer Hydrate] Background fetch for ${r.partNo} color=${r.colorId ?? 'any'} type=${blType}`);
                await fetchPriceOMagicData(r.partNo, blType as any, cid, 'N', undefined, undefined, false, undefined, counter, orgId, true);
                await fetchPriceOMagicData(r.partNo, blType as any, cid, 'U', undefined, undefined, false, undefined, counter, orgId, true);
              } catch (e: any) {
                console.warn(`[Brickanalyzer Hydrate] Failed for ${r.partNo}:`, e.message);
              }
            }
            console.log(`[Brickanalyzer Hydrate] Background fetch done: ${stillMissing.length} items, ${counter.count} API calls`);
          })().catch(() => {});
        }
      }

      res.json({ ...scan, results, cropCount: crops ? crops.filter(Boolean).length : 0, imgWidth: meta?.width ?? scan.imgWidth ?? null, imgHeight: meta?.height ?? scan.imgHeight ?? null });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/brickanalyzer/scan/:id/image — serve the cached full scan image
  // Falls back to DB-persisted image if not in memory (e.g. after server restart)
  app.get("/api/brickanalyzer/scan/:id/image", isApproved, async (req, res) => {
    try {
      const scanId = Number(req.params.id);
      let img = brickanalyzerImageCache.get(scanId);
      if (!img) {
        const row = await db.select({ imageData: brickanalyzerScans.imageData })
          .from(brickanalyzerScans)
          .where(eq(brickanalyzerScans.id, scanId))
          .limit(1)
          .then(r => r[0]);
        if (row?.imageData) {
          img = row.imageData as Buffer;
          brickanalyzerImageCache.set(scanId, img);
        }
      }
      if (!img) return res.status(404).json({ error: "Image not available" });
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'private, max-age=3600');
      res.send(img);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/brickanalyzer/scan/:id/crop/:index — serve a single crop image
  app.get("/api/brickanalyzer/scan/:id/crop/:index", isApproved, async (req, res) => {
    try {
      const scanId = Number(req.params.id);
      const idx    = Number(req.params.index);
      const crops  = brickanalyzerCropCache.get(scanId);
      if (!crops || !crops[idx]) return res.status(404).json({ error: "Crop not found" });
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'private, max-age=3600');
      res.send(crops[idx]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/brickanalyzer/scan/:id — dismiss scan
  app.delete("/api/brickanalyzer/scan/:id", isApproved, async (req, res) => {
    try {
      const scanId = Number(req.params.id);
      await db.delete(brickanalyzerScans).where(eq(brickanalyzerScans.id, scanId));
      brickanalyzerCropCache.delete(scanId);
      brickanalyzerImageCache.delete(scanId);
      brickanalyzerImageMeta.delete(scanId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/brickanalyzer/scan/:id/retry — re-run a failed scan using cached image.
  // Returns 410 if the image is no longer in memory (server restarted since failure).
  app.post("/api/brickanalyzer/scan/:id/retry", isApproved, async (req: any, res) => {
    try {
      const scanId = Number(req.params.id);
      const orgId  = reqOrgId(req);

      const [scan] = await db.select().from(brickanalyzerScans)
        .where(eq(brickanalyzerScans.id, scanId));
      if (!scan) return res.status(404).json({ error: 'Scan not found' });
      if (scan.status === 'processing') return res.status(409).json({ error: 'Scan already running' });

      const cachedImage = brickanalyzerImageCache.get(scanId);
      if (!cachedImage) {
        return res.status(410).json({
          error: 'Image no longer cached — server was restarted since this scan failed. Please upload the image again.',
          needsReupload: true,
        });
      }

      // Reset scan to processing, then re-run asynchronously
      await db.update(brickanalyzerScans).set({
        status: 'processing',
        errorMessage: null,
        totalPieces: null,
        identifiedPieces: null,
        results: null,
        completedAt: null,
      }).where(eq(brickanalyzerScans.id, scanId));

      // Clear stale crop cache so segmentation re-runs cleanly
      brickanalyzerCropCache.delete(scanId);

      res.json({ ok: true, scanId, message: 'Retry started' });

      // Re-run asynchronously with the cached image
      processBrickanalyzerScan(scanId, cachedImage, {}, false, undefined, orgId).catch((e) => {
        console.error(`[Brickanalyzer] Retry of scan ${scanId} failed:`, e.message);
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── CLIP / Brick Spotter management endpoints ─────────────────────────────

  // GET /api/brickspotter/python-status — whether the Python seg/CLIP service is ready
  app.get("/api/brickspotter/python-status", isApproved, async (req, res) => {
    const { isPythonServiceReady } = await import('./services/segmentClient.js');
    res.json({ ready: isPythonServiceReady() });
  });

  // GET /api/brickspotter/catalog-status — count of bl_catalog_clip_embeddings by source
  app.get("/api/brickspotter/catalog-status", isApproved, async (req, res) => {
    try {
      const { getCatalogEmbeddingStats } = await import('./services/clip-search.js');
      const stats = await getCatalogEmbeddingStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/brickspotter/confirm-embedding — store a confirmed scan crop as a scan embedding
  app.post("/api/brickspotter/confirm-embedding", isApproved, async (req, res) => {
    try {
      const { scanId, cropIndex, itemNo, colorId, itemType } = req.body as {
        scanId: number; cropIndex: number; itemNo: string; colorId?: number; itemType?: string;
      };
      if (!scanId || cropIndex == null || !itemNo) {
        return res.status(400).json({ error: 'scanId, cropIndex, itemNo required' });
      }
      const crops = brickanalyzerCropCache.get(scanId);
      const cropBuffer = crops?.[cropIndex];
      const { embedCrop: _embedCrop, embedUrl: _embedUrl } = await import('./services/segmentClient.js');
      const { storeScanEmbedding } = await import('./services/clip-search.js');
      let embedding: number[];
      if (cropBuffer) {
        // Preferred path: embed the actual scanned crop
        embedding = await _embedCrop(cropBuffer);
        console.log(`[CLIP] Stored scan embedding for ${itemNo} colorId=${colorId} from crop (scan ${scanId} crop ${cropIndex})`);
      } else if (colorId != null) {
        // Fallback: crop no longer in memory (server restarted after deployment).
        // Use the image store (object storage → CDN) — same bytes as catalog builder and PDF.
        const { getOrFetchImage: _getOrFetchImage } = await import('./services/image-store.js');
        console.log(`[CLIP] Crop cache miss — fetching from image store (${itemType ?? 'PART'}/${itemNo}/${colorId})`);
        const imgBuffer = await _getOrFetchImage(itemType ?? 'PART', itemNo, colorId);
        if (!imgBuffer) return res.status(404).json({ error: 'Image not available — retry after a new scan.' });
        embedding = await _embedCrop(imgBuffer);
        console.log(`[CLIP] Stored image-store embedding for ${itemNo} colorId=${colorId} (crop cache expired)`);
      } else {
        return res.status(404).json({ error: 'Crop not found in cache (scan may have expired). Retry after a new scan.' });
      }
      await storeScanEmbedding(itemNo, colorId ?? null, embedding, 'scan', itemType ?? 'PART');
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/brickspotter/build-catalog — batch embed BL inventory items using CDN URLs
  // Body: { limit?: number } — number of inventory items to process (default: all)
  app.post("/api/brickspotter/build-catalog", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { buildCatalogEmbeddings, getActiveBuild } = await import('./services/clip-search.js');

      // Guard against concurrent builds
      const active = getActiveBuild();
      if (active?.running) {
        return res.status(409).json({ error: 'Build already in progress', buildDone: active.done, buildTotal: active.total });
      }

      const limit = Number(req.body?.limit) || 0;
      const rows = await db.select({
        itemNo: blInventory.itemNo,
        colorId: blInventory.colorId,
      }).from(blInventory).where(eq(blInventory.orgId, orgId));

      const items = (limit > 0 ? rows.slice(0, limit) : rows).map((r) => ({
        itemNo: r.itemNo,
        colorId: Number(r.colorId),
        itemType: 'PART',
      }));

      // Run in background — return immediately with count
      res.json({ ok: true, queued: items.length });

      buildCatalogEmbeddings(items, (p) => {
        if (p.done % 100 === 0 || p.done === p.total) {
          console.log(`[CLIP Catalog] ${p.done}/${p.total} embedded (${p.errors} errors)`);
        }
      }).then((final) => {
        console.log(`[CLIP Catalog] Build complete: ${final.done} embedded, ${final.errors} errors`);
      }).catch((e) => {
        console.error('[CLIP Catalog] Build failed:', e.message);
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Universal CLIP Catalog routes ─────────────────────────────────────────

  // GET /api/brickspotter/universal-catalog/status
  app.get("/api/brickspotter/universal-catalog/status", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { getUniversalCatalogStatus } = await import('./services/universal-clip-catalog.js');
      const base = await getUniversalCatalogStatus();

      // Enrich with scheduler settings + last-run metadata
      const [settings] = await db.select({
        universalCatalogScheduleEnabled: platformSettings.universalCatalogScheduleEnabled,
        universalCatalogRefreshMonths:   platformSettings.universalCatalogRefreshMonths,
        universalCatalogRetryDays:       platformSettings.universalCatalogRetryDays,
      }).from(platformSettings).where(eq(platformSettings.id, PLATFORM_ORG_ID)).limit(1);

      const [meta] = await db.select({
        lastSyncTime:   syncMetadata.lastSyncTime,
        lastSyncStatus: syncMetadata.lastSyncStatus,
        errorMessage:   syncMetadata.errorMessage,
      }).from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, 'universal_catalog_refresh')))
        .limit(1);

      const lastRunMs  = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : null;
      const months     = settings?.universalCatalogRefreshMonths ?? 1;
      const nextRunMs  = lastRunMs ? lastRunMs + months * 30 * 24 * 60 * 60 * 1000 : null;

      res.json({
        ...base,
        scheduleEnabled:  settings?.universalCatalogScheduleEnabled ?? false,
        refreshMonths:    months,
        retryDays:        settings?.universalCatalogRetryDays ?? 30,
        lastScheduledRun: lastRunMs,
        nextScheduledRun: nextRunMs,
        lastScheduleStatus: meta?.lastSyncStatus ?? null,
      });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/brickspotter/universal-catalog/import
  // Downloads Rebrickable parts CSV and populates the queue (idempotent)
  app.post("/api/brickspotter/universal-catalog/import", isApproved, async (_req, res) => {
    try {
      const { importFromRebrickable, isUniversalImporting } = await import('./services/universal-clip-catalog.js');
      if (isUniversalImporting()) return res.status(409).json({ error: 'Import already in progress' });
      res.json({ ok: true, message: 'Import started in background' });
      importFromRebrickable().catch(e => console.error('[Universal Catalog] Import failed:', e.message));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/brickspotter/universal-catalog/start
  // Starts (or resumes) the background embedding worker
  app.post("/api/brickspotter/universal-catalog/start", isApproved, async (_req, res) => {
    try {
      const { startUniversalWorker, getUniversalCatalogState } = await import('./services/universal-clip-catalog.js');
      if (getUniversalCatalogState()?.running) return res.status(409).json({ error: 'Worker already running' });
      res.json({ ok: true });
      startUniversalWorker().catch(e => console.error('[Universal Catalog] Start failed:', e.message));
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/brickspotter/universal-catalog/stop
  app.post("/api/brickspotter/universal-catalog/stop", isApproved, async (_req, res) => {
    try {
      const { stopUniversalWorker } = await import('./services/universal-clip-catalog.js');
      stopUniversalWorker();
      res.json({ ok: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // POST /api/brickspotter/universal-catalog/retry
  // Resets no_image / failed rows back to 'pending' for re-processing.
  // Body: { olderThanDays?: number } — default 30; 0 = retry everything
  app.post("/api/brickspotter/universal-catalog/retry", isApproved, async (req, res) => {
    try {
      const { retryStaleItems } = await import('./services/universal-clip-catalog.js');
      const olderThanDays = Number(req.body?.olderThanDays ?? 30);
      const count = await retryStaleItems(olderThanDays);
      res.json({ ok: true, reset: count });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  // ─────────────────────────────────────────────────────────────────────────

  // Get Inventory Items
  app.get("/api/inventory", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const searchQuery = req.query.search as string;
      
      // Build query conditionally
      const inventoryItems = searchQuery && searchQuery.trim()
        ? await db
            .select({
              id: blInventory.id,
              itemNo: blInventory.itemNo,
              itemType: blInventory.itemType,
              colorId: blInventory.colorId,
              colorName: blColors.name,
              colorRgb: blColors.rgb,
              categoryId: blCatalog.categoryId,
              categoryName: blCategories.name,
              quantity: blInventory.quantity,
              newOrUsed: blInventory.newOrUsed,
              unitPrice: blInventory.unitPrice,
              updatedAt: blInventory.updatedAt,
            })
            .from(blInventory)
            .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
            .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
            .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
            .where(and(eq(blInventory.orgId, orgId), eq(blInventory.itemNo, searchQuery.trim())))
        : await db
            .select({
              id: blInventory.id,
              itemNo: blInventory.itemNo,
              itemType: blInventory.itemType,
              colorId: blInventory.colorId,
              colorName: blColors.name,
              colorRgb: blColors.rgb,
              categoryId: blCatalog.categoryId,
              categoryName: blCategories.name,
              quantity: blInventory.quantity,
              newOrUsed: blInventory.newOrUsed,
              unitPrice: blInventory.unitPrice,
              updatedAt: blInventory.updatedAt,
            })
            .from(blInventory)
            .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
            .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
            .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
            .where(eq(blInventory.orgId, orgId))
            .limit(100);

      res.json(inventoryItems);
    } catch (error) {
      console.error("Error fetching inventory:", error);
      res.status(500).json({ error: "Failed to fetch inventory" });
    }
  });

  // Get Inventory Count — used by billing tab to show usage vs trial limit
  app.get("/api/inventory/count", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const [row] = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(blInventory)
        .where(eq(blInventory.orgId, orgId));
      res.json({ count: Number(row?.count ?? 0) });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch inventory count" });
    }
  });

  // Get Inventory Stats (MUST be before /api/inventory/:id to avoid route conflict)
  app.get("/api/inventory/stats", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const [stats, colorCount, categoryCount, soldAvgResult] = await Promise.all([
        db.select({
          totalLots: sql<number>`COUNT(*)`,
          totalParts: sql<number>`SUM(${blInventory.quantity})`,
          totalValue: sql<number>`SUM(${blInventory.quantity} * CAST(${blInventory.unitPrice} AS DECIMAL))`,
          totalCost: sql<number>`SUM(${blInventory.quantity} * COALESCE(CAST(${blInventory.myCost} AS DECIMAL), 0))`,
          newParts: sql<number>`SUM(CASE WHEN ${blInventory.newOrUsed} = 'N' THEN ${blInventory.quantity} ELSE 0 END)`,
          usedParts: sql<number>`SUM(CASE WHEN ${blInventory.newOrUsed} = 'U' THEN ${blInventory.quantity} ELSE 0 END)`,
        }).from(blInventory).where(eq(blInventory.orgId, orgId)),

        db.select({ count: sql<number>`COUNT(DISTINCT ${blInventory.colorId})` })
          .from(blInventory).where(eq(blInventory.orgId, orgId)),

        db.select({ count: sql<number>`COUNT(DISTINCT ${blCatalog.categoryId})` })
          .from(blInventory)
          .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
          .where(eq(blInventory.orgId, orgId)),

        // BL 6-month avg sold price × inventory quantity, summed across all matching lots.
        // Matches on item_no (case-insensitive), item_type, color_id, and condition (N/U).
        db.execute(sql`
          SELECT COALESCE(SUM(i.quantity * CAST(p.sold_avg_price AS DECIMAL)), 0) AS sold_avg_value
          FROM bl_inventory i
          INNER JOIN price_guide_cache p
            ON UPPER(i.item_no) = p.item_no
           AND i.item_type = p.item_type
           AND COALESCE(i.color_id, 0) = COALESCE(p.color_id, 0)
           AND i.new_or_used = p.new_or_used
          WHERE i.org_id = ${orgId}
            AND p.sold_avg_price IS NOT NULL
            AND CAST(p.sold_avg_price AS DECIMAL) > 0
            AND i.deleted_at IS NULL
        `),
      ]);

      res.json({
        totalLots: Number(stats[0]?.totalLots) || 0,
        totalParts: Number(stats[0]?.totalParts) || 0,
        totalValue: Number(stats[0]?.totalValue) || 0,
        totalCost: Number(stats[0]?.totalCost) || 0,
        totalColors: Number(colorCount[0]?.count) || 0,
        totalCategories: Number(categoryCount[0]?.count) || 0,
        newParts: Number(stats[0]?.newParts) || 0,
        usedParts: Number(stats[0]?.usedParts) || 0,
        soldAvgValue: Number((soldAvgResult as any).rows[0]?.sold_avg_value) || 0,
      });
    } catch (error) {
      console.error("Error fetching inventory stats:", error);
      res.status(500).json({ error: "Failed to fetch inventory stats" });
    }
  });

  // Lightweight counts for inventory tool cards
  app.get("/api/inventory/tool-stats", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);

      const [warehouseResult, binsResult, shelvesResult, scansResult] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)` })
          .from(blInventory)
          .leftJoin(inventoryLocations, eq(blInventory.id, inventoryLocations.inventoryId))
          .where(and(
            eq(blInventory.orgId, orgId),
            sql`${inventoryLocations.id} IS NULL`,
            sql`${blInventory.quantity} > 0`
          ))
          .then(r => r[0]),
        db.select({ count: sql<number>`COUNT(*)` })
          .from(whBins)
          .where(and(eq(whBins.orgId, orgId), sql`${whBins.shelfId} IS NULL`))
          .then(r => r[0]),
        db.select({ count: sql<number>`COUNT(*)` })
          .from(whShelves)
          .where(and(eq(whShelves.orgId, orgId), sql`${whShelves.aisleId} IS NULL`))
          .then(r => r[0]),
        db.select({ count: sql<number>`COUNT(*)` })
          .from(brickanalyzerScans)
          .where(and(eq(brickanalyzerScans.orgId, orgId), eq(brickanalyzerScans.status, 'complete')))
          .then(r => r[0]),
      ]);

      res.json({
        warehouseUnassigned: Number(warehouseResult?.count ?? 0),
        binsNotOnShelves: Number(binsResult?.count ?? 0),
        shelvesNotInAisles: Number(shelvesResult?.count ?? 0),
        pendingScans: Number(scansResult?.count ?? 0),
      });
    } catch (error) {
      console.error("Error fetching tool stats:", error);
      res.status(500).json({ error: "Failed to fetch tool stats" });
    }
  });

  // ── Inventory Variants ───────────────────────────────────────────────────────
  // All active lots for the same item_no (across colors & conditions) for an org
  app.get("/api/inventory/variants/:itemNo", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { itemNo } = req.params;
      const result = await db.execute(sql`
        SELECT bi.id, bi.item_no, bi.item_type, bi.color_id, bc.name AS color_name, bc.rgb AS color_rgb,
               bi.new_or_used, bi.quantity, bi.unit_price,
               bi.is_stock_room, bi.stock_room_id, bi.date_created
        FROM bl_inventory bi
        LEFT JOIN bl_colors bc ON bi.color_id = bc.id
        WHERE bi.org_id = ${orgId}
          AND LOWER(bi.item_no) = LOWER(${itemNo})
          AND bi.deleted_at IS NULL
        ORDER BY bi.quantity DESC, bi.color_id NULLS LAST, bi.new_or_used
      `);
      const rows = (result as any).rows ?? [];
      res.json(rows);
    } catch (err) {
      console.error('Error fetching inventory variants:', err);
      res.status(500).json({ error: 'Failed to fetch variants' });
    }
  });

  // Sets readiness — all SET lots grouped by item, with full readiness fields
  // GET /api/sync/bricklink/recent-changes — items added/updated in the most recent BL inventory sync
  app.get('/api/sync/bricklink/recent-changes', isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const type = (req.query.type as string) === 'updated' ? 'updated' : 'added';
      const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);

      const [meta] = await db.select().from(syncMetadata).where(eq(syncMetadata.id, 'bricklink_inventory')).limit(1);

      const items = await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          colorId: blInventory.colorId,
          quantity: blInventory.quantity,
          unitPrice: blInventory.unitPrice,
          newOrUsed: blInventory.newOrUsed,
          isStockRoom: blInventory.isStockRoom,
          syncedAt: blInventory.syncedAt,
          updatedAt: blInventory.updatedAt,
          itemName: blCatalog.itemName,
          colorName: blCatalog.colorName,
        })
        .from(blInventory)
        .leftJoin(blCatalog, and(
          eq(blInventory.itemNo, blCatalog.itemNo),
          eq(blInventory.itemType, blCatalog.itemType),
          eq(sql`COALESCE(${blInventory.colorId}, 0)`, sql`COALESCE(${blCatalog.colorId}, 0)`),
        ))
        .where(and(eq(blInventory.orgId, orgId), isNull(blInventory.deletedAt)))
        .orderBy(type === 'added' ? desc(blInventory.syncedAt) : desc(blInventory.updatedAt))
        .limit(limit);

      // For "updated" type, fetch the most recent change per field from inventory_history
      let itemsWithChanges: typeof items[number][] | (typeof items[number] & { changes: { field: string; oldValue: string | null; newValue: string | null }[] })[] = items;
      if (type === 'updated' && items.length > 0) {
        const itemIds = items.map(i => i.id);
        const historyRows = await db
          .select({
            inventoryId: inventoryHistory.inventoryId,
            field: inventoryHistory.field,
            oldValue: inventoryHistory.oldValue,
            newValue: inventoryHistory.newValue,
            changedAt: inventoryHistory.changedAt,
          })
          .from(inventoryHistory)
          .where(and(
            eq(inventoryHistory.orgId, orgId),
            inArray(inventoryHistory.inventoryId, itemIds),
            eq(inventoryHistory.source, 'bricklink_sync'),
          ))
          .orderBy(desc(inventoryHistory.changedAt));

        // Group by inventoryId, keep the most recent change per field
        const historyByItem: Record<number, { field: string; oldValue: string | null; newValue: string | null }[]> = {};
        for (const row of historyRows) {
          if (!historyByItem[row.inventoryId]) historyByItem[row.inventoryId] = [];
          if (!historyByItem[row.inventoryId].some(h => h.field === row.field)) {
            historyByItem[row.inventoryId].push({ field: row.field, oldValue: row.oldValue, newValue: row.newValue });
          }
        }

        itemsWithChanges = items.map(item => ({
          ...item,
          changes: historyByItem[item.id] ?? [],
        }));
      }

      res.json({
        items: itemsWithChanges,
        lastSyncTime: meta?.lastSyncTime ?? null,
        totalCount: type === 'added' ? (meta?.recordsAdded ?? 0) : (meta?.recordsUpdated ?? 0),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // GET /api/sync/channel/recent-changes — lots created/updated in the most recent channel sync
  app.get('/api/sync/channel/recent-changes', isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const type = (req.query.type as string) === 'updated' ? 'updated' : 'created';
      const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);

      const [meta] = await db.select().from(syncMetadata).where(eq(syncMetadata.id, 'channel_sync')).limit(1);

      const items = await db
        .select({
          blInvId: channelLotLinks.blInvId,
          channelLotId: channelLotLinks.channelLotId,
          linkedAt: channelLotLinks.syncedAt,
          itemNo: blInventory.itemNo,
          colorId: blInventory.colorId,
          quantity: blInventory.quantity,
          unitPrice: blInventory.unitPrice,
          newOrUsed: blInventory.newOrUsed,
          updatedAt: blInventory.updatedAt,
          itemName: blCatalog.itemName,
          colorName: blCatalog.colorName,
        })
        .from(channelLotLinks)
        .leftJoin(blInventory, eq(channelLotLinks.blInvId, blInventory.id))
        .leftJoin(blCatalog, and(
          eq(blInventory.itemNo, blCatalog.itemNo),
          eq(blInventory.itemType, blCatalog.itemType),
          eq(sql`COALESCE(${blInventory.colorId}, 0)`, sql`COALESCE(${blCatalog.colorId}, 0)`),
        ))
        .where(and(eq(channelLotLinks.orgId, orgId), eq(channelLotLinks.channel, 'brickowl')))
        .orderBy(type === 'created' ? desc(channelLotLinks.syncedAt) : desc(blInventory.updatedAt))
        .limit(limit);

      // For "updated" items, attach recent field-level change history from inventory_history
      let itemsOut: any[] = items;
      if (type === 'updated' && items.length > 0) {
        const blInvIds = items.map((i) => i.blInvId).filter(Boolean) as number[];
        if (blInvIds.length > 0) {
          const histRows = await db
            .select({
              inventoryId: inventoryHistory.inventoryId,
              field: inventoryHistory.field,
              oldValue: inventoryHistory.oldValue,
              newValue: inventoryHistory.newValue,
              changedAt: inventoryHistory.changedAt,
            })
            .from(inventoryHistory)
            .where(and(
              eq(inventoryHistory.orgId, orgId),
              inArray(inventoryHistory.inventoryId, blInvIds),
            ))
            .orderBy(desc(inventoryHistory.changedAt));

          // Keep only the most-recent change per (inventoryId, field)
          const latestByItemField = new Map<string, typeof histRows[0]>();
          for (const row of histRows) {
            const key = `${row.inventoryId}::${row.field}`;
            if (!latestByItemField.has(key)) latestByItemField.set(key, row);
          }

          // Group by inventoryId
          const changesByItem = new Map<number, { field: string; oldValue: string | null; newValue: string | null }[]>();
          for (const row of latestByItemField.values()) {
            if (!changesByItem.has(row.inventoryId)) changesByItem.set(row.inventoryId, []);
            changesByItem.get(row.inventoryId)!.push({
              field: row.field,
              oldValue: row.oldValue,
              newValue: row.newValue,
            });
          }

          itemsOut = items.map((item) => ({
            ...item,
            changes: item.blInvId != null ? (changesByItem.get(item.blInvId) ?? []) : [],
          }));
        }
      }

      res.json({
        items: itemsOut,
        lastSyncTime: meta?.lastSyncTime ?? null,
        totalCount: type === 'created' ? (meta?.recordsAdded ?? 0) : (meta?.recordsUpdated ?? 0),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Live BrickLink vs Local quantity comparison
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

  // Bulk Rebrickable Image Sync (one-time operation to fetch all images)
  // GET /api/sync/orders/recent — orders added or updated in the most recent sync
  app.get('/api/sync/orders/recent', isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const platform = (req.query.platform as string) || 'bricklink';
      const type = (req.query.type as string) || 'added';
      const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);

      const syncId = platform === 'bricklink' ? 'bricklink_orders' : 'brickowl_orders';
      const prefix = platform === 'bricklink' ? 'bl-' : 'bo-';

      const [meta] = await db.select().from(syncMetadata).where(and(eq(syncMetadata.id, syncId), eq(syncMetadata.orgId, orgId))).limit(1);

      const totalCount = type === 'added' ? (meta?.recordsAdded ?? 0) : (meta?.recordsUpdated ?? 0);

      let rows: any[];
      if (type === 'added') {
        rows = await db.select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          orderStatus: orders.orderStatus,
          customerUsername: orders.customerUsername,
          orderTotal: orders.orderTotal,
          orderDate: orders.orderDate,
          syncedAt: orders.syncedAt,
        }).from(orders)
          .where(and(
            eq(orders.orgId, orgId),
            sql`${orders.id} LIKE ${prefix + '%'}`,
            eq(orders.isTest, false),
            sql`${orders.orderStatus} != 'purged'`,
          ))
          .orderBy(desc(orders.syncedAt))
          .limit(limit);
      } else {
        rows = await db.select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          orderStatus: orders.orderStatus,
          previousStatus: orders.previousStatus,
          customerUsername: orders.customerUsername,
          orderTotal: orders.orderTotal,
          orderDate: orders.orderDate,
          updatedAt: orders.updatedAt,
          syncedAt: orders.syncedAt,
        }).from(orders)
          .where(and(
            eq(orders.orgId, orgId),
            sql`${orders.id} LIKE ${prefix + '%'}`,
            eq(orders.isTest, false),
            sql`${orders.orderStatus} != 'purged'`,
            sql`${orders.updatedAt} > ${orders.syncedAt}`,
          ))
          .orderBy(desc(orders.updatedAt))
          .limit(limit);
      }

      res.json({ items: rows, totalCount, lastSyncTime: meta?.lastSyncTime ?? null });
    } catch (error: any) {
      console.error('Error fetching recent synced orders:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch recent orders' });
    }
  });

  // Temporary debug: fetch raw BL order detail to inspect all fields
  app.use(apiErrorHandler);

  const httpServer = createServer(app);

  return httpServer;
}
