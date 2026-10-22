import { COMMERCIAL_FIELDS, OCR_FIELDS, type Capture, type Evidence, type OcrResultRecord } from '../domain/schema';

/** Fila de Google Sheets: columnas comerciales + técnicas, todo como texto (valueInputOption=RAW). */
export function toSheetRow(c: Capture, evs: Evidence[], ocr: OcrResultRecord[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (const f of COMMERCIAL_FIELDS) row[f] = c.fields[f] ?? '';
  const review = OCR_FIELDS.filter((f) => ['review', 'illegible'].includes(c.field_meta[f]?.status ?? ''));
  const cap = (s = '') => (s.length > 45000 ? `${s.slice(0, 45000)}…` : s); // límite de celda de Sheets: 50 000
  Object.assign(row, {
    capture_uuid: c.uuid,
    record_revision: String(c.revision),
    ocr_status: c.ocr_status,
    review_status: c.review_status,
    review_fields: review.join(', '),
    evidence_folder_id: c.remote?.folder_id ?? '',
    evidence_folder_url: c.remote?.folder_url ?? '',
    evidence_ids: evs.map((e) => e.id).join(', '),
    evidence_files: evs.map((e) => `${e.kind}: ${e.remote_url ?? '(pendiente)'}`).join('\n'),
    ocr_engine: c.ocr_engine ?? '',
    ocr_fax: c.ocr_extras?.fax.join(', ') ?? '',
    ocr_text_front: cap(ocr.find((o) => o.side === 'front')?.text),
    ocr_text_back: cap(ocr.find((o) => o.side === 'back')?.text),
    device_id: c.device_id,
    created_at: c.created_at,
    updated_at: c.updated_at,
    app_version: c.app_version,
  });
  return row;
}
