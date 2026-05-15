/**
 * In-memory tracker for fatal OpenAI errors (quota / auth / persistent rate
 * limit) so dashboards can surface when AI features are degraded without each
 * caller having to hit the OpenAI API itself.
 *
 * Call sites record success / failure; consumers read a snapshot via
 * `getOpenAIHealth()`. State is process-local and resets on restart — that's
 * fine for surfacing a "something is broken right now" banner.
 */

type ErrorKind = 'quota' | 'auth' | 'rate_limit' | 'other';

interface HealthState {
  lastErrorAt: number | null;
  lastErrorKind: ErrorKind | null;
  lastErrorMessage: string | null;
  lastSuccessAt: number | null;
}

const state: HealthState = {
  lastErrorAt: null,
  lastErrorKind: null,
  lastErrorMessage: null,
  lastSuccessAt: null,
};

// Errors older than this are considered stale and won't be surfaced.
const STALENESS_MS = 30 * 60 * 1000;

function classify(err: any): ErrorKind | null {
  const status = err?.status ?? err?.response?.status;
  const code = String(err?.code ?? err?.error?.code ?? '');
  const type = String(err?.type ?? err?.error?.type ?? '');
  const msg = String(err?.message || err?.error?.message || '');
  // Quota — check explicit SDK fields first, then status+message.
  if (code === 'insufficient_quota' || type === 'insufficient_quota') return 'quota';
  if (/quota|insufficient_quota|exceeded your current quota/i.test(msg)) return 'quota';
  // Auth — invalid / missing / revoked key.
  if (status === 401 || status === 403) return 'auth';
  if (code === 'invalid_api_key' || /invalid_api_key/i.test(msg)) return 'auth';
  // Plain rate limit (no quota signal).
  if (status === 429 || code === 'rate_limit_exceeded') return 'rate_limit';
  return null;
}

export function recordOpenAIError(err: any): void {
  const kind = classify(err);
  if (!kind) return;
  state.lastErrorAt = Date.now();
  state.lastErrorKind = kind;
  state.lastErrorMessage = String(err?.message || err?.error?.message || err).slice(0, 240);
}

// Require this much error-free time before considering an outage resolved.
// Avoids racing against in-flight calls that may still be hitting quota.
const RESOLVE_GRACE_MS = 2 * 60 * 1000;

export function recordOpenAISuccess(): void {
  const now = Date.now();
  state.lastSuccessAt = now;
  // Only clear an error once we've been error-free for the grace window —
  // otherwise concurrent calls (one succeeding, one still hitting quota)
  // can flap the alert on/off.
  if (state.lastErrorAt && now - state.lastErrorAt > RESOLVE_GRACE_MS) {
    state.lastErrorAt = null;
    state.lastErrorKind = null;
    state.lastErrorMessage = null;
  }
}

export interface OpenAIHealthPublic {
  ok: boolean;
  kind: ErrorKind | null;
  lastErrorAt: number | null;
}

/** Sanitized snapshot safe to expose to non-admin users (no error message). */
export function getOpenAIHealthPublic(): OpenAIHealthPublic {
  const full = getOpenAIHealth();
  return { ok: full.ok, kind: full.kind, lastErrorAt: full.lastErrorAt };
}

export interface OpenAIHealthSnapshot {
  ok: boolean;
  kind: ErrorKind | null;
  message: string | null;
  lastErrorAt: number | null;
  lastSuccessAt: number | null;
}

export function getOpenAIHealth(): OpenAIHealthSnapshot {
  const recentError =
    state.lastErrorAt !== null && Date.now() - state.lastErrorAt < STALENESS_MS;
  return {
    ok: !recentError,
    kind: recentError ? state.lastErrorKind : null,
    message: recentError ? state.lastErrorMessage : null,
    lastErrorAt: recentError ? state.lastErrorAt : null,
    lastSuccessAt: state.lastSuccessAt,
  };
}
