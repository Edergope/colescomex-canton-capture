// Cola OCR persistente y no bloqueante.
// El estado vive en IndexedDB (ocr_status), así que al reabrir la app se retoman las capturas pendientes.
// Procesa de una en una (memoria del teléfono); el motor corre en su propio Web Worker.
import type { CaptureRepo } from '../storage/repo';
import type { OCRAdapter } from '../ocr/OCRAdapter';
import { extractEntities, type SideExtraction } from '../extract/entities';
import { mergeSides } from '../extract/merge';
import type { Capture, Evidence, EvidenceScan, OcrLine, OcrResultRecord, UserProfile } from '../domain/schema';
import type { DocumentScanner } from '../scanner/types';
import { processDocument } from '../scanner/engine';
import { BUSINESS_CARD } from '../scanner/profiles';
import type { ResourceGovernor } from './resources';

/** Lado mayor de la imagen que se entrega al OCR (perfil de tarjeta comercial). */
export const OCR_INPUT_SIDE = BUSINESS_CARD.ocrInputSide;

export interface OcrQueueOptions { scanner?: DocumentScanner; governor?: ResourceGovernor; onDone?: (uuid: string) => void; maxAttempts?: number; retryDelayMs?: (attempt: number) => number; now?: () => number }

export class OcrQueue {
  private queue: string[] = [];
  private running = false;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private idleWaiters: (() => void)[] = [];
  private stopped = false;
  readonly maxAttempts: number;
  constructor(private repo: CaptureRepo, private engine: OCRAdapter, private opts: OcrQueueOptions = {}) {
    this.maxAttempts = opts.maxAttempts ?? 3;
  }

  /** Recupera trabajo pendiente tras abrir la app (incluye los que quedaron en PROCESANDO al cerrarla). */
  async start(): Promise<number> {
    this.stopped = false;
    const pending = (await this.repo.list()).filter((c) => c.ocr_status === 'CAPTURADO' || c.ocr_status === 'PROCESANDO').reverse();
    for (const c of pending) this.enqueue(c.uuid);
    return pending.length;
  }

  stop() { this.stopped = true; if (this.idleTimer) clearTimeout(this.idleTimer); for (const t of this.timers) clearTimeout(t); this.timers.clear(); this.queue = []; }

  enqueue(uuid: string) {
    if (!this.queue.includes(uuid)) this.queue.push(uuid);
    void this.pump();
  }

  /** Reproceso manual (p. ej. tras un ERROR). Conserva las correcciones humanas bloqueadas. */
  async reprocess(uuid: string, user: UserProfile) {
    await this.repo.update(uuid, (c) => { c.ocr_status = 'CAPTURADO'; c.ocr_attempts = 0; c.ocr_error = undefined; c.fields.processing_status = 'CAPTURADO'; },
      { audit: { actor: user.id, type: 'OCR_REPROCESS_REQUESTED' } });
    this.enqueue(uuid);
  }

  /** true mientras un documento se está escaneando o leyendo (una recarga ahora se tomaría por un cierre por memoria). */
  get busy(): boolean { return this.running; }

