import { Router } from "express";
import OpenAI from "openai";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "../db";
import { asyncRoute, reqOrgId, resolvedCatalogItemName } from "../lib/routeHelpers";
import { isApproved, isSuperAdmin } from "../auth";
import { getPlatformOpenAIKey, getPlatformSettings } from "../lib/platformSettings";
import {
  blForumPosts, marketNews, appFeedback, orders, orderAdjustments,
  PLATFORM_ORG_ID, blInventory, blColors, blCatalog, blCategories,
  inventoryLocations, whBins, whShelves, whAisles, orderDetails,
} from "@shared/schema";

const router = Router();

// ── Item Details ──────────────────────────────────────────────────────────────

// GET /api/items/detail/:itemNo - Get detailed information about a specific item
router.get("/items/detail/:itemNo", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { itemNo } = req.params;

  // Get all inventory lots for this item
  const inventoryLots = await db
    .select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      itemType: blInventory.itemType,
      itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
      colorId: blInventory.colorId,
      colorName: blColors.name,
      colorRgb: blColors.rgb,
      categoryId: blCatalog.categoryId,
      categoryName: blCategories.name,
      quantity: blInventory.quantity,
      newOrUsed: blInventory.newOrUsed,
      unitPrice: blInventory.unitPrice,
    })
    .from(blInventory)
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
    .leftJoin(blCategories, eq(blCatalog.categoryId, blCategories.id))
    .where(and(eq(blInventory.orgId, orgId), eq(blInventory.itemNo, itemNo)));

  if (inventoryLots.length === 0) {
    return res.status(404).json({ error: "Item not found" });
  }

  // Get warehouse locations for each inventory lot
  const inventoryIds = inventoryLots.map(lot => lot.id);
  const warehouseLocations = inventoryIds.length > 0 
    ? await db
        .select({
          inventoryId: inventoryLocations.inventoryId,
          binId: inventoryLocations.binId,
          binName: whBins.name,
          shelfName: whShelves.name,
          aisleName: whAisles.name,
        })
        .from(inventoryLocations)
        .leftJoin(whBins, eq(inventoryLocations.binId, whBins.id))
        .leftJoin(whShelves, eq(whBins.shelfId, whShelves.id))
        .leftJoin(whAisles, eq(whShelves.aisleId, whAisles.id))
        .where(and(eq(inventoryLocations.orgId, orgId), inArray(inventoryLocations.inventoryId, inventoryIds)))
    : [];

  // Get sales data for this item
  // Note: sku contains the item number for most platforms
  const salesData = await db
    .select({
      quantitySold: sql<number>`COALESCE(SUM(${orderDetails.quantity}), 0)`,
      revenue: sql<number>`COALESCE(SUM(CAST(${orderDetails.unitPrice} AS DECIMAL) * ${orderDetails.quantity}), 0)`,
    })
    .from(orderDetails)
    .where(eq(orderDetails.sku, itemNo));

  // Build color variations array with warehouse locations
  const colors = inventoryLots.map(lot => {
    const location = warehouseLocations.find(loc => loc.inventoryId === lot.id);
    let warehouseLocation = null;
    if (location?.binName) {
      const parts = [];
      if (location.aisleName) parts.push(location.aisleName);
      if (location.shelfName) parts.push(location.shelfName);
      parts.push(location.binName);
      warehouseLocation = parts.join(' / ');
    }

    return {
      colorId: lot.colorId || 0,
      colorName: lot.colorName || 'Unknown',
      colorRgb: lot.colorRgb,
      quantity: lot.quantity || 0,
      condition: lot.newOrUsed || 'U',
      price: lot.unitPrice,
      warehouseLocation,
    };
  });

  // Calculate totals
  const totalQuantity = inventoryLots.reduce((sum, lot) => sum + (lot.quantity || 0), 0);
  const newQuantity = inventoryLots
    .filter(lot => lot.newOrUsed === 'N')
    .reduce((sum, lot) => sum + (lot.quantity || 0), 0);
  const usedQuantity = inventoryLots
    .filter(lot => lot.newOrUsed === 'U')
    .reduce((sum, lot) => sum + (lot.quantity || 0), 0);
  
  const colorCount = new Set(inventoryLots.map(lot => lot.colorId).filter(Boolean)).size;

  // Calculate price statistics
  const prices = inventoryLots
    .map(lot => parseFloat(lot.unitPrice || '0'))
    .filter(price => price > 0);
  
  const avgPrice = prices.length > 0 
    ? (prices.reduce((sum, price) => sum + price, 0) / prices.length).toFixed(3)
    : null;
  const minPrice = prices.length > 0 ? Math.min(...prices).toFixed(3) : null;
  const maxPrice = prices.length > 0 ? Math.max(...prices).toFixed(3) : null;

  // Calculate total value
  const totalValue = inventoryLots
    .reduce((sum, lot) => {
      const price = parseFloat(lot.unitPrice || '0');
      const qty = lot.quantity || 0;
      return sum + (price * qty);
    }, 0)
    .toFixed(2);

  const itemDetail = {
    itemNo,
    itemName: inventoryLots[0].itemName,
    categoryName: inventoryLots[0].categoryName,
    totalQuantity,
    newQuantity,
    usedQuantity,
    colorCount,
    avgPrice,
    minPrice,
    maxPrice,
    totalValue,
    quantitySold: Number(salesData[0]?.quantitySold || 0),
    revenue: Number(salesData[0]?.revenue || 0).toFixed(2),
    colors,
  };

  res.json(itemDetail);
}));

