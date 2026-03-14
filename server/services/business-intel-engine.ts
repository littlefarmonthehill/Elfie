import { db } from "../db";
import { businessInsights, blInventory, blCatalog, orders, orderDetails, priceGuideCache, marketNews, blForumPosts, organizations, appSettings, syncMetadata, PLATFORM_ORG_ID } from "@shared/schema";
import { eq, and, sql, desc, gte, ne, isNull, or } from "drizzle-orm";
import OpenAI from "openai";

interface OrgContext {
  orgId: string;
  inventoryItems: Array<{ itemNo: string; itemType: string; itemName: string | null; quantity: number; unitPrice: string | null; colorName: string | null; newOrUsed: string | null }>;
  pricingGaps: Array<{ itemNo: string; itemName: string | null; unitPrice: number; marketMin: number; marketAvg: number; soldAvg: number; soldMax: number; gapPct: number }>;
  slowMovers: Array<{ itemNo: string; itemName: string | null; quantity: number; unitPrice: number; daysSinceLastSale: number | null }>;
  fastMovers: Array<{ itemNo: string; itemName: string | null; totalSold: number; avgPrice: number; currentQty: number }>;
  acquisitionTargets: Array<{ itemNo: string; itemType: string; itemName: string | null; soldAvg: number; soldMax: number; soldCount: number; stockCount: number }>;
  recentNews: Array<{ title: string; snippet: string | null; source: string | null }>;
  recentForumTopics: Array<{ title: string; excerpt: string | null }>;
  customerInsights: {
    newCustomers30d: Array<{ buyerName: string; orderCount: number; totalSpent: number; firstOrderDate: string }>;
    topSpenders30d: Array<{ buyerName: string; orderCount: number; totalSpent: number; avgOrderValue: number }>;
    returningVsNew: { returning: number; newBuyers: number };
    recentHighValueOrders: Array<{ buyerName: string; totalAmount: number; orderDate: string; itemCount: number }>;
    dormantBuyers: Array<{ buyerName: string; lastOrderDate: string; totalHistoricalSpent: number; orderCount: number }>;
  };
}

