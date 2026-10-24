// Vista previa REAL del escáner en la captura: el mismo detector y la misma corrección de perspectiva que el
// procesamiento final, sobre la foto recién tomada. Lo que el operador aprueba es lo que se procesa (las esquinas
// aprobadas se guardan con la evidencia). Worker propio, cerrado al salir de la cámara.
import { WorkerScanner } from '../scanner/client';
import { BUSINESS_CARD } from '../scanner/profiles';
import type { Quad } from '../scanner/homography';
import type { ScanAnalysis } from '../scanner/types';

/** Lado máximo decodificado para la vista previa: suficiente para ver y ajustar, con poca memoria. */
export const PREVIEW_SIDE = 2000;

export interface PreviewResult {
  analysis: ScanAnalysis;
  /** documento rectificado y orientado (o la foto completa reducida si no hay recorte) */
  image: Blob;
  /** cuartos de vuelta aplicados para mostrarlo derecho (clasificador de orientación) */
  rot: number;
}

export class ScanPreview {
  private scanner?: WorkerScanner;
  private token = 0;

  /** Analiza la foto. `manualQuad` (esquinas en la foto original) fuerza un recorte concreto (ajuste manual). */
  async analyze(blob: Blob, manualQuad?: Quad): Promise<PreviewResult | null> {
    const my = ++this.token;
    this.scanner ??= new WorkerScanner();
    const session = await this.scanner.scan(blob, { detect: BUSINESS_CARD.detect, fullSide: PREVIEW_SIDE, maxOutputSide: 1400, manualQuad });
    try {
      if (my !== this.token) return null; // llegó otra foto mientras tanto
      const p = session.analysis.orientationProbs;
      // el clasificador da la probabilidad de cada giro del contenido; se endereza con el más probable
      const rot = p ? (4 - p.indexOf(Math.max(...p))) % 4 : 0;
      const image = await session.render(rot, { maxSide: 1400, quality: 0.85 });
      return my === this.token ? { analysis: session.analysis, image, rot } : null;
    } finally { session.release(); }
  }

  cancel() { this.token++; }
  close() { this.cancel(); this.scanner?.terminate(); this.scanner = undefined; }
}

/** Esquinas de la foto completa (para «Conservar foto completa»). */
export function fullFrame(a: { source: { width: number; height: number } }): Quad {
  const { width: w, height: h } = a.source;
  return [{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 }];
}

export type CropState = 'analyzing' | 'auto_ok' | 'auto_doubtful' | 'not_found' | 'multiple' | 'auto_accepted' | 'manual' | 'full' | 'error';

/**
 * Estado que se muestra al operador. Ver un recorte NO es aprobarlo: sin decisión explícita los estados son
 * propuestas pendientes; solo «auto_accepted», «manual» y «full» son decisiones del operador.
 */
export function cropState(a: ScanAnalysis | undefined, decision?: 'auto' | 'manual' | 'full'): CropState {
  if (decision === 'auto') return 'auto_accepted';
  if (decision === 'manual') return 'manual';
  if (decision === 'full') return 'full';
  if (!a) return 'analyzing';
  if (a.multiple) return 'multiple';
  if (a.status === 'ok') return 'auto_ok';
  if (a.status === 'low_confidence' && a.quad) return 'auto_doubtful';
  return 'not_found';
}

/** Estados que ya son una decisión del operador (la cara puede guardarse). */
export const DECIDED: ReadonlySet<CropState> = new Set(['auto_accepted', 'manual', 'full']);

export const CROP_LABEL: Record<CropState, { tone: 'ok' | 'warn' | 'info' | 'err' | 'neutral'; text: string; help: string }> = {
  analyzing: { tone: 'info', text: 'Analizando bordes…', help: 'La foto ya está protegida en el teléfono. Si no quiere esperar, conserve la foto completa o ajuste las esquinas.' },
  auto_ok: { tone: 'info', text: 'Recorte propuesto — decida', help: 'Compruebe que no falta texto y pulse «Usar recorte automático», o elija otra opción.' },
  auto_doubtful: { tone: 'warn', text: 'Bordes dudosos — decida', help: 'El recorte sugerido podría estar mal. Ajústelo, úselo igualmente o conserve la foto completa.' },
  not_found: { tone: 'warn', text: 'No se encontraron los bordes', help: 'Conserve la foto completa o ajuste las esquinas a mano.' },
  multiple: { tone: 'warn', text: 'Hay varias tarjetas en la foto', help: 'Ajuste las esquinas de la tarjeta correcta, conserve la foto completa o repita la foto.' },
  auto_accepted: { tone: 'ok', text: 'Recorte automático aceptado', help: 'Se procesará exactamente este recorte.' },
  manual: { tone: 'ok', text: 'Esquinas ajustadas por usted', help: 'Se procesará exactamente este recorte.' },
  full: { tone: 'neutral', text: 'Foto completa', help: 'No se recortará: se leerá la foto entera.' },
  error: { tone: 'err', text: 'El escáner no respondió', help: 'Conserve la foto completa, ajuste las esquinas a mano o repita la foto.' },
};
