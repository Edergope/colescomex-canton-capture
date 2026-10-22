// Primitivas de visión artificial en TypeScript puro (sin DOM): se ejecutan en un Web Worker
// en el navegador y en Node para las pruebas. Todas operan sobre buffers planos.

export interface RGBAImage { width: number; height: number; data: Uint8ClampedArray | Uint8Array }
export interface Pt { x: number; y: number }

/** Reducción por promedio de área (antialias) hasta que el lado mayor sea ≤ maxSide. */
export function downscale(img: RGBAImage, maxSide: number): { img: RGBAImage; scale: number } {
  const s = Math.min(1, maxSide / Math.max(img.width, img.height));
  if (s === 1) return { img, scale: 1 };
  const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
  const out = new Uint8ClampedArray(w * h * 4);
  const fx = img.width / w, fy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * img.width + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) { r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++; }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { img: { width: w, height: h, data: out }, scale: w / img.width };
}

/** Luminancia (0-255) y saturación (0-1) por píxel. */
export function lumaSat(img: RGBAImage): { L: Float32Array; S: Float32Array } {
  const n = img.width * img.height, L = new Float32Array(n), S = new Float32Array(n);
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    L[p] = 0.299 * r + 0.587 * g + 0.114 * b;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    S[p] = mx > 0 ? (mx - mn) / mx : 0;
  }
  return { L, S };
}

/** Desenfoque de caja separable de radio r. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return src.slice();
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), d = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / d;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / d;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
}

/** Magnitud y componentes del gradiente de Sobel. */
export function sobel(src: Float32Array, w: number, h: number): { mag: Float32Array; gx: Float32Array; gy: Float32Array } {
  const mag = new Float32Array(w * h), gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = src[i - w - 1], b = src[i - w], c = src[i - w + 1], d = src[i - 1], f = src[i + 1], g = src[i + w - 1], hh = src[i + w], k = src[i + w + 1];
      const sx = (c + 2 * f + k) - (a + 2 * d + g);
      const sy = (g + 2 * hh + k) - (a + 2 * b + c);
      gx[i] = sx; gy[i] = sy; mag[i] = Math.hypot(sx, sy);
    }
  }
  return { mag, gx, gy };
}

/** Umbral de Otsu sobre valores en [0,255]. */
export function otsu(values: ArrayLike<number>): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < values.length; i++) hist[Math.max(0, Math.min(255, values[i] | 0))]++;
  const total = values.length;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

export function percentile(values: Float32Array, q: number): number {
  const step = Math.max(1, Math.floor(values.length / 20000));
  const sample: number[] = [];
  for (let i = 0; i < values.length; i += step) sample.push(values[i]);
  sample.sort((a, b) => a - b);
  return sample[Math.min(sample.length - 1, Math.floor(q * sample.length))];
}

/** Dilatación / erosión binaria con elemento cuadrado (separable). */
export function morph(bin: Uint8Array, w: number, h: number, r: number, op: 'dilate' | 'erode'): Uint8Array {
  if (r <= 0) return bin.slice();
  const want = op === 'dilate' ? 1 : 0;
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w; let last = -1e9;
    // distancia al último píxel "want" a la izquierda/derecha
    const left = new Int32Array(w);
    for (let x = 0; x < w; x++) { if (bin[row + x] === want) last = x; left[x] = x - last; }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) {
      if (bin[row + x] === want) last = x;
      const near = Math.min(left[x], last - x) <= r;
      tmp[row + x] = near ? want : 1 - want;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9; const up = new Int32Array(h);
    for (let y = 0; y < h; y++) { if (tmp[y * w + x] === want) last = y; up[y] = y - last; }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x] === want) last = y;
      out[y * w + x] = Math.min(up[y], last - y) <= r ? want : 1 - want;
    }
  }
  return out;
}

export interface Component { label: number; area: number; minX: number; minY: number; maxX: number; maxY: number; touchesBorder: number }

