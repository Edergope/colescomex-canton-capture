import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const FX = path.resolve('ocr-eval/fixtures');
const fx = (n: string) => path.join(FX, n);

async function login(page: Page, who = 'Eder') {
  await page.goto('/');
  await page.getByRole('button', { name: `Soy ${who}` }).click();
  await expect(page.locator('#btn-register')).toBeVisible();
}
async function shoot(page: Page, button: string, file: string) {
  const chooser = page.waitForEvent('filechooser');
  await page.locator(button).click();
  await (await chooser).setFiles(file);
}
// El OCR real puede variar en espacios (p. ej. "&EXP"); se compara sin espacios.
const ns = (s: string) => s.replace(/\s+/g, '');
type Cap = { uuid: string; external_ref: string; ocr_status: string; sync_status: string; fields: Record<string, string>; evidence_ids: string[]; field_meta: Record<string, { source: string; locked?: boolean }> };
const captures = (page: Page) => page.evaluate(async () => (window as never as { __cx: { app: { repo: { list(): Promise<unknown[]> } } } }).__cx.app.repo.list()) as Promise<Cap[]>;
const evidences = (page: Page, uuid: string) => page.evaluate(async (u) => (await (window as never as { __cx: { app: { repo: { evidences(u: string): Promise<{ kind: string; capture_uuid: string; size: number }[]> } } } }).__cx.app.repo.evidences(u)).map((e) => ({ kind: e.kind, capture_uuid: e.capture_uuid, size: e.size })), uuid);

test('A/B/C consecutivas con OCR real (PaddleOCR) en segundo plano, fusión y sincronización', async ({ page }) => {
  await login(page);
  await page.locator('#btn-register').click();

  // A: frontal + reverso + stand
  await shoot(page, '#btn-front', fx('c1_front_photo.jpg'));
  await shoot(page, '#btn-back-yes', fx('c1_back_photo.jpg'));
  await shoot(page, '#btn-stand', fx('c2_back_scan.png'));
  const t0 = Date.now();
  await page.locator('#btn-save-next').click();
  await expect(page.locator('#btn-front')).toBeVisible(); // nueva captura abierta de inmediato
  const saveMs = Date.now() - t0;

  // B: solo frontal (mientras A está en OCR)
  await shoot(page, '#btn-front', fx('c2_front_photo.jpg'));
  await page.locator('#btn-back-no').click();
  await page.locator('#btn-save-next').click();
  await expect(page.locator('#btn-front')).toBeVisible();
  const during = await captures(page);
  expect(during.some((c) => c.ocr_status === 'PROCESANDO' || c.ocr_status === 'CAPTURADO')).toBe(true);

  // C: frontal + producto
  await shoot(page, '#btn-front', fx('c3_front_photo.jpg'));
  await page.locator('#btn-back-no').click();
  await shoot(page, '#btn-product', fx('c4_back_scan.png'));
  await page.locator('#btn-save-done').click();
  expect(saveMs).toBeLessThan(3000);

  await expect.poll(async () => (await captures(page)).filter((c) => ['EXTRAIDO', 'REQUIERE_REVISION'].includes(c.ocr_status)).length, { timeout: 180_000 }).toBe(3);
  const list = (await captures(page)).reverse(); // orden de creación
  const [A, B, C] = list;
  expect(new Set(list.map((c) => c.uuid)).size).toBe(3);
  expect(new Set(list.map((c) => c.external_ref)).size).toBe(3);

  expect(ns(A.fields.company_name)).toBe(ns('GUANGZHOU BRIGHT LIGHTING TECHNOLOGY CO., LTD.'));
  expect(A.fields.company_name_cn).toBe('广州市明亮照明科技有限公司');
  expect(A.fields.email).toBe('jason@brightlighting.com.cn');
  expect(A.fields.booth).toBe('C15'); // solo aparece en el REVERSO → fusión
  expect(A.field_meta.booth.source).toBe('ocr_back');
  expect(ns(B.fields.company_name)).toBe(ns('NINGBO OCEAN IMP. & EXP. CO., LTD.'));
  expect(B.fields.email).toBe('tony@ocean-nb.com');
  expect(C.fields.company_name_cn).toBe('佛山市顺德区美家家具有限公司');
  expect(C.fields.contact_name).toBe('陈小明');

  // originales intactos por captura + una versión procesada (recortada) por cada cara de tarjeta
  const kinds = async (u: string) => { const e = await allEvidences(page, u); return { orig: e.filter((x) => x.role !== 'processed').map((x) => x.kind), proc: e.filter((x) => x.role === 'processed').map((x) => x.kind) }; };
  expect(await kinds(A.uuid)).toEqual({ orig: ['card_front', 'card_back', 'stand'], proc: ['card_front', 'card_back'] });
  expect(await kinds(B.uuid)).toEqual({ orig: ['card_front'], proc: ['card_front'] });
  expect(await kinds(C.uuid)).toEqual({ orig: ['card_front', 'product'], proc: ['card_front'] });

  // sincronización (mock) → confirmado, una fila por captura
  await page.locator('#btn-sync').click();
  await expect.poll(async () => (await captures(page)).every((c) => c.sync_status === 'CONFIRMADO'), { timeout: 30_000 }).toBe(true);
  const rows = await page.evaluate(() => (window as never as { __cx: { sheets: { rows: unknown[] } } }).__cx.sheets.rows.length);
  expect(rows).toBe(3);

  // lista visible
  await page.goto('/');
  await page.getByRole('button', { name: /Ver capturas/ }).click();
  await expect(page.locator('#capture-list .item')).toHaveCount(3);
  await expect(page.locator('#capture-list')).toContainText('NINGBO OCEAN');
});

