import { Router } from "express";
import OpenAI from "openai";
import { z } from "zod";
import { createHash } from "crypto";
import { eq, desc, sql, inArray, or, and, isNull, isNotNull, count, gte, asc, ne } from "drizzle-orm";
import { db, pool } from "../db";
import { asyncRoute, reqOrgId, maskSecret, maskSettingsSecrets, SECRET_FIELDS, getOrgSettings } from "../lib/routeHelpers";
import { isAuthenticated, isApproved, isSuperAdmin } from "../auth";
import { getPlatformSettings, getPlatformOpenAIKey, getPlatformBrickLinkCredentials } from "../lib/platformSettings";
import { getRecentLogs, clearLogs } from "../services/server-log-buffer";
import { getEffectiveLimits } from "@shared/tierConfig";
import { getOrgWithLimits, checkSeatLimit, checkAutomationLimit, checkBrickspotterLimit } from "../services/tierEnforcement";
import { stripeClient } from "../services/stripe";
import { trackUsage } from "../services/ai-usage-tracker";
import { storage } from "../storage";
import {
  organizations, users, appSettings, platformSettings as platformSettingsTable,
  insertPlatformSettingsSchema, insertAppSettingsSchema,
  syncMetadata, blInventory, orders, inventoryEmbeddings, orderEmbeddings,
  embeddingJobs, blApiCalls, blCatalogClipEmbeddings, blCatalog,
  businessInsights, supportTickets, conversations,
  productVision, productOkrs, productKeyResults, productRoadmapItems,
  productBacklogItems, productCapabilities, featureVotes, pricingModel, plans,
  insertPlanSchema, insertProductOkrSchema, insertProductKeyResultSchema,
  insertProductRoadmapItemSchema, insertProductBacklogItemSchema, insertProductCapabilitySchema,
  channelLotLinks, blInventory as blInv, channelLotLinks as cll,
  historicalOrderRecovery, orderDetails, shipstationOrderMappings, shipstationDuplicateOrderArchives,
  PLATFORM_ORG_ID,
} from "@shared/schema";
import { getHistoricalRecoveryCandidates, clearShipStationRecoveryCache, canConfirmShipStationLineItem, isImmutableLineConflict } from "../services/shipstation-recovery";
import { compareDuplicateOrderRecords } from "../services/order-sync-helpers";

const router = Router();

// Billing helpers
function getBillingPeriodStart(billingStartDate: Date | null | undefined, now: Date): Date {
  if (!billingStartDate) return new Date(now.getFullYear(), now.getMonth(), 1);
  const signupDay = billingStartDate.getDate();
  let periodStart = new Date(now.getFullYear(), now.getMonth(), signupDay);
  if (periodStart > now) periodStart = new Date(now.getFullYear(), now.getMonth() - 1, signupDay);
  return periodStart;
}

function getBillingPeriodStartOffset(billingStartDate: Date | null | undefined, now: Date, monthsBack: number): Date {
  if (!billingStartDate) return new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
  const signupDay = billingStartDate.getDate();
  const currentPeriodStart = getBillingPeriodStart(billingStartDate, now);
  return new Date(currentPeriodStart.getFullYear(), currentPeriodStart.getMonth() - monthsBack, signupDay);
}

