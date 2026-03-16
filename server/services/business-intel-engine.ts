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
    topCustomersAllTime: Array<{ buyerName: string; orderCount: number; totalSpent: number; firstOrderDate: string; lastOrderDate: string }>;
    newCustomers: Array<{ buyerName: string; orderCount: number; totalSpent: number; firstOrderDate: string }>;
    topSpenders: Array<{ buyerName: string; orderCount: number; totalSpent: number; avgOrderValue: number }>;
    returningVsNew: { returning: number; newBuyers: number };
    highValueOrders: Array<{ buyerName: string; totalAmount: number; orderDate: string; itemCount: number }>;
    dormantBuyers: Array<{ buyerName: string; lastOrderDate: string; totalHistoricalSpent: number; orderCount: number }>;
    singleOrderBuyers: Array<{ buyerName: string; totalSpent: number; orderDate: string }>;
  };
  salesPerformance: {
    year1: { revenue: number; orderCount: number; avgOrderValue: number; uniqueBuyers: number; label: string };
    year2: { revenue: number; orderCount: number; avgOrderValue: number; uniqueBuyers: number; label: string };
    channelBreakdown: Array<{ channel: string; revenue: number; orderCount: number; avgOrderValue: number; uniqueBuyers: number }>;
    monthlyTrend: Array<{ month: string; revenue: number; orderCount: number }>;
  };
  windowStart: string;
  windowEnd: string;
}

