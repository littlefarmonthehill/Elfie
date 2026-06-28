import { Router } from 'express';
import { asyncRoute, reqOrgId, resolvedCatalogItemName, getOrgSettings, updateOrgSettings } from '../lib/routeHelpers';
import { apiErrorHandler } from '../middleware/errorHandler';
import { isApproved } from '../auth';
import { db } from '../db';
import { eq, sql, and, desc, asc, inArray, isNull, isNotNull, gt, gte, lte, or } from 'drizzle-orm';
import { blInventory, blCatalog, priceGuideCache, blCategories, appSettings, pricingModel, syncMetadata, blApiCalls, blColors, blForumPosts, marketNews, businessInsights, ieStrategies, pomAiSettings, pomPriceDecisions, orderDetails, orders, whBins, inventoryLocations } from '@shared/schema';
import { z } from 'zod';
import OpenAI from 'openai';
import { getPlatformOpenAIKey, getPlatformSettings } from '../lib/platformSettings';
import { syncBricklinkData, fetchPriceOMagicData, calculateSuggestedPriceWithSupply, bricklinkCatalogRequest, requestPomSyncStop, syncPriceOMagicCache } from '../services/bricklink';
import { getPomIsRunning, setPomIsRunning } from '../services/pom-scheduler';
import { checkAutomationLimit } from '../services/tierEnforcement';
import { trackUsage } from '../services/ai-usage-tracker';

const router = Router();

// ── Pricing Routes ───────────────────────────────────────────────────────────

router.post("/priceomatic/fetch-pricing", isApproved, asyncRoute(async (req, res) => {
  const { itemNo, itemType, colorId, newOrUsed } = req.body;
  if (!itemNo || !itemType || !newOrUsed) {
    return res.status(400).json({ error: "itemNo, itemType and newOrUsed are required" });
  }
  const colorIdNum = colorId != null ? parseInt(colorId) : undefined;

  // Force full refresh: delete existing cache entry so fetchPriceOMagicData re-fetches both sold + stock
  await db.delete(priceGuideCache).where(
    and(
      eq(priceGuideCache.itemNo, itemNo),
      eq(priceGuideCache.itemType, itemType),
      eq(priceGuideCache.colorId, colorIdNum ?? -1),
      eq(priceGuideCache.newOrUsed, newOrUsed)
    )
  );

  const result = await fetchPriceOMagicData(
    itemNo,
    itemType,
    colorIdNum,
    newOrUsed,
  );

  res.json({
    stockAvgPrice: result.stockAvgPrice,
    stockMinPrice: result.stockMinPrice,
    stockMaxPrice: result.stockMaxPrice,
    stockQuantity: result.stockQuantity,   // piece count — required for STR calculation
    stockTotalLots: result.stockTotalLots, // lot/seller count
    soldAvgPrice: result.soldAvgPrice,
    soldMinPrice: result.soldMinPrice,
    soldMaxPrice: result.soldMaxPrice,
    soldQuantity: result.soldQuantity,
    soldTotalLots: result.soldTotalLots,
  });
}));

router.get("/pom/spot-lookup", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const { partNo, itemType = 'P', colorId, newOrUsed = 'N', forceRefresh } = req.query;

  if (!partNo || typeof partNo !== 'string' || !partNo.trim()) {
    return res.status(400).json({ error: "partNo is required" });
  }

  const partNoClean = partNo.trim().toUpperCase();
  const colorIdNum = colorId ? parseInt(colorId as string) : undefined;

  const config = await getOrgSettings(orgId);

  // If forceRefresh=true, delete any cached entry so fetchPriceOMagicData makes fresh API calls
  if (forceRefresh === 'true') {
    await db.delete(priceGuideCache).where(and(
      eq(priceGuideCache.itemNo, partNoClean.toUpperCase()),
      eq(priceGuideCache.itemType, itemType as string),
      eq(priceGuideCache.colorId, colorIdNum ?? -1),
      eq(priceGuideCache.newOrUsed, newOrUsed as string)
    ));
  }

  // Fetch market data (sold guide only when skipStock=true; both when full fetch)
  const priceData = await fetchPriceOMagicData(
    partNoClean,
    itemType as string,
    colorIdNum,
    newOrUsed as string,
    undefined,
    undefined,
    true // skipStock — sold guide only for spot lookup
  );

  // Also check inventory for this part — filter by color if one was specified
  const inventoryLots = await db
    .select({
      id: blInventory.id,
      itemType: blInventory.itemType,
      colorId: blInventory.colorId,
      colorName: blColors.name,
      colorRgb: blColors.rgb,
      quantity: blInventory.quantity,
      unitPrice: blInventory.unitPrice,
      newOrUsed: blInventory.newOrUsed,
    })
    .from(blInventory)
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .where(
      colorIdNum !== undefined
        ? and(eq(blInventory.orgId, orgId), sql`upper(${blInventory.itemNo}) = ${partNoClean}`, eq(blInventory.colorId, colorIdNum))
        : and(eq(blInventory.orgId, orgId), sql`upper(${blInventory.itemNo}) = ${partNoClean}`)
    )
    .orderBy(blColors.name);

  const actualItemType = inventoryLots[0]?.itemType ?? (itemType as string);
  const mainKey = `${colorIdNum ?? 'null'}_${newOrUsed}`;
  const lotPriceData: Record<string, typeof priceData> = { [mainKey]: priceData };

  const seenCombos = new Set<string>([mainKey]);
  const combosToFetch: Array<{ colorId: number | null; itemType: string; newOrUsed: string; key: string }> = [];
  const seenColors = new Set<string>();
  for (const lot of inventoryLots) {
    const colorKey = String(lot.colorId ?? 'null');
    const lotItemType = lot.itemType ?? actualItemType;
    if (!seenColors.has(colorKey)) {
      seenColors.add(colorKey);
      for (const condition of ['N', 'U']) {
        const key = `${colorKey}_${condition}`;
        if (!seenCombos.has(key)) {
          seenCombos.add(key);
          combosToFetch.push({ colorId: lot.colorId, itemType: lotItemType, newOrUsed: condition, key });
        }
      }
    }
  }

  await Promise.all(
    combosToFetch.map(async (combo) => {
      try {
        const pd = await fetchPriceOMagicData(
          partNoClean,
          combo.itemType,
          combo.colorId ?? undefined,
          combo.newOrUsed,
          config.pomSugStorePremium,
          config,
          true // skipStock — score-only; user fetches pricing on demand
        );
        lotPriceData[combo.key] = pd;
      } catch (err) {
        console.warn(`[POM Spot Lookup] Failed price fetch for combo ${combo.key}:`, err);
      }
    })
  );

  const peakByColor = new Map<string, number>();
  Object.entries(lotPriceData).forEach(([key, pd]: [string, any]) => {
    const colorKey = key.substring(0, key.lastIndexOf('_'));
    const soldMax = pd.soldMaxPrice ? parseFloat(pd.soldMaxPrice) : 0;
    if (soldMax > 0) {
      peakByColor.set(colorKey, Math.max(peakByColor.get(colorKey) ?? 0, soldMax));
    }
  });

  const inventoryLotsEnriched = inventoryLots.map(lot => {
    const colorKey = String(lot.colorId ?? 'null');
    const colorPeak = peakByColor.get(colorKey) ?? null;
    const currentPrice = lot.unitPrice ? parseFloat(lot.unitPrice) : 0;
    const opportunityScore = (colorPeak && currentPrice > 0)
      ? Number((colorPeak / currentPrice).toFixed(2))
      : null;
    return {
      ...lot,
      opportunityScore,
      marketPeakSoldPrice: colorPeak ? colorPeak.toFixed(4) : null,
    };
  });

  const thresholds = {
    tooHigh: config?.pomTooHighThreshold ?? 25,
    tooLow: config?.pomTooLowThreshold ?? 25,
  };

  res.json({ priceData, inventoryLots: inventoryLotsEnriched, lotPriceData, thresholds, storedToCache: true });
}));

