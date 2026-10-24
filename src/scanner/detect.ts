// Detección del documento (tarjeta) dentro de la fotografía.
// 1) dos generadores de candidatos: máscara de "papel" (claro y poco saturado, separado por bordes)
//    y regiones cerradas por bordes (para fondos claros);
// 2) envolvente convexa → cuadrilátero de área máxima → refinamiento de cada lado por ajuste de recta
//    (recupera esquinas redondeadas o tapadas por dedos);
// 3) puntuación geométrica + soporte de bordes + contraste → confianza.
// Si la confianza no basta, NO se recorta: el llamador conserva la foto original y marca revisión.

import {
  boxBlur, boundaryPoints, components, convexHull, dist, downscale, lumaSat, morph, otsu, percentile, polygonArea,
  simplifyClosed, sobel, type Component, type Pt, type RGBAImage,
} from './imageops';
import { orderQuad, rectifiedSize, type Quad } from './homography';

export type PolMode = 'global' | 'free';
export interface Candidate { quad: Quad; score: number; method: 'paper' | 'edges' | 'background'; parts: Record<string, number>; pol?: PolMode }
export interface DetectResult {
  status: 'ok' | 'low_confidence' | 'not_found';
  /** esquinas en coordenadas de la imagen recibida (TL, TR, BR, BL) */
  quad?: Quad;
  confidence: number;
  method?: Candidate['method'];
  /** hay otro documento de tamaño comparable en la foto */
  multiple: boolean;
  reasons: string[];
  /** soporte de borde de cada lado del cuadrilátero final (fracción del lado con borde visible) */
  sideSupport?: number[];
  candidates: Candidate[];
  workWidth: number; workHeight: number; ms: number;
}

export const DETECT_WORK_SIDE = 720;
export const CONFIDENCE_OK = 0.62;
export const CONFIDENCE_MIN = 0.4;

/** Versiones reducidas ya calculadas (en el navegador las genera el decodificador nativo, más rápido). */
export interface Pyramid { work?: RGBAImage; fine?: RGBAImage }
/** Geometría esperada del documento (perfil). Por defecto: tarjeta comercial. */
export interface DetectOptions { aspectRange?: [number, number]; minAreaFrac?: number }

