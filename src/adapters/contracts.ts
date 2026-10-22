// Contratos de integración. Antigravity conecta las implementaciones reales (google*.ts) sin tocar el núcleo.
// Ver docs/INTEGRATION_CONTRACTS.md para la semántica exacta de idempotencia.
import type { UserProfile } from '../domain/schema';

export class AuthRequiredError extends Error { constructor(msg = 'Se requiere iniciar sesión en Google') { super(msg); } }
export class NotAuthorizedError extends Error {}
/** Fallo transitorio (red, 429, 5xx): se reintenta con espera exponencial. */
export class TransientRemoteError extends Error {}

export interface AuthAdapter {
  readonly mode: 'mock' | 'google';
  allowedUsers(): UserProfile[];
  /** Usuario con sesión en ESTE dispositivo (persistida localmente para operar sin conexión). */
  currentUser(): Promise<UserProfile | null>;
  /** Inicio de sesión interactivo. Rechaza usuarios fuera de la lista autorizada (NotAuthorizedError). */
  signIn(userId?: string): Promise<UserProfile>;
  signOut(): Promise<void>;
  /** Token OAuth para las APIs de Google. Lanza AuthRequiredError si hay que volver a autenticarse. */
  getAccessToken(): Promise<string>;
}

export interface EvidenceUpload {
  evidence_id: string; capture_uuid: string; external_ref: string; kind: string;
  file_name: string; mime: string; blob: Blob; sha256?: string;
}

export interface DriveAdapter {
  /**
   * Busca (por appProperties.capture_uuid) o crea la carpeta de evidencias de la captura dentro de
   * EVIDENCIAS_FASE2. Idempotente: llamarla N veces devuelve siempre la misma carpeta.
   */
  ensureCaptureFolder(c: { capture_uuid: string; external_ref: string }): Promise<{ folderId: string; url: string }>;
  /**
   * Sube una evidencia. Idempotente por evidence_id (appProperties): si ya existe, devuelve el archivo existente
   * sin crear otro. Nunca sobrescribe ni borra archivos.
   */
  uploadEvidence(folderId: string, e: EvidenceUpload): Promise<{ fileId: string; url: string }>;
}

export interface SheetsAdapter {
  /**
   * Inserta o actualiza la fila cuya columna capture_uuid coincide (una fila = una captura).
   * Escribe por NOMBRE de columna (cabecera), añade al final las columnas técnicas que falten y
   * no toca otras columnas ni otras filas. Nunca escribe en la hoja de Fase 1.
   */
  upsertRow(row: Record<string, string>): Promise<{ rowNumber: number; action: 'inserted' | 'updated' }>;
}
