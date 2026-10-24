// Pruebas visuales y funcionales de la experiencia móvil (UX/UI v1).
// Solo datos FICTICIOS (e2e/support/seed.ts): las capturas de pantalla pueden publicarse.
import { test, expect as baseExpect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { seed, fictionalCardJpeg, SEED_CYCLE } from './support/seed';

// la configuración global da 120 s para el OCR real; la interfaz debe responder mucho antes
const expect = baseExpect.configure({ timeout: 20_000 });
const SHOTS = 'docs/ux/screenshots';
fs.mkdirSync(SHOTS, { recursive: true });

const DEVICES = {
  'android-pequeno': { width: 360, height: 740 },
  'android-grande': { width: 412, height: 915 },
} as const;

type Cap = { uuid: string; external_ref: string; ocr_status: string; sync_status: string; review_status: string; fields: Record<string, string>; field_meta: Record<string, { source: string; locked?: boolean; status: string }> };
type W = { __cx: { app: { repo: { list(): Promise<Cap[]>; evidences(u: string): Promise<{ id: string; kind: string; role?: string; scan?: { manual_quad?: unknown[] } }[]>; audit(u: string): Promise<{ type: string }[]> } }; sheets: { rows: unknown[]; asObjects(): Record<string, string>[] } } };
const captures = (page: Page) => page.evaluate(() => (window as unknown as W).__cx.app.repo.list());

async function login(page: Page, who = 'Eder') {
  await page.goto('/');
  await page.getByRole('button', { name: `Continuar como ${who}` }).click();
  await expect(page.locator('#btn-register')).toBeVisible();
}
async function go(page: Page, nav: 'home' | 'list' | 'review' | 'settings') {
  await page.locator(`[data-nav="${nav}"]`).click();
  await expect(page.locator(`[data-nav="${nav}"][aria-current="page"]`)).toBeVisible();
}
async function shot(page: Page, name: string) {
  await page.waitForTimeout(250); // miniaturas diferidas
  await page.screenshot({ path: `${SHOTS}/${name}.jpg`, type: 'jpeg', quality: 78, fullPage: false });
}

/** Auditoría de accesibilidad básica (sin dependencias): nombres accesibles, etiquetas, alt, tamaño táctil y desbordes. */
async function audit(page: Page, where: string) {
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const vis = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && !e.closest('.sr-only'); };
    const name = (e: Element) => (e.getAttribute('aria-label') || (e as HTMLElement).innerText || e.getAttribute('title') || '').trim();
    for (const e of document.querySelectorAll('button, a[href], [role="button"]')) {
      if (!vis(e)) continue;
      if (!name(e)) out.push(`sin nombre accesible: ${e.outerHTML.slice(0, 90)}`);
      const r = e.getBoundingClientRect();
      const inline = e.closest('dd, p, .chips, .row.xs') && e.tagName === 'A';
      if (!inline && Math.min(r.width, r.height) < 40) out.push(`objetivo táctil ${Math.round(r.width)}×${Math.round(r.height)}: ${name(e).slice(0, 40)}`);
    }
    for (const e of document.querySelectorAll('input:not([type=hidden]):not([type=file]), textarea, select')) {
      if (!vis(e)) continue;
      const el = e as HTMLInputElement;
      if (!el.labels?.length && !el.getAttribute('aria-label') && !el.closest('label')) out.push(`campo sin etiqueta: ${el.name || el.id}`);
    }
    for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt')) out.push(`imagen sin alt: ${img.src.slice(0, 40)}`);
    const W = document.documentElement.clientWidth;
    for (const e of document.querySelectorAll('body *')) {
      if (!vis(e) || e.closest('.filters, .mini-strip, .ce-overlay, .toast-region, svg')) continue;
      const r = e.getBoundingClientRect();
      if (r.right > W + 1 || r.left < -1) { out.push(`desborde horizontal: <${e.tagName.toLowerCase()} class="${(e as HTMLElement).className}"> ${Math.round(r.left)}–${Math.round(r.right)} > ${W}`); break; }
    }
    return out;
  });
  expect(problems, `${where}\n${problems.join('\n')}`).toEqual([]);
}