export function detectDocument(img: RGBAImage, pyr: Pyramid = {}, dopts: DetectOptions = {}): DetectResult {
  const aspectRange = dopts.aspectRange ?? [1.15, 2.4], minAreaFrac = dopts.minAreaFrac ?? 0.04;
  const t0 = now();
  const { img: work, scale } = pyr.work ? { img: pyr.work, scale: pyr.work.width / img.width } : downscale(img, DETECT_WORK_SIDE);
  const w = work.width, h = work.height, N = w * h;
  const { L, S } = lumaSat(work);
  const Lb = boxBlur(L, w, h, 1);
  const { mag, gx, gy } = sobel(Lb, w, h);
  const edgeThr = Math.max(60, percentile(mag, 0.9));
  const edges = new Uint8Array(N);
  for (let i = 0; i < N; i++) edges[i] = mag[i] > edgeThr ? 1 : 0;

  const D = backgroundDistance(work);
  const bgThr = Math.max(28, otsu(D));
  const cands: Candidate[] = [];
  const consider = (bin: Uint8Array, method: Candidate['method']) => {
    const { labels, comps } = components(bin, w, h);
    const big = comps.filter((c) => c.area > N * Math.min(0.04, minAreaFrac)).sort((a, b) => b.area - a.area).slice(0, 6);
    for (const c of big) {
      const q = quadFromComponent(labels, w, h, c);
      if (!q) continue;
      const ctx = { w, h, L: Lb, mag, gx, gy, edgeThr, D, bgThr, rgb: work.data };
      // dos hipótesis de polaridad (tarjeta clara/oscura en conjunto, o por lado): se queda la que mejor encaja
      let bestSc: Candidate | null = null;
      for (const mode of ['global', 'free'] as PolMode[]) {
        const sc = scoreQuad(snapToEdges(q.quad, ctx, 2, mode), c, q.hullArea, ctx, method, aspectRange, minAreaFrac);
        if (sc && (!bestSc || sc.score > bestSc.score)) bestSc = { ...sc, pol: mode };
      }
      if (bestSc) cands.push(bestSc);
    }
  };

  // A) papel: claro y poco saturado. Se prueban varios umbrales (Otsu en dos niveles) y se cortan los
  //    bordes moderados para separar la tarjeta de paredes claras y de los dedos que la sostienen.
  const paper = new Float32Array(N);
  for (let i = 0; i < N; i++) paper[i] = Math.max(0, Math.min(255, Lb[i] * (1 - 1.3 * S[i])));
  const t1 = otsu(paper);
  const upper: number[] = [];
  for (let i = 0; i < N; i += 2) if (paper[i] > t1) upper.push(paper[i]);
  const t2 = upper.length > 100 ? otsu(upper) : t1;
  const cutThr = Math.max(35, percentile(mag, 0.75));
  const cut = new Uint8Array(N);
  for (let i = 0; i < N; i++) cut[i] = mag[i] > cutThr ? 1 : 0;
  for (const t of [...new Set([t1, Math.round((t1 + t2) / 2), t2])]) {
    let maskA: Uint8Array = new Uint8Array(N);
    for (let i = 0; i < N; i++) maskA[i] = paper[i] > t && !cut[i] ? 1 : 0;
    maskA = morph(morph(maskA, w, h, 2, 'erode'), w, h, 2, 'dilate'); // apertura: rompe puentes finos
    consider(maskA, 'paper');
  }

  // B) regiones cerradas por bordes (tarjeta clara sobre fondo claro): interior de los contornos.
  const closed = morph(edges, w, h, 2, 'dilate');
  const inside = new Uint8Array(N);
  for (let i = 0; i < N; i++) inside[i] = closed[i] ? 0 : 1;
  consider(inside, 'edges');

  // C) separación del FONDO (cualquier color de tarjeta: oscura, de color, metalizada; fondo claro u oscuro).
  //    El color del fondo se modela con un plano por canal ajustado a la banda exterior de la foto (tolera
  //    degradados y luz desigual); se excluye la piel (dedos), se cierran los huecos del texto y se rellena el
  //    interior de la tarjeta.
  {
    const thr = bgThr;
    let fg: Uint8Array = new Uint8Array(N);
    for (let i = 0, j = 0; i < N; i++, j += 4) fg[i] = D[i] > thr && !isSkin(work.data[j], work.data[j + 1], work.data[j + 2]) ? 1 : 0;
    fg = morph(morph(fg, w, h, 3, 'dilate'), w, h, 3, 'erode'); // cierre: une letras y bloques de color
    fg = fillHoles(fg, w, h);
    fg = morph(morph(fg, w, h, 3, 'erode'), w, h, 3, 'dilate'); // apertura: separa dedos y objetos tocando la tarjeta
    consider(fg, 'background');
  }

  // Fusionar candidatos casi idénticos (ambos métodos encuentran la misma tarjeta).
  cands.sort((a, b) => b.score - a.score);
  const uniq: Candidate[] = [];
  for (const c of cands) {
    const twin = uniq.find((u) => quadDistance(u.quad, c.quad) < 0.04 * Math.hypot(w, h));
    if (twin) { twin.score = Math.min(1, Math.max(twin.score, c.score) + 0.05); if (twin.method !== c.method) twin.parts.agree = 1; continue; }
    uniq.push(c);
  }
  uniq.sort((a, b) => b.score - a.score);

  // Una tarjeta es el rectángulo MÁS EXTERIOR: si el mejor candidato está contenido en otro mayor con
  // puntuación comparable, se elige el envolvente (los bloques de color, marcos y logotipos son contenido).
  let best = uniq[0];
  for (let guard = 0; best && guard < 4; guard++) {
    const outer = uniq.find((c) => c !== best && c.score >= 0.85 * best!.score && polygonArea(c.quad) > 1.25 * polygonArea(best!.quad) && containment(best!.quad, c.quad) > 0.9);
    if (!outer) break;
    best = outer;
  }
  const reasons: string[] = [];
  let multiple = false;
  if (best) {
    // otro documento comparable y SEPARADO (no uno dentro de otro)
    multiple = uniq.some((c) => c !== best && c.score > 0.6 * best!.score && c.parts.aspect > 0.8 && containment(c.quad, best!.quad) < 0.2 && containment(best!.quad, c.quad) < 0.2
      && polygonArea(c.quad) > 0.4 * polygonArea(best!.quad) && inkDensity(mag, w, h, c.quad, edgeThr) >= 0.012);
    if (multiple) reasons.push('Hay más de un documento comparable en la foto');
  } else reasons.push('No se encontró ningún contorno de documento');

  let confidence = best ? Math.max(0, best.score - (multiple ? 0.25 : 0)) : 0;
  if (best && best !== uniq[0]) reasons.push('Se eligió el contorno exterior (había un bloque interior con más puntuación)');
  const inv = 1 / scale;
  let finalQuad = best ? (best.quad.map((p) => ({ x: p.x * inv, y: p.y * inv })) as Quad) : undefined;
  let sideSupport: number[] = [];
  if (finalQuad && confidence >= CONFIDENCE_MIN) {
    const fine = refineFine(img, finalQuad, pyr.fine, best.pol ?? 'global');
    finalQuad = fine.quad; sideSupport = fine.sideSupport;
  }
  // Compuertas sobre el cuadrilátero FINAL: situaciones en las que un recorte automático sería inseguro
  // aunque la puntuación global sea alta (se conserva la foto y se pide revisión).

  if (best && finalQuad) {
    const m = 0.004 * Math.hypot(img.width, img.height);
    if (finalQuad.some((p) => p.x < m || p.y < m || p.x > img.width - 1 - m || p.y > img.height - 1 - m)) {
      confidence = Math.min(confidence, 0.5); reasons.push('La tarjeta toca el borde de la foto (podría estar cortada)');
    }
    // Evidencia por lado = borde visible o separación de color del fondo. Un lado puede estar tapado en parte
    // por los dedos; dos lados débiles = recorte dudoso.
    const v = validateQuad(work, finalQuad.map((p) => ({ x: p.x * scale, y: p.y * scale })) as Quad, D, bgThr);
    const ev = [0, 1, 2, 3].map((k) => Math.max(sideSupport[k] ?? 0, Math.min(1, v.perSide[k].contrast / 40))).sort((a, b) => a - b);
    if (ev[0] < 0.2 || ev[1] < 0.45) { confidence = Math.min(confidence, 0.55); reasons.push('Un lado del documento no tiene borde visible'); }
    // la tarjeta «continúa» por un lado: fuera no hay fondo, no hay borde visible y el color apenas cambia
    // (con el generador de FONDO el modelo de fondo es su propia premisa: basta con que fuera no haya fondo)
    const continues = [0, 1, 2, 3].some((k) => v.perSide[k].foreignOutside > 0.5 && (best.method === 'background' || ((sideSupport[k] ?? 0) < 0.5 && v.perSide[k].contrast < 25)));
    if (continues) { confidence = Math.min(confidence, 0.45); reasons.push('Hay contenido de la tarjeta fuera del recorte (podría cortar texto)'); }
    // el recorte incluye fondo: la banda interior de algún lado parece fondo
    if (v.perSide.some((p, k) => p.insideBackground > 0.5 && (sideSupport[k] ?? 0) < 0.5)) { confidence = Math.min(confidence, 0.5); reasons.push('El recorte incluye parte del fondo'); }
    // una tarjeta comercial tiene texto: un rectángulo liso (hoja, folleto, pared) no es la tarjeta
    const ink = inkDensity(mag, w, h, finalQuad.map((p) => ({ x: p.x * scale, y: p.y * scale })) as Quad, edgeThr);
    if (ink < 0.012) { confidence = Math.min(confidence, 0.5); reasons.push('No se ve texto dentro del recorte'); }
    const r = rectifiedSize(finalQuad); const asp = Math.max(r.width, r.height) / Math.max(1, Math.min(r.width, r.height));
    if (asp < (dopts.aspectRange?.[0] ?? 1.15) || asp > (dopts.aspectRange?.[1] ?? 2.4)) { confidence = Math.min(confidence, 0.5); reasons.push('La proporción del recorte no corresponde al documento'); }
  }
  // recorte automático solo si dos generadores independientes coinciden en la misma tarjeta; si no, es una SUGERENCIA
  // (excepción: tarjeta en primer plano, >35 % de la foto, con borde de papel o contorno cerrado: no hay otro objeto que confundir)
  const closeUp = !!best && polygonArea(best.quad) / (w * h) > 0.35 && best.method !== 'background';
  if (best && !best.parts.agree && !closeUp && confidence >= CONFIDENCE_OK) { confidence = Math.min(confidence, CONFIDENCE_OK - 0.01); reasons.push('Solo un método detectó este contorno'); }
  const status = !best || confidence < CONFIDENCE_MIN ? 'not_found' : confidence < CONFIDENCE_OK ? 'low_confidence' : 'ok';
  if (best && status !== 'ok') reasons.push(`Confianza de bordes insuficiente (${confidence.toFixed(2)})`);
  return {
    status, confidence: +confidence.toFixed(3), method: best?.method, multiple, reasons,
    quad: finalQuad, sideSupport: sideSupport.map((v) => +v.toFixed(3)),
    candidates: uniq.slice(0, 4).map((c) => ({ ...c, quad: c.quad.map((p) => ({ x: p.x * inv, y: p.y * inv })) as Quad })),
    workWidth: w, workHeight: h, ms: Math.round(now() - t0),
  };
}

