// Composiciones "antes / después" para la documentación: foto con el contorno detectado + documento procesado.
// Requiere haber ejecutado ocr-eval/run-scanner-eval.mjs (docs/scanner/after/*.jpg). Uso: node --import tsx scripts/before-after.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { detectDocument } from '../src/scanner/detect';
import { downscale, type RGBAImage } from '../src/scanner/imageops';
import { privateDir } from './private-dir.mjs';

const FX = 'ocr-eval/scanner-fixtures', AFTER = 'docs/scanner/after', OUT = 'docs/scanner/before-after';
const PFX = path.join(privateDir(), 'scanner-fixtures'), PAFTER = path.join(privateDir(), 'reports', 'after'), POUT = path.join(privateDir(), 'reports', 'before-after');
mkdirSync(OUT, { recursive: true });
const dec = (p: string): RGBAImage => { const j = jpeg.decode(readFileSync(p), { useTArray: true, maxMemoryUsageInMB: 2048 }); return { width: j.width, height: j.height, data: new Uint8ClampedArray(j.data.buffer) }; };
const CASES = ['real_R1_front_rot0', 'real_R1_back_rot0', 'real_R1_front_rot180', 'syn_table_oblique_rot90', 'syn_fingers', 'syn_qr_border', 'syn_vertical_card', 'syn_white_on_light', 'syn_multiple_cards', 'syn_undetectable', 'syn_dark_card'];
for (const name of CASES) {
  // tarjetas reales: entrada y salida en el directorio privado
  const isPriv = name.startsWith('real_');
  const src = path.join(isPriv ? PFX : FX, `${name}.jpg`);
  if (!existsSync(src)) { console.log(name, 'omitido (privado no disponible)'); continue; }
  const img = dec(src);
  const r = detectDocument(img);
  const H = 900;
  const { img: left, scale } = downscale(img, H);
  const crop = r.status === 'ok' && !r.multiple;
  const col = crop ? [0, 220, 70] : [255, 150, 0];
  const quads = r.multiple ? r.candidates.slice(0, 2).map((c) => c.quad) : r.quad ? [r.quad] : [];
  for (const q of quads) for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    for (let t = 0; t <= 1; t += 0.0008) {
      const x = Math.round((a.x + (b.x - a.x) * t) * scale), y = Math.round((a.y + (b.y - a.y) * t) * scale);
      for (let o = -2; o <= 2; o++) for (let p = -2; p <= 2; p++) { const xx = x + o, yy = y + p; if (xx < 0 || yy < 0 || xx >= left.width || yy >= left.height) continue; const i = (yy * left.width + xx) * 4; left.data.set(col, i); }
    }
  }
  const afterPath = path.join(isPriv ? PAFTER : AFTER, `${name}.jpg`);
  const right = existsSync(afterPath) ? downscale(dec(afterPath), H).img : null;
  const rh = right ? Math.min(left.height, Math.round((right.height * Math.min(left.height / right.height, 900 / right.width)))) : 0;
  const rr = right ? downscale(right, Math.max(rh, Math.round(rh * right.width / right.height))).img : null;
  const W = left.width + 20 + (rr?.width ?? 0), Hh = Math.max(left.height, rr?.height ?? 0);
  const out = new Uint8ClampedArray(W * Hh * 4).fill(255);
  const blit = (src: RGBAImage, ox: number) => { for (let y = 0; y < src.height; y++) out.set(src.data.subarray(y * src.width * 4, (y + 1) * src.width * 4), ((y * W) + ox) * 4); };
  blit(left, 0); if (rr) blit(rr, left.width + 20);
  if (isPriv) mkdirSync(POUT, { recursive: true });
  writeFileSync(path.join(isPriv ? POUT : OUT, `${name}.jpg`), jpeg.encode({ width: W, height: Hh, data: Buffer.from(out.buffer) }, 82).data);
  console.log(name, r.status, r.multiple ? 'multiple' : '', crop ? 'recorte' : 'revisión');
}
