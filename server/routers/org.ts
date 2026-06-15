import { Router } from 'express';
import multer from 'multer';
import { asyncRoute, reqOrgId } from '../lib/routeHelpers';
import { isAuthenticated, isApproved, isOrgOwner, getOrgId } from '../auth';
import { db } from '../db';
import { orgIntegrations, PLATFORM_ORG_ID } from '@shared/schema';
import { eq, and, sql } from 'drizzle-orm';
import { storage } from '../storage';

const router = Router();
const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

// GET /api/public/organizations — list org names for employee join flow (no auth)
router.get('/public/organizations', asyncRoute(async (_req, res) => {
  const allOrgs = await storage.getAllOrganizations();
  const publicOrgs = allOrgs
    .filter(o => o.isActive && o.id !== PLATFORM_ORG_ID && o.id !== '__platform__')
    .map(o => ({ id: o.id, name: o.name }));
  res.json(publicOrgs);
}));

// GET /api/org — current user's org details
router.get('/org', isAuthenticated, asyncRoute(async (req: any, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(404).json({ message: 'No organization' });
  const org = await storage.getOrganization(orgId);
  if (!org) return res.status(404).json({ message: 'Organization not found' });
  res.json(org);
}));

// POST /api/org/factory-reset — wipes all operational data and restarts onboarding
router.post('/org/factory-reset', isAuthenticated, isOrgOwner, asyncRoute(async (req: any, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(404).json({ message: 'No organization' });
  await storage.factoryResetOrganization(orgId);
  console.log(`[Org] Factory reset by owner for org ${orgId}`);
  res.json({ success: true });
}));

// PATCH /api/org — org owner can update org profile
router.patch('/org', isAuthenticated, isOrgOwner, asyncRoute(async (req: any, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(404).json({ message: 'No organization' });
  const { name, address, phone, website, onboardingCompleted } = req.body;
  if (name !== undefined && (typeof name !== 'string' || name.trim().length < 2)) {
    return res.status(400).json({ message: 'Name must be at least 2 characters' });
  }
  const updates: Record<string, any> = {};
  if (name !== undefined) updates.name = name.trim();
  if (address !== undefined) updates.address = address || null;
  if (phone !== undefined) updates.phone = phone || null;
  if (website !== undefined) updates.website = website || null;
  if (onboardingCompleted !== undefined) updates.onboardingCompleted = !!onboardingCompleted;
  const org = await storage.updateOrganization(orgId, updates);
  res.json(org);
}));

// POST /api/org/logo — upload org logo (stored as base64 data URL)
router.post('/org/logo', isAuthenticated, logoUpload.single('logo'), asyncRoute(async (req: any, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(404).json({ message: 'No organization' });
  if (!req.file) return res.status(400).json({ message: 'No file provided' });
  if (!req.file.mimetype.startsWith('image/')) {
    return res.status(400).json({ message: 'Only image files are allowed' });
  }
  const base64 = req.file.buffer.toString('base64');
  const logoUrl = `data:${req.file.mimetype};base64,${base64}`;
  const org = await storage.updateOrganization(orgId, { logoUrl });
  res.json({ logoUrl: org?.logoUrl });
}));

// DELETE /api/org/logo — remove org logo
router.delete('/org/logo', isAuthenticated, isOrgOwner, asyncRoute(async (req: any, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(404).json({ message: 'No organization' });
  await storage.updateOrganization(orgId, { logoUrl: null });
  res.json({ success: true });
}));

// DELETE /api/org — permanently delete the org and all its data (owner only)
router.delete('/org', isAuthenticated, isOrgOwner, asyncRoute(async (req: any, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(404).json({ message: 'No organization' });
  await storage.deleteOrganization(orgId);
  if (req.session?.impersonatingOrgId === orgId) {
    delete req.session.impersonatingOrgId;
    delete req.session.impersonatingOrgName;
    return res.json({ success: true, wasImpersonating: true });
  }
  req.logout?.(() => {});
  req.session?.destroy?.(() => {});
  res.json({ success: true, wasImpersonating: false });
}));

// PATCH /api/org/integrations/:id
router.patch('/org/integrations/:id', isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  const { credentials, isConnected, displayName } = req.body as {
    credentials?: Record<string, string>;
    isConnected?: boolean;
    displayName?: string;
  };
  const [row] = await db
    .update(orgIntegrations)
    .set({
      ...(credentials !== undefined && { credentials }),
      ...(isConnected !== undefined && { isConnected }),
      ...(displayName !== undefined && { displayName }),
      updatedAt: sql`NOW()`,
    })
    .where(and(eq(orgIntegrations.id, id), eq(orgIntegrations.orgId, orgId)))
    .returning();
  if (!row) return res.status(404).json({ error: 'Integration not found' });
  res.json({ success: true, integration: row });
}));

// DELETE /api/org/integrations/:id
router.delete('/org/integrations/:id', isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });
  await db.delete(orgIntegrations).where(
    and(eq(orgIntegrations.id, id), eq(orgIntegrations.orgId, orgId))
  );
  res.json({ success: true });
}));

export default router;
