// Evaluación de extremo a extremo del Smart Document Scanner en el navegador:
// Worker (EXIF, detección, rectificación, clasificador) → DocumentOrientation + PaddleOCR → parser.
import { WorkerScanner } from '../src/scanner/client';
import { PaddleOCRAdapter } from '../src/ocr/paddle';
import { processDocument } from '../src/scanner/engine';
import { BUSINESS_CARD, PROFILES } from '../src/scanner/profiles';
import type { ResourceGovernor } from '../src/pipeline/resources';
import { extractEntities } from '../src/extract/entities';
import { mergeSides } from '../src/extract/merge';

const log = (s: string) => { document.getElementById('log')!.textContent += `\n${s}`; };
const norm = (s = '') => s.toLowerCase().normalize('NFKC').replace(/[^a-z0-9一-鿿@+]/g, '');
const toB64 = async (b: Blob) => { const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

// Tarjetas reales: imágenes y resultado esperado en el directorio PRIVADO (servido solo por `vite dev` en /@private/).
interface PrivCase { id: string; expected: { fields: Record<string, string>; extras: Record<string, string[]>; products: string[] } }
const strictNorm = (s = '') => s.normalize('NFKC').toUpperCase().replace(/\s+/g, ' ').trim();

(async () => {
  const cases = await (await fetch('./scanner-fixtures/manifest.json')).json() as { name: string; file: string; private?: boolean; quad: unknown; expect: string; rot: number; card?: string; side?: string; fields?: Record<string, string | string[]> }[];
  const privRes = await fetch('/@private/cases.json').catch(() => undefined);
  const priv: PrivCase[] = privRes?.ok ? (await privRes.json()).cases : [];
  const only = new URLSearchParams(location.search).get('only');
  const noOcr = new URLSearchParams(location.search).has('noocr');
  const ocrSide = Number(new URLSearchParams(location.search).get('ocrside') ?? BUSINESS_CARD.ocrInputSide);
  // perfil de recursos: `low` = alternancia estricta escáner ↔ PaddleOCR + decodificación reducida (como en Android ≤ 4 GB)
  const low = new URLSearchParams(location.search).get('profile') === 'low';
  const governor = { exclusive: low, begin: async () => undefined, end: async () => undefined, guard: <T>(_s: string, fn: () => Promise<T>) => fn() } as unknown as ResourceGovernor; // solo escáner (medición de memoria)
  const scanner = new WorkerScanner('/ocr-assets/');
  const ocr = new PaddleOCRAdapter('/ocr-assets/');
  const t0 = performance.now(); if (!noOcr) await ocr.init(); const initMs = performance.now() - t0;
  const results: Record<string, unknown>[] = [];
  const sides: Record<string, ReturnType<typeof extractEntities>> = {};
  for (const c of cases) {
    if (only && !c.name.includes(only)) continue;
    const res = await fetch(c.private ? `/@private/scanner-fixtures/${c.file}` : `./scanner-fixtures/${c.file}`);
    if (!res.ok) { log(`${c.name}: OMITIDO (fixture privado no disponible)`); continue; }
    const blob = await res.blob();
    const tA = performance.now();
    let ocrRuns = 0;
    const profile = { ...PROFILES[(c as { profile?: string }).profile ?? 'business_card'], ocrInputSide: ocrSide };
    const countingOcr = Object.assign(Object.create(Object.getPrototypeOf(ocr)), ocr, {
      recognize: async (b: Blob) => { ocrRuns++; if (noOcr) return { lines: [], ms: 0, engine: 'none' }; return ocr.recognize(b); },
      dispose: async () => { if (low) await ocr.dispose(); },
    });
    const pr = await processDocument({ ocr: countingOcr, scanner, governor }, { blob, profile, jobId: c.name, mode: low ? 'reduced' : 'normal' });
    const a = pr.analysis!;
    const choice = { rot: pr.rotation, lines: pr.lines, source: pr.orientation?.source, confident: pr.orientation?.confident, trials: pr.orientation?.trials ?? [] };
    const processed = pr.processed;
    const thumb = processed ?? new Blob([]);
    const totalMs = performance.now() - tA;
    const ext = extractEntities(choice.lines);
    if (c.private && c.name.endsWith('rot0')) sides[`${c.card}:${c.side}`] = ext;
    const m = mergeSides(ext, undefined);
    const fields: Record<string, { expected: unknown; got: string; ok: boolean }> = {};
    for (const [f, exp] of Object.entries(c.fields ?? {})) {
      const got = (m.fields as Record<string, string>)[f] ?? '';
      const acc = Array.isArray(exp) ? exp : [exp];
      fields[f] = { expected: exp, got, ok: acc.some((x) => norm(x) === norm(got)) };
    }
    const r = {
      name: c.name, expect: c.expect, status: a.status, multiple: a.multiple, cropped: a.cropped, confidence: a.confidence,
      expectedRot: c.rot, chosenRot: choice.rot, rotOk: c.expect === 'review' ? null : choice.rot === c.rot, orientationSource: choice.source, confident: choice.confident,
      probs: a.orientationProbs?.map((p) => +p.toFixed(3)), reasons: a.reasons, ocrRuns, trials: choice.trials.map((t: { rot: number; prior: number; reading: { score: number; entities: number; horizontal: number; confidence: number; wordRatio: number } }) => ({ rot: t.rot, prior: +t.prior.toFixed(2), score: t.reading.score, entities: t.reading.entities, h: t.reading.horizontal, conf: t.reading.confidence, words: t.reading.wordRatio })),
      fields, fieldsOk: Object.values(fields).filter((f) => f.ok).length, fieldsTotal: Object.keys(fields).length,
      ms: { ...a.ms, total: Math.round(totalMs), ocrRuns }, mode: pr.mode, processedBytes: processed?.size ?? 0, output: a.output,
      private: !!c.private, text: choice.lines.map((l) => l.text).join('\n'), thumb: thumb.size ? await toB64(thumb) : undefined,
    };
    results.push(r);
    log(`${c.name}: ${a.status}${a.multiple ? '+multi' : ''} rot ${choice.rot}/${c.rot} ${r.rotOk} OCR×${ocrRuns} campos ${r.fieldsOk}/${r.fieldsTotal} ${Math.round(totalMs)}ms`);
  }
  // Tarjetas reales completas (anverso + reverso fusionados) contra el resultado comercial esperado (privado)
  const realCards: Record<string, unknown>[] = [];
  for (const pc of priv) {
    const f = sides[`${pc.id}:front`], b = sides[`${pc.id}:back`];
    if (!f || !b) continue;
    const m = mergeSides(f, b);
    const fields: Record<string, { expected: string; got: string; ok: boolean }> = {};
    for (const [k, exp] of Object.entries(pc.expected.fields)) { const got = (m.fields as Record<string, string>)[k] ?? ''; fields[k] = { expected: exp, got, ok: norm(exp) === norm(got) }; }
    for (const [k, exp] of Object.entries(pc.expected.extras)) { const got = ((m.extras as unknown as Record<string, string[]>)[k] ?? []).join(' | '); fields[`extras.${k}`] = { expected: exp.join(' | '), got, ok: norm(exp.join('')) === norm(got) }; }
    // Productos: comparación ESTRICTA por elemento (con espacios) y, aparte, sin espacios (letras conservadas)
    const items = (m.fields.main_products ?? '').split(';').map((x) => x.trim()).filter(Boolean);
    const strict = pc.expected.products.map((p) => ({ product: p, exact: items.some((i) => strictNorm(i) === strictNorm(p)), lettersOnly: items.some((i) => norm(i) === norm(p)) }));
    const meta = m.meta.main_products;
    fields.main_products = { expected: pc.expected.products.join('; '), got: m.fields.main_products ?? '', ok: strict.every((x) => x.exact) && items.length === pc.expected.products.length };
    realCards.push({ id: pc.id, fields, products: { strict, items, status: meta?.status, reason: meta?.reason, candidates: meta?.candidates } });
    log(`${pc.id}: ${Object.values(fields).filter((x) => x.ok).length}/${Object.keys(fields).length} · productos exactos ${strict.filter((x) => x.exact).length}/${strict.length}`);
  }
  (window as unknown as { __done: unknown }).__done = { initMs: Math.round(initMs), results, realCards };
  log('FIN');
})().catch((e) => { log(`ERROR ${e?.stack ?? e}`); (window as unknown as { __done: unknown }).__done = { error: String(e?.stack ?? e) }; });
