// Regresión del defecto de Drive (búsqueda por evidence_id sin acotar a la carpeta de destino) y garantías de
// la sincronización con los adaptadores Google REALES contra un emulador de Drive/Sheets:
// destinos correctos, misma evidencia en dos carpetas, reintentos sin duplicados, fila coherente con los
// archivos, errores remotos nunca presentados como éxito y reparación no destructiva de enlaces mal archivados.
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { openCaptureDB } from '../src/storage/db';
import { CaptureRepo } from '../src/storage/repo';
import { SyncEngine, uploadPlan } from '../src/sync/SyncEngine';
import { GoogleDriveAdapter, GoogleSheetsAdapter } from '../src/adapters/google';
import { MockAuth } from '../src/adapters/mock';
import type { DriveAdapter } from '../src/adapters/contracts';
import type { EvidenceScan, UserProfile } from '../src/domain/schema';
import { fakeGoogle } from './support/fake-google';
import { classifySyncError } from '../src/ui/model';
/** las pruebas no esperan de verdad entre reintentos */
const NO_WAIT = async () => undefined;

const USER: UserProfile = { id: 'EDR', name: 'Eder' };
const FOLDER = 'application/vnd.google-apps.folder';
let n = 0;

type Hook = (url: string, init: RequestInit) => Response | undefined;
async function setup(opts: { mainDrive?: (real: GoogleDriveAdapter, g: ReturnType<typeof fakeGoogle>) => DriveAdapter } = {}) {
  const g = fakeGoogle();
  let hook: Hook | undefined;
  const f = (async (i: RequestInfo | URL, init: RequestInit = {}) => hook?.(String(i), init) ?? g.fetch(i, init)) as typeof fetch;
  const auth = new MockAuth([USER]); await auth.signIn('EDR');
  const repo = new CaptureRepo(await openCaptureDB(`drive-reg-${++n}-${Math.random()}`));
  const realMain = new GoogleDriveAdapter(auth, 'ROOT_MAIN', f, undefined, NO_WAIT);
  const archive = new GoogleDriveAdapter(auth, 'ROOT_ARCHIVE', f, undefined, NO_WAIT);
  const sheets = new GoogleSheetsAdapter(auth, 'SHEET', 'CAPTURA_FASE2', f);
  const mk = (main: DriveAdapter) => new SyncEngine(repo, main, sheets, { archive, scannerEnabled: true, backoffMs: () => 0, isOnline: () => true });
  const sync = mk(opts.mainDrive ? opts.mainDrive(realMain, g) : realMain);
  return { g, repo, sync, fixedSync: mk(realMain), setHook: (h?: Hook) => { hook = h; } };
}

const jpeg = (s: string) => new Blob([`\xFF\xD8${s}`], { type: 'image/jpeg' });
async function capture(repo: CaptureRepo, mode: 'cropped' | 'not_cropped') {
  const c = await repo.createCapture(USER, [{ kind: 'card_front', blob: jpeg('front') }, { kind: 'stand', blob: jpeg('stand') }]);
  const front = (await repo.evidences(c.uuid)).find((e) => e.kind === 'card_front')!;
  const scan: EvidenceScan = { status: mode === 'cropped' ? 'ok' : 'not_found', confidence: mode === 'cropped' ? 0.98 : 0.2, multiple: false, reasons: [],
    cropped: mode === 'cropped', rotation: 0, orientation_source: 'none', orientation_confident: false, at: new Date().toISOString() };
  await repo.saveScanResult(c.uuid, front.id, scan, mode === 'cropped' ? jpeg('processed') : undefined);
  await repo.update(c.uuid, (x) => { x.ocr_status = 'EXTRAIDO'; x.fields.company_name = 'Demo Valves Co.'; }, { bump: true });
  return c.uuid;
}
const filesIn = (g: ReturnType<typeof fakeGoogle>, parent?: string) => g.files.filter((f) => f.mimeType !== FOLDER && !!parent && f.parents.includes(parent));
const rows = (g: ReturnType<typeof fakeGoogle>) => { const [head, ...rest] = g.grid; return rest.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? '']))); };

