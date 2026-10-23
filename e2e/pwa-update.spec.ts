// Actualización REAL de la PWA instalada, en el mismo origen y la misma ruta que GitHub Pages
// (/colescomex-canton-capture/), con los artefactos que estuvieron publicados:
//   · deployed/v1.0.0 → la versión que ejecuta el teléfono del propietario (gh-pages 9945243)
//   · deployed/v1.2.0 → la publicada hoy (gh-pages d6d8cd3)
// y esta rama compilada dos veces (B1, B2) para probar las actualizaciones siguientes.
// Datos 100 % ficticios. Las versiones de producción no pueden acceder a Google: todo lo externo se bloquea.
import { test, expect as baseExpect, type Page, type BrowserContext } from '@playwright/test';
import { execSync } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const expect = baseExpect.configure({ timeout: 90_000 });
const OUT = path.resolve('dist-update');
const BASE = '/colescomex-canton-capture/';
const PORT = 4181;
const URL0 = `http://localhost:${PORT}${BASE}`;
const FIXTURE = path.resolve('ocr-eval/fixtures/c2_front_photo.jpg'); // tarjeta sintética de la fase 1

// ───────────── Servidor estático con raíz intercambiable (simula una nueva publicación) ─────────────
let root = '';
const failPaths = new Set<string>();
/** peticiones recibidas (para comprobar que no se repiten descargas de modelos OCR) */
const requests: string[] = [];
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.onnx': 'application/octet-stream', '.tar': 'application/x-tar' };
function staticServer(getRoot: () => string, log?: string[]) { return http.createServer((req, res) => {
  const root = getRoot();
  const u = decodeURIComponent((req.url ?? '/').split('?')[0]);
  log?.push(u.slice(BASE.length));
  if (!u.startsWith(BASE)) { res.writeHead(404); res.end(); return; }
  let rel = u.slice(BASE.length) || 'index.html';
  if (failPaths.has(rel)) { res.writeHead(500); res.end('fallo simulado'); return; }
  let file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { rel = '404.html'; file = path.join(root, '404.html'); res.statusCode = 404; }
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  // mismas cabeceras de caché que GitHub Pages
  res.setHeader('Content-Type', TYPES[path.extname(file)] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', 'max-age=600');
  fs.createReadStream(file).pipe(res);
}); }
const server = staticServer(() => root, requests);
// segundo origen («Firebase»): mismo contenido inicial, publicación independiente
let rootF = '';
const PORT_F = 4182;
const URL_F = `http://127.0.0.1:${PORT_F}${BASE}`;
const serverF = staticServer(() => rootF);

const has = (ref: string) => { try { execSync(`git cat-file -e ${ref}^{commit}`, { stdio: 'ignore' }); return true; } catch { return false; } };
function extract(ref: string, dir: string) {
  if (fs.existsSync(path.join(dir, 'sw.js'))) return;
  fs.mkdirSync(dir, { recursive: true });
  execSync(`git archive --format=tar ${ref} | tar -x -C "${dir}"`, { stdio: 'inherit', shell: '/bin/bash' });
}
function buildBranch(id: string, extraEnv: Record<string, string> = {}) {
  const dir = path.join(OUT, id);
  execSync(`npx vite build --mode test --outDir "${dir}" --emptyOutDir`, { stdio: 'pipe', env: { ...process.env, VITE_INSTANCE: 'production', VITE_AUTH_MODE: 'mock', VITE_SYNC_MODE: 'mock', VITE_BUILD_ID: id, ...extraEnv } });
  fs.copyFileSync(path.join(dir, 'index.html'), path.join(dir, '404.html'));
  return dir;
}

const RUN = `${Date.now().toString(36)}`;
const B1 = `B1-${RUN}`, B2 = `B2-${RUN}`, BW = `BW-${RUN}`;
test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  test.setTimeout(600_000);
  fs.mkdirSync(OUT, { recursive: true });
  if (has('deployed/v1.0.0')) extract('deployed/v1.0.0', path.join(OUT, 'A-v1.0.0'));
  if (has('deployed/v1.2.0')) extract('deployed/v1.2.0', path.join(OUT, 'A-v1.2.0'));
  buildBranch(B1); buildBranch(B2);
  buildBranch(BW, { VITE_SW_NO_AUTOACTIVATE: '1' }); // publicación hipotética SIN activación automática
  await new Promise<void>((r) => server.listen(PORT, r));
  await new Promise<void>((r) => serverF.listen(PORT_F, r));
});
test.afterAll(() => { server.close(); serverF.close(); });

