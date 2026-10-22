// Normalización de valores. Nunca añade información que no esté en el texto.

/** NFKC: convierte dígitos/letras/puntuación de ancho completo a ASCII; preserva los caracteres chinos. */
export function nfkc(s: string): string { return s.normalize('NFKC'); }

export const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;
export const CJK_G = /[㐀-䶿一-鿿豈-﫿]/g;
export function cjkRatio(s: string): number {
  const letters = s.replace(/[\s\d\p{P}\p{S}]/gu, '');
  if (!letters) return 0;
  return (letters.match(CJK_G)?.length ?? 0) / letters.length;
}
export function isCjkDominant(s: string): boolean { return cjkRatio(s) >= 0.5; }

export function cleanSpaces(s: string): string { return s.replace(/\s+/g, ' ').trim(); }

/** Corrige confusiones OCR típicas (O→0, l/I/|→1) solo dentro de secuencias numéricas. */
export function fixDigitConfusions(s: string): { value: string; fixed: boolean } {
  const value = s.replace(/[\dOoIl|][\dOoIl|\s\-().]{5,}/g, (tok) =>
    (tok.match(/\d/g)?.length ?? 0) >= 4 ? tok.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1') : tok);
  return { value, fixed: value !== s };
}

export interface NormalizedPhone { e164: string; kind: 'mobile_cn' | 'landline_cn' | 'intl' | 'unknown'; digits: string }

/** Normaliza un teléfono a E.164 (+86...). Devuelve null si no tiene forma de teléfono. */
export function normalizePhone(raw: string): NormalizedPhone | null {
  const { value } = fixDigitConfusions(nfkc(raw));
  const stripped = value.replace(/(ext|分机|转)\.?\s*\d+$/i, '');
  const hasPlus = /^\s*\+/.test(stripped);
  let d = stripped.replace(/\D/g, '');
  if (d.length < 7 || d.length > 15) return null;
  if (d.startsWith('00')) d = d.slice(2);
  // China: 86 + móvil (1[3-9]xxxxxxxxx) o fijo (área 2-3 dígitos + 7-8 dígitos)
  if (d.startsWith('86') && (hasPlus || d.length >= 12)) {
    let rest = d.slice(2);
    if (rest.startsWith('0')) rest = rest.slice(1); // +86 (0)20 ...
    if (/^1[3-9]\d{9}$/.test(rest)) return { e164: `+86${rest}`, kind: 'mobile_cn', digits: rest };
    if (/^[2-9]\d{8,10}$/.test(rest)) return { e164: `+86${rest}`, kind: 'landline_cn', digits: rest };
    return { e164: `+${d}`, kind: 'unknown', digits: d };
  }
  if (!hasPlus && /^1[3-9]\d{9}$/.test(d)) return { e164: `+86${d}`, kind: 'mobile_cn', digits: d };
  if (!hasPlus && /^0[1-9]\d{8,10}$/.test(d)) return { e164: `+86${d.slice(1)}`, kind: 'landline_cn', digits: d.slice(1) };
  if (hasPlus && d.length >= 8) return { e164: `+${d}`, kind: 'intl', digits: d };
  return { e164: d, kind: 'unknown', digits: d };
}

export function normalizeEmail(raw: string): string {
  return nfkc(raw).replace(/\s*@\s*/g, '@').replace(/\s*\.\s*/g, '.').replace(/[,，;；]+$/, '').replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '').toLowerCase();
}

export function normalizeWebsite(raw: string): string {
  return nfkc(raw).trim().replace(/\s*\.\s*/g, '.').replace(/^https?:\/\//i, '').replace(/[/,，;；.]+$/, '').toLowerCase();
}

export function normalizeWechat(raw: string): string {
  return nfkc(raw).trim().replace(/^[:：\s]+/, '').replace(/[,，;；]+$/, '').replace(/\s+/g, '');
}

/** "12.1E35-36" / "12.1 E 35" / "展位号:9.2D18" → { hall: "12.1", booth: "E35-36" } */
export const BOOTH_RE = /\b(\d{1,2}\.\d)\s*[-–]?\s*([A-M])\s*[-–]?\s*(\d{1,2}(?:\s*[-–/]\s*\d{1,2})?)\b/;
export function parseBooth(raw: string): { hall: string; booth: string } | null {
  const m = nfkc(raw).toUpperCase().match(BOOTH_RE);
  if (!m) return null;
  return { hall: m[1], booth: `${m[2]}${m[3].replace(/\s+/g, '').replace(/[–/]/g, '-')}` };
}

/** Comparación tolerante (mayúsculas, espacios, puntuación) para decidir si dos lecturas coinciden. */
export function sameValue(a: string, b: string): boolean {
  const k = (s: string) => nfkc(s).toLowerCase().replace(/[\s.,，。·()（）\-_/]/g, '');
  return k(a) === k(b);
}
