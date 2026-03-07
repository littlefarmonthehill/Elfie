import { db } from "../db";
import { organizations, users, picklistItems } from "@shared/schema";
import { eq, sql, count } from "drizzle-orm";
import { TIER_CONFIG, getEffectiveLimits, checkLimit, type TierFeatures } from "@shared/tierConfig";

export async function getOrgWithLimits(orgId: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org) return null;

  const limits = getEffectiveLimits(org);
  return { ...org, limits };
}

export async function checkBrickspotterLimit(orgId: string) {
  const orgWithLimits = await getOrgWithLimits(orgId);
  if (!orgWithLimits) return { allowed: false, message: "Organization not found" };

  const { brickspotterScansThisMonth, brickspotterScansResetDate, limits } = orgWithLimits;

  // Reset monthly counter if reset date is > 30 days ago
  const now = new Date();
  const resetDate = new Date(brickspotterScansResetDate);
  const diffDays = Math.floor((now.getTime() - resetDate.getTime()) / (1000 * 60 * 60 * 24));

  let currentScans = brickspotterScansThisMonth;
  if (diffDays >= 30) {
    currentScans = 0;
    await db
      .update(organizations)
      .set({
        brickspotterScansThisMonth: 0,
        brickspotterScansResetDate: now,
      })
      .where(eq(organizations.id, orgId));
  }

  const result = checkLimit(currentScans, limits.brickspotterScansPerMonth, "BrickSpotter scans");
  return {
    ...result,
    scansUsed: currentScans,
    scansLimit: limits.brickspotterScansPerMonth,
  };
}

export async function incrementBrickspotterScan(orgId: string) {
  await db
    .update(organizations)
    .set({
      brickspotterScansThisMonth: sql`brickspotter_scans_this_month + 1`,
    })
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

  return {
    ...result,
    current: currentSeats,
    limit: orgWithLimits.limits.seats,
  };
}

export async function checkAutomationLimit(orgId: string) {
  const orgWithLimits = await getOrgWithLimits(orgId);
  if (!orgWithLimits) return { allowed: false, message: "Organization not found" };

  // Placeholder for automation rules count - assuming a table exists or using a sub-query if they are in appSettings
  // For now, let's assume we count something representing 'automation rules'
  // If no specific table exists yet, return unlimited for now or 0
  const currentRules = 0; // TODO: Implement real count if/when automation rules table exists
  
  const result = checkLimit(currentRules, orgWithLimits.limits.automationRules, "automation rules");
  return {
    ...result,
    current: currentRules,
    limit: orgWithLimits.limits.automationRules,
  };
}

export async function isFeatureAllowed(orgId: string, feature: keyof TierFeatures) {
  const [org] = await db
    .select({ plan: organizations.plan })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org) return false;
  
  const tier = TIER_CONFIG[org.plan as keyof typeof TIER_CONFIG] || TIER_CONFIG.foundation;
  return tier.features[feature] === true;
}
