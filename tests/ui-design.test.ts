// Sistema de diseño y modelo de presentación: contraste de los tokens (claro/oscuro) y mensajes de estado.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifySyncError, dataTrack, displayName, googleTrack, matchesFilter, matchesSearch, quotedTokens, reviewItems } from '../src/ui/model';
import type { Capture } from '../src/domain/schema';

const css = readFileSync(new URL('../src/ui/styles.css', import.meta.url), 'utf8');
function tokens(block: string): Record<string, string> {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}
const light = tokens(css.slice(css.indexOf(':root {'), css.indexOf('@media (prefers-color-scheme: dark)')));
const dark = { ...light, ...tokens(css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf('/* ── Base ── */'))) };

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [texto, fondo, mínimo] — 4.5:1 texto normal (WCAG AA); 7:1 para el texto principal (uso en exteriores).
const PAIRS: [string, string, number][] = [
  ['ink', 'bg', 7], ['ink', 'surface', 7], ['ink-2', 'surface', 4.5], ['ink-2', 'surface-2', 4.5],
  ['muted', 'surface', 4.5], ['muted', 'bg', 4.5], ['muted', 'surface-2', 4.5],
  ['primary-ink', 'primary', 4.5], ['link', 'surface', 4.5], ['link', 'bg', 4.5], ['err', 'surface', 4.5],
  ['ok', 'ok-soft', 4.5], ['warn', 'warn-soft', 4.5], ['err', 'err-soft', 4.5], ['info', 'info-soft', 4.5], ['neutral', 'neutral-soft', 4.5],
  ['ok', 'surface-2', 4.5], ['warn', 'surface', 4.5], ['on-brand', 'brand', 7], ['accent', 'brand', 4.5],
];

describe('tokens de color: contraste WCAG en ambos temas', () => {
  for (const [name, t] of [['claro', light], ['oscuro', dark]] as const) {
    for (const [fg, bg, min] of PAIRS) {
      it(`${name}: --${fg} sobre --${bg} ≥ ${min}:1`, () => {
        expect(t[fg], fg).toBeDefined(); expect(t[bg], bg).toBeDefined();
        expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
      });
    }
  }
  it('el modo oscuro se define tanto por preferencia del sistema como por elección explícita', () => {
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\)\s*{\s*:root:not\(\[data-theme="light"\]\)/);
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/:focus-visible/);
  });
});

function cap(p: Partial<Capture> = {}): Capture {
  const fields = Object.fromEntries(['company_name', 'company_name_cn', 'contact_name', 'booth', 'email', 'main_products', 'wechat'].map((k) => [k, ''])) as Capture['fields'];
  return { uuid: 'u1', external_ref: 'CF26F2-EDR-TEST-0001', fields, field_meta: {}, evidence_ids: [], ocr_status: 'EXTRAIDO', ocr_attempts: 0, review_status: 'SIN_REVISAR',
    sync_status: 'LOCAL', sync_attempts: 0, revision: 1, synced_revision: 0, device_id: 'd', user_id: 'EDR', created_at: new Date().toISOString(), updated_at: '', app_version: 't', ...p } as Capture;
}