async function getOrgContext(orgId: string): Promise<OrgContext> {
  const now = new Date();
  const twoYearsAgo = new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000);
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  const windowStart = twoYearsAgo.toISOString();
  const windowEnd = now.toISOString();

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
        WHERE o.org_id = ${orgId} AND o.is_test = false AND od.sku LIKE '%' || bi.item_no || '%'
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
    WHERE o.org_id = ${orgId} AND o.is_test = false AND o.order_date >= ${windowStart}
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

  // ── Customer Intelligence (rolling 2 years) ──

  const topCustomersData = await db.execute(sql`
    SELECT
      o.customer_username,
      COUNT(*)::int as order_count,
      SUM(o.order_total::numeric)::numeric as total_spent,
      MIN(o.order_date)::text as first_order_date,
      MAX(o.order_date)::text as last_order_date
    FROM orders o
    WHERE o.org_id = ${orgId} AND o.is_test = false AND o.order_date >= ${windowStart}
    GROUP BY o.customer_username
    ORDER BY total_spent DESC
    LIMIT 20
  `);
  const topCustomersAllTime = (topCustomersData.rows || []).map((r: any) => ({
    buyerName: String(r.customer_username || 'Unknown'),
    orderCount: Number(r.order_count || 0),
    totalSpent: Number(r.total_spent || 0),
    firstOrderDate: String(r.first_order_date || ''),
    lastOrderDate: String(r.last_order_date || ''),
  }));

  const newCustomerData = await db.execute(sql`
    SELECT
      o.customer_username,
      COUNT(*)::int as order_count,
      SUM(o.order_total::numeric)::numeric as total_spent,
      MIN(o.order_date)::text as first_order_date
    FROM orders o
    WHERE o.org_id = ${orgId} AND o.is_test = false AND o.order_date >= ${windowStart}
    GROUP BY o.customer_username
    HAVING MIN(o.order_date) >= ${oneYearAgo.toISOString()}
    ORDER BY total_spent DESC
    LIMIT 15
  `);
  const newCustomers = (newCustomerData.rows || []).map((r: any) => ({
    buyerName: String(r.customer_username || 'Unknown'),
    orderCount: Number(r.order_count || 0),
    totalSpent: Number(r.total_spent || 0),
    firstOrderDate: String(r.first_order_date || ''),
  }));

  const topSpenderData = await db.execute(sql`
    SELECT
      o.customer_username,
      COUNT(*)::int as order_count,
      SUM(o.order_total::numeric)::numeric as total_spent,
      AVG(o.order_total::numeric)::numeric as avg_order_value
    FROM orders o
    WHERE o.org_id = ${orgId} AND o.is_test = false AND o.order_date >= ${windowStart}
    GROUP BY o.customer_username
    ORDER BY total_spent DESC
    LIMIT 15
  `);
  const topSpenders = (topSpenderData.rows || []).map((r: any) => ({
    buyerName: String(r.customer_username || 'Unknown'),
    orderCount: Number(r.order_count || 0),
    totalSpent: Number(r.total_spent || 0),
    avgOrderValue: Number(r.avg_order_value || 0),
  }));

  const returningData = await db.execute(sql`
    SELECT
      COUNT(DISTINCT CASE WHEN first_order < ${oneYearAgo.toISOString()} THEN customer_username END)::int as returning,
      COUNT(DISTINCT CASE WHEN first_order >= ${oneYearAgo.toISOString()} THEN customer_username END)::int as new_buyers
    FROM (
      SELECT customer_username, MIN(order_date) as first_order
      FROM orders WHERE org_id = ${orgId} AND is_test = false AND order_date >= ${windowStart}
      GROUP BY customer_username
    ) sub
  `);
  const returningVsNew = {
    returning: Number((returningData.rows || [])[0]?.returning || 0),
    newBuyers: Number((returningData.rows || [])[0]?.new_buyers || 0),
  };

  const highValueData = await db.execute(sql`
    SELECT
      o.customer_username,
      o.order_total::numeric as order_total,
      o.order_date::text as order_date,
      (SELECT COUNT(*)::int FROM order_details od WHERE od.order_id = o.id) as item_count
    FROM orders o
    WHERE o.org_id = ${orgId} AND o.is_test = false AND o.order_date >= ${windowStart}
    ORDER BY o.order_total::numeric DESC
    LIMIT 15
  `);
  const highValueOrders = (highValueData.rows || []).map((r: any) => ({
    buyerName: String(r.customer_username || 'Unknown'),
    totalAmount: Number(r.order_total || 0),
    orderDate: String(r.order_date || ''),
    itemCount: Number(r.item_count || 0),
  }));

  const dormantData = await db.execute(sql`
    SELECT
      o.customer_username,
      MAX(o.order_date)::text as last_order_date,
      SUM(o.order_total::numeric)::numeric as total_historical_spent,
      COUNT(*)::int as order_count
    FROM orders o
    WHERE o.org_id = ${orgId} AND o.is_test = false
    GROUP BY o.customer_username
    HAVING COUNT(*) >= 2
      AND MAX(o.order_date) < ${sixMonthsAgo.toISOString()}
      AND MAX(o.order_date) >= ${twoYearsAgo.toISOString()}
    ORDER BY total_historical_spent DESC
    LIMIT 15
  `);
  const dormantBuyers = (dormantData.rows || []).map((r: any) => ({
    buyerName: String(r.customer_username || 'Unknown'),
    lastOrderDate: String(r.last_order_date || ''),
    totalHistoricalSpent: Number(r.total_historical_spent || 0),
    orderCount: Number(r.order_count || 0),
  }));

  const singleOrderData = await db.execute(sql`
    SELECT
      o.customer_username,
      SUM(o.order_total::numeric)::numeric as total_spent,
      MAX(o.order_date)::text as order_date
    FROM orders o
    WHERE o.org_id = ${orgId} AND o.is_test = false AND o.order_date >= ${windowStart}
    GROUP BY o.customer_username
    HAVING COUNT(*) = 1
    ORDER BY total_spent DESC
    LIMIT 10
  `);
  const singleOrderBuyers = (singleOrderData.rows || []).map((r: any) => ({
    buyerName: String(r.customer_username || 'Unknown'),
    totalSpent: Number(r.total_spent || 0),
    orderDate: String(r.order_date || ''),
  }));

  // ── Sales Performance & Year-over-Year ──

  const y1Start = twoYearsAgo.toISOString();
  const y1End = oneYearAgo.toISOString();
  const y2Start = oneYearAgo.toISOString();
  const y2End = now.toISOString();

  const y1Label = `${twoYearsAgo.getFullYear()}-${oneYearAgo.getFullYear()}`;
  const y2Label = `${oneYearAgo.getFullYear()}-${now.getFullYear()}`;

  const year1Data = await db.execute(sql`
    SELECT
      COALESCE(SUM(order_total::numeric), 0)::numeric as revenue,
      COUNT(*)::int as order_count,
      COALESCE(AVG(order_total::numeric), 0)::numeric as avg_order_value,
      COUNT(DISTINCT customer_username)::int as unique_buyers
    FROM orders
    WHERE org_id = ${orgId} AND is_test = false AND order_date >= ${y1Start} AND order_date < ${y1End}
  `);
  const y1Row = (year1Data.rows || [])[0] || {};

  const year2Data = await db.execute(sql`
    SELECT
      COALESCE(SUM(order_total::numeric), 0)::numeric as revenue,
      COUNT(*)::int as order_count,
      COALESCE(AVG(order_total::numeric), 0)::numeric as avg_order_value,
      COUNT(DISTINCT customer_username)::int as unique_buyers
    FROM orders
    WHERE org_id = ${orgId} AND is_test = false AND order_date >= ${y2Start} AND order_date < ${y2End}
  `);
  const y2Row = (year2Data.rows || [])[0] || {};

  // ── Channel Breakdown (full 2 years) ──

  const channelData = await db.execute(sql`
    SELECT
      COALESCE(marketplace, 'Unknown') as channel,
      COALESCE(SUM(order_total::numeric), 0)::numeric as revenue,
      COUNT(*)::int as order_count,
      COALESCE(AVG(order_total::numeric), 0)::numeric as avg_order_value,
      COUNT(DISTINCT customer_username)::int as unique_buyers
    FROM orders
    WHERE org_id = ${orgId} AND is_test = false AND order_date >= ${windowStart}
    GROUP BY COALESCE(marketplace, 'Unknown')
    ORDER BY revenue DESC
  `);
  const channelBreakdown = (channelData.rows || []).map((r: any) => ({
    channel: String(r.channel),
    revenue: Number(r.revenue || 0),
    orderCount: Number(r.order_count || 0),
    avgOrderValue: Number(r.avg_order_value || 0),
    uniqueBuyers: Number(r.unique_buyers || 0),
  }));

  // ── Monthly Trend (last 2 years) ──

  const monthlyData = await db.execute(sql`
    SELECT
      TO_CHAR(order_date, 'YYYY-MM') as month,
      COALESCE(SUM(order_total::numeric), 0)::numeric as revenue,
      COUNT(*)::int as order_count
    FROM orders
    WHERE org_id = ${orgId} AND is_test = false AND order_date >= ${windowStart}
    GROUP BY TO_CHAR(order_date, 'YYYY-MM')
    ORDER BY month
  `);
  const monthlyTrend = (monthlyData.rows || []).map((r: any) => ({
    month: String(r.month),
    revenue: Number(r.revenue || 0),
    orderCount: Number(r.order_count || 0),
  }));

  return {
    orgId, inventoryItems, pricingGaps, slowMovers, fastMovers,
    acquisitionTargets, recentNews, recentForumTopics,
    customerInsights: {
      topCustomersAllTime, newCustomers, topSpenders, returningVsNew,
      highValueOrders, dormantBuyers, singleOrderBuyers,
    },
    salesPerformance: {
      year1: { revenue: Number(y1Row.revenue || 0), orderCount: Number(y1Row.order_count || 0), avgOrderValue: Number(y1Row.avg_order_value || 0), uniqueBuyers: Number(y1Row.unique_buyers || 0), label: y1Label },
      year2: { revenue: Number(y2Row.revenue || 0), orderCount: Number(y2Row.order_count || 0), avgOrderValue: Number(y2Row.avg_order_value || 0), uniqueBuyers: Number(y2Row.unique_buyers || 0), label: y2Label },
      channelBreakdown,
      monthlyTrend,
    },
    windowStart: twoYearsAgo.toISOString().substring(0, 10),
    windowEnd: now.toISOString().substring(0, 10),
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
  const newCustSummary = ci.newCustomers.slice(0, 8).map(c =>
    `  ${c.buyerName}: ${c.orderCount} orders, $${c.totalSpent.toFixed(2)} spent, first order ${c.firstOrderDate.substring(0, 10)}`
  ).join('\n');

  const topSpenderSummary = ci.topSpenders.slice(0, 8).map(c =>
    `  ${c.buyerName}: ${c.orderCount} orders, $${c.totalSpent.toFixed(2)} total, avg $${c.avgOrderValue.toFixed(2)}/order`
  ).join('\n');

  const highValueSummary = ci.highValueOrders.slice(0, 8).map(c =>
    `  ${c.buyerName}: $${c.totalAmount.toFixed(2)} order (${c.itemCount} items) on ${c.orderDate.substring(0, 10)}`
  ).join('\n');

  const dormantSummary = ci.dormantBuyers.slice(0, 8).map(c =>
    `  ${c.buyerName}: ${c.orderCount} past orders, $${c.totalHistoricalSpent.toFixed(2)} lifetime, last order ${c.lastOrderDate.substring(0, 10)}`
  ).join('\n');

  const singleBuyerSummary = ci.singleOrderBuyers.slice(0, 5).map(c =>
    `  ${c.buyerName}: $${c.totalSpent.toFixed(2)} single order on ${c.orderDate.substring(0, 10)}`
  ).join('\n');

  const sp = ctx.salesPerformance;
  const revenueChange = sp.year1.revenue > 0
    ? ((sp.year2.revenue - sp.year1.revenue) / sp.year1.revenue * 100).toFixed(1)
    : 'N/A';
  const orderChange = sp.year1.orderCount > 0
    ? ((sp.year2.orderCount - sp.year1.orderCount) / sp.year1.orderCount * 100).toFixed(1)
    : 'N/A';

  const channelSummary = sp.channelBreakdown.map(ch =>
    `  ${ch.channel}: $${ch.revenue.toFixed(2)} revenue, ${ch.orderCount} orders, avg $${ch.avgOrderValue.toFixed(2)}/order, ${ch.uniqueBuyers} buyers`
  ).join('\n');

  const monthlyStr = sp.monthlyTrend.map(m => `  ${m.month}: $${m.revenue.toFixed(2)} (${m.orderCount} orders)`).join('\n');

  return `You are a LEGO reseller business intelligence analyst. Analyze the FULL ROLLING 2-YEAR window (${ctx.windowStart} to ${ctx.windowEnd}). Generate HIGHLY SPECIFIC insights using the EXACT data below. Every insight MUST reference specific item numbers, customer names, dollar amounts, and percentages from this data. NO generic advice.

=== YOUR CURRENT INVENTORY (${ctx.inventoryItems.length} items) ===
${invSummary || 'Empty inventory'}

=== ITEMS YOU ARE OVERPRICED ON (your price > 15% above market sold avg) ===
${pricingOverpriced || 'None detected'}

=== ITEMS YOU ARE UNDERPRICED ON (your price > 15% below market sold avg) ===
${pricingUnderpriced || 'None detected'}

=== SLOW-MOVING INVENTORY (items not selling) ===
${slowSummary || 'No slow movers detected'}

=== FAST-MOVING ITEMS (best sellers in 2-year window) ===
${fastSummary || 'No sales data'}

=== HIGH-VALUE ITEMS YOU DO NOT STOCK (proven demand, you have zero inventory) ===
${acqSummary || 'No acquisition targets found'}

=== YEAR-OVER-YEAR SALES COMPARISON ===
Year 1 (${sp.year1.label}): $${sp.year1.revenue.toFixed(2)} revenue, ${sp.year1.orderCount} orders, avg $${sp.year1.avgOrderValue.toFixed(2)}/order, ${sp.year1.uniqueBuyers} unique buyers
Year 2 (${sp.year2.label}): $${sp.year2.revenue.toFixed(2)} revenue, ${sp.year2.orderCount} orders, avg $${sp.year2.avgOrderValue.toFixed(2)}/order, ${sp.year2.uniqueBuyers} unique buyers
Revenue change: ${revenueChange}% | Order count change: ${orderChange}%

=== SALES CHANNEL PERFORMANCE (2-year totals) ===
${channelSummary || 'No channel data'}

=== MONTHLY REVENUE TREND ===
${monthlyStr || 'No monthly data'}

=== NEWER CUSTOMERS (first order within last year) ===
${newCustSummary || 'No new customers in last year'}
Summary: ${ci.returningVsNew.newBuyers} new buyers vs ${ci.returningVsNew.returning} returning buyers

=== TOP SPENDERS (by total spend) ===
${topSpenderSummary || 'No spender data'}

=== HIGHEST VALUE INDIVIDUAL ORDERS ===
${highValueSummary || 'None'}

=== DORMANT REPEAT BUYERS (2+ orders but none in last 6 months) ===
${dormantSummary || 'No dormant repeat buyers'}

=== ONE-TIME HIGH-VALUE BUYERS (single order, never returned) ===
${singleBuyerSummary || 'None'}

=== MARKET NEWS ===
${newsSummary || 'No recent news'}

=== COMMUNITY DISCUSSIONS ===
${forumSummary || 'No recent forum posts'}

Generate 8-12 SPECIFIC, DATA-DRIVEN insights. Each insight MUST cite exact item numbers, customer names, dollar amounts, and/or percentages from the data above. NEVER write generic advice.

CRITICAL DEDUP RULES — follow these strictly:
- NEVER generate two insights about the same topic. Each insight must cover a DIFFERENT finding.
- If a data section is empty (e.g., no dormant buyers, no top spenders, no fast movers), generate AT MOST 1 insight mentioning that gap. Do NOT create multiple "no data" insights for the same category.
- The categories "top_spender" and "new_customer" and "dormant" each get AT MOST 1 insight. Do not split the same observation into multiple insights with slightly different wording.
- "revenue" and "velocity" each get AT MOST 1 insight. Do not create two revenue comparison insights with different titles.

For each insight, output a JSON object with these fields:
- category: One of the operational categories below
- urgency: "high" | "medium" | "low"
- title: Short headline with the item number, customer name, or channel name (max 100 chars)
- summary: 2-3 sentences with SPECIFIC numbers, names, and recommended action. Be precise about dollar amounts and percentages.
- details: { affectedItems: ["itemNo1"], customers: ["name1", "name2"], priceGap: number, currentPrice: number, recommendedPrice: number, potentialRevenue: number, source: "inventory"|"pricing"|"sales"|"customers"|"market_news"|"forum"|"channels" }
- sourceType: "inventory" | "pricing" | "sales" | "customers" | "market_news" | "forum" | "channels"

=== OPERATIONAL AREA CATEGORIES ===
GROUP 1 — PRODUCT & INVENTORY:
- "pricing": Items over/underpriced vs market. Include currentPrice, recommendedPrice, priceGap.
- "acquisition": High-value items you should stock but don't. Include potentialRevenue.
- "overstock": Items with high qty and low/no sales.
- "restock": Fast movers running low on stock.

GROUP 2 — ORDERS & SALES:
- "revenue": Revenue trends, YoY comparison, margin analysis. Compare Year 1 vs Year 2 and cite specific $ changes and % shifts.
- "velocity": Sales velocity changes — items or months selling faster/slower.
- "channel": Sales channel performance analysis — which channels drive the most revenue, best AOV, most buyers. Compare channel performance.

GROUP 3 — CUSTOMER INTELLIGENCE:
- "new_customer": Newer customers worth nurturing. ALWAYS include names in details.customers.
- "top_spender": High-spending customers to reward/prioritize. ALWAYS include names in details.customers.
- "dormant": Repeat buyers who stopped ordering. ALWAYS include names in details.customers.

MARKET & FORUM CROSS-REFERENCING:
- If MARKET NEWS mentions retiring sets, price surges, or trending themes, cross-reference against the seller's inventory and generate actionable insights (e.g., "News reports Set X retiring — you have 5 in stock, consider repricing" or "Theme Y trending in forums — you stock related parts").
- If COMMUNITY DISCUSSIONS mention demand for specific parts/sets, cross-reference with inventory to find opportunities.
- Use sourceType "market_news" or "forum" when the insight originates from those sources. The category should still be the best-fitting operational category (pricing, acquisition, restock, etc.).

Required distribution — generate 8-12 insights total:
1. PRODUCT (2-3): Pricing, acquisition, overstock, or restock. Name SPECIFIC items with exact prices.
2. SALES (2-3): At least 1 revenue (with YoY comparison), 1 channel performance insight. Cite specific $ amounts and % changes.
3. CUSTOMER (2-3): At least 1 new_customer, 1 top_spender, 1 dormant. Name SPECIFIC customers with order counts and spend amounts.
4. MARKET-DRIVEN (1-2): If market news or forum discussions mention items, sets, or themes relevant to the seller's inventory, generate insights that connect those external signals to specific inventory items. Set sourceType to "market_news" or "forum".

Output a JSON array. No other text.`;
}

