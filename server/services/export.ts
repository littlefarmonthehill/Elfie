import { db } from '../db';
import { blInventory } from '@shared/schema';
import { promises as fs } from 'fs';
import path from 'path';

const BACKUP_DIR = path.join(process.cwd(), 'backups', 'bricklink-xml');

/**
 * Ensure backup directory exists
 */
async function ensureBackupDir() {
  try {
    await fs.mkdir(BACKUP_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating backup directory:', error);
  }
}

/**
 * Generate BrickLink XML format from inventory
 * Format reference: https://www.bricklink.com/help.asp?helpID=207
 */
export async function generateBrickLinkXML(): Promise<string> {
  const inventory = await db.select().from(blInventory);

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
export async function generateInventoryCSV(): Promise<string> {
  const inventory = await db.select().from(blInventory);

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
    item.itemName || '',
    item.itemType,
    item.colorId || '',
    item.colorName || '',
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

/**
 * Save XML backup to disk (called automatically during inventory sync)
 */
export async function saveXMLBackup(): Promise<string> {
  await ensureBackupDir();
  
  const xml = await generateBrickLinkXML();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const filename = `bricklink-inventory-${timestamp}.xml`;
  const filepath = path.join(BACKUP_DIR, filename);
  
  await fs.writeFile(filepath, xml, 'utf-8');
  console.log(`✓ XML backup saved: ${filename}`);
  
  return filename;
}

/**
 * List all available XML backups
 */
export async function listXMLBackups(): Promise<Array<{ filename: string; timestamp: Date; size: number }>> {
  await ensureBackupDir();
  
  try {
    const files = await fs.readdir(BACKUP_DIR);
    const xmlFiles = files.filter(f => f.endsWith('.xml'));
    
    const backups = await Promise.all(
      xmlFiles.map(async (filename) => {
        const filepath = path.join(BACKUP_DIR, filename);
        const stats = await fs.stat(filepath);
        
        // Extract timestamp from filename: bricklink-inventory-2025-10-19T16-30-00.xml
        const timestampStr = filename.replace('bricklink-inventory-', '').replace('.xml', '');
        const timestamp = new Date(timestampStr.replace(/-/g, (match, offset) => {
          // Replace hyphens with colons for time part
          if (offset > 10) return ':';
          return match;
        }));
        
        return {
          filename,
          timestamp: stats.mtime, // Use file modification time as more reliable
          size: stats.size,
        };
      })
    );
    
    // Sort by timestamp, most recent first
    return backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  } catch (error) {
    console.error('Error listing XML backups:', error);
    return [];
  }
}

/**
 * Get specific XML backup file content
 */
export async function getXMLBackup(filename: string): Promise<string> {
  const filepath = path.join(BACKUP_DIR, filename);
  
  // Security check: ensure filename doesn't contain path traversal
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    throw new Error('Invalid filename');
  }
  
  try {
    const content = await fs.readFile(filepath, 'utf-8');
    return content;
  } catch (error) {
    console.error(`Error reading backup file ${filename}:`, error);
    throw new Error('Backup file not found');
  }
}
