/**
 * Manages the Python watershed segmentation service.
 * Spawns eagerly at server startup, keeps it alive, restarts on crash.
 */
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import http from 'http';

const SEG_PORT    = 5001;
const SCRIPT      = path.resolve('./server/services/segment_service.py');
const COLD_TIMEOUT = 120_000; // 2 min — scipy/cv2 imports are slow on first boot
const WARM_TIMEOUT =  15_000; // 15 s  — restart after crash

let proc: ChildProcess | null = null;
let ready = false;
let startedAt = 0;

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

function postJson(urlPath: string, body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        hostname: '127.0.0.1', port: SEG_PORT, path: urlPath, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
        timeout: 60_000,
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

/**
 * Segment all LEGO pieces in an image buffer.
 * Returns bounding boxes as percentages of image dimensions.
 */
export async function segmentImage(imageBuffer: Buffer): Promise<SegBox[]> {
  if (!proc) startService();
  await waitReady();

  const b64  = imageBuffer.toString('base64');
  const resp = await postJson('/segment', { image: b64 });

  if (resp.error) throw new Error(`Seg service error: ${resp.error}`);
  return (resp.boxes || []) as SegBox[];
}