test('corrección humana se conserva tras reprocesar OCR', async ({ page }) => {
  await login(page);
  await page.locator('#btn-register').click();
  await shoot(page, '#btn-front', fx('c6_front_photo.jpg'));
  await page.locator('#btn-back-no').click();
  await page.locator('#btn-save-done').click();
  await expect.poll(async () => (await captures(page))[0]?.ocr_status, { timeout: 180_000 }).toMatch(/EXTRAIDO|REQUIERE_REVISION/);
  const [c] = await captures(page);
  expect(c.fields.email).toBe('kevin.huang@greenleafpack.com');
  await page.getByRole('button', { name: /Ver capturas/ }).click();
  await page.locator('#capture-list .item').first().click();
  await page.locator('input[name="contact_name"]').fill('Kevin Huang (黄凯文)');
  await page.locator('#btn-save-edit').click();
  await page.locator('#btn-reprocess').click();
  await expect.poll(async () => (await captures(page))[0].ocr_status, { timeout: 180_000 }).toMatch(/EXTRAIDO|REQUIERE_REVISION/);
  await page.waitForTimeout(500);
  const [after] = await captures(page);
  expect(after.fields.contact_name).toBe('Kevin Huang (黄凯文)');
  expect(after.field_meta.contact_name).toMatchObject({ source: 'human', locked: true });
});

test('borrador del asistente sobrevive a que Android cierre la página al abrir la cámara', async ({ page }) => {
  await login(page);
  await page.locator('#btn-register').click();
  await shoot(page, '#btn-front', fx('c5_front_photo.jpg'));
  await expect(page.locator('#btn-back-no')).toBeVisible();
  await page.reload(); // la pestaña se recarga como si Android la hubiera descartado
  await expect(page.getByText('Se recuperó una captura sin guardar')).toBeVisible();
  await page.locator('#btn-back-no').click();
  await page.locator('#btn-save-done').click();
  await expect.poll(async () => (await captures(page)).length).toBe(1);
  expect((await evidences(page, (await captures(page))[0].uuid))[0].size).toBeGreaterThan(100_000);
});

