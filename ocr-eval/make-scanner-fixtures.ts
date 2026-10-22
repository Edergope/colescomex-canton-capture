// Genera el conjunto de regresión del escáner con verdad de referencia (esquinas exactas, orientación,
// campos esperados). Uso: node --import tsx ocr-eval/make-scanner-fixtures.ts
// - Fotos reales (directorio PRIVADO): original + rotaciones exactas 90/180/270 (esquinas anotadas a mano y rotadas).
// - Escenas sintéticas: tarjetas de ocr-eval/fixtures/*_scan.png proyectadas con homografía conocida sobre fondos.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { homography, applyH, type Quad } from '../src/scanner/homography';
import { rotate90, type RGBAImage, type Pt } from '../src/scanner/imageops';
import { CARDS } from './cards.mjs';
import { privateCases, privateDir, PRIVATE_SKIP_MSG } from '../scripts/private-dir.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..');
const OUT = path.join(dir, 'scanner-fixtures');
mkdirSync(OUT, { recursive: true });

function decode(p: string): RGBAImage {
  const buf = readFileSync(p);
  if (p.endsWith('.png')) { const x = PNG.sync.read(buf); return { width: x.width, height: x.height, data: new Uint8ClampedArray(x.data) }; }
  const j = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 2048 });
  return { width: j.width, height: j.height, data: new Uint8ClampedArray(j.data.buffer) };
}
function saveJpeg(img: RGBAImage, file: string, q = 88, dir = OUT) {
  writeFileSync(path.join(dir, file), jpeg.encode({ width: img.width, height: img.height, data: Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length) }, q).data);
}
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

/** Rotación exacta de esquinas al girar la imagen k cuartos de vuelta horarios. */
function rotPts(q: Pt[], w: number, h: number, k: number): Pt[] {
  return q.map((p) => {
    let { x, y } = p; let W = w, H = h;
    for (let i = 0; i < k; i++) { [x, y] = [H - 1 - y, x]; [W, H] = [H, W]; }
    return { x, y };
  });
}
/** Reordena para que el documento girado conserve la convención TL,TR,BR,BL del contenido (para la orientación). */

type Bg = 'wood' | 'dark' | 'light' | 'gradient';
function background(w: number, h: number, kind: Bg): RGBAImage {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; let r: number, g: number, b: number;
    if (kind === 'wood') { const v = 0.5 + 0.5 * Math.sin(x * 0.02 + Math.sin(y * 0.01) * 3); r = 120 + 50 * v; g = 80 + 35 * v; b = 50 + 20 * v; }
    else if (kind === 'dark') { r = 25 + 10 * Math.sin(y * 0.05); g = 28; b = 35; }
    else if (kind === 'light') { const v = 225 + 8 * Math.sin(x * 0.01 + y * 0.013); r = v; g = v - 2; b = v - 6; }
    else { r = 60 + (150 * x) / w; g = 70 + (120 * y) / h; b = 90; }
    const n = (rnd() - 0.5) * 14;
    d[i] = r + n; d[i + 1] = g + n; d[i + 2] = b + n; d[i + 3] = 255;
  }
  return { width: w, height: h, data: d };
}

/** Pega la tarjeta en el cuadrilátero `q` de la escena (mapeo inverso escena→tarjeta, bilineal) con sombra suave. */
function project(scene: RGBAImage, card: RGBAImage, q: Quad, shadow = true) {
  const H = homography(q, [{ x: 0, y: 0 }, { x: card.width - 1, y: 0 }, { x: card.width - 1, y: card.height - 1 }, { x: 0, y: card.height - 1 }]);
  const xs = q.map((p) => p.x), ys = q.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 30), x1 = Math.min(scene.width - 1, Math.ceil(Math.max(...xs)) + 30);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 30), y1 = Math.min(scene.height - 1, Math.ceil(Math.max(...ys)) + 30);
  const d = scene.data;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = applyH(H, { x, y });
    const i = (y * scene.width + x) * 4;
    if (c.x >= 0 && c.y >= 0 && c.x <= card.width - 1 && c.y <= card.height - 1) {
      const cx = Math.min(card.width - 2, Math.floor(c.x)), cy = Math.min(card.height - 2, Math.floor(c.y)), ax = c.x - cx, ay = c.y - cy;
      const j = (cy * card.width + cx) * 4;
      for (let k = 0; k < 3; k++) {
        const t = card.data[j + k] + (card.data[j + 4 + k] - card.data[j + k]) * ax;
        const b = card.data[j + card.width * 4 + k] + (card.data[j + card.width * 4 + 4 + k] - card.data[j + card.width * 4 + k]) * ax;
        d[i + k] = t + (b - t) * ay;
      }
    } else if (shadow) {
      // sombra proyectada abajo-derecha
      const s = applyH(H, { x: x - 10, y: y - 14 });
      if (s.x >= 0 && s.y >= 0 && s.x <= card.width - 1 && s.y <= card.height - 1) for (let k = 0; k < 3; k++) d[i + k] *= 0.7;
    }
  }
}