async function getOrgContext(orgId: string): Promise<OrgContext> {
  const latestOrderResult = await db.execute(sql`
    SELECT MAX(order_date)::text as latest, MIN(order_date)::text as earliest
    FROM orders WHERE org_id = ${orgId}
  `);
  const latestOrderDate = (latestOrderResult.rows || [])[0]?.latest
    ? new Date(String((latestOrderResult.rows || [])[0].latest))
    : new Date();
  const earliestOrderDate = (latestOrderResult.rows || [])[0]?.earliest
    ? new Date(String((latestOrderResult.rows || [])[0].earliest))
    : new Date();

  const refDate = latestOrderDate.getTime() > Date.now() - 60 * 24 * 60 * 60 * 1000
    ? new Date()
    : latestOrderDate;

  const recentWindow = new Date(refDate.getTime() - 90 * 24 * 60 * 60 * 1000);
  const dormantStart = new Date(refDate.getTime() - 365 * 24 * 60 * 60 * 1000);
  const newCutoff = new Date(refDate.getTime() - 90 * 24 * 60 * 60 * 1000);

  const windowLabel = refDate.getTime() < Date.now() - 60 * 24 * 60 * 60 * 1000
    ? `(data as of ${refDate.toISOString().substring(0, 10)}, store inactive since then)`
    : '(last 90 days)';

  const inventoryItems = await db
    .select({
      itemNo: blInventory.itemNo,
      itemType: blInventory.itemType,
      itemName: blCatalog.itemName,
      quantity: blInventory.quantity,
      unitPrice: blInventory.unitPrice,
      colorName: blCatalog.colorName,
      newOrUsed: blInventory.newOrUsed,
    })
    .from(blInventory)
    .leftJoin(blCatalog, and(
      eq(blInventory.itemNo, blCatalog.itemNo),
      eq(blInventory.itemType, blCatalog.itemType),
      eq(blInventory.colorId, blCatalog.colorId),
    ))
    .where(eq(blInventory.orgId, orgId))
    .orderBy(desc(blInventory.quantity))
    .limit(150);

  const orgItemNos = inventoryItems.map(i => i.itemNo);

  const pricingData = await db.execute(sql`
    SELECT
      bi.item_no, bc.item_name, bi.unit_price::numeric as unit_price,
      pgc.stock_min_price::numeric as market_min,
      pgc.stock_avg_price::numeric as market_avg,
      pgc.sold_avg_price::numeric as sold_avg,
      pgc.sold_max_price::numeric as sold_max,
      ROUND(((bi.unit_price::numeric - pgc.sold_avg_price::numeric) / NULLIF(pgc.sold_avg_price::numeric, 0)) * 100, 1) as gap_pct
    FROM bl_inventory bi
    LEFT JOIN bl_catalog bc ON bi.item_no = bc.item_no AND bi.item_type = bc.item_type AND bi.color_id = bc.color_id
    LEFT JOIN price_guide_cache pgc ON bi.item_no = pgc.item_no AND bi.item_type = pgc.item_type AND bi.color_id = pgc.color_id AND bi.new_or_used = pgc.new_or_used
    WHERE bi.org_id = ${orgId}
      AND pgc.sold_avg_price IS NOT NULL AND pgc.sold_avg_price::numeric > 0
      AND bi.unit_price::numeric > 0
    ORDER BY ABS(bi.unit_price::numeric - pgc.sold_avg_price::numeric) DESC
    LIMIT 30
  `);
  const pricingGaps = (pricingData.rows || []).map((r: any) => ({
    itemNo: String(r.item_no),
    itemName: r.item_name ? String(r.item_name) : null,
    unitPrice: Number(r.unit_price || 0),
    marketMin: Number(r.market_min || 0),
    marketAvg: Number(r.market_avg || 0),
    soldAvg: Number(r.sold_avg || 0),
    soldMax: Number(r.sold_max || 0),
    gapPct: Number(r.gap_pct || 0),
  }));

  const slowMoverData = await db.execute(sql`
    SELECT
      bi.item_no, bc.item_name, bi.quantity, bi.unit_price::numeric as unit_price,
      EXTRACT(DAY FROM NOW() - (
        SELECT MAX(o.order_date) FROM orders o
        JOIN order_details od ON od.order_id = o.id
        WHERE o.org_id = ${orgId} AND od.sku LIKE '%' || bi.item_no || '%'
      )) as days_since_last_sale
    FROM bl_inventory bi
    LEFT JOIN bl_catalog bc ON bi.item_no = bc.item_no AND bi.item_type = bc.item_type AND bi.color_id = bc.color_id
    WHERE bi.org_id = ${orgId} AND bi.quantity > 0
    ORDER BY days_since_last_sale DESC NULLS FIRST
    LIMIT 20
  `);
  const slowMovers = (slowMoverData.rows || []).map((r: any) => ({
    itemNo: String(r.item_no),
    itemName: r.item_name ? String(r.item_name) : null,
    quantity: Number(r.quantity || 0),
    unitPrice: Number(r.unit_price || 0),
    daysSinceLastSale: r.days_since_last_sale != null ? Number(r.days_since_last_sale) : null,
  }));

  const fastMoverData = await db.execute(sql`
    SELECT
      od.sku, COUNT(*)::int as total_sold, AVG(od.unit_price::numeric)::numeric as avg_price,
      COALESCE((SELECT SUM(bi2.quantity) FROM bl_inventory bi2 WHERE bi2.org_id = ${orgId} AND od.sku LIKE '%' || bi2.item_no || '%'), 0) as current_qty,
      bc.item_name
    FROM order_details od
    JOIN orders o ON od.order_id = o.id
    LEFT JOIN bl_catalog bc ON od.sku LIKE '%' || bc.item_no || '%' AND bc.item_type = 'PART'
    WHERE o.org_id = ${orgId} AND o.order_date >= ${recentWindow.toISOString()}
    GROUP BY od.sku, bc.item_name
    ORDER BY total_sold DESC
    LIMIT 20
  `);
  const fastMovers = (fastMoverData.rows || []).map((r: any) => ({
    itemNo: String(r.sku || '').replace(/^\d+\.LGO-/, ''),
    itemName: r.item_name ? String(r.item_name) : null,
    totalSold: Number(r.total_sold || 0),
    avgPrice: Number(r.avg_price || 0),
    currentQty: Number(r.current_qty || 0),
  }));

  const acquisitionData = await db.execute(sql`
    SELECT
      pgc.item_no, pgc.item_type, bc.item_name,
      pgc.sold_avg_price::numeric as sold_avg,
      pgc.sold_max_price::numeric as sold_max,
      pgc.sold_total_lots::int as sold_count,
      pgc.stock_total_lots::int as stock_count
    FROM price_guide_cache pgc
    LEFT JOIN bl_catalog bc ON pgc.item_no = bc.item_no AND pgc.item_type = bc.item_type AND pgc.color_id = bc.color_id
    WHERE pgc.sold_avg_price::numeric > 5
      AND pgc.sold_total_lots > 3
      AND NOT EXISTS (
        SELECT 1 FROM bl_inventory bi
        WHERE bi.org_id = ${orgId} AND bi.item_no = pgc.item_no AND bi.item_type = pgc.item_type
      )
    ORDER BY pgc.sold_avg_price::numeric * pgc.sold_total_lots DESC
    LIMIT 25
  `);
  const acquisitionTargets = (acquisitionData.rows || []).map((r: any) => ({
    itemNo: String(r.item_no),
    itemType: String(r.item_type || 'PART'),
    itemName: r.item_name ? String(r.item_name) : null,
    soldAvg: Number(r.sold_avg || 0),
    soldMax: Number(r.sold_max || 0),
    soldCount: Number(r.sold_count || 0),
    stockCount: Number(r.stock_count || 0),
  }));

  const recentNews = await db
    .select({ title: marketNews.title, snippet: marketNews.snippet, source: marketNews.source })
    .from(marketNews)
    .orderBy(desc(marketNews.fetchedAt))
    .limit(15);

  const recentForumTopics = await db
    .select({ title: blForumPosts.title, excerpt: blForumPosts.excerpt })
    .from(blForumPosts)
    .orderBy(desc(blForumPosts.postedAt))
    .limit(15);

  // ── Customer Intelligence ──
  const newCustomerData = await db.execute(sql`
    SELECT
      o.buyer_name,
      COUNT(*)::int as order_count,
      SUM(o.total_amount::numeric)::numeric as total_spent,
      MIN(o.order_date)::text as first_order_date
    FROM orders o
    WHERE o.org_id = ${orgId}
    GROUP BY o.buyer_name
    HAVING MIN(o.order_date) >= ${thirtyDaysAgo.toISOString()}
    ORDER BY total_spent DESC
    LIMIT 15
  `);
  const newCustomers30d = (newCustomerData.rows || []).map((r: any) => ({
    buyerName: String(r.buyer_name || 'Unknown'),
    orderCount: Number(r.order_count || 0),
    totalSpent: Number(r.total_spent || 0),
    firstOrderDate: String(r.first_order_date || ''),
  }));

  const topSpenderData = await db.execute(sql`
    SELECT
      o.buyer_name,
      COUNT(*)::int as order_count,
      SUM(o.total_amount::numeric)::numeric as total_spent,
      AVG(o.total_amount::numeric)::numeric as avg_order_value
    FROM orders o
    WHERE o.org_id = ${orgId} AND o.order_date >= ${thirtyDaysAgo.toISOString()}
    GROUP BY o.buyer_name
    ORDER BY total_spent DESC
    LIMIT 10
  `);
  const topSpenders30d = (topSpenderData.rows || []).map((r: any) => ({
    buyerName: String(r.buyer_name || 'Unknown'),
    orderCount: Number(r.order_count || 0),
    totalSpent: Number(r.total_spent || 0),
    avgOrderValue: Number(r.avg_order_value || 0),
  }));

  const returningData = await db.execute(sql`
    SELECT
      COUNT(DISTINCT CASE WHEN first_order < ${thirtyDaysAgo.toISOString()} THEN buyer_name END)::int as returning,
      COUNT(DISTINCT CASE WHEN first_order >= ${thirtyDaysAgo.toISOString()} THEN buyer_name END)::int as new_buyers
    FROM (
      SELECT buyer_name, MIN(order_date) as first_order
      FROM orders WHERE org_id = ${orgId} AND order_date >= ${thirtyDaysAgo.toISOString()}
      GROUP BY buyer_name
    ) sub
  `);
  const returningVsNew = {
    returning: Number((returningData.rows || [])[0]?.returning || 0),
    newBuyers: Number((returningData.rows || [])[0]?.new_buyers || 0),
  };

  const highValueData = await db.execute(sql`
    SELECT
      o.buyer_name,
      o.total_amount::numeric as total_amount,
      o.order_date::text as order_date,
      (SELECT COUNT(*)::int FROM order_details od WHERE od.order_id = o.id) as item_count
    FROM orders o
    WHERE o.org_id = ${orgId} AND o.order_date >= ${thirtyDaysAgo.toISOString()}
    ORDER BY o.total_amount::numeric DESC
    LIMIT 10
  `);
  const recentHighValueOrders = (highValueData.rows || []).map((r: any) => ({
    buyerName: String(r.buyer_name || 'Unknown'),
    totalAmount: Number(r.total_amount || 0),
    orderDate: String(r.order_date || ''),
    itemCount: Number(r.item_count || 0),
  }));

  const dormantData = await db.execute(sql`
    SELECT
      o.buyer_name,
      MAX(o.order_date)::text as last_order_date,
      SUM(o.total_amount::numeric)::numeric as total_historical_spent,
      COUNT(*)::int as order_count
    FROM orders o
    WHERE o.org_id = ${orgId}
    GROUP BY o.buyer_name
    HAVING MAX(o.order_date) < ${sixtyDaysAgo.toISOString()}
      AND MAX(o.order_date) >= ${ninetyDaysAgo.toISOString()}
      AND COUNT(*) >= 2
    ORDER BY total_historical_spent DESC
    LIMIT 10
  `);
  const dormantBuyers = (dormantData.rows || []).map((r: any) => ({
    buyerName: String(r.buyer_name || 'Unknown'),
    lastOrderDate: String(r.last_order_date || ''),
    totalHistoricalSpent: Number(r.total_historical_spent || 0),
    orderCount: Number(r.order_count || 0),
  }));

  return {
    orgId, inventoryItems, pricingGaps, slowMovers, fastMovers,
    acquisitionTargets, recentNews, recentForumTopics,
    customerInsights: { newCustomers30d, topSpenders30d, returningVsNew, recentHighValueOrders, dormantBuyers },
  };
}

