import type { OcrLine } from '../domain/schema';

/**
 * Contrato del motor OCR. Solo transforma imagen → líneas de texto con confianza.
 * NO clasifica datos comerciales: eso lo hace src/extract (entidades → normalización → validación → fusión).
 * Implementaciones: PaddleOCR (por defecto), Tesseract.js (alternativa), Remote (p. ej. Google Cloud Vision vía backend), Mock.
 */
export interface OCRAdapter {
  readonly name: string;
  /** Descarga/carga modelos. Idempotente. */
  init(onProgress?: (msg: string) => void): Promise<void>;
  recognize(image: Blob): Promise<OcrOutput>;
  dispose(): Promise<void>;
}

export interface OcrOutput { lines: OcrLine[]; ms: number; engine: string }

/** Error recuperable (p. ej. memoria agotada, modelo aún sin descargar): se reintenta. */
export class OcrTransientError extends Error {}

/** Ordena líneas por posición (arriba→abajo, izquierda→derecha) cuando el motor da cajas. */
export function sortLines(lines: OcrLine[]): OcrLine[] {
  if (!lines.every((l) => l.box?.length)) return lines;
  const cy = (l: OcrLine) => l.box!.reduce((s, p) => s + p[1], 0) / l.box!.length;
  const cx = (l: OcrLine) => Math.min(...l.box!.map((p) => p[0]));
  const h = (l: OcrLine) => Math.max(...l.box!.map((p) => p[1])) - Math.min(...l.box!.map((p) => p[1]));
  const top = (l: OcrLine) => Math.min(...l.box!.map((p) => p[1]));
  const right = (l: OcrLine) => Math.max(...l.box!.map((p) => p[0]));
  const sorted = [...lines].sort((a, b) => cy(a) - cy(b));
  // Une en una fila solo cajas contiguas en horizontal (sin solaparse), con centros verticales cercanos,
  // alturas parecidas y separación pequeña: así "Tel: x" + "Fax: y" quedan juntos, pero no se mezclan
  // líneas inclinadas de una foto ni un logotipo alejado.
  const rows: OcrLine[][] = [];
  for (const l of sorted) {
    const row = rows.find((r) => {
      const last = r[r.length - 1];
      const hh = Math.max(h(last), h(l));
      const gap = cx(l) - right(last);
      return Math.abs(cy(last) - cy(l)) < hh * 0.5 && Math.min(h(last), h(l)) / hh > 0.5 && gap > -hh * 0.2 && gap < hh * 2.5;
    });
    if (row) row.push(l); else rows.push([l]);
  }
  void top;
  return rows.sort((a, b) => cy(a[0]) - cy(b[0])).flatMap((r) => (r.length === 1 ? r : [mergeRow(r.sort((a, b) => cx(a) - cx(b)))]));
}

function mergeRow(row: OcrLine[]): OcrLine {
  // Unir cajas de la misma fila conserva "Tel: xxx" juntos; separador doble = espacio grande.
  return {
    text: row.map((l) => l.text).join('  '),
    score: Math.min(...row.map((l) => l.score)),
    box: row.flatMap((l) => l.box ?? []),
  };
}

/** Reduce fotos grandes de cámara antes del OCR (el original se conserva intacto en IndexedDB). */
export async function prepareImage(blob: Blob, maxSide = 2000): Promise<Blob | ImageBitmap> {
  if (typeof createImageBitmap === 'undefined') return blob;
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  if (scale === 1) return bmp;
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  bmp.close();
  return createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
}

/** Igual que prepareImage pero devuelve un Blob (para motores que no aceptan ImageBitmap). */
export async function prepareImageBlob(blob: Blob, maxSide = 2000): Promise<Blob> {
  const img = await prepareImage(blob, maxSide);
  if (img instanceof Blob || typeof OffscreenCanvas === 'undefined') return img instanceof Blob ? img : blob;
  const cv = new OffscreenCanvas(img.width, img.height);
  cv.getContext('2d')!.drawImage(img, 0, 0);
  img.close();
  return cv.convertToBlob({ type: 'image/png' });
}
