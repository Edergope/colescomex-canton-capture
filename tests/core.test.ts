// Pruebas obligatorias del núcleo (sección 11 del prompt maestro).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { CaptureApp } from '../src/app/service';
import { MockAuth, MockDrive, MockNetwork, MockSheets } from '../src/adapters/mock';
import { MockOCRAdapter } from '../src/ocr/mock';
import { EXTERNAL_REF_RE } from '../src/domain/ids';
import type { EvidenceKind, UserProfile } from '../src/domain/schema';

const USERS: UserProfile[] = [{ id: 'EDR', name: 'Eder' }, { id: 'HCT', name: 'Héctor' }];
const img = (lines: string[]) => new Blob([`\xFF\xD8fake-jpeg\nMOCKOCR\n${lines.join('\n')}`], { type: 'image/jpeg' });
const ev = (kind: EvidenceKind, lines: string[] = [`foto ${kind}`]) => ({ kind, blob: img(lines) });

const CARD_A_FRONT = ['GUANGZHOU BRIGHT LIGHTING TECHNOLOGY CO., LTD.', 'Jason Wang', 'Sales Manager', 'M: +86 138 0013 8000', 'E: jason@brightlighting.com.cn'];
const CARD_A_BACK = ['广州市明亮照明科技有限公司', '王伟 销售经理', '微信: jasonwang_gz', '地址：广东省广州市白云区黄埔路18号'];
const CARD_B_FRONT = ['NINGBO OCEAN IMP. & EXP. CO., LTD.', 'Tony Li', 'Export Manager', 'M: +86 139 5744 1234', 'E: tony@ocean-nb.com'];
const CARD_C_FRONT = ['佛山市顺德区美家家具有限公司', '陈小明', '总经理', '手机：139 2233 4455', '邮箱：chen@meijia-furniture.cn'];

let n = 0;
const apps: CaptureApp[] = [];
afterEach(() => { apps.splice(0).forEach((a) => a.stop()); });

async function makeApp(opts: { user?: string; db?: string; drive?: MockDrive; sheets?: MockSheets; ocr?: MockOCRAdapter; net?: MockNetwork } = {}) {
  const net = opts.net ?? new MockNetwork();
  const auth = new MockAuth(USERS);
  const app = await CaptureApp.create({
    dbName: opts.db ?? `test-${++n}-${Math.random()}`, auth,
    ocr: opts.ocr ?? new MockOCRAdapter({ delayMs: 5 }),
    drive: opts.drive ?? new MockDrive(net), sheets: opts.sheets ?? new MockSheets(net),
    ocrOptions: { retryDelayMs: () => 5 }, syncOptions: { backoffMs: () => 0, isOnline: () => net.online }, syncDebounceMs: 60_000,
  });
  await auth.signIn(opts.user ?? 'EDR');
  apps.push(app);
  return { app, net, auth };
}

