// Vista previa REAL del escáner en la captura: el mismo detector y la misma corrección de perspectiva que el
// procesamiento final, sobre la foto recién tomada. Lo que el operador aprueba es lo que se procesa: el recorte
// aprobado se MATERIALIZA aquí (imagen recortada y enderezada) y se guarda con la evidencia como documento procesado.
// Worker propio, cerrado al salir de la cámara; si no responde a tiempo se termina (memoria del teléfono).
import { WorkerScanner } from '../scanner/client';
import { BUSINESS_CARD } from '../scanner/profiles';
import type { Quad } from '../scanner/homography';
import type { ScanAnalysis } from '../scanner/types';

/** Lado máximo decodificado para la vista previa: suficiente para ver y ajustar, con poca memoria. */
export const PREVIEW_SIDE = 2000;
/** Documento recortado que se materializa al aprobar (vista y OCR de respaldo; el proceso final lo rehace a 2400). */
export const MATERIALIZED_SIDE = BUSINESS_CARD.ocrInputSide;
/** Tiempo máximo para analizar o generar un recorte en el teléfono antes de declarar el fallo. */
export const PREVIEW_TIMEOUT_MS = 45_000;

export interface PreviewResult {
  analysis: ScanAnalysis;
  /** documento rectificado y orientado (o la foto completa reducida si no hay recorte) */
  image: Blob;
  /** cuartos de vuelta aplicados para mostrarlo derecho (clasificador de orientación) */
  rot: number;
}

/** Recorte materializado: la imagen existe, se decodificó y corresponde a las esquinas pedidas. */
export interface MaterializedCrop { image: Blob; quad: Quad; rot: number; width: number; height: number; source: { width: number; height: number } }

export class ScanPreview {
  private scanner?: WorkerScanner;
  private closed = false;

  /** Analiza la foto. `manualQuad` (esquinas en la foto original) fuerza un recorte concreto. */
  async analyze(blob: Blob, manualQuad?: Quad, maxSide = 1400): Promise<PreviewResult> {
    if (this.closed) throw new Error('Vista previa cerrada');
    this.scanner ??= new WorkerScanner();
    const scanner = this.scanner;
    let timer = 0;
    const timeout = new Promise<never>((_, rej) => { timer = window.setTimeout(() => rej(new Error('El escáner no respondió a tiempo')), PREVIEW_TIMEOUT_MS); });
    const run = async (): Promise<PreviewResult> => {
      const session = await scanner.scan(blob, { detect: BUSINESS_CARD.detect, fullSide: PREVIEW_SIDE, maxOutputSide: maxSide, manualQuad });
      try {
        const p = session.analysis.orientationProbs;
        // el clasificador da la probabilidad de cada giro del contenido; se endereza con el más probable
        const rot = p ? (4 - p.indexOf(Math.max(...p))) % 4 : 0;
        const image = await session.render(rot, { maxSide, quality: 0.9 });
        return { analysis: session.analysis, image, rot };
      } finally { session.release(); }
    };
    try { return await Promise.race([run(), timeout]); }
    catch (e) {
      // un Worker colgado (p. ej. sin memoria) se termina: el siguiente intento empieza limpio
      if (this.scanner === scanner) { scanner.terminate(); this.scanner = undefined; }
      throw e;
    } finally { clearTimeout(timer); }
  }

  /**
   * Genera el documento recortado y enderezado para unas esquinas aprobadas y COMPRUEBA que existe (se decodifica
   * y tiene dimensiones). Si algo falla lanza un error: nunca se da por aplicado un recorte que no existe.
   */
  async materialize(blob: Blob, quad: Quad): Promise<MaterializedCrop> {
    const r = await this.analyze(blob, quad, MATERIALIZED_SIDE);
    if (!r.analysis.cropped || r.image.size === 0) throw new Error('El escáner no pudo rectificar esas esquinas');
    const bmp = await createImageBitmap(r.image).catch(() => { throw new Error('La imagen recortada no se pudo leer'); });
    const size = { width: bmp.width, height: bmp.height }; bmp.close();
    if (!size.width || !size.height) throw new Error('La imagen recortada está vacía');
    return { image: r.image, quad, rot: r.rot, ...size, source: r.analysis.source };
  }