function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

/** Componente → envolvente → cuadrilátero inscrito de área máxima → lados refinados. */
function quadFromComponent(labels: Int32Array, w: number, h: number, c: Component): { quad: Quad; hullArea: number } | null {
  const bpts = boundaryPoints(labels, w, h, c);
  if (bpts.length < 20) return null;
  const hull = convexHull(bpts);
  if (hull.length < 4) return null;
  const hullArea = polygonArea(hull);
  const simp = simplifyClosed(hull, 1.5);
  const base = maxAreaQuad(simp.length >= 4 ? simp : hull);
  if (!base) return null;
  const refined = refineSides(base, hull, bpts, Math.hypot(w, h)) ?? base;
  return { quad: orderQuad(refined), hullArea };
}

/** Cuadrilátero de área máxima con vértices en el polígono convexo (O(n³) con n pequeño). */
function maxAreaQuad(poly: Pt[]): Pt[] | null {
  let P = poly;
  if (P.length > 60) { const step = P.length / 60; P = Array.from({ length: 60 }, (_, i) => poly[Math.floor(i * step)]); }
  const n = P.length; if (n < 4) return null;
  const tri = (a: Pt, b: Pt, c: Pt) => Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  let best = -1, res: Pt[] | null = null;
  for (let i = 0; i < n; i++) {
    for (let k = i + 2; k < n; k++) {
      // mejor j en (i,k) y mejor l en (k, i+n): el área del triángulo es unimodal en un polígono convexo
      let bj = 0, bjA = -1, bl = 0, blA = -1;
      for (let j = i + 1; j < k; j++) { const a = tri(P[i], P[j], P[k]); if (a > bjA) { bjA = a; bj = j; } }
      for (let l = k + 1; l < i + n; l++) { const a = tri(P[i], P[k], P[l % n]); if (a > blA) { blA = a; bl = l % n; } }
      if (bjA + blA > best) { best = bjA + blA; res = [P[i], P[bj], P[k], P[bl]]; }
    }
  }
  return res;
}

/** Ajusta una recta a los puntos de borde cercanos a cada lado e intersecta lados consecutivos. */
function refineSides(q: Pt[], hull: Pt[], bpts: Pt[], diag: number): Pt[] | null {
  const ordered = orderQuad(q);
  const tol = 0.02 * diag;
  const lines: { p: Pt; d: Pt }[] = [];
  const pool = bpts.length > 4000 ? bpts.filter((_, i) => i % Math.ceil(bpts.length / 4000) === 0) : bpts;
  for (let s = 0; s < 4; s++) {
    const a = ordered[s], b = ordered[(s + 1) % 4];
    const len = dist(a, b); if (len < 1) return null;
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    // puntos de la envolvente (lado exterior del objeto) cercanos al segmento, lejos de las esquinas
    let pts = pool.concat(hull).filter((p) => {
      const t = ((p.x - a.x) * ux + (p.y - a.y) * uy) / len;
      const dperp = Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux);
      return t > 0.08 && t < 0.92 && dperp < tol;
    });
    if (pts.length < 8) { lines.push({ p: a, d: { x: ux, y: uy } }); continue; }
    let fit = fitLine(pts);
    for (let it = 0; it < 2; it++) {
      const res = pts.map((p) => Math.abs((p.x - fit.p.x) * fit.d.y - (p.y - fit.p.y) * fit.d.x));
      const med = [...res].sort((x, y) => x - y)[Math.floor(res.length / 2)] || 0.5;
      const keep = pts.filter((_, i) => res[i] <= Math.max(1, 2.5 * med));
      if (keep.length < 8) break;
      pts = keep; fit = fitLine(pts);
    }
    lines.push(fit);
  }
  const out: Pt[] = [];
  for (let s = 0; s < 4; s++) {
    const p = intersect(lines[(s + 3) % 4], lines[s]);
    if (!p || dist(p, ordered[s]) > 0.08 * diag) return null;
    out.push(p);
  }
  return out;
}

function fitLine(pts: Pt[]): { p: Pt; d: Pt } {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n, my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { p: { x: mx, y: my }, d: { x: Math.cos(ang), y: Math.sin(ang) } };
}

function intersect(l1: { p: Pt; d: Pt }, l2: { p: Pt; d: Pt }): Pt | null {
  const den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
  if (Math.abs(den) < 1e-6) return null;
  const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / den;
  return { x: l1.p.x + t * l1.d.x, y: l1.p.y + t * l1.d.y };
}

interface Ctx { w: number; h: number; L: Float32Array; mag: Float32Array; gx: Float32Array; gy: Float32Array; edgeThr: number; D?: Float32Array; bgThr?: number; rgb?: RGBAImage['data'] }

