// Controles de memoria y recuperación para Android (gobernador de recursos + motor reutilizable).
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { CaptureApp } from '../src/app/service';
import { MockAuth, MockDrive, MockNetwork, MockSheets } from '../src/adapters/mock';
import { MockOCRAdapter } from '../src/ocr/mock';
import type { DocumentScanner, ScanOptions, ScanSession } from '../src/scanner/types';
import type { UserProfile } from '../src/domain/schema';
import { openCaptureDB } from '../src/storage/db';
import { CaptureRepo } from '../src/storage/repo';
import { ResourceGovernor } from '../src/pipeline/resources';
import { processDocument } from '../src/scanner/engine';
import { BUSINESS_CARD, A4_DOCUMENT } from '../src/scanner/profiles';
import { TWIN_FRONT } from './fixtures/twin-card';

const USERS: UserProfile[] = [{ id: 'EDR', name: 'Eder' }];
const photo = () => new Blob(['\xFF\xD8 foto'], { type: 'image/jpeg' });

/** Escáner simulado que registra el orden de las operaciones y la memoria "residente". */
class TracingScanner implements DocumentScanner {
  log: string[] = [];
  alive = false;
  opts: ScanOptions[] = [];
  hang = false;
  constructor(private ocr?: TracingOCR) {}
  async scan(_b: Blob, o: ScanOptions = {}): Promise<ScanSession> {
    this.opts.push(o);
    if (this.hang) return new Promise(() => undefined); // nunca responde (Worker colgado)
    this.alive = true;
    this.log.push(`scan${this.ocr?.loaded ? ' [OCR EN MEMORIA]' : ''}`);
    return {
      analysis: { status: 'ok', confidence: 0.9, multiple: false, reasons: [], orientationProbs: [0.92, 0.03, 0.03, 0.02], source: { width: 4000, height: 3000 },
        output: { width: 2000, height: 1150 }, cropped: true, ms: { decode: 1, detect: 1, warp: 1, classify: 1, total: 4 } },
      render: async (rot, r = {}) => { this.log.push(`render rot=${rot} max=${r.maxSide}`); return new Blob([`\xFF\xD8\nMOCKOCR\n${TWIN_FRONT.join('\n')}`], { type: 'image/jpeg' }); },
      release: () => { this.log.push('release'); },
    };
  }
  terminate() { if (this.alive) this.log.push('terminate'); this.alive = false; }
}
class TracingOCR extends MockOCRAdapter {
  loaded = false; scanner?: TracingScanner; disposals = 0;
  async recognize(b: Blob) { this.loaded = true; this.scanner?.log.push(`ocr${this.scanner.alive ? ' [ESCÁNER EN MEMORIA]' : ''}`); return super.recognize(b); }
  async dispose() { if (this.loaded) this.disposals++; this.loaded = false; }
}

const apps: CaptureApp[] = [];
afterEach(() => { apps.splice(0).forEach((a) => a.stop()); });

