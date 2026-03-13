export interface BricklinkAccessToken {
  tokenValue: string;
  tokenSecret: string;
}

export interface BricklinkPasteResult {
  consumerKey?: string;
  consumerSecret?: string;
  tokens: BricklinkAccessToken[];
}

const HEX_PATTERN = /[A-Fa-f0-9]{16,}/;

function extractValue(text: string, label: string): string | undefined {
  const pattern = new RegExp(label + `[:\\s]+([A-Fa-f0-9]{16,})`, 'i');
  const match = text.match(pattern);
  return match ? match[1] : undefined;
}

function extractAllValues(text: string, label: string): string[] {
  const pattern = new RegExp(label + `[:\\s]+([A-Fa-f0-9]{16,})`, 'gi');
  return [...text.matchAll(pattern)].map(m => m[1]);
}

export function parseBricklinkPaste(text: string): BricklinkPasteResult | null {
  const result: BricklinkPasteResult = { tokens: [] };

  result.consumerKey = extractValue(text, 'Consumer\\s*Key');
  result.consumerSecret = extractValue(text, 'Consumer\\s*Secret');

  const tokenValues = extractAllValues(text, 'Token\\s*Value');
  const tokenSecrets = extractAllValues(text, 'Token\\s*Secret');

  const pairCount = Math.min(tokenValues.length, tokenSecrets.length);
  for (let i = 0; i < pairCount; i++) {
    result.tokens.push({ tokenValue: tokenValues[i], tokenSecret: tokenSecrets[i] });
  }

  const hasAnything = result.consumerKey || result.consumerSecret || result.tokens.length > 0;
  return hasAnything ? result : null;
}

export type PasteStatus = "idle" | "success" | "partial" | "multi" | "fail";

export function getPasteStatus(parsed: BricklinkPasteResult | null): PasteStatus {
  if (!parsed) return "fail";
  if (parsed.tokens.length > 1) return "multi";
  const hasKey = !!parsed.consumerKey;
  const hasSecret = !!parsed.consumerSecret;
  const hasToken = parsed.tokens.length === 1;
  if (hasKey && hasSecret && hasToken) return "success";
  if (hasKey || hasSecret || hasToken) return "partial";
  return "fail";
}