function scoreQuad(q: Quad, c: Component, hullArea: number, ctx: Ctx, method: Candidate['method'], aspectRange: [number, number], minAreaFrac: number): Candidate | null {
  const { w, h } = ctx;
  const area = polygonArea(q);
  const areaFrac = area / (w * h);
  if (areaFrac < minAreaFrac || areaFrac > 0.985) return null;
  // convexidad y ángulos internos
  let minAng = 180, maxAng = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4], b = q[i], cc = q[(i + 1) % 4];
    const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: cc.x - b.x, y: cc.y - b.y };
    const ang = (Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y))))) * 180) / Math.PI;
    minAng = Math.min(minAng, ang); maxAng = Math.max(maxAng, ang);
  }
  if (minAng < 45 || maxAng > 135) return null;
  const sides = [0, 1, 2, 3].map((i) => dist(q[i], q[(i + 1) % 4]));
  const oppRatio = Math.min(sides[0] / sides[2], sides[2] / sides[0], sides[1] / sides[3], sides[3] / sides[1]);
  const aspect = Math.max(sides[0] + sides[2], sides[1] + sides[3]) / Math.min(sides[0] + sides[2], sides[1] + sides[3]);

  // soporte de bordes: fracción del perímetro con gradiente fuerte perpendicular al lado
  const perSide: number[] = [];
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    const len = dist(a, b), nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    let hit = 0, tot = 0;
    for (let k = 1; k < 40; k++) {
      const t = k / 40; const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      tot++;
      for (let o = -3; o <= 3; o++) {
        const x = Math.round(px + nx * o), y = Math.round(py + ny * o);
        if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
        const i = y * w + x;
        const along = Math.abs(ctx.gx[i] * nx + ctx.gy[i] * ny) / (ctx.mag[i] || 1);
        if (ctx.mag[i] > ctx.edgeThr * 0.6 && along > 0.7) { hit++; break; }
      }
    }
    perSide.push(hit / tot);
  }
  const edgeSupport = perSide.reduce((s, v) => s + v, 0) / 4;
  const minSide = Math.min(...perSide);
  // un lado pegado al borde de la imagen indica que la tarjeta podría estar cortada por el encuadre
  const margin = 2;
  const atBorder = q.filter((p) => p.x < margin || p.y < margin || p.x > w - 1 - margin || p.y > h - 1 - margin).length;

  // contraste interior/exterior en una banda junto a los lados
  let inSum = 0, outSum = 0, nIn = 0, nOut = 0;
  const cx = q.reduce((s, p) => s + p.x, 0) / 4, cy = q.reduce((s, p) => s + p.y, 0) / 4;
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4];
    for (let k = 1; k < 20; k++) {
      const t = k / 20; const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      const vx = cx - px, vy = cy - py, vl = Math.hypot(vx, vy) || 1;
      const ix = Math.round(px + (vx / vl) * 6), iy = Math.round(py + (vy / vl) * 6);
      const ox = Math.round(px - (vx / vl) * 6), oy = Math.round(py - (vy / vl) * 6);
      if (ix >= 0 && iy >= 0 && ix < w && iy < h) { inSum += ctx.L[iy * w + ix]; nIn++; }
      if (ox >= 0 && oy >= 0 && ox < w && oy < h) { outSum += ctx.L[oy * w + ox]; nOut++; }
    }
  }
  const contrast = nIn && nOut ? Math.min(1, Math.abs(inSum / nIn - outSum / nOut) / 60) : 0.3;
  const fill = Math.min(1, c.area / area);
  const solidity = Math.min(1, area / Math.max(1, hullArea));

  const parts = {
    area: Math.min(1, areaFrac / 0.12),
    shape: Math.max(0, 1 - (90 - Math.min(minAng, 180 - maxAng)) / 45) * 0.5 + Math.max(0, (oppRatio - 0.6) / 0.4) * 0.5,
    aspect: aspect >= aspectRange[0] && aspect <= aspectRange[1] ? 1 : aspect < aspectRange[0] ? Math.max(0, (aspect - (aspectRange[0] - 0.25)) / 0.25) : Math.max(0, 1 - (aspect - aspectRange[1])),
    edges: edgeSupport, minEdge: minSide, contrast, fill: method === 'edges' ? 1 : fill, solidity,
    border: atBorder >= 2 ? 0 : atBorder === 1 ? 0.6 : 1,
  };
  const score = 0.08 * parts.area + 0.14 * parts.shape + 0.1 * parts.aspect + 0.26 * parts.edges + 0.12 * parts.minEdge
    + 0.12 * parts.contrast + 0.08 * parts.fill + 0.04 * parts.solidity + 0.06 * parts.border;
  return { quad: q, score: +score.toFixed(3), method, parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, +v.toFixed(3)])) };
}

/**
 * Ajuste de cada lado al borde real: se exploran rectas cercanas (±15°, ±10 % de la diagonal) y se elige
 * la de mayor soporte de gradiente con polaridad "claro dentro / oscuro fuera", repartido a lo largo del lado.
 */
