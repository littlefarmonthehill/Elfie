import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '../db';
import { platformSettings, orgIntegrations, channelSyncConfig } from '@shared/schema';
import { isApproved } from '../auth';
import { asyncRoute, reqOrgId } from '../lib/routeHelpers';

const EBAY_SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly',
  'https://api.ebay.com/oauth/api_scope/commerce.identity.readonly',
].join(' ');

const getFrontendBase = () =>
  process.env.REPLIT_DOMAINS
    ? `https://${process.env.REPLIT_DOMAINS.split(',')[0].trim()}`
    : 'http://localhost:5000';

const router = Router();

// GET /api/ebay/oauth/initiate?env=production|sandbox
router.get('/oauth/initiate', isApproved, asyncRoute(async (req: any, res) => {
  const env = (req.query.env as string) === 'sandbox' ? 'sandbox' : 'production';
  const orgId = reqOrgId(req);
  const [ps] = await db.select().from(platformSettings).limit(1);
  const appId  = env === 'sandbox' ? ps?.ebaySandboxAppId  : ps?.ebayProdAppId;
  const ruName = env === 'sandbox' ? ps?.ebaySandboxRuName : ps?.ebayProdRuName;
  if (!appId || !ruName) {
    return res.status(400).json({ message: 'eBay platform credentials not configured. Ask your platform admin to add them under Services → eBay.' });
  }
  const state = Buffer.from(JSON.stringify({ orgId, env })).toString('base64url');
  const baseUrl = env === 'sandbox'
    ? 'https://auth.sandbox.ebay.com/oauth2/authorize'
    : 'https://auth.ebay.com/oauth2/authorize';
  const url = `${baseUrl}?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(ruName)}&response_type=code&scope=${encodeURIComponent(EBAY_SCOPES)}&state=${state}`;
  res.redirect(url);
}));

// GET /api/ebay/oauth/callback — no auth, eBay redirects here
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query as Record<string, string>;
  const base = getFrontendBase();

  if (error || !code || !state) {
    const msg = encodeURIComponent(error_description || error || 'Authorization cancelled or failed');
    return res.redirect(`${base}/?ebay_status=error&ebay_error=${msg}`);
  }

  let orgId: string, env: string;
  try {
    ({ orgId, env } = JSON.parse(Buffer.from(state, 'base64url').toString()));
  } catch {
    return res.redirect(`${base}/?ebay_status=error&ebay_error=${encodeURIComponent('Invalid state parameter')}`);
  }

  try {
    const [ps] = await db.select().from(platformSettings).limit(1);
    const appId  = env === 'sandbox' ? ps?.ebaySandboxAppId  : ps?.ebayProdAppId;
    const certId = env === 'sandbox' ? ps?.ebaySandboxCertId : ps?.ebayProdCertId;
    const ruName = env === 'sandbox' ? ps?.ebaySandboxRuName : ps?.ebayProdRuName;
    if (!appId || !certId || !ruName) {
      return res.redirect(`${base}/?ebay_status=error&ebay_error=${encodeURIComponent('Platform eBay credentials missing')}`);
    }
    const tokenUrl = env === 'sandbox'
      ? 'https://api.sandbox.ebay.com/identity/v1/oauth2/token'
      : 'https://api.ebay.com/identity/v1/oauth2/token';
    const basicAuth = Buffer.from(`${appId}:${certId}`).toString('base64');
    const tokenResp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${basicAuth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: ruName }),
    });
    if (!tokenResp.ok) {
      const body = await tokenResp.text();
      console.error('[eBay OAuth] Token exchange failed:', body);
      return res.redirect(`${base}/?ebay_status=error&ebay_error=${encodeURIComponent('Token exchange failed — check eBay RuName matches callback URL')}`);
    }
    const tokenData = await tokenResp.json() as { refresh_token: string; access_token: string };
    const tokenKey = env === 'sandbox' ? 'sandboxRefreshToken' : 'refreshToken';
    const [existing] = await db.select().from(orgIntegrations)
      .where(and(eq(orgIntegrations.orgId, orgId), eq(orgIntegrations.channel, 'ebay')))
      .limit(1);
    const existingCreds = ((existing?.credentials ?? {}) as Record<string, string>);
    const newCreds: Record<string, string> = { ...existingCreds, [tokenKey]: tokenData.refresh_token, environment: env };
    if (existing) {
      await db.update(orgIntegrations).set({ credentials: newCreds }).where(eq(orgIntegrations.id, existing.id));
    } else {
      await db.insert(orgIntegrations).values({ orgId, channel: 'ebay', type: 'sales_channel', displayName: 'eBay', credentials: newCreds });
      try {
        await db.insert(channelSyncConfig).values({ orgId, channelKey: 'ebay' }).onConflictDoNothing();
      } catch {}
    }
    res.redirect(`${base}/?ebay_status=connected&ebay_env=${env}`);
  } catch (err: any) {
    console.error('[eBay OAuth] Callback error:', err);
    res.redirect(`${base}/?ebay_status=error&ebay_error=${encodeURIComponent(err?.message || 'Server error during token exchange')}`);
  }
});