router.get("/priceomatic/deep-space", isApproved, asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const orgId = reqOrgId(req);
  const settings = await getOrgSettings(orgId);
  const raw = settings?.pomDeepSpaceKeys || '[]';
  const parsed: unknown[] = JSON.parse(raw);
  type StoredGroupInfo = { key: string; itemNo: string; itemName: string | null; colorId: number | null; colorName: string | null };
  const items: StoredGroupInfo[] = parsed.map((el: unknown) =>
    typeof el === 'string'
      ? { key: el, itemNo: el.split('_')[0], itemName: null, colorId: null, colorName: null }
      : el as StoredGroupInfo
  );
  const keys = items.map(i => i.key);
  res.json({ success: true, keys, items });
}));

router.put("/priceomatic/deep-space", isApproved, asyncRoute(async (req, res) => {
  const { items } = req.body as { items?: { key: string; itemNo: string; itemName: string | null; colorId: number | null; colorName: string | null }[]; keys?: string[] };
  const toStore = items ?? (req.body.keys as string[] | undefined)?.map((k: string) => ({ key: k, itemNo: k.split('_')[0], itemName: null, colorId: null, colorName: null })) ?? [];
  if (!Array.isArray(toStore)) return res.status(400).json({ success: false, error: "items must be an array" });
  const json = JSON.stringify(toStore);
  const orgId = reqOrgId(req);
  await db.insert(appSettings).values({ id: orgId, orgId, pomDeepSpaceKeys: json })
    .onConflictDoUpdate({ target: appSettings.id, set: { pomDeepSpaceKeys: json, updatedAt: new Date() } });
  res.json({ success: true, keys: toStore.map((i: { key: string }) => i.key), items: toStore });
}));

router.get("/priceomatic/future-missions", isApproved, asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const orgId = reqOrgId(req);
  const settings = await getOrgSettings(orgId);
  const raw = settings?.pomFutureMissionsKeys || '[]';
  const parsed: unknown[] = JSON.parse(raw);
  type StoredGroupInfo = { key: string; itemNo: string; itemName: string | null; colorId: number | null; colorName: string | null };
  const items: StoredGroupInfo[] = parsed.map((el: unknown) =>
    typeof el === 'string'
      ? { key: el, itemNo: el.split('_')[0], itemName: null, colorId: null, colorName: null }
      : el as StoredGroupInfo
  );
  res.json({ success: true, keys: items.map(i => i.key), items });
}));

router.put("/priceomatic/future-missions", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const { items } = req.body as { items?: { key: string; itemNo: string; itemName: string | null; colorId: number | null; colorName: string | null }[] };
  const toStore = items ?? [];
  if (!Array.isArray(toStore)) return res.status(400).json({ success: false, error: "items must be an array" });
  const json = JSON.stringify(toStore);
  await db.insert(appSettings).values({ id: orgId, orgId, pomFutureMissionsKeys: json })
    .onConflictDoUpdate({ target: appSettings.id, set: { pomFutureMissionsKeys: json, updatedAt: new Date() } });
  res.json({ success: true, keys: toStore.map((i: { key: string }) => i.key), items: toStore });
}));

router.get("/ie-strategies", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const [row] = await db.select().from(ieStrategies).where(eq(ieStrategies.orgId, orgId)).limit(1);
  res.json(row ?? { orgId, visionMission: null, successFactors: null, pricingStrategy: null, pricingStrategyPreset: null, inventoryStrategy: null, ordersStrategy: null, customerStrategy: null, marketStrategy: null });
}));

router.put("/ie-strategies", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const { visionMission, successFactors, pricingStrategy, pricingStrategyPreset, inventoryStrategy, ordersStrategy, customerStrategy, marketStrategy } = req.body;
  const set: Record<string, any> = { updatedAt: new Date() };
  if (visionMission !== undefined) set.visionMission = visionMission || null;
  if (successFactors !== undefined) set.successFactors = successFactors || null;
  if (pricingStrategy !== undefined) set.pricingStrategy = pricingStrategy || null;
  if (pricingStrategyPreset !== undefined) set.pricingStrategyPreset = pricingStrategyPreset || null;
  if (inventoryStrategy !== undefined) set.inventoryStrategy = inventoryStrategy || null;
  if (ordersStrategy !== undefined) set.ordersStrategy = ordersStrategy || null;
  if (customerStrategy !== undefined) set.customerStrategy = customerStrategy || null;
  if (marketStrategy !== undefined) set.marketStrategy = marketStrategy || null;
  const [updated] = await db.insert(ieStrategies)
    .values({ orgId, ...set })
    .onConflictDoUpdate({ target: ieStrategies.orgId, set })
    .returning();
  res.json(updated);
}));

