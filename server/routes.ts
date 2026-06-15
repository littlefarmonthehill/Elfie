import type { Express } from "express";
import { createServer, type Server } from "http";
import { sql } from "drizzle-orm";
import { addConnection, removeConnection, broadcast } from "./sse";
import { db } from "./db";
import { setupAuth, isApproved } from "./auth";
import { reqOrgId } from "./lib/routeHelpers";
import { apiErrorHandler } from "./middleware/errorHandler";

// Domain sub-routers
import billingRouter from "./routers/billing";
import easypostWebhookRouter from "./routers/easypost-webhook";
import conversationsRouter from "./routers/conversations";
import bulkLotsRouter from "./routers/bulkLots";
import ebayRouter from "./routers/ebay";
import userImagesRouter from "./routers/userImages";
import ordersRouter from "./routers/orders";
import platformAdminRouter from "./routers/platformAdmin";
import warehouseRouter from "./routers/warehouse";
import listingBatchesRouter from "./routers/listing-batches";
import miscRouter from "./routers/misc";
import aiRouter from "./routers/ai";
import visionRouter from "./routers/vision";
import inventoryRouter from "./routers/inventory";
import pricingRouter from "./routers/pricing";
import syncRouter from "./routers/sync";
import authRouter from "./routers/auth";
import orgRouter from "./routers/org";
import adminRouter from "./routers/admin";
import exportRouter from "./routers/export";
import marketingRouter from "./routers/marketing";

// Re-export shared platform helpers so existing code that imports from this
// module continues to work without changes.
export { getPlatformSettings, getPlatformOpenAIKey, getPlatformBrickLinkCredentials } from "./lib/platformSettings";

