// Recorte manual MATERIALIZADO, verificado con píxeles (no con clases CSS): foto sintética de 3000×2000 con EXIF
// orientación 6 (como una foto vertical de Android), tarjeta de límites conocidos sobre un fondo magenta/verde muy
// distinto y 4 marcas de color junto a las esquinas de la tarjeta. Se ajustan las 4 esquinas, se aplica y se mide:
// imagen decodificable, proporción de la tarjeta, CERO fondo, marcas conservadas, original intacto, mismas esquinas al
// volver a editar, OCR y sincronización (simulada) sobre el documento recortado. También: un fallo nunca es «éxito».
import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const expectL = expect.configure({ timeout: 90_000 });
type P = { x: number; y: number };
type Ev = { id: string; kind: string; role?: string; preliminary?: boolean; superseded_by?: string; derived_from?: string; sha256?: string; file_name: string; blob: Blob; crop?: { decision: string }; scan?: { manual_quad?: P[]; processed_id?: string; cropped?: boolean } };
type W = { __cx: { app: { repo: { list(): Promise<{ uuid: string; ocr_status: string; external_ref: string }[]>; evidences(u: string): Promise<Ev[]>; ocrResults(u: string): Promise<{ side: string; read_from?: string }[]>; getMeta(k: string): Promise<unknown> }; syncNow(f?: boolean): Promise<unknown> };
  drive: { files: Map<string, { name: string; size?: number }> }; archive?: { files: Map<string, { name: string }> } } };

// ── escena conocida (coordenadas de la imagen GUARDADA, antes de aplicar EXIF) ──
const RAW = { w: 3000, h: 2000 };
const CARD = { cx: 1500, cy: 1000, w: 1800, h: 1050, angle: -8 * Math.PI / 180 };
const MARK = { inset: 110, size: 90 };
const MARKS = { tl: [225, 20, 20], tr: [20, 60, 225], br: [245, 140, 0], bl: [130, 30, 200] } as const;
const rawCorners = (): P[] => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
  const x = sx * CARD.w / 2, y = sy * CARD.h / 2; const c = Math.cos(CARD.angle), s = Math.sin(CARD.angle);
  return { x: CARD.cx + x * c - y * s, y: CARD.cy + x * s + y * c };
});
/** EXIF 6 = girar 90° en sentido horario para mostrar: (x, y) guardado → (H−1−y, x) visible */
const toDisplayed = (p: P): P => ({ x: RAW.h - 1 - p.y, y: p.x });
/** ordena TL, TR, BR, BL en la imagen visible */
function order(q: P[]): P[] {
  const c = { x: q.reduce((a, p) => a + p.x, 0) / 4, y: q.reduce((a, p) => a + p.y, 0) / 4 };
  const byAngle = [...q].sort((a, b) => Math.atan2(a.y - c.y, a.x - c.x) - Math.atan2(b.y - c.y, b.x - c.x)); // desde ~−180°
  const tl = byAngle.reduce((m, p) => (p.x + p.y < m.x + m.y ? p : m));
  const i = byAngle.indexOf(tl); return [0, 1, 2, 3].map((k) => byAngle[(i + k) % 4]);
}
/** esquinas objetivo: 0,6 % hacia dentro de la tarjeta (sin fondo, sin tocar las marcas) */
function targets(): P[] {
  const q = order(rawCorners().map(toDisplayed));
  const c = { x: q.reduce((a, p) => a + p.x, 0) / 4, y: q.reduce((a, p) => a + p.y, 0) / 4 };
  return q.map((p) => ({ x: p.x + (c.x - p.x) * 0.012, y: p.y + (c.y - p.y) * 0.012 }));
}

