/**
 * Address Normalizer
 *
 * Pre-processes shipping addresses before carrier API submission.
 * All normalization happens on our side — we never rely on carriers
 * (USPS, EasyPost, etc.) to handle or correct non-ASCII characters.
 *
 * Pipeline per field:
 *   1. Unicode NFKD decomposition — separates base letters from diacritics
 *      (e.g. é → e + combining ´)
 *   2. Diacritic strip — removes combining diacritic code-points so only
 *      the base letter remains (é → e, ü → u, ñ → n)
 *   3. any-ascii transliteration — maps remaining non-ASCII scripts to their
 *      closest Latin equivalents (Japanese, Chinese, Arabic, Korean, etc.)
 *   4. Character whitelist — strips anything not in [A-Za-z0-9 ,.#-]
 *   5. Collapse runs of spaces and trim
 *   6. Max-length truncation per USPS field limits
 */

import anyAscii from 'any-ascii';

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

/**
 * Normalize a single address field to a carrier-safe ASCII string.
 * Returns the normalized string and any warnings generated.
 */
function normalizeField(
  value: string,
  fieldName: string,
): { normalized: string; warnings: string[] } {
  const warnings: string[] = [];

  if (!value) return { normalized: '', warnings };

  // 1 + 2: NFKD decomposition → strip combining diacritics
  let out = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, ''); // strip combining diacritic marks

  // 3: Transliterate remaining non-ASCII (Japanese, Chinese, Arabic, etc.)
  const hasNonAscii = /[^\x00-\x7F]/.test(out);
  if (hasNonAscii) {
    out = anyAscii(out);
  }

  // 4: Remove characters outside the carrier whitelist
  out = out.replace(ALLOWED_RE, ' ');

  // 5: Collapse multiple spaces and trim
  out = out.replace(/\s+/g, ' ').trim();

  // Confidence check: if the result is empty or all spaces, warn
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
  field:    string;
  original: string;
  normalized: string;
}

export interface NormalizeAddressResult {
  original:   AddressFields;
  normalized: AddressFields;
  /** Fields that were actually modified (original !== normalized). */
  changes:  AddressChange[];
  /** Anomaly notes: truncations, fields that couldn't be transliterated, etc. */
  warnings: string[];
}

/**
 * Normalize a full address object for carrier submission.
 *
 * - `original`   — the caller's input, unchanged
 * - `normalized` — carrier-safe ASCII version ready for the API
 * - `warnings`   — human-readable notes about fields that were changed
 *                  or could not be transliterated (manual review required)
 *
 * Fields not subject to transliteration (country, phone, email) are
 * copied through as-is.
 */
export function normalizeAddress(address: AddressFields): NormalizeAddressResult {
  const warnings: string[] = [];
  const changes:  AddressChange[] = [];
  const normalized: AddressFields = {};

  const textFields: Array<keyof AddressFields> = [
    'name', 'company', 'street1', 'street2', 'city', 'state', 'zip',
  ];

  for (const field of textFields) {
    const raw = String(address[field] ?? '');
    const { normalized: norm, warnings: fw } = normalizeField(raw, field);
    (normalized as any)[field] = norm || undefined;
    warnings.push(...fw);
    // Record an explicit change entry whenever the value was actually modified
    if (raw && norm !== raw) {
      changes.push({ field, original: raw, normalized: norm });
    }
  }

  // Pass-through fields (not label-printed text that runs through printers)
  normalized.country = address.country ?? undefined;
  normalized.phone   = address.phone   ?? undefined;
  normalized.email   = address.email   ?? undefined;

  return {
    original: { ...address },
    normalized,
    changes,
    warnings,
  };
}