router.post("/ie-strategies/extract-weights", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const { preset, strategyText } = req.body as { preset: string; strategyText?: string };
  if (!preset) return res.status(400).json({ error: 'preset required' });

  const PRESET_DEFAULTS: Record<string, { wCeiling: number; wVelocity: number; wScarcity: number; wUndercut: number }> = {
    premium:         { wCeiling: 0.15, wVelocity: 0.20, wScarcity: 0.50, wUndercut: 0.15 },
    market_rate:     { wCeiling: 0.30, wVelocity: 0.30, wScarcity: 0.20, wUndercut: 0.20 },
    balanced:        { wCeiling: 0.25, wVelocity: 0.25, wScarcity: 0.25, wUndercut: 0.25 },
    clear_inventory: { wCeiling: 0.10, wVelocity: 0.42, wScarcity: 0.08, wUndercut: 0.40 },
  };

  const defaults = PRESET_DEFAULTS[preset] ?? PRESET_DEFAULTS.balanced;

  if (!strategyText?.trim()) {
    await updateOrgSettings(orgId, {
      pomWeightCeiling: defaults.wCeiling,
      pomWeightVelocity: defaults.wVelocity,
      pomWeightScarcity: defaults.wScarcity,
      pomWeightUndercut: defaults.wUndercut,
    });
    return res.json({ weights: defaults, source: 'preset' });
  }

  const platSettings = await getPlatformSettings();
  const openAiKey = platSettings?.openaiApiKey;
  if (!openAiKey) {
    await updateOrgSettings(orgId, {
      pomWeightCeiling: defaults.wCeiling,
      pomWeightVelocity: defaults.wVelocity,
      pomWeightScarcity: defaults.wScarcity,
      pomWeightUndercut: defaults.wUndercut,
    });
    return res.json({ weights: defaults, source: 'preset_fallback' });
  }

  const PRESET_LABELS: Record<string, string> = {
    premium: 'Premium Seller',
    market_rate: 'Market Rate',
    balanced: 'Balanced',
    clear_inventory: 'Clear Inventory',
  };
  const PRESET_RANGES: Record<string, string> = {
    premium:         'wCeiling 0.05-0.25, wVelocity 0.10-0.30, wScarcity 0.35-0.65, wUndercut 0.05-0.20',
    market_rate:     'wCeiling 0.20-0.40, wVelocity 0.20-0.40, wScarcity 0.10-0.25, wUndercut 0.15-0.30',
    balanced:        'wCeiling 0.15-0.35, wVelocity 0.15-0.35, wScarcity 0.15-0.35, wUndercut 0.15-0.35',
    clear_inventory: 'wCeiling 0.03-0.18, wVelocity 0.30-0.55, wScarcity 0.03-0.15, wUndercut 0.30-0.55',
  };

  const prompt = `You are a pricing configuration system for a LEGO reseller platform.

Preset: ${PRESET_LABELS[preset] ?? preset}
Preset weight ranges: ${PRESET_RANGES[preset] ?? 'each 0.1-0.4'}
Seller's pricing description: "${strategyText.trim()}"

Based on the preset and any nuances in the description, choose final scoring weights.
Dimensions:
- wCeiling: how much room to raise price vs sold avg/peak (ceiling ratio)
- wVelocity: STR (Sell-Through Rate = sold qty ÷ listed qty). STR>100% = demand surge, 40-100% = healthy demand, <40% = slow mover. Capped at 100% for scoring so fast-sellers don't crowd out other signals.
- wScarcity: how rare the item is (fewer sellers = scarcer)
- wUndercut: price position vs market min (undercutRatio = myPrice ÷ marketMin). Ratio < 1 = you're cheapest (adds to score), ratio > 1 = being undercut (subtracts from score). Higher weight amplifies both the boost and the penalty.

Stay within the preset ranges. All four weights must sum to exactly 1.0.
Respond ONLY as JSON: {"wCeiling": 0.00, "wVelocity": 0.00, "wScarcity": 0.00, "wUndercut": 0.00}`;

  const openai = new OpenAI({ apiKey: openAiKey });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 80,
    response_format: { type: 'json_object' },
  });
  if (completion.usage) trackUsage({ service: 'openai', model: 'gpt-4o-mini', operation: 'pom-weights', inputTokens: completion.usage.prompt_tokens || 0, outputTokens: completion.usage.completion_tokens || 0, totalTokens: completion.usage.total_tokens || 0, orgId });

  const raw = completion.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw);
  const w = {
    wCeiling:  typeof parsed.wCeiling  === 'number' ? Math.max(0, Math.min(1, parsed.wCeiling))  : defaults.wCeiling,
    wVelocity: typeof parsed.wVelocity === 'number' ? Math.max(0, Math.min(1, parsed.wVelocity)) : defaults.wVelocity,
    wScarcity: typeof parsed.wScarcity === 'number' ? Math.max(0, Math.min(1, parsed.wScarcity)) : defaults.wScarcity,
    wUndercut: typeof parsed.wUndercut === 'number' ? Math.max(0, Math.min(1, parsed.wUndercut)) : defaults.wUndercut,
  };
  const total = w.wCeiling + w.wVelocity + w.wScarcity + w.wUndercut;
  if (total > 0) {
    w.wCeiling  = Number((w.wCeiling  / total).toFixed(3));
    w.wVelocity = Number((w.wVelocity / total).toFixed(3));
    w.wScarcity = Number((w.wScarcity / total).toFixed(3));
    w.wUndercut = Number((w.wUndercut / total).toFixed(3));
  }

  await updateOrgSettings(orgId, {
    pomWeightCeiling:  w.wCeiling,
    pomWeightVelocity: w.wVelocity,
    pomWeightScarcity: w.wScarcity,
    pomWeightUndercut: w.wUndercut,
  });

  res.json({ weights: w, source: 'ai' });
}));

router.get("/pom/ai-settings", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const [row] = await db.select().from(pomAiSettings).where(eq(pomAiSettings.orgId, orgId)).limit(1);
  res.json(row ?? { orgId, aiEnabled: false, aiStrategy: null, decisionCount: 0, sortMode: 'scoring' });
}));

router.patch("/pom/ai-settings", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const { aiEnabled, aiStrategy, sortMode } = req.body as { aiEnabled?: boolean; aiStrategy?: string; sortMode?: string };
  const updateSet: Record<string, any> = { updatedAt: new Date() };
  if (aiEnabled !== undefined) updateSet.aiEnabled = aiEnabled;
  if (aiStrategy !== undefined) updateSet.aiStrategy = aiStrategy;
  if (sortMode !== undefined) updateSet.sortMode = sortMode;
  const [updated] = await db.insert(pomAiSettings)
    .values({ orgId, ...updateSet, createdAt: new Date() })
    .onConflictDoUpdate({ target: pomAiSettings.orgId, set: updateSet })
    .returning();
  res.json(updated);
}));

router.post("/pom/price-decision", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const { itemNo, colorId, newOrUsed, suggestedPrice, actualPrice, marketSnapshot } = req.body;
  if (!itemNo || !actualPrice) return res.status(400).json({ error: 'itemNo and actualPrice required' });
  const delta = suggestedPrice != null ? (Number(actualPrice) - Number(suggestedPrice)) : null;
  await db.insert(pomPriceDecisions).values({
    orgId,
    itemNo,
    colorId: colorId ?? null,
    newOrUsed: newOrUsed ?? 'N',
    suggestedPrice: suggestedPrice != null ? String(suggestedPrice) : null,
    actualPrice: String(actualPrice),
    priceDelta: delta != null ? String(delta) : null,
    marketSnapshot: marketSnapshot ?? null,
    decisionAt: new Date(),
  });
  await db.insert(pomAiSettings)
    .values({ orgId, decisionCount: 1, createdAt: new Date(), updatedAt: new Date() })
    .onConflictDoUpdate({ target: pomAiSettings.orgId, set: { decisionCount: sql`pom_ai_settings.decision_count + 1`, updatedAt: new Date() } });
  res.json({ success: true });
}));