function fingers(scene: RGBAImage, centers: { x: number; y: number; rx: number; ry: number; a: number }[]) {
  for (const f of centers) {
    const ca = Math.cos(f.a), sa = Math.sin(f.a);
    for (let y = Math.max(0, f.y - f.ry - f.rx); y < Math.min(scene.height, f.y + f.ry + f.rx); y++)
      for (let x = Math.max(0, f.x - f.ry - f.rx); x < Math.min(scene.width, f.x + f.ry + f.rx); x++) {
        const dx = x - f.x, dy = y - f.y; const u = (dx * ca + dy * sa) / f.rx, v = (-dx * sa + dy * ca) / f.ry;
        if (u * u + v * v <= 1) { const i = (y * scene.width + x) * 4; const sh = 0.85 + 0.15 * (1 - u * u); scene.data[i] = 205 * sh; scene.data[i + 1] = 150 * sh; scene.data[i + 2] = 125 * sh; }
      }
  }
}

function lighting(scene: RGBAImage, ang: number, strength: number) {
  const { width: w, height: h, data } = scene;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const t = ((x / w) * Math.cos(ang) + (y / h) * Math.sin(ang));
    const f = 1 - strength * Math.max(0, Math.min(1, t));
    const i = (y * w + x) * 4; data[i] *= f; data[i + 1] *= f; data[i + 2] *= f;
  }
}

function blur(scene: RGBAImage, r: number) {
  const { width: w, height: h } = scene; const src = scene.data; const tmp = new Float32Array(w * h * 4);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
      let s = 0, n = 0; for (let o = -r; o <= r; o++) { const xx = Math.min(w - 1, Math.max(0, x + o)); s += src[(y * w + xx) * 4 + k]; n++; } tmp[(y * w + x) * 4 + k] = s / n;
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
      let s = 0, n = 0; for (let o = -r; o <= r; o++) { const yy = Math.min(h - 1, Math.max(0, y + o)); s += tmp[(yy * w + x) * 4 + k]; n++; } src[(y * w + x) * 4 + k] = s / n;
    }
  }
}

interface Case {
  name: string; file: string; source: 'real' | 'synthetic'; scenario: string;
  /** true = imagen real en el directorio PRIVADO (scanner-fixtures/ dentro de CX_PRIVATE_DIR) */
  private?: boolean;
  /** esquinas de referencia en la imagen (TL,TR,BR,BL del CONTENIDO derecho) o null si no debe recortarse */
  quad: Pt[] | null;
  /** qué se espera del escáner: recorte fiable, o que lo marque para revisión */
  expect: 'crop' | 'review' | 'crop_or_review';
  /** rotación correctora esperada (cuartos de vuelta horarios) para leer el texto */
  rot: number;
  card?: string; side?: string; fields?: Record<string, string | string[]>;
  /** perfil de documento (por defecto tarjeta comercial) */
  profile?: string;
}
const cases: Case[] = [];

// ── Fotos reales (directorio PRIVADO: nunca en el repositorio) ────────────────────────────────────────────
// Esquinas anotadas a mano a resolución completa, leídas de cases.json privado.
const real = privateCases();
if (!real) console.warn(`⚠ ${PRIVATE_SKIP_MSG}`);
const PRIV_OUT = path.join(privateDir(), 'scanner-fixtures');
if (real) mkdirSync(PRIV_OUT, { recursive: true });
for (const rc of real ?? []) {
  for (const side of ['front', 'back'] as const) {
    const sd = rc.sides[side];
    const img = decode(path.join(privateDir(), sd.file));
    for (let k = 0; k < 4; k++) {
      const name = `real_${rc.id}_${side}_rot${k * 90}`;
      saveJpeg(rotate90(img, k), `${name}.jpg`, 92, PRIV_OUT);
      cases.push({ name, file: `${name}.jpg`, private: true, source: 'real', scenario: k === 0 ? 'foto real sostenida con los dedos' : `foto real girada ${k * 90}°`,
        quad: rotPts(sd.corners, img.width, img.height, k), expect: 'crop', rot: (sd.rot - k + 4) % 4, card: rc.id, side });
    }
  }
}

