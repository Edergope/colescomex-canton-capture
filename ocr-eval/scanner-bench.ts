// Banco de evaluación del DETECTOR de documentos (Node, reproducible, sin navegador).
//   node --import tsx ocr-eval/scanner-bench.ts [--n=240] [--seed=7] [--save=fallos] [--only=texto]
// Genera escenas con verdad de referencia exacta (tarjetas bilingües de ocr-eval/fixtures proyectadas con
// homografía conocida) en condiciones de feria y compara el detector publicado (v1.2.1, copia congelada)
// con el actual (src/scanner/detect.ts), con la MISMA tubería que el worker (pirámide 1600 / 720 px).
// Si existe el directorio privado, añade las fotos reales anotadas (resultados solo en el directorio privado).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { homography, applyH, orderQuad, type Quad } from '../src/scanner/homography';
import { downscale, rotate90, type RGBAImage, type Pt } from '../src/scanner/imageops';
import { BUSINESS_CARD } from '../src/scanner/profiles';
import { DETECT_WORK_SIDE, FINE_SIDE, detectDocument as detectNew } from '../src/scanner/detect';
import { detectDocument as detectOld } from './bench/detect-v1.2.1';
import { privateDir } from '../scripts/private-dir.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
const N = Number(arg('n') ?? 240);
let seed = Number(arg('seed') ?? 7);
const SAVE = arg('save'); // 'fallos' → guarda imágenes de los fallos (solo sintéticas) en ocr-eval/results/bench
const ONLY = arg('only');
// mulberry32: generador pseudoaleatorio de calidad (el LCG anterior repetía escenas)
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => a + (b - a) * rnd();

function decode(p: string): RGBAImage {
  const buf = readFileSync(p);
  if (p.endsWith('.png')) { const x = PNG.sync.read(buf); return { width: x.width, height: x.height, data: new Uint8ClampedArray(x.data) }; }
  const j = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 2048 });
  return { width: j.width, height: j.height, data: new Uint8ClampedArray(j.data.buffer) };
}
const encodeJpeg = (img: RGBAImage, q: number) => jpeg.encode({ width: img.width, height: img.height, data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length) }, q).data;

