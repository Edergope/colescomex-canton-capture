// Despliegue: conservación de assets de la publicación anterior (una versión, sin crecer y sin pisar la nueva).
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// @ts-expect-error módulo JS del script de despliegue
import { retainPreviousAssets } from '../scripts/lib/retain-assets.mjs';

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe' }).toString();
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'cx-retain-')); }
function write(dir: string, files: Record<string, string>) { for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); } }
/** Publica `files` como un commit huérfano en gh-pages (igual que deploy-pages.mjs) */
function publish(repo: string, files: Record<string, string>) {
  const tree = tmp(); write(tree, files);
  git(repo, '--work-tree', tree, 'checkout', '--orphan', `tmp-${Math.random().toString(36).slice(2)}`);
  git(repo, '--work-tree', tree, 'add', '-A'); git(repo, '--work-tree', tree, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'deploy');
  git(repo, 'branch', '-f', 'gh-pages', 'HEAD');
}
const dist = (files: Record<string, string>) => { const d = tmp(); write(d, files); return d; };
const read = (d: string, f: string) => fs.readFileSync(path.join(d, f), 'utf8');

describe('retención de assets entre publicaciones', () => {
  it('conserva los chunks antiguos que faltan, no pisa los nuevos y no arrastra los ya retenidos', () => {
    const repo = tmp(); git(repo, 'init', '-q');
    publish(repo, { 'index.html': 'v1', 'sw.js': 'sw1', 'assets/main-v1.js': 'm1', 'assets/ocr.worker-v1.js': 'w1', 'assets/shared.css': 'old', 'ocr-assets/model.onnx': 'M' });

    // despliegue v2
    const d2 = dist({ 'index.html': 'v2', 'sw.js': 'sw2', 'assets/main-v2.js': 'm2', 'assets/shared.css': 'new', 'ocr-assets/model.onnx': 'M' });
    const r2 = retainPreviousAssets({ cwd: repo, ref: 'gh-pages', distDir: d2 });
    expect(r2.retained.sort()).toEqual(['assets/main-v1.js', 'assets/ocr.worker-v1.js']);
    expect(read(d2, 'assets/shared.css')).toBe('new'); // la versión nueva manda
    expect(read(d2, 'index.html')).toBe('v2'); // nunca se tocan index.html ni sw.js
    expect(read(d2, 'sw.js')).toBe('sw2');
    expect(JSON.parse(read(d2, 'retained-assets.json')).files.sort()).toEqual(['assets/main-v1.js', 'assets/ocr.worker-v1.js']);

    // se publica v2 (con sus retenidos) y luego v3: los de v1 ya no se arrastran (solo una versión)
    const files2 = Object.fromEntries(['index.html', 'sw.js', 'assets/main-v2.js', 'assets/shared.css', 'ocr-assets/model.onnx', 'assets/main-v1.js', 'assets/ocr.worker-v1.js', 'retained-assets.json'].map((f) => [f, read(d2, f)]));
    publish(repo, files2);
    const d3 = dist({ 'index.html': 'v3', 'sw.js': 'sw3', 'assets/main-v3.js': 'm3', 'ocr-assets/model.onnx': 'M' });
    const r3 = retainPreviousAssets({ cwd: repo, ref: 'gh-pages', distDir: d3 });
    expect(r3.retained.sort()).toEqual(['assets/main-v2.js', 'assets/shared.css']);
    expect(r3.skippedPreviouslyRetained.sort()).toEqual(['assets/main-v1.js', 'assets/ocr.worker-v1.js']);
    expect(fs.existsSync(path.join(d3, 'assets/main-v1.js'))).toBe(false);
  });

  it('sin publicación anterior falla de forma controlada (el script lo captura y continúa)', () => {
    const repo = tmp(); git(repo, 'init', '-q');
    expect(() => retainPreviousAssets({ cwd: repo, ref: 'gh-pages', distDir: dist({ 'index.html': 'v1' }) })).toThrow();
  });
});