router.post("/pom/ai-suggest", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const [aiSettings] = await db.select().from(pomAiSettings).where(eq(pomAiSettings.orgId, orgId)).limit(1);
  if (!aiSettings?.aiEnabled) return res.status(403).json({ error: 'AI pricing is not enabled' });

  const { itemNo, colorId, newOrUsed, pomSuggested, marketData, itemName } = req.body as {
    itemNo: string;
    colorId?: number;
    newOrUsed?: string;
    pomSuggested?: number;
    itemName?: string;
    marketData?: {
      soldAvgPrice?: string; soldMaxPrice?: string; stockMinPrice?: string;
      soldQuantity?: number; stockQuantity?: number;
    };
  };

  const recentDecisions = await db.select().from(pomPriceDecisions)
    .where(and(eq(pomPriceDecisions.orgId, orgId), eq(pomPriceDecisions.itemNo, itemNo)))
    .orderBy(sql`decision_at DESC`)
    .limit(5);

  const recentNews = await db.select({ title: marketNews.title, snippet: marketNews.snippet })
    .from(marketNews)
    .orderBy(sql`fetched_at DESC`)
    .limit(3);

  const [ieRow] = await db.select({ pricingStrategy: ieStrategies.pricingStrategy }).from(ieStrategies).where(eq(ieStrategies.orgId, orgId)).limit(1);
  const strategy = ieRow?.pricingStrategy || aiSettings.aiStrategy || 'Maximize revenue by selling at or above market value. Prefer fewer high-value sales over high volume at lower prices.';
  const condition = newOrUsed === 'U' ? 'Used' : 'New';

  const prompt = `You are a pricing advisor for a LEGO reseller marketplace (BrickLink). 
      
Pricing Strategy: "${strategy}"

Item: ${itemName || itemNo} (Part# ${itemNo}${colorId ? `, Color ID: ${colorId}` : ''}, ${condition})
POM Algorithm Suggested Price: ${pomSuggested != null ? `$${pomSuggested.toFixed(2)}` : 'N/A'}

Current Market Data:
- Sold Average: ${marketData?.soldAvgPrice ? `$${marketData.soldAvgPrice}` : 'N/A'}
- Sold Maximum: ${marketData?.soldMaxPrice ? `$${marketData.soldMaxPrice}` : 'N/A'}
- Current Market Minimum: ${marketData?.stockMinPrice ? `$${marketData.stockMinPrice}` : 'N/A'}
- Units Sold Recently: ${marketData?.soldQuantity ?? 'N/A'}
- Current Listings: ${marketData?.stockQuantity ?? 'N/A'}

${recentDecisions.length > 0 ? `Your Recent Pricing Decisions for This Item:
${recentDecisions.map(d => `- Set $${Number(d.actualPrice).toFixed(2)}${d.suggestedPrice ? ` (POM suggested $${Number(d.suggestedPrice).toFixed(2)}, delta ${Number(d.priceDelta) >= 0 ? '+' : ''}${Number(d.priceDelta).toFixed(2)})` : ''}`).join('\n')}` : ''}

${recentNews.length > 0 ? `Recent Market News (may signal trends):
${recentNews.map(n => `- ${n.title}: ${n.snippet}`).join('\n')}` : ''}

Based on the pricing strategy, market data, and any relevant trends, provide:
1. A recommended price (single number, USD)
2. One concise sentence (max 15 words) explaining why

Respond ONLY as JSON: {"price": 0.00, "reasoning": "..."}`;

  const pomPlatSettings = await getPlatformSettings();
  const pomOpenAiKey = pomPlatSettings?.openaiApiKey;
  if (!pomOpenAiKey) return res.status(500).json({ error: "No AI API key configured" });
  const openai = new OpenAI({ apiKey: pomOpenAiKey });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 120,
    response_format: { type: 'json_object' },
  });
  if (completion.usage) trackUsage({ service: 'openai', model: 'gpt-4o-mini', operation: 'pom-ai-suggest', inputTokens: completion.usage.prompt_tokens || 0, outputTokens: completion.usage.completion_tokens || 0, totalTokens: completion.usage.total_tokens || 0, orgId });

  const raw = completion.choices[0]?.message?.content || '{}';
  const parsed = JSON.parse(raw);
  const price = typeof parsed.price === 'number' ? Number(parsed.price.toFixed(2)) : null;
  const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : null;

  res.json({ price, reasoning, decisionCount: aiSettings.decisionCount });
}));

router.get("/priceomatic/category-tiers", isApproved, asyncRoute(async (req, res) => {
  const categories = await db
    .selectDistinct({ id: blCategories.id, name: blCategories.name, priorityTier: blCategories.priorityTier })
    .from(blCategories)
    .innerJoin(blCatalog, eq(blCatalog.categoryId, blCategories.id))
    .orderBy(blCategories.name);
  res.json({ success: true, categories });
}));

router.patch("/priceomatic/category-tier", isApproved, asyncRoute(async (req, res) => {
  const { categoryId, tier } = req.body as { categoryId: number; tier: string };
  if (!categoryId || !['tier1', 'tier2', 'tier3', 'tier4', 'standard'].includes(tier)) {
    return res.status(400).json({ error: "Invalid categoryId or tier" });
  }
  await db
    .update(blCategories)
    .set({ priorityTier: tier, updatedAt: new Date() })
    .where(eq(blCategories.id, categoryId));
  res.json({ success: true });
}));

router.post("/priceomatic/tier-reset", isApproved, asyncRoute(async (req, res) => {
  const categories = await db
    .select({ id: blCategories.id, name: blCategories.name, priorityTier: blCategories.priorityTier })
    .from(blCategories);

  function autoAssignTier(name: string): string {
    const n = name.toLowerCase();
    if (n.includes('minifig') || n.startsWith('minifigure')) return 'tier1';
    if (n.includes('bionicle')) return 'tier1';
    if (n.includes('large figure')) return 'tier1';
    if (n.includes('collectible minifigure') || n.startsWith('collectible')) return 'tier1';
    if (n.startsWith('technic')) return 'tier2';
    if (n.includes('slope') || n.includes('inverted slope')) return 'tier2';
    if (n.includes('bracket') || n.includes('snot')) return 'tier2';
    if (n.includes('modified brick') || n.includes('modified plate') || n.includes('modified tile')) return 'tier2';
    if (n.includes('hinge') || n.includes('clip') || n.includes('bar, connected')) return 'tier2';
    if (n.includes('electric') || n.includes('battery') || n.includes('motor') || n.includes('pneumatic')) return 'tier2';
    if (n.includes('power function') || n.includes('powered up') || n.includes('train')) return 'tier2';
    if (n.includes('windscreen') || n.includes('window') || n.includes('door,')) return 'tier2';
    if (n.includes('decorated') && (n.includes('plate') || n.includes('brick') || n.includes('tile') || n.includes('slope'))) return 'tier2';
    if (n.includes('container') || n.includes('vehicle') || n.includes('cockpit') || n.includes('fuselage')) return 'tier2';
    if (n.startsWith('brick') || n.startsWith('plate') || n.startsWith('tile') ||
        n.startsWith('bar') || n.startsWith('cylinder') || n.startsWith('wedge') ||
        n.startsWith('arch') || n.startsWith('round') || n.startsWith('cone') ||
        n.startsWith('panel') || n.startsWith('fence') || n.startsWith('flag') ||
        n.startsWith('plant') || n.startsWith('animal') || n.startsWith('rock')) return 'tier3';
    if (n.startsWith('sticker') || n.startsWith('label') || n.startsWith('book') ||
        n.startsWith('magazine') || n.startsWith('catalog') || n.startsWith('instruction') ||
        n.startsWith('extra items') || n.startsWith('box')) return 'tier4';
    return 'standard';
  }

  for (const cat of categories) {
    const newTier = autoAssignTier(cat.name);
    if (newTier !== cat.priorityTier) {
      await db.update(blCategories)
        .set({ priorityTier: newTier, updatedAt: new Date() })
        .where(eq(blCategories.id, cat.id));
    }
  }
  res.json({ success: true });
}));