// ── Tarjetas (texturas) ────────────────────────────────────────────────────────────────────────────────────
const CARD_FILES = ['c1_front', 'c1_back', 'c2_front', 'c2_back', 'c3_front', 'c4_front', 'c4_back', 'c5_front', 'c6_front'];
const cardCache = new Map<string, RGBAImage>();
const baseCard = (id: string) => { if (!cardCache.has(id)) cardCache.set(id, downscale(decode(path.join(dir, 'fixtures', `${id}_scan.png`)), 900).img); return cardCache.get(id)!; };
type CardStyle = 'white' | 'cream' | 'dark' | 'colored' | 'metallic' | 'framed' | 'dark_block';
function styleCard(src: RGBAImage, style: CardStyle): RGBAImage {
  const { width: w, height: h } = src; const d = new Uint8ClampedArray(src.data);
  const tint = pick([[180, 30, 40], [20, 70, 160], [20, 120, 80], [230, 140, 20]]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const L = (d[i] + d[i + 1] + d[i + 2]) / 3; const ink = 1 - L / 255; // 0 papel, 1 tinta
    if (style === 'cream') { d[i] = Math.min(255, d[i] * 0.98 + 4); d[i + 1] = d[i + 1] * 0.95; d[i + 2] = d[i + 2] * 0.85; }
    else if (style === 'dark') { const v = 22 + ink * 210; d[i] = v * 0.9; d[i + 1] = v * 0.92; d[i + 2] = v + 12 * (1 - ink); } // fondo azul noche, texto claro
    else if (style === 'colored') { for (let k = 0; k < 3; k++) d[i + k] = tint[k] * (1 - ink) + 250 * ink; } // fondo de color, texto blanco
    else if (style === 'metallic') { const g = 150 + 60 * Math.sin((x + y) / (w * 0.15)) + 25 * Math.sin(x / 7); const v = g * (1 - ink) + 30 * ink; d[i] = v; d[i + 1] = v; d[i + 2] = v + 6; }
  }
  const out = { width: w, height: h, data: d };
  if (style === 'framed') { const b = Math.round(0.035 * Math.min(w, h)); fillRect(out, 0, 0, w, b, [30, 40, 60]); fillRect(out, 0, h - b, w, b, [30, 40, 60]); fillRect(out, 0, 0, b, h, [30, 40, 60]); fillRect(out, w - b, 0, b, h, [30, 40, 60]); }
  if (style === 'dark_block') fillRect(out, 0, 0, Math.round(w * 0.38), h, [25, 35, 70]); // franja de color de marca pegada a un borde
  return out;
}
function fillRect(img: RGBAImage, x0: number, y0: number, w: number, h: number, c: number[]) {
  for (let y = Math.max(0, y0); y < Math.min(img.height, y0 + h); y++) for (let x = Math.max(0, x0); x < Math.min(img.width, x0 + w); x++) {
    const i = (y * img.width + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
  }
}

// ── Fondos ────────────────────────────────────────────────────────────────────────────────────────────────
type Bg = 'white_table' | 'light_grey' | 'wood' | 'dark' | 'fabric' | 'clutter' | 'gradient';
function background(w: number, h: number, kind: Bg): RGBAImage {
  const d = new Uint8ClampedArray(w * h * 4);
  const ph = rnd() * 10;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; let r: number, g: number, b: number;
    if (kind === 'white_table') { const v = 236 + 6 * Math.sin(x * 0.004 + ph) - 10 * (y / h); r = v; g = v; b = v - 3; }
    else if (kind === 'light_grey') { const v = 190 + 10 * Math.sin(x * 0.01 + y * 0.008 + ph); r = v; g = v + 2; b = v + 5; }
    else if (kind === 'wood') { const v = 0.5 + 0.5 * Math.sin(x * 0.02 + Math.sin(y * 0.01 + ph) * 3); r = 120 + 50 * v; g = 80 + 35 * v; b = 50 + 20 * v; }
    else if (kind === 'dark') { r = 25 + 10 * Math.sin(y * 0.05 + ph); g = 28; b = 35; }
    else if (kind === 'fabric') { const v = 90 + 25 * Math.sin(x * 0.35) * Math.sin(y * 0.35 + ph); r = v * 0.6; g = v * 0.8; b = v * 1.2; }
    else if (kind === 'clutter') { const v = 160 + 30 * Math.sin(x * 0.01 + ph); r = v; g = v - 10; b = v - 25; }
    else { r = 60 + (150 * x) / w; g = 70 + (120 * y) / h; b = 90; }
    const n = (rnd() - 0.5) * 12;
    d[i] = r + n; d[i + 1] = g + n; d[i + 2] = b + n; d[i + 3] = 255;
  }
  const img = { width: w, height: h, data: d };
  if (kind === 'clutter') for (let k = 0; k < 7; k++) { // objetos detrás: papeles blancos, teléfono oscuro, folletos de color
    const c = pick([[245, 245, 240], [20, 20, 25], [200, 60, 50], [60, 90, 170], [235, 220, 180]]);
    fillRect(img, Math.round(between(-0.1, 0.9) * w), Math.round(between(-0.1, 0.9) * h), Math.round(between(0.12, 0.35) * w), Math.round(between(0.08, 0.3) * h), c);
  }
  return img;
}

