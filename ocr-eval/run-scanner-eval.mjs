// Ejecuta la evaluación del escáner en Chromium (Pixel 7 emulado) y guarda métricas e imágenes antes/después.
// Uso: node ocr-eval/run-scanner-eval.mjs [--only=texto]
import { chromium, devices } from '@playwright/test';
import { spawn, execSync } from 'node:child_process';
import { mkdir, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { privateDir } from '../scripts/private-dir.mjs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1];
const noOcr = process.argv.includes('--noocr');
const ocrSide = process.argv.find((a) => a.startsWith('--ocrside='))?.split('=')[1];
const profile = process.argv.find((a) => a.startsWith('--profile='))?.split('=')[1];
if (!existsSync(path.join(root, 'ocr-eval/scanner-fixtures/manifest.json'))) execSync('node --import tsx ocr-eval/make-scanner-fixtures.ts', { cwd: root, stdio: 'inherit' });
const PORT = 5181;
const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
await new Promise((res, rej) => { vite.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); }); setTimeout(() => rej(new Error('vite timeout')), 30000); });
function treeRssMb(pid) {
  const rows = execSync('ps -A -o pid=,ppid=,rss=').toString().trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map(); for (const [p, pp] of rows) { if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(p); }
  const rss = new Map(rows.map(([p, , r]) => [p, r])); let total = 0; const st = [pid];
  while (st.length) { const p = st.pop(); total += rss.get(p) ?? 0; st.push(...(kids.get(p) ?? [])); }
  return total / 1024;
}
try {
  const server = await chromium.launchServer();
  const pid = server.process().pid;
  const browser = await chromium.connect(server.wsEndpoint());
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  const base = treeRssMb(pid); let peak = base;
  const timer = setInterval(() => { peak = Math.max(peak, treeRssMb(pid)); }, 250);
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/ocr-eval/scanner-eval.html?x=1${only ? `&only=${only}` : ''}${noOcr ? '&noocr=1' : ''}${ocrSide ? `&ocrside=${ocrSide}` : ''}${profile ? `&profile=${profile}` : ''}`);
  // fallo rápido si la página de evaluación no arranca (p. ej. error de compilación del módulo)
  await page.waitForFunction(() => (document.getElementById('log')?.textContent ?? '').length > 12 || window.__done, null, { timeout: 120_000 })
    .catch(() => { throw new Error(`La página de evaluación no arrancó: ${errors.join(' | ') || 'sin mensajes'}`); });
  await page.waitForFunction(() => window.__done, null, { timeout: 30 * 60 * 1000, polling: 1000 });
  const done = await page.evaluate(() => window.__done);
  clearInterval(timer);
  done.memory = { baselineRssMb: Math.round(base), peakRssMb: Math.round(peak) }; done.errors = errors;
  const outDir = path.join(root, 'docs/scanner');
  const privOut = path.join(privateDir(), 'reports');
  await mkdir(path.join(outDir, 'after'), { recursive: true });
  for (const r of done.results ?? []) {
    if (noOcr) { delete r.thumb; continue; }
    if (r.thumb) {
      // las imágenes de tarjetas reales solo van al directorio privado
      const dir = r.private ? path.join(privOut, 'after') : path.join(outDir, 'after');
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `${r.name}.jpg`), Buffer.from(r.thumb, 'base64')); delete r.thumb;
    }
  }
  await mkdir(path.join(root, 'ocr-eval/results'), { recursive: true });
  // Informe completo (con texto y valores reales) → privado; informe público → sin texto ni valores de tarjetas reales
  if (done.realCards?.length || (done.results ?? []).some((r) => r.private)) {
    await mkdir(privOut, { recursive: true });
    await writeFile(path.join(privOut, `scanner-eval${noOcr ? '-noocr' : ''}${profile === 'low' ? '-low' : ''}.json`), JSON.stringify(done, null, 1));
  }
  const pub = JSON.parse(JSON.stringify(done));
  for (const r of pub.results ?? []) if (r.private) { r.text = '(privado)'; r.trials = r.trials?.map(({ rot, prior, score, h }) => ({ rot, prior, score, h })); }
  pub.realCards = (pub.realCards ?? []).map((c) => ({ id: c.id, fields: Object.fromEntries(Object.entries(c.fields).map(([k, v]) => [k, v.ok ? 'PASS' : 'FAIL'])),
    products: { exact: c.products.strict.filter((x) => x.exact).length, lettersOnly: c.products.strict.filter((x) => x.lettersOnly).length, total: c.products.strict.length, status: c.products.status } }));
  await writeFile(path.join(root, `ocr-eval/results/scanner-eval${noOcr ? '-noocr' : ''}${profile === 'low' ? '-low' : ''}.json`), JSON.stringify(pub, null, 1));
  if (done.error) console.error(done.error);
  for (const r of done.results ?? []) console.log(`${r.name.padEnd(30)} ${String(r.status).padEnd(15)} crop=${r.cropped} rot ${r.chosenRot}/${r.expectedRot} ${r.rotOk} OCR×${r.ocrRuns} campos ${r.fieldsOk}/${r.fieldsTotal} ${r.ms.total}ms (dec ${r.ms.decode} det ${r.ms.detect} warp ${r.ms.warp} cls ${r.ms.classify})`);
  for (const c of done.realCards ?? []) {
    for (const [k, v] of Object.entries(c.fields)) console.log(`  ${c.id} ${v.ok ? 'PASS' : 'FAIL'} ${k}`); // sin valores: la salida puede quedar en registros públicos
    console.log(`  ${c.id} productos exactos ${c.products.strict.filter((x) => x.exact).length}/${c.products.strict.length} · letras conservadas ${c.products.strict.filter((x) => x.lettersOnly).length}/${c.products.strict.length} · estado ${c.products.status}`);
  }
  console.log('memoria', done.memory, 'init OCR', done.initMs, 'ms', errors.length ? errors : '');
  await browser.close(); await server.close();
} finally { vite.kill(); }
