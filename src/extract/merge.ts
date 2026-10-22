// Fusión frontal + reverso sobre UNA captura (nunca genera otra fila).
// - El frontal es la fuente principal; el reverso completa campos vacíos.
// - Si ambos difieren, se conserva el valor frontal y ambos quedan como candidatos → revisión.
// - Los campos bloqueados por una corrección humana confirmada nunca se modifican.

import { OCR_FIELDS, type Capture, type FieldMeta, type FieldSource, type OcrField, type OcrStatus } from '../domain/schema';
import type { FieldCandidate, Hit, SideExtraction, SideExtras } from './entities';
import { isCjkDominant, sameValue } from './normalize';

export interface MergeResult {
  fields: Partial<Record<OcrField, string>>;
  meta: Partial<Record<OcrField, FieldMeta>>;
  status: Extract<OcrStatus, 'EXTRAIDO' | 'REQUIERE_REVISION'>;
  reviewFields: OcrField[];
  extras: SideExtras;
}

const BILINGUAL = new Set<OcrField>(['company_name', 'contact_name', 'job_title', 'main_products']);

export function mergeSides(front: SideExtraction, back: SideExtraction | undefined, current?: Pick<Capture, 'fields' | 'field_meta'>): MergeResult {
  const fields: MergeResult['fields'] = {};
  const meta: MergeResult['meta'] = {};
  const locked = (f: OcrField) => !!current?.field_meta[f]?.locked;

  const set = (f: OcrField, value: string, m: FieldMeta) => {
    if (locked(f)) return;
    fields[f] = value; meta[f] = m;
  };

  for (const f of OCR_FIELDS) {
    if (f === 'phone_1' || f === 'phone_2') continue;
    const a = front.fields[f];
    const b = back?.fields[f];
    if (a && b) {
      if (sameValue(a.value, b.value) || a.value.includes(b.value)) {
        // misma lectura en ambas caras: se toma la mejor valoración
        set(f, a.value, rankStatus(b.status) < rankStatus(a.status) ? { ...meta1(b, 'ocr_back'), source: 'ocr_front' } : meta1(a, 'ocr_front'));
      }
      else if (f === 'address' && isCjkDominant(a.value) !== isCjkDominant(b.value)) {
        set(f, `${a.value} / ${b.value}`, { ...meta1(a, 'ocr_front'), status: worst(a.status, b.status) });
      } else if (BILINGUAL.has(f) && isCjkDominant(a.value) !== isCjkDominant(b.value)) {
        // misma información en otro idioma: no es contradicción
        set(f, a.value, { ...meta1(a, 'ocr_front'), candidates: uniq([...a.candidates, b.value]), reason: a.reason ?? 'reverso en otro idioma' });
      } else {
        set(f, a.value, { source: 'ocr_front', status: 'review', confidence: a.confidence, candidates: uniq([b.value, ...a.candidates, ...b.candidates]), reason: `frontal y reverso no coinciden (reverso: "${b.value}")` });
      }
    } else if (a) set(f, a.value, meta1(a, 'ocr_front'));
    else if (b) set(f, b.value, meta1(b, 'ocr_back'));
    else {
      const ill = front.illegible[f] ?? back?.illegible[f];
      const sug = front.suggestions[f] ?? back?.suggestions[f];
      set(f, '', ill ? { source: 'ocr_front', status: 'illegible', candidates: [ill], reason: `texto ilegible: "${ill}"` }
        : sug ? { source: 'ocr_front', status: 'absent', candidates: [sug], reason: 'sugerencia: mencionado fuera de la dirección' }
          : { source: 'ocr_front', status: 'absent' });
    }
  }

  // Teléfonos: lista única ordenada (frontal primero), sin duplicar los de WhatsApp/WeChat innecesariamente.
  const phones: (Hit & { side: FieldSource })[] = [];
  for (const [side, list] of [['ocr_front', front.phones], ['ocr_back', back?.phones ?? []]] as const) {
    for (const h of list) if (!phones.some((p) => p.value === h.value)) phones.push({ ...h, side });
  }
  const assign = (f: 'phone_1' | 'phone_2', h: (typeof phones)[number] | undefined, extra: string[]) => {
    if (h) set(f, h.value, { source: h.side, status: h.status, confidence: h.score, reason: h.reason, candidates: extra });
    else {
      const ill = f === 'phone_1' ? front.illegible.phone_1 ?? back?.illegible.phone_1 : undefined;
      set(f, '', ill ? { source: 'ocr_front', status: 'illegible', candidates: [ill], reason: `texto ilegible: "${ill}"` } : { source: 'ocr_front', status: 'absent' });
    }
  };
  assign('phone_1', phones[0], []);
  assign('phone_2', phones[1], phones.slice(2).map((p) => p.value));

  // Resultado efectivo (incluye valores bloqueados que no se tocaron).
  const effective = (f: OcrField) => (locked(f) ? current!.fields[f] : fields[f]) ?? '';
  const effMeta = (f: OcrField) => (locked(f) ? current!.field_meta[f] : meta[f]);
  const reviewFields = OCR_FIELDS.filter((f) => !locked(f) && ['review', 'illegible'].includes(effMeta(f)?.status ?? ''));
  const hasCompany = !!(effective('company_name') || effective('company_name_cn'));
  const hasChannel = ['phone_1', 'email', 'wechat', 'whatsapp', 'website'].some((f) => effective(f as OcrField));
  const status = reviewFields.length || !hasCompany || !hasChannel ? 'REQUIERE_REVISION' : 'EXTRAIDO';

  const ex = (k: keyof SideExtras) => uniq([...front.extras[k], ...(back?.extras[k] ?? [])]);
  const extras: SideExtras = { fax: ex('fax'), qq: ex('qq'), postal_code: ex('postal_code'), secondary_companies: ex('secondary_companies') };
  return { fields, meta, status, reviewFields, extras };
}

function meta1(c: FieldCandidate, source: FieldSource): FieldMeta {
  return { source, status: c.status, confidence: c.confidence, reason: c.reason, candidates: c.candidates.length ? c.candidates : undefined };
}
function rankStatus(s: FieldMeta['status']): number { return ['ok', 'review', 'illegible', 'absent'].indexOf(s); }
function worst(a: FieldMeta['status'], b: FieldMeta['status']): FieldMeta['status'] {
  const order = ['ok', 'review', 'illegible', 'absent'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}
function uniq(a: string[]): string[] { return [...new Set(a.filter(Boolean))]; }
