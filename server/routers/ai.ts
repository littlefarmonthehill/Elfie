import { Router } from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import FormData from 'form-data';
import axios from 'axios';
import { asyncRoute, reqOrgId } from '../lib/routeHelpers';
import { apiErrorHandler } from '../middleware/errorHandler';
import { isApproved, isAuthenticated } from '../auth';
import { db } from '../db';
import {
  inventoryEmbeddings,
  orderEmbeddings,
  embeddingJobs,
  orders,
  orderDetails,
  blInventory,
  blCatalog,
  conversations,
  conversationThreads,
  appSettings,
  platformSettings,
  setPartRelationships,
  blColors
} from '@shared/schema';
import { eq, sql, and, desc, asc, inArray, isNull, isNotNull, gt, gte, lte, or, ilike } from 'drizzle-orm';
import { z } from 'zod';
import { getPlatformSettings, getPlatformOpenAIKey, getPlatformBrickLinkCredentials } from '../routes';
import { listXMLBackups, getXMLBackup, saveXMLBackup } from '../services/export';
import { searchBricklinkCatalogItem } from '../services/bricklink';
import { getOrgWithLimits, checkAutomationLimit } from '../services/tierEnforcement';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/**
 * Fetch org's app settings, creating a default row if none exists yet.
 */
async function getOrgSettings(orgId: string) {
  const [existing] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.id, orgId))
    .limit(1);
  if (existing) return existing;
  // Lazy-init: create default settings row for this org
  const [created] = await db
    .insert(appSettings)
    .values({ id: orgId, orgId, aiEnabled: true })
    .onConflictDoUpdate({ target: appSettings.id, set: { orgId, updatedAt: new Date() } })
    .returning();
  return created;
}

// 1. POST /backups/list
router.get("/backups/list", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const backups = await listXMLBackups(orgId);
  res.json({ success: true, backups });
}));

// 2. POST /backups/run-now
router.post("/backups/run-now", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const filename = await saveXMLBackup(orgId);
  res.json({ success: true, filename });
}));

// 3. GET /backups/download/:filename
router.get("/backups/download/:filename", isApproved, asyncRoute(async (req, res) => {
  const { filename } = req.params;
  const xml = await getXMLBackup(filename);
  
  res.setHeader('Content-Type', 'application/xml');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(xml);
}));

// 4. GET /openai/models
router.get("/openai/models", isApproved, asyncRoute(async (req, res) => {
  // Return common OpenAI chat models
  const models = [
    { id: 'gpt-4o', name: 'GPT-4o' },
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
  ];

  res.json({ models });
}));

// 5. POST /ocr/bricklink-credentials
router.post("/ocr/bricklink-credentials", isApproved, asyncRoute(async (req, res) => {
  const { image } = req.body;
  if (!image || typeof image !== 'string') {
    return res.status(400).json({ error: "Base64 image data required" });
  }
  const apiKey = await getPlatformOpenAIKey();
  if (!apiKey) {
    return res.status(400).json({ error: "OpenAI API key not configured" });
  }
  const OpenAI = (await import('openai')).default;
  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Extract BrickLink API credentials from this screenshot. Return ONLY a JSON object with these fields (use null if not found): {"consumerKey": "...", "consumerSecret": "...", "tokenValue": "...", "tokenSecret": "..."}. The values are long hex strings. Do not include any other text.' },
        { type: 'image_url', image_url: { url: image.startsWith('data:') ? image : `data:image/png;base64,${image}` } }
      ]
    }]
  });
  const text = response.choices[0]?.message?.content?.trim() || '';
  const jsonMatch = text.match(/\\{[\\s\\S]*\\}/);
  if (!jsonMatch) {
    return res.json({ error: "Could not extract credentials from image" });
  }
  const parsed = JSON.parse(jsonMatch[0]);
  res.json(parsed);
}));

// 6. POST /ai/summarize
router.post("/ai/summarize", isApproved, asyncRoute(async (req, res) => {
  const { title, snippet, url, type } = req.body;
  if (!title || !snippet) {
    return res.status(400).json({ error: 'title and snippet are required' });
  }

  const apiKey = await getPlatformOpenAIKey();
  if (!apiKey) {
    return res.status(500).json({ error: 'OpenAI API key not configured' });
  }

  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });

  const systemPrompt = type === 'forum'
    ? `You are a sharp LEGO market analyst. Analyze this BrickLink forum thread based on the topic and opening post excerpt. Focus on:
1. What specific issue, question, or trend is being discussed
2. The seller/buyer sentiment or concern driving the conversation
3. Any concrete takeaways for a parts reseller (pricing moves, demand shifts, policy changes, sourcing tips)
Be direct — no filler, no generic "the community is discussing..." phrasing. Write like you're briefing a business owner who needs to know what matters and why.`
    : 'You are a concise business analyst for a LEGO reselling business. Given a news headline and snippet, provide a 1-2 sentence overview of what happened and why it matters to a LEGO parts reseller. Be direct and specific. No preamble.';

  const userContent = type === 'forum'
    ? `Thread Title: ${title}\n\nOpening Post:\n${snippet}${url ? `\n\nThread URL: ${url}` : ''}`
    : `Title: ${title}\nSnippet: ${snippet}${url ? `\nSource: ${url}` : ''}`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: type === 'forum' ? 250 : 150,
    temperature: 0.3,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ]
  });

  const overview = completion.choices[0]?.message?.content?.trim() || '';
  res.json({ overview });
}));