describe('modelo de presentación', () => {
  it('sin empresa: «Leyendo tarjeta…» mientras se procesa y «Empresa pendiente de identificar» después', () => {
    expect(displayName(cap({ ocr_status: 'PROCESANDO' }))).toEqual({ text: 'Leyendo tarjeta…', pending: true });
    expect(displayName(cap({ ocr_status: 'REQUIERE_REVISION' }))).toEqual({ text: 'Empresa pendiente de identificar', pending: true });
    expect(displayName(cap({ fields: { ...cap().fields, company_name_cn: '示例公司' } })).text).toBe('示例公司');
  });

  it('nunca se dice «Confirmado en Google» antes de la confirmación', () => {
    for (const s of ['LOCAL', 'PENDIENTE', 'SINCRONIZANDO', 'ERROR'] as const) expect(googleTrack(cap({ sync_status: s })).label).not.toMatch(/Confirmado|Guardado en Google/);
    expect(googleTrack(cap({ sync_status: 'SINCRONIZANDO' })).label).toBe('Subiendo a Google');
    expect(googleTrack(cap({ sync_status: 'PENDIENTE' })).label).toBe('Pendiente de sincronización');
    expect(googleTrack(cap({ sync_status: 'CONFIRMADO' })).label).toBe('Confirmado en Google');
    expect(dataTrack(cap({ ocr_status: 'PROCESANDO' })).label).toBe('Procesando documento');
  });

  it('errores de sincronización con mensaje específico por causa', () => {
    expect(classifySyncError('Sin conexión (simulado)').kind).toBe('offline');
    expect(classifySyncError('AuthRequiredError: Inicia sesión de nuevo').kind).toBe('auth');
    expect(classifySyncError('Drive HTTP 403: insufficient permissions').kind).toBe('permission');
    expect(classifySyncError('Sheets HTTP 503').kind).toBe('server');
    expect(classifySyncError('Sincronización bloqueada: Falta VITE_SPREADSHEET_ID').kind).toBe('config');
    expect(classifySyncError('algo raro').kind).toBe('upload');
    expect(classifySyncError('Sin conexión').title).toBe('La conexión se interrumpió; la subida se reintentará');
    expect(classifySyncError('Reconecta tu cuenta').title).toBe('La sesión de Google expiró; reconecte su cuenta');
    // los mensajes de la orden P0, uno por causa real (nunca todo 403 como «permiso»)
    expect(classifySyncError("Google HTTP 403 storageQuotaExceeded: The user's Drive storage quota has been exceeded.").title).toBe('El almacenamiento de su cuenta de Google está lleno');
    expect(classifySyncError('Google HTTP 429 rateLimitExceeded: Rate Limit Exceeded').title).toBe('Google limitó temporalmente las solicitudes');
    expect(classifySyncError('Google HTTP 403 userRateLimitExceeded: User rate limit exceeded').kind).toBe('rate_limit');
    expect(classifySyncError('Google HTTP 404: sesión de subida caducada').kind).toBe('offline'); // sesión de SUBIDA, no de Google
    expect(classifySyncError('La conexión se interrumpió durante la subida; se reintentará').kind).toBe('offline');
    expect(classifySyncError('Drive guardó 10 bytes de 20 en x.jpg; se reintentará').title).toBe('No fue posible subir este archivo');
    expect(classifySyncError('Google HTTP 403 insufficientFilePermissions: no').kind).toBe('permission');
  });

  it('revisión: solo campos dudosos no bloqueados; nada bloqueado por una persona vuelve a pedir revisión', () => {
    const c = cap({ ocr_status: 'REQUIERE_REVISION', field_meta: {
      main_products: { source: 'ocr_front', status: 'review', reason: 'posibles errores de separación: "STREETLIGHTING"' },
      email: { source: 'ocr_front', status: 'ok' },
      wechat: { source: 'human', status: 'ok', locked: true },
      contact_name: { source: 'ocr_front', status: 'review', locked: true },
    }, scan_issues: ['Tarjeta frontal: bordes no detectados'] });
    const items = reviewItems(c);
    expect(items.map((i) => i.field)).toEqual(['scan', 'main_products']);
    expect(items[1].reason).toMatch(/^Detectamos una posible separación incorrecta en Productos/);
    expect(quotedTokens(items[1].reason)).toEqual(['STREETLIGHTING']);
    expect(reviewItems({ ...c, review_status: 'REVISADO' })).toEqual([]);
  });

  it('filtros y búsqueda por empresa, contacto, referencia y empresas adicionales', () => {
    const c = cap({ sync_status: 'ERROR', fields: { ...cap().fields, company_name: 'Demo Valves', contact_name: 'Ada Ejemplo' }, ocr_extras: { fax: [], qq: [], secondary_companies: ['Otra Demo Ltd'] } });
    expect(matchesFilter(c, 'errors')).toBe(true);
    expect(matchesFilter(c, 'confirmed')).toBe(false);
    for (const q of ['valves', 'ada', 'test-0001', 'otra demo']) expect(matchesSearch(c, q), q).toBe(true);
    expect(matchesSearch(c, 'zzz')).toBe(false);
  });
});
