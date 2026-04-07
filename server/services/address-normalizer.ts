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
 *   2. wanakana.toRomaji  — kana (hiragana / katakana) → Hepburn romaji
 *      e.g. タナカ → tanaka, たろう → tarou
 *      Kanji that have no kana reading are left for step 3.
 *   3. any-ascii           — remaining non-ASCII → closest Latin chars
 *   4–6. Whitelist / collapse / truncate
 *
 * All other countries
 *   1. NFKD + diacritic strip  (é → e, ü → u, ñ → n, etc.)
 *   2. any-ascii               (CJK, Arabic, Korean, etc.)
 *   3–5. Whitelist / collapse / truncate
 *
 * Adding a new country: add a `case 'XX':` branch in `transliterate()`.
 */

import anyAscii from 'any-ascii';
import { toRomaji } from 'wanakana';

// USPS Domestic Mail Manual field length limits (also used for intl labels)
const FIELD_LIMITS: Record<string, number> = {
  name:    35,
  company: 35,
  street1: 35,
  street2: 35,
  city:    28,
  state:    2,
  zip:     10,
};

// Characters allowed on a carrier label
const ALLOWED_RE = /[^A-Za-z0-9 ,.\-#]/g;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** True when the string contains any character that is not plain ASCII. */
const hasNonAscii = (s: string) => /[^\x00-\x7F]/.test(s);

/**
 * Title-case each word in a string.
 * "tanaka tarou" → "Tanaka Tarou"
 */
function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, c => c.toUpperCase());
}

// ── Country-aware transliteration ────────────────────────────────────────────

/**
 * Convert non-ASCII text to the closest printable ASCII using a pipeline
 * that is aware of the destination country.
 */
function transliterate(text: string, country: string): string {
  switch (country.toUpperCase()) {
    case 'JP': {
      // Step 1: Convert hiragana / katakana → Hepburn romaji
      // wanakana leaves kanji and Latin characters untouched.
      let out = toRomaji(text, { upcaseKatakana: false });

      // Step 2: any-ascii mop-up for any remaining kanji or other non-ASCII
      if (hasNonAscii(out)) {
        out = anyAscii(out);
      }

      // Step 3: Title-case the result so names look like "Tanaka Taro"
      // rather than the all-lowercase wanakana output.
      out = titleCase(out);
      return out;
    }

    // Future entries: add 'KR', 'CN', 'TW', etc. here as needed.

    default: {
      // Generic pipeline: any-ascii handles diacritics + non-Latin scripts.
      return hasNonAscii(text) ? anyAscii(text) : text;
    }
  }
}

// ── Per-field normalization ───────────────────────────────────────────────────

function normalizeField(
  value: string,
  fieldName: string,
  country: string,
): { normalized: string; warnings: string[] } {
  const warnings: string[] = [];

  if (!value) return { normalized: '', warnings };

  // 1 + 2: NFKD decomposition → strip combining diacritics (works for all scripts)
  let out = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  // 3: Country-aware transliteration
  if (hasNonAscii(out)) {
    out = transliterate(out, country);
  }

  // 4: Remove characters outside the carrier whitelist
  out = out.replace(ALLOWED_RE, ' ');

  // 5: Collapse multiple spaces and trim
  out = out.replace(/\s+/g, ' ').trim();

  // Confidence check: if the result is empty but the input wasn't, warn
  if (!out && value.trim()) {
    warnings.push(
      `Field "${fieldName}" could not be transliterated — manual review required (original: "${value.slice(0, 40)}")`
    );
  }

  // 6: Enforce max length
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
 * - `original`   — the caller's input, unchanged
 * - `normalized` — carrier-safe ASCII version ready for the API
 * - `changes`    — list of fields that were modified with before/after values
 * - `warnings`   — truncations or fields that could not be transliterated
 *
 * Fields not subject to transliteration (country, phone, email) are
 * passed through as-is.
 */
export function normalizeAddress(address: AddressFields): NormalizeAddressResult {
  const country   = (address.country ?? '').toUpperCase();
  const warnings: string[]      = [];
  const changes:  AddressChange[] = [];
  const normalized: AddressFields = {};

  const textFields: Array<keyof AddressFields> = [
    'name', 'company', 'street1', 'street2', 'city', 'state', 'zip',
  ];

  for (const field of textFields) {
    const raw = String(address[field] ?? '');
    const { normalized: norm, warnings: fw } = normalizeField(raw, field, country);
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