router.get("/listomatc/category-phases", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const [categories, [unassignedRow], [filingQueueRow], [unfiledNoRtfRow], rtfRows] = await Promise.all([
    db.selectDistinct({
      id: blCategories.id,
      name: blCategories.name,
      sortingPhase: blCategories.sortingPhase,
    })
    .from(blCategories)
    .innerJoin(blCatalog, eq(blCatalog.categoryId, blCategories.id))
    .orderBy(blCategories.name),

    db.select({ count: sql<number>`COUNT(*)` })
      .from(blInventory)
      .leftJoin(inventoryLocations, eq(inventoryLocations.inventoryId, blInventory.id))
      .where(and(eq(blInventory.orgId, orgId), isNull(blInventory.deletedAt), gt(blInventory.quantity, 0), isNull(inventoryLocations.id))),

    db.select({ count: sql<number>`COUNT(DISTINCT ${inventoryLocations.inventoryId})` })
      .from(inventoryLocations)
      .innerJoin(whBins, and(eq(whBins.id, inventoryLocations.binId), eq(whBins.isFilingQueue, true)))
      .innerJoin(blInventory, and(eq(blInventory.id, inventoryLocations.inventoryId), eq(blInventory.orgId, orgId), isNull(blInventory.deletedAt), gt(blInventory.quantity, 0)))
      .where(eq(inventoryLocations.orgId, orgId)),

    // "Unfiled & untagged" — lots that have neither a real bin nor an rtf
    // pre-sort hint. These are brand-new lots the lister hasn't even
    // printed labels for yet; nothing tells anyone where to find them.
    // Zero-qty lots are excluded — nothing to physically file.
    db.select({ count: sql<number>`COUNT(*)` })
      .from(blInventory)
      .leftJoin(inventoryLocations, eq(inventoryLocations.inventoryId, blInventory.id))
      .where(and(
        eq(blInventory.orgId, orgId),
        isNull(blInventory.deletedAt),
        gt(blInventory.quantity, 0),
        isNull(inventoryLocations.id),
        isNull(blInventory.rtfBin),
      )),

    // Per-rtf bucket counts so the dashboard can render one bubble per
    // tote that actually has bags in it (rtf 0, rtf 3, …).
    // Exclude lots already assigned to any bin (filed into a real location)
    // so the count resets to 0 once the bag has been physically filed.
    // Exclude soft-deleted lots and zero-qty lots — nothing to physically file.
    db.select({ rtfBin: blInventory.rtfBin, count: sql<number>`COUNT(*)` })
      .from(blInventory)
      .leftJoin(inventoryLocations, eq(inventoryLocations.inventoryId, blInventory.id))
      .where(and(eq(blInventory.orgId, orgId), isNull(blInventory.deletedAt), gt(blInventory.quantity, 0), isNotNull(blInventory.rtfBin), isNull(inventoryLocations.id)))
      .groupBy(blInventory.rtfBin),
  ]);

  const unassignedLots = Number(unassignedRow?.count ?? 0);
  const filingQueueLots = Number(filingQueueRow?.count ?? 0);
  const fileLotCounts = { unassignedLots, filingQueueLots, total: unassignedLots + filingQueueLots };

  // Sort rtf buckets numerically when possible so "rtf 0, rtf 1, rtf 2, …"
  // line up naturally; fall back to lexicographic for non-numeric tags.
  const rtfLotCounts = {
    unfiled: Number(unfiledNoRtfRow?.count ?? 0),
    byRtf: (rtfRows ?? [])
      .map(r => ({ rtfBin: String(r.rtfBin), count: Number(r.count) }))
      .filter(r => r.count > 0)
      .sort((a, b) => {
        const an = Number(a.rtfBin), bn = Number(b.rtfBin);
        if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
        return a.rtfBin.localeCompare(b.rtfBin);
      }),
  };

  res.json({ success: true, categories, fileLotCounts, rtfLotCounts });
}));

// ── Filing drill-down: lots with no bin and no rtf hint (truly unfiled) ──────
router.get("/listomatc/unfiled-lots", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const rows = await db
    .select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      newOrUsed: blInventory.newOrUsed,
      quantity: blInventory.quantity,
      itemName: blCatalog.itemName,
      colorName: blCatalog.colorName,
    })
    .from(blInventory)
    .leftJoin(blCatalog, and(
      eq(blCatalog.itemNo, blInventory.itemNo),
      eq(blCatalog.itemType, blInventory.itemType),
      eq(blCatalog.colorId, blInventory.colorId),
    ))
    .leftJoin(inventoryLocations, eq(inventoryLocations.inventoryId, blInventory.id))
    .where(and(
      eq(blInventory.orgId, orgId),
      isNull(blInventory.deletedAt),
      gt(blInventory.quantity, 0),
      isNull(inventoryLocations.id),
      isNull(blInventory.rtfBin),
    ))
    .orderBy(blCatalog.colorName, blInventory.itemNo)
    .limit(300);
  res.json({ lots: rows });
}));

// ── Filing drill-down: lots in a specific rtf bucket (have hint, not yet filed) ──
router.get("/listomatc/rtf-lots", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { rtfBin } = req.query as { rtfBin?: string };
  if (!rtfBin) return res.status(400).json({ error: "rtfBin query param required" });

  const rows = await db
    .select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      newOrUsed: blInventory.newOrUsed,
      quantity: blInventory.quantity,
      rtfBin: blInventory.rtfBin,
      itemName: blCatalog.itemName,
      colorName: blCatalog.colorName,
    })
    .from(blInventory)
    .leftJoin(blCatalog, and(
      eq(blCatalog.itemNo, blInventory.itemNo),
      eq(blCatalog.itemType, blInventory.itemType),
      eq(blCatalog.colorId, blInventory.colorId),
    ))
    .leftJoin(inventoryLocations, eq(inventoryLocations.inventoryId, blInventory.id))
    .where(and(
      eq(blInventory.orgId, orgId),
      isNull(blInventory.deletedAt),
      gt(blInventory.quantity, 0),
      eq(blInventory.rtfBin, rtfBin),
      isNull(inventoryLocations.id),
    ))
    .orderBy(blCatalog.colorName, blInventory.itemNo)
    .limit(300);
  res.json({ lots: rows });
}));