function project(scene: RGBAImage, card: RGBAImage, q: Quad, shadow: boolean) {
  const H = homography(q, [{ x: 0, y: 0 }, { x: card.width - 1, y: 0 }, { x: card.width - 1, y: card.height - 1 }, { x: 0, y: card.height - 1 }]);
  const xs = q.map((p) => p.x), ys = q.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 30), x1 = Math.min(scene.width - 1, Math.ceil(Math.max(...xs)) + 30);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 30), y1 = Math.min(scene.height - 1, Math.ceil(Math.max(...ys)) + 30);
  const d = scene.data;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = applyH(H, { x, y }); const i = (y * scene.width + x) * 4;
    if (c.x >= 0 && c.y >= 0 && c.x <= card.width - 1 && c.y <= card.height - 1) {
      const cx = Math.min(card.width - 2, Math.floor(c.x)), cy = Math.min(card.height - 2, Math.floor(c.y)), ax = c.x - cx, ay = c.y - cy; const j = (cy * card.width + cx) * 4;
      for (let k = 0; k < 3; k++) { const t = card.data[j + k] + (card.data[j + 4 + k] - card.data[j + k]) * ax; const b = card.data[j + card.width * 4 + k] + (card.data[j + card.width * 4 + 4 + k] - card.data[j + card.width * 4 + k]) * ax; d[i + k] = t + (b - t) * ay; }
    } else if (shadow) { const s = applyH(H, { x: x - 10, y: y - 14 }); if (s.x >= 0 && s.y >= 0 && s.x <= card.width - 1 && s.y <= card.height - 1) for (let k = 0; k < 3; k++) d[i + k] *= 0.72; }
  }
}
function ellipse(scene: RGBAImage, cx: number, cy: number, rx: number, ry: number, a: number, color: (u: number) => number[], alpha: (u: number) => number) {
  const ca = Math.cos(a), sa = Math.sin(a), R = Math.max(rx, ry);
  for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(scene.height, cy + R); y++) for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(scene.width, cx + R); x++) {
    const dx = x - cx, dy = y - cy; const u = (dx * ca + dy * sa) / rx, v = (-dx * sa + dy * ca) / ry; const r2 = u * u + v * v;
    if (r2 <= 1) { const i = (y * scene.width + x) * 4; const al = alpha(r2), c = color(r2); for (let k = 0; k < 3; k++) scene.data[i + k] = scene.data[i + k] * (1 - al) + c[k] * al; }
  }
}
const fingerAt = (s: RGBAImage, p: Pt, ang: number, len: number) => ellipse(s, p.x, p.y, len, len * 0.32, ang, (r2) => [205 * (0.85 + 0.15 * (1 - r2)), 150 * (0.85 + 0.15 * (1 - r2)), 125], () => 1);
const glare = (s: RGBAImage, p: Pt, r: number) => ellipse(s, p.x, p.y, r, r * 0.6, rnd() * 3, () => [255, 255, 252], (r2) => Math.min(1, 1.25 * (1 - r2)));
function blur(scene: RGBAImage, r: number) {
  const { width: w, height: h } = scene; const src = scene.data; const tmp = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) { let s = 0; for (let o = -r; o <= r; o++) s += src[(y * w + Math.min(w - 1, Math.max(0, x + o))) * 4 + k]; tmp[(y * w + x) * 4 + k] = s / (2 * r + 1); }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) { let s = 0; for (let o = -r; o <= r; o++) s += tmp[(Math.min(h - 1, Math.max(0, y + o)) * w + x) * 4 + k]; src[(y * w + x) * 4 + k] = s / (2 * r + 1); }
}
function lighting(scene: RGBAImage, ang: number, strength: number) {
  const { width: w, height: h, data } = scene;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const t = (x / w) * Math.cos(ang) + (y / h) * Math.sin(ang); const f = 1 - strength * Math.max(0, Math.min(1, t)); const i = (y * w + x) * 4; data[i] *= f; data[i + 1] *= f; data[i + 2] *= f; }
}

// ── Escenas ───────────────────────────────────────────────────────────────────────────────────────────────
type Cond = 'none' | 'glare' | 'fingers' | 'perspective' | 'rotated' | 'vertical' | 'blur' | 'uneven' | 'jpeg' | 'partial' | 'small' | 'multiple';
interface Scene { id: string; img: RGBAImage; gt: Quad | null; bg: Bg; style: CardStyle; cond: Cond; tags: string; ink?: Pt[] }
const BGS: Bg[] = ['white_table', 'light_grey', 'wood', 'dark', 'fabric', 'clutter', 'gradient'];
const STYLES: CardStyle[] = ['white', 'white', 'cream', 'dark', 'colored', 'metallic', 'framed', 'dark_block'];
const CONDS: Cond[] = ['none', 'glare', 'fingers', 'perspective', 'rotated', 'vertical', 'blur', 'uneven', 'jpeg', 'partial', 'small', 'multiple', 'perspective', 'fingers', 'glare'];

