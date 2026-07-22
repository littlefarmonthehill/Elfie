/**
 * Address Normalizer
 *
 * Pre-processes shipping addresses before carrier API submission.
 * All normalization happens on our side — we never rely on carriers
 * (USPS, EasyPost, etc.) to handle or correct non-ASCII characters.
 *
 * Country-aware transliteration pipeline
 * ─────────────────────────────────────
 * JP (Japan)
 *   1. NFKD + diacritic strip
 *   2. kuroshiro + kuromoji  — full Japanese morphological analysis
 *      Reads kanji with proper Japanese pronunciation via dictionary lookup.
 *      e.g. 弘晃 → hiroshi akira, 筒尾2丁目14-15 → tsutsuo 2 chome 14-15
 *      Kana (hiragana/katakana) is handled by the same step.
 *   3. any-ascii mop-up for any residual non-ASCII
 *   4–6. Whitelist / collapse / truncate
 *
 * KR (South Korea)
 *   1. NFKD + diacritic strip
 *   2. hangul-romanize    — Hangul → Revised Romanization of Korean
 *      e.g. 김민준 → Gimminjun, 강남구 → Gangnamgu
 *   3. any-ascii mop-up for any residual non-ASCII
 *   4–6. Whitelist / collapse / truncate
 *
 * CN / TW / HK (Chinese)
 *   1. NFKD + diacritic strip
 *   2. pinyin             — Chinese characters → Mandarin Pinyin (no tones)
 *      e.g. 北京市 → Bei Jing Shi, 张伟 → Zhang Wei
 *   3. any-ascii mop-up for any residual non-ASCII
 *   4–6. Whitelist / collapse / truncate
 *
 * All other countries (European diacritics, Cyrillic, Arabic, Thai, …)
 *   1. NFKD + diacritic strip  (é → e, ü → u, ñ → n, etc.)
 *   2. any-ascii               — broadest coverage fallback
 *   3–5. Whitelist / collapse / truncate
 *
 * Adding a new country: add a `case 'XX':` branch in `transliterate()`.
 */

import anyAscii from 'any-ascii';
import HangulRomanize from 'hangul-romanize';
import { pinyin } from 'pinyin';

const { Romanize } = HangulRomanize as any;

// ── kuroshiro singleton (JP only) ─────────────────────────────────────────────
// The kuromoji dictionary loads once, asynchronously, on first use.
// Subsequent calls reuse the same initialized instance.

let _kuroshiro: any = null;
let _kuroshiroReady: Promise<void> | null = null;

async function getKuroshiro(): Promise<any> {
  if (_kuroshiro) return _kuroshiro;

  if (!_kuroshiroReady) {
    _kuroshiroReady = (async () => {
      // @ts-ignore
      const { default: KuroshiroModule } = await import('kuroshiro');
      // @ts-ignore
      const { default: KuromojiModule }  = await import('kuroshiro-analyzer-kuromoji');
      const Kuroshiro        = (KuroshiroModule as any).default ?? KuroshiroModule;
      const KuromojiAnalyzer = (KuromojiModule as any).default  ?? KuromojiModule;
      const k = new Kuroshiro();
      await k.init(new KuromojiAnalyzer());
      _kuroshiro = k;
      console.log('[AddrNorm] kuroshiro + kuromoji dictionary ready — Japanese romanization active');
    })().catch((err: unknown) => {
      // Reset so the next call will retry rather than getting a cached rejection.
      _kuroshiroReady = null;
      console.error('[AddrNorm] kuroshiro init FAILED — JP addresses will fall back to any-ascii:', err instanceof Error ? err.message : String(err));
    });
  }

  await _kuroshiroReady;
  if (!_kuroshiro) throw new Error('kuroshiro unavailable');
  return _kuroshiro;
}

// Pre-warm the dictionary at module load so it is ready by the time the first
// shipment arrives, rather than adding latency to that request.
getKuroshiro().catch(() => { /* logged inside */ });

// ── USPS field length limits ──────────────────────────────────────────────────

const FIELD_LIMITS: Record<string, number> = {
  name:    35,
  company: 35,
  street1: 35,
  street2: 35,
  city:    28,
  state:    2,
  zip:     10,
};

// Characters allowed on a carrier label.
// USPS domestic allows commas and periods (e.g. "P.O. Box", "St. Paul, MN").
// USPS International explicitly forbids commas and periods — IMM / FAQ requirement.
const ALLOWED_RE_DOMESTIC    = /[^A-Za-z0-9 ,.\-#]/g;
const ALLOWED_RE_INTL        = /[^A-Za-z0-9 \-#]/g;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** True when the string contains any character outside plain ASCII. */
const hasNonAscii = (s: string) => /[^\x00-\x7F]/.test(s);

/**
 * Title-case each word.
 * "tanaka taro" → "Tanaka Taro"
 */
function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, c => c.toUpperCase());
}

