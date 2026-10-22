import type { IDBPDatabase } from 'idb';
import type { CaptureDB } from './db';
import {
  COMMERCIAL_FIELDS, DEFAULTS, type AuditEvent, type Capture, type CommercialField, type Evidence,
  type EvidenceKind, type FieldMeta, type OcrResultRecord, type UserProfile,
} from '../domain/schema';
import { formatExternalRef, localDate, randomCode, uuid } from '../domain/ids';
import { APP_VERSION } from '../config/version';

export interface DeviceInfo { device_id: string; device_code: string }
export interface NewEvidence { kind: EvidenceKind; blob: Blob; name?: string }
export interface QuickFields { hall?: string; booth?: string; notes?: string; product_interest?: string }

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf',
};
export function extFor(mime: string, name?: string): string {
  return EXT[mime] ?? name?.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') ?? 'bin';
}

type Listener = (uuid: string) => void;

export class CaptureRepo {
  private listeners = new Set<Listener>();
  constructor(readonly db: IDBPDatabase<CaptureDB>, private now: () => Date = () => new Date()) {}

  onChange(fn: Listener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(uuid: string) { for (const l of this.listeners) l(uuid); }

  async device(): Promise<DeviceInfo> {
    const tx = this.db.transaction('meta', 'readwrite');
    let d = (await tx.store.get('device')) as DeviceInfo | undefined;
    if (!d) { d = { device_id: uuid(), device_code: randomCode(4) }; await tx.store.put(d, 'device'); }
    await tx.done;
    return d;
  }

  async getMeta<T>(key: string): Promise<T | undefined> { return (await this.db.get('meta', key)) as T | undefined; }
  async setMeta(key: string, value: unknown): Promise<void> { await this.db.put('meta', value, key); }

  /**
   * Guarda captura + evidencias + consecutivo + auditoría en UNA transacción:
   * o queda todo persistido o nada (no hay capturas sin fotos ni fotos huérfanas).
   */
  async createCapture(user: UserProfile, evidences: NewEvidence[], quick: QuickFields = {}): Promise<Capture> {
    if (!evidences.some((e) => e.kind === 'card_front')) throw new Error('La fotografía frontal es obligatoria');
    const device = await this.device();
    const nowIso = this.now().toISOString();
    const capUuid = uuid();
    // Leer los Blobs ANTES de abrir la transacción (una tx de IndexedDB se cierra si se espera otra cosa).
    const prepared = evidences.map((e, i) => ({ ...e, seq: i + 1, mime: e.blob.type || 'application/octet-stream' }));

    const tx = this.db.transaction(['meta', 'captures', 'evidences', 'audit'], 'readwrite');
    const meta = tx.objectStore('meta');
    const seqKey = `seq:${user.id}`;
    const seq = (((await meta.get(seqKey)) as number | undefined) ?? 0) + 1;
    await meta.put(seq, seqKey);
    const external_ref = formatExternalRef(user.id, device.device_code, seq);

    const fields = Object.fromEntries(COMMERCIAL_FIELDS.map((f) => [f, ''])) as Record<CommercialField, string>;
    const field_meta: Partial<Record<CommercialField, FieldMeta>> = {};
    for (const [k, v] of Object.entries(DEFAULTS)) { fields[k as CommercialField] = v; field_meta[k as CommercialField] = { source: 'default', status: 'ok' }; }
    Object.assign(fields, {
      external_ref, capture_date: localDate(this.now()), captured_by: user.name, processing_status: 'CAPTURADO',
    });
    for (const [k, v] of Object.entries(quick)) {
      if (v && v.trim()) { fields[k as CommercialField] = v.trim(); field_meta[k as CommercialField] = { source: 'human', status: 'ok', locked: true }; }
    }

    const evRecords: Evidence[] = prepared.map((e) => ({
      id: uuid(), capture_uuid: capUuid, kind: e.kind, seq: e.seq, blob: e.blob, mime: e.mime, size: e.blob.size,
      file_name: `${external_ref}_${String(e.seq).padStart(2, '0')}_${e.kind}.${extFor(e.mime, e.name)}`,
      created_at: nowIso,
    }));
    const capture: Capture = {
      uuid: capUuid, external_ref, fields, field_meta, evidence_ids: evRecords.map((e) => e.id),
      ocr_status: 'CAPTURADO', ocr_attempts: 0, review_status: 'SIN_REVISAR',
      sync_status: 'LOCAL', sync_attempts: 0, revision: 1, synced_revision: 0,
      device_id: device.device_id, user_id: user.id, created_at: nowIso, updated_at: nowIso, app_version: APP_VERSION,
    };
    await tx.objectStore('captures').add(capture); // add (no put): falla si el uuid/ref ya existiera
    for (const e of evRecords) await tx.objectStore('evidences').add(e);
    await tx.objectStore('audit').add({ capture_uuid: capUuid, at: nowIso, actor: user.id, type: 'CAPTURE_CREATED', detail: { external_ref, evidences: evRecords.map((e) => e.kind) } });
    await tx.done;
    this.emit(capUuid);
    return capture;
  }

  get(uuid: string) { return this.db.get('captures', uuid); }
  async list(): Promise<Capture[]> { return (await this.db.getAllFromIndex('captures', 'by_created')).reverse(); }
  async evidences(captureUuid: string): Promise<Evidence[]> {
    return (await this.db.getAllFromIndex('evidences', 'by_capture', captureUuid)).sort((a, b) => a.seq - b.seq);
  }
  getEvidence(id: string) { return this.db.get('evidences', id); }
  async ocrResults(captureUuid: string) { return this.db.getAllFromIndex('ocr_results', 'by_capture', captureUuid); }
  async audit(captureUuid: string) { return this.db.getAllFromIndex('audit', 'by_capture', captureUuid); }

  /**
   * Lectura-modificación-escritura atómica de una captura. Evita que OCR, edición humana y
   * sincronización se pisen entre sí. `bump` = el cambio afecta a los datos (nueva revisión).
   */
  async update(uuid: string, mutate: (c: Capture) => void | false, opts: { bump?: boolean; audit?: Omit<AuditEvent, 'capture_uuid' | 'at'> } = {}): Promise<Capture | undefined> {
    const tx = this.db.transaction(['captures', 'audit'], 'readwrite');
    const store = tx.objectStore('captures');
    const c = await store.get(uuid);
    if (!c) { await tx.done; return undefined; }
    if (mutate(c) === false) { await tx.done; return c; }
    if (opts.bump) {
      c.revision += 1;
      c.updated_at = this.now().toISOString();
      if (c.sync_status === 'CONFIRMADO' || c.sync_status === 'ERROR') c.sync_status = 'PENDIENTE';
    }
    await store.put(c);
    if (opts.audit) await tx.objectStore('audit').add({ ...opts.audit, capture_uuid: uuid, at: this.now().toISOString() });
    await tx.done;
    this.emit(uuid);
    return c;
  }

  async updateEvidence(id: string, patch: Partial<Pick<Evidence, 'remote_file_id' | 'remote_url' | 'uploaded_at'>>): Promise<void> {
    const tx = this.db.transaction('evidences', 'readwrite');
    const e = await tx.store.get(id);
    if (!e) throw new Error(`Evidencia ${id} no existe`);
    await tx.store.put({ ...e, ...patch });
    await tx.done;
  }

  async saveOcrResult(r: OcrResultRecord): Promise<void> { await this.db.put('ocr_results', r); }

  /** Corrección humana: fija el valor y lo bloquea frente a reprocesos OCR. */
  async applyHumanEdit(uuid: string, edits: Partial<Record<CommercialField, string>>, user: UserProfile) {
    return this.update(uuid, (c) => {
      let changed = false;
      for (const [k, raw] of Object.entries(edits)) {
        const f = k as CommercialField; const v = (raw ?? '').trim();
        const prev = c.field_meta[f];
        if (c.fields[f] === v && prev?.source === 'human') continue;
        if (c.fields[f] === v && prev?.status === 'ok' && !prev.candidates?.length) continue;
        c.fields[f] = v;
        c.field_meta[f] = { source: 'human', status: v ? 'ok' : 'absent', locked: true, candidates: prev?.candidates, reason: `editado por ${user.name}` };
        changed = true;
      }
      return changed ? undefined : false;
    }, { bump: true, audit: { actor: user.id, type: 'HUMAN_EDIT', detail: edits } });
  }

  async addAudit(e: Omit<AuditEvent, 'at'>) { await this.db.add('audit', { ...e, at: this.now().toISOString() }); }
}
