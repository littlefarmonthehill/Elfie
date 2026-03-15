import { db } from "../db";
import { planConfigs, organizations } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { TIER_CONFIG, type PlanType } from "@shared/tierConfig";
import type { PlanConfig } from "@shared/schema";

// ── In-memory cache ────────────────────────────────────────────────────────────
let cache: PlanConfig[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export function invalidatePlanCache() {
  cache = null;
  cacheTime = 0;
}

// ── Seed from static tierConfig.ts if table is empty ──────────────────────────
export async function seedPlanConfigsIfEmpty() {
  const existing = await db.select({ id: planConfigs.id }).from(planConfigs).limit(1);
  if (existing.length > 0) return;

  const seeds = [
    { planKey: 'trial', sortOrder: 0, config: TIER_CONFIG.trial },
    { planKey: 'foundation', sortOrder: 1, config: TIER_CONFIG.foundation },
    { planKey: 'core', sortOrder: 2, config: TIER_CONFIG.core },
    { planKey: 'flagship', sortOrder: 3, config: TIER_CONFIG.flagship },
  ];

  for (const { planKey, sortOrder, config } of seeds) {
    await db.insert(planConfigs).values({
      planKey,
      name: config.name,
      tagline: config.tagline,
      trialDurationDays: config.trialDurationDays ?? 0,
      priceMonthly: config.pricing.monthly,
      priceAnnual: config.pricing.annual,
      priceAnnualMonthly: config.pricing.annualMonthly,
      limitSeats: config.limits.seats,
      limitScans: config.limits.brickspotterScansPerMonth,
      limitAutomationRules: config.limits.automationRules,
      limitOrderHistoryDays: config.limits.orderHistoryDays,
      limitInventoryItems: config.limits.inventoryItems,
      limitOrders: config.limits.orders,
      limitElfieQueries: config.limits.elfieQueries,
      limitBusinessIntel: config.limits.businessIntel,
      featureBrickOwl: config.features.brickOwl,
      featureElfieAi: config.features.elfieAiMode,
      featurePriceOMatic: config.features.priceOMatic,
      featureEasypost: config.features.easypostAutomation,
      featureDataImages: config.features.dataEnrichmentImages,
      featureDataSemantic: config.features.dataEnrichmentSemantic,
      featureFullEnrichment: config.features.fullDataEnrichment,
      featurePaymentSync: config.features.paymentSync,
      isSunset: false,
      sortOrder,
    }).onConflictDoNothing();
  }

  console.log("[planConfigService] Seeded 4 plan configs from static tierConfig");
}

// ── Read all plan configs (cached) ────────────────────────────────────────────
export async function getAllPlanConfigs(): Promise<PlanConfig[]> {
  if (cache && Date.now() - cacheTime < CACHE_TTL) return cache;
  const rows = await db.select().from(planConfigs).orderBy(planConfigs.sortOrder);
  cache = rows;
  cacheTime = Date.now();
  return rows;
}

// ── Read a single plan config by key ──────────────────────────────────────────
export async function getPlanConfigByKey(planKey: string): Promise<PlanConfig | null> {
  const configs = await getAllPlanConfigs();
  return configs.find(c => c.planKey === planKey) ?? null;
}

// ── Get all plan configs + org count per plan ─────────────────────────────────
export type PlanConfigWithCount = PlanConfig & { orgCount: number };

export async function getAllPlanConfigsWithCounts(): Promise<PlanConfigWithCount[]> {
  const configs = await getAllPlanConfigs();

  const counts = await db
    .select({ plan: organizations.plan, count: sql<number>`count(*)::int` })
    .from(organizations)
    .groupBy(organizations.plan);

  const countMap: Record<string, number> = {};
  for (const row of counts) {
    countMap[row.plan] = row.count;
  }

  return configs.map(c => ({ ...c, orgCount: countMap[c.planKey] ?? 0 }));
}

// ── Update a plan config (only if no orgs on it) ──────────────────────────────
export type PlanUpdateFields = Partial<Omit<PlanConfig, 'id' | 'planKey' | 'sortOrder' | 'updatedAt' | 'isSunset'>>;

export async function updatePlanConfig(planKey: string, fields: PlanUpdateFields): Promise<{ success: boolean; error?: string; plan?: PlanConfig }> {
  const orgCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(organizations)
    .where(eq(organizations.plan, planKey));
  const orgCount = orgCountResult[0]?.count ?? 0;

  if (orgCount > 0) {
    return { success: false, error: `This plan has ${orgCount} active org${orgCount === 1 ? '' : 's'} — config is locked. Sunset the plan instead.` };
  }

  const [updated] = await db
    .update(planConfigs)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(planConfigs.planKey, planKey))
    .returning();

  invalidatePlanCache();
  return { success: true, plan: updated };
}

// ── Toggle sunset flag (always allowed, even with orgs on it) ─────────────────
export async function setPlanSunset(planKey: string, isSunset: boolean): Promise<PlanConfig | null> {
  const [updated] = await db
    .update(planConfigs)
    .set({ isSunset, updatedAt: new Date() })
    .where(eq(planConfigs.planKey, planKey))
    .returning();

  invalidatePlanCache();
  return updated ?? null;
}

// ── Convert DB plan config to the shape tierEnforcement expects ───────────────
export function dbPlanToLimits(plan: PlanConfig) {
  return {
    seats: plan.limitSeats,
    brickspotterScansPerMonth: plan.limitScans,
    automationRules: plan.limitAutomationRules,
    orderHistoryDays: plan.limitOrderHistoryDays,
    inventoryItems: plan.limitInventoryItems,
    orders: plan.limitOrders,
    elfieQueries: plan.limitElfieQueries,
    businessIntel: plan.limitBusinessIntel,
  };
}

export function dbPlanToFeatures(plan: PlanConfig) {
  return {
    brickOwl: plan.featureBrickOwl,
    elfieAiMode: plan.featureElfieAi,
    priceOMatic: plan.featurePriceOMatic,
    easypostAutomation: plan.featureEasypost,
    dataEnrichmentImages: plan.featureDataImages,
    dataEnrichmentSemantic: plan.featureDataSemantic,
    fullDataEnrichment: plan.featureFullEnrichment,
    paymentSync: plan.featurePaymentSync,
  };
}
