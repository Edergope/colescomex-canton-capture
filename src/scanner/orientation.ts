// DocumentOrientation: elige la rotación (0/90/180/270° en sentido horario) que deja el texto legible.
// Señales: (1) clasificador entrenado PP-LCNet_x1_0_doc_ori (barato, se ejecuta una vez) como prior;
// (2) verificación con la lectura OCR de cada candidato: confianza, plausibilidad de las palabras y
// entidades comerciales válidas. No gana la lectura con más caracteres: un texto aleatorio no supera a
// una lectura que identifica empresa, correo y teléfono. El OCR solo se ejecuta sobre los candidatos necesarios.

import type { OcrLine } from '../domain/schema';
import { extractEntities } from '../extract/entities';
import { mergeSides } from '../extract/merge';
import { CJK_G } from '../extract/normalize';

/** Probabilidades del clasificador en el orden de sus etiquetas: el documento está girado 0/90/180/270° (horario). */
export type OrientationProbs = [number, number, number, number];

/** Rotación correctora (cuartos de vuelta horarios) para una etiqueta del clasificador. */
export const correctionFor = (labelIdx: number) => (4 - labelIdx) % 4;
/** Probabilidad a priori de que la rotación correctora `rot` sea la buena. */
export const priorFor = (probs: OrientationProbs | null, rot: number) => (probs ? probs[(4 - rot) % 4] : 0.25);

export interface ReadingScore { score: number; confidence: number; wordRatio: number; entities: number; chars: number; horizontal: number }

/**
 * Proporción del texto (ponderada por longitud) en cajas más anchas que altas. PaddleOCR gira internamente
 * las cajas altas y puede "leer" texto vertical: sin esta señal una imagen sin enderezar parecería legible.
 */
export function horizontalRatio(lines: OcrLine[]): number {
  let h = 0, t = 0;
  for (const l of lines) {
    const n = l.text.replace(/\s/g, '').length;
    if (!l.box?.length || n < 3) continue;
    const xs = l.box.map((p) => p[0]), ys = l.box.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs), hh = Math.max(...ys) - Math.min(...ys);
    t += n; if (w >= hh) h += n;
  }
  return t ? h / t : 1;
}

const VOWEL = /[aeiouy]/i;
export function readingScore(lines: OcrLine[]): ReadingScore {
  const text = lines.map((l) => l.text).join('\n');
  const chars = text.replace(/\s/g, '').length;
  if (chars < 6) return { score: chars ? 0.05 : 0, confidence: 0, wordRatio: 0, entities: 0, chars, horizontal: 1 };
  let wsum = 0, csum = 0;
  for (const l of lines) { const n = l.text.replace(/\s/g, '').length; wsum += n; csum += n * (l.score ?? 0); }
  const confidence = wsum ? csum / wsum : 0;
  // palabras latinas plausibles (tienen vocal, sin rachas largas de consonantes) y proporción CJK
  const words = text.match(/[A-Za-z]{2,}/g) ?? [];
  const plausible = words.filter((w) => w.length <= 4 && w === w.toUpperCase() ? true : VOWEL.test(w) && !/[bcdfghjklmnpqrstvwxz]{5,}/i.test(w) && w.length <= 22).length;
  const cjk = text.match(CJK_G)?.length ?? 0;
  const latinChars = words.join('').length;
  const wordRatio = latinChars + cjk === 0 ? 0 : (latinChars / (latinChars + cjk)) * (words.length ? plausible / words.length : 0) + (cjk / (latinChars + cjk)) * Math.min(1, confidence / 0.85);
  // entidades comerciales verificables
  const m = mergeSides(extractEntities(lines), undefined);
  const f = m.fields;
  const entities = [f.email, f.phone_1, f.website, f.company_name || f.company_name_cn, f.address, f.wechat || f.whatsapp, f.main_products]
    .filter((v) => !!v).length;
  const horizontal = horizontalRatio(lines);
  // texto mayoritariamente vertical = imagen no enderezada, aunque el OCR lo lea
  const score = (0.45 * confidence + 0.3 * wordRatio + 0.25 * Math.min(1, entities / 3)) * (horizontal >= 0.6 ? 1 : 0.4 + horizontal);
  return { score: +score.toFixed(4), confidence: +confidence.toFixed(4), wordRatio: +wordRatio.toFixed(4), entities, chars, horizontal: +horizontal.toFixed(3) };
}

export interface OrientationTrial { rot: number; prior: number; reading: ReadingScore; combined: number }
export interface OrientationChoice {
  rot: number; lines: OcrLine[]; source: 'classifier' | 'classifier+ocr' | 'ocr';
  trials: OrientationTrial[]; confident: boolean;
}

export interface ChooseOptions { acceptPrior?: number; acceptReading?: number; maxTrials?: number }

/**
 * Evalúa candidatos por orden de prior y se detiene en cuanto uno es claramente legible.
 * `evaluate(rot)` ejecuta el OCR sobre la imagen girada `rot` cuartos de vuelta (horario).
 */
export async function chooseOrientation(probs: OrientationProbs | null, evaluate: (rot: number) => Promise<OcrLine[]>, opts: ChooseOptions = {}): Promise<OrientationChoice> {
  const acceptPrior = opts.acceptPrior ?? 0.7, acceptReading = opts.acceptReading ?? 0.6, maxTrials = opts.maxTrials ?? 4;
  const order = [0, 1, 2, 3].sort((a, b) => priorFor(probs, b) - priorFor(probs, a) || a - b);
  const trials: OrientationTrial[] = [];
  const linesByRot = new Map<number, OcrLine[]>();
  for (const rot of order.slice(0, maxTrials)) {
    const lines = await evaluate(rot);
    const reading = readingScore(lines);
    const prior = priorFor(probs, rot);
    trials.push({ rot, prior, reading, combined: +(reading.score + 0.25 * prior).toFixed(4) });
    linesByRot.set(rot, lines);
    // Aceptación temprana: el clasificador lo daba por seguro y la lectura lo confirma.
    if (probs && trials.length === 1 && prior >= acceptPrior && reading.score >= acceptReading) break;
    // Sin clasificador (o con prior dudoso): basta una lectura muy clara con entidades.
    if (reading.score >= 0.75 && reading.entities >= 2 && (!probs || prior >= 0.2)) break;
  }
  const best = trials.reduce((m, t) => (t.combined > m.combined ? t : m), trials[0]);
  const topPrior = order[0];
  const source = trials.length === 1 && probs ? 'classifier' : probs && best.rot === topPrior ? 'classifier+ocr' : 'ocr';
  const second = trials.filter((t) => t !== best).reduce((m, t) => Math.max(m, t.combined), 0);
  const confident = best.reading.score >= 0.45 && (trials.length === 1 || best.combined - second >= 0.08);
  return { rot: best.rot, lines: linesByRot.get(best.rot)!, source, trials, confident };
}