export function snapToEdges(q0: Quad, ctx: Ctx, iterations = 2, mode: PolMode = 'global'): Quad {
  let q = q0;
  const diag = Math.hypot(ctx.w, ctx.h);
  for (let it = 0; it < iterations; it++) {
    const cx = q.reduce((s, p) => s + p.x, 0) / 4, cy = q.reduce((s, p) => s + p.y, 0) / 4;
    // UNA polaridad para toda la tarjeta: oscura sobre fondo claro (−1) solo con evidencia clara en conjunto;
    // si no, «claro dentro» (+1), el comportamiento probado con tarjetas claras
    const cardPol = mode === 'global' ? quadPolarity(ctx.L, ctx.w, ctx.h, q) : 0;
    const lines: { p: Pt; d: Pt }[] = [];
    for (let s = 0; s < 4; s++) {
      const a = q[s], b = q[(s + 1) % 4];
      const len = dist(a, b);
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // normal hacia fuera (lejos del centro)
      let nx = -uy, ny = ux;
      if ((mid.x - cx) * nx + (mid.y - cy) * ny < 0) { nx = -nx; ny = -ny; }
      const base = Math.atan2(uy, ux);
      const range = Math.round(0.1 * diag);
      const pol = mode === 'global' ? cardPol : sidePol(ctx.L, ctx.w, ctx.h, a, b, { x: cx, y: cy });
      const results: { off: number; ang: number; sup: number }[] = [];
      for (let da = -15; da <= 15; da += 1.5) {
        const ang = base + (da * Math.PI) / 180;
        const dx = Math.cos(ang), dy = Math.sin(ang);
        let lnx = -dy, lny = dx;
        if (lnx * nx + lny * ny < 0) { lnx = -lnx; lny = -lny; }
        for (let off = -range; off <= range; off += 1) {
          const ox = mid.x + nx * off, oy = mid.y + ny * off;
          // soporte por cuartos del lado: se ignora el mejor cuarto para exigir continuidad
          // dos polaridades: tarjeta clara sobre fondo oscuro (gradiente hacia dentro) u oscura sobre fondo claro
          const qp = [0, 0, 0, 0], qn = [0, 0, 0, 0], qt = [0, 0, 0, 0];
          for (let k = -24; k <= 24; k++) {
            const t = (k / 24) * len * 0.5 * 1.05;
            const x = Math.round(ox + dx * t), y = Math.round(oy + dy * t);
            const qi = Math.min(3, Math.floor(((k + 24) / 49) * 4));
            qt[qi]++;
            if (x < 1 || y < 1 || x >= ctx.w - 1 || y >= ctx.h - 1) continue;
            const i = y * ctx.w + x;
            const m = ctx.mag[i];
            if (m < 12) continue; // bordes de bajo contraste (tarjeta blanca contra pared gris)
            const inward = -(ctx.gx[i] * lnx + ctx.gy[i] * lny) / m; // perpendicular a la recta
            if (inward > 0.75) qp[qi]++; else if (inward < -0.75) qn[qi]++;
          }
          const supOf = (qh: number[]) => { const qs = qh.map((v, i) => v / Math.max(1, qt[i])).sort((x, y) => x - y); return (qs[0] + qs[1] + qs[2]) / 3; };
          results.push({ off, ang, sup: pol > 0 ? supOf(qp) : pol < 0 ? supOf(qn) : Math.max(supOf(qp), supOf(qn)) });
        }
      }
      const maxSup = Math.max(...results.map((r) => r.sup));
      if (typeof process !== 'undefined' && process.env?.SCAN_DEBUG === String(s)) {
        const top = [...results].sort((x, y) => y.sup - x.sup).slice(0, 12);
        console.error('side', s, 'it', it, 'mid', mid, 'n', nx.toFixed(2), ny.toFixed(2), top.map((r) => `${r.off}@${(((r.ang - base) * 180) / Math.PI).toFixed(1)}=${r.sup.toFixed(2)}`).join(' '));
      }
      let chosen: { off: number; ang: number; sup: number } | undefined;
      if (maxSup >= 0.3) {
        // máximo soporte; empates (≥ 95 %) → centroide. Un borde desenfocado da una banda de rectas casi
        // equivalentes: el centroide sitúa el lado en el centro del borde, no en un extremo.
        const strong = results.filter((r) => r.sup >= 0.95 * maxSup);
        let best = strong.reduce((m, r) => (r.sup > m.sup ? r : m), strong[0]);
        // La tarjeta es lo más EXTERIOR: si hay una recta paralela más afuera con soporte fuerte y la franja
        // entre ambas no es fondo (marco impreso, franja de color), el borde real es el exterior.
        if (ctx.D && ctx.bgThr !== undefined) {
          // marcos y filetes impresos son finos: la franja nunca supera el 4,5 % del lado corto de la tarjeta
          const shortSide = Math.min(...[0, 1, 2, 3].map((k) => dist(q[k], q[(k + 1) % 4])));
          const maxStrip = Math.max(4, 0.045 * shortSide);
          const outer = results.filter((r) => r.off > best.off + 3 && r.off - best.off <= maxStrip && r.sup >= 0.8 * maxSup && Math.abs(r.ang - best.ang) < 0.05).sort((x, y) => y.off - x.off);
          for (const o of outer) { if (stripIsCard(ctx, mid, nx, ny, best, o, len)) { best = o; break; } }
        }
        const pool = best.sup >= 0.95 * maxSup ? strong : results.filter((r) => r.sup >= 0.95 * best.sup);
        const near = pool.filter((r) => Math.abs(r.off - best.off) <= 6 && Math.abs(r.ang - best.ang) < 0.06);
        chosen = { off: near.reduce((a, r) => a + r.off, 0) / near.length, ang: near.reduce((a, r) => a + r.ang, 0) / near.length, sup: best.sup };
      }
      if (!chosen) { lines.push({ p: a, d: { x: ux, y: uy } }); continue; }
      lines.push({ p: { x: mid.x + nx * chosen.off, y: mid.y + ny * chosen.off }, d: { x: Math.cos(chosen.ang), y: Math.sin(chosen.ang) } });
    }
    const next: Pt[] = [];
    for (let s = 0; s < 4; s++) {
      const p = intersect(lines[(s + 3) % 4], lines[s]);
      if (!p || dist(p, q[s]) > 0.2 * diag) return q;
      next.push(p);
    }
    q = orderQuad(next);
  }
  return q;
}

export const FINE_SIDE = 1600;

/**
 * Refinamiento fino a mayor resolución: cada lado se reajusta en una banda estrecha (±2 % de la diagonal,
 * ±5°) maximizando la suma de gradiente con polaridad correcta. Corrige el error de la escala de trabajo.
 */
