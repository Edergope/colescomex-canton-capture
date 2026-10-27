// Modelo de presentación: traduce el estado técnico de una captura a mensajes claros para el operador.
// Funciones puras (sin DOM): se prueban en tests/ui-model.test.ts.
import { OCR_FIELDS, type Capture, type CommercialField, type FieldMeta, type OcrField } from '../domain/schema';
import { SIMULATED_SYNC } from '../config/env';

export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'neutral';
export interface Track { tone: Tone; icon: string; label: string; detail?: string; busy?: boolean }

export const FIELD_LABELS: Record<string, string> = {
  company_name: 'Empresa', company_name_cn: 'Empresa (chino)', contact_name: 'Contacto', job_title: 'Cargo',
  phone_1: 'Móvil / Teléfono 1', phone_2: 'Teléfono 2', wechat: 'WeChat', whatsapp: 'WhatsApp', email: 'Email', website: 'Web',
  address: 'Dirección', city: 'Ciudad', province: 'Provincia', country: 'País', hall: 'Hall', booth: 'Stand',
  supplier_type: 'Categoría', main_products: 'Productos', product_interest: 'Producto de interés', notes: 'Notas', follow_up: 'Seguimiento',
};

/** Nombre visible: nunca se presenta una captura sin empresa como si estuviera extraída. */
export function displayName(c: Capture): { text: string; pending: boolean } {
  const n = c.fields.company_name || c.fields.company_name_cn;
  if (n) return { text: n, pending: false };
  if (c.ocr_status === 'CAPTURADO' || c.ocr_status === 'PROCESANDO') return { text: 'Leyendo tarjeta…', pending: true };
  return { text: 'Empresa pendiente de identificar', pending: true };
}

/** Etapa 1 — la foto está guardada en el teléfono (siempre cierto tras guardar). */
export function photoTrack(): Track {
  return { tone: 'ok', icon: 'shield', label: 'Protegida en este dispositivo' };
}

/** Etapa 2 — extracción de datos (escáner + OCR + parser). */
export function dataTrack(c: Capture): Track {
  const n = reviewItems(c).length;
  if (c.review_status === 'REVISADO') return { tone: 'ok', icon: 'check-circle', label: 'Revisado', detail: 'Datos confirmados por una persona' };
  switch (c.ocr_status) {
    case 'CAPTURADO': return { tone: 'info', icon: 'clock', label: 'En cola', detail: c.ocr_attempts ? `Reintento ${c.ocr_attempts + 1}` : 'Procesando documento en segundo plano', busy: false };
    case 'PROCESANDO': return { tone: 'info', icon: 'loader', label: 'Procesando documento', detail: 'Recorte, orientación y lectura', busy: true };
    case 'EXTRAIDO': return { tone: 'ok', icon: 'check-circle', label: 'Datos extraídos' };
    case 'REQUIERE_REVISION': return { tone: 'warn', icon: 'alert', label: n ? `Revisar ${n} ${n === 1 ? 'dato' : 'datos'}` : 'Requiere revisión', detail: 'Datos inciertos: nada se aprueba solo' };
    case 'ERROR': return { tone: 'err', icon: 'alert-circle', label: 'Fallo de lectura', detail: c.ocr_error ? friendlyOcrError(c.ocr_error) : 'Puede reprocesarse; la foto está intacta' };
  }
}

export type SyncProblem = 'offline' | 'auth' | 'quota' | 'too_large' | 'rate_limit' | 'permission' | 'server' | 'config' | 'upload';
export function classifySyncError(msg = ''): { kind: SyncProblem; title: string; help: string } {
  if (/bloquead|configuraci[oó]n incompleta|Falta VITE_/i.test(msg)) return { kind: 'config', title: 'Sincronización bloqueada por configuración', help: 'La app no tiene los destinos de Google correctos. Avise al responsable técnico; sus capturas siguen protegidas.' };
  // Drive lleno: los archivos cuentan en la cuota de la cuenta que SUBE, aunque la carpeta sea del equipo (no es un permiso)
  if (/storageQuotaExceeded|quotaExceeded|almacenamiento.*lleno/i.test(msg)) return { kind: 'quota', title: 'El almacenamiento de su cuenta de Google está lleno', help: 'Las fotos que sube ocupan espacio en SU cuenta, aunque la carpeta sea del equipo. Libere espacio en drive.google.com/settings/storage; se reintentará solo y no se perdió nada.' };
  // sesión de Google (OAuth), nunca la «sesión de subida» reanudable de Drive
  if (/AuthRequired|La sesi[oó]n de Google|Inicia sesi[oó]n|Reconecta|HTTP 401/i.test(msg)) return { kind: 'auth', title: 'La sesión de Google expiró; reconecte su cuenta', help: 'Vuelva a conectar su cuenta de Google: las subidas pendientes se reanudan solas al hacerlo.' };
  if (/HTTP 413|too large|demasiado grande/i.test(msg)) return { kind: 'too_large', title: 'No fue posible subir este archivo', help: 'Drive lo rechazó por su tamaño. Avise al responsable técnico; la foto sigue protegida en el teléfono.' };
  // límites de ritmo de Google (llegan como 403 o 429): temporales, se reintentan solos
  if (/RateLimitExceeded|HTTP 429/i.test(msg)) return { kind: 'rate_limit', title: 'Google limitó temporalmente las solicitudes', help: 'Se reintentará automáticamente en unos minutos; no hace falta hacer nada.' };
  if (/HTTP 5\d\d|backendError|internalError/i.test(msg)) return { kind: 'server', title: 'Google no respondió', help: 'Error temporal del servicio. Se reintentará automáticamente.' };
  if (/HTTP 403|permiso|permission|insufficient|forbidden/i.test(msg)) return { kind: 'permission', title: 'Sin permiso en Google Drive o Sheets', help: 'Su cuenta no puede escribir en la carpeta o la hoja. Pida acceso de edición; no se perdió nada.' };
  if (/Sin conexi[oó]n|Red:|network|Failed to fetch|conexi[oó]n (perdida|se interrumpi)|interrumpi|offline|sesi[oó]n de subida caducada|no avanz[oó]/i.test(msg)) return { kind: 'offline', title: 'La conexión se interrumpió; la subida se reintentará', help: 'Se reanudará automáticamente desde donde quedó, sin duplicar archivos.' };
  return { kind: 'upload', title: 'No fue posible subir este archivo', help: 'Se reintentará automáticamente; no se crearán registros duplicados. Si persiste, copie el diagnóstico.' };
}

