// Control de los artefactos PUBLICABLES (dist/ o la ruta indicada) antes de desplegar:
//  1. Integridad OCR: cada modelo/runtime de public/ocr-assets llega byte a byte a dist y está en el precaché
//     con la revisión correcta (si no, la instalación fallaría o se repetirían descargas).
//  2. Precaché completo: cada entrada de sw.js existe en dist.
//  3. Sin secretos ni datos privados: patrones de credenciales, archivos .env y ningún archivo idéntico a un
//     fixture privado (comparación por SHA-256).
// Uso: node scripts/check-dist.mjs [dist]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { privateDir } from './private-dir.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dist = path.resolve(process.argv[2] ?? path.join(root, 'dist'));
const problems = [];
const hash = (f, alg) => crypto.createHash(alg).update(fs.readFileSync(f)).digest('hex');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const rel = (f, base) => path.relative(base, f).split(path.sep).join('/');

if (!fs.existsSync(path.join(dist, 'sw.js'))) { console.error(`✗ ${dist} no contiene sw.js (¿falta el build?)`); process.exit(1); }
const files = walk(dist);

// 2. precaché
const sw = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
const entries = [...sw.matchAll(/\{url:"([^"]+)",revision:(null|"([0-9a-f]+)")\}/g)].map((m) => ({ url: m[1], revision: m[3] ?? null }));
if (!entries.length) problems.push('sw.js sin manifiesto de precaché');
for (const e of entries) {
  const f = path.join(dist, e.url);
  if (!fs.existsSync(f)) { problems.push(`precaché apunta a un archivo inexistente: ${e.url}`); continue; }
  if (e.revision && hash(f, 'md5') !== e.revision) problems.push(`revisión de precaché incorrecta: ${e.url}`);
}
if (!/self\.skipWaiting\(\)/.test(sw) || !/clientsClaim\(\)/.test(sw)) problems.push('sw.js sin activación automática (skipWaiting/clientsClaim): las apps instaladas no recibirían la actualización');

// 1. integridad OCR
const IGNORED = [/(^|\/)tesseract\//, /\.jsep.*\.wasm$/]; // mismas exclusiones que workbox.globIgnores
const src = path.join(root, 'public', 'ocr-assets');
let ocrChecked = 0, ocrBytes = 0;
const precached = new Set(entries.map((e) => e.url));
for (const f of walk(src)) {
  const r = rel(f, path.join(root, 'public'));
  const out = path.join(dist, r);
  if (!fs.existsSync(out)) { problems.push(`falta en dist: ${r}`); continue; }
  if (hash(f, 'sha256') !== hash(out, 'sha256')) { problems.push(`contenido distinto al origen: ${r}`); continue; }
  if (/\.(onnx|wasm|tar|mjs|js|json|yml|yaml|txt)$/.test(r) && !IGNORED.some((x) => x.test(r)) && /\.(onnx|wasm|tar|mjs|js)$/.test(r) && !precached.has(r)) problems.push(`modelo/runtime OCR fuera del precaché (no funcionaría sin conexión): ${r}`);
  ocrChecked++; ocrBytes += fs.statSync(f).size;
}

// 3. secretos y datos privados
const SECRET = [/GOCSPX-[\w-]{10,}/, /ya29\.[\w-]{20,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, /"client_secret"\s*:/, /"refresh_token"\s*:/, /["'`]AIza[0-9A-Za-z_-]{35}["'`]/] // clave de API como literal (evita falsos positivos en WASM en base64);
for (const f of files) {
  const r = rel(f, dist);
  if (/(^|\/)\.env/.test(r) || /\.(pem|key|p12)$/.test(r)) problems.push(`archivo sensible publicado: ${r}`);
  if (/\.(js|mjs|html|json|webmanifest|css|txt|map)$/.test(r) && fs.statSync(f).size < 20 * 1024 * 1024) {
    const t = fs.readFileSync(f, 'utf8');
    for (const p of SECRET) if (p.test(t)) problems.push(`posible secreto (${p.source.slice(0, 12)}…) en ${r}`);
  }
}
let privChecked = 0;
const pdir = privateDir();
if (fs.existsSync(pdir)) {
  const priv = new Set(walk(pdir).filter((f) => fs.statSync(f).size > 1024).map((f) => { privChecked++; return hash(f, 'sha256'); }));
  for (const f of files) if (fs.statSync(f).size > 1024 && priv.has(hash(f, 'sha256'))) problems.push(`archivo idéntico a un fixture PRIVADO publicado: ${rel(f, dist)}`);
}

console.log(`dist: ${dist}`);
console.log(`· precaché: ${entries.length} entradas verificadas`);
console.log(`· OCR: ${ocrChecked} archivos (${(ocrBytes / 1048576).toFixed(1)} MB) idénticos al origen`);
console.log(`· secretos: ${files.length} archivos revisados; fixtures privados comparados: ${privChecked || 'directorio privado no disponible'}`);
if (problems.length) { console.error(`✗ ${problems.length} problema(s):\n  - ${problems.join('\n  - ')}`); process.exit(1); }
console.log('✓ Artefactos publicables correctos');
