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
  'ocr_engine', 'ocr_fax', 'ocr_extras', 'ocr_text_front', 'ocr_text_back', 'device_id', 'created_at', 'updated_at', 'app_version',
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

/** Resultado del Smart Document Scanner sobre una foto original de tarjeta. */
export interface EvidenceScan {
  status: 'ok' | 'low_confidence' | 'not_found' | 'manual';
  confidence: number;
  /** esquinas detectadas en la foto (con EXIF aplicado): TL, TR, BR, BL */
  quad?: { x: number; y: number }[];
  method?: string;
  multiple: boolean;
  reasons: string[];
  /** true si existe una versión recortada y enderezada (evidencia `processed`) */
  cropped: boolean;
  /** rotación aplicada al texto, grados en sentido horario */
  rotation: number;
  orientation_source: 'classifier' | 'classifier+ocr' | 'ocr' | 'none';
  orientation_confident: boolean;
  orientation_probs?: number[];
  trials?: { rot: number; prior: number; score: number }[];
  processed_id?: string;
  source_size?: { width: number; height: number };
  output_size?: { width: number; height: number };
  ms?: Record<string, number>;
  at: string;
  /** esquinas ajustadas a mano (excepcional): el siguiente proceso las usa en lugar de la detección */
  manual_quad?: { x: number; y: number }[];
  /** modo de procesamiento usado (normal / reducido / mínimo) según memoria e intentos */
  mode?: 'normal' | 'reduced' | 'minimal';
}

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
  /** original = foto del teléfono (inmutable); processed = documento recortado/enderezado derivado */
  role?: 'original' | 'processed';
  derived_from?: string;
  /** procesado sustituido por un reproceso posterior (se conserva, no se sube si no se subió ya) */
  superseded_by?: string;
  /** carpeta remota de `remote_file_id`: siempre la principal del proveedor (versiones ≤1.1-rc usaban 'archive') */
  remote_target?: 'main' | 'archive';
  /** copia en el RESPALDO RESTRINGIDO de originales (independiente de la carpeta principal) */
  archive_file_id?: string;
  archive_url?: string;
  archived_at?: string;
  sha256?: string;
  scan?: EvidenceScan;
  /**
   * Decisión del OPERADOR sobre el recorte, tomada viendo la vista previa real del escáner:
   * auto = aceptó el recorte automático mostrado; manual = ajustó las esquinas; full = conservó la foto completa.
   * Sin este campo (capturas anteriores) el recorte es automático y no fue validado por una persona.
   */
  crop?: CropDecision;
}

export interface CropDecision {
  decision: 'auto' | 'manual' | 'full';
  decided_at: string;
  decided_by?: string;
  /** estado y confianza del detector cuando se decidió (trazabilidad) */
  detector?: { status: string; confidence: number };
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
  ocr_extras?: { fax: string[]; qq: string[]; postal_code?: string[]; secondary_companies?: string[] };
  /** incidencias del escáner que requieren revisión humana (bordes dudosos, varias tarjetas…) */
  scan_issues?: string[];
  review_status: ReviewStatus;
  sync_status: SyncStatus;
  sync_error?: string;
  sync_attempts: number;
  sync_next_attempt_at?: number;
  /** Se incrementa en cada cambio de datos. CONFIRMADO solo si synced_revision === revision. */
  revision: number;
  synced_revision: number;
  remote?: { folder_id?: string; folder_url?: string; archive_folder_id?: string; row_confirmed_at?: string };
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
  /** rotación (grados horarios) de la imagen leída y evidencia usada (procesada u original) */
  rotation?: number;
  read_from?: string;
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