// GET /api/ebay/connection/status
router.get('/connection/status', isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const [row] = await db.select().from(orgIntegrations)
    .where(and(eq(orgIntegrations.orgId, orgId), eq(orgIntegrations.channel, 'ebay')))
    .limit(1);
  const creds = ((row?.credentials ?? {}) as Record<string, string>);
  const [ps] = await db.select().from(platformSettings).limit(1);
  res.json({
    production:      { connected: !!creds.refreshToken },
    sandbox:         { connected: !!creds.sandboxRefreshToken },
    activeEnvironment: (creds.environment as 'production' | 'sandbox') ?? 'production',
    platformConfigured: {
      production: !!(ps?.ebayProdAppId && ps?.ebayProdCertId && ps?.ebayProdRuName),
      sandbox:    !!(ps?.ebaySandboxAppId && ps?.ebaySandboxCertId && ps?.ebaySandboxRuName),
    },
  });
}));

// DELETE /api/ebay/connection?env=production|sandbox
router.delete('/connection', isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const env = (req.query.env as string) === 'sandbox' ? 'sandbox' : 'production';
  const tokenKey = env === 'sandbox' ? 'sandboxRefreshToken' : 'refreshToken';
  const [row] = await db.select().from(orgIntegrations)
    .where(and(eq(orgIntegrations.orgId, orgId), eq(orgIntegrations.channel, 'ebay')))
    .limit(1);
  if (!row) return res.json({ ok: true });
  const creds = { ...((row.credentials as Record<string, string>) ?? {}) };
  delete creds[tokenKey];
  if (env === 'production') creds.environment = 'sandbox';
  await db.update(orgIntegrations).set({ credentials: creds }).where(eq(orgIntegrations.id, row.id));
  res.json({ ok: true });
}));

// GET /api/ebay/notifications — eBay challenge verification (no auth)
router.get('/notifications', async (req, res) => {
  try {
    const challengeCode = req.query.challenge_code as string | undefined;
    if (!challengeCode) return res.status(400).json({ error: 'Missing challenge_code' });
    const [ps] = await db.select({ token: platformSettings.ebayNotificationToken })
      .from(platformSettings)
      .where(eq(platformSettings.id, 'platform'))
      .limit(1);
    const token = ps?.token ?? '';
    if (!token) {
      console.warn('[eBay Notifications] challenge_code received but no verification token configured');
      return res.status(500).json({ error: 'Notification token not configured' });
    }
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'https';
    const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
    const notificationEndpoint = `${proto}://${host}/api/ebay/notifications`;
    console.log(`[eBay Notifications] Challenge received. Endpoint used for hash: ${notificationEndpoint}`);
    const hash = createHash('sha256')
      .update(challengeCode + token + notificationEndpoint)
      .digest('hex');
    res.json({ challengeResponse: hash });
  } catch (err: any) {
    console.error('[eBay Notifications] Challenge error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ebay/notifications — account deletion (no auth, always 200)
router.post('/notifications', async (req, res) => {
  try {
    const topic = req.body?.metadata?.topic ?? 'unknown';
    console.log(`[eBay Notifications] Received notification: topic=${topic}`);
    res.status(200).json({ ok: true });
  } catch (err: any) {
    console.error('[eBay Notifications] POST error:', err.message);
    res.status(200).json({ ok: true });
  }
});

// POST /api/ebay/connection/environment
router.post('/connection/environment', isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const env = (req.body.env as string) === 'sandbox' ? 'sandbox' : 'production';
  const [row] = await db.select().from(orgIntegrations)
    .where(and(eq(orgIntegrations.orgId, orgId), eq(orgIntegrations.channel, 'ebay')))
    .limit(1);
  if (row) {
    const creds = { ...((row.credentials as Record<string, string>) ?? {}), environment: env };
    await db.update(orgIntegrations).set({ credentials: creds }).where(eq(orgIntegrations.id, row.id));
  } else {
    await db.insert(orgIntegrations).values({ orgId, channel: 'ebay', type: 'sales_channel', displayName: 'eBay', credentials: { environment: env } });
  }
  res.json({ ok: true });
}));

export default router;