/** JPEG sintético con EXIF orientación 6 (segmento APP1 insertado tras SOI). */
async function phonePhoto(page: Page) {
  const b64 = await page.evaluate(({ RAW, CARD, MARK, MARKS }) => {
    const c = document.createElement('canvas'); c.width = RAW.w; c.height = RAW.h; const g = c.getContext('2d')!;
    for (let y = 0; y < RAW.h; y += 80) for (let x = 0; x < RAW.w; x += 80) { g.fillStyle = ((x + y) / 80) % 2 ? '#d0209a' : '#20a040'; g.fillRect(x, y, 80, 80); }
    g.save(); g.translate(CARD.cx, CARD.cy); g.rotate(CARD.angle);
    g.fillStyle = '#fbfaf5'; g.fillRect(-CARD.w / 2, -CARD.h / 2, CARD.w, CARD.h);
    const m = (col: readonly number[], x: number, y: number) => { g.fillStyle = `rgb(${col.join(',')})`; g.fillRect(x, y, MARK.size, MARK.size); };
    const L = -CARD.w / 2 + MARK.inset, R = CARD.w / 2 - MARK.inset - MARK.size, T = -CARD.h / 2 + MARK.inset, B = CARD.h / 2 - MARK.inset - MARK.size;
    m(MARKS.tl, L, T); m(MARKS.tr, R, T); m(MARKS.br, R, B); m(MARKS.bl, L, B);
    g.fillStyle = '#111'; g.font = 'bold 96px sans-serif'; g.fillText('Nimbus Demo Valves Co.', -600, -200);
    g.font = '70px sans-serif'; g.fillText('Ada Ejemplo · Export Manager', -600, -60); g.fillText('Tel: +86 555 0100 777', -600, 60); g.fillText('www.nimbus.example', -600, 180);
    g.restore();
    return new Promise<string>((res) => c.toBlob(async (b) => {
      const u = new Uint8Array(await b!.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); res(btoa(s));
    }, 'image/jpeg', 0.92));
  }, { RAW, CARD, MARK, MARKS });
  const jpg = Buffer.from(b64, 'base64');
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
  const buffer = Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]);
  return { name: 'tarjeta-telefono.jpg', mimeType: 'image/jpeg', buffer };
}

/** Mide una imagen en la página: tamaño, fondo (magenta/verde), tarjeta y presencia de las 4 marcas. */
async function measure(page: Page, src: { selector?: string; evidenceId?: string; uuid?: string }) {
  return page.evaluate(async ({ src, MARKS }) => {
    let blob: Blob;
    if (src.selector) blob = await (await fetch((document.querySelector(src.selector) as HTMLImageElement).src)).blob();
    else { const w = window as unknown as W; blob = (await w.__cx.app.repo.evidences(src.uuid!)).find((e) => e.id === src.evidenceId)!.blob; }
    const bmp = await createImageBitmap(blob);
    const W0 = bmp.width, H0 = bmp.height; const k = Math.min(1, 700 / Math.max(W0, H0));
    const w = Math.round(W0 * k), h = Math.round(H0 * k);
    const c = new OffscreenCanvas(w, h); const g = c.getContext('2d')!; g.drawImage(bmp, 0, 0, w, h); bmp.close();
    const d = g.getImageData(0, 0, w, h).data;
    const isBg = (r: number, gg: number, b: number) => (r > 140 && gg < 90 && b > 100) || (gg > 120 && r < 90 && b < 110);
    const near = (r: number, gg: number, b: number, t: readonly number[]) => Math.abs(r - t[0]) + Math.abs(gg - t[1]) + Math.abs(b - t[2]) < 90;
    let bg = 0, edgeBg = 0, edgeN = 0, card = 0; const marks: Record<string, number> = { tl: 0, tr: 0, br: 0, bl: 0 };
    const band = Math.max(2, Math.round(Math.min(w, h) * 0.03));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2];
      const bgp = isBg(r, gg, b); if (bgp) bg++;
      if (x < band || y < band || x >= w - band || y >= h - band) { edgeN++; if (bgp) edgeBg++; }
      if (r > 225 && gg > 225 && b > 215) card++;
      for (const [n, col] of Object.entries(MARKS)) if (near(r, gg, b, col)) marks[n]++;
    }
    const n = w * h;
    return { width: W0, height: H0, size: blob.size, aspect: W0 / H0, bgFrac: bg / n, edgeBgFrac: edgeBg / edgeN, cardFrac: card / n, marks: Object.fromEntries(Object.entries(marks).map(([m, v]) => [m, v / n])) };
  }, { src, MARKS });
}
type M = Awaited<ReturnType<typeof measure>>;
/** El documento contiene SOLO la tarjeta, enderezada, con todo su contenido. */
function expectCardOnly(m: M, label: string) {
  const ratio = CARD.w / CARD.h;
  expect(Math.min(Math.abs(m.aspect - ratio), Math.abs(1 / m.aspect - ratio)) / ratio, `${label}: proporción de la tarjeta`).toBeLessThan(0.03);
  expect(m.bgFrac, `${label}: fondo exterior eliminado`).toBeLessThan(0.002);
  expect(m.edgeBgFrac, `${label}: bordes sin fondo`).toBeLessThan(0.005);
  expect(m.cardFrac, `${label}: la tarjeta ocupa la imagen`).toBeGreaterThan(0.55);
  for (const [n, v] of Object.entries(m.marks)) expect(v, `${label}: marca ${n} conservada`).toBeGreaterThan(0.002);
}

