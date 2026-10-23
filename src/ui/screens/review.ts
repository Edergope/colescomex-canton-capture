// PANTALLA 8 — Revisión inteligente: solo los datos que necesitan intervención. Nada se aprueba solo.
import { h, toast, confirmSheet, blobUrl } from '../dom';
import { icon } from '../icons';
import { appBar, chip, emptyState, notice } from '../components';
import { displayName, quotedTokens, reviewItems, type ReviewItem } from '../model';
import { BUSINESS_CARD } from '../../scanner/profiles';
import type { Capture, CommercialField, OcrLine, OcrResultRecord } from '../../domain/schema';
import type { Ctx } from '../views';
import { supplierCard } from './shared';

export async function reviewScreen(ctx: Ctx, all: Capture[], uuid?: string) {
  if (!uuid) return reviewQueue(ctx, all);
  const c = await ctx.app.repo.get(uuid);
  if (!c) return h('div', { class: 'screen' }, appBar('Revisión', { back: () => ctx.back() }), h('main', { class: 'content' }, emptyState('alert', 'Captura no encontrada', '')));
  const items = reviewItems(c);
  const ocr = await ctx.app.repo.ocrResults(uuid);
  const n = displayName(c);
  const fieldItems = items.filter((i) => i.field !== 'scan');
  const scanItems = items.filter((i) => i.field === 'scan');
  const queue = all.filter((x) => x.uuid !== uuid && reviewItems(x).length);

  const done = !items.length;
  return h('div', { class: 'screen has-nav', id: 'screen-review-item' },
    appBar('Revisión', { back: () => ctx.back(), sub: `${c.external_ref} · ${n.text}` }),
    h('main', { class: 'content' },
      done ? notice('ok', 'check-circle', 'No queda nada por revisar en esta captura', h('p', null, c.review_status === 'REVISADO' ? 'La revisión está confirmada.' : 'Todos los datos dudosos fueron aprobados o corregidos.'), undefined, 'review-done')
        : h('p', { class: 'small muted', role: 'status' }, `${items.length} ${items.length === 1 ? 'punto requiere' : 'puntos requieren'} su decisión. Lo que apruebe o corrija queda bloqueado frente a reprocesos.`),
      ...scanItems.map((it) => h('article', { class: 'card review-item', 'data-review': 'scan' },
        h('div', { class: 'row' }, chip('warn', 'crop', 'Documento'), h('b', { class: 'grow' }, 'Recorte o lectura del documento')),
        h('p', null, it.reason),
        h('div', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => ctx.go({ name: 'doc', uuid, kind: /reverso/i.test(it.reason) ? 'card_back' : 'card_front', view: 'original' }) }, icon('crop', 'sm'), 'Ver y ajustar esquinas')))),
      ...fieldItems.map((it) => fieldCard(ctx, c, it, ocr)),
      !done && c.review_status !== 'REVISADO' ? h('button', { class: 'btn block', id: 'btn-confirm-all', onClick: async () => {
        const ok = await confirmSheet('Confirmar la captura completa', fieldItems.length ? `Aún hay ${fieldItems.length} dato(s) sin decidir. Si confirma, se aprueban tal como están.` : 'Confirma que revisó el documento. Los datos actuales quedarán bloqueados.', 'Confirmar revisión');
        if (!ok) return;
        await ctx.app.confirmReview(uuid); toast('Revisión confirmada'); ctx.refresh();
      } }, icon('check-circle'), 'Confirmar revisión de la captura') : null,
      queue.length ? h('button', { class: 'btn primary block', id: 'btn-next-review', onClick: () => ctx.replace({ name: 'review', uuid: queue[0].uuid }) }, `Siguiente pendiente (${queue.length})`, icon('chevron')) : null,
      h('button', { class: 'btn ghost block', onClick: () => ctx.go({ name: 'detail', uuid }) }, 'Ver ficha completa')),
    ctx.nav('review'));
}

function reviewQueue(ctx: Ctx, all: Capture[]) {
  const pend = all.filter((c) => reviewItems(c).length);
  return h('div', { class: 'screen has-nav', id: 'screen-review' },
    appBar('Revisión', { sub: pend.length ? `${pend.length} capturas con datos dudosos` : 'Al día' }),
    h('main', { class: 'content' },
      pend.length ? h('p', { class: 'small muted' }, 'Solo aparecen los datos que el sistema no pudo leer con seguridad. Nada se aprueba automáticamente.') : null,
      pend.length ? h('button', { class: 'btn primary lg block', id: 'btn-start-review', onClick: () => ctx.go({ name: 'review', uuid: pend[0].uuid }) }, icon('review'), 'Empezar revisión') : null,
      pend.length ? h('div', { class: 'list', id: 'review-list' }, ...pend.map((c) => supplierCard(ctx, c, () => ctx.go({ name: 'review', uuid: c.uuid })))) : emptyState('check-circle', 'Nada pendiente de revisión', 'Cuando una lectura sea dudosa aparecerá aquí con la parte del documento que la respalda.')),
    ctx.nav('review'));
}

