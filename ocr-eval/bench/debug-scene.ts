// Depuración: genera escenas del banco, guarda la imagen con los cuadriláteros (verde = referencia, rojo = v1.2.1,
// azul = actual) y muestra estado/razones. Uso: node --import tsx ocr-eval/bench/debug-scene.ts 0 1 2
import { writeFileSync, mkdirSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { makeScene, runDetector } from '../scanner-bench';
import { detectDocument as detectNew } from '../../src/scanner/detect';
import { detectDocument as detectOld } from './detect-v1.2.1';
import { downscale, type RGBAImage, type Pt } from '../../src/scanner/imageops';
const ids = process.argv.slice(2).map(Number);
const max = Math.max(...ids);
mkdirSync('ocr-eval/results/bench/debug', { recursive: true });
function line(img: RGBAImage, a: Pt, b: Pt, c: number[]) { const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)); for (let i = 0; i <= n; i++) for (let o = -3; o <= 3; o++) { const x = Math.round(a.x + ((b.x - a.x) * i) / n + o), y = Math.round(a.y + ((b.y - a.y) * i) / n); if (x >= 0 && y >= 0 && x < img.width && y < img.height) { const j = (y * img.width + x) * 4; img.data[j] = c[0]; img.data[j + 1] = c[1]; img.data[j + 2] = c[2]; } } }
const poly = (img: RGBAImage, q: Pt[] | undefined | null, c: number[]) => q && q.forEach((p, i) => line(img, p, q[(i + 1) % 4], c));
for (let k = 0; k <= max; k++) {
  const sc = makeScene(k);
  if (!ids.includes(k)) continue;
  const ro = runDetector(detectOld, sc.img), rn = runDetector(detectNew, sc.img);
  console.log(sc.id, sc.tags, '| v1.2.1:', ro.status, ro.confidence, ro.reasons.join('; '), '| actual:', rn.status, rn.confidence, rn.reasons.join('; '));
  const im = { width: sc.img.width, height: sc.img.height, data: new Uint8ClampedArray(sc.img.data) };
  poly(im, sc.gt, [0, 220, 0]); poly(im, ro.quad, [230, 0, 0]); poly(im, rn.quad, [0, 80, 255]);
  const s = downscale(im, 700).img;
  writeFileSync(`ocr-eval/results/bench/debug/${sc.id}.jpg`, jpeg.encode({ width: s.width, height: s.height, data: Buffer.from(s.data.buffer) }, 80).data);
}
