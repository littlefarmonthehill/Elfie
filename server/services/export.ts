import { db } from '../db';
import { blInventory, xmlBackups } from '@shared/schema';
import { eq, desc } from 'drizzle-orm';

/**
 * Generate BrickLink XML format from inventory
 * Format reference: https://www.bricklink.com/help.asp?helpID=207
 */
export async function generateBrickLinkXML(orgId?: string): Promise<string> {
  const inventory = orgId
    ? await db.select().from(blInventory).where(eq(blInventory.orgId, orgId))
    : await db.select().from(blInventory);

  const xmlItems = inventory.map(item => {
    const itemType = item.itemType?.charAt(0)?.toUpperCase() || 'P';
    const colorId = item.colorId || 0;
    const condition = item.newOrUsed === 'U' ? 'U' : 'N';
    const quantity = item.quantity || 1;
    const price = item.unitPrice ? parseFloat(item.unitPrice.toString()) : 0;
    const bulk = item.bulk || 1;
    const saleRate = item.saleRate || 0;

    let itemXml = `  <ITEM>\n`;
    itemXml += `    <ITEMTYPE>${itemType}</ITEMTYPE>\n`;
    itemXml += `    <ITEMID>${item.itemNo}</ITEMID>\n`;
    
    if (colorId !== null) {
      itemXml += `    <COLOR>${colorId}</COLOR>\n`;
    }
    
    itemXml += `    <QTY>${quantity}</QTY>\n`;
    
    if (condition) {
      itemXml += `    <CONDITION>${condition}</CONDITION>\n`;
    }
    
    if (price > 0) {
      itemXml += `    <PRICE>${price.toFixed(2)}</PRICE>\n`;
    }
    
    itemXml += `    <BULK>${bulk}</BULK>\n`;
    
    itemXml += `    <SALE>${saleRate}</SALE>\n`;
    
    if (item.description) {
      const escapedDescription = escapeXml(item.description);
      itemXml += `    <DESCRIPTION>${escapedDescription}</DESCRIPTION>\n`;
    }
    
    if (item.remarks) {
      const escapedRemarks = escapeXml(item.remarks);
      itemXml += `    <REMARKS>${escapedRemarks}</REMARKS>\n`;
    }
    
    itemXml += `  </ITEM>\n`;
    return itemXml;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<INVENTORY>\n${xmlItems.join('')}</INVENTORY>`;
  return xml;
}

/**
 * Generate CSV export for inventory
 */
export async function generateInventoryCSV(orgId?: string): Promise<string> {
  const inventory = orgId
    ? await db.select().from(blInventory).where(eq(blInventory.orgId, orgId))
    : await db.select().from(blInventory);

  const headers = [
    'ID',
    'Item No',
    'Item Name',
    'Item Type',
    'Color ID',
    'Color Name',
    'Quantity',
    'Condition',
    'Unit Price',
    'Description',
    'Remarks',
  ];

  const rows = inventory.map(item => [
    item.id,
    item.itemNo,
    (item as any).itemName || '',
    item.itemType,
    item.colorId || '',
    (item as any).colorName || '',
    item.quantity,
    item.newOrUsed,
    item.unitPrice || '',
    item.description || '',
    item.remarks || '',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(field => {
      const stringField = String(field);
      if (stringField.includes(',') || stringField.includes('"') || stringField.includes('\n')) {
        return `"${stringField.replace(/"/g, '""')}"`;
      }
      return stringField;
    }).join(','))
  ].join('\n');

  return csvContent;
}

/**
 * Escape special XML characters
 */
function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const MAX_BACKUPS_PER_ORG = 10;

/**
 * Save XML backup to the database (survives production deploys).
 */
export async function saveXMLBackup(orgId?: string): Promise<string> {
  const resolvedOrgId = orgId ?? 'default';
  const xml = await generateBrickLinkXML(orgId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const orgSuffix = orgId ? `-${orgId}` : '';
  const filename = `bricklink-inventory${orgSuffix}-${timestamp}.xml`;
  const sizeBytes = Buffer.byteLength(xml, 'utf-8');

  await db.insert(xmlBackups).values({
    orgId: resolvedOrgId,
    filename,
    content: xml,
    sizeBytes,
  });

  // Prune oldest backups beyond the keep limit
  const all = await db.select({ id: xmlBackups.id })
    .from(xmlBackups)
    .where(eq(xmlBackups.orgId, resolvedOrgId))
    .orderBy(desc(xmlBackups.createdAt));

  if (all.length > MAX_BACKUPS_PER_ORG) {
    const idsToDelete = all.slice(MAX_BACKUPS_PER_ORG).map(r => r.id);
    for (const id of idsToDelete) {
      await db.delete(xmlBackups).where(eq(xmlBackups.id, id));
    }
  }

  console.log(`✓ XML backup saved to DB: ${filename} (${(sizeBytes / 1024 / 1024).toFixed(2)} MB)`);
  return filename;
}

/**
 * List available XML backups for an org, most recent first.
 */
export async function listXMLBackups(orgId?: string): Promise<Array<{ filename: string; timestamp: Date; size: number }>> {
  try {
    // Select metadata only — never pull the `content` column on a listing call.
    // Full XML blobs accumulate quickly and a SELECT * would hit the response size limit.
    const cols = {
      id: xmlBackups.id,
      filename: xmlBackups.filename,
      createdAt: xmlBackups.createdAt,
      sizeBytes: xmlBackups.sizeBytes,
      orgId: xmlBackups.orgId,
    };
    const query = orgId
      ? db.select(cols).from(xmlBackups).where(eq(xmlBackups.orgId, orgId)).orderBy(desc(xmlBackups.createdAt))
      : db.select(cols).from(xmlBackups).orderBy(desc(xmlBackups.createdAt));

    const rows = await query;
    return rows.map(r => ({
      filename: r.filename,
      timestamp: r.createdAt,
      size: r.sizeBytes,
    }));
  } catch (error) {
    console.error('Error listing XML backups:', error);
    return [];
  }
}

/**
 * Retrieve a specific XML backup's content by filename.
 */
export async function getXMLBackup(filename: string): Promise<string> {
  // Security check: ensure filename doesn't contain path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Invalid filename');
  }

  const [row] = await db.select().from(xmlBackups).where(eq(xmlBackups.filename, filename)).limit(1);
  if (!row) {
    throw new Error('Backup file not found');
  }
  return row.content;
}