// ── Country-aware transliteration ────────────────────────────────────────────

async function transliterate(text: string, country: string): Promise<string> {
  switch (country.toUpperCase()) {

    case 'JP': {
      // Full Japanese morphological analysis — reads kanji with Japanese
      // pronunciation (not Chinese), then emits romaji.
      // e.g. 弘晃 → hiroshi akira, 丁目 → chome, 桑名市 → kuwana shi
      try {
        const k = await getKuroshiro();
        let out: string = await k.convert(text, { to: 'romaji', mode: 'spaced' });

        // kuroshiro may return macron long-vowels (ō, ū) — strip them via NFKD
        out = out.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');

        // any-ascii mop-up for residual non-ASCII (rare edge cases)
        if (hasNonAscii(out)) out = anyAscii(out);

        return titleCase(out);
      } catch {
        // If kuroshiro fails (e.g. dictionary not yet loaded), fall back to
        // any-ascii so the label is still submitted rather than crashing.
        return hasNonAscii(text) ? titleCase(anyAscii(text)) : text;
      }
    }

    case 'KR': {
      // Revised Romanization of Korean via hangul-romanize
      // e.g. 강남구 테헤란로 → Gangnamgu Tehelanro
      let out = Romanize.from(text) as string;
      if (hasNonAscii(out)) out = anyAscii(out);
      return titleCase(out);
    }

    case 'CN':
    case 'TW':
    case 'HK': {
      // Mandarin Pinyin (no tone marks) via the pinyin library.
      // pinyin() returns an array-of-arrays: [['bei'],['jing'],['shi']]
      // Non-Chinese characters are returned in single-element arrays unchanged.
      const syllables = (pinyin as any)(text, { style: 0, heteronym: false }) as string[][];
      let out = syllables.map((a: string[]) => a[0] ?? '').join(' ');
      out = out.replace(/\s+/g, ' ').trim();
      if (hasNonAscii(out)) out = anyAscii(out);
      return titleCase(out);
    }

    default: {
      // Generic pipeline: any-ascii handles diacritics + non-Latin scripts
      // (Cyrillic, Arabic, Greek, Thai, Hebrew, …).
      return hasNonAscii(text) ? anyAscii(text) : text;
    }
  }
}

// ── Per-field normalization ───────────────────────────────────────────────────

async function normalizeField(
  value: string,
  fieldName: string,
  country: string,
): Promise<{ normalized: string; warnings: string[] }> {
  const warnings: string[] = [];

  if (!value) return { normalized: '', warnings };

  // 1: NFKD decomposition → strip combining diacritics (works for all scripts)
  let out = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  // 2: Country-aware transliteration
  if (hasNonAscii(out)) {
    out = await transliterate(out, country);
  }

  // 3: Remove characters outside the carrier whitelist.
  //    International labels must not contain commas or periods (USPS IMM).
  const allowedRe = country === 'US' ? ALLOWED_RE_DOMESTIC : ALLOWED_RE_INTL;
  out = out.replace(allowedRe, ' ');

  // 4: Collapse multiple spaces and trim
  out = out.replace(/\s+/g, ' ').trim();

  // Confidence check: if the result is empty but the input wasn't, warn
  if (!out && value.trim()) {
    warnings.push(
      `Field "${fieldName}" could not be transliterated — manual review required (original: "${value.slice(0, 40)}")`
    );
  }

  // 5: Enforce max length
  const maxLen = FIELD_LIMITS[fieldName];
  if (maxLen && out.length > maxLen) {
    warnings.push(
      `Field "${fieldName}" truncated to ${maxLen} characters (was ${out.length})`
    );
    out = out.slice(0, maxLen).trim();
  }

  return { normalized: out, warnings };
}

/**
 * When street1 is too long, split the overflow into street2 at a clean word
 * boundary so the full address is preserved across both lines.
 * If street2 is already occupied, the overflow is prepended to street2
 * (space-separated), then street2 is itself truncated to its own limit.
 */
