// Tarjetas REALES (datos personales): se leen del directorio privado, nunca del repositorio.
// Sin fixtures privados, estas pruebas se OMITEN con aviso (no fallan ni se dan por aprobadas).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { privateCases, privateDir, PRIVATE_SKIP_MSG } from '../scripts/private-dir.mjs';
import { extractEntities } from '../src/extract/entities';
import { mergeSides } from '../src/extract/merge';

const cases = privateCases();
if (!cases) console.warn(`⚠ ${PRIVATE_SKIP_MSG}`);
const norm = (s = '') => s.toLowerCase().replace(/[^a-z0-9一-鿿@+]/g, '');
const L = (t: string[]) => t.map((text) => ({ text, score: 0.96 }));

describe.skipIf(!cases)('tarjetas reales privadas', () => {
  for (const c of cases ?? []) {
    it(`${c.id}: originales intactos (SHA-256)`, () => {
      for (const side of ['front', 'back'] as const) {
        const sha = createHash('sha256').update(readFileSync(path.join(privateDir(), c.sides[side].file))).digest('hex');
        expect(sha).toBe(c.sides[side].sha256);
      }
    });
    it(`${c.id}: extracción comercial del texto impreso = resultado esperado`, () => {
      const m = mergeSides(extractEntities(L(c.expected.printed_text.front)), extractEntities(L(c.expected.printed_text.back)));
      for (const [f, v] of Object.entries(c.expected.fields)) expect(norm((m.fields as Record<string, string>)[f]), f).toBe(norm(v));
      for (const [k, v] of Object.entries(c.expected.extras)) expect(((m.extras as unknown as Record<string, string[]>)[k] ?? []).map(norm), k).toEqual(v.map(norm));
      expect(m.fields.main_products!.split('; ')).toEqual(c.expected.products);
      expect(m.meta.main_products?.status).toBe('ok');
    });
  }
});
