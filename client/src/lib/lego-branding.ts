/**
 * Utility functions for LEGO® trademark branding compliance
 * 
 * All product and color names must display the LEGO® trademark symbol
 * for brand compliance. These functions add the trademark at runtime.
 */

/**
 * Add LEGO® trademark to product names
 * Example: "Brick 2 x 4" → "LEGO® Brick 2 x 4"
 */
export function addLegoTrademark(productName: string | null | undefined): string {
  if (!productName) return '';
  
  // If the name already contains LEGO®, return as-is
  if (productName.includes('LEGO®')) {
    return productName;
  }
  
  // If the name already contains LEGO (without trademark), replace it
  if (productName.toUpperCase().includes('LEGO')) {
    return productName.replace(/LEGO/gi, 'LEGO®');
  }
  
  // Otherwise, prepend LEGO® to the product name
  return `LEGO® ${productName}`;
}

/**
 * Add LEGO® trademark to color names
 * Example: "Dark Bluish Gray" → "LEGO® Dark Bluish Gray"
 */
export function addLegoColorTrademark(colorName: string | null | undefined): string {
  if (!colorName) return '';
  
  // If the color already contains LEGO®, return as-is
  if (colorName.includes('LEGO®')) {
    return colorName;
  }
  
  // Prepend LEGO® to the color name
  return `LEGO® ${colorName}`;
}

/**
 * Format product display name for showroom
 * Combines product name with LEGO® trademark
 */
export function formatProductDisplayName(itemName: string | null | undefined): string {
  return addLegoTrademark(itemName);
}

/**
 * Format color display name for showroom
 * Combines color name with LEGO® trademark
 */
export function formatColorDisplayName(colorName: string | null | undefined): string {
  return addLegoColorTrademark(colorName);
}