function spillStreet1IntoStreet2(
  street1: string,
  street2: string,
  warnings: string[],
): { street1: string; street2: string } {
  const limit = FIELD_LIMITS['street1'] ?? 35;
  if (street1.length <= limit) return { street1, street2 };

  // Find the last space at or before the limit so we don't cut mid-word
  let splitAt = street1.lastIndexOf(' ', limit);
  if (splitAt <= 0) splitAt = limit; // no space found — hard cut at limit

  const line1    = street1.slice(0, splitAt).trim();
  const overflow = street1.slice(splitAt).trim();

  const combined = street2 ? `${overflow} ${street2}` : overflow;
  const line2Limit = FIELD_LIMITS['street2'] ?? 35;
  const line2 = combined.slice(0, line2Limit).trim();

  warnings.push(
    `Field "street1" overflowed ${limit} characters — remainder moved to street2 to preserve full address`
  );

  return { street1: line1, street2: line2 };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AddressFields {
  name?:    string | null;
  company?: string | null;
  street1?: string | null;
  street2?: string | null;
  city?:    string | null;
  state?:   string | null;
  zip?:     string | null;
  country?: string | null;
  phone?:   string | null;
  email?:   string | null;
}

export interface AddressChange {
  field:      string;
  original:   string;
  normalized: string;
}

export interface NormalizeAddressResult {
  original:   AddressFields;
  normalized: AddressFields;
  /** Fields that were actually modified (original !== normalized). */
  changes:    AddressChange[];
  /** Anomaly notes: truncations, fields that couldn't be transliterated, etc. */
  warnings:   string[];
}

/**
 * Normalize a full address object for carrier submission.
 *
 * Async because JP addresses use kuroshiro, which loads a morphological
 * dictionary (once) before it can convert kanji to romaji.
 *
 * - `original`   — the caller's input, unchanged
 * - `normalized` — carrier-safe ASCII version ready for the API
 * - `changes`    — list of fields that were modified with before/after values
 * - `warnings`   — truncations or fields that could not be transliterated
 *
 * Fields not subject to transliteration (country, phone, email) are
 * passed through as-is.
 */
export async function normalizeAddress(address: AddressFields): Promise<NormalizeAddressResult> {
  const country   = (address.country ?? '').toUpperCase();
  const warnings: string[]        = [];
  const changes:  AddressChange[] = [];
  const normalized: AddressFields = {};

  const textFields: Array<keyof AddressFields> = [
    'name', 'company', 'street1', 'street2', 'city', 'state', 'zip',
  ];

  for (const field of textFields) {
    const raw = String(address[field] ?? '');
    const { normalized: norm, warnings: fw } = await normalizeField(raw, field, country);
    (normalized as any)[field] = norm || undefined;
    warnings.push(...fw);
    if (raw && norm !== raw) {
      changes.push({ field, original: raw, normalized: norm });
    }
  }

  // Post-process: if street1 overflowed its limit, spill the remainder into
  // street2 rather than losing it. This preserves unit/apartment numbers on
  // long international addresses (e.g. Japan, Korea) instead of truncating.
  // We re-run normalizeField with a non-existent key ('street1_nolimit') so
  // the length limit is skipped, giving us the full normalized value to split.
  {
    const rawStreet1 = String(address.street1 ?? '');
    const rawStreet2 = String(address.street2 ?? '');
    const { normalized: fullStreet1 } = await normalizeField(rawStreet1, 'street1_nolimit', country);
    const limit = FIELD_LIMITS['street1'] ?? 35;
    if (fullStreet1.length > limit) {
      const currentStreet2 = normalized.street2 ?? '';
      const spilled = spillStreet1IntoStreet2(fullStreet1, currentStreet2, warnings);
      // Remove the blunt truncation warning — we handled it more gracefully
      const truncIdx = warnings.findIndex(w => w.includes('"street1" truncated to'));
      if (truncIdx !== -1) warnings.splice(truncIdx, 1);
      normalized.street1 = spilled.street1 || undefined;
      normalized.street2 = spilled.street2 || undefined;
      // Keep changes array accurate
      const s1ChangeIdx = changes.findIndex(c => c.field === 'street1');
      if (s1ChangeIdx !== -1) changes[s1ChangeIdx].normalized = spilled.street1;
      else if (rawStreet1 !== spilled.street1) changes.push({ field: 'street1', original: rawStreet1, normalized: spilled.street1 });
      if (spilled.street2 && spilled.street2 !== rawStreet2) {
        const s2ChangeIdx = changes.findIndex(c => c.field === 'street2');
        if (s2ChangeIdx !== -1) changes[s2ChangeIdx].normalized = spilled.street2;
        else changes.push({ field: 'street2', original: rawStreet2, normalized: spilled.street2 });
      }
    }
  }

  // Pass-through fields
  normalized.country = address.country ?? undefined;
  normalized.phone   = address.phone   ?? undefined;
  normalized.email   = address.email   ?? undefined;

  return { original: { ...address }, normalized, changes, warnings };
}
