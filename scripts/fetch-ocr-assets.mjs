// Copia/descarga los recursos OCR a public/ocr-assets para auto-hospedarlos.
// Durante la feria la app NO debe depender de CDN: todo se sirve desde el mismo origen
// y el service worker lo precachea.
import { mkdir, copyFile, stat, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'public', 'ocr-assets');
const cache = path.join(root, '.asset-cache');
const MODEL_BASE = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0';
const MODELS = ['PP-OCRv5_mobile_det', 'PP-OCRv5_mobile_rec', 'PP-OCRv6_tiny_det', 'PP-OCRv6_tiny_rec'];
const TESS_LANGS = ['eng', 'chi_sim'];
const TESS_DATA = (l) => `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`;

async function download(url, dest) {
  if (existsSync(dest) && (await stat(dest)).size > 0) return;
  console.log('↓', url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

await mkdir(path.join(out, 'models'), { recursive: true });
await mkdir(path.join(out, 'ort'), { recursive: true });
await mkdir(path.join(out, 'tesseract'), { recursive: true });
await mkdir(cache, { recursive: true });

for (const m of MODELS) {
  const file = `${m}_onnx_infer.tar`;
  await download(`${MODEL_BASE}/${file}`, path.join(cache, file));
  await copyFile(path.join(cache, file), path.join(out, 'models', file));
}

// ONNX Runtime Web: debe coincidir con la versión embebida en el worker de paddleocr-js (1.24.3).
const ortVersion = JSON.parse(await readFile(path.join(root, 'node_modules/onnxruntime-web/package.json'), 'utf8')).version;
if (ortVersion !== '1.24.3') console.warn(`⚠ onnxruntime-web ${ortVersion} ≠ 1.24.3 (versión embebida en paddleocr-js 0.4.2)`);
for (const f of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) {
  await copyFile(path.join(root, 'node_modules/onnxruntime-web/dist', f), path.join(out, 'ort', f));
}

// Tesseract.js (motor alternativo / respaldo): worker, core y datos de idioma locales.
await copyFile(path.join(root, 'node_modules/tesseract.js/dist/worker.min.js'), path.join(out, 'tesseract', 'worker.min.js'));
for (const f of ['tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm', 'tesseract-core-lstm.wasm']) {
  await copyFile(path.join(root, 'node_modules/tesseract.js-core', f), path.join(out, 'tesseract', f));
}
for (const l of TESS_LANGS) {
  const gz = path.join(cache, `${l}.traineddata.gz`);
  await download(TESS_DATA(l), gz);
  // Se guarda descomprimido para que el SW lo cachee sin depender de Content-Encoding.
  await writeFile(path.join(out, 'tesseract', `${l}.traineddata`), gunzipSync(await readFile(gz)));
}
console.log('✓ Recursos OCR listos en', out);
