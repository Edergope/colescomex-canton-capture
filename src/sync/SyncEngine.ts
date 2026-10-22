// Sincronización idempotente con Google Drive + Sheets.
// Orden por captura: carpeta → cada evidencia → fila. Cada paso confirmado se persiste localmente,
// por lo que un reintento retoma donde quedó sin duplicar carpetas, archivos ni filas.
// Nunca se borra nada local. CONFIRMADO solo si todas las evidencias y la revisión actual de la fila están en Google.
import type { CaptureRepo } from '../storage/repo';
import type { DriveAdapter, SheetsAdapter } from '../adapters/contracts';
import { AuthRequiredError, TransientRemoteError } from '../adapters/contracts';
import { toSheetRow } from './row';
import type { Capture, Evidence } from '../domain/schema';

export interface SyncReport { attempted: number; confirmed: number; failed: number; skipped: number; authRequired: boolean; offline: boolean }
export interface SyncOptions {
  isOnline?: () => boolean; now?: () => number; backoffMs?: (attempt: number) => number;
  /** Drive de archivo de originales (carpeta separada con permisos restringidos). Opcional. */
  archive?: DriveAdapter;
  /** con escáner activo, las fotos de tarjeta no van a la carpeta principal hasta conocer el resultado del escaneo */
  scannerEnabled?: boolean;
}

/** Qué hacer con una evidencia en cada destino. */
export type Action = 'upload' | 'done' | 'skip' | 'wait';
export interface EvidencePlan { main: Action; archive: Action }

/**
 * Destinos de cada evidencia (dos destinos independientes):
 * - carpeta del proveedor (`main`): procesada vigente; original solo si no hay recorte fiable (o escáner desactivado);
 *   mientras la tarjeta no se ha escaneado, se espera (nunca se publica la foto con manos por adelantarse).
 * - respaldo restringido (`archive`): TODOS los originales de tarjeta, desde la primera sincronización
 *   (incluidos los que ya estaban en la carpeta principal por versiones anteriores).
 */
export function uploadPlan(c: Capture, evs: Evidence[], opts: { archive: boolean; scannerEnabled: boolean }): Map<string, EvidencePlan> {
  const plan = new Map<string, EvidencePlan>();
  const ocrPending = c.ocr_status === 'CAPTURADO' || c.ocr_status === 'PROCESANDO';
  for (const e of evs) {
    const card = e.kind === 'card_front' || e.kind === 'card_back';
    let main: Action, archive: Action = 'skip';
    if (e.role === 'processed') main = e.superseded_by && !e.remote_file_id ? 'skip' : 'upload';
    else if (!card || !opts.scannerEnabled) main = 'upload';
    else {
      const processed = evs.find((p) => p.role === 'processed' && p.derived_from === e.id && !p.superseded_by);
      main = processed ? 'skip' : !e.scan && ocrPending ? 'wait' : 'upload';
      if (opts.archive) archive = 'upload';
    }
    if (e.remote_file_id && main !== 'skip') main = 'done';
    if (e.remote_file_id && main === 'skip' && e.role !== 'processed') main = 'done'; // original ya publicado por una versión anterior
    if (e.archive_file_id) archive = 'done';
    plan.set(e.id, { main, archive });
  }
  return plan;
}

/** Caras de tarjeta sin representación en la carpeta principal (ni procesada ni original): no se puede confirmar. */
export function mainCoverageMissing(evs: Evidence[], plan: Map<string, EvidencePlan>): boolean {
  const originals = evs.filter((e) => (e.kind === 'card_front' || e.kind === 'card_back') && e.role !== 'processed');
  return originals.some((o) => {
    const proc = evs.find((p) => p.role === 'processed' && p.derived_from === o.id && !p.superseded_by);
    const ok = (id?: string) => !!id && ['upload', 'done'].includes(plan.get(id)!.main);
    return !ok(proc?.id) && !ok(o.id);
  });
}

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
      // 2. Evidencias (idempotente por evidence_id) según el plan de destinos.
      //    Primero el respaldo restringido de originales (protección temprana), después la carpeta del proveedor.
      const planOpts = { archive: !!this.opts.archive, scannerEnabled: !!this.opts.scannerEnabled };
      const plan = uploadPlan(start, await this.repo.evidences(uuid), planOpts);
      for (const e of await this.repo.evidences(uuid)) {
        if (plan.get(e.id)?.archive !== 'upload') continue;
        let af = (await this.repo.get(uuid))!.remote?.archive_folder_id;
        if (!af) {
          const f = await this.opts.archive!.ensureCaptureFolder({ capture_uuid: uuid, external_ref: start.external_ref });
          af = f.folderId;
          await this.repo.update(uuid, (c) => { c.remote = { ...c.remote, archive_folder_id: f.folderId }; });
        }
        const up = await this.opts.archive!.uploadEvidence(af, {
          evidence_id: e.id, capture_uuid: uuid, external_ref: start.external_ref, kind: e.kind, file_name: e.file_name, mime: e.mime, blob: e.blob, sha256: e.sha256,
        });
        await this.repo.updateEvidence(e.id, { archive_file_id: up.fileId, archive_url: up.url, archived_at: new Date(this.now()).toISOString() });
      }
      for (const e of await this.repo.evidences(uuid)) {
        if (plan.get(e.id)?.main !== 'upload') continue;
        const up = await this.drive.uploadEvidence(folderId, {
          evidence_id: e.id, capture_uuid: uuid, external_ref: start.external_ref, kind: e.kind, file_name: e.file_name, mime: e.mime, blob: e.blob, sha256: e.sha256,
        });
        await this.repo.updateEvidence(e.id, { remote_file_id: up.fileId, remote_url: up.url, uploaded_at: new Date(this.now()).toISOString(), remote_target: 'main' });
      }
      // 3. Fila (upsert por capture_uuid) con la versión actual de la captura
      const cur = (await this.repo.get(uuid))!;
      const evs = await this.repo.evidences(uuid);
      const plan2 = uploadPlan(cur, evs, planOpts);
      if ([...plan2.values()].some((p) => p.main === 'upload' || p.archive === 'upload')) throw new Error('Evidencias sin confirmar en Drive');
      const waiting = [...plan2.values()].some((p) => p.main === 'wait') || mainCoverageMissing(evs, plan2);
      const sentRev = cur.revision;
      const row = toSheetRow(cur, evs, await this.repo.ocrResults(uuid));
      const res = await this.sheets.upsertRow(row);
      const done = await this.repo.update(uuid, (c) => {
        c.synced_revision = Math.max(c.synced_revision, sentRev);
        c.sync_attempts = 0; c.sync_next_attempt_at = undefined; c.sync_error = undefined;
        c.remote = { ...c.remote, row_confirmed_at: new Date(this.now()).toISOString() };
        // Si los datos cambiaron mientras se enviaba (p. ej. terminó el OCR) o falta subir la tarjeta escaneada,
        // queda pendiente: nunca se declara CONFIRMADO con evidencias principales solo en el teléfono.
        c.sync_status = c.revision === c.synced_revision && !waiting ? 'CONFIRMADO' : 'PENDIENTE';
      }, { audit: { actor: 'system', type: 'SYNC_CONFIRMED', detail: { revision: sentRev, row: res.rowNumber, action: res.action, started_rev: rev } } });
      if (done?.sync_status === 'PENDIENTE' && !waiting) this.again = true;
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