// ── Clear all RTF bin hints for the org (resets pre-sort tags on unassigned lots) ──
router.delete("/listomatc/rtf-bins", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  // Only clear rtfBin on lots that are NOT yet assigned to a real bin location.
  // Lots that have already been scanned into a bin keep their filing record untouched.
  const assignedIds = db
    .select({ inventoryId: inventoryLocations.inventoryId })
    .from(inventoryLocations)
    .where(eq(inventoryLocations.orgId, orgId));

  const result = await db
    .update(blInventory)
    .set({ rtfBin: null })
    .where(and(
      eq(blInventory.orgId, orgId),
      isNull(blInventory.deletedAt),
      isNotNull(blInventory.rtfBin),
      sql`${blInventory.id} NOT IN (${assignedIds})`,
    ));
  res.json({ success: true, cleared: result.rowCount ?? 0 });
}));

router.patch("/listomatc/category-phase", isApproved, asyncRoute(async (req, res) => {
  const { categoryId, phase } = req.body as { categoryId: number; phase: string | null };
  const validPhases = ['category', 'subcategory', 'finalsort', 'listing', 'file', null];
  if (!categoryId || !validPhases.includes(phase)) {
    return res.status(400).json({ error: "Invalid categoryId or phase" });
  }
  await db
    .update(blCategories)
    .set({ sortingPhase: phase, updatedAt: new Date() })
    .where(eq(blCategories.id, categoryId));
  res.json({ success: true });
}));

router.get("/listomatc/priority", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const cfg = await getOrgSettings(orgId);

  const phaseScores: Record<string, number> = {
    category: cfg?.lomCategoryScore ?? 25,
    subcategory: cfg?.lomSubcategoryScore ?? 50,
    finalsort: cfg?.lomFinalsortScore ?? 75,
    listing: cfg?.lomListingScore ?? 100,
  };

  const rows = await db.execute(sql`
        SELECT
          c.id,
          c.name,
          c.sorting_phase,
          c.flagged,
          COALESCE(inv.current_qty, 0)::integer    AS current_qty,
          COALESCE(inv.sold_out_lots, 0)::integer  AS sold_out_lots,
          COALESCE(inv.total_lots, 0)::integer     AS total_lots,
          COALESCE(sold.total_sold, 0)::integer    AS total_sold
        FROM ${blCategories} c
        LEFT JOIN (
          SELECT cat.category_id,
                 SUM(inv_inner.quantity)                                     AS current_qty,
                 COUNT(*) FILTER (WHERE inv_inner.quantity = 0)              AS sold_out_lots,
                 COUNT(*)                                          AS total_lots
          FROM ${blInventory} inv_inner
          JOIN ${blCatalog} cat ON inv_inner.item_no = cat.item_no
            AND inv_inner.item_type = cat.item_type
            AND inv_inner.color_id = cat.color_id
          WHERE inv_inner.item_type = 'PART'
            AND inv_inner.org_id = ${orgId}
          GROUP BY cat.category_id
        ) inv ON c.id = inv.category_id
        LEFT JOIN (
          SELECT cat2.category_id, SUM(od.quantity) AS total_sold
          FROM ${orderDetails} od
          JOIN ${orders} o ON od.order_id = o.id
          JOIN ${blInventory} i ON od.sku = CAST(i.id AS TEXT)
          JOIN ${blCatalog} cat2 ON i.item_no = cat2.item_no
            AND i.item_type = cat2.item_type
            AND i.color_id = cat2.color_id
          WHERE o.order_status NOT IN ('cancelled', 'Cancelled')
            AND i.item_type = 'PART'
            AND o.org_id = ${orgId}
            AND i.org_id = ${orgId}
          GROUP BY cat2.category_id
        ) sold ON c.id = sold.category_id
        WHERE COALESCE(inv.current_qty, 0) + COALESCE(inv.sold_out_lots, 0) + COALESCE(sold.total_sold, 0) > 0
      `);

  const scored = (rows.rows as any[]).map(r => {
    const currentQty    = Number(r.current_qty);
    const totalSold     = Number(r.total_sold);
    const soldOutLots   = Number(r.sold_out_lots);
    const totalLots     = Number(r.total_lots);

    const sellThroughPct = (currentQty + totalSold) > 0
      ? (totalSold / (currentQty + totalSold)) * 100 : 0;

    const soldOutSharePct = totalLots > 0
      ? (soldOutLots / totalLots) * 100 : 0;

    const basePhaseScore = phaseScores[r.sorting_phase] ?? 0;
    const effectivePhaseScore = (r.sorting_phase === 'listing' && r.flagged)
      ? basePhaseScore * 2 : basePhaseScore;

    const score = sellThroughPct * 0.30 + soldOutSharePct * 0.30 + effectivePhaseScore * 0.40;

    return {
      id: Number(r.id),
      name: r.name,
      sortingPhase: r.sorting_phase,
      flagged: r.flagged,
      currentQty,
      totalSold,
      soldOutLots,
      totalLots,
      basePhaseScore,
      sellThroughPct: Math.round(sellThroughPct * 10) / 10,
      soldOutSharePct: Math.round(soldOutSharePct * 10) / 10,
      effectivePhaseScore,
      score: Math.round(score * 10) / 10,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  // ── File lot counts ─────────────────────────────────────────────────────────
  // unassigned: lots with no inventory_location row
  // filingQueue: lots assigned to a bin flagged as is_filing_queue=true
  const [[unassignedRow], [filingQueueRow]] = await Promise.all([
    db.select({ count: sql<number>`COUNT(*)` })
      .from(blInventory)
      .leftJoin(inventoryLocations, eq(inventoryLocations.inventoryId, blInventory.id))
      .where(and(eq(blInventory.orgId, orgId), isNull(inventoryLocations.id))),
    db.select({ count: sql<number>`COUNT(DISTINCT ${inventoryLocations.inventoryId})` })
      .from(inventoryLocations)
      .innerJoin(whBins, and(eq(whBins.id, inventoryLocations.binId), eq(whBins.isFilingQueue, true)))
      .where(eq(inventoryLocations.orgId, orgId)),
  ]);
  const unassignedLots = Number(unassignedRow?.count ?? 0);
  const filingQueueLots = Number(filingQueueRow?.count ?? 0);
  const fileLotCounts = { unassignedLots, filingQueueLots, total: unassignedLots + filingQueueLots };

  res.json({ categories: scored, phaseScores, fileLotCounts });
}));

router.get("/listomatc/category/:id/sample", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const categoryId = parseInt(req.params.id);
  if (isNaN(categoryId)) return res.status(400).json({ error: "Invalid category id" });

  const rows = await db
    .select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
      colorName: blColors.name,
      quantity: blInventory.quantity,
      unitPrice: blInventory.unitPrice,
      thumbnailUrl: blCatalog.thumbnailUrl,
    })
    .from(blInventory)
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
    .where(and(eq(blInventory.orgId, orgId), eq(blCatalog.categoryId, categoryId), eq(blInventory.itemType, 'PART')))
    .orderBy(desc(blInventory.quantity))
    .limit(5);

  res.json({ items: rows });
}));