/** Componentes conexas (4-vecindad) de los píxeles a 1. */
export function components(bin: Uint8Array, w: number, h: number): { labels: Int32Array; comps: Component[] } {
  const labels = new Int32Array(w * h);
  const comps: Component[] = [];
  const stack = new Int32Array(w * h);
  let next = 0;
  for (let s = 0; s < w * h; s++) {
    if (!bin[s] || labels[s]) continue;
    next++;
    const c: Component = { label: next, area: 0, minX: w, minY: h, maxX: 0, maxY: 0, touchesBorder: 0 };
    let sp = 0; stack[sp++] = s; labels[s] = next;
    while (sp) {
      const p = stack[--sp]; const x = p % w, y = (p - x) / w;
      c.area++;
      if (x < c.minX) c.minX = x; if (x > c.maxX) c.maxX = x; if (y < c.minY) c.minY = y; if (y > c.maxY) c.maxY = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.touchesBorder++;
      if (x > 0 && bin[p - 1] && !labels[p - 1]) { labels[p - 1] = next; stack[sp++] = p - 1; }
      if (x < w - 1 && bin[p + 1] && !labels[p + 1]) { labels[p + 1] = next; stack[sp++] = p + 1; }
      if (y > 0 && bin[p - w] && !labels[p - w]) { labels[p - w] = next; stack[sp++] = p - w; }
      if (y < h - 1 && bin[p + w] && !labels[p + w]) { labels[p + w] = next; stack[sp++] = p + w; }
    }
    comps.push(c);
  }
  return { labels, comps };
}

/** Píxeles de borde de una componente (vecino 4 fuera de ella). */
export function boundaryPoints(labels: Int32Array, w: number, h: number, c: Component): Pt[] {
  const pts: Pt[] = [];
  for (let y = c.minY; y <= c.maxY; y++) {
    for (let x = c.minX; x <= c.maxX; x++) {
      const i = y * w + x;
      if (labels[i] !== c.label) continue;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || labels[i - 1] !== c.label || labels[i + 1] !== c.label || labels[i - w] !== c.label || labels[i + w] !== c.label) pts.push({ x, y });
    }
  }
  return pts;
}

/** Envolvente convexa (cadena monótona). Devuelve los vértices en sentido horario (eje y hacia abajo). */
export function convexHull(points: Pt[]): Pt[] {
  const p = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

export function polygonArea(poly: Pt[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Simplificación Douglas-Peucker de un polígono cerrado. */
export function simplifyClosed(poly: Pt[], eps: number): Pt[] {
  if (poly.length <= 8) return poly;
  // partir por los dos puntos más alejados
  let i0 = 0, i1 = 0, best = -1;
  for (let i = 0; i < poly.length; i++) { const d = dist(poly[0], poly[i]); if (d > best) { best = d; i1 = i; } }
  const a = poly.slice(i0, i1 + 1), b = poly.slice(i1).concat([poly[0]]);
  const dp = (pts: Pt[]): Pt[] => {
    if (pts.length < 3) return pts;
    const s = pts[0], e = pts[pts.length - 1];
    const L = dist(s, e) || 1;
    let idx = 0, md = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = Math.abs((e.x - s.x) * (s.y - pts[i].y) - (s.x - pts[i].x) * (e.y - s.y)) / L;
      if (d > md) { md = d; idx = i; }
    }
    if (md <= eps) return [s, e];
    const l = dp(pts.slice(0, idx + 1)), r = dp(pts.slice(idx));
    return l.slice(0, -1).concat(r);
  };
  const ra = dp(a), rb = dp(b);
  return ra.slice(0, -1).concat(rb.slice(0, -1));
}

/** Rotación de 90°·k (sentido horario) de una imagen RGBA. */
export function rotate90(img: RGBAImage, k: number): RGBAImage {
  const q = ((k % 4) + 4) % 4;
  if (q === 0) return img;
  const { width: w, height: h, data } = img;
  const W = q % 2 ? h : w, H = q % 2 ? w : h;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let X: number, Y: number;
      if (q === 1) { X = h - 1 - y; Y = x; } else if (q === 2) { X = w - 1 - x; Y = h - 1 - y; } else { X = y; Y = w - 1 - x; }
      const si = (y * w + x) * 4, di = (Y * W + X) * 4;
      out[di] = data[si]; out[di + 1] = data[si + 1]; out[di + 2] = data[si + 2]; out[di + 3] = data[si + 3];
    }
  }
  return { width: W, height: H, data: out };
}