export function refineFine(img: RGBAImage, q: Quad, pre?: RGBAImage, mode: PolMode = 'global'): { quad: Quad; sideSupport: number[] } {
  const { img: fine, scale } = pre ? { img: pre, scale: pre.width / img.width } : downscale(img, FINE_SIDE);
  const w = fine.width, h = fine.height;
  const { L } = lumaSat(fine);
  const Lb = boxBlur(L, w, h, 1);
  const g = { w, h, ...sobel(Lb, w, h) };
  const qs = q.map((p) => ({ x: p.x * scale, y: p.y * scale })) as Quad;
  const diag = Math.hypot(w, h);
  const center = { x: qs.reduce((a, p) => a + p.x, 0) / 4, y: qs.reduce((a, p) => a + p.y, 0) / 4 };
  // polaridad de cada lado (tarjeta más clara u oscura que su entorno), igual que en el ajuste a escala de trabajo
  const gp = quadPolarity(Lb, w, h, qs);
  const pols = mode === 'global' ? [gp, gp, gp, gp] : [0, 1, 2, 3].map((k) => sidePol(Lb, w, h, qs[k], qs[(k + 1) % 4], center));
  // 1) rectas globales por lado
  const lines = [0, 1, 2, 3].map((s) => fitSideFine(g, qs[s], qs[(s + 1) % 4], center, 0, 1, 5, 0.02 * diag, pols[s]));
  const global: Pt[] = [];
  for (let s = 0; s < 4; s++) {
    const p = intersect(lines[(s + 3) % 4], lines[s]);
    if (!p || dist(p, qs[s]) > 0.04 * diag) return { quad: q, sideSupport: [0, 0, 0, 0] };
    global.push(p);
  }
  // 2) esquinas locales: rectas ajustadas solo al 30 % de cada lado más cercano a la esquina
  //    (tarjetas curvadas: la esquina real no está en la recta global)
  const out: Pt[] = [];
  for (let s = 0; s < 4; s++) {
    const prev = global[(s + 3) % 4], cur = global[s], next = global[(s + 1) % 4];
    const lPrev = fitSideFine(g, prev, cur, center, 0.7, 1, 3, 0.008 * diag, pols[(s + 3) % 4]);
    const lNext = fitSideFine(g, cur, next, center, 0, 0.3, 3, 0.008 * diag, pols[s]);
    const p = intersect(lPrev, lNext);
    out.push(p && dist(p, cur) < 0.012 * diag ? p : cur);
  }
  const fq = orderQuad(out);
  return { quad: orderQuad(out.map((p) => ({ x: p.x / scale, y: p.y / scale }))), sideSupport: [0, 1, 2, 3].map((k) => sideSupportAt(g, fq[k], fq[(k + 1) % 4], center)) };
}

/** Fracción del lado (entre esquinas) con borde visible: gradiente perpendicular, polaridad "claro dentro". */
function sideSupportAt(g: Grad, a: Pt, b: Pt, center: Pt): number {
  const len = dist(a, b); if (len < 2) return 0;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  let nx = -uy, ny = ux;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if ((mid.x - center.x) * nx + (mid.y - center.y) * ny < 0) { nx = -nx; ny = -ny; }
  let hp = 0, hn = 0, tot = 0;
  for (let k = 2; k < 98; k++) {
    const px = a.x + (b.x - a.x) * (k / 100), py = a.y + (b.y - a.y) * (k / 100);
    tot++;
    let fp = false, fn = false;
    for (let o = -3; o <= 3; o++) {
      const x = Math.round(px + nx * o), y = Math.round(py + ny * o);
      if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) continue;
      const i = y * g.w + x, m = g.mag[i];
      if (m < 12) continue;
      const inward = -(g.gx[i] * nx + g.gy[i] * ny);
      if (inward > 0.75 * m) fp = true; else if (inward < -0.75 * m) fn = true;
    }
    if (fp) hp++; if (fn) hn++;
  }
  return Math.max(hp, hn) / tot;
}

type Grad = { w: number; h: number; mag: Float32Array; gx: Float32Array; gy: Float32Array };

/** Recta que mejor explica el borde entre a y b (tramo [t0,t1]) con polaridad "claro hacia el centro". */
function fitSideFine(g: Grad, a: Pt, b: Pt, center: Pt, t0: number, t1: number, maxDeg: number, range: number, pol = 0): { p: Pt; d: Pt } {
  const len = dist(a, b);
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  const tm = (t0 + t1) / 2, half = ((t1 - t0) * len) / 2;
  const mid = { x: a.x + (b.x - a.x) * tm, y: a.y + (b.y - a.y) * tm };
  let nx = -uy, ny = ux;
  if ((mid.x - center.x) * nx + (mid.y - center.y) * ny < 0) { nx = -nx; ny = -ny; }
  const base = Math.atan2(uy, ux);
  const local = t1 - t0 < 1;
  let bestV = -1, bestOff = 0, bestAng = base;
  for (let da = -maxDeg; da <= maxDeg; da += 0.25) {
    const ang = base + (da * Math.PI) / 180;
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let lnx = -dy, lny = dx;
    if (lnx * nx + lny * ny < 0) { lnx = -lnx; lny = -lny; }
    for (let off = -range; off <= range; off += 0.5) {
      const ox = mid.x + nx * off, oy = mid.y + ny * off;
      const qp = [0, 0, 0, 0], qn = [0, 0, 0, 0];
      for (let k = -40; k <= 40; k++) {
        const t = (k / 40) * half * (local ? 0.95 : 0.9);
        const x = Math.round(ox + dx * t), y = Math.round(oy + dy * t);
        if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) continue;
        const i = y * g.w + x;
        const inward = -(g.gx[i] * lnx + g.gy[i] * lny);
        const qi = Math.min(3, Math.floor(((k + 40) / 81) * 4));
        if (inward > 0.7 * g.mag[i]) qp[qi] += Math.min(inward, 400);
        else if (-inward > 0.7 * g.mag[i]) qn[qi] -= Math.max(inward, -400);
      }
      // global: se descarta el mejor cuarto (continuidad); local: tramo corto, suma completa. Una sola polaridad por recta.
      const val = (qv: number[]) => { if (local) return qv[0] + qv[1] + qv[2] + qv[3]; const q = [...qv].sort((x, y) => x - y); return q[0] + q[1] + q[2]; };
      const v = pol > 0 ? val(qp) : pol < 0 ? val(qn) : Math.max(val(qp), val(qn));
      if (v > bestV) { bestV = v; bestOff = off; bestAng = ang; }
    }
  }
  return { p: { x: mid.x + nx * bestOff, y: mid.y + ny * bestOff }, d: { x: Math.cos(bestAng), y: Math.sin(bestAng) } };
}

function quadDistance(a: Quad, b: Quad): number { return Math.max(...a.map((p, i) => dist(p, b[i]))); }

/** Solapamiento aproximado (IoU) por muestreo en rejilla. */
export function overlap(a: Quad, b: Quad): number {
  const xs = [...a, ...b].map((p) => p.x), ys = [...a, ...b].map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let inter = 0, uni = 0;
  for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) {
    const p = { x: x0 + ((x1 - x0) * (i + 0.5)) / 40, y: y0 + ((y1 - y0) * (j + 0.5)) / 40 };
    const ia = inQuad(a, p), ib = inQuad(b, p);
    if (ia && ib) inter++; if (ia || ib) uni++;
  }
  return uni ? inter / uni : 0;
}

