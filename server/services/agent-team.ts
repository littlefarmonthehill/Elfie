/**
 * Agent Team — five domain-specialized background agents that each maintain
 * a running picture of one area of the business. Their signals are written to
 * business_insights (tagged with agent_id) and can be retrieved by E.L.F.I.E.
 *
 * Agents:
 *   inventory  — stock health, dead stock, reorder pressure, warehouse utilization
 *   pricing    — pricing gaps, POM scores, repricing opportunities, AI decision patterns
 *   market     — BrickLink price movements, forum signals, set retirement, demand trends
 *   orders     — order velocity, channel performance, fulfillment patterns, seasonality
 *   customer   — buyer retention, dormant buyers, top spenders, new buyer activity
 */

import { db } from "../db";
import {
  businessInsights, blInventory, blCatalog,
  marketNews, blForumPosts, appSettings, pomPriceDecisions, ieStrategies,
} from "@shared/schema";
import { eq, and, sql, desc, gte, ne, isNull, or, inArray } from "drizzle-orm";
import OpenAI from "openai";

export type AgentId = 'inventory' | 'pricing' | 'market' | 'orders' | 'customer';

const SIGNAL_TTL_HOURS = 12;

async function getOpenAI(): Promise<OpenAI | null> {
  try {
    const [row] = await db.select({ key: appSettings.openaiApiKey })
      .from(appSettings).where(eq(appSettings.id, 'platform')).limit(1);
    const key = row?.key || process.env.OPENAI_API_KEY;
    if (!key) return null;
    return new OpenAI({ apiKey: key });
  } catch { return null; }
}

// Fetch all IE strategy fields for an org (returns empty object if none set)
async function getOrgStrategies(orgId: string): Promise<Partial<Record<string, string>>> {
  try {
    const [row] = await db.select().from(ieStrategies).where(eq(ieStrategies.orgId, orgId)).limit(1);
    return row ?? {};
  } catch { return {}; }
}

// Build a system prompt with optional global org context (vision, success) and per-agent strategy.
// Vision/mission and success factors are injected into every agent; the per-agent strategy is additive.
function buildSystemPrompt(
  basePrompt: string,
  strategies: Partial<Record<string, string | null>>,
  agentStrategy: string | null | undefined,
  agentLabel: string,
): string {
  const parts: string[] = [basePrompt];
  if (strategies.visionMission?.trim()) {
    parts.push(`\nBUSINESS VISION & MISSION:\n"${strategies.visionMission.trim()}"\nThis is what the business stands for and where it is headed. Let it colour how you frame every signal.`);
  }
  if (strategies.successFactors?.trim()) {
    parts.push(`\nDEFINING SUCCESS (Vivid Vision — what the future looks like when the business wins):\n"${strategies.successFactors.trim()}"\nUse this to understand the outcomes, feelings, and reputation the owner is driving toward. Signals that accelerate this future should be elevated.`);
  }
  if (agentStrategy?.trim()) {
    parts.push(`\n${agentLabel.toUpperCase()} STRATEGY:\n"${agentStrategy.trim()}"\nThis is your domain-specific guiding directive — prioritise signals and recommendations that align with it.`);
  }
  return parts.join('\n');
}

async function upsertSignals(
  orgId: string,
  agentId: AgentId,
  signals: Array<{ category: string; urgency: string; title: string; summary: string; details?: any }>,
) {
  const expiresAt = new Date(Date.now() + SIGNAL_TTL_HOURS * 60 * 60 * 1000);
  for (const sig of signals) {
    if (!sig.title || !sig.summary) continue;
    try {
      const existing = await db.select({ id: businessInsights.id })
        .from(businessInsights)
        .where(and(
          eq(businessInsights.orgId, orgId),
          eq(businessInsights.agentId, agentId),
          eq(businessInsights.title, sig.title),
          eq(businessInsights.dismissed, false),
        )).limit(1);

      if (existing.length > 0) {
        await db.update(businessInsights)
          .set({ summary: sig.summary, details: sig.details ?? null, urgency: sig.urgency, expiresAt, updatedAt: new Date() })
          .where(eq(businessInsights.id, existing[0].id));
      } else {
        await db.insert(businessInsights).values({
          orgId,
          agentId,
          category: sig.category,
          urgency: sig.urgency,
          title: sig.title,
          summary: sig.summary,
          details: sig.details ?? null,
          sourceType: agentId,
          expiresAt,
        });
      }
    } catch { /* non-fatal per signal */ }
  }
}

