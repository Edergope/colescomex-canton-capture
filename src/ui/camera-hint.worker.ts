/// <reference lib="webworker" />
// Pista de encuadre en vivo: ejecuta el detector REAL del motor (detectDocument) sobre fotogramas reducidos.
// Solo orienta al usuario; el recorte definitivo lo calcula la tubería completa sobre la foto a resolución completa.
import { detectDocument } from '../scanner/detect';
import { BUSINESS_CARD } from '../scanner/profiles';

declare const self: DedicatedWorkerGlobalScope;
self.onmessage = (e: MessageEvent<{ id: number; width: number; height: number; buffer: ArrayBuffer }>) => {
  const { id, width, height, buffer } = e.data;
  try {
    const img = { width, height, data: new Uint8ClampedArray(buffer) };
    const r = detectDocument(img, { work: img, fine: img }, BUSINESS_CARD.detect);
    self.postMessage({ id, status: r.status, multiple: r.multiple, confidence: r.confidence,
      quad: r.quad?.map((p) => ({ x: p.x / width, y: p.y / height })) });
  } catch (err) {
    self.postMessage({ id, status: 'not_found', multiple: false, confidence: 0, error: String(err) });
  }
};