export function inQuad(q: Pt[], p: Pt): boolean {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    const cr = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cr !== 0) { if (sign === 0) sign = Math.sign(cr); else if (Math.sign(cr) !== sign) return false; }
  }
  return true;
}

/** Distancia de color de cada píxel al modelo de fondo (plano por canal ajustado de forma robusta al borde). */
export function backgroundDistance(img: RGBAImage): Float32Array {
  const { width: w, height: h, data } = img;
  const band = Math.max(2, Math.round(0.04 * Math.min(w, h)));
  const X: number[] = [], Y: number[] = [], C: number[][] = [[], [], []];
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
    if (x >= band && y >= band && x < w - band && y < h - band) continue;
    const i = (y * w + x) * 4;
    if (isSkin(data[i], data[i + 1], data[i + 2])) continue; // la mano que sostiene la tarjeta no es fondo
    X.push(x / w); Y.push(y / h); C[0].push(data[i]); C[1].push(data[i + 1]); C[2].push(data[i + 2]);
  }
  if (X.length < 50) return new Float32Array(w * h).fill(255); // sin fondo visible: este generador no aporta
  const models = C.map((c) => robustPlane(X, Y, c));
  const D = new Float32Array(w * h);
  for (let y = 0, p = 0; y < h; y++) for (let x = 0; x < w; x++, p++) {
    const i = p * 4; let s = 0;
    for (let k = 0; k < 3; k++) { const m = models[k]; const e = data[i + k] - (m[0] + m[1] * (x / w) + m[2] * (y / h)); s += e * e; }
    D[p] = Math.sqrt(s);
  }
  return D;
}

/** Plano z = a + b·x + c·y por mínimos cuadrados con dos pasadas de recorte de residuos (objetos en el borde). */
function robustPlane(X: number[], Y: number[], Z: number[]): number[] {
  let idx = X.map((_, i) => i), m = [0, 0, 0];
  for (let it = 0; it < 3; it++) {
    let s1 = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, sz = 0, sxz = 0, syz = 0;
    for (const i of idx) { const x = X[i], y = Y[i], z = Z[i]; s1++; sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; sz += z; sxz += x * z; syz += y * z; }
    const A = [[s1, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]], B = [sz, sxz, syz];
    m = solve3(A, B) ?? [sz / Math.max(1, s1), 0, 0];
    const res = idx.map((i) => Math.abs(Z[i] - (m[0] + m[1] * X[i] + m[2] * Y[i])));
    const med = [...res].sort((a, b) => a - b)[Math.floor(res.length / 2)] || 1;
    const keep = idx.filter((_, k) => res[k] <= Math.max(6, 2.5 * med));
    if (keep.length < 0.3 * X.length) break;
    idx = keep;
  }
  return m;
}
function solve3(A: number[][], B: number[]): number[] | null {
  const det = (M: number[][]) => M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const d = det(A); if (Math.abs(d) < 1e-9) return null;
  return [0, 1, 2].map((c) => det(A.map((row, r) => row.map((v, k) => (k === c ? B[r] : v)))) / d);
}

/** Piel (regla RGB clásica): los dedos que sostienen la tarjeta no deben formar parte del documento. */
function isSkin(r: number, g: number, b: number): boolean {
  return r > 95 && g > 40 && b > 20 && r > g && r > b && r - Math.min(g, b) > 15 && Math.abs(r - g) > 15 && r - b > 40 && g > b;
}

/** Rellena los huecos (zonas a 0 no conectadas con el borde de la imagen). */
function fillHoles(bin: Uint8Array, w: number, h: number): Uint8Array {
  const inv = new Uint8Array(w * h); for (let i = 0; i < inv.length; i++) inv[i] = bin[i] ? 0 : 1;
  const { labels, comps } = components(inv, w, h);
  const holes = new Set(comps.filter((c) => !c.touchesBorder).map((c) => c.label));
  const out = bin.slice(); for (let i = 0; i < out.length; i++) if (labels[i] && holes.has(labels[i])) out[i] = 1;
  return out;
}

/**
 * Validación del recorte final (escala de trabajo), con el modelo de fondo:
 *  - contraste de COLOR por lado entre una banda interior y otra exterior (cualquier polaridad);
 *  - contenido fuera del recorte: una banda exterior algo alejada (más allá de la sombra) debe parecer FONDO.
 *    Si en algún lado es mayoritariamente «no fondo» (y no es piel), el recorte probablemente se quedó con un
 *    bloque interior, un logotipo o una parte de la tarjeta: se cortaría texto.
 */
export function validateQuad(img: RGBAImage, q: Quad, D: Float32Array, thr: number): { perSide: { contrast: number; foreignOutside: number; insideBackground: number }[] } {
  const { width: w, height: h, data } = img;
  const cx = q.reduce((s, p) => s + p.x, 0) / 4, cy = q.reduce((s, p) => s + p.y, 0) / 4;
  const shortSide = Math.min(dist(q[0], q[1]), dist(q[1], q[2]), dist(q[2], q[3]), dist(q[3], q[0]));
  const near0 = Math.max(2, 0.02 * shortSide), near1 = Math.max(4, 0.06 * shortSide);
  const far0 = Math.max(6, 0.08 * shortSide), far1 = Math.max(10, 0.16 * shortSide);
  const perSide = [0, 1, 2, 3].map((s) => {
    const a = q[s], b = q[(s + 1) % 4];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const len = dist(a, b); let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    if ((mid.x - cx) * nx + (mid.y - cy) * ny < 0) { nx = -nx; ny = -ny; } // normal hacia fuera
    const sIn = [0, 0, 0], sOut = [0, 0, 0]; let nIn = 0, nOut = 0, foreign = 0, nFar = 0, inBg = 0;
    for (let k = 1; k < 30; k++) {
      const t = 0.12 + 0.76 * (k / 30); const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      for (let j = 0; j <= 4; j++) {
        const o = near0 + ((near1 - near0) * j) / 4;
        for (const sign of [-1, 1]) {
          const x = Math.round(px + nx * o * sign), y = Math.round(py + ny * o * sign);
          if (x < 0 || y < 0 || x >= w || y >= h) continue;
          const i = (y * w + x) * 4;
          if (sign < 0) { for (let c = 0; c < 3; c++) sIn[c] += data[i + c]; nIn++; if (D[y * w + x] <= thr * 0.6) inBg++; } else { for (let c = 0; c < 3; c++) sOut[c] += data[i + c]; nOut++; }
        }
        const of = far0 + ((far1 - far0) * j) / 4;
        const x = Math.round(px + nx * of), y = Math.round(py + ny * of);
        if (x < 0 || y < 0 || x >= w || y >= h) continue; // fuera de la foto: se trata aparte (tarjeta en el borde)
        const i = (y * w + x) * 4; nFar++;
        if (D[y * w + x] > thr && !isSkin(data[i], data[i + 1], data[i + 2])) foreign++;
      }
    }
    const contrast = nIn && nOut ? Math.hypot(...[0, 1, 2].map((c) => sIn[c] / nIn - sOut[c] / nOut)) : 0;
    return { contrast, foreignOutside: nFar ? foreign / nFar : 0, insideBackground: nIn ? inBg / nIn : 0 };
  });
  return { perSide };
}

