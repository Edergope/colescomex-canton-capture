// Regresión del detector de documentos sobre fotos reales y escenas sintéticas con verdad de referencia.
// Valida por separado: A detección, B esquinas, C recorte/fondo, D perspectiva (vía esquinas), I tiempo.
import { describe, expect, it, beforeAll } from 'vitest';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { detectDocument, inQuad } from '../src/scanner/detect';
import type { Pt, RGBAImage } from '../src/scanner/imageops';
import { privateDir } from '../scripts/private-dir.mjs';
import { PROFILES } from '../src/scanner/profiles';

const FX = path.resolve('ocr-eval/scanner-fixtures');
interface Case { name: string; file: string; private?: boolean; profile?: string; source: string; scenario: string; quad: Pt[] | null; expect: 'crop' | 'review' | 'crop_or_review'; rot: number }
let cases: Case[] = [];
const report: Record<string, unknown>[] = [];

beforeAll(() => {
  if (!existsSync(path.join(FX, 'manifest.json'))) execFileSync('node', ['--import', 'tsx', 'ocr-eval/make-scanner-fixtures.ts'], { stdio: 'inherit' });
  cases = JSON.parse(readFileSync(path.join(FX, 'manifest.json'), 'utf8'));
}, 120_000);

const fileOf = (c: Case) => (c.private ? path.join(privateDir(), 'scanner-fixtures', c.file) : path.join(FX, c.file));
function decode(file: string): RGBAImage {
  const j = jpeg.decode(readFileSync(file), { useTArray: true, maxMemoryUsageInMB: 2048 });
  return { width: j.width, height: j.height, data: new Uint8ClampedArray(j.data.buffer) };
}

/** Error de esquinas emparejando cada esquina de referencia con la detectada más cercana. */
export function cornerErrors(gt: Pt[], det: Pt[]): number[] {
  return gt.map((g) => Math.min(...det.map((d) => Math.hypot(d.x - g.x, d.y - g.y))));
}
/** Cobertura del documento real y fracción de fondo incluida, por muestreo en rejilla. */
export function areaMetrics(gt: Pt[], det: Pt[]): { coverage: number; background: number } {
  const xs = [...gt, ...det].map((p) => p.x), ys = [...gt, ...det].map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let g = 0, d = 0, both = 0;
  const N = 220;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const p = { x: x0 + ((x1 - x0) * (i + 0.5)) / N, y: y0 + ((y1 - y0) * (j + 0.5)) / N };
    const a = inQuad(gt, p), b = inQuad(det, p);
    if (a) g++; if (b) d++; if (a && b) both++;
  }
  return { coverage: both / g, background: d ? (d - both) / d : 0 };
}

const CORNER_TOL = 0.012; // 1,2 % de la diagonal
const MIN_COVERAGE = 0.985; // no se corta contenido
const MAX_BACKGROUND = 0.015; // fondo incluido en el recorte

describe('Smart Document Scanner — detección (fotos reales + sintéticas)', () => {
  it('cada caso cumple su expectativa con métricas independientes', () => {
    const failures: string[] = [];
    const usable = cases.filter((c) => existsSync(fileOf(c)));
    if (usable.length < cases.length) console.warn(`⚠ ${cases.length - usable.length} casos reales omitidos: fixtures privados no disponibles`);
    for (const c of usable) {
      const img = decode(fileOf(c));
      const t0 = Date.now();
      const r = detectDocument(img, {}, PROFILES[c.profile ?? 'business_card'].detect);
      const ms = Date.now() - t0;
      const diag = Math.hypot(img.width, img.height);
      const cropped = r.status === 'ok' && !r.multiple && !!r.quad;
      const row: Record<string, unknown> = { name: c.name, source: c.source, scenario: c.scenario, expect: c.expect, status: r.status, multiple: r.multiple, confidence: r.confidence, ms };
      if (c.quad && r.quad) {
        const errs = cornerErrors(c.quad, r.quad);
        const am = areaMetrics(c.quad, r.quad);
        Object.assign(row, { maxCornerErrPct: +(100 * Math.max(...errs) / diag).toFixed(2), coverage: +am.coverage.toFixed(4), background: +am.background.toFixed(4) });
      }
      let pass: boolean;
      if (c.expect === 'crop') pass = cropped && (row.maxCornerErrPct as number) <= CORNER_TOL * 100 && (row.coverage as number) >= MIN_COVERAGE && (row.background as number) <= MAX_BACKGROUND;
      else if (c.expect === 'review') pass = !cropped;
      else pass = !cropped || ((row.maxCornerErrPct as number) <= CORNER_TOL * 100 && (row.coverage as number) >= MIN_COVERAGE && (row.background as number) <= MAX_BACKGROUND);
      row.pass = pass;
      report.push(row);
      if (!pass) failures.push(`${c.name}: ${JSON.stringify(row)}`);
    }
    mkdirSync('ocr-eval/results', { recursive: true });
    writeFileSync('ocr-eval/results/scanner-detect.json', JSON.stringify(report, null, 1));
    console.table(report.map((r) => ({ caso: r.name, esperado: r.expect, estado: r.status, conf: r.confidence, errEsq: r.maxCornerErrPct, cobertura: r.coverage, fondo: r.background, ms: r.ms, ok: r.pass })));
    expect(failures).toEqual([]);
  }, 300_000);
});
