import { Router } from 'express';
import { z } from 'zod';
import { asyncRoute, reqOrgId } from '../lib/routeHelpers';
import { isApproved, getOrgId } from '../auth';
import { db } from '../db';
import { users, organizations } from '@shared/schema';
import { eq, sql, and, or } from 'drizzle-orm';
import { storage } from '../storage';
import { sendApprovalEmail } from '../email';

const router = Router();

// GET /api/admin/organizations — list all orgs with user count
router.get('/admin/organizations', isApproved, asyncRoute(async (req: any, res) => {
  const user = req.user as any;
  if (user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
  const orgs = await storage.getAllOrganizations();
  const counts = await db
    .select({ orgId: users.orgId, count: sql<number>`count(*)::int` })
    .from(users)
    .groupBy(users.orgId);
  const countMap = new Map(counts.map(r => [r.orgId, r.count]));
  const result = orgs.map(o => ({ ...o, userCount: countMap.get(o.id) ?? 0 }));
  res.json(result);
}));

// PATCH /api/admin/organizations/:id — admin update plan or deactivate
router.patch('/admin/organizations/:id', isApproved, asyncRoute(async (req: any, res) => {
  const user = req.user as any;
  if (user.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
  const { id } = req.params;
  const update: Record<string, any> = {};
  if (req.body.plan && ['free', 'pro', 'enterprise'].includes(req.body.plan)) update.plan = req.body.plan;
  if (typeof req.body.isActive === 'boolean') update.isActive = req.body.isActive;
  if (req.body.name && typeof req.body.name === 'string') update.name = req.body.name.trim();
  if (Object.keys(update).length === 0) return res.status(400).json({ message: 'No valid fields to update' });
  const org = await storage.updateOrganization(id, update);
  if (!org) return res.status(404).json({ message: 'Organization not found' });
  res.json(org);
}));

// GET /api/admin/users
router.get('/admin/users', isApproved, asyncRoute(async (req: any, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
  const orgId = reqOrgId(req);
  const allUsers = await storage.getAllUsers();
  res.json(allUsers.filter(u => u.orgId === orgId));
}));

// PATCH /api/admin/users/:id/approval
router.patch('/admin/users/:id/approval', isApproved, asyncRoute(async (req: any, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
  const { id } = req.params;
  const { isApproved: approved } = req.body;
  const orgId = reqOrgId(req);
  const targetUser = await storage.getUser(id);
  if (!targetUser || targetUser.orgId !== orgId) return res.status(404).json({ message: 'User not found' });
  const approvalSchema = z.object({ isApproved: z.boolean() });
  const validation = approvalSchema.safeParse({ isApproved: approved });
  if (!validation.success) return res.status(400).json({ message: 'Invalid approval status. Must be boolean' });
  const updatedUser = await storage.updateUserApproval(id, approved);
  if (!updatedUser) return res.status(404).json({ message: 'User not found' });
  if (approved && updatedUser.email && process.env.RESEND_API_KEY) {
    try {
      const displayName = updatedUser.firstName || updatedUser.email.split('@')[0];
      let orgName = 'your organization';
      if (updatedUser.orgId) {
        const org = await storage.getOrganization(updatedUser.orgId);
        if (org?.name) orgName = org.name;
      }
      const baseUrl = process.env.REPLIT_DOMAINS
        ? `https://${process.env.REPLIT_DOMAINS.split(',')[0].trim()}`
        : `http://localhost:${process.env.PORT || 5000}`;
      await sendApprovalEmail(updatedUser.email, displayName, orgName, `${baseUrl}/login`);
    } catch (emailErr) {
      console.error('[Approval] Failed to send approval email:', emailErr);
    }
  }
  res.json(updatedUser);
}));

// PATCH /api/admin/users/:id/role
router.patch('/admin/users/:id/role', isApproved, asyncRoute(async (req: any, res) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });
  const { id } = req.params;
  const { role } = req.body;
  const orgId = reqOrgId(req);
  const targetUserCheck = await storage.getUser(id);
  if (!targetUserCheck || targetUserCheck.orgId !== orgId) return res.status(404).json({ message: 'User not found' });
  const roleSchema = z.object({ role: z.enum(['customer', 'employee', 'admin']) });
  const validation = roleSchema.safeParse({ role });
  if (!validation.success) return res.status(400).json({ message: 'Invalid role. Must be customer, employee, or admin' });
  if (role !== 'admin') {
    const allUsers = await storage.getAllUsers();
    const targetUser = allUsers.find(u => u.id === id && u.orgId === orgId);
    if (targetUser?.role === 'admin') {
      const otherAdmins = allUsers.filter(u => u.id !== id && u.orgId === orgId && u.role === 'admin' && u.isApproved);
      if (otherAdmins.length === 0) {
        return res.status(400).json({ message: 'Cannot remove the last admin. Promote another user to Admin first.' });
      }
    }
  }
  const updatedUser = await storage.updateUserRole(id, role);
  if (!updatedUser) return res.status(404).json({ message: 'User not found' });
  res.json(updatedUser);
}));

