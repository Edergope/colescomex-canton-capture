// Banco de evaluación: ejecuta un motor OCR sobre las tarjetas de prueba y calcula métricas.
import { PaddleOCRAdapter } from '../src/ocr/paddle';
import { TesseractOCRAdapter } from '../src/ocr/tesseract';
import type { OCRAdapter } from '../src/ocr/OCRAdapter';
import { extractEntities } from '../src/extract/entities';
import { mergeSides } from '../src/extract/merge';
import { CJK_G, nfkc } from '../src/extract/normalize';

const log = (s: string) => { document.getElementById('log')!.textContent += `\n${s}`; };
const engineName = new URLSearchParams(location.search).get('engine') ?? 'paddle';
const variant = new URLSearchParams(location.search).get('variant') ?? 'all';

function lev(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = dp[j]; dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return dp[b.length];
}
const norm = (s: string) => nfkc(s).toLowerCase().replace(/\s+/g, '');
function cjkRecall(gt: string, ocr: string): number {
  const g = gt.match(CJK_G) ?? []; if (!g.length) return NaN;
  const bag = new Map<string, number>(); for (const c of ocr.match(CJK_G) ?? []) bag.set(c, (bag.get(c) ?? 0) + 1);
  let hit = 0; for (const c of g) { const n = bag.get(c) ?? 0; if (n) { hit++; bag.set(c, n - 1); } }
  return hit / g.length;
}

(async () => {
  const manifest = await (await fetch('./fixtures/manifest.json')).json() as { name: string; files: Record<string, string>; expect: Record<string, string | string[]>; text: string[] }[];
  const engine: OCRAdapter = engineName === 'tesseract' ? new TesseractOCRAdapter('/ocr-assets/tesseract/') : new PaddleOCRAdapter('/ocr-assets/', { maxSide: Number(new URLSearchParams(location.search).get('max') ?? 1600), detLimit: Number(new URLSearchParams(location.search).get('det') ?? 960), model: (new URLSearchParams(location.search).get('model') ?? 'PP-OCRv5_mobile') as never });
  const t0 = performance.now();
  await engine.init((m) => log(m));
  const initMs = performance.now() - t0;
  log(`init ${initMs.toFixed(0)} ms`);
  const results = [];
  for (const card of manifest) {
    for (const v of ['scan', 'photo']) {
      if (variant !== 'all' && v !== variant) continue;
      const blob = await (await fetch(`./fixtures/${card.files[v]}`)).blob();
      let out; let error: string | undefined;
      try { out = await engine.recognize(blob); } catch (e) { error = String(e); }
      const ocrText = out?.lines.map((l) => l.text).join('\n') ?? '';
      const gt = card.text.join('');
      const cer = lev(norm(gt), norm(ocrText.replace(/\n/g, ''))) / norm(gt).length;
      const merged = mergeSides(extractEntities(out?.lines ?? []), undefined);
      const fields: Record<string, { expected: string | string[]; got: string; ok: boolean }> = {};
      for (const [f, exp] of Object.entries(card.expect)) {
        const got = (merged.fields as Record<string, string>)[f] ?? '';
        const accepted = Array.isArray(exp) ? exp : [exp];
        fields[f] = { expected: exp, got, ok: accepted.some((a) => norm(a) === norm(got)) };
      }
      const r = { image: `${card.name}_${v}`, ms: Math.round(out?.ms ?? 0), cer: +cer.toFixed(4), cjkRecall: +cjkRecall(gt, ocrText).toFixed(4), fields, ocrText, error, status: merged.status };
      results.push(r);
      log(`${r.image}: ${r.ms}ms CER=${r.cer} CJK=${r.cjkRecall} campos=${Object.values(fields).filter((f) => f.ok).length}/${Object.keys(fields).length}`);
    }
  }
  (window as unknown as { __done: unknown }).__done = { engine: engine.name, initMs: Math.round(initMs), results };
  log('FIN');
})().catch((e) => { log(`ERROR ${e?.stack ?? e}`); (window as unknown as { __done: unknown }).__done = { error: String(e) }; });