describe('Pruebas A/B/C: capturas consecutivas con OCR en segundo plano', () => {
  it('captura B y C mientras el OCR procesa A; tres proveedores aislados y correctos', async () => {
    const ocr = new MockOCRAdapter({ delayMs: 150 });
    const { app } = await makeApp({ ocr });

    const t0 = Date.now();
    const A = await app.saveCapture([ev('card_front', CARD_A_FRONT), ev('card_back', CARD_A_BACK), ev('stand')]);
    const tA = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 20));
    expect((await app.repo.get(A.uuid))!.ocr_status).toBe('PROCESANDO'); // A en proceso…
    const B = await app.saveCapture([ev('card_front', CARD_B_FRONT)]);      // …y se captura B
    const C = await app.saveCapture([ev('card_front', CARD_C_FRONT), ev('product')]); // …y C
    expect(tA).toBeLessThan(150); // guardar no espera al OCR
    expect((await app.repo.get(B.uuid))!.ocr_status).toBe('CAPTURADO');

    await app.ocr.idle();
    const [a, b, c] = await Promise.all([A, B, C].map((x) => app.repo.get(x.uuid)));

    // identificadores únicos
    expect(new Set([a!.uuid, b!.uuid, c!.uuid]).size).toBe(3);
    expect(new Set([a!.external_ref, b!.external_ref, c!.external_ref]).size).toBe(3);
    for (const x of [a, b, c]) expect(x!.external_ref).toMatch(EXTERNAL_REF_RE);

    // evidencias vinculadas a su captura (y solo a ella)
    const evA = await app.repo.evidences(A.uuid), evB = await app.repo.evidences(B.uuid), evC = await app.repo.evidences(C.uuid);
    expect(evA.map((e) => e.kind)).toEqual(['card_front', 'card_back', 'stand']);
    expect(evB.map((e) => e.kind)).toEqual(['card_front']);
    expect(evC.map((e) => e.kind)).toEqual(['card_front', 'product']);
    for (const [cap, evs] of [[a!, evA], [b!, evB], [c!, evC]] as const) {
      expect(evs.every((e) => e.capture_uuid === cap.uuid && e.file_name.startsWith(cap.external_ref))).toBe(true);
      expect(cap.evidence_ids).toEqual(evs.map((e) => e.id));
    }
    expect(await evA[1].blob.text()).toContain('广州市明亮照明科技有限公司'); // la foto original se conserva intacta

    // frontal + reverso fusionados en UNA captura
    expect(a!.fields.company_name).toBe('GUANGZHOU BRIGHT LIGHTING TECHNOLOGY CO., LTD.');
    expect(a!.fields.company_name_cn).toBe('广州市明亮照明科技有限公司');
    expect(a!.field_meta.company_name_cn?.source).toBe('ocr_back');
    expect(a!.fields.wechat).toBe('jasonwang_gz');
    expect(a!.fields.phone_1).toBe('+8613800138000');
    expect(ocr.calls).toBe(4); // A: 2 caras; B y C: 1 cada una (stand/producto no pasan por OCR)

    // ningún registro sobrescrito por otro
    expect(b!.fields.company_name).toBe('NINGBO OCEAN IMP. & EXP. CO., LTD.');
    expect(b!.fields.email).toBe('tony@ocean-nb.com');
    expect(c!.fields.company_name_cn).toBe('佛山市顺德区美家家具有限公司');
    expect(c!.fields.contact_name).toBe('陈小明');
    expect(c!.fields.email).toBe('chen@meijia-furniture.cn');
    expect(a!.fields.email).toBe('jason@brightlighting.com.cn');

    // valores precargados
    for (const x of [a!, b!, c!]) {
      expect(x.fields).toMatchObject({ mission: 'China 2026', source: 'Canton Fair', phase: 'Fase 2', country: 'China', data_classification: 'REAL', captured_by: 'Eder' });
      expect(['EXTRAIDO', 'REQUIERE_REVISION']).toContain(x.ocr_status);
      expect(x.fields.processing_status).not.toMatch(/APPROVED|APROBADO/);
    }
  });

  it('no permite guardar sin fotografía frontal y no deja restos', async () => {
    const { app } = await makeApp();
    await expect(app.saveCapture([ev('stand')])).rejects.toThrow(/frontal/);
    expect(await app.repo.list()).toHaveLength(0);
    expect(await app.repo.db.count('evidences')).toBe(0);
  });
});