async function callAgent(openai: OpenAI, orgId: string, systemPrompt: string, dataContext: string): Promise<any[]> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: dataContext },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 2000,
  });
  try {
    const { trackUsage } = await import('./ai-usage-tracker');
    if (completion.usage) {
      trackUsage({ service: 'openai', model: 'gpt-4o-mini', operation: `agent-${orgId}`, inputTokens: completion.usage.prompt_tokens || 0, outputTokens: completion.usage.completion_tokens || 0, totalTokens: completion.usage.total_tokens || 0, orgId });
    }
  } catch { /* non-fatal */ }
  const content = completion.choices[0]?.message?.content || '{}';
  let parsed: any = {};
  try {
    parsed = JSON.parse(content);
  } catch {
    // Truncated or malformed JSON — return empty; agent will retry on next cycle
  }
  return Array.isArray(parsed.signals) ? parsed.signals : [];
}

// ─── INVENTORY AGENT ────────────────────────────────────────────────────────

export async function runInventoryAgent(orgId: string): Promise<number> {
  const openai = await getOpenAI();
  if (!openai) return 0;

  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  const inventory = await db.select({
    itemNo: blInventory.itemNo,
    itemName: blCatalog.itemName,
    colorName: blCatalog.colorName,
    quantity: blInventory.quantity,
    unitPrice: blInventory.unitPrice,
    newOrUsed: blInventory.newOrUsed,
    itemType: blInventory.itemType,
  })
    .from(blInventory)
    .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
    .where(eq(blInventory.orgId, orgId))
    .orderBy(desc(blInventory.quantity))
    .limit(200);

  const soldItems = await db.execute(sql`
    SELECT od.item_no, SUM(od.quantity) as sold_qty, MAX(o.order_date) as last_sold
    FROM order_details od
    JOIN orders o ON od.order_id = o.id
    WHERE o.org_id = ${orgId} AND o.order_date >= ${ninetyDaysAgo}
    GROUP BY od.item_no
  `);
  const soldMap = new Map<string, { qty: number; lastSold: string }>();
  for (const r of soldItems.rows as any[]) {
    soldMap.set(r.item_no, { qty: Number(r.sold_qty), lastSold: r.last_sold });
  }

  const totalValue = inventory.reduce((s, i) => s + (i.quantity * parseFloat(i.unitPrice || '0')), 0);
  const zeroSellers = inventory.filter(i => !soldMap.has(i.itemNo) && i.quantity > 10);
  const highVelocity = inventory.filter(i => (soldMap.get(i.itemNo)?.qty ?? 0) > 20 && i.quantity < 5);
  const deadStock = inventory.filter(i => i.quantity > 50 && !soldMap.has(i.itemNo)).slice(0, 15);

  const ctx = `
INVENTORY SUMMARY:
Total SKUs: ${inventory.length} | Total value: $${totalValue.toFixed(2)}
Zero sellers (>10 qty, no 90d sales): ${zeroSellers.length} items
Low stock fast movers (sold >20 in 90d, <5 qty): ${highVelocity.length} items

DEAD STOCK (top 15 by qty, never sold in 90d):
${deadStock.map(i => `${i.itemNo} "${i.itemName || '?'}" ${i.colorName || ''} qty:${i.quantity} @$${i.unitPrice}`).join('\n')}

LOW STOCK FAST MOVERS (reorder urgently):
${highVelocity.slice(0, 15).map(i => `${i.itemNo} "${i.itemName || '?'}" qty:${i.quantity} sold:${soldMap.get(i.itemNo)?.qty}x in 90d`).join('\n')}

LARGEST HOLDINGS BY VALUE:
${inventory.filter(i => parseFloat(i.unitPrice || '0') * i.quantity > 5).slice(0, 20).map(i => `${i.itemNo} "${i.itemName || '?'}" qty:${i.quantity} @$${i.unitPrice} = $${(i.quantity * parseFloat(i.unitPrice || '0')).toFixed(2)}`).join('\n')}
`.trim();

  const strategies = await getOrgStrategies(orgId);
  const systemPrompt = buildSystemPrompt(
    `You are the Inventory Agent for a LEGO reseller. Analyze the inventory data and generate 3-6 specific, actionable signals about stock health. Focus on dead stock risk, reorder urgency, capital concentration, and stock imbalances.

Output JSON: { "signals": [ { "category": string, "urgency": "high"|"medium"|"low", "title": string (max 80 chars), "summary": string (2-3 sentences, specific numbers), "details": { "itemNos": [], "metric": "" } } ] }

Categories: restock | overstock | dead_stock | capital_risk | opportunity
Rules: cite specific item numbers and dollar amounts. No generic advice.`,
    strategies, strategies.inventoryStrategy, 'Inventory'
  );

  const signals = await callAgent(openai, orgId, systemPrompt, ctx);
  await upsertSignals(orgId, 'inventory', signals);
  console.log(`[AgentTeam] Inventory agent generated ${signals.length} signals for ${orgId}`);
  return signals.length;
}