function makeScene(k: number): Scene {
  const portrait = rnd() < 0.75; const W = portrait ? 1500 : 2000, H = portrait ? 2000 : 1500;
  const bg = pick(BGS), style = pick(STYLES), cond = pick(CONDS);
  const scene = background(W, H, bg);
  let card = styleCard(baseCard(pick(CARD_FILES)), style);
  const vertical = cond === 'vertical';
  if (vertical) card = rotate90(card, 1);
  const ar = card.width / card.height;
  // tamaño en la foto: 35–80 % del lado corto (las fotos de feria suelen encuadrar la tarjeta de cerca)
  const frac = cond === 'small' ? between(0.2, 0.3) : between(0.45, 0.8);
  let cw = Math.min(W, H) * frac * (vertical ? 1 : 1.0), ch = cw / ar;
  if (vertical) { ch = Math.min(W, H) * frac * 1.2; cw = ch * ar; }
  const ang = cond === 'rotated' ? between(-Math.PI, Math.PI) : between(-0.25, 0.25);
  const tilt = cond === 'perspective' ? between(0.08, 0.2) : between(0, 0.04), skew = cond === 'perspective' ? between(0.05, 0.15) : between(0, 0.03);
  const cx = W / 2 + between(-0.12, 0.12) * W, cy = H / 2 + between(-0.12, 0.12) * H;
  const local = [{ x: -cw / 2 + skew * cw, y: -ch / 2 }, { x: cw / 2 - skew * cw, y: -ch / 2 + tilt * ch }, { x: cw / 2, y: ch / 2 }, { x: -cw / 2, y: ch / 2 - tilt * ch }];
  const c = Math.cos(ang), s = Math.sin(ang);
  let q = local.map((p) => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c })) as Quad;
  if (cond === 'partial') { const dx = (pick([-1, 1]) * W) * between(0.32, 0.45); q = q.map((p) => ({ x: p.x + dx, y: p.y })) as Quad; } // un lado fuera del encuadre
  let gt: Quad | null = cond === 'partial' ? null : q;
  if (cond === 'multiple') { // dos tarjetas comparables: no debe recortar a ciegas
    const q2 = q.map((p) => ({ x: p.x * 0.55 + W * 0.05, y: p.y * 0.55 + H * 0.02 })) as Quad;
    q = q.map((p) => ({ x: p.x * 0.55 + W * 0.42, y: p.y * 0.55 + H * 0.45 })) as Quad;
    project(scene, styleCard(baseCard(pick(CARD_FILES)), pick(STYLES)), q2, true);
    gt = null;
  }
  project(scene, card, q, bg !== 'white_table' || rnd() < 0.5);
  const ink = gt ? inkPoints(card, q) : undefined;
  if (cond === 'fingers') { // dedos sobre dos lados opuestos (cómo se sostiene una tarjeta)
    const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const left = mid(q[0], q[3]), right = mid(q[1], q[2]);
    const dirA = Math.atan2(left.y - cy, left.x - cx), dirB = Math.atan2(right.y - cy, right.x - cx);
    fingerAt(scene, { x: left.x + Math.cos(dirA) * cw * 0.12, y: left.y + Math.sin(dirA) * cw * 0.12 + between(-0.2, 0.2) * ch }, dirA, cw * 0.2);
    fingerAt(scene, { x: right.x + Math.cos(dirB) * cw * 0.12, y: right.y + Math.sin(dirB) * cw * 0.12 + between(-0.2, 0.2) * ch }, dirB, cw * 0.2);
  }
  if (cond === 'glare') { const t = rnd(); const e = Math.floor(rnd() * 4); const a = q[e], b = q[(e + 1) % 4]; glare(scene, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, cw * between(0.12, 0.25)); }
  if (cond === 'blur') blur(scene, 3);
  if (cond === 'uneven') lighting(scene, rnd() * 6, 0.55);
  let img = scene;
  if (cond === 'jpeg' || rnd() < 0.3) img = decode2(encodeJpeg(scene, cond === 'jpeg' ? 45 : 85));
  return { id: `s${String(k).padStart(3, '0')}`, img, gt, bg, style, cond, tags: `${bg}/${style}/${cond}`, ink };
}
/** Puntos de TINTA (texto, logotipos) de la tarjeta proyectados en la escena: miden el texto cortado. */
function inkPoints(card: RGBAImage, q: Quad): Pt[] {
  const H = homography([{ x: 0, y: 0 }, { x: card.width - 1, y: 0 }, { x: card.width - 1, y: card.height - 1 }, { x: 0, y: card.height - 1 }], q);
  const Ls: number[] = []; for (let i = 0; i < card.data.length; i += 4 * 37) Ls.push((card.data[i] + card.data[i + 1] + card.data[i + 2]) / 3);
  const med = Ls.sort((a, b) => a - b)[Math.floor(Ls.length / 2)];
  const pts: Pt[] = []; const m = Math.round(0.04 * Math.min(card.width, card.height)); // fuera del margen del borde/marco
  for (let y = m; y < card.height - m; y += 3) for (let x = m; x < card.width - m; x += 3) {
    const i = (y * card.width + x) * 4; const L = (card.data[i] + card.data[i + 1] + card.data[i + 2]) / 3;
    if (Math.abs(L - med) > 70) pts.push(applyH(H, { x, y }));
  }
  return pts;
}
function decode2(buf: Buffer): RGBAImage { const j = jpeg.decode(buf, { useTArray: true }); return { width: j.width, height: j.height, data: new Uint8ClampedArray(j.data.buffer) }; }

