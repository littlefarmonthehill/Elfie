export type PlanType = 'foundation' | 'core' | 'flagship';

export interface TierLimits {
  seats: number;
  brickspotterScansPerMonth: number; // -1 = unlimited
  automationRules: number; // -1 = unlimited
  orderHistoryDays: number; // -1 = unlimited
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
  flagship: {
    id: 'flagship',
    name: 'Flagship',
    tagline: 'House account — unlimited everything',
    limits: {
      seats: -1,
      brickspotterScansPerMonth: -1,
      automationRules: -1,
      orderHistoryDays: -1,
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
      brickspotterScansPerMonth: 25,
      automationRules: 1,
      orderHistoryDays: 365,
    },
    features: {
      brickOwl: false,
      elfieAiMode: false,
      priceOMatic: false,
      easypostAutomation: false,
      dataEnrichmentImages: false,
      dataEnrichmentSemantic: false,
      fullDataEnrichment: false,
      paymentSync: true,
    },
    pricing: {
      monthly: 3900,       // $39.00/mo
      annual: 39000,       // $390.00/yr
      annualMonthly: 3250, // $32.50/mo equivalent
    },
  },
  core: {
    id: 'core',
    name: 'Core',
    tagline: 'For serious operations',
    limits: {
      seats: 5,
      brickspotterScansPerMonth: -1,
      automationRules: -1,
      orderHistoryDays: -1,
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
      monthly: 9900,       // $99.00/mo
      annual: 99000,       // $990.00/yr
      annualMonthly: 8250, // $82.50/mo equivalent
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
