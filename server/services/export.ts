import { db } from '../db';
import { blInventory } from '@shared/schema';

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
    
    if (quantity > 0) {
      itemXml += `    <MINQTY>${quantity}</MINQTY>\n`;
    }
    
    if (condition) {
      itemXml += `    <CONDITION>${condition}</CONDITION>\n`;
    }
    
    if (price > 0) {
      itemXml += `    <PRICE>${price.toFixed(2)}</PRICE>\n`;
    }
    
    if (bulk > 1) {
      itemXml += `    <BULK>${bulk}</BULK>\n`;
    }
    
    if (saleRate > 0) {
      itemXml += `    <SALE>${saleRate}</SALE>\n`;
    }
    
    if (item.description) {
      const escapedDescription = escapeXml(item.description);
      itemXml += `    <COMMENTS>${escapedDescription}</COMMENTS>\n`;
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
