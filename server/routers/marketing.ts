import { Router } from 'express';
import { asyncRoute } from '../lib/routeHelpers';
import { isAuthenticated, isApproved, getOrgId } from '../auth';
import { insertMarketingOutreachSchema } from '@shared/schema';
import { storage } from '../storage';

const router = Router();

// GET /api/marketing/outreach
router.get('/marketing/outreach', isAuthenticated, isApproved, asyncRoute(async (req: any, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(404).json({ message: 'No organization' });
  const records = await storage.getMarketingOutreach(orgId);
  res.json(records);
}));

// POST /api/marketing/outreach
router.post('/marketing/outreach', isAuthenticated, isApproved, asyncRoute(async (req: any, res) => {
  const orgId = getOrgId(req);
  const parsed = insertMarketingOutreachSchema.safeParse({ ...req.body, orgId });
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
  const record = await storage.createMarketingOutreach(parsed.data);
  res.json(record);
}));

export default router;