// ─── PRICING AGENT ──────────────────────────────────────────────────────────

export async function runPricingAgent(orgId: string): Promise<number> {
  const openai = await getOpenAI();
  if (!openai) return 0;

  const gapData = await db.execute(sql`
    SELECT bi.item_no, bc.item_name, bi.unit_price::numeric, bi.quantity,
           pgc.stock_avg_price::numeric as market_avg, pgc.sold_avg_price::numeric as sold_avg,
           pgc.sold_max_price::numeric as sold_max, pgc.stock_total_lots,
           ROUND(((bi.unit_price::numeric - pgc.sold_avg_price::numeric) / NULLIF(pgc.sold_avg_price::numeric,0))*100,1) as gap_pct
    FROM bl_inventory bi
    LEFT JOIN bl_catalog bc ON bi.item_no=bc.item_no AND bi.item_type=bc.item_type AND bi.color_id=bc.color_id
    LEFT JOIN price_guide_cache pgc ON bi.item_no=pgc.item_no AND bi.item_type=pgc.item_type AND bi.color_id=pgc.color_id AND bi.new_or_used=pgc.new_or_used
    WHERE bi.org_id=${orgId} AND pgc.sold_avg_price IS NOT NULL AND pgc.sold_avg_price::numeric > 0 AND bi.unit_price::numeric > 0
    ORDER BY ABS(bi.unit_price::numeric - pgc.sold_avg_price::numeric) DESC
    LIMIT 40
  `);
  const gaps = gapData.rows as any[];

  const recentDecisions = await db.select({
    itemNo: pomPriceDecisions.itemNo,
    actualPrice: pomPriceDecisions.actualPrice,
    suggestedPrice: pomPriceDecisions.suggestedPrice,
    priceDelta: pomPriceDecisions.priceDelta,
    decisionAt: pomPriceDecisions.decisionAt,
  }).from(pomPriceDecisions)
    .where(eq(pomPriceDecisions.orgId, orgId))
    .orderBy(desc(pomPriceDecisions.decisionAt))
    .limit(30);

  const overpriced = gaps.filter((g: any) => Number(g.gap_pct) > 20).slice(0, 10);
  const underpriced = gaps.filter((g: any) => Number(g.gap_pct) < -20).slice(0, 10);

  const avgDelta = recentDecisions.length > 0
    ? recentDecisions.reduce((s, d) => s + (d.priceDelta ? Number(d.priceDelta) : 0), 0) / recentDecisions.length
    : null;

  const ctx = `
PRICING GAPS (your price vs. market sold avg):
OVERPRICED (>20% above sold avg, ${overpriced.length} items):
${overpriced.map((g: any) => `  ${g.item_no} "${g.item_name || '?'}" — YOUR:$${Number(g.unit_price).toFixed(2)} SOLD_AVG:$${Number(g.sold_avg).toFixed(2)} SOLD_MAX:$${Number(g.sold_max).toFixed(2)} (${Number(g.gap_pct) > 0 ? '+' : ''}${g.gap_pct}% gap) qty:${g.quantity}`).join('\n')}

UNDERPRICED (>20% below sold avg, ${underpriced.length} items):
${underpriced.map((g: any) => `  ${g.item_no} "${g.item_name || '?'}" — YOUR:$${Number(g.unit_price).toFixed(2)} SOLD_AVG:$${Number(g.sold_avg).toFixed(2)} SOLD_MAX:$${Number(g.sold_max).toFixed(2)} (${g.gap_pct}% gap) qty:${g.quantity}`).join('\n')}

RECENT PRICING DECISIONS (${recentDecisions.length} logged):
${recentDecisions.slice(0, 10).map(d => `  ${d.itemNo} set $${Number(d.actualPrice).toFixed(2)}${d.suggestedPrice ? ` (POM suggested $${Number(d.suggestedPrice).toFixed(2)}, delta ${Number(d.priceDelta) >= 0 ? '+' : ''}${Number(d.priceDelta ?? 0).toFixed(2)})` : ''}`).join('\n')}
${avgDelta !== null ? `Average pricing delta vs POM: ${avgDelta >= 0 ? '+' : ''}$${avgDelta.toFixed(3)} (${avgDelta > 0 ? 'pricing above' : 'pricing below'} POM suggestions on average)` : ''}
`.trim();

  const strategies = await getOrgStrategies(orgId);
  const systemPrompt = buildSystemPrompt(
    `You are the Pricing Agent for a LEGO reseller. Analyze pricing gaps and repricing patterns to generate 3-5 specific, actionable pricing signals.

Output JSON: { "signals": [ { "category": string, "urgency": "high"|"medium"|"low", "title": string (max 80 chars), "summary": string (2-3 sentences, cite specific items/prices), "details": { "itemNos": [], "potentialRevenue": 0 } } ] }

Categories: pricing | opportunity | risk
Rules: be specific. Cite item numbers, exact prices, potential revenue impact. Focus on the biggest opportunities.`,
    strategies, strategies.pricingStrategy, 'Pricing'
  );

  const signals = await callAgent(openai, orgId, systemPrompt, ctx);
  await upsertSignals(orgId, 'pricing', signals);
  console.log(`[AgentTeam] Pricing agent generated ${signals.length} signals for ${orgId}`);
  return signals.length;
}