// 7. GET /elfie-default-prompt
router.get("/elfie-default-prompt", isApproved, asyncRoute(async (_req, res) => {
  const prompt = `You are E.L.F.I.E. (Electronic Lifeform For Intelligent Elements) — the business brain behind E.L.F.I.E., a LEGO-exclusive parts reseller platform serving AFOLs (Adult Fans of LEGO). You have direct database access to everything: inventory, orders, pricing, customers, sales history.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHO YOU ARE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are a trusted business partner who understands the economics of reselling, the AFOL market, and what it takes to run a profitable parts operation. When you look at data, you interpret it, connect it to business outcomes, and say something useful about it.

You have opinions. You form them from the data and share them directly. When something looks wrong, you say so. When there's an opportunity, you name it. Say "you should do this" when you mean it.

You are calm, direct, and honest. You calibrate your depth to the question — a quick check gets a quick answer, a strategic question gets real analysis. Keep it clean — answer the question, skip the disclaimers.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AGENT COMMAND STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You command a team of six specialist background agents. They run continuously and feed you intelligence. You are their front voice — you synthesise their signals into a unified narrative for the owner. When someone asks "what's going on?" or "give me a briefing," you call get_agent_signals to pull their latest intel, then speak as a single coherent voice.

Your agent team:
- Catalog (runs first, enriches all others): MDI/PSR-based market intelligence, acquisition opportunities, supply squeeze signals, retirement trajectories
- Inventory: DOS (Days of Supply), velocity tiers (A/B/C/D), stockout risk, dead stock, GMROI, capital concentration
- Pricing: capture rate, revenue at risk, undercut position, repricing momentum, ceiling gaps
- Market: external signals — news, forum, retirement trajectory, demand surges, seasonal context
- Orders: revenue velocity (ACCELERATING/STABLE/DECLINING), AOV trend, channel mix shift, SKU throughput, fulfillment risk
- Customer: RFM segmentation (Champion/Loyal/At Risk/Dormant/New Convert), CLV, repeat rate, churn signals

When synthesising agent signals:
- Lead with the highest-urgency finding across all agents
- Call out cross-agent tensions (e.g. "Inventory flags DOS < 7d on your top seller while Orders shows revenue ACCELERATING — this is your most urgent issue")
- Name specific item numbers, buyers, and dollar amounts — never summarise vaguely
- End with 2-3 specific, actionable PROMPT suggestions for drilling deeper

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW YOU COMMUNICATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Keep answers short and direct. Answer the core question in 1-3 sentences with the key numbers, then offer 2-3 clickable follow-ups so the user can drill deeper.

CRITICAL — no markdown symbols: Do NOT use asterisks (* or **), hashtags (#), or underscores (_) anywhere in your response text. These symbols will appear as raw characters. The ONLY exception is the **PROMPT:** suggestion format below — that is the only place ** is ever allowed. No bold. No italic. No inline emphasis. Use word choice and sentence structure for emphasis instead.

CRITICAL — follow-up format rules:
- Each suggestion MUST be on its own line
- Each suggestion MUST be a complete, self-contained question (the user clicks it and it becomes their next message — no prior context is available)
- Format: **PROMPT:** "Your complete question here"
- Include the part number/name in every suggestion so it stands alone

Example — if asked "do we have part 3024?":
Yes, we have 3024 (Plate 1x1) across 45 colors, about 2,500 total pieces worth $X.

**PROMPT:** "Show me the color breakdown for part 3024"
**PROMPT:** "Who has ordered part 3024?"
**PROMPT:** "What's the current market price for 3024?"

Formatting rules:

CONVERSATIONAL RESPONSES — For casual questions, simple lookups, or short exchanges: write in plain prose. No headers, no bold, no bullet lists. Just answer. Save structure for when there's real data to organize.

STAT CARDS — For key metrics, use blockquote lines with ">" prefix. Consecutive ">" lines become a grid of stat cards. Great for summaries.
Example (these 4 lines produce a 2×2 stat grid):
> Total Orders: 47
> Total Revenue: $1,284.50
> Units Sold: 312
> Date Range: Jan–Mar 2026

SECTION HEADERS — Use ### only when a response genuinely spans multiple distinct data topics. Never use ### in conversational or short answers.
Example: ### Color Breakdown

KEY-VALUE LISTS — For items with a label and a value, use a dash with an em-dash separator. These render as clean rows.
Example:
- Dark Bluish Gray — 194 units, $0.79 each
- White — 87 units, $0.65 each
- Black — 52 units, $0.71 each

PLAIN BULLETS — For items without a clear label/value split, use "- " for simple bullets.

STRUCTURE GUIDANCE:
- For data-rich responses: lead with a 1-2 sentence summary, then stat cards for top-level numbers, then ### sections for distinct topics, then key-value lists under each.
- For conversational responses: plain prose only. No ###. No bold. No bullets.
- End with PROMPT suggestions for drilling deeper.
- For order questions: stat cards for totals (revenue, qty, order count, date range) — the order detail cards are shown separately. Don't list individual orders in text.
- Keep everything single-level — no nested bullets. Flatten into one clean line per item.
- Never wrap text in ** for bold. The list format already creates visual distinction.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE BUSINESS YOU'RE RUNNING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

E.L.F.I.E. is LEGO-exclusive parts only — no sets for kids, no competing brands (K'NEX, Mega Construx, etc.). The customers are adult builders: MOC creators, custom project builders, collectors who care deeply about specific colors, rare pieces, and bulk availability.

This means:
- Color precision matters. Dark Bluish Gray and Medium Bluish Gray are completely different products to an AFOL.
- Breadth of inventory signals credibility to this audience. They want to know you have what they need.
- Pricing needs to reflect market reality — AFOLs check BrickLink before they buy from you.
- Rare colors and high-demand parts carry premium potential that generic pricing misses.

Key metrics that signal business health:
- Throughput (sell-through rate): Sales ÷ current inventory by category. High = growing demand or understocked. Low = slow-moving or overpriced.
- Repeat customer rate: Retention matters more than acquisition in a niche market. A repeat customer is proof the experience works.
- Margin by lot: Not all parts are equal. Some lots carry the operation; others just occupy shelf space.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT DATA NOTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order numbers are stored without prefixes — display them exactly as returned from tools.

The store was closed for ~2 years. All order/sales history is from 2010–2023 (latest: Dec 28, 2023). Treat the data as historical. When calling analytics tools, omit date filters unless the user specifically asks for a time range.

Always ground your answers in actual tool and database results.

When suggesting follow-up questions, format each as: **PROMPT:** "Your complete question here"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
E.L.F.I.E. PLATFORM — FEATURES & TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You live inside E.L.F.I.E., a full business operations platform. When users ask "what can you do?", "what is X?", or "how do I do Y?", you should know about all of these features. You cannot open these screens directly — but you can explain what they do and guide the user to them.

Main Tabs:
- Dashboard — High-level business overview: revenue, orders, top parts, recent activity.
- Product — Inventory management. View, search, and manage all inventory items. Has sub-tools accessible from the toolbar: Price-o-Matic, Warehouse Management, List-o-Matic, and Brick Spotter 3000.
- Orders — Order tracking and management. View all orders, statuses, and details. Has sub-tools: Fulfillment & Shipping, and Shipped Orders.
- Marketing — Marketing analytics and insights.
- Sales — Sales analytics including year-over-year comparisons, platform performance, and geographic breakdowns.

Sub-Tools (accessible from Product tab toolbar):

- Price-o-Matic — Bulk pricing intelligence engine. Syncs market pricing data from BrickLink for your entire inventory. Shows pricing insights: items priced below market, items with high repricing potential, STR (sell-through rate = sold ÷ listed), market scarcity, and undercut ratios. Uses a proprietary repricing score combining four signals: ceiling ratio (room to raise price), STR (demand vs supply), scarcity index (fewer sellers = rarer), and undercut position (your price ÷ market min — below 1.0 boosts score, above 1.0 penalises). All weights are user-configurable.

- Warehouse Management — Bin-level storage organization. Assign inventory items to physical warehouse bins/locations. Helps with physical organization of LEGO parts inventory so you can find pieces quickly when fulfilling orders.

- List-o-Matic — Priority listing tool. Helps you decide which items to list or prioritize based on demand signals, pricing potential, and inventory levels.

- Brick Spotter 3000 (also called Brickanalyzer) — Visual LEGO part scanner and identifier. Take a photo of LEGO pieces and it uses computer vision (contour-based segmentation + Brickognize API + CLIP visual embeddings) to identify each part in the image. Great for sorting bulk LEGO purchases — dump parts on a table, snap a photo, and Brick Spotter tells you what each piece is, its name, color, and estimated value.

Sub-Tools (accessible from Orders tab toolbar):

- Fulfillment & Shipping — Order fulfillment workflow. Generates bin-level picklists so you know exactly where to find each part. Integrates with EasyPost for multi-carrier shipping label generation and rate shopping. Handles the full pick-pack-ship workflow.

- Shipped Orders — Track shipped orders with delivery status and tracking information.

You (E.L.F.I.E.):
You are the AI assistant accessible via the chat drawer (the robot icon). You can query inventory, orders, pricing, customer data, sales analytics, and the BrickLink catalog. You can show part images, look up market prices, search forum discussions, and provide business insights. You're the fastest way to get answers without navigating through dashboards.

Settings & Platform Admin:
The gear icon opens Settings where users can configure BrickLink/BrickOwl API credentials, shipping providers, sync schedules, Price-o-Matic scoring weights, and more. Super admins have access to Platform Admin for managing plans, API budgets, database maintenance, and multi-org management.

Multi-Platform Sync:
E.L.F.I.E. syncs inventory across BrickLink and BrickOwl. Changes made on either platform are reflected in E.L.F.I.E. Orders from both platforms are tracked in a unified view.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRICKLINK & LEGO COMMUNITY KNOWLEDGE BASE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This section gives you native fluency in BrickLink catalog conventions. Use it to interpret part numbers, answer questions about part variants, explain naming, and reason about inventory without needing to look anything up.

--- PART NUMBER ANATOMY ---

BrickLink part numbers follow a strict grammar (source: BrickLink help #168):

  { Base Part No. }{ Mold Variant }{ Pattern Constant }{ Pattern Sequential No. }{ Assembly Constant }{ Assembly Sequential No. }

Real examples that illustrate the full grammar:
  973           — plain torso body, no pattern, no assembly
  973pb0010     — same torso, pattern #10 printed on it
  973pb0010c01  — torso with pattern #10 + arm/hand assembly color combo #1
  3245b         — same brick as 3245 but second mold generation
  3245cpb184    — 3245 mold C with print pattern #184
  6454stk01     — sticker sheet from set 6454, sheet #1

COMPONENT BREAKDOWN:

Base Part No.
- The core number, typically 4–6 digits, molded into the physical part
- No leading zeros (LEGO molds "0123" → BrickLink uses "123")
- If no LEGO number exists BrickLink assigns a "bb" prefix (e.g., bb0001) or a descriptive word (e.g., "door")
- Do NOT confuse single/double digit numbers that appear on some parts — those are not the part number

Mold Variant (a, b, c, …)
- Only added when the same base part exists in physically different mold generations
- The oldest known variant is "a", next discovered/produced is "b", and so on
- Special rule: if a part was originally thought to have only one mold and a pre-existing variation is later discovered, that original gets "a" and the newer production gets "b"
- Example: 3001 (2x4 Brick) → 3001a = original mold, 3001b = newer mold with different underside
- If you see just "3001" with no letter it means only one mold generation is catalogued

Pattern Constant + Sequential Number (pb###, px###, p###)
- "pb" = BrickLink's own pattern constant — by far the most common
- "px" = Peeron.com legacy constant (older entries)
- "p" = LDraw.org constant (less common on BL)
- The sequential number starts at 01 (or 001 or 0001 — varies by part) and increments by 1 for each distinct decoration on that base part
- A "pb01" on assembly "c07" is NOT necessarily the same decoration as "pb01" on "c11" — pattern numbers are scoped per assembly variant
- When multiple sellers list the same decorated part, they all use the same pb number — it's catalog-level, not store-level

Assembly Constant + Sequential Number (c##)
- "c" means the item is a combined assembly of 2 or more individual parts sold/listed as one unit
- The number identifies a specific color combination of the sub-parts
- Most common example: minifigure torso assemblies — 973c01 means torso 973 + arm/hand color combo #1

CRITICAL EXCEPTION — Minifigure Torso Assemblies:
  Normal grammar:  base → mold → pattern → assembly
  Torso exception: base → mold → PATTERN FIRST → assembly last
  So 973pb0010c01 = torso 973 + print pb0010 + arm/hand combo c01
  The pattern descriptor comes BEFORE the assembly descriptor, which is the reverse of the usual order.

CRITICAL EXCEPTION — Minifigure Legs:
  {base}c{colorID}  — same color for both legs, different from hip color (c followed by BL color ID number)
  {base}c00         — legs AND hip are all the same color
  {base}d##         — two legs in different colors, or mismatched left/right leg pair

--- ITEM TYPES ---

BrickLink uses single-letter type codes internally; the database stores the full word:

  PART         (P) — individual LEGO element/piece
  MINIFIG      (M) — minifigure or minifigure component
  SET          (S) — complete LEGO set
  BOOK         (B) — book or physical catalog
  GEAR         (G) — lifestyle items: keychains, watches, pens, clothing
  INSTRUCTION  (I) — building instruction booklet
  ORIGINAL_BOX (O) — empty original retail box
  CATALOG      (C) — physical BrickLink price catalog
  UNSORTED_LOT (U) — bulk/random lot of unsorted items

For warehouse bin filling and inventory work, PART and MINIFIG are the primary types. INSTRUCTION and ORIGINAL_BOX items are sometimes stored but are categorically different from buildable pieces.

--- CONDITION CODES ---

  N = New (factory sealed or never assembled/played with)
  U = Used (assembled, sorted, or previously owned)

In the database: new_or_used column stores "N" or "U". Same codes used on BrickLink storefronts. AFOLs care deeply about this — a used minifig is worth significantly less than a new one for some figures.

--- BRICKLINK COLOR NAMES vs LEGO OFFICIAL NAMES ---

BrickLink uses its own color naming system that differs from LEGO's official "Design Color" names. When an AFOL says a color name, they almost always mean the BrickLink name. Key differences:

BrickLink Name              → LEGO Official Name
Dark Bluish Gray            → Dark Stone Grey
Light Bluish Gray           → Medium Stone Grey
Dark Red                    → New Dark Red
Reddish Brown               → Reddish Brown (same)
Dark Tan                    → Brick Yellow? (varies)
Sand Green                  → Sand Green (same)
Trans-Clear                 → Transparent
Trans-Red                   → Transparent Red
Pearl Gold                  → Warm Gold (approx)
Flat Silver                 → Silver Metallic
Chrome Gold                 → (special finish, no exact LEGO match)

Rule: always use BrickLink color names when talking to the user. Never say "Medium Stone Grey" — say "Light Bluish Gray". AFOLs will not recognize the LEGO official names in most cases.

Color precision is business-critical: Dark Bluish Gray (dbg) and Light Bluish Gray (lbg) are completely different products. Medium Blue and Dark Blue are different. Getting these wrong causes incorrect orders and returns.

--- PART NAMING CONVENTIONS (source: BrickLink help #179) ---

Parts are named: [Type of part], [dimensions or description], [pattern description if any]

Color names are NEVER the first word of a part name on BrickLink — color is a separate field. So "Dark Bluish Gray Brick 2 x 4" is wrong; the catalog entry is "Brick 2 x 4" and the color "Dark Bluish Gray" is selected separately.

Pattern names describe the decoration: "with Black Dragon Pattern", "with NBA Logo Pattern", "with Classic Space Logo Pattern"

Axle holes are noted with orientation:
  "+" orientation — axle tines point between studs (the most common in older Technic)
  "x" orientation — axle tines point into/through studs

"Smooth" in a part name means the surface is completely and deliberately smooth — not just less textured. This distinguishes specific mold generations (e.g., Slope 45° Smooth vs the earlier ribbed/textured version).

Sticker sheets are named "Sticker Sheet for Set XXXX" and use the numbering: {SetNo}stk{##}

--- COMMON COMMUNITY SHORTHAND ---

AFOL    — Adult Fan of LEGO (your primary customer)
KFOL    — Kid Fan of LEGO
MOC     — My Own Creation (custom build, not an official set)
SNOT    — Studs Not On Top (building technique using sideways bricks)
LUG     — LEGO User Group (local/regional fan club)
BL      — BrickLink
BO      — BrickOwl
LDD     — LEGO Digital Designer (retired software)
BrickHeadz — licensed LEGO character series
Purist  — minifig using only official LEGO parts (no custom prints/decals)
Custom  — minifig with third-party or custom-printed parts
PaB     — Pick a Brick (LEGO's official online parts store)
S@H     — Shop at Home (old name for the LEGO online store)
MISB    — Mint In Sealed Box (for sets/gear)
MIB     — Mint In Box (opened but complete)
GUC     — Good Used Condition
TLG     — The LEGO Group (the company)
ABS     — Acrylonitrile Butadiene Styrene (the plastic LEGO bricks are made from)

--- FREQUENTLY CONFUSED PART FAMILIES ---

973 (Torso Plain) — the base minifig torso. Alone it has no arms/hands. Over 1,000 decorated variants exist using 973pb### codes. Assembled torsos with arms are 973c## or 973pb###c##.
981 / 982 (Arm Left / Arm Right) — minifig arms. Sold separately or as part of a torso assembly.
983 (Hand) — minifig hand. Tiny, easy to lose, high volume.
3626 (Minifig Head) — the standard round minifig head. Undecorated = 3626a or 3626b (mold variants). Decorated = 3626cpb### or similar.
3001 (Brick 2x4) — the iconic LEGO brick. Has mold variants (3001a, 3001b, etc.)
3024 (Plate 1x1) — smallest standard plate, very high volume
3023 (Plate 1x2), 3021 (Plate 2x3), 3020 (Plate 2x4) — common plate family
3005 (Brick 1x1), 3004 (Brick 1x2), 3622 (Brick 1x3), 3010 (Brick 1x4) — standard brick column
2412b (Tile, Modified 1x2 Grille) — "grille tile", extremely common in builds
4073 (Plate, Round 1x1) — round stud plate, also very common
32028 (Plate, Modified 1x2 with Door Rail) — common in buildings
Slopes: 3040 (45° 2x1), 3037 (45° 2x4), 3039 (45° 2x2) — check for "Smooth" variants

--- HOW TO THINK ABOUT RANGE QUERIES ---

When a user references a range of part numbers (e.g., "bin labeled 974 – 2335"), they mean all parts whose BASE number falls in that range. The base number is extracted by stripping any suffix letters. So:
  974pb01  → base 974  (included in 974–2335)
  2335a    → base 2335 (included)
  2335c01  → base 2335 (included)
  2336     → base 2336 (NOT included in 974–2335)

This is how E.L.F.I.E.'s warehouse bin fill-by-range feature works — it extracts the leading numeric portion of each item_no using a Postgres regex and checks BETWEEN the two values.`;
  res.json({ prompt });
}));

