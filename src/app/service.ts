// Servicio de aplicación: une almacenamiento, cola OCR, sincronización y autenticación.
// La UI solo habla con esta clase; las pruebas instancian varias (= varios teléfonos).
import { openCaptureDB } from '../storage/db';
import { syncLedger } from '../sync/ledger';
import { CaptureRepo, type NewEvidence, type QuickFields } from '../storage/repo';
import { OcrQueue, type OcrQueueOptions } from '../pipeline/ocrQueue';
import { SyncEngine, type SyncOptions, type SyncReport } from '../sync/SyncEngine';
import type { AuthAdapter, DriveAdapter, SheetsAdapter } from '../adapters/contracts';
import type { OCRAdapter } from '../ocr/OCRAdapter';
import type { DocumentScanner } from '../scanner/types';
import { ResourceGovernor, type GovernorOptions } from '../pipeline/resources';
import { OCR_FIELDS, type Capture, type CommercialField, type UserProfile } from '../domain/schema';

export interface AppDeps {
  dbName?: string; auth: AuthAdapter; ocr: OCRAdapter; drive: DriveAdapter; sheets: SheetsAdapter;
  /** Smart Document Scanner (detección, recorte, orientación). Sin él, el OCR lee la foto original. */
  scanner?: DocumentScanner;
  /** Drive de respaldo restringido de originales (carpeta separada). */
  archiveDrive?: DriveAdapter;
  /** Control de memoria / recuperación (Android). `false` lo desactiva (pruebas). */
  resources?: GovernorOptions | false;
  ocrOptions?: OcrQueueOptions; syncOptions?: SyncOptions; autoSyncMs?: number; syncDebounceMs?: number;
  /**
   * Reparar automáticamente al arrancar los enlaces de Drive mal archivados (defecto v1.1/v1.2-rc).
   * En producción es `false`: solo se detectan y la reparación requiere confirmación del operador.
   */
  autoRepairLinks?: boolean;
}

export class CaptureApp {
  private timers: ReturnType<typeof setInterval | typeof setTimeout>[] = [];
  private kickTimer?: ReturnType<typeof setTimeout>;
  private constructor(readonly governor: ResourceGovernor | undefined, readonly repo: CaptureRepo, readonly ocr: OcrQueue, readonly sync: SyncEngine, readonly auth: AuthAdapter, private deps: AppDeps) {}

  static async create(deps: AppDeps): Promise<CaptureApp> {
    const repo = new CaptureRepo(await openCaptureDB(deps.dbName));
    const governor = deps.resources === false || !deps.scanner ? undefined : await ResourceGovernor.create(repo, deps.resources ?? {});
    let self: CaptureApp | undefined;
    // Al terminar el OCR la fila de Google se actualiza enseguida (no espera al ciclo automático).
    const ocrOptions = { ...deps.ocrOptions, scanner: deps.scanner, governor, onDone: (u: string) => { deps.ocrOptions?.onDone?.(u); self?.kickSync(); } };
    return self = new CaptureApp(governor, repo, new OcrQueue(repo, deps.ocr, ocrOptions), new SyncEngine(repo, deps.drive, deps.sheets, { ...deps.syncOptions, archive: deps.archiveDrive, scannerEnabled: !!deps.scanner }), deps.auth, deps);
  }