async function login(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continuar como Eder' }).click();
  await expect(page.locator('#btn-register')).toBeVisible();
}
async function pick(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#btn-gallery').click();
  await (await chooser).setFiles(file);
}
/** Posición en pantalla de un punto de la foto (marco del editor = foto exacta). */
async function screenOf(page: Page, p: P) {
  return page.evaluate(({ p }) => {
    const svg = document.querySelector('#corner-editor .ce-svg') as SVGSVGElement; const b = svg.getBoundingClientRect();
    const [, , W, H] = svg.getAttribute('viewBox')!.split(' ').map(Number);
    return { x: b.left + (p.x / W) * b.width, y: b.top + (p.y / H) * b.height };
  }, { p });
}
const handles = (page: Page) => page.evaluate(() => [...document.querySelectorAll('#corner-editor .ce-handle')].map((c) => ({ x: Number(c.getAttribute('cx')), y: Number(c.getAttribute('cy')) })));
/** Arrastra cada esquina del editor hasta su objetivo (como con el dedo). */
async function dragCorners(page: Page, to: P[]) {
  for (let i = 0; i < 4; i++) {
    const from = await screenOf(page, (await handles(page))[i]);
    const dest = await screenOf(page, to[i]);
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(dest.x, dest.y, { steps: 6 }); await page.mouse.up();
  }
}
const diag = (q: P[]) => Math.hypot(q[2].x - q[0].x, q[2].y - q[0].y);
const maxErr = (a: P[], b: P[]) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y)));
/** Escáner de la vista previa que «se cae» (p. ej. sin memoria en Android) mientras `__scanCrash` sea true. */
async function crashableScanner(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __scanCrash: boolean; Worker: typeof Worker };
    w.__scanCrash = false;
    const Base = window.Worker;
    w.Worker = class extends Base {
      private scan: boolean;
      constructor(u: string | URL, o?: WorkerOptions) { super(u, o); this.scan = o?.name === 'cx-scanner'; }
      postMessage(m: unknown, t?: Transferable[] | StructuredSerializeOptions) {
        if (this.scan && w.__scanCrash && (m as { type?: string })?.type === 'scan') { setTimeout(() => this.onerror?.(new ErrorEvent('error', { message: 'memoria agotada (simulado)' })), 30); return; }
        super.postMessage(m, t as Transferable[]);
      }
    } as typeof Worker;
  });
}

test.use({ viewport: { width: 393, height: 851 } });

