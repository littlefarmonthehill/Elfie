/**
 * Agent Team — six domain-specialized background agents that each maintain
 * a running picture of one area of the business. Their signals are written to
 * business_insights (tagged with agent_id) and can be retrieved by E.L.F.I.E.
 *
 * Agent hierarchy:
 *   catalog    — runs FIRST; enriches all domain agents with market/catalog intel
 *   inventory  — stock health, DOS, stockout risk, capital concentration, GMROI
 *   pricing    — pricing gaps, capture rate, revenue at risk, repricing momentum
 *   market     — retirement trajectory, supply squeeze, demand surges, seasonality
 *   orders     — revenue velocity, AOV, channel mix, fulfillment readiness
 *   customer   — RFM segmentation, CLV, churn signals, retention health
 *
 * E.L.F.I.E. is the front voice — she synthesises all agent signals into a
 * unified business narrative when the user asks for a briefing.
 */

import { db } from "../db";
import {
  businessInsights, blInventory, blCatalog,
  marketNews, blForumPosts, platformSettings, pomPriceDecisions, ieStrategies,
} from "@shared/schema";
import { eq, and, sql, desc, gte, ne, isNull, or, inArray } from "drizzle-orm";
import OpenAI from "openai";

export type AgentId = 'inventory' | 'pricing' | 'market' | 'orders' | 'customer' | 'catalog';

const SIGNAL_TTL_HOURS = 168;

async function getOpenAI(): Promise<OpenAI | null> {
  try {
    const [row] = await db.select({ key: platformSettings.openaiApiKey })
      .from(platformSettings).where(eq(platformSettings.id, 'platform')).limit(1);
    const key = row?.key;
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
    parts.push(`\nDEFINING SUCCESS (Vivid Vision — what the future looks like when the business wins):\n"${strategies.successFactors.trim()}"\nUse this to understand the outcomes the owner is driving toward. Signals that accelerate this future should be elevated.`);
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

/** Upsert a single-sentence flash report for the agent — stored as category "flash_report". */
async function upsertFlashReport(orgId: string, agentId: AgentId, flashReport: string) {
  if (!flashReport?.trim()) return;
  const FLASH_TITLE = `__flash_${agentId}__`;
  const expiresAt = new Date(Date.now() + SIGNAL_TTL_HOURS * 60 * 60 * 1000);
  try {
    const existing = await db.select({ id: businessInsights.id })
      .from(businessInsights)
      .where(and(
        eq(businessInsights.orgId, orgId),
        eq(businessInsights.agentId, agentId),
        eq(businessInsights.title, FLASH_TITLE),
      )).limit(1);

    if (existing.length > 0) {
      await db.update(businessInsights)
        .set({ summary: flashReport.trim(), category: 'flash_report', urgency: 'info', expiresAt, updatedAt: new Date() })
        .where(eq(businessInsights.id, existing[0].id));
    } else {
      await db.insert(businessInsights).values({
        orgId,
        agentId,
        category: 'flash_report',
        urgency: 'info',
        title: FLASH_TITLE,
        summary: flashReport.trim(),
        details: null,
        sourceType: agentId,
        expiresAt,
      });
    }
  } catch { /* non-fatal */ }
}

interface AgentResult {
  signals: any[];
  flashReport: string | null;
}

async function callAgent(openai: OpenAI, orgId: string, systemPrompt: string, dataContext: string): Promise<AgentResult> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: dataContext },
    ],
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 2400,
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
  return {
    signals: Array.isArray(parsed.signals) ? parsed.signals : [],
    flashReport: typeof parsed.flashReport === 'string' ? parsed.flashReport : null,
  };
}

// ─── CATALOG ENRICHMENT HELPERS ─────────────────────────────────────────────

async function buildCatalogEnrichmentContext(orgId: string): Promise<string> {
  try {
    const enriched = await db.execute(sql`
      SELECT bi.item_no, bc.item_name, bcat.name AS category_name,
             bi.quantity, bi.unit_price::numeric as our_price,
             pgc.sold_avg_price::numeric  as market_avg,
             pgc.sold_max_price::numeric  as market_max,
             pgc.sold_quantity            as market_demand,
             pgc.stock_total_lots         as competing_lots,
             ROUND(
               ((bi.unit_price::numeric - pgc.sold_avg_price::numeric)
                / NULLIF(pgc.sold_avg_price::numeric, 0)) * 100, 1
             ) as price_gap_pct,
             ROUND(
               pgc.sold_quantity::numeric / NULLIF(pgc.stock_total_lots::numeric, 0), 2
             ) as mdi
      FROM bl_inventory bi
      LEFT JOIN bl_catalog bc
        ON  bi.item_no   = bc.item_no
        AND bi.item_type = bc.item_type
        AND bi.color_id  = bc.color_id
      LEFT JOIN bl_categories bcat ON bc.category_id = bcat.id
      LEFT JOIN price_guide_cache pgc
        ON  bi.item_no      = pgc.item_no
        AND bi.item_type    = pgc.item_type
        AND bi.color_id     = pgc.color_id
        AND bi.new_or_used  = pgc.new_or_used
      WHERE bi.org_id = ${orgId}
        AND bi.quantity > 0
        AND pgc.sold_avg_price IS NOT NULL
        AND pgc.sold_avg_price::numeric > 0
      ORDER BY (bi.quantity::numeric * pgc.sold_avg_price::numeric) DESC
      LIMIT 40
    `);

    const highDemand = (enriched.rows as any[]).filter((r: any) => Number(r.market_demand || 0) > 100);
    const underpriced = (enriched.rows as any[]).filter((r: any) => Number(r.price_gap_pct || 0) < -25).slice(0, 8);
    const overpriced  = (enriched.rows as any[]).filter((r: any) => Number(r.price_gap_pct || 0) > 25).slice(0, 8);

    const lines: string[] = ['CATALOG & MARKET ENRICHMENT (platform data cross-referenced with org inventory):'];

    if (highDemand.length > 0) {
      lines.push(`\nHIGH-DEMAND HELD ITEMS (market sold_qty > 100, MDI = sold÷lots):`);
      highDemand.slice(0, 10).forEach((r: any) =>
        lines.push(`  ${r.item_no} "${r.item_name || '?'}" [${r.category_name || '?'}] qty:${r.quantity} @$${Number(r.our_price).toFixed(3)} | mkt_avg:$${Number(r.market_avg).toFixed(3)} demand:${r.market_demand} lots:${r.competing_lots || '?'} MDI:${r.mdi || '?'}`)
      );
    }

    if (underpriced.length > 0) {
      lines.push(`\nSIGNIFICANTLY UNDERPRICED (>25% below market sold avg):`);
      underpriced.forEach((r: any) =>
        lines.push(`  ${r.item_no} "${r.item_name || '?'}" our:$${Number(r.our_price).toFixed(3)} mkt_avg:$${Number(r.market_avg).toFixed(3)} gap:${r.price_gap_pct}% qty:${r.quantity} MDI:${r.mdi || '?'}`)
      );
    }

    if (overpriced.length > 0) {
      lines.push(`\nSIGNIFICANTLY OVERPRICED (>25% above market sold avg):`);
      overpriced.forEach((r: any) =>
        lines.push(`  ${r.item_no} "${r.item_name || '?'}" our:$${Number(r.our_price).toFixed(3)} mkt_avg:$${Number(r.market_avg).toFixed(3)} gap:${r.price_gap_pct}% qty:${r.quantity}`)
      );
    }

    return lines.join('\n');
  } catch { return ''; }
}

