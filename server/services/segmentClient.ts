/**
 * Manages the Python watershed segmentation service.
 * Spawns it on first use, keeps it alive, restarts on crash.
 */
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import http from 'http';

const SEG_PORT = 5001;
const SCRIPT   = path.resolve('./server/services/segment_service.py');

let proc: ChildProcess | null = null;
let ready = false;

function startService() {
  if (proc) return;

  console.log('[SegClient] Starting Python segmentation service...');
  proc = spawn('python3', [SCRIPT, String(SEG_PORT)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout?.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line) console.log(`[SegService] ${line}`);
    if (line.includes('Starting on port')) ready = true;
  });

  proc.stderr?.on('data', (d: Buffer) => {
    const line = d.toString().trim();
    if (line) console.error(`[SegService ERR] ${line}`);
    if (line.includes('Running on')) ready = true;
  });

  proc.on('exit', (code) => {
    console.warn(`[SegClient] Python service exited (code=${code}) — will restart on next call`);
    proc  = null;
    ready = false;
  });
}

function waitReady(timeoutMs = 10_000): Promise<void> {
  if (ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (ready) return resolve();
      if (Date.now() > deadline) return reject(new Error('Segmentation service failed to start'));
      setTimeout(check, 200);
    };
    check();
  });
}

function postJson(path: string, body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request(
      { hostname: '127.0.0.1', port: SEG_PORT, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
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