/** Fracción del área de `a` que queda dentro de `b` (muestreo en rejilla). */
export function containment(a: Quad, b: Quad): number {
  const xs = a.map((p) => p.x), ys = a.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  let inA = 0, inBoth = 0;
  for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) {
    const p = { x: x0 + ((x1 - x0) * (i + 0.5)) / 30, y: y0 + ((y1 - y0) * (j + 0.5)) / 30 };
    if (inQuad(a, p)) { inA++; if (inQuad(b, p)) inBoth++; }
  }
  return inA ? inBoth / inA : 0;
}

/** ¿La franja entre dos rectas paralelas (interior → exterior) es parte de la tarjeta y no fondo? */
function stripIsCard(ctx: Ctx, mid: Pt, nx: number, ny: number, inner: { off: number; ang: number }, outer: { off: number; ang: number }, len: number): boolean {
  const { w, h, D, bgThr, rgb } = ctx; if (!D || bgThr === undefined || !rgb) return false;
  const dx = Math.cos(inner.ang), dy = Math.sin(inner.ang);
  let card = 0, tot = 0;
  for (let k = -10; k <= 10; k++) {
    const t = (k / 10) * len * 0.4;
    for (let f = 0.25; f <= 0.75; f += 0.25) {
      const off = inner.off + (outer.off - inner.off) * f;
      const x = Math.round(mid.x + nx * off + dx * t), y = Math.round(mid.y + ny * off + dy * t);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = y * w + x; tot++;
      if (D[i] > bgThr && !isSkin(rgb[i * 4], rgb[i * 4 + 1], rgb[i * 4 + 2])) card++;
    }
  }
  return tot > 10 && card / tot > 0.7;
}

/** Densidad de bordes (texto, logotipos) en el interior del cuadrilátero, lejos de sus lados. */
export function inkDensity(mag: Float32Array, w: number, h: number, q: Quad, edgeThr: number): number {
  const c = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
  const inner = q.map((p) => ({ x: c.x + (p.x - c.x) * 0.8, y: c.y + (p.y - c.y) * 0.8 })) as Quad; // 80 % central
  const xs = inner.map((p) => p.x), ys = inner.map((p) => p.y);
  let hit = 0, tot = 0;
  for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(h - 1, Math.ceil(Math.max(...ys))); y += 2) for (let x = Math.max(0, Math.floor(Math.min(...xs))); x <= Math.min(w - 1, Math.ceil(Math.max(...xs))); x += 2) {
    if (!inQuad(inner, { x, y })) continue; tot++; if (mag[y * w + x] > edgeThr) hit++;
  }
  return tot ? hit / tot : 0;
}



/** Polaridad de la tarjeta: −1 si es claramente más OSCURA que su entorno (media de los 4 lados), si no +1. */
function quadPolarity(L: Float32Array, w: number, h: number, q: Pt[]): number {
  const c = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
  let inS = 0, outS = 0, n = 0;
  for (let s = 0; s < 4; s++) {
    const a = q[s], b = q[(s + 1) % 4]; const len = dist(a, b); if (len < 4) continue;
    let nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if ((mid.x - c.x) * nx + (mid.y - c.y) * ny < 0) { nx = -nx; ny = -ny; }
    const d = Math.max(3, 0.03 * len);
    for (let k = 1; k < 16; k++) {
      const t = 0.15 + 0.7 * (k / 16); const px = a.x + (b.x - a.x) * t, py = a.y + (b.y - a.y) * t;
      const xi = Math.round(px - nx * d), yi = Math.round(py - ny * d), xo = Math.round(px + nx * d * 2), yo = Math.round(py + ny * d * 2);
      if (xi < 0 || yi < 0 || xi >= w || yi >= h || xo < 0 || yo < 0 || xo >= w || yo >= h) continue;
      inS += L[yi * w + xi]; outS += L[yo * w + xo]; n++;
    }
  }
  return n > 10 && (inS - outS) / n < -25 ? -1 : 1;
}

/** Polaridad de un lado: +1 tarjeta más clara que el exterior, −1 más oscura, 0 indistinta (se aceptan ambas). */
function sidePol(L: Float32Array, w: number, h: number, a: Pt, b: Pt, center: Pt): number {
  const len = dist(a, b); if (len < 4) return 0;
  const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
  let nx = -uy, ny = ux;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if ((mid.x - center.x) * nx + (mid.y - center.y) * ny < 0) { nx = -nx; ny = -ny; }
  const d = Math.max(3, 0.03 * len);
  let inS = 0, outS = 0, n = 0;
  for (let k = -8; k <= 8; k++) {
    const t = (k / 8) * len * 0.35;
    const xi = Math.round(mid.x + ux * t - nx * d), yi = Math.round(mid.y + uy * t - ny * d);
    const xo = Math.round(mid.x + ux * t + nx * d * 2), yo = Math.round(mid.y + uy * t + ny * d * 2);
    if (xi < 0 || yi < 0 || xi >= w || yi >= h || xo < 0 || yo < 0 || xo >= w || yo >= h) continue;
    inS += L[yi * w + xi]; outS += L[yo * w + xo]; n++;
  }
  if (n < 5) return 0;
  const diff = (inS - outS) / n;
  return diff > 12 ? 1 : diff < -12 ? -1 : 0;
}
