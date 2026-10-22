import type { OCRAdapter, OcrOutput } from './OCRAdapter';
import { OcrTransientError, prepareImage, sortLines } from './OCRAdapter';

type PaddleInstance = { predict: (img: unknown, params?: Record<string, unknown>) => Promise<{ items: { text: string; score: number; poly: number[][] }[] }[]>; dispose: () => Promise<void> | void };

/**
 * PaddleOCR.js (PP-OCRv5 mobile, modelo multilingüe chino+inglés) sobre ONNX Runtime Web (WASM),
 * ejecutado en un Web Worker propio del SDK. Modelos y WASM auto-hospedados en /ocr-assets.
 */
export class PaddleOCRAdapter implements OCRAdapter {
  get name() { return `paddleocr-js@0.4.2/${this.model}`; }
  private get model() { return this.opts.model ?? 'PP-OCRv5_mobile'; }
  private ocr?: PaddleInstance;
  private initPromise?: Promise<void>;
  constructor(private base = `${import.meta.env.BASE_URL}ocr-assets/`, private opts: { maxSide?: number; detLimit?: number; model?: 'PP-OCRv5_mobile' | 'PP-OCRv6_tiny' } = {}) {}

  init(onProgress?: (msg: string) => void): Promise<void> {
    this.initPromise ??= (async () => {
      onProgress?.('Cargando motor OCR…');
      const { PaddleOCR } = await import('@paddleocr/paddleocr-js');
      const abs = (p: string) => new URL(this.base + p, location.href).href;
      this.ocr = (await PaddleOCR.create({
        textDetectionModelName: `${this.model}_det`,
        textDetectionModelAsset: { url: abs(`models/${this.model}_det_onnx_infer.tar`) },
        textRecognitionModelName: `${this.model}_rec`,
        textRecognitionModelAsset: { url: abs(`models/${this.model}_rec_onnx_infer.tar`) },
        worker: true,
        ortOptions: {
          backend: 'wasm',
          // Variante WASM simple (sin WebGPU/JSEP): 14 MB en lugar de 28 MB.
          wasmPaths: { mjs: abs('ort/ort-wasm-simd-threaded.mjs'), wasm: abs('ort/ort-wasm-simd-threaded.wasm') },
          numThreads: globalThis.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1,
          simd: true,
        },
      } as never)) as unknown as PaddleInstance;
      onProgress?.('Motor OCR listo');
    })().catch((e) => { this.initPromise = undefined; throw new OcrTransientError(`No se pudo iniciar PaddleOCR: ${(e as Error).message}`); });
    return this.initPromise;
  }

  async recognize(image: Blob): Promise<OcrOutput> {
    await this.init();
    const t0 = performance.now();
    const input = await prepareImage(image, this.opts.maxSide ?? 1600);
    const [res] = await this.ocr!.predict(input, { textDetLimitSideLen: this.opts.detLimit ?? 960, textDetLimitType: 'max' });
    const lines = sortLines(res.items.filter((i) => i.text.trim()).map((i) => ({ text: i.text, score: i.score, box: i.poly })));
    return { lines, ms: performance.now() - t0, engine: this.name };
  }

  async dispose(): Promise<void> { await this.ocr?.dispose(); this.ocr = undefined; this.initPromise = undefined; }
}
