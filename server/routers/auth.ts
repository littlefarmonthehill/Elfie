import { Router } from 'express';
import { asyncRoute } from '../lib/routeHelpers';
import { isAuthenticated } from '../auth';
import { db } from '../db';
import { users, plans } from '@shared/schema';
import { eq, and, asc } from 'drizzle-orm';
import { storage } from '../storage';

const router = Router();

// GET /api/auth/user — authenticated but may not be approved
router.get('/auth/user', isAuthenticated, asyncRoute(async (req: any, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  const freshUser = await storage.getUser(userId);
  if (!freshUser) return res.status(401).json({ message: 'User not found' });
  const { password: _pw, ...safeUser } = freshUser as any;
  // "View as regular user" preview: report the EFFECTIVE super-admin status
  const previewAsUser = !!req.session?.previewAsUser;
  const actualSuperAdmin = !!safeUser.superAdmin;
  res.json({
    ...safeUser,
    superAdmin: previewAsUser ? false : actualSuperAdmin,
    actualSuperAdmin,
    previewAsUser,
  });
}));

// POST /api/auth/preview-mode — super admins toggle "view as regular user"
router.post('/auth/preview-mode', isAuthenticated, asyncRoute(async (req: any, res) => {
  const userId = req.user?.id;
  const dbUser = userId ? await storage.getUser(userId) : null;
  if (!dbUser?.superAdmin) return res.status(403).json({ message: 'Super admin access required' });
  const enabled = req.body?.enabled === true;
  req.session.previewAsUser = enabled;
  req.session.save((err: any) => {
    if (err) {
      console.error('Error saving preview mode:', err);
      return res.status(500).json({ message: 'Failed to update preview mode' });
    }
    res.json({ previewAsUser: enabled });
  });
}));

// PATCH /api/auth/preferences — save per-user UI preferences
router.patch('/auth/preferences', isAuthenticated, asyncRoute(async (req: any, res) => {
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ message: 'Unauthorized' });
  const { heatmapCondition, heatmapSource, heatmapMetric } = req.body;
  const update: Record<string, string> = {};
  if (heatmapCondition === 'new' || heatmapCondition === 'used') update.heatmapCondition = heatmapCondition;
  if (heatmapSource === 'peak' || heatmapSource === 'sold' || heatmapSource === 'listed') update.heatmapSource = heatmapSource;
  if (heatmapMetric === 'max' || heatmapMetric === 'avg') update.heatmapMetric = heatmapMetric;
  if (Object.keys(update).length === 0) return res.json({ success: true });
  await db.update(users).set({ ...update, updatedAt: new Date() }).where(eq(users.id, userId));
  res.json({ success: true });
}));

// GET /api/public/plans — unauthenticated endpoint for landing page
router.get('/public/plans', asyncRoute(async (_req, res) => {
  const livePlans = await db
    .select()
    .from(plans)
    .where(and(eq(plans.status, 'live'), eq(plans.isPublic, true)))
    .orderBy(asc(plans.basePrice));
  res.json(livePlans);
}));

// GET /api/plans — live + public plans for subscription self-selection
router.get('/plans', isAuthenticated, asyncRoute(async (_req, res) => {
  const activePlans = await db
    .select()
    .from(plans)
    .where(and(eq(plans.status, 'live'), eq(plans.isPublic, true)))
    .orderBy(asc(plans.id));
  res.json(activePlans);
}));

export default router;
