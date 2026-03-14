import { db } from "../db";
import { businessInsights, blInventory, blCatalog, orders, orderDetails, priceGuideCache, marketNews, blForumPosts, organizations, appSettings, syncMetadata, PLATFORM_ORG_ID } from "@shared/schema";
import { eq, and, sql, desc, gte, ne, isNull, or } from "drizzle-orm";
import OpenAI from "openai";

interface OrgContext {
  orgId: string;
  topItems: Array<{ itemNo: string; itemName: string | null; quantity: number; unitPrice: string | null; colorName: string | null; categoryId: number | null }>;
  salesVelocity: Array<{ itemNo: string; totalSold: number; avgPrice: number }>;
  pricingGaps: Array<{ itemNo: string; itemName: string | null; unitPrice: number; marketMin: number; marketAvg: number; soldAvg: number }>;
  recentNews: Array<{ title: string; snippet: string | null; source: string | null; url: string }>;
  recentForumTopics: Array<{ title: string; excerpt: string | null; threadUrl: string }>;
}

async function getOrgContext(orgId: string): Promise<OrgContext> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const topItems = await db
    .select({
      itemNo: blInventory.itemNo,
      itemName: blCatalog.itemName,
      quantity: blInventory.quantity,
      unitPrice: blInventory.unitPrice,
      colorName: blCatalog.colorName,
      categoryId: blCatalog.categoryId,
    })
    .from(blInventory)
    .leftJoin(blCatalog, and(
      eq(blInventory.itemNo, blCatalog.itemNo),
      eq(blInventory.itemType, blCatalog.itemType),
      eq(blInventory.colorId, blCatalog.colorId),
    ))
    .where(eq(blInventory.orgId, orgId))
    .orderBy(desc(blInventory.quantity))
    .limit(100);

  const salesData = await db.execute(sql`
    SELECT od.sku, COUNT(*)::int as total_sold, AVG(od.unit_price::numeric)::numeric as avg_price
    FROM order_details od
    JOIN orders o ON od.order_id = o.id
    WHERE o.org_id = ${orgId} AND o.order_date >= ${thirtyDaysAgo.toISOString()}
    GROUP BY od.sku
    ORDER BY total_sold DESC
    LIMIT 50
  `);
  const salesVelocity = (salesData.rows || []).map((r: any) => ({
    itemNo: String(r.sku || '').replace(/^\d+\.LGO-/, ''),
    totalSold: Number(r.total_sold || 0),
    avgPrice: Number(r.avg_price || 0),
  }));

  const pricingData = await db.execute(sql`
    SELECT 
      bi.item_no, bc.item_name, bi.unit_price::numeric as unit_price,
      pgc.stock_min_price::numeric as market_min, 
      pgc.stock_avg_price::numeric as market_avg,
      pgc.sold_avg_price::numeric as sold_avg
    FROM bl_inventory bi
    LEFT JOIN bl_catalog bc ON bi.item_no = bc.item_no AND bi.item_type = bc.item_type AND bi.color_id = bc.color_id
    LEFT JOIN price_guide_cache pgc ON bi.item_no = pgc.item_no AND bi.item_type = pgc.item_type AND bi.color_id = pgc.color_id AND bi.new_or_used = pgc.new_or_used
    WHERE bi.org_id = ${orgId}
      AND pgc.stock_min_price IS NOT NULL
      AND bi.unit_price::numeric > 0
      AND pgc.stock_min_price::numeric > 0
    ORDER BY ABS(bi.unit_price::numeric - pgc.sold_avg_price::numeric) DESC
    LIMIT 50
  `);
  const pricingGaps = (pricingData.rows || []).map((r: any) => ({
    itemNo: String(r.item_no),
    itemName: r.item_name ? String(r.item_name) : null,
    unitPrice: Number(r.unit_price || 0),
    marketMin: Number(r.market_min || 0),
    marketAvg: Number(r.market_avg || 0),
    soldAvg: Number(r.sold_avg || 0),
  }));

  const recentNews = await db
    .select({ title: marketNews.title, snippet: marketNews.snippet, source: marketNews.source, url: marketNews.url })
    .from(marketNews)
    .orderBy(desc(marketNews.fetchedAt))
    .limit(20);

  const recentForumTopics = await db
    .select({ title: blForumPosts.title, excerpt: blForumPosts.excerpt, threadUrl: blForumPosts.threadUrl })
    .from(blForumPosts)
    .orderBy(desc(blForumPosts.postedAt))
    .limit(20);

  return { orgId, topItems, salesVelocity, pricingGaps, recentNews, recentForumTopics };
}