  /** Arranque: retoma OCR pendiente y programa la sincronización automática. */
  async start(): Promise<{ resumedOcr: number; repairedLinks: number; misfiledLinks: number }> {
    const resumedOcr = await this.ocr.start();
    const repairedLinks = this.deps.autoRepairLinks === false ? 0 : await this.sync.repairMisfiledEvidence().catch(() => 0);
    const misfiledLinks = (await this.sync.findMisfiledEvidence().catch(() => ({ evidences: 0 }))).evidences;
    if (this.deps.autoSyncMs) {
      // cola persistente (IndexedDB) con reintentos automáticos: el operador no tiene que pulsar «Sincronizar».
      // Periódico (respeta la espera de cada captura) y, sin esperar, al recuperar la conexión o volver a la app.
      this.timers.push(setInterval(() => void this.syncNow().catch(() => undefined), this.deps.autoSyncMs));
      if (typeof window !== 'undefined') {
        window.addEventListener('online', () => this.kickSync(true));
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.kickSync(true); });
      }
    }
    this.kickSync(true); // al abrir la app
    return { resumedOcr, repairedLinks, misfiledLinks };
  }

  stop() { this.ocr.stop(); for (const t of this.timers) clearInterval(t as never); if (this.kickTimer) clearTimeout(this.kickTimer); }

  async user(): Promise<UserProfile> {
    const u = await this.auth.currentUser();
    if (!u) throw new Error('No hay usuario identificado');
    return u;
  }

  /** Guarda localmente (transacción atómica) y devuelve de inmediato; OCR y sincronización siguen en segundo plano. */
  async saveCapture(evidences: NewEvidence[], quick?: QuickFields): Promise<Capture> {
    const c = await this.repo.createCapture(await this.user(), evidences, quick);
    this.ocr.enqueue(c.uuid);
    this.kickSync();
    return c;
  }

  async editFields(uuid: string, edits: Partial<Record<CommercialField, string>>) {
    const c = await this.repo.applyHumanEdit(uuid, edits, await this.user());
    this.kickSync();
    return c;
  }

  /** Confirmación humana: bloquea todos los valores actuales frente a reprocesos OCR. */
  async confirmReview(uuid: string) {
    const u = await this.user();
    const c = await this.repo.update(uuid, (c) => {
      for (const f of OCR_FIELDS) {
        const m = c.field_meta[f] ?? { source: 'human' as const, status: 'absent' as const };
        c.field_meta[f] = { ...m, status: c.fields[f] ? 'ok' : 'absent', locked: true, reason: `confirmado por ${u.name}` };
      }
      c.review_status = 'REVISADO';
      c.fields.processing_status = 'REVISADO';
    }, { bump: true, audit: { actor: u.id, type: 'REVIEW_CONFIRMED' } });
    this.kickSync();
    return c;
  }

  async reprocessOcr(uuid: string) { await this.ocr.reprocess(uuid, await this.user()); }

  /**
   * Recorte aprobado sobre una captura guardada: el documento recortado ya generado (y visto) pasa a ser el procesado
   * vigente al instante; después se vuelve a leer la tarjeta (las correcciones humanas bloqueadas se conservan).
   */
  async applyCrop(evidenceId: string, quad: { x: number; y: number }[], decision: 'manual' | 'full' | 'auto', image: Blob, rot: number) {
    const u = await this.user();
    const ev = await this.repo.getEvidence(evidenceId);
    if (!ev) throw new Error('Evidencia inexistente');
    await this.repo.applyCrop(evidenceId, quad, decision, image, rot, u);
    await this.ocr.reprocess(ev.capture_uuid, u);
  }

  /** Ajuste manual de esquinas (excepcional) y reproceso de la captura con ellas. */
  async setManualCorners(evidenceId: string, quad: { x: number; y: number }[] | undefined, decision: 'manual' | 'full' | 'auto' = 'manual') {
    const u = await this.user();
    const ev = await this.repo.getEvidence(evidenceId);
    if (!ev) throw new Error('Evidencia inexistente');
    await this.repo.setManualQuad(evidenceId, quad, u, decision);
    await this.ocr.reprocess(ev.capture_uuid, u);
  }

  syncNow(force = false): Promise<SyncReport> { return this.sync.syncAll({ force }); }

  /** Libro de sincronización por captura (sin datos personales): estado, error real y archivos subidos/esperados. */
  syncLedger(onlyPending = false) { return syncLedger(this.repo, { archive: !!this.deps.archiveDrive, scannerEnabled: !!this.deps.scanner, onlyPending }); }

  /** Enlaces de Drive por revisar (solo lectura) y reparación explícita confirmada por el operador. */
  findMisfiledLinks() { return this.sync.findMisfiledEvidence(); }
  async repairMisfiledLinks(): Promise<number> {
    const u = await this.user();
    const n = await this.sync.repairMisfiledEvidence();
    if (n) { await this.repo.addAudit({ capture_uuid: '-', actor: u.id, type: 'DRIVE_LINK_REPAIR_APPROVED', detail: { evidences: n } }); this.kickSync(); }
    return n;
  }

  /** Sincroniza en breve. `force` ignora la espera de las capturas con error (conexión recuperada, app abierta, sesión renovada). */
  kickSync(force = false) {
    if (this.kickTimer) clearTimeout(this.kickTimer);
    this.kickForce ||= force;
    this.kickTimer = setTimeout(() => { const f = this.kickForce; this.kickForce = false; void this.syncNow(f).catch(() => undefined); }, this.deps.syncDebounceMs ?? 1500);
  }
  private kickForce = false;

  /** Inicia o renueva la sesión de Google y reanuda AL MOMENTO las subidas pendientes. */
  async signIn(userId?: string) {
    const u = await this.auth.signIn(userId);
    this.kickSync(true);
    return u;
  }

  async counts() {
    const all = await this.repo.list();
    const by = (k: keyof Capture, v: string) => all.filter((c) => c[k] === v).length;
    return {
      total: all.length,
      local: by('sync_status', 'LOCAL'), pending: by('sync_status', 'PENDIENTE'), syncing: by('sync_status', 'SINCRONIZANDO'),
      confirmed: by('sync_status', 'CONFIRMADO'), syncError: by('sync_status', 'ERROR'),
      ocrPending: all.filter((c) => c.ocr_status === 'CAPTURADO' || c.ocr_status === 'PROCESANDO').length,
      review: by('ocr_status', 'REQUIERE_REVISION'), ocrError: by('ocr_status', 'ERROR'),
    };
  }
}