function fieldCard(ctx: Ctx, c: Capture, it: ReviewItem, ocr: OcrResultRecord[]) {
  const f = it.field as CommercialField;
  const found = findLine(ocr, it);
  // el texto tal como se leyó, sin la etiqueta impresa («WeChat:», «Products:»…)
  const original = found?.line.text.replace(/^[\p{L} .]{2,20}[:：]\s*/u, '').trim();
  const input = h('input', { name: f, id: `rv-${f}`, value: it.value, autocomplete: 'off' });
  const region = h('div', { class: 'region', 'aria-live': 'polite' });
  if (found) void cropRegion(ctx, found.rec, found.line).then((r) => {
    if (!r) return;
    region.replaceChildren(h('figure', { style: 'margin:0', class: 'stack' }, h('img', { class: 'evidence-crop', src: r.url, alt: `Región del documento donde se leyó ${it.label}` }),
      h('figcaption', { class: 'xs muted' }, `${found.rec.side === 'front' ? 'Anverso' : 'Reverso'}${r.approx ? ' · región aproximada' : ''}`)));
  });
  const decide = async (v: string, msg: string) => {
    await ctx.app.editFields(c.uuid, { [f]: v } as Partial<Record<CommercialField, string>>);
    toast(msg); ctx.refresh();
  };
  const sameAsOriginal = !original || norm(original) === norm(it.value);
  const approve = h('button', { class: 'btn primary grow', 'data-approve': f,
    onClick: () => decide(input.value, !input.value.trim() ? 'Se dejó sin dato' : input.value.trim() === it.value.trim() ? 'Valor aprobado' : 'Corrección guardada') });
  const label = () => approve.replaceChildren(icon('check'), input.value.trim() ? (input.value.trim() === it.value.trim() ? 'Aprobar' : 'Guardar corrección') : 'Dejar sin dato');
  input.addEventListener('input', label); label();
  return h('article', { class: 'card review-item', 'data-review': f },
    h('div', { class: 'row' }, chip(it.illegible ? 'err' : 'warn', 'alert', it.illegible ? 'Ilegible' : 'Revisar'), h('b', { class: 'grow' }, it.label)),
    h('p', { class: 'small' }, it.reason),
    original ? h('div', { class: 'stack', style: 'gap:4px' }, h('span', { class: 'xs muted strong' }, 'Texto reconocido en la foto'), h('div', { class: 'original', 'data-original': '1' }, original)) : null,
    region,
    h('div', { class: 'stack', style: 'gap:4px' }, h('span', { class: 'xs muted strong' }, 'Valor sugerido'),
      h('div', { class: 'suggestion', 'data-suggestion': '1' }, it.value || h('span', { class: 'muted' }, 'Sin valor sugerido'))),
    it.candidates.length ? h('div', { class: 'row xs' }, h('span', { class: 'muted' }, 'Otras lecturas:'), ...it.candidates.map((v) => h('button', { type: 'button', class: 'btn sm', onClick: () => { input.value = v; input.dispatchEvent(new Event('input')); input.focus(); } }, v))) : null,
    h('div', { class: 'field' }, h('label', { for: `rv-${f}` }, 'Valor final (editable)'), input),
    h('div', { class: 'row' },
      !sameAsOriginal ? h('button', { class: 'btn grow', 'data-keep': f, onClick: () => decide(original!, 'Se conservó el texto original') }, 'Conservar original') : null,
      approve));
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}@.]+/gu, '');

/** Línea del OCR que respalda el dato: primero las palabras citadas en el motivo, luego el valor. */
function findLine(ocr: OcrResultRecord[], it: ReviewItem): { rec: OcrResultRecord; line: OcrLine } | undefined {
  const needles = [...quotedTokens(it.reason), ...it.value.split(/\s*[;\n]\s*/), it.value].map(norm).filter((x) => x.length >= 3);
  for (const n of needles) for (const rec of ocr) for (const line of rec.lines) {
    const t = norm(line.text);
    if (t && (t.includes(n) || (n.includes(t) && t.length >= 4))) return { rec, line };
  }
  return undefined;
}

/** Recorta la zona de la línea en la imagen leída. Las cajas están en la imagen de entrada del OCR (lado ≤ ocrInputSide). */
async function cropRegion(ctx: Ctx, rec: OcrResultRecord, line: OcrLine): Promise<{ url: string; approx: boolean } | undefined> {
  if (!line.box?.length || !rec.read_from) return undefined;
  const ev = await ctx.app.repo.getEvidence(rec.read_from);
  if (!ev || !ev.mime.startsWith('image/')) return undefined;
  try {
    const bmp = await createImageBitmap(ev.blob);
    const rot = ev.role === 'processed' ? 0 : ((rec.rotation ?? 0) % 360 + 360) % 360; // el procesado ya está enderezado
    const W = rot % 180 ? bmp.height : bmp.width, H = rot % 180 ? bmp.width : bmp.height;
    const s = Math.max(W, H) / Math.min(Math.max(W, H), BUSINESS_CARD.ocrInputSide);
    const xs = line.box.map((p) => p[0] * s), ys = line.box.map((p) => p[1] * s);
    const pad = Math.max(12, (Math.max(...ys) - Math.min(...ys)) * 0.8);
    const x0 = Math.max(0, Math.min(...xs) - pad), y0 = Math.max(0, Math.min(...ys) - pad);
    const x1 = Math.min(W, Math.max(...xs) + pad), y1 = Math.min(H, Math.max(...ys) + pad);
    if (x1 - x0 < 4 || y1 - y0 < 4) { bmp.close(); return undefined; }
    const scale = Math.min(1, 900 / (x1 - x0));
    const cv = document.createElement('canvas');
    cv.width = Math.round((x1 - x0) * scale); cv.height = Math.round((y1 - y0) * scale);
    const g = cv.getContext('2d')!;
    g.scale(scale, scale); g.translate(-x0, -y0);
    // rotación horaria de la foto completa hasta la orientación en que se leyó
    g.translate(W / 2, H / 2); g.rotate((rot * Math.PI) / 180); g.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/jpeg', 0.85));
    cv.width = cv.height = 0;
    return blob ? { url: blobUrl(blob), approx: ev.role !== 'processed' } : undefined;
  } catch { return undefined; }
}