// ─── MARKET AGENT ────────────────────────────────────────────────────────────

export async function runMarketAgent(orgId: string): Promise<number> {
  const openai = await getOpenAI();
  if (!openai) return 0;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const recentNews = await db.select({ title: marketNews.title, snippet: marketNews.snippet, publishedAt: marketNews.publishedAt, source: marketNews.source })
    .from(marketNews)
    .where(gte(marketNews.publishedAt, sevenDaysAgo))
    .orderBy(desc(marketNews.publishedAt))
    .limit(20);

  const recentForum = await db.select({ title: blForumPosts.title, excerpt: blForumPosts.excerpt, replyCount: blForumPosts.replyCount, lastReplyAt: blForumPosts.lastReplyAt })
    .from(blForumPosts)
    .where(gte(blForumPosts.postedAt, sevenDaysAgo))
    .orderBy(desc(blForumPosts.replyCount))
    .limit(15);

  const priceMoves = await db.execute(sql`
    SELECT pgc.item_no, bc.item_name,
           pgc.sold_avg_price::numeric as sold_avg,
           pgc.sold_max_price::numeric as sold_max,
           pgc.stock_total_lots,
           pgc.sold_quantity,
           bi.quantity as our_qty,
           bi.unit_price::numeric as our_price
    FROM price_guide_cache pgc
    LEFT JOIN bl_catalog bc ON pgc.item_no=bc.item_no AND pgc.item_type=bc.item_type AND pgc.color_id=bc.color_id
    LEFT JOIN bl_inventory bi ON pgc.item_no=bi.item_no AND pgc.item_type=bi.item_type AND pgc.color_id=bi.color_id AND bi.org_id=${orgId}
    WHERE pgc.sold_quantity > 50 AND pgc.sold_max_price::numeric > pgc.sold_avg_price::numeric * 1.5
    ORDER BY pgc.sold_max_price::numeric DESC
    LIMIT 20
  `);

  const ctx = `
MARKET NEWS (last 7 days, ${recentNews.length} articles):
${recentNews.map(n => `  [${n.source || '?'}] ${n.title}${n.snippet ? ' — ' + n.snippet.substring(0, 100) : ''}`).join('\n')}

BRICKLINK FORUM HOT TOPICS (last 7 days, sorted by replies):
${recentForum.map(f => `  [${f.replyCount} replies] ${f.title}${f.excerpt ? ' — ' + f.excerpt.substring(0, 80) : ''}`).join('\n')}

ITEMS WITH HIGH PRICE SPREAD (sold_max > 1.5x sold_avg — potential premium demand):
${(priceMoves.rows as any[]).slice(0, 15).map((r: any) => `  ${r.item_no} "${r.item_name || '?'}" sold_avg:$${Number(r.sold_avg).toFixed(2)} sold_max:$${Number(r.sold_max).toFixed(2)} demand:${r.sold_quantity} lots${r.our_qty != null ? ` — WE HAVE: qty:${r.our_qty} @$${Number(r.our_price).toFixed(2)}` : ' — NOT IN STOCK'}`).join('\n')}
`.trim();

  const strategies = await getOrgStrategies(orgId);
  const systemPrompt = buildSystemPrompt(
    `You are the Market Intelligence Agent for a LEGO reseller. Analyze market news, forum discussions, and price spread data to identify external signals that may affect the business.

Output JSON: { "signals": [ { "category": string, "urgency": "high"|"medium"|"low", "title": string (max 80 chars), "summary": string (2-3 sentences connecting external signal to business impact), "details": { "source": "", "itemNos": [] } } ] }

Categories: trend | opportunity | risk | acquisition
Rules: Connect news/forum signals to specific inventory implications. Identify retirement risks, demand surges, pricing opportunities. Be specific about which items are affected.`,
    strategies, strategies.marketStrategy, 'Market Intelligence'
  );

  const signals = await callAgent(openai, orgId, systemPrompt, ctx);
  await upsertSignals(orgId, 'market', signals);
  console.log(`[AgentTeam] Market agent generated ${signals.length} signals for ${orgId}`);
  return signals.length;
}

