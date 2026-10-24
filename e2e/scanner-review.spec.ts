// Revisión del recorte en la captura (escáner real en el navegador, datos FICTICIOS):
// capturar → vista previa real del recorte → DECISIÓN EXPLÍCITA por cara (usar / ajustar con lupa / foto completa) → guardar.
// Ver un recorte no es aprobarlo: sin decisión no se guarda, ni con confianza alta ni con baja, ni durante el análisis.
import { test, expect as baseExpect, type Page } from '@playwright/test';
import { fictionalCardJpeg } from './support/seed';

const expect = baseExpect.configure({ timeout: 60_000 });
type Ev = { id: string; kind: string; role?: string; crop?: { decision: string; detector?: { status: string } }; scan?: { manual_quad?: { x: number; y: number }[]; status: string }; size: number; blob: Blob };
type W = { __cx: { app: { repo: { list(): Promise<{ uuid: string; ocr_status: string }[]>; evidences(u: string): Promise<Ev[]>; getMeta(k: string): Promise<unknown> } } } };

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
/** Foto sin tarjeta (pared lisa con degradado): no hay bordes que detectar. */
async function blankJpeg(page: Page) {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1200; c.height = 1600; const g = c.getContext('2d')!;
    const grd = g.createLinearGradient(0, 0, 1200, 1600); grd.addColorStop(0, '#d8d4cc'); grd.addColorStop(1, '#bdb8ae'); g.fillStyle = grd; g.fillRect(0, 0, 1200, 1600);
    const blob: Blob = await new Promise((r) => c.toBlob((x) => r(x!), 'image/jpeg', 0.9));
    const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s);
  });
  return { name: 'pared.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}
/** Tarjeta ficticia que se sale por el borde derecho de la foto: el detector propone un recorte DUDOSO. */
async function cardOnEdgeJpeg(page: Page) {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 1100; const g = c.getContext('2d')!;
    g.fillStyle = '#4a5260'; g.fillRect(0, 0, 1600, 1100); g.save(); g.translate(1150, 550); g.rotate(-0.07);
    g.fillStyle = '#fffdf7'; g.fillRect(-560, -330, 1120, 660); g.fillStyle = '#111'; g.font = 'bold 54px sans-serif'; g.fillText('Nimbus Demo Valves Co.', -490, -200);
    g.font = '38px sans-serif'; g.fillText('Tel: +86 555 0100 777', -490, 0); g.fillText('Web: www.nimbus.example', -490, 140); g.restore();
    const blob: Blob = await new Promise((r) => c.toBlob((x) => r(x!), 'image/jpeg', 0.9));
    const u = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s);
  });
  return { name: 'tarjeta-en-el-borde.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}
/**
 * Escáner de la vista previa lento (`delayMs`) o colgado (`delayMs` = -1): retrasa o descarta los mensajes al worker
 * «cx-scanner». Solo para pruebas; se desactiva con `window.__scanDelay = 0`.
 */
async function slowScanner(page: Page, delayMs: number) {
  await page.evaluate((d) => {
    const w = window as unknown as { __scanDelay: number; Worker: typeof Worker };
    w.__scanDelay = d;
    const Base = window.Worker;
    w.Worker = class extends Base {
      private scan: boolean;
      constructor(u: string | URL, o?: WorkerOptions) { super(u, o); this.scan = o?.name === 'cx-scanner'; }
      postMessage(m: unknown, t?: Transferable[] | StructuredSerializeOptions) {
        const delay = this.scan ? w.__scanDelay : 0;
        if (delay < 0) return; // escáner colgado: nunca responde
        if (delay) setTimeout(() => super.postMessage(m, t as Transferable[]), delay); else super.postMessage(m, t as Transferable[]);
      }
    } as typeof Worker;
  }, delayMs);
}
const captureCount = (page: Page) => page.evaluate(async () => (await (window as unknown as W).__cx.app.repo.list()).length);
const draftKinds = (page: Page) => page.evaluate(async () => (((await (window as unknown as W).__cx.app.repo.getMeta('draft:EDR')) as { evidences: { kind: string; crop?: { decision?: string } }[] } | null)?.evidences ?? []).map((e) => `${e.kind}:${e.crop?.decision ?? 'pendiente'}`));
/** Pulsa guardar y comprueba que NO se guardó nada (la decisión sigue pendiente). */
async function saveIsRefused(page: Page, id = '#btn-save-done') {
  await page.locator(id).click();
  await expect(page.locator('#crop-pending')).toBeVisible();
  await expect(page.locator('#crop-review')).toHaveClass(/pending/);
  await page.waitForTimeout(800);
  expect(await captureCount(page)).toBe(0);
  await expect(page.locator('#btn-save-done')).toBeVisible(); // sigue en la cámara, con el borrador
}

const latestEvidences = async (page: Page) => {
  await expect.poll(() => page.evaluate(async () => (await (window as unknown as W).__cx.app.repo.list()).length)).toBe(1);
  return page.evaluate(async () => { const w = window as unknown as W; const [c] = await w.__cx.app.repo.list(); return (await w.__cx.app.repo.evidences(c.uuid)).map((e) => ({ kind: e.kind, role: e.role, crop: e.crop, manual: e.scan?.manual_quad, status: e.scan?.status })); });
};

test('confianza ALTA: ver el recorte no es aprobarlo; guardar sin decidir no guarda; una pulsación lo acepta', async ({ page }) => {
  await login(page);
  await page.locator('#btn-register').click();
  await pick(page, await fictionalCardJpeg(page));
  // protegida en el borrador ANTES de cualquier decisión
  const draftSize = await page.evaluate(async () => ((await (window as unknown as W).__cx.app.repo.getMeta('draft:EDR')) as { evidences: { blob: Blob }[] }).evidences[0].blob.size);
  expect(draftSize).toBeGreaterThan(10_000);
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('Recorte propuesto — decida');
  await expect(page.locator('#cam-still')).toHaveAttribute('data-view', 'crop'); // se ve el documento recortado
  for (const id of ['#btn-crop-auto', '#btn-crop-adjust', '#btn-crop-full']) await expect(page.locator(id)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('#btn-save-done')).toHaveAttribute('data-blocked', 'crop');
  await saveIsRefused(page);
  await saveIsRefused(page, '#btn-save-next');
  expect(await draftKinds(page)).toEqual(['card_front:pendiente']);
  // una sola pulsación acepta el recorte visible
  await page.locator('#btn-crop-auto').click();
  await expect(page.locator('#btn-crop-auto')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('Recorte automático aceptado');
  await expect(page.locator('#crop-pending')).toHaveCount(0);
  await page.screenshot({ path: 'docs/scanner/screenshots/revision-recorte-automatico.jpg', type: 'jpeg', quality: 78 });
  await page.locator('#btn-save-done').click();
  const evs = await latestEvidences(page);
  const front = evs.find((e) => e.kind === 'card_front' && e.role !== 'processed')!;
  expect(front.crop).toMatchObject({ decision: 'auto', detector: { status: 'ok' } });
  expect(front.manual).toHaveLength(4); // se procesa exactamente el recorte aceptado
});

test('confianza BAJA: bordes dudosos no se aceptan en silencio; la foto completa queda elegida por el operador', async ({ page }) => {
  await login(page);
  await page.locator('#btn-register').click();
  await pick(page, await cardOnEdgeJpeg(page));
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('Bordes dudosos — decida');
  await expect(page.locator('#cam-still')).toHaveAttribute('data-view', 'original'); // la propuesta se dibuja sobre la foto
  await expect(page.locator('#btn-crop-auto')).toBeEnabled();
  await saveIsRefused(page);
  await page.locator('#btn-crop-full').click();
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('Foto completa');
  await page.locator('#btn-save-done').click();
  const front = (await latestEvidences(page)).find((e) => e.kind === 'card_front' && e.role !== 'processed')!;
  expect(front.crop).toMatchObject({ decision: 'full', detector: { status: 'low_confidence' } });
});

test('el guardado no se adelanta al análisis; la foto completa está disponible al instante', async ({ page }) => {
  await login(page);
  await page.locator('#btn-register').click();
  await slowScanner(page, 6000);
  await pick(page, await fictionalCardJpeg(page));
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('Analizando bordes');
  expect(await draftKinds(page)).toEqual(['card_front:pendiente']); // original ya protegido en IndexedDB
  await expect(page.locator('#btn-crop-auto')).toBeDisabled(); // no hay propuesta todavía
  await expect(page.locator('#btn-crop-full')).toBeEnabled(); // no se bloquea al operador
  await expect(page.locator('#btn-crop-adjust')).toBeEnabled();
  await saveIsRefused(page);
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('Analizando bordes'); // se probó DURANTE el análisis
  // al terminar el análisis tampoco se acepta nada por sí solo
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('Recorte propuesto', { timeout: 60_000 });
  await page.waitForTimeout(500);
  expect(await captureCount(page)).toBe(0);
  expect(await draftKinds(page)).toEqual(['card_front:pendiente']);
  // decidir durante otro análisis lento: la decisión no la pisa el resultado posterior
  await page.locator('#btn-crop-full').click();
  await expect(page.locator('#btn-crop-full')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => { (window as unknown as { __scanDelay: number }).__scanDelay = 0; });
  await page.locator('#btn-save-done').click();
  const front = (await latestEvidences(page)).find((e) => e.kind === 'card_front' && e.role !== 'processed')!;
  expect(front.crop?.decision).toBe('full');
  expect(Math.min(...front.manual!.map((p) => p.x))).toBe(0);
});

test('escáner colgado: no bloquea; se ofrece conservar la foto completa', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page);
  await page.locator('#btn-register').click();
  await slowScanner(page, -1);
  await pick(page, await fictionalCardJpeg(page));
  await expect(page.locator('#btn-crop-full')).toBeEnabled();
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('El escáner no respondió', { timeout: 40_000 });
  await saveIsRefused(page);
  await page.locator('#btn-crop-full').click();
  await page.evaluate(() => { (window as unknown as { __scanDelay: number }).__scanDelay = 0; });
  await page.locator('#btn-save-done').click();
  const front = (await latestEvidences(page)).find((e) => e.kind === 'card_front' && e.role !== 'processed')!;
  expect(front.crop?.decision).toBe('full');
  expect(front.manual).toHaveLength(4); // tamaño leído de la propia foto, sin escáner
});