describe('Drive: destinos correctos y la misma evidencia en dos carpetas', () => {
  it('tarjeta SIN recorte: el original va a la carpeta del proveedor Y al respaldo restringido como archivos distintos', async () => {
    const { g, repo, sync } = await setup();
    const uuid = await capture(repo, 'not_cropped');
    expect(await sync.syncOne(uuid)).toBe('confirmed');
    const c = (await repo.get(uuid))!;
    const front = (await repo.evidences(uuid)).find((e) => e.kind === 'card_front')!;
    expect(front.remote_file_id).toBeTruthy();
    expect(front.archive_file_id).toBeTruthy();
    expect(front.remote_file_id).not.toBe(front.archive_file_id);
    expect(g.files.find((f) => f.id === front.remote_file_id)!.parents).toEqual([c.remote!.folder_id]);
    expect(g.files.find((f) => f.id === front.archive_file_id)!.parents).toEqual([c.remote!.archive_folder_id]);
    expect(filesIn(g, c.remote!.folder_id).map((f) => f.appProperties.kind).sort()).toEqual(['card_front', 'stand']);
    expect(filesIn(g, c.remote!.archive_folder_id).map((f) => f.appProperties.kind)).toEqual(['card_front']);
  });

  it('tarjeta recortada: el procesado va a la carpeta del proveedor y el original solo al respaldo', async () => {
    const { g, repo, sync } = await setup();
    const uuid = await capture(repo, 'cropped');
    expect(await sync.syncOne(uuid)).toBe('confirmed');
    const c = (await repo.get(uuid))!;
    const evs = await repo.evidences(uuid);
    const orig = evs.find((e) => e.kind === 'card_front' && e.role !== 'processed')!;
    const proc = evs.find((e) => e.role === 'processed')!;
    expect(proc.derived_from).toBe(orig.id);
    expect(orig.remote_file_id).toBeUndefined();
    expect(g.files.find((f) => f.id === proc.remote_file_id)!.parents).toEqual([c.remote!.folder_id]);
    expect(g.files.find((f) => f.id === orig.archive_file_id)!.parents).toEqual([c.remote!.archive_folder_id]);
    expect(filesIn(g, c.remote!.folder_id).map((f) => f.appProperties.evidence_id).sort()).toEqual([proc.id, evs.find((e) => e.kind === 'stand')!.id].sort());
  });

  it('la fila de Sheets enlaza exactamente los archivos almacenados en Drive', async () => {
    const { g, repo, sync } = await setup();
    const uuid = await capture(repo, 'not_cropped');
    await sync.syncOne(uuid);
    const c = (await repo.get(uuid))!;
    const [row] = rows(g);
    expect(row.capture_uuid).toBe(uuid);
    expect(row.evidence_folder_id).toBe(c.remote!.folder_id);
    for (const e of await repo.evidences(uuid)) {
      if (e.remote_file_id) { expect(row.evidence_files).toContain(e.remote_url); expect(g.files.some((f) => f.id === e.remote_file_id)).toBe(true); }
      if (e.archive_file_id) expect(g.files.some((f) => f.id === e.archive_file_id)).toBe(true);
    }
  });
});

describe('la foto original nunca se publica antes de que el escáner la recorte', () => {
  it('con decisión de recorte guardada (scan provisional), la carpeta del proveedor ESPERA; el respaldo sí recibe el original', async () => {
    const { repo } = await setup();
    const q = [{ x: 5, y: 5 }, { x: 95, y: 6 }, { x: 94, y: 65 }, { x: 6, y: 64 }];
    for (const decision of ['auto', 'manual', 'full'] as const) {
      const c = await repo.createCapture(USER, [{ kind: 'card_front', blob: jpeg('front'), crop: { decision, quad: q } }]);
      const [front] = await repo.evidences(c.uuid);
      expect(front.scan?.manual_quad).toEqual(q); // existe el scan provisional con las esquinas aprobadas
      const cap = (await repo.get(c.uuid))!;
      expect(cap.ocr_status).toBe('CAPTURADO');
      expect(uploadPlan(cap, [front], { archive: true, scannerEnabled: true }).get(front.id)).toEqual({ main: 'wait', archive: 'upload' });
    }
  });
});

