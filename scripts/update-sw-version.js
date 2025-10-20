import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const swPath = join(__dirname, '../client/public/service-worker.js');

// Read the service worker file
let content = readFileSync(swPath, 'utf8');

// Generate a unique version based on timestamp
const version = Date.now();

// Replace the CACHE_VERSION line
content = content.replace(
  /const CACHE_VERSION = \d+;/,
  `const CACHE_VERSION = ${version};`
);

// Write back to file
writeFileSync(swPath, content, 'utf8');

console.log(`✅ Service worker cache version updated to: ${version}`);