describe('Sincronización', () => {
  it('no declara CONFIRMADO si solo existe en el teléfono; confirma tras subir evidencias y fila', async () => {
    const { app, net } = await makeApp();
    net.online = false;
    const A = await app.saveCapture([ev('card_front', CARD_A_FRONT), ev('card_back', CARD_A_BACK), ev('stand')]);
    await app.ocr.idle();
    const r = await app.syncNow();
    expect(r.offline).toBe(true);
    expect((await app.repo.get(A.uuid))!.sync_status).toBe('LOCAL');

    net.online = true;
    await app.syncNow();
    const a = (await app.repo.get(A.uuid))!;
    expect(a.sync_status).toBe('CONFIRMADO');
    expect(a.synced_revision).toBe(a.revision);
    expect((await app.repo.evidences(A.uuid)).every((e) => e.remote_file_id)).toBe(true);
  });

  it('pérdida de conexión ANTES y DURANTE la sincronización: reintentos sin duplicados', async () => {
    const drive = new MockDrive(); const sheets = new MockSheets(drive.net);
    const { app } = await makeApp({ drive, sheets, net: drive.net });
    const net = drive.net;
    const caps = [
      await app.saveCapture([ev('card_front', CARD_A_FRONT), ev('card_back', CARD_A_BACK), ev('stand')]),
      await app.saveCapture([ev('card_front', CARD_B_FRONT)]),
      await app.saveCapture([ev('card_front', CARD_C_FRONT), ev('product')]),
    ];
    await app.ocr.idle();

    // antes: sin red
    net.online = false;
    expect((await app.syncNow()).offline).toBe(true);
    expect(drive.files.size + sheets.rows.length).toBe(0);

    // durante: se suben carpeta + 1 foto y se pierde la respuesta de la segunda subida
    net.online = true;
    net.dropResponseNext = 0;
    let ops = 0;
    const origUpload = drive.uploadEvidence.bind(drive);
    drive.uploadEvidence = async (...args) => { if (++ops === 2) net.dropResponseNext = 1; return origUpload(...args); };
    await app.syncNow(true);
    const afterCut = (await app.repo.get(caps[0].uuid))!;
    expect(afterCut.sync_status).toBe('ERROR');
    expect(afterCut.sync_error).toMatch(/reintentar/);

    // la fila se escribe pero se pierde la respuesta → el reintento debe ACTUALIZAR, no insertar
    drive.uploadEvidence = origUpload;
    const origUpsert = sheets.upsertRow.bind(sheets);
    let rowsOps = 0;
    sheets.upsertRow = async (row) => { if (++rowsOps === 1) net.dropResponseNext = 1; return origUpsert(row); };
    for (let i = 0; i < 4; i++) await app.syncNow(true);

    for (const c of caps) expect((await app.repo.get(c.uuid))!.sync_status).toBe('CONFIRMADO');
    expect(drive.folders.size).toBe(3);
    expect(drive.files.size).toBe(6); // 3 + 1 + 2 evidencias, sin duplicados
    expect(sheets.rows).toHaveLength(3);
    expect(new Set(sheets.asObjects().map((r) => r.capture_uuid)).size).toBe(3);
    // cada archivo está en la carpeta de SU proveedor
    for (const c of caps) {
      const folder = [...drive.folders.values()].find((f) => f.appProperties.capture_uuid === c.uuid)!;
      const files = [...drive.files.values()].filter((f) => f.parent === folder.id);
      expect(files.every((f) => f.appProperties.capture_uuid === c.uuid && f.name.startsWith(c.external_ref))).toBe(true);
      expect(files).toHaveLength(c.evidence_ids.length);
    }
  });

  it('cambios posteriores (OCR o corrección) actualizan la MISMA fila', async () => {
    const ocr = new MockOCRAdapter({ delayMs: 80 });
    const { app } = await makeApp({ ocr });
    const sheets = (app.sync as unknown as { sheets: MockSheets }).sheets;
    const A = await app.saveCapture([ev('card_front', CARD_A_FRONT)]);
    await app.syncNow(); // se sincroniza antes de que termine el OCR (la foto se protege cuanto antes)
    expect(sheets.rows).toHaveLength(1);
    expect(sheets.asObjects()[0].company_name).toBe('');
    await app.ocr.idle();
    expect((await app.repo.get(A.uuid))!.sync_status).toBe('PENDIENTE');
    await app.syncNow();
    await app.editFields(A.uuid, { booth: 'C15', hall: '11.2' });
    await app.syncNow();
    expect(sheets.rows).toHaveLength(1);
    const row = sheets.asObjects()[0];
    expect(row.company_name).toBe('GUANGZHOU BRIGHT LIGHTING TECHNOLOGY CO., LTD.');
    expect(row.booth).toBe('C15');
    expect(row.capture_uuid).toBe(A.uuid);
    expect((await app.repo.get(A.uuid))!.sync_status).toBe('CONFIRMADO');
  });

  it('sesión de Google expirada → ERROR con instrucción, sin perder datos', async () => {
    const { app, auth } = await makeApp();
    const drive = new MockDrive();
    // conecta un Drive que exige token válido
    (app.sync as unknown as { drive: unknown }).drive = { ...drive, ensureCaptureFolder: async (c: never) => { await auth.getAccessToken(); return drive.ensureCaptureFolder(c); }, uploadEvidence: drive.uploadEvidence.bind(drive) };
    auth.tokenValid = false;
    const A = await app.saveCapture([ev('card_front', CARD_B_FRONT)]);
    const r = await app.syncNow(true);
    expect(r.authRequired).toBe(true);
    const a = (await app.repo.get(A.uuid))!;
    expect(a.sync_status).toBe('ERROR');
    expect(a.sync_error).toMatch(/Google/);
    expect(await app.repo.evidences(A.uuid)).toHaveLength(1);
  });
});