async function getOrgMonthlySalesCents(orgId: string, from: Date, to: Date): Promise<number> {
  const itemsResult = await db.execute(sql`
    SELECT COALESCE(SUM(od.quantity * od.unit_price::numeric), 0) AS total
    FROM order_details od JOIN orders o ON o.id = od.order_id
    WHERE o.org_id = ${orgId} AND o.order_status NOT IN ('cancelled','purged')
      AND o.order_date >= ${from} AND o.order_date < ${to}
  `);
  const itemsCents = Math.round(parseFloat((itemsResult.rows[0] as any)?.total ?? '0') * 100);
  const discountResult = await db.execute(sql`
    SELECT COALESCE(SUM(oa.amount::numeric), 0) AS total
    FROM order_adjustments oa JOIN orders o ON o.id = oa.order_id
    WHERE o.org_id = ${orgId} AND o.order_status NOT IN ('cancelled','purged')
      AND o.order_date >= ${from} AND o.order_date < ${to} AND oa.type = 'discount'
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
  const [defaultPlan] = await db.select().from(plans).where(eq(plans.isDefault, true)).limit(1);
  if (defaultPlan) return defaultPlan;
  return { id: 0, name: 'Pay As You Grow', basePrice: 3900, salesPercentage: 1.9, freeSalesThreshold: 100000, status: 'live', isDefault: true, sunsetAt: null, createdAt: new Date(), updatedAt: new Date() };
}

// ── Platform Admin: Org management ───────────────────────────────────────────

router.get("/platform-admin/orgs", isSuperAdmin, asyncRoute(async (_req, res) => {
  const orgs = await db.select().from(organizations).orderBy(desc(organizations.createdAt));
  const userCounts = await db.select({ orgId: users.orgId, count: count() }).from(users).groupBy(users.orgId);
  const userCountMap = new Map(userCounts.map(u => [u.orgId, u.count]));
  const result = orgs.map(org => ({ ...org, userCount: userCountMap.get(org.id) || 0, limits: getEffectiveLimits(org) }));
  res.json(result);
}));

router.get("/platform-admin/org-sync-status", isSuperAdmin, asyncRoute(async (_req, res) => {
  const orgSyncIds = ['bricklink_inventory', 'bricklink_orders', 'brickowl_orders', 'ebay_orders', 'channel_sync'];
  const syncRows = await db.select({ id: syncMetadata.id, orgId: syncMetadata.orgId, lastSyncTime: syncMetadata.lastSyncTime, lastSyncStatus: syncMetadata.lastSyncStatus, recordsAdded: syncMetadata.recordsAdded, recordsUpdated: syncMetadata.recordsUpdated, errorMessage: syncMetadata.errorMessage, updatedAt: syncMetadata.updatedAt })
    .from(syncMetadata)
    .where(and(inArray(syncMetadata.id, orgSyncIds), sql`${syncMetadata.orgId} IS NOT NULL AND ${syncMetadata.orgId} != ${PLATFORM_ORG_ID}`))
    .orderBy(desc(syncMetadata.updatedAt));
  const bsScans = await db.execute(sql`SELECT org_id, COUNT(*)::int as total_scans, COUNT(*) FILTER (WHERE status = 'complete')::int as completed, COUNT(*) FILTER (WHERE status = 'failed')::int as failed, MAX(created_at)::text as last_scan_at FROM brickanalyzer_scans WHERE org_id IS NOT NULL AND org_id != ${PLATFORM_ORG_ID} GROUP BY org_id`);
  const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(sql`${organizations.id} != ${PLATFORM_ORG_ID}`);
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
  for (const [oid, name] of Array.from(orgMap.entries())) {
    if (!grouped[oid]) grouped[oid] = { orgName: name, syncs: [], brickspotter: null };
  }
  res.json(Object.entries(grouped).map(([orgId, data]) => ({ orgId, ...data })));
}));

router.get("/platform-admin/stats", isSuperAdmin, asyncRoute(async (_req, res) => {
  const [orgStats] = await db.select({ count: count() }).from(organizations);
  const [userStats] = await db.select({ count: count() }).from(users);
  const [activeSubs] = await db.select({ count: count() }).from(organizations).where(eq(organizations.subscriptionStatus, 'active'));
  res.json({ totalOrganizations: orgStats.count, totalUsers: userStats.count, activeSubscriptions: activeSubs.count });
}));

router.post("/admin/organizations/:id/plan", isSuperAdmin, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { plan } = req.body;
  if (!['trial', 'foundation', 'core', 'flagship'].includes(plan)) return res.status(400).json({ message: "Invalid plan" });
  const [updated] = await db.update(organizations).set({ plan, updatedAt: new Date() }).where(eq(organizations.id, id)).returning();
  res.json(updated);
}));

router.get("/admin/mappings/status", isAuthenticated, asyncRoute(async (_req, res) => {
  const { ORDER_STATUS_MAPPINGS } = await import('../config/order-status-mapping');
  res.json(ORDER_STATUS_MAPPINGS);
}));

router.get("/admin/mappings/sku-links", isAuthenticated, asyncRoute(async (req: any, res) => {
  const orgId = req.user?.orgId;
  const links = await db.select({ blInvId: channelLotLinks.blInvId, orgId: channelLotLinks.orgId, channel: channelLotLinks.channel, channelLotId: channelLotLinks.channelLotId, syncedAt: channelLotLinks.syncedAt, itemNo: blInventory.itemNo, itemType: blInventory.itemType, colorId: blInventory.colorId, description: blInventory.description })
    .from(channelLotLinks).leftJoin(blInventory, eq(channelLotLinks.blInvId, blInventory.id)).where(eq(channelLotLinks.orgId, orgId)).orderBy(channelLotLinks.channel, channelLotLinks.blInvId);
  res.json(links);
}));

router.get("/admin/organizations/:id/limits", isAuthenticated, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const user = req.user as any;
  // Preview mode: a super admin "viewing as a regular user" loses cross-org access.
  const effectiveSuperAdmin = user.superAdmin && !req.session?.previewAsUser;
  if (user.orgId !== id && !effectiveSuperAdmin) return res.status(403).json({ message: "Forbidden" });
  const orgWithLimits = await getOrgWithLimits(id);
  if (!orgWithLimits) return res.status(404).json({ message: "Organization not found" });
  const [seatCheck, automationCheck, brickspotterCheck] = await Promise.all([checkSeatLimit(id), checkAutomationLimit(id), checkBrickspotterLimit(id)]);
  res.json({ plan: orgWithLimits.plan, limits: orgWithLimits.limits, usage: { seats: seatCheck, automationRules: automationCheck, brickspotterScans: brickspotterCheck } });
}));

router.patch("/admin/organizations/:id/overrides", isSuperAdmin, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { seatLimitOverride, brickspotterLimitOverride, automationLimitOverride, blApiCallLimitOverride } = req.body;
  const updates: any = { updatedAt: new Date() };
  if (seatLimitOverride !== undefined) updates.seatLimitOverride = seatLimitOverride;
  if (brickspotterLimitOverride !== undefined) updates.brickspotterLimitOverride = brickspotterLimitOverride;
  if (automationLimitOverride !== undefined) updates.automationLimitOverride = automationLimitOverride;
  if (blApiCallLimitOverride !== undefined) {
    updates.blApiCallLimitOverride = (blApiCallLimitOverride != null && blApiCallLimitOverride > 0) ? Math.min(5000, blApiCallLimitOverride) : blApiCallLimitOverride;
  }
  const [updated] = await db.update(organizations).set(updates).where(eq(organizations.id, id)).returning();
  res.json(updated);
}));

router.get("/admin/organizations/:id/bl-api-usage", isSuperAdmin, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db.select({ count: sql<number>`count(*)` }).from(blApiCalls).where(and(eq(blApiCalls.orgId, id), gte(blApiCalls.timestamp, twentyFourHoursAgo)));
  res.json({ orgId: id, callsLast24h: Number(row?.count) || 0 });
}));

// ── Impersonation ─────────────────────────────────────────────────────────────

router.post("/platform-admin/impersonate/:orgId", isSuperAdmin, asyncRoute(async (req: any, res) => {
  const { orgId } = req.params;
  const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) return res.status(404).json({ message: "Organization not found" });
  req.session.impersonatingOrgId = org.id;
  req.session.impersonatingOrgName = org.name;
  res.json({ success: true, orgId: org.id, orgName: org.name });
}));

router.delete("/platform-admin/impersonate", isSuperAdmin, asyncRoute(async (req: any, res) => {
  delete req.session.impersonatingOrgId;
  delete req.session.impersonatingOrgName;
  res.json({ success: true });
}));

router.get("/platform-admin/impersonation-status", isAuthenticated, asyncRoute(async (req: any, res) => {
  const isImpersonating = !!(req.session?.impersonatingOrgId);
  res.json({ isImpersonating, orgId: req.session?.impersonatingOrgId ?? null, orgName: req.session?.impersonatingOrgName ?? null });
}));

router.patch("/platform-admin/orgs/:id/features", isSuperAdmin, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { featureOverrides } = req.body;
  if (typeof featureOverrides !== 'object' || featureOverrides === null) return res.status(400).json({ message: "featureOverrides must be an object" });
  const [updated] = await db.update(organizations).set({ featureOverrides, updatedAt: new Date() }).where(eq(organizations.id, id)).returning();
  res.json(updated);
}));

router.post("/platform-admin/orgs/:id/factory-reset", isSuperAdmin, asyncRoute(async (req: any, res) => {
  const { id: orgId } = req.params;
  const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) return res.status(404).json({ message: 'Organization not found' });
  await storage.factoryResetOrganization(orgId);
  console.log(`[Platform Admin] Factory reset for org ${orgId} (${org.name})`);
  res.json({ success: true, orgId, orgName: org.name });
}));

type LegacyDuplicateOrderSnapshot = {
  id: string;
  order_key: string | null;
  marketplace: string | null;
  order_date: string | Date | null;
  order_total: string | number | null;
};

function parseDatabaseJson<T>(value: unknown): T {
  return typeof value === "string" ? JSON.parse(value) as T : value as T;
}

function duplicateOrderCandidateHash(candidate: {
  duplicateOrder: unknown;
  canonicalOrder: unknown;
  duplicateDetails: unknown;
  comparison: unknown;
}): string {
  return createHash("sha256").update(JSON.stringify(candidate)).digest("hex");
}

type SqlExecutor = {
  execute: (query: any) => Promise<any>;
};

async function getShipStationDuplicateCleanupCandidates(executor: SqlExecutor = db) {
  const result = await executor.execute(sql`
    SELECT
      bare.id AS duplicate_order_id,
      proper.id AS canonical_order_id,
      bare.org_id AS org_id,
      to_jsonb(bare) AS duplicate_order,
      to_jsonb(proper) AS canonical_order,
      COALESCE((
        SELECT jsonb_agg(to_jsonb(od) ORDER BY od.id)
        FROM order_details od
        WHERE od.order_id = bare.id
      ), '[]'::jsonb) AS duplicate_details,
      (
        bare.parent_order_id IS NOT NULL
        OR bare.local_only
        OR bare.order_number ~ '-[0-9]+$'
        OR EXISTS (
          SELECT 1 FROM order_splits split
          WHERE split.parent_order_id = bare.id OR split.split_order_id = bare.id
        )
      ) AS duplicate_is_split,
      (
        proper.parent_order_id IS NOT NULL
        OR proper.local_only
        OR proper.order_number ~ '-[0-9]+$'
        OR EXISTS (
          SELECT 1 FROM order_splits split
          WHERE split.parent_order_id = proper.id OR split.split_order_id = proper.id
        )
      ) AS canonical_is_split,
      EXISTS (
        SELECT 1
        FROM orders reused
        WHERE reused.id NOT IN (bare.id, proper.id)
          AND reused.org_id IS NOT DISTINCT FROM bare.org_id
          AND (reused.order_number = bare.order_number OR reused.order_number = proper.order_number)
      ) AS has_reused_order_number,
      archive.id AS archive_id,
      archive.archived_at AS archived_at
    FROM orders bare
    INNER JOIN orders proper
      ON proper.id = 'bl-' || SUBSTRING(bare.order_number FROM 4)
      AND proper.org_id IS NOT DISTINCT FROM bare.org_id
    LEFT JOIN shipstation_duplicate_order_archives archive
      ON archive.candidate_key = bare.id || ':' || proper.id
    WHERE bare.order_number LIKE 'BL.%'
    ORDER BY bare.order_date DESC, bare.id
  `);

  return (result.rows as any[]).map((row) => {
    const duplicateOrder = parseDatabaseJson<LegacyDuplicateOrderSnapshot>(row.duplicate_order);
    const canonicalOrder = parseDatabaseJson<LegacyDuplicateOrderSnapshot>(row.canonical_order);
    const duplicateDetails = parseDatabaseJson<unknown[]>(row.duplicate_details);
    const comparison = compareDuplicateOrderRecords({
      duplicate: {
        orderKey: duplicateOrder.order_key,
        source: duplicateOrder.marketplace,
        orderDate: duplicateOrder.order_date,
        orderTotal: duplicateOrder.order_total,
      },
      canonical: {
        orderKey: canonicalOrder.order_key,
        source: canonicalOrder.marketplace,
        orderDate: canonicalOrder.order_date,
        orderTotal: canonicalOrder.order_total,
      },
      duplicateIsSplit: Boolean(row.duplicate_is_split),
      canonicalIsSplit: Boolean(row.canonical_is_split),
      hasReusedOrderNumber: Boolean(row.has_reused_order_number),
    });
    const candidateKey = `${row.duplicate_order_id}:${row.canonical_order_id}`;
    const candidateHash = duplicateOrderCandidateHash({
      duplicateOrder,
      canonicalOrder,
      duplicateDetails,
      comparison,
    });

    return {
      candidateKey,
      candidateHash,
      duplicateOrder,
      canonicalOrder,
      duplicateDetails,
      duplicateDetailsCount: duplicateDetails.length,
      comparison,
      archived: Boolean(row.archive_id),
      archivedAt: row.archived_at ?? null,
      orgId: row.org_id ?? null,
    };
  });
}

const duplicateOrderArchiveSchema = z.object({
  candidateKey: z.string().min(1),
  expectedCandidateHash: z.string().length(64),
  reviewReason: z.string().trim().max(2000).nullable().optional(),
});

router.post("/platform-admin/cleanup-shipstation-duplicate-orders", isSuperAdmin, asyncRoute(async (req, res) => {
  if (req.query.confirm === "true") {
    return res.status(400).json({
      message: "Bulk deletion is no longer permitted. Review and archive one verified candidate at a time.",
    });
  }

  const candidates = await getShipStationDuplicateCleanupCandidates();
  const safeCandidates = candidates.filter(candidate => candidate.comparison.isSafe && !candidate.archived);
  const blockedCandidates = candidates.filter(candidate => !candidate.comparison.isSafe);
  const archivedCandidates = candidates.filter(candidate => candidate.archived);
  res.json({
    dryRun: true,
    candidates,
    summary: {
      total: candidates.length,
      readyForArchive: safeCandidates.length,
      blocked: blockedCandidates.length,
      archived: archivedCandidates.length,
      duplicateDetails: candidates.reduce((total, candidate) => total + candidate.duplicateDetailsCount, 0),
    },
    message: "No orders or line items were removed. Only fully matching, non-split, non-reused candidates may be archived for review.",
  });
}));

router.post("/platform-admin/cleanup-shipstation-duplicate-orders/archive", isSuperAdmin, asyncRoute(async (req: any, res) => {
  const input = duplicateOrderArchiveSchema.parse(req.body);
  let response: { ok: boolean; status?: number; message?: string; reasons?: string[]; candidateKey?: string };
  try {
    response = await db.transaction(async (tx) => {
      // The comparison reads orders, line items, and split relations. Lock all
      // three tables for this brief review transaction so a sync cannot change
      // any of that evidence between revalidation and archive insertion.
      await tx.execute(sql`LOCK TABLE orders, order_details, order_splits IN SHARE ROW EXCLUSIVE MODE`);
      const candidates = await getShipStationDuplicateCleanupCandidates(tx);
      const candidate = candidates.find(item => item.candidateKey === input.candidateKey);
      if (!candidate) return { ok: false, status: 404, message: "This duplicate candidate no longer exists. Reload the review list." };
      if (candidate.archived) return { ok: false, status: 409, message: "This candidate has already been archived for review." };
      if (candidate.candidateHash !== input.expectedCandidateHash) {
        return { ok: false, status: 409, message: "The candidate changed since it was reviewed. Reload and compare it again." };
      }
      if (!candidate.comparison.isSafe || !candidate.comparison.safeReason) {
        return {
          ok: false,
          status: 400,
          message: "This candidate is ambiguous and cannot be archived as a duplicate.",
          reasons: candidate.comparison.reasons,
        };
      }

      await tx.insert(shipstationDuplicateOrderArchives).values({
        candidateKey: candidate.candidateKey,
        candidateHash: candidate.candidateHash,
        orgId: candidate.orgId,
        duplicateOrderId: candidate.duplicateOrder.id,
        canonicalOrderId: candidate.canonicalOrder.id,
        duplicateSnapshot: JSON.stringify(candidate.duplicateOrder),
        canonicalSnapshot: JSON.stringify(candidate.canonicalOrder),
        duplicateDetailsSnapshot: JSON.stringify(candidate.duplicateDetails),
        comparisonSnapshot: JSON.stringify(candidate.comparison),
        safeReason: candidate.comparison.safeReason,
        reviewReason: input.reviewReason ?? null,
        archivedBy: req.user?.email || req.user?.id || "platform-admin",
      });
      return { ok: true, candidateKey: candidate.candidateKey };
    });
  } catch (error: any) {
    if (error?.code === "23505") {
      return res.status(409).json({ message: "This candidate was archived by another administrator. Reload the review list." });
    }
    throw error;
  }

  if (!response.ok) return res.status(response.status ?? 400).json({ message: response.message, reasons: response.reasons });
  console.log(`[AdminCleanup] Archived reviewed ShipStation duplicate candidate ${response.candidateKey}; original orders and line items retained.`);
  res.json({
    success: true,
    candidateKey: response.candidateKey,
    message: "Candidate archived for review. Original orders and line items were retained.",
  });
}));

router.get("/platform-admin/cleanup-shipstation-duplicate-orders/archives", isSuperAdmin, asyncRoute(async (_req, res) => {
  const archives = await db.select({
    candidateKey: shipstationDuplicateOrderArchives.candidateKey,
    candidateHash: shipstationDuplicateOrderArchives.candidateHash,
    duplicateOrderId: shipstationDuplicateOrderArchives.duplicateOrderId,
    canonicalOrderId: shipstationDuplicateOrderArchives.canonicalOrderId,
    duplicateSnapshot: shipstationDuplicateOrderArchives.duplicateSnapshot,
    canonicalSnapshot: shipstationDuplicateOrderArchives.canonicalSnapshot,
    duplicateDetailsSnapshot: shipstationDuplicateOrderArchives.duplicateDetailsSnapshot,
    comparisonSnapshot: shipstationDuplicateOrderArchives.comparisonSnapshot,
    safeReason: shipstationDuplicateOrderArchives.safeReason,
    reviewReason: shipstationDuplicateOrderArchives.reviewReason,
    archivedBy: shipstationDuplicateOrderArchives.archivedBy,
    archivedAt: shipstationDuplicateOrderArchives.archivedAt,
  }).from(shipstationDuplicateOrderArchives)
    .orderBy(desc(shipstationDuplicateOrderArchives.archivedAt));

  res.json({
    archives: archives.map(archive => ({
      ...archive,
      duplicateSnapshot: parseDatabaseJson<LegacyDuplicateOrderSnapshot>(archive.duplicateSnapshot),
      canonicalSnapshot: parseDatabaseJson<LegacyDuplicateOrderSnapshot>(archive.canonicalSnapshot),
      duplicateDetailsSnapshot: parseDatabaseJson<unknown[]>(archive.duplicateDetailsSnapshot),
      comparisonSnapshot: parseDatabaseJson<ReturnType<typeof compareDuplicateOrderRecords>>(archive.comparisonSnapshot),
    })),
  });
}));

const historicalRecoveryReviewSchema = z.object({
  decision: z.enum(["confirm_add", "confirm_quantity", "skip"]),
  sourceOrderId: z.string().min(1).nullable().optional(),
  sourceLineItemKey: z.string().min(1),
  expectedSourceSnapshotHash: z.string().length(64),
  expectedLocalQuantity: z.number().int().nonnegative().nullable().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
});

const historicalOrderMappingSchema = z.object({
  sourceOrderId: z.string().min(1),
  sourceSnapshotHash: z.string().length(64),
});

router.get("/platform-admin/historical-order-recovery/candidates", isSuperAdmin, asyncRoute(async (req, res) => {
  const result = await getHistoricalRecoveryCandidates({
    forceRefresh: req.query.refresh === "true",
  });
  res.json(result);
}));

router.post("/platform-admin/historical-order-recovery/cache/clear", isSuperAdmin, asyncRoute(async (_req, res) => {
  clearShipStationRecoveryCache();
  res.json({ success: true });
}));

router.post("/platform-admin/historical-order-recovery/:candidateKey/verify-order-link", isSuperAdmin, asyncRoute(async (req: any, res) => {
  const candidateKey = String(req.params.candidateKey);
  const input = historicalOrderMappingSchema.parse(req.body);
  const { candidates } = await getHistoricalRecoveryCandidates({ forceRefresh: true });
  const candidate = candidates.find(item => item.candidateKey === candidateKey);
  if (!candidate || candidate.orderMappingStatus !== "order_number_only" || !candidate.sourceOrder.orderId) {
    return res.status(409).json({ message: "This order link is no longer an unresolved review candidate. Reload before continuing." });
  }
  if (candidate.sourceOrder.orderId !== input.sourceOrderId || candidate.sourceSnapshotHash !== input.sourceSnapshotHash) {
    return res.status(409).json({ message: "The reviewed ShipStation source changed. Reload and compare the order again." });
  }
  try {
    await db.insert(shipstationOrderMappings).values({
      orgId: candidate.order.orgId ?? PLATFORM_ORG_ID,
      localOrderId: candidate.order.id,
      sourceOrderId: candidate.sourceOrder.orderId,
      sourceOrderKey: candidate.sourceOrder.orderKey,
      sourceSnapshot: JSON.stringify(candidate.sourceOrder),
      verifiedBy: req.user?.email || req.user?.id || "platform-admin",
    });
  } catch (error: any) {
    if (error?.code === "23505") return res.status(409).json({ message: "This ShipStation or local order is already linked. Reload to review the current mapping." });
    throw error;
  }
  clearShipStationRecoveryCache();
  res.json({ ok: true });
}));

router.post("/platform-admin/historical-order-recovery/:candidateKey/review", isSuperAdmin, asyncRoute(async (req: any, res) => {
  const input = historicalRecoveryReviewSchema.parse(req.body);
  const candidateKey = req.params.candidateKey;
  const result = await getHistoricalRecoveryCandidates({ forceRefresh: true });
  const candidate = result.candidates.find(item => item.candidateKey === candidateKey);
  if (!candidate) return res.status(404).json({ message: "Recovery candidate no longer exists or could not be matched to ShipStation." });
  if (candidate.review) return res.status(409).json({ message: "This recovery candidate has already been reviewed.", review: candidate.review });
  if ((input.decision !== "skip" && !candidate.sourceOrder.orderId) ||
    candidate.sourceOrder.orderId !== (input.sourceOrderId ?? null) ||
    candidate.sourceItem.lineItemKey !== input.sourceLineItemKey) {
    return res.status(409).json({ message: "The source record changed. Reload the candidates and review the current record." });
  }
  if (candidate.sourceSnapshotHash !== input.expectedSourceSnapshotHash) {
    return res.status(409).json({ message: "The reviewed ShipStation item changed. Reload the candidates before confirming." });
  }
  if (input.decision === "skip" && !input.reason) {
    return res.status(400).json({ message: "A reason is required when skipping an ambiguous or unverified candidate." });
  }
  if (input.decision === "confirm_add" && candidate.candidateType !== "missing_line_item") {
    return res.status(400).json({ message: "Only a verified missing line item can be added." });
  }
  if (input.decision === "confirm_quantity" && candidate.candidateType !== "quantity_mismatch") {
    return res.status(400).json({ message: "Only a verified quantity mismatch can be repaired." });
  }
  if (input.decision !== "skip" && candidate.candidateType === "ambiguous") {
    return res.status(400).json({ message: "Ambiguous source-format differences must be skipped, not guessed." });
  }
  if (input.decision !== "skip" && !canConfirmShipStationLineItem(candidate.sourceItem)) {
    return res.status(400).json({ message: "A stable ShipStation line-item ID/key is required before a historical line can be repaired." });
  }

  const reviewer = req.user?.email || req.user?.id || "platform-admin";
  const sourceSnapshot = JSON.stringify({ sourceOrder: candidate.sourceOrder, sourceItem: candidate.sourceItem });
  const beforeSnapshot = candidate.localItem ? JSON.stringify(candidate.localItem) : null;
  const now = new Date();

  let response: { conflict: boolean; alreadyReviewed?: boolean; orderDetailId?: string | null; decision?: string };
  try {
    response = await db.transaction(async (tx) => {
      const [existingReview] = await tx.select({ id: historicalOrderRecovery.id })
        .from(historicalOrderRecovery)
        .where(eq(historicalOrderRecovery.candidateKey, candidateKey))
        .limit(1);
      if (existingReview) return { conflict: false, alreadyReviewed: true };
      let orderDetailId = candidate.localItem?.id ?? null;
      let afterSnapshot: string | null = null;

      if (input.decision === "confirm_add") {
        const sourceItem = candidate.sourceItem;
        if (!sourceItem.name || sourceItem.quantity == null || sourceItem.quantity < 0) {
          throw new Error("ShipStation source row does not contain a safe name and integer quantity.");
        }
        // The candidate was generated before this transaction. Re-check the
        // immutable source line key here; the database trigger is the final
        // all-writers guard if a channel sync inserts the line concurrently.
        const [lineAddedSinceReview] = await tx.select({ id: orderDetails.id })
          .from(orderDetails)
          .where(and(
            eq(orderDetails.orderId, candidate.order.id),
            eq(orderDetails.lineItemKey, sourceItem.lineItemKey),
          ))
          .limit(1);
        if (lineAddedSinceReview) return { conflict: true };
        const fulfilled = ["shipped", "completed", "cancelled", "returned"].includes(candidate.order.orderStatus.toLowerCase());
        const [inserted] = await tx.insert(orderDetails).values({
          orderId: candidate.order.id,
          lineItemKey: sourceItem.lineItemKey,
          sku: sourceItem.sku,
          name: sourceItem.name,
          quantity: sourceItem.quantity,
          unitPrice: sourceItem.unitPrice == null ? null : String(sourceItem.unitPrice),
          taxAmount: sourceItem.taxAmount == null ? null : String(sourceItem.taxAmount),
          weight: sourceItem.weight == null ? null : String(sourceItem.weight),
          weightUnits: sourceItem.weightUnits,
          description: sourceItem.description,
          options: sourceItem.options == null ? null : JSON.stringify(sourceItem.options),
          customField1: sourceItem.customField1,
          customField2: sourceItem.customField2,
          customField3: sourceItem.customField3,
          fulfilled,
        }).returning();
        orderDetailId = inserted.id;
        afterSnapshot = JSON.stringify(inserted);
      } else if (input.decision === "confirm_quantity") {
        if (!candidate.localItem || input.expectedLocalQuantity == null) {
          throw new Error("The current local quantity is required to confirm a quantity repair.");
        }
        if (candidate.localItem.quantity !== input.expectedLocalQuantity) {
          return { conflict: true };
        }
        const [updated] = await tx.update(orderDetails)
          .set({ quantity: candidate.sourceItem.quantity!, updatedAt: now })
          .where(and(
            eq(orderDetails.id, candidate.localItem.id),
            eq(orderDetails.orderId, candidate.order.id),
            eq(orderDetails.quantity, input.expectedLocalQuantity),
          ))
          .returning();
        if (!updated) return { conflict: true };
        afterSnapshot = JSON.stringify(updated);
      }

      await tx.insert(historicalOrderRecovery).values({
        candidateKey,
        orderId: candidate.order.id,
        orderDetailId,
        orgId: candidate.order.orgId,
        sourceOrderId: candidate.sourceOrder.orderId,
        sourceLineItemKey: candidate.sourceItem.lineItemKey,
        candidateType: candidate.candidateType,
        decision: input.decision,
        reason: input.reason ?? null,
        beforeSnapshot,
        sourceSnapshot,
        afterSnapshot,
        reviewedBy: reviewer,
        reviewedAt: now,
      });
      return { conflict: false, orderDetailId, decision: input.decision };
    });
  } catch (error: any) {
    if (isImmutableLineConflict(error)) {
      return res.status(409).json({ message: "This ShipStation line was added by another writer. Reload before making another recovery decision." });
    }
    if (error?.code === "23505") {
      return res.status(409).json({ message: "This recovery candidate was reviewed by another administrator. Reload to see the audit record." });
    }
    throw error;
  }

  if (response.conflict) return res.status(409).json({ message: "The local quantity changed. Reload the candidates before confirming." });
  if (response.alreadyReviewed) return res.status(409).json({ message: "This recovery candidate has already been reviewed. Reload to see the audit record." });
  res.json({ success: true, ...response });
}));

router.patch("/platform-admin/orgs/:id/plan", isSuperAdmin, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const planId = parseInt(req.body.planId);
  if (!planId || isNaN(planId)) return res.status(400).json({ message: 'planId is required' });
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!plan) return res.status(404).json({ message: 'Plan not found' });
  const [updated] = await db.update(organizations).set({ planId, updatedAt: new Date() }).where(eq(organizations.id, id)).returning();
  res.json(updated);
}));

router.patch("/platform-admin/orgs/:id/suspend", isSuperAdmin, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;
  const [updated] = await db.update(organizations).set({ isActive: !!isActive, updatedAt: new Date() }).where(eq(organizations.id, id)).returning();
  res.json(updated);
}));

router.delete("/platform-admin/orgs/:id", isSuperAdmin, asyncRoute(async (req: any, res) => {
  const { id } = req.params;
  if (id === PLATFORM_ORG_ID || id === 'org_planetbrick' || id === '__platform__') return res.status(403).json({ message: "Cannot delete the platform organization." });
  const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!org) return res.status(404).json({ message: "Organization not found." });
  await storage.deleteOrganization(id);
  const wasImpersonating = req.session?.impersonatingOrgId === id;
  if (wasImpersonating) { delete req.session.impersonatingOrgId; delete req.session.impersonatingOrgName; }
  res.json({ success: true, wasImpersonating });
}));

router.get("/platform-admin/orgs/:id/payments", isSuperAdmin, asyncRoute(async (req, res) => {
  const { id } = req.params;
  const [org] = await db.select().from(organizations).where(eq(organizations.id, id)).limit(1);
  if (!org) return res.status(404).json({ error: 'Not found' });
  if (!org.stripeCustomerId) return res.json({ payments: [] });
  const stripe = stripeClient.getClient();
  const invoices = await stripe.invoices.list({ customer: org.stripeCustomerId, limit: 50 });
  const payments = invoices.data.map(inv => ({ id: inv.id, amount: inv.amount_paid, currency: inv.currency, status: inv.status, description: inv.description || inv.lines.data[0]?.description || null, periodStart: inv.period_start, periodEnd: inv.period_end, created: inv.created, hostedUrl: inv.hosted_invoice_url, pdfUrl: inv.invoice_pdf }));
  res.json({ payments });
}));

// ── Platform Services ─────────────────────────────────────────────────────────

router.get("/platform-admin/platform-services/stripe-balance", isSuperAdmin, asyncRoute(async (_req, res) => {
  const stripe = stripeClient.getClient();
  const balance = await stripe.balance.retrieve();
  res.json({ available: balance.available.map(b => ({ amount: b.amount, currency: b.currency })), pending: balance.pending.map(b => ({ amount: b.amount, currency: b.currency })), livemode: balance.livemode });
}));

router.get("/platform-admin/platform-services/platform-info", isSuperAdmin, asyncRoute(async (_req, res) => {
  const platSettings = await getPlatformSettings();
  res.json({ platformName: platSettings?.platformName || '', tagline: platSettings?.tagline || '', shopName: platSettings?.shopName || '', shopTagline: platSettings?.shopTagline || '', studioName: platSettings?.studioName || '', studioTagline: platSettings?.studioTagline || '' });
}));

router.post("/platform-admin/platform-services/platform-info", isSuperAdmin, asyncRoute(async (req, res) => {
  const { platformName, tagline, shopName, shopTagline, studioName, studioTagline } = req.body as { platformName: string; tagline?: string; shopName?: string; shopTagline?: string; studioName?: string; studioTagline?: string };
  if (typeof platformName !== 'string' || platformName.length > 100) return res.status(400).json({ message: 'Platform name must be a string (max 100 chars)' });
  await db.insert(platformSettingsTable).values({ id: 'platform', platformName: platformName.trim() || null, tagline: tagline?.trim() || null, shopName: shopName?.trim() || null, shopTagline: shopTagline?.trim() || null, studioName: studioName?.trim() || null, studioTagline: studioTagline?.trim() || null })
    .onConflictDoUpdate({ target: platformSettingsTable.id, set: { platformName: platformName.trim() || null, tagline: tagline?.trim() || null, shopName: shopName?.trim() || null, shopTagline: shopTagline?.trim() || null, studioName: studioName?.trim() || null, studioTagline: studioTagline?.trim() || null, updatedAt: sql`CURRENT_TIMESTAMP` } });
  res.json({ ok: true });
}));

router.get("/public/platform-info", asyncRoute(async (_req, res) => {
  const platSettings = await getPlatformSettings().catch(() => null);
  res.json({ tagline: platSettings?.tagline || null, shopName: platSettings?.shopName || null, shopTagline: platSettings?.shopTagline || null, studioName: platSettings?.studioName || null, studioTagline: platSettings?.studioTagline || null });
}));

router.get("/platform-admin/platform-services/bricklink-status", isSuperAdmin, asyncRoute(async (_req, res) => {
  const creds = await getPlatformBrickLinkCredentials();
  if (!creds) return res.json({ connected: false, hasCredentials: false });
  const { bricklinkRequest } = await import('../services/bricklink');
  const result = await bricklinkRequest('/colors', undefined, PLATFORM_ORG_ID);
  const colorCount = Array.isArray(result.data) ? result.data.length : 0;
  res.json({ connected: true, hasCredentials: true, keyPrefix: creds.consumerKey.substring(0, 8) + '…', testResult: `${colorCount} colors retrieved` });
}));

router.post("/platform-admin/platform-services/bricklink-credentials", isSuperAdmin, asyncRoute(async (req, res) => {
  const body = req.body as Record<string, string | null | undefined>;
  const updateSet: Record<string, any> = { updatedAt: sql`CURRENT_TIMESTAMP` };
  const insertValues: Record<string, any> = { id: PLATFORM_ORG_ID };
  const cleanCred = (v: string) => v.replace(/[^A-Za-z0-9]/g, '');
  if (typeof body.consumerKey === 'string' && body.consumerKey.trim().length > 0) { const val = cleanCred(body.consumerKey); updateSet.blConsumerKey = val; insertValues.blConsumerKey = val; }
  if (typeof body.consumerSecret === 'string' && body.consumerSecret.trim().length > 0) { const val = cleanCred(body.consumerSecret); updateSet.blConsumerSecret = val; insertValues.blConsumerSecret = val; }
  if (typeof body.tokenValue === 'string' && body.tokenValue.trim().length > 0) { const val = cleanCred(body.tokenValue); updateSet.blTokenValue = val; insertValues.blTokenValue = val; }
  if (typeof body.tokenSecret === 'string' && body.tokenSecret.trim().length > 0) { const val = cleanCred(body.tokenSecret); updateSet.blTokenSecret = val; insertValues.blTokenSecret = val; }
  if (Object.keys(updateSet).length <= 1) return res.status(400).json({ message: 'No valid credential fields provided' });
  await db.insert(platformSettingsTable).values(insertValues).onConflictDoUpdate({ target: platformSettingsTable.id, set: updateSet });
  res.json({ ok: true });
}));

router.get("/platform-admin/platform-services/bricklink-credentials", isSuperAdmin, asyncRoute(async (_req, res) => {
  const [ps] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.id, PLATFORM_ORG_ID)).limit(1);
  const mask = (val: string | null | undefined) => val ? val.substring(0, 8) + '…' : '';
  res.json({ hasConsumerKey: !!ps?.blConsumerKey, consumerKeyPrefix: mask(ps?.blConsumerKey), hasConsumerSecret: !!ps?.blConsumerSecret, hasTokenValue: !!ps?.blTokenValue, tokenValuePrefix: mask(ps?.blTokenValue), hasTokenSecret: !!ps?.blTokenSecret });
}));

router.get("/platform-admin/platform-services/ebay-credentials", isSuperAdmin, asyncRoute(async (req, res) => {
  const [ps] = await db.select().from(platformSettingsTable).limit(1);
  const prefix = (v: string | null | undefined) => v ? v.substring(0, 12) + '…' : null;
  res.json({
    prod: { hasAppId: !!ps?.ebayProdAppId, hasCertId: !!ps?.ebayProdCertId, hasDevId: !!ps?.ebayProdDevId, hasRuName: !!ps?.ebayProdRuName, appIdPrefix: prefix(ps?.ebayProdAppId), ruNamePrefix: prefix(ps?.ebayProdRuName) },
    sandbox: { hasAppId: !!ps?.ebaySandboxAppId, hasCertId: !!ps?.ebaySandboxCertId, hasDevId: !!ps?.ebaySandboxDevId, hasRuName: !!ps?.ebaySandboxRuName, appIdPrefix: prefix(ps?.ebaySandboxAppId), ruNamePrefix: prefix(ps?.ebaySandboxRuName) },
    hasNotificationToken: !!ps?.ebayNotificationToken,
    notificationEndpoint: `${(req.headers['x-forwarded-proto'] as string) || req.protocol || 'https'}://${(req.headers['x-forwarded-host'] as string) || req.headers.host || ''}/api/ebay/notifications`,
  });
}));

