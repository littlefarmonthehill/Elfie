import { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import multer from 'multer';
import { db } from '../db';
import { userImages, lotImages, itemTypeImages } from '@shared/schema';
import { isApproved } from '../auth';
import { asyncRoute, reqOrgId } from '../lib/routeHelpers';
import {
  uploadUserImage,
  deleteUserImage,
  assignImageToLot,
  assignImageToItemType,
  getImagesForLot,
  readFromStorage,
} from '../services/user-image-store';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const router = Router();
router.use(isApproved);

// POST /api/user-images/upload
router.post('/upload', upload.single('image'), asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  if (!req.file) return res.status(400).json({ error: 'No image file provided' });
  const record = await uploadUserImage({
    orgId,
    inputBuffer: req.file.buffer,
    altText: (req.body.altText as string) || null,
  });
  res.json(record);
}));

// GET /api/user-images/:id/img
router.get('/:id/img', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const [record] = await db.select().from(userImages)
    .where(and(eq(userImages.id, req.params.id), eq(userImages.orgId, orgId)))
    .limit(1);
  if (!record) return res.status(404).json({ error: 'Not found' });
  const bytes = await readFromStorage(record.storageKey);
  if (!bytes) return res.status(404).json({ error: 'Image bytes not found in storage' });
  res.set({
    'Content-Type': 'image/jpeg',
    'Content-Length': bytes.length,
    'Cache-Control': 'private, max-age=86400',
  });
  res.end(bytes);
}));

// GET /api/user-images/for-lot/:lotId
router.get('/for-lot/:lotId', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const blInventoryId = parseInt(req.params.lotId, 10);
  const { itemNo, itemType } = req.query as { itemNo?: string; itemType?: string };
  if (!itemNo || !itemType) return res.status(400).json({ error: 'itemNo and itemType are required' });
  const result = await getImagesForLot({ orgId, blInventoryId, itemNo, itemType });
  res.json(result);
}));

// POST /api/user-images/assign/lot
router.post('/assign/lot', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { imageId, blInventoryId, position } = req.body;
  if (!imageId || !blInventoryId) return res.status(400).json({ error: 'imageId and blInventoryId required' });
  const row = await assignImageToLot({ orgId, imageId, blInventoryId: parseInt(blInventoryId, 10), position: position ?? 0 });
  res.json(row);
}));

// POST /api/user-images/assign/item-type
router.post('/assign/item-type', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { imageId, itemNo, itemType, position } = req.body;
  if (!imageId || !itemNo || !itemType) return res.status(400).json({ error: 'imageId, itemNo, itemType required' });
  const row = await assignImageToItemType({ orgId, imageId, itemNo, itemType, position: position ?? 0 });
  res.json(row);
}));

// DELETE /api/user-images/lot-assignment/:id
router.delete('/lot-assignment/:id', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const assignmentId = parseInt(req.params.id, 10);
  const [row] = await db.select().from(lotImages).where(eq(lotImages.id, assignmentId)).limit(1);
  if (!row || row.orgId !== orgId) return res.status(404).json({ error: 'Not found' });
  await db.delete(lotImages).where(eq(lotImages.id, assignmentId));
  res.json({ ok: true });
}));

// DELETE /api/user-images/item-type-assignment/:id
router.delete('/item-type-assignment/:id', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const assignmentId = parseInt(req.params.id, 10);
  const [row] = await db.select().from(itemTypeImages).where(eq(itemTypeImages.id, assignmentId)).limit(1);
  if (!row || row.orgId !== orgId) return res.status(404).json({ error: 'Not found' });
  await db.delete(itemTypeImages).where(eq(itemTypeImages.id, assignmentId));
  res.json({ ok: true });
}));

// DELETE /api/user-images/:id
router.delete('/:id', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const ok = await deleteUserImage(req.params.id, orgId);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ ok: true });
}));

// PUT /api/user-images/lot-reorder
router.put('/lot-reorder', asyncRoute(async (req: any, res) => {
  const orgId = reqOrgId(req);
  const { blInventoryId, orderedAssignmentIds } = req.body as { blInventoryId: number; orderedAssignmentIds: number[] };
  if (!blInventoryId || !Array.isArray(orderedAssignmentIds)) {
    return res.status(400).json({ error: 'blInventoryId and orderedAssignmentIds required' });
  }
  await Promise.all(orderedAssignmentIds.map((id, pos) =>
    db.update(lotImages)
      .set({ position: pos })
      .where(and(eq(lotImages.id, id), eq(lotImages.orgId, orgId)))
  ));
  res.json({ ok: true });
}));

export default router;
