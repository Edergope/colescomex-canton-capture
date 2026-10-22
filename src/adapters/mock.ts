// Implementaciones mock funcionales: misma semántica de idempotencia que las reales.
// Permiten simular desconexión, fallos y "respuesta perdida tras éxito" para las pruebas.
import type { UserProfile } from '../domain/schema';
import {
  AuthRequiredError, NotAuthorizedError, TransientRemoteError,
  type AuthAdapter, type DriveAdapter, type EvidenceUpload, type SheetsAdapter,
} from './contracts';

export class MockNetwork {
  online = true;
  /** falla las próximas N operaciones con error transitorio */
  failNext = 0;
  /** ejecuta la operación pero "pierde" la respuesta (simula corte durante la sincronización) */
  dropResponseNext = 0;
  ops = 0;
  async run<T>(fn: () => T | Promise<T>): Promise<T> {
    this.ops++;
    if (!this.online) throw new TransientRemoteError('Sin conexión (simulado)');
    if (this.failNext > 0) { this.failNext--; throw new TransientRemoteError('Error de red (simulado)'); }
    const r = await fn();
    if (this.dropResponseNext > 0) { this.dropResponseNext--; throw new TransientRemoteError('Conexión perdida durante la respuesta (simulado)'); }
    return r;
  }
}

export interface MockFile { id: string; name: string; parent: string; appProperties: Record<string, string>; size: number; mime: string }

export class MockDrive implements DriveAdapter {
  folders = new Map<string, MockFile>();
  files = new Map<string, MockFile>();
  private n = 0;
  constructor(public net = new MockNetwork(), private rootId = 'EVIDENCIAS_FASE2') {}
  ensureCaptureFolder(c: { capture_uuid: string; external_ref: string }) {
    return this.net.run(() => {
      let f = [...this.folders.values()].find((x) => x.appProperties.capture_uuid === c.capture_uuid);
      if (!f) {
        f = { id: `fld_${++this.n}`, name: c.external_ref, parent: this.rootId, appProperties: { capture_uuid: c.capture_uuid }, size: 0, mime: 'folder' };
        this.folders.set(f.id, f);
      }
      return { folderId: f.id, url: `mock://drive/folders/${f.id}` };
    });
  }
  uploadEvidence(folderId: string, e: EvidenceUpload) {
    return this.net.run(() => {
      if (!this.folders.has(folderId)) throw new Error(`Carpeta ${folderId} no existe`);
      let f = [...this.files.values()].find((x) => x.appProperties.evidence_id === e.evidence_id);
      if (!f) {
        f = { id: `file_${++this.n}`, name: e.file_name, parent: folderId, size: e.blob.size, mime: e.mime,
          appProperties: { evidence_id: e.evidence_id, capture_uuid: e.capture_uuid, kind: e.kind } };
        this.files.set(f.id, f);
      }
      return { fileId: f.id, url: `mock://drive/files/${f.id}` };
    });
  }
}

export class MockSheets implements SheetsAdapter {
  header: string[] = [];
  rows: string[][] = [];
  writes = 0;
  constructor(public net = new MockNetwork()) {}
  upsertRow(row: Record<string, string>) {
    return this.net.run(() => {
      this.writes++;
      for (const k of Object.keys(row)) if (!this.header.includes(k)) this.header.push(k);
      const key = this.header.indexOf('capture_uuid');
      const idx = this.rows.findIndex((r) => r[key] === row.capture_uuid);
      const values = this.header.map((h, i) => (h in row ? row[h] : (idx >= 0 ? this.rows[idx][i] ?? '' : '')));
      if (idx >= 0) { this.rows[idx] = values; return { rowNumber: idx + 2, action: 'updated' as const }; }
      this.rows.push(values);
      return { rowNumber: this.rows.length + 1, action: 'inserted' as const };
    });
  }
  asObjects(): Record<string, string>[] { return this.rows.map((r) => Object.fromEntries(this.header.map((h, i) => [h, r[i]]))); }
}

/** Autenticación mock: cada persona elige su propio perfil autorizado; la sesión es por dispositivo. */
export class MockAuth implements AuthAdapter {
  readonly mode = 'mock' as const;
  private user: UserProfile | null = null;
  tokenValid = true;
  constructor(private users: UserProfile[], private store: { get: () => Promise<UserProfile | null>; set: (u: UserProfile | null) => Promise<void> } = memStore()) {}
  allowedUsers() { return this.users; }
  async currentUser() { this.user ??= await this.store.get(); return this.user; }
  async signIn(userId?: string) {
    const u = this.users.find((x) => x.id === userId);
    if (!u) throw new NotAuthorizedError('Usuario no autorizado');
    this.user = u; await this.store.set(u); this.tokenValid = true;
    return u;
  }
  async signOut() { this.user = null; await this.store.set(null); }
  async getAccessToken() {
    if (!this.user || !this.tokenValid) throw new AuthRequiredError();
    return `mock-token-${this.user.id}`;
  }
}

function memStore() { let v: UserProfile | null = null; return { get: async () => v, set: async (u: UserProfile | null) => { v = u; } }; }