/** Etapa 3 — copia en Google (Drive + Sheets). «Confirmado» no implica datos verificados. */
export function googleTrack(c: Capture): Track {
  switch (c.sync_status) {
    case 'LOCAL': return { tone: 'neutral', icon: 'cloud', label: 'Pendiente de sincronización', detail: 'Aún no se ha enviado' };
    case 'PENDIENTE': return { tone: 'info', icon: 'cloud-up', label: 'Pendiente de sincronización', detail: c.synced_revision ? 'Hay cambios por enviar' : 'Esperando turno de envío' };
    case 'SINCRONIZANDO': return { tone: 'info', icon: 'loader', label: 'Subiendo a Google', busy: true };
    case 'CONFIRMADO': return SIMULATED_SYNC
      ? { tone: 'neutral', icon: 'cloud-ok', label: 'Sincronización simulada', detail: 'Vista previa: nada se envió a Google' }
      : { tone: 'ok', icon: 'cloud-ok', label: 'Confirmado en Google', detail: 'Fotos y fila confirmadas por Drive y Sheets' };
    case 'ERROR': { const p = classifySyncError(c.sync_error); return { tone: p.kind === 'offline' ? 'warn' : 'err', icon: p.kind === 'offline' ? 'cloud-off' : 'alert-circle', label: p.title, detail: p.help }; }
  }
}

function friendlyOcrError(e: string): string {
  if (/memoria|memory|OOM/i.test(e)) return 'El teléfono se quedó sin memoria; se reintentará en modo ligero';
  if (/superó/i.test(e)) return 'El proceso tardó demasiado; se reintentará';
  return 'No se pudo leer la tarjeta. Puede reprocesarla; la foto está intacta';
}

export interface ReviewItem { field: CommercialField | 'scan'; label: string; value: string; reason: string; candidates: string[]; illegible: boolean }

/** Solo los datos que realmente necesitan intervención (no bloqueados por una corrección humana). */
export function reviewItems(c: Capture): ReviewItem[] {
  if (c.review_status === 'REVISADO') return [];
  const out: ReviewItem[] = [];
  for (const issue of c.scan_issues ?? []) out.push({ field: 'scan', label: 'Documento', value: '', reason: issue, candidates: [], illegible: false });
  for (const f of OCR_FIELDS) {
    const m: FieldMeta | undefined = c.field_meta[f];
    if (!m || m.locked || (m.status !== 'review' && m.status !== 'illegible')) continue;
    out.push({ field: f, label: FIELD_LABELS[f] ?? f, value: c.fields[f] ?? '', reason: humanReason(f, m), candidates: (m.candidates ?? []).filter((x) => x && x !== c.fields[f]), illegible: m.status === 'illegible' });
  }
  return out;
}

function humanReason(f: OcrField, m: FieldMeta): string {
  const r = m.reason ?? '';
  if (f === 'main_products' && /separaci[oó]n/i.test(r)) return `Detectamos una posible separación incorrecta en Productos. ${r.replace(/^posibles errores de separación:\s*/i, '')}`;
  if (m.status === 'illegible') return r ? `Texto ilegible en la foto (${r.replace(/^texto ilegible:\s*/i, '')})` : 'Texto ilegible en la foto';
  if (/no coinciden/.test(r)) return `El anverso y el reverso no coinciden. ${r}`;
  if (/confianza/.test(r)) return 'Lectura con poca confianza';
  if (/posici[oó]n/.test(r)) return 'Dato deducido por su posición en la tarjeta (sin etiqueta)';
  return r || 'Requiere confirmación';
}

/** Palabras citadas en el motivo (p. ej. "STREETLIGHTING") para localizar la región del documento. */
export function quotedTokens(reason: string): string[] {
  return [...reason.matchAll(/"([^"]{3,})"/g)].map((m) => m[1]).filter((t, i, a) => a.indexOf(t) === i);
}

export function relTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'hace unos segundos';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return new Date(iso).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

export type ListFilter = 'all' | 'pending' | 'review' | 'errors' | 'confirmed';
export function matchesFilter(c: Capture, f: ListFilter): boolean {
  switch (f) {
    case 'all': return true;
    case 'pending': return c.sync_status !== 'CONFIRMADO' || c.ocr_status === 'CAPTURADO' || c.ocr_status === 'PROCESANDO';
    case 'review': return reviewItems(c).length > 0 || (c.ocr_status === 'REQUIERE_REVISION' && c.review_status !== 'REVISADO');
    case 'errors': return c.sync_status === 'ERROR' || c.ocr_status === 'ERROR';
    case 'confirmed': return c.sync_status === 'CONFIRMADO';
  }
}
export function matchesSearch(c: Capture, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [c.external_ref, c.fields.company_name, c.fields.company_name_cn, c.fields.contact_name, c.fields.booth, c.fields.email, ...(c.ocr_extras?.secondary_companies ?? [])]
    .some((v) => (v ?? '').toLowerCase().includes(t));
}
