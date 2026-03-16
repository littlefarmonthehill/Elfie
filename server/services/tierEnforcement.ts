import { db } from "../db";
import { organizations, users, picklistItems } from "@shared/schema";
import { eq, sql, count } from "drizzle-orm";
import { checkLimit, type TierFeatures } from "@shared/tierConfig";
import { getPlanConfigByKey, dbPlanToLimits, dbPlanToFeatures } from "./planConfigService";

export async function getOrgWithLimits(orgId: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org) return null;

  const planCfg = await getPlanConfigByKey(org.plan);
  const baseLimits = planCfg ? dbPlanToLimits(planCfg) : {
    seats: 1, brickspotterScansPerMonth: 0, automationRules: 0,
    orderHistoryDays: 30, inventoryItems: 100,
  };

  const limits = {
    seats: org.seatLimitOverride ?? baseLimits.seats,
    brickspotterScansPerMonth: org.brickspotterLimitOverride ?? baseLimits.brickspotterScansPerMonth,
    automationRules: org.automationLimitOverride ?? baseLimits.automationRules,
    orderHistoryDays: baseLimits.orderHistoryDays,
    inventoryItems: baseLimits.inventoryItems,
  };

  return { ...org, limits };
}

export async function checkBrickspotterLimit(orgId: string) {
  const orgWithLimits = await getOrgWithLimits(orgId);
  if (!orgWithLimits) return { allowed: false, message: "Organization not found" };

  const { brickspotterScansThisMonth, brickspotterScansResetDate, limits } = orgWithLimits;

  const now = new Date();
  const resetDate = new Date(brickspotterScansResetDate);
  const diffDays = Math.floor((now.getTime() - resetDate.getTime()) / (1000 * 60 * 60 * 24));

  let currentScans = brickspotterScansThisMonth;
  if (diffDays >= 30) {
    currentScans = 0;
    await db
      .update(organizations)
      .set({ brickspotterScansThisMonth: 0, brickspotterScansResetDate: now })
      .where(eq(organizations.id, orgId));
  }

  const result = checkLimit(currentScans, limits.brickspotterScansPerMonth, "BrickSpotter scans");
  return { ...result, scansUsed: currentScans, scansLimit: limits.brickspotterScansPerMonth };
}

export async function incrementBrickspotterScan(orgId: string) {
  await db
    .update(organizations)
    .set({ brickspotterScansThisMonth: sql`brickspotter_scans_this_month + 1` })
    .where(eq(organizations.id, orgId));
}

export async function checkSeatLimit(orgId: string) {
  const orgWithLimits = await getOrgWithLimits(orgId);
  if (!orgWithLimits) return { allowed: false, message: "Organization not found" };

  const [userCountResult] = await db
    .select({ count: count() })
    .from(users)
    .where(eq(users.orgId, orgId));

  const currentSeats = userCountResult.count;
  const result = checkLimit(currentSeats, orgWithLimits.limits.seats, "team seats");

  return { ...result, current: currentSeats, limit: orgWithLimits.limits.seats };
}

export async function checkAutomationLimit(orgId: string) {
  const orgWithLimits = await getOrgWithLimits(orgId);
  if (!orgWithLimits) return { allowed: false, message: "Organization not found" };

  const currentRules = 0;
  const result = checkLimit(currentRules, orgWithLimits.limits.automationRules, "automation rules");
  return { ...result, current: currentRules, limit: orgWithLimits.limits.automationRules };
}

export async function isFeatureAllowed(orgId: string, feature: keyof TierFeatures) {
  const [org] = await db
    .select({ plan: organizations.plan })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org) return false;

  const planCfg = await getPlanConfigByKey(org.plan);
  if (!planCfg) return false;

  const features = dbPlanToFeatures(planCfg);
  return features[feature] === true;
}