  close() { this.closed = true; this.scanner?.terminate(); this.scanner = undefined; }
}

/** Esquinas de la foto completa (para «Conservar foto completa»). */
export function fullFrame(a: { source: { width: number; height: number } }): Quad {
  const { width: w, height: h } = a.source;
  return [{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 }];
}

export type CropState = 'analyzing' | 'auto_ok' | 'auto_doubtful' | 'not_found' | 'multiple' | 'error'
  | 'rendering' | 'render_error' | 'auto_accepted' | 'manual' | 'full';

/**
 * Estado que se muestra al operador. Ver un recorte NO es aprobarlo, y aprobar unas esquinas no es tener el recorte:
 * «auto_accepted» y «manual» solo cuando la imagen recortada EXISTE; mientras se genera, «rendering»; si falló,
 * «render_error» (con reintento). Sin decisión, los estados son propuestas pendientes.
 */
export function cropState(a: ScanAnalysis | undefined, decision?: 'auto' | 'manual' | 'full', render?: 'ok' | 'pending' | 'error'): CropState {
  if (decision === 'full') return 'full';
  if (decision === 'auto' || decision === 'manual') {
    if (render === 'ok') return decision === 'auto' ? 'auto_accepted' : 'manual';
    return render === 'error' ? 'render_error' : 'rendering';
  }
  if (!a) return 'analyzing';
  if (a.multiple) return 'multiple';
  if (a.status === 'ok') return 'auto_ok';
  if (a.status === 'low_confidence' && a.quad) return 'auto_doubtful';
  return 'not_found';
}

/** Estados que ya son una decisión del operador con el resultado disponible (la cara puede guardarse). */
export const DECIDED: ReadonlySet<CropState> = new Set(['auto_accepted', 'manual', 'full']);

export const CROP_LABEL: Record<CropState, { tone: 'ok' | 'warn' | 'info' | 'err' | 'neutral'; text: string; help: string }> = {
  analyzing: { tone: 'info', text: 'Analizando bordes…', help: 'La foto ya está protegida en el teléfono. Si no quiere esperar, conserve la foto completa o ajuste las esquinas.' },
  auto_ok: { tone: 'info', text: 'Recorte propuesto — decida', help: 'Compruebe que no falta texto y pulse «Usar recorte automático», o elija otra opción.' },
  auto_doubtful: { tone: 'warn', text: 'Bordes dudosos — decida', help: 'El recorte sugerido podría estar mal. Ajústelo, úselo igualmente o conserve la foto completa.' },
  not_found: { tone: 'warn', text: 'No se encontraron los bordes', help: 'Ajuste las 4 esquinas a mano o conserve la foto completa.' },
  multiple: { tone: 'warn', text: 'Hay varias tarjetas en la foto', help: 'Ajuste las esquinas de la tarjeta correcta, conserve la foto completa o repita la foto.' },
  error: { tone: 'err', text: 'El escáner no respondió', help: 'Ajuste las esquinas a mano, conserve la foto completa o repita la foto.' },
  rendering: { tone: 'info', text: 'Generando recorte…', help: 'Se está recortando y enderezando la tarjeta con las esquinas elegidas.' },
  render_error: { tone: 'err', text: 'No se pudo generar el recorte', help: 'Las esquinas se conservan. Reintente, ajústelas de nuevo o conserve la foto completa.' },
  auto_accepted: { tone: 'ok', text: 'Recorte automático aplicado', help: 'Esta es la imagen recortada que se guardará y leerá.' },
  manual: { tone: 'ok', text: 'Recorte manual aplicado', help: 'Esta es la imagen recortada con sus esquinas; es la que se guardará y leerá.' },
  full: { tone: 'neutral', text: 'Foto completa', help: 'No se recortará: se leerá la foto entera.' },
};