router.post("/platform-admin/platform-services/ebay-credentials", isSuperAdmin, asyncRoute(async (req, res) => {
  const body = req.body as Record<string, string | undefined>;
  const fieldMap: Array<[string, string]> = [
    ['prodAppId','ebay_prod_app_id'],['prodCertId','ebay_prod_cert_id'],['prodDevId','ebay_prod_dev_id'],['prodRuName','ebay_prod_ru_name'],
    ['sandboxAppId','ebay_sandbox_app_id'],['sandboxCertId','ebay_sandbox_cert_id'],['sandboxDevId','ebay_sandbox_dev_id'],['sandboxRuName','ebay_sandbox_ru_name'],
    ['notificationToken','ebay_notification_token'],
  ];
  const setCols: string[] = []; const setVals: string[] = [];
  for (const [bodyKey, colName] of fieldMap) {
    const val = body[bodyKey];
    if (typeof val === 'string' && val.trim().length > 0) { setCols.push(colName); setVals.push(val.trim()); }
  }
  if (setCols.length === 0) return res.status(400).json({ message: 'No credential fields provided' });
  const assignments = setCols.map((col, i) => sql.raw(`"${col}" = `).append(sql`${setVals[i]}`));
  const setFragment = assignments.reduce((acc, a, i) => i === 0 ? a : acc.append(sql.raw(', ')).append(a));
  await db.execute(sql.raw('UPDATE platform_settings SET ').append(setFragment).append(sql.raw(", updated_at = NOW() WHERE id = 'platform'")));
  console.log(`[eBay Creds] Saved columns: ${setCols.join(', ')}`);
  res.json({ ok: true });
}));

router.get("/platform-admin/platform-services/openai-status", isSuperAdmin, asyncRoute(async (_req, res) => {
  const apiKey = await getPlatformOpenAIKey();
  if (!apiKey) return res.json({ connected: false, models: [] });
  const client = new OpenAI({ apiKey });
  const models = await client.models.list();
  const chatModels = models.data.filter(m => m.id.startsWith('gpt')).slice(0, 5).map(m => m.id);
  res.json({ connected: true, models: chatModels, keyPrefix: apiKey.substring(0, 7) + '…' });
}));

