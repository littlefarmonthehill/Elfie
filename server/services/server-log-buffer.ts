/**
 * In-memory ring buffer for server-side WARN and ERROR log entries.
 * Intercepts console.warn and console.error globally so all services
 * are captured without modifying call sites.
 *
 * Deduplication: messages are normalized before fingerprinting so that
 * variable parts (UUIDs, timestamps, org IDs, line numbers, port numbers)
 * don't prevent identical errors from collapsing into a single counted entry.
 * The dedup window is 1 hour so persistent background errors group tightly.
 */

export type LogLevel = 'warn' | 'error';

export type LogEntry = {
  id: number;
  level: LogLevel;
  message: string;
  timestamp: Date;
  count: number;
};

const MAX_ENTRIES = 60;
const DEDUP_WINDOW_MS = 60 * 60 * 1000; // 1 hour

let _idSeq = 0;
const _buffer: LogEntry[] = [];

/**
 * Normalize a log message so that variable runtime values don't prevent
 * semantically identical messages from deduplicating.
 *
 * Strips (in order):
 *  1. ISO 8601 timestamps          e.g. 2024-01-15T12:34:56.789Z
 *  2. UUIDs (all variants)         e.g. 550e8400-e29b-41d4-a716-446655440000
 *  3. Hex sequences ≥8 chars       e.g. session tokens, short hashes
 *  4. Port numbers                 e.g. :5432  :3000
 *  5. Standalone integers ≥4 digits e.g. row counts, org IDs, request IDs
 *  6. Repeated whitespace
 */
function normalize(msg: string): string {
  return msg
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/g, '<ts>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/:\d{2,5}\b/g, ':<port>')
    .replace(/\b\d{4,}\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

function fingerprint(msg: string): string {
  return normalize(msg).slice(0, 160);
}

function push(level: LogLevel, msg: string): void {
  const fp = fingerprint(msg);
  const now = new Date();

  const existing = _buffer.findLast(
    e => e.level === level && fingerprint(e.message) === fp &&
         (now.getTime() - e.timestamp.getTime()) < DEDUP_WINDOW_MS
  );
  if (existing) {
    existing.count++;
    existing.timestamp = now;
    return;
  }

  _buffer.push({ id: ++_idSeq, level, message: msg.slice(0, 1000), timestamp: now, count: 1 });
  if (_buffer.length > MAX_ENTRIES) _buffer.shift();
}

export function getRecentLogs(limit = 40): LogEntry[] {
  return [..._buffer].reverse().slice(0, limit);
}

export function clearLogs(): void {
  _buffer.length = 0;
}

let _installed = false;

export function installLogInterceptor(): void {
  if (_installed) return;
  _installed = true;

  const _origWarn = console.warn.bind(console);
  const _origError = console.error.bind(console);

  console.warn = (...args: unknown[]) => {
    _origWarn(...args);
    push('warn', args.map(a => (typeof a === 'string' ? a : String(a))).join(' '));
  };

  console.error = (...args: unknown[]) => {
    _origError(...args);
    const msg = args.map(a => (typeof a === 'string' ? a : (a instanceof Error ? a.message : String(a)))).join(' ');
    push('error', msg);
  };
}