async function getExistingCatalogSignals(orgId: string): Promise<string> {
  try {
    const signals = await db.select({
      title: businessInsights.title,
      summary: businessInsights.summary,
      urgency: businessInsights.urgency,
    })
      .from(businessInsights)
      .where(and(
        eq(businessInsights.orgId, orgId),
        eq(businessInsights.agentId, 'catalog' as any),
        eq(businessInsights.dismissed, false),
        or(isNull(businessInsights.expiresAt), sql`${businessInsights.expiresAt} > NOW()`),
      ))
      .orderBy(desc(businessInsights.createdAt))
      .limit(6);

    if (signals.length === 0) return '';
    const lines = ['CATALOG INTELLIGENCE (Catalog Agent signals — cross-reference these with your domain data):'];
    signals.forEach(s => lines.push(`  [${s.urgency}] ${s.title}: ${s.summary}`));
    return lines.join('\n');
  } catch { return ''; }
}

// ─── CATALOG AGENT ──────────────────────────────────────────────────────────

export async function runCatalogAgent(orgId: string): Promise<number> {
  const openai = await getOpenAI();
  if (!openai) return 0;

  const catalogEnrichment = await buildCatalogEnrichmentContext(orgId);

  const priceSpread = await db.execute(sql`
    SELECT pgc.item_no, bc.item_name, bcat.name AS category_name,
           pgc.sold_avg_price::numeric  as sold_avg,
           pgc.sold_max_price::numeric  as sold_max,
           pgc.sold_quantity,
           pgc.stock_total_lots,
           ROUND(pgc.sold_max_price::numeric / NULLIF(pgc.sold_avg_price::numeric, 0), 2) as psr,
           ROUND(pgc.sold_quantity::numeric / NULLIF(pgc.stock_total_lots::numeric, 0), 2) as mdi,
           bi.quantity                  as our_qty,
           bi.unit_price::numeric       as our_price
    FROM price_guide_cache pgc
    LEFT JOIN bl_catalog bc
      ON pgc.item_no = bc.item_no AND pgc.item_type = bc.item_type AND pgc.color_id = bc.color_id
    LEFT JOIN bl_categories bcat ON bc.category_id = bcat.id
    LEFT JOIN bl_inventory bi
      ON pgc.item_no = bi.item_no AND pgc.item_type = bi.item_type
     AND pgc.color_id = bi.color_id AND bi.org_id = ${orgId}
    WHERE pgc.sold_quantity > 30
      AND pgc.sold_max_price::numeric > pgc.sold_avg_price::numeric * 1.5
    ORDER BY pgc.sold_quantity DESC
    LIMIT 20
  `);

  const news = await db.select({ title: marketNews.title, snippet: marketNews.snippet, source: marketNews.source })
    .from(marketNews)
    .where(gte(marketNews.publishedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)))
    .orderBy(desc(marketNews.publishedAt))
    .limit(8);

  const forum = await db.select({ title: blForumPosts.title, replyCount: blForumPosts.replyCount })
    .from(blForumPosts)
    .where(gte(blForumPosts.postedAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)))
    .orderBy(desc(blForumPosts.replyCount))
    .limit(6);

  const ctx = `${catalogEnrichment}

HIGH PRICE-SPREAD CATALOG ITEMS (PSR = sold_max ÷ sold_avg; MDI = sold_qty ÷ stock_lots):
${(priceSpread.rows as any[]).map((r: any) =>
  `  ${r.item_no} "${r.item_name || '?'}" [${r.category_name || '?'}] avg:$${Number(r.sold_avg).toFixed(3)} max:$${Number(r.sold_max).toFixed(3)} PSR:${r.psr} MDI:${r.mdi} demand:${r.sold_quantity} lots:${r.stock_total_lots}${r.our_qty != null ? ` | WE HAVE:${r.our_qty} @$${Number(r.our_price).toFixed(3)}` : ' | NOT IN STOCK'}`
).join('\n')}

MARKET HEADLINES (last 7d):
${news.map(n => `  [${n.source || '?'}] ${n.title}${n.snippet ? ' — ' + String(n.snippet).substring(0, 80) : ''}`).join('\n') || '  None'}

COMMUNITY HOT TOPICS (last 7d, by replies):
${forum.map(f => `  [${f.replyCount} replies] ${f.title}`).join('\n') || '  None'}`.trim();

  const strategies = await getOrgStrategies(orgId);
  const systemPrompt = buildSystemPrompt(
    `You are the Catalog Intelligence Agent ("Catalog") for a LEGO reseller on the E.L.F.I.E. platform. You run FIRST in the agent pipeline — your signals are consumed by all other domain agents (Inventory, Pricing, Market, Orders, Customer) as shared enrichment context. E.L.F.I.E. synthesises the combined output of all agents into a unified business voice for the owner.

YOUR MANDATE: Cross-reference the org's live inventory against the platform-wide parts catalog, price guide data, market news, and community signals to surface catalog-level intelligence.

INDUSTRY FRAMEWORKS TO APPLY:
- Market Demand Index (MDI): sold_quantity ÷ stock_total_lots — high MDI = strong turnover vs available supply
- Price Spread Ratio (PSR): sold_max ÷ sold_avg — above 1.5 = collector/speculator premium demand
- Supply Squeeze: few competing lots + high MDI + rising PSR = supply squeeze signal
- Retirement Trajectory: news + forum + low stock_total_lots = potential retirement wave; early acquisition = high ROI
- Acquisition Opportunity: high MDI item where org has zero stock = acquisition signal

CROSS-AGENT OUTPUTS (tag signals when they require action from another agent):
- [→ INVENTORY]: item with high MDI + org stock running low — flag for restock
- [→ PRICING]: underpriced item with high MDI — leaving money on the table
- [→ MARKET]: news/forum signal that affects a specific held item — escalate with item number
- If org has dead stock AND the market MDI is actually good, flag the contradiction for Inventory agent

OUTPUT FORMAT (JSON ONLY):
{
  "flashReport": "One sentence: current catalog health and the single most important signal. Include a specific item number and metric.",
  "signals": [
    {
      "category": "demand_trend|price_opportunity|acquisition|market_intel|supply_squeeze|risk",
      "urgency": "high|medium|low",
      "title": "max 80 chars",
      "summary": "2-3 sentences in plain business English — write for a store owner, not a financial analyst. Always spell out abbreviations on first use (e.g. 'PSR (Price Spread Ratio)', 'MDI (Market Demand Index)'). Cite item numbers, dollar amounts, and demand/supply figures. Cross-tag other agents where relevant.",
      "details": { "itemNos": [], "mdi": 0, "psr": 0, "estimatedImpact": "" }
    }
  ]
}

RULES: Every signal must include at least one specific item number and a measurable metric (MDI, PSR, or dollar value). No generic advice. Minimum 3, maximum 6 signals. LANGUAGE: Write in plain, everyday business language — as if briefing the shop owner at the end of the day. Always spell out every abbreviation the first time it appears in a signal (PSR = Price Spread Ratio, MDI = Market Demand Index, DOS = Days of Supply, AOV = Average Order Value, CLV = Customer Lifetime Value, RFM = buyer scoring method). Prefer plain phrasing where possible.`,
    strategies, strategies.marketStrategy, 'Catalog Intelligence'
  );

  const result = await callAgent(openai, orgId, systemPrompt, ctx);
  await upsertSignals(orgId, 'catalog', result.signals);
  if (result.flashReport) await upsertFlashReport(orgId, 'catalog', result.flashReport);
  console.log(`[AgentTeam] Catalog agent generated ${result.signals.length} signals for ${orgId}`);
  return result.signals.length;
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

  // DOS = qty ÷ (sold_90d ÷ 90). Velocity tiers: A >20/90d, B 5-20, C 1-5, D 0
  const withDos = inventory.map(i => {
    const sold90 = soldMap.get(i.itemNo)?.qty ?? 0;
    const dailyRate = sold90 / 90;
    const dos = dailyRate > 0 ? Math.round(i.quantity / dailyRate) : Infinity;
    const tier = sold90 > 20 ? 'A' : sold90 >= 5 ? 'B' : sold90 >= 1 ? 'C' : 'D';
    return { ...i, sold90, dos, tier, value: i.quantity * parseFloat(i.unitPrice || '0') };
  });

  const stockoutRisk = withDos.filter(i => i.tier === 'A' && i.dos < 21).slice(0, 10);
  const deadStock = withDos.filter(i => i.tier === 'D' && i.quantity > 20).slice(0, 15);
  const highDos = withDos.filter(i => i.tier !== 'D' && i.dos > 180 && i.quantity > 10).slice(0, 10);

  // Capital concentration: top items by value
  const byValue = [...withDos].sort((a, b) => b.value - a.value);
  const top10Value = byValue.slice(0, 10).reduce((s, i) => s + i.value, 0);
  const concentrationPct = totalValue > 0 ? ((top10Value / totalValue) * 100).toFixed(1) : '0';

  const ctx = `
INVENTORY SUMMARY:
Total SKUs: ${inventory.length} | Total value: $${totalValue.toFixed(2)} | Top 10 items = ${concentrationPct}% of total value
Velocity A-items (>20 sold/90d): ${withDos.filter(i => i.tier === 'A').length} | B (5-20): ${withDos.filter(i => i.tier === 'B').length} | C (1-5): ${withDos.filter(i => i.tier === 'C').length} | D (0 sales): ${withDos.filter(i => i.tier === 'D').length}

STOCKOUT RISK (Tier A items, DOS < 21 days — reorder URGENTLY):
${stockoutRisk.map(i => `  ${i.itemNo} "${i.itemName || '?'}" qty:${i.quantity} sold:${i.sold90}/90d DOS:${i.dos}d @$${i.unitPrice} value:$${i.value.toFixed(2)}`).join('\n') || '  None detected'}

DEAD STOCK (Tier D, qty > 20, zero 90d sales — liquidation candidates):
${deadStock.map(i => `  ${i.itemNo} "${i.itemName || '?'}" ${i.colorName || ''} qty:${i.quantity} @$${i.unitPrice} value:$${i.value.toFixed(2)}`).join('\n') || '  None'}

HIGH DOS SLOW MOVERS (DOS > 180d — capital trap risk):
${highDos.map(i => `  ${i.itemNo} "${i.itemName || '?'}" qty:${i.quantity} sold:${i.sold90}/90d DOS:${i.dos === Infinity ? '∞' : i.dos + 'd'} @$${i.unitPrice} value:$${i.value.toFixed(2)}`).join('\n') || '  None'}

LARGEST CAPITAL HOLDINGS (top 15 by value):
${byValue.slice(0, 15).map(i => `  ${i.itemNo} "${i.itemName || '?'}" qty:${i.quantity} @$${i.unitPrice} = $${i.value.toFixed(2)} [Tier ${i.tier}] DOS:${i.dos === Infinity ? '∞' : i.dos + 'd'}`).join('\n')}
`.trim();

  const catalogCtx = await getExistingCatalogSignals(orgId);
  const fullCtx = catalogCtx ? `${ctx}\n\n${catalogCtx}` : ctx;

  const strategies = await getOrgStrategies(orgId);
  const systemPrompt = buildSystemPrompt(
    `You are the Inventory Agent ("Inventory") for a LEGO reseller on the E.L.F.I.E. platform. You report to E.L.F.I.E., who synthesises your signals alongside Catalog, Pricing, Market, Orders, and Customer agents into a unified business voice for the owner.

YOUR MANDATE: Maintain a real-time picture of stock health, capital efficiency, and fulfillment readiness.

INDUSTRY FRAMEWORKS TO APPLY:
- Days of Supply (DOS): qty ÷ daily_sell_rate. DOS < 14d = stockout imminent; DOS 14-21d = reorder now; DOS > 180d = dead capital
- Velocity Tiers: A (>20 sold/90d) = hero SKUs; B (5-20) = regular; C (1-5) = slow; D (0) = dead
- Capital Concentration: if top 10 items > 40% of total value, flag concentration risk
- GMROI proxy: (sold_qty × unit_price) ÷ (avg_qty × unit_price) — high = capital working hard
- Stockout Risk Score: Tier-A item with DOS < 21d = HIGH; Tier-B with DOS < 14d = MEDIUM
- Dead Stock Liquidation Value: qty × unit_price × 0.6 (assume 40% markdown to clear)

CROSS-AGENT OUTPUTS (tag signals requiring another agent's action):
- [→ PRICING]: dead stock → suggest price cut to clear
- [→ CATALOG]: if Catalog flags high-MDI item you're low on → corroborate with your DOS data
- [→ ORDERS]: if stockout risk on your Tier-A items → Orders agent should surface this as fulfillment risk

OUTPUT FORMAT (JSON ONLY):
{
  "flashReport": "One plain-English sentence: current inventory health, days of stock remaining on the top risk item, and total capital at risk. Write it so a non-expert understands — e.g. 'Running low on X with only 8 days of stock left; $1,200 tied up in slow-moving parts.'",
  "signals": [
    {
      "category": "restock|overstock|dead_stock|capital_risk|stockout_risk|opportunity",
      "urgency": "high|medium|low",
      "title": "max 80 chars",
      "summary": "2-3 sentences in plain business English — write for a store owner, not a warehouse analyst. Always spell out abbreviations on first use (e.g. 'DOS (Days of Supply)', 'SKU (individual product)'). Cite item numbers, dollar values, days of stock remaining, and estimated impact.",
      "details": { "itemNos": [], "dos": 0, "velocityTier": "A|B|C|D", "capitalAtRisk": 0 }
    }
  ]
}

RULES: Cite specific item numbers, DOS, and capital values. For dead stock, state liquidation value. For stockout risk, state estimated lost revenue if not restocked. Minimum 3, maximum 6 signals. No generic advice. LANGUAGE: Write in plain, everyday business language — as if briefing the shop owner at the end of the day. Always spell out every abbreviation the first time it appears in a signal (DOS = Days of Supply, SKU = individual product, GMROI = return on inventory investment). Prefer plain phrasing where possible — say "you'll run out in X days" rather than just "DOS: X".`,
    strategies, strategies.inventoryStrategy, 'Inventory'
  );

  const result = await callAgent(openai, orgId, systemPrompt, fullCtx);
  await upsertSignals(orgId, 'inventory', result.signals);
  if (result.flashReport) await upsertFlashReport(orgId, 'inventory', result.flashReport);
  console.log(`[AgentTeam] Inventory agent generated ${result.signals.length} signals for ${orgId}`);
  return result.signals.length;
}