describe('incidente HCT: Drive lleno de la cuenta que sube → carpetas vacías, sin fila; recuperación automática e idempotente', () => {
  it('reproduce los síntomas sin falso «confirmado» y recupera en las MISMAS carpetas con una fila por capture_uuid', async () => {
    const { g, repo, sync } = await setup();
    const HECTOR: UserProfile = { id: 'HCT', name: 'Héctor' };
    // una captura de Eder ya sincronizada (sus filas no deben cambiar)
    const eder = await capture(repo, 'cropped');
    expect(await sync.syncOne(eder)).toBe('confirmed');
    const ederRow = JSON.stringify(rows(g));
    // tres capturas de Héctor
    const hct: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await repo.createCapture(HECTOR, [{ kind: 'card_front', blob: jpeg(`hct-front-${i}`) }, { kind: 'stand', blob: jpeg(`hct-stand-${i}`) }]);
      await repo.update(c.uuid, (x) => { x.ocr_status = 'EXTRAIDO'; x.fields.company_name = `Demo HCT ${i}`; }, { bump: true });
      hct.push(c.uuid);
    }
    // el Drive de Héctor está lleno: los archivos cuentan en la cuota de quien SUBE (las carpetas no ocupan espacio)
    g.quotaFull = true;
    await sync.syncAll({ force: true });
    const folders = g.files.filter((f) => f.mimeType === FOLDER && /^CF26F2-HCT-/.test(f.name));
    expect(folders).toHaveLength(6); // carpeta del proveedor + carpeta del respaldo por captura…
    for (const f of folders) expect(filesIn(g, f.id)).toHaveLength(0); // …ambas VACÍAS, como en Drive real
    expect(rows(g).filter((r) => r.captured_by === 'Héctor')).toHaveLength(0); // ninguna fila HCT
    expect(JSON.stringify(rows(g))).toBe(ederRow);
    for (const u of hct) {
      const c = (await repo.get(u))!;
      expect(c.sync_status).toBe('ERROR'); // nunca CONFIRMADO con una carpeta vacía
      expect(c.sync_error).toMatch(/storageQuotaExceeded/);
    }
    const { ledgerRow } = await import('../src/sync/ledger');
    const before = await Promise.all(hct.map(async (u) => ledgerRow((await repo.get(u))!, await repo.evidences(u), { archive: true, scannerEnabled: true })));
    for (const l of before) expect(l).toMatchObject({ sync_status: 'ERROR', drive_folder: true, archive_folder: true, main: { uploaded: 0 }, archive: { uploaded: 0 } });

    // Héctor libera espacio: el ciclo AUTOMÁTICO (sin pulsar «Sincronizar») completa todo
    g.quotaFull = false;
    await sync.syncAll();
    const ref = (u: string) => repo.get(u).then((c) => c!);
    for (const u of hct) {
      const c = await ref(u);
      expect(c.sync_status).toBe('CONFIRMADO');
      expect(filesIn(g, c.remote!.folder_id).length).toBeGreaterThan(0);
      expect(filesIn(g, c.remote!.archive_folder_id).length).toBeGreaterThan(0);
    }
    expect(g.files.filter((f) => f.mimeType === FOLDER && /^CF26F2-HCT-/.test(f.name))).toHaveLength(6); // mismas carpetas, ninguna nueva
    const hctRows = rows(g).filter((r) => r.captured_by === 'Héctor');
    expect(hctRows.map((r) => r.capture_uuid).sort()).toEqual([...hct].sort());
    for (const r of hctRows) expect(r.external_ref).toMatch(/^CF26F2-HCT-/);
    expect(rows(g).filter((r) => r.captured_by === 'Eder')).toHaveLength(1);
    // idempotencia: otra pasada no crea archivos ni filas
    const nFiles = g.files.length, nRows = rows(g).length;
    await sync.syncAll({ force: true });
    expect(g.files.length).toBe(nFiles);
    expect(rows(g).length).toBe(nRows);
  });
});