export async function registerRoutes(app: Express): Promise<Server> {
  // ── One-time startup: deduplicate picklist_items ──────────────────────────
  try {
    await db.execute(sql`
      DELETE FROM picklist_items
      WHERE id NOT IN (
        SELECT DISTINCT ON (order_detail_id) id
        FROM picklist_items
        ORDER BY order_detail_id, created_at ASC
      )
    `);
  } catch (e) {
    console.warn('[startup] picklist_items dedup skipped:', (e as Error).message);
  }

  // Auth middleware setup
  await setupAuth(app);

  app.get('/api/health', (_req, res) => { res.json({ ok: true }); });

  // ── Domain sub-routers ────────────────────────────────────────────────────
  app.use('/api/billing', billingRouter);
  app.use('/api', easypostWebhookRouter);
  app.use('/api', conversationsRouter);
  app.use('/api/bulk-lots', bulkLotsRouter);
  app.use('/api/ebay', ebayRouter);
  app.use('/api/user-images', userImagesRouter);
  app.use('/api', ordersRouter);
  app.use('/api', platformAdminRouter);
  app.use('/api', warehouseRouter);
  app.use('/api', listingBatchesRouter);
  app.use('/api', miscRouter);
  app.use('/api', aiRouter);
  app.use('/api', visionRouter);
  app.use('/api', inventoryRouter);
  app.use('/api', pricingRouter);
  app.use('/api', syncRouter);
  app.use('/api', authRouter);
  app.use('/api', orgRouter);
  app.use('/api', adminRouter);
  app.use('/api', exportRouter);
  app.use('/api', marketingRouter);

  // ── Server-Sent Events ────────────────────────────────────────────────────
  app.get('/api/events', isApproved, (req: any, res) => {
    const orgId = reqOrgId(req);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    addConnection(orgId, res);

    const ping = setInterval(() => {
      try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
    }, 25000);

    req.on('close', () => {
      clearInterval(ping);
      removeConnection(orgId, res);
    });
  });

  // ── Public static documents ───────────────────────────────────────────────
  app.get('/dbs-service-agreement.html', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Driftless Business Solutions – Service Agreement</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Georgia', serif; font-size: 9pt; color: #1a1a1a; background: #fff; line-height: 1.35; }
    .page { max-width: 720px; margin: 0 auto; padding: 28px 40px 28px; }
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #2c5f8a; padding-bottom: 8px; margin-bottom: 10px; }
    .header-left .company { font-size: 15pt; font-weight: bold; color: #2c5f8a; letter-spacing: 0.04em; text-transform: uppercase; }
    .header-left .tagline { font-size: 8pt; color: #666; font-style: italic; margin-top: 2px; }
    .header-right .doc-title { font-size: 11pt; font-weight: bold; color: #1a1a1a; }
    .header-right .doc-date { font-size: 8.5pt; color: #555; margin-top: 3px; text-align: right; }
    .meta { display: flex; gap: 24px; background: #f5f8fb; border: 1px solid #d0dde8; border-radius: 4px; padding: 6px 12px; margin-bottom: 10px; font-size: 8.5pt; }
    .meta-item label { color: #666; font-style: italic; margin-right: 4px; }
    .meta-item value { font-weight: bold; }
    h2 { font-size: 9.5pt; font-weight: bold; color: #2c5f8a; text-transform: uppercase; letter-spacing: 0.05em; background: #e2e6ea; padding: 3px 8px; border-radius: 3px; margin-top: 10px; margin-bottom: 5px; }
    h3 { font-size: 9pt; font-weight: bold; color: #1a1a1a; margin-top: 7px; margin-bottom: 3px; }
    p { margin-bottom: 4px; }
    ul { padding-left: 15px; margin-bottom: 4px; }
    ul li { margin-bottom: 1px; }
    .two-col-list { columns: 2; column-gap: 20px; padding-left: 15px; margin-bottom: 4px; }
    .two-col-list li { margin-bottom: 1px; break-inside: avoid; }
    .package-choice { display: flex; gap: 10px; margin: 5px 0 6px; }
    .package-box { flex: 1; border: 1.5px solid #2c5f8a; border-radius: 4px; padding: 7px 10px; }
    .package-box .pkg-header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 2px; }
    .package-box .pkg-name { font-weight: bold; font-size: 9.5pt; color: #2c5f8a; display: flex; align-items: center; gap: 6px; }
    .package-box .pkg-price { font-size: 11pt; font-weight: bold; color: #1a1a1a; margin-left: auto; }
    .package-box .pkg-desc { font-size: 8.5pt; color: #444; }
    .checkbox { display: inline-block; width: 11px; height: 11px; border: 1.5px solid #2c5f8a; border-radius: 2px; vertical-align: middle; flex-shrink: 0; }
    .timeline { display: flex; gap: 0; margin: 5px 0 6px; border: 1px solid #d0dde8; border-radius: 4px; overflow: hidden; font-size: 8.5pt; }
    .timeline-step { flex: 1; padding: 5px 8px; border-right: 1px solid #d0dde8; }
    .timeline-step:last-child { border-right: none; }
    .timeline-step .wk { font-weight: bold; color: #2c5f8a; font-size: 8pt; }
    .section { margin-bottom: 8px; }
    .section > h2:first-child { margin-top: 0; }
    .two-col-terms { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin-top: 8px; }
    .term-block h2 { margin-top: 0; }
    .sig-section { margin-top: 10px; border-top: 1px solid #d0dde8; padding-top: 8px; }
    .pkg-select-line { font-size: 9pt; margin-bottom: 10px; }
    .pkg-select-line span { display: inline-block; width: 150px; border-bottom: 1px solid #333; margin-left: 5px; }
    .signature-block { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .sig-party label { display: block; font-size: 7.5pt; color: #666; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
    .sig-party .party-name { font-weight: bold; font-size: 9pt; color: #1a1a1a; margin-bottom: 24px; }
    .sig-line { border-top: 1.5px solid #1a1a1a; padding-top: 3px; font-size: 8.5pt; color: #444; }
    .sig-line-2 { margin-top: 16px; border-top: 1px solid #aaa; padding-top: 3px; font-size: 8.5pt; color: #666; }
    .footer { margin-top: 8px; border-top: 1px solid #d0dde8; padding-top: 4px; text-align: center; font-size: 7.5pt; color: #999; }
    @media print {
      body { font-size: 9pt; }
      .page { padding: 16px 28px 16px; max-width: 100%; }
      h2 { page-break-after: avoid; }
      .package-choice { page-break-inside: avoid; }
      .two-col-terms { page-break-inside: avoid; }
      .sig-section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-left">
        <div class="company">Driftless Business Solutions</div>
        <div class="tagline">Customized systems that just work, so you can do the work you love</div>
      </div>
      <div class="header-right">
        <div class="doc-title">Service Agreement</div>
        <div class="doc-date">March 3, 2026</div>
      </div>
    </div>
    <div class="meta">
      <div class="meta-item"><label>Client:</label><value>Minnesota Building Contractors</value></div>
      <div class="meta-item"><label>Service Provider:</label><value>Driftless Business Solutions ("DBS")</value></div>
    </div>
    <div class="section">
      <h2>Scope of Work</h2>
      <ul class="two-col-list">
        <li>Increase residential service inquiries and referrals</li>
        <li>Lead capture and contact forms</li>
        <li>Express the Client's vision, mission, and messaging</li>
        <li>Content assets ready for marketing and social media</li>
        <li>Showcase completed work through galleries, photos, and videos</li>
        <li>MVP of the solution — designed, built, reviewed, and delivered within 4 weeks</li>
      </ul>
    </div>
    <div class="section">
      <h2>1.1 &nbsp; Initial Development</h2>
      <p>DBS will build a custom residential-focused website for <strong>Minnesota Building Contractors</strong>, including:</p>
      <ul class="two-col-list">
        <li>Custom design, layout &amp; mobile display</li>
        <li>Lead capture &amp; contact forms</li>
        <li>Residential-focused copywriting &amp; messaging</li>
        <li>Project showcase (galleries, photos, videos)</li>
      </ul>
      <div class="package-choice">
        <div class="package-box">
          <div class="pkg-header">
            <div class="pkg-name"><span class="checkbox"></span> Starter MVP</div>
            <div class="pkg-price">$1,000</div>
          </div>
          <div class="pkg-desc">Residential site with lead capture, 1–2 lightweight tools, and basic project showcase.</div>
        </div>
        <div class="package-box">
          <div class="pkg-header">
            <div class="pkg-name"><span class="checkbox"></span> Core MVP</div>
            <div class="pkg-price">$2,000</div>
          </div>
          <div class="pkg-desc">Full-featured site with lead capture workflows, enhanced showcase, and marketing-ready messaging assets.</div>
        </div>
      </div>
    </div>
    <div class="section">
      <h2>1.2 &nbsp; Ongoing Support</h2>
      <div class="package-choice">
        <div class="package-box">
          <div class="pkg-header">
            <div class="pkg-name"><span class="checkbox"></span> Starter Support</div>
            <div class="pkg-price">$600/mo</div>
          </div>
          <div class="pkg-desc">4 hrs/month — Technology maintenance, minor updates, content tweaks, messaging adjustments.</div>
        </div>
        <div class="package-box">
          <div class="pkg-header">
            <div class="pkg-name"><span class="checkbox"></span> Core Support</div>
            <div class="pkg-price">$1,250/mo</div>
          </div>
          <div class="pkg-desc">10 hrs/month — Technology maintenance, messaging updates, vendor coordination, media updates.</div>
        </div>
      </div>
      <p style="font-size:8.5pt; color:#555; margin-top:-2px;">Additional hours billed at <strong>$150/hr</strong>.</p>
    </div>
    <div class="two-col-terms">
      <div class="term-block">
        <h2>Payment Terms</h2>
        <ul>
          <li>50% due at signing; 50% upon completion</li>
          <li>Ongoing Support billed monthly</li>
        </ul>
      </div>
      <div class="term-block">
        <h2>Client Responsibilities</h2>
        <ul>
          <li>Provide access to existing site, branding &amp; content</li>
          <li>Respond promptly to approvals; identify preferred vendors</li>
        </ul>
      </div>
      <div class="term-block">
        <h2>Ownership &amp; Rights</h2>
        <ul>
          <li>All work becomes Client property upon final payment</li>
          <li>DBS may showcase work in portfolio materials</li>
        </ul>
      </div>
      <div class="term-block">
        <h2>Termination</h2>
        <ul>
          <li>Either party may terminate with 30 days written notice</li>
          <li>Client pays for all work completed through termination</li>
        </ul>
      </div>
    </div>
    <div class="sig-section">
      <div class="signature-block">
        <div class="sig-party">
          <label>Client</label>
          <div class="party-name">Minnesota Building Contractors</div>
          <div class="sig-line">Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div>
        </div>
        <div class="sig-party">
          <label>Service Provider</label>
          <div class="party-name">Driftless Business Solutions</div>
          <div class="sig-line">Signature &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date</div>
        </div>
      </div>
    </div>
    <div class="footer">Driftless Business Solutions &nbsp;|&nbsp; Service Agreement &nbsp;|&nbsp; March 3, 2026</div>
  </div>
</body>
</html>`);
  });

  app.use(apiErrorHandler);

  const httpServer = createServer(app);
  return httpServer;
}
