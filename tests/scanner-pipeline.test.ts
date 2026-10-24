// Integración del Smart Document Scanner con el núcleo (cola OCR, almacenamiento, sincronización).
// El escáner se simula para controlar detección/orientación; la detección real se prueba en scanner-detect.test.ts
// y la tubería real completa en el navegador (ocr-eval/run-scanner-eval.mjs y e2e).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { CaptureApp } from '../src/app/service';
import { MockAuth, MockDrive, MockNetwork, MockSheets } from '../src/adapters/mock';
import { MockOCRAdapter } from '../src/ocr/mock';
import type { DocumentScanner, ScanAnalysis, ScanSession } from '../src/scanner/types';
import type { EvidenceKind, UserProfile } from '../src/domain/schema';
import { sha256 } from '../src/storage/repo';
import { TWIN_EXPECTED as X, TWIN_FRONT } from './fixtures/twin-card';

const USERS: UserProfile[] = [{ id: 'EDR', name: 'Eder' }, { id: 'HCT', name: 'Héctor' }];
const FRONT = TWIN_FRONT;
const BACK = ['WE PRODUCE:', 'SOLAR LIGHTING  LED LIGHTING', 'GARDEN LIGHTING', 'ALUMINIUM POLE', 'PLASTIC GARDEN LIGHTS'];
const GARBAGE = ['lI1 0Oo xqzt', 'pqbd ddbp', 'Il|l1 0O'];

/** "Foto" simulada: describe qué debe responder el escáner. */
interface Spec { status: ScanAnalysis['status']; label: number; lines: string[]; multiple?: boolean }
const photo = (spec: Spec) => new Blob([`\xFF\xD8MOCKCARD\n${JSON.stringify(spec)}`], { type: 'image/jpeg' });
const other = (kind: EvidenceKind) => ({ kind, blob: new Blob([`\xFF\xD8 foto ${kind}`], { type: 'image/jpeg' }) });

class FakeScanner implements DocumentScanner {
  calls: { manualQuad?: unknown; approvedQuad?: unknown }[] = [];
  async scan(blob: Blob, opts: { manualQuad?: unknown; approvedQuad?: unknown } = {}): Promise<ScanSession> {
    this.calls.push(opts);
    const spec = JSON.parse((await blob.text()).split('MOCKCARD\n')[1]) as Spec;
    const status = opts.manualQuad || opts.approvedQuad ? 'manual' : spec.status;
    const probs = [0.03, 0.03, 0.03, 0.03] as [number, number, number, number]; probs[spec.label] = 0.91;
    const good = (4 - spec.label) % 4;
    const cropped = (status === 'ok' || status === 'manual') && !spec.multiple;
    return {
      analysis: { status, confidence: status === 'ok' ? 0.9 : 0.5, quad: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 60 }, { x: 10, y: 60 }], method: 'paper',
        multiple: !!spec.multiple, reasons: [], orientationProbs: probs, source: { width: 100, height: 70 }, output: { width: 80, height: 50 }, cropped,
        ms: { decode: 1, detect: 1, warp: 1, classify: 1, total: 4 } },
      render: async (rot: number, o = {}) => new Blob([`\xFF\xD8 render rot=${rot} max=${o.maxSide ?? 'full'}\nMOCKOCR\n${(rot === good ? spec.lines : GARBAGE).join('\n')}`], { type: 'image/jpeg' }),
      release: () => undefined,
    };
  }
}

const apps: CaptureApp[] = [];
afterEach(() => { apps.splice(0).forEach((a) => a.stop()); });
async function makeApp(opts: { archive?: boolean; scanner?: FakeScanner; ocr?: MockOCRAdapter } = {}) {
  const net = new MockNetwork();
  const drive = new MockDrive(net), sheets = new MockSheets(net), archive = opts.archive ? new MockDrive(net, 'ORIGINALES') : undefined;
  const auth = new MockAuth(USERS);
  const scanner = opts.scanner ?? new FakeScanner();
  const ocr = opts.ocr ?? new MockOCRAdapter();
  const app = await CaptureApp.create({ dbName: `scan-${Math.random()}`, auth, ocr, drive, sheets, scanner, archiveDrive: archive,
    ocrOptions: { retryDelayMs: () => 5 }, syncOptions: { backoffMs: () => 0, isOnline: () => net.online }, syncDebounceMs: 60_000 });
  await auth.signIn('EDR');
  apps.push(app);
  return { app, drive, sheets, archive, scanner, ocr, net };
}