// ───────────────────────── Matriz visual: tamaños Android × tema ─────────────────────────
for (const [dev, vp] of Object.entries(DEVICES)) {
  for (const scheme of ['light', 'dark'] as const) {
    test.describe(`${dev} · ${scheme === 'light' ? 'claro' : 'oscuro'}`, () => {
      test.use({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 2 });
      test('pantallas principales: capturas, accesibilidad y sin desbordes', async ({ page }) => {
        const tag = `${dev}-${scheme === 'light' ? 'claro' : 'oscuro'}`;
        await page.goto('/');
        await expect(page.locator('#screen-login')).toBeVisible();
        await expect(page.locator('#screen-login')).not.toContainText(/[\w.]{3,}@/); // el correo nunca aparece completo
        await audit(page, `${tag} acceso`); await shot(page, `${tag}-01-acceso`);
        await page.getByRole('button', { name: 'Continuar como Eder' }).click();
        await seed(page, 8);
        await go(page, 'list'); await go(page, 'home');
        await expect(page.locator('#m-total')).toContainText('8');
        await audit(page, `${tag} inicio`); await shot(page, `${tag}-02-inicio`);

        await go(page, 'list');
        await expect(page.locator('#capture-list .supplier')).toHaveCount(8);
        await audit(page, `${tag} proveedores`); await shot(page, `${tag}-03-proveedores`);

        await page.locator('.supplier', { hasText: 'Empresa pendiente de identificar' }).click();
        await expect(page.locator('#screen-detail')).toBeVisible();
        await audit(page, `${tag} ficha`); await shot(page, `${tag}-04-ficha`);

        await go(page, 'review');
        await page.locator('#review-list .supplier', { hasText: 'Bluepeak' }).click();
        await expect(page.locator('[data-review="main_products"] .evidence-crop')).toBeVisible();
        await audit(page, `${tag} revisión`);
        await page.locator('[data-review="main_products"]').scrollIntoViewIfNeeded();
        await shot(page, `${tag}-05-revision`);

        await go(page, 'home'); await page.locator('#btn-sync').click();
        await expect(page.locator('#sync-stages')).toBeVisible();
        await audit(page, `${tag} sincronización`); await shot(page, `${tag}-06-sincronizacion`);

        await go(page, 'settings');
        await audit(page, `${tag} ajustes`); await shot(page, `${tag}-07-ajustes`);

        await page.locator('#nav-capture').click();
        await expect(page.locator('#btn-gallery')).toBeVisible();
        await audit(page, `${tag} cámara`); await shot(page, `${tag}-08-camara`);
        const chooser = page.waitForEvent('filechooser');
        await page.locator('#btn-gallery').click();
        await (await chooser).setFiles(await fictionalCardJpeg(page));
        await expect(page.locator('#btn-save-next')).toBeVisible();
        await expect(page.locator('#crop-review')).toBeVisible();
        await expect(page.locator('.cam-sheet .chip').first()).toContainText(/Recorte automático|Bordes dudosos|No se encontraron|varias/, { timeout: 60_000 });
        await audit(page, `${tag} vista previa`); await shot(page, `${tag}-09-vista-previa`);
      });
    });
  }
}