describe('sesión de Google, capturas antiguas y originales', () => {
  it('la sesión de Google expira a mitad de la subida → ERROR de sesión; al renovarla se completa sin duplicar', async () => {
    const { g, repo, sync, setHook } = await setup();
    const uuid = await capture(repo, 'not_cropped');
    let n = 0;
    setHook((url, init) => (init.method === 'PUT' && url.includes('/upload/') && ++n === 1 ? new Response('{}', { status: 401 }) : undefined));
    expect(await sync.syncOne(uuid)).toBe('auth');
    const c = (await repo.get(uuid))!;
    expect(c.sync_status).toBe('ERROR');
    expect(classifySyncError(c.sync_error).kind).toBe('auth');
    setHook(undefined); // sesión renovada
    expect(await sync.syncOne(uuid)).toBe('confirmed');
    const ids = g.files.filter((f) => f.mimeType !== FOLDER).map((f) => `${f.parents[0]}:${f.appProperties.evidence_id}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rows(g)).toHaveLength(1);
  });

  it('captura ANTIGUA (sin sha256, sin escaneo, sin decisión de recorte) se sincroniza igual y una sola vez', async () => {
    const { g, repo, sync } = await setup();
    const c = await repo.createCapture(USER, [{ kind: 'card_front', blob: jpeg('legacy-front') }]);
    await repo.update(c.uuid, (x) => { x.ocr_status = 'EXTRAIDO'; x.app_version = '1.0.0'; }, { bump: true });
    const [ev] = await repo.evidences(c.uuid);
    // como la escribía la v1.0: sin sha256 ni escaneo (escritura directa en la base de PRUEBA)
    await (repo as unknown as { db: { put(s: string, v: unknown): Promise<unknown> } }).db.put('evidences', { ...ev, sha256: undefined, scan: undefined });
    expect(await sync.syncOne(c.uuid)).toBe('confirmed');
    expect(rows(g).map((r) => r.capture_uuid)).toEqual([c.uuid]);
  });

  it('los ORIGINALES llegan al respaldo byte a byte y el teléfono los conserva intactos', async () => {
    const { g, repo, sync } = await setup();
    const uuid = await capture(repo, 'cropped');
    const orig = (await repo.evidences(uuid)).find((e) => e.kind === 'card_front' && e.role === 'original')!;
    const before = new Uint8Array(await orig.blob.arrayBuffer());
    expect(await sync.syncOne(uuid)).toBe('confirmed');
    const af = (await repo.get(uuid))!.remote!.archive_folder_id;
    const archived = g.files.find((f) => f.parents[0] === af && f.appProperties.evidence_id === orig.id)!;
    expect([...archived.bytes!]).toEqual([...before]);
    const after = new Uint8Array(await (await repo.getEvidence(orig.id))!.blob.arrayBuffer());
    expect([...after]).toEqual([...before]);
  });
});

describe('reintentos: sin archivos ni filas duplicadas', () => {
  it('fallo a mitad de la subida → ERROR (no CONFIRMADO); el reintento completa sin duplicar', async () => {
    const { g, repo, sync, setHook } = await setup();
    const uuid = await capture(repo, 'not_cropped');
    let uploads = 0;
    // Drive deja de responder a mitad de las subidas (la subida reanudable reintenta cada bloque; aquí el fallo persiste)
    setHook((url) => (url.includes('/upload/') && ++uploads >= 2 ? new Response('{}', { status: 503 }) : undefined));
    expect(await sync.syncOne(uuid)).toBe('failed');
    expect((await repo.get(uuid))!.sync_status).toBe('ERROR');
    expect(rows(g)).toHaveLength(0); // ninguna fila con evidencias a medias
    setHook(undefined);
    expect(await sync.syncOne(uuid)).toBe('confirmed');
    for (let i = 0; i < 2; i++) { await repo.update(uuid, (x) => { x.fields.notes = `nota ${i}`; }, { bump: true }); await sync.syncOne(uuid); }
    const ids = g.files.filter((f) => f.mimeType !== FOLDER).map((f) => `${f.parents[0]}:${f.appProperties.evidence_id}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3); // anverso (principal) + stand (principal) + anverso (respaldo)
    expect(rows(g)).toHaveLength(1);
    expect(rows(g)[0].notes).toBe('nota 1');
  });
});

