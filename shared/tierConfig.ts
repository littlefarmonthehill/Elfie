export type PlanType = 'trial' | 'foundation' | 'core' | 'flagship';

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
  priceOMatic: boolean;
  easypostAutomation: boolean;
  dataEnrichmentImages: boolean;
  dataEnrichmentSemantic: boolean;
  fullDataEnrichment: boolean;
  paymentSync: boolean;
}

export interface TierPricing {
  monthly: number; // in cents
  annual: number;  // in cents (total per year)
  annualMonthly: number; // monthly equivalent when billed annually
}

export interface TierConfig {
  id: PlanType;
  name: string;
  tagline: string;
  limits: TierLimits;
  features: TierFeatures;
  pricing: TierPricing;
}

export const TIER_CONFIG: Record<PlanType, TierConfig> = {
  trial: {
    id: 'trial',
    name: 'Free Trial',
    tagline: '14 days to explore PlanetBrick',
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
  foundation: {
    id: 'foundation',
    name: 'Foundation',
    tagline: 'For solo sellers getting started',
    limits: {
      seats: 2,
      brickspotterScansPerMonth: 50,
      automationRules: 3,
      orderHistoryDays: 90,
      inventoryItems: 5000,
      orders: 150,
      elfieQueries: 100,
      businessIntel: 5,
    },
    features: {
      brickOwl: false,
      elfieAiMode: true,
      priceOMatic: true,
      easypostAutomation: false,
      dataEnrichmentImages: true,
      dataEnrichmentSemantic: true,
      fullDataEnrichment: false,
      paymentSync: true,
    },
    pricing: {
      monthly: 1999,       // $19.99/mo
      annual: 19188,       // $191.88/yr
      annualMonthly: 1599, // $15.99/mo equivalent
    },
  },
  core: {
    id: 'core',
    name: 'Core',
    tagline: 'For growing brick businesses',
    limits: {
      seats: 5,
      brickspotterScansPerMonth: 250,
      automationRules: 10,
      orderHistoryDays: 365,
      inventoryItems: 50000,
      orders: 1000,
      elfieQueries: 500,
      businessIntel: 25,
    },
    features: {
      brickOwl: true,
      elfieAiMode: true,
      priceOMatic: true,
      easypostAutomation: true,
      dataEnrichmentImages: true,
      dataEnrichmentSemantic: true,
      fullDataEnrichment: true,
      paymentSync: true,
    },
    pricing: {
      monthly: 4999,       // $49.99/mo
      annual: 47988,       // $479.88/yr
      annualMonthly: 3999, // $39.99/mo equivalent
    },
  },
  flagship: {
    id: 'flagship',
    name: 'Flagship',
    tagline: 'For high-volume operations & teams',
    limits: {
      seats: -1,
      brickspotterScansPerMonth: -1,
      automationRules: -1,
      orderHistoryDays: -1,
      inventoryItems: -1,
      orders: -1,
      elfieQueries: -1,
      businessIntel: -1,
    },
    features: {
      brickOwl: true,
      elfieAiMode: true,
      priceOMatic: true,
      easypostAutomation: true,
      dataEnrichmentImages: true,
      dataEnrichmentSemantic: true,
      fullDataEnrichment: true,
      paymentSync: true,
    },
    pricing: {
      monthly: 9999,       // $99.99/mo
      annual: 95988,       // $959.88/yr
      annualMonthly: 7999, // $79.99/mo equivalent
    },
  },
};

export function getTierConfig(plan: string): TierConfig {
  return TIER_CONFIG[(plan as PlanType)] ?? TIER_CONFIG.foundation;
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
  limit: number; // -1 = unlimited
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
      message: `You've reached your ${resourceName} limit (${limit}). Upgrade to Core for more.`,
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
      message: `You've used ${current} of ${limit} ${resourceName}. Consider upgrading to Core for more.`,
      current,
      limit,
    };
  }

  return { allowed: true, nudgeLevel: 'none', message: null, current, limit };
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

export function getAnnualSavings(plan: PlanType): number {
  const tier = TIER_CONFIG[plan];
  const annualIfMonthly = tier.pricing.monthly * 12;
  return annualIfMonthly - tier.pricing.annual;
}
