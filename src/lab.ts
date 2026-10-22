// Laboratorio en el teléfono: escáner (recorte + orientación) + OCR + parser sobre una foto real, con tiempos
// por etapa y memoria. No guarda nada. Sirve para validar el rendimiento en los Android de la feria.
import { PaddleOCRAdapter } from './ocr/paddle';
import { TesseractOCRAdapter } from './ocr/tesseract';
import type { OCRAdapter } from './ocr/OCRAdapter';
import { extractEntities } from './extract/entities';
import { mergeSides } from './extract/merge';
import { WorkerScanner } from './scanner/client';
import { processDocument } from './scanner/engine';
import { BUSINESS_CARD } from './scanner/profiles';

const out = document.getElementById('out')!;
const preview = document.getElementById('preview') as HTMLImageElement | null;
const engines = new Map<string, OCRAdapter>();
const scanner = new WorkerScanner();
document.getElementById('file')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const sel = (document.getElementById('engine') as HTMLSelectElement).value;
  const useScanner = (document.getElementById('scanner') as HTMLInputElement | null)?.checked ?? true;
  if (!engines.has(sel)) engines.set(sel, sel === 'tesseract' ? new TesseractOCRAdapter() : new PaddleOCRAdapter(undefined, { model: sel === 'paddle-tiny' ? 'PP-OCRv6_tiny' : 'PP-OCRv5_mobile' }));
  const eng = engines.get(sel)!;
  out.textContent = 'Procesando…';
  const t0 = performance.now();
  try {
    await eng.init();
    const tInit = performance.now() - t0;
    let lines; let scanInfo = '';
    if (useScanner) {
      // mismo motor que la app (perfil de tarjeta comercial)
      const r = await processDocument({ ocr: eng, scanner }, { blob: file, profile: BUSINESS_CARD, jobId: 'lab' });
      const a = r.analysis;
      if (preview && r.processed) { preview.src = URL.createObjectURL(r.processed); preview.hidden = false; }
      lines = r.lines;
      scanInfo = a ? `Escáner: ${a.status}${a.multiple ? ' (varias tarjetas)' : ''} conf ${a.confidence} · recorte ${a.cropped ? 'sí' : 'no'} · giro ${r.rotation * 90}° (${r.orientation?.source ?? '—'}, OCR×${r.orientation?.trials.length ?? 0})\n` +
        `Tiempos: decodificar ${a.ms.decode} ms · detectar ${a.ms.detect} ms · enderezar ${a.ms.warp} ms · orientación ${a.ms.classify} ms · total ${r.ms} ms\n` +
        (a.reasons.length ? `Avisos: ${a.reasons.join(' · ')}\n` : '') : `Escáner no disponible: ${JSON.stringify(r.issues)}\n`;
      if (r.ocrError) throw r.ocrError;
    } else {
      lines = (await eng.recognize(file)).lines;
    }
    const total = performance.now() - t0;
    const m = mergeSides(extractEntities(lines), undefined);
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    out.textContent = [
      `${eng.name}  init ${tInit.toFixed(0)} ms  total ${total.toFixed(0)} ms  ${mem ? `heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : ''}`,
      scanInfo, `Estado: ${m.status}  revisar: ${m.reviewFields.join(', ') || '—'}`, '',
      ...Object.entries(m.fields).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
      ...Object.entries(m.extras).filter(([, v]) => v.length).map(([k, v]) => `extra.${k}: ${v.join(' | ')}`), '', '— Texto —',
      ...lines.map((l) => `${l.score.toFixed(2)}  ${l.text}`),
    ].join('\n');
  } catch (err) { out.textContent = `Error: ${(err as Error).message}`; }
});