// POST /api/admin/users — create a new user in the org
router.post('/admin/users', isApproved, asyncRoute(async (req: any, res) => {
  const orgId = getOrgId(req);
  if (!orgId) return res.status(403).json({ message: 'No organization' });
  const { email, firstName, lastName, role } = req.body;
  if (!email || typeof email !== 'string') return res.status(400).json({ message: 'Email is required' });
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await storage.getUserByEmail(normalizedEmail);
  if (existing) return res.status(400).json({ message: 'A user with this email already exists' });
  const bcrypt = await import('bcryptjs');
  const tempPassword = Math.random().toString(36).slice(-10) + 'A1!';
  const hashedPassword = await bcrypt.hash(tempPassword, 10);
  const user = await storage.createUser({
    email: normalizedEmail,
    password: hashedPassword,
    firstName: firstName || null,
    lastName: lastName || null,
    isApproved: true,
    role: role || 'employee',
    orgId,
    orgRole: null,
    superAdmin: false,
  });
  res.json({ ...user, tempPassword });
}));

// POST /api/admin/backfill-bo-bl-links — one-time repair tool
router.post('/admin/backfill-bo-bl-links', isApproved, asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { getBrickOwlInventory } = await import('../services/brickowl');
  const boInventory = await getBrickOwlInventory(false, orgId);
  const boLotToBlInvId = new Map<string, number>();
  for (const lot of boInventory) {
    const blInvIdStr = lot.external_lot_ids?.other;
    if (blInvIdStr && lot.lot_id) {
      const parsed = parseInt(blInvIdStr, 10);
      if (!isNaN(parsed)) boLotToBlInvId.set(String(lot.lot_id), parsed);
    }
  }
  const brokenRows = await db.execute(sql`
    SELECT od.id, od.order_id, od.line_item_key, od.sku, od.bricklink_inventory_id
    FROM order_details od
    JOIN orders o ON o.id = od.order_id
    WHERE o.marketplace = 'BrickOwl'
      AND (
        od.bricklink_inventory_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM bl_inventory bi WHERE bi.id = od.bricklink_inventory_id
        )
      )
  `);
  let fixed = 0;
  const failures: string[] = [];
  for (const row of (brokenRows as any).rows) {
    const key: string = row.line_item_key || '';
    const dashIdx = key.indexOf('-');
    const boLotId = dashIdx >= 0 ? key.slice(dashIdx + 1) : null;
    if (!boLotId) { failures.push(`id=${row.id}: cannot extract lot from key '${key}'`); continue; }
    const blInvId = boLotToBlInvId.get(boLotId);
    if (!blInvId) { failures.push(`id=${row.id}: BO lot ${boLotId} not found in live inventory`); continue; }
    await db.execute(sql`
      UPDATE order_details
      SET bricklink_inventory_id = ${blInvId}, sku = ${String(blInvId)}, color_id = NULL, condition = NULL
      WHERE id = ${row.id}
    `);
    fixed++;
  }
  console.log(`[Admin] backfill-bo-bl-links: ${fixed} rows fixed, ${failures.length} could not be resolved`);
  res.json({ ok: true, inventoryLotsInMap: boLotToBlInvId.size, brokenFound: (brokenRows as any).rows.length, fixed, failures });
}));