test('anverso y reverso se deciden por separado: falta uno → no se guarda y se muestra ese', async ({ page }) => {
  await login(page);
  await page.locator('#btn-register').click();
  await pick(page, await fictionalCardJpeg(page, 'Anverso Demo Co.'));
  await page.locator('#btn-back-yes').click();
  await pick(page, await fictionalCardJpeg(page, 'Reverso Demo Co.'));
  await expect(page.locator('#btn-crop-auto')).toBeEnabled({ timeout: 60_000 });
  await page.locator('#btn-crop-auto').click(); // decide solo el reverso
  await expect(page.locator('#crop-pending')).toContainText('anverso');
  await expect(page.locator('#crop-pending')).not.toContainText('reverso');
  await saveIsRefused(page, '#btn-save-next');
  await expect(page.locator('.mini-strip .evidence').first()).toHaveAttribute('aria-pressed', 'true'); // lleva al anverso
  await expect(page.locator('.mini-strip .evidence').first()).toHaveAttribute('data-crop', 'pending');
  await page.locator('#btn-crop-adjust').click();
  await page.locator('#ce-save').click();
  await expect(page.locator('#crop-pending')).toHaveCount(0);
  await page.locator('#btn-save-done').click();
  const evs = (await latestEvidences(page)).filter((e) => e.role !== 'processed');
  expect(evs.find((e) => e.kind === 'card_front')?.crop?.decision).toBe('manual');
  expect(evs.find((e) => e.kind === 'card_back')?.crop?.decision).toBe('auto');
});

