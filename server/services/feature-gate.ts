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
  stages: Record<string, Stage>; // visible feature key -> maturity stage (drives in-context stage badges)
  catalog: Record<string, Stage>; // EVERY gated feature key -> effective stage, regardless of visibility (drives onboarding stage-awareness)
}

/**
 * Canonical, code-level catalog of every gated feature and its DEFAULT release
 * stage. This is the source of truth that ships with the build, so gating
 * behaves identically in every environment (dev, and a freshly published prod
 * DB that has no feature keys set yet). A roadmap row in the database carrying
 * the same `featureKey` can OVERRIDE the stage per environment; if none exists,
 * the default below applies. Keep these keys in sync with the `useFeature(...)`
 * calls in the frontend.
 */
export const FEATURE_GATE_DEFAULTS: Record<string, { stage: Stage; title: string; description: string }> = {
  inv_brick_spotter: { stage: 'beta', title: 'Brick Spotter', description: 'Scan photos of LEGO pieces to identify them and match against your inventory.' },
  inv_health: { stage: 'beta', title: 'Inventory Health', description: 'Health scoring and breakdowns that flag gaps and issues across your inventory.' },
  inv_bundletron: { stage: 'beta', title: 'BundleTron', description: 'Build and manage bulk and bundle lots with AI-assisted descriptions.' },
  inv_acquisition: { stage: 'beta', title: 'Acquisition Evaluator', description: 'Evaluate a seller price list against your inventory to spot buying opportunities.' },
  inv_list_o_matic: { stage: 'beta', title: 'List-o-Matic', description: 'Prioritized listing pipeline that tells you what to list next.' },
  inv_price_o_matic: { stage: 'released', title: 'Price-o-Matic', description: 'Bulk pricing from a proprietary time-series database with dynamic repricing scores.' },
  inv_cargo_bay: { stage: 'beta', title: 'Cargo Bay', description: 'Warehouse management: bin locations, QR/barcode filing, and locating inventory.' },
  channel_ebay: { stage: 'alpha', title: 'eBay Channel', description: 'Sell on eBay: list inventory, sync stock, and manage eBay orders. BrickLink and BrickOwl are always available.' },
  sales_operations: { stage: 'beta', title: 'Operations', description: 'Fulfillment operations metrics like time-to-ship and cancel or return rates.' },
  sales_top_items: { stage: 'beta', title: 'Top Items', description: 'Your best-selling items by revenue for the selected period.' },
  insights_strategy: { stage: 'beta', title: 'Strategy Lens', description: 'Filter business insights by strategy area: pricing, inventory, orders, customers and market.' },
};

/**
 * Resolve whether the current request's user is a PlanetBrick super admin.
 * Fast path uses the session flag; falls back to a DB lookup if the session is stale.
 */
async function resolveSuperAdmin(req: any): Promise<boolean> {
  // Preview mode: super admin is "viewing as a regular user" — suppress access.
  if (req?.session?.previewAsUser) return false;
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
 * The gate set is the union of the code-level FEATURE_GATE_DEFAULTS (always
 * present, so behaviour is identical in every environment) and any database
 * roadmap rows carrying a featureKey. A DB row OVERRIDES the catalog stage for
 * its environment; where no DB row exists (e.g. a freshly published prod DB),
 * the catalog default applies.
 *
 * Visibility rules by effective stage:
 *  - released → everyone
 *  - alpha    → super admins only
 *  - beta     → super admins, or orgs that have opted in
 *  - none     → never gated here (roadmap entry only)
 */
export async function getVisibleFeatures(req: any): Promise<VisibleFeatures> {
  const orgId = reqOrgId(req);
  const isSuper = await resolveSuperAdmin(req);
  const optIns = await getOrgBetaOptIns(orgId);

  // DB rows with a real featureKey: used to override the catalog stage per
  // environment and to supply vote counts / fresh copy for the beta panel.
  const caps = await db.select({
    id: productCapabilities.id,
    title: productCapabilities.title,
    description: productCapabilities.description,
    stage: productCapabilities.stage,
    featureKey: productCapabilities.featureKey,
  }).from(productCapabilities).where(isNotNull(productCapabilities.featureKey));

  const dbByKey = new Map<string, { id: number; title: string; description: string; stage: Stage }>();
  for (const c of caps) {
    if (c.featureKey && (c.stage as Stage) !== 'none') {
      dbByKey.set(c.featureKey, { id: c.id, title: c.title, description: c.description ?? '', stage: c.stage as Stage });
    }
  }

  // Effective gate set = code defaults, with DB rows of the same key overriding
  // stage/copy. DB-only gates (keys not in the catalog) are included too so
  // nothing that previously worked regresses.
  const effective = new Map<string, { stage: Stage; title: string; description: string; capId?: number }>();
  for (const [key, def] of Object.entries(FEATURE_GATE_DEFAULTS)) {
    effective.set(key, { stage: def.stage, title: def.title, description: def.description });
  }
  for (const [key, row] of dbByKey) {
    const base = effective.get(key);
    effective.set(key, {
      stage: row.stage,
      title: row.title || base?.title || key,
      description: row.description || base?.description || '',
      capId: row.id,
    });
  }

  const visible: string[] = [];
  const stages: Record<string, Stage> = {};
  for (const [key, info] of effective) {
    let isVisible = false;
    if (info.stage === 'released') isVisible = true;
    else if (info.stage === 'alpha') isVisible = isSuper;
    else if (info.stage === 'beta') isVisible = isSuper || optIns.has(key);
    if (isVisible) {
      visible.push(key);
      stages[key] = info.stage;
    }
  }

  // Beta-stage features for the opt-in panel, with vote counts where a DB row exists.
  const betaEntries = Array.from(effective.entries()).filter(([, i]) => i.stage === 'beta');
  let voteMap = new Map<number, number>();
  const betaCapIds = betaEntries.map(([, i]) => i.capId).filter((id): id is number => typeof id === 'number');
  if (betaCapIds.length > 0) {
    const voteRows = await db.select({ capabilityId: featureVotes.capabilityId, votes: count() })
      .from(featureVotes).where(inArray(featureVotes.capabilityId, betaCapIds))
      .groupBy(featureVotes.capabilityId);
    voteMap = new Map(voteRows.map(v => [v.capabilityId, Number(v.votes)]));
  }

  const beta: BetaFeatureInfo[] = betaEntries.map(([key, i]) => ({
    key,
    title: i.title,
    description: i.description,
    votes: i.capId != null ? (voteMap.get(i.capId) ?? 0) : 0,
    enabled: optIns.has(key),
  }));

  // Full catalog of effective stages for EVERY gated feature, regardless of
  // whether the current user can see it. Onboarding (run by normal, non-super
  // users) needs this to know an alpha/beta feature's true stage even though
  // those features are absent from `stages`/`visible`.
  const catalog: Record<string, Stage> = {};
  for (const [key, info] of effective) catalog[key] = info.stage;

  return { visible: Array.from(new Set(visible)), beta, stages, catalog };
}

/** Guard helper for feature-specific routes. Returns true if the request may access `key`. */
export async function canSeeFeature(req: any, key: string): Promise<boolean> {
  const { visible } = await getVisibleFeatures(req);
  return visible.includes(key);
}