router.post("/platform-admin/platform-services/openai-key", isSuperAdmin, asyncRoute(async (req, res) => {
  const { openaiApiKey } = req.body as { openaiApiKey: string | null };
  await db.insert(platformSettingsTable).values({ id: 'platform', openaiApiKey: openaiApiKey || null })
    .onConflictDoUpdate({ target: platformSettingsTable.id, set: { openaiApiKey: openaiApiKey || null, updatedAt: sql`CURRENT_TIMESTAMP` } });
  res.json({ ok: true });
}));

router.get("/platform-admin/platform-services/openai-billing", isSuperAdmin, asyncRoute(async (_req, res) => {
  const { getUsageSummary, getUsageMtd, getUsageLast30d } = await import('../services/ai-usage-tracker');
  const [summary, mtd, last30d] = await Promise.all([getUsageSummary(30), getUsageMtd(), getUsageLast30d()]);
  const topModels = summary.sort((a, b) => Number(b.totalTokens) - Number(a.totalTokens)).slice(0, 10).map(row => ({ model: row.model, service: row.service, cost: Math.round(Number(row.totalCost) * 10000) / 10000, input_tokens: Number(row.totalInput), output_tokens: Number(row.totalOutput), requests: Number(row.requests) }));
  res.json({ billing: { totalGranted: 0, totalUsed: 0, totalAvailable: 0, grants: [] }, usage: { last30Days: Math.round(Number(last30d.totalCost) * 10000) / 10000, mtd: Math.round(Number(mtd.totalCost) * 10000) / 10000, topModels, totalTokens: Number(last30d.totalTokens), totalRequests: Number(last30d.requests), mtdTokens: Number(mtd.totalTokens), mtdRequests: Number(mtd.requests) }, costsAvailable: summary.length > 0, creditsAvailable: false, source: 'local' });
}));

router.get("/platform-admin/platform-services/openai-billing/by-org", isSuperAdmin, asyncRoute(async (_req, res) => {
  const { getUsageByOrg } = await import('../services/ai-usage-tracker');
  const rows = await getUsageByOrg(30);
  const orgMap: Record<string, { orgId: string; totalTokens: number; totalCost: number; requests: number; operations: Record<string, { tokens: number; cost: number; requests: number }> }> = {};
  for (const row of rows) {
    const oid = row.orgId || 'platform';
    if (!orgMap[oid]) orgMap[oid] = { orgId: oid, totalTokens: 0, totalCost: 0, requests: 0, operations: {} };
    const entry = orgMap[oid];
    const tokens = Number(row.totalTokens); const cost = Number(row.totalCost); const reqs = Number(row.requests);
    entry.totalTokens += tokens; entry.totalCost += cost; entry.requests += reqs;
    const op = row.operation || 'other';
    if (!entry.operations[op]) entry.operations[op] = { tokens: 0, cost: 0, requests: 0 };
    entry.operations[op].tokens += tokens; entry.operations[op].cost += cost; entry.operations[op].requests += reqs;
  }
  const orgNames: Record<string, string> = {};
  let storedPlatformName = '';
  const allOrgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);
  for (const o of allOrgs) orgNames[o.id] = o.name;
  const platSettings2 = await getPlatformSettings().catch(() => null);
  storedPlatformName = platSettings2?.platformName || '';
  const orgs = Object.values(orgMap).map(o => ({ ...o, orgName: orgNames[o.orgId] || (o.orgId === 'platform' ? (storedPlatformName || 'Platform') : o.orgId), totalCost: Math.round(o.totalCost * 10000) / 10000, operations: Object.entries(o.operations).map(([op, d]) => ({ operation: op, tokens: d.tokens, cost: Math.round(d.cost * 10000) / 10000, requests: d.requests })) })).sort((a, b) => b.totalTokens - a.totalTokens);
  res.json({ orgs });
}));

// ── Platform Admin: Settings ──────────────────────────────────────────────────

router.get("/platform-admin/settings", isSuperAdmin, asyncRoute(async (_req, res) => {
  const [appSettingsRow, platSettingsRow] = await Promise.all([getOrgSettings(PLATFORM_ORG_ID), getPlatformSettings()]);
  res.json(maskSettingsSecrets({ ...appSettingsRow, ...platSettingsRow } as any));
}));

router.post("/platform-admin/settings", isSuperAdmin, asyncRoute(async (req, res) => {
  const body = { ...req.body };
  for (const field of SECRET_FIELDS) {
    const val = body[field];
    if (val && typeof val === 'string' && val.includes('····')) delete body[field];
  }
  const platData = insertPlatformSettingsSchema.partial().parse(body);
  const appData = insertAppSettingsSchema.partial().parse(body);
  const [appSettingsRow, platSettingsRow] = await Promise.all([
    db.insert(appSettings).values({ ...appData, id: PLATFORM_ORG_ID, orgId: PLATFORM_ORG_ID }).onConflictDoUpdate({ target: appSettings.id, set: { ...appData, updatedAt: sql`CURRENT_TIMESTAMP` } }).returning().then(r => r[0]),
    db.insert(platformSettingsTable).values({ id: 'platform', ...platData }).onConflictDoUpdate({ target: platformSettingsTable.id, set: { ...platData, updatedAt: sql`CURRENT_TIMESTAMP` } }).returning().then(r => r[0]),
  ]);
  res.json(maskSettingsSecrets({ ...appSettingsRow, ...platSettingsRow } as any));
}));

// ── Admin Team ────────────────────────────────────────────────────────────────

router.get("/platform-admin/admin-team", isSuperAdmin, asyncRoute(async (_req, res) => {
  const admins = await storage.getSuperAdmins();
  res.json(admins);
}));

router.get("/platform-admin/admin-team/search", isSuperAdmin, asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json([]);
  const results = await storage.searchUsersByEmail(q);
  res.json(results);
}));

router.patch("/platform-admin/admin-team/:id", isSuperAdmin, asyncRoute(async (req: any, res) => {
  const schema = z.object({ superAdmin: z.boolean() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Invalid body' });
  if (req.user?.id === req.params.id && !parsed.data.superAdmin) return res.status(400).json({ message: 'Cannot remove your own super admin access' });
  const updated = await storage.updateUserSuperAdmin(req.params.id, parsed.data.superAdmin);
  if (!updated) return res.status(404).json({ message: 'User not found' });
  res.json(updated);
}));

// ── Pricing Model ─────────────────────────────────────────────────────────────

router.get("/platform-admin/pricing-model", isSuperAdmin, asyncRoute(async (_req, res) => {
  const [row] = await db.select().from(pricingModel).where(eq(pricingModel.id, 1)).limit(1);
  res.json(row || null);
}));

router.put("/platform-admin/pricing-model", isSuperAdmin, asyncRoute(async (req, res) => {
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
}));

// ── Org Usage & Billing ───────────────────────────────────────────────────────

router.get("/org/usage", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const now = new Date();
  const plan = await getOrgActivePlan(orgId);
  const [orgRow] = await db.select({ billingStartDate: organizations.billingStartDate, subscriptionStatus: organizations.subscriptionStatus, planId: organizations.planId }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const periodStart = getBillingPeriodStart(orgRow?.billingStartDate, now);
  const monthlySalesCents = await getOrgMonthlySalesCents(orgId, periodStart, now);
  const billing = calcSalesBilling(plan, monthlySalesCents);
  res.json({ orgId, billingStartDate: orgRow?.billingStartDate ? orgRow.billingStartDate.toISOString() : null, subscriptionStatus: orgRow?.subscriptionStatus ?? 'active', period: { start: periodStart.toISOString(), end: now.toISOString() }, plan: { id: plan.id, name: plan.name, basePrice: plan.basePrice, salesPercentage: plan.salesPercentage, freeSalesThreshold: plan.freeSalesThreshold, isDefault: plan.isDefault ?? false, sunsetAt: plan.sunsetAt ? plan.sunsetAt.toISOString() : null }, monthlySalesCents, billing });
}));

router.get("/org/billing/history", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const plan = await getOrgActivePlan(orgId);
  const [orgRow] = await db.select({ billingStartDate: organizations.billingStartDate, createdAt: organizations.createdAt }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const now = new Date();
  const billingStartDate = orgRow?.billingStartDate ?? orgRow?.createdAt ?? null;
  const currentPeriodStart = getBillingPeriodStart(billingStartDate, now);
  const earliest = billingStartDate ?? currentPeriodStart;
  const totalMonthsBack = (currentPeriodStart.getFullYear() - earliest.getFullYear()) * 12 + (currentPeriodStart.getMonth() - earliest.getMonth());
  const firstYear = earliest.getFullYear();
  const lastYear = totalMonthsBack > 0 ? currentPeriodStart.getFullYear() : earliest.getFullYear();
  const requestedYear = req.query.year ? parseInt(req.query.year as string) : lastYear;
  const targetYear = Math.max(firstYear, Math.min(lastYear, requestedYear));
  const months = [];
  for (let i = 1; i <= totalMonthsBack; i++) {
    const mStart = getBillingPeriodStartOffset(billingStartDate, now, i);
    if (billingStartDate && mStart < earliest) continue;
    if (mStart.getFullYear() !== targetYear) continue;
    const mEnd = getBillingPeriodStartOffset(billingStartDate, now, i - 1);
    const monthlySalesCents = await getOrgMonthlySalesCents(orgId, mStart, mEnd);
    const billing = calcSalesBilling(plan, monthlySalesCents);
    months.push({ label: mStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), year: mStart.getFullYear(), periodStart: mStart.toISOString(), periodEnd: mEnd.toISOString(), monthlySalesCents, billing, plan: { name: plan.name, basePrice: plan.basePrice, salesPercentage: plan.salesPercentage, freeSalesThreshold: plan.freeSalesThreshold, isDefault: plan.isDefault ?? false, sunsetAt: plan.sunsetAt ? plan.sunsetAt.toISOString() : null } });
  }
  res.json({ months, year: targetYear, firstYear, lastYear });
}));

// ── Plans CRUD ────────────────────────────────────────────────────────────────

router.get("/platform-admin/plans", isSuperAdmin, asyncRoute(async (_req, res) => {
  const allPlans = await db.select().from(plans).orderBy(asc(plans.id));
  const orgCounts = await db.select({ planId: organizations.planId, count: sql<number>`COUNT(*)::int` }).from(organizations).groupBy(organizations.planId);
  const countMap = new Map(orgCounts.map(r => [r.planId, Number(r.count)]));
  res.json(allPlans.map(p => { const orgCount = countMap.get(p.id) ?? 0; return { ...p, orgCount, locked: orgCount > 0 }; }));
}));

router.post("/platform-admin/plans", isSuperAdmin, asyncRoute(async (req, res) => {
  const data = insertPlanSchema.parse(req.body);
  const [created] = await db.insert(plans).values(data).returning();
  res.status(201).json(created);
}));

router.patch("/platform-admin/plans/:id", isSuperAdmin, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  const [orgCount] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(organizations).where(eq(organizations.planId, id));
  const hasOrgs = Number(orgCount.count) > 0;
  const bsFields = { ...(req.body.isBrickspotterOnly !== undefined && { isBrickspotterOnly: req.body.isBrickspotterOnly }), ...(req.body.limitBrickspotterScans !== undefined && { limitBrickspotterScans: req.body.limitBrickspotterScans }), ...(req.body.limitBrickspotterApiCalls !== undefined && { limitBrickspotterApiCalls: req.body.limitBrickspotterApiCalls }) };
  const allowed = hasOrgs ? { status: req.body.status, name: req.body.name, sunsetAt: req.body.sunsetAt, isDefault: req.body.isDefault, isPublic: req.body.isPublic, ...bsFields } : req.body;
  if (allowed.sunsetAt !== undefined) allowed.sunsetAt = allowed.sunsetAt ? new Date(allowed.sunsetAt) : null;
  if (allowed.isDefault === true) await db.update(plans).set({ isDefault: false }).where(sql`id != ${id}`);
  const parsed = insertPlanSchema.partial().parse(allowed);
  const [updated] = await db.update(plans).set({ ...parsed, updatedAt: new Date() }).where(eq(plans.id, id)).returning();
  if (!updated) return res.status(404).json({ message: 'Plan not found' });
  res.json({ ...updated, locked: hasOrgs });
}));

router.delete("/platform-admin/plans/:id", isSuperAdmin, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  const [orgCount] = await db.select({ count: sql<number>`COUNT(*)::int` }).from(organizations).where(eq(organizations.planId, id));
  if (Number(orgCount.count) > 0) return res.status(409).json({ message: 'Cannot delete a plan with active organizations. Sunset it instead.' });
  await db.delete(plans).where(eq(plans.id, id));
  res.json({ success: true });
}));

router.get("/platform-admin/org-usage/:orgId", isSuperAdmin, asyncRoute(async (req: any, res) => {
  const { orgId } = req.params;
  const now = new Date();
  const plan = await getOrgActivePlan(orgId);
  const [orgInfo] = await db.select({ id: organizations.id, name: organizations.name, billingStartDate: organizations.billingStartDate }).from(organizations).where(eq(organizations.id, orgId)).limit(1);
  const periodStart = getBillingPeriodStart(orgInfo?.billingStartDate, now);
  const monthlySalesCents = await getOrgMonthlySalesCents(orgId, periodStart, now);
  const billing = calcSalesBilling(plan, monthlySalesCents);
  res.json({ orgId, orgName: orgInfo?.name || orgId, billingStartDate: orgInfo?.billingStartDate ? orgInfo.billingStartDate.toISOString() : null, period: { start: periodStart.toISOString(), end: now.toISOString() }, plan: { id: plan.id, name: plan.name, basePrice: plan.basePrice, salesPercentage: plan.salesPercentage, freeSalesThreshold: plan.freeSalesThreshold }, monthlySalesCents, billing });
}));

router.get("/platform-admin/all-orgs-usage", isSuperAdmin, asyncRoute(async (_req, res) => {
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
}));

// ── System Health ─────────────────────────────────────────────────────────────