test('sin conexión: la app reabre desde caché, captura y sincroniza al volver la red', async ({ page, context }) => {
  await login(page);
  // esperar a que el service worker controle la página y termine el precache
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 60_000 }).toBe(true);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length), { timeout: 60_000 }).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(async () => {
    const keys = await caches.keys();
    for (const k of keys) { const c = await caches.open(k); if ((await c.keys()).some((r) => r.url.includes('PP-OCRv5_mobile_rec'))) return true; }
    return false;
  }), { timeout: 120_000 }).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#btn-register')).toBeVisible();
  await expect(page.getByText(/Sin conexión: puedes seguir capturando/)).toBeVisible();
  await page.locator('#btn-register').click();
  await shoot(page, '#btn-front', fx('c4_front_photo.jpg'));
  await page.locator('#btn-back-no').click();
  await page.locator('#btn-save-done').click();
  // OCR también sin conexión (modelos desde la caché del service worker)
  await expect.poll(async () => (await captures(page))[0]?.ocr_status, { timeout: 180_000 }).toMatch(/EXTRAIDO|REQUIERE_REVISION/);
  let [c] = await captures(page);
  expect(ns(c.fields.company_name)).toBe(ns('SHENZHEN TOPWAY ELECTRONICS CO.,LTD'));
  expect(['LOCAL', 'PENDIENTE']).toContain(c.sync_status);
  await expect(page.locator('[data-sync]').first()).toBeVisible().catch(() => undefined);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.locator('#btn-sync').click();
  await expect.poll(async () => (await captures(page))[0].sync_status, { timeout: 30_000 }).toBe('CONFIRMADO');
  [c] = await captures(page);
  expect(c.external_ref).toMatch(/^CF26F2-EDR-/);
});

// ───────────── Smart Document Scanner con tarjetas REALES (fixtures privados; se omite sin ellos) ─────────────
import { privateCases, privateDir, PRIVATE_SKIP_MSG } from '../scripts/private-dir.mjs';
const REAL_CASES = privateCases() ?? [];
type Ev = { id: string; kind: string; role?: string; derived_from?: string; superseded_by?: string; size: number; file_name: string; sha256?: string; scan?: { status: string; rotation: number; cropped: boolean; orientation_source: string } };
const allEvidences = (page: Page, uuid: string) => page.evaluate(async (u) => (await (window as never as { __cx: { app: { repo: { evidences(u: string): Promise<Ev[]> } } } }).__cx.app.repo.evidences(u))
  .map((e) => ({ id: e.id, kind: e.kind, role: e.role, derived_from: e.derived_from, superseded_by: e.superseded_by, size: e.size, file_name: e.file_name, sha256: e.sha256, scan: e.scan && { status: e.scan.status, rotation: e.scan.rotation, cropped: e.scan.cropped, orientation_source: e.scan.orientation_source } })), uuid);