// ── Forum ─────────────────────────────────────────────────────────────────────

router.get("/forum/recent", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const daysAgo = parseInt(req.query.days as string) || 7;
  const limit = parseInt(req.query.limit as string) || 10;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysAgo);

  const recentPosts = await db
    .select({
      id: blForumPosts.id,
      threadId: blForumPosts.threadId,
      title: blForumPosts.title,
      excerpt: blForumPosts.excerpt,
      username: blForumPosts.username,
      postedAt: blForumPosts.postedAt,
      postUrl: blForumPosts.postUrl,
      threadUrl: blForumPosts.threadUrl,
      hasReplies: blForumPosts.hasReplies,
    })
    .from(blForumPosts)
    .where(and(eq(blForumPosts.orgId, orgId), sql`${blForumPosts.postedAt} >= ${cutoffDate}`))
    .orderBy(sql`${blForumPosts.postedAt} DESC`)
    .limit(limit);

  res.json({
    success: true,
    count: recentPosts.length,
    posts: recentPosts,
    cutoffDate: cutoffDate.toISOString(),
  });
}));

// ── Market Intelligence ────────────────────────────────────────────────────────

router.get("/market-intel/recent", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const daysAgo = parseInt(req.query.days as string) || 30;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysAgo);

  const recentPosts = await db
    .select({
      title: blForumPosts.title,
      excerpt: blForumPosts.excerpt,
      username: blForumPosts.username,
      postedAt: blForumPosts.postedAt,
      threadUrl: blForumPosts.threadUrl,
    })
    .from(blForumPosts)
    .where(sql`${blForumPosts.postedAt} >= ${cutoffDate} AND ${blForumPosts.title} NOT ILIKE 'Re:%'`)
    .orderBy(sql`${blForumPosts.postedAt} DESC`)
    .limit(20);

  const recentArticles = await db
    .select({
      title: marketNews.title,
      snippet: marketNews.snippet,
      url: marketNews.url,
      source: marketNews.source,
      query: marketNews.query,
      fetchedAt: marketNews.fetchedAt,
    })
    .from(marketNews)
    .where(sql`${marketNews.fetchedAt} >= ${cutoffDate}`)
    .orderBy(sql`${marketNews.fetchedAt} DESC`)
    .limit(15);

  res.json({
    success: true,
    forum: { count: recentPosts.length, posts: recentPosts },
    news: { count: recentArticles.length, articles: recentArticles },
  });
}));

// GET /api/market-intel/forum-summary — AI-generated per-topic descriptions (15-min cache)
let _forumSummaryCache: { descriptions: Record<string, string>; generatedAt: number } | null = null;
const FORUM_SUMMARY_TTL_MS = 15 * 60 * 1000;