function buildAnalysisPrompt(ctx: OrgContext): string {
  const invSummary = ctx.topItems.slice(0, 30).map(i =>
    `${i.itemNo} "${i.itemName || 'Unknown'}" qty:${i.quantity} price:$${i.unitPrice || '?'} color:${i.colorName || '?'}`
  ).join('\n');

  const salesSummary = ctx.salesVelocity.slice(0, 20).map(s =>
    `${s.itemNo} sold:${s.totalSold} avg:$${s.avgPrice.toFixed(2)}`
  ).join('\n');

  const pricingSummary = ctx.pricingGaps.slice(0, 20).map(p =>
    `${p.itemNo} "${p.itemName || '?'}" your:$${p.unitPrice.toFixed(2)} mkt_min:$${p.marketMin.toFixed(2)} mkt_avg:$${p.marketAvg.toFixed(2)} sold_avg:$${p.soldAvg.toFixed(2)}`
  ).join('\n');

  const newsSummary = ctx.recentNews.map(n => `- ${n.title} (${n.source})`).join('\n');
  const forumSummary = ctx.recentForumTopics.map(f => `- ${f.title}`).join('\n');

  return `You are a LEGO reseller business intelligence analyst. Analyze the following business data and generate actionable insights.

INVENTORY (top items by quantity):
${invSummary || 'No inventory data'}

RECENT SALES (last 30 days):
${salesSummary || 'No recent sales data'}

PRICING ANALYSIS (your price vs market):
${pricingSummary || 'No pricing data'}

MARKET NEWS:
${newsSummary || 'No recent news'}

COMMUNITY DISCUSSIONS:
${forumSummary || 'No recent forum posts'}

Generate 3-8 specific, actionable business insights. For each insight, output a JSON object on its own line with these fields:
- category: one of "pricing", "acquisition", "risk", "opportunity", "trend"
- urgency: "high", "medium", or "low"
- title: short headline (max 80 chars)
- summary: 1-2 sentence actionable recommendation (max 200 chars)
- details: object with relevant data like { affectedItems: [...], priceGap: number, source: "news"|"forum"|"sales"|"inventory" }
- sourceType: "market_news", "forum", "sales", "inventory", or "pricing"

Focus on:
1. PRICING: Items priced significantly above or below market (>15% gap). Items where sold_avg suggests a different optimal price.
2. ACQUISITION: Items mentioned in news/forums as retiring or trending that the seller does NOT stock.
3. RISK: Items with declining sales velocity, or news about overproduction/price drops.
4. OPPORTUNITY: High-velocity items with low stock, or trending items with pricing power.
5. TREND: Patterns in sales data or community discussion.

Output ONLY valid JSON objects, one per line. No other text.`;
}

export async function generateOrgInsights(orgId: string): Promise<number> {
  const ctx = await getOrgContext(orgId);
  
  if (ctx.topItems.length === 0 && ctx.salesVelocity.length === 0) {
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
      max_tokens: 2000,
    });
    responseText = completion.choices[0]?.message?.content || '';
  } catch (err: any) {
    console.error(`[BusinessIntel] OpenAI error for org ${orgId}:`, err.message);
    return 0;
  }

  const VALID_CATEGORIES = ['pricing', 'acquisition', 'risk', 'opportunity', 'trend'];
  const VALID_URGENCIES = ['high', 'medium', 'low'];

  let parsedInsights: any[] = [];
  const trimmed = responseText.trim();
  try {
    const parsed = JSON.parse(trimmed);
    parsedInsights = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const lines = trimmed.split('\n').filter(l => l.trim().startsWith('{'));
    for (const line of lines) {
      try {
        parsedInsights.push(JSON.parse(line));
      } catch {
        console.warn(`[BusinessIntel] Failed to parse insight line for org ${orgId}: ${line.substring(0, 100)}`);
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
      if (typeof insight.summary !== 'string' || insight.summary.length > 500) continue;
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

      await db.insert(businessInsights).values({
        orgId,
        category,
        urgency,
        title: insight.title,
        summary: insight.summary,
        details: insight.details || null,
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