test('recorte manual REAL: 4 esquinas → Aplicar → tarjeta recortada y enderezada sin fondo; guardada, leída y sincronizada', async ({ page }) => {
  test.setTimeout(300_000);
  await login(page);
  await page.locator('#btn-register').click();
  const photo = await phonePhoto(page);
  const sha = createHash('sha256').update(photo.buffer).digest('hex');
  fs.mkdirSync('docs/scanner/evidencia', { recursive: true });
  fs.writeFileSync('docs/scanner/evidencia/01-foto-original-sintetica.jpg', photo.buffer);
  await pick(page, photo);
  await expectL(page.locator('.cam-sheet .chip').first()).not.toContainText('Analizando');

  // 1) ajuste manual de las 4 esquinas sobre la foto ORIGINAL (EXIF aplicado: 2000×3000 visible)
  await page.locator('#btn-crop-adjust').click();
  await expect(page.locator('#corner-editor')).toBeVisible();
  const vb = await page.locator('#corner-editor .ce-svg').getAttribute('viewBox');
  expect(vb).toBe('0 0 2000 3000'); // la foto se muestra con su orientación EXIF
  const T = targets();
  await dragCorners(page, T);
  const chosen = await handles(page);
  expect(maxErr(chosen, T) / diag(T), 'esquinas colocadas donde se soltaron').toBeLessThan(0.01);
  await page.screenshot({ path: 'docs/scanner/evidencia/02-editor-cuatro-esquinas.jpg', type: 'jpeg', quality: 80 });

  // 2) Aplicar → el recorte se GENERA y se muestra (no solo coordenadas)
  await page.locator('#ce-save').click();
  await expectL(page.locator('#corner-editor')).toHaveCount(0);
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('Recorte manual aplicado');
  await expect(page.locator('#cam-still')).toHaveAttribute('data-view', 'crop');
  const preview = await measure(page, { selector: '#cam-still' });
  expectCardOnly(preview, 'vista previa');
  await page.screenshot({ path: 'docs/scanner/evidencia/03-recorte-aplicado.jpg', type: 'jpeg', quality: 80 });
  await page.locator('#btn-view-toggle').click(); // comprobación visual: original con el contorno elegido
  await expect(page.locator('#cam-still')).toHaveAttribute('data-view', 'original');
  await page.screenshot({ path: 'docs/scanner/evidencia/04-original-con-contorno.jpg', type: 'jpeg', quality: 80 });
  await page.locator('#btn-view-toggle').click();

  // 3) volver a editar: la foto original con LAS MISMAS esquinas (no reiniciadas)
  await page.locator('#btn-crop-adjust').click();
  await expect(page.locator('#corner-editor .ce-svg')).toBeVisible();
  expect(maxErr(await handles(page), chosen)).toBeLessThan(0.5);
  await page.locator('#ce-cancel').click();
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('Recorte manual aplicado');

  // 4) guardar: original intacto + documento procesado guardado al instante (Etapa A, sin esperar al OCR)
  await page.locator('#btn-save-done').click();
  await expect.poll(() => page.evaluate(async () => (await (window as unknown as W).__cx.app.repo.list()).length)).toBe(1);
  const uuid = await page.evaluate(async () => (await (window as unknown as W).__cx.app.repo.list())[0].uuid);
  const evs = () => page.evaluate(async (u) => (await (window as unknown as W).__cx.app.repo.evidences(u)).map((e) => ({ id: e.id, kind: e.kind, role: e.role, preliminary: e.preliminary, superseded_by: e.superseded_by, derived_from: e.derived_from, sha256: e.sha256, file_name: e.file_name, crop: e.crop, manual_quad: e.scan?.manual_quad, processed_id: e.scan?.processed_id, cropped: e.scan?.cropped })), uuid);
  const first = await evs();
  const orig = first.find((e) => e.role === 'original')!;
  const proc0 = first.find((e) => e.role === 'processed')!;
  expect(orig.sha256).toBe(sha); // la foto original se conserva sin modificar
  expect(await page.evaluate(async ({ u, id }) => {
    const b = (await (window as unknown as W).__cx.app.repo.evidences(u)).find((e) => e.id === id)!.blob;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await b.arrayBuffer()))].map((x) => x.toString(16).padStart(2, '0')).join('');
  }, { u: uuid, id: orig.id })).toBe(sha);
  expect(orig.crop?.decision).toBe('manual');
  expect(maxErr(orig.manual_quad!, chosen)).toBeLessThan(0.5); // las esquinas aprobadas, tal cual
  expect(proc0).toMatchObject({ derived_from: orig.id, file_name: expect.stringMatching(/_01_card_front_scan\.jpg$/) });
  expect(orig.processed_id).toBe(proc0.id);

  // 5) OCR sobre el documento recortado; versión final a resolución completa con LAS MISMAS esquinas
  await expect.poll(() => page.evaluate(async () => (await (window as unknown as W).__cx.app.repo.list())[0].ocr_status), { timeout: 240_000 }).toMatch(/EXTRAIDO|REQUIERE_REVISION/);
  const done = await evs();
  const procs = done.filter((e) => e.role === 'processed' && !e.superseded_by);
  expect(procs).toHaveLength(1);
  expect(procs[0].id).toBe(proc0.id); // sustituido in situ: mismo documento, mismo nombre
  expect(procs[0].preliminary).toBe(false);
  const final = await measure(page, { evidenceId: procs[0].id, uuid });
  expectCardOnly(final, 'documento final');
  expect(Math.max(final.width, final.height)).toBeGreaterThan(Math.max(preview.width, preview.height)); // resolución completa
  const ocr = await page.evaluate((u) => (window as unknown as W).__cx.app.repo.ocrResults(u), uuid);
  expect(ocr.find((r) => r.side === 'front')?.read_from).toBe(procs[0].id);
  fs.writeFileSync('docs/scanner/evidencia/05-documento-final.jpg', Buffer.from(await page.evaluate(async ({ u, id }) => {
    const b = (await (window as unknown as W).__cx.app.repo.evidences(u)).find((e) => e.id === id)!.blob;
    const a = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s);
  }, { u: uuid, id: procs[0].id }), 'base64'));

  // 6) sincronización (Google SIMULADO): carpeta del proveedor = documento recortado; original solo en el respaldo
  await page.evaluate(() => (window as unknown as W).__cx.app.syncNow(true));
  const remote = await page.evaluate(() => {
    const w = window as unknown as W;
    return { main: [...w.__cx.drive.files.values()].map((f) => f.name), archive: [...(w.__cx.archive?.files.values() ?? [])].map((f) => f.name) };
  });
  expect(remote.main.filter((n) => /card_front/.test(n))).toEqual([expect.stringMatching(/_01_card_front_scan\.jpg$/)]);
  expect(remote.archive.filter((n) => /card_front/.test(n))).toEqual([expect.stringMatching(/_01_card_front\.jpg$/)]);
  fs.writeFileSync('docs/scanner/evidencia/medidas.json', JSON.stringify({ objetivo: { proporcion: +(CARD.w / CARD.h).toFixed(4) }, vista_previa: preview, documento_final: final }, null, 2));

  // 7) volver a editar la captura GUARDADA: original con las esquinas aprobadas
  await page.locator('#btn-list').click();
  await page.locator('.supplier').first().click();
  await page.locator('[data-evidence="card_front"]').click();
  await expect(page.locator('#scan-state')).toContainText('Recortado con sus esquinas');
  await page.locator('#btn-adjust').click();
  await expect(page.locator('#corner-editor .ce-svg')).toBeVisible();
  expect(maxErr(await handles(page), chosen)).toBeLessThan(0.5);
});