router.patch("/listomatc/categories/:id/flag", isApproved, asyncRoute(async (req, res) => {
  const categoryId = parseInt(req.params.id);
  if (isNaN(categoryId)) return res.status(400).json({ error: "Invalid category id" });
  const [current] = await db.select({ flagged: blCategories.flagged })
    .from(blCategories).where(eq(blCategories.id, categoryId)).limit(1);
  if (!current) return res.status(404).json({ error: "Category not found" });
  await db.update(blCategories)
    .set({ flagged: !current.flagged, updatedAt: new Date() })
    .where(eq(blCategories.id, categoryId));
  res.json({ success: true, flagged: !current.flagged });
}));

router.patch("/listomatc/phase-scores", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const { category, subcategory, finalsort, listing } = req.body;
  await db.update(appSettings).set({
    lomCategoryScore:    Number(category)    || 25,
    lomSubcategoryScore: Number(subcategory) || 50,
    lomFinalsortScore:   Number(finalsort)   || 75,
    lomListingScore:     Number(listing)     || 100,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  }).where(eq(appSettings.id, orgId));
  res.json({ success: true });
}));

router.get("/priceomatic/freshness", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const cfg = await getOrgSettings(orgId);

  const tierDays: Record<string, number> = {
    tier1: cfg?.pomTier1RefreshDays ?? 1,
    tier2: cfg?.pomTier2RefreshDays ?? 3,
    tier3: cfg?.pomTier3RefreshDays ?? 7,
    tier4: cfg?.pomTier4RefreshDays ?? 30,
  };

  const rows = await db.execute(sql`
        SELECT
          c.id                                          AS category_id,
          c.name                                        AS category_name,
          c.priority_tier                               AS tier,
          COUNT(i.id)                                   AS total_lots,
          COUNT(pgc.id)                                 AS fetched_lots,
          MIN(pgc.fetched_at)                           AS oldest_fetched_at,
          MAX(pgc.fetched_at)                           AS last_fetched_at
        FROM bl_inventory i
        LEFT JOIN bl_catalog bc ON i.item_no = bc.item_no AND i.item_type = bc.item_type AND COALESCE(i.color_id, 0) = bc.color_id
        LEFT JOIN bl_categories c ON bc.category_id = c.id
        LEFT JOIN price_guide_cache pgc
          ON i.item_no = pgc.item_no
          AND i.item_type = pgc.item_type
          AND i.new_or_used = pgc.new_or_used
          AND CASE WHEN COALESCE(i.color_id, 0) = 0 THEN pgc.color_id IN (0, -1) ELSE i.color_id = pgc.color_id END
        WHERE i.org_id = ${orgId}
        GROUP BY c.id, c.name, c.priority_tier
        ORDER BY c.name
      `);

  const FRESH_THRESHOLD_DAYS = 180;
  const FRESH_THRESHOLD_MS = FRESH_THRESHOLD_DAYS * 86400000;
  const now = Date.now();
  const categories = (rows.rows as any[]).map((row) => {
    const tier = row.tier || 'tier2';
    const lastFetchedAt = row.last_fetched_at ? new Date(row.last_fetched_at) : null;
    const totalLots = parseInt(row.total_lots) || 0;
    const fetchedLots = parseInt(row.fetched_lots) || 0;
    const neverFetched = totalLots - fetchedLots;

    let status: 'fresh' | 'stale' | 'never' = 'never';
    if (lastFetchedAt && fetchedLots > 0) {
      const lastActivityFresh = now - lastFetchedAt.getTime() < FRESH_THRESHOLD_MS;
      status = lastActivityFresh ? 'fresh' : 'stale';
    }

    const daysSince = lastFetchedAt
      ? Math.floor((now - lastFetchedAt.getTime()) / 86400000)
      : null;

    return {
      categoryId: row.category_id ? parseInt(row.category_id) : null,
      categoryName: row.category_name || '(Uncategorized)',
      tier,
      totalLots,
      fetchedLots,
      neverFetched,
      coveragePct: totalLots > 0 ? Math.round((fetchedLots / totalLots) * 100) : 0,
      lastFetchedAt: lastFetchedAt?.toISOString() ?? null,
      daysSince,
      status,
      refreshDays: tierDays[tier] ?? 3,
      freshThresholdDays: FRESH_THRESHOLD_DAYS,
    };
  });

  const tierSummary = Object.fromEntries(
    Object.keys(tierDays).map((tier) => {
      const cats = categories.filter((c) => c.tier === tier);
      const totalLots = cats.reduce((s, c) => s + c.totalLots, 0);
      const fetchedLots = cats.reduce((s, c) => s + c.fetchedLots, 0);
      const freshCats = cats.filter((c) => c.status === 'fresh').length;
      const staleCats = cats.filter((c) => c.status === 'stale').length;
      const neverCats = cats.filter((c) => c.status === 'never').length;
      const lastFetch = cats.reduce((best, c) => {
        if (!c.lastFetchedAt) return best;
        if (!best) return c.lastFetchedAt;
        return c.lastFetchedAt > best ? c.lastFetchedAt : best;
      }, null as string | null);
      return [tier, { totalLots, fetchedLots, coveragePct: totalLots > 0 ? Math.round((fetchedLots / totalLots) * 100) : 0, freshCats, staleCats, neverCats, lastFetch, refreshDays: tierDays[tier] }];
    })
  );

  res.json({ success: true, categories, tierSummary });
}));

