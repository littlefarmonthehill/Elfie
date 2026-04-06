/**
 * Print Service
 *
 * Handles direct label printing via raw TCP (ZPL to Zebra/similar printers)
 * and test print generation.
 */

import * as net from 'net';

/**
 * Send ZPL content to a raw TCP printer (port 9100 by default).
 * Works with Zebra, Rollo, and any printer that accepts raw ZPL over TCP.
 */
export function sendZplToPrinter(
  ip: string,
  port: number,
  zplContent: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const TIMEOUT_MS = 8000;

    const cleanup = () => {
      try { socket.destroy(); } catch {}
    };

    socket.setTimeout(TIMEOUT_MS);

    socket.on('timeout', () => {
      cleanup();
      reject(new Error(`Printer connection timed out after ${TIMEOUT_MS / 1000}s — check IP and port`));
    });

    socket.on('error', (err) => {
      cleanup();
      reject(new Error(`Could not reach printer at ${ip}:${port} — ${err.message}`));
    });

    socket.connect(port, ip, () => {
      socket.write(Buffer.from(zplContent, 'utf8'), (writeErr) => {
        if (writeErr) {
          cleanup();
          reject(new Error(`Failed to send ZPL to printer: ${writeErr.message}`));
          return;
        }
        // Small drain delay so the printer processes the stream before disconnect
        setTimeout(() => {
          socket.end(() => {
            socket.destroy();
            resolve();
          });
        }, 200);
      });
    });
  });
}

/**
 * Fetch ZPL content from a URL (e.g. EasyPost label URL when format=ZPL).
 */
export async function fetchZplFromUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ZPL from ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/**
 * Build a simple test ZPL page for 4×6 or 2×7 labels.
 * Useful for verifying printer connectivity and label alignment.
 */
export function buildTestZpl(labelSize: '4x6' | '2x7' = '4x6'): string {
  const [w, h] = labelSize === '2x7' ? [200, 700] : [400, 600];
  return [
    '^XA',
    `^PW${w * 8}`,
    `^LL${h * 8}`,
    '^FO60,80^A0N,60,60^FDTEST PRINT^FS',
    '^FO60,180^A0N,36,36^FDE.L.F.I.E. Label Printer^FS',
    '^FO60,240^A0N,28,28^FDIf you can read this, your printer^FS',
    '^FO60,280^A0N,28,28^FDis correctly configured.^FS',
    `^FO60,340^A0N,24,24^FDLabel size: ${labelSize}^FS`,
    '^FO60,400^BY2,3,60^BCN,,Y,N^FD123456789^FS',
    '^XZ',
  ].join('\n');
}
