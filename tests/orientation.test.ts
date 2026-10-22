import { describe, expect, it } from 'vitest';
import { chooseOrientation, readingScore, correctionFor, type OrientationProbs } from '../src/scanner/orientation';
import type { OcrLine } from '../src/domain/schema';

const L = (score: number, ...t: string[]): OcrLine[] => t.map((text) => ({ text, score }));
const GOOD = L(0.93, 'NANHAI BRIGHTPOLE STREET LIGHTING CO.,LTD', 'Laura Demo', 'Mobile:86-13800000001', 'E-mail:laura@brightpole-demo.cc', 'Tel:86-512-80000001');
// Lectura típica de texto al revés: muchos caracteres, sin palabras ni entidades, confianza media
const GARBAGE = L(0.71, 'GL1-11G8-8-L1UD:IIqOW', 'OKA owaq ernel', 'pL1-SLLI-11-98:l9l', 'oo\'owap-alodtybuq@ernel:llew-3', 'XWWQ ZRTPK QQLLD NNMRS TTXXZ', 'lllIIl IIllI 1l1l1 lIl1');
const BLANK: OcrLine[] = [];

describe('readingScore', () => {
  it('una lectura coherente con empresa, correo y teléfono supera a texto aleatorio con más caracteres', () => {
    const g = readingScore(GOOD), b = readingScore(GARBAGE);
    expect(GARBAGE.map((l) => l.text).join('').length).toBeGreaterThan(GOOD.map((l) => l.text).join('').length * 0.8);
    expect(g.entities).toBeGreaterThanOrEqual(3);
    expect(b.entities).toBe(0);
    expect(g.score).toBeGreaterThan(b.score + 0.25);
  });
  it('vacío → 0', () => { expect(readingScore(BLANK).score).toBe(0); });
});

describe('chooseOrientation', () => {
  const evalFor = (good: number) => {
    const calls: number[] = [];
    const fn = async (rot: number) => { calls.push(rot); return rot === good ? GOOD : rot === (good + 2) % 4 ? GARBAGE : BLANK; };
    return { fn, calls };
  };
  it('clasificador seguro y lectura buena → un solo OCR', async () => {
    const probs: OrientationProbs = [0.03, 0.03, 0.03, 0.91]; // documento girado 270° → corrección 90° horario
    expect(correctionFor(3)).toBe(1);
    const { fn, calls } = evalFor(1);
    const r = await chooseOrientation(probs, fn);
    expect(r.rot).toBe(1); expect(calls).toEqual([1]); expect(r.source).toBe('classifier'); expect(r.confident).toBe(true);
  });
  it('clasificador equivocado → la verificación OCR lo corrige', async () => {
    const probs: OrientationProbs = [0.9, 0.04, 0.03, 0.03]; // dice "derecho" pero el texto está al revés
    const { fn, calls } = evalFor(2);
    const r = await chooseOrientation(probs, fn);
    expect(r.rot).toBe(2); expect(calls.length).toBeGreaterThan(1); expect(r.source).toBe('ocr');
  });
  it('sin clasificador: prueba candidatos hasta encontrar una lectura clara', async () => {
    const { fn, calls } = evalFor(3);
    const r = await chooseOrientation(null, fn);
    expect(r.rot).toBe(3); expect(calls).toContain(3);
  });
  it('si nada es legible, no declara confianza', async () => {
    const r = await chooseOrientation(null, async () => GARBAGE);
    expect(r.confident).toBe(false);
  });
});
