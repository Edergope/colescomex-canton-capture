// Cola OCR persistente y no bloqueante.
// El estado vive en IndexedDB (ocr_status), así que al reabrir la app se retoman las capturas pendientes.
// Procesa de una en una (memoria del teléfono); el motor corre en su propio Web Worker.
import type { CaptureRepo } from '../storage/repo';
import type { OCRAdapter } from '../ocr/OCRAdapter';
import { extractEntities, type SideExtraction } from '../extract/entities';
import { mergeSides } from '../extract/merge';
import type { Capture, OcrResultRecord, UserProfile } from '../domain/schema';

export interface OcrQueueOptions { onDone?: (uuid: string) => void; maxAttempts?: number; retryDelayMs?: (attempt: number) => number; now?: () => number }

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

  stop() { this.stopped = true; for (const t of this.timers) clearTimeout(t); this.timers.clear(); this.queue = []; }

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

  /** Resuelve cuando la cola queda vacía (útil en pruebas). */
  idle(): Promise<void> {
    if (!this.running && this.queue.length === 0 && this.timers.size === 0) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private async pump() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      while (this.queue.length && !this.stopped) await this.process(this.queue.shift()!);
    } finally {
      this.running = false;
      if (this.queue.length === 0 && this.timers.size === 0) { const w = this.idleWaiters; this.idleWaiters = []; w.forEach((r) => r()); }
    }
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
      for (const [side, kind] of [['front', 'card_front'], ['back', 'card_back']] as const) {
        const ev = evs.find((e) => e.kind === kind);
        if (!ev) continue;
        const out = await this.engine.recognize(ev.blob);
        const rec: OcrResultRecord = {
          key: `${uuid}:${side}`, capture_uuid: uuid, side, evidence_id: ev.id, engine: out.engine,
          lines: out.lines, text: out.lines.map((l) => l.text).join('\n'), ms: Math.round(out.ms), created_at: new Date().toISOString(),
        };
        await this.repo.saveOcrResult(rec);
        sides.push({ side, ext: extractEntities(out.lines) });
      }
      const front = sides.find((s) => s.side === 'front')?.ext;
      if (!front) throw new Error('La captura no tiene fotografía frontal');
      const back = sides.find((s) => s.side === 'back')?.ext;
      // La fusión se aplica sobre la versión MÁS RECIENTE de la captura (respeta ediciones hechas mientras tanto).
      await this.repo.update(uuid, (c) => applyMerge(c, front, back, this.engine.name),
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

export function applyMerge(c: Capture, front: SideExtraction, back: SideExtraction | undefined, engine: string) {
  const m = mergeSides(front, back, c);
  for (const [f, v] of Object.entries(m.fields)) (c.fields as Record<string, string>)[f] = v ?? '';
  for (const [f, meta] of Object.entries(m.meta)) (c.field_meta as Record<string, unknown>)[f] = meta;
  c.ocr_status = m.status;
  c.ocr_error = undefined;
  c.ocr_engine = engine;
  c.ocr_extras = m.extras;
  if (c.review_status !== 'REVISADO') c.fields.processing_status = m.status;
}
