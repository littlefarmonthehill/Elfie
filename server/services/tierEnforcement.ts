import { db } from "../db";
import { organizations, users } from "@shared/schema";
import { eq, sql, count } from "drizzle-orm";
import { checkLimit, type TierFeatures } from "@shared/tierConfig";

export async function getOrgWithLimits(orgId: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org) return null;

  const isCore = org.plan !== 'trial';
  const limits = {
    seats: org.seatLimitOverride ?? (isCore ? -1 : 1),
    brickspotterScansPerMonth: org.brickspotterLimitOverride ?? (isCore ? -1 : 10),
    automationRules: org.automationLimitOverride ?? (isCore ? -1 : 0),
    orderHistoryDays: isCore ? -1 : 14,
    inventoryItems: isCore ? -1 : 500,
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

export async function isFeatureAllowed(orgId: string, feature: keyof TierFeatures): Promise<boolean> {
  const [org] = await db
    .select({ plan: organizations.plan })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  if (!org) return false;
  if (org.plan === 'trial') {
    const trialFeatures: Record<keyof TierFeatures, boolean> = {
      brickOwl: false,
      elfieAiMode: true,
      elfieCustom: false,
      elfieLiveSupport: false,
      priceOMatic: false,
      easypostAutomation: false,
      dataEnrichmentImages: true,
      dataEnrichmentSemantic: false,
      fullDataEnrichment: false,
      paymentSync: false,
    };
    return trialFeatures[feature] ?? false;
  }
  return true;
}