// ── Métricas ──────────────────────────────────────────────────────────────────────────────────────────────
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
function inQuad(q: Pt[], p: Pt): boolean { let sign = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); if (cr !== 0) { if (!sign) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false; } } return true; }
function compare(pred: Quad, gt: Quad) {
  const P = orderQuad(pred), G = orderQuad(gt);
  let err = Infinity; for (let r = 0; r < 4; r++) err = Math.min(err, Math.max(...G.map((g, i) => dist(g, P[(i + r) % 4]))));
  const diag = Math.max(dist(G[0], G[2]), dist(G[1], G[3]));
  const xs = [...P, ...G].map((p) => p.x), ys = [...P, ...G].map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let inG = 0, inP = 0, lost = 0, extra = 0; const n = 80;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const p = { x: x0 + ((x1 - x0) * (i + 0.5)) / n, y: y0 + ((y1 - y0) * (j + 0.5)) / n };
    const g = inQuad(G, p), q = inQuad(P, p);
    if (g) inG++; if (q) inP++; if (g && !q) lost++; if (q && !g) extra++;
  }
  return { cornerErr: err / diag, contentLoss: inG ? lost / inG : 1, extra: inP ? extra / inP : 1 };
}
type Outcome = 'correcto' | 'aceptable' | 'falso_positivo' | 'conserva_foto' | 'revisión_correcta';
function classify(r: ReturnType<typeof detectOld>, gt: Quad | null, ink?: Pt[]) {
  const cropped = (r.status === 'ok') && !r.multiple && !!r.quad;
  if (!gt) return { outcome: (cropped ? 'falso_positivo' : 'revisión_correcta') as Outcome, m: null };
  if (!cropped) return { outcome: 'conserva_foto' as Outcome, m: r.quad ? compare(r.quad, gt) : null };
  const m: ReturnType<typeof compare> & { textLoss?: number } = compare(r.quad!, gt);
  if (ink?.length) { const P = orderQuad(r.quad!); m.textLoss = ink.filter((p) => !inQuad(P, p)).length / ink.length; }
  // correcto: esquinas ≤2 % de la diagonal de la tarjeta; aceptable: no corta texto (≤0,5 % de la tinta) ni incluye >6 % de fondo
  const textOk = m.textLoss !== undefined ? m.textLoss <= 0.005 : m.contentLoss <= 0.01;
  const outcome: Outcome = m.cornerErr <= 0.02 ? 'correcto' : textOk && m.extra <= 0.06 ? 'aceptable' : 'falso_positivo';
  return { outcome, m };
}