async function isolate(context: BrowserContext) {
  // las versiones de producción intentarían usar Google: nada sale de localhost
  await context.route((url) => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), (r) => r.abort());
}
/** SW instalado y controlando la página. Las versiones sin clientsClaim (v1.0/v1.2) solo controlan tras recargar. */
async function swReady(page: Page) {
  await expect.poll(() => page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!reg?.active && !reg.installing && !reg.waiting;
  }), { timeout: 180_000 }).toBe(true);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 60_000 }).toBe(true);
}
const controllerScript = (page: Page) => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '');
/** evaluate que tolera la recarga automática de la página durante una actualización */
const safeEval = <T,>(page: Page, fn: () => T | Promise<T>) => page.evaluate(fn).catch(() => null);

/** Datos con el formato EXACTO de la v1.0 (IndexedDB colescomex-canton-capture, versión 1). Ficticios. */
async function seedLegacy(page: Page) {
  return page.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('colescomex-canton-capture'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const jpeg = async (label: string) => {
      const c = document.createElement('canvas'); c.width = 1200; c.height = 760;
      const g = c.getContext('2d')!; g.fillStyle = '#556070'; g.fillRect(0, 0, 1200, 760); g.fillStyle = '#fffdf7'; g.fillRect(140, 120, 920, 520);
      g.fillStyle = '#111'; g.font = 'bold 48px sans-serif'; g.fillText(label, 200, 260); g.font = '34px sans-serif'; g.fillText('Ana Ejemplo · Tel +86 555 0100 321', 200, 360);
      return new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
    };
    const sha = async (b: Blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer()))].map((x) => x.toString(16).padStart(2, '0')).join('');
    const F = ['external_ref', 'capture_date', 'captured_by', 'mission', 'source', 'phase', 'hall', 'booth', 'company_name', 'company_name_cn', 'contact_name', 'job_title', 'phone_1', 'phone_2', 'wechat',
      'whatsapp', 'email', 'website', 'address', 'city', 'province', 'country', 'supplier_type', 'main_products', 'product_interest', 'notes', 'follow_up', 'data_classification', 'processing_status'];
    const now = new Date().toISOString();
    const cap = (n: number, company: string, synced: boolean, evIds: string[]) => {
      const ref = `CF26F2-EDR-T3ST-000${n}`;
      const fields = Object.fromEntries(F.map((f) => [f, ''])) as Record<string, string>;
      Object.assign(fields, { external_ref: ref, capture_date: now.slice(0, 10), captured_by: 'Eder', mission: 'China 2026', source: 'Canton Fair', phase: 'Fase 2', country: 'China', data_classification: 'REAL', company_name: company, contact_name: 'Ana Ejemplo', processing_status: 'EXTRAIDO' });
      return { uuid: `legacy-${n}`, external_ref: ref, fields, field_meta: { company_name: { source: 'human', status: 'ok', locked: true }, contact_name: { source: 'ocr_front', status: 'ok' } },
        evidence_ids: evIds, ocr_status: 'EXTRAIDO', ocr_attempts: 1, ocr_engine: 'paddleocr-js', review_status: 'SIN_REVISAR',
        sync_status: synced ? 'CONFIRMADO' : 'PENDIENTE', sync_attempts: 0, revision: synced ? 3 : 1, synced_revision: synced ? 3 : 0,
        remote: synced ? { folder_id: 'FOLDER-LEGACY-1', folder_url: 'https://drive.google.com/drive/folders/FOLDER-LEGACY-1', row_confirmed_at: now } : undefined,
        device_id: 'dev-legacy', user_id: 'EDR', created_at: now, updated_at: now, app_version: '1.0.0' };
    };
    const blobs = { e1: await jpeg('Demo Legacy Lighting Co.'), e2: await jpeg('Demo Offline Valves Ltd.'), e3: await jpeg('Stand demo'), d1: await jpeg('Borrador demo') };
    const ev = (id: string, capture_uuid: string, kind: string, seq: number, ref: string, blob: Blob, remote?: string) => ({ id, capture_uuid, kind, seq, blob, mime: 'image/jpeg', size: blob.size,
      file_name: `${ref}_0${seq}_${kind}.jpg`, created_at: now, ...(remote ? { remote_file_id: remote, remote_url: `https://drive.google.com/file/d/${remote}/view`, uploaded_at: now } : {}) });
    const tx = db.transaction(['captures', 'evidences', 'ocr_results', 'meta', 'audit'], 'readwrite');
    tx.objectStore('captures').put(cap(1, 'Demo Legacy Lighting Co.', true, ['e1']));
    tx.objectStore('captures').put(cap(2, 'Demo Offline Valves Ltd.', false, ['e2', 'e3']));
    tx.objectStore('evidences').put(ev('e1', 'legacy-1', 'card_front', 1, 'CF26F2-EDR-T3ST-0001', blobs.e1, 'FILE-LEGACY-1'));
    tx.objectStore('evidences').put(ev('e2', 'legacy-2', 'card_front', 1, 'CF26F2-EDR-T3ST-0002', blobs.e2));
    tx.objectStore('evidences').put(ev('e3', 'legacy-2', 'stand', 2, 'CF26F2-EDR-T3ST-0002', blobs.e3));
    tx.objectStore('ocr_results').put({ key: 'legacy-1:front', capture_uuid: 'legacy-1', side: 'front', evidence_id: 'e1', engine: 'paddleocr-js', lines: [], text: 'Demo Legacy Lighting Co.', ms: 900, created_at: now });
    tx.objectStore('audit').put({ capture_uuid: 'legacy-1', at: now, actor: 'EDR', type: 'HUMAN_EDIT', detail: { company_name: 'Demo Legacy Lighting Co.' } });
    tx.objectStore('meta').put({ id: 'EDR', name: 'Eder', email: 'eder@example.com' }, 'session');
    tx.objectStore('meta').put({ device_id: 'dev-legacy', device_code: 'T3ST' }, 'device');
    tx.objectStore('meta').put(2, 'seq:EDR');
    tx.objectStore('meta').put({ step: 'askBack', evidences: [{ kind: 'card_front', blob: blobs.d1, name: 'borrador.jpg' }], quick: { booth: 'B12' } }, 'draft:EDR');
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = () => j(tx.error); });
    db.close();
    return { e1: await sha(blobs.e1), e2: await sha(blobs.e2), e3: await sha(blobs.e3), d1: await sha(blobs.d1) };
  });
}