describe('errores remotos nunca presentados como sincronización satisfactoria', () => {
  it('Drive responde 200 sin identificador → ERROR', async () => {
    const { g, repo, sync } = await setup();
    const uuid = await capture(repo, 'not_cropped');
    g.uploadWithoutIdNext();
    expect(await sync.syncOne(uuid)).toBe('failed');
    const c = (await repo.get(uuid))!;
    expect(c.sync_status).toBe('ERROR');
    expect(c.sync_error).toMatch(/no devolvió el identificador/);
    expect(c.synced_revision).toBe(0);
  });

  it('Sheets 403 → ERROR con el motivo, sin marcar la revisión como enviada', async () => {
    const { repo, sync, setHook } = await setup();
    const uuid = await capture(repo, 'cropped');
    setHook((url) => (url.includes('sheets.googleapis.com') ? new Response('permiso denegado', { status: 403 }) : undefined));
    expect(await sync.syncOne(uuid)).toBe('failed');
    const c = (await repo.get(uuid))!;
    expect(c.sync_status).toBe('ERROR');
    expect(c.sync_error).toMatch(/403/);
    expect(c.synced_revision).toBe(0);
  });
});

describe('defecto anterior (búsqueda sin carpeta) y reparación no destructiva', () => {
  /** Reproduce la consulta de v1.1/v1.2-rc: busca el evidence_id en TODO Drive, sin `'<carpeta>' in parents`. */
  const unscoped = (real: GoogleDriveAdapter, g: ReturnType<typeof fakeGoogle>): DriveAdapter => ({
    ensureCaptureFolder: (c) => real.ensureCaptureFolder(c),
    uploadEvidence: async (folderId, e) => {
      const any = g.files.find((f) => f.appProperties?.evidence_id === e.evidence_id);
      return any ? { fileId: any.id, url: `https://drive/${any.id}` } : real.uploadEvidence(folderId, e);
    },
  });

  it('con la búsqueda sin acotar, la carpeta del proveedor se quedaba sin la tarjeta (se reproduce el defecto)', async () => {
    const { g, repo, sync } = await setup({ mainDrive: unscoped });
    const uuid = await capture(repo, 'not_cropped');
    expect(await sync.syncOne(uuid)).toBe('confirmed'); // ¡se declaraba confirmado!
    const c = (await repo.get(uuid))!;
    const front = (await repo.evidences(uuid)).find((e) => e.kind === 'card_front')!;
    expect(front.remote_file_id).toBe(front.archive_file_id);
    expect(filesIn(g, c.remote!.folder_id).map((f) => f.appProperties.kind)).toEqual(['stand']);
  });

  it('al arrancar la versión corregida se repara: se sube a la carpeta del proveedor, el respaldo queda intacto y la fila se corrige', async () => {
    const { g, repo, sync, fixedSync } = await setup({ mainDrive: unscoped });
    const uuid = await capture(repo, 'not_cropped');
    await sync.syncOne(uuid);
    const archiveId = (await repo.evidences(uuid)).find((e) => e.kind === 'card_front')!.archive_file_id!;
    const before = g.files.length;

    expect(await fixedSync.repairMisfiledEvidence()).toBe(1);
    expect((await repo.get(uuid))!.sync_status).toBe('PENDIENTE');
    expect((await repo.audit(uuid)).map((a) => a.type)).toContain('DRIVE_LINK_REPAIRED');
    expect(await fixedSync.repairMisfiledEvidence()).toBe(0); // idempotente

    await fixedSync.syncAll();
    const c = (await repo.get(uuid))!;
    const front = (await repo.evidences(uuid)).find((e) => e.kind === 'card_front')!;
    expect(c.sync_status).toBe('CONFIRMADO');
    expect(front.archive_file_id).toBe(archiveId); // el respaldo no se toca
    expect(front.remote_file_id).not.toBe(archiveId);
    expect(g.files.find((f) => f.id === front.remote_file_id)!.parents).toEqual([c.remote!.folder_id]);
    expect(g.files.length).toBe(before + 1); // solo se añade la copia que faltaba; nada se borra
    expect(rows(g)).toHaveLength(1);
    expect(rows(g)[0].evidence_files).toContain(front.remote_url);
  });

  it('versiones antiguas con remote_target "archive": el enlace pasa a respaldo y la carpeta principal se completa', async () => {
    const { g, repo, fixedSync } = await setup();
    const uuid = await capture(repo, 'not_cropped');
    const front = (await repo.evidences(uuid)).find((e) => e.kind === 'card_front')!;
    await repo.updateEvidence(front.id, { remote_file_id: 'LEGACY1', remote_url: 'https://drive/LEGACY1', remote_target: 'archive' });
    await repo.update(uuid, (x) => { x.sync_status = 'CONFIRMADO'; x.synced_revision = x.revision; });
    expect(await fixedSync.repairMisfiledEvidence()).toBe(1);
    const fixedEv = (await repo.evidences(uuid)).find((e) => e.id === front.id)!;
    expect(fixedEv).toMatchObject({ archive_file_id: 'LEGACY1', remote_file_id: undefined });
    await fixedSync.syncAll();
    const c = (await repo.get(uuid))!;
    expect(c.sync_status).toBe('CONFIRMADO');
    expect(filesIn(g, c.remote!.folder_id).map((f) => f.appProperties.kind).sort()).toEqual(['card_front', 'stand']);
  });
});