const runDetector = (fn: typeof detectOld, img: RGBAImage) => {
  const fine = downscale(img, FINE_SIDE).img, work = downscale(fine, DETECT_WORK_SIDE).img; // misma pirámide que el worker
  return fn(img, { work, fine }, BUSINESS_CARD.detect);
};
/** pista de la cámara: fotograma de 480 px sin escala fina (como camera-hint.worker.ts en v1.2.1) */
const runHint = (fn: typeof detectOld, img: RGBAImage) => { const s = downscale(img, 480).img; const r = fn(s, { work: s, fine: s }, BUSINESS_CARD.detect); return { ...r, quad: r.quad?.map((p) => ({ x: (p.x * img.width) / s.width, y: (p.y * img.height) / s.height })) as Quad | undefined }; };

export { makeScene, runDetector, classify, compare };
const MAIN = process.argv[1]?.endsWith('scanner-bench.ts');
interface Row { id: string; tags: string; cond: string; style: string; bg: string; real: boolean; old: Outcome; new: Outcome; oldM: unknown; newM: unknown; oldConf: number; newConf: number; oldMs: number; newMs: number; hintOk: boolean; newMethod?: string; hintVsFinal?: number | null }
const rows: Row[] = [];
if (!MAIN) { /* importado: sin informe */ }
const OUT = path.join(dir, 'results', 'bench'); mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
for (let k = 0; MAIN && k < N; k++) {
  const sc = makeScene(k);
  if (ONLY && !sc.tags.includes(ONLY)) continue;
  const a = Date.now(); const ro = runDetector(detectOld, sc.img); const mo = Date.now() - a;
  const b = Date.now(); const rn = runDetector(detectNew, sc.img); const mn = Date.now() - b;
  const co = classify(ro, sc.gt, sc.ink), cn = classify(rn, sc.gt, sc.ink);
  const hint = runHint(detectOld, sc.img);
  const hintOk = hint.status === 'ok' && !hint.multiple;
  rows.push({ id: sc.id, tags: sc.tags, cond: sc.cond, style: sc.style, bg: sc.bg, real: false, newMethod: rn.method, old: co.outcome, new: cn.outcome, oldM: co.m, newM: cn.m, oldConf: ro.confidence, newConf: rn.confidence, oldMs: mo, newMs: mn, hintOk,
    hintVsFinal: hintOk && sc.gt ? compare(hint.quad!, sc.gt).cornerErr : null });
  if (SAVE && (co.outcome === 'falso_positivo' || cn.outcome === 'falso_positivo' || cn.outcome === 'conserva_foto')) writeFileSync(path.join(OUT, `${sc.id}_${sc.tags.replace(/\//g, '-')}.jpg`), encodeJpeg(downscale(sc.img, 900).img, 80));
}

// fotos reales anotadas (privadas): solo se informan agregadas; las imágenes nunca salen del directorio privado
const privManifest = path.join(privateDir(), 'scanner-fixtures');
const manifest = existsSync(path.join(dir, 'scanner-fixtures', 'manifest.json')) ? JSON.parse(readFileSync(path.join(dir, 'scanner-fixtures', 'manifest.json'), 'utf8')) as { name: string; file: string; private?: boolean; quad: Pt[] | null; source: string }[] : [];
for (const c of (MAIN ? manifest : []).filter((m) => m.source === 'real' && m.private)) {
  const f = path.join(privManifest, c.file); if (!existsSync(f)) continue;
  const img = decode(f);
  const ro = runDetector(detectOld, img), rn = runDetector(detectNew, img);
  const co = classify(ro, c.quad as Quad | null), cn = classify(rn, c.quad as Quad | null);
  rows.push({ id: c.name, tags: 'real/privada', cond: 'real', style: 'real', bg: 'real', real: true, old: co.outcome, new: cn.outcome, oldM: co.m, newM: cn.m, oldConf: ro.confidence, newConf: rn.confidence, oldMs: 0, newMs: 0, hintOk: false });
}