// ─── ORDERS AGENT ────────────────────────────────────────────────────────────

export async function runOrdersAgent(orgId: string): Promise<number> {
  const openai = await getOpenAI();
  if (!openai) return 0;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const velocityData = await db.execute(sql`
    SELECT
      DATE_TRUNC('week', o.order_date) as week,
      COUNT(*) as order_count,
      SUM(o.order_total::numeric) as revenue,
      o.marketplace
    FROM orders o
    WHERE o.org_id=${orgId} AND o.order_date >= ${sixtyDaysAgo}
      AND o.order_status NOT IN ('cancelled','purged')
    GROUP BY week, o.marketplace
    ORDER BY week DESC, revenue DESC
  `);

  const topSKUs = await db.execute(sql`
    SELECT od.item_no, bc.item_name, SUM(od.quantity) as sold_qty, AVG(od.unit_price::numeric) as avg_price, COUNT(DISTINCT o.id) as order_count
    FROM order_details od
    JOIN orders o ON od.order_id=o.id
    LEFT JOIN bl_catalog bc ON od.item_no=bc.item_no AND od.item_type=bc.item_type
    WHERE o.org_id=${orgId} AND o.order_date >= ${thirtyDaysAgo} AND o.order_status NOT IN ('cancelled','purged')
    GROUP BY od.item_no, bc.item_name
    ORDER BY sold_qty DESC
    LIMIT 20
  `);

  const channelData = (velocityData.rows as any[]).reduce((acc: any, r: any) => {
    if (!acc[r.marketplace]) acc[r.marketplace] = { revenue: 0, orders: 0 };
    acc[r.marketplace].revenue += Number(r.revenue || 0);
    acc[r.marketplace].orders += Number(r.order_count || 0);
    return acc;
  }, {});

  const total30d = (velocityData.rows as any[])
    .filter((r: any) => new Date(r.week) >= thirtyDaysAgo)
    .reduce((s: number, r: any) => s + Number(r.revenue || 0), 0);
  const total60to30d = (velocityData.rows as any[])
    .filter((r: any) => new Date(r.week) < thirtyDaysAgo)
    .reduce((s: number, r: any) => s + Number(r.revenue || 0), 0);
  const revChange = total60to30d > 0 ? ((total30d - total60to30d) / total60to30d * 100).toFixed(1) : 'N/A';

  const ctx = `
ORDER VELOCITY (60-day window):
Last 30d revenue: $${total30d.toFixed(2)} | Prior 30d: $${total60to30d.toFixed(2)} | Change: ${revChange}%

CHANNEL BREAKDOWN (60d):
${Object.entries(channelData).map(([ch, d]: any) => `  ${ch}: $${d.revenue.toFixed(2)} revenue, ${d.orders} orders`).join('\n')}

TOP SELLING SKUs (last 30d):
${(topSKUs.rows as any[]).map((r: any) => `  ${r.item_no} "${r.item_name || '?'}" — sold:${r.sold_qty} units across ${r.order_count} orders @avg $${Number(r.avg_price).toFixed(2)}`).join('\n')}

WEEKLY ORDER VOLUME (last 8 weeks):
${(velocityData.rows as any[]).slice(0, 16).map((r: any) => `  ${String(r.week).substring(0,10)} [${r.marketplace}]: ${r.order_count} orders $${Number(r.revenue).toFixed(2)}`).join('\n')}
`.trim();

  const strategies = await getOrgStrategies(orgId);
  const systemPrompt = buildSystemPrompt(
    `You are the Orders Agent for a LEGO reseller. Analyze order velocity, channel performance, and SKU throughput to generate 3-5 specific operational signals.

Output JSON: { "signals": [ { "category": string, "urgency": "high"|"medium"|"low", "title": string (max 80 chars), "summary": string (2-3 sentences, cite specific numbers and trends), "details": { "metric": "", "value": 0 } } ] }

Categories: velocity | channel | revenue | opportunity | risk
Rules: cite specific percentages, dollar amounts, and item numbers. Focus on actionable patterns — which channels are growing, which SKUs are driving volume, where there are gaps.`,
    strategies, strategies.ordersStrategy, 'Orders'
  );

  const signals = await callAgent(openai, orgId, systemPrompt, ctx);
  await upsertSignals(orgId, 'orders', signals);
  console.log(`[AgentTeam] Orders agent generated ${signals.length} signals for ${orgId}`);
  return signals.length;
}