router.get("/market-intel/forum-summary", isApproved, asyncRoute(async (req: any, res) => {
  if (_forumSummaryCache && Date.now() - _forumSummaryCache.generatedAt < FORUM_SUMMARY_TTL_MS) {
    return res.json({ descriptions: _forumSummaryCache.descriptions, cached: true });
  }
  const orgId = req.user?.orgId ?? PLATFORM_ORG_ID;
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const posts = await db
    .select({ threadId: blForumPosts.threadId, title: blForumPosts.title, excerpt: blForumPosts.excerpt })
    .from(blForumPosts)
    .where(and(
      eq(blForumPosts.orgId, orgId),
      sql`${blForumPosts.postedAt} >= ${cutoff}`,
      sql`${blForumPosts.title} NOT ILIKE 'Re:%'`
    ))
    .orderBy(sql`${blForumPosts.postedAt} DESC`)
    .limit(20);
  if (posts.length === 0) return res.json({ descriptions: {} });
  const { default: AnthropicSDK } = await import("@anthropic-ai/sdk");
  const client = new AnthropicSDK({
    apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  });
  const topicList = posts.map((p, i) =>
    `${i + 1}. "${p.title}"${p.excerpt ? ` — ${p.excerpt.slice(0, 100)}` : ''}`
  ).join('\n');
  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    messages: [{
      role: "user",
      content: `You are a LEGO reselling market intelligence assistant. For each BrickLink forum topic below, write exactly ONE concise sentence (max 18 words) explaining what the discussion is about and why it matters to LEGO resellers. Return ONLY a valid JSON array of strings in the same order as the topics, with no extra text before or after.\n\nTopics:\n${topicList}\n\nJSON array:`
    }]
  });
  const raw = message.content[0]?.type === 'text' ? message.content[0].text.trim() : '[]';
  let descArray: string[] = [];
  try { descArray = JSON.parse(raw); } catch { descArray = posts.map(() => ''); }
  const descriptions: Record<string, string> = {};
  posts.forEach((p, i) => { if (p.threadId) descriptions[p.threadId] = descArray[i] ?? ''; });
  _forumSummaryCache = { descriptions, generatedAt: Date.now() };
  res.json({ descriptions });
}));

// ── Backup & Restore ───────────────────────────────────────────────────────────

router.post("/backup/restore", isApproved, asyncRoute(async (req, res) => {
  const { targetTimestamp, skipPlatformSync } = req.body;
  if (!targetTimestamp) return res.status(400).json({ error: "targetTimestamp is required" });
  const backupRestore = await import('../services/backup-restore');
  const jobId = await backupRestore.initiateRestoreWorkflow(targetTimestamp, skipPlatformSync || false);
  res.json({ success: true, jobId });
}));

router.get("/backup/restore/status/:jobId", isApproved, asyncRoute(async (req, res) => {
  const { jobId } = req.params;
  const backupRestore = await import('../services/backup-restore');
  const status = await backupRestore.getRestoreStatus(jobId);
  if (!status) return res.status(404).json({ error: "Restore job not found" });
  res.json(status);
}));

router.post("/backup/differential/analyze", isApproved, asyncRoute(async (req, res) => {
  const { jobId } = req.body;
  if (!jobId) return res.status(400).json({ error: "jobId is required" });
  const backupRestore = await import('../services/backup-restore');
  const analysis = await backupRestore.analyzeDifferential(jobId);
  res.json(analysis);
}));

router.post("/backup/differential/apply", isApproved, asyncRoute(async (req, res) => {
  const { jobId, overrideAnomalies } = req.body;
  if (!jobId) return res.status(400).json({ error: "jobId is required" });
  const backupRestore = await import('../services/backup-restore');
  const result = await backupRestore.applyDifferentialRecovery(jobId, overrideAnomalies || false);
  res.json(result);
}));

router.get("/backup/verify/:jobId", isApproved, asyncRoute(async (req, res) => {
  const { jobId } = req.params;
  const backupRestore = await import('../services/backup-restore');
  const verification = await backupRestore.verifyRestoration(jobId);
  res.json(verification);
}));

// ── App Feedback ───────────────────────────────────────────────────────────────

router.get("/feedback", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const items = await db.select().from(appFeedback).where(eq(appFeedback.orgId, orgId)).orderBy(desc(appFeedback.createdAt));
  res.json(items);
}));

router.post("/feedback", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { type, title, rawDescription, refinedDescription, acceptanceCriteria, status, sourcePage } = req.body;
  if (!title || !rawDescription) return res.status(400).json({ error: "title and rawDescription are required" });
  const [item] = await db.insert(appFeedback).values({
    type: type ?? "enhancement",
    title,
    rawDescription,
    refinedDescription: refinedDescription ?? null,
    acceptanceCriteria: acceptanceCriteria ?? null,
    status: status ?? "new",
    sourcePage: sourcePage ?? null,
    orgId,
  }).returning();
  res.json(item);
}));

router.patch("/feedback/:id", isApproved, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "status is required" });
  const [updated] = await db
    .update(appFeedback)
    .set({ status, updatedAt: new Date() })
    .where(eq(appFeedback.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
}));

router.delete("/feedback/:id", isApproved, asyncRoute(async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(appFeedback).where(eq(appFeedback.id, id));
  res.json({ ok: true });
}));

