import type { Quad } from './homography';
import type { OrientationProbs } from './orientation';

export type ScanStatus = 'ok' | 'low_confidence' | 'not_found' | 'manual';

export interface ScanAnalysis {
  status: ScanStatus;
  confidence: number;
  /** esquinas en la imagen original (con EXIF aplicado): TL, TR, BR, BL */
  quad?: Quad;
  method?: string;
  multiple: boolean;
  reasons: string[];
  /** probabilidades del clasificador de orientación (null si no está disponible) */
  orientationProbs: OrientationProbs | null;
  source: { width: number; height: number };
  /** tamaño del documento rectificado (o de la foto reducida si no se recortó) */
  output: { width: number; height: number };
  /** true si `render` entrega el documento recortado y enderezado */
  cropped: boolean;
  ms: { decode: number; detect: number; warp: number; classify: number; total: number };
}

export interface RenderOptions { maxSide?: number; quality?: number }

export interface ScanSession {
  analysis: ScanAnalysis;
  /** imagen (documento rectificado o foto) girada `rot` cuartos de vuelta horarios, en JPEG */
  render(rot: number, opts?: RenderOptions): Promise<Blob>;
  release(): void;
}

/** Tolerancia (fracción de la diagonal del documento) para refinar un recorte aprobado. */
export const APPROVED_TOL = 0.006;

export interface ScanOptions {
  manualQuad?: Quad;
  /**
   * Recorte automático APROBADO por el operador (visto en la vista previa, a menor resolución). Se procesa ese
   * recorte; solo se sustituye por la detección a resolución completa si coincide con él (mismo contorno, esquinas
   * a ≤ APPROVED_TOL de la diagonal), para ganar precisión sin cambiar lo aprobado.
   */
  approvedQuad?: Quad;
  /** geometría esperada (perfil de documento) */
  detect?: { aspectRange?: [number, number]; minAreaFrac?: number };
  /** lado mayor del documento rectificado */
  maxOutputSide?: number;
  /** límite de decodificación de la foto (modo reducido para teléfonos con poca memoria) */
  fullSide?: number;
}

/** Escáner de documentos reemplazable (Worker en el navegador; implementación de prueba en Node). */
export interface DocumentScanner {
  scan(blob: Blob, opts?: ScanOptions): Promise<ScanSession>;
  /** libera por completo los recursos (termina el Worker); el siguiente `scan` los vuelve a crear */
  terminate?(): void;
}

/** El recorte solo se usa como imagen principal si la detección es fiable y no hay varios documentos. */
export const CROP_STATUSES: ScanStatus[] = ['ok', 'manual'];
export const MAX_OUTPUT_SIDE = 2400;