function buildAnalysisPrompt(ctx: OrgContext): string {
  const invSummary = ctx.inventoryItems.slice(0, 40).map(i =>
    `  ${i.itemNo} (${i.itemType}) "${i.itemName || '?'}" qty:${i.quantity} @$${i.unitPrice || '?'} ${i.newOrUsed || ''} color:${i.colorName || '?'}`
  ).join('\n');

  const pricingOverpriced = ctx.pricingGaps.filter(p => p.gapPct > 15).slice(0, 10).map(p =>
    `  ${p.itemNo} "${p.itemName || '?'}" — YOUR: $${p.unitPrice.toFixed(2)} vs SOLD_AVG: $${p.soldAvg.toFixed(2)} (${p.gapPct > 0 ? '+' : ''}${p.gapPct.toFixed(1)}% gap) SOLD_MAX: $${p.soldMax.toFixed(2)}`
  ).join('\n');

  const pricingUnderpriced = ctx.pricingGaps.filter(p => p.gapPct < -15).slice(0, 10).map(p =>
    `  ${p.itemNo} "${p.itemName || '?'}" — YOUR: $${p.unitPrice.toFixed(2)} vs SOLD_AVG: $${p.soldAvg.toFixed(2)} (${p.gapPct.toFixed(1)}% below) SOLD_MAX: $${p.soldMax.toFixed(2)}`
  ).join('\n');

  const slowSummary = ctx.slowMovers.slice(0, 10).map(s =>
    `  ${s.itemNo} "${s.itemName || '?'}" qty:${s.quantity} @$${s.unitPrice.toFixed(2)} — ${s.daysSinceLastSale != null ? `last sold ${Math.round(s.daysSinceLastSale)}d ago` : 'NEVER SOLD'}`
  ).join('\n');

  const fastSummary = ctx.fastMovers.slice(0, 10).map(f =>
    `  ${f.itemNo} "${f.itemName || '?'}" sold:${f.totalSold}x @avg $${f.avgPrice.toFixed(2)} — current stock: ${f.currentQty}`
  ).join('\n');

  const acqSummary = ctx.acquisitionTargets.slice(0, 15).map(a =>
    `  ${a.itemNo} (${a.itemType}) "${a.itemName || '?'}" — sold_avg:$${a.soldAvg.toFixed(2)} sold_max:$${a.soldMax.toFixed(2)} demand:${a.soldCount} lots sold, ${a.stockCount} sellers`
  ).join('\n');

  const newsSummary = ctx.recentNews.map(n => `  - ${n.title}${n.snippet ? ` — ${n.snippet.substring(0, 100)}` : ''}`).join('\n');
  const forumSummary = ctx.recentForumTopics.map(f => `  - ${f.title}`).join('\n');

  const ci = ctx.customerInsights;
  const newCustSummary = ci.newCustomers30d.slice(0, 8).map(c =>
    `  ${c.buyerName}: ${c.orderCount} orders, $${c.totalSpent.toFixed(2)} spent, first order ${c.firstOrderDate.substring(0, 10)}`
  ).join('\n');

  const topSpenderSummary = ci.topSpenders30d.slice(0, 8).map(c =>
    `  ${c.buyerName}: ${c.orderCount} orders, $${c.totalSpent.toFixed(2)} total, avg $${c.avgOrderValue.toFixed(2)}/order`
  ).join('\n');

  const highValueSummary = ci.recentHighValueOrders.slice(0, 5).map(c =>
    `  ${c.buyerName}: $${c.totalAmount.toFixed(2)} order (${c.itemCount} items) on ${c.orderDate.substring(0, 10)}`
  ).join('\n');

  const dormantSummary = ci.dormantBuyers.slice(0, 5).map(c =>
    `  ${c.buyerName}: ${c.orderCount} past orders, $${c.totalHistoricalSpent.toFixed(2)} lifetime, last order ${c.lastOrderDate.substring(0, 10)}`
  ).join('\n');

  return `You are a LEGO reseller business intelligence analyst. You must generate HIGHLY SPECIFIC insights using the EXACT data below. Every insight MUST reference specific item numbers, customer names, dollar amounts, and percentages from this data. NO generic advice.

=== YOUR CURRENT INVENTORY (${ctx.inventoryItems.length} items) ===
${invSummary || 'Empty inventory'}

=== ITEMS YOU ARE OVERPRICED ON (your price > 15% above market sold avg) ===
${pricingOverpriced || 'None detected'}

=== ITEMS YOU ARE UNDERPRICED ON (your price > 15% below market sold avg) ===
${pricingUnderpriced || 'None detected'}

=== SLOW-MOVING INVENTORY (items not selling) ===
${slowSummary || 'No slow movers detected'}

=== FAST-MOVING ITEMS (best sellers last 30 days) ===
${fastSummary || 'No recent sales'}

=== HIGH-VALUE ITEMS YOU DO NOT STOCK (proven demand, you have zero inventory) ===
${acqSummary || 'No acquisition targets found'}

=== CUSTOMER DATA — NEW CUSTOMERS (first order in last 30 days) ===
${newCustSummary || 'No new customers'}
Summary: ${ci.returningVsNew.newBuyers} new buyers vs ${ci.returningVsNew.returning} returning buyers in last 30 days

=== CUSTOMER DATA — TOP SPENDERS (last 30 days) ===
${topSpenderSummary || 'No orders in last 30 days'}

=== CUSTOMER DATA — HIGH-VALUE ORDERS (last 30 days) ===
${highValueSummary || 'None'}

=== CUSTOMER DATA — DORMANT BUYERS (repeat buyers who stopped ordering 60-90 days ago) ===
${dormantSummary || 'No dormant repeat buyers'}

=== MARKET NEWS ===
${newsSummary || 'No recent news'}

=== COMMUNITY DISCUSSIONS ===
${forumSummary || 'No recent forum posts'}

Generate 5-10 SPECIFIC, DATA-DRIVEN insights. Each insight MUST cite exact item numbers, customer names, dollar amounts, and/or percentages from the data above. NEVER write generic advice like "consider stocking retiring sets" — instead write "Stock item 10497 (Galaxy Explorer) — sold avg $${ctx.acquisitionTargets[0]?.soldAvg?.toFixed(2) || '45.00'}, ${ctx.acquisitionTargets[0]?.soldCount || 12} lots sold, you currently have zero inventory."

For each insight, output a JSON object with these fields:
- category: One of the operational categories below
- urgency: "high" | "medium" | "low"
- title: Short headline with the item number or customer name (max 100 chars)
- summary: 2-3 sentences with SPECIFIC numbers, item IDs, customer names, and recommended action. Be precise about dollar amounts and percentages.
- details: { affectedItems: ["itemNo1", "itemNo2"], customers: ["name1", "name2"], priceGap: number, currentPrice: number, recommendedPrice: number, potentialRevenue: number, source: "inventory"|"pricing"|"sales"|"customers"|"market_news"|"forum" }
- sourceType: "inventory" | "pricing" | "sales" | "customers" | "market_news" | "forum"

=== OPERATIONAL AREA CATEGORIES ===
GROUP 1 — PRODUCT & INVENTORY (use these categories):
- "pricing": Items that are over/underpriced vs market. Include currentPrice, recommendedPrice, priceGap in details.
- "acquisition": High-value items you should stock but don't. Include potentialRevenue in details.
- "overstock": Items with high qty and low/no sales — consider discounting or bundling.
- "restock": Fast movers running low on stock — reorder soon.

GROUP 2 — ORDERS & SALES (use these categories):
- "revenue": Revenue trends, high-value order patterns, margin analysis.
- "velocity": Sales velocity changes — items selling faster/slower than before.

GROUP 3 — CUSTOMER INTELLIGENCE (use these categories):
- "new_customer": New customers (first order in last 30 days) worth nurturing. ALWAYS include customer names in details.customers array.
- "top_spender": High-spending customers to reward or prioritize. ALWAYS include customer names in details.customers array.
- "dormant": Repeat buyers who stopped ordering — re-engage them. ALWAYS include customer names in details.customers array.

Required distribution — generate 7-10 insights total:
1. PRODUCT (3-4): At least 1 pricing, 1 acquisition, and 1 overstock or restock insight. Name SPECIFIC items with exact prices.
2. SALES (1-2): Revenue or velocity insight with specific dollar amounts and trends.
3. CUSTOMER (3-4): At least 1 new_customer, 1 top_spender, and 1 dormant insight. Name SPECIFIC customers with their order counts and spend amounts. These are the most important — include every customer name from the data in the details.customers array.

Output a JSON array. No other text.`;
}