router.post("/feedback/refine", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { type, rawDescription } = req.body;
  if (!rawDescription?.trim()) return res.status(400).json({ error: "rawDescription is required" });
  const apiKey = await getPlatformOpenAIKey();
  if (!apiKey) return res.status(400).json({ error: "OpenAI API key not configured" });

  const typeLabels: Record<string, string> = {
    defect: "Bug / Defect",
    enhancement: "Enhancement",
    feature: "New Feature / Capability",
  };
  const typeLabel = typeLabels[type] ?? "Enhancement";

  const systemPrompt = `You are E.L.F.I.E., the AI assistant for E.L.F.I.E. (Electronic Lifeform For Intelligent Elements), a LEGO reselling business operations platform.
Your job is to take a user's raw app feedback and refine it into a clear, structured request that can be handed to a developer.
Write everything in plain English that a non-technical business owner can understand.
Your response MUST be valid JSON with these exact keys: title, refinedDescription, acceptanceCriteria.
- title: a short (under 10 words), action-oriented title
- refinedDescription: 2-4 sentences clearly explaining what the user wants and why it matters to their business
- acceptanceCriteria: a newline-separated list of 3-6 bullet points (plain text, no markdown) describing what "done" looks like from the user's perspective`;

  const userPrompt = `Feedback type: ${typeLabel}\n\nUser's raw description:\n${rawDescription}\n\nRefine this into a structured request.`;

  const client = new OpenAI({ apiKey });
  const completionModel = "gpt-4o-mini";
  const completion = await client.chat.completions.create({
    model: completionModel,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.4,
    max_tokens: 600,
  });

  if (completion.usage) {
    const { trackUsage } = await import('../services/ai-usage-tracker');
    trackUsage({
      service: 'openai',
      model: completionModel,
      operation: 'feedback-refine',
      inputTokens: completion.usage.prompt_tokens || 0,
      outputTokens: completion.usage.completion_tokens || 0,
      totalTokens: completion.usage.total_tokens || 0,
      orgId: orgId || null,
    });
  }

  const text = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(text);

  res.json({
    title: parsed.title ?? "Untitled Request",
    refinedDescription: parsed.refinedDescription ?? rawDescription,
    acceptanceCriteria: parsed.acceptanceCriteria ?? "",
  });
}));

// ── Labels ─────────────────────────────────────────────────────────────────────

router.post("/labels/combined", isApproved, asyncRoute(async (req, res) => {
  const { labelUrls } = req.body as { labelUrls: string[] };
  if (!Array.isArray(labelUrls) || labelUrls.length === 0) {
    return res.status(400).json({ error: "labelUrls array is required" });
  }

  const { PDFDocument } = await import('pdf-lib');

  const pdfBuffers = await Promise.all(
    labelUrls.map(async (url) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`Failed to fetch label: ${r.status} ${url}`);
      return Buffer.from(await r.arrayBuffer());
    })
  );

  const merged = await PDFDocument.create();
  for (const buf of pdfBuffers) {
    const src = await PDFDocument.load(buf);
    const pages = await merged.copyPages(src, src.getPageIndices());
    pages.forEach(p => merged.addPage(p));
  }

  const mergedBytes = await merged.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="shipping-labels.pdf"');
  res.send(Buffer.from(mergedBytes));
}));

// ── Admin Cleanup ──────────────────────────────────────────────────────────────

router.post('/admin/cleanup-false-refunds', isSuperAdmin, asyncRoute(async (_req, res) => {
  const candidates = await db
    .select({
      id: orderAdjustments.id,
      orderId: orderAdjustments.orderId,
      amount: orderAdjustments.amount,
      externalId: orderAdjustments.externalTransactionId,
      shipping: orders.shippingAmount,
    })
    .from(orderAdjustments)
    .innerJoin(orders, eq(orders.id, orderAdjustments.orderId))
    .where(
      and(
        sql`${orderAdjustments.externalTransactionId} LIKE 'bo-%-partial-%'`,
        eq(orderAdjustments.reason, 'Partial refund')
      )
    );

  const toDelete = candidates.filter(c => {
    const adjAbs = Math.abs(Number(c.amount));
    const shipping = Number(c.shipping ?? 0);
    return shipping > 0 && Math.abs(adjAbs - shipping) < 0.02;
  });

  if (toDelete.length === 0) {
    return res.json({ deleted: 0, message: 'No false-refund adjustments found.' });
  }

  const ids = toDelete.map(r => r.id);
  await db.delete(orderAdjustments).where(sql`${orderAdjustments.id} = ANY(${ids})`);

  console.log(`Cleanup: deleted ${ids.length} false partial-refund adjustments:`, ids);
  return res.json({ deleted: ids.length, ids, orders: toDelete.map(r => r.orderId) });
}));

export default router;
