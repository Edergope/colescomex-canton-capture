import type { OCRAdapter, OcrOutput } from './OCRAdapter';
import { OcrTransientError } from './OCRAdapter';
import type { AuthAdapter } from '../adapters/contracts';

/**
 * OCR remoto opcional (p. ej. Google Cloud Vision DOCUMENT_TEXT_DETECTION) a través de un BACKEND propio.
 * El navegador nunca contiene la clave de Vision: envía la imagen con el token del usuario y el backend
 * responde { lines: [{ text, score, box? }] }. Contrato en docs/INTEGRATION_CONTRACTS.md §4.
 */
export class RemoteOCRAdapter implements OCRAdapter {
  readonly name: string;
  constructor(private endpoint: string, private auth: AuthAdapter, engineName = 'remote') { this.name = `remote:${engineName}`; }
  async init(): Promise<void> {}
  async recognize(image: Blob): Promise<OcrOutput> {
    const t0 = performance.now();
    const token = await this.auth.getAccessToken();
    let res: Response;
    try {
      res = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': image.type || 'application/octet-stream', Authorization: `Bearer ${token}` }, body: image });
    } catch (e) { throw new OcrTransientError(`OCR remoto no disponible: ${(e as Error).message}`); }
    if (res.status >= 500 || res.status === 429) throw new OcrTransientError(`OCR remoto HTTP ${res.status}`);
    if (!res.ok) throw new Error(`OCR remoto HTTP ${res.status}`);
    const body = (await res.json()) as { lines: OcrOutput['lines'] };
    return { lines: body.lines, ms: performance.now() - t0, engine: this.name };
  }
  async dispose(): Promise<void> {}
}