router.get("/priceomatic/insights", isApproved, asyncRoute(async (req, res) => {
  const orgId = reqOrgId(req);
  const peakSoldSub = db
    .select({
      itemNo: priceGuideCache.itemNo,
      itemType: priceGuideCache.itemType,
      colorId: priceGuideCache.colorId,
      peakSold: sql<string>`MAX(${priceGuideCache.soldMaxPrice})`.as('peak_sold'),
    })
    .from(priceGuideCache)
    .groupBy(priceGuideCache.itemNo, priceGuideCache.itemType, priceGuideCache.colorId)
    .as('peak_sold_sub');

  const insights = await db
    .select({
      inventoryId: blInventory.id,
      itemNo: blInventory.itemNo,
      itemName: resolvedCatalogItemName(blInventory.itemNo, blInventory.itemType, blInventory.colorId),
      itemType: blInventory.itemType,
      colorId: blInventory.colorId,
      colorName: blColors.name,
      colorRgb: blColors.rgb,
      newOrUsed: blInventory.newOrUsed,
      currentPrice: blInventory.unitPrice,
      myCost: blInventory.myCost,
      stockAvgPrice: priceGuideCache.stockAvgPrice,
      stockMinPrice: priceGuideCache.stockMinPrice,
      stockMaxPrice: priceGuideCache.stockMaxPrice,
      stockQuantity: sql<number>`${priceGuideCache}.stock_quantity`.as('stockQuantity'),
      stockTotalLots: priceGuideCache.stockTotalLots,
      soldAvgPrice: priceGuideCache.soldAvgPrice,
      soldMinPrice: priceGuideCache.soldMinPrice,
      soldMaxPrice: priceGuideCache.soldMaxPrice,
      soldQuantity: sql<number>`${priceGuideCache}.sold_quantity`.as('soldQuantity'),
      soldTotalLots: priceGuideCache.soldTotalLots,
      quantity: blInventory.quantity,
      lastFetched: priceGuideCache.fetchedAt,
      marketPeakSoldPrice: peakSoldSub.peakSold,
    })
    .from(blInventory)
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .leftJoin(blCatalog, and(eq(blInventory.itemNo, blCatalog.itemNo), eq(blInventory.itemType, blCatalog.itemType), eq(blInventory.colorId, blCatalog.colorId)))
    .innerJoin(
      priceGuideCache,
      and(
        sql`UPPER(${blInventory.itemNo}) = ${priceGuideCache.itemNo}`,
        eq(blInventory.itemType, priceGuideCache.itemType),
        eq(blInventory.newOrUsed, priceGuideCache.newOrUsed),
        sql`CASE WHEN COALESCE(${blInventory.colorId}, 0) = 0 THEN ${priceGuideCache.colorId} IN (0, -1) ELSE ${blInventory.colorId} = ${priceGuideCache.colorId} END`
      )
    )
    .leftJoin(
      peakSoldSub,
      and(
        eq(blInventory.itemNo, peakSoldSub.itemNo),
        eq(blInventory.itemType, peakSoldSub.itemType),
        sql`(${blInventory.colorId} = ${peakSoldSub.colorId} OR (${blInventory.colorId} IS NULL AND ${peakSoldSub.colorId} IS NULL))`
      )
    )
    .where(and(eq(blInventory.orgId, orgId), sql`${blInventory.unitPrice} IS NOT NULL AND (${priceGuideCache.stockAvgPrice} IS NOT NULL OR ${priceGuideCache.soldAvgPrice} IS NOT NULL)`));

  const scoringSettings = await getOrgSettings(orgId);
  const wCeiling = scoringSettings?.pomWeightCeiling ?? 0.4;
  const [pomAiRow] = await db.select({ sortMode: pomAiSettings.sortMode }).from(pomAiSettings).where(eq(pomAiSettings.orgId, orgId)).limit(1);
  const wVelocity = scoringSettings?.pomWeightVelocity ?? 0.3;
  const wScarcity = scoringSettings?.pomWeightScarcity ?? 0.2;
  const wUndercut = scoringSettings?.pomWeightUndercut ?? 0.1;

  const enrichedItems = insights.map(item => {
    const currentPrice = parseFloat(item.currentPrice || '0');
    const marketPeak = item.marketPeakSoldPrice ? parseFloat(item.marketPeakSoldPrice) : null;

    const soldAvgForCeiling = item.soldAvgPrice ? parseFloat(item.soldAvgPrice) : null;
    const soldLotsForCeiling = item.soldTotalLots ? Number(item.soldTotalLots) : 0;
    const confidenceFactor = Math.min(1, soldLotsForCeiling / 10);
    const blendedRef = (soldAvgForCeiling !== null && marketPeak !== null)
      ? soldAvgForCeiling * 0.6 + marketPeak * 0.4
      : (soldAvgForCeiling ?? marketPeak);
    const priceCeilingRatio = (blendedRef !== null && blendedRef > 0 && currentPrice > 0)
      ? Number(((blendedRef / currentPrice) * Math.max(0.2, confidenceFactor)).toFixed(3))
      : null;

    const soldQty = item.soldQuantity ?? null;
    const stockQty = item.stockQuantity ?? null;
    const demandVelocity = (soldQty != null && stockQty != null && stockQty > 0)
      ? Number((soldQty / stockQty).toFixed(3))
      : null;

    const scarcityDenom = item.stockQuantity ?? item.stockTotalLots ?? null;
    const marketScarcity = (scarcityDenom != null && scarcityDenom > 0)
      ? Number((1 / scarcityDenom).toFixed(4))
      : null;

    const stockMin = parseFloat(item.stockMinPrice || '0');
    const undercutRatio = (stockMin > 0 && currentPrice > 0)
      ? Number((currentPrice / stockMin).toFixed(3))
      : null;

    let repricingScore: number | null = null;
    const hasAnyComponent = priceCeilingRatio !== null || demandVelocity !== null || marketScarcity !== null || undercutRatio !== null;
    if (hasAnyComponent) {
      const ceilingComponent = (priceCeilingRatio ?? 0) * wCeiling;
      const velocityComponent = Math.min(1, demandVelocity ?? 0) * wVelocity;
      const scarcityComponent = (marketScarcity ?? 0) * wScarcity;
      const undercutComponent = (undercutRatio && undercutRatio > 0) ? (1 - undercutRatio) * wUndercut : 0;
      repricingScore = Number((ceilingComponent + velocityComponent + scarcityComponent + undercutComponent).toFixed(3));
    }

    return {
      inventoryId: item.inventoryId,
      itemNo: item.itemNo,
      itemName: (item.itemName && item.itemName !== 'undefined') ? item.itemName : null,
      itemType: item.itemType,
      colorId: item.colorId,
      colorName: item.colorName,
      colorRgb: item.colorRgb ?? null,
      newOrUsed: item.newOrUsed,
      currentPrice: item.currentPrice,
      myCost: item.myCost,
      stockAvgPrice: item.stockAvgPrice,
      stockMinPrice: item.stockMinPrice,
      stockMaxPrice: item.stockMaxPrice,
      stockQuantity: item.stockQuantity,
      stockTotalLots: item.stockTotalLots,
      soldAvgPrice: item.soldAvgPrice,
      soldMinPrice: item.soldMinPrice,
      soldMaxPrice: item.soldMaxPrice,
      soldQuantity: item.soldQuantity,
      soldTotalLots: item.soldTotalLots,
      marketPeakSoldPrice: item.marketPeakSoldPrice,
      opportunityScore: priceCeilingRatio,
      priceCeilingRatio,
      demandVelocity,
      marketScarcity,
      undercutRatio,
      repricingScore,
      quantity: item.quantity,
      lastFetched: item.lastFetched,
    };
  });

  res.json({
    success: true,
    data: {
      items: enrichedItems,
      summary: {
        total: enrichedItems.length,
      },
      sugConfig: {
        soldAvgW: scoringSettings?.pomSugSoldAvgW ?? 0.5,
        stockMinW: scoringSettings?.pomSugStockMinW ?? 0.3,
        soldMaxW: scoringSettings?.pomSugSoldMaxW ?? 0.2,
        demandMult: scoringSettings?.pomSugDemandMult ?? 0.25,
        compCap: scoringSettings?.pomSugCompCap ?? 1.15,
        floor: scoringSettings?.pomSugFloor ?? 0.95,
        storePremium: scoringSettings?.pomSugStorePremium ?? 1.10,
      },
      scoreConfig: {
        wCeiling: wCeiling,
        wVelocity: wVelocity,
        wScarcity: wScarcity,
        wUndercut: wUndercut,
      },
      sortMode: pomAiRow?.sortMode ?? 'scoring',
    },
  });
}));

router.use(apiErrorHandler);

export default router;
