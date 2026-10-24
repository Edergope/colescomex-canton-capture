// Cámara en vivo con el dispositivo simulado de Chromium (patrón de prueba, sin imágenes reales).
import { test, expect, type Page } from '@playwright/test';
import { resolveCrops } from './support/crop';

type W = { __cx: { app: { repo: { list(): Promise<{ uuid: string }[]>; evidences(u: string): Promise<{ kind: string; role?: string }[]> } } } };
const captures = (page: Page) => page.evaluate(() => (window as unknown as W).__cx.app.repo.list());
const DEVICES = { 'android-grande': { width: 412, height: 915 } } as const;
async function login(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continuar como Eder' }).click();
  await expect(page.locator('#btn-register')).toBeVisible();
}
/**
 * Estado REAL del visor: el <video> debe estar en el documento, visible, con el MediaStream activo, sin pausa,
 * con datos (readyState ≥ 2), con dimensiones, y entregando fotogramas NUEVOS (avance de currentTime, callbacks de
 * fotograma y píxeles distintos entre dos instantes: el dispositivo simulado de Chromium dibuja un patrón animado).
 */
async function viewer(page: Page) {
  return page.evaluate(async () => {
    const v = document.querySelector('.camera .viewport video') as HTMLVideoElement | null;
    if (!v) return { inDom: false };
    const r = v.getBoundingClientRect(); const cs = getComputedStyle(v);
    const sample = () => {
      const c = document.createElement('canvas'); c.width = 64; c.height = 36;
      const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(v, 0, 0, 64, 36);
      return Array.from(g.getImageData(0, 0, 64, 36).data);
    };
    const t0 = v.currentTime; const px0 = v.videoWidth ? sample() : [];
    let frames = 0;
    await new Promise<void>((res) => {
      const end = performance.now() + 1200;
      const tick = () => { frames++; if (performance.now() < end) v.requestVideoFrameCallback(tick); };
      v.requestVideoFrameCallback(tick); setTimeout(res, 1300);
    });
    const px1 = v.videoWidth ? sample() : [];
    let changed = 0; for (let i = 0; i < px1.length; i++) if (Math.abs(px1[i] - (px0[i] ?? 0)) > 8) changed++;
    return {
      inDom: v.isConnected, visible: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) > 0,
      streamActive: !!(v.srcObject as MediaStream | null)?.active, paused: v.paused, readyState: v.readyState,
      videoWidth: v.videoWidth, videoHeight: v.videoHeight, advanced: +(v.currentTime - t0).toFixed(3), frames, pixelsChanged: changed,
    };
  });
}
/** El visor muestra la cámara en vivo (no basta con que exista un <video>). */
async function expectLive(page: Page, where: string) {
  let last: Awaited<ReturnType<typeof viewer>> | undefined;
  await expect.poll(async () => { const s = (last = await viewer(page)); return s.inDom && s.visible && s.streamActive && !s.paused && (s.readyState ?? 0) >= 2 && (s.frames ?? 0) >= 5 && (s.advanced ?? 0) > 0.3 && (s.pixelsChanged ?? 0) > 0; },
    { message: `visor en vivo: ${where}`, timeout: 10_000 }).toBe(true).catch((e) => { throw new Error(`${where}: ${JSON.stringify(last)}\n${(e as Error).message}`); });
  const s = await viewer(page);
  test.info().annotations.push({ type: `visor: ${where}`, description: JSON.stringify(s) });
  expect(s, where).toMatchObject({ inDom: true, visible: true, streamActive: true, paused: false });
  expect(s.videoWidth, where).toBeGreaterThan(0); expect(s.videoHeight, where).toBeGreaterThan(0);
  return s;
}
const streamId = (page: Page) => page.evaluate(() => ((document.querySelector('.camera video') as HTMLVideoElement | null)?.srcObject as MediaStream | null)?.id ?? null);

async function shot(page: Page, name: string) { await page.screenshot({ path: `docs/ux/screenshots/${name}.jpg`, type: 'jpeg', quality: 78 }); }

test.use({
  viewport: DEVICES['android-grande'],
  permissions: ['camera'],
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
});

