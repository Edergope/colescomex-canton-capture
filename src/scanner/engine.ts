// Motor reutilizable de procesamiento de documentos (independiente del tipo de documento):
//   foto → detección y recorte → corrección de perspectiva → orientación (clasificador + verificación OCR) → OCR
// El tipo de documento solo aporta un perfil (geometría y resoluciones). La interpretación del texto (parser de
// tarjetas, facturas…) y la persistencia quedan fuera del motor.
//
// Control de recursos (Android): con `governor.exclusive`, el Worker del escáner se termina antes de cada OCR y
// PaddleOCR se libera antes de escanear; cada etapa tiene vigilancia de tiempo y marcador de caída.
import type { OcrLine } from '../domain/schema';
import type { OCRAdapter } from '../ocr/OCRAdapter';
import type { DocumentScanner, RenderOptions, ScanAnalysis, ScanOptions, ScanSession } from './types';
import type { DocumentProfile } from './profiles';
import { chooseOrientation, type OrientationChoice } from './orientation';
import { MODE_PARAMS, type ProcessingMode, type ResourceGovernor } from '../pipeline/resources';
import type { Quad } from './homography';

export interface EngineDeps { ocr: OCRAdapter; scanner?: DocumentScanner; governor?: ResourceGovernor }
export interface ProcessInput { blob: Blob; profile: DocumentProfile; jobId: string; manualQuad?: Quad; mode?: ProcessingMode }

export type EngineIssue =
  | { code: 'not_cropped'; multiple: boolean; reasons: string[] }
  | { code: 'orientation_uncertain' }
  | { code: 'scanner_unavailable'; message: string }
  | { code: 'minimal_mode' };

export interface ProcessedDocument {
  lines: OcrLine[];
  engine: string;
  /** rotación aplicada al documento, en cuartos de vuelta horarios */
  rotation: number;
  analysis?: ScanAnalysis;
  orientation?: Pick<OrientationChoice, 'source' | 'trials' | 'confident'>;
  /** documento recortado, enderezado y orientado (solo si el recorte es fiable) */
  processed?: Blob;
  issues: EngineIssue[];
  mode: ProcessingMode;
  ms: number;
  /** error del OCR (el resto del resultado — p. ej. el documento procesado — sigue siendo válido) */
  ocrError?: unknown;
}

export async function processDocument(deps: EngineDeps, input: ProcessInput): Promise<ProcessedDocument> {
  const t0 = Date.now();
  const { ocr, scanner, governor } = deps;
  const mode = input.mode ?? 'normal';
  const params = MODE_PARAMS[mode];
  const issues: EngineIssue[] = [];
  const exclusive = !!governor?.exclusive;

  const runOcr = async (img: Blob): Promise<OcrLine[]> => {
    await governor?.begin(input.jobId, 'ocr');
    try {
      const out = governor ? await governor.guard('ocr', () => ocr.recognize(img), () => void ocr.dispose()) : await ocr.recognize(img);
      return out.lines;
    } finally { await governor?.end(); }
  };
  const plain = async (): Promise<ProcessedDocument> => {
    try { return { lines: await runOcr(input.blob), engine: ocr.name, rotation: 0, issues, mode, ms: Date.now() - t0 }; }
    catch (e) { return { lines: [], engine: ocr.name, rotation: 0, issues, mode, ms: Date.now() - t0, ocrError: e }; }
  };

  if (!scanner || !params.scanner) {
    if (scanner && !params.scanner) issues.push({ code: 'minimal_mode' });
    return plain();
  }

  // ── Escaneo (en perfil exclusivo, PaddleOCR se libera antes) ──
  const scanOpts: ScanOptions = { manualQuad: input.manualQuad, detect: input.profile.detect, maxOutputSide: input.profile.output.maxSide, fullSide: params.fullSide };
  const openSession = async (): Promise<ScanSession> => {
    if (exclusive) await ocr.dispose();
    await governor?.begin(input.jobId, 'scan');
    try {
      return governor ? await governor.guard('scan', () => scanner.scan(input.blob, scanOpts), () => scanner.terminate?.()) : await scanner.scan(input.blob, scanOpts);
    } finally { await governor?.end(); }
  };
  let session: ScanSession | undefined;
  try { session = await openSession(); }
  catch (e) {
    scanner.terminate?.();
    issues.push({ code: 'scanner_unavailable', message: (e as Error).message });
    return plain();
  }
  const analysis = session.analysis;
  const closeSession = () => { session?.release(); session = undefined; if (exclusive) scanner.terminate?.(); };
  // Renderizado con reapertura: si la sesión se cerró (perfil exclusivo) y hace falta otra rotación, se vuelve a escanear.
  const render = async (rot: number, o: RenderOptions): Promise<Blob> => {
    if (!session) session = await openSession();
    return session.render(rot, o);
  };
  const finals = new Map<number, Blob>();

  let choice: OrientationChoice | undefined;
  let ocrError: unknown;
  try {
    choice = await chooseOrientation(analysis.orientationProbs, async (rot) => {
      const img = await render(rot, { maxSide: input.profile.ocrInputSide, quality: 0.92 });
      if (exclusive) {
        // antes de liberar el escáner se prepara también el documento final en esta rotación (la más probable)
        if (analysis.cropped && !finals.has(rot)) finals.set(rot, await render(rot, { maxSide: input.profile.output.maxSide, quality: input.profile.output.quality }));
        closeSession();
      }
      return runOcr(img);
    });
  } catch (e) { ocrError = e; }

  const probs = analysis.orientationProbs;
  const rot = choice?.rot ?? (probs ? (4 - probs.indexOf(Math.max(...probs))) % 4 : 0);
  let processed: Blob | undefined;
  try {
    if (analysis.cropped) processed = finals.get(rot) ?? await render(rot, { maxSide: input.profile.output.maxSide, quality: input.profile.output.quality });
  } finally { closeSession(); }

  if (!analysis.cropped) issues.push({ code: 'not_cropped', multiple: analysis.multiple, reasons: analysis.reasons });
  if (choice && !choice.confident) issues.push({ code: 'orientation_uncertain' });
  return {
    lines: choice?.lines ?? [], engine: ocr.name, rotation: rot, analysis, processed, issues, mode, ms: Date.now() - t0, ocrError,
    orientation: choice ? { source: choice.source, trials: choice.trials, confident: choice.confident } : undefined,
  };
}
