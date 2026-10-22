// Localiza el directorio PRIVADO de fixtures reales (fuera del repositorio público).
// Prioridad: variable CX_PRIVATE_DIR → carpeta hermana ../colescomex-private-fixtures.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function privateDir() {
  return process.env.CX_PRIVATE_DIR ? path.resolve(process.env.CX_PRIVATE_DIR) : path.resolve(root, '..', 'colescomex-private-fixtures');
}
export function privateCases() {
  const f = path.join(privateDir(), 'cases.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).cases : null;
}
export const PRIVATE_SKIP_MSG = 'Fixtures privados no disponibles (CX_PRIVATE_DIR o ../colescomex-private-fixtures): pruebas con tarjetas reales OMITIDAS';
