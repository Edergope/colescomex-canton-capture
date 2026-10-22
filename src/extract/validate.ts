import { normalizePhone } from './normalize';

export const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;
const COMMON_TLDS = new Set([
  'com', 'cn', 'net', 'org', 'hk', 'tw', 'co', 'biz', 'info', 'shop', 'top', 'vip', 'ltd', 'cc', 'io', 'asia',
  'store', 'online', 'site', 'tech', 'group', 'xyz', 'me', 'us', 'uk', 'de', 'in', 'mo', 'sg', 'es', 'mx', 'work', 'club', 'pro', 'global',
]);

export function isValidEmail(v: string): boolean { return EMAIL_RE.test(v) && !v.includes('..'); }

export function domainTld(v: string): string { return v.split('/')[0].split('.').pop() ?? ''; }
export function isValidWebsite(v: string): { valid: boolean; knownTld: boolean } {
  const host = v.split('/')[0];
  const valid = /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(host) && !host.startsWith('-');
  return { valid, knownTld: COMMON_TLDS.has(domainTld(host)) };
}

export function isValidWechatId(v: string): boolean {
  return /^[a-zA-Z][-_a-zA-Z0-9]{5,19}$/.test(v) || /^\+?\d{7,15}$/.test(v);
}

export function isValidPhone(v: string): boolean {
  const p = normalizePhone(v);
  return !!p && (p.kind !== 'unknown' || (p.digits.length >= 8 && p.digits.length <= 13));
}

export const LOW_CONFIDENCE = 0.75;
export const ILLEGIBLE_CONFIDENCE = 0.45;