router.get("/platform-admin/system-health", isSuperAdmin, asyncRoute(async (_req, res) => {
  const [orgCount] = await db.select({ count: count() }).from(organizations);
  const [userCount] = await db.select({ count: count() }).from(users);
  const [activeSubCount] = await db.select({ count: count() }).from(organizations).where(eq(organizations.subscriptionStatus, 'active'));
  const activeJobs = await db.select({ id: embeddingJobs.id, orgId: embeddingJobs.orgId, jobType: embeddingJobs.jobType, status: embeddingJobs.status, processedItems: embeddingJobs.processedItems, totalItems: embeddingJobs.totalItems, errorMessage: embeddingJobs.errorMessage, createdAt: embeddingJobs.createdAt, completedAt: embeddingJobs.completedAt }).from(embeddingJobs).where(sql`${embeddingJobs.status} IN ('pending', 'processing')`).orderBy(desc(embeddingJobs.createdAt)).limit(20);
  const recentJobs = await db.select({ id: embeddingJobs.id, orgId: embeddingJobs.orgId, jobType: embeddingJobs.jobType, status: embeddingJobs.status, processedItems: embeddingJobs.processedItems, totalItems: embeddingJobs.totalItems, errorMessage: embeddingJobs.errorMessage, createdAt: embeddingJobs.createdAt, completedAt: embeddingJobs.completedAt }).from(embeddingJobs).where(sql`${embeddingJobs.status} IN ('completed', 'failed')`).orderBy(desc(embeddingJobs.completedAt)).limit(10);
  const [invEmbCount] = await db.select({ count: count() }).from(inventoryEmbeddings);
  const [ordEmbCount] = await db.select({ count: count() }).from(orderEmbeddings);
  const [invTotalCount] = await db.select({ count: count() }).from(blInventory);
  const [ordTotalCount] = await db.select({ count: count() }).from(orders);
  const platformSyncIds = ['priceomatic_cache', 'universal_catalog_refresh', 'rebrickable_set_parts', 'forum_sync', 'catalog_detail_completion', 'catalog_scan', 'market_news_sync', 'business_intel_sync'];
  const syncJobs = await db.select({ id: syncMetadata.id, orgId: syncMetadata.orgId, lastSyncTime: syncMetadata.lastSyncTime, lastSyncStatus: syncMetadata.lastSyncStatus, recordsAdded: syncMetadata.recordsAdded, recordsUpdated: syncMetadata.recordsUpdated, errorMessage: syncMetadata.errorMessage, updatedAt: syncMetadata.updatedAt }).from(syncMetadata).where(inArray(syncMetadata.id, platformSyncIds)).orderBy(desc(syncMetadata.updatedAt));
  const [clipTotal] = await db.select({ count: count() }).from(blCatalogClipEmbeddings);
  const [catalogTotal] = await db.select({ count: count() }).from(blCatalog);
  const clipCatalogStatus = { embedded: Number(clipTotal?.count || 0), total: Number(catalogTotal?.count || 0) };
  const [pAppSettings] = await db.select().from(platformSettingsTable).limit(1);
  const detailFreshDays = pAppSettings?.catalogDetailFreshnessDays ?? 90;
  const priceFreshDays = (pAppSettings as any)?.pomFreshnessDays ?? 180;
  const catalogCoverageResult = await db.execute(sql`
    SELECT
      (SELECT COUNT(*) FROM bl_inventory) AS total_lots,
      (SELECT COUNT(*) FROM bl_inventory WHERE quantity > 0) AS in_stock_lots,
      (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i INNER JOIN bl_catalog c ON i.item_no = c.item_no AND i.item_type = c.item_type AND COALESCE(i.color_id, 0) = c.color_id WHERE c.item_name IS NOT NULL AND c.item_name != '') AS has_detail,
      (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i INNER JOIN bl_catalog c ON i.item_no = c.item_no AND i.item_type = c.item_type AND COALESCE(i.color_id, 0) = c.color_id WHERE c.item_name IS NOT NULL AND c.item_name != '' AND i.quantity > 0) AS has_detail_instock,
      (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i INNER JOIN bl_catalog c ON i.item_no = c.item_no AND i.item_type = c.item_type AND COALESCE(i.color_id, 0) = c.color_id WHERE c.item_name IS NOT NULL AND c.item_name != '' AND c.updated_at < NOW() - INTERVAL '1 day' * ${detailFreshDays}) AS stale_detail,
      (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i INNER JOIN bl_catalog c ON i.item_no = c.item_no AND i.item_type = c.item_type AND COALESCE(i.color_id, 0) = c.color_id WHERE c.item_name IS NOT NULL AND c.item_name != '' AND c.updated_at < NOW() - INTERVAL '1 day' * ${detailFreshDays} AND i.quantity > 0) AS stale_detail_instock,
      (SELECT COUNT(DISTINCT i.id) FROM bl_inventory i LEFT JOIN bl_catalog c ON i.item_no = c.item_no AND i.item_type = c.item_type AND COALESCE(i.color_id, 0) = c.color_id WHERE i.quantity > 0 AND c.item_no IS NULL) AS inventory_not_in_catalog
  `);
  const cc = catalogCoverageResult.rows[0] as any;
  const catalogCoverage: any = {
    totalLots: parseInt(cc?.total_lots || '0'), inStockLots: parseInt(cc?.in_stock_lots || '0'),
    detail: { has: parseInt(cc?.has_detail || '0'), hasInStock: parseInt(cc?.has_detail_instock || '0'), stale: parseInt(cc?.stale_detail || '0'), staleInStock: parseInt(cc?.stale_detail_instock || '0') },
    supply: { has: 0, hasInStock: 0, stale: 0, staleInStock: 0 },
    sold: { has: 0, hasInStock: 0, stale: 0, staleInStock: 0 },
    inventoryNotInCatalog: parseInt(cc?.inventory_not_in_catalog || '0'),
    apiBudget: { total: pAppSettings?.blApiCallLimit ?? 4900, pomPct: pAppSettings?.pomApiBudgetPct ?? 70, catalogDetailPct: pAppSettings?.catalogDetailApiBudgetPct ?? 20, used24h: 0 },
  };
  const twentyFourHoursAgoCov = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [apiUsageRow] = await db.select({ count: sql<number>`count(*)` }).from(blApiCalls).where(gte(blApiCalls.timestamp, twentyFourHoursAgoCov));
  catalogCoverage.apiBudget.used24h = Number(apiUsageRow?.count) || 0;
  const { getActiveBuild } = await import('../services/clip-search.js');
  const clipBuild = getActiveBuild();
  const { getUniversalCatalogState } = await import('../services/universal-clip-catalog.js');
  const ucWorker = getUniversalCatalogState();
  const schedulerConfig: Record<string, any> = {
    priceomatic_cache: { enabled: !!pAppSettings?.pomScheduleEnabled, schedule: pAppSettings?.pomSyncTime || '14:00', frequency: 'Daily', batchSize: pAppSettings?.pomScheduleBatchSize ?? 1500 },
    universal_catalog_refresh: { enabled: !!pAppSettings?.universalCatalogScheduleEnabled, schedule: `Every ${pAppSettings?.universalCatalogRefreshMonths ?? 1} month(s)`, frequency: `${pAppSettings?.universalCatalogRefreshMonths ?? 1}mo`, retryDays: pAppSettings?.universalCatalogRetryDays ?? 30, workerRunning: !!ucWorker?.running },
    rebrickable_set_parts: { enabled: !!pAppSettings?.rebrickableSetSyncEnabled, schedule: pAppSettings?.rebrickableSetSyncTime || '04:00', frequency: 'Monthly' },
    forum_sync: { enabled: !!pAppSettings?.forumSyncEnabled, schedule: `Every ${pAppSettings?.forumSyncFrequency ?? 60} min`, frequency: `${pAppSettings?.forumSyncFrequency ?? 60}min` },
    clip_catalog: { enabled: true, schedule: 'Auto-resume on restart', frequency: 'Continuous', workerRunning: !!clipBuild?.running },
    catalog_detail_completion: { enabled: !!pAppSettings?.catalogDetailEnabled, schedule: `Every ${pAppSettings?.catalogDetailFrequencyHours ?? 1}h`, frequency: `${pAppSettings?.catalogDetailFrequencyHours ?? 1}h`, batchSize: pAppSettings?.catalogDetailBatchSize ?? 500 },
    catalog_scan: { enabled: !!pAppSettings?.catalogScanEnabled, schedule: `Every ${pAppSettings?.catalogScanFrequencyHours ?? 2}h`, frequency: `${pAppSettings?.catalogScanFrequencyHours ?? 2}h`, zeroStockSkip: pAppSettings?.catalogScanZeroStockSkip !== false },
  };
  res.json({ platform: { totalOrganizations: orgCount.count, totalUsers: userCount.count, activeSubscriptions: activeSubCount.count }, embeddings: { inventoryEmbeddings: invEmbCount.count, inventoryTotal: invTotalCount.count, orderEmbeddings: ordEmbCount.count, orderTotal: ordTotalCount.count }, jobs: { active: activeJobs, recent: recentJobs }, syncJobs, clipCatalogStatus, schedulerConfig, catalogCoverage });
}));

// ── Schedulers ────────────────────────────────────────────────────────────────

router.post("/platform-admin/scheduler/:jobId/trigger", isSuperAdmin, asyncRoute(async (req, res) => {
  const { jobId } = req.params;
  switch (jobId) {
    case 'priceomatic_cache': {
      const { getPomIsRunning } = await import('../services/pom-scheduler.js');
      if (getPomIsRunning()) return res.status(409).json({ message: 'Price-o-Matic is already running' });
      const { syncPriceOMagicCache } = await import('../services/bricklink.js');
      const { syncLock } = await import('../services/sync-lock.js');
      if (syncLock.isBlockedFor('Price-o-Matic')) return res.status(409).json({ message: `Blocked by: ${syncLock.getBlockersFor('Price-o-Matic').join(', ')}` });
      const [settings] = await db.select().from(platformSettingsTable).limit(1);
      const batchSize = settings?.pomScheduleBatchSize ?? 1500;
      const { setPomIsRunning } = await import('../services/pom-scheduler.js');
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
      const { isUniversalImporting, getUniversalCatalogState, importFromRebrickable, retryStaleItems, startUniversalWorker } = await import('../services/universal-clip-catalog.js');
      if (isUniversalImporting() || getUniversalCatalogState()?.running) return res.status(409).json({ message: 'Universal Catalog is already running' });
      await db.insert(syncMetadata).values({ id: 'universal_catalog_refresh', orgId: PLATFORM_ORG_ID, lastSyncStatus: 'in_progress', lastSyncTime: new Date(), recordsAdded: 0, recordsUpdated: 0 }).onConflictDoUpdate({ target: syncMetadata.id, set: { lastSyncStatus: 'in_progress', lastSyncTime: new Date(), updatedAt: new Date(), errorMessage: null } });
      (async () => {
        try {
          const { imported } = await importFromRebrickable();
          const [settings] = await db.select().from(platformSettingsTable).limit(1);
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
      const { syncRebrickableSetParts, getRebrickableSyncIsRunning } = await import('../services/rebrickable.js');
      if (getRebrickableSyncIsRunning()) return res.status(409).json({ message: 'Rebrickable sync is already running' });
      syncRebrickableSetParts(false).catch((err: any) => { console.error('[Manual Rebrickable] Failed:', err.message); });
      return res.json({ message: 'Rebrickable set-parts sync triggered' });
    }
    case 'forum_sync': {
      const { triggerManualForumSync } = await import('../services/bl-forum-scheduler.js');
      const result = await triggerManualForumSync();
      if (!result.success) return res.status(409).json({ message: result.error || 'Forum sync failed' });
      return res.json({ message: 'Forum sync triggered' });
    }
    case 'market_news_sync': {
      const { triggerManualMarketNewsSync } = await import('../services/market-news-scheduler.js');
      const mnResult = await triggerManualMarketNewsSync();
      if (!mnResult.success) return res.status(409).json({ message: mnResult.error || 'Market news sync failed' });
      return res.json({ message: 'Market news sync triggered' });
    }
    case 'business_intel_sync': {
      const { triggerManualBusinessIntelSync } = await import('../services/business-intel-scheduler.js');
      const biResult = await triggerManualBusinessIntelSync();
      if (!biResult.success) return res.status(409).json({ message: biResult.error || 'Business intel sync failed' });
      return res.json({ message: 'Business intel sync triggered' });
    }
    case 'clip_catalog': {
      const { getActiveBuild, buildCatalogEmbeddings } = await import('../services/clip-search.js');
      if (getActiveBuild()?.running) return res.status(409).json({ message: 'CLIP Catalog build is already running' });
      const rows = await db.select({ itemNo: blInventory.itemNo, colorId: blInventory.colorId }).from(blInventory);
      const items = rows.map((r: any) => ({ itemNo: r.itemNo, colorId: Number(r.colorId), itemType: 'PART' }));
      buildCatalogEmbeddings(items, () => {}).catch((e: any) => { console.error('[Manual CLIP Build] Failed:', e.message); });
      return res.json({ message: 'CLIP Catalog build triggered' });
    }
    case 'catalog_scan': {
      const { getCatalogScanIsRunning, runCatalogScan } = await import('../services/catalog-scan-scheduler.js');
      if (getCatalogScanIsRunning()) return res.status(409).json({ message: 'Catalog Scan is already running' });
      runCatalogScan().catch((err: any) => { console.error('[Manual CatalogScan] Failed:', err.message); });
      return res.json({ message: 'Inventory Catalog Scan triggered' });
    }
    case 'catalog_detail_completion': {
      const { getCatalogDetailIsRunning, runCatalogDetailSync } = await import('../services/catalog-detail-scheduler.js');
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
}));

router.post("/platform-admin/scheduler/:jobId/toggle", isSuperAdmin, asyncRoute(async (req, res) => {
  const { jobId } = req.params;
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).json({ message: 'enabled (boolean) is required' });
  const settingMap: Record<string, string> = { priceomatic_cache: 'pomScheduleEnabled', catalog_detail_completion: 'catalogDetailEnabled', catalog_scan: 'catalogScanEnabled', universal_catalog_refresh: 'universalCatalogScheduleEnabled', rebrickable_set_parts: 'rebrickableSetSyncEnabled', forum_sync: 'forumSyncEnabled', business_intel_sync: 'businessIntelEnabled' };
  const column = settingMap[jobId];
  if (!column) {
    if (jobId === 'clip_catalog') {
      if (!enabled) { const { stopUniversalWorker } = await import('../services/universal-clip-catalog.js'); stopUniversalWorker(); }
      return res.json({ message: enabled ? 'CLIP Catalog will auto-resume' : 'CLIP worker stopped' });
    }
    return res.status(400).json({ message: `Unknown job: ${jobId}` });
  }
  await db.update(appSettings).set({ [column]: enabled, updatedAt: new Date() } as any).where(eq(appSettings.orgId, PLATFORM_ORG_ID));
  if (!enabled && jobId === 'universal_catalog_refresh') { const { stopUniversalWorker } = await import('../services/universal-clip-catalog.js'); stopUniversalWorker(); }
  res.json({ message: `${jobId} ${enabled ? 'enabled' : 'paused'}` });
}));

router.post("/platform-admin/org-sync-trigger/:orgId/:type", isSuperAdmin, asyncRoute(async (req, res) => {
  const { orgId, type } = req.params;
  if (!orgId || !['inventory', 'orders', 'channel'].includes(type)) return res.status(400).json({ message: 'Invalid orgId or type. type must be inventory | orders | channel' });
  if (type === 'inventory') {
    const { syncBricklinkData } = await import('../services/bricklink.js');
    syncBricklinkData(orgId).catch(e => console.error(`[Admin Trigger] Inventory sync failed for ${orgId}:`, e));
    return res.json({ message: `Inventory sync triggered for org ${orgId}` });
  }
  if (type === 'channel') {
    const { runChannelSyncForOrg } = await import('../services/channel-sync-scheduler.js');
    runChannelSyncForOrg(orgId).catch(e => console.error(`[Admin Trigger] Channel sync failed for ${orgId}:`, e));
    return res.json({ message: `Channel sync triggered for org ${orgId}` });
  }
  if (type === 'orders') {
    const syncSvcPath = '../services/order-sync-service' as string;
    const { syncOrdersForOrg } = await import(syncSvcPath).catch(() => ({ syncOrdersForOrg: null })) as any;
    if (syncOrdersForOrg) {
      syncOrdersForOrg(orgId).catch((e: any) => console.error(`[Admin Trigger] Orders sync failed for ${orgId}:`, e));
      return res.json({ message: `Orders sync triggered for org ${orgId}` });
    }
    return res.json({ message: 'Orders sync trigger not available — run from org context' });
  }
}));

// ── Business Intel + Agents ───────────────────────────────────────────────────

router.get("/business-intel", isAuthenticated, asyncRoute(async (req: any, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: 'No orgId' });
  const insights = await db.select().from(businessInsights).where(and(eq(businessInsights.orgId, orgId), eq(businessInsights.dismissed, false), or(isNull(businessInsights.expiresAt), sql`${businessInsights.expiresAt} > NOW()`))).orderBy(desc(businessInsights.createdAt)).limit(50);
  res.json(insights);
}));

router.post("/agents/trigger", isAuthenticated, asyncRoute(async (req: any, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: 'No orgId' });
  const { runAllAgents } = await import('../services/agent-team');
  runAllAgents(orgId).catch((err: any) => console.error(`[Agents] Background trigger failed for ${orgId}:`, err.message));
  res.json({ message: 'Agents triggered', orgId });
}));