export async function generateOrgInsights(orgId: string): Promise<number> {
  const ctx = await getOrgContext(orgId);

  if (ctx.inventoryItems.length === 0 && ctx.customerInsights.topSpenders30d.length === 0) {
    console.log(`[BusinessIntel] Org ${orgId} has no inventory/sales data, skipping`);
    return 0;
  }

  const prompt = buildAnalysisPrompt(ctx);

  const [platformSettings] = await db
    .select({ openaiApiKey: appSettings.openaiApiKey })
    .from(appSettings)
    .where(eq(appSettings.id, 'platform'))
    .limit(1);

  const apiKey = platformSettings?.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[BusinessIntel] No OpenAI API key available');
    return 0;
  }

  const openai = new OpenAI({ apiKey });

  let responseText: string;
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 4000,
    });
    responseText = completion.choices[0]?.message?.content || '';
  } catch (err: any) {
    console.error(`[BusinessIntel] OpenAI error for org ${orgId}:`, err.message);
    return 0;
  }

  const VALID_CATEGORIES = ['pricing', 'acquisition', 'overstock', 'restock', 'revenue', 'velocity', 'new_customer', 'top_spender', 'dormant', 'risk', 'opportunity', 'trend', 'customer'];
  const VALID_URGENCIES = ['high', 'medium', 'low'];

  let parsedInsights: any[] = [];
  const trimmed = responseText.trim();
  try {
    const parsed = JSON.parse(trimmed);
    parsedInsights = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      try {
        const inner = JSON.parse(codeBlockMatch[1].trim());
        parsedInsights = Array.isArray(inner) ? inner : [inner];
      } catch {}
    }
    if (parsedInsights.length === 0) {
      const lines = trimmed.split('\n').filter(l => l.trim().startsWith('{'));
      for (const line of lines) {
        try {
          parsedInsights.push(JSON.parse(line));
        } catch {
          console.warn(`[BusinessIntel] Failed to parse insight line for org ${orgId}: ${line.substring(0, 100)}`);
        }
      }
    }
  }

  if (parsedInsights.length === 0) {
    console.warn(`[BusinessIntel] No parseable insights from AI for org ${orgId}. Response start: ${responseText.substring(0, 200)}`);
    return 0;
  }

  let insertedCount = 0;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  for (const insight of parsedInsights) {
    try {
      if (!insight.title || !insight.summary || !insight.category) continue;
      if (typeof insight.title !== 'string' || insight.title.length > 200) continue;
      if (typeof insight.summary !== 'string' || insight.summary.length > 1000) continue;
      const category = VALID_CATEGORIES.includes(insight.category) ? insight.category : 'trend';
      const urgency = VALID_URGENCIES.includes(insight.urgency) ? insight.urgency : 'medium';

      const existing = await db
        .select({ id: businessInsights.id })
        .from(businessInsights)
        .where(and(
          eq(businessInsights.orgId, orgId),
          eq(businessInsights.title, insight.title),
          eq(businessInsights.dismissed, false),
        ))
        .limit(1);

      if (existing.length > 0) continue;

      const rawDetails = insight.details || {};
      const sanitizedDetails: Record<string, any> = {};
      if (Array.isArray(rawDetails.affectedItems)) sanitizedDetails.affectedItems = rawDetails.affectedItems.map(String);
      if (Array.isArray(rawDetails.customers)) sanitizedDetails.customers = rawDetails.customers.map(String);
      if (rawDetails.priceGap != null) { const v = Number(rawDetails.priceGap); if (Number.isFinite(v)) sanitizedDetails.priceGap = v; }
      if (rawDetails.currentPrice != null) { const v = Number(rawDetails.currentPrice); if (Number.isFinite(v)) sanitizedDetails.currentPrice = v; }
      if (rawDetails.recommendedPrice != null) { const v = Number(rawDetails.recommendedPrice); if (Number.isFinite(v)) sanitizedDetails.recommendedPrice = v; }
      if (rawDetails.potentialRevenue != null) { const v = Number(rawDetails.potentialRevenue); if (Number.isFinite(v)) sanitizedDetails.potentialRevenue = v; }
      if (rawDetails.source) sanitizedDetails.source = String(rawDetails.source);

      await db.insert(businessInsights).values({
        orgId,
        category,
        urgency,
        title: insight.title,
        summary: insight.summary,
        details: Object.keys(sanitizedDetails).length > 0 ? sanitizedDetails : null,
        sourceType: insight.sourceType || null,
        sourceRef: null,
        dismissed: false,
        expiresAt,
      });
      insertedCount++;
    } catch {
      continue;
    }
  }

  console.log(`[BusinessIntel] Generated ${insertedCount} insights for org ${orgId}`);
  return insertedCount;
}