describe('producción: reparaciones de enlaces solo con aprobación del operador', () => {
  it('al arrancar solo se detecta (no se modifica nada); la reparación requiere la acción explícita', async () => {
    const { CaptureApp } = await import('../src/app/service');
    const { MockOCRAdapter } = await import('../src/ocr/mock');
    const g = fakeGoogle();
    const auth = new MockAuth([USER]); await auth.signIn('EDR');
    const app = await CaptureApp.create({
      dbName: `drive-prod-${++n}-${Math.random()}`, auth, ocr: new MockOCRAdapter({ delayMs: 1 }), resources: false, syncDebounceMs: 60_000,
      drive: new GoogleDriveAdapter(auth, 'ROOT_MAIN', g.fetch, undefined, NO_WAIT), archiveDrive: new GoogleDriveAdapter(auth, 'ROOT_ARCHIVE', g.fetch, undefined, NO_WAIT),
      sheets: new GoogleSheetsAdapter(auth, 'SHEET', 'CAPTURA_FASE2', g.fetch), autoRepairLinks: false,
    });
    try {
      const uuid = await capture(app.repo, 'not_cropped');
      const front = (await app.repo.evidences(uuid)).find((e) => e.kind === 'card_front')!;
      await app.repo.updateEvidence(front.id, { remote_file_id: 'SAME', remote_url: 'https://drive/SAME', archive_file_id: 'SAME', archive_url: 'https://drive/SAME' });
      await app.repo.update(uuid, (x) => { x.sync_status = 'CONFIRMADO'; x.synced_revision = x.revision; });

      const r = await app.start();
      expect(r).toMatchObject({ repairedLinks: 0, misfiledLinks: 1 });
      const untouched = (await app.repo.evidences(uuid)).find((e) => e.id === front.id)!;
      expect(untouched).toMatchObject({ remote_file_id: 'SAME', archive_file_id: 'SAME' });
      expect((await app.repo.get(uuid))!.sync_status).toBe('CONFIRMADO');
      expect((await app.findMisfiledLinks()).refs).toEqual([(await app.repo.get(uuid))!.external_ref]);

      expect(await app.repairMisfiledLinks()).toBe(1); // acción explícita (botón + confirmación en Ajustes)
      const fixed = (await app.repo.evidences(uuid)).find((e) => e.id === front.id)!;
      expect(fixed).toMatchObject({ remote_file_id: undefined, archive_file_id: 'SAME' });
      expect((await app.repo.get(uuid))!.sync_status).toBe('PENDIENTE');
      expect((await app.findMisfiledLinks()).evidences).toBe(0);
    } finally { app.stop(); }
  });
});