  /** Resuelve cuando la cola queda vacía (útil en pruebas). */
  idle(): Promise<void> {
    if (!this.running && this.queue.length === 0 && this.timers.size === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private idleTimer?: ReturnType<typeof setTimeout>;
  /** Sin trabajo pendiente, se libera PaddleOCR (y el escáner) para devolver memoria al teléfono. */
  private scheduleIdleRelease() {
    const ms = this.opts.governor?.idleReleaseMs;
    if (!ms || this.stopped) return;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.running || this.queue.length) return;
      void this.engine.dispose(); this.opts.scanner?.terminate?.();
    }, ms);
  }

  private async pump() {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (this.queue.length && !this.stopped) await this.process(this.queue.shift()!);
    } finally {
      this.running = false;
      if (this.queue.length === 0 && this.timers.size === 0) {
        const w = this.idleWaiters; this.idleWaiters = []; w.forEach((r) => r());
        this.scheduleIdleRelease();
      }
    }
  }

  private async readSide(uuid: string, side: 'front' | 'back', ev: Evidence, issues: string[], attempt: number): Promise<OcrLine[]> {
    const label = side === 'front' ? 'frontal' : 'reverso';
    const gov = this.opts.governor;
    const mode = gov?.modeFor(attempt) ?? 'normal';
    const r = await processDocument({ ocr: this.engine, scanner: this.opts.scanner, governor: gov },
      // «auto» = recorte automático aprobado: se procesa ese recorte (afinado solo si la detección completa coincide)
      { blob: ev.blob, profile: BUSINESS_CARD, jobId: uuid, ...(ev.crop?.decision === 'auto' ? { approvedQuad: ev.scan?.manual_quad as never } : { manualQuad: ev.scan?.manual_quad as never }), mode });
    let procId: string | undefined;
    const a = r.analysis;
    if (a) {
      const scan: EvidenceScan = {
        status: a.status, confidence: a.confidence, quad: a.quad, method: a.method, multiple: a.multiple, reasons: a.reasons,
        cropped: a.cropped, rotation: r.rotation * 90,
        orientation_source: r.orientation?.source ?? (a.orientationProbs ? 'classifier' : 'none'), orientation_confident: !!r.orientation?.confident,
        orientation_probs: a.orientationProbs ?? undefined,
        trials: r.orientation?.trials.map((t) => ({ rot: t.rot * 90, prior: +t.prior.toFixed(3), score: t.reading.score })),
        source_size: a.source, output_size: a.output, ms: { ...a.ms, pipeline: r.ms }, at: new Date().toISOString(),
        manual_quad: ev.scan?.manual_quad, mode: r.mode,
      };
      // Solo un recorte fiable se convierte en la imagen principal; si no, se conserva la foto y se pide revisión.
      procId = await this.repo.saveScanResult(uuid, ev.id, scan, r.processed);
    }
    for (const is of r.issues) {
      if (is.code === 'not_cropped') issues.push(`Tarjeta ${label}: ${is.multiple ? 'varias tarjetas en la foto' : 'bordes no detectados con confianza'} — se conserva la foto original; ajuste las esquinas si es necesario`);
      if (is.code === 'orientation_uncertain') issues.push(`Tarjeta ${label}: orientación del texto incierta`);
      if (is.code === 'scanner_unavailable') issues.push(`Tarjeta ${label}: escáner no disponible (${is.message}); se leyó la foto original`);
      if (is.code === 'minimal_mode') issues.push(`Tarjeta ${label}: procesada sin escáner tras ${attempt - 1} intento(s) fallido(s) (modo de recuperación); se leyó la foto original`);
    }
    if (r.ocrError) throw r.ocrError;
    await this.saveResult(uuid, side, ev.id, r.engine, r.lines, r.ms, r.rotation * 90, procId ?? ev.id);
    return r.lines;
  }

  private async saveResult(uuid: string, side: 'front' | 'back', evidenceId: string, engine: string, lines: OcrLine[], ms: number, rotation: number, readFrom: string) {
    const prev = (await this.repo.ocrResults(uuid)).find((r) => r.side === side);
    // trazabilidad: el resultado anterior queda en la auditoría antes de sustituirse
    if (prev) await this.repo.addAudit({ capture_uuid: uuid, actor: 'system', type: 'OCR_RESULT_SUPERSEDED', detail: { side, engine: prev.engine, created_at: prev.created_at, rotation: prev.rotation ?? 0, text: prev.text } });
    const rec: OcrResultRecord = {
      key: `${uuid}:${side}`, capture_uuid: uuid, side, evidence_id: evidenceId, engine, lines,
      text: lines.map((l) => l.text).join('\n'), ms: Math.round(ms), created_at: new Date().toISOString(), rotation, read_from: readFrom,
    };
    await this.repo.saveOcrResult(rec);
  }

  private async process(uuid: string) {
    const started = await this.repo.update(uuid, (c) => {
      if (!['CAPTURADO', 'PROCESANDO'].includes(c.ocr_status)) return false;
      c.ocr_status = 'PROCESANDO'; c.ocr_attempts += 1; c.fields.processing_status = 'PROCESANDO';
    });
    if (!started || started.ocr_status !== 'PROCESANDO') return;
    try {
      const evs = await this.repo.evidences(uuid);
      const sides: { side: 'front' | 'back'; ext: SideExtraction }[] = [];
      const issues: string[] = [];
      for (const [side, kind] of [['front', 'card_front'], ['back', 'card_back']] as const) {
        const ev = evs.find((e) => e.kind === kind && e.role !== 'processed');
        if (!ev) continue;
        const r = await this.readSide(uuid, side, ev, issues, started.ocr_attempts);
        sides.push({ side, ext: extractEntities(r) });
      }
      const front = sides.find((s) => s.side === 'front')?.ext;
      if (!front) throw new Error('La captura no tiene fotografía frontal');
      const back = sides.find((s) => s.side === 'back')?.ext;
      // La fusión se aplica sobre la versión MÁS RECIENTE de la captura (respeta ediciones hechas mientras tanto).
      await this.repo.update(uuid, (c) => { c.scan_issues = issues; applyMerge(c, front, back, this.engine.name); },
        { bump: true, audit: { actor: 'system', type: 'OCR_DONE', detail: { engine: this.engine.name } } });
      this.opts.onDone?.(uuid);
    } catch (e) {
      const msg = (e as Error).message || String(e);
      const c = await this.repo.update(uuid, (c) => {
        const retry = c.ocr_attempts < this.maxAttempts;
        c.ocr_status = retry ? 'CAPTURADO' : 'ERROR';
        c.ocr_error = msg;
        c.fields.processing_status = retry ? 'CAPTURADO' : 'ERROR';
      }, { bump: false, audit: { actor: 'system', type: 'OCR_FAILED', detail: msg } });
      if (c && c.ocr_status === 'CAPTURADO' && !this.stopped) {
        const delay = this.opts.retryDelayMs?.(c.ocr_attempts) ?? Math.min(60_000, 2_000 * 2 ** c.ocr_attempts);
        const t = setTimeout(() => { this.timers.delete(t); this.enqueue(uuid); }, delay);
        this.timers.add(t);
      }
    }
  }
}

/** Lado de la tarjeta: escáner → orientación → OCR; guarda el documento procesado y el resultado OCR. */
export interface SideReader { readSide(uuid: string, side: 'front' | 'back', ev: Evidence, issues: string[]): Promise<OcrLine[]> }

export function applyMerge(c: Capture, front: SideExtraction, back: SideExtraction | undefined, engine: string) {
  const m = mergeSides(front, back, c);
  for (const [f, v] of Object.entries(m.fields)) (c.fields as Record<string, string>)[f] = v ?? '';
  for (const [f, meta] of Object.entries(m.meta)) (c.field_meta as Record<string, unknown>)[f] = meta;
  c.ocr_status = m.status;
  c.ocr_error = undefined;
  c.ocr_engine = engine;
  c.ocr_extras = m.extras;
  // incidencias del escáner (bordes dudosos, varias tarjetas, orientación incierta) → revisión humana
  if (c.scan_issues?.length) c.ocr_status = 'REQUIERE_REVISION';
  if (c.review_status !== 'REVISADO') c.fields.processing_status = c.ocr_status;
}
