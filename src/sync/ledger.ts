// Libro de sincronización por captura, SIN datos personales (ni empresa, ni contactos, ni fotos): referencia,
// capture_uuid, usuario, estado, intentos, error REAL de Google y cuántos archivos se subieron frente a los esperados.
// Lo usan la pantalla de Sincronización, «Copiar diagnóstico» y la conciliación con Drive/Sheets (scripts/reconcile-google.mjs).
import type { CaptureRepo } from '../storage/repo';
import type { Capture, Evidence } from '../domain/schema';
import { uploadPlan } from './SyncEngine';

export interface SyncLedgerRow {
  external_ref: string;
  capture_uuid: string;
  user_id: string;
  created_at: string;
  app_version?: string;
  sync_status: Capture['sync_status'];
  sync_attempts: number;
  /** error real (incluye el motivo de Google, p. ej. «Google HTTP 403 storageQuotaExceeded: …») */
  sync_error?: string;
  next_attempt_at?: string;
  /** la carpeta del proveedor (y la del respaldo) ya existen en Drive: una carpeta NO implica archivos subidos */
  drive_folder: boolean;
  archive_folder: boolean;
  /** archivos esperados en Drive frente a los confirmados (carpeta del proveedor / respaldo restringido) */
  main: { expected: number; uploaded: number };
  archive: { expected: number; uploaded: number };
  row_confirmed_at?: string;
}

export function ledgerRow(c: Capture, evs: Evidence[], opts: { archive: boolean; scannerEnabled: boolean }): SyncLedgerRow {
  const plan = uploadPlan(c, evs, opts);
  const main = { expected: 0, uploaded: 0 }, archive = { expected: 0, uploaded: 0 };
  for (const p of plan.values()) {
    if (p.main !== 'skip') { main.expected++; if (p.main === 'done') main.uploaded++; }
    if (p.archive !== 'skip') { archive.expected++; if (p.archive === 'done') archive.uploaded++; }
  }
  return {
    external_ref: c.external_ref, capture_uuid: c.uuid, user_id: c.user_id, created_at: c.created_at, app_version: c.app_version,
    sync_status: c.sync_status, sync_attempts: c.sync_attempts, sync_error: c.sync_error?.slice(0, 300),
    next_attempt_at: c.sync_next_attempt_at ? new Date(c.sync_next_attempt_at).toISOString() : undefined,
    drive_folder: !!c.remote?.folder_id, archive_folder: !!c.remote?.archive_folder_id, main, archive,
    row_confirmed_at: c.remote?.row_confirmed_at,
  };
}

/** Todas las capturas (o solo las no confirmadas) del dispositivo, de la más antigua a la más reciente. */
export async function syncLedger(repo: CaptureRepo, opts: { archive: boolean; scannerEnabled: boolean; onlyPending?: boolean }): Promise<SyncLedgerRow[]> {
  const caps = (await repo.list()).filter((c) => !opts.onlyPending || c.sync_status !== 'CONFIRMADO').reverse();
  return Promise.all(caps.map(async (c) => ledgerRow(c, await repo.evidences(c.uuid), opts)));
}
