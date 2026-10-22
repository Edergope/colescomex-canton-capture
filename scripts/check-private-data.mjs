// Verificación anti-fuga antes de publicar: busca datos personales/comerciales reales en
//  1) los archivos versionados (árbol de trabajo) y
//  2) TODOS los commits que se subirían (diff de origin/main..HEAD), incluidos binarios añadidos.
// Los patrones viven en el directorio PRIVADO (sensitive-patterns.txt): la propia lista no se publica.
// Uso: node scripts/check-private-data.mjs [rango]   (por defecto origin/main..HEAD). Sale con código ≠ 0 si encuentra algo.
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateDir } from './private-dir.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const range = process.argv[2] ?? 'origin/main..HEAD';
const pf = path.join(privateDir(), 'sensitive-patterns.txt');
if (!existsSync(pf)) { console.error(`✗ No se encuentra ${pf}: no se puede verificar (se bloquea la publicación por seguridad).`); process.exit(2); }
const patterns = readFileSync(pf, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((p) => new RegExp(p, 'i'));
const sh = (c) => execSync(c, { cwd: root, maxBuffer: 512 * 1024 * 1024 }).toString();
const problems = [];

// 1) árbol versionado
for (const f of sh('git ls-files').split('\n').filter(Boolean)) {
  if (/(^|\/)fixtures\/real\//.test(f)) problems.push(`archivo de fixtures reales versionado: ${f}`);
  if (/\.(jpe?g|png|webp|heic|pdf)$/i.test(f) && (/real|card_front|card_back/i.test(f) || patterns.some((re) => re.test(f))) && !/^ocr-eval\/fixtures\//.test(f) && !/syn_/.test(f)) problems.push(`imagen sospechosa versionada: ${f}`);
  const p = path.join(root, f);
  if (!existsSync(p)) continue;
  const buf = readFileSync(p);
  if (buf.includes(0)) continue; // binario
  const txt = buf.toString('utf8');
  for (const re of patterns) if (re.test(txt)) problems.push(`patrón sensible en ${f}`);
}
// 2) historia que se subiría (texto de los diffs + nombres de binarios añadidos)
let diff = '';
try { diff = sh(`git log -p --no-color ${range}`); } catch { console.warn(`⚠ rango ${range} no disponible; solo se verificó el árbol actual`); }
for (const re of patterns) if (re.test(diff)) problems.push(`patrón sensible en la HISTORIA (${range}): ${re.source.slice(0, 4)}…`);
for (const f of (range ? sh(`git log --name-only --format= ${range}`).split('\n') : []).filter(Boolean)) {
  if (/(^|\/)fixtures\/real\/|\/real_.*\.(jpe?g|png)$|e2e-detalle-.*\.png$/i.test(f) || patterns.some((re) => re.test(f))) problems.push(`archivo real en la HISTORIA (${range}): ${f}`);
}
const uniq = [...new Set(problems)];
if (uniq.length) { console.error(`✗ ${uniq.length} problema(s) de privacidad:\n  - ${uniq.join('\n  - ')}`); process.exit(1); }
console.log(`✓ Sin datos reales en el árbol versionado ni en ${range} (${patterns.length} patrones privados).`);
