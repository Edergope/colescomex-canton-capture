// Guardas de configuración: instancia de vista previa aislada y respaldo obligatorio de originales.
import { afterEach, describe, expect, it, vi } from 'vitest';

async function load(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import('../src/config/env');
}
afterEach(() => { vi.unstubAllEnvs(); });

const GOOGLE = { VITE_AUTH_MODE: 'google', VITE_SYNC_MODE: 'google', VITE_GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com',
  VITE_ALLOWED_USERS: 'EDR:Eder:a@x.com,HCT:Héctor:b@x.com', VITE_SHEETS_SPREADSHEET_ID: 'TEST-SHEET', VITE_DRIVE_EVIDENCE_FOLDER_ID: 'TEST-FOLDER',
  VITE_DRIVE_ORIGINALS_FOLDER_ID: 'TEST-ORIG', VITE_SCANNER: 'on' };

describe('guardas de configuración', () => {
  it('producción: base de datos de siempre y sin problemas con la configuración completa', async () => {
    const m = await load({ ...GOOGLE, VITE_INSTANCE: 'production' });
    expect(m.config.dbName).toBe('colescomex-canton-capture');
    expect(m.configProblems()).toEqual([]);
  });
  it('con el escáner activo, el respaldo restringido de originales es obligatorio', async () => {
    const m = await load({ ...GOOGLE, VITE_DRIVE_ORIGINALS_FOLDER_ID: '' });
    expect(m.configProblems().join(' ')).toMatch(/VITE_DRIVE_ORIGINALS_FOLDER_ID/);
  });
  it('vista previa: base de datos propia y bloqueo de los recursos de producción', async () => {
    const ok = await load({ ...GOOGLE, VITE_INSTANCE: 'preview', VITE_PRODUCTION_SPREADSHEET_ID: 'PROD-SHEET', VITE_PRODUCTION_DRIVE_FOLDER_ID: 'PROD-FOLDER' });
    expect(ok.config.dbName).toBe('colescomex-canton-capture--preview');
    expect(ok.configProblems()).toEqual([]);
    const bad = await load({ ...GOOGLE, VITE_INSTANCE: 'preview', VITE_SHEETS_SPREADSHEET_ID: 'PROD-SHEET', VITE_PRODUCTION_SPREADSHEET_ID: 'PROD-SHEET', VITE_PRODUCTION_DRIVE_FOLDER_ID: 'PROD-FOLDER' });
    expect(bad.configProblems().join(' ')).toMatch(/BLOQUEADO: la instancia "preview" apunta a un recurso de producción/);
    const undeclared = await load({ ...GOOGLE, VITE_INSTANCE: 'preview' });
    expect(undeclared.configProblems().join(' ')).toMatch(/VITE_PRODUCTION_SPREADSHEET_ID/);
  });
});
