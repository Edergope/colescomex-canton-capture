// Depuración: razones del detector actual en las escenas que no se recortan (y en las reales privadas).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { makeScene, runDetector, classify } from '../scanner-bench';
import { detectDocument as detectNew, refineFine } from '../../src/scanner/detect';
import { privateDir } from '../../scripts/private-dir.mjs';
const n = Number(process.argv[2] ?? 60);
const tally = new Map<string, number>();
const add = (k: string) => tally.set(k, (tally.get(k) ?? 0) + 1);
for (let k = 0; k < n; k++) {
  const sc = makeScene(k); const r = runDetector(detectNew, sc.img); const c = classify(r, sc.gt);
  if (c.outcome === 'conserva_foto') { add(`[${r.status}] ${r.reasons.filter((x) => !x.startsWith('Confianza')).join(' | ') || '(puntuación baja)'}`); if (process.argv[3]) console.log(sc.id, sc.tags, r.confidence, r.sideSupport, r.reasons.join(' | ')); }
}
const man = JSON.parse(readFileSync('ocr-eval/scanner-fixtures/manifest.json', 'utf8')) as { file: string; private?: boolean; source: string; quad: unknown; name: string }[];
for (const c of man.filter((m) => m.private)) {
  const f = path.join(privateDir(), 'scanner-fixtures', c.file); if (!existsSync(f)) continue;
  const j = jpeg.decode(readFileSync(f), { useTArray: true, maxMemoryUsageInMB: 2048 });
  const r = runDetector(detectNew, { width: j.width, height: j.height, data: new Uint8ClampedArray(j.data.buffer) });
  console.log('REAL', c.name, r.status, r.confidence, JSON.stringify(r.sideSupport), r.method, r.reasons.join(' | '));
}
console.log([...tally.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${v}× ${k}`).join('\n'));
void refineFine;
