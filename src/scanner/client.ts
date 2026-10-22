// Cliente del Worker del escáner (hilo principal). Una sola instancia de Worker para toda la app.
import type { DocumentScanner, RenderOptions, ScanAnalysis, ScanOptions, ScanSession } from './types';

export class WorkerScanner implements DocumentScanner {
  private worker?: Worker;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  constructor(private base = new URL(`${import.meta.env.BASE_URL}ocr-assets/`, location.href).href) {}

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new Worker(new URL('./scanner.worker.ts', import.meta.url), { type: 'module', name: 'cx-scanner' });
    w.onmessage = (e) => {
      const p = this.pending.get(e.data.id); if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data); else p.reject(new Error(e.data.error));
    };
    w.onerror = (e) => { for (const p of this.pending.values()) p.reject(new Error(`Escáner: ${e.message}`)); this.pending.clear(); this.worker = undefined; };
    this.worker = w;
    void this.call('init', { base: this.base });
    return w;
  }

  private call<T>(type: string, data: Record<string, unknown>, id = ++this.seq): Promise<T> {
    const w = this.ensure();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      w.postMessage({ id, type, ...data });
    });
  }

  /** Termina el Worker: devuelve al sistema toda su memoria (WASM incluido). Las sesiones abiertas quedan inválidas. */
  terminate(): void {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = undefined;
    for (const p of this.pending.values()) p.reject(new Error('Escáner terminado para liberar memoria'));
    this.pending.clear();
  }

  async scan(blob: Blob, opts: ScanOptions = {}): Promise<ScanSession> {
    const sid = ++this.seq;
    const { analysis } = await this.call<{ analysis: ScanAnalysis }>('scan', { blob, manualQuad: opts.manualQuad, detect: opts.detect, maxOutputSide: opts.maxOutputSide, fullSide: opts.fullSide }, sid);
    let released = false;
    return {
      analysis,
      render: async (rot: number, o: RenderOptions = {}) => (await this.call<{ blob: Blob }>('render', { sid, rot, maxSide: o.maxSide, quality: o.quality })).blob,
      release: () => { if (!released) { released = true; void this.call('release', { sid }).catch(() => undefined); } },
    };
  }
}