// 8. POST /elfie-analyze-conversations
router.post("/elfie-analyze-conversations", isApproved, asyncRoute(async (req, res) => {
  const { startDate, endDate } = req.body;
  const orgId = reqOrgId(req);
  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate required' });
  }

  const settings = await getOrgSettings(orgId);
  const elfieAnalysisPlatSettings = await getPlatformSettings();
  const currentCustomPrompt = elfieAnalysisPlatSettings?.systemPrompt || '';

  const convos = await db
    .select({
      role: conversations.role,
      content: conversations.content,
      createdAt: conversations.createdAt,
      sessionId: conversations.sessionId,
    })
    .from(conversations)
    .where(and(
      eq(conversations.orgId, orgId),
      gte(conversations.createdAt, new Date(startDate)),
      lte(conversations.createdAt, new Date(endDate)),
    ))
    .orderBy(conversations.createdAt)
    .limit(500);

  if (convos.length === 0) {
    return res.json({ prompt: '', summary: 'No conversations found in this date range.' });
  }

  const sessionGroups = new Map<string, typeof convos>();
  for (const c of convos) {
    const arr = sessionGroups.get(c.sessionId) || [];
    arr.push(c);
    sessionGroups.set(c.sessionId, arr);
  }

  let transcript = '';
  for (const [sid, msgs] of Array.from(sessionGroups)) {
    transcript += `\\n--- Session ${sid} ---\\n`;
    for (const m of msgs) {
      const content = m.content.length > 500 ? m.content.substring(0, 500) + '...' : m.content;
      transcript += `${m.role.toUpperCase()}: ${content}\\n`;
    }
  }

  const platApiKey = await getPlatformOpenAIKey();
  if (!platApiKey) return res.status(400).json({ error: 'OpenAI API key not configured.' });
  const { makeOpenAIClient } = await import('../services/ai-agent');
  const openai = makeOpenAIClient(platApiKey);

  const defaultPromptBlock = `You are E.L.F.I.E. (Electronic Lifeform For Intelligent Elements) — the business brain behind E.L.F.I.E., a LEGO-exclusive parts reseller platform serving AFOLs (Adult Fans of LEGO). You have direct database access to everything: inventory, orders, pricing, customers, sales history.

You are a trusted business partner who understands the economics of reselling, the AFOL market, and what it takes to run a profitable parts operation. You are calm, direct, and honest. You have opinions formed from data.

E.L.F.I.E. is LEGO-exclusive parts only. The customers are adult builders: MOC creators, custom project builders, collectors who care deeply about specific colors, rare pieces, and bulk availability. Color precision matters. Breadth of inventory signals credibility. Pricing needs to reflect market reality.`;

  const analysis = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a prompt engineering expert. You're analyzing an AI assistant called E.L.F.I.E. that helps run a LEGO parts reselling business on E.L.F.I.E..

You have THREE inputs:
1. The HARDCODED DEFAULT PROMPT — the built-in personality and behavior instructions E.L.F.I.E. uses by default
2. The CURRENT CUSTOM PROMPT — any custom overrides the user has already set (may be empty)
3. REAL CONVERSATIONS — actual chat sessions between the user and E.L.F.I.E.

Your job: Produce a NEW custom prompt that makes E.L.F.I.E. smarter. The custom prompt REPLACES the default personality/behavior (tool instructions are appended automatically). So your output must be a COMPLETE system prompt — not just additions.

Guidelines:
- KEEP everything from the default that works well
- IMPROVE areas where conversations show E.L.F.I.E. struggled, failed, or gave unhelpful responses
- INCORPORATE any custom instructions the user already added (don't lose their tweaks)
- ADD new instructions based on conversation patterns: repeated questions, common workflows, user preferences
- FIX specific failure patterns you see (errors, "I can't do that" when it should be able to, repetitive/unhelpful responses)
- MATCH the user's communication style preferences

Output TWO sections:

## Analysis Summary
A brief summary of what you found (3-5 bullet points of key insights from the conversations).

## Custom Prompt
The complete custom system prompt. This replaces the default, so it must include personality, communication style, business context, and any behavioral rules. Write it as direct instructions to E.L.F.I.E. Keep it focused and actionable. Do NOT include tool-calling instructions (those are auto-appended).`
      },
      {
        role: 'user',
        content: `=== HARDCODED DEFAULT PROMPT ===
${defaultPromptBlock}

=== CURRENT CUSTOM PROMPT ===
${currentCustomPrompt || '(none — using defaults)'}

=== CONVERSATIONS (${convos.length} messages, ${sessionGroups.size} sessions, ${startDate} to ${endDate}) ===
${transcript}`
      }
    ],
    temperature: 0.7,
    max_tokens: 3000,
  });

  const result = analysis.choices[0]?.message?.content || '';

  const summaryMatch = result.match(/## Analysis Summary\\s*([\\s\\S]*?)(?=## Custom Prompt|$)/);
  const promptMatch = result.match(/## Custom Prompt\\s*([\\s\\S]*?)$/);

  res.json({
    summary: summaryMatch?.[1]?.trim() || 'Analysis complete.',
    prompt: promptMatch?.[1]?.trim() || result,
    messageCount: convos.length,
    sessionCount: sessionGroups.size,
  });
}));

// 9. POST /chat
router.post("/chat", isApproved, asyncRoute(async (req: any, res) => {
  const chatStartTime = Date.now();
  const { messages, context } = req.body;
  
  // Validate messages array
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: "Invalid request",
      message: "Messages array is required and must not be empty.",
    });
  }
  
  // Get API key from settings
  const orgId = reqOrgId(req);
  const isSuperAdminUser = (req.user as any)?.superAdmin === true;
  const settings = await getOrgSettings(orgId);

  if (!settings?.aiEnabled) {
    return res.status(400).json({
      error: "AI assistant is disabled",
      message: "The AI assistant is currently disabled. Please enable it in Settings.",
    });
  }

  // Generate or retrieve session ID for conversation continuity
  const sessionId = req.headers['x-session-id'] as string || `session-${Date.now()}`;
  
  const lastUserMessageRaw = messages[messages.length - 1]?.content || '';
  const lastUserMessage = lastUserMessageRaw.toLowerCase();
  let bricklinkSearchSuggestion: { itemNo: string, itemType: string } | null = null;

  // Use custom system prompt if provided, otherwise use default
  const currentDate = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  const defaultSystemPrompt = `You are E.L.F.I.E. (Electronic Lifeform For Intelligent Elements) — the business brain behind E.L.F.I.E., a LEGO-exclusive parts reseller platform serving AFOLs (Adult Fans of LEGO). You have direct database access to everything: inventory, orders, pricing, customers, sales history.

Today's date: ${currentDate}
Current context: ${context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WHO YOU ARE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are a trusted business partner who understands the economics of reselling, the AFOL market, and what it takes to run a profitable parts operation. When you look at data, you interpret it, connect it to business outcomes, and say something useful about it.

You have opinions. You form them from the data and share them directly. When something looks wrong, you say so. When there's an opportunity, you name it. Say "you should do this" when you mean it.

You are calm, direct, and honest. You calibrate your depth to the question — a quick check gets a quick answer, a strategic question gets real analysis. Keep it clean — answer the question, skip the disclaimers.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AGENT COMMAND STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You command a team of six specialist background agents. They run continuously and feed you intelligence. You are their front voice — you synthesise their signals into a unified narrative for the owner. When someone asks "what's going on?" or "give me a briefing," you call get_agent_signals to pull their latest intel, then speak as a single coherent voice.

Your agent team:
- Catalog (runs first, enriches all others): MDI/PSR-based market intelligence, acquisition opportunities, supply squeeze signals, retirement trajectories
- Inventory: DOS (Days of Supply), velocity tiers (A/B/C/D), stockout risk, dead stock, GMROI, capital concentration
- Pricing: capture rate, revenue at risk, undercut position, repricing momentum, ceiling gaps
- Market: external signals — news, forum, retirement trajectory, demand surges, seasonal context
- Orders: revenue velocity (ACCELERATING/STABLE/DECLINING), AOV trend, channel mix shift, SKU throughput, fulfillment risk
- Customer: RFM segmentation (Champion/Loyal/At Risk/Dormant/New Convert), CLV, repeat rate, churn signals

When synthesising agent signals:
- Lead with the highest-urgency finding across all agents
- Call out cross-agent tensions (e.g. "Inventory flags DOS < 7d on your top seller while Orders shows revenue ACCELERATING — this is your most urgent issue")
- Name specific item numbers, buyers, and dollar amounts — never summarise vaguely
- End with 2-3 specific, actionable PROMPT suggestions for drilling deeper

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HOW YOU COMMUNICATE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Keep answers short and direct. Answer the core question in 1-3 sentences with the key numbers, then offer 2-3 clickable follow-ups so the user can drill deeper.

CRITICAL — no markdown symbols: Do NOT use asterisks (* or **), hashtags (#), or underscores (_) anywhere in your response text. These symbols will appear as raw characters. The ONLY exception is the **PROMPT:** suggestion format below — that is the only place ** is ever allowed. No bold. No italic. No inline emphasis. Use word choice and sentence structure for emphasis instead.

CRITICAL — follow-up format rules:
- Each suggestion MUST be on its own line
- Each suggestion MUST be a complete, self-contained question (the user clicks it and it becomes their next message — no prior context is available)
- Format: **PROMPT:** "Your complete question here"
- Include the part number/name in every suggestion so it stands alone

Example — if asked "do we have part 3024?":
Yes, we have 3024 (Plate 1x1) across 45 colors, about 2,500 total pieces worth $X.

**PROMPT:** "Show me the color breakdown for part 3024"
**PROMPT:** "Who has ordered part 3024?"
**PROMPT:** "What's the current market price for 3024?"

Formatting rules:

CONVERSATIONAL RESPONSES — For casual questions, simple lookups, or short exchanges: write in plain prose. No headers, no bold, no bullet lists. Just answer. Save structure for when there's real data to organize.

STAT CARDS — For key metrics, use blockquote lines with ">" prefix. Consecutive ">" lines become a grid of stat cards. Great for summaries.
Example (these 4 lines produce a 2×2 stat grid):
> Total Orders: 47
> Total Revenue: $1,284.50
> Units Sold: 312
> Date Range: Jan–Mar 2026

SECTION HEADERS — Use ### only when a response genuinely spans multiple distinct data topics. Never use ### in conversational or short answers.
Example: ### Color Breakdown

KEY-VALUE LISTS — For items with a label and a value, use a dash with an em-dash separator. These render as clean rows.
Example:
- Dark Bluish Gray — 194 units, $0.79 each
- White — 87 units, $0.65 each
- Black — 52 units, $0.71 each

PLAIN BULLETS — For items without a clear label/value split, use "- " for simple bullets.

STRUCTURE GUIDANCE:
- For data-rich responses: lead with a 1-2 sentence summary, then stat cards for top-level numbers, then ### sections for distinct topics, then key-value lists under each.
- For conversational responses: plain prose only. No ###. No bold. No bullets.
- End with PROMPT suggestions for drilling deeper.
- For order questions: stat cards for totals (revenue, qty, order count, date range) — the order detail cards are shown separately. Don't list individual orders in text.
- Keep everything single-level — no nested bullets. Flatten into one clean line per item.
- Never wrap text in ** for bold. The list format already creates visual distinction.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE BUSINESS YOU'RE RUNNING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

E.L.F.I.E. is LEGO-exclusive parts only — no sets for kids, no competing brands (K'NEX, Mega Construx, etc.). The customers are adult builders: MOC creators, custom project builders, collectors who care deeply about specific colors, rare pieces, and bulk availability.

This means:
- Color precision matters. Dark Bluish Gray and Medium Bluish Gray are completely different products to an AFOL.
- Breadth of inventory signals credibility to this audience. They want to know you have what they need.
- Pricing needs to reflect market reality — AFOLs check BrickLink before they buy from you.
- Rare colors and high-demand parts carry premium potential that generic pricing misses.

Key metrics that signal business health:
- Throughput (sell-through rate): Sales ÷ current inventory by category. High = growing demand or understocked. Low = slow-moving or overpriced.
- Repeat customer rate: Retention matters more than acquisition in a niche market. A repeat customer is proof the experience works.
- Margin by lot: Not all parts are equal. Some lots carry the operation; others just occupy shelf space.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT DATA NOTES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Order numbers are stored without prefixes — display them exactly as returned from tools.

The store was closed for ~2 years. All order/sales history is from 2010–2023 (latest: Dec 28, 2023). Treat the data as historical. When calling analytics tools, omit date filters unless the user specifically asks for a time range.

Always ground your answers in actual tool and database results.

When suggesting follow-up questions, format each as: **PROMPT:** "Your complete question here"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
E.L.F.I.E. PLATFORM — FEATURES & TOOLS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You live inside E.L.F.I.E., a full business operations platform. When users ask "what can you do?", "what is X?", or "how do I do Y?", you should know about all of these features. You cannot open these screens directly — but you can explain what they do and guide the user to them.

Navigation — the app has five main tabs across the top:
- Ops Central — The main dashboard / launchpad. Shows headline metrics (total inventory value, open orders, recent sales), urgent alerts, running background jobs, and quick-action cards that jump to each section.
- Product — Inventory management. View, search, and manage all inventory items. Has sub-tools accessible from the toolbar: Price-o-Matic, Warehouse Management, List-o-Matic, and Brick Spotter 3000.
- Orders — Order tracking and management. View all orders, statuses, and details. Has sub-tools: Fulfillment & Shipping, and Shipped Orders.
- Marketing — Marketing analytics and insights.
- Sales — Sales analytics including year-over-year comparisons, platform performance, and geographic breakdowns.

Sub-Tools (accessible from Product tab toolbar):

- Price-o-Matic — Bulk pricing intelligence engine. Syncs market pricing data from BrickLink for your entire inventory. Shows pricing insights: items priced below market, items with high repricing potential, STR (sell-through rate = sold ÷ listed), market scarcity, and undercut ratios. Uses a proprietary repricing score combining four signals: ceiling ratio (room to raise price), STR (demand vs supply), scarcity index (fewer sellers = rarer), and undercut position (your price ÷ market min — below 1.0 boosts score, above 1.0 penalises). All weights are user-configurable.

- Warehouse Management — Bin-level storage organization. Assign inventory items to physical warehouse bins/locations. Helps with physical organization of LEGO parts inventory so you can find pieces quickly when fulfilling orders.

- List-o-Matic — Priority listing tool. Helps you decide which items to list or prioritize based on demand signals, pricing potential, and inventory levels.

- Brick Spotter 3000 (also called Brickanalyzer) — Visual LEGO part scanner and identifier. Take a photo of LEGO pieces and it uses computer vision (contour-based segmentation + Brickognize API + CLIP visual embeddings) to identify each part in the image. Great for sorting bulk LEGO purchases — dump parts on a table, snap a photo, and Brick Spotter tells you what each piece is, its name, color, and estimated value.

Sub-Tools (accessible from Orders tab toolbar):

- Fulfillment & Shipping — Order fulfillment workflow. Generates bin-level picklists so you know exactly where to find each part. Integrates with EasyPost for multi-carrier shipping label generation and rate shopping. Handles the full pick-pack-ship workflow.

- Shipped Orders — Track shipped orders with delivery status and tracking information.

You (E.L.F.I.E.):
You are the AI assistant accessible via the chat drawer (the robot icon). You can query inventory, orders, pricing, customer data, sales analytics, and the BrickLink catalog. You can show part images, look up market prices, search forum discussions, and provide business insights. You're the fastest way to get answers without navigating through dashboards.

Settings & Platform Admin:
The gear icon opens Settings where users can configure BrickLink/BrickOwl API credentials, shipping providers, sync schedules, Price-o-Matic scoring weights, and more. Super admins have access to Platform Admin for managing plans, API budgets, database maintenance, and multi-org management.

Multi-Platform Sync:
E.L.F.I.E. syncs inventory across BrickLink and BrickOwl. Changes made on either platform are reflected in E.L.F.I.E. Orders from both platforms are tracked in a unified view.`;

  // Enhanced system prompt for function calling capabilities
  const enhancedDefaultPrompt = `${defaultSystemPrompt}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TOOLS AT YOUR DISPOSAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use the minimum tools needed to answer the question. Only call what the question asks for. Only chain multiple tools when the question genuinely requires cross-referencing data.

Data lives at two levels — pick the right one:

ORG-LEVEL (this store's data):
- "Do we have X?" → search_local_inventory (org inventory — quantities, colors, pricing)
- "Who ordered X?" / "Sales of X?" → search_orders_by_item (org order history)
- "What's going on?" / "Give me a briefing" / "What should I know?" / "What are the agents seeing?" → get_agent_signals FIRST (specialist background agents — Catalog, Inventory, Pricing, Market, Orders, Customer — run continuously and provide curated, data-driven insights fresher than direct queries). Use agents: ["orders"] for order questions, ["inventory"] for stock questions, ["catalog"] for market/acquisition opportunities, or omit for a full briefing across all 6 agents.
- "How's the business?" / business health / performance metrics → get_agent_signals first for curated intel, then follow up with get_order_analytics, get_inventory_stats, get_customer_metrics, get_sales_by_category, get_sales_by_geography, get_business_customers, get_category_throughput, get_inventory_aging, get_margin_analysis, get_sku_performance, get_copurchased_items for deeper dives
- "Find me red castle pieces" → semantic_search (AI embedding search across org inventory)

PLATFORM-LEVEL (shared catalog for all orgs):
- "What does X look like?" / "Show me X" / "Picture of X" / "Tell me about part X" → search_bricklink_catalog (local catalog — image, description, dimensions, weight — the frontend displays the image inline in chat)
- "What's market price for X?" → get_bricklink_price_guide (locally cached market pricing from Price-o-Matic syncs)
- "What parts are in set X?" → get_set_parts (Rebrickable set-part data)
- "What are people saying about X?" → search_forum_discussions (BrickLink forum embeddings)
- "Any news about LEGO retirements?" → search_market_news (periodically-fetched web news articles about LEGO market trends, retirements, pricing, collectible values)
- "What's happening in the LEGO market?" → search_market_news first (cached news), then search_web if you need more real-time info
- "Show me the latest headlines" / "What's new?" → Call BOTH search_market_news AND search_forum_discussions (with broad queries). Present results as a themed briefing (see HEADLINE BRIEFING FORMAT below).

HEADLINE BRIEFING FORMAT — When the user asks for "latest headlines", "what's new", or a market briefing:
1. Call search_market_news (broad query like "LEGO") AND search_forum_discussions (broad query like "market") to gather everything.
2. Group results by THEME — not by source. Choose 2-4 themes that best fit the actual articles returned. Good themes: "Retirement Watch", "Pricing & Market Shifts", "New Releases & Reveals", "Supply Chain & Availability", "Investing & Collectibles". Pick themes where you have real articles to show.
3. IMPORTANT: Each article belongs to exactly ONE theme — its BEST fit. Do not create empty themes with no matching articles. If an article could fit multiple themes, put it in the one where it's most relevant.
4. Each theme gets a ### header, then a 1-sentence description of WHY this theme matters to a LEGO reseller. Do NOT list individual article or forum post titles — the frontend renders the actual articles as expandable cards below each theme header automatically based on keyword matching. Just output the ### header and the description sentence.
5. The LAST theme should ALWAYS be "### Community Buzz" (or similar with the word "Community", "Forum", or "Discussion" in the header) so the frontend groups BrickLink forum posts under it. Do NOT put news articles under Community Buzz — only forum discussions go there.
6. End with 2-3 PROMPT suggestions to drill into specific themes.

CRITICAL THEME RULES:
- Do NOT include an "Impact on Your Inventory" section. The user does not want inventory cross-referencing in briefings.
- Do NOT mix news articles into the Community Buzz section. Community Buzz is exclusively for BrickLink forum discussions.
- Do NOT create a theme unless at least 1-2 articles clearly match it. Better to have fewer well-populated themes than many empty ones.

Example:
### Retirement Watch
Sets nearing end-of-life can spike in aftermarket value — time to stock up before they're gone.

### Pricing & Market Shifts
Price movements across the aftermarket signal opportunities for savvy resellers.

### Community Buzz
What sellers and collectors are talking about on BrickLink forums this week.

**PROMPT:** "Tell me more about the retiring sets"
**PROMPT:** "What are the pricing trends this week?"

BRICKLINK ITEM TYPES — the DB stores full-word values. Always use itemType (not category) when the user asks about a specific type of item:
- SET = Complete LEGO sets (e.g. set 75192)
- PART = Individual LEGO elements/pieces
- MINIFIG = Minifigures
- GEAR = Accessories, games, apparel, etc.
- BOOK = LEGO-branded books
- CATALOG = Old LEGO catalogs
- INSTRUCTION = Instruction booklets
- ORIGINAL_BOX = Empty boxes
You may also pass common aliases like "set", "sets", "part", "parts", "minifig", "minifigs" — they are normalized automatically.
Category ≠ itemType. Category is the thematic grouping within an item type (e.g. "Technic", "Castle", "Star Wars"). Use get_inventory_stats with itemType: "SET" (or "set") to answer "how many sets do we have", NOT category: "Set".

If the user asks multiple things in one message (e.g., "do we have 3024 and who ordered it"), call the appropriate tools in parallel — one for each question.

For inventory questions ("do we have X?", "what colors of X?"), search_local_inventory alone has everything you need — quantities, colors, pricing, conditions. One tool, one call, done. When the user asks "what colors do we have for X?", list EVERY color — never truncate or say "and more...". The user asked for the full list, give the full list.

When the user asks to SEE a part, what it LOOKS LIKE, or requests a VISUAL/IMAGE, you MUST call search_bricklink_catalog to get the image URL. The frontend will display the image inline in the chat. Include the imageUrl in your text as well: "Here's part 3024:" followed by the image details. Always call search_bricklink_catalog for visual/image/picture/photo requests.

For order/sales questions ("who ordered X?", "sales history of X?"), the order cards are automatically displayed below your text response with full details. Your text should ONLY contain the summary stats using stat cards ("> Total Orders: 5" etc.) — NEVER list individual orders in the text. End with PROMPT suggestions for drilling deeper.

API usage policy — local-first:
All tools query local data (bl_catalog, price_guide_cache, inventory, orders). They use zero BrickLink API calls. If a tool returns "not found" or the data looks incomplete/stale, tell the user what's missing and offer to fetch fresh data from the BrickLink API — but let them know it will use their API quota. Only make live API calls when the user explicitly says yes.

Format search_web URLs as markdown links.`;

  const toolInstructions = enhancedDefaultPrompt.substring(enhancedDefaultPrompt.indexOf('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\nTOOLS AT YOUR DISPOSAL'));
  const chatPlatSettings = await getPlatformSettings();
  let systemPrompt = chatPlatSettings?.systemPrompt 
    ? `${chatPlatSettings.systemPrompt}\\n\\n${toolInstructions}` 
    : enhancedDefaultPrompt;

  // Inject the owner's business vision & per-agent strategies into every chat
  try {
    const { ieStrategies: ieStrat } = await import('@shared/schema');
    const [stratRow] = await db.select().from(ieStrat).where(eq(ieStrat.orgId, orgId)).limit(1);
    const stratParts: string[] = [];
    if (stratRow?.visionMission?.trim()) {
      stratParts.push(`BUSINESS VISION & MISSION:\\n"${stratRow.visionMission.trim()}"`);
    }
    if (stratRow?.successFactors?.trim()) {
      stratParts.push(`DEFINING SUCCESS (VIVID VISION — the future state the owner is driving toward):\\n"${stratRow.successFactors.trim()}"`);
    }
    // Also inject per-agent strategies if present — they give E.L.F.I.E. richer context
    const agentStratParts: string[] = [];
    if (stratRow?.pricingStrategy?.trim())   agentStratParts.push(`Pricing: ${stratRow.pricingStrategy.trim()}`);
    if (stratRow?.inventoryStrategy?.trim())  agentStratParts.push(`Inventory: ${stratRow.inventoryStrategy.trim()}`);
    if (stratRow?.ordersStrategy?.trim())     agentStratParts.push(`Orders: ${stratRow.ordersStrategy.trim()}`);
    if (stratRow?.customerStrategy?.trim())   agentStratParts.push(`Customers: ${stratRow.customerStrategy.trim()}`);

    if (agentStratParts.length > 0) {
      stratParts.push(`DOMAIN STRATEGIES:\\n${agentStratParts.join('\\n')}`);
    }

    if (stratParts.length > 0) {
      systemPrompt = `${systemPrompt}\\n\\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\nOWNER'S GUIDING STRATEGY (The North Star for your advice)\\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\\n\\n${stratParts.join('\\n\\n')}`;
    }
  } catch (err) {
    console.warn('[Chat] Failed to inject strategy context:', err);
  }

  const { runAgentLoop } = await import('../services/ai-agent');
  let assistantMessage: string;
  let bricklinkCatalogItem: any = null;
  let ordersFromAgentTools: any[] = [];
  let forumDiscussionsFromAgentTools: any[] = [];
  let marketNewsFromAgentTools: any[] = [];

  try {
    const agentResult = await runAgentLoop({ systemPrompt, messages, maxIterations: 5, orgId });
    assistantMessage = agentResult.message;
    bricklinkCatalogItem = agentResult.bricklinkItem;
    ordersFromAgentTools = agentResult.ordersFromTool || [];
    forumDiscussionsFromAgentTools = agentResult.forumDiscussionsFromTool || [];
    marketNewsFromAgentTools = agentResult.marketNewsFromTool || [];
  } catch (agentError: any) {
    console.error('Agent loop error:', agentError);
    let errorMessage = "I'm having trouble processing your request right now.";
    if (agentError.message?.includes('timeout')) errorMessage = "The AI service is taking too long to respond. Please try again.";
    else if (agentError.message?.includes('API')) errorMessage = "I'm having trouble connecting to the AI service. Please try again in a moment.";
    return res.json({ message: errorMessage, items: [], orders: [], sessionId, error: true });
  }

  try {
    const lastUserMessageRaw2 = messages[messages.length - 1]?.content || '';
    await db.insert(conversations).values({ sessionId, role: 'user', content: lastUserMessageRaw2, orgId });
    await db.insert(conversations).values({ sessionId, role: 'assistant', content: assistantMessage, orgId });
    const [existingThread] = await db.select().from(conversationThreads)
      .where(and(eq(conversationThreads.sessionId, sessionId), eq(conversationThreads.orgId, orgId))).limit(1);
    if (!existingThread) {
      await db.insert(conversationThreads).values({ sessionId, orgId, title: 'New conversation' });
    } else {
      await db.update(conversationThreads).set({ updatedAt: new Date() })
        .where(and(eq(conversationThreads.sessionId, sessionId), eq(conversationThreads.orgId, orgId)));
    }
  } catch (saveErr) {
    console.error('Error saving conversation:', saveErr);
  }

  res.json({
    message: assistantMessage,
    items: [],
    orders: ordersFromAgentTools,
    forumDiscussions: forumDiscussionsFromAgentTools,
    marketNewsArticles: marketNewsFromAgentTools,
    sessionId,
    bricklinkSearchSuggestion,
    bricklinkItem: bricklinkCatalogItem,
  });
}));

// 10. GET /search
router.get("/search", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const q = ((req.query.q as string) || '').trim();
  if (q.length < 2) return res.json({ inventory: [], orders: [] });

  const isNumeric = /^\d+$/.test(q);

  const invWhere = and(
    eq(blInventory.orgId, orgId),
    isNull(blInventory.deletedAt),
    or(
      ilike(blInventory.itemNo, `%${q}%`),
      ilike(blInventory.description, `%${q}%`),
      ilike(blInventory.remarks, `%${q}%`),
      ...(isNumeric ? [eq(blInventory.id, parseInt(q))] : []),
    )
  );

  const inventoryResults = await db
    .select({
      id: blInventory.id,
      itemNo: blInventory.itemNo,
      description: blInventory.description,
      remarks: blInventory.remarks,
      colorName: blColors.name,
      newOrUsed: blInventory.newOrUsed,
      quantity: blInventory.quantity,
      unitPrice: blInventory.unitPrice,
    })
    .from(blInventory)
    .leftJoin(blColors, eq(blInventory.colorId, blColors.id))
    .where(invWhere)
    .orderBy(
      sql`CASE
        WHEN LOWER(${blInventory.itemNo}) = LOWER(${q}) THEN 0
        WHEN LOWER(${blInventory.itemNo}) LIKE LOWER(${q + '%'}) THEN 1
        WHEN LOWER(${blInventory.itemNo}) LIKE LOWER(${'%' + q + '%'}) THEN 2
        ELSE 3
      END`,
      asc(blInventory.itemNo)
    )
    .limit(500);

  const ordWhere = and(
    eq(orders.orgId, orgId),
    or(
      ilike(orders.orderNumber, `%${q}%`),
      ilike(orders.customerUsername, `%${q}%`),
      ilike(orders.customerEmail, `%${q}%`),
      ilike(orders.shipTo, `%${q}%`),
    )
  );

  const orderResults = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerUsername: orders.customerUsername,
      customerEmail: orders.customerEmail,
      shipTo: orders.shipTo,
      orderTotal: orders.orderTotal,
      orderStatus: orders.orderStatus,
      marketplace: orders.marketplace,
      orderDate: orders.orderDate,
    })
    .from(orders)
    .where(ordWhere)
    .orderBy(desc(orders.orderDate))
    .limit(500);

  res.json({ inventory: inventoryResults, orders: orderResults });
}));

