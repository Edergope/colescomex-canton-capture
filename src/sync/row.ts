import { COMMERCIAL_FIELDS, OCR_FIELDS, type Capture, type Evidence, type OcrResultRecord } from '../domain/schema';

/** Fila de Google Sheets: columnas comerciales + técnicas, todo como texto (valueInputOption=RAW). */
export function toSheetRow(c: Capture, evs: Evidence[], ocr: OcrResultRecord[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (const f of COMMERCIAL_FIELDS) row[f] = c.fields[f] ?? '';
  const review: string[] = OCR_FIELDS.filter((f) => ['review', 'illegible'].includes(c.field_meta[f]?.status ?? ''));
  if (c.scan_issues?.length) review.push('escaneo');
  const cap = (s = '') => (s.length > 45000 ? `${s.slice(0, 45000)}…` : s); // límite de celda de Sheets: 50 000
  Object.assign(row, {
    capture_uuid: c.uuid,
    record_revision: String(c.revision),
    ocr_status: c.ocr_status,
    review_status: c.review_status,
    review_fields: review.join(', '),
    evidence_folder_id: c.remote?.folder_id ?? '',
    evidence_folder_url: c.remote?.folder_url ?? '',
    evidence_ids: evs.filter((e) => e.remote_file_id || !e.superseded_by).map((e) => e.id).join(', '),
    evidence_files: evidenceLines(evs).join('\n'),
    ocr_engine: c.ocr_engine ?? '',
    ocr_fax: c.ocr_extras?.fax.join(', ') ?? '',
    ocr_extras: formatExtras(c),
    ocr_text_front: cap(ocr.find((o) => o.side === 'front')?.text),
    ocr_text_back: cap(ocr.find((o) => o.side === 'back')?.text),
    device_id: c.device_id,
    created_at: c.created_at,
    updated_at: c.updated_at,
    app_version: c.app_version,
  });
  return row;
}

/** Una línea por archivo en Drive: tarjeta escaneada (principal), originales (principal y/o respaldo restringido). */
function evidenceLines(evs: Evidence[]): string[] {
  const out: string[] = [];
  for (const e of evs) {
    if (e.role === 'processed') { if (e.remote_url || !e.superseded_by) out.push(`${e.kind} [escaneada${e.superseded_by ? ', sustituida' : ''}]: ${e.remote_url ?? '(pendiente)'}`); continue; }
    const tag = e.scan ? 'original' : '';
    if (e.remote_url || !e.archive_url) {
      const hasProc = evs.some((p) => p.derived_from === e.id && !p.superseded_by);
      if (e.remote_url || !hasProc) out.push(`${e.kind}${tag ? ` [${tag}]` : ''}: ${e.remote_url ?? '(pendiente)'}`);
      else out.push(`${e.kind} [original]: (sin respaldo configurado: solo en el teléfono)`);
    }
    if (e.archive_url) out.push(`${e.kind} [original, respaldo restringido]: ${e.archive_url}`);
  }
  return out;
}

/** Datos sin columna comercial propia, en formato "clave=valor; …" (segunda empresa, QQ, código postal, escaneo). */
export function formatExtras(c: Capture): string {
  const x = c.ocr_extras;
  const parts: string[] = [];
  if (x?.secondary_companies?.length) parts.push(`segunda_empresa=${x.secondary_companies.join(' | ')}`);
  if (x?.qq.length) parts.push(`qq=${x.qq.join(' | ')}`);
  if (x?.postal_code?.length) parts.push(`codigo_postal=${x.postal_code.join(' | ')}`);
  if (c.scan_issues?.length) parts.push(`escaneo=${c.scan_issues.join(' | ')}`);
  return parts.join('; ');
}