// POST /api/admin/cleanup-duplicate-picklist-items
router.post('/admin/cleanup-duplicate-picklist-items', isApproved, asyncRoute(async (_req, res) => {
  const result = await db.execute(sql`
    DELETE FROM picklist_items
    WHERE id IN (
      SELECT id FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY order_detail_id
                 ORDER BY pulled DESC, created_at ASC
               ) AS rn
        FROM picklist_items
      ) ranked
      WHERE rn > 1
    )
  `);
  const deleted = (result as any).rowCount ?? 0;
  console.log(`[Admin] cleanup-duplicate-picklist-items: removed ${deleted} duplicate rows`);
  res.json({ ok: true, deleted });
}));

// POST /api/admin/fix-bo-visibility — set a specific BO lot invisible by BL inventory ID
router.post('/admin/fix-bo-visibility', isApproved, asyncRoute(async (req: any, res) => {
  const { blInventoryId, forSale = 0 } = req.body;
  if (!blInventoryId) return res.status(400).json({ error: 'blInventoryId required' });
  const orgId = reqOrgId(req);
  const { getBrickOwlInventory, updateBrickOwlLot } = await import('../services/brickowl');
  const inventory = await getBrickOwlInventory(false, orgId);
  const lot = inventory.find((l: any) => l.external_lot_ids?.other === String(blInventoryId));
  if (!lot) return res.status(404).json({ error: `No BrickOwl lot found tagged with BL inv ID ${blInventoryId}` });
  const updateResult = await updateBrickOwlLot({ lot_id: lot.lot_id, for_sale: forSale }, orgId);
  console.log(`[Admin] fix-bo-visibility: BL inv ${blInventoryId} → BO lot ${lot.lot_id} set for_sale=${forSale}`);
  res.json({ ok: true, boLotId: lot.lot_id, blInventoryId, forSale, updateResult });
}));

// GET /api/admin/cleanup-old-orders
router.get('/admin/cleanup-old-orders', isApproved, asyncRoute(async (req: any, res) => {
  const beforeDate = req.query.before
    ? new Date(req.query.before as string)
    : new Date(Date.now() - 365 * 2 * 24 * 60 * 60 * 1000);
  const beforeStr = beforeDate.toISOString().split('T')[0];
  const targets = await db.execute(sql.raw(
    `SELECT id, order_number, order_status, order_date FROM orders
     WHERE order_status IN ('awaiting_payment','awaiting_shipment','awaiting_fulfillment','pending')
       AND (order_date IS NULL OR order_date < '${beforeStr}')
     ORDER BY order_date ASC`
  ));
  const rows = targets.rows as any[];
  const ids = rows.map((r: any) => r.id);
  if (ids.length === 0) return res.json({ deleted: 0, before: beforeStr, message: 'Nothing to clean up' });
  const idList = ids.map((id: string) => `'${id}'`).join(',');
  const d1 = await db.execute(sql.raw(`DELETE FROM order_details WHERE order_id IN (${idList})`));
  const d2 = await db.execute(sql.raw(`DELETE FROM order_adjustments WHERE order_id IN (${idList})`));
  const d3 = await db.execute(sql.raw(`DELETE FROM picklist_items WHERE order_id IN (${idList})`));
  await db.execute(sql.raw(`DELETE FROM orders WHERE id IN (${idList})`));
  res.json({
    deleted: ids.length,
    before: beforeStr,
    orders: rows.map((r: any) => ({ id: r.id, orderNumber: r.order_number, status: r.order_status, date: r.order_date })),
    detailsDeleted: (d1 as any).rowCount,
    adjustmentsDeleted: (d2 as any).rowCount,
    picklistDeleted: (d3 as any).rowCount,
  });
}));

export default router;
