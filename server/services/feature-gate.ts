import { eq, count, inArray, isNotNull, and } from "drizzle-orm";
import { db } from "../db";
import { productCapabilities, featureVotes, appSettings } from "@shared/schema";
import { storage } from "../storage";
import { reqOrgId } from "../lib/routeHelpers";

export type Stage = 'none' | 'alpha' | 'beta' | 'released';

export interface BetaFeatureInfo {
  key: string;
  title: string;
  description: string;
  votes: number;
  enabled: boolean; // whether the current org has opted in
}

export interface VisibleFeatures {
  visible: string[];        // feature keys the current user/org can see right now
  beta: BetaFeatureInfo[];  // beta-stage features available to opt into (for the Beta Features panel)
}

/**
 * Resolve whether the current request's user is a PlanetBrick super admin.
 * Fast path uses the session flag; falls back to a DB lookup if the session is stale.
 */
async function resolveSuperAdmin(req: any): Promise<boolean> {
  const sessionUser = req?.user as any;
  if (sessionUser?.superAdmin === true) return true;
  try {
    const userId = sessionUser?.id;
    if (userId) {
      const dbUser = await storage.getUser(userId);
      return !!dbUser?.superAdmin;
    }
  } catch {
    // ignore — treat as non-super-admin
  }
  return false;
}

/** Read the org's opted-in beta feature keys. */
async function getOrgBetaOptIns(orgId: string): Promise<Set<string>> {
  const [row] = await db.select({ betaFeatures: appSettings.betaFeatures })
    .from(appSettings).where(eq(appSettings.id, orgId)).limit(1);
  return new Set((row?.betaFeatures ?? []).filter(Boolean) as string[]);
}

/**
 * Compute the set of feature keys visible to the current user/org plus the list of
 * beta-stage features available to opt into.
 *
 * Visibility rules by capability stage:
 *  - released → everyone
 *  - alpha    → super admins only
 *  - beta     → super admins, or orgs that have opted in
 *  - none     → never gated here (roadmap entry only)
 */
export async function getVisibleFeatures(req: any): Promise<VisibleFeatures> {
  const orgId = reqOrgId(req);
  const isSuper = await resolveSuperAdmin(req);

  // Only capabilities with a real featureKey participate in runtime gating.
  const caps = await db.select({
    id: productCapabilities.id,
    title: productCapabilities.title,
    description: productCapabilities.description,
    stage: productCapabilities.stage,
    featureKey: productCapabilities.featureKey,
  }).from(productCapabilities).where(isNotNull(productCapabilities.featureKey));

  const gated = caps.filter(c => !!c.featureKey && c.stage !== 'none');
  const optIns = await getOrgBetaOptIns(orgId);

  const visible: string[] = [];
  for (const c of gated) {
    const key = c.featureKey as string;
    if (c.stage === 'released') visible.push(key);
    else if (c.stage === 'alpha') { if (isSuper) visible.push(key); }
    else if (c.stage === 'beta') { if (isSuper || optIns.has(key)) visible.push(key); }
  }

  // Beta-stage features for the opt-in panel, with vote counts.
  const betaCaps = gated.filter(c => c.stage === 'beta');
  let voteMap = new Map<number, number>();
  if (betaCaps.length > 0) {
    const ids = betaCaps.map(c => c.id);
    const voteRows = await db.select({ capabilityId: featureVotes.capabilityId, votes: count() })
      .from(featureVotes).where(inArray(featureVotes.capabilityId, ids))
      .groupBy(featureVotes.capabilityId);
    voteMap = new Map(voteRows.map(v => [v.capabilityId, Number(v.votes)]));
  }

  const beta: BetaFeatureInfo[] = betaCaps.map(c => ({
    key: c.featureKey as string,
    title: c.title,
    description: c.description ?? '',
    votes: voteMap.get(c.id) ?? 0,
    enabled: optIns.has(c.featureKey as string),
  }));

  return { visible: Array.from(new Set(visible)), beta };
}

/** Guard helper for feature-specific routes. Returns true if the request may access `key`. */
export async function canSeeFeature(req: any, key: string): Promise<boolean> {
  const { visible } = await getVisibleFeatures(req);
  return visible.includes(key);
}
