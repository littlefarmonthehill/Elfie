import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const swPath = join(__dirname, '../client/public/service-worker.js');

let content = readFileSync(swPath, 'utf8');

const now = new Date();
const version = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}.${Math.floor(now.getTime() / 1000) % 100000}`;

content = content.replace(
  /const CACHE_VERSION = ['"][^'"]+['"];/,
  `const CACHE_VERSION = '${version}';`
);

writeFileSync(swPath, content, 'utf8');

console.log(`Service worker cache version updated to: ${version}`);
