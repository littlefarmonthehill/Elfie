/**
 * In-memory ring buffer for server-side WARN and ERROR log entries.
 * Intercepts console.warn and console.error globally so all services
 * are captured without modifying call sites.
 *
 * Deduplication: if the same message fingerprint (first 120 chars) arrives
 * within 10 minutes of the previous occurrence, only the count is incremented.
 * This prevents a single runaway error from flooding the display.
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
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

let _idSeq = 0;
const _buffer: LogEntry[] = [];

function fingerprint(msg: string): string {
  return msg.slice(0, 120).replace(/\s+/g, ' ').trim();
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
