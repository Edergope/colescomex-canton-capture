import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AuditEvent, Capture, Evidence, OcrResultRecord } from '../domain/schema';

export interface CaptureDB extends DBSchema {
  captures: { key: string; value: Capture; indexes: { by_created: string; by_ref: string } };
  evidences: { key: string; value: Evidence; indexes: { by_capture: string } };
  ocr_results: { key: string; value: OcrResultRecord; indexes: { by_capture: string } };
  meta: { key: string; value: unknown };
  audit: { key: number; value: AuditEvent; indexes: { by_capture: string } };
}

export const DB_NAME = 'colescomex-canton-capture';
export const DB_VERSION = 1;

export function openCaptureDB(name = DB_NAME): Promise<IDBPDatabase<CaptureDB>> {
  return openDB<CaptureDB>(name, DB_VERSION, {
    upgrade(db) {
      const c = db.createObjectStore('captures', { keyPath: 'uuid' });
      c.createIndex('by_created', 'created_at');
      c.createIndex('by_ref', 'external_ref', { unique: true });
      db.createObjectStore('evidences', { keyPath: 'id' }).createIndex('by_capture', 'capture_uuid');
      db.createObjectStore('ocr_results', { keyPath: 'key' }).createIndex('by_capture', 'capture_uuid');
      db.createObjectStore('meta');
      db.createObjectStore('audit', { keyPath: 'id', autoIncrement: true }).createIndex('by_capture', 'capture_uuid');
    },
    blocking() { /* otra pestaña quiere actualizar el esquema */ },
  });
}

/** Pide al navegador que no borre el almacenamiento bajo presión de espacio. */
export async function requestPersistentStorage(): Promise<{ persisted: boolean; usage?: number; quota?: number }> {
  if (!navigator.storage?.persist) return { persisted: false };
  const persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
  const est = await navigator.storage.estimate?.();
  return { persisted, usage: est?.usage, quota: est?.quota };
}
