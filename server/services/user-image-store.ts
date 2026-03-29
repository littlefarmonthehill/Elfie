/**
 * User Image Store — processes, stores, and retrieves user-owned images.
 *
 * Pipeline on ingest:
 *   raw bytes → Sharp resize (max 2000px, JPEG 85%) → object storage → DB record
 *
 * Scope rules:
 *   scope='user'    → uploaded by the operator; may be pushed to any channel.
 *   scope='catalog' → sourced from BL/BO catalog; must NOT be used on other channels.
 *
 * Resolution order for a lot:
 *   lot-level user images → item-type user images → (catalog images handled separately)
 */

import sharp from 'sharp';
import { randomUUID } from 'crypto';
import { objectStorageClient } from '../replit_integrations/object_storage/objectStorage';
import { db } from '../db';
import { userImages, lotImages, itemTypeImages } from '@shared/schema';
import { eq, and, asc } from 'drizzle-orm';

// ── Object storage helpers ─────────────────────────────────────────────────────

function getBucketConfig(): { bucketName: string; baseDir: string } | null {
  const raw = process.env.PUBLIC_OBJECT_SEARCH_PATHS ?? '';
  const first = raw.split(',').map(p => p.trim()).find(p => p.length > 0);
  if (!first) return null;
  const parts = first.replace(/^\//, '').split('/');
  if (parts.length < 1 || !parts[0]) return null;
  return { bucketName: parts[0], baseDir: parts.slice(1).join('/') || 'public' };
}

function buildStorageKey(orgId: string, uuid: string): string {
  return `user-images/${orgId}/${uuid}.jpg`;
}

async function writeToStorage(key: string, buffer: Buffer): Promise<boolean> {
  const cfg = getBucketConfig();
  if (!cfg) return false;
  try {
    const objectName = `${cfg.baseDir}/${key}`;
    const bucket = objectStorageClient.bucket(cfg.bucketName);
    await bucket.file(objectName).save(buffer, { contentType: 'image/jpeg', resumable: false });
    return true;
  } catch (err: any) {
    console.warn(`[UserImageStore] Write error for ${key}:`, err.message);
    return false;
  }
}

export async function readFromStorage(key: string): Promise<Buffer | null> {
  const cfg = getBucketConfig();
  if (!cfg) return null;
  try {
    const objectName = `${cfg.baseDir}/${key}`;
    const bucket = objectStorageClient.bucket(cfg.bucketName);
    const file = bucket.file(objectName);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [content] = await file.download();
    return content as Buffer;
  } catch (err: any) {
    console.warn(`[UserImageStore] Read error for ${key}:`, err.message);
    return null;
  }
}

async function deleteFromStorage(key: string): Promise<void> {
  const cfg = getBucketConfig();
  if (!cfg) return;
  try {
    const objectName = `${cfg.baseDir}/${key}`;
    await objectStorageClient.bucket(cfg.bucketName).file(objectName).delete({ ignoreNotFound: true });
  } catch (err: any) {
    console.warn(`[UserImageStore] Delete error for ${key}:`, err.message);
  }
}

// ── Image processing ───────────────────────────────────────────────────────────

/**
 * Process raw image bytes through Sharp.
 * Resizes to max 2000px on the longest edge, converts to JPEG at 85% quality.
 * Originals are discarded — only the processed version is stored.
 */
export async function processImage(inputBuffer: Buffer): Promise<{
  buffer: Buffer;
  widthPx: number;
  heightPx: number;
  fileSizeKb: number;
}> {
  const buffer = await sharp(inputBuffer)
    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, progressive: true })
    .toBuffer();

  const meta = await sharp(buffer).metadata();

  return {
    buffer,
    widthPx: meta.width ?? 0,
    heightPx: meta.height ?? 0,
    fileSizeKb: Math.ceil(buffer.length / 1024),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Upload, process, and store a new user image.
 * Returns the created user_images row.
 */
export async function uploadUserImage(opts: {
  orgId: string;
  inputBuffer: Buffer;
  sourceChannel?: string;
  sourceUrl?: string;
  altText?: string;
}): Promise<typeof userImages.$inferSelect> {
  const uuid = randomUUID();
  const storageKey = buildStorageKey(opts.orgId, uuid);

  const { buffer, widthPx, heightPx, fileSizeKb } = await processImage(opts.inputBuffer);

  const stored = await writeToStorage(storageKey, buffer);
  if (!stored) throw new Error('Failed to store image — object storage unavailable');

  const [record] = await db.insert(userImages).values({
    id: uuid,
    orgId: opts.orgId,
    storageKey,
    scope: 'user',
    sourceChannel: opts.sourceChannel ?? 'local',
    sourceUrl: opts.sourceUrl ?? null,
    altText: opts.altText ?? null,
    widthPx,
    heightPx,
    fileSizeKb,
  }).returning();

  return record;
}

/**
 * Permanently delete a user image: removes the object-storage bytes,
 * all lot/item-type assignments, and the DB record.
 */
export async function deleteUserImage(imageId: string, orgId: string): Promise<boolean> {
  const [record] = await db
    .select()
    .from(userImages)
    .where(and(eq(userImages.id, imageId), eq(userImages.orgId, orgId)))
    .limit(1);

  if (!record) return false;

  await Promise.all([
    db.delete(lotImages).where(eq(lotImages.imageId, imageId)),
    db.delete(itemTypeImages).where(eq(itemTypeImages.imageId, imageId)),
  ]);
  await db.delete(userImages).where(eq(userImages.id, imageId));
  await deleteFromStorage(record.storageKey);
  return true;
}

/**
 * Assign an image to a specific lot (lot-level override).
 * Returns the new lot_images row.
 */
export async function assignImageToLot(opts: {
  orgId: string;
  blInventoryId: number;
  imageId: string;
  position?: number;
}): Promise<typeof lotImages.$inferSelect> {
  const [row] = await db.insert(lotImages).values({
    orgId: opts.orgId,
    blInventoryId: opts.blInventoryId,
    imageId: opts.imageId,
    position: opts.position ?? 0,
  }).returning();
  return row;
}

/**
 * Assign an image to all lots of a given item type (item-type default).
 * Returns the new item_type_images row.
 */
export async function assignImageToItemType(opts: {
  orgId: string;
  itemNo: string;
  itemType: string;
  imageId: string;
  position?: number;
}): Promise<typeof itemTypeImages.$inferSelect> {
  const [row] = await db.insert(itemTypeImages).values({
    orgId: opts.orgId,
    itemNo: opts.itemNo,
    itemType: opts.itemType,
    imageId: opts.imageId,
    position: opts.position ?? 0,
  }).returning();
  return row;
}

export type ResolvedImage = {
  id: string;
  storageKey: string;
  scope: string;
  sourceChannel: string;
  altText: string | null;
  widthPx: number | null;
  heightPx: number | null;
  fileSizeKb: number | null;
  createdAt: Date;
  assignmentId: number;
  position: number;
  level: 'lot' | 'item_type';
};

/**
 * Resolve images for a lot with item-type fallback.
 * Only 'user'-scoped images are returned (catalog images are excluded — legal requirement).
 * targetChannel is reserved for future per-channel scope filtering.
 */
export async function getImagesForLot(opts: {
  orgId: string;
  blInventoryId: number;
  itemNo: string;
  itemType: string;
}): Promise<{ lotLevel: ResolvedImage[]; itemTypeLevel: ResolvedImage[] }> {
  const cols = {
    id: userImages.id,
    storageKey: userImages.storageKey,
    scope: userImages.scope,
    sourceChannel: userImages.sourceChannel,
    altText: userImages.altText,
    widthPx: userImages.widthPx,
    heightPx: userImages.heightPx,
    fileSizeKb: userImages.fileSizeKb,
    createdAt: userImages.createdAt,
  };

  const lotRows = await db
    .select({ ...cols, assignmentId: lotImages.id, position: lotImages.position })
    .from(lotImages)
    .innerJoin(userImages, eq(lotImages.imageId, userImages.id))
    .where(and(
      eq(lotImages.orgId, opts.orgId),
      eq(lotImages.blInventoryId, opts.blInventoryId),
      eq(userImages.scope, 'user'),
    ))
    .orderBy(asc(lotImages.position), asc(lotImages.createdAt));

  const typeRows = await db
    .select({ ...cols, assignmentId: itemTypeImages.id, position: itemTypeImages.position })
    .from(itemTypeImages)
    .innerJoin(userImages, eq(itemTypeImages.imageId, userImages.id))
    .where(and(
      eq(itemTypeImages.orgId, opts.orgId),
      eq(itemTypeImages.itemNo, opts.itemNo),
      eq(itemTypeImages.itemType, opts.itemType),
      eq(userImages.scope, 'user'),
    ))
    .orderBy(asc(itemTypeImages.position), asc(itemTypeImages.createdAt));

  return {
    lotLevel: lotRows.map(r => ({ ...r, level: 'lot' as const })),
    itemTypeLevel: typeRows.map(r => ({ ...r, level: 'item_type' as const })),
  };
}
