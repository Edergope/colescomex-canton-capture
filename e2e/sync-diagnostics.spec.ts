// Sincronización visible para el operador (incidente HCT): resumen local/completas/pendientes/errores, causa por
// captura, «Copiar diagnóstico técnico» sin datos comerciales y REINTENTO AUTOMÁTICO al volver la conexión, sin pulsar
// «Sincronizar». Google SIMULADO (red con fallos inyectados): nunca se escribe en Google real.
import { test, expect, type Page } from '@playwright/test';
import { fictionalCardJpeg } from './support/seed';
import { resolveCrops } from './support/crop';

type W = { __cx: { drive: { net: { failNext: number }; files: Map<string, { name: string; appProperties: Record<string, string> }> }; sheets: { asObjects(): Record<string, string>[] };
  app: { repo: { list(): Promise<{ uuid: string; external_ref: string; sync_status: string; ocr_status: string }[]> } } } };
const cx = (page: Page) => page.evaluate(async () => (await (window as unknown as W).__cx.app.repo.list()).map((c) => ({ uuid: c.uuid, ref: c.external_ref, status: c.sync_status, ocr: c.ocr_status })));

test('Sincronización: resumen y causa por captura, diagnóstico sin datos comerciales y reintento automático al volver la red', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Continuar como Eder' }).click();
  await page.locator('#btn-register').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#btn-gallery').click();
  await (await chooser).setFiles(await fictionalCardJpeg(page, 'Nimbus Demo Valves Co.'));
  await resolveCrops(page, 'full');
  // Google deja de responder (red caída de forma persistente) antes de guardar
  await page.evaluate(() => { (window as unknown as W).__cx.drive.net.failNext = 999; });
  await page.locator('#btn-save-done').click();
  // estable: la lectura terminó (cambia los datos → nuevo intento) y el último intento también falló
  await expect.poll(async () => { const [c] = await cx(page); return c && /EXTRAIDO|REQUIERE_REVISION/.test(c.ocr) ? c.status : 'leyendo'; }, { timeout: 120_000 }).toBe('ERROR');
  const [{ ref, uuid }] = await cx(page);

  await page.locator('#btn-sync').click();
  const count = (k: string) => page.locator(`#sync-summary [data-count="${k}"]`);
  await expect(count('local')).toHaveText('1');
  await expect(count('complete')).toHaveText('0'); // nunca «completa» sin archivos y fila
  await expect(count('pending')).toHaveText('1');
  await expect(count('errors')).toHaveText('1');
  await expect(page.locator(`#sync-causes [data-ref="${ref}"]`)).toContainText('No fue posible subir este archivo');
  await page.locator('#sync-detail summary').click();
  await expect(page.locator(`#sync-detail [data-ref="${ref}"]`)).toContainText('Error de red (simulado)'); // error REAL, no genérico

  // diagnóstico técnico: referencias, estados y errores reales; sin datos comerciales
  await page.locator('#btn-copy-sync-diag').click();
  await expect(page.locator('#sync-diag-text')).toBeVisible();
  const text = await page.locator('#sync-diag-text').innerText();
  expect(text).not.toContain('Nimbus');
  expect(text).not.toContain('"device_id"'); // sin id interno del dispositivo
  expect(text).not.toMatch(/folder_id/);
  const diag = JSON.parse(text) as { app: { version: string }; captures: { external_ref: string; capture_uuid: string; sync_status: string; sync_attempts: number; sync_error: string; row: string; originals: number; main: { expected: number; uploaded: number } }[] };
  expect(diag.app.version).toBe('1.2.3');
  expect(diag.captures).toHaveLength(1);
  expect(diag.captures[0]).toMatchObject({ external_ref: ref, capture_uuid: uuid, sync_status: 'ERROR', row: 'SIN_FILA', originals: 1, main: { uploaded: 0 } });
  expect(diag.captures[0].sync_attempts).toBeGreaterThanOrEqual(1);
  expect(diag.captures[0].sync_error).toContain('Error de red (simulado)');

  // vuelve la red: la app reintenta SOLA (evento «online»), sin pulsar «Sincronizar»
  await page.evaluate(() => { (window as unknown as W).__cx.drive.net.failNext = 0; window.dispatchEvent(new Event('online')); });
  await expect.poll(async () => (await cx(page))[0].status, { timeout: 60_000 }).toBe('CONFIRMADO');
  const remote = await page.evaluate((u) => {
    const w = window as unknown as W;
    return { files: [...w.__cx.drive.files.values()].filter((f) => f.appProperties.capture_uuid === u).length, rows: w.__cx.sheets.asObjects().filter((r) => r.capture_uuid === u).length };
  }, uuid);
  expect(remote.files).toBeGreaterThanOrEqual(1);
  expect(remote.rows).toBe(1); // una sola fila por capture_uuid
});