export async function purgeExpiredInsights(): Promise<number> {
  const result = await db
    .delete(businessInsights)
    .where(
      or(
        and(
          sql`${businessInsights.expiresAt} IS NOT NULL`,
          sql`${businessInsights.expiresAt} < NOW()`,
        ),
        and(
          eq(businessInsights.dismissed, true),
          sql`${businessInsights.updatedAt} < NOW() - INTERVAL '3 days'`,
        ),
      )
    );
  const count = (result as any)?.rowCount || 0;
  if (count > 0) console.log(`[BusinessIntel] Purged ${count} expired/dismissed insights`);
  return count;
}

export async function syncBusinessIntel(): Promise<{ totalInsights: number; orgsProcessed: number }> {
  console.log('[BusinessIntel] Starting business intelligence sync...');

  await purgeExpiredInsights();

  const allOrgs = await db
    .select({ id: organizations.id })
    .from(organizations);

  let totalInsights = 0;
  for (const org of allOrgs) {
    try {
      const count = await generateOrgInsights(org.id);
      totalInsights += count;
    } catch (err: any) {
      console.error(`[BusinessIntel] Error processing org ${org.id}:`, err.message);
    }
  }

  console.log(`[BusinessIntel] Sync complete: ${totalInsights} insights across ${allOrgs.length} orgs`);
  return { totalInsights, orgsProcessed: allOrgs.length };
}
