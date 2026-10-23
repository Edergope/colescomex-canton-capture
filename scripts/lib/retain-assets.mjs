// Retención de assets de la publicación anterior (una versión) para el despliegue en GitHub Pages.
// Una app instalada que aún ejecuta la versión anterior puede pedir chunks con hash antiguos (workers del OCR y
// del escáner). Si desaparecen del servidor, fallan con 404. Se conservan SOLO los archivos propios de la
// publicación anterior que no existan en la nueva (no los que ella ya retenía): el tamaño no crece sin límite.
// Los retenidos no entran en el precaché (se copian después del build): no provocan descargas repetidas.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const RETAIN_DIRS = ['assets/', 'ocr-assets/'];
export const RETAINED_MANIFEST = 'retained-assets.json';

const git = (cwd, args, opts = {}) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024, ...opts });

/** @returns {{ retained: string[], skippedPreviouslyRetained: string[] }} */
export function retainPreviousAssets({ cwd, ref = 'origin/gh-pages', distDir, dirs = RETAIN_DIRS }) {
  const prevRetained = new Set((() => {
    try { return JSON.parse(git(cwd, ['show', `${ref}:${RETAINED_MANIFEST}`]).toString()).files ?? []; } catch { return []; }
  })());
  const prevFiles = git(cwd, ['ls-tree', '-r', '--name-only', ref]).toString().split('\n').filter(Boolean);
  const retained = [];
  const skippedPreviouslyRetained = [];
  for (const f of prevFiles) {
    if (!dirs.some((d) => f.startsWith(d))) continue;
    if (prevRetained.has(f)) { skippedPreviouslyRetained.push(f); continue; }
    const target = path.join(distDir, f);
    if (!target.startsWith(path.resolve(distDir) + path.sep)) continue; // nunca fuera de dist
    if (fs.existsSync(target)) continue; // la versión nueva manda
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, git(cwd, ['show', `${ref}:${f}`]));
    retained.push(f);
  }
  fs.writeFileSync(path.join(distDir, RETAINED_MANIFEST), `${JSON.stringify({ files: retained }, null, 2)}\n`);
  return { retained, skippedPreviouslyRetained };
}