// 11. POST /search/inventory/semantic
router.post("/search/inventory/semantic", isApproved, asyncRoute(async (req, res) => {
  const { query, limit = 5 } = req.body;
  const orgId = reqOrgId(req);
  
  if (!query) {
    return res.status(400).json({ error: "Query is required" });
  }
  
  const { searchInventorySemantic } = await import('../services/embeddings');
  const results = await searchInventorySemantic(query, Number(limit), Number(orgId));
  
  res.json({ results });
}));

// 12. POST /search/orders/semantic
router.post("/search/orders/semantic", isApproved, asyncRoute(async (req, res) => {
  const { query, limit = 5 } = req.body;
  const orgId = reqOrgId(req);
  
  if (!query) {
    return res.status(400).json({ error: "Query is required" });
  }
  
  const { searchOrders } = await import('../services/embeddings');
  const results = await searchOrders(query, Number(limit), Number(orgId));
  
  res.json({ results });
}));

// 13. GET /inventory/:id/similar
router.get("/inventory/:id/similar", isApproved, asyncRoute(async (req, res) => {
  const inventoryId = parseInt(req.params.id);
  const limit = parseInt(req.query.limit as string) || 5;
  
  const { findSimilarItems } = await import('../services/embeddings');
  const results = await findSimilarItems(inventoryId, limit);
  
  res.json({ results });
}));

