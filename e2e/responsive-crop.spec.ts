// Distribución real en teléfonos Android: revisión del recorte y editor de esquinas con anchos de 360/393/412 px,
// alturas con y sin barras dinámicas de Chrome, texto aumentado (130 %) y navegación por gestos (margen inferior
// emulado cuando el navegador lo permite). Se miden RECTÁNGULOS reales y qué elemento recibe el toque en su centro.
import { test, expect, type Page, type CDPSession } from '@playwright/test';
import { fictionalCardJpeg } from './support/seed';

const WIDTHS = [360, 393, 412];
const HEIGHTS = [640, 780, 915]; // 640 ≈ barras de Chrome visibles en un teléfono pequeño
const SCALES = [1, 1.3];

async function login(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continuar como Eder' }).click();
  await expect(page.locator('#btn-register')).toBeVisible();
}
/** El botón cabe entero en la pantalla, mide ≥ 44 px y es él quien recibe el toque en su centro. */
async function reachable(page: Page, sel: string, where: string, scroll = true) {
  const el = page.locator(sel);
  if (scroll) await el.scrollIntoViewIfNeeded();
  const r = await el.evaluate((e) => {
    const b = e.getBoundingClientRect(); const vw = window.innerWidth, vh = window.innerHeight;
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
    return { rect: [b.left, b.top, b.right, b.bottom].map(Math.round), vw, inside: b.left >= -0.5 && b.top >= -0.5 && b.right <= vw + 0.5 && b.bottom <= vh + 0.5, hit: !!hit && (hit === e || e.contains(hit)), h: Math.round(b.height), w: Math.round(b.width), bottom: Math.round(b.bottom), vh };
  });
  expect({ inside: r.inside, hit: r.hit }, `${sel} — ${where} ${JSON.stringify(r)}`).toEqual({ inside: true, hit: true });
  expect(r.h, `${sel} alto táctil — ${where}`).toBeGreaterThanOrEqual(44);
  return r;
}
async function setScale(page: Page, s: number) { await page.evaluate((k) => { document.documentElement.style.fontSize = `${k * 100}%`; }, s); }
/** Margen de navegación por gestos (env(safe-area-inset-bottom)); devuelve false si este Chromium no lo emula. */
async function gestureInset(cdp: CDPSession, px: number): Promise<boolean> {
  try { await cdp.send('Emulation.setSafeAreaInsetsOverride' as never, { insets: { top: 0, bottom: px, left: 0, right: 0 } } as never); return true; } catch { return false; }
}

for (const width of WIDTHS) {
  test(`ancho ${width} px: revisión del recorte y editor de esquinas completos y pulsables`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width, height: 780 });
    await login(page);
    await page.locator('#btn-register').click();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#btn-gallery').click();
    await (await chooser).setFiles(await fictionalCardJpeg(page));
    await expect(page.locator('.cam-sheet .chip').first()).not.toContainText('Analizando', { timeout: 60_000 });
    const cdp = await page.context().newCDPSession(page);
    let insetOk = false;
    for (const height of HEIGHTS) for (const scale of SCALES) {
      const where = `${width}×${height}, texto ${Math.round(scale * 100)} %`;
      await page.setViewportSize({ width, height });
      await setScale(page, scale);
      insetOk = await gestureInset(cdp, height === 640 ? 34 : 0) || insetOk;
      // revisión: el documento sigue visible y las acciones son alcanzables y legibles
      const vp = await page.locator('.camera .viewport').boundingBox();
      expect(vp!.height / height, `documento visible — ${where}`).toBeGreaterThan(0.3);
      await page.locator('.cam-sheet').evaluate((e) => { e.scrollTop = 0; });
      for (const sel of ['#btn-crop-auto', '#btn-crop-adjust', '#btn-crop-full', '#btn-save-next', '#btn-back-yes', '#btn-retake', '#btn-save-done']) await reachable(page, sel, where);
      const fonts = await page.locator('#crop-review .btn').evaluateAll((bs) => bs.map((b) => parseFloat(getComputedStyle(b).fontSize)));
      expect(Math.min(...fonts), `texto de las acciones legible — ${where}`).toBeGreaterThanOrEqual(13);
      if (scale === 1 && height === 780) await page.screenshot({ path: `docs/scanner/evidencia/responsive-${width}-revision.jpg`, type: 'jpeg', quality: 75 });

      // editor: sin desplazamiento, todo dentro de la pantalla; la foto conserva un área grande
      await page.locator('.cam-sheet').evaluate((e) => { e.scrollTop = 0; });
      await page.locator('#btn-crop-adjust').click();
      await expect(page.locator('#corner-editor .ce-svg')).toBeVisible();
      await page.waitForTimeout(150); // ajuste del marco al espacio visible
      for (const sel of ['#ce-save', '#ce-cancel', '#ce-full']) await reachable(page, sel, `editor ${where}`, false);
      const frame = await page.locator('#corner-editor .ce-frame').boundingBox();
      const stage = await page.locator('#corner-editor .ce-stage').boundingBox();
      // la foto ocupa todo el ancho o todo el alto disponible (lo que limite) y el área de trabajo es grande
      expect(Math.max(frame!.width / stage!.width, frame!.height / stage!.height), `foto ajustada al área — ${where}`).toBeGreaterThan(0.95);
      expect(stage!.height / height, `área de la foto en el editor — ${where}`).toBeGreaterThan(0.45);
      const hs = await page.locator('#corner-editor .ce-handle').evaluateAll((cs) => cs.map((c) => { const b = c.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, d: b.width }; }));
      for (const hb of hs) {
        expect(hb.l >= 0 && hb.t >= 0 && hb.r <= width && hb.b <= height, `esquina dentro de la pantalla — ${where}`).toBe(true);
        expect(hb.d, `esquina visible (≥ 26 px) — ${where}`).toBeGreaterThanOrEqual(26);
      }
      if (scale === 1 && height === 780) await page.screenshot({ path: `docs/scanner/evidencia/responsive-${width}-editor.jpg`, type: 'jpeg', quality: 75 });
      if (height === 640 && scale === 1.3) await page.screenshot({ path: `docs/scanner/evidencia/responsive-${width}-editor-640-texto130.jpg`, type: 'jpeg', quality: 75 });
      await page.locator('#ce-cancel').click();
      await expect(page.locator('#corner-editor')).toHaveCount(0);
    }
    test.info().annotations.push({ type: 'navegación por gestos', description: insetOk ? 'margen inferior de 34 px emulado (Emulation.setSafeAreaInsetsOverride)' : 'no emulable en este Chromium: cubierto por el pie con max(safe-area, 12 px)' });
  });
}
