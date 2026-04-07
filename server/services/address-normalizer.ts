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
      const { default: KuroshiroModule } = await import('kuroshiro');
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

  // Pass-through fields
  normalized.country = address.country ?? undefined;
  normalized.phone   = address.phone   ?? undefined;
  normalized.email   = address.email   ?? undefined;

  return { original: { ...address }, normalized, changes, warnings };
}
