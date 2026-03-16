import { db } from '../db';
import { aiUsageLog } from '@shared/schema';
import { sql, gte, eq, and } from 'drizzle-orm';

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'text-embedding-3-small': { input: 0.02 / 1_000_000, output: 0 },
  'text-embedding-3-large': { input: 0.13 / 1_000_000, output: 0 },
  'text-embedding-ada-002': { input: 0.10 / 1_000_000, output: 0 },
  'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
  'gpt-4o': { input: 2.50 / 1_000_000, output: 10.00 / 1_000_000 },
  'gpt-4-turbo': { input: 10.00 / 1_000_000, output: 30.00 / 1_000_000 },
  'claude-sonnet-4-6': { input: 3.00 / 1_000_000, output: 15.00 / 1_000_000 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_COSTS[model];
  if (!rates) return 0;
  return (inputTokens * rates.input) + (outputTokens * rates.output);
}

export async function trackUsage(params: {
  service: string;
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  orgId?: string | null;
}) {
  try {
    const cost = estimateCost(params.model, params.inputTokens, params.outputTokens);
    await db.insert(aiUsageLog).values({
      service: params.service,
      model: params.model,
      operation: params.operation,
      orgId: params.orgId || null,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalTokens: params.totalTokens,
      estimatedCost: cost,
    });
  } catch (err) {
    console.error('[AI Usage] Failed to log usage:', err);
  }
}

export async function getUsageSummary(days: number = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db.select({
    model: aiUsageLog.model,
    service: aiUsageLog.service,
    totalInput: sql<number>`COALESCE(SUM(${aiUsageLog.inputTokens}), 0)`.as('total_input'),
    totalOutput: sql<number>`COALESCE(SUM(${aiUsageLog.outputTokens}), 0)`.as('total_output'),
    totalTokens: sql<number>`COALESCE(SUM(${aiUsageLog.totalTokens}), 0)`.as('total_tokens'),
    totalCost: sql<number>`COALESCE(SUM(${aiUsageLog.estimatedCost}), 0)`.as('total_cost'),
    requests: sql<number>`COUNT(*)`.as('requests'),
  })
    .from(aiUsageLog)
    .where(gte(aiUsageLog.createdAt, since))
    .groupBy(aiUsageLog.model, aiUsageLog.service);

  return rows;
}

export async function getUsageMtd() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [result] = await db.select({
    totalTokens: sql<number>`COALESCE(SUM(${aiUsageLog.totalTokens}), 0)`.as('total_tokens'),
    totalCost: sql<number>`COALESCE(SUM(${aiUsageLog.estimatedCost}), 0)`.as('total_cost'),
    requests: sql<number>`COUNT(*)`.as('requests'),
  })
    .from(aiUsageLog)
    .where(gte(aiUsageLog.createdAt, startOfMonth));

  return result;
}

export async function getUsageLast30d() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [result] = await db.select({
    totalTokens: sql<number>`COALESCE(SUM(${aiUsageLog.totalTokens}), 0)`.as('total_tokens'),
    totalCost: sql<number>`COALESCE(SUM(${aiUsageLog.estimatedCost}), 0)`.as('total_cost'),
    requests: sql<number>`COUNT(*)`.as('requests'),
  })
    .from(aiUsageLog)
    .where(gte(aiUsageLog.createdAt, since));

  return result;
}

export async function getOrgAiUsageMtd(orgId: string) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const rows = await db.select({
    operation: aiUsageLog.operation,
    totalTokens: sql<number>`COALESCE(SUM(${aiUsageLog.totalTokens}), 0)`.as('total_tokens'),
    totalCost: sql<number>`COALESCE(SUM(${aiUsageLog.estimatedCost}), 0)`.as('total_cost'),
    requests: sql<number>`COUNT(*)`.as('requests'),
  })
    .from(aiUsageLog)
    .where(and(
      eq(aiUsageLog.orgId, orgId),
      gte(aiUsageLog.createdAt, startOfMonth),
    ))
    .groupBy(aiUsageLog.operation);

  return rows;
}

export async function getOrgAiUsageForMonth(orgId: string, from: Date, to: Date): Promise<number> {
  const [row] = await db.select({
    requests: sql<number>`COUNT(*)::int`.as('requests'),
  })
    .from(aiUsageLog)
    .where(and(
      eq(aiUsageLog.orgId, orgId),
      gte(aiUsageLog.createdAt, from),
      sql`${aiUsageLog.createdAt} < ${to}`,
      sql`${aiUsageLog.operation} NOT IN ('embedding', 'embedding-onboarding')`,
    ));
  return Number(row?.requests ?? 0);
}

export async function getUsageByOrg(days: number = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const rows = await db.select({
    orgId: aiUsageLog.orgId,
    operation: aiUsageLog.operation,
    totalInput: sql<number>`COALESCE(SUM(${aiUsageLog.inputTokens}), 0)`.as('total_input'),
    totalOutput: sql<number>`COALESCE(SUM(${aiUsageLog.outputTokens}), 0)`.as('total_output'),
    totalTokens: sql<number>`COALESCE(SUM(${aiUsageLog.totalTokens}), 0)`.as('total_tokens'),
    totalCost: sql<number>`COALESCE(SUM(${aiUsageLog.estimatedCost}), 0)`.as('total_cost'),
    requests: sql<number>`COUNT(*)`.as('requests'),
  })
    .from(aiUsageLog)
    .where(gte(aiUsageLog.createdAt, since))
    .groupBy(aiUsageLog.orgId, aiUsageLog.operation);

  return rows;
}