test('un fallo al generar el recorte NUNCA se presenta como éxito: error real, esquinas conservadas y reintento', async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.locator('#btn-register').click();
  await crashableScanner(page);
  await pick(page, await phonePhoto(page));
  await expectL(page.locator('.cam-sheet .chip').first()).not.toContainText('Analizando');

  await page.locator('#btn-crop-adjust').click();
  await expect(page.locator('#corner-editor .ce-svg')).toBeVisible();
  const T = targets();
  await dragCorners(page, T);
  const chosen = await handles(page);
  await page.evaluate(() => { (window as unknown as { __scanCrash: boolean }).__scanCrash = true; }); // el escáner «se cae»
  await page.locator('#ce-save').click();
  // el editor sigue abierto, con el error y las mismas esquinas: nada se declara aplicado
  await expectL(page.locator('#ce-error')).toContainText('No se pudo generar el recorte');
  await expect(page.locator('#corner-editor')).toBeVisible();
  expect(maxErr(await handles(page), chosen)).toBeLessThan(0.5);
  await page.locator('#ce-cancel').click();
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('No se pudo generar el recorte');
  await expect(page.locator('#cam-still')).toHaveAttribute('data-view', 'original');
  await expect(page.locator('#btn-crop-retry')).toBeVisible();
  // guardar no es posible: el recorte decidido no existe
  await page.locator('#btn-save-done').click();
  await expect(page.locator('#crop-pending')).toContainText('recorte sin generar');
  await page.waitForTimeout(600);
  expect(await page.evaluate(async () => (await (window as unknown as W).__cx.app.repo.list()).length)).toBe(0);

  // reintento con el escáner recuperado → recorte real
  await page.evaluate(() => { (window as unknown as { __scanCrash: boolean }).__scanCrash = false; });
  await page.locator('#btn-crop-retry').click();
  await expectL(page.locator('.cam-sheet .chip').first()).toContainText('Recorte manual aplicado');
  expectCardOnly(await measure(page, { selector: '#cam-still' }), 'tras reintentar');
  await page.locator('#btn-crop-adjust').click();
  await expect(page.locator('#corner-editor .ce-svg')).toBeVisible();
  expect(maxErr(await handles(page), chosen)).toBeLessThan(0.5); // mismas esquinas tras el fallo
});
