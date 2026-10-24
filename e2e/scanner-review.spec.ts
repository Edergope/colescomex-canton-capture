// Revisión del recorte en la captura (escáner real en el navegador, datos FICTICIOS):
// capturar → vista previa real del recorte → usar / ajustar con lupa / conservar foto completa → guardar.
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
const latestEvidences = async (page: Page) => {
  await expect.poll(() => page.evaluate(async () => (await (window as unknown as W).__cx.app.repo.list()).length)).toBe(1);
  return page.evaluate(async () => { const w = window as unknown as W; const [c] = await w.__cx.app.repo.list(); return (await w.__cx.app.repo.evidences(c.uuid)).map((e) => ({ kind: e.kind, role: e.role, crop: e.crop, manual: e.scan?.manual_quad, status: e.scan?.status })); });
};

test('la foto se protege al instante y se muestra el recorte REAL antes de aprobarlo', async ({ page }) => {
  await login(page);
  await page.locator('#btn-register').click();
  await pick(page, await fictionalCardJpeg(page));
  // protegida en el borrador ANTES de cualquier decisión
  const draftSize = await page.evaluate(async () => ((await (window as unknown as W).__cx.app.repo.getMeta('draft:EDR')) as { evidences: { blob: Blob }[] }).evidences[0].blob.size);
  expect(draftSize).toBeGreaterThan(10_000);
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('Recorte automático — revíselo');
  await expect(page.locator('#cam-still')).toHaveAttribute('data-view', 'crop'); // se ve el documento recortado, no una promesa
  await expect(page.locator('#btn-crop-auto')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'docs/scanner/screenshots/revision-recorte-automatico.jpg', type: 'jpeg', quality: 78 });
  await page.locator('#btn-save-done').click();
  const evs = await latestEvidences(page);
  const front = evs.find((e) => e.kind === 'card_front' && e.role !== 'processed')!;
  expect(front.crop).toMatchObject({ decision: 'auto', detector: { status: 'ok' } });
  expect(front.manual).toHaveLength(4); // se procesa exactamente el recorte que se vio
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

test('sin bordes detectables: no inventa esquinas; conserva la foto completa por defecto', async ({ page }) => {
  await login(page);
  await page.locator('#btn-register').click();
  await pick(page, await blankJpeg(page));
  await expect(page.locator('.cam-sheet .chip').first()).toContainText('No se encontraron los bordes');
  await expect(page.locator('#btn-crop-auto')).toBeDisabled();
  await expect(page.locator('#cam-still')).toHaveAttribute('data-view', 'original');
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