router.post("/business-intel/:id/dismiss", isAuthenticated, asyncRoute(async (req: any, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: 'No orgId' });
  await db.update(businessInsights).set({ dismissed: true, updatedAt: new Date() }).where(and(eq(businessInsights.id, req.params.id), eq(businessInsights.orgId, orgId)));
  res.json({ message: 'Insight dismissed' });
}));

router.get("/ops/flash-report", isAuthenticated, asyncRoute(async (req: any, res) => {
  const orgId = req.user?.orgId;
  if (!orgId) return res.status(400).json({ message: 'No orgId' });
  const { getOpsFlashReports } = await import('../services/agent-team');
  const reports = await getOpsFlashReports(orgId);
  const [pSettings] = await db.select({ freq: platformSettingsTable.businessIntelFrequency, enabled: platformSettingsTable.businessIntelEnabled }).from(platformSettingsTable).where(eq(platformSettingsTable.id, 'platform')).limit(1);
  const [meta] = await db.select({ lastSyncTime: syncMetadata.lastSyncTime }).from(syncMetadata).where(eq(syncMetadata.id, 'business_intel_sync')).limit(1);
  const schedulerEnabled = pSettings?.enabled ?? false;
  const freqMs = ((pSettings?.freq ?? 360)) * 60 * 1000;
  const lastMs = meta?.lastSyncTime ? new Date(meta.lastSyncTime).getTime() : null;
  const schedulerNextRunAt = schedulerEnabled && lastMs ? new Date(lastMs + freqMs).toISOString() : null;
  res.json({ reports, schedulerNextRunAt, schedulerEnabled });
}));

// ── BL API Usage ──────────────────────────────────────────────────────────────

router.get("/platform-admin/bl-api-usage", isSuperAdmin, asyncRoute(async (_req, res) => {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [totalRow] = await db.select({ count: sql<number>`count(*)` }).from(blApiCalls).where(gte(blApiCalls.timestamp, twentyFourHoursAgo));
  const callsLast24h = Number(totalRow?.count) || 0;
  const hourlyRows = await db.select({ hourEpoch: sql<string>`EXTRACT(EPOCH FROM date_trunc('hour', ${blApiCalls.timestamp}))::bigint`, calls: sql<number>`count(*)` }).from(blApiCalls).where(gte(blApiCalls.timestamp, twentyFourHoursAgo)).groupBy(sql`date_trunc('hour', ${blApiCalls.timestamp})`).orderBy(sql`date_trunc('hour', ${blApiCalls.timestamp})`);
  const hourlyMap = new Map(hourlyRows.map(r => [Number(r.hourEpoch) * 1000, Number(r.calls)]));
  const hourlyBuckets: { hourStart: string; rollsOffAt: string; calls: number }[] = [];
  for (let i = 23; i >= 0; i--) {
    const slotStartMs = Math.floor(Date.now() / 3600000) * 3600000 - i * 3600000;
    hourlyBuckets.push({ hourStart: new Date(slotStartMs).toISOString(), rollsOffAt: new Date(slotStartMs + 24 * 60 * 60 * 1000).toISOString(), calls: hourlyMap.get(slotStartMs) ?? 0 });
  }
  const perOrgRows = await db.select({ orgId: blApiCalls.orgId, calls: sql<number>`count(*)` }).from(blApiCalls).where(gte(blApiCalls.timestamp, twentyFourHoursAgo)).groupBy(blApiCalls.orgId).orderBy(sql`count(*) DESC`).limit(20);
  const [totalAllTime] = await db.select({ count: sql<number>`count(*)` }).from(blApiCalls);
  const [successRow] = await db.select({ count: sql<number>`count(*)` }).from(blApiCalls).where(and(gte(blApiCalls.timestamp, twentyFourHoursAgo), eq(blApiCalls.success, true)));
  const [failRow] = await db.select({ count: sql<number>`count(*)` }).from(blApiCalls).where(and(gte(blApiCalls.timestamp, twentyFourHoursAgo), eq(blApiCalls.success, false)));
  const recentEndpoints = await db.select({ endpoint: blApiCalls.endpoint, calls: sql<number>`count(*)` }).from(blApiCalls).where(gte(blApiCalls.timestamp, twentyFourHoursAgo)).groupBy(blApiCalls.endpoint).orderBy(sql`count(*) DESC`).limit(10);
  const [ps] = await db.select({ blApiCallLimit: platformSettingsTable.blApiCallLimit }).from(platformSettingsTable).where(eq(platformSettingsTable.id, PLATFORM_ORG_ID)).limit(1).catch(() => [null]);
  res.json({ callsLast24h, totalAllTime: Number(totalAllTime?.count) || 0, successLast24h: Number(successRow?.count) || 0, failLast24h: Number(failRow?.count) || 0, hourlyBuckets, perOrg: perOrgRows.map(r => ({ orgId: r.orgId, calls: Number(r.calls) })), topEndpoints: recentEndpoints.map(r => ({ endpoint: r.endpoint, calls: Number(r.calls) })), ceiling: ps?.blApiCallLimit ?? 5000 });
}));

router.get("/platform-admin/customer-health/bl-api-breakdown", isSuperAdmin, asyncRoute(async (_req, res) => {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db.select({ orgId: blApiCalls.orgId, endpoint: blApiCalls.endpoint, success: blApiCalls.success, calls: sql<number>`count(*)` }).from(blApiCalls).where(gte(blApiCalls.timestamp, twentyFourHoursAgo)).groupBy(blApiCalls.orgId, blApiCalls.endpoint, blApiCalls.success);
  const orgMap = new Map<string, { orgId: string; orgName: string; total: number; inventory: number; orders: number; catalog: number; priceGuide: number; other: number; success: number; failed: number }>();
  for (const row of rows) {
    const oid = row.orgId || 'unknown';
    if (oid === 'platform') continue;
    if (!orgMap.has(oid)) orgMap.set(oid, { orgId: oid, orgName: '', total: 0, inventory: 0, orders: 0, catalog: 0, priceGuide: 0, other: 0, success: 0, failed: 0 });
    const entry = orgMap.get(oid)!;
    const c = Number(row.calls);
    entry.total += c;
    if (row.success) entry.success += c; else entry.failed += c;
    const ep = (row.endpoint || '').toLowerCase();
    if (ep.includes('/inventories') || ep.includes('/inventory')) entry.inventory += c;
    else if (ep.includes('/orders')) entry.orders += c;
    else if (ep.includes('/price_guide') || ep.includes('/price')) entry.priceGuide += c;
    else if (ep.includes('/items/') || ep.includes('/item_mapping') || ep.includes('/categories') || ep.includes('/colors')) entry.catalog += c;
    else entry.other += c;
  }
  const orgIds = Array.from(orgMap.keys());
  if (orgIds.length > 0) {
    const orgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(inArray(organizations.id, orgIds));
    for (const org of orgs) { const entry = orgMap.get(org.id); if (entry) entry.orgName = org.name; }
  }
  res.json(Array.from(orgMap.values()).sort((a, b) => b.total - a.total));
}));

// ── Server Logs ───────────────────────────────────────────────────────────────

router.get("/platform-admin/server-logs", isSuperAdmin, (_req, res) => {
  res.json(getRecentLogs(40));
});

router.delete("/platform-admin/server-logs", isSuperAdmin, (_req, res) => {
  clearLogs();
  res.json({ ok: true });
});

// ── DB Admin ──────────────────────────────────────────────────────────────────

router.get("/platform-admin/db-tables", isSuperAdmin, asyncRoute(async (_req, res) => {
  const TABLE_DESCRIPTIONS: Record<string, string> = {
    anomaly_events: 'Detected data anomalies and automated system alerts',
    app_feedback: 'User-submitted feedback, bug reports, and feature requests',
    app_settings: 'Per-organization configuration settings',
    bl_api_calls: 'BrickLink API call log used for rate limiting and usage tracking per org',
    bl_catalog: 'Shared cross-org part/color/category reference',
    bl_catalog_clip_embeddings: '512-dim CLIP visual fingerprints. Powers BrickSpotter visual recognition',
    bl_categories: 'BrickLink part category names and hierarchy',
    bl_colors: 'BrickLink color definitions',
    bl_forum_embeddings: 'Text embeddings of BrickLink forum posts',
    bl_forum_posts: 'Scraped BrickLink forum posts',
    bl_inventory: 'Live per-org BrickLink inventory',
    brickanalyzer_scans: 'BrickSpotter scan history',
    conversations: 'AI chat assistant conversation sessions per org',
    differential_batches: 'Incremental backup batch tracking',
    embedding_jobs: 'Async background job queue for text embedding generation',
    eod_forms: 'End-of-day summary forms',
    inventory_embeddings: 'Text embeddings of inventory items',
    inventory_locations: 'Physical warehouse bin assignments',
    order_adjustments: 'Manual price and quantity adjustments applied to orders',
    order_detail_embeddings: 'Text embeddings of individual order line items',
    order_details: 'Line items for each order',
    order_embeddings: 'Text embeddings of full orders',
    order_split_items: 'Parts assigned to split sub-orders',
    order_splits: 'Split sub-orders created from a parent order',
    orders: 'Orders synced from the marketplace',
    org_integrations: 'OAuth tokens and API credentials stored per organization',
    organizations: 'Tenant organizations on the platform',
    part_id_mappings: 'Cross-reference table mapping BrickLink to Rebrickable part numbers',
    part_price_history: 'Historical BrickLink price guide snapshots',
    picklist_items: 'Active pick queue',
    plan_configs: 'Subscription plan tier definitions',
    price_guide_cache: 'Cached BrickLink price guide data',
    restore_jobs: 'Database restore job tracking',
    sessions: 'User authentication sessions',
    set_part_embeddings: 'Text embeddings of set part lists',
    set_part_relationships: 'Rebrickable sets-to-parts mapping',
    shipments: 'Shipment records linked to orders',
    sync_issues: 'Detected issues during sync operations',
    sync_metadata: 'Per-org BrickLink sync state',
    universal_catalog_queue: 'Rebrickable parts queue for universal CLIP embedding',
    users: 'Platform user accounts',
    wh_aisles: 'Warehouse aisle definitions',
    wh_bins: 'Warehouse bin definitions',
    wh_shelves: 'Warehouse shelf definitions',
  };
  const rows = await db.execute<{ table_name: string; total_size: string; total_size_bytes: string; live_rows: string; dead_rows: string; last_vacuum: string | null; last_autovacuum: string | null; last_analyze: string | null; last_autoanalyze: string | null; seq_scans: string; idx_scans: string; mod_since_analyze: string }>(sql`
    SELECT t.table_name,
      pg_size_pretty(pg_total_relation_size(quote_ident(t.table_name))) AS total_size,
      pg_total_relation_size(quote_ident(t.table_name))::text AS total_size_bytes,
      COALESCE(s.n_live_tup, 0)::text AS live_rows, COALESCE(s.n_dead_tup, 0)::text AS dead_rows,
      s.last_vacuum::text, s.last_autovacuum::text, s.last_analyze::text, s.last_autoanalyze::text,
      COALESCE(s.seq_scan, 0)::text AS seq_scans, COALESCE(s.idx_scan, 0)::text AS idx_scans,
      COALESCE(s.n_mod_since_analyze, 0)::text AS mod_since_analyze
    FROM information_schema.tables t
    LEFT JOIN pg_stat_user_tables s ON s.relname = t.table_name
    WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    ORDER BY pg_total_relation_size(quote_ident(t.table_name)) DESC
  `);
  const tables = (rows.rows ?? []).map(r => ({ tableName: r.table_name, totalSize: r.total_size, totalSizeBytes: Number(r.total_size_bytes), liveRows: Number(r.live_rows), deadRows: Number(r.dead_rows), lastVacuum: r.last_vacuum ?? r.last_autovacuum ?? null, lastAnalyze: r.last_analyze ?? r.last_autoanalyze ?? null, seqScans: Number(r.seq_scans), idxScans: Number(r.idx_scans), modSinceAnalyze: Number(r.mod_since_analyze), description: TABLE_DESCRIPTIONS[r.table_name] ?? null }));
  res.json(tables);
}));

