import { createHash } from "crypto";
import type { Express } from "express";
import { createServer, type Server } from "http";
import { getRecentLogs, clearLogs } from "./services/server-log-buffer";

const SECRET_FIELDS = [
  'openaiApiKey',
  'bricklinkConsumerKey',
  'bricklinkConsumerSecret',
  'bricklinkTokenValue',
  'bricklinkTokenSecret',
  'brickowlApiKey',
  'stripeSecretKey',
  'easypostApiKey',
  'easypostTestApiKey',
  'shipstationApiKey',
  'shipstationApiSecret',
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
import { getEffectiveLimits } from "@shared/tierConfig";
import { setupAuth, isAuthenticated, isApproved, isOrgOwner, getOrgId, isSuperAdmin } from "./auth";
import { syncBricklinkData, fetchPriceOMagicData, searchBricklinkCatalogItem, syncPriceOMagicCache, requestPomSyncStop, bricklinkCatalogRequest, calculateSuggestedPriceWithSupply } from "./services/bricklink";
import { getPomIsRunning, setPomIsRunning } from "./services/pom-scheduler";
import { syncLock } from "./services/sync-lock";
import { syncShipStationOrders } from "./services/shipstation";
import { syncBrickLinkToBrickOwl } from "./services/brickowl";
import { generateBrickLinkXML, generateInventoryCSV, listXMLBackups, getXMLBackup } from "./services/export";
import { getProcessedPartImage, processImageFromUrl } from "./services/image-proxy";
import { db, pool } from "./db";
import { users, organizations, orders, orderDetails, blInventory, blCatalog, insertBlCatalogSchema, blCategories, blColors, appSettings, insertAppSettingsSchema, conversations, conversationThreads, syncMetadata, inventoryEmbeddings, orderEmbeddings, embeddingJobs, whAisles, whShelves, whBins, inventoryLocations, picklistItems, insertWhAisleSchema, insertWhShelfSchema, insertWhBinSchema, insertInventoryLocationSchema, insertPicklistItemSchema, updateFulfillmentSchema, syncIssues, insertSyncIssueSchema, shipments, eodForms, setPartRelationships, blForumPosts, orderAdjustments, insertOrderAdjustmentSchema, brickanalyzerScans, priceGuideCache, partIdMappings, appFeedback, blCatalogClipEmbeddings, orgIntegrations, blApiCalls, marketNews, businessInsights, supportTickets, PLATFORM_ORG_ID, productVision, productOkrs, productKeyResults, productRoadmapItems, productBacklogItems, productCapabilities, featureVotes, insertProductOkrSchema, insertProductKeyResultSchema, insertProductRoadmapItemSchema, insertProductBacklogItemSchema, insertProductCapabilitySchema, pricingModel, plans, insertPlanSchema, shippingServiceMappings, pushSubscriptions } from "@shared/schema";
import { eq, desc, sql, inArray, like, ilike, or, and, isNotNull, isNull, ne, count, gte, gt, lte, asc } from "drizzle-orm";
import { z } from "zod";
import multer from "multer";
import FormData from "form-data";
import axios from "axios";
import OpenAI from "openai";
import { checkBrickspotterLimit, incrementBrickspotterScan, getOrgWithLimits, checkSeatLimit, checkAutomationLimit } from "./services/tierEnforcement";
import { stripeClient, createCheckoutSession, createCheckoutSessionByPlan, createPortalSession, handleStripeWebhook, changePlan, setAutoRenew, cancelSubscriptionNow } from "./services/stripe";

// Decode HTML entities from BrickLink notes for accurate comparison.
// Regex compiled once at module level; single-pass replace with a lookup table.
const HTML_ENTITIES: Record<string, string> = {
  '&#39;': "'", '&#40;': '(', '&#41;': ')', '&quot;': '"',
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&#x27;': "'", '&#x2F;': '/',
};
const HTML_ENTITY_RE = new RegExp(
  Object.keys(HTML_ENTITIES).map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'g'
);

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
  return text.replace(HTML_ENTITY_RE, m => HTML_ENTITIES[m] ?? m);
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

/** Get the requesting user's orgId — falls back to the default org for safety. */
function reqOrgId(req: any): string {
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
    .values({ id: orgId, orgId, aiEnabled: true, selectedModel: 'gpt-4o-mini' })
    .onConflictDoUpdate({ target: appSettings.id, set: { orgId, updatedAt: new Date() } })
    .returning();
  return created;
}

/**
 * Get the platform-wide OpenAI API key from the dedicated platform settings row.
 * This is the single source of truth for all OpenAI usage across every org.
 */
export async function getPlatformOpenAIKey(): Promise<string | null> {
  const settings = await getOrgSettings(PLATFORM_ORG_ID);
  return settings?.openaiApiKey || null;
}

export async function getPlatformBrickLinkCredentials(): Promise<{
  consumerKey: string;
  consumerSecret: string;
  tokenValue: string;
  tokenSecret: string;
} | null> {
  const settings = await getOrgSettings(PLATFORM_ORG_ID);
  if (!settings?.bricklinkConsumerKey || !settings?.bricklinkConsumerSecret ||
      !settings?.bricklinkTokenValue || !settings?.bricklinkTokenSecret) {
    return null;
  }
  return {
    consumerKey: settings.bricklinkConsumerKey,
    consumerSecret: settings.bricklinkConsumerSecret,
    tokenValue: settings.bricklinkTokenValue,
    tokenSecret: settings.bricklinkTokenSecret,
  };
}

export async function registerRoutes(app: Express): Promise<Server> {
  // Auth middleware setup - Email/Password Authentication
  await setupAuth(app);

  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });

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

  // ─── Platform Admin routes (Super Admin Only) ───────────────────────────

  // GET /api/platform-admin/orgs — all orgs with usage stats (superAdmin only)
  app.get('/api/platform-admin/orgs', isSuperAdmin, async (_req, res) => {
    try {
      const orgs = await db.select().from(organizations).orderBy(desc(organizations.createdAt));
      
      // Get user counts for all orgs
      const userCounts = await db
        .select({ orgId: users.orgId, count: count() })
        .from(users)
        .groupBy(users.orgId);
      
      const userCountMap = new Map(userCounts.map(u => [u.orgId, u.count]));

      const result = orgs.map(org => {
        const limits = getEffectiveLimits(org);
        return {
          ...org,
          userCount: userCountMap.get(org.id) || 0,
          limits,
        };
      });

      res.json(result);
    } catch (error) {
      console.error("Error fetching platform orgs:", error);
      res.status(500).json({ message: "Failed to fetch organizations" });
    }
  });

  // GET /api/platform-admin/org-sync-status — org-level sync data for audit log
  app.get('/api/platform-admin/org-sync-status', isSuperAdmin, async (_req, res) => {
    try {
      const orgSyncIds = ['bricklink_inventory', 'bricklink_orders', 'brickowl_orders', 'channel_sync'];
      const syncRows = await db
        .select({
          id: syncMetadata.id,
          orgId: syncMetadata.orgId,
          lastSyncTime: syncMetadata.lastSyncTime,
          lastSyncStatus: syncMetadata.lastSyncStatus,
          recordsAdded: syncMetadata.recordsAdded,
          recordsUpdated: syncMetadata.recordsUpdated,
          errorMessage: syncMetadata.errorMessage,
          updatedAt: syncMetadata.updatedAt,
        })
        .from(syncMetadata)
        .where(and(
          inArray(syncMetadata.id, orgSyncIds),
          sql`${syncMetadata.orgId} IS NOT NULL AND ${syncMetadata.orgId} != ${PLATFORM_ORG_ID}`,
        ))
        .orderBy(desc(syncMetadata.updatedAt));

      const bsScans = await db.execute(sql`
        SELECT org_id,
          COUNT(*)::int as total_scans,
          COUNT(*) FILTER (WHERE status = 'complete')::int as completed,
          COUNT(*) FILTER (WHERE status = 'failed')::int as failed,
          MAX(created_at)::text as last_scan_at
        FROM brickanalyzer_scans
        WHERE org_id IS NOT NULL AND org_id != ${PLATFORM_ORG_ID}
        GROUP BY org_id
      `);

      const orgs = await db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(sql`${organizations.id} != ${PLATFORM_ORG_ID}`);

      const orgMap = new Map(orgs.map(o => [o.id, o.name]));

      const grouped: Record<string, { orgName: string; syncs: typeof syncRows; brickspotter: any }> = {};
      for (const row of syncRows) {
        const oid = row.orgId || 'unknown';
        if (!grouped[oid]) grouped[oid] = { orgName: orgMap.get(oid) || oid, syncs: [], brickspotter: null };
        grouped[oid].syncs.push(row);
      }
      for (const bs of (bsScans.rows || [])) {
        const oid = String((bs as any).org_id);
        if (!grouped[oid]) grouped[oid] = { orgName: orgMap.get(oid) || oid, syncs: [], brickspotter: null };
        grouped[oid].brickspotter = { totalScans: (bs as any).total_scans, completed: (bs as any).completed, failed: (bs as any).failed, lastScanAt: (bs as any).last_scan_at };
      }

      // Add orgs that exist but have no sync data yet
      for (const [oid, name] of orgMap) {
        if (!grouped[oid]) grouped[oid] = { orgName: name, syncs: [], brickspotter: null };
      }

      res.json(Object.entries(grouped).map(([orgId, data]) => ({ orgId, ...data })));
    } catch (error) {
      console.error("Error fetching org sync status:", error);
      res.status(500).json({ message: "Failed to fetch org sync status" });
    }
  });

  // GET /api/platform-admin/stats — platform-level stats
  app.get('/api/platform-admin/stats', isSuperAdmin, async (_req, res) => {
    try {
      const [orgStats] = await db.select({ count: count() }).from(organizations);
      const [userStats] = await db.select({ count: count() }).from(users);
      const [activeSubs] = await db.select({ count: count() }).from(organizations).where(eq(organizations.subscriptionStatus, 'active'));

      res.json({
        totalOrganizations: orgStats.count,
        totalUsers: userStats.count,
        activeSubscriptions: activeSubs.count,
      });
    } catch (error) {
      console.error("Error fetching platform stats:", error);
      res.status(500).json({ message: "Failed to fetch platform stats" });
    }
  });

  // POST /api/admin/organizations/:id/plan — super admin changes org plan
  app.post('/api/admin/organizations/:id/plan', isSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { plan } = req.body;
      if (!['trial', 'foundation', 'core', 'flagship'].includes(plan)) {
        return res.status(400).json({ message: "Invalid plan" });
      }
      const [updated] = await db.update(organizations).set({ plan, updatedAt: new Date() }).where(eq(organizations.id, id)).returning();
      res.json(updated);
    } catch (error) {
      console.error("Error updating org plan:", error);
      res.status(500).json({ message: "Failed to update organization plan" });
    }
  });

  // GET /api/admin/organizations/:id/limits — get org's current usage vs limits
  app.get('/api/admin/organizations/:id/limits', isAuthenticated, async (req, res) => {
    try {
      const { id } = req.params;
      // Ensure user belongs to this org OR is superAdmin
      const user = req.user as any;
      if (user.orgId !== id && !user.superAdmin) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const orgWithLimits = await getOrgWithLimits(id);
      if (!orgWithLimits) return res.status(404).json({ message: "Organization not found" });

      const seatCheck = await checkSeatLimit(id);
      const automationCheck = await checkAutomationLimit(id);
      const brickspotterCheck = await checkBrickspotterLimit(id);

      res.json({
        plan: orgWithLimits.plan,
        limits: orgWithLimits.limits,
        usage: {
          seats: seatCheck,
          automationRules: automationCheck,
          brickspotterScans: brickspotterCheck,
        }
      });
    } catch (error) {
      console.error("Error fetching org limits:", error);
      res.status(500).json({ message: "Failed to fetch organization limits" });
    }
  });

  // PATCH /api/admin/organizations/:id/overrides — set seat/scan/automation/bl-api overrides
  app.patch('/api/admin/organizations/:id/overrides', isSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { seatLimitOverride, brickspotterLimitOverride, automationLimitOverride, blApiCallLimitOverride } = req.body;
      
      const updates: any = { updatedAt: new Date() };
      if (seatLimitOverride !== undefined) updates.seatLimitOverride = seatLimitOverride;
      if (brickspotterLimitOverride !== undefined) updates.brickspotterLimitOverride = brickspotterLimitOverride;
      if (automationLimitOverride !== undefined) updates.automationLimitOverride = automationLimitOverride;
      if (blApiCallLimitOverride !== undefined) updates.blApiCallLimitOverride = blApiCallLimitOverride;

      const [updated] = await db.update(organizations).set(updates).where(eq(organizations.id, id)).returning();
      res.json(updated);
    } catch (error) {
      console.error("Error updating overrides:", error);
      res.status(500).json({ message: "Failed to update overrides" });
    }
  });

  // GET /api/admin/organizations/:id/bl-api-usage — per-org BL API call count last 24h
  app.get('/api/admin/organizations/:id/bl-api-usage', isSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [row] = await db
        .select({ count: sql<number>`count(*)` })
        .from(blApiCalls)
        .where(and(eq(blApiCalls.orgId, id), gte(blApiCalls.timestamp, twentyFourHoursAgo)));
      res.json({ orgId: id, callsLast24h: Number(row?.count) || 0 });
    } catch (error) {
      console.error("Error fetching BL API usage:", error);
      res.status(500).json({ message: "Failed to fetch BL API usage" });
    }
  });

  // ─── Platform Admin: Impersonation ───────────────────────────────────────────

  // POST /api/platform-admin/impersonate/:orgId — super admin enters as a tenant org
  app.post('/api/platform-admin/impersonate/:orgId', isSuperAdmin, async (req: any, res) => {
    try {
      const { orgId } = req.params;
      const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      req.session.impersonatingOrgId = org.id;
      req.session.impersonatingOrgName = org.name;
      res.json({ success: true, orgId: org.id, orgName: org.name });
    } catch (error) {
      console.error("Error starting impersonation:", error);
      res.status(500).json({ message: "Failed to start impersonation" });
    }
  });

  // DELETE /api/platform-admin/impersonate — stop impersonation, return to own session
  app.delete('/api/platform-admin/impersonate', isSuperAdmin, async (req: any, res) => {
    try {
      delete req.session.impersonatingOrgId;
      delete req.session.impersonatingOrgName;
      res.json({ success: true });
    } catch (error) {
      console.error("Error stopping impersonation:", error);
      res.status(500).json({ message: "Failed to stop impersonation" });
    }
  });

  // GET /api/platform-admin/impersonation-status — current impersonation state
  app.get('/api/platform-admin/impersonation-status', isAuthenticated, async (req: any, res) => {
    try {
      const isImpersonating = !!(req.session?.impersonatingOrgId);
      res.json({
        isImpersonating,
        orgId: req.session?.impersonatingOrgId ?? null,
        orgName: req.session?.impersonatingOrgName ?? null,
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get impersonation status" });
    }
  });

  // PATCH /api/platform-admin/orgs/:id/features — update per-org feature overrides
  app.patch('/api/platform-admin/orgs/:id/features', isSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { featureOverrides } = req.body;
      if (typeof featureOverrides !== 'object' || featureOverrides === null) {
        return res.status(400).json({ message: "featureOverrides must be an object" });
      }
      const [updated] = await db.update(organizations)
        .set({ featureOverrides, updatedAt: new Date() })
        .where(eq(organizations.id, id))
        .returning();
      res.json(updated);
    } catch (error) {
      console.error("Error updating feature overrides:", error);
      res.status(500).json({ message: "Failed to update feature overrides" });
    }
  });

  // POST /api/platform-admin/cleanup-shipstation-duplicate-orders
  // Dry-run by default. Pass ?confirm=true to actually delete.
  // Removes bare-numeric ShipStation-synced BL orders where a proper bl-{X} order already exists.
  app.post('/api/platform-admin/cleanup-shipstation-duplicate-orders', isSuperAdmin, async (req, res) => {
    try {
      const confirm = req.query.confirm === 'true';

      // Identify duplicate IDs: bare numeric orders with BL.X order_number where bl-X exists
      const dupsResult = await db.execute(sql`
        SELECT bare.id AS dup_id
        FROM orders bare
        INNER JOIN orders proper ON proper.id = 'bl-' || SUBSTRING(bare.order_number FROM 4)
        WHERE bare.order_number LIKE 'BL.%'
      `);
      const dupIds = (dupsResult.rows as any[]).map(r => r.dup_id as string);

      if (!confirm) {
        // Dry run — count what would be deleted
        const detailCountResult = await db.execute(sql`
          SELECT COUNT(*) as cnt
          FROM order_details od
          WHERE od.order_id IN (
            SELECT bare.id FROM orders bare
            INNER JOIN orders proper ON proper.id = 'bl-' || SUBSTRING(bare.order_number FROM 4)
            WHERE bare.order_number LIKE 'BL.%'
          )
        `);
        return res.json({
          dryRun: true,
          ordersToDelete: dupIds.length,
          orderDetailsToDelete: Number((detailCountResult.rows[0] as any)?.cnt ?? 0),
          sampleIds: dupIds.slice(0, 10),
          message: 'Pass ?confirm=true to execute the deletion',
        });
      }

      if (dupIds.length === 0) {
        return res.json({ message: 'No duplicate orders found — nothing to delete.' });
      }

      // Step 1: Delete order_details (no cascade on this FK)
      await db.execute(sql`
        DELETE FROM order_details
        WHERE order_id IN (
          SELECT bare.id FROM orders bare
          INNER JOIN orders proper ON proper.id = 'bl-' || SUBSTRING(bare.order_number FROM 4)
          WHERE bare.order_number LIKE 'BL.%'
        )
      `);

      // Step 2: Delete the duplicate orders (order_adjustments + picklist_items cascade automatically)
      await db.execute(sql`
        DELETE FROM orders
        WHERE id IN (
          SELECT bare.id FROM orders bare
          INNER JOIN orders proper ON proper.id = 'bl-' || SUBSTRING(bare.order_number FROM 4)
          WHERE bare.order_number LIKE 'BL.%'
        )
      `);

      console.log(`[AdminCleanup] Deleted ${dupIds.length} ShipStation duplicate orders and their related records`);

      return res.json({
        success: true,
        ordersDeleted: dupIds.length,
        message: `Deleted ${dupIds.length} ShipStation duplicate BL orders`,
      });
    } catch (error: any) {
      console.error('[AdminCleanup] Error during duplicate order cleanup:', error.message);
      res.status(500).json({ error: 'Cleanup failed: ' + error.message });
    }
  });

  // PATCH /api/platform-admin/orgs/:id/plan — super admin assigns any plan (including free/default) to an org
  app.patch('/api/platform-admin/orgs/:id/plan', isSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const planId = parseInt(req.body.planId);
      if (!planId || isNaN(planId)) return res.status(400).json({ message: 'planId is required' });
      const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
      if (!plan) return res.status(404).json({ message: 'Plan not found' });
      const [updated] = await db.update(organizations)
        .set({ planId, updatedAt: new Date() })
        .where(eq(organizations.id, id))
        .returning();
      res.json(updated);
    } catch (error) {
      console.error('Error updating org plan:', error);
      res.status(500).json({ message: 'Failed to update plan' });
    }
  });

  // PATCH /api/platform-admin/orgs/:id/suspend — toggle org active state
  app.patch('/api/platform-admin/orgs/:id/suspend', isSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const [updated] = await db.update(organizations)
        .set({ isActive: !!isActive, updatedAt: new Date() })
        .where(eq(organizations.id, id))
        .returning();
      res.json(updated);
    } catch (error) {
      console.error("Error updating org active state:", error);
      res.status(500).json({ message: "Failed to update organization" });
    }
  });

  // GET /api/platform-admin/orgs/:id/payments — Stripe invoice history for an org
  app.get('/api/platform-admin/orgs/:id/payments', isSuperAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
      if (!org) return res.status(404).json({ error: 'Not found' });
      if (!org.stripeCustomerId) return res.json({ payments: [] });
      const stripe = stripeClient.getClient();
      const invoices = await stripe.invoices.list({ customer: org.stripeCustomerId, limit: 50 });
      const payments = invoices.data.map(inv => ({
        id: inv.id,
        amount: inv.amount_paid,
        currency: inv.currency,
        status: inv.status,
        description: inv.description || inv.lines.data[0]?.description || null,
        periodStart: inv.period_start,
        periodEnd: inv.period_end,
        created: inv.created,
        hostedUrl: inv.hosted_invoice_url,
        pdfUrl: inv.invoice_pdf,
      }));
      res.json({ payments });
    } catch {
      res.status(500).json({ error: 'Failed to fetch payments' });
    }
  });

  // GET /api/platform-admin/platform-services/stripe-balance
  app.get('/api/platform-admin/platform-services/stripe-balance', isSuperAdmin, async (_req, res) => {
    try {
      const stripe = stripeClient.getClient();
      const balance = await stripe.balance.retrieve();
      res.json({
        available: balance.available.map(b => ({ amount: b.amount, currency: b.currency })),
        pending: balance.pending.map(b => ({ amount: b.amount, currency: b.currency })),
        livemode: balance.livemode,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Failed to fetch Stripe balance' });
    }
  });

  // GET /api/platform-admin/platform-services/platform-info — get platform name
  app.get('/api/platform-admin/platform-services/platform-info', isSuperAdmin, async (_req, res) => {
    try {
      const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, PLATFORM_ORG_ID)).limit(1);
      res.json({ platformName: settings?.platformName || '' });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || 'Failed to load platform info' });
    }
  });

  // POST /api/platform-admin/platform-services/platform-info — save platform name
  app.post('/api/platform-admin/platform-services/platform-info', isSuperAdmin, async (req, res) => {
    try {
      const { platformName } = req.body as { platformName: string };
      if (typeof platformName !== 'string' || platformName.length > 100) {
        return res.status(400).json({ message: 'Platform name must be a string (max 100 chars)' });
      }
      await db
        .insert(appSettings)
        .values({ id: PLATFORM_ORG_ID, orgId: PLATFORM_ORG_ID, platformName: platformName.trim() || null })
        .onConflictDoUpdate({
          target: appSettings.id,
          set: { platformName: platformName.trim() || null, updatedAt: sql`CURRENT_TIMESTAMP` },
        });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || 'Failed to save platform info' });
    }
  });

  // GET /api/platform-admin/platform-services/bricklink-status — check platform BrickLink connection
  app.get('/api/platform-admin/platform-services/bricklink-status', isSuperAdmin, async (_req, res) => {
    try {
      const creds = await getPlatformBrickLinkCredentials();
      if (!creds) return res.json({ connected: false, hasCredentials: false });
      const { bricklinkRequest } = await import('./services/bricklink');
      const result = await bricklinkRequest('/colors', undefined, PLATFORM_ORG_ID);
      const colorCount = Array.isArray(result.data) ? result.data.length : 0;
      res.json({
        connected: true,
        hasCredentials: true,
        keyPrefix: creds.consumerKey.substring(0, 8) + '…',
        testResult: `${colorCount} colors retrieved`,
      });
    } catch (err: any) {
      res.json({ connected: false, hasCredentials: true, error: err?.message });
    }
  });

  // POST /api/platform-admin/platform-services/bricklink-credentials — save platform BrickLink creds (partial update)
  app.post('/api/platform-admin/platform-services/bricklink-credentials', isSuperAdmin, async (req, res) => {
    try {
      const body = req.body as Record<string, string | null | undefined>;
      const updateSet: Record<string, any> = { updatedAt: sql`CURRENT_TIMESTAMP` };
      const insertValues: Record<string, any> = { id: PLATFORM_ORG_ID, orgId: PLATFORM_ORG_ID };

      const cleanCred = (v: string) => v.replace(/[^A-Za-z0-9]/g, '');
      if (typeof body.consumerKey === 'string' && body.consumerKey.trim().length > 0) {
        const val = cleanCred(body.consumerKey);
        updateSet.bricklinkConsumerKey = val;
        insertValues.bricklinkConsumerKey = val;
      }
      if (typeof body.consumerSecret === 'string' && body.consumerSecret.trim().length > 0) {
        const val = cleanCred(body.consumerSecret);
        updateSet.bricklinkConsumerSecret = val;
        insertValues.bricklinkConsumerSecret = val;
      }
      if (typeof body.tokenValue === 'string' && body.tokenValue.trim().length > 0) {
        const val = cleanCred(body.tokenValue);
        updateSet.bricklinkTokenValue = val;
        insertValues.bricklinkTokenValue = val;
      }
      if (typeof body.tokenSecret === 'string' && body.tokenSecret.trim().length > 0) {
        const val = cleanCred(body.tokenSecret);
        updateSet.bricklinkTokenSecret = val;
        insertValues.bricklinkTokenSecret = val;
      }

      if (Object.keys(updateSet).length <= 1) {
        return res.status(400).json({ message: 'No valid credential fields provided' });
      }

      await db
        .insert(appSettings)
        .values(insertValues)
        .onConflictDoUpdate({
          target: appSettings.id,
          set: updateSet,
        });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || 'Failed to save BrickLink credentials' });
    }
  });

  // GET /api/platform-admin/platform-services/bricklink-credentials — retrieve presence/prefix info (never full secrets)
  app.get('/api/platform-admin/platform-services/bricklink-credentials', isSuperAdmin, async (_req, res) => {
    try {
      const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, PLATFORM_ORG_ID)).limit(1);
      const mask = (val: string | null | undefined) => val ? val.substring(0, 8) + '…' : '';
      res.json({
        hasConsumerKey: !!settings?.bricklinkConsumerKey,
        consumerKeyPrefix: mask(settings?.bricklinkConsumerKey),
        hasConsumerSecret: !!settings?.bricklinkConsumerSecret,
        hasTokenValue: !!settings?.bricklinkTokenValue,
        tokenValuePrefix: mask(settings?.bricklinkTokenValue),
        hasTokenSecret: !!settings?.bricklinkTokenSecret,
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || 'Failed to load credentials' });
    }
  });

  // GET /api/platform-admin/platform-services/openai-status
  app.get('/api/platform-admin/platform-services/openai-status', isSuperAdmin, async (_req, res) => {
    try {
      const apiKey = await getPlatformOpenAIKey();
      if (!apiKey) return res.json({ connected: false, models: [] });
      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({ apiKey });
      const models = await client.models.list();
      const chatModels = models.data.filter(m => m.id.startsWith('gpt')).slice(0, 5).map(m => m.id);
      res.json({ connected: true, models: chatModels, keyPrefix: apiKey.substring(0, 7) + '…' });
    } catch (err: any) {
      res.json({ connected: false, error: err?.message });
    }
  });

  // POST /api/platform-admin/platform-services/openai-key — save platform-wide OpenAI API key
  app.post('/api/platform-admin/platform-services/openai-key', isSuperAdmin, async (req, res) => {
    try {
      const { openaiApiKey } = req.body as { openaiApiKey: string | null };
      const [settings] = await db
        .insert(appSettings)
        .values({ id: PLATFORM_ORG_ID, orgId: PLATFORM_ORG_ID, openaiApiKey: openaiApiKey || null })
        .onConflictDoUpdate({
          target: appSettings.id,
          set: { openaiApiKey: openaiApiKey || null, updatedAt: sql`CURRENT_TIMESTAMP` },
        })
        .returning();
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || 'Failed to save API key' });
    }
  });

  // GET /api/platform-admin/platform-services/openai-billing — locally tracked AI usage
  app.get('/api/platform-admin/platform-services/openai-billing', isSuperAdmin, async (_req, res) => {
    try {
      const { getUsageSummary, getUsageMtd, getUsageLast30d } = await import('./services/ai-usage-tracker');

      const [summary, mtd, last30d] = await Promise.all([
        getUsageSummary(30),
        getUsageMtd(),
        getUsageLast30d(),
      ]);

      const topModels = summary
        .sort((a, b) => Number(b.totalTokens) - Number(a.totalTokens))
        .slice(0, 10)
        .map(row => ({
          model: row.model,
          service: row.service,
          cost: Math.round(Number(row.totalCost) * 10000) / 10000,
          input_tokens: Number(row.totalInput),
          output_tokens: Number(row.totalOutput),
          requests: Number(row.requests),
        }));

      res.json({
        billing: { totalGranted: 0, totalUsed: 0, totalAvailable: 0, grants: [] },
        usage: {
          last30Days: Math.round(Number(last30d.totalCost) * 10000) / 10000,
          mtd: Math.round(Number(mtd.totalCost) * 10000) / 10000,
          topModels,
          totalTokens: Number(last30d.totalTokens),
          totalRequests: Number(last30d.requests),
          mtdTokens: Number(mtd.totalTokens),
          mtdRequests: Number(mtd.requests),
        },
        costsAvailable: summary.length > 0,
        creditsAvailable: false,
        source: 'local',
      });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || 'Failed to fetch AI usage data' });
    }
  });

  // GET /api/platform-admin/settings — read platform-level settings (POM, schedulers, etc.)
  app.get('/api/platform-admin/settings', isSuperAdmin, async (_req, res) => {
    try {
      const settings = await getOrgSettings(PLATFORM_ORG_ID);
      res.json(maskSettingsSecrets(settings as any));
    } catch (error) {
      console.error("Error fetching platform settings:", error);
      res.status(500).json({ error: "Failed to fetch platform settings" });
    }
  });

  // POST /api/platform-admin/settings — update platform-level settings
  app.post('/api/platform-admin/settings', isSuperAdmin, async (req, res) => {
    try {
      const data = insertAppSettingsSchema.parse(req.body);
      for (const field of SECRET_FIELDS) {
        const val = (data as any)[field];
        if (val && typeof val === 'string' && val.includes('····')) {
          delete (data as any)[field];
        }
      }
      const [settings] = await db
        .insert(appSettings)
        .values({ ...data, id: PLATFORM_ORG_ID, orgId: PLATFORM_ORG_ID })
        .onConflictDoUpdate({
          target: appSettings.id,
          set: { ...data, updatedAt: sql`CURRENT_TIMESTAMP` },
        })
        .returning();
      res.json(maskSettingsSecrets(settings as any));
    } catch (error) {
      console.error("Error updating platform settings:", error);
      res.status(500).json({ error: "Failed to update platform settings" });
    }
  });

  // GET /api/platform-admin/platform-services/openai-billing/by-org — per-org AI usage breakdown
  app.get('/api/platform-admin/platform-services/openai-billing/by-org', isSuperAdmin, async (_req, res) => {
    try {
      const { getUsageByOrg } = await import('./services/ai-usage-tracker');
      const rows = await getUsageByOrg(30);

      const orgMap: Record<string, { orgId: string; totalTokens: number; totalCost: number; requests: number; operations: Record<string, { tokens: number; cost: number; requests: number }> }> = {};

      for (const row of rows) {
        const oid = row.orgId || 'platform';
        if (!orgMap[oid]) {
          orgMap[oid] = { orgId: oid, totalTokens: 0, totalCost: 0, requests: 0, operations: {} };
        }
        const entry = orgMap[oid];
        const tokens = Number(row.totalTokens);
        const cost = Number(row.totalCost);
        const reqs = Number(row.requests);
        entry.totalTokens += tokens;
        entry.totalCost += cost;
        entry.requests += reqs;
        const op = row.operation || 'other';
        if (!entry.operations[op]) entry.operations[op] = { tokens: 0, cost: 0, requests: 0 };
        entry.operations[op].tokens += tokens;
        entry.operations[op].cost += cost;
        entry.operations[op].requests += reqs;
      }

      const orgNames: Record<string, string> = {};
      let storedPlatformName = '';
      try {
        const allOrgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);
        for (const o of allOrgs) orgNames[o.id] = o.name;
        const [platSettings] = await db.select({ platformName: appSettings.platformName }).from(appSettings).where(eq(appSettings.id, PLATFORM_ORG_ID)).limit(1);
        storedPlatformName = platSettings?.platformName || '';
      } catch {}

      const orgs = Object.values(orgMap)
        .map(o => ({
          ...o,
          orgName: orgNames[o.orgId] || (o.orgId === 'platform' ? (storedPlatformName || 'Platform') : o.orgId),
          totalCost: Math.round(o.totalCost * 10000) / 10000,
          operations: Object.entries(o.operations).map(([op, d]) => ({
            operation: op,
            tokens: d.tokens,
            cost: Math.round(d.cost * 10000) / 10000,
            requests: d.requests,
          })),
        }))
        .sort((a, b) => b.totalTokens - a.totalTokens);

      res.json({ orgs });
    } catch (err: any) {
      res.status(500).json({ message: err?.message || 'Failed to fetch per-org usage' });
    }
  });

  // GET /api/platform-admin/admin-team — list all super admins
  app.get('/api/platform-admin/admin-team', isSuperAdmin, async (_req, res) => {
    try {
      const admins = await storage.getSuperAdmins();
      res.json(admins);
    } catch (err) {
      res.status(500).json({ message: 'Failed to fetch admin team' });
    }
  });

  // GET /api/platform-admin/admin-team/search — find users by email/name
  app.get('/api/platform-admin/admin-team/search', isSuperAdmin, async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      if (q.length < 2) return res.json([]);
      const results = await storage.searchUsersByEmail(q);
      res.json(results);
    } catch (err) {
      res.status(500).json({ message: 'Search failed' });
    }
  });

  // PATCH /api/platform-admin/admin-team/:id — grant or revoke super admin
  app.patch('/api/platform-admin/admin-team/:id', isSuperAdmin, async (req: any, res) => {
    try {
      const schema = z.object({ superAdmin: z.boolean() });
      const parsed = schema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: 'Invalid body' });
      // Prevent revoking your own super admin
      if (req.user?.id === req.params.id && !parsed.data.superAdmin) {
        return res.status(400).json({ message: 'Cannot remove your own super admin access' });
      }
      const updated = await storage.updateUserSuperAdmin(req.params.id, parsed.data.superAdmin);
      if (!updated) return res.status(404).json({ message: 'User not found' });
      res.json(updated);
    } catch (err) {
      res.status(500).json({ message: 'Failed to update super admin status' });
    }
  });

  // GET /api/platform-admin/pricing-model — get pay-as-you-grow config
  app.get('/api/platform-admin/pricing-model', isSuperAdmin, async (_req, res) => {
    try {
      const [row] = await db.select().from(pricingModel).where(eq(pricingModel.id, 1)).limit(1);
      res.json(row || null);
    } catch (err: any) {
      console.error("Error fetching pricing model:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // PUT /api/platform-admin/pricing-model — update pay-as-you-grow config
  app.put('/api/platform-admin/pricing-model', isSuperAdmin, async (req, res) => {
    try {
      const pricingSchema = z.object({
        basePrice: z.number().int().min(0).max(100000).optional(),
        overageBump: z.number().int().min(0).max(10000).optional(),
        monthlyCap: z.number().int().min(0).max(100000).optional(),
        trialDays: z.number().int().min(0).max(365).optional(),
        baseInventoryLots: z.number().int().min(0).max(10000000).optional(),
        bumpInventoryLots: z.number().int().min(0).max(1000000).optional(),
        baseOrdersPerMonth: z.number().int().min(0).max(1000000).optional(),
        bumpOrdersPerMonth: z.number().int().min(0).max(100000).optional(),
        baseConnectedStores: z.number().int().min(0).max(100).optional(),
        bumpConnectedStores: z.number().int().min(0).max(50).optional(),
        baseAiCalls: z.number().int().min(0).max(1000000).optional(),
        bumpAiCalls: z.number().int().min(0).max(100000).optional(),
        baseScans: z.number().int().min(0).max(1000000).optional(),
        bumpScans: z.number().int().min(0).max(100000).optional(),
      });
      const parsed = pricingSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid pricing data", errors: parsed.error.flatten().fieldErrors });
      const updates = parsed.data as Record<string, any>;
      if (Object.keys(updates).length === 0) return res.status(400).json({ message: 'No valid fields to update' });
      updates.updatedAt = new Date();
      await db.update(pricingModel).set(updates).where(eq(pricingModel.id, 1));
      const [row] = await db.select().from(pricingModel).where(eq(pricingModel.id, 1)).limit(1);
      res.json(row);
    } catch (err: any) {
      console.error("Error updating pricing model:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Sales-Percentage Billing Helpers ────────────────────────────────────────
  // Billing formula: totalDue = plan.basePrice + salesPercentage% × max(0, monthlySales − freeSalesThreshold)
  // All monetary values in cents.
  // Billing periods run from the customer's signup-date anniversary each month
  // (e.g. signed up on the 15th → periods run 15th–14th, not 1st–last).

  /** Returns the start of the current billing period for an org based on their signup day. */
  function getBillingPeriodStart(billingStartDate: Date | null | undefined, now: Date): Date {
    if (!billingStartDate) {
      // No signup date recorded — fall back to calendar month start
      return new Date(now.getFullYear(), now.getMonth(), 1);
    }
    const signupDay = billingStartDate.getDate();
    // Try this month's anniversary
    let periodStart = new Date(now.getFullYear(), now.getMonth(), signupDay);
    if (periodStart > now) {
      // We're before this month's anniversary — use last month's
      periodStart = new Date(now.getFullYear(), now.getMonth() - 1, signupDay);
    }
    return periodStart;
  }

  /** Returns the start of a billing period N months before the current one. */
  function getBillingPeriodStartOffset(billingStartDate: Date | null | undefined, now: Date, monthsBack: number): Date {
    if (!billingStartDate) {
      return new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
    }
    const signupDay = billingStartDate.getDate();
    const currentPeriodStart = getBillingPeriodStart(billingStartDate, now);
    return new Date(currentPeriodStart.getFullYear(), currentPeriodStart.getMonth() - monthsBack, signupDay);
  }

  async function getOrgMonthlySalesCents(orgId: string, from: Date, to: Date): Promise<number> {
    // Items subtotal: sum(quantity * unit_price) for all non-cancelled/purged orders in the period
    const itemsResult = await db.execute(sql`
      SELECT COALESCE(SUM(od.quantity * od.unit_price::numeric), 0) AS total
      FROM order_details od
      JOIN orders o ON o.id = od.order_id
      WHERE o.org_id = ${orgId}
        AND o.order_status NOT IN ('cancelled', 'purged')
        AND o.order_date >= ${from}
        AND o.order_date < ${to}
    `);
    const itemsCents = Math.round(parseFloat((itemsResult.rows[0] as any)?.total ?? '0') * 100);

    // Discount adjustments: sum all discount-type adjustments for those orders (amounts are negative for deductions)
    const discountResult = await db.execute(sql`
      SELECT COALESCE(SUM(oa.amount::numeric), 0) AS total
      FROM order_adjustments oa
      JOIN orders o ON o.id = oa.order_id
      WHERE o.org_id = ${orgId}
        AND o.order_status NOT IN ('cancelled', 'purged')
        AND o.order_date >= ${from}
        AND o.order_date < ${to}
        AND oa.type = 'discount'
    `);
    const discountCents = Math.round(parseFloat((discountResult.rows[0] as any)?.total ?? '0') * 100);

    return Math.max(0, itemsCents + discountCents);
  }

  function calcSalesBilling(plan: { basePrice: number; salesPercentage: number; freeSalesThreshold: number }, monthlySalesCents: number) {
    const salesOverThreshold = Math.max(0, monthlySalesCents - plan.freeSalesThreshold);
    const salesFeeCents = Math.round(salesOverThreshold * plan.salesPercentage / 100);
    return { baseFee: plan.basePrice, salesFee: salesFeeCents, totalDue: plan.basePrice + salesFeeCents };
  }

  async function getOrgActivePlan(orgId: string) {
    const [orgRow] = await db.select({ planId: organizations.planId }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
    if (orgRow?.planId) {
      const [plan] = await db.select().from(plans).where(eq(plans.id, orgRow.planId)).limit(1);
      if (plan) return plan;
    }
    // Fall back to the platform-designated default plan
    const [defaultPlan] = await db.select().from(plans).where(eq(plans.isDefault, true)).limit(1);
    if (defaultPlan) return defaultPlan;
    // Last-resort hardcoded fallback (should never reach here in a properly seeded DB)
    return { id: 0, name: 'Pay As You Grow', basePrice: 3900, salesPercentage: 1.9, freeSalesThreshold: 100000, status: 'live', isDefault: true, sunsetAt: null, createdAt: new Date(), updatedAt: new Date() };
  }

  // GET /api/org/usage — current org's billing-period usage summary (sales-based)
  app.get('/api/org/usage', isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const now = new Date();

      const plan = await getOrgActivePlan(orgId);

      const [orgRow] = await db.select({
        billingStartDate: organizations.billingStartDate,
        subscriptionStatus: organizations.subscriptionStatus,
        planId: organizations.planId,
      }).from(organizations).where(eq(organizations.id, orgId)).limit(1);

      // Period runs from signup-date anniversary, not calendar month
      const periodStart = getBillingPeriodStart(orgRow?.billingStartDate, now);

      const monthlySalesCents = await getOrgMonthlySalesCents(orgId, periodStart, now);
      const billing = calcSalesBilling(plan, monthlySalesCents);

      res.json({
        orgId,
        billingStartDate: orgRow?.billingStartDate ? orgRow.billingStartDate.toISOString() : null,
        subscriptionStatus: orgRow?.subscriptionStatus ?? 'active',
        period: { start: periodStart.toISOString(), end: now.toISOString() },
        plan: { id: plan.id, name: plan.name, basePrice: plan.basePrice, salesPercentage: plan.salesPercentage, freeSalesThreshold: plan.freeSalesThreshold, isDefault: plan.isDefault ?? false, sunsetAt: plan.sunsetAt ? plan.sunsetAt.toISOString() : null },
        monthlySalesCents,
        billing,
      });
    } catch (err: any) {
      console.error("Error fetching org usage:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/org/billing/history — completed billing months, paginated by year
  // Query params: ?year=2024  (defaults to current year)
  // Response: { months, year, firstYear, lastYear }
  app.get('/api/org/billing/history', isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const plan = await getOrgActivePlan(orgId);

      const [orgRow] = await db.select({ billingStartDate: organizations.billingStartDate, createdAt: organizations.createdAt })
        .from(organizations).where(eq(organizations.id, orgId)).limit(1);

      const now = new Date();
      const billingStartDate = orgRow?.billingStartDate ?? orgRow?.createdAt ?? null;
      const currentPeriodStart = getBillingPeriodStart(billingStartDate, now);

      // History = completed billing periods only (i.e. everything before the current period start).
      // If the org just signed up and the current period hasn't completed yet, there is no history.
      const earliest = billingStartDate ?? currentPeriodStart;
      const totalMonthsBack =
        (currentPeriodStart.getFullYear() - earliest.getFullYear()) * 12 +
        (currentPeriodStart.getMonth() - earliest.getMonth());

      // Determine year range for the navigator
      const firstYear = earliest.getFullYear();
      const lastYear = totalMonthsBack > 0 ? currentPeriodStart.getFullYear() : earliest.getFullYear();

      // Which year to show (default: last/current year)
      const requestedYear = req.query.year ? parseInt(req.query.year as string) : lastYear;
      const targetYear = Math.max(firstYear, Math.min(lastYear, requestedYear));

      // Collect all completed periods within the target year.
      // Guard: mStart must be on or after billingStartDate so we never show pre-signup months.
      const months = [];
      for (let i = 1; i <= totalMonthsBack; i++) {
        const mStart = getBillingPeriodStartOffset(billingStartDate, now, i);
        if (billingStartDate && mStart < earliest) continue; // never show pre-signup periods
        if (mStart.getFullYear() !== targetYear) continue;
        const mEnd = getBillingPeriodStartOffset(billingStartDate, now, i - 1);
        const monthlySalesCents = await getOrgMonthlySalesCents(orgId, mStart, mEnd);
        const billing = calcSalesBilling(plan, monthlySalesCents);
        months.push({
          label: mStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
          year: mStart.getFullYear(),
          periodStart: mStart.toISOString(),
          periodEnd: mEnd.toISOString(),
          monthlySalesCents,
          billing,
          plan: { name: plan.name, basePrice: plan.basePrice, salesPercentage: plan.salesPercentage, freeSalesThreshold: plan.freeSalesThreshold, isDefault: plan.isDefault ?? false, sunsetAt: plan.sunsetAt ? plan.sunsetAt.toISOString() : null },
        });
      }

      res.json({ months, year: targetYear, firstYear, lastYear });
    } catch (err: any) {
      console.error('Error fetching billing history:', err);
      res.status(500).json({ message: err.message });
    }
  });

  // ── Platform Admin: Plans CRUD ──────────────────────────────────────────────
  app.get('/api/platform-admin/plans', isSuperAdmin, async (_req, res) => {
    try {
      const allPlans = await db.select().from(plans).orderBy(asc(plans.id));
      const orgCounts = await db.select({
        planId: organizations.planId,
        count: sql<number>`COUNT(*)::int`,
      }).from(organizations).groupBy(organizations.planId);
      const countMap = new Map(orgCounts.map(r => [r.planId, Number(r.count)]));
      res.json(allPlans.map(p => {
        const orgCount = countMap.get(p.id) ?? 0;
        return { ...p, orgCount, locked: orgCount > 0 };
      }));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post('/api/platform-admin/plans', isSuperAdmin, async (req, res) => {
    try {
      const data = insertPlanSchema.parse(req.body);
      const [created] = await db.insert(plans).values(data).returning();
      res.status(201).json(created);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.patch('/api/platform-admin/plans/:id', isSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      // Check if orgs are on this plan — if so, only status/name/sunsetAt/isDefault edits allowed
      const [orgCount] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(organizations).where(eq(organizations.planId, id));
      const hasOrgs = Number(orgCount.count) > 0;
      // BS fields are always editable regardless of lock status
      const bsFields = {
        ...(req.body.isBrickspotterOnly !== undefined && { isBrickspotterOnly: req.body.isBrickspotterOnly }),
        ...(req.body.limitBrickspotterScans !== undefined && { limitBrickspotterScans: req.body.limitBrickspotterScans }),
        ...(req.body.limitBrickspotterApiCalls !== undefined && { limitBrickspotterApiCalls: req.body.limitBrickspotterApiCalls }),
      };
      const allowed = hasOrgs
        ? { status: req.body.status, name: req.body.name, sunsetAt: req.body.sunsetAt, isDefault: req.body.isDefault, ...bsFields }
        : req.body;
      // Parse sunsetAt as a Date if provided
      if (allowed.sunsetAt !== undefined) {
        allowed.sunsetAt = allowed.sunsetAt ? new Date(allowed.sunsetAt) : null;
      }
      // If setting this plan as default, clear the flag from all other plans first
      if (allowed.isDefault === true) {
        await db.update(plans).set({ isDefault: false }).where(sql`id != ${id}`);
      }
      const parsed = insertPlanSchema.partial().parse(allowed);
      const [updated] = await db.update(plans).set({ ...parsed, updatedAt: new Date() }).where(eq(plans.id, id)).returning();
      if (!updated) return res.status(404).json({ message: 'Plan not found' });
      res.json({ ...updated, locked: hasOrgs });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete('/api/platform-admin/plans/:id', isSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const [orgCount] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(organizations).where(eq(organizations.planId, id));
      if (Number(orgCount.count) > 0) return res.status(409).json({ message: 'Cannot delete a plan with active organizations. Sunset it instead.' });
      await db.delete(plans).where(eq(plans.id, id));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });


  // GET /api/platform-admin/org-usage/:orgId — admin view of any org's billing
  app.get('/api/platform-admin/org-usage/:orgId', isSuperAdmin, async (req: any, res) => {
    try {
      const { orgId } = req.params;
      const now = new Date();

      const plan = await getOrgActivePlan(orgId);

      const [orgInfo] = await db.select({ id: organizations.id, name: organizations.name, billingStartDate: organizations.billingStartDate })
        .from(organizations).where(eq(organizations.id, orgId)).limit(1);

      const periodStart = getBillingPeriodStart(orgInfo?.billingStartDate, now);
      const monthlySalesCents = await getOrgMonthlySalesCents(orgId, periodStart, now);
      const billing = calcSalesBilling(plan, monthlySalesCents);

      res.json({
        orgId,
        orgName: orgInfo?.name || orgId,
        billingStartDate: orgInfo?.billingStartDate ? orgInfo.billingStartDate.toISOString() : null,
        period: { start: periodStart.toISOString(), end: now.toISOString() },
        plan: { id: plan.id, name: plan.name, basePrice: plan.basePrice, salesPercentage: plan.salesPercentage, freeSalesThreshold: plan.freeSalesThreshold },
        monthlySalesCents,
        billing,
      });
    } catch (err: any) {
      console.error("Error fetching org usage:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/platform-admin/all-orgs-usage — sales-based billing summary for all orgs
  app.get('/api/platform-admin/all-orgs-usage', isSuperAdmin, async (_req, res) => {
    try {
      const now = new Date();
      const allOrgs = await db.select({ id: organizations.id, name: organizations.name, planId: organizations.planId, billingStartDate: organizations.billingStartDate }).from(organizations);
      const allPlans = await db.select().from(plans);
      const planMap = new Map(allPlans.map(p => [p.id, p]));
      const defaultPlan = { id: 1, name: 'Pay As You Grow', basePrice: 3900, salesPercentage: 1.9, freeSalesThreshold: 100000, status: 'live', createdAt: new Date(), updatedAt: new Date() };

      const orgUsages = await Promise.all(allOrgs.map(async (org) => {
        const plan = planMap.get(org.planId ?? 1) ?? defaultPlan;
        const periodStart = getBillingPeriodStart(org.billingStartDate, now);
        const monthlySalesCents = await getOrgMonthlySalesCents(org.id, periodStart, now);
        const billing = calcSalesBilling(plan, monthlySalesCents);
        return { orgId: org.id, orgName: org.name, planName: plan.name, monthlySalesCents, billing };
      }));

      const totalMRR = orgUsages.reduce((s, o) => s + o.billing.totalDue, 0);
      res.json({ orgs: orgUsages, summary: { totalMRR, orgCount: orgUsages.length } });
    } catch (err: any) {
      console.error("Error fetching all orgs usage:", err);
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/platform-admin/system-health — embedding jobs, sync status, platform vitals
  app.get('/api/platform-admin/system-health', isSuperAdmin, async (_req, res) => {
    try {
      // Platform totals
      const [orgCount] = await db.select({ count: count() }).from(organizations);
      const [userCount] = await db.select({ count: count() }).from(users);
      const [activeSubCount] = await db.select({ count: count() }).from(organizations).where(eq(organizations.subscriptionStatus, 'active'));

      // Active embedding jobs (pending / processing)
      const activeJobs = await db
        .select({
          id: embeddingJobs.id,
          orgId: embeddingJobs.orgId,
          jobType: embeddingJobs.jobType,
          status: embeddingJobs.status,
          processedItems: embeddingJobs.processedItems,
          totalItems: embeddingJobs.totalItems,
          errorMessage: embeddingJobs.errorMessage,
          createdAt: embeddingJobs.createdAt,
          completedAt: embeddingJobs.completedAt,
        })
        .from(embeddingJobs)
        .where(sql`${embeddingJobs.status} IN ('pending', 'processing')`)
        .orderBy(desc(embeddingJobs.createdAt))
        .limit(20);

      // Recent completed/failed jobs (last 10)
      const recentJobs = await db
        .select({
          id: embeddingJobs.id,
          orgId: embeddingJobs.orgId,
          jobType: embeddingJobs.jobType,
          status: embeddingJobs.status,
          processedItems: embeddingJobs.processedItems,
          totalItems: embeddingJobs.totalItems,
          errorMessage: embeddingJobs.errorMessage,
          createdAt: embeddingJobs.createdAt,
          completedAt: embeddingJobs.completedAt,
        })
        .from(embeddingJobs)
        .where(sql`${embeddingJobs.status} IN ('completed', 'failed')`)
        .orderBy(desc(embeddingJobs.completedAt))
        .limit(10);

      // Embedding counts per type
      const [invEmbCount] = await db.select({ count: count() }).from(inventoryEmbeddings);
      const [ordEmbCount] = await db.select({ count: count() }).from(orderEmbeddings);
      const [invTotalCount] = await db.select({ count: count() }).from(blInventory);
      const [ordTotalCount] = await db.select({ count: count() }).from(orders);

      const platformSyncIds = ['priceomatic_cache', 'universal_catalog_refresh', 'rebrickable_set_parts', 'forum_sync', 'catalog_detail_completion', 'catalog_scan', 'market_news_sync', 'business_intel_sync'];
      const syncJobs = await db
        .select({
          id: syncMetadata.id,
          orgId: syncMetadata.orgId,
          lastSyncTime: syncMetadata.lastSyncTime,
          lastSyncStatus: syncMetadata.lastSyncStatus,
          recordsAdded: syncMetadata.recordsAdded,
          recordsUpdated: syncMetadata.recordsUpdated,
          errorMessage: syncMetadata.errorMessage,
          updatedAt: syncMetadata.updatedAt,
        })
        .from(syncMetadata)
        .where(inArray(syncMetadata.id, platformSyncIds))
        .orderBy(desc(syncMetadata.updatedAt));

      const [clipTotal] = await db.select({ count: count() }).from(blCatalogClipEmbeddings);
      const [catalogTotal] = await db.select({ count: count() }).from(blCatalog);
      const clipCatalogStatus = {
        embedded: Number(clipTotal?.count || 0),
        total: Number(catalogTotal?.count || 0),
      };

      // Catalog coverage stats for BrickLink Catalog tab dashboard
      const [platformSettings] = await db.select().from(appSettings).where(eq(appSettings.orgId, PLATFORM_ORG_ID)).limit(1);
      const detailFreshDays = platformSettings?.catalogDetailFreshnessDays ?? 90;
      const priceFreshDays = platformSettings?.pomFreshnessDays ?? 180;
      const catalogCoverageResult = await db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM bl_inventory) AS total_lots,
          (SELECT COUNT(*) FROM bl_inventory WHERE quantity > 0) AS in_stock_lots,

          (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i
           INNER JOIN bl_catalog c ON i.item_no = c.item_no AND i.item_type = c.item_type AND COALESCE(i.color_id, 0) = c.color_id
           WHERE c.item_name IS NOT NULL AND c.item_name != '') AS has_detail,
          (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i
           INNER JOIN bl_catalog c ON i.item_no = c.item_no AND i.item_type = c.item_type AND COALESCE(i.color_id, 0) = c.color_id
           WHERE c.item_name IS NOT NULL AND c.item_name != '' AND i.quantity > 0) AS has_detail_instock,
          (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i
           INNER JOIN bl_catalog c ON i.item_no = c.item_no AND i.item_type = c.item_type AND COALESCE(i.color_id, 0) = c.color_id
           WHERE c.item_name IS NOT NULL AND c.item_name != '' AND c.updated_at < NOW() - INTERVAL '1 day' * ${detailFreshDays}) AS stale_detail,
          (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i
           INNER JOIN bl_catalog c ON i.item_no = c.item_no AND i.item_type = c.item_type AND COALESCE(i.color_id, 0) = c.color_id
           WHERE c.item_name IS NOT NULL AND c.item_name != '' AND c.updated_at < NOW() - INTERVAL '1 day' * ${detailFreshDays} AND i.quantity > 0) AS stale_detail_instock,

          (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i
           INNER JOIN price_guide_cache p ON UPPER(i.item_no) = p.item_no AND i.item_type = p.item_type
             AND CASE WHEN COALESCE(i.color_id, 0) = 0 THEN p.color_id IN (0, -1) ELSE i.color_id = p.color_id END AND i.new_or_used = p.new_or_used
           WHERE p.stock_avg_price IS NOT NULL AND p.stock_min_price IS NOT NULL AND p.stock_max_price IS NOT NULL AND p.stock_qty_avg_price IS NOT NULL AND p.stock_quantity IS NOT NULL AND p.stock_fetched_at IS NOT NULL) AS has_supply,
          (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i
           INNER JOIN price_guide_cache p ON UPPER(i.item_no) = p.item_no AND i.item_type = p.item_type
             AND CASE WHEN COALESCE(i.color_id, 0) = 0 THEN p.color_id IN (0, -1) ELSE i.color_id = p.color_id END AND i.new_or_used = p.new_or_used
           WHERE p.stock_avg_price IS NOT NULL AND p.stock_min_price IS NOT NULL AND p.stock_max_price IS NOT NULL AND p.stock_qty_avg_price IS NOT NULL AND p.stock_quantity IS NOT NULL AND p.stock_fetched_at IS NOT NULL AND i.quantity > 0) AS has_supply_instock,
          (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i
           INNER JOIN price_guide_cache p ON UPPER(i.item_no) = p.item_no AND i.item_type = p.item_type
             AND CASE WHEN COALESCE(i.color_id, 0) = 0 THEN p.color_id IN (0, -1) ELSE i.color_id = p.color_id END AND i.new_or_used = p.new_or_used
           WHERE p.stock_avg_price IS NOT NULL AND p.stock_min_price IS NOT NULL AND p.stock_max_price IS NOT NULL AND p.stock_qty_avg_price IS NOT NULL AND p.stock_quantity IS NOT NULL AND p.stock_fetched_at IS NOT NULL AND p.stock_fetched_at < NOW() - INTERVAL '1 day' * ${priceFreshDays}) AS stale_supply,
          (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i
           INNER JOIN price_guide_cache p ON UPPER(i.item_no) = p.item_no AND i.item_type = p.item_type
             AND CASE WHEN COALESCE(i.color_id, 0) = 0 THEN p.color_id IN (0, -1) ELSE i.color_id = p.color_id END AND i.new_or_used = p.new_or_used
           WHERE p.stock_avg_price IS NOT NULL AND p.stock_min_price IS NOT NULL AND p.stock_max_price IS NOT NULL AND p.stock_qty_avg_price IS NOT NULL AND p.stock_quantity IS NOT NULL AND p.stock_fetched_at IS NOT NULL AND p.stock_fetched_at < NOW() - INTERVAL '1 day' * ${priceFreshDays} AND i.quantity > 0) AS stale_supply_instock,

          (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i
           INNER JOIN price_guide_cache p ON UPPER(i.item_no) = p.item_no AND i.item_type = p.item_type
             AND CASE WHEN COALESCE(i.color_id, 0) = 0 THEN p.color_id IN (0, -1) ELSE i.color_id = p.color_id END AND i.new_or_used = p.new_or_used
           WHERE p.sold_avg_price IS NOT NULL AND p.sold_min_price IS NOT NULL AND p.sold_max_price IS NOT NULL AND p.sold_qty_avg_price IS NOT NULL AND p.sold_quantity IS NOT NULL AND p.sold_fetched_at IS NOT NULL) AS has_sold,
          (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i
           INNER JOIN price_guide_cache p ON UPPER(i.item_no) = p.item_no AND i.item_type = p.item_type
             AND CASE WHEN COALESCE(i.color_id, 0) = 0 THEN p.color_id IN (0, -1) ELSE i.color_id = p.color_id END AND i.new_or_used = p.new_or_used
           WHERE p.sold_avg_price IS NOT NULL AND p.sold_min_price IS NOT NULL AND p.sold_max_price IS NOT NULL AND p.sold_qty_avg_price IS NOT NULL AND p.sold_quantity IS NOT NULL AND p.sold_fetched_at IS NOT NULL AND i.quantity > 0) AS has_sold_instock,
          (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i
           INNER JOIN price_guide_cache p ON UPPER(i.item_no) = p.item_no AND i.item_type = p.item_type
             AND CASE WHEN COALESCE(i.color_id, 0) = 0 THEN p.color_id IN (0, -1) ELSE i.color_id = p.color_id END AND i.new_or_used = p.new_or_used
           WHERE p.sold_avg_price IS NOT NULL AND p.sold_min_price IS NOT NULL AND p.sold_max_price IS NOT NULL AND p.sold_qty_avg_price IS NOT NULL AND p.sold_quantity IS NOT NULL AND p.sold_fetched_at IS NOT NULL AND p.sold_fetched_at < NOW() - INTERVAL '1 day' * ${priceFreshDays}) AS stale_sold,
          (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i
           INNER JOIN price_guide_cache p ON UPPER(i.item_no) = p.item_no AND i.item_type = p.item_type
             AND CASE WHEN COALESCE(i.color_id, 0) = 0 THEN p.color_id IN (0, -1) ELSE i.color_id = p.color_id END AND i.new_or_used = p.new_or_used
           WHERE p.sold_avg_price IS NOT NULL AND p.sold_min_price IS NOT NULL AND p.sold_max_price IS NOT NULL AND p.sold_qty_avg_price IS NOT NULL AND p.sold_quantity IS NOT NULL AND p.sold_fetched_at IS NOT NULL AND p.sold_fetched_at < NOW() - INTERVAL '1 day' * ${priceFreshDays} AND i.quantity > 0) AS stale_sold_instock,

          (SELECT COUNT(DISTINCT i.id)
           FROM bl_inventory i
           LEFT JOIN bl_catalog c ON i.item_no = c.item_no AND i.item_type = c.item_type AND COALESCE(i.color_id, 0) = c.color_id
           WHERE i.quantity > 0 AND c.item_no IS NULL) AS inventory_not_in_catalog
      `);
      const cc = catalogCoverageResult.rows[0] as any;
      const catalogCoverage = {
        totalLots: parseInt(cc?.total_lots || '0'),
        inStockLots: parseInt(cc?.in_stock_lots || '0'),
        detail: { has: parseInt(cc?.has_detail || '0'), hasInStock: parseInt(cc?.has_detail_instock || '0'), stale: parseInt(cc?.stale_detail || '0'), staleInStock: parseInt(cc?.stale_detail_instock || '0') },
        supply: { has: parseInt(cc?.has_supply || '0'), hasInStock: parseInt(cc?.has_supply_instock || '0'), stale: parseInt(cc?.stale_supply || '0'), staleInStock: parseInt(cc?.stale_supply_instock || '0') },
        sold: { has: parseInt(cc?.has_sold || '0'), hasInStock: parseInt(cc?.has_sold_instock || '0'), stale: parseInt(cc?.stale_sold || '0'), staleInStock: parseInt(cc?.stale_sold_instock || '0') },
        inventoryNotInCatalog: parseInt(cc?.inventory_not_in_catalog || '0'),
        apiBudget: {
          total: platformSettings?.blApiCallLimit ?? 4900,
          pomPct: platformSettings?.pomApiBudgetPct ?? 70,
          catalogDetailPct: platformSettings?.catalogDetailApiBudgetPct ?? 20,
          used24h: 0,
        },
      };

      const twentyFourHoursAgoCov = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const [apiUsageRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(blApiCalls)
        .where(gte(blApiCalls.timestamp, twentyFourHoursAgoCov));
      catalogCoverage.apiBudget.used24h = Number(apiUsageRow?.count) || 0;


      const { getActiveBuild } = await import('./services/clip-search.js');
      const clipBuild = getActiveBuild();
      const { getUniversalCatalogState } = await import('./services/universal-clip-catalog.js');
      const ucWorker = getUniversalCatalogState();

      const schedulerConfig: Record<string, any> = {
        priceomatic_cache: {
          enabled: !!platformSettings?.pomScheduleEnabled,
          schedule: platformSettings?.pomSyncTime || '14:00',
          frequency: 'Daily',
          batchSize: platformSettings?.pomScheduleBatchSize ?? 1500,
        },
        universal_catalog_refresh: {
          enabled: !!platformSettings?.universalCatalogScheduleEnabled,
          schedule: `Every ${platformSettings?.universalCatalogRefreshMonths ?? 1} month(s)`,
          frequency: `${platformSettings?.universalCatalogRefreshMonths ?? 1}mo`,
          retryDays: platformSettings?.universalCatalogRetryDays ?? 30,
          workerRunning: !!ucWorker?.running,
        },
        rebrickable_set_parts: {
          enabled: !!platformSettings?.rebrickableSetSyncEnabled,
          schedule: platformSettings?.rebrickableSetSyncTime || '04:00',
          frequency: 'Monthly',
        },
        forum_sync: {
          enabled: !!platformSettings?.forumSyncEnabled,
          schedule: `Every ${platformSettings?.forumSyncFrequency ?? 60} min`,
          frequency: `${platformSettings?.forumSyncFrequency ?? 60}min`,
        },
        clip_catalog: {
          enabled: true,
          schedule: 'Auto-resume on restart',
          frequency: 'Continuous',
          workerRunning: !!clipBuild?.running,
        },
        catalog_detail_completion: {
          enabled: !!platformSettings?.catalogDetailEnabled,
          schedule: `Every ${platformSettings?.catalogDetailFrequencyHours ?? 1}h`,
          frequency: `${platformSettings?.catalogDetailFrequencyHours ?? 1}h`,
          batchSize: platformSettings?.catalogDetailBatchSize ?? 500,
        },
        catalog_scan: {
          enabled: !!platformSettings?.catalogScanEnabled,
          schedule: `Every ${platformSettings?.catalogScanFrequencyHours ?? 2}h`,
          frequency: `${platformSettings?.catalogScanFrequencyHours ?? 2}h`,
          zeroStockSkip: platformSettings?.catalogScanZeroStockSkip !== false,
        },
      };

      res.json({
        platform: {
          totalOrganizations: orgCount.count,
          totalUsers: userCount.count,
          activeSubscriptions: activeSubCount.count,
        },
        embeddings: {
          inventoryEmbeddings: invEmbCount.count,
          inventoryTotal: invTotalCount.count,
          orderEmbeddings: ordEmbCount.count,
          orderTotal: ordTotalCount.count,
        },
        jobs: {
          active: activeJobs,
          recent: recentJobs,
        },
        syncJobs,
        clipCatalogStatus,
        schedulerConfig,
        catalogCoverage,
      });
    } catch (error) {
      console.error("Error fetching system health:", error);
      res.status(500).json({ message: "Failed to fetch system health" });
    }
  });

  // POST /api/platform-admin/scheduler/:jobId/trigger — manually run a platform job
  app.post('/api/platform-admin/scheduler/:jobId/trigger', isSuperAdmin, async (req, res) => {
    try {
      const { jobId } = req.params;
      switch (jobId) {
        case 'priceomatic_cache': {
          const { getPomIsRunning } = await import('./services/pom-scheduler.js');
          if (getPomIsRunning()) return res.status(409).json({ message: 'Price-o-Matic is already running' });
          const { syncPriceOMagicCache } = await import('./services/bricklink.js');
          const { syncLock } = await import('./services/sync-lock.js');
          if (syncLock.isBlockedFor('Price-o-Matic')) return res.status(409).json({ message: `Blocked by: ${syncLock.getBlockersFor('Price-o-Matic').join(', ')}` });
          const [settings] = await db.select().from(appSettings).where(eq(appSettings.orgId, PLATFORM_ORG_ID)).limit(1);
          const batchSize = settings?.pomScheduleBatchSize ?? 1500;
          const { setPomIsRunning } = await import('./services/pom-scheduler.js');
          setPomIsRunning(true);
          await db.insert(syncMetadata).values({ id: 'priceomatic_cache', lastSyncStatus: 'in_progress', lastSyncTime: new Date(), recordsAdded: 0, recordsUpdated: 0, orgId: PLATFORM_ORG_ID }).onConflictDoUpdate({ target: syncMetadata.id, set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date(), errorMessage: null } });
          syncPriceOMagicCache(batchSize).then(async (result: any) => {
            const isShutdown = result.stopped && (result.stopReason?.includes('shutdown') || result.stopReason?.includes('interrupted'));
            const finalStatus = result.stopped ? (isShutdown ? 'error' : 'partial') : 'success';
            await db.insert(syncMetadata).values({ id: 'priceomatic_cache', lastSyncStatus: finalStatus, lastSyncTime: new Date(), recordsAdded: 0, recordsUpdated: result.itemsUpdated, errorMessage: result.stopReason || null, orgId: PLATFORM_ORG_ID }).onConflictDoUpdate({ target: syncMetadata.id, set: { lastSyncStatus: finalStatus, updatedAt: new Date(), recordsUpdated: result.itemsUpdated, errorMessage: result.stopReason || null } });
            setPomIsRunning(false);
          }).catch(async (err: any) => {
            await db.insert(syncMetadata).values({ id: 'priceomatic_cache', lastSyncStatus: 'error', lastSyncTime: new Date(), recordsAdded: 0, recordsUpdated: 0, errorMessage: err.message, orgId: PLATFORM_ORG_ID }).onConflictDoUpdate({ target: syncMetadata.id, set: { lastSyncStatus: 'error', updatedAt: new Date(), errorMessage: err.message } });
            setPomIsRunning(false);
          });
          return res.json({ message: 'Price-o-Matic sync triggered' });
        }
        case 'universal_catalog_refresh': {
          const { isUniversalImporting, getUniversalCatalogState, importFromRebrickable, retryStaleItems, startUniversalWorker } = await import('./services/universal-clip-catalog.js');
          if (isUniversalImporting() || getUniversalCatalogState()?.running) return res.status(409).json({ message: 'Universal Catalog is already running' });
          await db.insert(syncMetadata).values({ id: 'universal_catalog_refresh', orgId: PLATFORM_ORG_ID, lastSyncStatus: 'in_progress', lastSyncTime: new Date(), recordsAdded: 0, recordsUpdated: 0 }).onConflictDoUpdate({ target: syncMetadata.id, set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date(), errorMessage: null } });
          (async () => {
            try {
              const { imported } = await importFromRebrickable();
              const [settings] = await db.select().from(appSettings).where(eq(appSettings.orgId, PLATFORM_ORG_ID)).limit(1);
              const reset = await retryStaleItems(settings?.universalCatalogRetryDays ?? 30);
              await startUniversalWorker();
              await db.insert(syncMetadata).values({ id: 'universal_catalog_refresh', orgId: PLATFORM_ORG_ID, lastSyncStatus: 'success', lastSyncTime: new Date(), recordsAdded: imported, recordsUpdated: reset, errorMessage: null }).onConflictDoUpdate({ target: syncMetadata.id, set: { lastSyncStatus: 'success', lastSyncTime: new Date(), recordsAdded: imported, recordsUpdated: reset, errorMessage: null, updatedAt: new Date() } });
            } catch (err: any) {
              await db.insert(syncMetadata).values({ id: 'universal_catalog_refresh', orgId: PLATFORM_ORG_ID, lastSyncStatus: 'error', lastSyncTime: new Date(), recordsAdded: 0, recordsUpdated: 0, errorMessage: err.message }).onConflictDoUpdate({ target: syncMetadata.id, set: { lastSyncStatus: 'error', updatedAt: new Date(), errorMessage: err.message } });
            }
          })();
          return res.json({ message: 'Universal Catalog refresh triggered' });
        }
        case 'rebrickable_set_parts': {
          const { syncRebrickableSetParts, getRebrickableSyncIsRunning } = await import('./services/rebrickable.js');
          if (getRebrickableSyncIsRunning()) return res.status(409).json({ message: 'Rebrickable sync is already running' });
          syncRebrickableSetParts(false).catch((err: any) => { console.error('[Manual Rebrickable] Failed:', err.message); });
          return res.json({ message: 'Rebrickable set-parts sync triggered' });
        }
        case 'forum_sync': {
          const { triggerManualForumSync } = await import('./services/bl-forum-scheduler.js');
          const result = await triggerManualForumSync();
          if (!result.success) return res.status(409).json({ message: result.error || 'Forum sync failed' });
          return res.json({ message: 'Forum sync triggered' });
        }
        case 'market_news_sync': {
          const { triggerManualMarketNewsSync } = await import('./services/market-news-scheduler.js');
          const mnResult = await triggerManualMarketNewsSync();
          if (!mnResult.success) return res.status(409).json({ message: mnResult.error || 'Market news sync failed' });
          return res.json({ message: 'Market news sync triggered' });
        }
        case 'business_intel_sync': {
          const { triggerManualBusinessIntelSync } = await import('./services/business-intel-scheduler.js');
          const biResult = await triggerManualBusinessIntelSync();
          if (!biResult.success) return res.status(409).json({ message: biResult.error || 'Business intel sync failed' });
          return res.json({ message: 'Business intel sync triggered' });
        }
        case 'clip_catalog': {
          const { getActiveBuild, buildCatalogEmbeddings } = await import('./services/clip-search.js');
          if (getActiveBuild()?.running) return res.status(409).json({ message: 'CLIP Catalog build is already running' });
          const rows = await db.select({ itemNo: blInventory.itemNo, colorId: blInventory.colorId }).from(blInventory);
          const items = rows.map((r: any) => ({ itemNo: r.itemNo, colorId: Number(r.colorId), itemType: 'PART' }));
          buildCatalogEmbeddings(items, () => {}).catch((e: any) => { console.error('[Manual CLIP Build] Failed:', e.message); });
          return res.json({ message: 'CLIP Catalog build triggered' });
        }
        case 'catalog_scan': {
          const { getCatalogScanIsRunning, runCatalogScan } = await import('./services/catalog-scan-scheduler.js');
          if (getCatalogScanIsRunning()) return res.status(409).json({ message: 'Catalog Scan is already running' });
          runCatalogScan().catch((err: any) => { console.error('[Manual CatalogScan] Failed:', err.message); });
          return res.json({ message: 'Inventory Catalog Scan triggered' });
        }
        case 'catalog_detail_completion': {
          const { getCatalogDetailIsRunning, runCatalogDetailSync } = await import('./services/catalog-detail-scheduler.js');
          if (getCatalogDetailIsRunning()) return res.status(409).json({ message: 'Catalog Detail is already running' });
          await db.insert(syncMetadata).values({ id: 'catalog_detail_completion', lastSyncStatus: 'in_progress', lastSyncTime: new Date(), recordsAdded: 0, recordsUpdated: 0, orgId: PLATFORM_ORG_ID }).onConflictDoUpdate({ target: syncMetadata.id, set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date(), errorMessage: null } });
          runCatalogDetailSync().then(async (result) => {
            const finalStatus = result.stopped ? 'partial' : 'success';
            await db.insert(syncMetadata).values({ id: 'catalog_detail_completion', lastSyncStatus: finalStatus, lastSyncTime: new Date(), recordsAdded: result.itemsEnriched, recordsUpdated: result.categoriesAdded + result.categoriesUpdated + result.colorsAdded + result.colorsUpdated, errorMessage: result.stopReason || null, orgId: PLATFORM_ORG_ID }).onConflictDoUpdate({ target: syncMetadata.id, set: { lastSyncStatus: finalStatus, updatedAt: new Date(), recordsAdded: result.itemsEnriched, recordsUpdated: result.categoriesAdded + result.categoriesUpdated + result.colorsAdded + result.colorsUpdated, errorMessage: result.stopReason || null } });
          }).catch(async (err: any) => {
            await db.insert(syncMetadata).values({ id: 'catalog_detail_completion', lastSyncStatus: 'error', lastSyncTime: new Date(), recordsAdded: 0, recordsUpdated: 0, errorMessage: err.message, orgId: PLATFORM_ORG_ID }).onConflictDoUpdate({ target: syncMetadata.id, set: { lastSyncStatus: 'error', updatedAt: new Date(), errorMessage: err.message } });
          });
          return res.json({ message: 'Catalog Detail Completion triggered' });
        }
        default:
          return res.status(400).json({ message: `Unknown job: ${jobId}` });
      }
    } catch (error: any) {
      console.error('Error triggering scheduler:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/platform-admin/scheduler/:jobId/toggle — pause/resume a platform job
  app.post('/api/platform-admin/scheduler/:jobId/toggle', isSuperAdmin, async (req, res) => {
    try {
      const { jobId } = req.params;
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') return res.status(400).json({ message: 'enabled (boolean) is required' });

      const settingMap: Record<string, string> = {
        priceomatic_cache: 'pomScheduleEnabled',
        catalog_detail_completion: 'catalogDetailEnabled',
        catalog_scan: 'catalogScanEnabled',
        universal_catalog_refresh: 'universalCatalogScheduleEnabled',
        rebrickable_set_parts: 'rebrickableSetSyncEnabled',
        forum_sync: 'forumSyncEnabled',
        business_intel_sync: 'businessIntelEnabled',
      };

      const column = settingMap[jobId];
      if (!column) {
        if (jobId === 'clip_catalog') {
          if (!enabled) {
            const { stopUniversalWorker } = await import('./services/universal-clip-catalog.js');
            stopUniversalWorker();
          }
          return res.json({ message: enabled ? 'CLIP Catalog will auto-resume' : 'CLIP worker stopped' });
        }
        return res.status(400).json({ message: `Unknown job: ${jobId}` });
      }

      await db.update(appSettings).set({ [column]: enabled, updatedAt: new Date() } as any).where(eq(appSettings.orgId, PLATFORM_ORG_ID));

      if (!enabled) {
        if (jobId === 'universal_catalog_refresh') {
          const { stopUniversalWorker } = await import('./services/universal-clip-catalog.js');
          stopUniversalWorker();
        }
      }

      res.json({ message: `${jobId} ${enabled ? 'enabled' : 'paused'}` });
    } catch (error: any) {
      console.error('Error toggling scheduler:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/business-intel — returns insights for requesting org
  app.get('/api/business-intel', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = req.user?.orgId;
      if (!orgId) return res.status(400).json({ message: 'No orgId' });
      const insights = await db
        .select()
        .from(businessInsights)
        .where(and(
          eq(businessInsights.orgId, orgId),
          eq(businessInsights.dismissed, false),
          or(
            isNull(businessInsights.expiresAt),
            sql`${businessInsights.expiresAt} > NOW()`,
          ),
        ))
        .orderBy(desc(businessInsights.createdAt))
        .limit(50);
      res.json(insights);
    } catch (error: any) {
      console.error('Error fetching business insights:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/business-intel/:id/dismiss — dismiss an insight
  app.post('/api/business-intel/:id/dismiss', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = req.user?.orgId;
      if (!orgId) return res.status(400).json({ message: 'No orgId' });
      const { id } = req.params;
      await db.update(businessInsights)
        .set({ dismissed: true, updatedAt: new Date() })
        .where(and(
          eq(businessInsights.id, id),
          eq(businessInsights.orgId, orgId),
        ));
      res.json({ message: 'Insight dismissed' });
    } catch (error: any) {
      console.error('Error dismissing insight:', error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/platform-admin/bl-api-usage — platform-wide BrickLink API usage (all orgs combined)
  app.get('/api/platform-admin/bl-api-usage', isSuperAdmin, async (_req, res) => {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const [totalRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(blApiCalls)
        .where(gte(blApiCalls.timestamp, twentyFourHoursAgo));
      const callsLast24h = Number(totalRow?.count) || 0;

      const hourlyRows = await db
        .select({
          hourEpoch: sql<string>`EXTRACT(EPOCH FROM date_trunc('hour', ${blApiCalls.timestamp}))::bigint`,
          calls: sql<number>`count(*)`,
        })
        .from(blApiCalls)
        .where(gte(blApiCalls.timestamp, twentyFourHoursAgo))
        .groupBy(sql`date_trunc('hour', ${blApiCalls.timestamp})`)
        .orderBy(sql`date_trunc('hour', ${blApiCalls.timestamp})`);

      const hourlyMap = new Map(hourlyRows.map(r => [Number(r.hourEpoch) * 1000, Number(r.calls)]));
      const hourlyBuckets: { hourStart: string; rollsOffAt: string; calls: number }[] = [];
      for (let i = 23; i >= 0; i--) {
        const slotStartMs = Math.floor(Date.now() / 3600000) * 3600000 - i * 3600000;
        hourlyBuckets.push({
          hourStart: new Date(slotStartMs).toISOString(),
          rollsOffAt: new Date(slotStartMs + 24 * 60 * 60 * 1000).toISOString(),
          calls: hourlyMap.get(slotStartMs) ?? 0,
        });
      }

      const perOrgRows = await db
        .select({
          orgId: blApiCalls.orgId,
          calls: sql<number>`count(*)`,
        })
        .from(blApiCalls)
        .where(gte(blApiCalls.timestamp, twentyFourHoursAgo))
        .groupBy(blApiCalls.orgId)
        .orderBy(sql`count(*) DESC`)
        .limit(20);

      const [totalAllTime] = await db
        .select({ count: sql<number>`count(*)` })
        .from(blApiCalls);

      const [successRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(blApiCalls)
        .where(and(gte(blApiCalls.timestamp, twentyFourHoursAgo), eq(blApiCalls.success, true)));
      const [failRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(blApiCalls)
        .where(and(gte(blApiCalls.timestamp, twentyFourHoursAgo), eq(blApiCalls.success, false)));

      const recentEndpoints = await db
        .select({
          endpoint: blApiCalls.endpoint,
          calls: sql<number>`count(*)`,
        })
        .from(blApiCalls)
        .where(gte(blApiCalls.timestamp, twentyFourHoursAgo))
        .groupBy(blApiCalls.endpoint)
        .orderBy(sql`count(*) DESC`)
        .limit(10);

      res.json({
        callsLast24h,
        totalAllTime: Number(totalAllTime?.count) || 0,
        successLast24h: Number(successRow?.count) || 0,
        failLast24h: Number(failRow?.count) || 0,
        hourlyBuckets,
        perOrg: perOrgRows.map(r => ({ orgId: r.orgId, calls: Number(r.calls) })),
        topEndpoints: recentEndpoints.map(r => ({ endpoint: r.endpoint, calls: Number(r.calls) })),
        ceiling: await (async () => {
          try {
            const [ps] = await db
              .select({ blApiCallLimit: appSettings.blApiCallLimit })
              .from(appSettings)
              .where(eq(appSettings.id, PLATFORM_ORG_ID))
              .limit(1);
            return ps?.blApiCallLimit ?? 5000;
          } catch { return 5000; }
        })(),
      });
    } catch (error) {
      console.error("Error fetching platform BL API usage:", error);
      res.status(500).json({ message: "Failed to fetch BL API usage" });
    }
  });

  // GET /api/platform-admin/customer-health/bl-api-breakdown — per-org BL API usage grouped by endpoint category
  app.get('/api/platform-admin/customer-health/bl-api-breakdown', isSuperAdmin, async (_req, res) => {
    try {
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const rows = await db
        .select({
          orgId: blApiCalls.orgId,
          endpoint: blApiCalls.endpoint,
          success: blApiCalls.success,
          calls: sql<number>`count(*)`,
        })
        .from(blApiCalls)
        .where(gte(blApiCalls.timestamp, twentyFourHoursAgo))
        .groupBy(blApiCalls.orgId, blApiCalls.endpoint, blApiCalls.success);

      const orgMap = new Map<string, {
        orgId: string; orgName: string; total: number; inventory: number; orders: number;
        catalog: number; priceGuide: number; other: number;
        success: number; failed: number;
      }>();

      for (const row of rows) {
        const oid = row.orgId || 'unknown';
        if (oid === 'platform') continue;
        if (!orgMap.has(oid)) {
          orgMap.set(oid, { orgId: oid, orgName: '', total: 0, inventory: 0, orders: 0, catalog: 0, priceGuide: 0, other: 0, success: 0, failed: 0 });
        }
        const entry = orgMap.get(oid)!;
        const count = Number(row.calls);
        entry.total += count;

        if (row.success) entry.success += count;
        else entry.failed += count;

        const ep = (row.endpoint || '').toLowerCase();
        if (ep.includes('/inventories') || ep.includes('/inventory')) entry.inventory += count;
        else if (ep.includes('/orders')) entry.orders += count;
        else if (ep.includes('/price_guide') || ep.includes('/price')) entry.priceGuide += count;
        else if (ep.includes('/items/') || ep.includes('/item_mapping')) entry.catalog += count;
        else if (ep.includes('/categories') || ep.includes('/colors')) entry.catalog += count;
        else entry.other += count;
      }

      const orgIds = Array.from(orgMap.keys());
      if (orgIds.length > 0) {
        const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, orgIds));
        for (const org of orgs) {
          const entry = orgMap.get(org.id);
          if (entry) entry.orgName = org.name;
        }
      }

      const result = Array.from(orgMap.values()).sort((a, b) => b.total - a.total);
      res.json(result);
    } catch (error) {
      console.error("Error fetching customer BL API breakdown:", error);
      res.status(500).json({ message: "Failed to fetch BL API breakdown" });
    }
  });

  // GET /api/platform-admin/server-logs — recent WARN/ERROR log entries from in-memory buffer
  app.get('/api/platform-admin/server-logs', isSuperAdmin, (_req, res) => {
    res.json(getRecentLogs(40));
  });

  // DELETE /api/platform-admin/server-logs — clear all buffered log entries
  app.delete('/api/platform-admin/server-logs', isSuperAdmin, (_req, res) => {
    clearLogs();
    res.json({ ok: true });
  });

  // GET /api/platform-admin/db-tables — table health from pg_stat_user_tables
  app.get('/api/platform-admin/db-tables', isSuperAdmin, async (_req, res) => {
    const TABLE_DESCRIPTIONS: Record<string, string> = {
      anomaly_events:                'Detected data anomalies and automated system alerts',
      app_feedback:                  'User-submitted feedback, bug reports, and feature requests',
      app_settings:                  'Per-organization configuration settings (83 columns covering all feature flags and preferences)',
      bl_api_calls:                  'BrickLink API call log used for rate limiting and usage tracking per org',
      bl_catalog:                    'Shared cross-org part/color/category reference — the catalog layer split from inventory',
      bl_catalog_clip_embeddings:    '512-dim CLIP visual fingerprints keyed to bl_catalog. Powers BrickSpotter visual recognition (source: catalog, scan, universal)',
      bl_categories:                 'BrickLink part category names and hierarchy (e.g. Technic, Minifig, Plate)',
      bl_colors:                     'BrickLink color definitions including name, hex values, and color type',
      bl_forum_embeddings:           'Text embeddings of BrickLink forum posts for AI-powered knowledge search',
      bl_forum_posts:                'Scraped BrickLink forum posts used as a platform knowledge base for the AI assistant',
      bl_inventory:                  'Live per-org BrickLink inventory — the core stock table (org-scoped, synced from BrickLink)',
      brickanalyzer_scans:           'BrickSpotter scan history including detected parts, confidence scores, and crop data',
      conversations:                 'AI chat assistant conversation sessions and message history per org',
      differential_batches:          'Incremental backup batch tracking used by the data restore system',
      embedding_jobs:                'Async background job queue for text embedding generation (inventory, orders, sets)',
      eod_forms:                     'End-of-day summary forms submitted by staff',
      inventory_embeddings:          'Text embeddings of inventory items for semantic stock search (org-scoped)',
      inventory_locations:           'Physical warehouse bin assignments mapping inventory items to wh_bins',
      order_adjustments:             'Manual price and quantity adjustments applied to orders',
      order_detail_embeddings:       'Text embeddings of individual order line items for granular AI search',
      order_details:                 'Line items for each BrickLink order (part, color, qty, price)',
      order_embeddings:              'Text embeddings of full orders for AI assistant and semantic order lookup (org-scoped)',
      order_split_items:             'Parts assigned to split sub-orders during the picking/fulfillment workflow',
      order_splits:                  'Split sub-orders created from a parent order for partial shipment',
      orders:                        'BrickLink orders synced from the marketplace (org-scoped)',
      org_integrations:              'OAuth tokens and API credentials stored per organization (BrickLink, BrickOwl, etc.)',
      organizations:                 'Tenant organizations on the platform with plan, subscription, and Stripe metadata',
      part_id_mappings:              'Cross-reference table mapping BrickLink part numbers to Rebrickable part numbers',
      part_price_history:            'Historical BrickLink price guide snapshots per part/color for trend analysis',
      picklist_items:                'Active pick queue — items assigned to pickers for order fulfillment',
      plan_configs:                  'Subscription plan tier definitions including pricing, feature flags, and usage limits',
      price_guide_cache:             'Cached BrickLink price guide data per part/color to reduce API calls',
      restore_jobs:                  'Database restore job tracking — status, progress, and error logs for backup restoration',
      sessions:                      'User authentication sessions (Replit OIDC)',
      set_part_embeddings:           'Text embeddings of set part lists used for set-similarity search',
      set_part_relationships:        'Rebrickable sets-to-parts mapping covering all known LEGO sets (~35k sets)',
      shipments:                     'Shipment records linked to orders including tracking numbers and carrier info',
      sync_issues:                   'Detected issues and warnings logged during BrickLink sync operations',
      sync_metadata:                 'Per-org BrickLink sync state — last sync time, cursor, and status',
      universal_catalog_queue:       'Rebrickable parts queue for universal CLIP embedding (source=universal in bl_catalog_clip_embeddings)',
      users:                         'Platform user accounts authenticated via Replit OIDC',
      wh_aisles:                     'Warehouse aisle definitions (top level of the aisle → shelf → bin hierarchy)',
      wh_bins:                       'Warehouse bin (slot) definitions — the leaf node where parts are physically stored',
      wh_shelves:                    'Warehouse shelf definitions within aisles',
    };

    try {
      const rows = await db.execute<{
        table_name: string;
        total_size: string;
        total_size_bytes: string;
        live_rows: string;
        dead_rows: string;
        last_vacuum: string | null;
        last_autovacuum: string | null;
        last_analyze: string | null;
        last_autoanalyze: string | null;
        seq_scans: string;
        idx_scans: string;
        mod_since_analyze: string;
      }>(sql`
        SELECT
          t.table_name,
          pg_size_pretty(pg_total_relation_size(quote_ident(t.table_name))) AS total_size,
          pg_total_relation_size(quote_ident(t.table_name))::text AS total_size_bytes,
          COALESCE(s.n_live_tup, 0)::text AS live_rows,
          COALESCE(s.n_dead_tup, 0)::text AS dead_rows,
          s.last_vacuum::text,
          s.last_autovacuum::text,
          s.last_analyze::text,
          s.last_autoanalyze::text,
          COALESCE(s.seq_scan, 0)::text AS seq_scans,
          COALESCE(s.idx_scan, 0)::text AS idx_scans,
          COALESCE(s.n_mod_since_analyze, 0)::text AS mod_since_analyze
        FROM information_schema.tables t
        LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name
        WHERE t.table_schema = 'public'
          AND t.table_type = 'BASE TABLE'
        ORDER BY pg_total_relation_size(quote_ident(t.table_name)) DESC
      `);

      const tables = (rows.rows ?? []).map(r => ({
        tableName: r.table_name,
        totalSize: r.total_size,
        totalSizeBytes: Number(r.total_size_bytes),
        liveRows: Number(r.live_rows),
        deadRows: Number(r.dead_rows),
        lastVacuum: r.last_vacuum ?? r.last_autovacuum ?? null,
        lastAnalyze: r.last_analyze ?? r.last_autoanalyze ?? null,
        seqScans: Number(r.seq_scans),
        idxScans: Number(r.idx_scans),
        modSinceAnalyze: Number(r.mod_since_analyze),
        description: TABLE_DESCRIPTIONS[r.table_name] ?? null,
      }));

      res.json(tables);
    } catch (error) {
      console.error('Error fetching db table stats:', error);
      res.status(500).json({ message: 'Failed to fetch table stats' });
    }
  });

  // POST /api/platform-admin/db-vacuum — run VACUUM ANALYZE on specific tables
  app.post('/api/platform-admin/db-vacuum', isSuperAdmin, async (req, res) => {
    const { tables } = req.body as { tables?: string[] };
    if (!tables || !Array.isArray(tables) || tables.length === 0) {
      return res.status(400).json({ message: 'tables array is required' });
    }
    const validName = /^[a-z_][a-z0-9_]*$/;
    const invalid = tables.filter(t => !validName.test(t));
    if (invalid.length) return res.status(400).json({ message: `Invalid table names: ${invalid.join(', ')}` });

    const results: { table: string; ok: boolean; error?: string }[] = [];
    for (const table of tables) {
      const client = await pool.connect();
      try {
        await client.query(`VACUUM ANALYZE ${table}`);
        results.push({ table, ok: true });
      } catch (err: any) {
        results.push({ table, ok: false, error: err.message?.slice(0, 200) });
      } finally {
        client.release();
      }
    }
    res.json({ results });
  });

  // POST /api/platform-admin/db-cleanup — purge stale rows from known cleanup targets
  app.post('/api/platform-admin/db-cleanup', isSuperAdmin, async (req, res) => {
    const { target, daysOld } = req.body as { target: string; daysOld?: number };
    const VALID_TARGETS = ['bl_api_calls', 'embedding_jobs', 'restore_jobs', 'sync_issues', 'price_guide_cache', 'sessions', 'brickanalyzer_scans', 'conversations', 'universal_catalog_queue'];
    if (!target || !VALID_TARGETS.includes(target)) {
      return res.status(400).json({ message: `Invalid target. Allowed: ${VALID_TARGETS.join(', ')}` });
    }
    const age = Math.max(0, Math.min(3650, Math.floor(Number(daysOld) || 30)));
    const cutoff = sql`NOW() - (${age} * INTERVAL '1 day')`;

    const results: { target: string; deleted: number; error?: string }[] = [];

    try {
      switch (target) {
        case 'bl_api_calls': {
          const r = await db.execute(sql`DELETE FROM bl_api_calls WHERE timestamp < ${cutoff}`);
          results.push({ target, deleted: r.rowCount ?? 0 });
          break;
        }
        case 'embedding_jobs': {
          const r = await db.execute(sql`DELETE FROM embedding_jobs WHERE status IN ('completed', 'failed') AND created_at < ${cutoff}`);
          results.push({ target, deleted: r.rowCount ?? 0 });
          break;
        }
        case 'restore_jobs': {
          const r = await db.execute(sql`DELETE FROM restore_jobs WHERE status IN ('completed', 'failed') AND created_at < ${cutoff}`);
          results.push({ target, deleted: r.rowCount ?? 0 });
          break;
        }
        case 'sync_issues': {
          const r = await db.execute(sql`DELETE FROM sync_issues WHERE created_at < ${cutoff}`);
          results.push({ target, deleted: r.rowCount ?? 0 });
          break;
        }
        case 'price_guide_cache': {
          const r = await db.execute(sql`DELETE FROM price_guide_cache WHERE fetched_at < ${cutoff}`);
          results.push({ target, deleted: r.rowCount ?? 0 });
          break;
        }
        case 'sessions': {
          const r = await db.execute(sql`DELETE FROM sessions WHERE expire < NOW()`);
          results.push({ target, deleted: r.rowCount ?? 0 });
          break;
        }
        case 'brickanalyzer_scans': {
          const r = await db.execute(sql`DELETE FROM brickanalyzer_scans WHERE created_at < ${cutoff}`);
          results.push({ target, deleted: r.rowCount ?? 0 });
          break;
        }
        case 'conversations': {
          const r = await db.execute(sql`DELETE FROM conversations WHERE updated_at < ${cutoff}`);
          results.push({ target, deleted: r.rowCount ?? 0 });
          break;
        }
        case 'universal_catalog_queue': {
          const r = await db.execute(sql`DELETE FROM universal_catalog_queue WHERE status IN ('embedded', 'no_image', 'failed') AND attempted_at < ${cutoff}`);
          results.push({ target, deleted: r.rowCount ?? 0 });
          break;
        }
        default:
          return res.status(400).json({ message: `Unknown cleanup target: ${target}` });
      }
      res.json({ results });
    } catch (error: any) {
      console.error(`db-cleanup error for ${target}:`, error);
      res.status(500).json({ message: error.message?.slice(0, 300) });
    }
  });

  // POST /api/platform-admin/migrate-catalog — one-time migration to populate bl_catalog
  // Idempotent: safe to run multiple times. Pulls distinct catalog data from bl_inventory
  // and merges with any richer data already in price_guide_cache.
  app.post('/api/platform-admin/migrate-catalog', isSuperAdmin, async (_req, res) => {
    try {
      // Step 1: upsert distinct rows from bl_inventory into bl_catalog
      await db.execute(sql`
        INSERT INTO bl_catalog (item_no, item_type, color_id, item_name, color_name, category_id,
          bl_catalog_weight, bl_dimension_x, bl_dimension_y, bl_dimension_z, image_url, thumbnail_url, updated_at)
        SELECT
          item_no,
          item_type,
          COALESCE(color_id, 0) AS color_id,
          MAX(item_name)           AS item_name,
          MAX(color_name)          AS color_name,
          MAX(category_id)         AS category_id,
          MAX(bl_catalog_weight)   AS bl_catalog_weight,
          MAX(bl_dimension_x)      AS bl_dimension_x,
          MAX(bl_dimension_y)      AS bl_dimension_y,
          MAX(bl_dimension_z)      AS bl_dimension_z,
          MAX(image_url)           AS image_url,
          MAX(thumbnail_url)       AS thumbnail_url,
          NOW()
        FROM bl_inventory
        WHERE item_no IS NOT NULL AND item_type IS NOT NULL
        GROUP BY item_no, item_type, COALESCE(color_id, 0)
        ON CONFLICT (item_no, item_type, color_id) DO UPDATE SET
          item_name         = COALESCE(EXCLUDED.item_name, bl_catalog.item_name),
          color_name        = COALESCE(EXCLUDED.color_name, bl_catalog.color_name),
          category_id       = COALESCE(EXCLUDED.category_id, bl_catalog.category_id),
          bl_catalog_weight = COALESCE(EXCLUDED.bl_catalog_weight, bl_catalog.bl_catalog_weight),
          bl_dimension_x    = COALESCE(EXCLUDED.bl_dimension_x, bl_catalog.bl_dimension_x),
          bl_dimension_y    = COALESCE(EXCLUDED.bl_dimension_y, bl_catalog.bl_dimension_y),
          bl_dimension_z    = COALESCE(EXCLUDED.bl_dimension_z, bl_catalog.bl_dimension_z),
          image_url         = COALESCE(EXCLUDED.image_url, bl_catalog.image_url),
          thumbnail_url     = COALESCE(EXCLUDED.thumbnail_url, bl_catalog.thumbnail_url),
          updated_at        = NOW()
      `);

      // Step 2: merge richer data from price_guide_cache (has year_released, sometimes better weight/dims)
      await db.execute(sql`
        UPDATE bl_catalog c
        SET
          year_released  = COALESCE(c.year_released, pgc.year_released),
          bl_catalog_weight = COALESCE(c.bl_catalog_weight,
            CASE WHEN pgc.weight IS NOT NULL AND pgc.weight::numeric > 0 THEN pgc.weight ELSE NULL END),
          bl_dimension_x = COALESCE(c.bl_dimension_x, pgc.dimension_x),
          bl_dimension_y = COALESCE(c.bl_dimension_y, pgc.dimension_y),
          bl_dimension_z = COALESCE(c.bl_dimension_z, pgc.dimension_z),
          image_url      = COALESCE(c.image_url, pgc.image_url),
          thumbnail_url  = COALESCE(c.thumbnail_url, pgc.thumbnail_url),
          updated_at     = NOW()
        FROM price_guide_cache pgc
        WHERE c.item_no = pgc.item_no
          AND c.item_type = pgc.item_type
          AND c.color_id = CASE WHEN pgc.color_id = -1 THEN 0 ELSE pgc.color_id END
      `);

      // Count results
      const [{ count: catalogCount }] = await db.execute(sql`SELECT COUNT(*) AS count FROM bl_catalog`) as any;
      const [{ count: withImages }] = await db.execute(sql`SELECT COUNT(*) AS count FROM bl_catalog WHERE image_url IS NOT NULL AND image_url != ''`) as any;

      res.json({
        success: true,
        catalogRows: parseInt(catalogCount),
        rowsWithImages: parseInt(withImages),
      });
    } catch (error: any) {
      console.error("Catalog migration error:", error);
      res.status(500).json({ message: error.message || "Migration failed" });
    }
  });

  // ─── Support Ticket routes ─────────────────────────────────────────────────

  // POST /api/support/escalate — org user escalates chat to live support
  app.post('/api/support/escalate', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
      if (!org) return res.status(404).json({ message: "Organization not found" });
      const overrides = (org.featureOverrides ?? {}) as Record<string, boolean>;
      if (overrides.elfieLiveSupport === false) {
        return res.status(403).json({ message: "Live support is not available on your current plan" });
      }
      const { sessionId, subject } = req.body;
      if (!sessionId) return res.status(400).json({ message: "sessionId required" });
      const existing = await db.select().from(supportTickets)
        .where(and(eq(supportTickets.orgId, orgId), eq(supportTickets.sessionId, sessionId), ne(supportTickets.status, 'resolved')))
        .limit(1);
      if (existing.length > 0) return res.json(existing[0]);
      const [ticket] = await db.insert(supportTickets).values({
        orgId,
        sessionId,
        subject: subject || 'Live support request',
        status: 'escalated',
      }).returning();
      await db.insert(conversations).values({
        sessionId,
        role: 'system',
        content: 'This conversation has been escalated to live support. A team member will join shortly.',
        orgId,
      });
      res.json(ticket);
    } catch (error: any) {
      console.error("Support escalate error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/support/session — load chat history + active ticket for a session on mount
  app.get('/api/support/session', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const sessionId = req.query.sessionId as string;
      if (!sessionId) return res.status(400).json({ message: "sessionId required" });
      const [ticket] = await db.select().from(supportTickets)
        .where(and(eq(supportTickets.orgId, orgId), eq(supportTickets.sessionId, sessionId), ne(supportTickets.status, 'resolved')))
        .orderBy(desc(supportTickets.createdAt))
        .limit(1);
      const selectFields = {
        id: conversations.id,
        role: conversations.role,
        content: conversations.content,
        context: conversations.context,
        createdAt: conversations.createdAt,
      };
      let msgs: any[];
      if (ticket) {
        const recentBefore = await db.select(selectFields).from(conversations)
          .where(and(
            eq(conversations.orgId, orgId),
            eq(conversations.sessionId, sessionId),
            lte(conversations.createdAt, ticket.createdAt),
          ))
          .orderBy(desc(conversations.createdAt))
          .limit(20);
        const afterEscalation = await db.select(selectFields).from(conversations)
          .where(and(
            eq(conversations.orgId, orgId),
            eq(conversations.sessionId, sessionId),
            gt(conversations.createdAt, ticket.createdAt),
          ))
          .orderBy(asc(conversations.createdAt));
        msgs = [...recentBefore.reverse(), ...afterEscalation];
      } else {
        msgs = await db.select(selectFields).from(conversations)
          .where(and(eq(conversations.orgId, orgId), eq(conversations.sessionId, sessionId)))
          .orderBy(desc(conversations.createdAt))
          .limit(30);
        msgs = msgs.reverse();
      }
      const unseenSupport = ticket ? await db.select({ count: count() }).from(conversations)
        .where(and(
          eq(conversations.orgId, orgId),
          eq(conversations.sessionId, sessionId),
          eq(conversations.role, 'support'),
        )) : [{ count: 0 }];
      res.json({
        messages: msgs,
        ticket: ticket || null,
        hasUnseenSupport: (unseenSupport[0]?.count || 0) > 0,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Conversation Threads — ChatGPT-style conversation management
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/conversations/threads — list conversation threads for current org
  app.get('/api/conversations/threads', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const threads = await db.select().from(conversationThreads)
        .where(eq(conversationThreads.orgId, orgId))
        .orderBy(desc(conversationThreads.updatedAt))
        .limit(50);
      res.json(threads);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/conversations/threads — create or ensure a thread exists for a sessionId
  app.post('/api/conversations/threads', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { sessionId } = req.body;
      if (!sessionId) return res.status(400).json({ message: "sessionId required" });
      const [existing] = await db.select().from(conversationThreads)
        .where(and(eq(conversationThreads.sessionId, sessionId), eq(conversationThreads.orgId, orgId)))
        .limit(1);
      if (existing) return res.json(existing);
      const [thread] = await db.insert(conversationThreads).values({
        sessionId,
        orgId,
        title: 'New conversation',
      }).returning();
      res.json(thread);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/conversations/threads/:sessionId/title — auto-generate or manually set title
  app.patch('/api/conversations/threads/:sessionId/title', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { sessionId } = req.params;
      const { title } = req.body;
      if (!title) return res.status(400).json({ message: "title required" });
      await db.update(conversationThreads)
        .set({ title, updatedAt: new Date() })
        .where(and(eq(conversationThreads.sessionId, sessionId), eq(conversationThreads.orgId, orgId)));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // DELETE /api/conversations/threads/:sessionId — delete a thread and its messages
  app.delete('/api/conversations/threads/:sessionId', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { sessionId } = req.params;
      await db.delete(conversations)
        .where(and(eq(conversations.sessionId, sessionId), eq(conversations.orgId, orgId)));
      await db.delete(conversationThreads)
        .where(and(eq(conversationThreads.sessionId, sessionId), eq(conversationThreads.orgId, orgId)));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/conversations/threads/:sessionId/generate-title — AI-generate title from first user message
  app.post('/api/conversations/threads/:sessionId/generate-title', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { sessionId } = req.params;
      const firstMessages = await db.select({ content: conversations.content, role: conversations.role })
        .from(conversations)
        .where(and(eq(conversations.sessionId, sessionId), eq(conversations.orgId, orgId), eq(conversations.role, 'user')))
        .orderBy(asc(conversations.createdAt))
        .limit(2);
      if (firstMessages.length === 0) return res.json({ title: 'New conversation' });
      const snippet = firstMessages.map(m => m.content).join(' ').slice(0, 200);
      try {
        const openai = (await import('openai')).default;
        const platformSettings = await db.select().from(appSettings).where(eq(appSettings.orgId, PLATFORM_ORG_ID)).limit(1);
        const apiKey = platformSettings[0]?.openaiApiKey;
        if (apiKey) {
          const client = new openai({ apiKey });
          const completion = await client.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: 'Generate a very short title (3-6 words) for this conversation. No quotes. No punctuation at end.' },
              { role: 'user', content: snippet },
            ],
            max_tokens: 20,
            temperature: 0.5,
          });
          const title = completion.choices[0]?.message?.content?.trim() || snippet.slice(0, 40);
          await db.update(conversationThreads)
            .set({ title, updatedAt: new Date() })
            .where(and(eq(conversationThreads.sessionId, sessionId), eq(conversationThreads.orgId, orgId)));
          return res.json({ title });
        }
      } catch {}
      const fallbackTitle = snippet.slice(0, 40) + (snippet.length > 40 ? '...' : '');
      await db.update(conversationThreads)
        .set({ title: fallbackTitle, updatedAt: new Date() })
        .where(and(eq(conversationThreads.sessionId, sessionId), eq(conversationThreads.orgId, orgId)));
      res.json({ title: fallbackTitle });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/support/ticket-status — get current ticket status for a session
  app.get('/api/support/ticket-status', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const sessionId = req.query.sessionId as string;
      if (!sessionId) return res.status(400).json({ message: "sessionId required" });
      const tickets = await db.select().from(supportTickets)
        .where(and(eq(supportTickets.orgId, orgId), eq(supportTickets.sessionId, sessionId), ne(supportTickets.status, 'resolved')))
        .orderBy(desc(supportTickets.createdAt))
        .limit(1);
      res.json(tickets[0] || null);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/support/messages — org user polls for new support messages in their session
  app.get('/api/support/messages', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const sessionId = req.query.sessionId as string;
      const since = req.query.since as string;
      if (!sessionId) return res.status(400).json({ message: "sessionId required" });
      let query = db.select().from(conversations)
        .where(and(
          eq(conversations.orgId, orgId),
          eq(conversations.sessionId, sessionId),
          or(eq(conversations.role, 'support'), eq(conversations.role, 'system')),
        ))
        .orderBy(asc(conversations.createdAt));
      if (since) {
        const sinceDate = new Date(parseInt(since));
        query = db.select().from(conversations)
          .where(and(
            eq(conversations.orgId, orgId),
            eq(conversations.sessionId, sessionId),
            or(eq(conversations.role, 'support'), eq(conversations.role, 'system')),
            gt(conversations.createdAt, sinceDate),
          ))
          .orderBy(asc(conversations.createdAt));
      }
      const msgs = await query;
      res.json(msgs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/platform-admin/support-queue — all open/active tickets (superAdmin)
  app.get('/api/platform-admin/support-queue', isSuperAdmin, async (_req, res) => {
    try {
      const tickets = await db.select({
        ticket: supportTickets,
        orgName: organizations.name,
      }).from(supportTickets)
        .leftJoin(organizations, eq(supportTickets.orgId, organizations.id))
        .where(ne(supportTickets.status, 'resolved'))
        .orderBy(desc(supportTickets.createdAt));
      const result = tickets.map(t => ({
        ...t.ticket,
        orgName: t.orgName || 'Unknown',
      }));
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/platform-admin/support-queue/history — resolved tickets (superAdmin)
  app.get('/api/platform-admin/support-queue/history', isSuperAdmin, async (_req, res) => {
    try {
      const tickets = await db.select({
        ticket: supportTickets,
        orgName: organizations.name,
      }).from(supportTickets)
        .leftJoin(organizations, eq(supportTickets.orgId, organizations.id))
        .where(eq(supportTickets.status, 'resolved'))
        .orderBy(desc(supportTickets.resolvedAt))
        .limit(50);
      const result = tickets.map(t => ({
        ...t.ticket,
        orgName: t.orgName || 'Unknown',
      }));
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/platform-admin/support-queue/:ticketId/messages — conversation for a ticket
  app.get('/api/platform-admin/support-queue/:ticketId/messages', isSuperAdmin, async (req, res) => {
    try {
      const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, req.params.ticketId)).limit(1);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ticket.orgId)).limit(1);
      const ticketWithOrg = { ...ticket, orgName: org?.name || ticket.orgId };
      const recentBefore = await db.select().from(conversations)
        .where(and(
          eq(conversations.orgId, ticket.orgId),
          eq(conversations.sessionId, ticket.sessionId),
          lte(conversations.createdAt, ticket.createdAt),
        ))
        .orderBy(desc(conversations.createdAt))
        .limit(20);
      const afterEscalation = await db.select().from(conversations)
        .where(and(
          eq(conversations.orgId, ticket.orgId),
          eq(conversations.sessionId, ticket.sessionId),
          gt(conversations.createdAt, ticket.createdAt),
        ))
        .orderBy(asc(conversations.createdAt));
      const msgs = [...recentBefore.reverse(), ...afterEscalation];
      res.json({ ticket: ticketWithOrg, messages: msgs });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/platform-admin/support-queue/:ticketId/reply — admin sends a message
  app.post('/api/platform-admin/support-queue/:ticketId/reply', isSuperAdmin, async (req: any, res) => {
    try {
      const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, req.params.ticketId)).limit(1);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const { content } = req.body;
      if (!content?.trim()) return res.status(400).json({ message: "content required" });
      const adminUser = req.user;
      const displayName = adminUser?.email || 'Support Agent';
      await db.insert(conversations).values({
        sessionId: ticket.sessionId,
        role: 'support',
        content: content.trim(),
        context: displayName,
        orgId: ticket.orgId,
      });
      if (ticket.status === 'escalated') {
        await db.update(supportTickets)
          .set({ status: 'active', assignedTo: adminUser?.id || null, updatedAt: new Date() })
          .where(eq(supportTickets.id, ticket.id));
      }
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // PATCH /api/platform-admin/support-queue/:ticketId/resolve — mark ticket resolved
  app.patch('/api/platform-admin/support-queue/:ticketId/resolve', isSuperAdmin, async (req, res) => {
    try {
      const [ticket] = await db.update(supportTickets)
        .set({ status: 'resolved', resolvedAt: new Date(), updatedAt: new Date() })
        .where(eq(supportTickets.id, req.params.ticketId))
        .returning();
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      await db.insert(conversations).values({
        sessionId: ticket.sessionId,
        role: 'system',
        content: 'This support session has been resolved. You can continue chatting with E.L.F.I.E. as usual.',
        orgId: ticket.orgId,
      });
      res.json(ticket);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/platform-admin/support-queue/count — badge count of open tickets
  app.get('/api/platform-admin/support-queue/count', isSuperAdmin, async (_req, res) => {
    try {
      const [result] = await db.select({ count: count() }).from(supportTickets)
        .where(ne(supportTickets.status, 'resolved'));
      res.json({ count: result?.count || 0 });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Product Management routes (superAdmin only) ────────────────────────────

  // Vision of Success
  app.get('/api/platform-admin/product/vision', isSuperAdmin, async (_req, res) => {
    try {
      const [vision] = await db.select().from(productVision).limit(1);
      res.json(vision || { id: null, whatChanges: '', howIFeel: '', whatPeopleSay: '', visionStatement: '' });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.put('/api/platform-admin/product/vision', isSuperAdmin, async (req, res) => {
    try {
      const { whatChanges, howIFeel, whatPeopleSay, visionStatement } = req.body;
      const updates: any = { updatedAt: new Date() };
      if (whatChanges !== undefined) updates.whatChanges = whatChanges;
      if (howIFeel !== undefined) updates.howIFeel = howIFeel;
      if (whatPeopleSay !== undefined) updates.whatPeopleSay = whatPeopleSay;
      if (visionStatement !== undefined) updates.visionStatement = visionStatement;
      const [existing] = await db.select().from(productVision).limit(1);
      if (existing) {
        const [updated] = await db.update(productVision).set(updates).where(eq(productVision.id, existing.id)).returning();
        res.json(updated);
      } else {
        const [created] = await db.insert(productVision).values({ whatChanges: whatChanges || '', howIFeel: howIFeel || '', whatPeopleSay: whatPeopleSay || '', visionStatement: visionStatement || '' }).returning();
        res.json(created);
      }
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post('/api/platform-admin/product/vision/generate', isSuperAdmin, async (req, res) => {
    try {
      const { whatChanges, howIFeel, whatPeopleSay } = req.body;
      if (!whatChanges && !howIFeel && !whatPeopleSay) {
        return res.status(400).json({ message: 'Fill in at least one field before generating.' });
      }
      const apiKey = await getPlatformOpenAIKey();
      if (!apiKey) return res.status(400).json({ message: 'OpenAI API key not configured.' });
      const openai = new OpenAI({ apiKey });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 300,
        messages: [
          { role: 'system', content: 'You are a product strategist. Write a concise, inspiring product vision statement (2-4 sentences) based on the founder\'s answers to three prompts. The statement should be forward-looking, specific to their product, and motivating for a team. Do not use bullet points or headers — just the statement.' },
          { role: 'user', content: `If we are successful, what changes?\n${whatChanges}\n\nIf we are successful, how do I feel?\n${howIFeel}\n\nIf we are successful, what are people saying?\n${whatPeopleSay}` },
        ],
      });
      const statement = completion.choices[0]?.message?.content?.trim() || '';
      res.json({ visionStatement: statement });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  // OKRs
  app.get('/api/platform-admin/product/okrs', isSuperAdmin, async (_req, res) => {
    try {
      const okrs = await db.select().from(productOkrs).orderBy(desc(productOkrs.createdAt));
      const krs = await db.select().from(productKeyResults).orderBy(asc(productKeyResults.id));
      const result = okrs.map(o => ({ ...o, keyResults: krs.filter(k => k.okrId === o.id) }));
      res.json(result);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post('/api/platform-admin/product/okrs', isSuperAdmin, async (req, res) => {
    try {
      const parsed = insertProductOkrSchema.parse(req.body);
      const [okr] = await db.insert(productOkrs).values(parsed).returning();
      res.json({ ...okr, keyResults: [] });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.patch('/api/platform-admin/product/okrs/:id', isSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { title, timeframe, status } = req.body;
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (timeframe !== undefined) updates.timeframe = timeframe;
      if (status !== undefined) updates.status = status;
      const [updated] = await db.update(productOkrs).set(updates).where(eq(productOkrs.id, id)).returning();
      res.json(updated);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.delete('/api/platform-admin/product/okrs/:id', isSuperAdmin, async (req, res) => {
    try {
      await db.delete(productOkrs).where(eq(productOkrs.id, parseInt(req.params.id)));
      res.json({ ok: true });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  // Key Results
  app.post('/api/platform-admin/product/key-results', isSuperAdmin, async (req, res) => {
    try {
      const parsed = insertProductKeyResultSchema.parse(req.body);
      const [kr] = await db.insert(productKeyResults).values(parsed).returning();
      res.json(kr);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.patch('/api/platform-admin/product/key-results/:id', isSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { title, progress } = req.body;
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (progress !== undefined) updates.progress = Math.max(0, Math.min(100, progress));
      const [updated] = await db.update(productKeyResults).set(updates).where(eq(productKeyResults.id, id)).returning();
      res.json(updated);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.delete('/api/platform-admin/product/key-results/:id', isSuperAdmin, async (req, res) => {
    try {
      await db.delete(productKeyResults).where(eq(productKeyResults.id, parseInt(req.params.id)));
      res.json({ ok: true });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  // Roadmap Items
  app.get('/api/platform-admin/product/roadmap', isSuperAdmin, async (_req, res) => {
    try {
      const items = await db.select().from(productRoadmapItems).orderBy(asc(productRoadmapItems.createdAt));
      res.json(items);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post('/api/platform-admin/product/roadmap', isSuperAdmin, async (req, res) => {
    try {
      const parsed = insertProductRoadmapItemSchema.parse(req.body);
      const [item] = await db.insert(productRoadmapItems).values(parsed).returning();
      res.json(item);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.patch('/api/platform-admin/product/roadmap/:id', isSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { title, description, lane, okrId, targetDate } = req.body;
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (lane !== undefined) updates.lane = lane;
      if (okrId !== undefined) updates.okrId = okrId;
      if (targetDate !== undefined) updates.targetDate = targetDate ? new Date(targetDate) : null;
      const [updated] = await db.update(productRoadmapItems).set(updates).where(eq(productRoadmapItems.id, id)).returning();
      res.json(updated);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.delete('/api/platform-admin/product/roadmap/:id', isSuperAdmin, async (req, res) => {
    try {
      await db.delete(productRoadmapItems).where(eq(productRoadmapItems.id, parseInt(req.params.id)));
      res.json({ ok: true });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  // Backlog Items
  app.get('/api/platform-admin/product/backlog', isSuperAdmin, async (_req, res) => {
    try {
      const items = await db.select().from(productBacklogItems).orderBy(desc(productBacklogItems.createdAt));
      res.json(items);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post('/api/platform-admin/product/backlog', isSuperAdmin, async (req, res) => {
    try {
      const parsed = insertProductBacklogItemSchema.parse(req.body);
      const [item] = await db.insert(productBacklogItems).values(parsed).returning();
      res.json(item);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.patch('/api/platform-admin/product/backlog/:id', isSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { title, description, priority, effort, status, roadmapItemId, capabilityId } = req.body;
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (priority !== undefined) updates.priority = priority;
      if (effort !== undefined) updates.effort = effort;
      if (status !== undefined) updates.status = status;
      if (roadmapItemId !== undefined) updates.roadmapItemId = roadmapItemId;
      if (capabilityId !== undefined) updates.capabilityId = capabilityId;
      const [updated] = await db.update(productBacklogItems).set(updates).where(eq(productBacklogItems.id, id)).returning();
      res.json(updated);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.delete('/api/platform-admin/product/backlog/:id', isSuperAdmin, async (req, res) => {
    try {
      await db.delete(productBacklogItems).where(eq(productBacklogItems.id, parseInt(req.params.id)));
      res.json({ ok: true });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  // Capabilities
  app.get('/api/platform-admin/product/capabilities', isSuperAdmin, async (_req, res) => {
    try {
      const caps = await db.select().from(productCapabilities).orderBy(asc(productCapabilities.level), asc(productCapabilities.sortOrder));
      res.json(caps);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.post('/api/platform-admin/product/capabilities', isSuperAdmin, async (req, res) => {
    try {
      const parsed = insertProductCapabilitySchema.parse(req.body);
      const [cap] = await db.insert(productCapabilities).values(parsed).returning();
      res.json(cap);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.patch('/api/platform-admin/product/capabilities/:id', isSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { title, description, level, parentId, sortOrder, status } = req.body;
      const validStatuses = ['built', 'new', 'now', 'next', 'later'];
      const updates: any = {};
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (level !== undefined) updates.level = level;
      if (parentId !== undefined) updates.parentId = parentId;
      if (sortOrder !== undefined) updates.sortOrder = sortOrder;
      if (status !== undefined && validStatuses.includes(status)) updates.status = status;
      const [updated] = await db.update(productCapabilities).set(updates).where(eq(productCapabilities.id, id)).returning();
      res.json(updated);
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  app.delete('/api/platform-admin/product/capabilities/:id', isSuperAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const children = await db.select({ id: productCapabilities.id }).from(productCapabilities).where(eq(productCapabilities.parentId, id));
      const childIds = children.map(c => c.id);
      const allIds = [id, ...childIds];
      if (childIds.length > 0) {
        const grandchildren = await db.select({ id: productCapabilities.id }).from(productCapabilities).where(inArray(productCapabilities.parentId, childIds));
        const grandchildIds = grandchildren.map(c => c.id);
        allIds.push(...grandchildIds);
        if (grandchildIds.length > 0) {
          await db.update(productBacklogItems).set({ capabilityId: null }).where(inArray(productBacklogItems.capabilityId, grandchildIds));
          await db.delete(productCapabilities).where(inArray(productCapabilities.id, grandchildIds));
        }
        await db.update(productBacklogItems).set({ capabilityId: null }).where(inArray(productBacklogItems.capabilityId, childIds));
        await db.delete(productCapabilities).where(inArray(productCapabilities.id, childIds));
      }
      await db.update(productBacklogItems).set({ capabilityId: null }).where(eq(productBacklogItems.capabilityId, id));
      await db.delete(productCapabilities).where(eq(productCapabilities.id, id));
      res.json({ ok: true });
    } catch (error: any) { res.status(500).json({ message: error.message }); }
  });

  // ─── Feature Request (any authenticated user) ────────────────────────────────

  app.post('/api/feature-request/rephrase', isAuthenticated, async (req: any, res) => {
    try {
      const { description } = req.body;
      if (!description || typeof description !== 'string' || description.trim().length < 5) {
        return res.status(400).json({ message: 'Please describe the feature you want.' });
      }
      const apiKey = await getPlatformOpenAIKey();
      if (!apiKey) return res.status(503).json({ message: 'AI service not configured.' });
      const openai = new OpenAI({ apiKey });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a product manager for E.L.F.I.E., a LEGO/BrickLink inventory management SaaS. Rephrase the user\'s feature request into a clear, concise, well-written product feature description (1-2 sentences max). Keep the user\'s intent but make it professional. Return ONLY the rephrased feature text, nothing else.' },
          { role: 'user', content: description },
        ],
        max_tokens: 200,
        temperature: 0.3,
      });
      const rephrased = completion.choices[0]?.message?.content?.trim() || description;
      res.json({ rephrased });
    } catch (error: any) {
      console.error('[FeatureRequest] rephrase error:', error.message);
      res.status(500).json({ message: 'Could not rephrase feature request.' });
    }
  });

  app.post('/api/feature-request/submit', isAuthenticated, async (req: any, res) => {
    try {
      const { feature } = req.body;
      if (!feature || typeof feature !== 'string' || feature.trim().length < 5) {
        return res.status(400).json({ message: 'Feature description is required.' });
      }
      const allCaps = await db.select().from(productCapabilities).orderBy(asc(productCapabilities.level), asc(productCapabilities.sortOrder));
      const l2Caps = allCaps.filter(c => c.level === 2);
      let assignedParentId: number | null = null;
      let assignedL2Name = 'General';
      if (l2Caps.length > 0) {
        const apiKey = await getPlatformOpenAIKey();
        if (apiKey) {
          const openai = new OpenAI({ apiKey });
          const l2List = l2Caps.map(c => `ID:${c.id} "${c.title}"`).join(', ');
          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: `You are classifying a feature request into a product capability category. The available L2 categories are: ${l2List}. Return ONLY the numeric ID of the best-matching category. If none fit well, return 0.` },
              { role: 'user', content: feature },
            ],
            max_tokens: 10,
            temperature: 0,
          });
          const idStr = completion.choices[0]?.message?.content?.trim() || '0';
          const idMatch = idStr.match(/\d+/);
          const parsedId = idMatch ? parseInt(idMatch[0], 10) : 0;
          const matched = l2Caps.find(c => c.id === parsedId);
          if (matched) {
            assignedParentId = matched.id;
            assignedL2Name = matched.title;
          }
        }
      }
      if (!assignedParentId && l2Caps.length > 0) {
        assignedParentId = l2Caps[0].id;
        assignedL2Name = l2Caps[0].title;
      }
      const maxSort = allCaps.filter(c => c.level === 3 && c.parentId === assignedParentId).reduce((mx, c) => Math.max(mx, c.sortOrder), 0);
      const [newCap] = await db.insert(productCapabilities).values({
        title: feature.trim(),
        description: '',
        level: 3,
        parentId: assignedParentId,
        sortOrder: maxSort + 1,
        status: 'new',
      }).returning();
      res.json({ capability: newCap, l2Name: assignedL2Name });
    } catch (error: any) {
      console.error('[FeatureRequest] submit error:', error.message);
      res.status(500).json({ message: 'Could not save feature request.' });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Public Roadmap & Feature Voting
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /api/public-roadmap — returns L1→L2→L3 capabilities with vote counts
  app.get('/api/public-roadmap', isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any)?.id || (req.user as any)?.claims?.sub || '';
      const statusFilter = req.query.status as string | undefined;
      const allCaps = await db.select().from(productCapabilities).orderBy(asc(productCapabilities.level), asc(productCapabilities.sortOrder));
      const voteCounts = await db.select({
        capabilityId: featureVotes.capabilityId,
        votes: count(),
      }).from(featureVotes).groupBy(featureVotes.capabilityId);
      const voteMap = new Map(voteCounts.map(v => [v.capabilityId, Number(v.votes)]));
      let userVotes: number[] = [];
      if (userId) {
        const uv = await db.select({ capabilityId: featureVotes.capabilityId }).from(featureVotes).where(eq(featureVotes.userId, userId));
        userVotes = uv.map(v => v.capabilityId);
      }
      let features = allCaps.filter(c => c.level === 3);
      if (statusFilter && statusFilter !== 'all') {
        features = features.filter(c => c.status === statusFilter);
      }
      const l2s = allCaps.filter(c => c.level === 2);
      const l1s = allCaps.filter(c => c.level === 1);
      const enriched = features.map(f => ({
        id: f.id,
        title: f.title,
        description: f.description,
        status: f.status,
        parentId: f.parentId,
        l2Name: l2s.find(l => l.id === f.parentId)?.title || '',
        l1Name: (() => { const l2 = l2s.find(l => l.id === f.parentId); return l2 ? (l1s.find(l => l.id === l2.parentId)?.title || '') : ''; })(),
        votes: voteMap.get(f.id) || 0,
        userVoted: userVotes.includes(f.id),
      }));
      enriched.sort((a, b) => b.votes - a.votes);
      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // POST /api/feature-votes/:capabilityId — toggle vote (add or remove)
  app.post('/api/feature-votes/:capabilityId', isAuthenticated, async (req: any, res) => {
    try {
      const userId = (req.user as any)?.id || (req.user as any)?.claims?.sub || '';
      const orgId = reqOrgId(req);
      const capabilityId = parseInt(req.params.capabilityId, 10);
      if (!capabilityId || isNaN(capabilityId)) return res.status(400).json({ message: 'Invalid capability ID' });
      const [cap] = await db.select().from(productCapabilities).where(eq(productCapabilities.id, capabilityId)).limit(1);
      if (!cap || cap.level !== 3) return res.status(404).json({ message: 'Feature not found' });
      const [existing] = await db.select().from(featureVotes)
        .where(and(eq(featureVotes.capabilityId, capabilityId), eq(featureVotes.userId, userId)))
        .limit(1);
      if (existing) {
        await db.delete(featureVotes).where(eq(featureVotes.id, existing.id));
        const [{ votes }] = await db.select({ votes: count() }).from(featureVotes).where(eq(featureVotes.capabilityId, capabilityId));
        return res.json({ voted: false, votes: Number(votes) });
      }
      await db.insert(featureVotes).values({ capabilityId, userId, orgId });
      const [{ votes }] = await db.select({ votes: count() }).from(featureVotes).where(eq(featureVotes.capabilityId, capabilityId));
      res.json({ voted: true, votes: Number(votes) });
    } catch (error: any) {
      if (error.message?.includes('unique') || error.code === '23505') {
        const [{ votes }] = await db.select({ votes: count() }).from(featureVotes).where(eq(featureVotes.capabilityId, parseInt(req.params.capabilityId, 10)));
        return res.json({ voted: true, votes: Number(votes) });
      }
      res.status(500).json({ message: error.message });
    }
  });

  // GET /api/feature-votes/counts — vote counts for all features (for admin panels)
  app.get('/api/feature-votes/counts', isAuthenticated, async (req: any, res) => {
    try {
      const voteCounts = await db.select({
        capabilityId: featureVotes.capabilityId,
        votes: count(),
      }).from(featureVotes).groupBy(featureVotes.capabilityId);
      const map: Record<number, number> = {};
      voteCounts.forEach(v => { map[v.capabilityId] = Number(v.votes); });
      res.json(map);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ─── Billing routes ──────────────────────────────────────────────────────────

  // GET /api/public/plans — unauthenticated endpoint for landing page (live plans only)
  app.get('/api/public/plans', async (_req, res) => {
    try {
      const livePlans = await db
        .select()
        .from(plans)
        .where(eq(plans.status, 'live'))
        .orderBy(asc(plans.basePrice));
      res.json(livePlans);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/plans — return only live plans for subscription selection (sunset + in_progress plans are hidden)
  app.get('/api/plans', isAuthenticated, async (_req, res) => {
    try {
      const activePlans = await db
        .select()
        .from(plans)
        .where(eq(plans.status, 'live'))
        .orderBy(asc(plans.id));
      res.json(activePlans);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // POST /api/billing/checkout — create Stripe checkout session
  app.post('/api/billing/checkout', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { plan, interval, planId, context } = req.body;

      // New path: plan selected by DB id (dynamic plans table)
      if (planId !== undefined) {
        const [dbPlan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
        if (!dbPlan || dbPlan.status !== 'live') {
          return res.status(400).json({ message: "Invalid or unavailable plan" });
        }

        // Default (free) plans skip Stripe entirely — activate directly
        if (dbPlan.isDefault) {
          await storage.updateOrganization(orgId, {
            plan: dbPlan.name,
            planId: dbPlan.id,
            subscriptionStatus: 'active',
            trialEndsAt: null,
          });
          const isOnboarding = context === 'onboarding' || context === 'plan_expired';
          const redirect = isOnboarding ? `/?subscribed=true&plan=${dbPlan.id}` : `/settings?tab=billing`;
          return res.json({ success: true, redirect });
        }

        const isOnboarding = context === 'onboarding' || context === 'plan_expired';
        const successUrl = isOnboarding
          ? `${req.protocol}://${req.get('host')}/?subscribed=true&plan=${dbPlan.id}`
          : `${req.protocol}://${req.get('host')}/settings?tab=billing&session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = isOnboarding
          ? `${req.protocol}://${req.get('host')}/`
          : `${req.protocol}://${req.get('host')}/settings?tab=billing`;

        const session = await createCheckoutSessionByPlan(orgId, dbPlan, successUrl, cancelUrl);
        return res.json({ url: session.url });
      }

      if (!['foundation', 'core'].includes(plan)) return res.status(400).json({ message: "Invalid plan" });
      if (!['monthly', 'annual'].includes(interval)) return res.status(400).json({ message: "Invalid interval" });

      const isOnboarding = context === 'onboarding';
      const successUrl = isOnboarding
        ? `${req.protocol}://${req.get('host')}/?subscribed=true&plan=${plan}`
        : `${req.protocol}://${req.get('host')}/settings?tab=billing&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = isOnboarding
        ? `${req.protocol}://${req.get('host')}/`
        : `${req.protocol}://${req.get('host')}/settings?tab=billing`;

      const session = await createCheckoutSession(orgId, plan, interval, successUrl, cancelUrl);
      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Stripe checkout error:", error);
      res.status(500).json({ message: error.message || "Failed to create checkout session" });
    }
  });

  // POST /api/billing/portal — create customer portal session
  app.post('/api/billing/portal', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const returnUrl = `${req.protocol}://${req.get('host')}/settings?tab=billing`;
      const session = await createPortalSession(orgId, returnUrl);
      res.json({ url: session.url });
    } catch (error: any) {
      console.error("Stripe portal error:", error);
      res.status(500).json({ message: error.message || "Failed to create portal session" });
    }
  });

  // GET /api/billing/status — get org subscription status
  app.get('/api/billing/status', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const org = await storage.getOrganization(orgId);
      if (!org) return res.status(404).json({ message: "Organization not found" });

      const brickspotterCheck = await checkBrickspotterLimit(orgId);

      // Look up plan sunset info (if org is on a sunset plan with an end date)
      let planSunsetAt: string | null = null;
      let planStatus: string | null = null;
      if (org.planId) {
        const [planRow] = await db.select({ status: plans.status, sunsetAt: plans.sunsetAt }).from(plans).where(eq(plans.id, org.planId)).limit(1);
        if (planRow) {
          planStatus = planRow.status;
          planSunsetAt = planRow.sunsetAt ? planRow.sunsetAt.toISOString() : null;
        }
      }
      
      res.json({
        plan: org.plan,
        status: org.subscriptionStatus,
        interval: org.subscriptionInterval,
        hasStripeCustomer: !!org.stripeCustomerId,
        hasActiveSubscription: !!org.stripeSubscriptionId,
        trialEndsAt: org.trialEndsAt ?? null,
        subscriptionEndsAt: org.subscriptionEndsAt ?? null,
        cancelAtPeriodEnd: org.cancelAtPeriodEnd ?? false,
        planStatus,
        planSunsetAt,
        brickspotter: {
          scansUsed: brickspotterCheck.scansUsed ?? 0,
          scansLimit: brickspotterCheck.scansLimit ?? -1,
          apiCallLimit: brickspotterCheck.apiCallLimit ?? 0,
          brickspotterOnly: brickspotterCheck.isBrickspotterOnly ?? false,
        },
      });
    } catch (error) {
      console.error("Error fetching billing status:", error);
      res.status(500).json({ message: "Failed to fetch billing status" });
    }
  });

  // GET /api/billing/payments — Stripe invoice history for the current org
  app.get('/api/billing/payments', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
      if (!org) return res.status(404).json({ error: 'Not found' });
      if (!org.stripeCustomerId) return res.json({ payments: [] });
      const stripe = stripeClient.getClient();
      const invoices = await stripe.invoices.list({ customer: org.stripeCustomerId, limit: 50 });
      const payments = invoices.data.map(inv => ({
        id: inv.id,
        amount: inv.amount_paid,
        currency: inv.currency,
        status: inv.status,
        description: inv.description || inv.lines.data[0]?.description || null,
        periodStart: inv.period_start,
        periodEnd: inv.period_end,
        created: inv.created,
        hostedUrl: inv.hosted_invoice_url,
        pdfUrl: inv.invoice_pdf,
      }));
      res.json({ payments });
    } catch {
      res.status(500).json({ error: 'Failed to fetch payments' });
    }
  });

  // POST /api/billing/webhook — handle subscription events
  // Use express.raw() for Stripe webhook to verify signature
  app.post('/api/billing/webhook', async (req, res) => {
    const sig = req.headers['stripe-signature'] as string;
    try {
      await handleStripeWebhook((req as any).rawBody || req.body, sig);
      res.json({ received: true });
    } catch (err: any) {
      console.error("Webhook error:", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  });

  // POST /api/billing/change-plan — upgrade or downgrade active subscription inline
  app.post('/api/billing/change-plan', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { plan, interval } = req.body;
      if (!['foundation', 'core'].includes(plan)) return res.status(400).json({ message: "Invalid plan" });
      if (!['monthly', 'annual'].includes(interval)) return res.status(400).json({ message: "Invalid interval" });
      const result = await changePlan(orgId, plan, interval);
      res.json(result);
    } catch (error: any) {
      console.error("Change plan error:", error);
      res.status(500).json({ message: error.message || "Failed to change plan" });
    }
  });

  // PATCH /api/billing/auto-renew — toggle subscription auto-renew (cancel_at_period_end)
  app.patch('/api/billing/auto-renew', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { autoRenew } = req.body;
      if (typeof autoRenew !== 'boolean') return res.status(400).json({ message: "autoRenew must be a boolean" });
      const result = await setAutoRenew(orgId, autoRenew);
      res.json(result);
    } catch (error: any) {
      console.error("Auto-renew error:", error);
      res.status(500).json({ message: error.message || "Failed to update auto-renew" });
    }
  });

  // DELETE /api/billing/subscription — cancel subscription immediately
  app.delete('/api/billing/subscription', isAuthenticated, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const result = await cancelSubscriptionNow(orgId);
      res.json(result);
    } catch (error: any) {
      console.error("Cancel subscription error:", error);
      res.status(500).json({ message: error.message || "Failed to cancel subscription" });
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
      // Destroy the session so the user is logged out
      req.logout?.(() => {});
      req.session?.destroy?.(() => {});
      res.json({ success: true });
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
      
      const users = await storage.getAllUsers();
      res.json(users);
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
      
      // Validate isApproved
      const approvalSchema = z.object({
        isApproved: z.boolean(),
      });
      
      const validation = approvalSchema.safeParse({ isApproved });
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid approval status. Must be boolean" });
      }
      
      const updatedUser = await storage.updateUserApproval(id, isApproved);
      
      // Check if user was found and updated
      if (!updatedUser) {
        return res.status(404).json({ message: "User not found" });
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
        const targetUser = allUsers.find(u => u.id === id);
        if (targetUser?.role === 'admin') {
          const otherAdmins = allUsers.filter(u => u.id !== id && u.role === 'admin' && u.isApproved);
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

  // Cleanup: delete stale orders stuck in awaiting_* status, older than a given date
  // ?before=YYYY-MM-DD (default 2 years ago); targets awaiting_payment, awaiting_shipment, awaiting_fulfillment
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

  // Lightweight endpoint for Sales Dashboard - orders without details
  app.get("/api/orders/summary", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      // Parse date range parameter
      const range = req.query.range as string;
      const productLine = req.query.productLine as string;
      const platform = req.query.platform as string;
      let dateFilter: Date | null = null;
      let endDateFilter: Date | null = null;
      
      if (range && range !== 'all') {
        const now = new Date();
        switch (range) {
          case 'mtd':
            // Month-to-Date: start of current month
            dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'lastmonth':
            // Last Month: entire previous calendar month
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case '3months':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 3, 1);
            break;
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1);
            endDateFilter = new Date(now.getFullYear(), 0, 1);
            break;
        }
      }

      // If filtering by product line, we need to find orders that contain items from that product line
      if (productLine) {
        // Build WHERE conditions for product line classification
        let productLineCondition: any;
        switch (productLine) {
          case 'K\'NEX':
            productLineCondition = sql`(od.name ILIKE '%K''NEX%' OR od.name ILIKE '%KNEX%')`;
            break;
          case 'Erector/Meccano':
            productLineCondition = sql`(od.name ILIKE '%Erector%' OR od.name ILIKE '%Meccano%')`;
            break;
          case 'Capsela':
            productLineCondition = sql`od.name ILIKE '%Capsela%'`;
            break;
          case 'Marbleworks':
            productLineCondition = sql`(od.name ILIKE '%Marbleworks%' OR od.name ILIKE '%Discovery Toys%')`;
            break;
          case 'Little Tikes':
            productLineCondition = sql`od.name ILIKE '%Little Tikes%'`;
            break;
          case 'Fisher-Price':
            productLineCondition = sql`od.name ILIKE '%Fisher-Price%'`;
            break;
          case 'LEGO':
          default:
            // LEGO is the default - any item that doesn't match other product lines
            productLineCondition = sql`NOT (
              (od.name ILIKE '%K''NEX%' OR od.name ILIKE '%KNEX%') OR
              (od.name ILIKE '%Erector%' OR od.name ILIKE '%Meccano%') OR
              od.name ILIKE '%Capsela%' OR
              (od.name ILIKE '%Marbleworks%' OR od.name ILIKE '%Discovery Toys%') OR
              od.name ILIKE '%Little Tikes%' OR
              od.name ILIKE '%Fisher-Price%'
            )`;
            break;
        }

        // Query orders that have at least one item matching the product line
        let whereConditions = sql`o.org_id = ${orgId} AND o.order_status NOT IN ('cancelled', 'Cancelled') AND o.is_test = false AND ${productLineCondition}`;
        
        if (platform) {
          whereConditions = sql`${whereConditions} AND (o.marketplace = ${platform} OR (o.marketplace IS NULL AND ${platform} = 'Unknown'))`;
        }
        
        if (dateFilter && !endDateFilter) {
          whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter}`;
        } else if (dateFilter && endDateFilter) {
          whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter} AND o.order_date < ${endDateFilter}`;
        }

        const query = sql`
          SELECT DISTINCT o.*
          FROM ${orders} o
          JOIN ${orderDetails} od ON o.id = od.order_id
          WHERE ${whereConditions}
          ORDER BY o.order_date DESC
        `;

        const result = await db.execute(query);
        
        // Map snake_case DB columns to camelCase to match the Order interface
        const mappedOrders = result.rows.map((row: any) => ({
          id: row.id,
          orderNumber: row.order_number,
          marketplace: row.marketplace,
          orderDate: row.order_date,
          orderTotal: row.order_total,
          customerUsername: row.customer_username,
          orderStatus: row.order_status,
          // Include other fields if needed
          blOrderId: row.bl_order_id,
          customerEmail: row.customer_email,
          customerName: row.customer_name,
          paymentStatus: row.payment_status,
          shippingMethod: row.shipping_method,
          trackingNumber: row.tracking_number,
          shippingCost: row.shipping_cost,
          taxAmount: row.tax_amount,
          shippingAddress: row.shipping_address,
          boOrderId: row.bo_order_id,
          boOrderTime: row.bo_order_time,
          shippedDate: row.shipped_date,
        }));
        
        res.json(mappedOrders);
        return;
      }

      // Return only the fields needed by the frontend to avoid large memory spikes.
      // The SalesDashboard only uses: id, orderDate, orderStatus, orderTotal, marketplace, orderNumber.
      const selectFields = {
        id: orders.id,
        orderNumber: orders.orderNumber,
        marketplace: orders.marketplace,
        orderDate: orders.orderDate,
        orderTotal: orders.orderTotal,
        orderStatus: orders.orderStatus,
      };

      const isTestExclude = sql`${orders.isTest} = false`;
      const orgFilter = eq(orders.orgId, orgId);
      const allOrders = dateFilter
        ? endDateFilter
          ? await db.select(selectFields).from(orders)
              .where(and(orgFilter, isTestExclude, sql`${orders.orderDate} >= ${dateFilter.toISOString()} AND ${orders.orderDate} < ${endDateFilter.toISOString()}`))
              .orderBy(desc(orders.orderDate))
          : await db.select(selectFields).from(orders)
              .where(and(orgFilter, isTestExclude, sql`${orders.orderDate} >= ${dateFilter.toISOString()}`))
              .orderBy(desc(orders.orderDate))
        : await db.select(selectFields).from(orders)
            .where(and(orgFilter, isTestExclude))
            .orderBy(desc(orders.orderDate));
      
      res.json(allOrders);
    } catch (error) {
      console.error("Error fetching order summaries:", error);
      res.status(500).json({ error: "Failed to fetch order summaries" });
    }
  });

  // Data Fetch Routes - all protected by isApproved middleware
  app.get("/api/orders", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      // Parse date range parameter
      const range = req.query.range as string;
      // lean=true skips fetching line items — used by Marketing dashboard for performance
      const lean = req.query.lean === 'true';
      let dateFilter: Date | null = null;
      let endDateFilter: Date | null = null;
      
      if (range && range !== 'all') {
        const now = new Date();
        switch (range) {
          case 'mtd':
            // Month-to-Date: start of current month
            dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'lastmonth':
            // Last Month: entire previous calendar month
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case '3months':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 3, 1);
            break;
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1);
            endDateFilter = new Date(now.getFullYear(), 0, 1);
            break;
        }
      }

      // Build where clause — always exclude test orders from analytics and scope to org
      const isTestFilter = sql`${orders.isTest} = false`;
      const orgOrderFilter = eq(orders.orgId, orgId);
      const buildWhere = (dateClause: any) =>
        dateClause ? and(orgOrderFilter, isTestFilter, dateClause) : and(orgOrderFilter, isTestFilter);

      const allOrders = dateFilter
        ? endDateFilter
          ? await db.select().from(orders)
              .where(buildWhere(sql`${orders.orderDate} >= ${dateFilter.toISOString()} AND ${orders.orderDate} < ${endDateFilter.toISOString()}`))
              .orderBy(desc(orders.orderDate))
          : await db.select().from(orders)
              .where(buildWhere(sql`${orders.orderDate} >= ${dateFilter.toISOString()}`))
              .orderBy(desc(orders.orderDate))
        : await db.select().from(orders)
            .where(buildWhere(null))
            .orderBy(desc(orders.orderDate));
      
      if (allOrders.length === 0) {
        res.json([]);
        return;
      }

      // lean mode: skip line items — orders only (much smaller response)
      if (lean) {
        res.json(allOrders);
        return;
      }
      
      // Fetch all order details in one query using inArray (works across all DB drivers)
      const orderIds = allOrders.map(o => o.id);
      const allDetails = await db.select()
        .from(orderDetails)
        .where(inArray(orderDetails.orderId, orderIds));
      
      // Group details by order ID
      const detailsByOrder = allDetails.reduce((acc, detail) => {
        if (!acc[detail.orderId]) {
          acc[detail.orderId] = [];
        }
        acc[detail.orderId].push(detail);
        return acc;
      }, {} as Record<string, typeof allDetails>);
      
      // Combine orders with their details
      const ordersWithDetails = allOrders.map(order => ({
        ...order,
        items: detailsByOrder[order.id] || [],
      }));
      
      res.json(ordersWithDetails);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ error: "Failed to fetch orders" });
    }
  });

  // Lightweight stats for Orders Dashboard header
  app.get("/api/orders/stats", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const now = new Date();
      const range = req.query.range as string | undefined;

      // Build date range window applied to totalOrders, shippedOrders, and rangeRevenue
      let dateStart: Date | null = null;
      let dateEnd: Date | null = null;
      if (range && range !== 'all') {
        switch (range) {
          case 'mtd':
            dateStart = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'lastmonth':
            dateStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            dateEnd = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case '3months':
            dateStart = new Date(now.getFullYear(), now.getMonth() - 3, 1);
            break;
          case '1year':
            dateStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case 'prevyear':
            dateStart = new Date(now.getFullYear() - 1, 0, 1);
            dateEnd = new Date(now.getFullYear(), 0, 1);
            break;
        }
      }

      const dateRangeClause = dateStart
        ? dateEnd
          ? sql`${orders.orderDate} >= ${dateStart.toISOString()} AND ${orders.orderDate} < ${dateEnd.toISOString()}`
          : sql`${orders.orderDate} >= ${dateStart.toISOString()}`
        : sql`1=1`;

      const totalWhere = dateStart
        ? and(eq(orders.orgId, orgId), sql`${orders.isTest} = false`, sql`${orders.orderStatus} NOT IN ('cancelled', 'Cancelled')`, dateRangeClause)
        : and(eq(orders.orgId, orgId), sql`${orders.isTest} = false`, sql`${orders.orderStatus} NOT IN ('cancelled', 'Cancelled')`);

      const shippedWhere = dateStart
        ? and(eq(orders.orgId, orgId), sql`${orders.isTest} = false`, eq(orders.orderStatus, 'shipped'), dateRangeClause)
        : and(eq(orders.orgId, orgId), sql`${orders.isTest} = false`, eq(orders.orderStatus, 'shipped'));

      const revenueWhere = dateStart
        ? and(eq(orders.orgId, orgId), sql`${orders.isTest} = false`, sql`${orders.orderStatus} NOT IN ('cancelled', 'Cancelled')`, dateRangeClause)
        : and(eq(orders.orgId, orgId), sql`${orders.isTest} = false`, sql`${orders.orderStatus} NOT IN ('cancelled', 'Cancelled')`);

      const avgLotsClause = dateStart
        ? dateEnd
          ? sql`AND o.order_date >= ${dateStart.toISOString()} AND o.order_date < ${dateEnd.toISOString()}`
          : sql`AND o.order_date >= ${dateStart.toISOString()}`
        : sql``;

      const [totalResult, pendingResult, shippedResult, pendingRevenueResult, rangeRevenueResult, avgLotsResult] = await Promise.all([
        db.select({ count: sql<number>`COUNT(*)` })
          .from(orders)
          .where(totalWhere)
          .then(r => r[0]),
        db.select({ count: sql<number>`COUNT(*)` })
          .from(orders)
          .where(and(eq(orders.orgId, orgId), sql`${orders.isTest} = false`, sql`${orders.orderStatus} IN ('awaiting_payment', 'awaiting_shipment', 'awaiting_fulfillment')`))
          .then(r => r[0]),
        db.select({ count: sql<number>`COUNT(*)` })
          .from(orders)
          .where(shippedWhere)
          .then(r => r[0]),
        db.select({ total: sql<string>`COALESCE(SUM(order_total::numeric), 0)` })
          .from(orders)
          .where(and(eq(orders.orgId, orgId), sql`${orders.isTest} = false`, sql`${orders.orderStatus} IN ('awaiting_payment', 'awaiting_shipment', 'awaiting_fulfillment')`))
          .then(r => r[0]),
        db.select({ total: sql<string>`COALESCE(SUM(order_total::numeric), 0)` })
          .from(orders)
          .where(revenueWhere)
          .then(r => r[0]),
        db.execute(sql`
          SELECT COALESCE(AVG(lot_count), 0)::numeric AS avg_lots
          FROM (
            SELECT od.order_id, COUNT(*) AS lot_count
            FROM order_details od
            JOIN orders o ON od.order_id = o.id
            WHERE o.org_id = ${orgId}
              AND o.is_test = false
              AND o.order_status NOT IN ('cancelled', 'Cancelled')
              ${avgLotsClause}
            GROUP BY od.order_id
          ) sub
        `).then(r => r.rows[0]),
      ]);

      res.json({
        totalOrders: Number(totalResult?.count ?? 0),
        pendingOrders: Number(pendingResult?.count ?? 0),
        shippedOrders: Number(shippedResult?.count ?? 0),
        pendingRevenue: Number(pendingRevenueResult?.total ?? 0),
        monthRevenue: Number(rangeRevenueResult?.total ?? 0),
        avgLotsPerOrder: Number((avgLotsResult as any)?.avg_lots ?? 0),
      });
    } catch (error) {
      console.error("Error fetching order stats:", error);
      res.status(500).json({ error: "Failed to fetch order stats" });
    }
  });

  // Customer stats aggregated server-side for Marketing Dashboard
  // Returns one row per customer with order_count, total_revenue, last/first order date, most recent order id & ship_to
  app.get("/api/orders/customer-stats", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const range = req.query.range as string;

      let dateFilter: string | null = null;
      let endDateFilter: string | null = null;

      if (range && range !== 'all') {
        const now = new Date();
        switch (range) {
          case 'mtd':
            dateFilter = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
            break;
          case 'lastmonth':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
            endDateFilter = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
            break;
          case '3months':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 3, 1).toISOString();
            break;
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1).toISOString();
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1).toISOString();
            endDateFilter = new Date(now.getFullYear(), 0, 1).toISOString();
            break;
        }
      }

      // Single-pass query: DISTINCT ON gets most-recent order row per customer,
      // window functions compute aggregates across all matching orders for that customer.
      // Date conditions are built conditionally to avoid null-parameter ambiguity in Drizzle sql tags.
      const startCond = dateFilter    ? sql`AND order_date >= ${dateFilter}::timestamp`    : sql``;
      const endCond   = endDateFilter ? sql`AND order_date <  ${endDateFilter}::timestamp` : sql``;

      const result = await db.execute(sql`
        SELECT DISTINCT ON (customer_username)
          id                                                                          AS most_recent_order_id,
          customer_username,
          customer_email,
          ship_to,
          COUNT(*)          OVER (PARTITION BY customer_username)::int                AS order_count,
          SUM(order_total::numeric) OVER (PARTITION BY customer_username)::float      AS total_revenue,
          MAX(order_date)   OVER (PARTITION BY customer_username)                    AS last_order_date,
          MIN(order_date)   OVER (PARTITION BY customer_username)                    AS first_order_date
        FROM orders
        WHERE org_id        = ${orgId}
          AND is_test       = false
          AND order_status  NOT IN ('cancelled', 'Cancelled')
          ${startCond}
          ${endCond}
        ORDER BY customer_username, order_date DESC
      `);

      res.json(result.rows);
    } catch (err) {
      console.error("Error fetching customer stats:", err);
      res.status(500).json({ error: "Failed to fetch customer stats" });
    }
  });

  // Optimized endpoint for Orders Dashboard - only fetches what's needed
  app.get("/api/orders/dashboard", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      // CTE calculates net total (gross - refunds - fees) per order
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
        db.execute(sql`
          ${withAdjustments}
          SELECT ${orderCols}
          FROM orders o
          LEFT JOIN adj a ON a.order_id = o.id
          WHERE o.org_id = ${orgId}
            AND o.order_status IN ('awaiting_payment', 'awaiting_shipment')
            AND o.is_test = false
          ORDER BY o.order_date DESC
          LIMIT 5
        `),
        db.execute(sql`
          ${withAdjustments}
          SELECT ${orderCols}
          FROM orders o
          LEFT JOIN adj a ON a.order_id = o.id
          WHERE o.org_id = ${orgId}
            AND o.order_status = 'shipped'
            AND o.is_test = false
          ORDER BY o.order_date DESC
          LIMIT 5
        `),
        db.execute(sql`
          ${withAdjustments}
          SELECT ${orderCols}
          FROM orders o
          LEFT JOIN adj a ON a.order_id = o.id
          WHERE o.org_id = ${orgId}
            AND o.order_total IS NOT NULL AND o.order_total::numeric > 0
            AND o.order_status NOT IN ('cancelled', 'Cancelled')
            AND o.is_test = false
          ORDER BY net_total DESC
          LIMIT 5
        `),
      ]);

      const mapRow = (r: any) => ({
        id: r.id,
        orderNumber: r.order_number,
        orderDate: r.order_date,
        orderStatus: r.order_status,
        orderTotal: r.order_total,
        netTotal: r.net_total,
        customerUsername: r.customer_username,
        marketplace: r.marketplace,
        items: [],
      });

      res.json({
        pending: pendingOrders.rows.map(mapRow),
        recentShipments: recentShipments.rows.map(mapRow),
        highValue: highValueOrders.rows.map(mapRow),
      });
    } catch (error) {
      console.error("Error fetching dashboard orders:", error);
      res.status(500).json({ error: "Failed to fetch dashboard orders" });
    }
  });

  // Get shipped orders with search functionality
  app.get("/api/orders/shipped", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const searchQuery = req.query.search as string;
      const range = req.query.range as string | undefined;

      // Build date filter from range
      let dateFilter: Date | null = null;
      let dateEnd: Date | null = null;
      if (range && range !== 'all') {
        const now = new Date();
        switch (range) {
          case 'mtd':
            dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'lastmonth':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            dateEnd = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case '3months':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 3, 1);
            break;
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1);
            dateEnd = new Date(now.getFullYear(), 0, 1);
            break;
        }
      }
      
      // Execute query for shipped orders — limit to 200 most recent to prevent browser crash.
      // Use DISTINCT ON to avoid duplicates when an order has multiple shipment records.
      const limit = searchQuery?.trim() ? 500 : 200;

      const searchWhere = searchQuery?.trim()
        ? sql`AND (
            o.order_number ILIKE ${'%' + searchQuery.trim() + '%'}
            OR o.customer_username ILIKE ${'%' + searchQuery.trim() + '%'}
            OR o.customer_email ILIKE ${'%' + searchQuery.trim() + '%'}
            OR s.tracking_number ILIKE ${'%' + searchQuery.trim() + '%'}
          )`
        : sql``;

      const dateWhere = dateFilter && dateEnd
        ? sql`AND o.order_date >= ${dateFilter.toISOString()} AND o.order_date < ${dateEnd.toISOString()}`
        : dateFilter
          ? sql`AND o.order_date >= ${dateFilter.toISOString()}`
          : sql``;

      const rawRows = await db.execute(sql`
        SELECT * FROM (
          SELECT DISTINCT ON (o.id)
            o.id,
            o.order_number AS "orderNumber",
            o.order_date AS "orderDate",
            o.ship_date AS "shipDate",
            o.customer_username AS "customerUsername",
            o.customer_email AS "customerEmail",
            o.order_total AS "orderTotal",
            o.marketplace,
            o.ship_to AS "shipTo",
            o.order_status AS "orderStatus",
            o.is_test AS "isTest",
            s.tracking_number AS "trackingNumber",
            s.carrier,
            s.service,
            s.label_url AS "labelUrl",
            COALESCE(o.ship_date, o.order_date) AS sort_date
          FROM orders o
          LEFT JOIN shipments s ON o.id = s.order_id
          WHERE o.org_id = ${orgId}
            AND o.order_status IN ('shipped', 'returned')
            ${dateWhere}
            ${searchWhere}
          ORDER BY o.id, s.created_at DESC NULLS LAST
        ) sub
        ORDER BY sort_date DESC
        LIMIT ${limit}
      `);

      res.json(rawRows.rows);
    } catch (error) {
      console.error("Error fetching shipped orders:", error);
      res.status(500).json({ error: "Failed to fetch shipped orders" });
    }
  });

  // Toggle test order flag — only for shipped orders with net total of $0 and a refund
  app.patch("/api/orders/:id/toggle-test", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const orderId = decodeURIComponent(req.params.id);

      const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
      if (!order) return res.status(404).json({ error: "Order not found" });

      // Verify eligibility: must have a refund adjustment and net total ≤ 0
      const adjResult = await db.execute(sql`
        SELECT COALESCE(SUM(ABS(amount::numeric)) FILTER (WHERE type = 'refund'), 0) AS refund_total
        FROM order_adjustments WHERE order_id = ${orderId}
      `);
      const refundTotal = parseFloat((adjResult.rows[0] as any)?.refund_total ?? '0');
      const orderTotal = parseFloat(order.orderTotal ?? '0');
      const netTotal = orderTotal - refundTotal;

      if (!order.isTest && (refundTotal === 0 || netTotal > 0.01)) {
        return res.status(400).json({
          error: "Cannot mark as test: order must have a refund and a net total of $0",
          refundTotal,
          netTotal,
        });
      }

      const [updated] = await db.update(orders)
        .set({ isTest: !order.isTest, updatedAt: new Date() })
        .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)))
        .returning();

      res.json({ isTest: updated.isTest });
    } catch (error) {
      console.error("Error toggling test flag:", error);
      res.status(500).json({ error: "Failed to toggle test flag" });
    }
  });

  // Get items sold in a specific category
  app.get("/api/analytics/categories/:categoryId/items", isApproved, async (req, res) => {
    try {
      const categoryId = parseInt(req.params.categoryId);
      const range = req.query.range as string;
      let dateFilter: Date | null = null;
      let endDateFilter: Date | null = null;
      
      // Parse date range
      if (range && range !== 'all') {
        const now = new Date();
        switch (range) {
          case 'mtd':
            dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'lastmonth':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case '3months':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 3, 1);
            break;
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1);
            endDateFilter = new Date(now.getFullYear(), 0, 1);
            break;
        }
      }
      
      // Build WHERE conditions
      let whereConditions = sql`o.order_status NOT IN ('cancelled', 'Cancelled') AND o.is_test = false`;
      if (dateFilter && !endDateFilter) {
        whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter}`;
      } else if (dateFilter && endDateFilter) {
        whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter} AND o.order_date < ${endDateFilter}`;
      }
      
      // Get items sold in this category with quantities (grouped by part number only)
      const query = sql`
        SELECT 
          i.item_no,
          i.item_name as name,
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
      `;
      
      const result = await db.execute(query);
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching category items:", error);
      res.status(500).json({ error: "Failed to fetch category items" });
    }
  });

  // Get category analysis (sell-through percentages)
  app.get("/api/analytics/categories", isApproved, async (req, res) => {
    try {
      const range = req.query.range as string;
      let dateFilter: Date | null = null;
      let endDateFilter: Date | null = null;
      
      // Parse date range (same logic as orders endpoint)
      if (range && range !== 'all') {
        const now = new Date();
        switch (range) {
          case 'mtd':
            dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'lastmonth':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case '3months':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 3, 1);
            break;
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1);
            endDateFilter = new Date(now.getFullYear(), 0, 1);
            break;
        }
      }
      
      // Build SQL query for category sell-through analysis
      // SKU is now standardized to BrickLink inventory ID for both platforms
      
      // Build WHERE conditions for the query
      let whereConditions = sql`o.order_status NOT IN ('cancelled', 'Cancelled') AND o.is_test = false`;
      if (dateFilter && !endDateFilter) {
        whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter}`;
      } else if (dateFilter && endDateFilter) {
        whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter} AND o.order_date < ${endDateFilter}`;
      }
      
      // Get sold quantities by category
      // Now we can directly join sku (BrickLink inventory ID) to bl_inventory.id
      const soldSubquery = sql`
        SELECT i.category_id, SUM(od.quantity) as total_qty
        FROM ${orderDetails} od
        JOIN ${orders} o ON od.order_id = o.id
        JOIN ${blInventory} i ON od.sku = CAST(i.id AS TEXT)
        WHERE ${whereConditions}
        GROUP BY i.category_id
      `;
      
      // Main query combining current inventory and sold data
      // Sell-through = sold / (current_stock + sold)
      // This represents "of everything ever available in this category, what fraction sold?"
      const query = sql`
        SELECT 
          c.id as category_id,
          c.name as category_name,
          COALESCE(sold.total_qty, 0)::integer as total_sold,
          COALESCE(inv.total_qty, 0)::integer as current_inventory,
          CASE 
            WHEN (COALESCE(inv.total_qty, 0) + COALESCE(sold.total_qty, 0)) > 0 
            THEN ROUND((COALESCE(sold.total_qty, 0)::numeric / (COALESCE(inv.total_qty, 0) + COALESCE(sold.total_qty, 0))::numeric * 100), 2)
            ELSE 0 
          END as sell_through_pct
        FROM ${blCategories} c
        LEFT JOIN (
          SELECT category_id, SUM(quantity) as total_qty
          FROM ${blInventory}
          GROUP BY category_id
        ) inv ON c.id = inv.category_id
        LEFT JOIN (
          ${soldSubquery}
        ) sold ON c.id = sold.category_id
        WHERE COALESCE(inv.total_qty, 0) + COALESCE(sold.total_qty, 0) > 0
        ORDER BY sell_through_pct DESC, c.name ASC
      `;
      
      const result = await db.execute(query);
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching category analysis:", error);
      res.status(500).json({ error: "Failed to fetch category analysis" });
    }
  });

  // Get product line analysis (sales by product type with platform breakdown)
  app.get("/api/analytics/product-lines", isApproved, async (req, res) => {
    try {
      const range = req.query.range as string;
      let dateFilter: Date | null = null;
      let endDateFilter: Date | null = null;
      
      // Parse date range (same logic as other analytics endpoints)
      if (range && range !== 'all') {
        const now = new Date();
        switch (range) {
          case 'mtd':
            dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'lastmonth':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case '3months':
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 3, 1);
            break;
          case '1year':
            dateFilter = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1);
            endDateFilter = new Date(now.getFullYear(), 0, 1);
            break;
        }
      }
      
      // Build WHERE conditions
      let whereConditions = sql`o.order_status NOT IN ('cancelled', 'Cancelled') AND o.is_test = false`;
      if (dateFilter && !endDateFilter) {
        whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter}`;
      } else if (dateFilter && endDateFilter) {
        whereConditions = sql`${whereConditions} AND o.order_date >= ${dateFilter} AND o.order_date < ${endDateFilter}`;
      }
      
      // Query to classify orders into product lines based on item names
      const query = sql`
        WITH order_items AS (
          SELECT 
            o.id as order_id,
            o.marketplace,
            o.order_total,
            od.name,
            od.quantity,
            od.unit_price
          FROM ${orders} o
          JOIN ${orderDetails} od ON o.id = od.order_id
          WHERE ${whereConditions}
        ),
        classified_items AS (
          SELECT 
            order_id,
            marketplace,
            quantity,
            unit_price,
            CASE
              WHEN name ILIKE '%K''NEX%' OR name ILIKE '%KNEX%' THEN 'K''NEX'
              WHEN name ILIKE '%Erector%' OR name ILIKE '%Meccano%' THEN 'Erector/Meccano'
              WHEN name ILIKE '%Capsela%' THEN 'Capsela'
              WHEN name ILIKE '%Marbleworks%' OR name ILIKE '%Discovery Toys%' THEN 'Marbleworks'
              WHEN name ILIKE '%Little Tikes%' THEN 'Little Tikes'
              WHEN name ILIKE '%Fisher-Price%' THEN 'Fisher-Price'
              ELSE 'LEGO'
            END as product_line
          FROM order_items
        ),
        platform_aggregates AS (
          SELECT 
            product_line,
            COALESCE(marketplace, 'Unknown') as marketplace,
            COUNT(DISTINCT order_id) as platform_orders,
            COALESCE(SUM(quantity * COALESCE(unit_price::numeric, 0)), 0) as platform_revenue
          FROM classified_items
          GROUP BY product_line, marketplace
        )
        SELECT 
          product_line,
          SUM(platform_orders)::integer as order_count,
          (SELECT SUM(quantity)::integer FROM classified_items ci WHERE ci.product_line = pa.product_line) as total_units,
          SUM(platform_revenue) as total_revenue,
          json_agg(
            json_build_object(
              'marketplace', marketplace,
              'order_count', platform_orders,
              'revenue', platform_revenue::text
            ) ORDER BY platform_revenue DESC
          ) as platforms
        FROM platform_aggregates pa
        GROUP BY product_line
        ORDER BY SUM(platform_revenue) DESC
      `;
      
      const result = await db.execute(query);
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching product line analysis:", error);
      res.status(500).json({ error: "Failed to fetch product line analysis" });
    }
  });

  // Fetch single order by ID with full details
  app.get("/api/orders/:id", isApproved, async (req: any, res) => {
    try {
      const orderId = req.params.id;
      const orgId = reqOrgId(req);
      
      // Fetch the order
      const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
      
      if (!order) {
        res.status(404).json({ error: "Order not found" });
        return;
      }
      
      // Fetch order items
      const items = await db.select().from(orderDetails).where(eq(orderDetails.orderId, orderId));

      // Look up BrickLink part numbers for items missing the stored item_no
      // (backfill for older order records synced before item_no was added)
      const missingItemNoIds = items
        .filter(i => !i.itemNo && i.bricklinkInventoryId != null)
        .map(i => i.bricklinkInventoryId as number);
      const fallbackItemNoMap: Record<number, string> = {};
      if (missingItemNoIds.length > 0) {
        const blItems = await db
          .select({ id: blInventory.id, itemNo: blInventory.itemNo })
          .from(blInventory)
          .where(inArray(blInventory.id, missingItemNoIds));
        for (const bi of blItems) fallbackItemNoMap[bi.id] = bi.itemNo;
      }

      // Fetch adjustments (refunds, credits)
      const adjustments = await db
        .select()
        .from(orderAdjustments)
        .where(eq(orderAdjustments.orderId, orderId))
        .orderBy(orderAdjustments.createdAt);

      // Fetch most recent shipment for tracking number
      const [shipment] = await db
        .select({ trackingNumber: shipments.trackingNumber, labelUrl: shipments.labelUrl, carrier: shipments.carrier, service: shipments.service })
        .from(shipments)
        .where(eq(shipments.orderId, orderId))
        .orderBy(desc(shipments.createdAt))
        .limit(1);
      
      // Parse shipTo JSON to get customer address
      let shipToData: any = {};
      try {
        shipToData = order.shipTo ? JSON.parse(order.shipTo) : {};
      } catch (e) {
        console.error("Error parsing shipTo JSON:", e);
      }
      
      // Fetch all orders for this customer to show as pills
      const customerUsername = order.customerUsername;
      let allCustomerOrders: any[] = [];
      let isRepeatCustomer = false;
      
      if (customerUsername && customerUsername !== 'Unknown Customer') {
        allCustomerOrders = await db.select({
          id: orders.id,
          orderNumber: orders.orderNumber,
          orderDate: orders.orderDate,
          orderStatus: orders.orderStatus,
          orderTotal: orders.orderTotal,
        })
        .from(orders)
        .where(and(eq(orders.orgId, orgId), eq(orders.customerUsername, customerUsername)))
        .orderBy(desc(orders.orderDate));
        
        isRepeatCustomer = allCustomerOrders.length > 1;
      }
      
      // Format response to match OrderDetail component expectations
      const formattedOrder = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        platform: 'ShipStation' as const,
        status: order.orderStatus === 'shipped' ? 'Shipped' as const :
                order.orderStatus === 'cancelled' ? 'Cancelled' as const :
                order.orderStatus === 'awaiting_payment' ? 'Pending' as const :
                'Paid' as const,
        customer: {
          name: order.customerUsername || 'Unknown Customer',
          email: order.customerEmail || '',
          address: shipToData.street1 || '',
          address2: shipToData.street2 || '',
          address3: shipToData.street3 || '',
          city: shipToData.city || '',
          state: shipToData.state || '',
          zip: shipToData.postalCode || '',
          country: shipToData.country || '',
        },
        weight: order.weight ? Number(order.weight) : null,
        weightUnits: order.weightUnits || 'oz',
        items: items.map(item => ({
          partNumber: item.itemNo
            || (item.bricklinkInventoryId ? fallbackItemNoMap[item.bricklinkInventoryId] : undefined)
            || item.sku
            || '',
          name: item.name,
          quantity: item.quantity,
          price: Number(item.unitPrice) || 0,
        })),
        shipping: Number(order.shippingAmount) || 0,
        tax: Number(order.taxAmount) || 0,
        total: Number(order.orderTotal) || 0,
        orderDate: order.orderDate.toISOString(),
        shippedDate: order.shipDate?.toISOString(),
        trackingNumber: shipment?.trackingNumber || undefined,
        labelUrl: shipment?.labelUrl || undefined,
        shippingCarrier: shipment?.carrier || undefined,
        shippingService: shipment?.service || undefined,
        isRepeatCustomer: isRepeatCustomer,
        adjustments: adjustments.map(a => ({
          id: a.id,
          type: a.type,
          amount: Number(a.amount),
          paymentMethod: a.paymentMethod,
          externalTransactionId: a.externalTransactionId,
          reason: a.reason,
          notes: a.notes,
          createdAt: a.createdAt.toISOString(),
        })),
        previousOrders: allCustomerOrders
          .filter(o => o.id !== orderId) // Exclude current order from previous orders
          .map(o => ({
            orderId: o.id,
            orderNumber: o.orderNumber,
            orderDate: o.orderDate.toISOString(),
            total: Number(o.orderTotal) || 0,
            status: o.orderStatus === 'shipped' ? 'Shipped' as const :
                    o.orderStatus === 'cancelled' ? 'Cancelled' as const :
                    o.orderStatus === 'awaiting_payment' ? 'Pending' as const :
                    'Paid' as const,
          })),
      };
      
      res.json(formattedOrder);
    } catch (error) {
      console.error("Error fetching order:", error);
      res.status(500).json({ error: "Failed to fetch order" });
    }
  });

  // Backfill order weights from bl_inventory.bl_catalog_weight × order_details.quantity
  // Runs once per deployment; safe to re-run (only touches orders with weight IS NULL)
  app.post("/api/orders/backfill-weights", isApproved, async (req, res) => {
    try {
      // Single SQL: compute grams → oz from catalog weights, update orders where weight is null
      const result = await db.execute(sql`
        WITH computed AS (
          SELECT
            od.order_id,
            SUM(
              CASE
                WHEN od.weight IS NOT NULL AND CAST(od.weight AS DECIMAL) > 0
                  THEN CAST(od.weight AS DECIMAL) * od.quantity
                WHEN bi.bl_catalog_weight IS NOT NULL AND bi.bl_catalog_weight > 0
                  THEN bi.bl_catalog_weight * od.quantity
                ELSE 0
              END
            ) AS total_grams
          FROM order_details od
          JOIN bl_inventory bi ON bi.id = od.bricklink_inventory_id
          JOIN orders o ON o.id = od.order_id
          WHERE o.weight IS NULL
          GROUP BY od.order_id
          HAVING SUM(
            CASE
              WHEN od.weight IS NOT NULL AND CAST(od.weight AS DECIMAL) > 0
                THEN CAST(od.weight AS DECIMAL) * od.quantity
              WHEN bi.bl_catalog_weight IS NOT NULL AND bi.bl_catalog_weight > 0
                THEN bi.bl_catalog_weight * od.quantity
              ELSE 0
            END
          ) > 0
        )
        UPDATE orders
        SET
          weight = ROUND(computed.total_grams * 0.035274, 2),
          weight_units = 'oz'
        FROM computed
        WHERE orders.id = computed.order_id
      `);
      const rowCount = (result as any).rowCount ?? 0;
      res.json({ updated: rowCount, message: `Weight backfilled for ${rowCount} orders` });
    } catch (error: any) {
      console.error("Error backfilling order weights:", error);
      res.status(500).json({ error: error.message || "Backfill failed" });
    }
  });

  // Update order address and weight fields (pre-shipment edits)
  app.patch("/api/orders/:id", isApproved, async (req: any, res) => {
    try {
      const orderId = req.params.id;
      const orgId = reqOrgId(req);
      const { street1, street2, street3, city, state, postalCode, country, weight, weightUnits, packageType, packageLength, packageWidth, packageHeight } = req.body;

      const [order] = await db.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId))).limit(1);
      if (!order) {
        return res.status(404).json({ error: "Order not found" });
      }

      // Merge updated address fields into existing shipTo JSON
      let shipToData: any = {};
      try {
        shipToData = order.shipTo ? JSON.parse(order.shipTo) : {};
      } catch (e) { /* ignore */ }

      if (street1 !== undefined) shipToData.street1 = street1;
      if (street2 !== undefined) shipToData.street2 = street2;
      if (street3 !== undefined) shipToData.street3 = street3;
      if (city !== undefined) shipToData.city = city;
      if (state !== undefined) shipToData.state = state;
      if (postalCode !== undefined) shipToData.postalCode = postalCode;
      if (country !== undefined) shipToData.country = country;

      const updateData: any = { shipTo: JSON.stringify(shipToData) };
      if (weight !== undefined) updateData.weight = weight !== null && weight !== '' ? weight.toString() : null;
      if (weightUnits !== undefined) updateData.weightUnits = weightUnits;
      if (packageType !== undefined) updateData.packageType = packageType || null;
      if (packageLength !== undefined) updateData.packageLength = packageLength !== null && packageLength !== '' ? packageLength.toString() : null;
      if (packageWidth !== undefined) updateData.packageWidth = packageWidth !== null && packageWidth !== '' ? packageWidth.toString() : null;
      if (packageHeight !== undefined) updateData.packageHeight = packageHeight !== null && packageHeight !== '' ? packageHeight.toString() : null;

      await db.update(orders).set(updateData).where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)));

      res.json({ success: true });
    } catch (error) {
      console.error("Error updating order:", error);
      res.status(500).json({ error: "Failed to update order" });
    }
  });

  // Update order status and trigger inventory adjustment
  app.post("/api/orders/:id/status", isApproved, async (req, res) => {
    try {
      const orderId = req.params.id;
      const { status } = req.body;

      if (!status) {
        return res.status(400).json({ error: "Status is required" });
      }

      const { updateOrderStatus } = await import('./services/inventory-adjustment');
      const result = await updateOrderStatus(orderId, status);

      res.json(result);
    } catch (error) {
      console.error("Error updating order status:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to update order status" 
      });
    }
  });

  // Manual inventory adjustment endpoint (for testing/admin use)
  app.post("/api/orders/:id/adjust-inventory", isApproved, async (req, res) => {
    try {
      const orderId = req.params.id;

      const { adjustInventoryForOrder } = await import('./services/inventory-adjustment');
      const result = await adjustInventoryForOrder(orderId);

      res.json(result);
    } catch (error) {
      console.error("Error adjusting inventory:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to adjust inventory" 
      });
    }
  });

  // Order Adjustments - Per-order refund totals (for chart deduction)
  app.get("/api/orders/adjustments/by-order", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { dateRange = 'mtd' } = req.query as { dateRange?: string };
      const now = new Date();
      let sinceDate: Date;
      let endDate: Date | null = null;
      switch (dateRange) {
        case 'lastmonth':
          sinceDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          endDate   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
          break;
        case '3months':  sinceDate = new Date(now.getFullYear(), now.getMonth() - 3, 1); break;
        case '1year':
        case '1y':       sinceDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); break;
        case 'prevyear':
          sinceDate = new Date(now.getFullYear() - 1, 0, 1);
          endDate   = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
          break;
        case 'all':      sinceDate = new Date(2000, 0, 1); break;
        default:         sinceDate = new Date(now.getFullYear(), now.getMonth(), 1); // mtd
      }
      const result = await db.execute(sql`
        SELECT oa.order_id, SUM(ABS(oa.amount::numeric)) AS total_refunds
        FROM order_adjustments oa
        JOIN orders o ON o.id = oa.order_id
        WHERE oa.type = 'refund'
          AND oa.org_id = ${orgId}
          AND o.is_test = false
          AND o.order_date >= ${sinceDate}
          ${endDate ? sql`AND o.order_date <= ${endDate}` : sql``}
        GROUP BY oa.order_id
      `);
      const refundsByOrder: Record<string, number> = {};
      for (const row of result.rows as any[]) {
        refundsByOrder[row.order_id] = Number(row.total_refunds);
      }
      res.json(refundsByOrder);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Order Adjustments - Summary (total refunds + fees for a date range)
  app.get("/api/orders/adjustments/summary", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { dateRange = 'mtd' } = req.query as { dateRange?: string };

      let sinceDate: Date;
      let endDate: Date | null = null;
      const now = new Date();
      switch (dateRange) {
        case 'lastmonth':
          sinceDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
          endDate   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
          break;
        case '3months':  sinceDate = new Date(now.getFullYear(), now.getMonth() - 3, 1); break;
        case '1year':
        case '1y':       sinceDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000); break;
        case 'prevyear':
          sinceDate = new Date(now.getFullYear() - 1, 0, 1);
          endDate   = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
          break;
        case 'all':      sinceDate = new Date(2000, 0, 1); break;
        default:         sinceDate = new Date(now.getFullYear(), now.getMonth(), 1); // mtd
      }

      const result = await db.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN oa.type = 'refund' THEN ABS(oa.amount::numeric) ELSE 0 END), 0) AS total_refunds,
          COUNT(DISTINCT CASE WHEN oa.type = 'refund' THEN oa.order_id END) AS refunded_order_count,
          COALESCE(SUM(CASE WHEN oa.type = 'merchant_fee' THEN ABS(oa.amount::numeric) ELSE 0 END), 0) AS total_fees,
          COALESCE(SUM(CASE WHEN oa.type = 'merchant_fee' AND oa.reason LIKE '%BrickLink%' THEN ABS(oa.amount::numeric) ELSE 0 END), 0) AS bricklink_fees,
          COALESCE(SUM(CASE WHEN oa.type = 'merchant_fee' AND oa.reason LIKE '%Stripe%' THEN ABS(oa.amount::numeric) ELSE 0 END), 0) AS stripe_fees,
          COALESCE(SUM(CASE WHEN oa.type = 'shipping_cost' THEN ABS(oa.amount::numeric) ELSE 0 END), 0) AS total_shipping,
          COUNT(DISTINCT CASE WHEN oa.type = 'shipping_cost' THEN oa.order_id END) AS shipped_order_count
        FROM order_adjustments oa
        JOIN orders o ON o.id = oa.order_id
        WHERE oa.org_id = ${orgId}
          AND o.is_test = false
          AND o.order_date >= ${sinceDate}
          ${endDate ? sql`AND o.order_date <= ${endDate}` : sql``}
      `);

      const row = result.rows[0] as any;
      const totalShipping = Number(row.total_shipping);
      const shippedOrderCount = Number(row.shipped_order_count);
      res.json({
        totalRefunds: Number(row.total_refunds),
        refundedOrderCount: Number(row.refunded_order_count),
        totalFees: Number(row.total_fees),
        bricklinkFees: Number(row.bricklink_fees),
        stripeFees: Number(row.stripe_fees),
        totalShipping,
        shippedOrderCount,
        avgShippingPerOrder: shippedOrderCount > 0 ? totalShipping / shippedOrderCount : 0,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Order Adjustments - CRUD
  app.get("/api/orders/:id/adjustments", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const adjustments = await db
        .select()
        .from(orderAdjustments)
        .where(and(eq(orderAdjustments.orderId, req.params.id), eq(orderAdjustments.orgId, orgId)))
        .orderBy(orderAdjustments.createdAt);
      res.json(adjustments);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch adjustments" });
    }
  });

  app.post("/api/orders/:id/adjustments", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const parsed = insertOrderAdjustmentSchema.safeParse({
        ...req.body,
        orderId: req.params.id,
        orgId,
      });
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
      }
      const [adj] = await db.insert(orderAdjustments).values(parsed.data).returning();
      res.json(adj);
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to create adjustment" });
    }
  });

  app.delete("/api/orders/:orderId/adjustments/:adjustmentId", isApproved, async (req, res) => {
    try {
      await db
        .delete(orderAdjustments)
        .where(
          and(
            eq(orderAdjustments.id, req.params.adjustmentId),
            eq(orderAdjustments.orderId, req.params.orderId)
          )
        );
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to delete adjustment" });
    }
  });


  app.get("/api/dashboard/stats", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      // Parse date range parameter
      const range = req.query.range as string;
      let dateFilter: Date | null = null;
      let endDateFilter: Date | null = null;
      
      if (range) {
        const now = new Date();
        switch (range) {
          case 'mtd':
            // Month-to-Date: start of current month
            dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case 'lastmonth':
            // Last Month: entire previous calendar month
            dateFilter = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            endDateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case '3months':
            dateFilter = new Date(now.setMonth(now.getMonth() - 3));
            break;
          case '1year':
            dateFilter = new Date(now.setFullYear(now.getFullYear() - 1));
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1);
            endDateFilter = new Date(now.getFullYear(), 0, 1);
            break;
        }
      }

      // Build orders WHERE clause once (reused for both count and sum)
      const orgOrdersWhere = eq(orders.orgId, orgId);
      const ordersWhere = dateFilter
        ? endDateFilter
          ? and(orgOrdersWhere, sql`${orders.orderDate} >= ${dateFilter.toISOString()} AND ${orders.orderDate} < ${endDateFilter.toISOString()}`)
          : and(orgOrdersWhere, sql`${orders.orderDate} >= ${dateFilter.toISOString()}`)
        : orgOrdersWhere;

      // Two parallel queries instead of five sequential ones
      const [ordersStats, inventoryStats] = await Promise.all([
        db.select({
          count: sql<number>`count(*)`,
          totalSales: sql<number>`COALESCE(sum(${orders.orderTotal}), 0)`,
        }).from(orders).where(ordersWhere),
        db.select({
          count: sql<number>`count(*)`,
          totalQty: sql<number>`COALESCE(sum(${blInventory.quantity}), 0)`,
          totalValue: sql<number>`COALESCE(sum(${blInventory.quantity} * CAST(${blInventory.unitPrice} AS DECIMAL)), 0)`,
        }).from(blInventory).where(eq(blInventory.orgId, orgId)),
      ]);

      res.json({
        totalOrders: Number(ordersStats[0]?.count) || 0,
        totalInventoryItems: Number(inventoryStats[0]?.count) || 0,
        totalInventoryQuantity: Number(inventoryStats[0]?.totalQty) || 0,
        totalSales: Number(ordersStats[0]?.totalSales) || 0,
        totalInventoryValue: Number(inventoryStats[0]?.totalValue) || 0,
      });
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // Settings Routes
  app.get("/api/settings", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const settings = await getOrgSettings(orgId);
      const masked = maskSettingsSecrets(settings as any);
      res.json({
        ...masked,
        brickowlConnectedViaEnv: !settings?.brickowlApiKey && !!process.env.BRICKOWL_API_KEY,
      });
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.post("/api/settings", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const data = insertAppSettingsSchema.parse(req.body);
      
      for (const field of SECRET_FIELDS) {
        const val = (data as any)[field];
        if (val && typeof val === 'string' && val.includes('····')) {
          delete (data as any)[field];
        }
      }
      
      const [settings] = await db
        .insert(appSettings)
        .values({ ...data, id: orgId, orgId })
        .onConflictDoUpdate({
          target: appSettings.id,
          set: {
            ...data,
            updatedAt: sql`CURRENT_TIMESTAMP`,
          },
        })
        .returning();

      res.json(maskSettingsSecrets(settings as any));
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // Shipping service mappings — learned label → EasyPost service name
  app.get("/api/shipping/service-mappings", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const rows = await db.select().from(shippingServiceMappings).where(eq(shippingServiceMappings.orgId, orgId));
      const map: Record<string, string> = {};
      for (const row of rows) map[row.label] = row.easypostService;
      res.json(map);
    } catch (e) {
      res.status(500).json({ error: "Failed to fetch service mappings" });
    }
  });

  app.post("/api/shipping/service-mappings", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { label, easypostService } = req.body;
      if (!label || !easypostService) return res.status(400).json({ error: "label and easypostService required" });
      await db.insert(shippingServiceMappings)
        .values({ orgId, label, easypostService })
        .onConflictDoUpdate({
          target: [shippingServiceMappings.orgId, shippingServiceMappings.label],
          set: { easypostService, updatedAt: sql`CURRENT_TIMESTAMP` },
        });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: "Failed to save service mapping" });
    }
  });

  // ── Push Notifications ──────────────────────────────────────────────────────
  app.get("/api/notifications/vapid-public-key", isApproved, (_req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || null });
  });

  app.post("/api/notifications/subscribe", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const userId = req.user?.id ?? null;
      const { endpoint, keys, notifyAllOrders = true, notifyPriorityOrders = true } = req.body;
      if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: "Invalid subscription" });
      await db.insert(pushSubscriptions)
        .values({ orgId, userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, notifyAllOrders, notifyPriorityOrders })
        .onConflictDoUpdate({
          target: pushSubscriptions.endpoint,
          set: { orgId, userId, notifyAllOrders, notifyPriorityOrders },
        });
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/notifications/subscription", isApproved, async (req: any, res) => {
    try {
      const { endpoint, notifyAllOrders, notifyPriorityOrders } = req.body;
      if (!endpoint) return res.status(400).json({ error: "endpoint required" });
      await db.update(pushSubscriptions)
        .set({ notifyAllOrders, notifyPriorityOrders })
        .where(eq(pushSubscriptions.endpoint, endpoint));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/notifications/unsubscribe", isApproved, async (req: any, res) => {
    try {
      const { endpoint } = req.body;
      if (!endpoint) return res.status(400).json({ error: "endpoint required" });
      await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/notifications/test", isApproved, async (req: any, res) => {
    try {
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
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify({
              title: 'E.L.F.I.E. · Test Notification',
              body: 'Comms check, Commander! If you can read this, the notification pipeline is fully operational. 🧱',
              tag: 'elfie-test',
              url: '/',
            })
          );
          sent++;
        } catch (err: any) {
          if (err.statusCode === 410 || err.statusCode === 404) stale.push(sub.id);
        }
      }
      for (const id of stale) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
      }
      res.json({ ok: true, sent, stale: stale.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Org Integrations (selling channels: BrickOwl, eBay, Amazon, etc.)
  app.get("/api/org/integrations", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const integrations = await db.select().from(orgIntegrations).where(eq(orgIntegrations.orgId, orgId));
      const sanitized = integrations.map(i => ({
        ...i,
        credentials: Object.fromEntries(
          Object.entries((i.credentials as Record<string, string>) || {}).map(([k, v]) => [k, v ? '••••••' : ''])
        ),
      }));
      res.json(sanitized);
    } catch (error: any) {
      console.error("Error fetching org integrations:", error);
      res.status(500).json({ error: "Failed to fetch integrations" });
    }
  });

  app.post("/api/org/integrations", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { channel, type, displayName, credentials, isConnected } = req.body as {
        channel: string;
        type: 'sales_channel' | 'shipping' | 'payment';
        displayName?: string;
        credentials?: Record<string, string>;
        isConnected?: boolean;
      };
      if (!channel || !type) return res.status(400).json({ error: "channel and type are required" });
      const [row] = await db
        .insert(orgIntegrations)
        .values({
          orgId,
          channel,
          type,
          displayName: displayName ?? channel,
          credentials: credentials ?? {},
          isConnected: isConnected ?? false,
        })
        .returning();
      res.json({ success: true, integration: row });
    } catch (error: any) {
      console.error("Error creating org integration:", error);
      res.status(500).json({ error: "Failed to create integration" });
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
  app.get("/api/export/bricklink-xml", isApproved, async (req, res) => {
    try {
      const xml = await generateBrickLinkXML();
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

  app.get("/api/export/inventory-csv", isApproved, async (req, res) => {
    try {
      const csv = await generateInventoryCSV();
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

  // List available XML backups
  app.get("/api/backups/list", isApproved, async (req, res) => {
    try {
      const backups = await listXMLBackups();
      res.json({ success: true, backups });
    } catch (error) {
      console.error("Error listing XML backups:", error);
      res.status(500).json({ error: "Failed to list backups" });
    }
  });

  // Download specific XML backup
  app.get("/api/backups/download/:filename", isApproved, async (req, res) => {
    try {
      const { filename } = req.params;
      const xml = await getXMLBackup(filename);
      
      res.setHeader('Content-Type', 'application/xml');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(xml);
    } catch (error) {
      console.error("Error downloading backup:", error);
      res.status(404).json({ error: "Backup file not found" });
    }
  });

  // OpenAI Models Route (simplified - we use specific models)
  app.get("/api/openai/models", isApproved, async (req, res) => {
    try {
      // Return common OpenAI chat models
      const models = [
        { id: 'gpt-4o', name: 'GPT-4o' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
      ];

      res.json({ models });
    } catch (error) {
      console.error("Error fetching models:", error);
      res.status(500).json({ error: "Failed to fetch models" });
    }
  });

  app.post("/api/ocr/bricklink-credentials", isApproved, async (req, res) => {
    try {
      const { image } = req.body;
      if (!image || typeof image !== 'string') {
        return res.status(400).json({ error: "Base64 image data required" });
      }
      const apiKey = await getPlatformOpenAIKey();
      if (!apiKey) {
        return res.status(400).json({ error: "OpenAI API key not configured" });
      }
      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({ apiKey });
      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        max_tokens: 500,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Extract BrickLink API credentials from this screenshot. Return ONLY a JSON object with these fields (use null if not found): {"consumerKey": "...", "consumerSecret": "...", "tokenValue": "...", "tokenSecret": "..."}. The values are long hex strings. Do not include any other text.' },
            { type: 'image_url', image_url: { url: image.startsWith('data:') ? image : `data:image/png;base64,${image}` } }
          ]
        }]
      });
      const text = response.choices[0]?.message?.content?.trim() || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return res.json({ error: "Could not extract credentials from image" });
      }
      const parsed = JSON.parse(jsonMatch[0]);
      res.json(parsed);
    } catch (err: any) {
      console.error("[OCR] BrickLink credential extraction failed:", err.message);
      res.status(500).json({ error: "Failed to process screenshot" });
    }
  });

  app.post("/api/ai/summarize", isApproved, async (req, res) => {
    try {
      const { title, snippet, url, type } = req.body;
      if (!title || !snippet) {
        return res.status(400).json({ error: 'title and snippet are required' });
      }

      const apiKey = await getPlatformOpenAIKey();
      if (!apiKey) {
        return res.status(500).json({ error: 'OpenAI API key not configured' });
      }

      const OpenAI = (await import('openai')).default;
      const openai = new OpenAI({ apiKey });

      const systemPrompt = type === 'forum'
        ? `You are a sharp LEGO market analyst. Analyze this BrickLink forum thread based on the topic and opening post excerpt. Focus on:
1. What specific issue, question, or trend is being discussed
2. The seller/buyer sentiment or concern driving the conversation
3. Any concrete takeaways for a parts reseller (pricing moves, demand shifts, policy changes, sourcing tips)
Be direct — no filler, no generic "the community is discussing..." phrasing. Write like you're briefing a business owner who needs to know what matters and why.`
        : 'You are a concise business analyst for a LEGO reselling business. Given a news headline and snippet, provide a 1-2 sentence overview of what happened and why it matters to a LEGO parts reseller. Be direct and specific. No preamble.';

      const userContent = type === 'forum'
        ? `Thread Title: ${title}\n\nOpening Post:\n${snippet}${url ? `\n\nThread URL: ${url}` : ''}`
        : `Title: ${title}\nSnippet: ${snippet}${url ? `\nSource: ${url}` : ''}`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: type === 'forum' ? 250 : 150,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ]
      });

      const overview = completion.choices[0]?.message?.content?.trim() || '';
      res.json({ overview });
    } catch (error: any) {
      console.error('Summarize error:', error.message);
      res.status(500).json({ error: 'Failed to generate overview' });
    }
  });

  app.get("/api/elfie-default-prompt", isApproved, async (_req, res) => {
    const prompt = `You are E.L.F.I.E. (Electronic Lifeform For Intelligent Elements) — the business brain behind E.L.F.I.E., a LEGO-exclusive parts reseller platform serving AFOLs (Adult Fans of LEGO). You have direct database access to everything: inventory, orders, pricing, customers, sales history.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHO YOU ARE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are a trusted business partner who understands the economics of reselling, the AFOL market, and what it takes to run a profitable parts operation. When you look at data, you interpret it, connect it to business outcomes, and say something useful about it.

You have opinions. You form them from the data and share them directly. When something looks wrong, you say so. When there's an opportunity, you name it. Say "you should do this" when you mean it.

You are calm, direct, and honest. You calibrate your depth to the question — a quick check gets a quick answer, a strategic question gets real analysis. Keep it clean — answer the question, skip the disclaimers.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW YOU COMMUNICATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Keep answers short and direct. Answer the core question in 1-3 sentences with the key numbers, then offer 2-3 clickable follow-ups so the user can drill deeper.

CRITICAL — follow-up format rules:
- Each suggestion MUST be on its own line
- Each suggestion MUST be a complete, self-contained question (the user clicks it and it becomes their next message — no prior context is available)
- Format: **PROMPT:** "Your complete question here"
- Include the part number/name in every suggestion so it stands alone

Example — if asked "do we have part 3024?":
Yes, we have 3024 (Plate 1x1) across 45 colors, about 2,500 total pieces worth $X.

**PROMPT:** "Show me the color breakdown for part 3024"
**PROMPT:** "Who has ordered part 3024?"
**PROMPT:** "What's the current market price for 3024?"

**Formatting rules:**

STAT CARDS — For key metrics, use blockquote lines with ">" prefix. Consecutive ">" lines become a grid of stat cards. Great for summaries.
Example (these 4 lines produce a 2×2 stat grid):
> Total Orders: 47
> Total Revenue: $1,284.50
> Units Sold: 312
> Date Range: Jan–Mar 2026

SECTION HEADERS — Use ### to group sections when the response covers multiple topics.
Example: ### Color Breakdown

KEY-VALUE LISTS — For items with a label and a value, use a dash with an em-dash or colon separator. These render as clean rows with the label on the left and value on the right.
Example:
- **Dark Bluish Gray** — 194 units, $0.79 each
- **White** — 87 units, $0.65 each
- **Black** — 52 units, $0.71 each

PLAIN BULLETS — For items without a clear label/value split, use "- " for simple bullets.

STRUCTURE GUIDANCE:
- Lead with a short 1-2 sentence summary.
- Follow with stat cards ("> Key: Value" lines) for the top-level numbers.
- Use ### section headers to separate different topics (e.g., ### Customer Profile, ### Order History, ### Pricing).
- Under each section, use key-value list items for structured data.
- End with PROMPT suggestions for drilling deeper.
- For order questions: stat cards for totals (revenue, qty, order count, date range) — the order detail cards are shown separately. Don't list individual orders in text.
- Keep everything single-level — no nested bullets. Flatten into one clean line per item.
- Use **bold** for labels and important values.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE BUSINESS YOU'RE RUNNING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

E.L.F.I.E. is LEGO-exclusive parts only — no sets for kids, no competing brands (K'NEX, Mega Construx, etc.). The customers are adult builders: MOC creators, custom project builders, collectors who care deeply about specific colors, rare pieces, and bulk availability.

This means:
- Color precision matters. Dark Bluish Gray and Medium Bluish Gray are completely different products to an AFOL.
- Breadth of inventory signals credibility to this audience. They want to know you have what they need.
- Pricing needs to reflect market reality — AFOLs check BrickLink before they buy from you.
- Rare colors and high-demand parts carry premium potential that generic pricing misses.

**Key metrics that signal business health:**
- **Throughput (sell-through rate)**: Sales ÷ current inventory by category. High = growing demand or understocked. Low = slow-moving or overpriced.
- **Repeat customer rate**: Retention matters more than acquisition in a niche market. A repeat customer is proof the experience works.
- **Margin by lot**: Not all parts are equal. Some lots carry the operation; others just occupy shelf space.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT DATA NOTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order numbers are stored without prefixes — display them exactly as returned from tools.

The store was closed for ~2 years. All order/sales history is from 2010–2023 (latest: Dec 28, 2023). Treat the data as historical. When calling analytics tools, omit date filters unless the user specifically asks for a time range.

Always ground your answers in actual tool and database results.

When suggesting follow-up questions, format each as: **PROMPT:** "Your complete question here"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
E.L.F.I.E. PLATFORM — FEATURES & TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You live inside E.L.F.I.E., a full business operations platform. When users ask "what can you do?", "what is X?", or "how do I do Y?", you should know about all of these features. You cannot open these screens directly — but you can explain what they do and guide the user to them.

**Main Tabs:**
- **Dashboard** — High-level business overview: revenue, orders, top parts, recent activity.
- **Product** — Inventory management. View, search, and manage all inventory items. Has sub-tools accessible from the toolbar: Price-o-Matic, Warehouse Management, List-o-Matic, and Brick Spotter 3000.
- **Orders** — Order tracking and management. View all orders, statuses, and details. Has sub-tools: Fulfillment & Shipping, and Shipped Orders.
- **Marketing** — Marketing analytics and insights.
- **Sales** — Sales analytics including year-over-year comparisons, platform performance, and geographic breakdowns.

**Sub-Tools (accessible from Product tab toolbar):**

- **Price-o-Matic** — Bulk pricing intelligence engine. Syncs market pricing data from BrickLink for your entire inventory. Shows pricing insights: items priced below market, items with high repricing potential, demand velocity, market scarcity, and undercut ratios. Helps you find parts where you can raise prices or where competitors are undercutting you. Uses a proprietary repricing score combining ceiling ratio, demand velocity, scarcity index, and undercut ratio — all with user-configurable weights.

- **Warehouse Management** — Bin-level storage organization. Assign inventory items to physical warehouse bins/locations. Helps with physical organization of LEGO parts inventory so you can find pieces quickly when fulfilling orders.

- **List-o-Matic** — Priority listing tool. Helps you decide which items to list or prioritize based on demand signals, pricing potential, and inventory levels.

- **Brick Spotter 3000** (also called Brickanalyzer) — Visual LEGO part scanner and identifier. Take a photo of LEGO pieces and it uses computer vision (contour-based segmentation + Brickognize API + CLIP visual embeddings) to identify each part in the image. Great for sorting bulk LEGO purchases — dump parts on a table, snap a photo, and Brick Spotter tells you what each piece is, its name, color, and estimated value.

**Sub-Tools (accessible from Orders tab toolbar):**

- **Fulfillment & Shipping** — Order fulfillment workflow. Generates bin-level picklists so you know exactly where to find each part. Integrates with EasyPost for multi-carrier shipping label generation and rate shopping. Handles the full pick-pack-ship workflow.

- **Shipped Orders** — Track shipped orders with delivery status and tracking information.

**You (E.L.F.I.E.):**
You are the AI assistant accessible via the chat drawer (the robot icon). You can query inventory, orders, pricing, customer data, sales analytics, and the BrickLink catalog. You can show part images, look up market prices, search forum discussions, and provide business insights. You're the fastest way to get answers without navigating through dashboards.

**Settings & Platform Admin:**
The gear icon opens Settings where users can configure BrickLink/BrickOwl API credentials, shipping providers, sync schedules, Price-o-Matic scoring weights, and more. Super admins have access to Platform Admin for managing plans, API budgets, database maintenance, and multi-org management.

**Multi-Platform Sync:**
E.L.F.I.E. syncs inventory across BrickLink and BrickOwl. Changes made on either platform are reflected in E.L.F.I.E. Orders from both platforms are tracked in a unified view.`;
    res.json({ prompt });
  });

  app.post("/api/elfie-analyze-conversations", isApproved, async (req, res) => {
    try {
      const { startDate, endDate } = req.body;
      const orgId = (req as any).orgId;
      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate and endDate required' });
      }

      const settings = await getOrgSettings(orgId);
      const currentCustomPrompt = settings?.systemPrompt || '';

      const convos = await db
        .select({
          role: conversations.role,
          content: conversations.content,
          createdAt: conversations.createdAt,
          sessionId: conversations.sessionId,
        })
        .from(conversations)
        .where(and(
          eq(conversations.orgId, orgId),
          gte(conversations.createdAt, new Date(startDate)),
          lte(conversations.createdAt, new Date(endDate)),
        ))
        .orderBy(conversations.createdAt)
        .limit(500);

      if (convos.length === 0) {
        return res.json({ prompt: '', summary: 'No conversations found in this date range.' });
      }

      const sessionGroups = new Map<string, typeof convos>();
      for (const c of convos) {
        const arr = sessionGroups.get(c.sessionId) || [];
        arr.push(c);
        sessionGroups.set(c.sessionId, arr);
      }

      let transcript = '';
      for (const [sid, msgs] of sessionGroups) {
        transcript += `\n--- Session ${sid} ---\n`;
        for (const m of msgs) {
          const content = m.content.length > 500 ? m.content.substring(0, 500) + '...' : m.content;
          transcript += `${m.role.toUpperCase()}: ${content}\n`;
        }
      }

      const { getOpenAIClient } = await import('./services/ai-agent');
      const openai = getOpenAIClient();

      const defaultPromptBlock = `You are E.L.F.I.E. (Electronic Lifeform For Intelligent Elements) — the business brain behind E.L.F.I.E., a LEGO-exclusive parts reseller platform serving AFOLs (Adult Fans of LEGO). You have direct database access to everything: inventory, orders, pricing, customers, sales history.

You are a trusted business partner who understands the economics of reselling, the AFOL market, and what it takes to run a profitable parts operation. You are calm, direct, and honest. You have opinions formed from data.

E.L.F.I.E. is LEGO-exclusive parts only. The customers are adult builders: MOC creators, custom project builders, collectors who care deeply about specific colors, rare pieces, and bulk availability. Color precision matters. Breadth of inventory signals credibility. Pricing needs to reflect market reality.`;

      const analysis = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a prompt engineering expert. You're analyzing an AI assistant called E.L.F.I.E. that helps run a LEGO parts reselling business on E.L.F.I.E..

You have THREE inputs:
1. The HARDCODED DEFAULT PROMPT — the built-in personality and behavior instructions E.L.F.I.E. uses by default
2. The CURRENT CUSTOM PROMPT — any custom overrides the user has already set (may be empty)
3. REAL CONVERSATIONS — actual chat sessions between the user and E.L.F.I.E.

Your job: Produce a NEW custom prompt that makes E.L.F.I.E. smarter. The custom prompt REPLACES the default personality/behavior (tool instructions are appended automatically). So your output must be a COMPLETE system prompt — not just additions.

Guidelines:
- KEEP everything from the default that works well
- IMPROVE areas where conversations show E.L.F.I.E. struggled, failed, or gave unhelpful responses
- INCORPORATE any custom instructions the user already added (don't lose their tweaks)
- ADD new instructions based on conversation patterns: repeated questions, common workflows, user preferences
- FIX specific failure patterns you see (errors, "I can't do that" when it should be able to, repetitive/unhelpful responses)
- MATCH the user's communication style preferences

Output TWO sections:

## Analysis Summary
A brief summary of what you found (3-5 bullet points of key insights from the conversations).

## Custom Prompt
The complete custom system prompt. This replaces the default, so it must include personality, communication style, business context, and any behavioral rules. Write it as direct instructions to E.L.F.I.E. Keep it focused and actionable. Do NOT include tool-calling instructions (those are auto-appended).`
          },
          {
            role: 'user',
            content: `=== HARDCODED DEFAULT PROMPT ===
${defaultPromptBlock}

=== CURRENT CUSTOM PROMPT ===
${currentCustomPrompt || '(none — using defaults)'}

=== CONVERSATIONS (${convos.length} messages, ${sessionGroups.size} sessions, ${startDate} to ${endDate}) ===
${transcript}`
          }
        ],
        temperature: 0.7,
        max_tokens: 3000,
      });

      const result = analysis.choices[0]?.message?.content || '';

      const summaryMatch = result.match(/## Analysis Summary\s*([\s\S]*?)(?=## Custom Prompt|$)/);
      const promptMatch = result.match(/## Custom Prompt\s*([\s\S]*?)$/);

      res.json({
        summary: summaryMatch?.[1]?.trim() || 'Analysis complete.',
        prompt: promptMatch?.[1]?.trim() || result,
        messageCount: convos.length,
        sessionCount: sessionGroups.size,
      });
    } catch (error: any) {
      console.error('Elfie conversation analysis error:', error.message);
      res.status(500).json({ error: 'Failed to analyze conversations' });
    }
  });

  // E.L.F.I.E. Chat Route
  app.post("/api/chat", isApproved, async (req, res) => {
    const chatStartTime = Date.now();
    try {
      const { messages, context } = req.body;
      
      // Validate messages array
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({
          error: "Invalid request",
          message: "Messages array is required and must not be empty.",
        });
      }
      
      // Get API key from settings
      const orgId = reqOrgId(req);
      const isSuperAdminUser = (req.user as any)?.superAdmin === true;
      const settings = await getOrgSettings(orgId);

      if (!settings?.aiEnabled) {
        return res.status(400).json({
          error: "AI assistant is disabled",
          message: "The AI assistant is currently disabled. Please enable it in Settings.",
        });
      }

      // Generate or retrieve session ID for conversation continuity
      const sessionId = req.headers['x-session-id'] as string || `session-${Date.now()}`;
      
      const lastUserMessageRaw = messages[messages.length - 1]?.content || '';
      const lastUserMessage = lastUserMessageRaw.toLowerCase();
      let bricklinkSearchSuggestion: { itemNo: string, itemType: string } | null = null;

      // Use custom system prompt if provided, otherwise use default
      const currentDate = new Date().toLocaleDateString('en-US', { 
        weekday: 'long', 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      
      const defaultSystemPrompt = `You are E.L.F.I.E. (Electronic Lifeform For Intelligent Elements) — the business brain behind E.L.F.I.E., a LEGO-exclusive parts reseller platform serving AFOLs (Adult Fans of LEGO). You have direct database access to everything: inventory, orders, pricing, customers, sales history.

Today's date: ${currentDate}
Current context: ${context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHO YOU ARE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are a trusted business partner who understands the economics of reselling, the AFOL market, and what it takes to run a profitable parts operation. When you look at data, you interpret it, connect it to business outcomes, and say something useful about it.

You have opinions. You form them from the data and share them directly. When something looks wrong, you say so. When there's an opportunity, you name it. Say "you should do this" when you mean it.

You are calm, direct, and honest. You calibrate your depth to the question — a quick check gets a quick answer, a strategic question gets real analysis. Keep it clean — answer the question, skip the disclaimers.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW YOU COMMUNICATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Keep answers short and direct. Answer the core question in 1-3 sentences with the key numbers, then offer 2-3 clickable follow-ups so the user can drill deeper.

CRITICAL — follow-up format rules:
- Each suggestion MUST be on its own line
- Each suggestion MUST be a complete, self-contained question (the user clicks it and it becomes their next message — no prior context is available)
- Format: **PROMPT:** "Your complete question here"
- Include the part number/name in every suggestion so it stands alone

Example — if asked "do we have part 3024?":
Yes, we have 3024 (Plate 1x1) across 45 colors, about 2,500 total pieces worth $X.

**PROMPT:** "Show me the color breakdown for part 3024"
**PROMPT:** "Who has ordered part 3024?"
**PROMPT:** "What's the current market price for 3024?"

**Formatting rules:**

STAT CARDS — For key metrics, use blockquote lines with ">" prefix. Consecutive ">" lines become a grid of stat cards. Great for summaries.
Example (these 4 lines produce a 2×2 stat grid):
> Total Orders: 47
> Total Revenue: $1,284.50
> Units Sold: 312
> Date Range: Jan–Mar 2026

SECTION HEADERS — Use ### to group sections when the response covers multiple topics.
Example: ### Color Breakdown

KEY-VALUE LISTS — For items with a label and a value, use a dash with an em-dash or colon separator. These render as clean rows with the label on the left and value on the right.
Example:
- **Dark Bluish Gray** — 194 units, $0.79 each
- **White** — 87 units, $0.65 each
- **Black** — 52 units, $0.71 each

PLAIN BULLETS — For items without a clear label/value split, use "- " for simple bullets.

STRUCTURE GUIDANCE:
- Lead with a short 1-2 sentence summary.
- Follow with stat cards ("> Key: Value" lines) for the top-level numbers.
- Use ### section headers to separate different topics (e.g., ### Customer Profile, ### Order History, ### Pricing).
- Under each section, use key-value list items for structured data.
- End with PROMPT suggestions for drilling deeper.
- For order questions: stat cards for totals (revenue, qty, order count, date range) — the order detail cards are shown separately. Don't list individual orders in text.
- Keep everything single-level — no nested bullets. Flatten into one clean line per item.
- Use **bold** for labels and important values.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE BUSINESS YOU'RE RUNNING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

E.L.F.I.E. is LEGO-exclusive parts only — no sets for kids, no competing brands (K'NEX, Mega Construx, etc.). The customers are adult builders: MOC creators, custom project builders, collectors who care deeply about specific colors, rare pieces, and bulk availability.

This means:
- Color precision matters. Dark Bluish Gray and Medium Bluish Gray are completely different products to an AFOL.
- Breadth of inventory signals credibility to this audience. They want to know you have what they need.
- Pricing needs to reflect market reality — AFOLs check BrickLink before they buy from you.
- Rare colors and high-demand parts carry premium potential that generic pricing misses.

**Key metrics that signal business health:**
- **Throughput (sell-through rate)**: Sales ÷ current inventory by category. High = growing demand or understocked. Low = slow-moving or overpriced.
- **Repeat customer rate**: Retention matters more than acquisition in a niche market. A repeat customer is proof the experience works.
- **Margin by lot**: Not all parts are equal. Some lots carry the operation; others just occupy shelf space.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT DATA NOTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order numbers are stored without prefixes — display them exactly as returned from tools.

The store was closed for ~2 years. All order/sales history is from 2010–2023 (latest: Dec 28, 2023). Treat the data as historical. When calling analytics tools, omit date filters unless the user specifically asks for a time range.

Always ground your answers in actual tool and database results.

When suggesting follow-up questions, format each as: **PROMPT:** "Your complete question here"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
E.L.F.I.E. PLATFORM — FEATURES & TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You live inside E.L.F.I.E., a full business operations platform. When users ask "what can you do?", "what is X?", or "how do I do Y?", you should know about all of these features. You cannot open these screens directly — but you can explain what they do and guide the user to them.

**Navigation:** The app has five main tabs across the top:
- **Ops Central** — The main dashboard / launchpad. Shows headline metrics (total inventory value, open orders, recent sales), urgent alerts, running background jobs, and quick-action cards that jump to each section.
- **Product** — Inventory management. View, search, and manage all inventory items. Has sub-tools accessible from the toolbar: Price-o-Matic, Warehouse Management, List-o-Matic, and Brick Spotter 3000.
- **Orders** — Order tracking and management. View all orders, statuses, and details. Has sub-tools: Fulfillment & Shipping, and Shipped Orders.
- **Marketing** — Marketing analytics and insights.
- **Sales** — Sales analytics including year-over-year comparisons, platform performance, and geographic breakdowns.

**Sub-Tools (accessible from Product tab toolbar):**

- **Price-o-Matic** — Bulk pricing intelligence engine. Syncs market pricing data from BrickLink for your entire inventory. Shows pricing insights: items priced below market, items with high repricing potential, demand velocity, market scarcity, and undercut ratios. Helps you find parts where you can raise prices or where competitors are undercutting you. Uses a proprietary repricing score combining ceiling ratio, demand velocity, scarcity index, and undercut ratio — all with user-configurable weights.

- **Warehouse Management** — Bin-level storage organization. Assign inventory items to physical warehouse bins/locations. Helps with physical organization of LEGO parts inventory so you can find pieces quickly when fulfilling orders.

- **List-o-Matic** — Priority listing tool. Helps you decide which items to list or prioritize based on demand signals, pricing potential, and inventory levels.

- **Brick Spotter 3000** (also called Brickanalyzer) — Visual LEGO part scanner and identifier. Take a photo of LEGO pieces and it uses computer vision (contour-based segmentation + Brickognize API + CLIP visual embeddings) to identify each part in the image. Great for sorting bulk LEGO purchases — dump parts on a table, snap a photo, and Brick Spotter tells you what each piece is, its name, color, and estimated value.

**Sub-Tools (accessible from Orders tab toolbar):**

- **Fulfillment & Shipping** — Order fulfillment workflow. Generates bin-level picklists so you know exactly where to find each part. Integrates with EasyPost for multi-carrier shipping label generation and rate shopping. Handles the full pick-pack-ship workflow.

- **Shipped Orders** — Track shipped orders with delivery status and tracking information.

**You (E.L.F.I.E.):**
You are the AI assistant accessible via the chat drawer (the robot icon). You can query inventory, orders, pricing, customer data, sales analytics, and the BrickLink catalog. You can show part images, look up market prices, search forum discussions, and provide business insights. You're the fastest way to get answers without navigating through dashboards.

**Settings & Platform Admin:**
The gear icon opens Settings where users can configure BrickLink/BrickOwl API credentials, shipping providers, sync schedules, Price-o-Matic scoring weights, and more. Super admins have access to Platform Admin for managing plans, API budgets, database maintenance, and multi-org management.

**Multi-Platform Sync:**
E.L.F.I.E. syncs inventory across BrickLink and BrickOwl. Changes made on either platform are reflected in E.L.F.I.E. Orders from both platforms are tracked in a unified view.`;

      // Enhanced system prompt for function calling capabilities
      const enhancedDefaultPrompt = `${defaultSystemPrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOLS AT YOUR DISPOSAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use the minimum tools needed to answer the question. Only call what the question asks for. Only chain multiple tools when the question genuinely requires cross-referencing data.

**Data lives at two levels — pick the right one:**

ORG-LEVEL (this store's data):
- "Do we have X?" → search_local_inventory (org inventory — quantities, colors, pricing)
- "Who ordered X?" / "Sales of X?" → search_orders_by_item (org order history)
- "How's the business?" → get_order_analytics, get_inventory_stats, get_customer_metrics, get_sales_by_category, get_sales_by_geography, get_business_customers, get_category_throughput, get_inventory_aging, get_margin_analysis, get_sku_performance, get_copurchased_items
- "Find me red castle pieces" → semantic_search (AI embedding search across org inventory)

PLATFORM-LEVEL (shared catalog for all orgs):
- "What does X look like?" / "Show me X" / "Picture of X" / "Tell me about part X" → search_bricklink_catalog (local catalog — image, description, dimensions, weight — the frontend displays the image inline in chat)
- "What's market price for X?" → get_bricklink_price_guide (locally cached market pricing from Price-o-Matic syncs)
- "What parts are in set X?" → get_set_parts (Rebrickable set-part data)
- "What are people saying about X?" → search_forum_discussions (BrickLink forum embeddings)
- "Any news about LEGO retirements?" → search_market_news (periodically-fetched web news articles about LEGO market trends, retirements, pricing, collectible values)
- "What's happening in the LEGO market?" → search_market_news first (cached news), then search_web if you need more real-time info
- "Show me the latest headlines" / "What's new?" → Call BOTH search_market_news AND search_forum_discussions (with broad queries). Present results as a themed briefing (see HEADLINE BRIEFING FORMAT below).

HEADLINE BRIEFING FORMAT — When the user asks for "latest headlines", "what's new", or a market briefing:
1. Call search_market_news (broad query like "LEGO") AND search_forum_discussions (broad query like "market") to gather everything.
2. Group results by THEME — not by source. Choose 2-4 themes that best fit the actual articles returned. Good themes: "Retirement Watch", "Pricing & Market Shifts", "New Releases & Reveals", "Supply Chain & Availability", "Investing & Collectibles". Pick themes where you have real articles to show.
3. IMPORTANT: Each article belongs to exactly ONE theme — its BEST fit. Do not create empty themes with no matching articles. If an article could fit multiple themes, put it in the one where it's most relevant.
4. Each theme gets a ### header, then a 1-sentence description of WHY this theme matters to a LEGO reseller. Do NOT list individual article or forum post titles — the frontend renders the actual articles as expandable cards below each theme header automatically based on keyword matching. Just output the ### header and the description sentence.
5. The LAST theme should ALWAYS be "### Community Buzz" (or similar with the word "Community", "Forum", or "Discussion" in the header) so the frontend groups BrickLink forum posts under it. Do NOT put news articles under Community Buzz — only forum discussions go there.
6. End with 2-3 PROMPT suggestions to drill into specific themes.

CRITICAL THEME RULES:
- Do NOT include an "Impact on Your Inventory" section. The user does not want inventory cross-referencing in briefings.
- Do NOT mix news articles into the Community Buzz section. Community Buzz is exclusively for BrickLink forum discussions.
- Do NOT create a theme unless at least 1-2 articles clearly match it. Better to have fewer well-populated themes than many empty ones.

Example:
### Retirement Watch
Sets nearing end-of-life can spike in aftermarket value — time to stock up before they're gone.

### Pricing & Market Shifts
Price movements across the aftermarket signal opportunities for savvy resellers.

### Community Buzz
What sellers and collectors are talking about on BrickLink forums this week.

**PROMPT:** "Tell me more about the retiring sets"
**PROMPT:** "What are the pricing trends this week?"

If the user asks multiple things in one message (e.g., "do we have 3024 and who ordered it"), call the appropriate tools in parallel — one for each question.

For inventory questions ("do we have X?", "what colors of X?"), search_local_inventory alone has everything you need — quantities, colors, pricing, conditions. One tool, one call, done. When the user asks "what colors do we have for X?", list EVERY color — never truncate or say "and more...". The user asked for the full list, give the full list.

When the user asks to SEE a part, what it LOOKS LIKE, or requests a VISUAL/IMAGE, you MUST call search_bricklink_catalog to get the image URL. The frontend will display the image inline in the chat. Include the imageUrl in your text as well: "Here's part 3024:" followed by the image details. Always call search_bricklink_catalog for visual/image/picture/photo requests.

For order/sales questions ("who ordered X?", "sales history of X?"), the order cards are automatically displayed below your text response with full details. Your text should ONLY contain the summary stats using stat cards ("> Total Orders: 5" etc.) — NEVER list individual orders in the text. End with PROMPT suggestions for drilling deeper.

**API usage policy — local-first:**
All tools query local data (bl_catalog, price_guide_cache, inventory, orders). They use zero BrickLink API calls. If a tool returns "not found" or the data looks incomplete/stale, tell the user what's missing and offer to fetch fresh data from the BrickLink API — but let them know it will use their API quota. Only make live API calls when the user explicitly says yes.

Format search_web URLs as markdown links.`;

      const toolInstructions = enhancedDefaultPrompt.substring(enhancedDefaultPrompt.indexOf('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nTOOLS AT YOUR DISPOSAL'));
      const systemPrompt = settings?.systemPrompt 
        ? `${settings.systemPrompt}\n\n${toolInstructions}` 
        : enhancedDefaultPrompt;

      // Use agent loop with function calling (with error recovery)
      const { runAgentLoop } = await import('./services/ai-agent');
      let assistantMessage: string;
      let bricklinkCatalogItem: any = null;
      
      let ordersFromAgentTools: any[] = [];
      let forumDiscussionsFromAgentTools: any[] = [];
      let marketNewsFromAgentTools: any[] = [];
      
      try {
        const agentResult = await runAgentLoop({
          systemPrompt,
          messages,
          maxIterations: 5,
          orgId: reqOrgId(req),
        });
        assistantMessage = agentResult.message;
        bricklinkCatalogItem = agentResult.bricklinkItem;
        ordersFromAgentTools = agentResult.ordersFromTool || [];
        forumDiscussionsFromAgentTools = agentResult.forumDiscussionsFromTool || [];
        marketNewsFromAgentTools = agentResult.marketNewsFromTool || [];
      } catch (agentError: any) {
        // Agent loop failed - return user-friendly error message instead of 500
        console.error('❌ Agent loop error:', agentError);
        
        let errorMessage = "I'm having trouble processing your request right now.";
        if (agentError.message?.includes('timeout')) {
          errorMessage = "The AI service is taking too long to respond. Please try again.";
        } else if (agentError.message?.includes('Anthropic') || agentError.message?.includes('API')) {
          errorMessage = "I'm having trouble connecting to the AI service. Please try again in a moment.";
        } else if (agentError.message?.includes('Invalid response')) {
          errorMessage = "The AI service returned an unexpected response. Please try again.";
        }
        
        // Return error as assistant message instead of throwing 500
        return res.json({
          message: errorMessage,
          items: [],
          orders: [],
          sessionId,
          error: true,
        });
      }
      
      // Items and orders come from the AI agent tools — no separate hardcoded queries needed

      // Save conversation to database for learning
      let isFirstExchange = false;
      try {
        await db.insert(conversations).values({
          sessionId,
          role: 'user',
          content: lastUserMessageRaw,
          context,
          orgId,
        });

        await db.insert(conversations).values({
          sessionId,
          role: 'assistant',
          content: assistantMessage,
          context,
          orgId,
        });

        const [existingThread] = await db.select().from(conversationThreads)
          .where(and(eq(conversationThreads.sessionId, sessionId), eq(conversationThreads.orgId, orgId))).limit(1);
        if (!existingThread) {
          await db.insert(conversationThreads).values({ sessionId, orgId, title: 'New conversation' });
          isFirstExchange = true;
        } else {
          await db.update(conversationThreads)
            .set({ updatedAt: new Date() })
            .where(and(eq(conversationThreads.sessionId, sessionId), eq(conversationThreads.orgId, orgId)));
          if (existingThread.title === 'New conversation') isFirstExchange = true;
        }
      } catch (saveError) {
        console.error('Error saving conversation:', saveError);
      }

      if (isFirstExchange) {
        fetch(`http://localhost:${process.env.PORT || 5000}/api/conversations/threads/${sessionId}/generate-title`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie: req.headers.cookie || '' },
        }).catch(() => {});
      }

      res.json({
        message: assistantMessage,
        items: [],
        orders: ordersFromAgentTools, // Orders from AI agent tools only
        forumDiscussions: forumDiscussionsFromAgentTools,
        marketNewsArticles: marketNewsFromAgentTools,
        sessionId,
        bricklinkSearchSuggestion, // Return suggestion if item not found (frontend will render as button)
        bricklinkItem: bricklinkCatalogItem, // Return BrickLink catalog item if found (frontend will auto-open drawer)
      });
    } catch (error) {
      console.error("❌ Chat error:", error);
      if (error instanceof Error) {
        console.error("Error name:", error.name);
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
      }
      
      // Provide more specific error messages
      let userMessage = "I'm having trouble connecting right now. Please try again.";
      if (error instanceof Error) {
        if (error.message.includes('OpenAI')) {
          userMessage = "I'm having trouble connecting to the AI service. Please check your API key in Settings.";
        } else if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
          userMessage = "The request timed out. Please try again.";
        } else if (error.message.includes('API key')) {
          userMessage = "The AI service is not properly configured. Please contact support.";
        }
      }
      
      res.status(500).json({
        error: "Failed to generate response",
        message: userMessage,
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Semantic Search - Inventory
  app.post("/api/search/inventory/semantic", isApproved, async (req, res) => {
    try {
      const { query, limit = 5 } = req.body;
      const orgId = reqOrgId(req);
      
      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }
      
      const { searchInventorySemantic } = await import('./services/embeddings');
      const results = await searchInventorySemantic(query, limit, orgId);
      
      res.json({ results });
    } catch (error) {
      console.error("Semantic search error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Semantic search failed" 
      });
    }
  });

  // Semantic Search - Orders
  app.post("/api/search/orders/semantic", isApproved, async (req, res) => {
    try {
      const { query, limit = 5 } = req.body;
      const orgId = reqOrgId(req);
      
      if (!query) {
        return res.status(400).json({ error: "Query is required" });
      }
      
      const { searchOrders } = await import('./services/embeddings');
      const results = await searchOrders(query, limit, orgId);
      
      res.json({ results });
    } catch (error) {
      console.error("Order semantic search error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Order search failed" 
      });
    }
  });

  // Find Similar Items
  app.get("/api/inventory/:id/similar", isApproved, async (req, res) => {
    try {
      const inventoryId = parseInt(req.params.id);
      const limit = parseInt(req.query.limit as string) || 5;
      
      const { findSimilarItems } = await import('./services/embeddings');
      const results = await findSimilarItems(inventoryId, limit);
      
      res.json({ results });
    } catch (error) {
      console.error("Find similar items error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to find similar items" 
      });
    }
  });

  // Get Sets Containing This Part in a Specific Color
  app.get("/api/inventory/:itemNo/:colorId/sets/count", isApproved, async (req, res) => {
    try {
      const { itemNo, colorId } = req.params;
      const colorIdNum = parseInt(colorId);

      const [result] = await db
        .select({ count: sql<number>`count(distinct ${setPartRelationships.setNum})::int` })
        .from(setPartRelationships)
        .where(
          and(
            eq(setPartRelationships.partNum, itemNo),
            colorIdNum && colorIdNum > 0
              ? eq(setPartRelationships.colorId, colorIdNum)
              : sql`${setPartRelationships.colorId} IS NULL`
          )
        );

      res.json({ total: result?.count ?? 0 });
    } catch (error) {
      console.error("Get sets count error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to get sets count" });
    }
  });

  app.get("/api/inventory/:itemNo/:colorId/sets", isApproved, async (req, res) => {
    try {
      const { itemNo, colorId } = req.params;
      const colorIdNum = parseInt(colorId);
      
      const colorInfo = colorIdNum && colorIdNum > 0
        ? await db
            .select({
              id: blColors.id,
              name: blColors.name,
              rgb: blColors.rgb,
            })
            .from(blColors)
            .where(eq(blColors.id, colorIdNum))
            .limit(1)
        : [];
      
      const requestedColor = colorInfo.length > 0 ? colorInfo[0] : null;
      
      const rawData = await db
        .select({
          setNum: setPartRelationships.setNum,
          setName: sql<string>`max(${setPartRelationships.setName})`,
          quantity: sql<number>`sum(${setPartRelationships.quantity})::int`,
        })
        .from(setPartRelationships)
        .where(
          and(
            eq(setPartRelationships.partNum, itemNo),
            colorIdNum && colorIdNum > 0 
              ? eq(setPartRelationships.colorId, colorIdNum)
              : sql`${setPartRelationships.colorId} IS NULL`
          )
        )
        .groupBy(setPartRelationships.setNum)
        .orderBy(setPartRelationships.setNum);
      
      const sortedSets = rawData.sort((a, b) => {
        const nameA = (a.setName || a.setNum).toLowerCase();
        const nameB = (b.setName || b.setNum).toLowerCase();
        return nameA.localeCompare(nameB);
      });
      
      res.json({ 
        sets: sortedSets,
        total: sortedSets.length,
        color: requestedColor ? {
          id: requestedColor.id,
          name: requestedColor.name,
          rgb: requestedColor.rgb,
        } : null
      });
    } catch (error) {
      console.error("Get sets for part error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get sets for part" 
      });
    }
  });

  // Batch Embed Inventory Items
  app.post("/api/embeddings/inventory/batch", isApproved, async (req, res) => {
    try {
      const { inventoryIds } = req.body;
      
      if (!inventoryIds || !Array.isArray(inventoryIds)) {
        return res.status(400).json({ error: "inventoryIds array is required" });
      }
      
      const { batchEmbedInventory } = await import('./services/embeddings');
      const results = await batchEmbedInventory(inventoryIds);
      
      res.json({ results });
    } catch (error) {
      console.error("Batch embedding error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Batch embedding failed" 
      });
    }
  });

  // Embed Single Inventory Item
  app.post("/api/embeddings/inventory/:id", isApproved, async (req, res) => {
    try {
      const inventoryId = parseInt(req.params.id);
      
      const { embedInventoryItem } = await import('./services/embeddings');
      const result = await embedInventoryItem(inventoryId);
      
      res.json(result);
    } catch (error) {
      console.error("Embedding error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Embedding failed" 
      });
    }
  });

  // Get Embedding Statistics
  app.get("/api/embeddings/stats", isApproved, async (req, res) => {
    try {
      const { getEmbeddingStats } = await import('./services/embeddings');
      const stats = await getEmbeddingStats();
      
      res.json(stats);
    } catch (error) {
      console.error("Get embedding stats error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get stats" 
      });
    }
  });

  // Get Inventory Items Without Embeddings
  app.get("/api/embeddings/inventory/missing", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const limit = parseInt(req.query.limit as string) || 100;
      
      // Get inventory items that don't have embeddings yet
      const itemsWithoutEmbeddings = await db
        .select({ id: blInventory.id })
        .from(blInventory)
        .leftJoin(inventoryEmbeddings, eq(blInventory.id, inventoryEmbeddings.inventoryId))
        .where(and(eq(blInventory.orgId, orgId), sql`${inventoryEmbeddings.inventoryId} IS NULL`))
        .limit(limit);
      
      res.json(itemsWithoutEmbeddings);
    } catch (error) {
      console.error("Get missing embeddings error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get missing embeddings" 
      });
    }
  });

  // Get Orders Without Embeddings
  app.get("/api/embeddings/orders/missing", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const limit = parseInt(req.query.limit as string) || 100;
      
      // Get orders that don't have embeddings yet
      const ordersWithoutEmbeddings = await db
        .select({ id: orders.id })
        .from(orders)
        .leftJoin(orderEmbeddings, eq(orders.id, orderEmbeddings.orderId))
        .where(and(eq(orders.orgId, orgId), sql`${orderEmbeddings.orderId} IS NULL`))
        .limit(limit);
      
      res.json(ordersWithoutEmbeddings);
    } catch (error) {
      console.error("Get missing order embeddings error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get missing order embeddings" 
      });
    }
  });

  // Batch Embed Orders
  app.post("/api/embeddings/orders/batch", isApproved, async (req, res) => {
    try {
      const { orderIds } = req.body;
      
      if (!orderIds || !Array.isArray(orderIds)) {
        return res.status(400).json({ error: "orderIds array is required" });
      }
      
      const { batchEmbedOrders } = await import('./services/embeddings');
      const results = await batchEmbedOrders(orderIds);
      
      res.json({ results });
    } catch (error) {
      console.error("Batch order embedding error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Batch order embedding failed" 
      });
    }
  });

  // Background Job Routes
  
  // Validation schema for starting a background job
  const startJobSchema = z.object({
    type: z.enum(['inventory', 'orders']),
    batchSize: z.number().int().min(10).max(100).optional().default(30),
  });
  
  // Start background embedding job (now uses persistent worker)
  app.post("/api/embeddings/jobs/start", isApproved, async (req, res) => {
    try {
      // Validate input
      const validated = startJobSchema.parse(req.body);
      
      // Use the new persistent embedding worker instead of the old in-memory system
      const { createEmbeddingJob } = await import('./services/embedding-worker');
      const job = await createEmbeddingJob(validated.type, 'manual');
      
      res.json({ 
        jobId: job.id, 
        message: 'Background job started - will continue until 100% complete',
        persistent: true
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ 
          error: "Invalid input", 
          details: error.errors 
        });
      }
      console.error("Start job error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to start background job" 
      });
    }
  });

  // Stop background embedding job
  app.post("/api/embeddings/jobs/:jobId/stop", isApproved, async (req, res) => {
    try {
      const { jobId } = req.params;
      
      const { jobManager } = await import('./services/backgroundJobs');
      const stopped = jobManager.stopJob(jobId);
      
      if (stopped) {
        res.json({ message: 'Job stopped successfully' });
      } else {
        res.status(404).json({ error: 'Job not found or not running' });
      }
    } catch (error) {
      console.error("Stop job error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to stop job" 
      });
    }
  });

  // Get job status
  app.get("/api/embeddings/jobs/:jobId", isApproved, async (req, res) => {
    try {
      const { jobId } = req.params;
      
      const { jobManager } = await import('./services/backgroundJobs');
      const job = jobManager.getJobStatus(jobId);
      
      if (job) {
        res.json(job);
      } else {
        res.status(404).json({ error: 'Job not found' });
      }
    } catch (error) {
      console.error("Get job status error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get job status" 
      });
    }
  });

  // Get active job for a type (now queries database)
  app.get("/api/embeddings/jobs/active/:type", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { type } = req.params;
      
      if (!type || !['inventory', 'orders', 'sets'].includes(type)) {
        return res.status(400).json({ error: "Invalid job type. Must be 'inventory', 'orders', or 'sets'" });
      }
      
      // Query the persistent database for active jobs
      const [activeJob] = await db
        .select()
        .from(embeddingJobs)
        .where(and(eq(embeddingJobs.orgId, orgId), sql`${embeddingJobs.jobType} = ${type} AND ${embeddingJobs.status} IN ('pending', 'processing')`))
        .orderBy(sql`${embeddingJobs.createdAt} DESC`)
        .limit(1);
      
      res.json(activeJob || null);
    } catch (error) {
      console.error("Get active job error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get active job" 
      });
    }
  });

  // Get all jobs
  app.get("/api/embeddings/jobs", isApproved, async (req, res) => {
    try {
      const { jobManager } = await import('./services/backgroundJobs');
      const jobs = jobManager.getAllJobs();
      
      res.json(jobs);
    } catch (error) {
      console.error("Get all jobs error:", error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to get jobs" 
      });
    }
  });

  // BrickLink Catalog Search Endpoint
  app.get("/api/bricklink/search", isApproved, async (req, res) => {
    try {
      const { itemNo, itemType } = req.query;
      
      if (!itemNo || !itemType) {
        return res.status(400).json({ error: "Missing itemNo or itemType parameter" });
      }
      
      // Search BrickLink catalog
      const catalogItem = await searchBricklinkCatalogItem(itemNo as string, itemType as string);
      
      if (catalogItem) {
        res.json({ item: catalogItem });
      } else {
        res.status(404).json({ error: "Item not found in BrickLink catalog" });
      }
    } catch (error) {
      console.error('BrickLink search error:', error);
      res.status(500).json({ 
        error: error instanceof Error ? error.message : "Failed to search BrickLink catalog"
      });
    }
  });

  // Brickognize Image Recognition Endpoint
  const upload = multer({ storage: multer.memoryStorage() });
  
  app.post("/api/brickognize/identify", upload.single('image'), isApproved, async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }
      
      const itemType = req.body.itemType || 'parts'; // Default to parts
      
      // Use the form-data package with axios for proper Node.js compatibility
      const formData = new FormData();
      formData.append('query_image', req.file.buffer, {
        filename: req.file.originalname || 'image.jpg',
        contentType: req.file.mimetype || 'image/jpeg',
      });
      
      // Call Brickognize API using axios (handles streams properly)
      const brickognizeUrl = `https://api.brickognize.com/predict/${itemType}/`;
      const response = await axios.post(brickognizeUrl, formData, {
        headers: formData.getHeaders(),
      });
      
      const { trackUsage } = await import('./services/ai-usage-tracker');
      trackUsage({
        service: 'brickognize',
        model: 'brickognize-v1',
        operation: 'brickspotter-scan',
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        orgId: reqOrgId(req),
      });
      res.json(response.data);
    } catch (error: any) {
      console.error('Brickognize identification error:', error.response?.data || error.message);
      const statusCode = error.response?.status || 500;
      res.status(statusCode).json({ 
        error: statusCode === 400 
          ? "Brickognize couldn't identify that image. Try a clearer photo!"
          : "Oops! E.L.F.I.E. couldn't identify that LEGO piece. Try again!"
      });
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
          nudge: limitCheck.nudgeLevel,
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
      if (limitCheck.nudgeLevel !== 'none') {
        res.setHeader('X-Tier-Nudge', limitCheck.nudgeLevel);
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
        universalCatalogScheduleEnabled: appSettings.universalCatalogScheduleEnabled,
        universalCatalogRefreshMonths:   appSettings.universalCatalogRefreshMonths,
        universalCatalogRetryDays:       appSettings.universalCatalogRetryDays,
      }).from(appSettings).where(eq(appSettings.id, orgId)).limit(1);

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
      const stats = await db
        .select({
          totalLots: sql<number>`COUNT(*)`,
          totalParts: sql<number>`SUM(${blInventory.quantity})`,
          totalValue: sql<number>`SUM(${blInventory.quantity} * CAST(${blInventory.unitPrice} AS DECIMAL))`,
          totalCost: sql<number>`SUM(${blInventory.quantity} * COALESCE(CAST(${blInventory.myCost} AS DECIMAL), 0))`,
        })
        .from(blInventory)
        .where(eq(blInventory.orgId, orgId));

      const colorCount = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${blInventory.colorId})` })
        .from(blInventory)
        .where(eq(blInventory.orgId, orgId));

      const categoryCount = await db
        .select({ count: sql<number>`COUNT(DISTINCT ${blCatalog.categoryId})` })
        .from(blInventory)
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .where(eq(blInventory.orgId, orgId));

      res.json({
        totalLots: Number(stats[0]?.totalLots) || 0,
        totalParts: Number(stats[0]?.totalParts) || 0,
        totalValue: Number(stats[0]?.totalValue) || 0,
        totalCost: Number(stats[0]?.totalCost) || 0,
        totalColors: Number(colorCount[0]?.count) || 0,
        totalCategories: Number(categoryCount[0]?.count) || 0,
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

  // Image proxy route - serves part images with white backgrounds removed
  // Accepts URL parameter for direct image processing
  app.get("/api/images/proxy", async (req, res) => {
    try {
      const imageUrl = req.query.url as string;

      if (!imageUrl) {
        return res.status(400).json({ error: "Missing url parameter" });
      }

      // Strict validation for SSRF protection
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(imageUrl);
      } catch {
        return res.status(400).json({ error: "Invalid URL format" });
      }

      // Only allow HTTPS protocol
      if (parsedUrl.protocol !== 'https:') {
        return res.status(400).json({ error: "Only HTTPS URLs are allowed" });
      }

      // Strict allowlist: only cdn.rebrickable.com domain
      if (parsedUrl.hostname !== 'cdn.rebrickable.com') {
        return res.status(400).json({ error: "Only cdn.rebrickable.com URLs are allowed" });
      }

      // Normalize the URL to prevent bypasses
      const normalizedUrl = parsedUrl.toString();

      const imageBuffer = await processImageFromUrl(normalizedUrl);

      if (!imageBuffer) {
        return res.status(404).json({ error: "Image not found or failed to process" });
      }

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
      res.send(imageBuffer);
    } catch (error) {
      console.error(`Error serving proxied image:`, error);
      res.status(500).json({ error: "Failed to process image" });
    }
  });

  // Legacy route - kept for backward compatibility
  app.get("/api/images/parts/:partNum/:colorId", async (req, res) => {
    try {
      const { partNum, colorId } = req.params;
      const colorIdNum = parseInt(colorId);

      if (isNaN(colorIdNum)) {
        return res.status(400).json({ error: "Invalid color ID" });
      }

      const imageBuffer = await getProcessedPartImage(partNum, colorIdNum);

      if (!imageBuffer) {
        return res.status(404).json({ error: "Image not found" });
      }

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
      res.send(imageBuffer);
    } catch (error) {
      console.error(`Error serving image for ${req.params.partNum} color ${req.params.colorId}:`, error);
      res.status(500).json({ error: "Failed to process image" });
    }
  });

  // In-memory cache for discrepancies (expires after 5 minutes)
  const discrepancyCache = new Map<string, { data: any[]; timestamp: number }>();
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Persistent BOID lookup cache (never expires - reduces API calls)
  const boidLookupCache = new Map<string, string | null>();

  // Get Platform Sync Status
  app.get("/api/platform-sync/status", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      // Get BrickLink inventory stats (source of truth)
      const blStats = await db
        .select({
          totalLots: sql<number>`COUNT(*)`,
          totalParts: sql<number>`SUM(${blInventory.quantity})`,
        })
        .from(blInventory)
        .where(eq(blInventory.orgId, orgId));

      const brickLinkStats = {
        totalLots: Number(blStats[0]?.totalLots) || 0,
        totalParts: Number(blStats[0]?.totalParts) || 0,
        lastSyncedAt: new Date().toISOString(),
      };

      // Check if BrickOwl API key is configured
      const settings = await getOrgSettings(orgId);
      const brickowlEnabled = !!(settings?.brickowlApiKey || process.env.BRICKOWL_API_KEY);

      // Get actual BrickOwl inventory stats if enabled
      let brickowlStats = {
        totalLots: 0,
        totalParts: 0,
        lastSyncedAt: null as string | null,
      };

      let priceDifferencesCount = 0;
      let quantityDifferencesCount = 0;
      let remarksDifferencesCount = 0;
      let descriptionDifferencesCount = 0;

      if (brickowlEnabled) {
        try {
          const { getBrickOwlInventory, lookupBoid } = await import('./services/brickowl');
          const brickowlInventory = await getBrickOwlInventory(false); // Get all, not just active
          
          brickowlStats.totalLots = brickowlInventory.length;
          brickowlStats.totalParts = brickowlInventory.reduce((sum: number, lot: any) => {
            const qty = parseInt(lot.qty || lot.quantity || '0');
            return sum + qty;
          }, 0);
          brickowlStats.lastSyncedAt = new Date().toISOString();

          // Cache arrays for detailed discrepancies
          const missingItems: any[] = [];
          const priceDiscrepancies: any[] = [];
          const quantityDiscrepancies: any[] = [];
          const remarksDiscrepancies: any[] = [];
          const descriptionDiscrepancies: any[] = [];

          // SIMPLIFIED COMPARISON: Use external_lot_ids.other (BrickLink inventory ID) for matching
          const blItemsMap = new Map<number, any>();
          const blItems = await db.select().from(blInventory).where(eq(blInventory.orgId, orgId));
          
          // Build lookup map: BrickLink inventory ID -> BrickLink item
          for (const blItem of blItems) {
            blItemsMap.set(blItem.id, blItem);
          }

          // Track matched BrickLink inventory IDs
          const matchedBlIds = new Set<number>();
          
          // Compare each BrickOwl lot against BrickLink inventory
          for (const boLot of brickowlInventory) {
            // Extract BrickLink inventory ID from external_lot_ids.other
            const blInventoryId = boLot.external_lot_ids?.other ? 
              parseInt(boLot.external_lot_ids.other) : null;
            
            if (!blInventoryId) {
              // No BrickLink inventory ID linked - skip
              continue;
            }
            
            const blItem = blItemsMap.get(blInventoryId);
            
            if (!blItem) {
              // BrickOwl lot references non-existent BrickLink item - skip
              continue;
            }
            
            matchedBlIds.add(blInventoryId);
            
            const boQty = parseInt(boLot.qty || '0');
            const boPrice = parseFloat(boLot.price || '0');
            const blPrice = blItem.unitPrice ? parseFloat(blItem.unitPrice) : 0;
            
            // Check for quantity differences
            if (boQty !== blItem.quantity) {
              quantityDifferencesCount++;
              quantityDiscrepancies.push({
                itemNo: blItem.itemNo,
                itemName: blItem.itemName,
                colorName: blItem.colorName,
                blQuantity: blItem.quantity,
                blPrice,
                boQuantity: boQty,
                boPrice,
                difference: 'quantity',
                qtyDiff: boQty - blItem.quantity,
              });
            }
            
            // Check for price differences (use small epsilon for float comparison)
            if (Math.abs(boPrice - blPrice) > 0.001) {
              priceDifferencesCount++;
              priceDiscrepancies.push({
                itemNo: blItem.itemNo,
                itemName: blItem.itemName,
                colorName: blItem.colorName,
                blQuantity: blItem.quantity,
                blPrice,
                boQuantity: boQty,
                boPrice,
                difference: 'price',
                priceDiff: boPrice - blPrice,
              });
            }
            
            // Check for personal_note (remarks) differences
            // Decode HTML entities from both sides before comparing and displaying
            const boRemarks = boLot.personal_note || '';
            const blRemarks = blItem.remarks || '';
            const blRemarksDecoded = decodeHtmlEntities(blRemarks);
            const boRemarksDecoded = decodeHtmlEntities(boRemarks);
            if (boRemarksDecoded !== blRemarksDecoded) {
              remarksDifferencesCount++;
              remarksDiscrepancies.push({
                itemNo: blItem.itemNo,
                itemName: blItem.itemName,
                colorName: blItem.colorName,
                blQuantity: blItem.quantity,
                blPrice,
                boQuantity: boQty,
                boPrice,
                difference: 'remarks',
                blRemarks: blRemarksDecoded,
                boRemarks: boRemarksDecoded,
              });
            }
            
            // Check for public_note (description) differences
            // Decode HTML entities from both sides before comparing and displaying
            const boDescription = boLot.public_note || '';
            const blDescription = blItem.description || '';
            const blDescriptionDecoded = decodeHtmlEntities(blDescription);
            const boDescriptionDecoded = decodeHtmlEntities(boDescription);
            if (boDescriptionDecoded !== blDescriptionDecoded) {
              descriptionDifferencesCount++;
              descriptionDiscrepancies.push({
                itemNo: blItem.itemNo,
                itemName: blItem.itemName,
                colorName: blItem.colorName,
                blQuantity: blItem.quantity,
                blPrice,
                boQuantity: boQty,
                boPrice,
                difference: 'description',
                blDescription: blDescriptionDecoded,
                boDescription: boDescriptionDecoded,
              });
            }
          }

          // Find missing items (BrickLink items not matched in BrickOwl)
          // Limit to 100 for display performance
          let missingCount = 0;
          for (const [inventoryId, blItem] of Array.from(blItemsMap.entries())) {
            if (!matchedBlIds.has(inventoryId)) {
              if (missingCount < 100) {
                const blPrice = blItem.unitPrice ? parseFloat(blItem.unitPrice) : 0;
                missingItems.push({
                  itemNo: blItem.itemNo,
                  itemName: blItem.itemName,
                  colorName: blItem.colorName,
                  blQuantity: blItem.quantity,
                  blPrice,
                  boQuantity: 0,
                  boPrice: 0,
                  difference: 'missing',
                });
              }
              missingCount++;
            }
          }

          // Cache the detailed discrepancies
          const now = Date.now();
          discrepancyCache.set('BrickOwl:missing', { data: missingItems, timestamp: now });
          discrepancyCache.set('BrickOwl:price', { data: priceDiscrepancies, timestamp: now });
          discrepancyCache.set('BrickOwl:quantity', { data: quantityDiscrepancies, timestamp: now });
          discrepancyCache.set('BrickOwl:remarks', { data: remarksDiscrepancies, timestamp: now });
          discrepancyCache.set('BrickOwl:description', { data: descriptionDiscrepancies, timestamp: now });
        } catch (error) {
          console.error('Failed to fetch BrickOwl inventory stats:', error);
        }
      }

      const platformSyncStatus = {
        source: {
          name: 'BrickLink',
          stats: brickLinkStats,
        },
        targets: [
          {
            name: 'BrickOwl',
            enabled: brickowlEnabled,
            stats: brickowlStats,
            discrepancies: {
              missingLots: Math.max(0, brickLinkStats.totalLots - brickowlStats.totalLots),
              missingParts: Math.max(0, brickLinkStats.totalParts - brickowlStats.totalParts),
              priceDifferences: priceDifferencesCount,
              quantityDifferences: quantityDifferencesCount,
              remarksDifferences: remarksDifferencesCount,
              descriptionDifferences: descriptionDifferencesCount,
            },
          },
        ],
        lastSyncStatus: 'idle' as const,
        lastSyncMessage: null,
      };

      res.json(platformSyncStatus);
    } catch (error) {
      console.error("Error fetching platform sync status:", error);
      res.status(500).json({ error: "Failed to fetch platform sync status" });
    }
  });

  // Get detailed discrepancies for a specific platform and type
  app.get("/api/platform-sync/discrepancies/:platform/:type", isApproved, async (req: any, res) => {
    try {
      const { platform, type } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const orgId = reqOrgId(req);

      if (platform !== 'BrickOwl') {
        return res.status(400).json({ error: `Platform ${platform} is not supported yet` });
      }

      const settings = await getOrgSettings(orgId);
      const brickowlEnabled = !!(settings?.brickowlApiKey || process.env.BRICKOWL_API_KEY);

      if (!brickowlEnabled) {
        return res.status(400).json({ error: 'BrickOwl API key not configured' });
      }

      // Check cache first
      const cacheKey = `${platform}:${type}`;
      const cached = discrepancyCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp < CACHE_TTL)) {
        // Return cached data
        const discrepancies = cached.data.slice(0, limit);
        return res.json({ discrepancies, total: cached.data.length });
      }

      // Cache miss or expired - return empty for now (should call status endpoint first)
      res.json({ 
        discrepancies: [], 
        total: 0,
        message: 'Cache expired. Please refresh the platform sync status first.' 
      });
    } catch (error) {
      console.error("Error fetching discrepancies:", error);
      res.status(500).json({ error: "Failed to fetch discrepancies" });
    }
  });

  // Sync BrickLink inventory to platform
  app.post("/api/platform-sync/sync", isApproved, async (req, res) => {
    try {
      const { platform, limit } = req.body;

      if (platform !== 'BrickOwl') {
        return res.status(400).json({ 
          success: false,
          error: `Platform ${platform} is not supported yet. Only BrickOwl is available.` 
        });
      }

      const orgId = reqOrgId(req);
      const [settingsRow] = await db.select({ channelSyncMode: appSettings.channelSyncMode })
        .from(appSettings).where(eq(appSettings.orgId, orgId)).limit(1);
      const syncMode = (settingsRow?.channelSyncMode === 'quantity_only' ? 'quantity_only' : 'full_control') as 'full_control' | 'quantity_only';

      console.log(`[Platform Sync] Starting BrickLink → BrickOwl sync${limit ? ` (limit: ${limit})` : ''} (mode: ${syncMode})...`);
      
      const result = await syncBrickLinkToBrickOwl(limit, syncMode);
      
      console.log(`[Platform Sync] Complete: ${result.lotsCreated} created, ${result.lotsUpdated} updated, ${result.lotsSkipped} skipped`);

      res.json({
        success: true,
        platform,
        result,
      });
    } catch (error) {
      console.error("Platform sync error:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to sync platform",
      });
    }
  });

  // Verify BrickOwl lots endpoint
  app.post('/api/platform-sync/verify-lots', isApproved, async (req, res) => {
    try {
      const { externalIds } = req.body;
      
      if (!externalIds || !Array.isArray(externalIds)) {
        return res.status(400).json({ error: 'externalIds array required' });
      }

      // Fetch all BrickOwl inventory
      const { getBrickOwlInventory } = await import('./services/brickowl');
      const brickowlInventory = await getBrickOwlInventory(false);
      
      // Filter for the specific lots
      const verifiedLots = brickowlInventory
        .filter((lot: any) => externalIds.includes(lot.external_id_1))
        .map((lot: any) => ({
          external_id_1: lot.external_id_1,
          boid: lot.boid,
          name: lot.name,
          color: lot.col_name || 'N/A',
          condition: lot.full_con || lot.con,
          quantity: lot.qty,
          price: lot.price,
          lot_id: lot.lot_id,
          url: lot.url,
        }));

      const response = {
        success: true,
        lots: verifiedLots,
        total: verifiedLots.length,
      };
      
      return res.json(response);
    } catch (error: any) {
      console.error('[Verify Lots] Error:', error);
      return res.status(500).json({ error: error.message });
    }
  });


  // ============================================
  // Sync Issues Routes
  // ============================================
  
  // Get all sync issues (with optional filters)
  app.get("/api/sync-issues", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { status, syncType, platform, severity } = req.query;
      
      const conditions = [eq(syncIssues.orgId, orgId)];
      
      if (status) {
        conditions.push(eq(syncIssues.status, status as string));
      }
      if (syncType) {
        conditions.push(eq(syncIssues.syncType, syncType as string));
      }
      if (platform) {
        conditions.push(eq(syncIssues.platform, platform as string));
      }
      if (severity) {
        conditions.push(eq(syncIssues.severity, severity as string));
      }
      
      const issues = await db
        .select()
        .from(syncIssues)
        .where(and(...conditions))
        .orderBy(desc(syncIssues.createdAt))
        .limit(100);
      
      res.json({
        success: true,
        issues,
        count: issues.length,
      });
    } catch (error) {
      console.error("Error fetching sync issues:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch sync issues",
      });
    }
  });
  
  // Get sync issue stats
  app.get("/api/sync-issues/stats", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const openIssues = await db
        .select({ count: sql<number>`count(*)` })
        .from(syncIssues)
        .where(and(eq(syncIssues.orgId, orgId), eq(syncIssues.status, 'open')));
      
      const criticalIssues = await db
        .select({ count: sql<number>`count(*)` })
        .from(syncIssues)
        .where(and(eq(syncIssues.orgId, orgId), eq(syncIssues.status, 'open'), eq(syncIssues.severity, 'critical')));
      
      res.json({
        success: true,
        stats: {
          open: Number(openIssues[0]?.count || 0),
          critical: Number(criticalIssues[0]?.count || 0),
        },
      });
    } catch (error) {
      console.error("Error fetching sync issue stats:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch stats",
      });
    }
  });
  
  // Create a new sync issue
  app.post("/api/sync-issues", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const issue = insertSyncIssueSchema.parse(req.body);
      
      const [newIssue] = await db.insert(syncIssues).values({ ...issue, orgId }).returning();
      
      res.json({
        success: true,
        issue: newIssue,
      });
    } catch (error) {
      console.error("Error creating sync issue:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to create sync issue",
      });
    }
  });
  
  // Update sync issue (resolve, ignore, etc.)
  app.patch("/api/sync-issues/:id", isApproved, async (req, res) => {
    try {
      const { id } = req.params;
      const { status, resolvedBy } = req.body;
      
      const updates: any = { status };
      
      if (status === 'resolved' || status === 'ignored') {
        updates.resolvedAt = new Date();
        updates.resolvedBy = resolvedBy || 'user';
      }
      
      const [updatedIssue] = await db
        .update(syncIssues)
        .set(updates)
        .where(eq(syncIssues.id, id))
        .returning();
      
      if (!updatedIssue) {
        return res.status(404).json({
          success: false,
          error: "Issue not found",
        });
      }
      
      res.json({
        success: true,
        issue: updatedIssue,
      });
    } catch (error) {
      console.error("Error updating sync issue:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to update issue",
      });
    }
  });
  
  // Bulk-resolve all open issues for given syncTypes (clears an entire dashboard group)
  app.post("/api/sync-issues/bulk-resolve", isApproved, async (req, res) => {
    try {
      const { syncTypes, status = "resolved" } = req.body as { syncTypes: string[]; status?: string };

      if (!Array.isArray(syncTypes) || syncTypes.length === 0) {
        return res.status(400).json({ success: false, error: "syncTypes array required" });
      }

      const conditions = [
        eq(syncIssues.status, "open"),
        inArray(syncIssues.syncType, syncTypes),
      ];

      const updated = await db
        .update(syncIssues)
        .set({ status, resolvedAt: new Date(), resolvedBy: "user" })
        .where(and(...conditions))
        .returning({ id: syncIssues.id });

      res.json({ success: true, resolved: updated.length });
    } catch (error) {
      console.error("Error bulk-resolving sync issues:", error);
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : "Failed" });
    }
  });

  // Delete a sync issue
  app.delete("/api/sync-issues/:id", isApproved, async (req, res) => {
    try {
      const { id } = req.params;
      
      await db.delete(syncIssues).where(eq(syncIssues.id, id));
      
      res.json({
        success: true,
      });
    } catch (error) {
      console.error("Error deleting sync issue:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete issue",
      });
    }
  });

  // Get Recently Updated/Added Inventory Items (MUST be before /api/inventory/:id)
  app.get("/api/inventory/recent-updates", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
      const type = req.query.type as string; // 'new' or 'updated'
      
      const baseSelect = {
        id: blInventory.id,
        inventoryId: blInventory.id,
        itemNo: blInventory.itemNo,
        itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
        colorId: blInventory.colorId,
        colorName: blColors.name,
        colorRgb: blColors.rgb,
        quantity: blInventory.quantity,
        unitPrice: blInventory.unitPrice,
        newOrUsed: blInventory.newOrUsed,
        syncedAt: blInventory.syncedAt,
        updatedAt: blInventory.updatedAt,
      };

      let recentItems;

      if (type === 'new') {
        // Newly added items: syncedAt and updatedAt are very close (within 5 seconds)
        recentItems = await db
          .select(baseSelect)
          .from(blInventory)
          .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
          .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
          .where(and(eq(blInventory.orgId, orgId), sql`EXTRACT(EPOCH FROM (${blInventory.updatedAt} - ${blInventory.syncedAt})) < 5`))
          .orderBy(desc(blInventory.syncedAt))
          .limit(limit);
      } else if (type === 'updated') {
        // Updated items: updatedAt is significantly later than syncedAt (more than 5 seconds)
        recentItems = await db
          .select(baseSelect)
          .from(blInventory)
          .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
          .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
          .where(and(eq(blInventory.orgId, orgId), sql`EXTRACT(EPOCH FROM (${blInventory.updatedAt} - ${blInventory.syncedAt})) >= 5`))
          .orderBy(desc(blInventory.updatedAt))
          .limit(limit);
      } else {
        // All recent items (default behavior)
        recentItems = await db
          .select(baseSelect)
          .from(blInventory)
          .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
          .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
          .where(eq(blInventory.orgId, orgId))
          .orderBy(desc(blInventory.updatedAt))
          .limit(limit);
      }

      res.json(recentItems);
    } catch (error) {
      console.error("Error fetching recent inventory updates:", error);
      res.status(500).json({ error: "Failed to fetch recent updates" });
    }
  });

  // Price-o-Matic: Get price guide for inventory item (MUST be before /api/inventory/:id)
  app.get("/api/inventory/price-guide/:itemNo/:itemType", isApproved, async (req, res) => {
    try {
      const { itemNo, itemType } = req.params;
      const colorId = req.query.color_id ? parseInt(req.query.color_id as string) : undefined;
      const newOrUsed = (req.query.new_or_used as string) || 'N'; // Default to New if not specified
      const premiumPercentage = req.query.premium ? parseInt(req.query.premium as string) : 15;

      if (!itemNo || !itemType) {
        return res.status(400).json({ error: "Item number and type are required" });
      }

      console.log(`[Price-o-Matic] Fetching price guide for ${itemType}/${itemNo}${colorId ? `/${colorId}` : ''}/${newOrUsed}`);

      const priceData = await fetchPriceOMagicData(itemNo, itemType, colorId, newOrUsed, premiumPercentage);

      res.json(priceData);
    } catch (error) {
      console.error("[Price-o-Matic] Error fetching price guide:", error);
      res.status(500).json({ 
        error: "Failed to fetch price guide", 
        message: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  app.get("/api/inventory/price-guide-full/:itemNo/:itemType", isApproved, async (req: any, res) => {
    try {
      const { itemNo, itemType } = req.params;
      const colorId = req.query.color_id ? parseInt(req.query.color_id as string) : null;
      const myCondition = (req.query.new_or_used as string) || 'N';
      const orgId = reqOrgId(req);

      if (!itemNo || !itemType) {
        return res.status(400).json({ error: "Item number and type are required" });
      }

      const colorCondition = colorId != null && colorId > 0
        ? eq(priceGuideCache.colorId, colorId)
        : sql`${priceGuideCache.colorId} IN (0, -1)`;

      const rows = await db
        .select({
          newOrUsed: priceGuideCache.newOrUsed,
          stockAvgPrice: priceGuideCache.stockAvgPrice,
          stockMinPrice: priceGuideCache.stockMinPrice,
          stockMaxPrice: priceGuideCache.stockMaxPrice,
          stockTotalLots: priceGuideCache.stockTotalLots,
          stockQuantity: sql<number>`${priceGuideCache}.stock_quantity`,
          soldAvgPrice: priceGuideCache.soldAvgPrice,
          soldMinPrice: priceGuideCache.soldMinPrice,
          soldMaxPrice: priceGuideCache.soldMaxPrice,
          soldTotalLots: priceGuideCache.soldTotalLots,
          soldQuantity: sql<number>`${priceGuideCache}.sold_quantity`,
          suggestedPrice: priceGuideCache.suggestedPrice,
          premiumPercentage: priceGuideCache.premiumPercentage,
          fetchedAt: priceGuideCache.fetchedAt,
        })
        .from(priceGuideCache)
        .where(and(
          sql`UPPER(${priceGuideCache.itemNo}) = UPPER(${itemNo})`,
          eq(priceGuideCache.itemType, itemType),
          colorCondition,
        ));

      const nRow = rows.find(r => r.newOrUsed === 'N') || null;
      const uRow = rows.find(r => r.newOrUsed === 'U') || null;

      const settings = await getOrgSettings(orgId);
      const wCeiling = settings?.pomWeightCeiling ?? 0.4;
      const wVelocity = settings?.pomWeightVelocity ?? 0.3;
      const wScarcity = settings?.pomWeightScarcity ?? 0.2;
      const wUndercut = settings?.pomWeightUndercut ?? 0.1;

      const myRow = myCondition === 'U' ? uRow : nRow;
      const soldQty = myRow?.soldQuantity ?? myRow?.soldTotalLots ?? 0;
      const stockQty = myRow?.stockQuantity ?? myRow?.stockTotalLots ?? 0;
      const stockMin = parseFloat(myRow?.stockMinPrice || '0');

      const currentPriceStr = req.query.current_price as string;
      const currentPrice = currentPriceStr ? parseFloat(currentPriceStr) : 0;

      const marketPeakRows = await db
        .select({ peakSold: sql<string>`MAX(${priceGuideCache.soldMaxPrice})` })
        .from(priceGuideCache)
        .where(and(
          sql`UPPER(${priceGuideCache.itemNo}) = UPPER(${itemNo})`,
          eq(priceGuideCache.itemType, itemType),
          colorCondition,
        ));
      const marketPeak = marketPeakRows[0]?.peakSold ? parseFloat(marketPeakRows[0].peakSold) : null;

      const priceCeilingRatio = (marketPeak !== null && currentPrice > 0)
        ? Number((marketPeak / currentPrice).toFixed(3))
        : null;
      const demandVelocity = (stockQty > 0)
        ? Number((soldQty / stockQty).toFixed(3))
        : null;
      const marketScarcityVal = (stockQty > 0)
        ? Number((1 / stockQty).toFixed(6))
        : null;
      const undercutRatio = (stockMin > 0 && currentPrice > 0)
        ? Number((currentPrice / stockMin).toFixed(3))
        : null;

      let repricingScore: number | null = null;
      const hasAny = priceCeilingRatio !== null || demandVelocity !== null || marketScarcityVal !== null || undercutRatio !== null;
      if (hasAny) {
        const cC = (priceCeilingRatio ?? 0) * wCeiling;
        const vC = (demandVelocity ?? 0) * wVelocity;
        const sC = (marketScarcityVal ?? 0) * wScarcity;
        const uC = (undercutRatio && undercutRatio > 0) ? (1 / undercutRatio) * wUndercut : 0;
        repricingScore = Number((cC + vC + sC + uC).toFixed(2));
      }

      const computeSuggested = (row: typeof nRow) => {
        if (!row) return null;
        if (row.suggestedPrice && parseFloat(row.suggestedPrice) > 0) return row.suggestedPrice;
        const soldAvg = parseFloat(row.soldAvgPrice || '0');
        const soldMax = parseFloat(row.soldMaxPrice || '0');
        const stkMin = parseFloat(row.stockMinPrice || '0');
        const sQty = row.soldQuantity ?? (row.soldTotalLots ? parseInt(String(row.soldTotalLots)) : 0);
        const lQty = row.stockQuantity ?? (row.stockTotalLots ? parseInt(String(row.stockTotalLots)) : 0);
        if (soldAvg <= 0 && stkMin <= 0) return null;
        const base = (soldAvg > 0 ? soldAvg * 0.5 : 0) + (stkMin > 0 ? stkMin * 0.3 : 0) + (soldMax > 0 ? soldMax * 0.2 : 0);
        if (base <= 0) return null;
        const vel = lQty > 0 ? sQty / lQty : 0;
        const demandAdj = 1 + vel * 0.25;
        const raw = base * demandAdj;
        const capLimit = stkMin > 0 ? stkMin * 1.15 : raw;
        const cappedRaw = raw <= capLimit ? raw : capLimit + (raw - capLimit) * 0.3;
        const floor = stkMin > 0 ? stkMin * 0.95 : 0;
        const suggested = Math.max(cappedRaw * 1.10, floor);
        return suggested.toFixed(2);
      };

      res.json({
        N: nRow ? {
          soldQty: nRow.soldQuantity ?? nRow.soldTotalLots ?? null,
          soldMin: nRow.soldMinPrice,
          soldAvg: nRow.soldAvgPrice,
          soldMax: nRow.soldMaxPrice,
          listedQty: nRow.stockQuantity ?? nRow.stockTotalLots ?? null,
          listedMin: nRow.stockMinPrice,
          listedAvg: nRow.stockAvgPrice,
          listedMax: nRow.stockMaxPrice,
          suggestedPrice: computeSuggested(nRow),
        } : null,
        U: uRow ? {
          soldQty: uRow.soldQuantity ?? uRow.soldTotalLots ?? null,
          soldMin: uRow.soldMinPrice,
          soldAvg: uRow.soldAvgPrice,
          soldMax: uRow.soldMaxPrice,
          listedQty: uRow.stockQuantity ?? uRow.stockTotalLots ?? null,
          listedMin: uRow.stockMinPrice,
          listedAvg: uRow.stockAvgPrice,
          listedMax: uRow.stockMaxPrice,
          suggestedPrice: computeSuggested(uRow),
        } : null,
        scoring: {
          ceiling: priceCeilingRatio,
          velocity: demandVelocity,
          scarcity: marketScarcityVal,
          undercut: undercutRatio,
          score: repricingScore,
          weights: { wCeiling, wVelocity, wScarcity, wUndercut },
        },
        fetchedAt: myRow?.fetchedAt ?? null,
      });
    } catch (error) {
      console.error("[POM Full Guide] Error:", error);
      res.status(500).json({ error: "Failed to fetch full price guide" });
    }
  });

  // On-demand pricing — fetches stock guide + computes suggested price for a specific lot
  // Called when user explicitly clicks "Get pricing" in filter results or spot lookup
  app.post("/api/priceomatic/fetch-pricing", isApproved, async (req, res) => {
    try {
      const { itemNo, itemType, colorId, newOrUsed } = req.body;
      if (!itemNo || !itemType || !newOrUsed) {
        return res.status(400).json({ error: "itemNo, itemType and newOrUsed are required" });
      }
      const colorIdNum = colorId != null ? parseInt(colorId) : undefined;

      // Force full refresh: delete existing cache entry so fetchPriceOMagicData re-fetches both sold + stock
      const { priceGuideCache: pgc } = await import("@shared/schema");
      await db.delete(pgc).where(
        and(
          eq(pgc.itemNo, itemNo),
          eq(pgc.itemType, itemType),
          eq(pgc.colorId, colorIdNum ?? -1),
          eq(pgc.newOrUsed, newOrUsed)
        )
      );

      const result = await fetchPriceOMagicData(
        itemNo,
        itemType,
        colorIdNum,
        newOrUsed,
      );

      res.json({
        stockAvgPrice: result.stockAvgPrice,
        stockMinPrice: result.stockMinPrice,
        stockMaxPrice: result.stockMaxPrice,
        stockTotalLots: result.stockTotalLots,
        soldAvgPrice: result.soldAvgPrice,
        soldMinPrice: result.soldMinPrice,
        soldMaxPrice: result.soldMaxPrice,
        soldQuantity: result.soldQuantity,
        soldTotalLots: result.soldTotalLots,
      });
    } catch (error) {
      console.error("[POM fetch-pricing] Error:", error);
      res.status(500).json({ error: "Failed to fetch pricing", message: error instanceof Error ? error.message : "Unknown error" });
    }
  });

  // Spot Price Lookup — any part number, in or out of inventory
  app.get("/api/pom/spot-lookup", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { partNo, itemType = 'P', colorId, newOrUsed = 'N', forceRefresh } = req.query;

      if (!partNo || typeof partNo !== 'string' || !partNo.trim()) {
        return res.status(400).json({ error: "partNo is required" });
      }

      const partNoClean = partNo.trim().toUpperCase();
      const colorIdNum = colorId ? parseInt(colorId as string) : undefined;

      // If forceRefresh=true, delete any cached entry so fetchPriceOMagicData makes fresh API calls
      // Use case-insensitive match for itemNo — BrickLink stores some parts with lowercase prefix (e.g. "x161")
      if (forceRefresh === 'true') {
        const { priceGuideCache: pgc } = await import("@shared/schema");
        await db.delete(pgc).where(and(
          eq(pgc.itemNo, partNoClean.toUpperCase()),
          eq(pgc.itemType, itemType as string),
          eq(pgc.colorId, colorIdNum ?? -1),
          eq(pgc.newOrUsed, newOrUsed as string)
        ));
      }

      // Fetch market data (sold guide only when skipStock=true; both when full fetch)
      const priceData = await fetchPriceOMagicData(
        partNoClean,
        itemType as string,
        colorIdNum,
        newOrUsed as string,
        undefined,
        undefined,
        true // skipStock — sold guide only for spot lookup
      );

      // Also check inventory for this part — filter by color if one was specified
      const inventoryLots = await db
        .select({
          id: blInventory.id,
          itemType: blInventory.itemType,
          colorId: blInventory.colorId,
          colorName: blColors.name,
          colorRgb: blColors.rgb,
          quantity: blInventory.quantity,
          unitPrice: blInventory.unitPrice,
          newOrUsed: blInventory.newOrUsed,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .where(
          colorIdNum !== undefined
            ? and(eq(blInventory.orgId, orgId), sql`upper(${blInventory.itemNo}) = ${partNoClean}`, eq(blInventory.colorId, colorIdNum))
            : and(eq(blInventory.orgId, orgId), sql`upper(${blInventory.itemNo}) = ${partNoClean}`)
        )
        .orderBy(blColors.name);

      // Build price data for each unique (colorId, newOrUsed) combo found in inventory.
      // This allows the UI to show a suggested price next to each color variation's current price.
      const mainKey = `${colorIdNum ?? 'null'}_${newOrUsed}`;
      const lotPriceData: Record<string, typeof priceData> = { [mainKey]: priceData };

      // Use the actual itemType from inventory records so the cache key matches the insights JOIN
      // (BrickLink stores "PART", "MINIFIG", etc. — not the single-letter codes)
      const actualItemType = inventoryLots[0]?.itemType ?? (itemType as string);

      // For each unique colorId in inventory, always fetch BOTH N and U so the peak is
      // condition-agnostic (e.g. a Used-only lot still sees the New peak price).
      const seenCombos = new Set<string>([mainKey]);
      const combosToFetch: Array<{ colorId: number | null; itemType: string; newOrUsed: string; key: string }> = [];
      const seenColors = new Set<string>();
      for (const lot of inventoryLots) {
        const colorKey = String(lot.colorId ?? 'null');
        const lotItemType = lot.itemType ?? actualItemType;
        if (!seenColors.has(colorKey)) {
          seenColors.add(colorKey);
          for (const condition of ['N', 'U']) {
            const key = `${colorKey}_${condition}`;
            if (!seenCombos.has(key)) {
              seenCombos.add(key);
              combosToFetch.push({ colorId: lot.colorId, itemType: lotItemType, newOrUsed: condition, key });
            }
          }
        }
      }

      await Promise.all(
        combosToFetch.map(async (combo) => {
          try {
            const pd = await fetchPriceOMagicData(
              partNoClean,
              combo.itemType,
              combo.colorId ?? undefined,
              combo.newOrUsed,
              config.basePremium,
              config,
              true // skipStock — score-only; user fetches pricing on demand
            );
            lotPriceData[combo.key] = pd;
          } catch (err) {
            console.warn(`[POM Spot Lookup] Failed price fetch for combo ${combo.key}:`, err);
          }
        })
      );

      // Compute per-color peak: MAX(soldMaxPrice) across N+U for the same colorId
      const peakByColor = new Map<string, number>();
      Object.entries(lotPriceData).forEach(([key, pd]: [string, any]) => {
        const colorKey = key.substring(0, key.lastIndexOf('_')); // strip trailing _N or _U
        const soldMax = pd.soldMaxPrice ? parseFloat(pd.soldMaxPrice) : 0;
        if (soldMax > 0) {
          peakByColor.set(colorKey, Math.max(peakByColor.get(colorKey) ?? 0, soldMax));
        }
      });

      // Enrich each inventory lot with per-color opportunityScore
      const inventoryLotsEnriched = inventoryLots.map(lot => {
        const colorKey = String(lot.colorId ?? 'null');
        const colorPeak = peakByColor.get(colorKey) ?? null;
        const currentPrice = lot.unitPrice ? parseFloat(lot.unitPrice) : 0;
        const opportunityScore = (colorPeak && currentPrice > 0)
          ? Number((colorPeak / currentPrice).toFixed(2))
          : null;
        return {
          ...lot,
          opportunityScore,
          marketPeakSoldPrice: colorPeak ? colorPeak.toFixed(4) : null,
        };
      });

      // Include flag thresholds so the UI can badge each lot as Too High / Too Low / Well Priced
      const settingsRow = await getOrgSettings(orgId);

      const thresholds = {
        tooHigh: settingsRow?.pomTooHighThreshold ?? 25,
        tooLow: settingsRow?.pomTooLowThreshold ?? 25,
      };

      res.json({ priceData, inventoryLots: inventoryLotsEnriched, lotPriceData, thresholds, storedToCache: true });
    } catch (error: any) {
      console.error("[POM Spot Lookup] Error:", error);
      res.status(500).json({
        error: "Lookup failed",
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Colors list for dropdowns
  app.get("/api/colors", isApproved, async (req, res) => {
    try {
      const colors = await db
        .select({ id: blColors.id, name: blColors.name, rgb: blColors.rgb })
        .from(blColors)
        .orderBy(blColors.name);
      res.json(colors);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch colors" });
    }
  });

  // BrickLink Catalog Search (MUST be before /api/inventory/:id)
  app.get("/api/bricklink/catalog/:itemNo/:itemType", isApproved, async (req, res) => {
    try {
      const { itemNo, itemType } = req.params;

      if (!itemNo || !itemType) {
        return res.status(400).json({ error: "Item number and type are required" });
      }

      console.log(`[BrickLink Catalog] Searching for ${itemType}/${itemNo}`);

      const itemData = await searchBricklinkCatalogItem(itemNo, itemType);

      res.json(itemData);
    } catch (error) {
      console.error("[BrickLink Catalog] Error searching catalog:", error);
      res.status(500).json({ 
        error: "Failed to search BrickLink catalog", 
        message: error instanceof Error ? error.message : "Unknown error" 
      });
    }
  });

  // Browse inventory — paginated list for lots, parts, or categories drawers
  app.get("/api/inventory/browse", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const type = (req.query.type as string) || 'lots';
      const page = Math.max(0, parseInt(req.query.page as string) || 0);
      const limit = 100;
      const offset = page * limit;
      const search = (req.query.search as string || '').trim();

      if (type === 'categories') {
        const searchWhere = search
          ? and(eq(blInventory.orgId, orgId), ilike(blCategories.name, `%${search}%`))
          : eq(blInventory.orgId, orgId);
        const rows = await db
          .select({
            categoryId: blCatalog.categoryId,
            categoryName: blCategories.name,
            lotCount: count(blInventory.id),
            totalQty: sql<number>`SUM(${blInventory.quantity})`,
          })
          .from(blInventory)
          .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
          .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
          .where(searchWhere)
          .groupBy(blCatalog.categoryId, blCategories.name)
          .orderBy(asc(blCategories.name))
          .limit(limit)
          .offset(offset);
        const [{ total }] = await db
          .select({ total: sql<number>`COUNT(DISTINCT ${blCatalog.categoryId})` })
          .from(blInventory)
          .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
          .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
          .where(searchWhere);
        return res.json({ rows, total, page, limit });
      }

      // lots or parts — same data, different sort
      const searchWhere = search
        ? and(
            eq(blInventory.orgId, orgId),
            or(
              ilike(blInventory.itemNo, `%${search}%`),
              ilike(blCatalog.itemName, `%${search}%`),
              ilike(blColors.name, `%${search}%`),
            )
          )
        : eq(blInventory.orgId, orgId);

      const orderBy = type === 'parts'
        ? desc(blInventory.quantity)
        : asc(blInventory.itemNo);

      const rows = await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
          itemType: blInventory.itemType,
          colorId: blInventory.colorId,
          colorName: blColors.name,
          colorRgb: blColors.rgb,
          categoryName: blCategories.name,
          quantity: blInventory.quantity,
          newOrUsed: blInventory.newOrUsed,
          unitPrice: blInventory.unitPrice,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
        .where(searchWhere)
        .orderBy(orderBy)
        .limit(limit)
        .offset(offset);

      const [{ total }] = await db
        .select({ total: sql<number>`COUNT(*)` })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .where(searchWhere);

      res.json({ rows, total, page, limit });
    } catch (error) {
      console.error("Error browsing inventory:", error);
      res.status(500).json({ error: "Failed to browse inventory" });
    }
  });

  // Search for inventory by item number (MUST be before /api/inventory/:id)
  app.get("/api/inventory/search", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { itemNo, colorId, limit = 10 } = req.query;

      if (!itemNo || typeof itemNo !== 'string') {
        return res.status(400).json({ error: "itemNo is required" });
      }

      const parsedColorId = colorId ? parseInt(colorId as string) : null;

      const whereClause = parsedColorId != null
        ? and(eq(blInventory.orgId, orgId), eq(blInventory.itemNo, itemNo), eq(blInventory.colorId, parsedColorId))
        : and(eq(blInventory.orgId, orgId), eq(blInventory.itemNo, itemNo));

      const inventoryLots = await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
          colorId: blInventory.colorId,
          colorName: blColors.name,
          newOrUsed: blInventory.newOrUsed,
          quantity: blInventory.quantity,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .where(whereClause)
        .limit(parseInt(limit as string) || 10);

      res.json(inventoryLots);
    } catch (error) {
      console.error("Error searching inventory:", error);
      res.status(500).json({ error: "Failed to search inventory" });
    }
  });

  // Catalog lookup — fetch BrickLink item details + price guide for non-inventory items
  // Called by BrickSpotter heatmap badge when the scanned part isn't in inventory.
  // Uses 6-month price_guide_cache so BL API calls are rare after first hit.
  // BrickSpotter always uses the platform BL account — orgId is only for DB access control.
  app.get("/api/catalog/lookup/:itemType/:itemNo", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req); // used for DB ownership checks only
      const { itemType, itemNo } = req.params;
      const colorId = req.query.colorId !== undefined ? parseInt(req.query.colorId as string) : undefined;

      const itemTypeMap: Record<string, string> = {
        PART: 'PART', MINIFIG: 'MINIFIG', SET: 'SET', BOOK: 'BOOK', GEAR: 'GEAR', CATALOG: 'CATALOG', INSTRUCTION: 'INSTRUCTION',
      };
      const itemTypePrefix: Record<string, string> = {
        PART: 'P', MINIFIG: 'M', SET: 'S', BOOK: 'B', GEAR: 'G', CATALOG: 'C', INSTRUCTION: 'I',
      };
      const blUrlPrefix = itemTypePrefix[itemType?.toUpperCase()] ?? 'P';
      const apiItemType = itemTypeMap[itemType?.toUpperCase()] ?? itemType?.toUpperCase();

      // Step 1: Check bl_catalog for existing enriched data (name + image from enrichment scheduler)
      const catalogRow = await db.select()
        .from(blCatalog)
        .where(and(
          eq(blCatalog.itemNo, itemNo),
          eq(blCatalog.itemType, itemType),
          colorId != null ? eq(blCatalog.colorId, colorId) : eq(blCatalog.colorId, 0)
        ))
        .limit(1);
      let catalog = catalogRow[0];

      // Step 2: If no bl_catalog row, or image is missing, fetch from BL API — same as catalog-detail-scheduler
      // This enriches non-inventory items on first lookup and caches result in bl_catalog for future calls
      if (!catalog?.imageUrl) {
        try {
          const { data } = await bricklinkCatalogRequest(`/items/${apiItemType}/${itemNo}`, undefined, PLATFORM_ORG_ID);
          if (data) {
            const rawImage = data.image_url as string | null | undefined;
            const rawThumb = data.thumbnail_url as string | null | undefined;
            // Normalize protocol-relative URLs (BL API returns //img.bricklink.com/...)
            const imageUrl = rawImage?.startsWith('//') ? `https:${rawImage}` : (rawImage ?? null);
            const thumbnailUrl = rawThumb?.startsWith('//') ? `https:${rawThumb}` : (rawThumb ?? null);

            await db.insert(blCatalog).values({
              itemNo,
              itemType,
              colorId: colorId ?? 0,
              itemName: data.name || null,
              categoryId: data.category_id || null,
              blCatalogWeight: data.weight ? String(data.weight) : null,
              yearReleased: data.year_released || null,
              imageUrl,
              thumbnailUrl,
            }).onConflictDoUpdate({
              target: [blCatalog.itemNo, blCatalog.itemType, blCatalog.colorId],
              set: {
                itemName: sql`COALESCE(EXCLUDED.item_name, bl_catalog.item_name)`,
                categoryId: sql`COALESCE(EXCLUDED.category_id, bl_catalog.category_id)`,
                imageUrl: sql`COALESCE(EXCLUDED.image_url, bl_catalog.image_url)`,
                thumbnailUrl: sql`COALESCE(EXCLUDED.thumbnail_url, bl_catalog.thumbnail_url)`,
                yearReleased: sql`COALESCE(EXCLUDED.year_released, bl_catalog.year_released)`,
                updatedAt: sql`NOW()`,
              },
            });

            // Re-read to pick up what was just written
            const refreshed = await db.select().from(blCatalog)
              .where(and(
                eq(blCatalog.itemNo, itemNo),
                eq(blCatalog.itemType, itemType),
                colorId != null ? eq(blCatalog.colorId, colorId) : eq(blCatalog.colorId, 0)
              ))
              .limit(1);
            catalog = refreshed[0] ?? catalog;
          }
        } catch (blErr: any) {
          console.warn(`[catalog/lookup] BL API item detail fetch failed for ${itemType}/${itemNo}:`, blErr.message);
        }
      }

      // Step 3: Get price data from cache (fast, color-specific)
      const pomData = await fetchPriceOMagicData(
        itemNo, itemType, colorId, 'N', 15, null, false, undefined, undefined, orgId
      );

      // Step 4: Get color name + rgb from bl_colors
      let colorName: string | null = null;
      let colorRgb: string | null = null;
      if (colorId != null && colorId > 0) {
        const colorRow = await db.select({ name: blColors.name, rgb: blColors.rgb })
          .from(blColors)
          .where(eq(blColors.id, colorId))
          .limit(1);
        if (colorRow.length > 0) {
          colorName = colorRow[0].name;
          colorRgb = colorRow[0].rgb ?? null;
        }
      }

      const resolvedImageUrl = catalog?.imageUrl ?? pomData.imageUrl ?? null;
      const resolvedThumbnailUrl = catalog?.thumbnailUrl ?? pomData.thumbnailUrl ?? null;

      const responseData = {
        id: `catalog-${itemType}-${itemNo}__c${colorId ?? 0}`,
        itemNo,
        itemName: catalog?.itemName ?? pomData.itemName ?? itemNo,
        itemType,
        categoryId: catalog?.categoryId ?? pomData.categoryId ?? null,
        categoryName: null,
        colorId: colorId ?? null,
        colorName: catalog?.colorName ?? colorName ?? null,
        colorRgb,
        quantity: 0,
        newOrUsed: 'N',
        unitPrice: '0.00',
        myCost: null,
        description: null,
        remarks: null,
        myWeight: catalog?.blCatalogWeight ? String(catalog.blCatalogWeight) : (pomData.weight ? String(pomData.weight) : null),
        isBrickLinkCatalog: true,
        imageUrl: resolvedImageUrl,
        thumbnailUrl: resolvedThumbnailUrl,
        bricklinkUrl: `https://www.bricklink.com/v2/catalog/catalogitem.page?${blUrlPrefix}=${itemNo}`,
        loadingPriceOMagic: false,
        priceOMagic: {
          stockAvgPrice: pomData.stockAvgPrice ?? null,
          stockMinPrice: pomData.stockMinPrice ?? null,
          stockMaxPrice: pomData.stockMaxPrice ?? null,
          stockTotalLots: pomData.stockTotalLots ?? null,
          soldAvgPrice: pomData.soldAvgPrice ?? null,
          soldMinPrice: pomData.soldMinPrice ?? null,
          soldMaxPrice: pomData.soldMaxPrice ?? null,
          soldTotalLots: pomData.soldTotalLots ?? null,
          suggestedPrice: pomData.suggestedPrice ?? null,
          itemName: catalog?.itemName ?? pomData.itemName ?? null,
          imageUrl: resolvedImageUrl,
          thumbnailUrl: resolvedThumbnailUrl,
        },
      };

      console.log(`[catalog/lookup] ${itemType}/${itemNo} colorId=${colorId} → imageUrl=${resolvedImageUrl ?? 'null'}`);
      res.json(responseData);
    } catch (error) {
      console.error("[catalog/lookup] Error:", error);
      res.status(500).json({ error: "Failed to fetch catalog data" });
    }
  });

  // Get Inventory Item by ID (MUST be after /api/inventory/stats and price-guide to avoid route conflict)
  app.get("/api/inventory/:id", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const itemId = parseInt(req.params.id);
      if (isNaN(itemId)) {
        return res.status(400).json({ error: "Invalid item ID" });
      }

      const items = await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
          itemType: blInventory.itemType,
          colorId: blInventory.colorId,
          colorName: blColors.name,
          colorRgb: blColors.rgb,
          categoryId: blCatalog.categoryId,
          categoryName: blCategories.name,
          quantity: blInventory.quantity,
          newOrUsed: blInventory.newOrUsed,
          completeness: blInventory.completeness,
          unitPrice: blInventory.unitPrice,
          myCost: blInventory.myCost,
          bindId: blInventory.bindId,
          description: blInventory.description,
          remarks: blInventory.remarks,
          bulk: blInventory.bulk,
          isRetain: blInventory.isRetain,
          isStockRoom: blInventory.isStockRoom,
          stockRoomId: blInventory.stockRoomId,
          dateCreated: blInventory.dateCreated,
          saleRate: blInventory.saleRate,
          tierPrice1: blInventory.tierPrice1,
          tierPrice2: blInventory.tierPrice2,
          tierPrice3: blInventory.tierPrice3,
          tierQuantity1: blInventory.tierQuantity1,
          tierQuantity2: blInventory.tierQuantity2,
          tierQuantity3: blInventory.tierQuantity3,
          myWeight: blInventory.myWeight,
          updatedAt: blInventory.updatedAt,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
        .where(and(eq(blInventory.orgId, orgId), eq(blInventory.id, itemId)));

      if (items.length === 0) {
        return res.status(404).json({ error: "Item not found" });
      }

      res.json(items[0]);
    } catch (error) {
      console.error("Error fetching item by ID:", error);
      res.status(500).json({ error: "Failed to fetch item" });
    }
  });

  // Get Item Analytics
  app.get("/api/inventory/:id/analytics", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const itemId = parseInt(req.params.id);
      if (isNaN(itemId)) {
        return res.status(400).json({ error: "Invalid item ID" });
      }

      // Parse date range parameter
      const range = req.query.range as string;
      let dateFilter: Date | null = null;
      
      if (range) {
        const now = new Date();
        switch (range) {
          case '3months':
            dateFilter = new Date(now.setMonth(now.getMonth() - 3));
            break;
          case '1year':
            dateFilter = new Date(now.setFullYear(now.getFullYear() - 1));
            break;
          case 'prevyear':
            dateFilter = new Date(now.getFullYear() - 1, 0, 1);
            endDateFilter = new Date(now.getFullYear(), 0, 1);
            break;
          default:
            dateFilter = null; // 'all' or invalid range
        }
      }

      // Get the inventory item
      const [item] = await db
        .select({ id: blInventory.id, dateCreated: blInventory.dateCreated })
        .from(blInventory)
        .where(and(eq(blInventory.orgId, orgId), eq(blInventory.id, itemId)))
        .limit(1);

      if (!item) {
        return res.status(404).json({ error: "Item not found" });
      }

      // Build query conditions - match SKU (inventory ID as text) to inventory ID
      // Filter out non-numeric SKUs (custom codes like "M40-1") to avoid cast errors
      // Also filter out SKUs longer than 9 digits to prevent integer overflow (max int is 2,147,483,647)
      const conditions = [
        sql`${orderDetails.sku} ~ '^[0-9]{1,9}$'`, // Only numeric SKUs with max 9 digits
        sql`CAST(${orderDetails.sku} AS INTEGER) = ${item.id}`
      ];
      if (dateFilter) {
        conditions.push(sql`${orders.orderDate} >= ${dateFilter.toISOString()}`);
      }

      // Query all sales for this item (matching SKU to itemNo)
      const sales = await db
        .select({
          orderId: orderDetails.orderId,
          quantity: orderDetails.quantity,
          unitPrice: orderDetails.unitPrice,
          orderDate: orders.orderDate,
          customerUsername: orders.customerUsername,
          customerEmail: orders.customerEmail,
          orderStatus: orders.orderStatus,
        })
        .from(orderDetails)
        .innerJoin(orders, eq(orderDetails.orderId, orders.id))
        .where(and(...conditions))
        .orderBy(desc(orders.orderDate));

      // Calculate analytics metrics
      const totalUnitsSold = sales.reduce((sum, sale) => sum + sale.quantity, 0);
      const totalRevenue = sales.reduce((sum, sale) => sum + (sale.quantity * parseFloat(sale.unitPrice || "0")), 0);
      const averageSellingPrice = totalUnitsSold > 0 ? totalRevenue / totalUnitsSold : 0;

      // Calculate sales by month
      const salesByMonth: Record<string, { units: number; revenue: number }> = {};
      sales.forEach(sale => {
        const monthKey = new Date(sale.orderDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
        if (!salesByMonth[monthKey]) {
          salesByMonth[monthKey] = { units: 0, revenue: 0 };
        }
        salesByMonth[monthKey].units += sale.quantity;
        salesByMonth[monthKey].revenue += sale.quantity * parseFloat(sale.unitPrice || "0");
      });

      // Find best selling month
      let bestMonth = { month: '', units: 0 };
      Object.entries(salesByMonth).forEach(([month, data]) => {
        if (data.units > bestMonth.units) {
          bestMonth = { month, units: data.units };
        }
      });

      // Calculate days since last sold
      let daysSinceLastSold = null;
      if (sales.length > 0) {
        const lastSaleDate = new Date(sales[0].orderDate);
        const now = new Date();
        daysSinceLastSold = Math.floor((now.getTime() - lastSaleDate.getTime()) / (1000 * 60 * 60 * 24));
      }

      // Calculate sales velocity (units per month)
      let salesVelocity = 0;
      if (sales.length > 0) {
        const firstSaleDate = new Date(sales[sales.length - 1].orderDate);
        const lastSaleDate = new Date(sales[0].orderDate);
        const monthsDiff = (lastSaleDate.getTime() - firstSaleDate.getTime()) / (1000 * 60 * 60 * 24 * 30);
        salesVelocity = monthsDiff > 0 ? totalUnitsSold / monthsDiff : totalUnitsSold;
      }

      // Identify top customers
      const customerPurchases: Record<string, { name: string; units: number; revenue: number; orders: number }> = {};
      sales.forEach(sale => {
        const customerKey = sale.customerUsername || sale.customerEmail || 'Unknown';
        if (!customerPurchases[customerKey]) {
          customerPurchases[customerKey] = { 
            name: customerKey, 
            units: 0, 
            revenue: 0,
            orders: 0
          };
        }
        customerPurchases[customerKey].units += sale.quantity;
        customerPurchases[customerKey].revenue += sale.quantity * parseFloat(sale.unitPrice || "0");
        customerPurchases[customerKey].orders += 1;
      });

      const topCustomers = Object.values(customerPurchases)
        .sort((a, b) => b.units - a.units)
        .slice(0, 5);

      // Days in inventory
      let daysInInventory = null;
      if (item.dateCreated) {
        const now = new Date();
        const created = new Date(item.dateCreated);
        daysInInventory = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      }

      // Recent sales (last 3 months)
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const recentSales = sales.filter(sale => new Date(sale.orderDate) >= threeMonthsAgo);
      const recentUnitsSold = recentSales.reduce((sum, sale) => sum + sale.quantity, 0);

      res.json({
        totalUnitsSold,
        totalRevenue: totalRevenue.toFixed(2),
        averageSellingPrice: averageSellingPrice.toFixed(2),
        salesVelocity: salesVelocity.toFixed(1),
        daysSinceLastSold,
        daysInInventory,
        bestSellingMonth: bestMonth.month || 'N/A',
        bestSellingMonthUnits: bestMonth.units,
        topCustomers,
        recentSales: {
          last3Months: recentUnitsSold,
          percentOfTotal: totalUnitsSold > 0 ? ((recentUnitsSold / totalUnitsSold) * 100).toFixed(1) : '0'
        },
        salesByMonth: Object.entries(salesByMonth).map(([month, data]) => ({
          month,
          units: data.units,
          revenue: data.revenue.toFixed(2)
        })).reverse().slice(0, 12), // Last 12 months
        totalOrders: sales.length,
      });
    } catch (error) {
      console.error("Error fetching item analytics:", error);
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  });

  // GET /api/inventory/:id/item-insights — AI-generated business insights for a specific item
  app.get("/api/inventory/:id/item-insights", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const itemId = parseInt(req.params.id);
      if (isNaN(itemId)) return res.status(400).json({ error: "Invalid item ID" });

      const [item] = await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          itemType: blInventory.itemType,
          itemName: blCatalog.itemName,
          categoryName: blCategories.name,
          colorName: blCatalog.colorName,
          quantity: blInventory.quantity,
          unitPrice: blInventory.unitPrice,
          newOrUsed: blInventory.newOrUsed,
          dateCreated: blInventory.dateCreated,
          myCost: blInventory.myCost,
        })
        .from(blInventory)
        .leftJoin(blCatalog, and(
          eq(blInventory.itemNo, blCatalog.itemNo),
          eq(blInventory.itemType, blCatalog.itemType),
          sql`CASE WHEN ${blInventory.colorId} = 0 THEN -1 ELSE ${blInventory.colorId} END = ${blCatalog.colorId}`,
        ))
        .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
        .where(and(eq(blInventory.orgId, orgId), eq(blInventory.id, itemId)))
        .limit(1);

      if (!item) return res.status(404).json({ error: "Item not found" });
      if (!item.itemNo) return res.status(400).json({ error: "Item has no part number" });

      const pgResult = await db.execute(sql`
        SELECT stock_avg_price, stock_min_price, stock_max_price, stock_total_lots,
               sold_avg_price, sold_min_price, sold_max_price, sold_total_lots
        FROM price_guide_cache
        WHERE item_no = ${item.itemNo.toUpperCase()}
          AND item_type = ${item.itemType || 'PART'}
          AND new_or_used = ${item.newOrUsed || 'N'}
        LIMIT 1
      `);
      const pgRow = pgResult.rows[0] as any;

      const stockGuide = pgRow ? { avgPrice: pgRow.stock_avg_price, minPrice: pgRow.stock_min_price, maxPrice: pgRow.stock_max_price, totalLots: pgRow.stock_total_lots } : null;
      const soldGuide = pgRow ? { avgPrice: pgRow.sold_avg_price, minPrice: pgRow.sold_min_price, maxPrice: pgRow.sold_max_price, totalLots: pgRow.sold_total_lots } : null;

      const salesData = await db
        .select({
          quantity: orderDetails.quantity,
          unitPrice: orderDetails.unitPrice,
          orderDate: orders.orderDate,
          customerUsername: orders.customerUsername,
        })
        .from(orderDetails)
        .innerJoin(orders, eq(orderDetails.orderId, orders.id))
        .where(and(
          sql`${orderDetails.sku} ~ '^[0-9]{1,9}$'`,
          sql`CAST(${orderDetails.sku} AS INTEGER) = ${item.id}`,
        ))
        .orderBy(desc(orders.orderDate))
        .limit(50);

      const totalSold = salesData.reduce((s, r) => s + r.quantity, 0);
      const totalRev = salesData.reduce((s, r) => s + r.quantity * parseFloat(r.unitPrice || '0'), 0);
      let velocity = 0;
      if (salesData.length > 0) {
        const first = new Date(salesData[salesData.length - 1].orderDate);
        const last = new Date(salesData[0].orderDate);
        const months = (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24 * 30);
        velocity = months > 0 ? totalSold / months : totalSold;
      }
      let daysSinceLastSold: number | null = null;
      if (salesData.length > 0) {
        daysSinceLastSold = Math.floor((Date.now() - new Date(salesData[0].orderDate).getTime()) / (1000 * 60 * 60 * 24));
      }

      const searchQuery = `${item.itemName || item.itemNo} ${item.categoryName || ''} LEGO`;

      let marketNewsResults: any[] = [];
      let forumResults: any[] = [];
      try {
        const { searchMarketNews, searchForumDiscussions } = await import('./services/ai-tools.js');
        const [newsRes, forumRes] = await Promise.all([
          searchMarketNews({ query: searchQuery, limit: 5 }),
          searchForumDiscussions({ query: searchQuery, limit: 5 }),
        ]);
        marketNewsResults = newsRes.data || [];
        forumResults = forumRes.data || [];
      } catch (e: any) {
        console.warn('[ItemInsights] Embedding search error (non-fatal):', e.message);
      }

      const [platformSettings] = await db
        .select({ openaiApiKey: appSettings.openaiApiKey })
        .from(appSettings)
        .where(eq(appSettings.id, 'platform'))
        .limit(1);
      const apiKey = platformSettings?.openaiApiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "No AI API key configured" });

      const prompt = `You are a LEGO/BrickLink business advisor. Analyze this specific inventory item and provide actionable business insights.

ITEM DATA:
- Name: ${item.itemName || item.itemNo}
- Part/Set Number: ${item.itemNo}
- Type: ${item.itemType}
- Category: ${item.categoryName || 'Unknown'}
- Color: ${item.colorName || 'N/A'}
- Condition: ${item.newOrUsed === 'N' ? 'New' : 'Used'}
- Quantity in stock: ${item.quantity}
- Listed price: $${item.unitPrice || '0'}
- My cost: $${item.myCost || 'Unknown'}
- Days in inventory: ${item.dateCreated ? Math.floor((Date.now() - new Date(item.dateCreated).getTime()) / 86400000) : 'Unknown'}

SALES HISTORY:
- Total units sold: ${totalSold}
- Total revenue: $${totalRev.toFixed(2)}
- Sales velocity: ${velocity.toFixed(1)} units/month
- Days since last sold: ${daysSinceLastSold ?? 'Never sold'}

MARKET DATA:
- Current stock avg price: $${stockGuide?.avgPrice || 'N/A'} (${stockGuide?.totalLots || 0} sellers)
- Current stock min: $${stockGuide?.minPrice || 'N/A'}, max: $${stockGuide?.maxPrice || 'N/A'}
- Recent sold avg price: $${soldGuide?.avgPrice || 'N/A'} (${soldGuide?.totalLots || 0} transactions)
- Recent sold min: $${soldGuide?.minPrice || 'N/A'}, max: $${soldGuide?.maxPrice || 'N/A'}

RELEVANT MARKET NEWS:
${marketNewsResults.length > 0 ? marketNewsResults.map(n => `- ${n.title}: ${n.snippet || ''}`).join('\n') : 'No relevant news found.'}

RELEVANT FORUM DISCUSSIONS:
${forumResults.length > 0 ? forumResults.map(f => `- ${f.title}: ${f.excerpt || ''}`).join('\n') : 'No relevant discussions found.'}

Provide exactly 4-6 insights as a JSON array. Each insight must have:
- "category": one of "pricing", "movement", "market", "category_trend", "opportunity", "risk"
- "urgency": "high", "medium", or "low"
- "title": short actionable headline (max 60 chars)
- "summary": 1-2 sentence explanation with specific numbers/data
- "source": what data informed this insight ("sales", "market_data", "news", "forum", "inventory")

Focus on:
1. Pricing strategy (is the item priced competitively? above/below market?)
2. Movement strategy (how to move slow stock or capitalize on fast sellers)
3. Market trends (any relevant news or forum chatter about this item/category?)
4. Category insights (how does this item fit in its category's market?)
5. Opportunities or risks (retirement rumors, supply changes, demand shifts)

Be specific with numbers. Reference actual data points. If market news or forum data is empty, focus on pricing and sales data instead.
Return ONLY a JSON array, no markdown, no explanation.`;

      const openai = new (await import('openai')).default({ apiKey });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2000,
      });

      const responseText = completion.choices[0]?.message?.content || '';
      let insights: any[] = [];
      try {
        const trimmed = responseText.trim();
        const parsed = JSON.parse(trimmed);
        insights = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        const codeBlock = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlock) {
          try {
            const inner = JSON.parse(codeBlock[1].trim());
            insights = Array.isArray(inner) ? inner : [inner];
          } catch {}
        }
      }

      const VALID_CATEGORIES = ['pricing', 'movement', 'market', 'category_trend', 'opportunity', 'risk'];
      const VALID_URGENCIES = ['high', 'medium', 'low'];
      insights = insights
        .filter(i => i.title && i.summary)
        .map(i => ({
          category: VALID_CATEGORIES.includes(i.category) ? i.category : 'market',
          urgency: VALID_URGENCIES.includes(i.urgency) ? i.urgency : 'medium',
          title: String(i.title).slice(0, 100),
          summary: String(i.summary).slice(0, 500),
          source: i.source || 'inventory',
        }));

      res.json({
        insights,
        meta: {
          newsCount: marketNewsResults.length,
          forumCount: forumResults.length,
          salesCount: salesData.length,
          hasPriceGuide: !!(stockGuide || soldGuide),
        },
      });
    } catch (error: any) {
      console.error("[ItemInsights] Error:", error.message);
      res.status(500).json({ error: "Failed to generate item insights" });
    }
  });

  // GET /api/catalog/item-insights — AI insights for a catalog item (not in inventory) using itemNo/itemType/colorId
  app.get("/api/catalog/item-insights", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { itemNo, itemType, colorId: colorIdStr } = req.query as { itemNo?: string; itemType?: string; colorId?: string };
      if (!itemNo || !itemType) return res.status(400).json({ error: "itemNo and itemType are required" });
      const colorId = colorIdStr !== undefined ? parseInt(colorIdStr) : -1;
      const effectiveColorId = isNaN(colorId) ? -1 : colorId === 0 ? -1 : colorId;

      const [catalogItem] = await db
        .select({
          itemNo: blCatalog.itemNo,
          itemType: blCatalog.itemType,
          itemName: blCatalog.itemName,
          colorName: blCatalog.colorName,
          categoryName: blCategories.name,
        })
        .from(blCatalog)
        .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
        .where(and(
          eq(blCatalog.itemNo, itemNo.toUpperCase()),
          eq(blCatalog.itemType, itemType.toUpperCase()),
          eq(blCatalog.colorId, effectiveColorId),
        ))
        .limit(1);

      const pgResult = await db.execute(sql`
        SELECT stock_avg_price, stock_min_price, stock_max_price, stock_total_lots,
               sold_avg_price, sold_min_price, sold_max_price, sold_total_lots
        FROM price_guide_cache
        WHERE item_no = ${itemNo.toUpperCase()}
          AND item_type = ${itemType.toUpperCase()}
          AND new_or_used = 'N'
        LIMIT 1
      `);
      const pgRow = pgResult.rows[0] as any;
      const stockGuide = pgRow ? { avgPrice: pgRow.stock_avg_price, minPrice: pgRow.stock_min_price, maxPrice: pgRow.stock_max_price, totalLots: pgRow.stock_total_lots } : null;
      const soldGuide = pgRow ? { avgPrice: pgRow.sold_avg_price, minPrice: pgRow.sold_min_price, maxPrice: pgRow.sold_max_price, totalLots: pgRow.sold_total_lots } : null;

      // Sales history from this org's order_details by itemNo
      const salesData = await db
        .select({
          quantity: orderDetails.quantity,
          unitPrice: orderDetails.unitPrice,
          orderDate: orders.orderDate,
        })
        .from(orderDetails)
        .innerJoin(orders, and(eq(orderDetails.orderId, orders.id), eq(orders.orgId, orgId)))
        .where(sql`UPPER(${orderDetails.itemNo}) = ${itemNo.toUpperCase()}`)
        .orderBy(desc(orders.orderDate))
        .limit(50);

      const totalSold = salesData.reduce((s, r) => s + r.quantity, 0);
      const totalRev = salesData.reduce((s, r) => s + r.quantity * parseFloat(r.unitPrice || '0'), 0);
      let velocity = 0;
      if (salesData.length > 0) {
        const first = new Date(salesData[salesData.length - 1].orderDate);
        const last = new Date(salesData[0].orderDate);
        const months = (last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24 * 30);
        velocity = months > 0 ? totalSold / months : totalSold;
      }
      let daysSinceLastSold: number | null = null;
      if (salesData.length > 0) {
        daysSinceLastSold = Math.floor((Date.now() - new Date(salesData[0].orderDate).getTime()) / (1000 * 60 * 60 * 24));
      }

      const displayName = catalogItem?.itemName || itemNo;
      const searchQuery = `${displayName} ${catalogItem?.categoryName || ''} LEGO`;

      let marketNewsResults: any[] = [];
      let forumResults: any[] = [];
      try {
        const { searchMarketNews, searchForumDiscussions } = await import('./services/ai-tools.js');
        const [newsRes, forumRes] = await Promise.all([
          searchMarketNews({ query: searchQuery, limit: 5 }),
          searchForumDiscussions({ query: searchQuery, limit: 5 }),
        ]);
        marketNewsResults = newsRes.data || [];
        forumResults = forumRes.data || [];
      } catch (e: any) {
        console.warn('[CatalogInsights] Embedding search error (non-fatal):', e.message);
      }

      const [platformSettings] = await db
        .select({ openaiApiKey: appSettings.openaiApiKey })
        .from(appSettings)
        .where(eq(appSettings.id, 'platform'))
        .limit(1);
      const apiKey = platformSettings?.openaiApiKey || process.env.OPENAI_API_KEY;
      if (!apiKey) return res.status(500).json({ error: "No AI API key configured" });

      const prompt = `You are a LEGO/BrickLink business advisor. This is a catalog item the seller does NOT currently have in inventory. Analyze the market data and provide insights to help them decide whether to source and sell this item.

ITEM DATA:
- Name: ${displayName}
- Part/Set Number: ${itemNo}
- Type: ${itemType}
- Category: ${catalogItem?.categoryName || 'Unknown'}
- Color: ${catalogItem?.colorName || 'N/A'}

PAST SALES (from this seller's order history):
- Total units sold previously: ${totalSold}
- Total revenue generated: $${totalRev.toFixed(2)}
- Sales velocity: ${velocity.toFixed(1)} units/month
- Days since last sold: ${daysSinceLastSold ?? 'Never sold'}

MARKET DATA (BrickLink):
- Current stock avg price: $${stockGuide?.avgPrice || 'N/A'} (${stockGuide?.totalLots || 0} sellers)
- Current stock min: $${stockGuide?.minPrice || 'N/A'}, max: $${stockGuide?.maxPrice || 'N/A'}
- Recent sold avg price: $${soldGuide?.avgPrice || 'N/A'} (${soldGuide?.totalLots || 0} transactions)
- Recent sold min: $${soldGuide?.minPrice || 'N/A'}, max: $${soldGuide?.maxPrice || 'N/A'}

RELEVANT MARKET NEWS:
${marketNewsResults.length > 0 ? marketNewsResults.map(n => `- ${n.title}: ${n.snippet || ''}`).join('\n') : 'No relevant news found.'}

RELEVANT FORUM DISCUSSIONS:
${forumResults.length > 0 ? forumResults.map(f => `- ${f.title}: ${f.excerpt || ''}`).join('\n') : 'No relevant discussions found.'}

Provide exactly 4-6 insights as a JSON array. Each insight must have:
- "category": one of "pricing", "movement", "market", "category_trend", "opportunity", "risk"
- "urgency": "high", "medium", or "low"
- "title": short actionable headline (max 60 chars)
- "summary": 1-2 sentence explanation with specific numbers/data
- "source": what data informed this insight ("sales", "market_data", "news", "forum", "inventory")

Focus on:
1. Is this item worth sourcing? (demand signal from past sales + market liquidity)
2. What price point makes sense? (based on market data)
3. Market trends for this item or its category
4. Any opportunities or risks (retirement, demand spikes, saturation)
5. Sourcing urgency (high velocity + low stock = source now vs. wait)

Be specific with numbers. Reference actual data points. Return ONLY a JSON array, no markdown, no explanation.`;

      const openai = new (await import('openai')).default({ apiKey });
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2000,
      });

      const responseText = completion.choices[0]?.message?.content || '';
      let insights: any[] = [];
      try {
        const trimmed = responseText.trim();
        const parsed = JSON.parse(trimmed);
        insights = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        const codeBlock = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlock) {
          try {
            const inner = JSON.parse(codeBlock[1].trim());
            insights = Array.isArray(inner) ? inner : [inner];
          } catch {}
        }
      }

      const VALID_CATEGORIES = ['pricing', 'movement', 'market', 'category_trend', 'opportunity', 'risk'];
      const VALID_URGENCIES = ['high', 'medium', 'low'];
      insights = insights
        .filter(i => i.title && i.summary)
        .map(i => ({
          category: VALID_CATEGORIES.includes(i.category) ? i.category : 'market',
          urgency: VALID_URGENCIES.includes(i.urgency) ? i.urgency : 'medium',
          title: String(i.title).slice(0, 100),
          summary: String(i.summary).slice(0, 500),
          source: i.source || 'market_data',
        }));

      res.json({
        insights,
        meta: {
          newsCount: marketNewsResults.length,
          forumCount: forumResults.length,
          salesCount: salesData.length,
          hasPriceGuide: !!(stockGuide || soldGuide),
          isCatalog: true,
        },
      });
    } catch (error: any) {
      console.error("[CatalogInsights] Error:", error.message);
      res.status(500).json({ error: "Failed to generate catalog insights" });
    }
  });

  // Rate Limit Status
  // BrickSpotter always draws from the platform BrickLink account (PLATFORM_ORG_ID).
  // Org-level BL accounts are used only for that org's own inventory sync / order sync / POM.
  // So for BrickSpotter users we report platform-level usage, not the org's own usage.
  app.get("/api/bricklink/rate-limit", isApproved, async (req, res) => {
    try {
      const orgId = reqOrgId(req);
      const { checkRateLimit } = await import("./services/bricklink");

      const bsCheck = await checkBrickspotterLimit(orgId);
      // BS-only orgs always route through the platform BL account.
      // For mixed-access plans, check apiCallLimit (0 = no BrickSpotter; >0 or -1 = has access).
      const hasBrickSpotter = bsCheck.isBrickspotterOnly || bsCheck.apiCallLimit !== 0;
      const targetOrgId = hasBrickSpotter ? PLATFORM_ORG_ID : orgId;

      const status = await checkRateLimit(targetOrgId);
      res.json(status);
    } catch (error) {
      console.error("Error checking rate limit:", error);
      res.status(500).json({ error: "Failed to check rate limit" });
    }
  });

  // Sync Routes
  app.post("/api/sync/bricklink/inventory", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const result = await syncBricklinkData(orgId);
      res.json({
        success: true,
        data: result,
      });
      // Fire-and-forget: embed any new items that don't yet have a CLIP catalog embedding.
      (async () => {
        try {
          const { buildCatalogEmbeddings } = await import('./services/clip-search.js');
          const rows = await db.select({ itemNo: blInventory.itemNo, colorId: blInventory.colorId }).from(blInventory).where(eq(blInventory.orgId, orgId));
          const items = rows.map((r) => ({ itemNo: r.itemNo, colorId: Number(r.colorId), itemType: 'PART' }));
          if (items.length === 0) return;
          const built = await buildCatalogEmbeddings(items);
          if (built.done > 0) console.log(`[CLIP Auto] Manual sync: ${built.done} new catalog embeddings added`);
        } catch (e: any) {
          console.warn('[CLIP Auto] Post-manual-sync catalog update failed (non-fatal):', e.message);
        }
      })();
    } catch (error: any) {
      const isConflict = error?.message?.toLowerCase().includes('blocked') || error?.message?.toLowerCase().includes('already in progress') || error?.message?.toLowerCase().includes('already running');
      console.error("BrickLink sync error:", error);
      res.status(isConflict ? 409 : 500).json({
        success: false,
        error: isConflict ? error.message : "Failed to sync BrickLink inventory",
      });
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
  app.post("/api/sync/rebrickable/bulk-images", isApproved, async (req, res) => {
    try {
      const maxBatches = req.body?.maxBatches || 500;
      
      // Start the sync in background - don't await it
      console.log(`[Rebrickable Bulk Sync] Starting bulk image sync in background (max ${maxBatches} batches)...`);
      
      // Import and start the sync without awaiting
      import("./services/rebrickable-images").then(async ({ bulkSyncRebrickableImages }) => {
        console.log('[Rebrickable Bulk Sync] Background sync process started');
        try {
          const result = await bulkSyncRebrickableImages(maxBatches);
          console.log('[Rebrickable Bulk Sync] Background sync complete:', JSON.stringify(result));
        } catch (error) {
          console.error('[Rebrickable Bulk Sync] Background sync error:', error);
        }
      });
      
      // Return immediately to client
      res.json({
        success: true,
        message: "Image sync started in background. This will continue even if you close this page.",
        data: {
          status: "started",
          maxBatches
        }
      });
    } catch (error) {
      console.error("🔍 [DEBUG] Rebrickable bulk sync error:", error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to start bulk sync",
      });
    }
  });

  // Rebrickable Set-Parts Sync — manual trigger
  app.post("/api/sync/rebrickable/set-parts", isApproved, async (req: any, res) => {
    try {
      const { force = false } = req.body || {};
      const { syncRebrickableSetParts, getRebrickableSyncIsRunning } = await import('./services/rebrickable.js');
      if (getRebrickableSyncIsRunning()) {
        return res.status(409).json({ success: false, error: 'Rebrickable sync already running' });
      }
      // Fire-and-forget — returns immediately
      syncRebrickableSetParts(force).catch((err: any) => {
        console.error('[Rebrickable API] Sync error:', err.message);
      });
      res.json({ success: true, message: 'Rebrickable set-parts sync started', force });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // Get BrickLink sync progress (for real-time UI updates)
  app.get("/api/sync/bricklink/progress", isApproved, async (req, res) => {
    try {
      const { syncProgressTracker } = await import('./services/sync-progress');
      const progress = syncProgressTracker.get();
      res.json(progress);
    } catch (error) {
      console.error("Error fetching sync progress:", error);
      res.status(500).json({ error: "Failed to fetch sync progress" });
    }
  });

  // Get ShipStation sync progress (for real-time UI updates)
  app.get("/api/sync/shipstation/orders/progress", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const [metadata] = await db
        .select()
        .from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, 'shipstation_orders')))
        .limit(1);
      
      if (!metadata) {
        res.json({ status: 'idle', progress: null });
        return;
      }
      
      res.json({
        status: metadata.lastSyncStatus,
        progress: metadata.errorMessage ? JSON.parse(metadata.errorMessage) : null,
        lastSync: metadata.lastSyncTime,
        recordsAdded: metadata.recordsAdded,
        recordsUpdated: metadata.recordsUpdated,
      });
    } catch (error) {
      console.error("Error fetching sync progress:", error);
      res.status(500).json({ error: "Failed to fetch sync progress" });
    }
  });

  app.post("/api/sync/shipstation/orders", isApproved, async (req, res) => {
    try {
      // Check for fullSync query parameter
      const fullSync = req.query.fullSync === 'true' || req.body.fullSync === true;
      const result = await syncShipStationOrders(fullSync);
      res.json({
        success: true,
        data: result,
        syncType: fullSync ? 'full' : 'incremental',
      });
    } catch (error) {
      console.error("ShipStation sync error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to sync ShipStation orders",
      });
    }
  });

  // BrickLink order sync endpoint
  app.post("/api/sync/bricklink/orders", isApproved, async (req: any, res) => {
    try {
      const { limit, fullSync } = req.body;
      const { runPlatformOrderSync } = await import("./services/order-sync-core");
      const result = await runPlatformOrderSync("bricklink", { limit, fullSync });
      res.json({ success: true, data: result });
      if ((result.bricklink.ordersAdded ?? 0) > 0) {
        const orgId = reqOrgId(req);
        const { sendOrderSyncNotifications } = await import("./services/push-notifications");
        const newRows = await db.select({ orderNumber: orders.orderNumber, shippingTier: orders.shippingTier })
          .from(orders).where(eq(orders.orgId, orgId)).orderBy(desc(orders.syncedAt)).limit(result.bricklink.ordersAdded!);
        sendOrderSyncNotifications(orgId, newRows).catch(() => {});
      }
    } catch (error: any) {
      console.error("BrickLink order sync error:", error);
      const isConflict = error?.message?.toLowerCase().includes('blocked');
      res.status(isConflict ? 409 : 500).json({ success: false, error: error.message || "Failed to sync BrickLink orders" });
    }
  });

  // BrickOwl order sync endpoint
  app.post("/api/sync/brickowl/orders", isApproved, async (req: any, res) => {
    try {
      const { limit, fullSync } = req.body;
      const { runPlatformOrderSync } = await import("./services/order-sync-core");
      const result = await runPlatformOrderSync("brickowl", { limit, fullSync });
      res.json({ success: true, data: result });
      if ((result.brickowl.ordersAdded ?? 0) > 0) {
        const orgId = reqOrgId(req);
        const { sendOrderSyncNotifications } = await import("./services/push-notifications");
        const newRows = await db.select({ orderNumber: orders.orderNumber, shippingTier: orders.shippingTier })
          .from(orders).where(eq(orders.orgId, orgId)).orderBy(desc(orders.syncedAt)).limit(result.brickowl.ordersAdded!);
        sendOrderSyncNotifications(orgId, newRows).catch(() => {});
      }
    } catch (error: any) {
      console.error("BrickOwl order sync error:", error);
      const isConflict = error?.message?.toLowerCase().includes('blocked');
      res.status(isConflict ? 409 : 500).json({ success: false, error: error.message || "Failed to sync BrickOwl orders" });
    }
  });

  // Multi-platform order sync endpoint (BrickLink + BrickOwl + Stripe + PayPal)
  app.post("/api/sync/all-platforms/orders", isApproved, async (req: any, res) => {
    try {
      const { limit = 50, fullSync = false } = req.body;
      const { runPlatformOrderSync } = await import("./services/order-sync-core");
      const result = await runPlatformOrderSync("all", { limit, fullSync });
      const anySuccess = result.bricklink.success || result.brickowl.success;
      const allSkipped = result.bricklink.skipped && result.brickowl.skipped;
      const totalAdded = (result.bricklink.ordersAdded ?? 0) + (result.brickowl.ordersAdded ?? 0);
      res.json({ success: anySuccess, allSkipped, results: result });
      if (totalAdded > 0) {
        const orgId = reqOrgId(req);
        const { sendOrderSyncNotifications } = await import("./services/push-notifications");
        const newRows = await db.select({ orderNumber: orders.orderNumber, shippingTier: orders.shippingTier })
          .from(orders).where(eq(orders.orgId, orgId)).orderBy(desc(orders.syncedAt)).limit(totalAdded);
        sendOrderSyncNotifications(orgId, newRows).catch(() => {});
      }
    } catch (error: any) {
      const isConflict = error?.message?.toLowerCase().includes('blocked');
      console.error("❌ Multi-platform order sync error:", error);
      res.status(isConflict ? 409 : 500).json({ success: false, error: error.message || "Failed to sync platform orders" });
    }
  });

  // Lightweight "is running" poll for dashboard action items
  app.get("/api/order-sync/running", isApproved, async (req, res) => {
    const { getOrderSyncIsRunning } = await import("./services/order-sync-core");
    res.json({ running: getOrderSyncIsRunning() });
  });

  app.get("/api/channel-sync/running", isApproved, async (req, res) => {
    const { getChannelSyncIsRunning } = await import("./services/channel-sync-scheduler");
    res.json({ running: getChannelSyncIsRunning() });
  });

  // Manual channel sync trigger
  app.post("/api/sync/channel", isApproved, async (req, res) => {
    try {
      if (syncLock.isRunning()) {
        const blocker = syncLock.getActive().join(', ');
        return res.status(409).json({ success: false, error: `Cannot start Channel Sync: ${blocker} is already running.` });
      }
      const { runChannelSync } = await import("./services/channel-sync-scheduler");
      await runChannelSync();
      res.json({ success: true });
    } catch (error: any) {
      const isConflict = error?.message?.toLowerCase().includes('blocked') || error?.message?.toLowerCase().includes('already running');
      res.status(isConflict ? 409 : 500).json({ success: false, error: error.message || "Failed to run channel sync" });
    }
  });

  // Recent sync errors for dashboard action items
  // Returns syncs that completed with error/failed status in the last 24 hours
  app.get("/api/sync/statuses", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const ids = ['bricklink_inventory', 'priceomatic_cache', 'channel_sync', 'bricklink_orders', 'brickowl_orders', 'rebrickable_set_parts'];
      const rows = await db.select().from(syncMetadata).where(and(eq(syncMetadata.orgId, orgId), inArray(syncMetadata.id, ids)));

      // Cross-check in_progress records against live in-memory state.
      // If the DB says in_progress but nothing is actually running, auto-correct.
      const { getPomIsRunning } = await import("./services/pom-scheduler");
      const { getChannelSyncIsRunning } = await import("./services/channel-sync-scheduler");
      const { getOrderSyncIsRunning } = await import("./services/order-sync-core");
      const { getRebrickableSyncIsRunning } = await import("./services/rebrickable.js");
      const isActuallyRunning: Record<string, boolean> = {
        bricklink_inventory:    syncLock.isInventorySyncRunning(),
        priceomatic_cache:      getPomIsRunning(),
        channel_sync:           getChannelSyncIsRunning(),
        bricklink_orders:       getOrderSyncIsRunning(),
        brickowl_orders:        getOrderSyncIsRunning(),
        rebrickable_set_parts:  getRebrickableSyncIsRunning(),
      };
      for (const row of rows) {
        if (row.lastSyncStatus === 'in_progress' && !isActuallyRunning[row.id]) {
          await db.update(syncMetadata)
            .set({ lastSyncStatus: 'error', errorMessage: 'Sync interrupted by server restart.', updatedAt: new Date() })
            .where(eq(syncMetadata.id, row.id));
          row.lastSyncStatus = 'error';
          row.errorMessage = 'Sync interrupted by server restart.';
          console.log(`[Statuses] Cleared stale in_progress for ${row.id}`);
        }
      }

      const byId = Object.fromEntries(rows.map(r => [r.id, r]));
      const pick = (id: string) => {
        const r = byId[id];
        if (!r) return null;
        return {
          lastSyncTime: r.lastSyncTime?.toISOString() ?? null,
          lastSyncStatus: r.lastSyncStatus,
          recordsAdded: r.recordsAdded ?? 0,
          recordsUpdated: r.recordsUpdated ?? 0,
          errorMessage: r.errorMessage ?? null,
        };
      };
      // Merge BL + BO orders: pick whichever ran more recently
      const blOrders = byId['bricklink_orders'];
      const boOrders = byId['brickowl_orders'];
      let ordersMeta = null;
      if (blOrders || boOrders) {
        const latest = (!blOrders?.lastSyncTime) ? boOrders :
                       (!boOrders?.lastSyncTime) ? blOrders :
                       (new Date(blOrders.lastSyncTime) > new Date(boOrders.lastSyncTime) ? blOrders : boOrders);
        if (latest) {
          const blAdded = blOrders?.recordsAdded ?? 0;
          const boAdded = boOrders?.recordsAdded ?? 0;
          const blUpdated = blOrders?.recordsUpdated ?? 0;
          const boUpdated = boOrders?.recordsUpdated ?? 0;
          ordersMeta = {
            lastSyncTime: latest.lastSyncTime?.toISOString() ?? null,
            lastSyncStatus: latest.lastSyncStatus,
            recordsAdded: blAdded + boAdded,
            recordsUpdated: blUpdated + boUpdated,
            errorMessage: latest.errorMessage ?? null,
          };
        }
      }
      res.json({
        inventory: pick('bricklink_inventory'),
        priceomatic: pick('priceomatic_cache'),
        channel: pick('channel_sync'),
        orders: ordersMeta,
        rebrickable: pick('rebrickable_set_parts'),
      });
    } catch (error) {
      console.error('Error fetching sync statuses:', error);
      res.status(500).json({ inventory: null, priceomatic: null, channel: null, orders: null, rebrickable: null });
    }
  });

  app.get("/api/sync/recent-errors", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const rows = await db
        .select()
        .from(syncMetadata)
        .where(
          and(
            eq(syncMetadata.orgId, orgId),
            inArray(syncMetadata.lastSyncStatus, ['error', 'failed', 'partial']),
            sql`${syncMetadata.lastSyncTime} >= ${since}`,
            sql`${syncMetadata.id} != 'priceomatic_cache'`
          )
        );

      const SYNC_LABELS: Record<string, string> = {
        bricklink_inventory: 'Inventory Sync',
        bricklink_orders:    'Order Sync (BrickLink)',
        brickowl_orders:     'Order Sync (BrickOwl)',
        priceomatic_cache:   'Price-o-Matic',
        channel_sync:        'Channel Sync',
      };

      const errors = rows.map(r => ({
        id: r.id,
        label: SYNC_LABELS[r.id] ?? r.id,
        status: r.lastSyncStatus,
        message: r.errorMessage ?? 'Unknown error',
        time: r.lastSyncTime?.toISOString() ?? null,
      }));

      res.json({ errors });
    } catch (error) {
      console.error('Error fetching recent sync errors:', error);
      res.status(500).json({ errors: [] });
    }
  });

  // Get Order Sync Status for all platforms
  app.get("/api/order-sync/status", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      // Get local database order stats
      const dbOrderStats = await db
        .select({
          totalOrders: sql<number>`COUNT(*)`,
          totalItems: sql<number>`SUM((SELECT COUNT(*) FROM ${orderDetails} WHERE ${orderDetails.orderId} = ${orders.id}))`,
          pendingOrders: sql<number>`COUNT(CASE WHEN ${orders.orderStatus} IN ('awaiting_payment', 'awaiting_shipment', 'pending') THEN 1 END)`,
          shippedOrders: sql<number>`COUNT(CASE WHEN ${orders.orderStatus} = 'shipped' THEN 1 END)`,
        })
        .from(orders)
        .where(eq(orders.orgId, orgId));

      const dbStats = {
        totalOrders: Number(dbOrderStats[0]?.totalOrders) || 0,
        totalItems: Number(dbOrderStats[0]?.totalItems) || 0,
        pendingOrders: Number(dbOrderStats[0]?.pendingOrders) || 0,
        shippedOrders: Number(dbOrderStats[0]?.shippedOrders) || 0,
      };

      // Get settings to check API credentials
      const settings = await getOrgSettings(orgId);
      const bricklinkEnabled = !!(settings?.bricklinkConsumerKey && settings?.bricklinkConsumerSecret && 
        settings?.bricklinkTokenValue && settings?.bricklinkTokenSecret);
      const brickowlEnabled = !!(settings?.brickowlApiKey || process.env.BRICKOWL_API_KEY);

      // Get last sync times from sync_metadata
      const [blSyncMeta] = await db
        .select()
        .from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, 'bricklink_orders')))
        .limit(1);

      const [boSyncMeta] = await db
        .select()
        .from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, orgId), eq(syncMetadata.id, 'brickowl_orders')))
        .limit(1);

      // Get BrickLink order stats from local database
      const blLocalStats = await db
        .select({
          totalOrders: sql<number>`COUNT(*)`,
          totalItems: sql<number>`SUM((SELECT COUNT(*) FROM ${orderDetails} WHERE ${orderDetails.orderId} = ${orders.id}))`,
          pendingOrders: sql<number>`COUNT(CASE WHEN ${orders.orderStatus} IN ('awaiting_payment', 'awaiting_shipment', 'pending') THEN 1 END)`,
        })
        .from(orders)
        .where(and(eq(orders.orgId, orgId), eq(orders.marketplace, 'BrickLink')));

      const brickLinkStats = {
        totalOrders: Number(blLocalStats[0]?.totalOrders) || 0,
        totalItems: Number(blLocalStats[0]?.totalItems) || 0,
        pendingOrders: Number(blLocalStats[0]?.pendingOrders) || 0,
        lastSyncedAt: blSyncMeta?.lastSyncTime?.toISOString() || null,
      };

      // Get BrickOwl order stats from local database
      const boLocalStats = await db
        .select({
          totalOrders: sql<number>`COUNT(*)`,
          totalItems: sql<number>`SUM((SELECT COUNT(*) FROM ${orderDetails} WHERE ${orderDetails.orderId} = ${orders.id}))`,
          pendingOrders: sql<number>`COUNT(CASE WHEN ${orders.orderStatus} IN ('awaiting_payment', 'awaiting_shipment', 'pending') THEN 1 END)`,
        })
        .from(orders)
        .where(and(eq(orders.orgId, orgId), eq(orders.marketplace, 'BrickOwl')));

      const brickOwlStats = {
        totalOrders: Number(boLocalStats[0]?.totalOrders) || 0,
        totalItems: Number(boLocalStats[0]?.totalItems) || 0,
        pendingOrders: Number(boLocalStats[0]?.pendingOrders) || 0,
        lastSyncedAt: boSyncMeta?.lastSyncTime?.toISOString() || null,
      };

      // For now, we can't easily get differentials without making API calls
      // So we'll just return the stats and indicate if API is configured
      const orderSyncStatus = {
        platforms: [
          {
            name: 'BrickLink',
            enabled: bricklinkEnabled,
            stats: brickLinkStats,
            differentials: {
              // These would need API calls to calculate - leaving as 0 for now
              missingOrders: 0,
              statusDifferences: 0,
            },
          },
          {
            name: 'BrickOwl',
            enabled: brickowlEnabled,
            stats: brickOwlStats,
            differentials: {
              // These would need API calls to calculate - leaving as 0 for now
              missingOrders: 0,
              statusDifferences: 0,
            },
          },
        ],
        summary: {
          totalOrders: dbStats.totalOrders,
          totalItems: dbStats.totalItems,
          pendingOrders: dbStats.pendingOrders,
          shippedOrders: dbStats.shippedOrders,
        },
      };

      res.json(orderSyncStatus);
    } catch (error) {
      console.error("Error fetching order sync status:", error);
      res.status(500).json({ error: "Failed to fetch order sync status" });
    }
  });

  // Marketplace diagnostic endpoint
  app.get("/api/orders/marketplace-diagnostic", isApproved, async (req, res) => {
    try {
      // Get summary statistics
      const stats = await db.execute(sql`
        SELECT 
          marketplace,
          COUNT(*) as count,
          ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM orders), 1) as percentage
        FROM orders
        GROUP BY marketplace
        ORDER BY count DESC
      `);

      // Get sample "Unknown" orders with their data
      const unknownSamples = await db.execute(sql`
        SELECT 
          order_number,
          order_key,
          marketplace,
          order_date,
          CASE 
            WHEN order_number ~ '^BL\\.' THEN 'Should be: BrickLink'
            WHEN order_number ~ '^BO\\.' THEN 'Should be: BrickOwl'
            WHEN order_number ~ '^LBS' THEN 'Should be: eBay'
            WHEN order_number ~ '^\\d{7,8}$' THEN 'Should be: BrickLink (numeric)'
            WHEN order_number ~ '^\\d{3}-\\d{7}-\\d{7}$' THEN 'Should be: Amazon'
            WHEN order_number ~ '^\\d{2}-\\d{5}-\\d{5}$' THEN 'Should be: eBay'
            WHEN order_number ~ '^\\d{12}-\\d{13}$' THEN 'Should be: eBay (long format)'
            ELSE 'Pattern not recognized'
          END as detected_pattern
        FROM orders 
        WHERE marketplace IS NULL
        ORDER BY order_date DESC
        LIMIT 20
      `);

      res.json({
        success: true,
        summary: stats.rows,
        unknownSamples: unknownSamples.rows,
        insights: {
          totalOrders: stats.rows.reduce((sum: number, row: any) => sum + Number(row.count), 0),
          unknownCount: stats.rows.find((row: any) => row.marketplace === null)?.count || 0,
          detectionMethods: [
            { priority: 1, method: 'advancedOptions.source', description: 'Most reliable - direct marketplace field' },
            { priority: 2, method: 'Custom Fields', description: 'Check customField1, customField2, customField3' },
            { priority: 3, method: 'Order Number Pattern', description: 'BL., BO., LBS, numeric patterns' },
            { priority: 4, method: 'Order Key Pattern', description: 'EBAY-, AMZN-, etc. prefixes' },
            { priority: 5, method: 'Customer Email Domain', description: 'Marketplace notification emails' },
            { priority: 6, method: 'Shipping Service', description: 'Carrier code or service mentions' },
            { priority: 7, method: 'Store ID', description: 'advancedOptions.storeId references' },
            { priority: 8, method: 'Order Notes', description: 'Internal/customer notes mentioning marketplace' }
          ],
          detectionPatterns: [
            { pattern: 'BL.XXXXXXX', platform: 'BrickLink' },
            { pattern: 'BO.XXXXXXX', platform: 'BrickOwl' },
            { pattern: 'LBS*', platform: 'eBay' },
            { pattern: '7-8 digits', platform: 'BrickLink (legacy)' },
            { pattern: 'XXX-XXXXXXX-XXXXXXX', platform: 'Amazon' },
            { pattern: 'XX-XXXXX-XXXXX', platform: 'eBay' },
            { pattern: '12-13 digit with hyphen', platform: 'eBay (long)' }
          ]
        }
      });
    } catch (error) {
      console.error("Marketplace diagnostic error:", error);
      res.status(500).json({
        success: false,
        error: "Failed to generate marketplace diagnostic",
      });
    }
  });

  // Price-o-Matic sync endpoint (manual trigger from POM screen)
  app.post("/api/sync/priceomatic", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      // Fast in-memory check — blocks if an incompatible sync is already running
      if (syncLock.isBlockedFor('Price-o-Matic')) {
        const blocker = syncLock.getBlockersFor('Price-o-Matic').join(', ');
        return res.status(409).json({
          success: false,
          error: `Cannot start Price-o-Matic: ${blocker} is already running. Please wait for it to complete.`,
        });
      }

      // Use pomBatchSize (manual sync setting) — never the scheduler's pomScheduleBatchSize
      // POM is a platform-level job, so always read from the platform settings row
      const pomSettings = await getOrgSettings(PLATFORM_ORG_ID);
      const maxItems = req.body.maxItems ?? pomSettings?.pomBatchSize ?? 1500;
      
      // DB-level check as secondary guard (survives server restarts)
      const [existingSync] = await db
        .select()
        .from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'priceomatic_cache')))
        .limit(1);
      
      if (existingSync?.lastSyncStatus === 'in_progress' && existingSync.lastSyncTime) {
        const timeSinceSync = Date.now() - new Date(existingSync.lastSyncTime).getTime();
        const tenMinutesInMs = 10 * 60 * 1000;
        if (timeSinceSync < tenMinutesInMs) {
          return res.status(409).json({
            success: false,
            error: 'A sync is already in progress. Please wait for it to complete.',
          });
        }
        // Stale (>10 min) — allow override
      }

      // Claim the global lock (race-condition guard — another sync may have started since the check above)
      if (!setPomIsRunning(true)) {
        const blocker = syncLock.getActive().join(', ');
        return res.status(409).json({
          success: false,
          error: `Cannot start Price-o-Matic: ${blocker} is already running.`,
        });
      }
      
      // Update sync metadata to "in_progress"
      await db
        .insert(syncMetadata)
        .values({
          id: 'priceomatic_cache',
          lastSyncStatus: 'in_progress',
          lastSyncTime: new Date(),
          recordsAdded: 0,
          recordsUpdated: 0,
          orgId: PLATFORM_ORG_ID,
        })
        .onConflictDoUpdate({
          target: syncMetadata.id,
          set: {
            lastSyncStatus: 'in_progress',
            lastSyncTime: new Date(),
            updatedAt: new Date(),
          },
        });

      // Start the sync in the background (don't await)
      syncPriceOMagicCache(maxItems).then(async (result) => {
        setPomIsRunning(false);
        await db
          .insert(syncMetadata)
          .values({
            id: 'priceomatic_cache',
            lastSyncStatus: result.stopped && result.stopReason?.includes('limit') ? 'partial' : 'success',
            lastSyncTime: new Date(),
            recordsAdded: 0,
            recordsUpdated: result.itemsUpdated,
            errorMessage: result.stopReason || null,
            orgId: PLATFORM_ORG_ID,
          })
          .onConflictDoUpdate({
            target: syncMetadata.id,
            set: {
              lastSyncStatus: result.stopped && result.stopReason?.includes('limit') ? 'partial' : 'success',
              lastSyncTime: new Date(),
              recordsUpdated: result.itemsUpdated,
              errorMessage: result.stopReason || null,
              updatedAt: new Date(),
            },
          });
      }).catch(async (error) => {
        setPomIsRunning(false);
        console.error("Price-o-Matic background sync error:", error);
        await db
          .insert(syncMetadata)
          .values({
            id: 'priceomatic_cache',
            lastSyncStatus: 'failed',
            lastSyncTime: new Date(),
            recordsAdded: 0,
            recordsUpdated: 0,
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
            orgId: PLATFORM_ORG_ID,
          })
          .onConflictDoUpdate({
            target: syncMetadata.id,
            set: {
              lastSyncStatus: 'failed',
              errorMessage: error instanceof Error ? error.message : 'Unknown error',
              updatedAt: new Date(),
            },
          });
      });

      // Respond immediately that sync has started
      res.json({
        success: true,
        data: {
          message: 'Sync started in background',
          maxItems,
        },
      });
    } catch (error) {
      console.error("Price-o-Matic sync start error:", error);
      
      res.status(500).json({
        success: false,
        error: "Failed to start Price-o-Matic sync",
      });
    }
  });

  // Get Price-o-Matic sync status
  app.get("/api/sync/priceomatic/status", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const [status] = await db
        .select()
        .from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'priceomatic_cache')))
        .limit(1);

      const { checkRateLimit, getPomSyncProgress } = await import("./services/bricklink");
      const { getPomIsRunning } = await import("./services/pom-scheduler");
      const rateLimit = await checkRateLimit(orgId);
      const liveProgress = getPomSyncProgress();

      const [pomSettings] = await db.select({
        apiCeiling: appSettings.blApiCallLimit,
        pomApiBudgetPct: appSettings.pomApiBudgetPct,
      }).from(appSettings).where(eq(appSettings.id, PLATFORM_ORG_ID)).limit(1);

      const pomBudgetedCeiling = Math.floor((pomSettings?.apiCeiling ?? 4900) * (pomSettings?.pomApiBudgetPct ?? 70) / 100);

      const [unenrichedRow] = await db.select({
        count: sql<number>`COUNT(*)`,
      }).from(blInventory)
        .leftJoin(
          priceGuideCache,
          and(
            sql`UPPER(${blInventory.itemNo}) = ${priceGuideCache.itemNo}`,
            eq(blInventory.itemType, priceGuideCache.itemType),
            sql`CASE WHEN COALESCE(${blInventory.colorId}, 0) = 0 THEN ${priceGuideCache.colorId} IN (0, -1) ELSE ${blInventory.colorId} = ${priceGuideCache.colorId} END`,
            sql`${blInventory.newOrUsed} = ${priceGuideCache.newOrUsed}`
          )
        )
        .where(and(gt(blInventory.quantity, 0), sql`${priceGuideCache.id} IS NULL`));

      let resolvedStatus = status;
      if (status?.lastSyncStatus === 'in_progress' && !getPomIsRunning()) {
        const staleFix = {
          lastSyncStatus: 'error' as const,
          errorMessage: 'Sync interrupted — server was restarted or sync was killed mid-run.',
          updatedAt: new Date(),
        };
        await db.update(syncMetadata).set(staleFix).where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'priceomatic_cache')));
        resolvedStatus = { ...status, ...staleFix };
        console.log('[POM] Cleared stale in_progress status from previous run');
      }

      res.json({
        success: true,
        data: {
          ...(resolvedStatus || {
            id: 'priceomatic_cache',
            lastSyncStatus: 'never',
            lastSyncTime: null,
            recordsUpdated: 0,
          }),
          callsLast24h: rateLimit.callsLast24h,
          apiCeiling: pomBudgetedCeiling,
          unenrichedCount: unenrichedRow?.count ?? 0,
          oldestCallTime: rateLimit.oldestCallTime ?? null,
          newestCallTime: rateLimit.newestCallTime ?? null,
          hourlyBuckets: rateLimit.hourlyBuckets ?? [],
          liveProgress,
        },
      });
    } catch (error) {
      console.error("Error fetching Price-o-Matic status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch sync status",
      });
    }
  });

  // Stop an in-progress Price-o-Matic sync
  app.post("/api/sync/priceomatic/stop", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      requestPomSyncStop();
      // Mark the sync as stopped in the DB so the UI reflects it immediately
      await db
        .insert(syncMetadata)
        .values({
          id: 'priceomatic_cache',
          lastSyncStatus: 'stopped',
          lastSyncTime: new Date(),
          errorMessage: 'Sync stopped by user request.',
          orgId,
        })
        .onConflictDoUpdate({
          target: syncMetadata.id,
          set: {
            lastSyncStatus: 'stopped',
            errorMessage: 'Sync stopped by user request.',
            updatedAt: new Date(),
          },
        });
      console.log('[Price-o-Matic] Stop requested by user');
      res.json({ success: true, message: 'Stop signal sent — sync will halt before the next item.' });
    } catch (error) {
      console.error("Error stopping Price-o-Matic sync:", error);
      res.status(500).json({ success: false, error: "Failed to stop sync" });
    }
  });

  app.get("/api/sync/catalog-detail/status", isSuperAdmin, async (req: any, res) => {
    try {
      const [status] = await db.select().from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'catalog_detail_completion')))
        .limit(1);
      const { getCatalogDetailProgress, getCatalogDetailIsRunning } = await import('./services/catalog-detail-scheduler.js');
      const liveProgress = getCatalogDetailProgress();
      let resolvedStatus = status;
      if (status?.lastSyncStatus === 'in_progress' && !getCatalogDetailIsRunning()) {
        const staleFix = { lastSyncStatus: 'error' as const, errorMessage: 'Sync interrupted — server restarted mid-run.', updatedAt: new Date() };
        await db.update(syncMetadata).set(staleFix).where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'catalog_detail_completion')));
        resolvedStatus = { ...status, ...staleFix };
      }
      res.json({ success: true, data: { ...(resolvedStatus || { id: 'catalog_detail_completion', lastSyncStatus: 'never', lastSyncTime: null }), liveProgress } });
    } catch (error) {
      console.error("Error fetching Catalog Detail status:", error);
      res.status(500).json({ success: false, error: "Failed to fetch status" });
    }
  });

  app.get("/api/sync/catalog-scan/status", isSuperAdmin, async (req: any, res) => {
    try {
      const [status] = await db.select().from(syncMetadata)
        .where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'catalog_scan')))
        .limit(1);
      const { getCatalogScanProgress, getCatalogScanIsRunning } = await import('./services/catalog-scan-scheduler.js');
      const liveProgress = getCatalogScanProgress();
      let resolvedStatus = status;
      if (status?.lastSyncStatus === 'in_progress' && !getCatalogScanIsRunning()) {
        const staleFix = { lastSyncStatus: 'error' as const, errorMessage: 'Scan interrupted — server restarted mid-run.', updatedAt: new Date() };
        await db.update(syncMetadata).set(staleFix).where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'catalog_scan')));
        resolvedStatus = { ...status, ...staleFix };
      }
      res.json({ success: true, data: { ...(resolvedStatus || { id: 'catalog_scan', lastSyncStatus: 'never', lastSyncTime: null }), liveProgress } });
    } catch (error) {
      console.error("Error fetching Catalog Scan status:", error);
      res.status(500).json({ success: false, error: "Failed to fetch status" });
    }
  });

  // Clear all Price-o-Matic cache data and reset sync status
  app.delete("/api/sync/priceomatic/cache", isApproved, async (req: any, res) => {
    try {
      const result = await db.execute(sql`DELETE FROM price_guide_cache`);
      const deleted = (result as any).rowCount ?? 0;

      // Reset sync metadata so the dashboard shows 'never'
      await db.delete(syncMetadata).where(and(eq(syncMetadata.orgId, PLATFORM_ORG_ID), eq(syncMetadata.id, 'priceomatic_cache')));

      console.log(`[Price-o-Matic] Cache cleared: ${deleted} rows deleted`);
      res.json({ success: true, deleted });
    } catch (error) {
      console.error("Error clearing Price-o-Matic cache:", error);
      res.status(500).json({ success: false, error: "Failed to clear cache" });
    }
  });

  // Deep Space: get current keys + stored item metadata for cross-device rendering
  app.get("/api/priceomatic/deep-space", isApproved, async (req: any, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const orgId = reqOrgId(req);
      const settings = await getOrgSettings(orgId);
      const raw = settings?.pomDeepSpaceKeys || '[]';
      const parsed: unknown[] = JSON.parse(raw);
      // Support both old format (string[]) and new format (StoredGroupInfo[])
      type StoredGroupInfo = { key: string; itemNo: string; itemName: string | null; colorId: number | null; colorName: string | null };
      const items: StoredGroupInfo[] = parsed.map((el: unknown) =>
        typeof el === 'string'
          ? { key: el, itemNo: el.split('_')[0], itemName: null, colorId: null, colorName: null }
          : el as StoredGroupInfo
      );
      const keys = items.map(i => i.key);
      res.json({ success: true, keys, items });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to fetch deep space keys" });
    }
  });

  // Deep Space: save full set of item metadata (key + display info)
  app.put("/api/priceomatic/deep-space", isApproved, async (req: any, res) => {
    try {
      const { items } = req.body as { items?: { key: string; itemNo: string; itemName: string | null; colorId: number | null; colorName: string | null }[]; keys?: string[] };
      // Accept either new format (items[]) or legacy format (keys[])
      const toStore = items ?? (req.body.keys as string[] | undefined)?.map((k: string) => ({ key: k, itemNo: k.split('_')[0], itemName: null, colorId: null, colorName: null })) ?? [];
      if (!Array.isArray(toStore)) return res.status(400).json({ success: false, error: "items must be an array" });
      const json = JSON.stringify(toStore);
      const orgId = reqOrgId(req);
      await db.insert(appSettings).values({ id: orgId, orgId, pomDeepSpaceKeys: json })
        .onConflictDoUpdate({ target: appSettings.id, set: { pomDeepSpaceKeys: json, updatedAt: new Date() } });
      res.json({ success: true, keys: toStore.map((i: { key: string }) => i.key), items: toStore });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to save deep space keys" });
    }
  });

  // Future Missions: fetch queue
  app.get("/api/priceomatic/future-missions", isApproved, async (req: any, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const orgId = reqOrgId(req);
      const settings = await getOrgSettings(orgId);
      const raw = settings?.pomFutureMissionsKeys || '[]';
      const parsed: unknown[] = JSON.parse(raw);
      type StoredGroupInfo = { key: string; itemNo: string; itemName: string | null; colorId: number | null; colorName: string | null };
      const items: StoredGroupInfo[] = parsed.map((el: unknown) =>
        typeof el === 'string'
          ? { key: el, itemNo: el.split('_')[0], itemName: null, colorId: null, colorName: null }
          : el as StoredGroupInfo
      );
      res.json({ success: true, keys: items.map(i => i.key), items });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to fetch future missions keys" });
    }
  });

  // Future Missions: save queue
  app.put("/api/priceomatic/future-missions", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { items } = req.body as { items?: { key: string; itemNo: string; itemName: string | null; colorId: number | null; colorName: string | null }[] };
      const toStore = items ?? [];
      if (!Array.isArray(toStore)) return res.status(400).json({ success: false, error: "items must be an array" });
      const json = JSON.stringify(toStore);
      await db.insert(appSettings).values({ id: orgId, orgId, pomFutureMissionsKeys: json })
        .onConflictDoUpdate({ target: appSettings.id, set: { pomFutureMissionsKeys: json, updatedAt: new Date() } });
      res.json({ success: true, keys: toStore.map((i: { key: string }) => i.key), items: toStore });
    } catch (error) {
      res.status(500).json({ success: false, error: "Failed to save future missions keys" });
    }
  });

  // Get categories with their priority tiers — only categories that exist in our inventory
  app.get("/api/priceomatic/category-tiers", isApproved, async (req, res) => {
    try {
      const categories = await db
        .selectDistinct({ id: blCategories.id, name: blCategories.name, priorityTier: blCategories.priorityTier })
        .from(blCategories)
        .innerJoin(blCatalog, eq(blCatalog.categoryId, blCategories.id))
        .orderBy(blCategories.name);
      res.json({ success: true, categories });
    } catch (error) {
      console.error("Error fetching category tiers:", error);
      res.status(500).json({ error: "Failed to fetch category tiers" });
    }
  });

  // Update a category's priority tier
  app.patch("/api/priceomatic/category-tier", isApproved, async (req, res) => {
    try {
      const { categoryId, tier } = req.body as { categoryId: number; tier: string };
      if (!categoryId || !['tier1', 'tier2', 'tier3', 'tier4', 'standard'].includes(tier)) {
        return res.status(400).json({ error: "Invalid categoryId or tier" });
      }
      await db
        .update(blCategories)
        .set({ priorityTier: tier, updatedAt: new Date() })
        .where(eq(blCategories.id, categoryId));
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating category tier:", error);
      res.status(500).json({ error: "Failed to update category tier" });
    }
  });

  // Auto-assign all categories to tiers based on name keywords and inventory data
  app.post("/api/priceomatic/tier-reset", isApproved, async (req, res) => {
    try {
      const categories = await db
        .select({ id: blCategories.id, name: blCategories.name, priorityTier: blCategories.priorityTier })
        .from(blCategories);

      function autoAssignTier(name: string): string {
        const n = name.toLowerCase();
        // ── Tier 1: Minifigures, Bionicle, premium collectibles ─────────
        if (n.includes('minifig') || n.startsWith('minifigure')) return 'tier1';
        if (n.includes('bionicle')) return 'tier1';
        if (n.includes('large figure')) return 'tier1';
        if (n.includes('collectible minifigure') || n.startsWith('collectible')) return 'tier1';
        // ── Tier 2: High-demand structural & specialized ─────────────────
        if (n.startsWith('technic')) return 'tier2';
        if (n.includes('slope') || n.includes('inverted slope')) return 'tier2';
        if (n.includes('bracket') || n.includes('snot')) return 'tier2';
        if (n.includes('modified brick') || n.includes('modified plate') || n.includes('modified tile')) return 'tier2';
        if (n.includes('hinge') || n.includes('clip') || n.includes('bar, connected')) return 'tier2';
        if (n.includes('electric') || n.includes('battery') || n.includes('motor') || n.includes('pneumatic')) return 'tier2';
        if (n.includes('power function') || n.includes('powered up') || n.includes('train')) return 'tier2';
        if (n.includes('windscreen') || n.includes('window') || n.includes('door,')) return 'tier2';
        if (n.includes('decorated') && (n.includes('plate') || n.includes('brick') || n.includes('tile') || n.includes('slope'))) return 'tier2';
        if (n.includes('container') || n.includes('vehicle') || n.includes('cockpit') || n.includes('fuselage')) return 'tier2';
        // ── Tier 3: Core commodity parts ─────────────────────────────────
        if (n.startsWith('brick') || n.startsWith('plate') || n.startsWith('tile') ||
            n.startsWith('bar') || n.startsWith('cylinder') || n.startsWith('wedge') ||
            n.startsWith('arch') || n.startsWith('round') || n.startsWith('cone') ||
            n.startsWith('panel') || n.startsWith('fence') || n.startsWith('flag') ||
            n.startsWith('plant') || n.startsWith('animal') || n.startsWith('rock')) return 'tier3';
        // ── Tier 4: Niche / very low velocity ────────────────────────────
        if (n.startsWith('sticker') || n.startsWith('label') || n.startsWith('book') ||
            n.startsWith('magazine') || n.startsWith('catalog') || n.startsWith('instruction') ||
            n.startsWith('display') || n.startsWith('storage')) return 'tier4';
        // Default: tier3 (safe commodity catch-all)
        return 'tier3';
      }

      const updates: Array<{ id: number; tier: string }> = [];
      const summary: Record<string, number> = { tier1: 0, tier2: 0, tier3: 0, tier4: 0, unchanged: 0 };

      for (const cat of categories) {
        const newTier = autoAssignTier(cat.name);
        if (newTier !== cat.priorityTier) {
          updates.push({ id: cat.id, tier: newTier });
          summary[newTier] = (summary[newTier] || 0) + 1;
        } else {
          summary.unchanged++;
        }
      }

      // Batch update
      for (const u of updates) {
        await db
          .update(blCategories)
          .set({ priorityTier: u.tier, updatedAt: new Date() })
          .where(eq(blCategories.id, u.id));
      }

      res.json({ success: true, changed: updates.length, unchanged: summary.unchanged, summary });
    } catch (error) {
      console.error("Error resetting tiers:", error);
      res.status(500).json({ error: "Failed to reset tiers" });
    }
  });

  // ── List-o-Matic: category sorting phase endpoints ──────────────────────────

  // Get all inventory categories with their sorting phase assignments
  app.get("/api/listomatc/category-phases", isApproved, async (req, res) => {
    try {
      const categories = await db
        .selectDistinct({
          id: blCategories.id,
          name: blCategories.name,
          sortingPhase: blCategories.sortingPhase,
        })
        .from(blCategories)
        .innerJoin(blCatalog, eq(blCatalog.categoryId, blCategories.id))
        .orderBy(blCategories.name);
      res.json({ success: true, categories });
    } catch (error) {
      console.error("Error fetching category phases:", error);
      res.status(500).json({ error: "Failed to fetch category phases" });
    }
  });

  // Update a category's sorting phase
  app.patch("/api/listomatc/category-phase", isApproved, async (req, res) => {
    try {
      const { categoryId, phase } = req.body as { categoryId: number; phase: string | null };
      const validPhases = ['category', 'subcategory', 'finalsort', 'listing', null];
      if (!categoryId || !validPhases.includes(phase)) {
        return res.status(400).json({ error: "Invalid categoryId or phase" });
      }
      await db
        .update(blCategories)
        .set({ sortingPhase: phase, updatedAt: new Date() })
        .where(eq(blCategories.id, categoryId));
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating category phase:", error);
      res.status(500).json({ error: "Failed to update category phase" });
    }
  });

  // List-o-Matic Priority Score List
  app.get("/api/listomatc/priority", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const cfg = await getOrgSettings(orgId);

      const phaseScores: Record<string, number> = {
        category: cfg?.lomCategoryScore ?? 25,
        subcategory: cfg?.lomSubcategoryScore ?? 50,
        finalsort: cfg?.lomFinalsortScore ?? 75,
        listing: cfg?.lomListingScore ?? 100,
      };

      const rows = await db.execute(sql`
        SELECT
          c.id,
          c.name,
          c.sorting_phase,
          c.flagged,
          COALESCE(inv.current_qty, 0)::integer    AS current_qty,
          COALESCE(inv.sold_out_lots, 0)::integer  AS sold_out_lots,
          COALESCE(inv.total_lots, 0)::integer     AS total_lots,
          COALESCE(sold.total_sold, 0)::integer    AS total_sold
        FROM ${blCategories} c
        LEFT JOIN (
          SELECT cat.category_id,
                 SUM(inv_inner.quantity)                                     AS current_qty,
                 COUNT(*) FILTER (WHERE inv_inner.quantity = 0)              AS sold_out_lots,
                 COUNT(*)                                          AS total_lots
          FROM ${blInventory} inv_inner
          JOIN ${blCatalog} cat ON inv_inner.item_no = cat.item_no
            AND inv_inner.item_type = cat.item_type
            AND inv_inner.color_id = cat.color_id
          WHERE inv_inner.item_type = 'PART'
            AND inv_inner.org_id = ${orgId}
          GROUP BY cat.category_id
        ) inv ON c.id = inv.category_id
        LEFT JOIN (
          SELECT cat2.category_id, SUM(od.quantity) AS total_sold
          FROM ${orderDetails} od
          JOIN ${orders} o ON od.order_id = o.id
          JOIN ${blInventory} i ON od.sku = CAST(i.id AS TEXT)
          JOIN ${blCatalog} cat2 ON i.item_no = cat2.item_no
            AND i.item_type = cat2.item_type
            AND i.color_id = cat2.color_id
          WHERE o.order_status NOT IN ('cancelled', 'Cancelled')
            AND i.item_type = 'PART'
            AND o.org_id = ${orgId}
            AND i.org_id = ${orgId}
          GROUP BY cat2.category_id
        ) sold ON c.id = sold.category_id
        WHERE COALESCE(inv.current_qty, 0) + COALESCE(inv.sold_out_lots, 0) + COALESCE(sold.total_sold, 0) > 0
      `);

      const scored = (rows.rows as any[]).map(r => {
        const currentQty    = Number(r.current_qty);
        const totalSold     = Number(r.total_sold);
        const soldOutLots   = Number(r.sold_out_lots);
        const totalLots     = Number(r.total_lots);

        const sellThroughPct = (currentQty + totalSold) > 0
          ? (totalSold / (currentQty + totalSold)) * 100 : 0;

        // % of this category's lots that are sold out
        const soldOutSharePct = totalLots > 0
          ? (soldOutLots / totalLots) * 100 : 0;

        const basePhaseScore = phaseScores[r.sorting_phase] ?? 0;
        const effectivePhaseScore = (r.sorting_phase === 'listing' && r.flagged)
          ? basePhaseScore * 2 : basePhaseScore;

        const score = sellThroughPct * 0.30 + soldOutSharePct * 0.30 + effectivePhaseScore * 0.40;

        return {
          id: Number(r.id),
          name: r.name,
          sortingPhase: r.sorting_phase,
          flagged: r.flagged,
          currentQty,
          totalSold,
          soldOutLots,
          totalLots,
          basePhaseScore,
          sellThroughPct: Math.round(sellThroughPct * 10) / 10,
          soldOutSharePct: Math.round(soldOutSharePct * 10) / 10,
          effectivePhaseScore,
          score: Math.round(score * 10) / 10,
        };
      });

      scored.sort((a, b) => b.score - a.score);
      res.json({ categories: scored, phaseScores });
    } catch (error) {
      console.error("Error fetching listomatc priority:", error);
      res.status(500).json({ error: "Failed to fetch priority list" });
    }
  });

  // Sample parts for a category (up to 5, ordered by qty desc)
  app.get("/api/listomatc/category/:id/sample", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const categoryId = parseInt(req.params.id);
      if (isNaN(categoryId)) return res.status(400).json({ error: "Invalid category id" });

      const rows = await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
          colorName: blColors.name,
          quantity: blInventory.quantity,
          unitPrice: blInventory.unitPrice,
          thumbnailUrl: blCatalog.thumbnailUrl,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .where(and(eq(blInventory.orgId, orgId), eq(blCatalog.categoryId, categoryId), eq(blInventory.itemType, 'PART')))
        .orderBy(desc(blInventory.quantity))
        .limit(5);

      res.json({ items: rows });
    } catch (error) {
      console.error("Error fetching category sample:", error);
      res.status(500).json({ error: "Failed to fetch sample" });
    }
  });

  // Toggle flag on a category (doubles phase score in listing phase)
  app.patch("/api/listomatc/categories/:id/flag", isApproved, async (req, res) => {
    try {
      const categoryId = parseInt(req.params.id);
      if (isNaN(categoryId)) return res.status(400).json({ error: "Invalid category id" });
      const [current] = await db.select({ flagged: blCategories.flagged })
        .from(blCategories).where(eq(blCategories.id, categoryId)).limit(1);
      if (!current) return res.status(404).json({ error: "Category not found" });
      await db.update(blCategories)
        .set({ flagged: !current.flagged, updatedAt: new Date() })
        .where(eq(blCategories.id, categoryId));
      res.json({ success: true, flagged: !current.flagged });
    } catch (error) {
      console.error("Error toggling flag:", error);
      res.status(500).json({ error: "Failed to toggle flag" });
    }
  });

  app.patch("/api/listomatc/phase-scores", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { category, subcategory, finalsort, listing } = req.body;
      await db.update(appSettings).set({
        lomCategoryScore:    Number(category)    || 25,
        lomSubcategoryScore: Number(subcategory) || 50,
        lomFinalsortScore:   Number(finalsort)   || 75,
        lomListingScore:     Number(listing)     || 100,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      }).where(eq(appSettings.id, orgId));
      res.json({ success: true });
    } catch (error) {
      console.error("Error saving phase scores:", error);
      res.status(500).json({ error: "Failed to save phase scores" });
    }
  });

  // Get Price-o-Matic insights (pricing discrepancies)
  // Per-category Price-o-Matic freshness stats
  app.get("/api/priceomatic/freshness", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      // Load tier refresh thresholds from settings
      const cfg = await getOrgSettings(orgId);

      const tierDays: Record<string, number> = {
        tier1: cfg?.pomTier1RefreshDays ?? 1,
        tier2: cfg?.pomTier2RefreshDays ?? 3,
        tier3: cfg?.pomTier3RefreshDays ?? 7,
        tier4: cfg?.pomTier4RefreshDays ?? 30,
      };

      // Aggregate per-category: total lots, fetched lots, oldest + newest fetch times
      // MIN(fetched_at) = oldest cache entry — freshness is only "fresh" when ALL lots are within window
      const rows = await db.execute(sql`
        SELECT
          c.id                                          AS category_id,
          c.name                                        AS category_name,
          c.priority_tier                               AS tier,
          COUNT(i.id)                                   AS total_lots,
          COUNT(pgc.id)                                 AS fetched_lots,
          MIN(pgc.fetched_at)                           AS oldest_fetched_at,
          MAX(pgc.fetched_at)                           AS last_fetched_at
        FROM bl_inventory i
        LEFT JOIN bl_catalog bc ON i.item_no = bc.item_no AND i.item_type = bc.item_type AND COALESCE(i.color_id, 0) = bc.color_id
        LEFT JOIN bl_categories c ON bc.category_id = c.id
        LEFT JOIN price_guide_cache pgc
          ON i.item_no = pgc.item_no
          AND i.item_type = pgc.item_type
          AND i.new_or_used = pgc.new_or_used
          AND CASE WHEN COALESCE(i.color_id, 0) = 0 THEN pgc.color_id IN (0, -1) ELSE i.color_id = pgc.color_id END
        GROUP BY c.id, c.name, c.priority_tier
        ORDER BY c.name
      `);

      // Fresh = updated within 6 months (180 days). Stale = older than 6 months.
      // This is separate from the tier refresh schedule (which controls how often POM reprices).
      const FRESH_THRESHOLD_DAYS = 180;
      const FRESH_THRESHOLD_MS = FRESH_THRESHOLD_DAYS * 86400000;

      const now = Date.now();
      const categories = (rows.rows as any[]).map((row) => {
        const tier = row.tier || 'tier2';
        const oldestFetchedAt = row.oldest_fetched_at ? new Date(row.oldest_fetched_at) : null;
        const lastFetchedAt = row.last_fetched_at ? new Date(row.last_fetched_at) : null;
        const totalLots = parseInt(row.total_lots) || 0;
        const fetchedLots = parseInt(row.fetched_lots) || 0;
        const neverFetched = totalLots - fetchedLots;

        // Fresh = POM has run on this category recently (last_fetched_at within 6 months)
        // Stale = POM has touched it but not within 6 months
        // Never = no lots in this category have ever been fetched
        let status: 'fresh' | 'stale' | 'never' = 'never';
        if (lastFetchedAt && fetchedLots > 0) {
          const lastActivityFresh = now - lastFetchedAt.getTime() < FRESH_THRESHOLD_MS;
          status = lastActivityFresh ? 'fresh' : 'stale';
        }

        // daysSince reflects last POM activity on this category (most recent fetch)
        const daysSince = lastFetchedAt
          ? Math.floor((now - lastFetchedAt.getTime()) / 86400000)
          : null;

        return {
          categoryId: row.category_id ? parseInt(row.category_id) : null,
          categoryName: row.category_name || '(Uncategorized)',
          tier,
          totalLots,
          fetchedLots,
          neverFetched,
          coveragePct: totalLots > 0 ? Math.round((fetchedLots / totalLots) * 100) : 0,
          lastFetchedAt: lastFetchedAt?.toISOString() ?? null,
          daysSince,
          status,
          refreshDays: tierDays[tier] ?? 3,       // tier schedule (how often POM reprices)
          freshThresholdDays: FRESH_THRESHOLD_DAYS, // freshness status threshold (6 months)
        };
      });

      // Also compute per-tier summaries
      const tierSummary = Object.fromEntries(
        Object.keys(tierDays).map((tier) => {
          const cats = categories.filter((c) => c.tier === tier);
          const totalLots = cats.reduce((s, c) => s + c.totalLots, 0);
          const fetchedLots = cats.reduce((s, c) => s + c.fetchedLots, 0);
          const freshCats = cats.filter((c) => c.status === 'fresh').length;
          const staleCats = cats.filter((c) => c.status === 'stale').length;
          const neverCats = cats.filter((c) => c.status === 'never').length;
          const lastFetch = cats.reduce((best, c) => {
            if (!c.lastFetchedAt) return best;
            if (!best) return c.lastFetchedAt;
            return c.lastFetchedAt > best ? c.lastFetchedAt : best;
          }, null as string | null);
          return [tier, { totalLots, fetchedLots, coveragePct: totalLots > 0 ? Math.round((fetchedLots / totalLots) * 100) : 0, freshCats, staleCats, neverCats, lastFetch, refreshDays: tierDays[tier] }];
        })
      );

      res.json({ success: true, categories, tierSummary });
    } catch (error) {
      console.error("Error fetching POM freshness:", error);
      res.status(500).json({ error: "Failed to fetch freshness stats" });
    }
  });

  app.get("/api/priceomatic/insights", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { priceGuideCache } = await import("@shared/schema");

      // Pre-compute the peak sold price per item/type/color in one pass
      const peakSoldSub = db
        .select({
          itemNo: priceGuideCache.itemNo,
          itemType: priceGuideCache.itemType,
          colorId: priceGuideCache.colorId,
          peakSold: sql<string>`MAX(${priceGuideCache.soldMaxPrice})`.as('peak_sold'),
        })
        .from(priceGuideCache)
        .groupBy(priceGuideCache.itemNo, priceGuideCache.itemType, priceGuideCache.colorId)
        .as('peak_sold_sub');

      // Join inventory with cached price data — pure data enrichment, no formula computation
      const insights = await db
        .select({
          inventoryId: blInventory.id,
          itemNo: blInventory.itemNo,
          itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
          itemType: blInventory.itemType,
          colorId: blInventory.colorId,
          colorName: blColors.name,
          colorRgb: blColors.rgb,
          newOrUsed: blInventory.newOrUsed,
          currentPrice: blInventory.unitPrice,
          myCost: blInventory.myCost,
          stockAvgPrice: priceGuideCache.stockAvgPrice,
          stockMinPrice: priceGuideCache.stockMinPrice,
          stockMaxPrice: priceGuideCache.stockMaxPrice,
          stockQuantity: sql<number>`${priceGuideCache}.stock_quantity`.as('stockQuantity'),
          stockTotalLots: priceGuideCache.stockTotalLots,
          soldAvgPrice: priceGuideCache.soldAvgPrice,
          soldMinPrice: priceGuideCache.soldMinPrice,
          soldMaxPrice: priceGuideCache.soldMaxPrice,
          soldQuantity: sql<number>`${priceGuideCache}.sold_quantity`.as('soldQuantity'),
          soldTotalLots: priceGuideCache.soldTotalLots,
          quantity: blInventory.quantity,
          lastFetched: priceGuideCache.fetchedAt,
          marketPeakSoldPrice: peakSoldSub.peakSold,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .innerJoin(
          priceGuideCache,
          and(
            sql`UPPER(${blInventory.itemNo}) = ${priceGuideCache.itemNo}`,
            eq(blInventory.itemType, priceGuideCache.itemType),
            eq(blInventory.newOrUsed, priceGuideCache.newOrUsed),
            sql`CASE WHEN COALESCE(${blInventory.colorId}, 0) = 0 THEN ${priceGuideCache.colorId} IN (0, -1) ELSE ${blInventory.colorId} = ${priceGuideCache.colorId} END`
          )
        )
        .leftJoin(
          peakSoldSub,
          and(
            eq(blInventory.itemNo, peakSoldSub.itemNo),
            eq(blInventory.itemType, peakSoldSub.itemType),
            sql`(${blInventory.colorId} = ${peakSoldSub.colorId} OR (${blInventory.colorId} IS NULL AND ${peakSoldSub.colorId} IS NULL))`
          )
        )
        .where(and(eq(blInventory.orgId, orgId), sql`${blInventory.unitPrice} IS NOT NULL AND (${priceGuideCache.stockAvgPrice} IS NOT NULL OR ${priceGuideCache.soldAvgPrice} IS NOT NULL)`))

      // Load scoring weights from org settings
      const scoringSettings = await getOrgSettings(orgId);
      const wCeiling = scoringSettings?.pomWeightCeiling ?? 0.4;
      const wVelocity = scoringSettings?.pomWeightVelocity ?? 0.3;
      const wScarcity = scoringSettings?.pomWeightScarcity ?? 0.2;
      const wUndercut = scoringSettings?.pomWeightUndercut ?? 0.1;

      // Enrich with all repricing scores
      const enrichedItems = insights.map(item => {
        const currentPrice = parseFloat(item.currentPrice || '0');
        const marketPeak = item.marketPeakSoldPrice ? parseFloat(item.marketPeakSoldPrice) : null;

        // 1. Price Ceiling Ratio (= old opportunityScore)
        const priceCeilingRatio = (marketPeak !== null && currentPrice > 0)
          ? Number((marketPeak / currentPrice).toFixed(3))
          : null;

        // 2. Demand Velocity = soldQuantity / stockQuantity (fall back to lots if qty not yet populated)
        const soldQty = item.soldQuantity ?? parseInt(item.soldTotalLots || '0');
        const stockQty = item.stockQuantity ?? parseInt(item.stockTotalLots || '0');
        const demandVelocity = (stockQty > 0)
          ? Number((soldQty / stockQty).toFixed(3))
          : null;

        // 3. Market Scarcity Index = 1 / stockQuantity (fall back to lots if qty not yet populated)
        const marketScarcity = (stockQty > 0)
          ? Number((1 / stockQty).toFixed(4))
          : null;

        // 4. Undercut Ratio = ourPrice / stockMinPrice
        const stockMin = parseFloat(item.stockMinPrice || '0');
        const undercutRatio = (stockMin > 0 && currentPrice > 0)
          ? Number((currentPrice / stockMin).toFixed(3))
          : null;

        // 5. Combined Repricing Opportunity Score — compute if any component exists
        let repricingScore: number | null = null;
        const hasAnyComponent = priceCeilingRatio !== null || demandVelocity !== null || marketScarcity !== null || undercutRatio !== null;
        if (hasAnyComponent) {
          const ceilingComponent = (priceCeilingRatio ?? 0) * wCeiling;
          const velocityComponent = (demandVelocity ?? 0) * wVelocity;
          const scarcityComponent = (marketScarcity ?? 0) * wScarcity;
          const undercutComponent = (undercutRatio && undercutRatio > 0) ? (1 / undercutRatio) * wUndercut : 0;
          repricingScore = Number((ceilingComponent + velocityComponent + scarcityComponent + undercutComponent).toFixed(3));
        }

        return {
          inventoryId: item.inventoryId,
          itemNo: item.itemNo,
          itemName: (item.itemName && item.itemName !== 'undefined') ? item.itemName : null,
          itemType: item.itemType,
          colorId: item.colorId,
          colorName: item.colorName,
          colorRgb: item.colorRgb ?? null,
          newOrUsed: item.newOrUsed,
          currentPrice: item.currentPrice,
          myCost: item.myCost,
          stockAvgPrice: item.stockAvgPrice,
          stockMinPrice: item.stockMinPrice,
          stockMaxPrice: item.stockMaxPrice,
          stockQuantity: item.stockQuantity,
          stockTotalLots: item.stockTotalLots,
          soldAvgPrice: item.soldAvgPrice,
          soldMinPrice: item.soldMinPrice,
          soldMaxPrice: item.soldMaxPrice,
          soldQuantity: item.soldQuantity,
          soldTotalLots: item.soldTotalLots,
          marketPeakSoldPrice: item.marketPeakSoldPrice,
          opportunityScore: priceCeilingRatio,
          priceCeilingRatio,
          demandVelocity,
          marketScarcity,
          undercutRatio,
          repricingScore,
          quantity: item.quantity,
          lastFetched: item.lastFetched,
        };
      });

      res.json({
        success: true,
        data: {
          items: enrichedItems,
          summary: {
            total: enrichedItems.length,
          },
          sugConfig: {
            soldAvgW: scoringSettings?.pomSugSoldAvgW ?? 0.5,
            stockMinW: scoringSettings?.pomSugStockMinW ?? 0.3,
            soldMaxW: scoringSettings?.pomSugSoldMaxW ?? 0.2,
            demandMult: scoringSettings?.pomSugDemandMult ?? 0.25,
            compCap: scoringSettings?.pomSugCompCap ?? 1.15,
            floor: scoringSettings?.pomSugFloor ?? 0.95,
            storePremium: scoringSettings?.pomSugStorePremium ?? 1.10,
          },
          scoreConfig: {
            wCeiling: wCeiling,
            wVelocity: wVelocity,
            wScarcity: wScarcity,
            wUndercut: wUndercut,
          },
        },
      });
    } catch (error) {
      console.error("Error fetching Price-o-Matic insights:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch pricing insights",
      });
    }
  });

  // ========================================
  // WAREHOUSE MANAGEMENT ROUTES
  // ========================================

  // Get all aisles with shelf and bin counts
  app.get("/api/warehouse/aisles", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const aislesWithCounts = await db
        .select({
          id: whAisles.id,
          name: whAisles.name,
          description: whAisles.description,
          createdAt: whAisles.createdAt,
          updatedAt: whAisles.updatedAt,
          shelfCount: sql<number>`(SELECT COUNT(*) FROM ${whShelves} WHERE ${whShelves.aisleId} = ${whAisles.id})`,
        })
        .from(whAisles)
        .where(eq(whAisles.orgId, orgId))
        .orderBy(whAisles.name);

      res.json(aislesWithCounts);
    } catch (error) {
      console.error("Error fetching aisles:", error);
      res.status(500).json({ error: "Failed to fetch aisles" });
    }
  });

  // Create aisle
  app.post("/api/warehouse/aisles", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const data = insertWhAisleSchema.parse(req.body);
      const [aisle] = await db
        .insert(whAisles)
        .values({ ...data, orgId })
        .returning();
      res.json(aisle);
    } catch (error) {
      console.error("Error creating aisle:", error);
      res.status(500).json({ error: "Failed to create aisle" });
    }
  });

  // Update aisle
  app.put("/api/warehouse/aisles/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = insertWhAisleSchema.parse(req.body);
      const [aisle] = await db
        .update(whAisles)
        .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(whAisles.id, id))
        .returning();
      
      if (!aisle) {
        return res.status(404).json({ error: "Aisle not found" });
      }
      res.json(aisle);
    } catch (error) {
      console.error("Error updating aisle:", error);
      res.status(500).json({ error: "Failed to update aisle" });
    }
  });

  // Delete aisle
  app.delete("/api/warehouse/aisles/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(whAisles).where(eq(whAisles.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting aisle:", error);
      res.status(500).json({ error: "Failed to delete aisle" });
    }
  });

  // Get all shelves (with optional aisle filter)
  app.get("/api/warehouse/shelves", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const aisleId = req.query.aisleId ? parseInt(req.query.aisleId as string) : null;
      
      const shelvesWithCounts = await db
        .select({
          id: whShelves.id,
          name: whShelves.name,
          aisleId: whShelves.aisleId,
          aisleName: whAisles.name,
          position: whShelves.position,
          description: whShelves.description,
          createdAt: whShelves.createdAt,
          updatedAt: whShelves.updatedAt,
          binCount: sql<number>`(SELECT COUNT(*) FROM ${whBins} WHERE ${whBins.shelfId} = ${whShelves.id})`,
        })
        .from(whShelves)
        .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
        .where(aisleId ? and(eq(whShelves.orgId, orgId), eq(whShelves.aisleId, aisleId)) : eq(whShelves.orgId, orgId))
        .orderBy(whShelves.aisleId, whShelves.position);

      res.json(shelvesWithCounts);
    } catch (error) {
      console.error("Error fetching shelves:", error);
      res.status(500).json({ error: "Failed to fetch shelves" });
    }
  });

  // Create shelf
  app.post("/api/warehouse/shelves", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const data = insertWhShelfSchema.parse(req.body);
      const [shelf] = await db
        .insert(whShelves)
        .values({ ...data, orgId })
        .returning();
      res.json(shelf);
    } catch (error) {
      console.error("Error creating shelf:", error);
      res.status(500).json({ error: "Failed to create shelf" });
    }
  });

  // Update shelf
  app.put("/api/warehouse/shelves/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = insertWhShelfSchema.parse(req.body);
      const [shelf] = await db
        .update(whShelves)
        .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(whShelves.id, id))
        .returning();
      
      if (!shelf) {
        return res.status(404).json({ error: "Shelf not found" });
      }
      res.json(shelf);
    } catch (error) {
      console.error("Error updating shelf:", error);
      res.status(500).json({ error: "Failed to update shelf" });
    }
  });

  // Delete shelf
  app.delete("/api/warehouse/shelves/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(whShelves).where(eq(whShelves.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting shelf:", error);
      res.status(500).json({ error: "Failed to delete shelf" });
    }
  });

  // Get all bins (with optional shelf filter)
  app.get("/api/warehouse/bins", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const shelfId = req.query.shelfId ? parseInt(req.query.shelfId as string) : null;
      
      const binsWithDetails = await db
        .select({
          id: whBins.id,
          name: whBins.name,
          shelfId: whBins.shelfId,
          shelfName: whShelves.name,
          aisleId: whAisles.id,
          aisleName: whAisles.name,
          position: whBins.position,
          description: whBins.description,
          createdAt: whBins.createdAt,
          updatedAt: whBins.updatedAt,
          itemCount: sql<number>`(SELECT COUNT(*) FROM ${inventoryLocations} WHERE ${inventoryLocations.binId} = ${whBins.id})`,
        })
        .from(whBins)
        .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
        .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
        .where(shelfId ? and(eq(whBins.orgId, orgId), eq(whBins.shelfId, shelfId)) : eq(whBins.orgId, orgId))
        .orderBy(whBins.shelfId, whBins.position);

      res.json(binsWithDetails);
    } catch (error) {
      console.error("Error fetching bins:", error);
      res.status(500).json({ error: "Failed to fetch bins" });
    }
  });

  // Create bin
  app.post("/api/warehouse/bins", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const data = insertWhBinSchema.parse(req.body);
      const [bin] = await db
        .insert(whBins)
        .values({ ...data, orgId })
        .returning();
      res.json(bin);
    } catch (error) {
      console.error("Error creating bin:", error);
      res.status(500).json({ error: "Failed to create bin" });
    }
  });

  // Update bin
  app.put("/api/warehouse/bins/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = insertWhBinSchema.parse(req.body);
      const [bin] = await db
        .update(whBins)
        .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(whBins.id, id))
        .returning();
      
      if (!bin) {
        return res.status(404).json({ error: "Bin not found" });
      }
      res.json(bin);
    } catch (error) {
      console.error("Error updating bin:", error);
      res.status(500).json({ error: "Failed to update bin" });
    }
  });

  // Delete bin
  app.delete("/api/warehouse/bins/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(whBins).where(eq(whBins.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting bin:", error);
      res.status(500).json({ error: "Failed to delete bin" });
    }
  });

  // Get unassigned inventory items (not in any bin)
  app.get("/api/warehouse/unassigned/inventory", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const unassignedItems = await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
          colorName: blColors.name,
          newOrUsed: blInventory.newOrUsed,
          quantity: blInventory.quantity,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .leftJoin(inventoryLocations, eq(blInventory.id, inventoryLocations.inventoryId))
        .where(and(eq(blInventory.orgId, orgId), sql`${inventoryLocations.id} IS NULL`))
        .orderBy(asc(blInventory.itemNo))
        .limit(2000);

      res.json(unassignedItems);
    } catch (error) {
      console.error("Error fetching unassigned inventory:", error);
      res.status(500).json({ error: "Failed to fetch unassigned inventory" });
    }
  });

  // Get unassigned bins (not on any shelf)
  app.get("/api/warehouse/unassigned/bins", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const unassignedBins = await db
        .select()
        .from(whBins)
        .where(and(eq(whBins.orgId, orgId), sql`${whBins.shelfId} IS NULL`));

      res.json(unassignedBins);
    } catch (error) {
      console.error("Error fetching unassigned bins:", error);
      res.status(500).json({ error: "Failed to fetch unassigned bins" });
    }
  });

  // Get unassigned shelves (not in any aisle)
  app.get("/api/warehouse/unassigned/shelves", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const unassignedShelves = await db
        .select()
        .from(whShelves)
        .where(and(eq(whShelves.orgId, orgId), sql`${whShelves.aisleId} IS NULL`));

      res.json(unassignedShelves);
    } catch (error) {
      console.error("Error fetching unassigned shelves:", error);
      res.status(500).json({ error: "Failed to fetch unassigned shelves" });
    }
  });

  // Assign inventory to bin
  app.post("/api/warehouse/assign/inventory", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const data = insertInventoryLocationSchema.parse(req.body);
      const [location] = await db
        .insert(inventoryLocations)
        .values({ ...data, orgId })
        .returning();
      res.json(location);
    } catch (error) {
      console.error("Error assigning inventory:", error);
      res.status(500).json({ error: "Failed to assign inventory" });
    }
  });

  // Assign bin to shelf
  app.put("/api/warehouse/assign/bin/:binId/shelf/:shelfId", isApproved, async (req, res) => {
    try {
      const binId = parseInt(req.params.binId);
      const shelfId = parseInt(req.params.shelfId);
      const [bin] = await db
        .update(whBins)
        .set({ shelfId, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(whBins.id, binId))
        .returning();
      
      if (!bin) {
        return res.status(404).json({ error: "Bin not found" });
      }
      res.json(bin);
    } catch (error) {
      console.error("Error assigning bin to shelf:", error);
      res.status(500).json({ error: "Failed to assign bin to shelf" });
    }
  });

  // Assign shelf to aisle
  app.put("/api/warehouse/assign/shelf/:shelfId/aisle/:aisleId", isApproved, async (req, res) => {
    try {
      const shelfId = parseInt(req.params.shelfId);
      const aisleId = parseInt(req.params.aisleId);
      const [shelf] = await db
        .update(whShelves)
        .set({ aisleId, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(whShelves.id, shelfId))
        .returning();
      
      if (!shelf) {
        return res.status(404).json({ error: "Shelf not found" });
      }
      res.json(shelf);
    } catch (error) {
      console.error("Error assigning shelf to aisle:", error);
      res.status(500).json({ error: "Failed to assign shelf to aisle" });
    }
  });

  // Get inventory locations with full details
  app.get("/api/warehouse/locations", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const locations = await db
        .select({
          id: inventoryLocations.id,
          inventoryId: inventoryLocations.inventoryId,
          itemNo: blInventory.itemNo,
          itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
          colorName: blColors.name,
          newOrUsed: blInventory.newOrUsed,
          binId: inventoryLocations.binId,
          binName: whBins.name,
          bagLabel: inventoryLocations.bagLabel,
          quantity: inventoryLocations.quantity,
          shelfId: whShelves.id,
          shelfName: whShelves.name,
          aisleId: whAisles.id,
          aisleName: whAisles.name,
          notes: inventoryLocations.notes,
        })
        .from(inventoryLocations)
        .leftJoin(blInventory, eq(inventoryLocations.inventoryId, blInventory.id))
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
        .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
        .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
        .where(eq(inventoryLocations.orgId, orgId))
        .limit(1000);

      res.json(locations);
    } catch (error) {
      console.error("Error fetching locations:", error);
      res.status(500).json({ error: "Failed to fetch locations" });
    }
  });

  // Get all locations for a single inventory item
  app.get("/api/warehouse/locations/inventory/:inventoryId", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const inventoryId = parseInt(req.params.inventoryId);
      const locs = await db
        .select({
          id: inventoryLocations.id,
          inventoryId: inventoryLocations.inventoryId,
          binId: inventoryLocations.binId,
          binName: whBins.name,
          shelfId: whShelves.id,
          shelfName: whShelves.name,
          aisleId: whAisles.id,
          aisleName: whAisles.name,
          quantity: inventoryLocations.quantity,
          bagLabel: inventoryLocations.bagLabel,
          notes: inventoryLocations.notes,
        })
        .from(inventoryLocations)
        .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
        .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
        .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
        .where(and(eq(inventoryLocations.orgId, orgId), eq(inventoryLocations.inventoryId, inventoryId)));
      res.json(locs);
    } catch (error) {
      console.error("Error fetching item locations:", error);
      res.status(500).json({ error: "Failed to fetch item locations" });
    }
  });

  // Update inventory location
  app.put("/api/warehouse/locations/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const data = insertInventoryLocationSchema.parse(req.body);
      const [location] = await db
        .update(inventoryLocations)
        .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(eq(inventoryLocations.id, id))
        .returning();
      
      if (!location) {
        return res.status(404).json({ error: "Location not found" });
      }
      res.json(location);
    } catch (error) {
      console.error("Error updating location:", error);
      res.status(500).json({ error: "Failed to update location" });
    }
  });

  // Delete inventory location (unassign item from bin)
  app.delete("/api/warehouse/locations/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(inventoryLocations).where(eq(inventoryLocations.id, id));
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting location:", error);
      res.status(500).json({ error: "Failed to delete location" });
    }
  });

  // QR code SVG generator for warehouse labels
  app.get("/api/warehouse/labels/qr", async (req, res) => {
    try {
      const data = String(req.query.data || '');
      const size = Math.min(300, Math.max(50, parseInt(String(req.query.size || '120'))));
      if (!data) return res.status(400).json({ error: 'data required' });
      const QRCode = await import('qrcode');
      const svg = await QRCode.toString(data, { type: 'svg', width: size, margin: 1, color: { dark: '#000000', light: '#ffffff' } });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(svg);
    } catch (err) {
      res.status(500).json({ error: 'QR generation failed' });
    }
  });

  // GET warehouse settings (depth preference)
  app.get("/api/warehouse/settings", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const [org] = await db.select({ warehouseDepth: organizations.warehouseDepth })
        .from(organizations)
        .where(eq(organizations.id, orgId));
      res.json({ depth: org?.warehouseDepth ?? 3 });
    } catch (error) {
      console.error("Error fetching warehouse settings:", error);
      res.status(500).json({ error: "Failed to fetch warehouse settings" });
    }
  });

  // PATCH warehouse settings (depth preference)
  app.patch("/api/warehouse/settings", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const depth = parseInt(req.body.depth);
      if (![1, 2, 3].includes(depth)) return res.status(400).json({ error: "depth must be 1, 2, or 3" });
      const [updated] = await db.update(organizations)
        .set({ warehouseDepth: depth, updatedAt: new Date() })
        .where(eq(organizations.id, orgId))
        .returning({ warehouseDepth: organizations.warehouseDepth });
      res.json({ depth: updated.warehouseDepth });
    } catch (error) {
      console.error("Error updating warehouse settings:", error);
      res.status(500).json({ error: "Failed to update warehouse settings" });
    }
  });

  // POST bulk create bins
  app.post("/api/warehouse/bins/bulk", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { prefix, start, end, padLength, shelfId } = req.body;
      if (!prefix || start == null || end == null) return res.status(400).json({ error: "prefix, start, and end are required" });
      const from = parseInt(start);
      const to = parseInt(end);
      if (isNaN(from) || isNaN(to) || from > to || to - from > 499) {
        return res.status(400).json({ error: "Invalid range (max 500 bins at once)" });
      }
      const pad = parseInt(padLength) || 0;
      const resolvedShelfId = shelfId ? parseInt(shelfId) : null;

      // Build the full list of names we want to create
      const candidates: string[] = [];
      for (let i = from; i <= to; i++) {
        const num = pad > 0 ? String(i).padStart(pad, '0') : String(i);
        candidates.push(`${prefix}${num}`);
      }

      // Fetch existing bins for this org (and shelf if provided) that match any candidate name
      const existingQuery = db
        .select({ name: whBins.name })
        .from(whBins)
        .where(
          resolvedShelfId != null
            ? and(eq(whBins.orgId, orgId), eq(whBins.shelfId, resolvedShelfId), inArray(whBins.name, candidates))
            : and(eq(whBins.orgId, orgId), isNull(whBins.shelfId), inArray(whBins.name, candidates))
        );
      const existing = await existingQuery;
      const existingNames = new Set(existing.map((b: { name: string }) => b.name.toLowerCase()));

      const rows = candidates
        .filter(name => !existingNames.has(name.toLowerCase()))
        .map(name => ({ name, shelfId: resolvedShelfId, orgId }));

      if (rows.length === 0) {
        return res.json({ created: 0, skipped: candidates.length, bins: [] });
      }

      const created = await db.insert(whBins).values(rows).returning();
      res.json({ created: created.length, skipped: candidates.length - created.length, bins: created });
    } catch (error) {
      console.error("Error bulk creating bins:", error);
      res.status(500).json({ error: "Failed to bulk create bins" });
    }
  });

  // ── Warehouse CSV Import ──
  // Accepts JSON { csvText: string }, creates aisles/shelves/bins from a CSV.
  // Supported column headers (case-insensitive): aisle, shelf, bin
  // Rows with blank values in a column mean "no parent at that level".
  app.post("/api/warehouse/import/csv", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { csvText } = req.body;
      if (!csvText || typeof csvText !== 'string') {
        return res.status(400).json({ error: "csvText is required" });
      }

      const lines = csvText.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
      if (lines.length < 2) return res.status(400).json({ error: "CSV must have a header row and at least one data row" });

      const headers = lines[0].split(',').map((h: string) => h.trim().toLowerCase());
      const aisleIdx = headers.indexOf('aisle');
      const shelfIdx = headers.indexOf('shelf');
      const binIdx = headers.indexOf('bin');

      if (binIdx === -1) return res.status(400).json({ error: "CSV must have at least a 'bin' column" });

      // Cache names → ids to avoid duplicate inserts
      const aisleCache = new Map<string, number>();
      const shelfCache = new Map<string, number>();
      const binCache = new Map<string, number>();

      // Pre-load existing records
      const existingAisles = await db.select().from(whAisles).where(eq(whAisles.orgId, orgId));
      const existingShelves = await db.select().from(whShelves).where(eq(whShelves.orgId, orgId));
      const existingBins = await db.select().from(whBins).where(eq(whBins.orgId, orgId));
      existingAisles.forEach((a: any) => aisleCache.set(a.name.toLowerCase(), a.id));
      existingShelves.forEach((s: any) => shelfCache.set(s.name.toLowerCase(), s.id));
      existingBins.forEach((b: any) => binCache.set(b.name.toLowerCase(), b.id));

      const stats = { aisles: 0, shelves: 0, bins: 0, skipped: 0 };
      const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c: string) => c.trim());
        const aisleName = aisleIdx >= 0 ? (cols[aisleIdx] || '') : '';
        const shelfName = shelfIdx >= 0 ? (cols[shelfIdx] || '') : '';
        const binName = binIdx >= 0 ? (cols[binIdx] || '') : '';

        if (!binName) { stats.skipped++; continue; }

        try {
          // Ensure aisle exists
          let aisleId: number | null = null;
          if (aisleName) {
            const key = aisleName.toLowerCase();
            if (aisleCache.has(key)) {
              aisleId = aisleCache.get(key)!;
            } else {
              const [a] = await db.insert(whAisles).values({ name: aisleName, orgId }).returning();
              aisleId = a.id;
              aisleCache.set(key, aisleId);
              stats.aisles++;
            }
          }

          // Ensure shelf exists
          let shelfId: number | null = null;
          if (shelfName) {
            const key = shelfName.toLowerCase();
            if (shelfCache.has(key)) {
              shelfId = shelfCache.get(key)!;
            } else {
              const [s] = await db.insert(whShelves).values({ name: shelfName, aisleId, orgId }).returning();
              shelfId = s.id;
              shelfCache.set(key, shelfId);
              stats.shelves++;
            }
          }

          // Ensure bin exists
          const binKey = binName.toLowerCase();
          if (binCache.has(binKey)) {
            stats.skipped++;
          } else {
            const [b] = await db.insert(whBins).values({ name: binName, shelfId, orgId }).returning();
            binCache.set(binKey, b.id);
            stats.bins++;
          }
        } catch (rowErr) {
          errors.push(`Row ${i + 1} (${binName}): ${rowErr instanceof Error ? rowErr.message : 'unknown error'}`);
        }
      }

      res.json({ ok: true, created: stats, errors });
    } catch (error) {
      console.error("Error importing warehouse CSV:", error);
      res.status(500).json({ error: "Failed to import CSV" });
    }
  });

  // ── Warehouse Lot-Assignment CSV Import ──
  // Maps existing inventory lots to bins via CSV.
  // Required columns: part_number (itemNo), bin (bin name)
  // Optional columns: color_id (int), condition ("N"/"U"), qty (int)
  // If multiple inventory rows match, all are assigned to the bin.
  app.post("/api/warehouse/import/lot-assignments", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { csvText } = req.body;
      if (!csvText || typeof csvText !== 'string') {
        return res.status(400).json({ error: "csvText is required" });
      }

      const lines = csvText.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
      if (lines.length < 2) return res.status(400).json({ error: "CSV must have a header row and at least one data row" });

      const headers = lines[0].split(',').map((h: string) => h.trim().toLowerCase().replace(/[\s_-]/g, '_'));
      const partIdx = ['part_number', 'part', 'item_no', 'itemno', 'sku'].map(k => headers.indexOf(k)).find(i => i >= 0) ?? -1;
      const binIdx = headers.indexOf('bin');
      const colorIdx = ['color_id', 'colorid', 'color'].map(k => headers.indexOf(k)).find(i => i >= 0) ?? -1;
      const condIdx = ['condition', 'new_or_used', 'newused', 'cond'].map(k => headers.indexOf(k)).find(i => i >= 0) ?? -1;
      const qtyIdx = ['qty', 'quantity'].map(k => headers.indexOf(k)).find(i => i >= 0) ?? -1;

      if (partIdx === -1) return res.status(400).json({ error: "CSV must have a 'part_number' column (also accepted: part, item_no, sku)" });
      if (binIdx === -1) return res.status(400).json({ error: "CSV must have a 'bin' column" });

      // Pre-load all org bins (name → id cache)
      const orgBins = await db.select({ id: whBins.id, name: whBins.name }).from(whBins).where(eq(whBins.orgId, orgId));
      const binCache = new Map(orgBins.map(b => [b.name.toLowerCase(), b.id]));

      // Pre-load all existing assignments to avoid duplicates
      const existingAssignments = await db
        .select({ inventoryId: inventoryLocations.inventoryId, binId: inventoryLocations.binId })
        .from(inventoryLocations)
        .where(eq(inventoryLocations.orgId, orgId));
      const assignedSet = new Set(existingAssignments.map(a => `${a.inventoryId}:${a.binId}`));

      const stats = { assigned: 0, skipped: 0, notFound: 0 };
      const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',').map((c: string) => c.trim());
        const partNumber = cols[partIdx] || '';
        const binName = cols[binIdx] || '';
        if (!partNumber || !binName) { stats.skipped++; continue; }

        const binId = binCache.get(binName.toLowerCase());
        if (!binId) {
          errors.push(`Row ${i + 1}: bin "${binName}" not found`);
          stats.notFound++;
          continue;
        }

        const rawCondition = condIdx >= 0 ? (cols[condIdx] || '').toUpperCase() : '';
        const condition = rawCondition === 'N' || rawCondition === 'U' ? rawCondition : null;

        // Execute and then filter in-memory for optional color/condition
        const inventoryRows = await db
          .select({ id: blInventory.id, colorId: blInventory.colorId, newOrUsed: blInventory.newOrUsed })
          .from(blInventory)
          .where(and(eq(blInventory.orgId, orgId), eq(blInventory.itemNo, partNumber)));

        if (inventoryRows.length === 0) {
          errors.push(`Row ${i + 1}: part "${partNumber}" not found in inventory`);
          stats.notFound++;
          continue;
        }

        // Apply optional filters
        let filtered = inventoryRows;
        if (colorIdx >= 0 && cols[colorIdx]) {
          const colorId = parseInt(cols[colorIdx]);
          if (!isNaN(colorId)) filtered = filtered.filter(r => r.colorId === colorId);
        }
        if (condition) {
          filtered = filtered.filter(r => r.newOrUsed === condition);
        }
        if (filtered.length === 0) filtered = inventoryRows; // Fallback: assign all without filter

        const qty = qtyIdx >= 0 ? parseInt(cols[qtyIdx]) || null : null;

        // Create assignments for all matched rows
        for (const inv of filtered) {
          const key = `${inv.id}:${binId}`;
          if (assignedSet.has(key)) { stats.skipped++; continue; }
          try {
            await db.insert(inventoryLocations).values({ inventoryId: inv.id, binId, orgId, quantity: qty });
            assignedSet.add(key);
            stats.assigned++;
          } catch (rowErr) {
            errors.push(`Row ${i + 1} (${partNumber} → ${binName}): ${rowErr instanceof Error ? rowErr.message : 'error'}`);
          }
        }
      }

      res.json({ ok: true, stats, errors });
    } catch (error) {
      console.error("Error importing lot assignments:", error);
      res.status(500).json({ error: "Failed to import lot assignments" });
    }
  });

  // Picklist Routes
  
  // Get picklist stats (unique bins still to pull)
  app.get("/api/picklist/stats", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const activeOrders = await db.select().from(orders).where(and(eq(orders.orgId, orgId), activeOrderStatusWhere()));

      if (activeOrders.length === 0) {
        return res.json({ toPull: 0 });
      }

      const orderIds = activeOrders.map(o => o.id);

      const picklistItemsData = await db
        .select()
        .from(picklistItems)
        .where(inArray(picklistItems.orderId, orderIds));

      // Count unique bins that still need to be pulled
      const binsToPull = new Set(
        picklistItemsData
          .filter(item => item.binId && !item.pulled)
          .map(item => item.binId)
      ).size;

      res.json({ toPull: binsToPull });
    } catch (error) {
      console.error("Error fetching picklist stats:", error);
      res.status(500).json({ error: "Failed to fetch picklist stats" });
    }
  });
  
  // Per-order picklist completion — returns { [orderId]: allPulled }
  app.get("/api/picklist/order-status", isApproved, async (req: any, res) => {
    try {
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
    } catch (error) {
      console.error("Error fetching picklist order status:", error);
      res.status(500).json({ error: "Failed to fetch picklist order status" });
    }
  });

  // Get picklist items for active orders (awaiting payment, awaiting shipment, awaiting fulfillment)
  app.get("/api/picklist", isApproved, async (req: any, res) => {
    try {
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

      // ── Batch-create missing picklist items (was N+1) ─────────────────────
      const existingDetailIds = new Set(existingPicklistItems.map(p => p.orderDetailId));
      const missingDetails = activeOrderDetails.filter(d => !existingDetailIds.has(d.id));

      if (missingDetails.length > 0) {
        // One query for all SKUs, one for all locations — instead of 2 queries per item
        const skus = [...new Set(missingDetails.map(d => d.sku).filter(Boolean))] as string[];
        const invBySku = skus.length > 0
          ? new Map(
              (await db.select({ id: blInventory.id, itemNo: blInventory.itemNo })
                .from(blInventory)
                .where(and(eq(blInventory.orgId, orgId), inArray(blInventory.itemNo, skus)))
              ).map(i => [i.itemNo, i])
            )
          : new Map<string, { id: number; itemNo: string }>();

        const invIds = [...invBySku.values()].map(i => i.id);
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

        await db.insert(picklistItems).values(newRows);

        // Refresh picklist items after insert
        const refreshed = await db.select().from(picklistItems).where(inArray(picklistItems.orderId, orderIds));
        existingPicklistItems.length = 0;
        existingPicklistItems.push(...refreshed);
      }

      // ── Apply filters ───────────────────────────────────────────────────────
      let filteredItems = [...existingPicklistItems];
      if (filter === 'to_pull') {
        filteredItems = filteredItems.filter(item => !item.pulled);
      }

      // ── Batch all lookups for the build phase (was N+1 per bin/item) ───────
      const orderMap = new Map(activeOrders.map(o => [o.id, o]));
      const detailMap = new Map(activeOrderDetails.map(d => [d.id, d]));

      // Warehouse location: bin → shelf → aisle (3 queries total, was 3 per bin)
      const uniqueBinIds = [...new Set(filteredItems.map(i => i.binId).filter((id): id is number => id !== null))];
      const binsData = uniqueBinIds.length > 0
        ? await db.select().from(whBins).where(and(eq(whBins.orgId, orgId), inArray(whBins.id, uniqueBinIds)))
        : [];
      const uniqueShelfIds = [...new Set(binsData.map(b => b.shelfId).filter((id): id is number => id !== null))];
      const shelvesData = uniqueShelfIds.length > 0
        ? await db.select().from(whShelves).where(and(eq(whShelves.orgId, orgId), inArray(whShelves.id, uniqueShelfIds)))
        : [];
      const uniqueAisleIds = [...new Set(shelvesData.map(s => s.aisleId).filter((id): id is number => id !== null))];
      const aislesData = uniqueAisleIds.length > 0
        ? await db.select().from(whAisles).where(and(eq(whAisles.orgId, orgId), inArray(whAisles.id, uniqueAisleIds)))
        : [];
      const binMap = new Map(binsData.map(b => [b.id, b]));
      const shelfMap = new Map(shelvesData.map(s => [s.id, s]));
      const aisleMap = new Map(aislesData.map(a => [a.id, a]));

      // Inventory: collect all lookup IDs, one query (was 1 per item)
      const lookupIds = filteredItems
        .map(item => {
          const d = detailMap.get(item.orderDetailId);
          const skuInt = d?.sku ? parseInt(d.sku) : NaN;
          return (!isNaN(skuInt) ? skuInt : (d?.bricklinkInventoryId ?? item.inventoryId)) as number | null;
        })
        .filter((id): id is number => id !== null);

      const uniqueInvIds = [...new Set(lookupIds)];
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
        ? await db.select({ id: blColors.id, name: blColors.name }).from(blColors).where(inArray(blColors.id, [...colorIdSet]))
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
          const skuInt = detail?.sku ? parseInt(detail.sku) : NaN;
          const lookupId = !isNaN(skuInt) ? skuInt : (detail?.bricklinkInventoryId ?? item.inventoryId ?? null);
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

          return {
            picklistItemId: item.id,
            orderDetailId: item.orderDetailId,
            orderId: item.orderId,
            orderNumber: order?.orderNumber,
            marketplace: order?.marketplace ?? null,
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
    } catch (error) {
      console.error("Error fetching picklist:", error);
      res.status(500).json({ error: "Failed to fetch picklist" });
    }
  });

  // Update bin pulled status (all items in bin)
  app.put("/api/picklist/bin/:binId/pull", isApproved, async (req, res) => {
    try {
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
      
      res.json({ success: true, binId, pulled });
    } catch (error) {
      console.error("Error updating bin pulled status:", error);
      res.status(500).json({ error: "Failed to update bin pulled status" });
    }
  });

  // Clear picklist items for shipped orders
  app.delete("/api/picklist/shipped", isApproved, async (req: any, res) => {
    try {
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
    } catch (error) {
      console.error("Error clearing shipped picklist items:", error);
      res.status(500).json({ error: "Failed to clear picklist" });
    }
  });

  // Update individual picklist item pulled status
  app.put("/api/picklist/item/:itemId/pull", isApproved, async (req, res) => {
    try {
      const { itemId } = req.params;
      const { pulled } = req.body;
      const updateData: any = {
        pulled: pulled === true,
        updatedAt: sql`CURRENT_TIMESTAMP`,
        pulledAt: pulled === true ? sql`CURRENT_TIMESTAMP` : null,
      };
      await db.update(picklistItems).set(updateData).where(eq(picklistItems.id, itemId));
      res.json({ success: true, itemId, pulled });
    } catch (error) {
      console.error("Error updating item pulled status:", error);
      res.status(500).json({ error: "Failed to update item pulled status" });
    }
  });


  // End of Day SCAN Form — return all purchased EasyPost shipments not yet added to a SCAN form
  app.get("/api/shipments/end-of-day", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const eligibleShipments = await db.select().from(shipments)
        .where(
          and(
            eq(shipments.orgId, orgId),
            eq(shipments.vendorCode, 'easypost'),
            eq(shipments.status, 'purchased'),
            isNull(shipments.eodFormId)
          )
        );
      const vendorIds = eligibleShipments.map(s => s.vendorShipmentId).filter(Boolean);
      res.json({ count: vendorIds.length, shipments: eligibleShipments.map(s => ({ id: s.id, orderId: s.orderId, trackingNumber: s.trackingNumber, carrier: s.carrier, service: s.service, purchasedAt: s.purchasedAt })) });
    } catch (error) {
      console.error("Error fetching EOD-eligible shipments:", error);
      res.status(500).json({ error: "Failed to fetch EOD-eligible shipments" });
    }
  });

  app.post("/api/shipments/scan-form", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      // Eligible: purchased EasyPost shipments not yet assigned to any EOD form
      const eligibleShipments = await db.select().from(shipments)
        .where(
          and(
            eq(shipments.orgId, orgId),
            eq(shipments.vendorCode, 'easypost'),
            eq(shipments.status, 'purchased'),
            isNull(shipments.eodFormId)
          )
        );

      const vendorIds = eligibleShipments.map(s => s.vendorShipmentId).filter(Boolean);
      if (vendorIds.length === 0) {
        return res.status(400).json({ error: 'No eligible EasyPost shipments for an EOD form' });
      }

      const cfg = await getOrgSettings(orgId);
      const apiKey = cfg?.easypostKeyMode === 'production' ? cfg?.easypostApiKey : cfg?.easypostTestApiKey;
      if (!apiKey) {
        return res.status(400).json({ error: 'EasyPost API key not configured' });
      }

      const auth = Buffer.from(`${apiKey}:`).toString('base64');

      // Submit to EasyPost, with one automatic retry if any shipment IDs are reported
      // as not found (e.g. voided or already manifested on EasyPost's side).
      let activeVendorIds = [...vendorIds];
      let scanForm: any = null;
      let skippedIds: string[] = [];

      for (let attempt = 0; attempt < 2; attempt++) {
        const epRes = await fetch('https://api.easypost.com/v2/scan_forms', {
          method: 'POST',
          headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ shipments: activeVendorIds.map(id => ({ id })) }),
        });

        if (epRes.ok) {
          scanForm = await epRes.json();
          break;
        }

        const err = await epRes.json().catch(() => ({}));
        const errMsg: string = err.error?.message || '';

        // EasyPost reports unusable IDs in the error message — extract and retry once without them.
        // Handles two known patterns:
        //   "N of the specified shipments were not found: shp_abc, shp_def"
        //   "N of the specified shipments have already been manifested: shp_abc, shp_def"
        const badIdsMatch = errMsg.match(/(?:not found|already been manifested):\s*(shp_[a-f0-9]+(?:[,\s]+shp_[a-f0-9]+)*)/i);
        const alreadyManifested = /already been manifested/i.test(errMsg);
        if (badIdsMatch && attempt === 0) {
          const badIds = badIdsMatch[1].split(/[,\s]+/).map((s: string) => s.trim()).filter(Boolean);
          console.warn(`[EOD] EasyPost rejected ${badIds.length} shipment ID(s) (${alreadyManifested ? 'already manifested' : 'not found'}), retrying without them`);
          skippedIds = [...skippedIds, ...badIds];
          activeVendorIds = activeVendorIds.filter(id => !badIds.includes(id));

          // Mark "already manifested" shipments in our DB so they stop appearing as eligible
          if (alreadyManifested && badIds.length > 0) {
            const alreadyManifShipments = eligibleShipments.filter(s => s.vendorShipmentId && badIds.includes(s.vendorShipmentId));
            if (alreadyManifShipments.length > 0) {
              await db.update(shipments)
                .set({ status: 'manifested' })
                .where(inArray(shipments.id, alreadyManifShipments.map(s => s.id)));
              console.log(`[EOD] Marked ${alreadyManifShipments.length} shipment(s) as 'manifested' in DB`);
            }
          }

          if (activeVendorIds.length === 0) {
            return res.status(400).json({ error: alreadyManifested
              ? 'All shipments have already been manifested in EasyPost. Nothing new to add to an EOD form.'
              : 'All shipments were rejected by EasyPost as not found. They may have been voided.' });
          }
          continue;
        }

        return res.status(400).json({ error: errMsg || 'EasyPost SCAN form creation failed' });
      }

      if (!scanForm) {
        return res.status(400).json({ error: 'EasyPost SCAN form creation failed after retry' });
      }

      const formUrl: string = scanForm.form_url;
      const epScanFormId: string = scanForm.id;

      // Persist the EOD form record (count reflects only the IDs EasyPost accepted)
      const [eodFormRecord] = await db.insert(eodForms).values({
        formUrl,
        scanFormId: epScanFormId,
        shipmentCount: activeVendorIds.length,
        orgId,
      }).returning();

      // Tag only the shipments whose IDs were actually accepted
      const acceptedShipments = eligibleShipments.filter(s => s.vendorShipmentId && activeVendorIds.includes(s.vendorShipmentId));
      const shipmentIds = acceptedShipments.map(s => s.id);
      await db.update(shipments)
        .set({ eodFormId: eodFormRecord.id })
        .where(inArray(shipments.id, shipmentIds));

      const warning = skippedIds.length > 0
        ? ` (${skippedIds.length} shipment(s) skipped — not found in EasyPost)`
        : '';
      console.log(`[EOD] SCAN form created: ${activeVendorIds.length} shipments${warning}`);

      res.json({ formUrl, scanFormId: epScanFormId, eodFormId: eodFormRecord.id, shipmentCount: activeVendorIds.length, skippedCount: skippedIds.length });
    } catch (error: any) {
      console.error("Error creating SCAN form:", error);
      res.status(500).json({ error: error.message || "Failed to create SCAN form" });
    }
  });

  // Mark all purchased EasyPost shipments as 'manifested' — clears the EOD backlog
  app.post("/api/shipments/clear-eod-backlog", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const result = await db.update(shipments)
        .set({ status: 'manifested' })
        .where(
          and(
            eq(shipments.orgId, orgId),
            eq(shipments.vendorCode, 'easypost'),
            eq(shipments.status, 'purchased'),
            isNull(shipments.eodFormId)
          )
        )
        .returning({ id: shipments.id });
      console.log(`[EOD] Cleared backlog: ${result.length} shipment(s) marked as manifested`);
      res.json({ cleared: result.length });
    } catch (error: any) {
      console.error("Error clearing EOD backlog:", error);
      res.status(500).json({ error: error.message || "Failed to clear EOD backlog" });
    }
  });

  // Get EOD form info for a specific order (for reprinting from ShippedOrders)
  app.get("/api/orders/:orderId/eod-form", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { orderId } = req.params;
      const shipmentRow = await db.select().from(shipments)
        .where(
          and(
            eq(shipments.orgId, orgId),
            eq(shipments.orderId, orderId),
            isNotNull(shipments.eodFormId),
          )
        )
        .limit(1);

      if (!shipmentRow.length || !shipmentRow[0].eodFormId) {
        return res.status(404).json({ error: 'No EOD form found for this order' });
      }

      const eodFormRow = await db.select().from(eodForms)
        .where(eq(eodForms.id, shipmentRow[0].eodFormId))
        .limit(1);

      if (!eodFormRow.length) {
        return res.status(404).json({ error: 'EOD form record not found' });
      }

      res.json({ formUrl: eodFormRow[0].formUrl, eodFormId: eodFormRow[0].id, shipmentCount: eodFormRow[0].shipmentCount, createdAt: eodFormRow[0].createdAt });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "Failed to fetch EOD form" });
    }
  });

  // Fulfillment Stats - Count unfulfilled orders
  app.get("/api/fulfillment/stats", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      // Count orders that are awaiting payment, awaiting fulfillment, or awaiting shipment
      const unfulfilled = await db
        .select({ count: sql<number>`count(DISTINCT ${orders.id})` })
        .from(orders)
        .where(
          and(
            eq(orders.orgId, orgId),
            or(
              eq(orders.orderStatus, 'awaiting_payment'),
              eq(orders.orderStatus, 'awaiting_fulfillment'),
              eq(orders.orderStatus, 'awaiting_shipment')
            )
          )
        );
      
      res.json({ 
        unfulfilled: Number(unfulfilled[0]?.count || 0)
      });
    } catch (error) {
      console.error("Error fetching fulfillment stats:", error);
      res.status(500).json({ error: "Failed to fetch fulfillment stats" });
    }
  });

  // Get fulfillment data - orders awaiting fulfillment with items grouped by bin
  app.get("/api/fulfillment", isApproved, async (req: any, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const orgId = reqOrgId(req);
      // Fetch orders that need fulfillment
      const fulfillmentOrders = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.orgId, orgId),
            or(
              eq(orders.orderStatus, 'awaiting_payment'),
              eq(orders.orderStatus, 'awaiting_fulfillment'),
              eq(orders.orderStatus, 'awaiting_shipment')
            )
          )
        )
        .orderBy(orders.orderNumber);
      
      if (fulfillmentOrders.length === 0) {
        res.json({ orders: [], items: [] });
        return;
      }
      
      const orderIds = fulfillmentOrders.map(o => o.id);
      
      // Get all potential items - use stored BrickLink data when available, fallback to parsing
      const allItems = await db
        .select({
          id: orderDetails.id,
          orderId: orderDetails.orderId,
          orderNumber: orders.orderNumber,
          sku: orderDetails.sku,
          bricklinkPartNumber: sql<string>`COALESCE(
            ${blInventory.itemNo},
            TRIM(SUBSTRING(${orderDetails.sku} FROM '.LGO-(.+)$')),
            TRIM(SUBSTRING(${orderDetails.name} FROM 'LEGO-([^ ]+)')),
            TRIM(SUBSTRING(${orderDetails.name} FROM 'Part ([^ ]+)'))
          )`,
          name: orderDetails.name,
          quantity: orderDetails.quantity,
          fulfilled: orderDetails.fulfilled,
          colorName: sql<string>`COALESCE(
            (SELECT bc.name FROM bl_colors bc WHERE bc.id = ${orderDetails.colorId} LIMIT 1),
            ${blColors.name},
            (SELECT bc.name FROM bl_colors bc WHERE order_details.name ILIKE '%' || bc.name || '%' ORDER BY LENGTH(bc.name) DESC LIMIT 1)
          )`,
          condition: sql<string>`COALESCE(
            ${orderDetails.condition},
            CASE 
              WHEN ${orderDetails.name} LIKE '%(Used)%' THEN 'Used'
              WHEN ${orderDetails.name} LIKE '%(New)%' THEN 'New'
              WHEN ${blInventory.newOrUsed} = 'N' THEN 'New'
              WHEN ${blInventory.newOrUsed} = 'U' THEN 'Used'
              ELSE NULL
            END
          )`,
          binId: inventoryLocations.binId,
          binName: whBins.name,
          shelfId: whShelves.id,
          shelfName: whShelves.name,
          aisleId: whAisles.id,
          aisleName: whAisles.name,
        })
        .from(orderDetails)
        .innerJoin(orders, eq(orderDetails.orderId, orders.id))
        .leftJoin(blInventory, eq(sql`CAST(${blInventory.id} AS TEXT)`, orderDetails.sku))
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(inventoryLocations, eq(blInventory.id, inventoryLocations.inventoryId))
        .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
        .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
        .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
        .where(sql`${orderDetails.orderId} IN (${sql.raw(orderIds.map(id => `'${id}'`).join(', '))})`);
      
      // Manually deduplicate: keep first occurrence of each order_detail id
      const seenIds = new Set<string>();
      const items = allItems.filter(item => {
        if (seenIds.has(item.id)) {
          return false;
        }
        seenIds.add(item.id);
        return true;
      });
      
      res.json({ 
        orders: fulfillmentOrders,
        items 
      });
    } catch (error) {
      console.error("Error fetching fulfillment data:", error);
      res.status(500).json({ error: "Failed to fetch fulfillment data" });
    }
  });

  // Update internal workflow status for an order
  app.put("/api/fulfillment/order/:orderId/workflow-status", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { orderId } = req.params;
      const { status } = req.body;
      const valid = ['new', 'processing', 'bump', 'issue', 'on_hold', 'done'];
      if (!status || !valid.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}` });
      }
      await db
        .update(orders)
        .set({ workflowStatus: status, updatedAt: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(orders.id, orderId), eq(orders.orgId, orgId)));
      res.json({ success: true });
    } catch (error) {
      console.error("Error updating workflow status:", error);
      res.status(500).json({ error: "Failed to update workflow status" });
    }
  });

  // Update fulfilled status for an order detail item
  app.put("/api/fulfillment/item/:itemId/fulfill", isApproved, async (req, res) => {
    try {
      const itemId = req.params.itemId;
      
      // Validate request body
      const validatedData = updateFulfillmentSchema.parse(req.body);
      const { fulfilled } = validatedData;
      
      const updateData: any = {
        fulfilled: fulfilled === true,
        updatedAt: sql`CURRENT_TIMESTAMP`
      };
      
      // Set fulfilledAt timestamp when marking as fulfilled, clear when unmarking
      if (fulfilled === true) {
        updateData.fulfilledAt = sql`CURRENT_TIMESTAMP`;
      } else {
        updateData.fulfilledAt = null;
      }
      
      await db
        .update(orderDetails)
        .set(updateData)
        .where(eq(orderDetails.id, itemId));
      
      res.json({ success: true, itemId, fulfilled });
    } catch (error) {
      console.error("Error updating item fulfilled status:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request body", details: error.errors });
      }
      res.status(500).json({ error: "Failed to update item fulfilled status" });
    }
  });

  // Get shipping summary for inline shipping card (weight estimate, address, requested service)
  app.get("/api/fulfillment/order-shipping/:orderId", isApproved, async (req, res) => {
    try {
      const { orderId } = req.params;

      const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
      if (!order) return res.status(404).json({ error: "Order not found" });

      // Calculate weight estimate from line items (grams × quantity, then converted to oz):
      // 1st preference: order_details.weight (per-piece weight from BrickLink order items API)
      // 2nd preference: bl_inventory.bl_catalog_weight (official BrickLink catalog weight per piece)
      // my_weight is the user's own field — not used for shipping estimates
      const weightRows = await db
        .select({
          totalWeightGrams: sql<string>`
            COALESCE(
              SUM(
                CASE
                  WHEN ${orderDetails.weight} IS NOT NULL AND CAST(${orderDetails.weight} AS DECIMAL) > 0
                    THEN CAST(${orderDetails.weight} AS DECIMAL) * ${orderDetails.quantity}
                  WHEN ${blCatalog.blCatalogWeight} IS NOT NULL AND ${blCatalog.blCatalogWeight} > 0
                    THEN ${blCatalog.blCatalogWeight} * ${orderDetails.quantity}
                  ELSE 0
                END
              ), 0
            )
          `,
        })
        .from(orderDetails)
        .leftJoin(blInventory, eq(orderDetails.bricklinkInventoryId, blInventory.id))
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .where(eq(orderDetails.orderId, orderId));

      const totalWeightGrams = parseFloat(weightRows[0]?.totalWeightGrams || "0");
      const totalWeightOz = Math.round(totalWeightGrams * 0.035274 * 10) / 10;

      // Parse ship-to address
      let shipToData: any = {};
      try {
        shipToData = typeof order.shipTo === "string" ? JSON.parse(order.shipTo) : (order.shipTo || {});
      } catch {}

      res.json({
        orderId,
        orderNumber: order.orderNumber,
        marketplace: order.marketplace,
        requestedService: order.requestedShippingService,
        savedWeight: order.weight ? Number(order.weight) : null,
        savedWeightUnits: order.weightUnits || "oz",
        savedPackageType: order.packageType || null,
        savedPackageLength: order.packageLength ? Number(order.packageLength) : null,
        savedPackageWidth: order.packageWidth ? Number(order.packageWidth) : null,
        savedPackageHeight: order.packageHeight ? Number(order.packageHeight) : null,
        weightEstimateGrams: Math.round(totalWeightGrams * 10) / 10,
        weightEstimateOz: totalWeightOz,
        address: {
          name: shipToData.name || order.customerUsername || "",
          street1: shipToData.street1 || shipToData.address1 || "",
          street2: shipToData.street2 || shipToData.address2 || "",
          city: shipToData.city || "",
          state: shipToData.state || "",
          zip: shipToData.postalCode || "",
          country: shipToData.country || "US",
        },
      });
    } catch (error: any) {
      console.error("Error fetching order shipping summary:", error);
      res.status(500).json({ error: error.message || "Failed to get shipping summary" });
    }
  });

  // Validate a shipping address via EasyPost
  app.post("/api/fulfillment/validate-address", isApproved, async (req, res) => {
    try {
      const { address } = req.body;
      if (!address) return res.status(400).json({ error: "address is required" });

      const { getShippingVendor } = await import("./services/easypost");
      const vendor = await getShippingVendor();
      const result = await vendor.validateAddress(address);
      res.json(result);
    } catch (error: any) {
      console.error("Error validating address:", error);
      res.status(500).json({ error: error.message || "Failed to validate address" });
    }
  });

  // Get packing slip data for one or more orders
  app.post("/api/fulfillment/packing-slip", isApproved, async (req, res) => {
    try {
      const { orderIds } = req.body;
      
      if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: "orderIds array is required" });
      }
      
      // Fetch orders
      const orderData = await db.select()
        .from(orders)
        .where(inArray(orders.id, orderIds));
      
      if (orderData.length === 0) {
        return res.status(404).json({ error: "No orders found" });
      }
      
      // Fetch order items with inventory data (part number, color, condition)
      const items = await db.select({
        orderId: orderDetails.orderId,
        inventoryId: sql<string>`COALESCE(
          CAST(${orderDetails.bricklinkInventoryId} AS TEXT),
          ${orderDetails.sku}
        )`,
        bricklinkPartNumber: sql<string>`COALESCE(
          ${blInventory.itemNo},
          TRIM(SUBSTRING(${orderDetails.sku} FROM '.LGO-(.+)$')),
          TRIM(SUBSTRING(${orderDetails.name} FROM 'LEGO-([^ ]+)')),
          ${orderDetails.sku}
        )`,
        name: orderDetails.name,
        quantity: orderDetails.quantity,
        colorName: sql<string>`COALESCE(
          (SELECT bc.name FROM bl_colors bc WHERE bc.id = ${orderDetails.colorId} LIMIT 1),
          ${blColors.name}
        )`,
        condition: sql<string>`COALESCE(
          ${orderDetails.condition},
          CASE 
            WHEN ${blInventory.newOrUsed} = 'N' THEN 'New'
            WHEN ${blInventory.newOrUsed} = 'U' THEN 'Used'
            WHEN ${orderDetails.name} LIKE '%(Used)%' THEN 'Used'
            WHEN ${orderDetails.name} LIKE '%(New)%' THEN 'New'
            ELSE NULL
          END
        )`,
        comment: blInventory.description,
        colorId: orderDetails.colorId,
      })
        .from(orderDetails)
        .leftJoin(blInventory, eq(sql`CAST(${blInventory.id} AS TEXT)`, orderDetails.sku))
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .where(inArray(orderDetails.orderId, orderIds));
      
      // Group items by order
      const itemsByOrder = items.reduce((acc, item) => {
        if (!acc[item.orderId]) {
          acc[item.orderId] = [];
        }
        acc[item.orderId].push(item);
        return acc;
      }, {} as Record<string, typeof items>);
      
      // Format response
      const packingSlips = orderData.map(order => {
        let shipTo: any = {};
        try {
          shipTo = typeof order.shipTo === 'string' ? JSON.parse(order.shipTo) : order.shipTo;
        } catch (e) {
          console.error('Error parsing shipTo:', e);
        }
        
        const orderItems = (itemsByOrder[order.id] || []).sort((a: any, b: any) => {
          const pa = a.bricklinkPartNumber || '';
          const pb = b.bricklinkPartNumber || '';
          const pCmp = pa.localeCompare(pb, undefined, { numeric: true });
          if (pCmp !== 0) return pCmp;
          const cCmp = (a.condition || '').localeCompare(b.condition || '');
          if (cCmp !== 0) return cCmp;
          return (a.colorName || '').localeCompare(b.colorName || '');
        });
        
        return {
          orderNumber: order.orderNumber,
          orderDate: order.orderDate,
          shipDate: order.shipDate,
          customerUsername: order.customerUsername,
          marketplace: order.marketplace,
          requestedService: order.requestedShippingService || null,
          carrierCode: order.carrierCode || null,
          serviceCode: order.serviceCode || null,
          shipTo,
          items: orderItems,
        };
      });
      
      res.json(packingSlips);
    } catch (error) {
      console.error("Error fetching packing slip data:", error);
      res.status(500).json({ error: "Failed to fetch packing slip data" });
    }
  });

  // Shipping Routes
  
  // Preview shipment - check if order will need to be split
  app.post("/api/shipments/preview", isApproved, async (req, res) => {
    try {
      const { orderId, itemIdsToShip } = req.body;
      
      if (!orderId || !itemIdsToShip || !Array.isArray(itemIdsToShip)) {
        return res.status(400).json({ error: "orderId and itemIdsToShip array are required" });
      }
      
      const { previewShipment } = await import('./services/order-shipping');
      const preview = await previewShipment(orderId, itemIdsToShip);
      
      res.json(preview);
    } catch (error: any) {
      console.error("Error previewing shipment:", error);
      res.status(500).json({ error: error.message || "Failed to preview shipment" });
    }
  });
  
  // Split an order
  app.post("/api/orders/:orderId/split", isApproved, async (req, res) => {
    try {
      const { orderId } = req.params;
      const { itemIdsToKeep } = req.body;
      
      if (!itemIdsToKeep || !Array.isArray(itemIdsToKeep)) {
        return res.status(400).json({ error: "itemIdsToKeep array is required" });
      }
      
      const { splitOrder } = await import('./services/order-shipping');
      const result = await splitOrder(orderId, itemIdsToKeep);
      
      res.json(result);
    } catch (error: any) {
      console.error("Error splitting order:", error);
      res.status(500).json({ error: error.message || "Failed to split order" });
    }
  });
  
  // Create shipment and get rates
  app.post("/api/shipments/create", isApproved, async (req, res) => {
    try {
      const { orderId, fromAddress, parcel, itemIdsToShip, overrideToAddress } = req.body;
      
      if (!orderId || !fromAddress || !parcel) {
        return res.status(400).json({ error: "orderId, fromAddress, and parcel are required" });
      }
      
      const { createShipment } = await import('./services/order-shipping');
      const result = await createShipment({
        orderId,
        itemIdsToShip: itemIdsToShip || [],
        fromAddress,
        parcel,
        overrideToAddress: overrideToAddress || undefined,
      });
      
      
      res.json(result);
    } catch (error: any) {
      console.error("Error creating shipment:", error);
      res.status(500).json({ error: error.message || "Failed to create shipment" });
    }
  });
  
  // Purchase shipping label
  app.post("/api/shipments/purchase", isApproved, async (req, res) => {
    try {
      const { orderId, shipmentId, rateId, insurance } = req.body;
      
      if (!orderId || !shipmentId || !rateId) {
        return res.status(400).json({ error: "orderId, shipmentId, and rateId are required" });
      }
      
      const { purchaseLabel } = await import('./services/order-shipping');
      const result = await purchaseLabel(orderId, shipmentId, rateId, insurance);
      
      res.json(result);
    } catch (error: any) {
      console.error("Error purchasing label:", error);
      res.status(500).json({ error: error.message || "Failed to purchase label" });
    }
  });
  
  // Get shipments for an order
  app.get("/api/shipments/:orderId", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { orderId } = req.params;
      
      const { shipments } = await import('@shared/schema');
      const orderShipments = await db.select()
        .from(shipments)
        .where(and(eq(shipments.orgId, orgId), eq(shipments.orderId, orderId)))
        .orderBy(desc(shipments.createdAt));
      
      res.json(orderShipments);
    } catch (error: any) {
      console.error("Error fetching shipments:", error);
      res.status(500).json({ error: "Failed to fetch shipments" });
    }
  });

  // Dry-Run Order Sync Tester - Test with historical orders
  app.post("/api/orders/dry-run-test", isApproved, async (req: any, res) => {
    try {
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
          if (!settings.bricklinkConsumerKey || !settings.bricklinkConsumerSecret || 
              !settings.bricklinkTokenValue || !settings.bricklinkTokenSecret) {
            console.log('BrickLink API credentials missing - skipping BrickLink');
            // Don't return error - just skip BrickLink if credentials missing
          } else {

          const { getBrickLinkOrders, getBrickLinkOrderItems, mapBrickLinkStatus, mapBrickLinkCondition } = 
            await import('./services/bricklink-orders');

          // Fetch recent PENDING BrickLink orders from ShipStation database
          // Note: BrickLink/BrickOwl APIs may not return items for shipped/completed orders
          console.log('Fetching recent PENDING BrickLink orders from ShipStation...');
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

          console.log(`Found ${recentBLOrders.length} recent BrickLink orders in ShipStation`);

        for (const ssOrder of recentBLOrders) {
          try {
            // Remove "BL." prefix to get BrickLink order ID
            const orderId = ssOrder.orderNumber.replace('BL.', '');
            console.log(`Processing BrickLink order ${orderId}...`);
            
            // Fetch ShipStation order items from database
            const ssItems = await db.select()
              .from(orderDetails)
              .where(eq(orderDetails.orderId, ssOrder.id));
            
            console.log(`ShipStation has ${ssItems.length} items for order ${orderId}`);

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
              const { getBrickLinkOrderItems } = await import('./services/bricklink-orders');
              const blItems = await getBrickLinkOrderItems(
                parseInt(orderId),
                settings.bricklinkConsumerKey!,
                settings.bricklinkConsumerSecret!,
                settings.bricklinkTokenValue!,
                settings.bricklinkTokenSecret!
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

            // Map ShipStation items with warehouse bins
            const itemsWithBins = await Promise.all(ssItems.map(async (item: any) => {
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
                .where(and(eq(inventoryLocations.orgId, orgId), eq(inventoryLocations.inventoryId, parseInt(item.sku || '0'))))
                .limit(1);

              return {
                sku: item.sku,
                name: item.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                warehouseBin: binInfo[0] || null,
              };
            }));

            results.push({
              platform: 'BrickLink',
              shipstationOrder: ssOrder, // ShipStation order with full details
              shipstationItems: itemsWithBins, // ShipStation items from database
              platformOrder: platformOrder, // Platform order header (if available)
              platformItems: platformItems, // Platform items from API (may be empty for shipped orders)
              issues: [],
            });
          } catch (orderError: any) {
            console.error(`Error processing BrickLink order:`, orderError.message || orderError);
          }
        }
          } // end else (credentials check)
        } catch (blError: any) {
          console.error('BrickLink API error:', blError.message || blError);
          // Continue with BrickOwl if "both" is selected
        }
      }

      // Test BrickOwl orders
      if (platform === 'brickowl' || platform === 'both') {
        const boApiKey = settings.brickowlApiKey || process.env.BRICKOWL_API_KEY;
        if (!boApiKey) {
          return res.status(400).json({ error: "BrickOwl API key not configured" });
        }

        const { getBrickOwlOrders, getBrickOwlOrderDetails, mapBrickOwlStatus, mapBrickOwlCondition } = 
          await import('./services/brickowl-orders');

        // Fetch recent PENDING BrickOwl orders from ShipStation database
        // Note: BrickLink/BrickOwl APIs may not return items for shipped/completed orders
        console.log('Fetching recent PENDING BrickOwl orders from ShipStation...');
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

        console.log(`Found ${recentBOOrders.length} recent BrickOwl orders in ShipStation`);

        for (const ssOrder of recentBOOrders) {
          try {
            // Remove "BO." prefix to get BrickOwl order ID
            const orderId = ssOrder.orderNumber.replace('BO.', '');
            console.log(`Processing BrickOwl order ${orderId}...`);
            
            // Fetch ShipStation order items from database
            const ssItems = await db.select()
              .from(orderDetails)
              .where(eq(orderDetails.orderId, ssOrder.id));
            
            console.log(`ShipStation has ${ssItems.length} items for order ${orderId}`);

            // Try to fetch platform order header and items
            let platformOrder = null;
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

              // Map BrickOwl items to common format with warehouse bins
              if (boOrder.items && Array.isArray(boOrder.items)) {
                console.log(`BrickOwl API returned ${boOrder.items.length} items for order ${orderId}`);
                
                platformItems = await Promise.all(boOrder.items.map(async (boItem: any) => {
                  const inventoryId = boItem.external_lot_ids?.other;
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

            // Map ShipStation items with warehouse bins
            const itemsWithBins = await Promise.all(ssItems.map(async (item: any) => {
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
                .where(and(eq(inventoryLocations.orgId, orgId), eq(inventoryLocations.inventoryId, parseInt(item.sku || '0'))))
                .limit(1);

              return {
                sku: item.sku,
                name: item.name,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                warehouseBin: binInfo[0] || null,
              };
            }));

            results.push({
              platform: 'BrickOwl',
              shipstationOrder: ssOrder, // ShipStation order with full details
              shipstationItems: itemsWithBins, // ShipStation items from database
              platformOrder: platformOrder, // Platform order header (if available)
              platformItems: platformItems, // Platform items from API (may be empty for shipped orders)
              issues: [],
            });
          } catch (err: any) {
            console.error(`Error processing BrickOwl order:`, err.message);
          }
        }
      }

      res.json({ success: true, results });
    } catch (error: any) {
      console.error("Error in dry-run test:", error);
      res.status(500).json({ error: error.message || "Failed to run order sync test" });
    }
  });

  // ============================================================================
  // ITEM DETAIL ROUTES
  // ============================================================================

  // GET /api/items/detail/:itemNo - Get detailed information about a specific item
  app.get("/api/items/detail/:itemNo", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { itemNo } = req.params;

      // Get all inventory lots for this item
      const inventoryLots = await db
        .select({
          id: blInventory.id,
          itemNo: blInventory.itemNo,
          itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
          colorId: blInventory.colorId,
          colorName: blColors.name,
          colorRgb: blColors.rgb,
          categoryId: blCatalog.categoryId,
          categoryName: blCategories.name,
          quantity: blInventory.quantity,
          newOrUsed: blInventory.newOrUsed,
          unitPrice: blInventory.unitPrice,
        })
        .from(blInventory)
        .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
        .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
        .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
        .where(and(eq(blInventory.orgId, orgId), eq(blInventory.itemNo, itemNo)));

      if (inventoryLots.length === 0) {
        return res.status(404).json({ error: "Item not found" });
      }

      // Get warehouse locations for each inventory lot
      const inventoryIds = inventoryLots.map(lot => lot.id);
      const warehouseLocations = inventoryIds.length > 0 
        ? await db
            .select({
              inventoryId: inventoryLocations.inventoryId,
              binId: inventoryLocations.binId,
              binName: whBins.name,
              shelfName: whShelves.name,
              aisleName: whAisles.name,
            })
            .from(inventoryLocations)
            .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
            .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
            .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
            .where(and(eq(inventoryLocations.orgId, orgId), inArray(inventoryLocations.inventoryId, inventoryIds)))
        : [];

      // Get sales data for this item
      // Note: sku contains the item number for most platforms
      const salesData = await db
        .select({
          quantitySold: sql<number>`COALESCE(SUM(${orderDetails.quantity}), 0)`,
          revenue: sql<number>`COALESCE(SUM(CAST(${orderDetails.unitPrice} AS DECIMAL) * ${orderDetails.quantity}), 0)`,
        })
        .from(orderDetails)
        .where(eq(orderDetails.sku, itemNo));

      // Build color variations array with warehouse locations
      const colors = inventoryLots.map(lot => {
        const location = warehouseLocations.find(loc => loc.inventoryId === lot.id);
        let warehouseLocation = null;
        if (location?.binName) {
          const parts = [];
          if (location.aisleName) parts.push(location.aisleName);
          if (location.shelfName) parts.push(location.shelfName);
          parts.push(location.binName);
          warehouseLocation = parts.join(' / ');
        }

        return {
          colorId: lot.colorId || 0,
          colorName: lot.colorName || 'Unknown',
          colorRgb: lot.colorRgb,
          quantity: lot.quantity || 0,
          condition: lot.newOrUsed || 'U',
          price: lot.unitPrice,
          warehouseLocation,
        };
      });

      // Calculate totals
      const totalQuantity = inventoryLots.reduce((sum, lot) => sum + (lot.quantity || 0), 0);
      const newQuantity = inventoryLots
        .filter(lot => lot.newOrUsed === 'N')
        .reduce((sum, lot) => sum + (lot.quantity || 0), 0);
      const usedQuantity = inventoryLots
        .filter(lot => lot.newOrUsed === 'U')
        .reduce((sum, lot) => sum + (lot.quantity || 0), 0);
      
      const colorCount = new Set(inventoryLots.map(lot => lot.colorId).filter(Boolean)).size;

      // Calculate price statistics
      const prices = inventoryLots
        .map(lot => parseFloat(lot.unitPrice || '0'))
        .filter(price => price > 0);
      
      const avgPrice = prices.length > 0 
        ? (prices.reduce((sum, price) => sum + price, 0) / prices.length).toFixed(3)
        : null;
      const minPrice = prices.length > 0 ? Math.min(...prices).toFixed(3) : null;
      const maxPrice = prices.length > 0 ? Math.max(...prices).toFixed(3) : null;

      // Calculate total value
      const totalValue = inventoryLots
        .reduce((sum, lot) => {
          const price = parseFloat(lot.unitPrice || '0');
          const qty = lot.quantity || 0;
          return sum + (price * qty);
        }, 0)
        .toFixed(2);

      const itemDetail = {
        itemNo,
        itemName: inventoryLots[0].itemName,
        categoryName: inventoryLots[0].categoryName,
        totalQuantity,
        newQuantity,
        usedQuantity,
        colorCount,
        avgPrice,
        minPrice,
        maxPrice,
        totalValue,
        quantitySold: Number(salesData[0]?.quantitySold || 0),
        revenue: Number(salesData[0]?.revenue || 0).toFixed(2),
        colors,
      };

      res.json(itemDetail);
    } catch (error) {
      console.error("Error fetching item details:", error);
      res.status(500).json({ error: "Failed to fetch item details" });
    }
  });

  // ============================================================================
  // FORUM NEWS ROUTES
  // ============================================================================

  // GET /api/forum/recent - Get recent forum posts for news notification
  app.get("/api/forum/recent", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const daysAgo = parseInt(req.query.days as string) || 7;
      const limit = parseInt(req.query.limit as string) || 10;
      
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
      
      const recentPosts = await db
        .select({
          id: blForumPosts.id,
          threadId: blForumPosts.threadId,
          title: blForumPosts.title,
          excerpt: blForumPosts.excerpt,
          username: blForumPosts.username,
          postedAt: blForumPosts.postedAt,
          postUrl: blForumPosts.postUrl,
          threadUrl: blForumPosts.threadUrl,
          hasReplies: blForumPosts.hasReplies,
        })
        .from(blForumPosts)
        .where(and(eq(blForumPosts.orgId, orgId), sql`${blForumPosts.postedAt} >= ${cutoffDate}`))
        .orderBy(sql`${blForumPosts.postedAt} DESC`)
        .limit(limit);
      
      res.json({
        success: true,
        count: recentPosts.length,
        posts: recentPosts,
        cutoffDate: cutoffDate.toISOString(),
      });
    } catch (error: any) {
      console.error("Error fetching recent forum posts:", error);
      res.status(500).json({ error: error.message || "Failed to fetch recent forum posts" });
    }
  });

  // GET /api/market-intel/recent - Combined forum posts + market news for Elfie greeting
  app.get("/api/market-intel/recent", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const daysAgo = parseInt(req.query.days as string) || 7;

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysAgo);

      const recentPosts = await db
        .select({
          title: blForumPosts.title,
          excerpt: blForumPosts.excerpt,
          username: blForumPosts.username,
          postedAt: blForumPosts.postedAt,
          threadUrl: blForumPosts.threadUrl,
        })
        .from(blForumPosts)
        .where(and(eq(blForumPosts.orgId, orgId), sql`${blForumPosts.postedAt} >= ${cutoffDate}`))
        .orderBy(sql`${blForumPosts.postedAt} DESC`)
        .limit(10);

      const recentArticles = await db
        .select({
          title: marketNews.title,
          snippet: marketNews.snippet,
          url: marketNews.url,
          source: marketNews.source,
          query: marketNews.query,
          fetchedAt: marketNews.fetchedAt,
        })
        .from(marketNews)
        .where(sql`${marketNews.fetchedAt} >= ${cutoffDate}`)
        .orderBy(sql`${marketNews.fetchedAt} DESC`)
        .limit(15);

      res.json({
        success: true,
        forum: { count: recentPosts.length, posts: recentPosts },
        news: { count: recentArticles.length, articles: recentArticles },
      });
    } catch (error: any) {
      console.error("Error fetching market intel:", error);
      res.status(500).json({ error: error.message || "Failed to fetch market intel" });
    }
  });

  // ============================================================================
  // BACKUP & RESTORE ROUTES
  // ============================================================================
  
  // Import backup-restore service
  const backupRestore = await import('./services/backup-restore');
  
  // POST /api/backup/restore - Initiate restore workflow
  app.post("/api/backup/restore", isApproved, async (req, res) => {
    try {
      const { targetTimestamp, skipPlatformSync } = req.body;
      
      if (!targetTimestamp) {
        return res.status(400).json({ error: "targetTimestamp is required" });
      }
      
      const jobId = await backupRestore.initiateRestoreWorkflow(
        targetTimestamp,
        skipPlatformSync || false
      );
      
      res.json({ success: true, jobId });
    } catch (error: any) {
      console.error("Error initiating restore:", error);
      res.status(500).json({ error: error.message || "Failed to initiate restore" });
    }
  });
  
  // GET /api/backup/restore/status/:jobId - Check restore progress
  app.get("/api/backup/restore/status/:jobId", isApproved, async (req, res) => {
    try {
      const { jobId } = req.params;
      const status = await backupRestore.getRestoreStatus(jobId);
      
      if (!status) {
        return res.status(404).json({ error: "Restore job not found" });
      }
      
      res.json(status);
    } catch (error: any) {
      console.error("Error fetching restore status:", error);
      res.status(500).json({ error: error.message || "Failed to fetch restore status" });
    }
  });
  
  // POST /api/backup/differential/analyze - Analyze BrickOwl vs BrickLink differences
  app.post("/api/backup/differential/analyze", isApproved, async (req, res) => {
    try {
      const { jobId } = req.body;
      
      if (!jobId) {
        return res.status(400).json({ error: "jobId is required" });
      }
      
      const analysis = await backupRestore.analyzeDifferential(jobId);
      res.json(analysis);
    } catch (error: any) {
      console.error("Error analyzing differential:", error);
      res.status(500).json({ error: error.message || "Failed to analyze differential" });
    }
  });
  
  // POST /api/backup/differential/apply - Apply differential sync to BrickLink
  app.post("/api/backup/differential/apply", isApproved, async (req, res) => {
    try {
      const { jobId, overrideAnomalies } = req.body;
      
      if (!jobId) {
        return res.status(400).json({ error: "jobId is required" });
      }
      
      const result = await backupRestore.applyDifferentialRecovery(
        jobId,
        overrideAnomalies || false
      );
      
      res.json(result);
    } catch (error: any) {
      console.error("Error applying differential:", error);
      res.status(500).json({ error: error.message || "Failed to apply differential" });
    }
  });
  
  // GET /api/backup/verify/:jobId - Run verification checks
  app.get("/api/backup/verify/:jobId", isApproved, async (req, res) => {
    try {
      const { jobId } = req.params;
      const verification = await backupRestore.verifyRestoration(jobId);
      
      res.json(verification);
    } catch (error: any) {
      console.error("Error verifying restore:", error);
      res.status(500).json({ error: error.message || "Failed to verify restore" });
    }
  });

  // ─── App Feedback ─────────────────────────────────────────────────────────
  // GET /api/feedback — list all, newest first
  app.get("/api/feedback", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const items = await db.select().from(appFeedback).where(eq(appFeedback.orgId, orgId)).orderBy(desc(appFeedback.createdAt));
      res.json(items);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/feedback — save a refined feedback item
  app.post("/api/feedback", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { type, title, rawDescription, refinedDescription, acceptanceCriteria, status, sourcePage } = req.body;
      if (!title || !rawDescription) return res.status(400).json({ error: "title and rawDescription are required" });
      const [item] = await db.insert(appFeedback).values({
        type: type ?? "enhancement",
        title,
        rawDescription,
        refinedDescription: refinedDescription ?? null,
        acceptanceCriteria: acceptanceCriteria ?? null,
        status: status ?? "new",
        sourcePage: sourcePage ?? null,
        orgId,
      }).returning();
      res.json(item);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH /api/feedback/:id — update status (or other fields)
  app.patch("/api/feedback/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { status } = req.body;
      if (!status) return res.status(400).json({ error: "status is required" });
      const [updated] = await db
        .update(appFeedback)
        .set({ status, updatedAt: new Date() })
        .where(eq(appFeedback.id, id))
        .returning();
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/feedback/:id
  app.delete("/api/feedback/:id", isApproved, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(appFeedback).where(eq(appFeedback.id, id));
      res.json({ ok: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST /api/feedback/refine — use OpenAI to refine raw feedback into structured form
  app.post("/api/feedback/refine", isApproved, async (req: any, res) => {
    try {
      const orgId = reqOrgId(req);
      const { type, rawDescription } = req.body;
      if (!rawDescription?.trim()) return res.status(400).json({ error: "rawDescription is required" });
      const apiKey = await getPlatformOpenAIKey();
      if (!apiKey) return res.status(400).json({ error: "OpenAI API key not configured" });

      const typeLabels: Record<string, string> = {
        defect: "Bug / Defect",
        enhancement: "Enhancement",
        feature: "New Feature / Capability",
      };
      const typeLabel = typeLabels[type] ?? "Enhancement";

      const systemPrompt = `You are E.L.F.I.E., the AI assistant for E.L.F.I.E. (Electronic Lifeform For Intelligent Elements), a LEGO reselling business operations platform.
Your job is to take a user's raw app feedback and refine it into a clear, structured request that can be handed to a developer.
Write everything in plain English that a non-technical business owner can understand.
Your response MUST be valid JSON with these exact keys: title, refinedDescription, acceptanceCriteria.
- title: a short (under 10 words), action-oriented title
- refinedDescription: 2-4 sentences clearly explaining what the user wants and why it matters to their business
- acceptanceCriteria: a newline-separated list of 3-6 bullet points (plain text, no markdown) describing what "done" looks like from the user's perspective`;

      const userPrompt = `Feedback type: ${typeLabel}\n\nUser's raw description:\n${rawDescription}\n\nRefine this into a structured request.`;

      const client = new OpenAI({ apiKey });

      const completionModel = "gpt-4o-mini";
      const completion = await client.chat.completions.create({
        model: completionModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 600,
      });

      if (completion.usage) {
        const { trackUsage } = await import('./services/ai-usage-tracker');
        trackUsage({
          service: 'openai',
          model: completionModel,
          operation: 'feedback-refine',
          inputTokens: completion.usage.prompt_tokens || 0,
          outputTokens: completion.usage.completion_tokens || 0,
          totalTokens: completion.usage.total_tokens || 0,
          orgId: orgId || null,
        });
      }

      const text = completion.choices[0]?.message?.content ?? "{}";
      const parsed = JSON.parse(text);

      res.json({
        title: parsed.title ?? "Untitled Request",
        refinedDescription: parsed.refinedDescription ?? rawDescription,
        acceptanceCriteria: parsed.acceptanceCriteria ?? "",
      });
    } catch (error: any) {
      console.error("❌ Feedback refine error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ── Global error handler ──────────────────────────────────────────────────
  // Catches any error passed to next(err) or thrown inside async route handlers
  // that was not already handled. Keeps error handling DRY across all routes.
  app.use((err: any, _req: any, res: any, _next: any) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || 'Internal server error';
    if (status >= 500) {
      console.error('[Unhandled error]', err);
    }
    if (!res.headersSent) {
      res.status(status).json({ message });
    }
  });

  // POST /api/labels/combined — fetch multiple EasyPost label PDFs and merge into one
  app.post("/api/labels/combined", isApproved, async (req, res) => {
    try {
      const { labelUrls } = req.body as { labelUrls: string[] };
      if (!Array.isArray(labelUrls) || labelUrls.length === 0) {
        return res.status(400).json({ error: "labelUrls array is required" });
      }

      const { PDFDocument } = await import('pdf-lib');

      // Fetch all label PDFs in parallel
      const pdfBuffers = await Promise.all(
        labelUrls.map(async (url) => {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`Failed to fetch label: ${r.status} ${url}`);
          return Buffer.from(await r.arrayBuffer());
        })
      );

      // Merge into one PDF document
      const merged = await PDFDocument.create();
      for (const buf of pdfBuffers) {
        const src = await PDFDocument.load(buf);
        const pages = await merged.copyPages(src, src.getPageIndices());
        pages.forEach(p => merged.addPage(p));
      }

      const mergedBytes = await merged.save();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="shipping-labels.pdf"');
      res.send(Buffer.from(mergedBytes));
    } catch (err: any) {
      console.error('[Labels] Combined PDF error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  const httpServer = createServer(app);

  return httpServer;
}