// ─── CUSTOMER AGENT ──────────────────────────────────────────────────────────

export async function runCustomerAgent(orgId: string): Promise<number> {
  const openai = await getOpenAI();
  if (!openai) return 0;

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const oneEightyDaysAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

  const topBuyers = await db.execute(sql`
    SELECT customer_username, COUNT(*) as order_count, SUM(order_total::numeric) as total_spent,
           MAX(order_date) as last_order, MIN(order_date) as first_order,
           AVG(order_total::numeric) as avg_order
    FROM orders
    WHERE org_id=${orgId} AND order_status NOT IN ('cancelled','purged')
    GROUP BY customer_username
    ORDER BY total_spent DESC
    LIMIT 20
  `);

  const dormant = await db.execute(sql`
    SELECT customer_username, MAX(order_date) as last_order, COUNT(*) as order_count,
           SUM(order_total::numeric) as lifetime_spent
    FROM orders
    WHERE org_id=${orgId} AND order_status NOT IN ('cancelled','purged')
    GROUP BY customer_username
    HAVING MAX(order_date) < ${ninetyDaysAgo} AND MAX(order_date) >= ${oneEightyDaysAgo}
       AND COUNT(*) >= 2
    ORDER BY lifetime_spent DESC
    LIMIT 15
  `);

  const newBuyers = await db.execute(sql`
    SELECT customer_username, COUNT(*) as order_count, SUM(order_total::numeric) as total_spent,
           MIN(order_date) as first_order
    FROM orders
    WHERE org_id=${orgId} AND order_status NOT IN ('cancelled','purged')
    GROUP BY customer_username
    HAVING MIN(order_date) >= ${ninetyDaysAgo}
    ORDER BY total_spent DESC
    LIMIT 15
  `);

  const ctx = `
TOP BUYERS ALL TIME:
${(topBuyers.rows as any[]).map((r: any) => `  ${r.customer_username}: ${r.order_count} orders, $${Number(r.total_spent).toFixed(2)} total, avg $${Number(r.avg_order).toFixed(2)}/order, last order: ${String(r.last_order).substring(0,10)}`).join('\n')}

DORMANT HIGH-VALUE BUYERS (2+ orders, last order 90-180d ago):
${(dormant.rows as any[]).map((r: any) => `  ${r.customer_username}: ${r.order_count} past orders, $${Number(r.lifetime_spent).toFixed(2)} lifetime, last order: ${String(r.last_order).substring(0,10)}`).join('\n') || '  None detected'}

NEW BUYERS (first order in last 90d):
${(newBuyers.rows as any[]).map((r: any) => `  ${r.customer_username}: ${r.order_count} orders, $${Number(r.total_spent).toFixed(2)} in first ${r.order_count > 1 ? `${r.order_count} orders` : 'order'}, since ${String(r.first_order).substring(0,10)}`).join('\n') || '  None in 90d'}
`.trim();

  const strategies = await getOrgStrategies(orgId);
  const systemPrompt = buildSystemPrompt(
    `You are the Customer Agent for a LEGO reseller. Analyze buyer behavior patterns to generate 3-5 specific customer intelligence signals.

Output JSON: { "signals": [ { "category": string, "urgency": "high"|"medium"|"low", "title": string (max 80 chars), "summary": string (2-3 sentences naming specific buyers with amounts), "details": { "buyerNames": [], "metric": "" } } ] }

Categories: new_customer | top_spender | dormant | retention | risk
Rules: name specific buyers with their exact spend and order counts. Identify retention risks, re-engagement opportunities, and emerging high-value relationships.`,
    strategies, strategies.customerStrategy, 'Customer'
  );

  const signals = await callAgent(openai, orgId, systemPrompt, ctx);
  await upsertSignals(orgId, 'customer', signals);
  console.log(`[AgentTeam] Customer agent generated ${signals.length} signals for ${orgId}`);
  return signals.length;
}