/** Lectura directa de IndexedDB (independiente del código de la app) para comparar antes/después. */
const snapshot = (page: Page) => page.evaluate(async () => {
  const db: IDBDatabase = await new Promise((res, rej) => { const r = indexedDB.open('colescomex-canton-capture'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = <T,>(store: string) => new Promise<T[]>((res) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result as T[]); });
  const get = <T,>(store: string, k: string) => new Promise<T>((res) => { const r = db.transaction(store).objectStore(store).get(k); r.onsuccess = () => res(r.result as T); });
  const sha = async (b: Blob) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer()))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const caps = await all<{ uuid: string; external_ref: string; sync_status: string; ocr_status: string; revision: number; field_meta: Record<string, { locked?: boolean }>; fields: Record<string, string> }>('captures');
  const evs = await all<{ id: string; capture_uuid: string; blob: Blob; role?: string; remote_file_id?: string }>('evidences');
  const draft = await get<{ evidences: { blob: Blob }[] } | undefined>('meta', 'draft:EDR');
  const out = {
    captures: Object.fromEntries(caps.map((c) => [c.external_ref, { sync: c.sync_status, ocr: c.ocr_status, company: c.fields.company_name, lockedCompany: !!c.field_meta.company_name?.locked }])),
    evidences: Object.fromEntries(await Promise.all(evs.filter((e) => e.id.startsWith('e')).map(async (e) => [e.id, { sha: await sha(e.blob), remote: e.remote_file_id ?? null }]))),
    draftSha: draft?.evidences?.[0] ? await sha(draft.evidences[0].blob) : null,
    seq: await get<number>('meta', 'seq:EDR'),
    audit: (await all<{ type: string }>('audit')).map((a) => a.type),
  };
  db.close();
  return out;
});

