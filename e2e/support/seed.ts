// Datos 100 % FICTICIOS para pruebas visuales y de flujo. Ningún nombre, teléfono o correo es real
// (dominios .example, teléfonos 555). Se crean en el IndexedDB del navegador de pruebas mediante el
// contrato existente (`repo.createCapture` + `repo.update`), sin tocar la lógica de sincronización.
import type { Page } from '@playwright/test';

export type SeedKind = 'confirmed' | 'review' | 'processing' | 'ocr_error' | 'offline' | 'no_company' | 'pending' | 'permission';
export const SEED_CYCLE: SeedKind[] = ['confirmed', 'review', 'processing', 'pending', 'ocr_error', 'offline', 'no_company', 'permission'];

/** Ejecutable dentro de la página (también se puede pegar en la consola de desarrollo). */
export async function seedInPage({ n, kinds }: { n: number; kinds: SeedKind[] }): Promise<string[]> {
  const cx = (window as unknown as { __cx: { app: any } }).__cx;
  const app = cx.app;
  const user = await app.auth.currentUser();
  const NAMES = ['Aurora Demo Lighting Co., Ltd.', 'Bluepeak Sample Hardware Ltd.', 'Cedar Fictional Ceramics', 'Delta Placeholder Textiles', 'Ember Mock Electronics', 'Fjord Test Furniture Co.', 'Garnet Sample Packaging', 'Harbor Demo Tools Inc.'];
  const PEOPLE = ['Ana Ejemplo', 'Leo Prueba', 'Mia Ficticia', 'Tom Muestra', 'Zoe Demo', 'Ivan Ensayo'];
  const card = async (i: number, name: string, person: string): Promise<Blob> => {
    const c = document.createElement('canvas'); c.width = 900; c.height = 540;
    const g = c.getContext('2d')!;
    g.fillStyle = '#5b6470'; g.fillRect(0, 0, 900, 540); // fondo (mesa)
    g.save(); g.translate(450, 270); g.rotate(((i % 5) - 2) * 0.03);
    g.fillStyle = '#fbfaf6'; g.fillRect(-380, -220, 760, 440);
    g.fillStyle = ['#1d4ed8', '#b45309', '#047857', '#7c3aed'][i % 4]; g.fillRect(-380, -220, 18, 440);
    g.fillStyle = '#111'; g.font = 'bold 34px sans-serif'; g.fillText(name.slice(0, 30), -330, -140);
    g.font = '26px sans-serif'; g.fillText(person, -330, -80); g.fillText('Sales Manager', -330, -45);
    g.font = '24px sans-serif'; g.fillText('Mob: +86 555 0100 ' + String(100 + i).slice(-3), -330, 30);
    g.fillText(`Email: sales${i}@demo.example`, -330, 70); g.fillText('Web: www.demo.example', -330, 110);
    g.fillText('Products: LED PANEL; STREETLIGHTING; FLOOD LIGHT', -330, 150);
    g.fillText(`WeChat: demo_wx_0${i}`, -330, 185);
    g.restore();
    return new Promise((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.85));
  };
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const kind = kinds[i % kinds.length];
    const name = NAMES[i % NAMES.length], person = PEOPLE[i % PEOPLE.length];
    const c = await app.repo.createCapture(user, [{ kind: 'card_front', blob: await card(i, name, person), name: `demo-${i}.jpg` }], { booth: `${String.fromCharCode(65 + (i % 6))}${10 + i}`, hall: '11.2' });
    await app.repo.update(c.uuid, (x: any) => {
      const set = (f: string, v: string, status = 'ok', extra: object = {}) => { x.fields[f] = v; x.field_meta[f] = { source: 'ocr_front', status, ...extra }; };
      x.ocr_engine = 'demo';
      if (kind !== 'processing' && kind !== 'no_company') {
        set('company_name', `${name}${n > NAMES.length ? ` ${i + 1}` : ''}`);
        set('contact_name', person); set('job_title', 'Sales Manager');
        set('phone_1', `+86 555 0100 ${String(100 + i).slice(-3)}`); set('email', `sales${i}@demo.example`); set('website', 'www.demo.example');
        set('city', 'Foshan'); set('province', 'Guangdong'); set('address', `No. ${i + 1} Demo Road, Sample District`);
        set('main_products', 'LED panel; Street lighting; Flood light');
      }
      x.ocr_status = 'EXTRAIDO';
      switch (kind) {
        case 'review':
          x.ocr_status = 'REQUIERE_REVISION';
          set('main_products', 'LED panel; STREETLIGHTING; Flood light', 'review', { reason: 'posibles errores de separación: "STREETLIGHTING"' });
          set('wechat', 'demo_wx_0' + i, 'review', { reason: 'baja confianza', candidates: ['demo_wx_O' + i] });
          break;
        case 'processing': x.ocr_status = 'PROCESANDO'; break;
        case 'ocr_error': x.ocr_status = 'ERROR'; x.ocr_error = 'OCR superó el tiempo máximo'; break;
        case 'no_company':
          x.ocr_status = 'REQUIERE_REVISION'; x.scan_issues = ['Tarjeta frontal: bordes no detectados con confianza — se conserva la foto original; ajuste las esquinas si es necesario'];
          set('company_name', '', 'illegible', { reason: 'texto ilegible: logotipo sin texto' });
          break;
      }
    }, { bump: true });
    // estado de Google en un segundo paso (sin incrementar la revisión)
    await app.repo.update(c.uuid, (x: any) => {
      const SYNC: Record<SeedKind, [string, string?]> = {
        confirmed: ['CONFIRMADO'], review: ['PENDIENTE'], processing: ['LOCAL'], pending: ['PENDIENTE'], no_company: ['PENDIENTE'],
        ocr_error: ['ERROR', 'Red: Failed to fetch'], offline: ['ERROR', 'Sin conexión'], permission: ['ERROR', 'Drive HTTP 403: insufficient permissions'],
      };
      const [st, err] = SYNC[kind];
      x.sync_status = st; x.sync_error = err;
      if (st === 'CONFIRMADO') x.synced_revision = x.revision;
      // reintentos lejanos: la sincronización automática no altera el estado sembrado durante la prueba
      x.sync_next_attempt_at = Date.now() + 86_400_000;
    });
    if (kind === 'review') {
      // lectura OCR sintética con cajas (coordenadas de la foto original, sin rotación)
      const ev = (await app.repo.evidences(c.uuid))[0];
      const lines = [
        { text: name, score: 0.97, box: [[120, 100], [700, 100], [700, 140], [120, 140]] },
        { text: 'Products: LED PANEL; STREETLIGHTING; FLOOD LIGHT', score: 0.81, box: [[118, 396], [760, 396], [760, 428], [118, 428]] },
        { text: `WeChat: demo_wx_0${i}`, score: 0.62, box: [[118, 432], [470, 432], [470, 462], [118, 462]] },
      ];
      await app.repo.saveOcrResult({ key: `${c.uuid}:front`, capture_uuid: c.uuid, side: 'front', evidence_id: ev.id, engine: 'demo', lines,
        text: lines.map((l) => l.text).join('\n'), ms: 1, created_at: new Date().toISOString(), rotation: 0, read_from: ev.id });
    }
    out.push(c.uuid);
  }
  return out;
}

export async function seed(page: Page, n: number, kinds: SeedKind[] = SEED_CYCLE): Promise<string[]> {
  await page.waitForFunction(() => !!(window as unknown as { __cx?: unknown }).__cx);
  return page.evaluate(seedInPage, { n, kinds });
}