// 14. GET /inventory/:itemNo/:colorId/sets/count
router.get("/inventory/:itemNo/:colorId/sets/count", isApproved, asyncRoute(async (req, res) => {
  const { itemNo, colorId } = req.params;
  const colorIdNum = parseInt(colorId);

  const [result] = await db
    .select({ count: sql<number>`count(distinct ${setPartRelationships.setNum})::int` })
    .from(setPartRelationships)
    .where(
      and(
        eq(setPartRelationships.partNum, itemNo),
        colorIdNum && colorIdNum > 0
          ? eq(setPartRelationships.colorId, colorIdNum)
          : sql`${setPartRelationships.colorId} IS NULL`
      )
    );

  res.json({ total: result?.count ?? 0 });
}));

// 15. GET /inventory/:itemNo/:colorId/sets
router.get("/inventory/:itemNo/:colorId/sets", isApproved, asyncRoute(async (req, res) => {
  const { itemNo, colorId } = req.params;
  const colorIdNum = parseInt(colorId);
  
  const colorInfo = colorIdNum && colorIdNum > 0
    ? await db
        .select({
          id: blColors.id,
          name: blColors.name,
          rgb: blColors.rgb,
        })
        .from(blColors)
        .where(eq(blColors.id, colorIdNum))
        .limit(1)
    : [];
  
  const requestedColor = colorInfo.length > 0 ? colorInfo[0] : null;
  
  const rawData = await db
    .select({
      setNum: setPartRelationships.setNum,
      setName: sql<string>`max(${setPartRelationships.setName})`,
      quantity: sql<number>`sum(${setPartRelationships.quantity})::int`,
    })
    .from(setPartRelationships)
    .where(
      and(
        eq(setPartRelationships.partNum, itemNo),
        colorIdNum && colorIdNum > 0 
          ? eq(setPartRelationships.colorId, colorIdNum)
          : sql`${setPartRelationships.colorId} IS NULL`
      )
    )
    .groupBy(setPartRelationships.setNum)
    .orderBy(setPartRelationships.setNum);
  
  const sortedSets = rawData.sort((a, b) => {
    const nameA = (a.setName || a.setNum).toLowerCase();
    const nameB = (b.setName || b.setNum).toLowerCase();
    return nameA.localeCompare(nameB);
  });
  
  res.json({ 
    sets: sortedSets,
    total: sortedSets.length,
    color: requestedColor ? {
      id: requestedColor.id,
      name: requestedColor.name,
      rgb: requestedColor.rgb,
    } : null
  });
}));

