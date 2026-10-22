// Página de laboratorio para medir el OCR con tarjetas reales en el teléfono de la feria.
import { PaddleOCRAdapter } from './ocr/paddle';
import { TesseractOCRAdapter } from './ocr/tesseract';
import type { OCRAdapter } from './ocr/OCRAdapter';
import { extractEntities } from './extract/entities';
import { mergeSides } from './extract/merge';

const out = document.getElementById('out')!;
const engines = new Map<string, OCRAdapter>();
document.getElementById('file')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const sel = (document.getElementById('engine') as HTMLSelectElement).value;
  if (!engines.has(sel)) engines.set(sel, sel === 'tesseract' ? new TesseractOCRAdapter() : new PaddleOCRAdapter(undefined, { model: sel === 'paddle-tiny' ? 'PP-OCRv6_tiny' : 'PP-OCRv5_mobile' }));
  const eng = engines.get(sel)!;
  out.textContent = 'Procesando…';
  const t0 = performance.now();
  try {
    await eng.init();
    const tInit = performance.now() - t0;
    const r = await eng.recognize(file);
    const m = mergeSides(extractEntities(r.lines), undefined);
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    out.textContent = [
      `${eng.name}  init ${tInit.toFixed(0)} ms  OCR ${r.ms.toFixed(0)} ms  ${mem ? `heap ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : ''}`,
      `Estado: ${m.status}  revisar: ${m.reviewFields.join(', ') || '—'}`, '',
      ...Object.entries(m.fields).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), '', '— Texto —',
      ...r.lines.map((l) => `${l.score.toFixed(2)}  ${l.text}`),
    ].join('\n');
  } catch (err) { out.textContent = `Error: ${(err as Error).message}`; }
});
