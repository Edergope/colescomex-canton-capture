import type { OCRAdapter, OcrOutput } from './OCRAdapter';
import type { OcrLine } from '../domain/schema';

/**
 * OCR simulado para desarrollo y pruebas. Lee el texto "impreso" en el propio Blob de prueba
 * (formato: líneas de texto UTF-8, opcionalmente "texto|confianza") o usa un resolver inyectado.
 */
export class MockOCRAdapter implements OCRAdapter {
  readonly name = 'mock';
  calls = 0;
  failNext = 0;
  constructor(private opts: { delayMs?: number; resolver?: (b: Blob) => Promise<OcrLine[]> } = {}) {}
  async init(): Promise<void> {}
  async recognize(image: Blob): Promise<OcrOutput> {
    this.calls++;
    const t0 = Date.now();
    if (this.opts.delayMs) await new Promise((r) => setTimeout(r, this.opts.delayMs));
    if (this.failNext > 0) { this.failNext--; throw new Error('Fallo OCR simulado'); }
    const lines = this.opts.resolver ? await this.opts.resolver(image) : parseMockBlob(await image.text());
    return { lines, ms: Date.now() - t0, engine: this.name };
  }
  async dispose(): Promise<void> {}
}

export function parseMockBlob(text: string): OcrLine[] {
  const marker = text.indexOf('MOCKOCR\n');
  const body = marker >= 0 ? text.slice(marker + 8) : '';
  return body.split('\n').filter(Boolean).map((l) => {
    const [t, s] = l.split('|');
    return { text: t, score: s ? Number(s) : 0.97 };
  });
}