describe('gobernador de recursos', () => {
  it('perfil bajo (≤ 4 GB): el escáner y PaddleOCR nunca residen a la vez en memoria', async () => {
    const ocr = new TracingOCR(); const scanner = new TracingScanner(ocr); ocr.scanner = scanner;
    const repo = new CaptureRepo(await openCaptureDB(`gov-${Math.random()}`));
    const governor = await ResourceGovernor.create(repo, { deviceMemoryGb: 3 });
    expect(governor.profile).toBe('low');
    ocr.loaded = true; // PaddleOCR cargado de una captura anterior
    const r = await processDocument({ ocr, scanner, governor }, { blob: photo(), profile: BUSINESS_CARD, jobId: 'x', mode: governor.modeFor(1) });
    expect(r.processed).toBeTruthy();
    expect(scanner.log.some((l) => l.includes('EN MEMORIA'))).toBe(false);
    expect(scanner.log).toEqual(['scan', 'render rot=0 max=1600', 'render rot=0 max=2400', 'release', 'terminate', 'ocr']);
    expect(scanner.opts[0].fullSide).toBe(2400); // modo reducido en perfil bajo
    expect(await repo.getMeta('resources:heavy_task')).toBeNull(); // marcador limpio al terminar
  });

  it('perfil estándar: sin terminar Workers entre etapas (más rápido), decodificación completa', async () => {
    const ocr = new TracingOCR(); const scanner = new TracingScanner(ocr); ocr.scanner = scanner;
    const repo = new CaptureRepo(await openCaptureDB(`gov-${Math.random()}`));
    const governor = await ResourceGovernor.create(repo, { deviceMemoryGb: 8 });
    await processDocument({ ocr, scanner, governor }, { blob: photo(), profile: BUSINESS_CARD, jobId: 'x', mode: governor.modeFor(1) });
    expect(governor.profile).toBe('standard');
    expect(scanner.opts[0].fullSide).toBeUndefined();
    expect(scanner.log).not.toContain('terminate');
  });

  it('caída de la pestaña durante el escaneo → al reabrir: perfil bajo, incidencia registrada y la captura se retoma', async () => {
    const db = `crash-${Math.random()}`;
    const auth = new MockAuth(USERS); await auth.signIn('EDR');
    const net = new MockNetwork();
    const hung = new TracingScanner(); hung.hang = true;
    const first = await CaptureApp.create({ dbName: db, auth, ocr: new MockOCRAdapter(), scanner: hung, drive: new MockDrive(net), sheets: new MockSheets(net),
      resources: { deviceMemoryGb: 8 }, syncDebounceMs: 60_000 });
    const c = await first.saveCapture([{ kind: 'card_front', blob: photo() }]);
    await new Promise((r) => setTimeout(r, 30));
    expect(await first.repo.getMeta('resources:heavy_task')).toMatchObject({ capture_uuid: c.uuid, stage: 'scan' });
    first.stop(); first.repo.db.close(); // Android cierra la pestaña en pleno escaneo

    const ocr = new TracingOCR(); const scanner = new TracingScanner(ocr); ocr.scanner = scanner;
    const second = await CaptureApp.create({ dbName: db, auth, ocr, scanner, drive: new MockDrive(net), sheets: new MockSheets(net),
      resources: { deviceMemoryGb: 8 }, syncDebounceMs: 60_000 });
    apps.push(second);
    expect(second.governor!.profile).toBe('low');
    expect(second.governor!.state.reason).toMatch(/interrupción durante el escaneo/);
    expect(second.governor!.recoveredFrom?.capture_uuid).toBe(c.uuid);
    await second.start(); await second.ocr.idle();
    const cap = (await second.repo.get(c.uuid))!;
    expect(cap.ocr_status).toBe('EXTRAIDO');
    expect(cap.ocr_attempts).toBe(2); // el intento interrumpido cuenta
    expect(scanner.opts[0].fullSide).toBe(2400); // segundo intento → modo reducido
    expect((await second.repo.audit(c.uuid)).some((a) => a.type === 'PROCESS_INTERRUPTED')).toBe(true);
  });

  it('una foto que provoca caídas repetidas termina en modo mínimo (sin escáner), sin bucle infinito', async () => {
    const repo = new CaptureRepo(await openCaptureDB(`gov-${Math.random()}`));
    const governor = await ResourceGovernor.create(repo, { deviceMemoryGb: 8 });
    expect([1, 2, 3, 4].map((a) => governor.modeFor(a))).toEqual(['normal', 'reduced', 'minimal', 'minimal']);
    const ocr = new TracingOCR(); const scanner = new TracingScanner(ocr); ocr.scanner = scanner;
    const r = await processDocument({ ocr, scanner, governor }, { blob: new Blob([`\xFF\xD8\nMOCKOCR\n${TWIN_FRONT.join('\n')}`]), profile: BUSINESS_CARD, jobId: 'x', mode: 'minimal' });
    expect(scanner.opts).toHaveLength(0);
    expect(r.issues).toEqual([{ code: 'minimal_mode' }]);
    expect(r.lines.length).toBeGreaterThan(0); // se leyó la foto original
  });

  it('Worker del escáner colgado: la vigilancia de tiempo lo termina y se lee la foto original', async () => {
    const repo = new CaptureRepo(await openCaptureDB(`gov-${Math.random()}`));
    const governor = await ResourceGovernor.create(repo, { deviceMemoryGb: 8, stageTimeoutMs: { scan: 50, ocr: 5000 } });
    const ocr = new TracingOCR(); const scanner = new TracingScanner(ocr); scanner.hang = true; scanner.alive = true;
    const r = await processDocument({ ocr, scanner, governor }, { blob: new Blob([`\xFF\xD8\nMOCKOCR\n${TWIN_FRONT.join('\n')}`]), profile: BUSINESS_CARD, jobId: 'x' });
    expect(scanner.log).toContain('terminate');
    expect(r.issues[0]).toMatchObject({ code: 'scanner_unavailable' });
    expect(r.issues[0].code === 'scanner_unavailable' && r.issues[0].message).toMatch(/superó/);
    expect(r.lines.length).toBeGreaterThan(0);
  });

  it('sin trabajo pendiente, PaddleOCR y el escáner se liberan', async () => {
    const auth = new MockAuth(USERS); await auth.signIn('EDR');
    const net = new MockNetwork();
    const ocr = new TracingOCR(); const scanner = new TracingScanner(ocr); ocr.scanner = scanner;
    const app = await CaptureApp.create({ dbName: `idle-${Math.random()}`, auth, ocr, scanner, drive: new MockDrive(net), sheets: new MockSheets(net),
      resources: { deviceMemoryGb: 8, idleReleaseMs: { standard: 30, low: 10 } }, syncDebounceMs: 60_000 });
    apps.push(app);
    await app.saveCapture([{ kind: 'card_front', blob: photo() }]);
    await app.ocr.idle();
    expect(ocr.loaded).toBe(true);
    await new Promise((r) => setTimeout(r, 80));
    expect(ocr.loaded).toBe(false);
    expect(ocr.disposals).toBe(1);
    expect(scanner.log.at(-1)).toBe('terminate');
  });
});

describe('motor reutilizable con perfiles de documento', () => {
  it('el mismo motor procesa otro tipo de documento con su perfil (geometría y resoluciones propias)', async () => {
    const ocr = new MockOCRAdapter(); const scanner = new TracingScanner();
    const r = await processDocument({ ocr, scanner }, { blob: photo(), profile: A4_DOCUMENT, jobId: 'x' });
    expect(scanner.opts[0].detect).toEqual(A4_DOCUMENT.detect);
    expect(scanner.opts[0].maxOutputSide).toBe(3200);
    expect(scanner.log).toContain('render rot=0 max=2400'); // entrada OCR del perfil A4
    expect(r.processed).toBeTruthy();
  });
});
