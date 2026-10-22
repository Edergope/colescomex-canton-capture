import type { Pt, RGBAImage } from './imageops';
import { dist } from './imageops';

export type Quad = [Pt, Pt, Pt, Pt]; // TL, TR, BR, BL (horario, eje y hacia abajo)
export type Mat3 = number[]; // fila mayor, 9 valores

/** Homografía H tal que H·src_i ≅ dst_i (resolución exacta con 4 correspondencias, eliminación gaussiana). */
export function homography(src: Pt[], dst: Pt[]): Mat3 {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) throw new Error('Homografía degenerada');
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  const h = A.map((row, i) => row[8] / row[i]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

export function applyH(H: Mat3, p: Pt): Pt {
  const w = H[6] * p.x + H[7] * p.y + H[8];
  return { x: (H[0] * p.x + H[1] * p.y + H[2]) / w, y: (H[3] * p.x + H[4] * p.y + H[5]) / w };
}

/** Ordena 4 puntos como TL, TR, BR, BL. */
export function orderQuad(pts: Pt[]): Quad {
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 };
  const sorted = [...pts].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x));
  // atan2 con y hacia abajo: orden horario empezando cerca de -π (izquierda). Elegir TL = mínima x+y.
  let start = 0, best = Infinity;
  sorted.forEach((p, i) => { if (p.x + p.y < best) { best = p.x + p.y; start = i; } });
  const q = [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
  return q as Quad;
}

/** Tamaño del rectángulo destino a partir de las longitudes medias de lados opuestos. */
export function rectifiedSize(q: Quad, maxSide = Infinity): { width: number; height: number } {
  let w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  let h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const s = Math.min(1, maxSide / Math.max(w, h));
  w *= s; h *= s;
  return { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) };
}

/**
 * Corrección de perspectiva: muestrea el cuadrilátero `q` de `src` en un rectángulo width×height
 * (mapeo inverso + interpolación bilineal).
 */
export function warpPerspective(src: RGBAImage, q: Quad, width: number, height: number): RGBAImage {
  const H = homography([{ x: 0, y: 0 }, { x: width - 1, y: 0 }, { x: width - 1, y: height - 1 }, { x: 0, y: height - 1 }], q);
  const out = new Uint8ClampedArray(width * height * 4);
  const sw = src.width, sh = src.height, d = src.data;
  for (let y = 0; y < height; y++) {
    // numeradores/denominador lineales en x: se incrementan en lugar de recalcular
    let nx = H[1] * y + H[2], ny = H[4] * y + H[5], nw = H[7] * y + H[8];
    let o = y * width * 4;
    for (let x = 0; x < width; x++, o += 4, nx += H[0], ny += H[3], nw += H[6]) {
      const fx = nx / nw, fy = ny / nw;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) {
        const cx = Math.min(sw - 1, Math.max(0, Math.round(fx))), cy = Math.min(sh - 1, Math.max(0, Math.round(fy)));
        const i = (cy * sw + cx) * 4;
        out[o] = d[i]; out[o + 1] = d[i + 1]; out[o + 2] = d[i + 2]; out[o + 3] = 255;
        continue;
      }
      const ax = fx - x0, ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        const top = d[i00 + c] + (d[i10 + c] - d[i00 + c]) * ax;
        const bot = d[i01 + c] + (d[i11 + c] - d[i01 + c]) * ax;
        out[o + c] = top + (bot - top) * ay;
      }
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}