describe('escáner + núcleo', () => {
  it('crea la versión procesada, conserva el original intacto y orienta con un solo OCR', async () => {
    const { app, ocr } = await makeApp();
    const front = photo({ status: 'ok', label: 3, lines: FRONT }); // girada 270° → corrección 90°
    const back = photo({ status: 'ok', label: 1, lines: BACK }); // girada 90° → corrección 270°
    const shaFront = await sha256(front);
    const c = await app.saveCapture([{ kind: 'card_front', blob: front }, { kind: 'card_back', blob: back }, other('stand')]);
    await app.ocr.idle();
    const evs = await app.repo.evidences(c.uuid);
    const origF = evs.find((e) => e.kind === 'card_front' && e.role === 'original')!;
    const procF = evs.find((e) => e.kind === 'card_front' && e.role === 'processed')!;
    expect(origF.sha256).toBe(shaFront);
    expect(await sha256(origF.blob)).toBe(shaFront); // H: original inmutable
    expect(procF.derived_from).toBe(origF.id);
    expect(procF.file_name).toBe(`${c.external_ref}_01_card_front_scan.jpg`);
    expect(await procF.blob.text()).toContain('rot=1 max=2400'); // documento final girado 90° a la resolución del perfil
    expect(origF.scan).toMatchObject({ status: 'ok', cropped: true, rotation: 90, orientation_source: 'classifier', processed_id: procF.id });
    expect(evs.find((e) => e.kind === 'card_back' && e.role === 'original')!.scan?.rotation).toBe(270);
    expect(ocr.calls).toBe(2); // una lectura por cara
    const cap = (await app.repo.get(c.uuid))!;
    expect(cap.fields.company_name).toBe(X.company_name);
    expect(cap.fields.contact_name).toBe(X.contact_name);
    expect(cap.fields.main_products).toBe('SOLAR LIGHTING; LED LIGHTING; GARDEN LIGHTING; ALUMINIUM POLE; PLASTIC GARDEN LIGHTS');
    expect(cap.ocr_extras).toMatchObject({ secondary_companies: [X.secondary], qq: [X.qq], postal_code: [X.postal], fax: [X.fax] });
    expect(cap.ocr_status).toBe('EXTRAIDO');
    const res = await app.repo.ocrResults(c.uuid);
    expect(res.find((r) => r.side === 'front')).toMatchObject({ rotation: 90, read_from: procF.id });
  });

  it('Drive: la carpeta del proveedor recibe solo la tarjeta limpia (sin respaldo configurado: solo desarrollo)', async () => {
    const { app, drive, sheets } = await makeApp();
    const c = await app.saveCapture([{ kind: 'card_front', blob: photo({ status: 'ok', label: 0, lines: FRONT }) }, other('stand')]);
    await app.ocr.idle(); await app.syncNow(true);
    const files = [...drive.files.values()];
    expect(files.map((f) => f.name).sort()).toEqual([`${c.external_ref}_01_card_front_scan.jpg`, `${c.external_ref}_02_stand.jpg`].sort());
    expect((await app.repo.get(c.uuid))!.sync_status).toBe('CONFIRMADO');
    const row = sheets.asObjects()[0];
    expect(row.evidence_files).toMatch(/card_front \[escaneada\]: mock:\/\/drive/);
    expect(row.evidence_files).toMatch(/card_front \[original\]: \(sin respaldo configurado: solo en el teléfono\)/);
    expect(row.ocr_extras).toContain(`qq=${X.qq}`);
    expect(row.ocr_extras).toContain('segunda_empresa=HUAXIN');
    expect(Object.keys(row).slice(0, 29)).toEqual(['external_ref', 'capture_date', 'captured_by', 'mission', 'source', 'phase', 'hall', 'booth', 'company_name', 'company_name_cn', 'contact_name', 'job_title', 'phone_1', 'phone_2', 'wechat', 'whatsapp', 'email', 'website', 'address', 'city', 'province', 'country', 'supplier_type', 'main_products', 'product_interest', 'notes', 'follow_up', 'data_classification', 'processing_status']);
  });

  it('con archivo de originales: el original va a una carpeta separada y la principal sigue limpia', async () => {
    const { app, drive, archive } = await makeApp({ archive: true });
    const c = await app.saveCapture([{ kind: 'card_front', blob: photo({ status: 'ok', label: 0, lines: FRONT }) }]);
    await app.ocr.idle(); await app.syncNow(true);
    expect([...drive.files.values()].map((f) => f.name)).toEqual([`${c.external_ref}_01_card_front_scan.jpg`]);
    expect([...archive!.files.values()].map((f) => f.name)).toEqual([`${c.external_ref}_01_card_front.jpg`]);
    expect([...archive!.folders.values()][0].parent).toBe('ORIGINALES');
    const evs = await app.repo.evidences(c.uuid);
    const orig = evs.find((e) => e.role === 'original')!;
    expect(orig.archive_file_id).toBeTruthy();
    expect(orig.remote_file_id).toBeUndefined(); // no está en la carpeta del proveedor
    expect((await app.repo.get(c.uuid))!.sync_status).toBe('CONFIRMADO');
  });

  it('con bordes dudosos el original va a la carpeta del proveedor Y al respaldo restringido', async () => {
    const { app, drive, archive, sheets } = await makeApp({ archive: true });
    const c = await app.saveCapture([{ kind: 'card_front', blob: photo({ status: 'low_confidence', label: 0, lines: FRONT }) }]);
    await app.ocr.idle(); await app.syncNow(true);
    expect([...drive.files.values()].map((f) => f.name)).toEqual([`${c.external_ref}_01_card_front.jpg`]);
    expect([...archive!.files.values()].map((f) => f.name)).toEqual([`${c.external_ref}_01_card_front.jpg`]);
    expect(sheets.asObjects()[0].evidence_files).toMatch(/respaldo restringido/);
    expect((await app.repo.get(c.uuid))!.sync_status).toBe('CONFIRMADO');
  });

  it('si el respaldo falla, la captura no se confirma aunque la carpeta principal esté completa', async () => {
    const { app, archive } = await makeApp({ archive: true });
    const c = await app.saveCapture([{ kind: 'card_front', blob: photo({ status: 'ok', label: 0, lines: FRONT }) }]);
    await app.ocr.idle();
    archive!.uploadEvidence = async () => { throw new Error('Sin permiso en la carpeta de respaldo'); };
    await app.syncNow(true);
    const cap = (await app.repo.get(c.uuid))!;
    expect(cap.sync_status).toBe('ERROR');
    expect(cap.sync_error).toMatch(/respaldo/);
  });

  it('mientras el escaneo no termina, la foto con manos no va a la carpeta principal y no se confirma', async () => {
    const slow = new MockOCRAdapter({ delayMs: 120 });
    const { app, drive, archive } = await makeApp({ archive: true, ocr: slow });
    const c = await app.saveCapture([{ kind: 'card_front', blob: photo({ status: 'ok', label: 0, lines: FRONT }) }]);
    await app.syncNow(true); // sincroniza antes de que termine el OCR
    expect(drive.files.size).toBe(0);
    expect(archive!.files.size).toBe(1); // el original queda protegido en el archivo cuanto antes
    expect((await app.repo.get(c.uuid))!.sync_status).toBe('PENDIENTE');
    await app.ocr.idle(); await app.syncNow(true);
    expect([...drive.files.values()].map((f) => f.name)).toEqual([`${c.external_ref}_01_card_front_scan.jpg`]);
    expect((await app.repo.get(c.uuid))!.sync_status).toBe('CONFIRMADO');
  });

  it('bordes dudosos o varias tarjetas: no se recorta, se conserva la foto y se pide revisión', async () => {
    const { app, drive, sheets } = await makeApp();
    const c = await app.saveCapture([{ kind: 'card_front', blob: photo({ status: 'low_confidence', label: 0, lines: FRONT }) },
      { kind: 'card_back', blob: photo({ status: 'ok', multiple: true, label: 0, lines: BACK }) }]);
    await app.ocr.idle(); await app.syncNow(true);
    const evs = await app.repo.evidences(c.uuid);
    expect(evs.filter((e) => e.role === 'processed')).toHaveLength(0);
    const cap = (await app.repo.get(c.uuid))!;
    expect(cap.ocr_status).toBe('REQUIERE_REVISION');
    expect(cap.scan_issues?.join(' ')).toMatch(/frontal: bordes no detectados/);
    expect(cap.scan_issues?.join(' ')).toMatch(/reverso: varias tarjetas/);
    expect(cap.fields.company_name).toBe(X.company_name); // el OCR sí se hizo (orientado)
    expect([...drive.files.values()].map((f) => f.name).sort()).toEqual([`${c.external_ref}_01_card_front.jpg`, `${c.external_ref}_02_card_back.jpg`]);
    expect(sheets.asObjects()[0].review_fields).toContain('escaneo');
  });

  it('decisiones de recorte en la captura: «auto» viaja como recorte APROBADO, «manual» y «full» como esquinas exactas', async () => {
    const { app, scanner } = await makeApp();
    const q = [{ x: 5, y: 5 }, { x: 95, y: 6 }, { x: 94, y: 65 }, { x: 6, y: 64 }];
    for (const decision of ['auto', 'manual', 'full'] as const) {
      scanner.calls.length = 0;
      const c = await app.saveCapture([{ kind: 'card_front', blob: photo({ status: 'ok', label: 0, lines: FRONT }), crop: { decision, quad: q, detector: { status: 'ok', confidence: 0.9 } } }]);
      await app.ocr.idle();
      const call = scanner.calls.at(-1)!;
      if (decision === 'auto') { expect(call.approvedQuad).toEqual(q); expect(call.manualQuad).toBeUndefined(); }
      else { expect(call.manualQuad).toEqual(q); expect(call.approvedQuad).toBeUndefined(); }
      const orig = (await app.repo.evidences(c.uuid)).find((e) => e.role === 'original')!;
      expect(orig.crop?.decision).toBe(decision);
      expect(orig.scan?.manual_quad).toEqual(q); // lo aprobado queda registrado tal cual
    }
  });

  it('esquinas manuales: el reproceso usa las esquinas indicadas y genera una versión nueva sin borrar la anterior', async () => {
    const { app, scanner } = await makeApp();
    const c = await app.saveCapture([{ kind: 'card_front', blob: photo({ status: 'low_confidence', label: 0, lines: FRONT }) }]);
    await app.ocr.idle();
    const orig = (await app.repo.evidences(c.uuid)).find((e) => e.role === 'original')!;
    const quad = [{ x: 1, y: 1 }, { x: 99, y: 2 }, { x: 98, y: 69 }, { x: 2, y: 68 }];
    await app.setManualCorners(orig.id, quad);
    await app.ocr.idle();
    expect(scanner.calls.at(-1)!.manualQuad).toEqual(quad);
    const evs = await app.repo.evidences(c.uuid);
    const proc = evs.filter((e) => e.role === 'processed');
    expect(proc).toHaveLength(1);
    expect(evs.find((e) => e.id === orig.id)!.scan).toMatchObject({ status: 'manual', cropped: true, manual_quad: quad });
    expect((await app.repo.get(c.uuid))!.scan_issues).toEqual([]);
    // un segundo reproceso sustituye (no borra) la versión anterior
    await app.reprocessOcr(c.uuid); await app.ocr.idle();
    const after = (await app.repo.evidences(c.uuid)).filter((e) => e.role === 'processed');
    expect(after).toHaveLength(2);
    expect(after.filter((e) => !e.superseded_by)).toHaveLength(1);
    expect(after.find((e) => !e.superseded_by)!.file_name).toBe(`${c.external_ref}_01_card_front_scan_v2.jpg`);
  });
});