// ─── PRICING AGENT ──────────────────────────────────────────────────────────

export async function runPricingAgent(orgId: string): Promise<number> {
  const openai = await getOpenAI();
  if (!openai) return 0;

  const gapData = await db.execute(sql`
    SELECT bi.item_no, bc.item_name, bi.unit_price::numeric, bi.quantity,
           pgc.stock_avg_price::numeric as market_avg, pgc.sold_avg_price::numeric as sold_avg,
           pgc.sold_max_price::numeric as sold_max, pgc.stock_total_lots,
           pgc.sold_quantity,
           ROUND(((bi.unit_price::numeric - pgc.sold_avg_price::numeric) / NULLIF(pgc.sold_avg_price::numeric,0))*100,1) as gap_pct,
           ROUND(bi.unit_price::numeric / NULLIF(pgc.sold_max_price::numeric,0), 3) as capture_rate,
           ROUND(bi.unit_price::numeric / NULLIF(pgc.stock_avg_price::numeric,0), 3) as vs_market
    FROM bl_inventory bi
    LEFT JOIN bl_catalog bc ON bi.item_no=bc.item_no AND bi.item_type=bc.item_type AND bi.color_id=bc.color_id
    LEFT JOIN price_guide_cache pgc ON bi.item_no=pgc.item_no AND bi.item_type=pgc.item_type AND bi.color_id=pgc.color_id AND bi.new_or_used=pgc.new_or_used
    WHERE bi.org_id=${orgId} AND pgc.sold_avg_price IS NOT NULL AND pgc.sold_avg_price::numeric > 0 AND bi.unit_price::numeric > 0
    ORDER BY ABS(bi.unit_price::numeric - pgc.sold_avg_price::numeric) DESC
    LIMIT 50
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

  // Revenue at risk: for underpriced, potential gain = (sold_avg - our_price) * qty
  const revenueGainIfFixed = underpriced.reduce((s: number, g: any) =>
    s + (Number(g.sold_avg) - Number(g.unit_price)) * Number(g.quantity), 0);
  const revenueRiskIfStuck = overpriced.reduce((s: number, g: any) =>
    s + (Number(g.unit_price) - Number(g.sold_avg)) * Number(g.quantity), 0);

  const avgDelta = recentDecisions.length > 0
    ? recentDecisions.reduce((s, d) => s + (d.priceDelta ? Number(d.priceDelta) : 0), 0) / recentDecisions.length
    : null;

  // Low capture rate items: our price < 70% of sold_max (room to raise significantly)
  const lowCapture = gaps.filter((g: any) => Number(g.capture_rate || 0) < 0.70 && Number(g.gap_pct) < 0).slice(0, 8);

  const ctx = `
PRICING GAPS (your price vs. market sold avg):

UNDERPRICED (>20% below sold avg, ${underpriced.length} items, potential revenue gain: $${revenueGainIfFixed.toFixed(2)}):
${underpriced.map((g: any) => `  ${g.item_no} "${g.item_name || '?'}" — OUR:$${Number(g.unit_price).toFixed(2)} SOLD_AVG:$${Number(g.sold_avg).toFixed(2)} SOLD_MAX:$${Number(g.sold_max).toFixed(2)} gap:${g.gap_pct}% capture:${g.capture_rate} qty:${g.quantity} gain_if_fixed:$${((Number(g.sold_avg)-Number(g.unit_price))*Number(g.quantity)).toFixed(2)}`).join('\n')}

OVERPRICED (>20% above sold avg, ${overpriced.length} items, revenue-at-risk: $${revenueRiskIfStuck.toFixed(2)}):
${overpriced.map((g: any) => `  ${g.item_no} "${g.item_name || '?'}" — OUR:$${Number(g.unit_price).toFixed(2)} SOLD_AVG:$${Number(g.sold_avg).toFixed(2)} (${Number(g.gap_pct) > 0 ? '+' : ''}${g.gap_pct}% gap) qty:${g.quantity}`).join('\n')}

LOW CEILING CAPTURE (capture_rate < 0.70 — significant room to raise price):
${lowCapture.map((g: any) => `  ${g.item_no} "${g.item_name || '?'}" — OUR:$${Number(g.unit_price).toFixed(2)} SOLD_MAX:$${Number(g.sold_max).toFixed(2)} capture:${g.capture_rate} demand:${g.sold_quantity}`).join('\n') || '  None identified'}

REPRICING MOMENTUM (last ${recentDecisions.length} POM decisions):
${recentDecisions.slice(0, 10).map(d => `  ${d.itemNo} set $${Number(d.actualPrice).toFixed(2)}${d.suggestedPrice ? ` (POM suggested $${Number(d.suggestedPrice).toFixed(2)}, delta ${Number(d.priceDelta) >= 0 ? '+' : ''}${Number(d.priceDelta ?? 0).toFixed(2)})` : ''}`).join('\n')}
${avgDelta !== null ? `Average pricing delta vs POM: ${avgDelta >= 0 ? '+' : ''}$${avgDelta.toFixed(3)} (${avgDelta > 0.01 ? 'systematically PRICING ABOVE POM' : avgDelta < -0.01 ? 'systematically PRICING BELOW POM' : 'aligned with POM suggestions'})` : '  No decisions logged'}
`.trim();

  const catalogCtxP = await getExistingCatalogSignals(orgId);
  const fullCtxP = catalogCtxP ? `${ctx}\n\n${catalogCtxP}` : ctx;

  const strategies = await getOrgStrategies(orgId);
  const systemPrompt = buildSystemPrompt(
    `You are the Pricing Agent ("Pricing") for a LEGO reseller on the E.L.F.I.E. platform. You report to E.L.F.I.E., who synthesises your signals alongside Catalog, Inventory, Market, Orders, and Customer agents into a unified business voice for the owner.

YOUR MANDATE: Identify pricing gaps, competitive positions, and revenue maximisation opportunities across the full inventory.

INDUSTRY FRAMEWORKS TO APPLY:
- Price Positioning: our_price ÷ sold_avg. Below 0.80 = leaving money on the table; above 1.20 = risk of slow sales
- Ceiling Capture Rate: our_price ÷ sold_max. Below 0.70 = significant upside; above 0.95 = pricing at ceiling
- Revenue at Risk (underpriced): (sold_avg − our_price) × qty = money left on the table per lot
- Revenue at Risk (overpriced): (our_price − sold_avg) × qty = slow-moving capital at risk
- Repricing Momentum: systematic avg delta vs POM reveals owner's pricing culture (above = premium bias; below = discount bias)
- Undercut Ratio: our_price ÷ market_min (from POM data). Below 1.0 = we're cheapest; above 1.0 = being undercut
- Low Capture Rate: capture_rate < 0.70 = we have significant room to raise price toward the ceiling

CROSS-AGENT OUTPUTS:
- [→ INVENTORY]: items with overpriced + high DOS = double jeopardy — cut price AND it frees capital
- [→ CATALOG]: if Catalog flags high-MDI item we're underpricing → escalate urgency
- [→ MARKET]: if market is reporting supply squeeze on items we hold → recommend price raise now

OUTPUT FORMAT (JSON ONLY):
{
  "flashReport": "One sentence: total revenue at risk from mispriced inventory, top opportunity item. Include dollar amounts.",
  "signals": [
    {
      "category": "underpriced|overpriced|competitive_position|repricing_pattern|opportunity|risk",
      "urgency": "high|medium|low",
      "title": "max 80 chars",
      "summary": "2-3 sentences in plain business English — write for a store owner, not a pricing analyst. Always spell out abbreviations on first use (e.g. 'capture rate (how close our price is to the highest price the market pays)'). Cite specific item numbers, exact prices, and the dollar value of the opportunity.",
      "details": { "itemNos": [], "revenueAtRisk": 0, "captureRate": 0 }
    }
  ]
}

RULES: Every signal must include a dollar-value revenue impact. Cite specific item numbers, exact prices, and capture rates. Minimum 3, maximum 5 signals. No generic advice. LANGUAGE: Write in plain, everyday business language — as if briefing the shop owner at the end of the day. Always spell out every abbreviation the first time it appears in a signal (AOV = Average Order Value, POM = pricing tool suggestion, capture rate = our price as a share of the highest market price). Say "we could earn $X more" rather than "revenue at risk: $X". Prefer plain phrasing over analyst shorthand.`,
    strategies, strategies.pricingStrategy, 'Pricing'
  );

  const result = await callAgent(openai, orgId, systemPrompt, fullCtxP);
  await upsertSignals(orgId, 'pricing', result.signals);
  if (result.flashReport) await upsertFlashReport(orgId, 'pricing', result.flashReport);
  console.log(`[AgentTeam] Pricing agent generated ${result.signals.length} signals for ${orgId}`);
  return result.signals.length;
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
           ROUND(pgc.sold_max_price::numeric / NULLIF(pgc.sold_avg_price::numeric, 0), 2) as psr,
           ROUND(pgc.sold_quantity::numeric / NULLIF(pgc.stock_total_lots::numeric, 0), 2) as mdi,
           bi.quantity as our_qty,
           bi.unit_price::numeric as our_price
    FROM price_guide_cache pgc
    LEFT JOIN bl_catalog bc ON pgc.item_no=bc.item_no AND pgc.item_type=bc.item_type AND pgc.color_id=bc.color_id
    LEFT JOIN bl_inventory bi ON pgc.item_no=bi.item_no AND pgc.item_type=bi.item_type AND pgc.color_id=bi.color_id AND bi.org_id=${orgId}
    WHERE pgc.sold_quantity > 50 AND pgc.sold_max_price::numeric > pgc.sold_avg_price::numeric * 1.5
    ORDER BY pgc.sold_max_price::numeric DESC
    LIMIT 20
  `);

  // Current month for seasonal context
  const month = new Date().getMonth() + 1;
  const season = month >= 10 ? 'Q4 Peak (holiday demand surge)' : month <= 2 ? 'Post-holiday cool-down' : month >= 6 && month <= 8 ? 'Summer lull' : 'Mid-year steady';

  const ctx = `
SEASONAL CONTEXT: ${season} (month ${month})

MARKET NEWS (last 7 days, ${recentNews.length} articles):
${recentNews.map(n => `  [${n.source || '?'}] ${n.title}${n.snippet ? ' — ' + n.snippet.substring(0, 100) : ''}`).join('\n') || '  None'}

BRICKLINK FORUM HOT TOPICS (last 7 days, by replies):
${recentForum.map(f => `  [${f.replyCount} replies] ${f.title}${f.excerpt ? ' — ' + f.excerpt.substring(0, 80) : ''}`).join('\n') || '  None'}

HIGH PSR ITEMS IN MARKET (PSR = sold_max÷sold_avg; MDI = sold÷lots — collector/squeeze signals):
${(priceMoves.rows as any[]).slice(0, 15).map((r: any) => `  ${r.item_no} "${r.item_name || '?'}" sold_avg:$${Number(r.sold_avg).toFixed(2)} sold_max:$${Number(r.sold_max).toFixed(2)} PSR:${r.psr} MDI:${r.mdi} demand:${r.sold_quantity} lots:${r.stock_total_lots}${r.our_qty != null ? ` — WE HOLD: qty:${r.our_qty} @$${Number(r.our_price).toFixed(2)}` : ' — NOT IN STOCK'}`).join('\n') || '  None'}
`.trim();

  const catalogCtxM = await getExistingCatalogSignals(orgId);
  const fullCtxM = catalogCtxM ? `${ctx}\n\n${catalogCtxM}` : ctx;

  const strategies = await getOrgStrategies(orgId);
  const systemPrompt = buildSystemPrompt(
    `You are the Market Intelligence Agent ("Market") for a LEGO reseller on the E.L.F.I.E. platform. You report to E.L.F.I.E., who synthesises your signals alongside Catalog, Inventory, Pricing, Orders, and Customer agents into a unified business voice for the owner.

YOUR MANDATE: Monitor external signals — news, forum discussions, price movements, seasonal patterns — and translate them into specific inventory and pricing implications.

INDUSTRY FRAMEWORKS TO APPLY:
- Retirement Trajectory: news + forum discussion + declining stock_total_lots = retirement wave; typical price appreciation +30-60% within 6 months of EOL
- Supply Squeeze Detection: high MDI + declining lots + PSR > 1.5 + forum buzz = supply squeeze; raise prices and consider acquiring more
- Demand Surge Signal: high forum reply count + news mentions + rising sold_quantity = demand event; check inventory coverage
- Price Spread Ratio (PSR): sold_max ÷ sold_avg > 1.5 = collector/speculator premium; above 2.0 = significant speculation
- Seasonal Context: align signals to known LEGO demand cycles (Q4 peak, post-holiday dip, summer lull)
- Market Sentiment: forum reply volume as a leading indicator of community interest in specific parts/sets

CROSS-AGENT OUTPUTS:
- [→ INVENTORY]: demand surge or supply squeeze on held items → restock urgently
- [→ PRICING]: supply squeeze or retirement signal on held items → raise prices now
- [→ CATALOG]: retirement signal on items org does NOT stock → acquisition opportunity before price spike

OUTPUT FORMAT (JSON ONLY):
{
  "flashReport": "One sentence: market summary, most significant external signal today, and which held items are affected. Be specific.",
  "signals": [
    {
      "category": "retirement_risk|demand_surge|supply_squeeze|market_intel|seasonal|opportunity",
      "urgency": "high|medium|low",
      "title": "max 80 chars",
      "summary": "2-3 sentences in plain business English — write for a store owner, not a market analyst. Always spell out abbreviations on first use (e.g. 'PSR (Price Spread Ratio — how far the top price is above the average)', 'EOL (End of Life — LEGO retiring the part)'). Connect the external signal to a specific, concrete business action.",
      "details": { "source": "", "itemNos": [], "priceImpactEstimate": "" }
    }
  ]
}

RULES: Every signal must connect to at least one specific item number or category in the org's inventory (or a clear acquisition opportunity). Cite exact prices, PSR, MDI, forum reply counts, and news sources. Minimum 3, maximum 6 signals. LANGUAGE: Write in plain, everyday business language — as if briefing the shop owner at the end of the day. Always spell out every abbreviation the first time it appears in a signal (PSR = Price Spread Ratio, MDI = Market Demand Index, EOL = LEGO retiring the part, STR = Sell-Through Rate). Say "buyers are paying up to 2× the normal price" rather than just "PSR: 2.0". Prefer concrete, actionable phrasing.`,
    strategies, strategies.marketStrategy, 'Market Intelligence'
  );

  const result = await callAgent(openai, orgId, systemPrompt, fullCtxM);
  await upsertSignals(orgId, 'market', result.signals);
  if (result.flashReport) await upsertFlashReport(orgId, 'market', result.flashReport);
  console.log(`[AgentTeam] Market agent generated ${result.signals.length} signals for ${orgId}`);
  return result.signals.length;
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
      AVG(o.order_total::numeric) as aov,
      o.marketplace
    FROM orders o
    WHERE o.org_id=${orgId} AND o.order_date >= ${sixtyDaysAgo}
      AND o.order_status NOT IN ('cancelled','purged')
    GROUP BY week, o.marketplace
    ORDER BY week DESC, revenue DESC
  `);

  const topSKUs = await db.execute(sql`
    SELECT
      od.item_no,
      (SELECT item_name FROM bl_catalog WHERE item_no = od.item_no LIMIT 1) as item_name,
      SUM(od.quantity) as sold_qty,
      AVG(od.unit_price::numeric) as avg_price,
      COUNT(DISTINCT o.id) as order_count,
      SUM(od.quantity * od.unit_price::numeric) as revenue
    FROM order_details od
    JOIN orders o ON od.order_id=o.id
    WHERE o.org_id=${orgId} AND o.order_date >= ${thirtyDaysAgo} AND o.order_status NOT IN ('cancelled','purged')
    GROUP BY od.item_no
    ORDER BY revenue DESC
    LIMIT 20
  `);

  // Cancellation rate
  const cancellations = await db.execute(sql`
    SELECT COUNT(*) as cancelled FROM orders
    WHERE org_id=${orgId} AND order_date >= ${thirtyDaysAgo} AND order_status IN ('cancelled','purged')
  `);
  const allOrders30d = await db.execute(sql`
    SELECT COUNT(*) as total, AVG(order_total::numeric) as aov FROM orders
    WHERE org_id=${orgId} AND order_date >= ${thirtyDaysAgo}
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
  const trend = total60to30d > 0 ? (total30d > total60to30d * 1.05 ? 'ACCELERATING' : total30d < total60to30d * 0.95 ? 'DECLINING' : 'STABLE') : 'INSUFFICIENT DATA';

  const cancelCount = Number((cancellations.rows[0] as any)?.cancelled || 0);
  const totalCount = Number((allOrders30d.rows[0] as any)?.total || 0);
  const cancelRate = totalCount > 0 ? ((cancelCount / totalCount) * 100).toFixed(1) : '0';
  const currentAov = Number((allOrders30d.rows[0] as any)?.aov || 0);

  // Top SKUs revenue concentration
  const allSKURevenue = (topSKUs.rows as any[]).reduce((s: number, r: any) => s + Number(r.revenue || 0), 0);
  const top5Revenue = (topSKUs.rows as any[]).slice(0, 5).reduce((s: number, r: any) => s + Number(r.revenue || 0), 0);
  const skuConcentrationPct = allSKURevenue > 0 ? ((top5Revenue / allSKURevenue) * 100).toFixed(1) : '0';

  const ctx = `
ORDER VELOCITY (60-day window):
Last 30d revenue: $${total30d.toFixed(2)} | Prior 30d: $${total60to30d.toFixed(2)} | Change: ${revChange}% | Trend: ${trend}
Current AOV: $${currentAov.toFixed(2)} | 30d orders: ${totalCount} | Cancellation rate: ${cancelRate}%
Top 5 SKUs = ${skuConcentrationPct}% of 30d revenue (SKU concentration)

CHANNEL BREAKDOWN (60d):
${Object.entries(channelData).map(([ch, d]: any) => `  ${ch}: $${d.revenue.toFixed(2)} revenue, ${d.orders} orders, share: ${total30d + total60to30d > 0 ? ((d.revenue / (total30d + total60to30d)) * 100).toFixed(1) : '?'}%`).join('\n') || '  No channel data'}

TOP REVENUE SKUs (last 30d):
${(topSKUs.rows as any[]).map((r: any) => `  ${r.item_no} "${r.item_name || '?'}" — sold:${r.sold_qty} units / ${r.order_count} orders @avg $${Number(r.avg_price).toFixed(2)} = $${Number(r.revenue).toFixed(2)} revenue`).join('\n') || '  None'}

WEEKLY ORDER VOLUME (last 8 weeks):
${(velocityData.rows as any[]).slice(0, 16).map((r: any) => `  ${String(r.week).substring(0,10)} [${r.marketplace}]: ${r.order_count} orders $${Number(r.revenue).toFixed(2)} AOV:$${Number(r.aov).toFixed(2)}`).join('\n')}
`.trim();

  const catalogCtxO = await getExistingCatalogSignals(orgId);
  const fullCtxO = catalogCtxO ? `${ctx}\n\n${catalogCtxO}` : ctx;

  const strategies = await getOrgStrategies(orgId);
  const systemPrompt = buildSystemPrompt(
    `You are the Orders Agent ("Orders") for a LEGO reseller on the E.L.F.I.E. platform. You report to E.L.F.I.E., who synthesises your signals alongside Catalog, Inventory, Pricing, Market, and Customer agents into a unified business voice for the owner.

YOUR MANDATE: Track order velocity, channel performance, SKU throughput, AOV trends, and fulfillment health.

INDUSTRY FRAMEWORKS TO APPLY:
- Revenue Velocity Trend: 30d vs prior 30d classified as ACCELERATING (>5%), STABLE (±5%), or DECLINING (<-5%)
- Average Order Value (AOV): rising AOV = premium buyers or higher basket; falling = downsizing or discount pressure
- Channel Mix Shift: if one platform's share changes >5 percentage points WoW, flag it (channel dependency or opportunity)
- SKU Concentration Risk: if top 5 SKUs > 30% of revenue, flag concentration (vulnerable to stockouts)
- Cancellation Rate: >5% in 30d = investigate root cause (pricing, availability, or fulfilment issue)
- Fulfillment Readiness: cross-reference top-selling SKUs with Inventory agent's stockout signals
- Order Concentration Risk: if top 5 buyers drive >30% of revenue, flag buyer dependency

CROSS-AGENT OUTPUTS:
- [→ INVENTORY]: if top-revenue SKUs are in Inventory's stockout risk list → escalate to high urgency
- [→ PRICING]: if AOV is declining → check if Pricing agent raised prices on popular items recently
- [→ CUSTOMER]: if repeat order rate is low → Customer agent should surface retention risk

OUTPUT FORMAT (JSON ONLY):
{
  "flashReport": "One plain-English sentence: whether orders are growing, flat, or falling; what the average sale size (AOV) is; and the top fulfillment risk. Write it so a non-expert understands — e.g. 'Orders are up 12% and the average sale is $14.80, but top-selling part X is close to selling out.'",
  "signals": [
    {
      "category": "velocity|channel_shift|aov_trend|sku_performance|fulfillment_risk|opportunity",
      "urgency": "high|medium|low",
      "title": "max 80 chars",
      "summary": "2-3 sentences in plain business English — write for a store owner, not a data analyst. Always spell out abbreviations on first use (e.g. 'AOV (Average Order Value — the typical size of each sale)', 'SKU (individual product)'). Cite specific % changes, dollar amounts, item names, and order counts.",
      "details": { "metric": "", "value": 0, "trend": "up|down|stable" }
    }
  ]
}

RULES: Every signal must cite a specific % change, dollar amount, or order count. Classify every revenue trend. Flag any metric crossing a threshold. Minimum 3, maximum 5 signals. LANGUAGE: Write in plain, everyday business language — as if briefing the shop owner at the end of the day. Always spell out every abbreviation the first time it appears in a signal (AOV = Average Order Value, SKU = individual product). Say "your average sale went up to $X" rather than "AOV: $X". Prefer plain phrasing — "orders are growing" not "ACCELERATING trend".`,
    strategies, strategies.ordersStrategy, 'Orders'
  );

  const result = await callAgent(openai, orgId, systemPrompt, fullCtxO);
  await upsertSignals(orgId, 'orders', result.signals);
  if (result.flashReport) await upsertFlashReport(orgId, 'orders', result.flashReport);
  console.log(`[AgentTeam] Orders agent generated ${result.signals.length} signals for ${orgId}`);
  return result.signals.length;
}