// ─── RUN ALL AGENTS ──────────────────────────────────────────────────────────

export async function runAllAgents(orgId: string): Promise<Record<AgentId, number>> {
  const results: Record<AgentId, number> = { inventory: 0, pricing: 0, market: 0, orders: 0, customer: 0 };
  const agents: [AgentId, (orgId: string) => Promise<number>][] = [
    ['inventory', runInventoryAgent],
    ['pricing', runPricingAgent],
    ['market', runMarketAgent],
    ['orders', runOrdersAgent],
    ['customer', runCustomerAgent],
  ];
  await Promise.all(agents.map(async ([id, fn]) => {
    try {
      results[id] = await fn(orgId);
    } catch (err: any) {
      console.error(`[AgentTeam] ${id} agent failed for ${orgId} (non-fatal):`, err.message);
    }
  }));
  return results;
}

// ─── FETCH SIGNALS FOR E.L.F.I.E. ───────────────────────────────────────────

export async function getAgentSignals(
  orgId: string,
  agentIds?: AgentId[],
  limit = 25,
): Promise<Array<{ agentId: string | null; category: string; urgency: string; title: string; summary: string; details: any; createdAt: Date }>> {
  const conditions = [
    eq(businessInsights.orgId, orgId),
    eq(businessInsights.dismissed, false),
    or(isNull(businessInsights.expiresAt), sql`${businessInsights.expiresAt} > NOW()`),
  ];

  if (agentIds && agentIds.length > 0) {
    conditions.push(inArray(businessInsights.agentId, agentIds));
  } else {
    conditions.push(ne(businessInsights.agentId, 'general' as any));
  }

  return db.select({
    agentId: businessInsights.agentId,
    category: businessInsights.category,
    urgency: businessInsights.urgency,
    title: businessInsights.title,
    summary: businessInsights.summary,
    details: businessInsights.details,
    createdAt: businessInsights.createdAt,
  })
    .from(businessInsights)
    .where(and(...conditions))
    .orderBy(desc(businessInsights.createdAt))
    .limit(limit);
}
