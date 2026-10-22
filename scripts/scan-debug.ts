// Diagnóstico visual del escáner: node --import tsx scripts/scan-debug.ts <imagen> [salida_prefijo]
import { readFileSync, writeFileSync } from 'node:fs';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { detectDocument } from '../src/scanner/detect';
import { warpPerspective, rectifiedSize } from '../src/scanner/homography';
import { downscale, type RGBAImage } from '../src/scanner/imageops';

export function decode(path: string): RGBAImage {
  const buf = readFileSync(path);
  if (path.toLowerCase().endsWith('.png')) { const p = PNG.sync.read(buf); return { width: p.width, height: p.height, data: new Uint8ClampedArray(p.data.buffer, p.data.byteOffset, p.data.length) }; }
  const j = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 1024 });
  return { width: j.width, height: j.height, data: new Uint8ClampedArray(j.data.buffer) };
}
export function encode(img: RGBAImage, path: string) { writeFileSync(path, jpeg.encode({ width: img.width, height: img.height, data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length) }, 85).data); }

if (process.argv[2]) {
  const t0 = Date.now();
  const img = decode(process.argv[2]);
  const t1 = Date.now();
  const r = detectDocument(img);
  console.log(JSON.stringify({ decodeMs: t1 - t0, status: r.status, conf: r.confidence, method: r.method, multiple: r.multiple, ms: r.ms, reasons: r.reasons,
    quad: r.quad?.map((p) => [Math.round(p.x), Math.round(p.y)]), cands: r.candidates.map((c) => ({ s: c.score, m: c.method, parts: c.parts, q: c.quad.map((p) => [Math.round(p.x), Math.round(p.y)]) })) }));
  const out = process.argv[3] ?? '/tmp/scan';
  const { img: small, scale } = downscale(img, 900);
  const d = small.data;
  const draw = (q: { x: number; y: number }[], col: number[]) => {
    for (let s = 0; s < 4; s++) { const a = q[s], b = q[(s + 1) % 4]; for (let t = 0; t <= 1; t += 0.001) {
      const x = Math.round((a.x + (b.x - a.x) * t) * scale), y = Math.round((a.y + (b.y - a.y) * t) * scale);
      for (let o = -2; o <= 2; o++) for (let p = -2; p <= 2; p++) { const xx = x + o, yy = y + p; if (xx < 0 || yy < 0 || xx >= small.width || yy >= small.height) continue; const i = (yy * small.width + xx) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; } } }
  };
  r.candidates.slice(1).forEach((c) => draw(c.quad, [255, 200, 0]));
  if (r.quad) draw(r.quad, [0, 220, 0]);
  encode(small, `${out}_detect.jpg`);
  if (r.quad) { const sz = rectifiedSize(r.quad, 1400); const t2 = Date.now(); const wimg = warpPerspective(img, r.quad, sz.width, sz.height); console.log('warpMs', Date.now() - t2, sz); encode(wimg, `${out}_warp.jpg`); }
}