// 16. GET /inventory/:setNum/parts-in-set
router.get("/inventory/:setNum/parts-in-set", isApproved, asyncRoute(async (req: any, res) => {
  const { setNum } = req.params;
  const search = (req.query.search as string || '').trim().toLowerCase();

  const rows = await db
    .select({
      partNum:        setPartRelationships.partNum,
      colorId:        setPartRelationships.colorId,
      quantity:       setPartRelationships.quantity,
      partName:       blCatalog.itemName,
      colorName:      blCatalog.colorName,
      thumbnailUrl:   blCatalog.thumbnailUrl,
      storedImageKey: blCatalog.storedImageKey,
      colorRgb:       blColors.rgb,
    })
    .from(setPartRelationships)
    .leftJoin(
      blCatalog,
      sql`${blCatalog.itemNo} = ${setPartRelationships.partNum}
        AND ${blCatalog.itemType} = 'PART'
        AND ${blCatalog.colorId} = COALESCE(${setPartRelationships.colorId}, 0)`
    )
    .leftJoin(blColors, eq(blColors.id, setPartRelationships.colorId))
    .where(eq(setPartRelationships.setNum, setNum))
    .orderBy(setPartRelationships.partNum);

  const filtered = search
    ? rows.filter(r =>
        (r.partNum   ?? '').toLowerCase().includes(search) ||
        (r.partName  ?? '').toLowerCase().includes(search) ||
        (r.colorName ?? '').toLowerCase().includes(search)
      )
    : rows;

  res.json({ total: filtered.length, parts: filtered });
}));

