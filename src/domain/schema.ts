// Esquema comercial de captura (compatible con COLESCOMEX_Canton_Fair_Fase1_Importacion).
// El orden y los nombres de COMMERCIAL_FIELDS no deben cambiarse: son las columnas comerciales.

export const COMMERCIAL_FIELDS = [
  'external_ref', 'capture_date', 'captured_by', 'mission', 'source', 'phase', 'hall', 'booth',
  'company_name', 'company_name_cn', 'contact_name', 'job_title', 'phone_1', 'phone_2', 'wechat',
  'whatsapp', 'email', 'website', 'address', 'city', 'province', 'country', 'supplier_type',
  'main_products', 'product_interest', 'notes', 'follow_up', 'data_classification', 'processing_status',
] as const;
export type CommercialField = (typeof COMMERCIAL_FIELDS)[number];

/** Columnas técnicas añadidas DESPUÉS de las comerciales (no alteran el esquema comercial). */
export const TECHNICAL_FIELDS = [
  'capture_uuid', 'record_revision', 'ocr_status', 'review_status', 'review_fields',
  'evidence_folder_id', 'evidence_folder_url', 'evidence_ids', 'evidence_files',
  'ocr_engine', 'ocr_fax', 'ocr_text_front', 'ocr_text_back', 'device_id', 'created_at', 'updated_at', 'app_version',
] as const;
export type TechnicalField = (typeof TECHNICAL_FIELDS)[number];
export const SHEET_COLUMNS = [...COMMERCIAL_FIELDS, ...TECHNICAL_FIELDS] as const;

export const DEFAULTS = {
  mission: 'China 2026',
  source: 'Canton Fair',
  phase: 'Fase 2',
  country: 'China',
  data_classification: 'REAL',
} as const satisfies Partial<Record<CommercialField, string>>;

/** Campos que el OCR puede completar. El resto solo los fija el sistema o una persona. */
export const OCR_FIELDS = [
  'hall', 'booth', 'company_name', 'company_name_cn', 'contact_name', 'job_title', 'phone_1', 'phone_2',
  'wechat', 'whatsapp', 'email', 'website', 'address', 'city', 'province', 'main_products',
] as const satisfies readonly CommercialField[];
export type OcrField = (typeof OCR_FIELDS)[number];

/** Campos que el usuario puede editar en la vista de revisión. */
export const EDITABLE_FIELDS = [
  ...OCR_FIELDS, 'country', 'supplier_type', 'product_interest', 'notes', 'follow_up',
] as const satisfies readonly CommercialField[];

export type OcrStatus = 'CAPTURADO' | 'PROCESANDO' | 'EXTRAIDO' | 'REQUIERE_REVISION' | 'ERROR';
export type SyncStatus = 'LOCAL' | 'PENDIENTE' | 'SINCRONIZANDO' | 'CONFIRMADO' | 'ERROR';
export type ReviewStatus = 'SIN_REVISAR' | 'REVISADO';

export const SYNC_LABELS: Record<SyncStatus, string> = {
  LOCAL: 'Guardado localmente',
  PENDIENTE: 'Pendiente de sincronización',
  SINCRONIZANDO: 'Sincronizando',
  CONFIRMADO: 'Confirmado en Google',
  ERROR: 'Error de sincronización',
};

/**
 * Estado de cada campo:
 * - absent: no aparece en ninguna imagen.
 * - illegible: hay indicio (etiqueta o línea) pero el valor no se pudo leer con confianza.
 * - review: valor leído pero ambiguo / heurístico / en conflicto frontal-reverso.
 * - ok: valor leído con regla explícita y confianza suficiente.
 */
export type FieldStatus = 'ok' | 'review' | 'illegible' | 'absent';
export type FieldSource = 'default' | 'system' | 'ocr_front' | 'ocr_back' | 'human';

export interface FieldMeta {
  source: FieldSource;
  status: FieldStatus;
  /** Valores alternativos detectados (p. ej. reverso distinto al frontal). Nunca se descartan. */
  candidates?: string[];
  confidence?: number;
  reason?: string;
  /** true = corrección humana confirmada: ningún proceso OCR posterior la sobrescribe. */
  locked?: boolean;
}

export type EvidenceKind = 'card_front' | 'card_back' | 'stand' | 'product' | 'catalog' | 'other';
export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  card_front: 'Tarjeta (frontal)', card_back: 'Tarjeta (reverso)', stand: 'Stand',
  product: 'Producto', catalog: 'Catálogo', other: 'Otra evidencia',
};

export interface Evidence {
  id: string; // UUID inmutable
  capture_uuid: string;
  kind: EvidenceKind;
  seq: number; // orden dentro de la captura
  blob: Blob; // original sin modificar
  mime: string;
  size: number;
  file_name: string; // nombre determinista para Drive
  created_at: string;
  remote_file_id?: string;
  remote_url?: string;
  uploaded_at?: string;
}

export interface Capture {
  uuid: string; // clave primaria inmutable
  external_ref: string;
  fields: Record<CommercialField, string>;
  field_meta: Partial<Record<CommercialField, FieldMeta>>;
  evidence_ids: string[];
  ocr_status: OcrStatus;
  ocr_attempts: number;
  ocr_error?: string;
  ocr_engine?: string;
  ocr_next_attempt_at?: number;
  /** datos detectados sin columna comercial propia (fax, QQ): se exportan en columnas técnicas */
  ocr_extras?: { fax: string[]; qq: string[] };
  review_status: ReviewStatus;
  sync_status: SyncStatus;
  sync_error?: string;
  sync_attempts: number;
  sync_next_attempt_at?: number;
  /** Se incrementa en cada cambio de datos. CONFIRMADO solo si synced_revision === revision. */
  revision: number;
  synced_revision: number;
  remote?: { folder_id?: string; folder_url?: string; row_confirmed_at?: string };
  device_id: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  app_version: string;
}

export interface OcrLine { text: string; score: number; box?: number[][] }
export interface OcrResultRecord {
  key: string; // `${capture_uuid}:${side}`
  capture_uuid: string;
  side: 'front' | 'back';
  evidence_id: string;
  engine: string;
  lines: OcrLine[];
  text: string;
  ms: number;
  created_at: string;
}

export interface AuditEvent {
  id?: number;
  capture_uuid: string;
  at: string;
  actor: string; // user_id o 'system'
  type: string;
  detail?: unknown;
}

export interface UserProfile { id: string; name: string; email?: string }