// ── Escenas sintéticas ──────────────────────────────────────────────────────────────────────────────────
const cardImg = (id: string, side = 'front') => decode(path.join(dir, 'fixtures', `${id}_${side}_scan.png`));
const W = 1800, H = 2400;
type Spec = { name: string; scenario: string; bg: Bg; card: string; side?: string; quad: Pt[]; expect: Case['expect']; rot?: number; post?: (s: RGBAImage) => void; extra?: (s: RGBAImage) => void; noShadow?: boolean };
const persp = (cx: number, cy: number, w: number, h: number, tilt: number, skew: number, ang: number): Pt[] => {
  const pts = [{ x: -w / 2 + skew, y: -h / 2 }, { x: w / 2 - skew, y: -h / 2 + tilt }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 - tilt }];
  const c = Math.cos(ang), s = Math.sin(ang);
  return pts.map((p) => ({ x: cx + p.x * c - p.y * s, y: cy + p.x * s + p.y * c }));
};
const specs: Spec[] = [
  { name: 'syn_table_oblique', scenario: 'tarjeta sobre mesa con perspectiva oblicua', bg: 'wood', card: 'c1', quad: persp(900, 1200, 1500, 860, 70, 120, 0.12), expect: 'crop' },
  { name: 'syn_dark_highcontrast', scenario: 'fondo de alto contraste', bg: 'dark', card: 'c2', quad: persp(900, 1150, 1400, 800, 30, 60, -0.2), expect: 'crop' },
  { name: 'syn_white_on_light', scenario: 'tarjeta blanca sobre fondo claro', bg: 'light', card: 'c6', quad: persp(900, 1200, 1400, 800, 20, 40, 0.05), expect: 'crop_or_review', noShadow: true },
  { name: 'syn_qr_border', scenario: 'código QR junto al borde', bg: 'wood', card: 'c5', quad: persp(900, 1200, 1500, 860, 40, 80, -0.08), expect: 'crop' },
  { name: 'syn_uneven_light', scenario: 'iluminación desigual', bg: 'wood', card: 'c2', quad: persp(900, 1200, 1450, 830, 50, 90, 0.1), expect: 'crop', post: (s) => lighting(s, 0.6, 0.6) },
  { name: 'syn_dark_card', scenario: 'tarjeta oscura (texto claro) sobre fondo de color', bg: 'gradient', card: 'c4', quad: persp(900, 1200, 1450, 830, 50, 90, 0.1), expect: 'crop_or_review' },
  { name: 'syn_blur', scenario: 'imagen ligeramente desenfocada', bg: 'wood', card: 'c3', quad: persp(900, 1200, 1400, 800, 40, 70, -0.15), expect: 'crop', post: (s) => blur(s, 3) },
  { name: 'syn_fingers', scenario: 'tarjeta sostenida con dedos (delante del borde)', bg: 'dark', card: 'c1', quad: persp(900, 1200, 1500, 860, 30, 50, 0.04), expect: 'crop',
    extra: (s) => fingers(s, [{ x: 160, y: 1100, rx: 230, ry: 75, a: 0.1 }, { x: 1680, y: 950, rx: 220, ry: 70, a: -0.2 }, { x: 1690, y: 1350, rx: 230, ry: 72, a: 0.15 }]) },
  { name: 'syn_vertical_card', scenario: 'tarjeta vertical (retrato)', bg: 'wood', card: 'c2', side: 'back', quad: persp(900, 1200, 800, 1400, 30, 40, 0.05), expect: 'crop' },
  { name: 'syn_rotated_45', scenario: 'tarjeta inclinada en diagonal', bg: 'dark', card: 'c4', side: 'back', quad: persp(900, 1200, 1300, 740, 20, 30, 0.6), expect: 'crop' },
];
for (const sp of specs) {
  const scene = background(W, H, sp.bg);
  let card = cardImg(sp.card, sp.side);
  let q = sp.quad as Quad;
  if (sp.name === 'syn_vertical_card') card = rotate90(card, 1); // tarjeta de contenido girado (texto vertical)
  project(scene, card, q, !sp.noShadow);
  sp.extra?.(scene); sp.post?.(scene);
  saveJpeg(scene, `${sp.name}.jpg`);
  const meta = CARDS.find((c: { id: string; side: string }) => c.id === sp.card && c.side === (sp.side ?? 'front'));
  // para la tarjeta vertical, el contenido está girado 90° horario dentro del cuadrilátero → corrección 270°
  cases.push({ name: sp.name, file: `${sp.name}.jpg`, source: 'synthetic', scenario: sp.scenario, quad: q, expect: sp.expect,
    rot: sp.name === 'syn_vertical_card' ? 3 : 0, card: sp.card, side: sp.side ?? 'front', fields: meta?.expect });
}
// varias tarjetas comparables → debe marcarse para revisión (no recortar a ciegas)
{
  const scene = background(W, H, 'wood');
  project(scene, cardImg('c1'), persp(900, 650, 1300, 740, 20, 30, 0.05) as Quad);
  project(scene, cardImg('c2'), persp(900, 1750, 1300, 740, 20, 30, -0.05) as Quad);
  saveJpeg(scene, 'syn_multiple_cards.jpg');
  cases.push({ name: 'syn_multiple_cards', file: 'syn_multiple_cards.jpg', source: 'synthetic', scenario: 'varias tarjetas en la misma foto', quad: null, expect: 'review', rot: 0 });
}
// perímetro no detectable: tarjeta que desborda el encuadre por todos los lados
{
  const scene = background(W, H, 'light');
  project(scene, cardImg('c3'), [{ x: -300, y: -250 }, { x: 2100, y: -200 }, { x: 2150, y: 2650 }, { x: -320, y: 2600 }] as Quad, false);
  saveJpeg(scene, 'syn_undetectable.jpg');
  cases.push({ name: 'syn_undetectable', file: 'syn_undetectable.jpg', source: 'synthetic', scenario: 'perímetro no detectable (tarjeta fuera del encuadre)', quad: null, expect: 'review', rot: 0 });
}
// otro tipo de documento con el MISMO motor: página A4 (ficha técnica) sobre una mesa, perfil a4_document
{
  const pw = 1240, ph = 1754; // A4 a 150 ppp
  const page = new Uint8ClampedArray(pw * ph * 4).fill(255);
  const block = (x0: number, y0: number, w: number, h: number, v: number) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * pw + x) * 4; page[i] = page[i + 1] = page[i + 2] = v; } };
  block(90, 90, 600, 46, 30); // título
  for (let r = 0; r < 34; r++) block(90, 200 + r * 42, 700 + ((r * 97) % 360), 16, 60); // renglones de texto
  block(90, 1660, 1060, 3, 90); // pie
  for (let r = 0; r < 6; r++) for (let c = 0; c < 4; c++) block(860 + c * 70, 220 + r * 60, 60, 40, 200 - c * 20); // tabla
  const sheet = { width: pw, height: ph, data: page };
  const scene = background(W, H, 'wood');
  const q = persp(900, 1200, 1300, 1840, 40, 70, 0.07) as Quad;
  project(scene, sheet, q);
  saveJpeg(scene, 'syn_a4_sheet.jpg');
  cases.push({ name: 'syn_a4_sheet', file: 'syn_a4_sheet.jpg', source: 'synthetic', scenario: 'ficha técnica A4 sobre mesa (perfil a4_document)', quad: q, expect: 'crop', rot: 0, profile: 'a4_document' });
}

// rotaciones 90/180/270 de una escena sintética
{
  const base = decode(path.join(OUT, 'syn_table_oblique.jpg'));
  const q0 = specs[0].quad;
  for (const k of [1, 2, 3]) {
    const name = `syn_table_oblique_rot${k * 90}`;
    saveJpeg(rotate90(base, k), `${name}.jpg`);
    cases.push({ name, file: `${name}.jpg`, source: 'synthetic', scenario: `mesa oblicua girada ${k * 90}°`, quad: rotPts(q0, W, H, k), expect: 'crop', rot: (4 - k) % 4, card: 'c1', side: 'front', fields: CARDS[0].expect });
  }
}
writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(cases, null, 1));
console.log(`✓ ${cases.length} casos en ${OUT}`);