// ─── CUSTOMER AGENT ──────────────────────────────────────────────────────────

export async function runCustomerAgent(orgId: string): Promise<number> {
  const openai = await getOpenAI();
  if (!openai) return 0;

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const oneEightyDaysAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);

  const topBuyers = await db.execute(sql`
    SELECT customer_username,
           COUNT(*) as order_count,
           SUM(order_total::numeric) as total_spent,
           MAX(order_date) as last_order,
           MIN(order_date) as first_order,
           AVG(order_total::numeric) as avg_order,
           EXTRACT(DAY FROM NOW() - MAX(order_date)) as days_since_last
    FROM orders
    WHERE org_id=${orgId} AND order_status NOT IN ('cancelled','purged')
    GROUP BY customer_username
    ORDER BY total_spent DESC
    LIMIT 20
  `);

  const dormant = await db.execute(sql`
    SELECT customer_username, MAX(order_date) as last_order, COUNT(*) as order_count,
           SUM(order_total::numeric) as lifetime_spent,
           AVG(order_total::numeric) as avg_order,
           EXTRACT(DAY FROM NOW() - MAX(order_date)) as days_dormant
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
           MIN(order_date) as first_order,
           EXTRACT(DAY FROM NOW() - MIN(order_date)) as days_since_first
    FROM orders
    WHERE org_id=${orgId} AND order_status NOT IN ('cancelled','purged')
    GROUP BY customer_username
    HAVING MIN(order_date) >= ${ninetyDaysAgo}
    ORDER BY total_spent DESC
    LIMIT 15
  `);

  // Repeat rate: buyers with 2+ orders as % of all buyers in 90d
  const repeatRateData = await db.execute(sql`
    SELECT
      COUNT(DISTINCT customer_username) as total_buyers,
      COUNT(DISTINCT CASE WHEN order_count >= 2 THEN customer_username END) as repeat_buyers
    FROM (
      SELECT customer_username, COUNT(*) as order_count
      FROM orders
      WHERE org_id=${orgId} AND order_date >= ${ninetyDaysAgo} AND order_status NOT IN ('cancelled','purged')
      GROUP BY customer_username
    ) sub
  `);
  const repeatRate = repeatRateData.rows[0] as any;
  const repeatPct = repeatRate?.total_buyers > 0
    ? ((Number(repeatRate.repeat_buyers) / Number(repeatRate.total_buyers)) * 100).toFixed(1)
    : '0';

  // At-risk Champions: top 10 all-time buyers who haven't ordered in 60d
  const atRiskChampions = (topBuyers.rows as any[])
    .filter((r: any) => Number(r.days_since_last) > 60)
    .slice(0, 5);

  const ctx = `
CUSTOMER HEALTH:
90d repeat rate: ${repeatPct}% (buyers with 2+ orders as % of all 90d buyers) — benchmark: >30% is healthy
Total buyers in 90d: ${repeatRate?.total_buyers || 0} | Repeat buyers: ${repeatRate?.repeat_buyers || 0}

TOP BUYERS ALL TIME (with RFM indicators):
${(topBuyers.rows as any[]).map((r: any) => {
  const rfm = Number(r.days_since_last) < 30 ? 'Champion' : Number(r.days_since_last) < 60 ? 'Loyal' : Number(r.days_since_last) < 90 ? 'At Risk' : 'Dormant';
  return `  [${rfm}] ${r.customer_username}: ${r.order_count} orders, $${Number(r.total_spent).toFixed(2)} lifetime, avg $${Number(r.avg_order).toFixed(2)}/order, last: ${String(r.last_order).substring(0,10)} (${Math.round(r.days_since_last)}d ago)`;
}).join('\n')}

AT-RISK CHAMPIONS (top 10 all-time buyers, 60d+ inactive — CLV at stake):
${atRiskChampions.map((r: any) => `  ${r.customer_username}: $${Number(r.total_spent).toFixed(2)} lifetime, ${r.order_count} orders, ${Math.round(r.days_since_last)}d inactive`).join('\n') || '  None — all Champions recently active'}

DORMANT HIGH-VALUE BUYERS (2+ orders, last order 90-180d ago):
${(dormant.rows as any[]).map((r: any) => `  ${r.customer_username}: ${r.order_count} past orders, $${Number(r.lifetime_spent).toFixed(2)} lifetime, avg $${Number(r.avg_order).toFixed(2)}/order, ${Math.round(r.days_dormant)}d dormant`).join('\n') || '  None detected'}

NEW BUYERS (first order in last 90d):
${(newBuyers.rows as any[]).map((r: any) => `  ${r.customer_username}: ${r.order_count} orders, $${Number(r.total_spent).toFixed(2)} total, first order ${Math.round(r.days_since_first)}d ago${Number(r.order_count) >= 2 ? ' — CONVERTED (2nd purchase achieved)' : ' — needs 2nd purchase nurture'}`).join('\n') || '  None in 90d'}
`.trim();

  const catalogCtxC = await getExistingCatalogSignals(orgId);
  const fullCtxC = catalogCtxC ? `${ctx}\n\n${catalogCtxC}` : ctx;

  const strategies = await getOrgStrategies(orgId);
  const systemPrompt = buildSystemPrompt(
    `You are the Customer Agent ("Customer") for a LEGO reseller on the E.L.F.I.E. platform. You report to E.L.F.I.E., who synthesises your signals alongside Catalog, Inventory, Pricing, Market, and Orders agents into a unified business voice for the owner.

YOUR MANDATE: Maintain a buyer health scorecard, identify retention risks, and surface opportunities to deepen high-value relationships.

INDUSTRY FRAMEWORKS TO APPLY:
- RFM Segmentation: score buyers on Recency (days since last order), Frequency (order count), Monetary (lifetime spend):
  • Champions: bought within 30d, 3+ orders, top spenders — protect and prioritise
  • Loyal: 30-60d, 2+ orders, above-avg spend — active retention
  • At Risk: 60-90d inactive, previously regular — re-engage now before they're lost
  • Dormant: 90-180d inactive, 2+ past orders — low-effort re-engagement
  • New Converts: first order < 30d, need 2nd purchase within 60d for retention
- Customer Lifetime Value (CLV) Estimate: avg_order × (order_count / months_active) × 24 months
- Churn Signal: Champion who hasn't ordered in 60d = churn signal; calculate CLV at stake
- Repeat Rate Health: >30% = healthy; 20-30% = watch; <20% = retention crisis
- Second Purchase Conversion: new buyer who places 2nd order within 60d = converted; otherwise at risk

CROSS-AGENT OUTPUTS:
- [→ INVENTORY]: if Champion buyers regularly order specific SKUs that Inventory flags as low-stock → escalate
- [→ ORDERS]: if repeat rate declining → Orders agent should show it in revenue trend
- [→ PRICING]: if at-risk buyers were deterred by recent price increases → flag to Pricing

OUTPUT FORMAT (JSON ONLY):
{
  "flashReport": "One plain-English sentence: what % of buyers came back for more, how many top buyers have gone quiet and what their future spend is worth, and who the best new buyer is. Write it so a non-expert understands — e.g. '28% of buyers returned for a second purchase; 3 of your best customers haven't ordered in 2+ months, putting $400 of expected future sales at risk.'",
  "signals": [
    {
      "category": "champion|at_risk|churn_signal|new_convert|retention|clv_opportunity",
      "urgency": "high|medium|low",
      "title": "max 80 chars",
      "summary": "2-3 sentences in plain business English — write for a store owner, not a CRM analyst. Always spell out abbreviations on first use (e.g. 'CLV (Customer Lifetime Value — total expected spend over their buying life)', 'repeat rate (% of buyers who came back for a second order)'). Name specific buyers, their status, exact spend, how long they've been quiet, and a clear next step.",
      "details": { "buyerNames": [], "rfmTier": "Champion|Loyal|At Risk|Dormant|New Convert", "clvEstimate": 0 }
    }
  ]
}

RULES: Name specific buyers with their status (Champion, Loyal, At Risk, Dormant, or New). For every at-risk buyer, estimate lifetime value at stake. For every new buyer, state days since first order. State the repeat rate and whether it's Healthy/Watch/Crisis. Minimum 3, maximum 5 signals. LANGUAGE: Write in plain, everyday business language — as if briefing the shop owner at the end of the day. Always spell out every abbreviation the first time it appears in a signal (CLV = Customer Lifetime Value, RFM = buyer scoring method based on recency/frequency/spend). Say "hasn't ordered in 75 days" not just "75d dormant". Prefer warm, concrete language — these are real customer relationships.`,
    strategies, strategies.customerStrategy, 'Customer'
  );

  const result = await callAgent(openai, orgId, systemPrompt, fullCtxC);
  await upsertSignals(orgId, 'customer', result.signals);
  if (result.flashReport) await upsertFlashReport(orgId, 'customer', result.flashReport);
  console.log(`[AgentTeam] Customer agent generated ${result.signals.length} signals for ${orgId}`);
  return result.signals.length;
}