router.post("/platform-admin/db-vacuum", isSuperAdmin, asyncRoute(async (req, res) => {
  const { tables } = req.body as { tables?: string[] };
  if (!tables || !Array.isArray(tables) || tables.length === 0) return res.status(400).json({ message: 'tables array is required' });
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
}));

router.post("/platform-admin/db-cleanup", isSuperAdmin, asyncRoute(async (req, res) => {
  const { target, daysOld } = req.body as { target: string; daysOld?: number };
  const VALID_TARGETS = ['bl_api_calls', 'embedding_jobs', 'restore_jobs', 'sync_issues', 'price_guide_cache', 'sessions', 'brickanalyzer_scans', 'conversations', 'universal_catalog_queue'];
  if (!target || !VALID_TARGETS.includes(target)) return res.status(400).json({ message: `Invalid target. Allowed: ${VALID_TARGETS.join(', ')}` });
  const age = Math.max(0, Math.min(3650, Math.floor(Number(daysOld) || 30)));
  const cutoff = sql`NOW() - (${age} * INTERVAL '1 day')`;
  const deleteMap: Record<string, () => Promise<any>> = {
    bl_api_calls: () => db.execute(sql`DELETE FROM bl_api_calls WHERE timestamp < ${cutoff}`),
    embedding_jobs: () => db.execute(sql`DELETE FROM embedding_jobs WHERE status IN ('completed', 'failed') AND created_at < ${cutoff}`),
    restore_jobs: () => db.execute(sql`DELETE FROM restore_jobs WHERE status IN ('completed', 'failed') AND created_at < ${cutoff}`),
    sync_issues: () => db.execute(sql`DELETE FROM sync_issues WHERE created_at < ${cutoff}`),
    price_guide_cache: () => db.execute(sql`DELETE FROM price_guide_cache WHERE fetched_at < ${cutoff}`),
    sessions: () => db.execute(sql`DELETE FROM sessions WHERE expire < NOW()`),
    brickanalyzer_scans: () => db.execute(sql`DELETE FROM brickanalyzer_scans WHERE created_at < ${cutoff}`),
    conversations: () => db.execute(sql`DELETE FROM conversations WHERE updated_at < ${cutoff}`),
    universal_catalog_queue: () => db.execute(sql`DELETE FROM universal_catalog_queue WHERE status IN ('embedded', 'no_image', 'failed') AND attempted_at < ${cutoff}`),
  };
  const r = await deleteMap[target]();
  res.json({ results: [{ target, deleted: r.rowCount ?? 0 }] });
}));

router.post("/platform-admin/migrate-catalog", isSuperAdmin, asyncRoute(async (_req, res) => {
  await db.execute(sql`
    INSERT INTO bl_catalog (item_no, item_type, color_id, item_name, color_name, category_id, bl_catalog_weight, bl_dimension_x, bl_dimension_y, bl_dimension_z, image_url, thumbnail_url, updated_at)
    SELECT item_no, item_type, COALESCE(color_id, 0) AS color_id, MAX(item_name), MAX(color_name), MAX(category_id), MAX(bl_catalog_weight), MAX(bl_dimension_x), MAX(bl_dimension_y), MAX(bl_dimension_z), MAX(image_url), MAX(thumbnail_url), NOW()
    FROM bl_inventory WHERE item_no IS NOT NULL AND item_type IS NOT NULL GROUP BY item_no, item_type, COALESCE(color_id, 0)
    ON CONFLICT (item_no, item_type, color_id) DO UPDATE SET
      item_name = COALESCE(EXCLUDED.item_name, bl_catalog.item_name), color_name = COALESCE(EXCLUDED.color_name, bl_catalog.color_name),
      category_id = COALESCE(EXCLUDED.category_id, bl_catalog.category_id), bl_catalog_weight = COALESCE(EXCLUDED.bl_catalog_weight, bl_catalog.bl_catalog_weight),
      image_url = COALESCE(EXCLUDED.image_url, bl_catalog.image_url), thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, bl_catalog.thumbnail_url), updated_at = NOW()
  `);
  await db.execute(sql`
    UPDATE bl_catalog c SET year_released = COALESCE(c.year_released, pgc.year_released),
      bl_catalog_weight = COALESCE(c.bl_catalog_weight, CASE WHEN pgc.weight IS NOT NULL AND pgc.weight::numeric > 0 THEN pgc.weight ELSE NULL END),
      image_url = COALESCE(c.image_url, pgc.image_url), thumbnail_url = COALESCE(c.thumbnail_url, pgc.thumbnail_url), updated_at = NOW()
    FROM price_guide_cache pgc WHERE c.item_no = pgc.item_no AND c.item_type = pgc.item_type AND c.color_id = CASE WHEN pgc.color_id = -1 THEN 0 ELSE pgc.color_id END
  `);
  const [{ count: catalogCount }] = await db.execute(sql`SELECT COUNT(*) AS count FROM bl_catalog`) as any;
  const [{ count: withImages }] = await db.execute(sql`SELECT COUNT(*) AS count FROM bl_catalog WHERE image_url IS NOT NULL AND image_url != ''`) as any;
  res.json({ success: true, catalogRows: parseInt(catalogCount), rowsWithImages: parseInt(withImages) });
}));

// ── Platform Admin: Support Queue ─────────────────────────────────────────────

router.get("/platform-admin/support-queue/count", isSuperAdmin, asyncRoute(async (_req, res) => {
  const [result] = await db.select({ count: count() }).from(supportTickets).where(ne(supportTickets.status, 'resolved'));
  res.json({ count: result?.count || 0 });
}));

router.get("/platform-admin/support-queue/history", isSuperAdmin, asyncRoute(async (_req, res) => {
  const tickets = await db.select({ ticket: supportTickets, orgName: organizations.name }).from(supportTickets).leftJoin(organizations, eq(supportTickets.orgId, organizations.id)).where(eq(supportTickets.status, 'resolved')).orderBy(desc(supportTickets.resolvedAt)).limit(50);
  res.json(tickets.map(t => ({ ...t.ticket, orgName: t.orgName || 'Unknown' })));
}));

router.get("/platform-admin/support-queue", isSuperAdmin, asyncRoute(async (_req, res) => {
  const tickets = await db.select({ ticket: supportTickets, orgName: organizations.name }).from(supportTickets).leftJoin(organizations, eq(supportTickets.orgId, organizations.id)).where(ne(supportTickets.status, 'resolved')).orderBy(desc(supportTickets.createdAt));
  res.json(tickets.map(t => ({ ...t.ticket, orgName: t.orgName || 'Unknown' })));
}));

router.get("/platform-admin/support-queue/:ticketId/messages", isSuperAdmin, asyncRoute(async (req, res) => {
  const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, req.params.ticketId)).limit(1);
  if (!ticket) return res.status(404).json({ message: "Ticket not found" });
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, ticket.orgId)).limit(1);
  const ticketWithOrg = { ...ticket, orgName: org?.name || ticket.orgId };
  const recentBefore = await db.select().from(conversations).where(and(eq(conversations.orgId, ticket.orgId), eq(conversations.sessionId, ticket.sessionId), sql`${conversations.createdAt} <= ${ticket.createdAt}`)).orderBy(desc(conversations.createdAt)).limit(20);
  const afterEscalation = await db.select().from(conversations).where(and(eq(conversations.orgId, ticket.orgId), eq(conversations.sessionId, ticket.sessionId), sql`${conversations.createdAt} > ${ticket.createdAt}`)).orderBy(asc(conversations.createdAt));
  res.json({ ticket: ticketWithOrg, messages: [...recentBefore.reverse(), ...afterEscalation] });
}));

router.post("/platform-admin/support-queue/:ticketId/reply", isSuperAdmin, asyncRoute(async (req: any, res) => {
  const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, req.params.ticketId)).limit(1);
  if (!ticket) return res.status(404).json({ message: "Ticket not found" });
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ message: "content required" });
  const displayName = req.user?.email || 'Support Agent';
  await db.insert(conversations).values({ sessionId: ticket.sessionId, role: 'support', content: content.trim(), context: displayName, orgId: ticket.orgId });
  if (ticket.status === 'escalated') await db.update(supportTickets).set({ status: 'active', assignedTo: req.user?.id || null, updatedAt: new Date() }).where(eq(supportTickets.id, ticket.id));
  res.json({ success: true });
}));

router.patch("/platform-admin/support-queue/:ticketId/resolve", isSuperAdmin, asyncRoute(async (req, res) => {
  const [ticket] = await db.update(supportTickets).set({ status: 'resolved', resolvedAt: new Date(), updatedAt: new Date() }).where(eq(supportTickets.id, req.params.ticketId)).returning();
  if (!ticket) return res.status(404).json({ message: "Ticket not found" });
  await db.insert(conversations).values({ sessionId: ticket.sessionId, role: 'system', content: 'This support session has been resolved. You can continue chatting with E.L.F.I.E. as usual.', orgId: ticket.orgId });
  res.json(ticket);
}));

// ── Product Management ────────────────────────────────────────────────────────

router.get("/platform-admin/product/vision", isSuperAdmin, asyncRoute(async (_req, res) => {
  const [vision] = await db.select().from(productVision).limit(1);
  res.json(vision || { id: null, whatChanges: '', howIFeel: '', whatPeopleSay: '', visionStatement: '' });
}));

router.put("/platform-admin/product/vision", isSuperAdmin, asyncRoute(async (req, res) => {
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
}));

router.post("/platform-admin/product/vision/generate", isSuperAdmin, asyncRoute(async (req, res) => {
  const { whatChanges, howIFeel, whatPeopleSay } = req.body;
  if (!whatChanges && !howIFeel && !whatPeopleSay) return res.status(400).json({ message: 'Fill in at least one field before generating.' });
  const apiKey = await getPlatformOpenAIKey();
  if (!apiKey) return res.status(400).json({ message: 'OpenAI API key not configured.' });
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({ model: 'gpt-4o-mini', temperature: 0.7, max_tokens: 300, messages: [{ role: 'system', content: "You are a product strategist. Write a concise, inspiring product vision statement (2-4 sentences). Do not use bullet points or headers — just the statement." }, { role: 'user', content: `If we are successful, what changes?\n${whatChanges}\n\nIf we are successful, how do I feel?\n${howIFeel}\n\nIf we are successful, what are people saying?\n${whatPeopleSay}` }] });
  if (completion.usage) trackUsage({ service: 'openai', model: 'gpt-4o-mini', operation: 'product-vision-generate', inputTokens: completion.usage.prompt_tokens || 0, outputTokens: completion.usage.completion_tokens || 0, totalTokens: completion.usage.total_tokens || 0 });
  res.json({ visionStatement: completion.choices[0]?.message?.content?.trim() || '' });
}));

router.get("/platform-admin/product/okrs", isSuperAdmin, asyncRoute(async (_req, res) => {
  const okrs = await db.select().from(productOkrs).orderBy(desc(productOkrs.createdAt));
  const krs = await db.select().from(productKeyResults).orderBy(asc(productKeyResults.id));
  res.json(okrs.map(o => ({ ...o, keyResults: krs.filter(k => k.okrId === o.id) })));
}));

router.post("/platform-admin/product/okrs", isSuperAdmin, asyncRoute(async (req, res) => {
  const [okr] = await db.insert(productOkrs).values(insertProductOkrSchema.parse(req.body)).returning();
  res.json({ ...okr, keyResults: [] });
}));

router.patch("/platform-admin/product/okrs/:id", isSuperAdmin, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  const { title, timeframe, status } = req.body;
  const updates: any = {};
  if (title !== undefined) updates.title = title;
  if (timeframe !== undefined) updates.timeframe = timeframe;
  if (status !== undefined) updates.status = status;
  const [updated] = await db.update(productOkrs).set(updates).where(eq(productOkrs.id, id)).returning();
  res.json(updated);
}));

router.delete("/platform-admin/product/okrs/:id", isSuperAdmin, asyncRoute(async (req, res) => {
  await db.delete(productOkrs).where(eq(productOkrs.id, parseInt(req.params.id)));
  res.json({ ok: true });
}));

router.post("/platform-admin/product/key-results", isSuperAdmin, asyncRoute(async (req, res) => {
  const [kr] = await db.insert(productKeyResults).values(insertProductKeyResultSchema.parse(req.body)).returning();
  res.json(kr);
}));

router.patch("/platform-admin/product/key-results/:id", isSuperAdmin, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  const { title, progress } = req.body;
  const updates: any = {};
  if (title !== undefined) updates.title = title;
  if (progress !== undefined) updates.progress = Math.max(0, Math.min(100, progress));
  const [updated] = await db.update(productKeyResults).set(updates).where(eq(productKeyResults.id, id)).returning();
  res.json(updated);
}));

router.delete("/platform-admin/product/key-results/:id", isSuperAdmin, asyncRoute(async (req, res) => {
  await db.delete(productKeyResults).where(eq(productKeyResults.id, parseInt(req.params.id)));
  res.json({ ok: true });
}));

router.get("/platform-admin/product/roadmap", isSuperAdmin, asyncRoute(async (_req, res) => {
  res.json(await db.select().from(productRoadmapItems).orderBy(asc(productRoadmapItems.createdAt)));
}));

router.post("/platform-admin/product/roadmap", isSuperAdmin, asyncRoute(async (req, res) => {
  const [item] = await db.insert(productRoadmapItems).values(insertProductRoadmapItemSchema.parse(req.body)).returning();
  res.json(item);
}));

router.patch("/platform-admin/product/roadmap/:id", isSuperAdmin, asyncRoute(async (req, res) => {
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
}));

router.delete("/platform-admin/product/roadmap/:id", isSuperAdmin, asyncRoute(async (req, res) => {
  await db.delete(productRoadmapItems).where(eq(productRoadmapItems.id, parseInt(req.params.id)));
  res.json({ ok: true });
}));

router.get("/platform-admin/product/backlog", isSuperAdmin, asyncRoute(async (_req, res) => {
  res.json(await db.select().from(productBacklogItems).orderBy(desc(productBacklogItems.createdAt)));
}));

router.post("/platform-admin/product/backlog", isSuperAdmin, asyncRoute(async (req, res) => {
  const [item] = await db.insert(productBacklogItems).values(insertProductBacklogItemSchema.parse(req.body)).returning();
  res.json(item);
}));