// ── Informe ───────────────────────────────────────────────────────────────────────────────────────────────
const OUTCOMES: Outcome[] = ['correcto', 'aceptable', 'falso_positivo', 'conserva_foto', 'revisión_correcta'];
function summary(rs: Row[], key: 'old' | 'new') {
  const c = Object.fromEntries(OUTCOMES.map((o) => [o, rs.filter((r) => r[key] === o).length])) as Record<Outcome, number>;
  const croppable = rs.filter((r) => r.cond !== 'partial' && r.cond !== 'multiple').length;
  const ms = rs.filter((r) => !r.real).map((r) => (key === 'old' ? r.oldMs : r.newMs)).sort((a, b) => a - b);
  const losses = rs.map((r) => (key === 'old' ? r.oldM : r.newM) as { contentLoss: number } | null).filter((m, i) => m && ['correcto', 'aceptable', 'falso_positivo'].includes(rs[i][key])).map((m) => m!.contentLoss);
  return { ...c, total: rs.length, croppable,
    recorte_util_pct: +((100 * (c.correcto + c.aceptable)) / Math.max(1, croppable)).toFixed(1),
    falsos_positivos_pct: +((100 * c.falso_positivo) / Math.max(1, rs.length)).toFixed(1),
    conserva_foto_pct: +((100 * c.conserva_foto) / Math.max(1, croppable)).toFixed(1),
    perdida_contenido_media_pct: losses.length ? +((100 * losses.reduce((a, b) => a + b, 0)) / losses.length).toFixed(2) : 0,
    perdida_contenido_max_pct: losses.length ? +(100 * Math.max(...losses)).toFixed(1) : 0,
    recortes_con_texto_cortado: rs.filter((r) => ['correcto', 'aceptable', 'falso_positivo'].includes(r[key]) && ((key === 'old' ? r.oldM : r.newM) as { textLoss?: number } | null)?.textLoss! > 0.005).length,
    ms_mediana: ms[Math.floor(ms.length / 2)] ?? 0, ms_p95: ms[Math.floor(ms.length * 0.95)] ?? 0 };
}
const syn = rows.filter((r) => !r.real), real = rows.filter((r) => r.real);
const groupBy = (k: 'cond' | 'style' | 'bg') => Object.fromEntries([...new Set(syn.map((r) => r[k]))].sort().map((g) => {
  const rs = syn.filter((r) => r[k] === g); const o = summary(rs, 'old'), n = summary(rs, 'new');
  return [g, { n: rs.length, antes: `${o.recorte_util_pct}% útil · ${o.falso_positivo} FP`, despues: `${n.recorte_util_pct}% útil · ${n.falso_positivo} FP` }];
}));
const hintRows = syn.filter((r) => r.hintOk);
const report = {
  generado: new Date().toISOString(), escenas_sinteticas: syn.length, semilla: Number(arg('seed') ?? 7),
  criterios: { correcto: 'recorte automático con esquinas ≤2 % de la diagonal de la tarjeta', aceptable: 'recorte que no corta texto (≤0,5 % de la tinta fuera) y con ≤6 % de fondo (p. ej. pierde solo un filete o marco decorativo)', falso_positivo: 'recorte automático declarado fiable que corta la tarjeta o incluye fondo, o recorte cuando debía pedir revisión', conserva_foto: 'el detector no se fía: conserva la foto completa y pide revisión/ajuste' },
  sinteticas: { antes_v1_2_1: summary(syn, 'old'), despues: summary(syn, 'new') },
  reales_privadas: real.length ? { n: real.length, antes_v1_2_1: summary(real, 'old'), despues: summary(real, 'new') } : 'no disponibles',
  por_condicion: groupBy('cond'), por_tarjeta: groupBy('style'), por_fondo: groupBy('bg'),
  pista_camara_v1_2_1: { dice_tarjeta_detectada: hintRows.length, de_ellas_con_error_mayor_3pct: hintRows.filter((r) => (r.hintVsFinal ?? 0) > 0.03).length, de_ellas_sin_tarjeta_recortable: syn.filter((r) => r.hintOk && (r.cond === 'partial' || r.cond === 'multiple')).length },
  ms_total: Date.now() - t0,
};
if (MAIN) writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...report, filas: syn }, null, 2));
if (MAIN && real.length) { const pr = path.join(privateDir(), 'reports'); mkdirSync(pr, { recursive: true }); writeFileSync(path.join(pr, 'scanner-bench-real.json'), JSON.stringify(real, null, 2)); }
if (MAIN) console.log(JSON.stringify(report, null, 2));