// ─── RUN ALL AGENTS ──────────────────────────────────────────────────────────

export async function runAllAgents(orgId: string): Promise<Record<AgentId, number>> {
  const results: Record<AgentId, number> = { catalog: 0, inventory: 0, pricing: 0, market: 0, orders: 0, customer: 0 };

  // Run catalog agent first so domain agents can use its signals as enrichment
  try {
    results.catalog = await runCatalogAgent(orgId);
  } catch (err: any) {
    console.error(`[AgentTeam] catalog agent failed for ${orgId} (non-fatal):`, err.message);
  }

  // Run domain agents in parallel after catalog completes
  const domainAgents: [AgentId, (orgId: string) => Promise<number>][] = [
    ['inventory', runInventoryAgent],
    ['pricing', runPricingAgent],
    ['market', runMarketAgent],
    ['orders', runOrdersAgent],
    ['customer', runCustomerAgent],
  ];
  await Promise.all(domainAgents.map(async ([id, fn]) => {
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
    sql`${businessInsights.category} != 'flash_report'`,
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

// ─── FETCH FLASH REPORTS FOR OPS CENTRAL ─────────────────────────────────────

export async function getOpsFlashReports(orgId: string): Promise<Record<string, { summary: string; urgency: string; updatedAt: Date } | null>> {
  const agentIds: AgentId[] = ['inventory', 'pricing', 'market', 'orders', 'customer', 'catalog'];
  const result: Record<string, { summary: string; urgency: string; updatedAt: Date } | null> = {};

  for (const agentId of agentIds) {
    result[agentId] = null;
  }

  try {
    const rows = await db.select({
      agentId: businessInsights.agentId,
      summary: businessInsights.summary,
      urgency: businessInsights.urgency,
      updatedAt: businessInsights.updatedAt,
    })
      .from(businessInsights)
      .where(and(
        eq(businessInsights.orgId, orgId),
        eq(businessInsights.category, 'flash_report'),
        or(isNull(businessInsights.expiresAt), sql`${businessInsights.expiresAt} > NOW()`),
        inArray(businessInsights.agentId, agentIds as any[]),
      ))
      .orderBy(desc(businessInsights.updatedAt));

    for (const row of rows) {
      if (row.agentId && result[row.agentId] === null) {
        result[row.agentId] = {
          summary: row.summary,
          urgency: row.urgency,
          updatedAt: row.updatedAt ?? new Date(),
        };
      }
    }
  } catch (err: any) {
    console.error('[AgentTeam] getOpsFlashReports error:', err.message);
  }

  return result;
}