export async function generateOrgInsights(orgId: string): Promise<number> {
  const ctx = await getOrgContext(orgId);

  if (ctx.inventoryItems.length === 0 && ctx.salesPerformance.year1.orderCount === 0 && ctx.salesPerformance.year2.orderCount === 0) {
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
    if (completion.usage) {
      const { trackUsage } = await import('./ai-usage-tracker');
      trackUsage({
        service: 'openai',
        model: 'gpt-4o-mini',
        operation: 'business-insight',
        inputTokens: completion.usage.prompt_tokens || 0,
        outputTokens: completion.usage.completion_tokens || 0,
        totalTokens: completion.usage.total_tokens || 0,
        orgId,
      });
    }
  } catch (err: any) {
    console.error(`[BusinessIntel] OpenAI error for org ${orgId}:`, err.message);
    return 0;
  }

  const VALID_CATEGORIES = ['pricing', 'acquisition', 'overstock', 'restock', 'revenue', 'velocity', 'channel', 'new_customer', 'top_spender', 'dormant', 'risk', 'opportunity', 'trend', 'customer'];
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

      const existingTitle = await db
        .select({ id: businessInsights.id })
        .from(businessInsights)
        .where(and(
          eq(businessInsights.orgId, orgId),
          eq(businessInsights.title, insight.title),
          eq(businessInsights.dismissed, false),
        ))
        .limit(1);

      if (existingTitle.length > 0) continue;

      const existingCat = await db
        .select({ id: businessInsights.id })
        .from(businessInsights)
        .where(and(
          eq(businessInsights.orgId, orgId),
          eq(businessInsights.category, category),
          eq(businessInsights.dismissed, false),
        ));

      if (existingCat.length >= 2) continue;

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
  const validCategories = ['pricing', 'acquisition', 'overstock', 'restock', 'revenue', 'velocity', 'channel', 'new_customer', 'top_spender', 'dormant'];
  const staleResult = await db
    .delete(businessInsights)
    .where(
      sql`${businessInsights.category} NOT IN (${sql.join(validCategories.map(c => sql`${c}`), sql`, `)})`
    );
  const staleCount = (staleResult as any)?.rowCount || 0;
  if (staleCount > 0) console.log(`[BusinessIntel] Purged ${staleCount} stale insights with legacy categories`);

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
  return staleCount + count;
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