test('conservar la foto completa: no se recorta y queda registrado como decisión del operador', async ({ page }) => {
  await login(page);
  await page.locator('#btn-register').click();
  await pick(page, await fictionalCardJpeg(page));
  await expect(page.locator('#btn-crop-full')).toBeEnabled();
  await page.locator('#btn-crop-full').click();
  await expect(page.locator('#btn-crop-full')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#cam-still')).toHaveAttribute('data-view', 'original');
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('Foto completa');
  await page.locator('#btn-save-done').click();
  const front = (await latestEvidences(page)).find((e) => e.kind === 'card_front' && e.role !== 'processed')!;
  expect(front.crop?.decision).toBe('full');
  const q = front.manual!; // esquinas = la foto entera
  expect(Math.min(...q.map((p) => p.x))).toBe(0); expect(Math.min(...q.map((p) => p.y))).toBe(0);
});

test('ajustar manualmente con lupa: se procesan las esquinas elegidas', async ({ page }) => {
  await login(page);
  await page.locator('#btn-register').click();
  await pick(page, await fictionalCardJpeg(page));
  await expect(page.locator('#btn-crop-adjust')).toBeEnabled();
  await page.locator('#btn-crop-adjust').click();
  await expect(page.locator('#corner-editor')).toBeVisible();
  const h = page.locator('.ce-handle').first(); const b = (await h.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + 20, b.y + 16, { steps: 4 });
  await expect(page.locator('.ce-loupe')).toBeVisible(); // lupa durante el arrastre
  await page.screenshot({ path: 'docs/scanner/screenshots/ajuste-esquinas-lupa.jpg', type: 'jpeg', quality: 78 });
  await page.mouse.up();
  await expect(page.locator('.ce-loupe')).toBeHidden();
  await page.locator('#ce-save').click();
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('Esquinas ajustadas por usted');
  await expect(page.locator('#cam-still')).toHaveAttribute('data-view', 'crop');
  await page.locator('#btn-save-done').click();
  const front = (await latestEvidences(page)).find((e) => e.kind === 'card_front' && e.role !== 'processed')!;
  expect(front.crop?.decision).toBe('manual');
  expect(front.manual).toHaveLength(4);
});

test('sin bordes detectables: no inventa esquinas; el operador conserva la foto completa', async ({ page }) => {
  await login(page);
  await page.locator('#btn-register').click();
  await pick(page, await blankJpeg(page));
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('No se encontraron los bordes');
  await expect(page.locator('#btn-crop-auto')).toBeDisabled();
  await expect(page.locator('#cam-still')).toHaveAttribute('data-view', 'original');
  await saveIsRefused(page);
  await page.locator('#btn-crop-full').click();
  await page.locator('#btn-save-done').click();
  const front = (await latestEvidences(page)).find((e) => e.kind === 'card_front' && e.role !== 'processed')!;
  expect(front.crop?.decision).toBe('full');
});

test('repetir una foto no pierde el resto del borrador', async ({ page }) => {
  await login(page);
  await page.locator('#btn-register').click();
  await pick(page, await fictionalCardJpeg(page, 'Anverso Demo Co.'));
  await page.locator('#btn-back-yes').click();
  await pick(page, await fictionalCardJpeg(page, 'Reverso Demo Co.'));
  await expect(page.locator('.mini-strip .evidence')).toHaveCount(2);
  await page.locator('.mini-strip .evidence').first().click(); // revisar el anverso
  await page.locator('#btn-retake').click();
  await expect(page.locator('#btn-gallery')).toBeVisible();
  const kinds = await page.evaluate(async () => ((await (window as unknown as W).__cx.app.repo.getMeta('draft:EDR')) as { evidences: { kind: string }[] }).evidences.map((e) => e.kind));
  expect(kinds).toEqual(['card_back']); // el reverso sigue protegido
  await pick(page, await fictionalCardJpeg(page, 'Anverso Demo Co.'));
  await expect(page.locator('.mini-strip .evidence')).toHaveCount(2);
});
