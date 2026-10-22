// Ejecuta la evaluación OCR en Chromium (emulación Android: Pixel 7 + CPU ralentizada x4)
// midiendo tiempo, precisión y memoria (RSS máxima del árbol de procesos del navegador).
// Uso: node ocr-eval/run-eval.mjs [paddle|tesseract ...] [--cpu=4]
import { chromium, devices } from '@playwright/test';
import { spawn, execSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const engines = args.filter((a) => !a.startsWith('--')).length ? args.filter((a) => !a.startsWith('--')) : ['paddle', 'tesseract'];
const cpu = Number(args.find((a) => a.startsWith('--cpu='))?.split('=')[1] ?? 4);
const PORT = 5179;

const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, stdio: 'pipe' });
await new Promise((res, rej) => {
  vite.stdout.on('data', (d) => { if (String(d).includes('Local')) res(); });
  vite.on('exit', () => rej(new Error('vite terminó')));
  setTimeout(() => rej(new Error('vite timeout')), 30000);
});

function treeRssMb(pid) {
  const rows = execSync('ps -A -o pid=,ppid=,rss=').toString().trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map(); for (const [p, pp] of rows) { if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(p); }
  const rss = new Map(rows.map(([p, , r]) => [p, r]));
  let total = 0; const stack = [pid];
  while (stack.length) { const p = stack.pop(); total += rss.get(p) ?? 0; stack.push(...(kids.get(p) ?? [])); }
  return total / 1024;
}

const summary = {};
await mkdir(path.join(root, 'ocr-eval', 'results'), { recursive: true });
try {
  for (const engine of engines) {
    const server = await chromium.launchServer();
    const pid = server.process().pid;
    const browser = await chromium.connect(server.wsEndpoint());
    const ctx = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    const baseline = treeRssMb(pid);
    let peak = baseline;
    const timer = setInterval(() => { peak = Math.max(peak, treeRssMb(pid)); }, 250);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const t0 = Date.now();
    await page.goto(`http://localhost:${PORT}/ocr-eval/eval.html?engine=${engine}${process.env.EVAL_QS ?? ''}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 30 * 60 * 1000, polling: 1000 });
    const done = await page.evaluate(() => window.__done);
    clearInterval(timer);
    const heap = await cdp.send('Performance.enable').then(() => cdp.send('Performance.getMetrics'));
    done.wallMs = Date.now() - t0;
    done.memory = { baselineRssMb: Math.round(baseline), peakRssMb: Math.round(peak), jsHeapUsedMb: Math.round(heap.metrics.find((m) => m.name === 'JSHeapUsedSize').value / 1048576) };
    done.cpuThrottle = cpu; done.errors = errors.slice(0, 10);
    await writeFile(path.join(root, 'ocr-eval', 'results', `${engine}.json`), JSON.stringify(done, null, 2));
    if (done.results) {
      const agg = (v) => {
        const rs = done.results.filter((r) => r.image.endsWith(v));
        const f = rs.flatMap((r) => Object.values(r.fields));
        const cj = rs.map((r) => r.cjkRecall).filter((x) => !Number.isNaN(x) && x !== null);
        return { images: rs.length, avgMs: Math.round(rs.reduce((s, r) => s + r.ms, 0) / rs.length), avgCER: +(rs.reduce((s, r) => s + r.cer, 0) / rs.length).toFixed(3),
          cjkRecall: +(cj.reduce((s, x) => s + x, 0) / cj.length).toFixed(3), fieldAccuracy: `${f.filter((x) => x.ok).length}/${f.length}` };
      };
      summary[engine] = { engine: done.engine, initMs: done.initMs, memory: done.memory, scan: agg('scan'), photo: agg('photo') };
    } else summary[engine] = done;
    console.log(engine, JSON.stringify(summary[engine], null, 1));
    await browser.close(); await server.close();
  }
} finally {
  vite.kill();
}
await writeFile(path.join(root, 'ocr-eval', 'results', 'summary.json'), JSON.stringify({ date: new Date().toISOString(), cpuThrottle: cpu, device: 'Pixel 7 (emulado)', summary }, null, 2));
