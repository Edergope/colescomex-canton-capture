// Sincronización idempotente con Google Drive + Sheets.
// Orden por captura: carpeta → cada evidencia → fila. Cada paso confirmado se persiste localmente,
// por lo que un reintento retoma donde quedó sin duplicar carpetas, archivos ni filas.
// Nunca se borra nada local. CONFIRMADO solo si todas las evidencias y la revisión actual de la fila están en Google.
import type { CaptureRepo } from '../storage/repo';
import type { DriveAdapter, SheetsAdapter } from '../adapters/contracts';
import { AuthRequiredError, TransientRemoteError } from '../adapters/contracts';
import { toSheetRow } from './row';
import type { Capture } from '../domain/schema';

export interface SyncReport { attempted: number; confirmed: number; failed: number; skipped: number; authRequired: boolean; offline: boolean }
export interface SyncOptions { isOnline?: () => boolean; now?: () => number; backoffMs?: (attempt: number) => number }

export class SyncEngine {
  private inFlight?: Promise<SyncReport>;
  private again = false;
  lastReport?: SyncReport;
  constructor(private repo: CaptureRepo, private drive: DriveAdapter, private sheets: SheetsAdapter, private opts: SyncOptions = {}) {}

  private online() { return this.opts.isOnline?.() ?? (typeof navigator === 'undefined' || navigator.onLine !== false); }
  private now() { return this.opts.now?.() ?? Date.now(); }

  needsSync(c: Capture): boolean { return c.synced_revision < c.revision || c.sync_status !== 'CONFIRMADO'; }

  /** Una sola ejecución a la vez; si se pide otra durante la actual, se encadena al terminar. */
  syncAll(opts: { force?: boolean } = {}): Promise<SyncReport> {
    if (this.inFlight) { this.again = true; return this.inFlight; }
    this.inFlight = (async () => {
      let report: SyncReport;
      do { this.again = false; report = await this.runOnce(!!opts.force); } while (this.again && !report.offline && !report.authRequired);
      this.lastReport = report;
      return report;
    })().finally(() => { this.inFlight = undefined; });
    return this.inFlight;
  }

  private async runOnce(force: boolean): Promise<SyncReport> {
    const r: SyncReport = { attempted: 0, confirmed: 0, failed: 0, skipped: 0, authRequired: false, offline: false };
    if (!this.online()) { r.offline = true; return r; }
    const list = (await this.repo.list()).reverse().filter((c) => this.needsSync(c));
    for (const c of list) {
      if (!force && c.sync_next_attempt_at && c.sync_next_attempt_at > this.now()) { r.skipped++; continue; }
      r.attempted++;
      const res = await this.syncOne(c.uuid);
      if (res === 'confirmed') r.confirmed++;
      else if (res === 'pending') r.skipped++;
      else { r.failed++; if (res === 'auth') { r.authRequired = true; break; } if (res === 'offline') { r.offline = true; break; } }
    }
    return r;
  }

  async syncOne(uuid: string): Promise<'confirmed' | 'pending' | 'failed' | 'auth' | 'offline'> {
    const start = await this.repo.update(uuid, (c) => { c.sync_status = 'SINCRONIZANDO'; c.sync_error = undefined; });
    if (!start) return 'failed';
    const rev = start.revision;
    try {
      // 1. Carpeta de evidencias del proveedor
      let folderId = start.remote?.folder_id;
      if (!folderId) {
        const f = await this.drive.ensureCaptureFolder({ capture_uuid: uuid, external_ref: start.external_ref });
        folderId = f.folderId;
        await this.repo.update(uuid, (c) => { c.remote = { ...c.remote, folder_id: f.folderId, folder_url: f.url }; });
      }
      // 2. Evidencias (idempotente por evidence_id)
      for (const e of await this.repo.evidences(uuid)) {
        if (e.remote_file_id) continue;
        const up = await this.drive.uploadEvidence(folderId, {
          evidence_id: e.id, capture_uuid: uuid, external_ref: start.external_ref, kind: e.kind, file_name: e.file_name, mime: e.mime, blob: e.blob,
        });
        await this.repo.updateEvidence(e.id, { remote_file_id: up.fileId, remote_url: up.url, uploaded_at: new Date(this.now()).toISOString() });
      }
      // 3. Fila (upsert por capture_uuid) con la versión actual de la captura
      const cur = (await this.repo.get(uuid))!;
      const evs = await this.repo.evidences(uuid);
      if (evs.some((e) => !e.remote_file_id)) throw new Error('Evidencias sin confirmar en Drive');
      const sentRev = cur.revision;
      const row = toSheetRow(cur, evs, await this.repo.ocrResults(uuid));
      const res = await this.sheets.upsertRow(row);
      const done = await this.repo.update(uuid, (c) => {
        c.synced_revision = Math.max(c.synced_revision, sentRev);
        c.sync_attempts = 0; c.sync_next_attempt_at = undefined; c.sync_error = undefined;
        c.remote = { ...c.remote, row_confirmed_at: new Date(this.now()).toISOString() };
        // Si los datos cambiaron mientras se enviaba (p. ej. terminó el OCR), queda pendiente otra vez.
        c.sync_status = c.revision === c.synced_revision ? 'CONFIRMADO' : 'PENDIENTE';
      }, { audit: { actor: 'system', type: 'SYNC_CONFIRMED', detail: { revision: sentRev, row: res.rowNumber, action: res.action, started_rev: rev } } });
      if (done?.sync_status === 'PENDIENTE') this.again = true;
      return done?.sync_status === 'CONFIRMADO' ? 'confirmed' : 'pending';
    } catch (e) {
      const auth = e instanceof AuthRequiredError;
      const transient = e instanceof TransientRemoteError;
      const msg = auth ? `${(e as Error).message}. Inicia sesión en Google y pulsa "Sincronizar".`
        : transient ? `${(e as Error).message}. Se reintentará automáticamente.` : (e as Error).message;
      await this.repo.update(uuid, (c) => {
        c.sync_status = 'ERROR'; c.sync_error = msg; c.sync_attempts += 1;
        c.sync_next_attempt_at = this.now() + (this.opts.backoffMs?.(c.sync_attempts) ?? Math.min(10 * 60_000, 5_000 * 2 ** c.sync_attempts));
      }, { audit: { actor: 'system', type: 'SYNC_FAILED', detail: msg } });
      return auth ? 'auth' : !this.online() ? 'offline' : 'failed';
    }
  }
}