describe('Dos usuarios simultáneos', () => {
  it('Eder y Héctor capturan a la vez en sus teléfonos sin colisiones', async () => {
    const net = new MockNetwork(); const drive = new MockDrive(net); const sheets = new MockSheets(net);
    const { app: eder } = await makeApp({ user: 'EDR', drive, sheets, net });
    const { app: hector } = await makeApp({ user: 'HCT', drive, sheets, net });
    const work = (app: CaptureApp, cards: string[][]) => Promise.all(cards.map((c) => app.saveCapture([ev('card_front', c)])));
    const [e, h] = await Promise.all([
      work(eder, [CARD_A_FRONT, CARD_B_FRONT, CARD_C_FRONT]),
      work(hector, [CARD_C_FRONT, CARD_A_FRONT, CARD_B_FRONT]),
    ]);
    await Promise.all([eder.ocr.idle(), hector.ocr.idle()]);
    await Promise.all([eder.syncNow(), hector.syncNow()]);
    await Promise.all([eder.syncNow(), hector.syncNow()]);
    const refs = [...e, ...h].map((c) => c.external_ref);
    expect(new Set(refs).size).toBe(6);
    expect(e.every((c) => c.external_ref.includes('-EDR-') && c.fields.captured_by === 'Eder')).toBe(true);
    expect(h.every((c) => c.external_ref.includes('-HCT-') && c.fields.captured_by === 'Héctor')).toBe(true);
    expect(sheets.rows).toHaveLength(6);
    expect(new Set(sheets.asObjects().map((r) => r.external_ref)).size).toBe(6);
  });

  it('el mismo usuario en dos teléfonos tampoco colisiona (código de dispositivo)', async () => {
    const { app: p1 } = await makeApp({ user: 'EDR' });
    const { app: p2 } = await makeApp({ user: 'EDR' });
    const a = await p1.saveCapture([ev('card_front', CARD_A_FRONT)]);
    const b = await p2.saveCapture([ev('card_front', CARD_A_FRONT)]);
    expect(a.external_ref.endsWith('-0001') && b.external_ref.endsWith('-0001')).toBe(true);
    expect(a.external_ref).not.toBe(b.external_ref);
  });
});

