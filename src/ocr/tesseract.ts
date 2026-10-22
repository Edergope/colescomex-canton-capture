import type { OCRAdapter, OcrOutput } from './OCRAdapter';
import { OcrTransientError, prepareImageBlob } from './OCRAdapter';
import type { OcrLine } from '../domain/schema';

/** Tesseract.js 7 (eng + chi_sim, LSTM). Alternativa evaluada; recursos locales en /ocr-assets/tesseract. */
export class TesseractOCRAdapter implements OCRAdapter {
  readonly name = 'tesseract.js@7/eng+chi_sim';
  private worker?: { recognize: (img: unknown, o?: unknown, out?: unknown) => Promise<{ data: { blocks?: { paragraphs: { lines: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] }[] }[] } }>; terminate: () => Promise<unknown> };
  private initPromise?: Promise<void>;
  constructor(private base = `${import.meta.env.BASE_URL}ocr-assets/tesseract/`) {}

  init(onProgress?: (msg: string) => void): Promise<void> {
    this.initPromise ??= (async () => {
      onProgress?.('Cargando Tesseract…');
      const { createWorker } = await import('tesseract.js');
      const abs = (p: string) => new URL(this.base + p, location.href).href;
      this.worker = (await createWorker(['eng', 'chi_sim'], 1, {
        workerPath: abs('worker.min.js'), corePath: abs(''), langPath: abs('').replace(/\/$/, ''), gzip: false, cacheMethod: 'none',
      })) as never;
    })().catch((e) => { this.initPromise = undefined; throw new OcrTransientError(`No se pudo iniciar Tesseract: ${(e as Error).message}`); });
    return this.initPromise;
  }

  async recognize(image: Blob): Promise<OcrOutput> {
    await this.init();
    const t0 = performance.now();
    const input = await prepareImageBlob(image, 2000);
    const { data } = await this.worker!.recognize(input, {}, { blocks: true, text: false });
    const lines: OcrLine[] = [];
    for (const b of data.blocks ?? []) for (const p of b.paragraphs) for (const l of p.lines) {
      // Tesseract separa los caracteres chinos con espacios: se eliminan solo entre caracteres CJK.
      const text = l.text.trim().replace(/(?<=[一-鿿])\s+(?=[一-鿿])/g, '');
      if (text) lines.push({ text, score: l.confidence / 100, box: [[l.bbox.x0, l.bbox.y0], [l.bbox.x1, l.bbox.y0], [l.bbox.x1, l.bbox.y1], [l.bbox.x0, l.bbox.y1]] });
    }
    return { lines, ms: performance.now() - t0, engine: this.name };
  }

  async dispose(): Promise<void> { await this.worker?.terminate(); this.worker = undefined; this.initPromise = undefined; }
}
