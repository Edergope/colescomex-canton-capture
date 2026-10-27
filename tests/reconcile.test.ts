// Conciliación de solo lectura (scripts/reconcile-google.ts) con un escenario como el incidente HCT (datos ficticios):
// 23 carpetas HCT vacías en EVIDENCIAS y en ORIGINALES, 41 filas EDR y ninguna HCT.
import { describe, expect, it } from 'vitest';
import { reconcile, compareReports, type DriveFolder, type LedgerEntry } from '../scripts/reconcile-google';

const ref = (u: string, n: number) => `CF26F2-${u}-${u === 'HCT' ? 'CCCB' : 'AB12'}-${String(n).padStart(4, '0')}`;
const uuid = (u: string, n: number) => `${u.toLowerCase()}-uuid-${n}`;
const folder = (u: string, n: number, files = 0): DriveFolder => ({ id: `F-${u}-${n}`, name: ref(u, n), capture_uuid: uuid(u, n), createdTime: '2026-10-22T10:00:00Z', owner: 'hector@example.com',
  files: Array.from({ length: files }, (_, i) => ({ name: `${ref(u, n)}_0${i + 1}.jpg` })) });
const row = (u: string, n: number) => ({ capture_uuid: uuid(u, n), external_ref: ref(u, n), captured_by: u === 'HCT' ? 'Héctor' : 'Eder', user_id: u });
const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('conciliación Drive + Sheets + teléfono', () => {
  it('incidente: 23 carpetas HCT vacías sin fila → 23 pendientes, 0 completas; las filas EDR no se mezclan', () => {
    const r = reconcile({ user: 'HCT', main: [...range(23).map((n) => folder('HCT', n)), ...range(41).map((n) => folder('EDR', n, 2))],
      archive: range(23).map((n) => folder('HCT', n)), rows: range(41).map((n) => row('EDR', n)) });
    expect(r.identified).toBe(23);
    expect(r.complete).toBe(0);
    expect(r.by_verdict.CARPETA_VACIA_SIN_FILA).toBe(23); // una carpeta vacía NUNCA cuenta como sincronizada
    expect(r.captures.every((c) => c.external_ref.startsWith('CF26F2-HCT-'))).toBe(true);
  });

  it('con el libro del teléfono: errores reales por motivo y capturas que nunca llegaron a Drive', () => {
    const ledger: LedgerEntry[] = [
      ...range(23).map((n) => ({ external_ref: ref('HCT', n), capture_uuid: uuid('HCT', n), sync_status: 'ERROR', sync_attempts: 9, sync_error: "Google HTTP 403 storageQuotaExceeded: The user's Drive storage quota has been exceeded.", main: { expected: 2, uploaded: 0 } })),
      { external_ref: ref('HCT', 24), capture_uuid: uuid('HCT', 24), sync_status: 'LOCAL', main: { expected: 2, uploaded: 0 } },
    ];
    const r = reconcile({ user: 'HCT', main: range(23).map((n) => folder('HCT', n)), archive: [], rows: [], ledger });
    expect(r.identified).toBe(24);
    expect(r.by_verdict.SOLO_EN_DISPOSITIVO).toBe(1);
    expect(Object.fromEntries(r.device_errors)).toEqual({ 'Google HTTP 403 storageQuotaExceeded': 23 });
  });

  it('tras la recuperación: completas, recuperadas y regresiones; fila con carpeta vacía o archivos incompletos ≠ completa', () => {
    const before = reconcile({ user: 'HCT', main: range(3).map((n) => folder('HCT', n)), archive: [], rows: [] });
    const after = reconcile({ user: 'HCT', main: [folder('HCT', 1, 2), folder('HCT', 2, 1), folder('HCT', 3, 0)], archive: [], rows: [row('HCT', 1), row('HCT', 2), row('HCT', 3)],
      ledger: [{ external_ref: ref('HCT', 2), capture_uuid: uuid('HCT', 2), sync_status: 'PENDIENTE', main: { expected: 2, uploaded: 1 } }] });
    expect(after.captures.map((c) => c.verdict)).toEqual(['COMPLETA', 'FILA_SIN_ARCHIVOS', 'FILA_SIN_ARCHIVOS']);
    expect(compareReports(before, after)).toEqual({ recovered: [ref('HCT', 1)], still_pending: [`${ref('HCT', 2)}: FILA_SIN_ARCHIVOS`, `${ref('HCT', 3)}: FILA_SIN_ARCHIVOS`], regressed: [] });
  });

  it('detecta filas duplicadas por capture_uuid', () => {
    const r = reconcile({ user: 'HCT', main: [folder('HCT', 1, 2)], archive: [], rows: [row('HCT', 1), row('HCT', 1)] });
    expect(r.duplicate_rows).toEqual([uuid('HCT', 1)]);
  });
});