async function legacyToNew(page: Page, context: BrowserContext, legacyDir: string) {
  await isolate(context);
  // 1. Instalación existente (artefacto publicado) con datos del operador
  root = legacyDir;
  await page.goto(URL0);
  await swReady(page);
  const oldSw = await controllerScript(page);
  const shas = await seedLegacy(page);
  await page.reload();
  const before = await snapshot(page);
  expect(Object.keys(before.captures).sort()).toEqual(['CF26F2-EDR-T3ST-0001', 'CF26F2-EDR-T3ST-0002']);

  // 2. Nueva publicación en el mismo origen; el operador vuelve a abrir la app (navegación normal)
  root = path.join(OUT, B1);
  requests.length = 0;
  const marker = await page.evaluate(() => ((window as unknown as { __m: number }).__m = Math.random()));
  await page.reload();
  // la versión antigua no envía SKIP_WAITING: el SW nuevo se activa solo y la página se recarga una vez
  await expect.poll(() => page.evaluate(() => (window as unknown as { __cx?: unknown }).__cx ? 'nueva' : 'antigua').catch(() => 'navegando'), { timeout: 180_000 }).toBe('nueva');
  await page.waitForLoadState('load');
  expect(await page.evaluate(() => (window as unknown as { __m?: number }).__m)).not.toBe(marker);
  await swReady(page);
  expect(await controllerScript(page)).toBe(oldSw); // misma URL de SW: sin reinstalar la app

  // 3. Interfaz nueva con la versión verificable
  await expect(page.getByText('Se recuperó una captura sin guardar')).toBeVisible();
  await expect(page.locator('#screen-capture')).toBeVisible(); // el borrador de la v1.0 se reabre
  await page.locator('#btn-cam-close').click();
  await page.locator('[data-nav="settings"]').click();
  await expect(page.locator('#app-version')).toHaveAttribute('data-build', B1);
  await expect.poll(async () => (await page.request.get(`${URL0}version.json`)).json()).toMatchObject({ build: B1 });

  // 4. Datos intactos byte a byte (IndexedDB leída sin pasar por la app)
  const after = await snapshot(page);
  for (const id of ['e1', 'e2', 'e3'] as const) expect(after.evidences[id].sha, id).toBe(shas[id]);
  expect(after.draftSha).toBe(shas.d1);
  expect(after.captures['CF26F2-EDR-T3ST-0001']).toMatchObject({ company: 'Demo Legacy Lighting Co.', lockedCompany: true, ocr: 'EXTRAIDO' });
  expect(after.captures['CF26F2-EDR-T3ST-0002'].company).toBe('Demo Offline Valves Ltd.');
  expect(after.evidences.e1.remote).toBe('FILE-LEGACY-1');
  expect(after.audit).toContain('HUMAN_EDIT');
  await page.locator('[data-nav="list"]').click();
  await expect(page.locator('#capture-list .supplier')).toHaveCount(2);
  const ocrDownloads = requests.filter((r) => /^ocr-assets\/(models|ort)\//.test(r));
  return { shas, ocrDownloads };
}

test('v1.0.0 instalada (la del teléfono) → versión nueva: se actualiza sola sin reinstalar y conserva todo; escáner y OCR funcionan', async ({ page, context }) => {
  test.skip(!has('deployed/v1.0.0'), 'artefacto deployed/v1.0.0 no disponible en este clon');
  test.setTimeout(480_000);
  const { ocrDownloads } = await legacyToNew(page, context, path.join(OUT, 'A-v1.0.0'));
  // modelos OCR reutilizados del precaché de la v1.0.0: solo se descarga el clasificador de orientación (nuevo en v1.1)
  expect(ocrDownloads).toEqual(['ocr-assets/models/PP-LCNet_x1_0_doc_ori.onnx']);

  // la numeración continúa (sin referencias duplicadas) y la captura nueva pasa por escáner + OCR del precaché nuevo
  await page.locator('#nav-capture').click();
  await page.locator('#btn-save-next').click(); // el borrador de la v1.0 se guarda como captura 0003
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#btn-gallery').click();
  await (await chooser).setFiles(FIXTURE);
  await page.locator('#btn-save-done').click();
  type W = { __cx: { app: { repo: { list(): Promise<{ external_ref: string; ocr_status: string; uuid: string; sync_status: string }[]>; evidences(u: string): Promise<{ role?: string }[]> } } } };
  const latest = () => page.evaluate(async () => (await (window as unknown as W).__cx.app.repo.list())[0]);
  await expect.poll(async () => (await latest()).external_ref).toBe('CF26F2-EDR-T3ST-0004');
  await expect.poll(async () => (await latest()).ocr_status, { timeout: 240_000 }).toMatch(/EXTRAIDO|REQUIERE_REVISION/);
  const uuid = (await latest()).uuid;
  expect((await page.evaluate((u) => (window as unknown as W).__cx.app.repo.evidences(u), uuid)).some((e) => e.role === 'processed')).toBe(true);
  // la captura local-only de la v1.0 se sincroniza con la versión nueva (mock) sin duplicar la ya confirmada
  await expect.poll(async () => page.evaluate(async () => (await (window as unknown as W).__cx.app.repo.list()).map((c) => c.sync_status).join(','))).not.toContain('ERROR');
});

test('v1.2.0 publicada hoy → versión nueva: misma garantía', async ({ page, context }) => {
  test.skip(!has('deployed/v1.2.0'), 'artefacto deployed/v1.2.0 no disponible en este clon');
  test.setTimeout(480_000);
  const { ocrDownloads } = await legacyToNew(page, context, path.join(OUT, 'A-v1.2.0'));
  expect(ocrDownloads).toEqual([]); // modelos idénticos: ninguna descarga repetida
});

test('actualizaciones siguientes: nunca recarga durante una captura; se aplica al volver a Inicio y se verifica', async ({ page, context }) => {
  test.setTimeout(480_000);
  await isolate(context);
  root = path.join(OUT, B1);
  await page.goto(URL0);
  await page.getByRole('button', { name: 'Continuar como Eder' }).click();
  await swReady(page);
  await page.locator('#btn-register').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#btn-gallery').click();
  await (await chooser).setFiles(FIXTURE);
  await expect(page.locator('#btn-save-next')).toBeVisible(); // captura en curso (borrador)
  const marker = await page.evaluate(() => ((window as unknown as { __m: number }).__m = Math.random()));

  // nueva publicación mientras el operador está en la cámara
  root = path.join(OUT, B2);
  await page.evaluate(() => (window as unknown as { __cx: { updater: { check(f: boolean): Promise<unknown> } } }).__cx.updater.check(true));
  await expect(page.locator('#update-bar')).toContainText('Nueva versión lista');
  await expect(page.locator('#update-bar')).toContainText('hay una captura en curso');
  await page.waitForTimeout(12_000); // más que el reintento automático (10 s)
  expect(await page.evaluate(() => (window as unknown as { __m?: number }).__m)).toBe(marker); // NO se recargó
  await expect(page.locator('#btn-save-next')).toBeVisible();

  // el operador guarda y sale: la actualización se aplica sola en un momento seguro
  await page.locator('#btn-save-done').click();
  // espera a que termine el OCR de la captura guardada (recargar durante el OCR se tomaría por un cierre por memoria)
  await expect.poll(() => safeEval(page, () => (window as unknown as { __m?: number }).__m ?? 'recargada'), { timeout: 300_000 }).toBe('recargada');
  await page.waitForLoadState('load');
  await expect(page.getByText(new RegExp(`Actualizada a la versión 1\\.2\\.1 \\(${B2}\\)`))).toBeVisible();
  await page.locator('[data-nav="settings"]').click();
  await expect(page.locator('#app-version')).toHaveAttribute('data-build', B2);
  await expect(page.locator('#update-phase')).toHaveAttribute('data-phase', /current|checking/);
  // sin bucles: tras aplicar no hay más recargas ni descargas
  const m2 = await page.evaluate(() => ((window as unknown as { __m2: number }).__m2 = Math.random()));
  requests.length = 0;
  await page.evaluate(() => (window as unknown as { __cx: { updater: { check(f: boolean): Promise<unknown> } } }).__cx.updater.check(true));
  await page.waitForTimeout(15_000);
  expect(await page.evaluate(() => (window as unknown as { __m2?: number }).__m2)).toBe(m2);
  expect(requests.filter((r) => !/^(sw\.js|version\.json)$/.test(r))).toEqual([]);
  type W = { __cx: { app: { repo: { list(): Promise<unknown[]> } } } };
  expect(await page.evaluate(async () => (await (window as unknown as W).__cx.app.repo.list()).length)).toBe(1);
});

test('descarga interrumpida: la app sigue en la versión actual, informa y reintenta hasta completar', async ({ page, context }) => {
  test.setTimeout(480_000);
  await isolate(context);
  root = path.join(OUT, B1);
  await page.goto(URL0);
  await page.getByRole('button', { name: 'Continuar como Eder' }).click();
  await swReady(page);
  root = path.join(OUT, B2);
  const mainJs = fs.readdirSync(path.join(OUT, B2, 'assets')).find((f) => /^main-.*\.js$/.test(f))!;
  failPaths.add(`assets/${mainJs}`); // el precaché de la versión nueva no puede completarse
  type U = { __cx: { updater: { check(f: boolean): Promise<{ phase: string }>; state: { phase: string; error?: string } } } };
  await page.evaluate(() => (window as unknown as U).__cx.updater.check(true));
  await expect.poll(() => page.evaluate(() => (window as unknown as U).__cx.updater.state.phase), { timeout: 60_000 }).toBe('error');
  expect(await page.evaluate(() => (window as unknown as U).__cx.updater.state.error)).toMatch(/interrumpió|No se pudo/);
  await page.locator('[data-nav="settings"]').click();
  await expect(page.locator('#app-version')).toHaveAttribute('data-build', B1); // sigue funcionando la versión instalada
  failPaths.clear();
  // sin tocar nada: el reintento automático (15 s) completa la descarga
  // se descarga, se activa y se aplica sola (ajustes = momento seguro); la recarga verifica la compilación nueva
  await expect.poll(() => safeEval(page, () => document.querySelector('#app-version')?.getAttribute('data-build') ?? ''), { timeout: 180_000, intervals: [3000] }).toBe(B2);
  await expect(page.getByText(new RegExp(`Actualizada a la versión 1\\.2\\.1 \\(${B2}\\)`))).toBeVisible();
});

test('edición sin guardar: la versión nueva espera y no se pierde el texto; se aplica tras guardar', async ({ page, context }) => {
  test.setTimeout(300_000);
  await isolate(context);
  root = path.join(OUT, B1);
  await page.goto(URL0);
  await page.getByRole('button', { name: 'Continuar como Eder' }).click();
  await swReady(page);
  await page.evaluate(async () => {
    const cx = (window as unknown as { __cx: { app: { repo: { createCapture(u: unknown, e: unknown[]): Promise<unknown> }; auth: { currentUser(): Promise<unknown> } } } }).__cx;
    await cx.app.repo.createCapture(await cx.app.auth.currentUser(), [{ kind: 'card_front', blob: new Blob(['\xFF\xD8demo'], { type: 'image/jpeg' }) }]);
  });
  await page.locator('#btn-list').click();
  await page.locator('.supplier').first().click();
  await page.locator('[data-edit="sec-ident"]').click();
  await page.locator('input[name="contact_name"]').fill('Leo Prueba (sin guardar)');
  const marker = await page.evaluate(() => ((window as unknown as { __m: number }).__m = Math.random()));
  root = path.join(OUT, B2);
  await page.evaluate(() => (window as unknown as { __cx: { updater: { check(f: boolean): Promise<unknown> } } }).__cx.updater.check(true));
  await expect(page.locator('#update-bar')).toContainText('hay una edición sin guardar');
  await page.waitForTimeout(12_000);
  expect(await page.evaluate(() => (window as unknown as { __m?: number }).__m)).toBe(marker);
  await expect(page.locator('input[name="contact_name"]')).toHaveValue('Leo Prueba (sin guardar)'); // nada se perdió
  await page.locator('#btn-save-edit').click(); // el usuario guarda: ya es seguro
  await page.locator('[data-nav="home"]').click();
  await expect.poll(() => safeEval(page, () => (window as unknown as { __m?: number }).__m ?? 'recargada'), { timeout: 120_000 }).toBe('recargada');
  await page.waitForLoadState('load');
  type W = { __cx: { app: { repo: { list(): Promise<{ fields: Record<string, string> }[]> } } } };
  await expect.poll(() => safeEval(page, async () => (await (window as unknown as W).__cx.app.repo.list())[0].fields.contact_name)).toBe('Leo Prueba (sin guardar)');
});

test('escenario F: otro origen (como Firebase) es otra app: no se actualiza desde GitHub Pages ni comparte datos', async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  await isolate(context);
  const page = await context.newPage();
  root = path.join(OUT, B1); rootF = path.join(OUT, B1);
  // instalación en el origen «Firebase» con una captura propia
  await page.goto(URL_F);
  await page.getByRole('button', { name: 'Continuar como Eder' }).click();
  await swReady(page);
  type W = { __cx: { app: { repo: { list(): Promise<{ external_ref: string }[]>; createCapture(u: unknown, e: unknown[]): Promise<{ external_ref: string }> }; auth: { currentUser(): Promise<unknown> } } } };
  const refF = await page.evaluate(async () => { const cx = (window as unknown as W).__cx; return (await cx.app.repo.createCapture(await cx.app.auth.currentUser(), [{ kind: 'card_front', blob: new Blob(['\xFF\xD8f'], { type: 'image/jpeg' }) }])).external_ref; });
  // instalación en el origen «GitHub Pages» (mismo navegador, mismo dispositivo)
  const pageP = await context.newPage();
  await pageP.goto(URL0);
  await expect(pageP.locator('#screen-login')).toBeVisible(); // sesión NO compartida
  await pageP.getByRole('button', { name: 'Continuar como Eder' }).click();
  await swReady(pageP);
  expect(await pageP.evaluate(async () => (await (window as unknown as W).__cx.app.repo.list()).length)).toBe(0); // IndexedDB NO compartida
  // se publica B2 solo en GitHub Pages
  root = path.join(OUT, B2);
  await pageP.evaluate(() => (window as unknown as { __cx: { updater: { check(f: boolean): Promise<unknown> } } }).__cx.updater.check(true));
  await expect.poll(() => safeEval(pageP, async () => (await (await fetch('version.json', { cache: 'no-store' })).json()).build), { timeout: 60_000 }).toBe(B2);
  await expect.poll(() => safeEval(pageP, () => (window as unknown as { __cx?: { updater: { current: { build: string } } } }).__cx?.updater.current.build ?? ''), { timeout: 120_000 }).toBe(B2);
  // el origen «Firebase» sigue en B1 aunque se compruebe y recargue: necesita su propia publicación
  await page.evaluate(() => (window as unknown as { __cx: { updater: { check(f: boolean): Promise<unknown> } } }).__cx.updater.check(true));
  await page.reload(); await page.waitForTimeout(3000);
  expect(await page.evaluate(() => (window as unknown as { __cx: { updater: { current: { build: string } } } }).__cx.updater.current.build)).toBe(B1);
  expect(await page.evaluate(async () => (await (window as unknown as W).__cx.app.repo.list()).map((c) => c.external_ref))).toEqual([refF]);
  await context.close();
});

test('resiliencia: si una publicación futura olvidara la activación automática, la app 1.2.1 la activa en un momento seguro', async ({ page, context }) => {
  test.setTimeout(300_000);
  expect(fs.readFileSync(path.join(OUT, BW, 'sw.js'), 'utf8')).not.toMatch(/self\.skipWaiting\(\),[a-z]\.clientsClaim\(\)/);
  await isolate(context);
  root = path.join(OUT, B1);
  await page.goto(URL0);
  await page.getByRole('button', { name: 'Continuar como Eder' }).click();
  await swReady(page);
  await page.locator('[data-nav="settings"]').click();
  root = path.join(OUT, BW);
  await page.evaluate(() => (window as unknown as { __cx: { updater: { check(f: boolean): Promise<unknown> } } }).__cx.updater.check(true));
  await expect.poll(() => safeEval(page, () => document.querySelector('#app-version')?.getAttribute('data-build') ?? ''), { timeout: 120_000, intervals: [2000] }).toBe(BW);
  await expect(page.getByText(new RegExp(`Actualizada a la versión 1\\.2\\.1 \\(${BW}\\)`))).toBeVisible();
});