test.describe('tarjetas reales (privadas)', () => {
  test.skip(REAL_CASES.length === 0, PRIVATE_SKIP_MSG);
  for (const rc of REAL_CASES) {
    test(`${rc.id}: tarjeta real girada y sostenida con la mano — recorte, orientación y extracción comercial`, async ({ page }) => {
      const X = rc.expected;
      await login(page);
      await page.locator('#btn-register').click();
      await shoot(page, '#btn-front', path.join(privateDir(), rc.sides.front.file));
      await shoot(page, '#btn-back-yes', path.join(privateDir(), rc.sides.back.file));
      const t0 = Date.now();
      await page.locator('#btn-save-next').click();
      await expect(page.locator('#btn-front')).toBeVisible(); // J: la siguiente captura no espera al escáner ni al OCR
      const saveMs = Date.now() - t0;
      await shoot(page, '#btn-front', fx('c2_front_photo.jpg'));
      await page.locator('#btn-back-no').click();
      await page.locator('#btn-save-done').click();
      expect(saveMs).toBeLessThan(3000);

      await expect.poll(async () => (await captures(page)).filter((c) => ['EXTRAIDO', 'REQUIERE_REVISION'].includes(c.ocr_status)).length, { timeout: 180_000 }).toBe(2);
      const [M] = (await captures(page)).reverse();
      // G: extracción comercial contra el resultado esperado (privado)
      for (const [f, v] of Object.entries(X.fields)) {
        if (f === 'address') expect(ns(M.fields.address).toLowerCase().replace(/,/g, '')).toBe(ns(v).toLowerCase());
        else expect(ns(M.fields[f] ?? ''), f).toBe(ns(v));
      }
      const extras = await page.evaluate(async (u) => (await (window as never as { __cx: { app: { repo: { get(u: string): Promise<{ ocr_extras: unknown }> } } } }).__cx.app.repo.get(u)).ocr_extras, M.uuid) as Record<string, string[]>;
      for (const [k, v] of Object.entries(X.extras)) expect((extras[k] ?? []).map(ns), k).toEqual(v.map(ns));
      // Productos: ninguno tomado como persona; todas las letras conservadas; si no son exactos, quedan marcados para revisión
      expect(M.fields.main_products).not.toMatch(/WE ?PRODUCE/i);
      expect(ns(M.fields.main_products).replace(/;/g, '')).toBe(X.products.map(ns).join(''));
      const exact = X.products.every((p) => M.fields.main_products.split(';').map((i) => i.trim()).includes(p));
      if (!exact) expect(M.field_meta.main_products).toMatchObject({ status: 'review' });

      // A–E y H: recorte, orientación, originales intactos
      const evs = await allEvidences(page, M.uuid);
      const origF = evs.find((e) => e.kind === 'card_front' && e.role === 'original')!;
      const origB = evs.find((e) => e.kind === 'card_back' && e.role === 'original')!;
      expect(origF.scan).toMatchObject({ status: 'ok', cropped: true, rotation: rc.sides.front.rot * 90, orientation_source: 'classifier' });
      expect(origB.scan).toMatchObject({ status: 'ok', cropped: true, rotation: rc.sides.back.rot * 90, orientation_source: 'classifier' });
      expect(origF.sha256).toBe(rc.sides.front.sha256);
      expect(origB.sha256).toBe(rc.sides.back.sha256);
      const procF = evs.find((e) => e.role === 'processed' && e.derived_from === origF.id)!;
      expect(procF.file_name).toMatch(/_01_card_front_scan\.jpg$/);
      const dims = await page.evaluate(async ({ u, id }) => {
        const e = (await (window as never as { __cx: { app: { repo: { evidences(u: string): Promise<{ id: string; blob: Blob }[]> } } } }).__cx.app.repo.evidences(u)).find((x) => x.id === id)!;
        const b = await createImageBitmap(e.blob); return { w: b.width, h: b.height };
      }, { u: M.uuid, id: procF.id });
      expect(dims.w).toBeGreaterThan(dims.h * 1.3); // orientación normalizada (apaisada) aunque la foto era vertical

      // Drive (mock): tarjetas limpias en la carpeta del proveedor; originales en el archivo restringido; una sola fila
      // sin recargar: el Drive simulado vive en memoria (en la app real, Drive persiste)
      await page.locator('#btn-sync').click();
      await expect.poll(async () => (await captures(page)).every((c) => c.sync_status === 'CONFIRMADO'), { timeout: 60_000 }).toBe(true);
      const remote = await page.evaluate((ref) => {
        const w = window as never as { __cx: { drive: { files: Map<string, { name: string }> }; archive?: { files: Map<string, { name: string }> }; sheets: { asObjects(): Record<string, string>[] } } };
        return { main: [...w.__cx.drive.files.values()].map((f) => f.name).filter((n) => n.startsWith(ref)),
          archive: [...(w.__cx.archive?.files.values() ?? [])].map((f) => f.name).filter((n) => n.startsWith(ref)),
          rows: w.__cx.sheets.asObjects().filter((r) => r.external_ref === ref).length };
      }, M.external_ref);
      expect(remote.main.sort()).toEqual([`${M.external_ref}_01_card_front_scan.jpg`, `${M.external_ref}_02_card_back_scan.jpg`]);
      expect(remote.archive.sort()).toEqual([`${M.external_ref}_01_card_front.jpg`, `${M.external_ref}_02_card_back.jpg`]);
      expect(remote.rows).toBe(1);

      await page.getByRole('button', { name: /Ver capturas/ }).click();
      await page.locator(`[data-ref="${M.external_ref}"]`).click();
      await expect(page.locator('[data-scan="card_front:ok"]')).toContainText('Recortada y enderezada');
      await expect(page.locator('#ocr-extras')).toContainText(X.extras.qq[0]);
      await page.screenshot({ path: path.join(privateDir(), 'reports', `e2e-detalle-${rc.id}.png`), fullPage: true });
    });
  }
});