test('anverso y reverso con el obturador, y captura consecutiva sin esperar al procesamiento', async ({ page }) => {
  await login(page);
  await page.locator('#btn-register').click();
  await expect.poll(() => page.evaluate(() => (document.querySelector('.camera video') as HTMLVideoElement | null)?.readyState ?? 0), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#btn-guide')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#btn-guide').click(); // la guía es opcional
  await expect(page.locator('#btn-guide')).toHaveAttribute('aria-pressed', 'false');
  await shot(page, 'flujo-camara-en-vivo');

  await page.locator('#btn-shutter').click();
  await expect(page.locator('#cam-still')).toBeVisible();
  await page.locator('#btn-back-yes').click();
  await page.locator('#btn-shutter').click();
  await expect(page.locator('.cam-sheet h2')).toHaveText('Anverso y reverso listos');
  await resolveCrops(page, 'full');
  const t0 = Date.now();
  await page.locator('#btn-save-next').click();
  await expect(page.locator('#btn-shutter')).toBeEnabled();
  expect(Date.now() - t0).toBeLessThan(3000);
  await page.locator('#btn-shutter').click();
  await resolveCrops(page, 'full');
  await page.locator('#btn-save-next').click();
  await expect(page.locator('#saved-toast')).toContainText('Captura protegida en este dispositivo');
  await expect.poll(async () => (await captures(page)).length).toBe(2);
  const list = await captures(page);
  const kinds = await page.evaluate((u) => (window as unknown as W).__cx.app.repo.evidences(u), list[1].uuid);
  expect(kinds.filter((e) => e.role !== 'processed').map((e) => e.kind)).toEqual(['card_front', 'card_back']);
});

test('visor en vivo: anverso → «Fotografiar reverso» → reverso → volver → repetir → guardar y siguiente (misma sesión de cámara)', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __gum: number };
    w.__gum = 0;
    const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c) => { w.__gum++; return orig(c); };
  });
  await login(page);
  await page.locator('#btn-register').click();
  await expectLive(page, 'al abrir la cámara (anverso)');
  const id0 = await streamId(page);
  expect(id0).toBeTruthy();

  await page.locator('#btn-shutter').click();
  await expect(page.locator('#cam-still')).toBeVisible();
  await page.locator('#btn-back-yes').click(); // «Fotografiar reverso»
  await expect(page.locator('#btn-shutter')).toBeEnabled();
  await expectLive(page, 'tras «Fotografiar reverso»');

  await page.locator('#btn-shutter').click();
  await expect(page.locator('.cam-sheet h2')).toHaveText('Anverso y reverso listos');
  await page.locator('#btn-add-stand').click(); // volver a la cámara (extra)
  await expectLive(page, 'al volver a la cámara para un extra');
  await page.locator('#btn-draft').click(); // volver a la hoja sin disparar

  await page.locator('.mini-strip .evidence').nth(1).click(); // reverso
  await page.locator('#btn-retake').click(); // «Repetir foto»
  await expectLive(page, 'tras «Repetir foto»');
  await page.locator('#btn-shutter').click();
  await expect(page.locator('.cam-sheet h2')).toHaveText('Anverso y reverso listos');

  await resolveCrops(page, 'full');
  await page.locator('#btn-save-next').click(); // «Guardar y siguiente proveedor»
  await expect(page.locator('#saved-toast')).toContainText('Captura protegida en este dispositivo');
  await expectLive(page, 'tras «Guardar y siguiente proveedor»');

  // segundo plano: la página se oculta y vuelve (Android al cambiar de app)
  await page.evaluate(() => {
    const set = (h: boolean) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); };
    set(true); (document.querySelector('.camera video') as HTMLVideoElement).pause(); // Android pausa el vídeo en segundo plano
    set(false);
  });
  await expectLive(page, 'al volver de segundo plano');

  // misma sesión MediaStream durante todo el recorrido: sin nuevas solicitudes de permiso
  expect(await streamId(page)).toBe(id0);
  expect(await page.evaluate(() => (window as unknown as { __gum: number }).__gum)).toBe(1);
  await expect.poll(async () => (await captures(page)).length).toBe(1);
});
