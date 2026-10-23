// Cámara en vivo con el dispositivo simulado de Chromium (patrón de prueba, sin imágenes reales).
import { test, expect, type Page } from '@playwright/test';

type W = { __cx: { app: { repo: { list(): Promise<{ uuid: string }[]>; evidences(u: string): Promise<{ kind: string; role?: string }[]> } } } };
const captures = (page: Page) => page.evaluate(() => (window as unknown as W).__cx.app.repo.list());
const DEVICES = { 'android-grande': { width: 412, height: 915 } } as const;
async function login(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continuar como Eder' }).click();
  await expect(page.locator('#btn-register')).toBeVisible();
}
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
  const t0 = Date.now();
  await page.locator('#btn-save-next').click();
  await expect(page.locator('#btn-shutter')).toBeEnabled();
  expect(Date.now() - t0).toBeLessThan(3000);
  await page.locator('#btn-shutter').click();
  await page.locator('#btn-save-next').click();
  await expect(page.locator('#saved-toast')).toContainText('Captura protegida en este dispositivo');
  await expect.poll(async () => (await captures(page)).length).toBe(2);
  const list = await captures(page);
  const kinds = await page.evaluate((u) => (window as unknown as W).__cx.app.repo.evidences(u), list[1].uuid);
  expect(kinds.filter((e) => e.role !== 'processed').map((e) => e.kind)).toEqual(['card_front', 'card_back']);
});
