/**
 * Manages the Python watershed segmentation service.
 * Spawns eagerly at server startup, keeps it alive, restarts on crash.
 */
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import http from 'http';

const SEG_PORT    = 5001;
const SCRIPT      = path.resolve('./server/services/segment_service.py');
const COLD_TIMEOUT = 300_000; // 5 min — production torch+torchvision cold-start can be slow
const WARM_TIMEOUT =  15_000; // 15 s  — restart after crash

let proc: ChildProcess | null = null;
let ready = false;
let startedAt = 0;

// ── Scan priority flag ──────────────────────────────────────────────────────
// Incremented when a Brickanalyzer scan starts processing, decremented when it
// finishes.  The CLIP catalog build checks this before each batch and yields
// the Python service to the live scan.
//
// COOLDOWN: After a scan ends, catalog build stays paused for another 30 seconds
// so back-to-back calibration shots don't let the catalog squeeze in between them.
const SCAN_COOLDOWN_MS = 30_000;
let _activeScanCount = 0;
let _lastScanEndedAt  = 0;
export function incrementActiveScan() { _activeScanCount++; }
export function decrementActiveScan() {
  _activeScanCount = Math.max(0, _activeScanCount - 1);
  if (_activeScanCount === 0) _lastScanEndedAt = Date.now();
}
export function isScanActive() {
  return _activeScanCount > 0 || (Date.now() - _lastScanEndedAt) < SCAN_COOLDOWN_MS;
}

export function startService() {
  if (proc) return;

  console.log('[SegClient] Starting Python segmentation service...');
  startedAt = Date.now();
  proc = spawn('python3', [SCRIPT, String(SEG_PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout?.on('data', (d: Buffer) => {
    d.toString().split('\n').forEach((line) => {
      line = line.trim();
      if (line) console.log(`[SegService] ${line}`);
      if (line.includes('Starting on port')) {
        ready = true;
        console.log(`[SegClient] Service ready in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      }
    });
  });

  proc.stderr?.on('data', (d: Buffer) => {
    d.toString().split('\n').forEach((line) => {
      line = line.trim();
      if (!line) return;
      // Flask prints startup info to stderr — use it as a ready signal too
      if (line.includes('Running on')) {
        ready = true;
        console.log(`[SegClient] Service ready (stderr signal) in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      }
      // Only log unexpected errors (suppress Flask's normal startup banner)
      if (!line.startsWith('WARNING') && !line.startsWith('Press') && !line.startsWith(' * ')) {
        console.error(`[SegService ERR] ${line}`);
      }
    });
  });

  proc.on('exit', (code) => {
    console.warn(`[SegClient] Python service exited (code=${code}) — will restart on next call`);
    proc  = null;
    ready = false;
  });
}

function waitReady(): Promise<void> {
  if (ready) return Promise.resolve();

  // Use longer timeout for cold starts (process hasn't been running long)
  const elapsed   = Date.now() - startedAt;
  const timeoutMs = elapsed < 5_000 ? COLD_TIMEOUT : WARM_TIMEOUT;

  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (ready) return resolve();
      if (Date.now() > deadline) {
        return reject(new Error(
          `Segmentation service failed to start after ${Math.round(timeoutMs / 1000)}s`
        ));
      }
      setTimeout(check, 300);
    };
    check();
  });
}

function postJson(urlPath: string, body: object, timeoutMs = 60_000): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1', port: SEG_PORT, path: urlPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`Bad JSON from seg service: ${data.slice(0, 200)}`)); }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Seg service request timed out')); });
    req.write(payload);
    req.end();
  });
}

export interface SegBox { x: number; y: number; w: number; h: number; }

export interface ScanSettings {
  // Shared
  segmenter?:       'contour';
  minSizePct?:      number;
  maxSizePct?:      number;
  maxPieces?:       number;
  minConfidence?:   number;
  // Watershed
  separation?:      number;
  sensitivity?:     number;
  // SAM
  pointsPerSide?:   number;
  iouThresh?:       number;
  stabilityThresh?: number;
  nmsThresh?:       number;
}

/**
 * Pre-download the SAM checkpoint and load the model into memory.
 * Called at startup so the first user scan doesn't have to wait.
 */
export function warmupSam(): void {
  (async () => {
    try {
      await waitReady();
      console.log('[SegClient] Pre-warming SAM model (downloading checkpoint if needed)...');
      const resp = await postJson('/warmup-sam', {}, 600_000); // 10 min — first-ever download
      if (resp.ok) console.log('[SegClient] SAM model warm and ready.');
      else console.warn('[SegClient] SAM warmup response:', resp);
    } catch (e: any) {
      console.warn('[SegClient] SAM warmup failed (model will load on first scan):', e.message);
    }
  })();
}

/**
 * Segment all LEGO pieces in an image buffer.
 * Returns bounding boxes as percentages of image dimensions.
 */
export async function segmentImage(imageBuffer: Buffer, settings?: ScanSettings): Promise<SegBox[]> {
  if (!proc) startService();
  await waitReady();

  // SAM needs much more time: model load + inference on CPU can take 2–3 minutes
  const isSam = (settings?.segmenter === 'sam');
  const timeoutMs = isSam ? 300_000 : 60_000; // 5 min for SAM, 1 min for watershed

  const b64  = imageBuffer.toString('base64');
  const resp = await postJson('/segment', { image: b64, settings: settings ?? {} }, timeoutMs);

  if (resp.error) throw new Error(`Seg service error: ${resp.error}`);
  return (resp.boxes || []) as SegBox[];
}

/**
 * Embed a cropped image buffer with CLIP ViT-B/32.
 * Returns a normalized 512-dimensional float array.
 * CLIP model is lazy-loaded on first call (~200ms on CPU after warmup).
 */
export async function embedCrop(imageBuffer: Buffer): Promise<number[]> {
  if (!proc) startService();
  await waitReady();
  const b64  = imageBuffer.toString('base64');
  const resp = await postJson('/embed', { image: b64 }, 120_000);
  if (resp.error) throw new Error(`CLIP embed error: ${resp.error}`);
  return resp.embedding as number[];
}

/**
 * Download an image from a URL and embed it with CLIP ViT-B/32.
 * Used for batch catalog embedding of BrickLink CDN reference images.
 */
export async function embedUrl(url: string): Promise<number[]> {
  if (!proc) startService();
  await waitReady();
  const resp = await postJson('/embed-url', { url }, 120_000);
  if (resp.error) throw new Error(`CLIP embed-url error: ${resp.error}`);
  return resp.embedding as number[];
}

/**
 * Pre-load CLIP ViT-B/32 into memory. Downloads weights (~338MB) on first call.
 * Call once at startup so scans don't pay the cold-start penalty.
 */
export function warmupClip(): void {
  (async () => {
    try {
      await waitReady();
      console.log('[SegClient] Pre-warming CLIP ViT-B/32...');
      const resp = await postJson('/warmup-clip', {}, 900_000); // 15 min — first ever download
      if (resp.ok) console.log('[SegClient] CLIP model warm and ready (512-dim).');
      else console.warn('[SegClient] CLIP warmup response:', resp);
    } catch (e: any) {
      console.warn('[SegClient] CLIP warmup failed (model will load on first scan):', e.message);
    }
  })();
}