describe('OCR fallido y reproceso', () => {
  it('agota reintentos → ERROR; reprocesar → EXTRAIDO; la foto sigue intacta', async () => {
    const ocr = new MockOCRAdapter();
    ocr.failNext = 3;
    const { app } = await makeApp({ ocr });
    const A = await app.saveCapture([ev('card_front', CARD_B_FRONT)]);
    await app.ocr.idle();
    let a = (await app.repo.get(A.uuid))!;
    expect(a.ocr_status).toBe('ERROR');
    expect(a.ocr_attempts).toBe(3);
    expect(a.ocr_error).toMatch(/simulado/);
    await app.reprocessOcr(A.uuid);
    await app.ocr.idle();
    a = (await app.repo.get(A.uuid))!;
    expect(a.ocr_status).toBe('EXTRAIDO');
    expect(a.fields.company_name).toBe('NINGBO OCEAN IMP. & EXP. CO., LTD.');
    expect(await (await app.repo.evidences(A.uuid))[0].blob.text()).toContain('NINGBO');
  });

  it('un fallo transitorio se recupera solo', async () => {
    const ocr = new MockOCRAdapter(); ocr.failNext = 1;
    const { app } = await makeApp({ ocr });
    const A = await app.saveCapture([ev('card_front', CARD_B_FRONT)]);
    await new Promise((r) => setTimeout(r, 50));
    await app.ocr.idle();
    expect((await app.repo.get(A.uuid))!.ocr_status).toBe('EXTRAIDO');
  });

  it('las correcciones humanas confirmadas no se sobrescriben al reprocesar', async () => {
    const { app } = await makeApp();
    const A = await app.saveCapture([ev('card_front', CARD_B_FRONT)]);
    await app.ocr.idle();
    await app.editFields(A.uuid, { contact_name: 'Tony Li (李涛)', email: 'tony.li@ocean-nb.com' });
    await app.reprocessOcr(A.uuid);
    await app.ocr.idle();
    const a = (await app.repo.get(A.uuid))!;
    expect(a.fields.contact_name).toBe('Tony Li (李涛)');
    expect(a.fields.email).toBe('tony.li@ocean-nb.com');
    expect(a.field_meta.email).toMatchObject({ source: 'human', locked: true });
    expect(a.fields.phone_1).toBe('+8613957441234'); // los demás sí se recalculan
    await app.confirmReview(A.uuid);
    const r = (await app.repo.get(A.uuid))!;
    expect(r.review_status).toBe('REVISADO');
    expect(r.field_meta.company_name?.locked).toBe(true);
  });
});

describe('Cierre y reapertura', () => {
  it('capturas con OCR pendiente se recuperan al reabrir la app', async () => {
    const db = `reopen-${Math.random()}`;
    const slow = new MockOCRAdapter({ delayMs: 10_000 });
    const { app: first } = await makeApp({ db, ocr: slow });
    const A = await first.saveCapture([ev('card_front', CARD_A_FRONT), ev('card_back', CARD_A_BACK)]);
    const B = await first.saveCapture([ev('card_front', CARD_B_FRONT)]);
    await new Promise((r) => setTimeout(r, 20));
    expect((await first.repo.get(A.uuid))!.ocr_status).toBe('PROCESANDO');
    first.stop(); // "cierra" la app en pleno OCR
    first.repo.db.close();

    const { app: second } = await makeApp({ db, ocr: new MockOCRAdapter() });
    const list = await second.repo.list();
    expect(list.map((c) => c.uuid).sort()).toEqual([A.uuid, B.uuid].sort());
    const { resumedOcr } = await second.start();
    expect(resumedOcr).toBe(2);
    await second.ocr.idle();
    expect((await second.repo.get(A.uuid))!.fields.company_name_cn).toBe('广州市明亮照明科技有限公司');
    expect((await second.repo.get(B.uuid))!.ocr_status).toBe('EXTRAIDO');
    expect(await second.repo.evidences(A.uuid)).toHaveLength(2);
    // el consecutivo continúa tras reabrir
    const C = await second.saveCapture([ev('card_front', CARD_C_FRONT)]);
    expect(C.external_ref.endsWith('-0003')).toBe(true);
  });
});