// ───────────────────────── Flujos funcionales ─────────────────────────
test.describe('flujos', () => {
  test.use({ viewport: DEVICES['android-pequeno'] });

  test('estados de lectura y de Google visibles por separado; filtros y búsqueda', async ({ page }) => {
    await login(page);
    await seed(page, 8);
    await go(page, 'list');
    const card = (t: string) => page.locator('#capture-list .supplier', { hasText: t });
    await expect(card('Aurora Demo')).toContainText('Confirmado en Google');
    await expect(card('Aurora Demo')).toContainText('Datos extraídos');
    await expect(card('Bluepeak')).toContainText('Revisar 2 datos');
    await expect(card('Bluepeak')).toContainText('Pendiente de sincronización');
    await expect(page.locator('#capture-list .supplier').filter({ hasText: 'Procesando documento' })).toHaveCount(1);
    await expect(card('Ember Mock')).toContainText('Fallo de lectura');
    await expect(card('Harbor Demo')).toContainText('Sin permiso en Google Drive o Sheets');
    await expect(card('Empresa pendiente de identificar')).toHaveCount(1);
    // «Confirmado en Google» solo donde Drive y Sheets confirmaron
    await expect(page.locator('#capture-list .supplier', { hasText: 'Confirmado en Google' })).toHaveCount(1);

    await page.locator('[data-filter="errors"]').click();
    await expect(page.locator('#capture-list .supplier')).toHaveCount(3);
    await page.locator('[data-filter="all"]').click();
    await page.locator('#list-search').fill('bluepeak');
    await expect(page.locator('#capture-list .supplier')).toHaveCount(1);
    await page.locator('#list-search').fill(await page.locator('#capture-list .supplier').first().getAttribute('data-ref') ?? '');
    await expect(page.locator('#capture-list .supplier')).toHaveCount(1);
    await page.locator('#list-search').fill('ana ejemplo');
    await expect(page.locator('#capture-list .supplier').first()).toContainText('Ana Ejemplo');
  });

  test('revisión inteligente: decisión humana explícita, valor bloqueado, nunca aprobación automática', async ({ page }) => {
    await login(page);
    await seed(page, 2, ['review', 'confirmed']);
    await page.locator('#btn-review').click();
    await page.locator('#btn-start-review').click();
    const wx = page.locator('[data-review="wechat"]');
    await expect(wx.locator('[data-original]')).toHaveText('demo_wx_00');
    await expect(wx.locator('[data-suggestion]')).toHaveText('demo_wx_00');
    await expect(wx.locator('.evidence-crop')).toBeVisible(); // región del documento que respalda el dato
    await wx.getByRole('button', { name: 'demo_wx_O0' }).click(); // otra lectura detectada
    await expect(wx.locator('[data-approve]')).toHaveText(/Guardar corrección/);
    await wx.locator('[data-approve]').click();
    await expect(page.locator('[data-review="wechat"]')).toHaveCount(0);
    let [c] = (await captures(page)).filter((x) => x.fields.wechat);
    expect(c.fields.wechat).toBe('demo_wx_O0');
    expect(c.field_meta.wechat).toMatchObject({ source: 'human', locked: true });
    expect(c.review_status).toBe('SIN_REVISAR'); // aprobar un dato no confirma la captura entera

    await page.locator('[data-review="main_products"] [data-approve]').click();
    await expect(page.locator('#review-done')).toBeVisible();
    [c] = (await captures(page)).filter((x) => x.fields.wechat);
    expect(c.review_status).toBe('SIN_REVISAR');
    expect(c.field_meta.main_products).toMatchObject({ source: 'human', locked: true });
  });

  test('confirmación global solo tras diálogo explícito', async ({ page }) => {
    await login(page);
    await seed(page, 1, ['review']);
    await page.locator('#btn-review').click();
    await page.locator('#btn-start-review').click();
    await page.locator('#btn-confirm-all').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
    expect((await captures(page))[0].review_status).toBe('SIN_REVISAR');
    await page.locator('#btn-confirm-all').click();
    await page.locator('[data-confirm]').click();
    await expect.poll(async () => (await captures(page))[0].review_status).toBe('REVISADO');
  });

  test('sincronización: mensajes por causa, sin conexión, reintento sin registros duplicados', async ({ page, context }) => {
    await login(page);
    // sin la captura «procesando»: su foto espera al escáner antes de subir (comportamiento del motor)
    await seed(page, 7, SEED_CYCLE.filter((k) => k !== 'processing'));
    await seed(page, 1, ['auth']);
    await page.locator('#btn-sync').click();
    await expect(page.locator('#sync-permission')).toContainText('Sin permiso en Google Drive o Sheets');
    await expect(page.locator('#sync-auth')).toContainText('La sesión de Google expiró');
    await expect(page.locator('#btn-reconnect')).toBeVisible();
    await expect(page.locator('#sync-offline')).toBeVisible();
    await expect(page.locator('#sync-ocr')).toContainText('Fallo de lectura');
    await expect(page.locator('[data-stage="google"]')).toContainText('1/8');
    await shot(page, 'flujo-sincronizacion-errores');

    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await page.locator('#btn-sync-now').click();
    await expect(page.locator('#sync-report')).toContainText('Sin conexión: no se envió nada');
    expect((await captures(page)).filter((c) => c.sync_status === 'CONFIRMADO')).toHaveLength(1);

    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.locator('#btn-sync-now').click();
    await expect.poll(async () => (await captures(page)).every((c) => c.sync_status === 'CONFIRMADO'), { timeout: 30_000 }).toBe(true);
    await expect(page.locator('[data-stage="google"]')).toContainText('8/8');
    const rows1 = await page.evaluate(() => (window as unknown as W).__cx.sheets.asObjects().map((r) => r.capture_uuid));
    await page.locator('#btn-sync-now').click(); // reintento: no crea filas nuevas
    await expect(page.locator('#sync-report')).toBeVisible();
    const rows2 = await page.evaluate(() => (window as unknown as W).__cx.sheets.asObjects().map((r) => r.capture_uuid));
    expect(rows2).toEqual(rows1);
    expect(new Set(rows2).size).toBe(rows2.length);
  });

  test('ficha: empresa pendiente, corrección humana bloqueada y secciones', async ({ page }) => {
    await login(page);
    await seed(page, 1, ['no_company']);
    await page.locator('#btn-list').click();
    await page.locator('.supplier').first().click();
    await expect(page.locator('#detail-head')).toContainText('Empresa pendiente de identificar');
    for (const s of ['#sec-ident', '#sec-comms', '#sec-products', '#sec-evidence', '#sec-trace']) await expect(page.locator(s)).toBeVisible();
    await page.locator('[data-edit="sec-ident"]').click();
    await page.locator('input[name="company_name"]').fill('Orchid Demo Instruments Ltd.');
    await page.locator('#btn-save-edit').click();
    await expect(page.locator('#detail-head h2')).toHaveText('Orchid Demo Instruments Ltd.');
    await expect(page.locator('[data-kv="company_name"]')).toContainText('Corregido');
    const [c] = await captures(page);
    expect(c.field_meta.company_name).toMatchObject({ source: 'human', locked: true });
    expect(c.sync_status).not.toBe('CONFIRMADO'); // la corrección queda pendiente de enviar
  });

  test('documento: el estado mostrado coincide con el archivo real y ajuste manual de esquinas', async ({ page }) => {
    await login(page);
    await page.locator('#btn-register').click();
    const chooser = page.waitForEvent('filechooser');
    await page.locator('#btn-gallery').click();
    await (await chooser).setFiles(await fictionalCardJpeg(page));
    await page.locator('#btn-save-done').click();
    await page.locator('#btn-list').click();
    await page.locator('.supplier').first().click();
    await page.locator('[data-evidence="card_front"]').click();
    // nunca se afirma que el recorte terminó antes de que exista el archivo procesado
    const state = await page.locator('#scan-state').innerText();
    const uuid = (await captures(page))[0].uuid;
    const hasProcessed = async () => (await page.evaluate((u) => (window as unknown as W).__cx.app.repo.evidences(u), uuid)).some((e) => e.role === 'processed');
    if (/recortado|Recorte automático/i.test(state)) expect(await hasProcessed()).toBe(true);
    else expect(state).toMatch(/Procesando documento|No se detectaron|Sin procesar/);

    await expect.poll(hasProcessed, { timeout: 120_000 }).toBe(true);
    await expect(page.locator('#scan-state')).toContainText(/recortado|Recorte automático/i, { timeout: 10_000 });
    await page.locator('[data-value="compare"]').click();
    await expect(page.locator('#doc-compare img')).toHaveCount(2);
    await shot(page, 'flujo-documento-comparar');

    await page.locator('#btn-adjust').click();
    await expect(page.locator('#corner-editor')).toBeVisible();
    const h = page.locator('.ce-handle').first();
    const b = (await h.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down(); await page.mouse.move(b.x + 30, b.y + 24, { steps: 4 }); await page.mouse.up();
    await shot(page, 'flujo-ajuste-esquinas');
    await page.locator('#ce-save').click();
    await expect(page.locator('#corner-editor')).toHaveCount(0);
    await expect.poll(async () => {
      const evs = await page.evaluate((u) => (window as unknown as W).__cx.app.repo.evidences(u), uuid);
      return evs.find((e) => e.kind === 'card_front' && e.role !== 'processed')?.scan?.manual_quad?.length;
    }).toBe(4);
    expect((await page.evaluate((u) => (window as unknown as W).__cx.app.repo.audit(u), uuid)).map((a) => a.type)).toContain('MANUAL_CORNERS');
  });

  test('muchos proveedores: render incremental, miniaturas acotadas y búsqueda', async ({ page }) => {
    test.setTimeout(180_000);
    await login(page);
    await seed(page, 150, ['confirmed', 'pending', 'review']);
    await page.locator('#btn-list').click();
    await expect(page.locator('#list-count')).toHaveText('150 proveedores');
    await expect(page.locator('#capture-list .supplier')).toHaveCount(30);
    for (let i = 0; i < 6; i++) { await page.locator('#capture-list .supplier').last().scrollIntoViewIfNeeded(); await page.waitForTimeout(150); }
    expect(await page.locator('#capture-list .supplier').count()).toBeGreaterThan(30);
    const imgs = await page.locator('#capture-list img').count();
    expect(imgs).toBeLessThan(60); // solo las miniaturas cerca del viewport existen como imagen
    await page.locator('#list-search').fill('Harbor Demo Tools Inc. 16');
    await expect(page.locator('#capture-list .supplier')).toHaveCount(1);
  });

  test('tema: claro, oscuro y sistema; preferencia persistida', async ({ page }) => {
    await login(page);
    await go(page, 'settings');
    await page.locator('#set-theme [data-value="dark"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('#set-theme [data-value="dark"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#set-theme [data-value="system"]').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  test('cerrar sesión no borra capturas pendientes', async ({ page }) => {
    await login(page);
    await seed(page, 3, ['pending']);
    await go(page, 'settings');
    await page.locator('#btn-logout').click();
    await expect(page.getByRole('dialog')).toContainText('NO se borrarán');
    await page.locator('[data-confirm]').click();
    await expect(page.locator('#screen-login')).toBeVisible();
    await login(page);
    await expect(page.locator('#m-total')).toContainText('3');
  });

  test('tipos de documento: ocultos por defecto y nunca presentados como funcionales', async ({ page }) => {
    await login(page);
    await page.locator('#btn-register').click();
    await expect(page.locator('#btn-doctype')).toHaveCount(0);
    await page.evaluate(() => localStorage.setItem('cx.features', 'documentTypes'));
    await page.reload();
    await page.locator('#btn-doctype').click();
    const dlg = page.getByRole('dialog');
    await expect(dlg.getByRole('button', { name: /Tarjeta comercial/ })).toBeEnabled();
    for (const t of ['Ficha técnica', 'Factura', 'Cotización', 'Catálogo']) await expect(dlg.getByRole('button', { name: new RegExp(t) })).toBeDisabled();
    await expect(dlg).toContainText('Próximamente');
  });
});