describe('reproceso de un registro existente (estructura del caso CF26F2-EDR-HDHG-0001, datos ficticios)', () => {
  it('reutiliza fotos, conserva bloqueos humanos y trazabilidad, sin duplicar proveedor, carpeta ni fila', async () => {
    // 1) Estado "histórico": captura hecha con la versión anterior (sin escáner): originales ya subidos a la
    //    carpeta principal y OCR erróneo (productos tomados como persona).
    const net = new MockNetwork(); const drive = new MockDrive(net), sheets = new MockSheets(net);
    const auth = new MockAuth(USERS); const db = `legacy-${Math.random()}`;
    const front = photo({ status: 'ok', label: 3, lines: FRONT }), back = photo({ status: 'ok', label: 1, lines: BACK });
    const legacyOcr = new MockOCRAdapter({ resolver: async () => [{ text: 'l1I DSlLL', score: 0.4 }] }); // anverso girado: casi ilegible
    const old = await CaptureApp.create({ dbName: db, auth, ocr: legacyOcr, drive, sheets, syncOptions: { backoffMs: () => 0 }, syncDebounceMs: 60_000 });
    await auth.signIn('EDR');
    const c = await old.saveCapture([{ kind: 'card_front', blob: front }, { kind: 'card_back', blob: back }]);
    await old.ocr.idle();
    // lo que guardó el parser anterior (el nuevo ya no produce este error, ver extract-real.test.ts)
    await old.repo.update(c.uuid, (x) => { x.fields.contact_name = 'PLASTIC GARDEN LIGHTS'; x.field_meta.contact_name = { source: 'ocr_back', status: 'review' }; }, { bump: true });
    await old.repo.saveOcrResult({ key: `${c.uuid}:back`, capture_uuid: c.uuid, side: 'back', evidence_id: 'x', engine: 'paddle-anterior', lines: [], text: 'PLASTIC GARDEN LIGHTS', ms: 1, created_at: new Date().toISOString() });
    await old.syncNow(true);
    expect((await old.repo.get(c.uuid))!.fields.contact_name).toBe('PLASTIC GARDEN LIGHTS'); // el fallo reportado
    await old.editFields(c.uuid, { booth: '11.2 C15' }); // corrección humana previa (bloqueada)
    await old.syncNow(true);
    old.stop(); old.repo.db.close();
    expect(drive.folders.size).toBe(1); expect(drive.files.size).toBe(2); expect(sheets.rows).toHaveLength(1);

    // 2) Nueva versión con escáner: reprocesar la MISMA captura.
    const archive = new MockDrive(net, 'ORIGINALES_FASE2');
    const app = await CaptureApp.create({ dbName: db, auth, ocr: new MockOCRAdapter(), drive, sheets, scanner: new FakeScanner(), archiveDrive: archive,
      syncOptions: { backoffMs: () => 0 }, syncDebounceMs: 60_000 });
    apps.push(app);
    await app.reprocessOcr(c.uuid); await app.ocr.idle(); await app.syncNow(true);
    const cap = (await app.repo.get(c.uuid))!;
    expect(cap.external_ref).toBe(c.external_ref);
    expect(cap.fields.contact_name).toBe(X.contact_name);
    expect(cap.fields.company_name).toBe(X.company_name);
    expect(cap.fields.main_products).toContain('PLASTIC GARDEN LIGHTS');
    expect(cap.fields.booth).toBe('11.2 C15'); // bloqueo humano respetado
    expect(cap.sync_status).toBe('CONFIRMADO');
    // sin duplicados: misma carpeta, misma fila; los originales ya subidos NO se vuelven a subir ni se borran
    expect(drive.folders.size).toBe(1);
    expect(sheets.rows).toHaveLength(1);
    const names = [...drive.files.values()].map((f) => f.name).sort();
    expect(names).toEqual([`${c.external_ref}_01_card_front.jpg`, `${c.external_ref}_01_card_front_scan.jpg`, `${c.external_ref}_02_card_back.jpg`, `${c.external_ref}_02_card_back_scan.jpg`]);
    const row = sheets.asObjects()[0];
    expect(row.capture_uuid).toBe(c.uuid);
    expect(row.contact_name).toBe(X.contact_name);
    expect(row.evidence_files).toMatch(/card_front \[escaneada\]/);
    // trazabilidad del OCR anterior
    const audit = await app.repo.audit(c.uuid);
    const superseded = audit.filter((a) => a.type === 'OCR_RESULT_SUPERSEDED');
    expect(superseded).toHaveLength(2);
    expect(JSON.stringify(superseded)).toContain('PLASTIC GARDEN LIGHTS');
    // los originales históricos también quedan respaldados en la carpeta restringida (sin tocar la principal)
    expect([...archive.files.values()].map((f) => f.name).sort()).toEqual([`${c.external_ref}_01_card_front.jpg`, `${c.external_ref}_02_card_back.jpg`]);
    // idempotente: repetir la sincronización no crea nada
    await app.syncNow(true);
    expect(drive.files.size).toBe(4); expect(archive.files.size).toBe(2); expect(sheets.rows).toHaveLength(1);
  });
});