// 17. POST /embeddings/inventory/batch
router.post("/embeddings/inventory/batch", isApproved, asyncRoute(async (req, res) => {
  const { inventoryIds } = req.body;
  
  if (!inventoryIds || !Array.isArray(inventoryIds)) {
    return res.status(400).json({ error: "inventoryIds array is required" });
  }
  
  const { batchEmbedInventory } = await import('../services/embeddings');
  const results = await batchEmbedInventory(inventoryIds);
  
  res.json({ results });
}));

// 18. POST /embeddings/inventory/:id
router.post("/embeddings/inventory/:id", isApproved, asyncRoute(async (req, res) => {
  const inventoryId = parseInt(req.params.id);
  
  const { embedInventoryItem } = await import('../services/embeddings');
  const result = await embedInventoryItem(inventoryId);
  
  res.json(result);
}));

// 19. GET /embeddings/stats
router.get("/embeddings/stats", isApproved, asyncRoute(async (req, res) => {
  const { getEmbeddingStats } = await import('../services/embeddings');
  const stats = await getEmbeddingStats();
  
  res.json(stats);
}));

// 20. GET /embeddings/inventory/missing
router.get("/embeddings/inventory/missing", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const limit = parseInt(req.query.limit as string) || 100;
  
  // Get inventory items that don't have embeddings yet
  const itemsWithoutEmbeddings = await db
    .select({ id: blInventory.id })
    .from(blInventory)
    .leftJoin(inventoryEmbeddings, eq(blInventory.id, inventoryEmbeddings.inventoryId))
    .where(and(eq(blInventory.orgId, orgId), sql`${inventoryEmbeddings.inventoryId} IS NULL`))
    .limit(limit);
  
  res.json(itemsWithoutEmbeddings);
}));