router.patch("/platform-admin/product/backlog/:id", isSuperAdmin, asyncRoute(async (req, res) => {
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
}));

router.delete("/platform-admin/product/backlog/:id", isSuperAdmin, asyncRoute(async (req, res) => {
  await db.delete(productBacklogItems).where(eq(productBacklogItems.id, parseInt(req.params.id)));
  res.json({ ok: true });
}));

router.get("/platform-admin/product/capabilities", isSuperAdmin, asyncRoute(async (_req, res) => {
  res.json(await db.select().from(productCapabilities).orderBy(asc(productCapabilities.level), asc(productCapabilities.sortOrder)));
}));

router.post("/platform-admin/product/capabilities", isSuperAdmin, asyncRoute(async (req, res) => {
  const [cap] = await db.insert(productCapabilities).values(insertProductCapabilitySchema.parse(req.body)).returning();
  res.json(cap);
}));

router.patch("/platform-admin/product/capabilities/:id", isSuperAdmin, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  const { title, description, level, parentId, sortOrder, status, stage, featureKey } = req.body;
  const validStatuses = ['built', 'new', 'now', 'next', 'testing', 'later'];
  const validStages = ['none', 'alpha', 'beta', 'released'];
  const updates: any = {};
  if (title !== undefined) updates.title = title;
  if (description !== undefined) updates.description = description;
  if (level !== undefined) updates.level = level;
  if (parentId !== undefined) updates.parentId = parentId;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;
  if (status !== undefined && validStatuses.includes(status)) updates.status = status;
  if (stage !== undefined) {
    if (!validStages.includes(stage)) return res.status(400).json({ message: `Invalid stage. Must be one of: ${validStages.join(', ')}.` });
    updates.stage = stage;
  }
  if (featureKey !== undefined) {
    // Stable code-matched key; empty/whitespace clears the gate (roadmap entry only).
    const trimmed = typeof featureKey === 'string' ? featureKey.trim() : '';
    updates.featureKey = trimmed.length > 0 ? trimmed : null;
    // Stage only means anything when a key exists. Clearing the key must reset
    // the stage to 'none' so we never leave an orphaned gate (e.g. 'released')
    // on a keyless feature where the Stage control is no longer shown.
    if (updates.featureKey === null) updates.stage = 'none';
  }
  try {
    const [updated] = await db.update(productCapabilities).set(updates).where(eq(productCapabilities.id, id)).returning();
    res.json(updated);
  } catch (e: any) {
    if (e?.code === '23505') return res.status(409).json({ message: 'That feature key is already in use. Feature keys must be unique.' });
    throw e;
  }
}));

router.delete("/platform-admin/product/capabilities/:id", isSuperAdmin, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  const children = await db.select({ id: productCapabilities.id }).from(productCapabilities).where(eq(productCapabilities.parentId, id));
  const childIds = children.map(c => c.id);
  if (childIds.length > 0) {
    const grandchildren = await db.select({ id: productCapabilities.id }).from(productCapabilities).where(inArray(productCapabilities.parentId, childIds));
    const grandchildIds = grandchildren.map(c => c.id);
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
}));

// ── Feature visibility gates ──────────────────────────────────────────────────
// A code-catalog-driven control surface for who can SEE each gated feature.
// The effective stage of a feature is the database override (a product_capabilities
// row carrying its featureKey) when one exists, otherwise the code default in
// FEATURE_GATE_DEFAULTS. This works in every environment — a freshly published
// prod DB with no feature keys still shows the catalog defaults, and the super
// admin can change them here without hunting through the roadmap tree.

// Find (or lazily create) the L2 group that holds stage-override rows.
async function ensureFeatureGateGroupL2Id(): Promise<number> {
  let [l1] = await db.select().from(productCapabilities)
    .where(and(eq(productCapabilities.level, 1), eq(productCapabilities.title, 'Feature Gates'))).limit(1);
  if (!l1) {
    [l1] = await db.insert(productCapabilities)
      .values({ title: 'Feature Gates', description: 'Runtime feature visibility controls.', level: 1, parentId: null, sortOrder: 999, status: 'built', stage: 'none' })
      .returning();
  }
  let [l2] = await db.select().from(productCapabilities)
    .where(and(eq(productCapabilities.level, 2), eq(productCapabilities.parentId, l1.id))).limit(1);
  if (!l2) {
    [l2] = await db.insert(productCapabilities)
      .values({ title: 'Gated features', description: '', level: 2, parentId: l1.id, sortOrder: 0, status: 'built', stage: 'none' })
      .returning();
  }
  return l2.id;
}

router.get("/platform-admin/feature-gates", isSuperAdmin, asyncRoute(async (_req, res) => {
  const { FEATURE_GATE_DEFAULTS } = await import("../services/feature-gate");
  const rows = await db.select({ stage: productCapabilities.stage, featureKey: productCapabilities.featureKey })
    .from(productCapabilities).where(isNotNull(productCapabilities.featureKey));
  const dbByKey = new Map<string, string>();
  for (const r of rows) if (r.featureKey && r.stage && r.stage !== 'none') dbByKey.set(r.featureKey, r.stage);
  const gates = Object.entries(FEATURE_GATE_DEFAULTS).map(([key, def]) => ({
    key,
    title: def.title,
    description: def.description,
    group: def.group,
    stage: dbByKey.get(key) ?? def.stage,
    isOverridden: dbByKey.has(key),
  }));
  res.json(gates);
}));

router.patch("/platform-admin/feature-gates/:key", isSuperAdmin, asyncRoute(async (req, res) => {
  const { FEATURE_GATE_DEFAULTS } = await import("../services/feature-gate");
  const key = req.params.key;
  const { stage } = req.body;
  const validStages = ['alpha', 'beta', 'released'];
  if (!FEATURE_GATE_DEFAULTS[key]) return res.status(404).json({ message: 'Unknown feature key.' });
  if (!validStages.includes(stage)) return res.status(400).json({ message: `Invalid stage. Must be one of: ${validStages.join(', ')}.` });
  const def = FEATURE_GATE_DEFAULTS[key];
  const [existing] = await db.select().from(productCapabilities).where(eq(productCapabilities.featureKey, key)).limit(1);
  if (existing) {
    await db.update(productCapabilities).set({ stage }).where(eq(productCapabilities.id, existing.id));
  } else {
    const parentL2Id = await ensureFeatureGateGroupL2Id();
    try {
      await db.insert(productCapabilities).values({
        title: def.title, description: def.description, level: 3, parentId: parentL2Id,
        sortOrder: 0, status: 'built', stage, featureKey: key,
      });
    } catch (e: any) {
      // Lost a race to another writer creating the same keyed row — fall back to update.
      if (e?.code === '23505') {
        await db.update(productCapabilities).set({ stage }).where(eq(productCapabilities.featureKey, key));
      } else {
        throw e;
      }
    }
  }
  res.json({ ok: true, key, stage });
}));

// ── Feature Requests + Public Roadmap ────────────────────────────────────────

router.post("/feature-request/rephrase", isAuthenticated, asyncRoute(async (_req, res) => {
  const { description } = _req.body;
  if (!description || typeof description !== 'string' || description.trim().length < 5) return res.status(400).json({ message: 'Please describe the feature you want.' });
  const apiKey = await getPlatformOpenAIKey();
  if (!apiKey) return res.status(503).json({ message: 'AI service not configured.' });
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: "You are a product manager for E.L.F.I.E., a LEGO/BrickLink inventory management SaaS. Rephrase the user's feature request into a clear, concise, well-written product feature description (1-2 sentences max). Return ONLY the rephrased feature text." }, { role: 'user', content: description }], max_tokens: 200, temperature: 0.3 });
  if (completion.usage) trackUsage({ service: 'openai', model: 'gpt-4o-mini', operation: 'feature-request-rephrase', inputTokens: completion.usage.prompt_tokens || 0, outputTokens: completion.usage.completion_tokens || 0, totalTokens: completion.usage.total_tokens || 0 });
  res.json({ rephrased: completion.choices[0]?.message?.content?.trim() || description });
}));

router.post("/feature-request/submit", isAuthenticated, asyncRoute(async (req: any, res) => {
  const { feature } = req.body;
  if (!feature || typeof feature !== 'string' || feature.trim().length < 5) return res.status(400).json({ message: 'Feature description is required.' });
  const allCaps = await db.select().from(productCapabilities).orderBy(asc(productCapabilities.level), asc(productCapabilities.sortOrder));
  const l2Caps = allCaps.filter(c => c.level === 2);
  let assignedParentId: number | null = null;
  let assignedL2Name = 'General';
  if (l2Caps.length > 0) {
    const apiKey = await getPlatformOpenAIKey();
    if (apiKey) {
      const openai = new OpenAI({ apiKey });
      const l2List = l2Caps.map(c => `ID:${c.id} "${c.title}"`).join(', ');
      const completion = await openai.chat.completions.create({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: `Classify into a product capability category. Available L2 categories: ${l2List}. Return ONLY the numeric ID of the best-matching category. If none fit well, return 0.` }, { role: 'user', content: feature }], max_tokens: 10, temperature: 0 });
      if (completion.usage) trackUsage({ service: 'openai', model: 'gpt-4o-mini', operation: 'feature-request-classify', inputTokens: completion.usage.prompt_tokens || 0, outputTokens: completion.usage.completion_tokens || 0, totalTokens: completion.usage.total_tokens || 0 });
      const idStr = completion.choices[0]?.message?.content?.trim() || '0';
      const idMatch = idStr.match(/\d+/);
      const parsedId = idMatch ? parseInt(idMatch[0], 10) : 0;
      const matched = l2Caps.find(c => c.id === parsedId);
      if (matched) { assignedParentId = matched.id; assignedL2Name = matched.title; }
    }
  }
  if (!assignedParentId && l2Caps.length > 0) { assignedParentId = l2Caps[0].id; assignedL2Name = l2Caps[0].title; }
  const maxSort = allCaps.filter(c => c.level === 3 && c.parentId === assignedParentId).reduce((mx, c) => Math.max(mx, c.sortOrder), 0);
  const [newCap] = await db.insert(productCapabilities).values({ title: feature.trim(), description: '', level: 3, parentId: assignedParentId, sortOrder: maxSort + 1, status: 'new' }).returning();
  res.json({ capability: newCap, l2Name: assignedL2Name });
}));

router.get("/public-roadmap", isAuthenticated, asyncRoute(async (req: any, res) => {
  const userId = (req.user as any)?.id || (req.user as any)?.claims?.sub || '';
  const statusFilter = req.query.status as string | undefined;
  const allCaps = await db.select().from(productCapabilities).orderBy(asc(productCapabilities.level), asc(productCapabilities.sortOrder));
  const voteCounts = await db.select({ capabilityId: featureVotes.capabilityId, votes: count() }).from(featureVotes).groupBy(featureVotes.capabilityId);
  const voteMap = new Map(voteCounts.map(v => [v.capabilityId, Number(v.votes)]));
  let userVotes: number[] = [];
  if (userId) {
    const uv = await db.select({ capabilityId: featureVotes.capabilityId }).from(featureVotes).where(eq(featureVotes.userId, userId));
    userVotes = uv.map(v => v.capabilityId);
  }
  let features = allCaps.filter(c => c.level === 3);
  if (statusFilter && statusFilter !== 'all') features = features.filter(c => c.status === statusFilter);
  const l2s = allCaps.filter(c => c.level === 2);
  const l1s = allCaps.filter(c => c.level === 1);
  const enriched = features.map(f => ({ id: f.id, title: f.title, description: f.description, status: f.status, parentId: f.parentId, l2Name: l2s.find(l => l.id === f.parentId)?.title || '', l1Name: (() => { const l2 = l2s.find(l => l.id === f.parentId); return l2 ? (l1s.find(l => l.id === l2.parentId)?.title || '') : ''; })(), votes: voteMap.get(f.id) || 0, userVoted: userVotes.includes(f.id) }));
  enriched.sort((a, b) => b.votes - a.votes);
  res.json(enriched);
}));

// ── Feature Staging (alpha/beta/released) ────────────────────────────────────
// Returns the feature keys visible to the current user/org plus the beta-stage
// features available to opt into (with vote counts) for the Beta Features panel.
router.get("/features", isApproved, asyncRoute(async (req: any, res) => {
  const { getVisibleFeatures } = await import("../services/feature-gate");
  res.json(await getVisibleFeatures(req));
}));

// Example gated endpoint — proves server-side enforcement end-to-end for one key.
router.get("/features/example-insight", isApproved, asyncRoute(async (req: any, res) => {
  const { canSeeFeature } = await import("../services/feature-gate");
  if (!(await canSeeFeature(req, 'beta_demo'))) {
    return res.status(403).json({ message: 'This feature is not available for your organization yet.' });
  }
  res.json({ message: "Beta demo is live for your organization.", generatedAt: new Date().toISOString() });
}));

router.get("/feature-votes/counts", isAuthenticated, asyncRoute(async (_req, res) => {
  const voteCounts = await db.select({ capabilityId: featureVotes.capabilityId, votes: count() }).from(featureVotes).groupBy(featureVotes.capabilityId);
  const map: Record<number, number> = {};
  voteCounts.forEach(v => { map[v.capabilityId] = Number(v.votes); });
  res.json(map);
}));

router.post("/feature-votes/:capabilityId", isAuthenticated, asyncRoute(async (req: any, res) => {
  const userId = (req.user as any)?.id || (req.user as any)?.claims?.sub || '';
  const orgId = reqOrgId(req);
  const capabilityId = parseInt(req.params.capabilityId, 10);
  if (!capabilityId || isNaN(capabilityId)) return res.status(400).json({ message: 'Invalid capability ID' });
  const [cap] = await db.select().from(productCapabilities).where(eq(productCapabilities.id, capabilityId)).limit(1);
  if (!cap || cap.level !== 3) return res.status(404).json({ message: 'Feature not found' });
  const [existing] = await db.select().from(featureVotes).where(and(eq(featureVotes.capabilityId, capabilityId), eq(featureVotes.userId, userId))).limit(1);
  if (existing) {
    await db.delete(featureVotes).where(eq(featureVotes.id, existing.id));
    const [{ votes }] = await db.select({ votes: count() }).from(featureVotes).where(eq(featureVotes.capabilityId, capabilityId));
    return res.json({ voted: false, votes: Number(votes) });
  }
  await db.insert(featureVotes).values({ capabilityId, userId, orgId });
  const [{ votes }] = await db.select({ votes: count() }).from(featureVotes).where(eq(featureVotes.capabilityId, capabilityId));
  res.json({ voted: true, votes: Number(votes) });
}));

export default router;
