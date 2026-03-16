export type PlanType = 'trial' | 'core';

export interface TierLimits {
  seats: number;
  brickspotterScansPerMonth: number; // -1 = unlimited
  automationRules: number; // -1 = unlimited
  orderHistoryDays: number; // -1 = unlimited
  inventoryItems: number; // -1 = unlimited
  orders: number; // -1 = unlimited
  elfieQueries: number; // -1 = unlimited
  businessIntel: number; // -1 = unlimited
}

export interface TierFeatures {
  brickOwl: boolean;
  elfieAiMode: boolean;
  elfieCustom: boolean;
  elfieLiveSupport: boolean;
  priceOMatic: boolean;
  easypostAutomation: boolean;
  dataEnrichmentImages: boolean;
  dataEnrichmentSemantic: boolean;
  fullDataEnrichment: boolean;
  paymentSync: boolean;
}

export interface TierPricing {
  monthly: number;
  annual: number;
  annualMonthly: number;
}

export interface TierConfig {
  id: PlanType;
  name: string;
  tagline: string;
  trialDurationDays?: number;
  limits: TierLimits;
  features: TierFeatures;
  pricing: TierPricing;
}

const ALL_FEATURES: TierFeatures = {
  brickOwl: true,
  elfieAiMode: true,
  elfieCustom: true,
  elfieLiveSupport: true,
  priceOMatic: true,
  easypostAutomation: true,
  dataEnrichmentImages: true,
  dataEnrichmentSemantic: true,
  fullDataEnrichment: true,
  paymentSync: true,
};

const UNLIMITED_LIMITS: TierLimits = {
  seats: -1,
  brickspotterScansPerMonth: -1,
  automationRules: -1,
  orderHistoryDays: -1,
  inventoryItems: -1,
  orders: -1,
  elfieQueries: -1,
  businessIntel: -1,
};

export const TIER_CONFIG: Record<PlanType, TierConfig> = {
  trial: {
    id: 'trial',
    name: 'Free Trial',
    tagline: '14 days to explore E.L.F.I.E.',
    trialDurationDays: 14,
    limits: {
      seats: 1,
      brickspotterScansPerMonth: 10,
      automationRules: 0,
      orderHistoryDays: 14,
      inventoryItems: 500,
      orders: 25,
      elfieQueries: 20,
      businessIntel: 0,
    },
    features: {
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
    },
    pricing: {
      monthly: 0,
      annual: 0,
      annualMonthly: 0,
    },
  },
  core: {
    id: 'core',
    name: 'Core',
    tagline: 'Pay As You Grow — sales-based billing',
    limits: UNLIMITED_LIMITS,
    features: ALL_FEATURES,
    pricing: {
      monthly: 0,
      annual: 0,
      annualMonthly: 0,
    },
  },
};

export function getTierConfig(plan: string): TierConfig {
  return TIER_CONFIG[(plan as PlanType)] ?? TIER_CONFIG.core;
}

export interface OrgLimits {
  seats: number;
  brickspotterScansPerMonth: number;
  automationRules: number;
  orderHistoryDays: number;
  inventoryItems: number;
  orders: number;
  elfieQueries: number;
  businessIntel: number;
}

export function getEffectiveLimits(org: {
  plan: string;
  seatLimitOverride?: number | null;
  brickspotterLimitOverride?: number | null;
  automationLimitOverride?: number | null;
}): OrgLimits {
  const tier = getTierConfig(org.plan);
  return {
    seats: org.seatLimitOverride ?? tier.limits.seats,
    brickspotterScansPerMonth: org.brickspotterLimitOverride ?? tier.limits.brickspotterScansPerMonth,
    automationRules: org.automationLimitOverride ?? tier.limits.automationRules,
    orderHistoryDays: tier.limits.orderHistoryDays,
    inventoryItems: tier.limits.inventoryItems,
    orders: tier.limits.orders,
    elfieQueries: tier.limits.elfieQueries,
    businessIntel: tier.limits.businessIntel,
  };
}

export function isFeatureEnabled(plan: string, feature: keyof TierFeatures): boolean {
  return getTierConfig(plan).features[feature];
}

export type NudgeLevel = 'none' | 'warning' | 'critical' | 'blocked';

export interface LimitCheckResult {
  allowed: boolean;
  nudgeLevel: NudgeLevel;
  message: string | null;
  current: number;
  limit: number;
}

export function checkLimit(current: number, limit: number, resourceName: string): LimitCheckResult {
  if (limit === -1) {
    return { allowed: true, nudgeLevel: 'none', message: null, current, limit };
  }

  const pct = current / limit;

  if (current >= limit) {
    return {
      allowed: false,
      nudgeLevel: 'blocked',
      message: `You've reached your ${resourceName} limit (${limit}).`,
      current,
      limit,
    };
  }

  if (pct >= 0.9) {
    return {
      allowed: true,
      nudgeLevel: 'critical',
      message: `You've used ${current} of ${limit} ${resourceName}. You're almost at your limit.`,
      current,
      limit,
    };
  }

  if (pct >= 0.8) {
    return {
      allowed: true,
      nudgeLevel: 'warning',
      message: `You've used ${current} of ${limit} ${resourceName}.`,
      current,
      limit,
    };
  }

  return { allowed: true, nudgeLevel: 'none', message: null, current, limit };
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}