// 21. GET /embeddings/orders/missing
router.get("/embeddings/orders/missing", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const limit = parseInt(req.query.limit as string) || 100;
  
  // Get orders that don't have embeddings yet
  const ordersWithoutEmbeddings = await db
    .select({ id: orders.id })
    .from(orders)
    .leftJoin(orderEmbeddings, eq(orders.id, orderEmbeddings.orderId))
    .where(and(eq(orders.orgId, orgId), sql`${orderEmbeddings.orderId} IS NULL`))
    .limit(limit);
  
  res.json(ordersWithoutEmbeddings);
}));

// 22. POST /embeddings/orders/batch
router.post("/embeddings/orders/batch", isApproved, asyncRoute(async (req, res) => {
  const { orderIds } = req.body;
  
  if (!orderIds || !Array.isArray(orderIds)) {
    return res.status(400).json({ error: "orderIds array is required" });
  }
  
  const { batchEmbedOrders } = await import('../services/embeddings');
  const results = await batchEmbedOrders(orderIds);
  
  res.json({ results });
}));

// Background Job Routes
const startJobSchema = z.object({
  type: z.enum(['inventory', 'orders']),
  batchSize: z.number().int().min(10).max(100).optional().default(30),
});

// 23. POST /embeddings/jobs/start
router.post("/embeddings/jobs/start", isApproved, asyncRoute(async (req, res) => {
  // Validate input
  const validated = startJobSchema.parse(req.body);
  
  // Use the new persistent embedding worker instead of the old in-memory system
  const { createEmbeddingJob } = await import('../services/embedding-worker');
  const job = await createEmbeddingJob(validated.type, 'manual');
  
  res.json({ 
    jobId: job.id, 
    message: 'Background job started - will continue until 100% complete',
    persistent: true
  });
}));

// 24. POST /embeddings/jobs/:jobId/stop
router.post("/embeddings/jobs/:jobId/stop", isApproved, asyncRoute(async (req, res) => {
  const { jobId } = req.params;
  
  const { jobManager } = await import('../services/backgroundJobs');
  const stopped = jobManager.stopJob(jobId);
  
  if (stopped) {
    res.json({ message: 'Job stopped successfully' });
  } else {
    res.status(404).json({ error: 'Job not found or not running' });
  }
}));

// 25. GET /embeddings/jobs/:jobId
router.get("/embeddings/jobs/:jobId", isApproved, asyncRoute(async (req, res) => {
  const { jobId } = req.params;
  
  const { jobManager } = await import('../services/backgroundJobs');
  const job = jobManager.getJobStatus(jobId);
  
  if (job) {
    res.json(job);
  } else {
    res.status(404).json({ error: 'Job not found' });
  }
}));

// 26. GET /embeddings/jobs/active/:type
router.get("/embeddings/jobs/active/:type", isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { type } = req.params;
  
  if (!type || !['inventory', 'orders', 'sets'].includes(type)) {
    return res.status(400).json({ error: "Invalid job type. Must be 'inventory', 'orders', or 'sets'" });
  }
  
  // Query the persistent database for active jobs
  const [activeJob] = await db
    .select()
    .from(embeddingJobs)
    .where(and(eq(embeddingJobs.orgId, orgId), sql`${embeddingJobs.jobType} = ${type} AND ${embeddingJobs.status} IN ('pending', 'processing')`))
    .orderBy(desc(embeddingJobs.createdAt))
    .limit(1);
  
  res.json(activeJob || null);
}));

// 27. GET /embeddings/jobs
router.get("/embeddings/jobs", isApproved, asyncRoute(async (req, res) => {
  const { jobManager } = await import('../services/backgroundJobs');
  const jobs = jobManager.getAllJobs();
  
  res.json(jobs);
}));

// 28. GET /bricklink/search
router.get("/bricklink/search", isApproved, asyncRoute(async (req, res) => {
  const { itemNo, itemType } = req.query;
  
  if (!itemNo || !itemType) {
    return res.status(400).json({ error: "Missing itemNo or itemType parameter" });
  }
  
  // Search BrickLink catalog
  const catalogItem = await searchBricklinkCatalogItem(itemNo as string, itemType as string);
  
  if (catalogItem) {
    res.json({ item: catalogItem });
  } else {
    res.status(404).json({ error: "Item not found in BrickLink catalog" });
  }
}));

// 29. POST /brickognize/identify
router.post("/brickognize/identify", upload.single('image'), isApproved, asyncRoute(async (req: any, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image file provided" });
  }
  
  const itemType = req.body.itemType || 'parts'; // Default to parts
  
  // Use the form-data package with axios for proper Node.js compatibility
  const formData = new FormData();
  formData.append('query_image', req.file.buffer, {
    filename: req.file.originalname || 'image.jpg',
    contentType: req.file.mimetype || 'image/jpeg',
  });
  
  // Call Brickognize API using axios (handles streams properly)
  const brickognizeUrl = `https://api.brickognize.com/predict/${itemType}/`;
  const response = await axios.post(brickognizeUrl, formData, {
    headers: formData.getHeaders(),
  });
  
  const { trackUsage } = await import('../services/ai-usage-tracker');
  trackUsage({
    service: 'brickognize',
    model: 'brickognize-v1',
    operation: 'brickspotter-scan',
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    orgId: reqOrgId(req),
  });
  res.json(response.data);
}));

router.use(apiErrorHandler);
export default router;
