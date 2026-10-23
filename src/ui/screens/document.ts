// PANTALLA 4 — Documento: procesado / original / comparar, estado REAL del escáner y ajuste de esquinas.
import { h, blobUrl, toast } from '../dom';
import { icon } from '../icons';
import { appBar, chip, emptyState, notice, segmented } from '../components';
import { EVIDENCE_LABELS, type Evidence, type EvidenceKind } from '../../domain/schema';
import type { Ctx, Route } from '../views';
import { openCornerEditor } from './corners';

type View = 'processed' | 'original' | 'compare';

export async function documentScreen(ctx: Ctx, route: Extract<Route, { name: 'doc' }>) {
  const c = await ctx.app.repo.get(route.uuid);
  const back = () => ctx.back();
  if (!c) return h('div', { class: 'screen' }, appBar('Documento', { back }), h('main', { class: 'content' }, emptyState('alert', 'Captura no encontrada', '')));
  const evs = await ctx.app.repo.evidences(c.uuid);
  const kind = route.kind as EvidenceKind;
  const original = evs.filter((e) => e.kind === kind && e.role !== 'processed').at(-1);
  const processed = original ? evs.find((e) => e.role === 'processed' && e.derived_from === original.id && !e.superseded_by) : undefined;
  if (!original) return h('div', { class: 'screen' }, appBar(EVIDENCE_LABELS[kind] ?? 'Documento', { back }), h('main', { class: 'content' }, emptyState('image', 'Evidencia no disponible', '')));

  const isCard = kind === 'card_front' || kind === 'card_back';
  const working = c.ocr_status === 'CAPTURADO' || c.ocr_status === 'PROCESANDO';
  let view: View = route.view ?? (processed ? 'processed' : 'original');
  if (!processed && view !== 'original') view = 'original';
  const stage = h('div', { class: 'stack' });
  const imgOf = (e: Evidence, alt: string) => e.mime.startsWith('image/') ? h('img', { src: blobUrl(e.blob), alt, decoding: 'async' }) : h('div', { class: 'empty' }, icon('file'), h('b', null, 'Documento PDF'), h('a', { class: 'btn', href: blobUrl(e.blob), target: '_blank', rel: 'noopener' }, 'Abrir'));
  const draw = () => {
    history.replaceState({ ...route, view } satisfies Route, '');
    stage.replaceChildren(view === 'compare' && processed
      ? h('div', { class: 'compare', id: 'doc-compare' },
          h('figure', null, imgOf(original, 'Foto original'), h('figcaption', null, 'Original (sin modificar)')),
          h('figure', null, imgOf(processed, 'Documento procesado'), h('figcaption', null, 'Procesado')))
      : h('div', { class: 'doc-view', id: 'doc-view', 'data-view': view }, imgOf(view === 'processed' && processed ? processed : original, view === 'processed' ? 'Documento procesado' : 'Foto original')));
  };

  const sc = original.scan;
  const state = !isCard ? null
    : processed ? notice('ok', 'crop', sc?.status === 'manual' || sc?.manual_quad ? 'Recortado con sus esquinas' : 'Documento recortado y enderezado',
        h('p', null, `${sc?.rotation ? `Texto girado ${sc.rotation}°. ` : ''}${sc?.output_size ? `${sc.output_size.width}×${sc.output_size.height} px. ` : ''}El original se conserva intacto.`), undefined, 'scan-state')
    : working ? notice('info', 'loader', 'Procesando documento', h('p', null, 'El recorte todavía no existe; se mostrará aquí cuando el escáner termine. Puede seguir capturando.'), undefined, 'scan-state')
    : sc ? notice('warn', 'alert', sc.multiple ? 'Hay varias tarjetas en la foto' : 'No se detectaron los bordes con confianza',
        h('p', null, 'Se usa la foto original para leer los datos. Si lo desea, ajuste las 4 esquinas a mano.'), undefined, 'scan-state')
    : notice('neutral', 'info', 'Sin procesar', h('p', null, 'El escáner no se ha ejecutado para esta foto.'), undefined, 'scan-state');

  const adjust = isCard && original.mime.startsWith('image/') ? h('button', { class: 'btn', id: 'btn-adjust', disabled: c.ocr_status === 'PROCESANDO', onClick: () => {
    ctx.setDirty(true);
    void openCornerEditor(original, {
      onSave: async (q) => { await ctx.app.setManualCorners(original.id, q); toast('Esquinas guardadas · procesando documento'); },
      onAuto: async () => { await ctx.app.setManualCorners(original.id, undefined); toast('Se volverá a detectar automáticamente'); },
      onClose: () => { ctx.setDirty(false); ctx.refresh(); },
    });
  } }, icon('crop'), 'Ajustar 4 esquinas') : null;

  draw();
  const OPTS: [View, string, string][] = [['processed', 'Procesado', 'crop'], ['original', 'Original', 'image'], ['compare', 'Comparar', 'layers']];
  // el segmentado se reconstruye para reflejar aria-pressed sin re-render completo
  const mkSeg = (): HTMLElement => segmented<View>('Vista del documento', OPTS, view, (v) => { view = v; const n = mkSeg(); segs.replaceWith(n); segs = n; draw(); });
  let segs = mkSeg();
  return h('div', { class: 'screen has-nav', id: 'screen-doc' },
    appBar(EVIDENCE_LABELS[kind], { back, sub: c.external_ref }),
    h('main', { class: 'content' },
      processed ? segs : null,
      stage, state,
      h('div', { class: 'row' }, adjust,
        isCard ? h('button', { class: 'btn', id: 'btn-reprocess', disabled: c.ocr_status === 'PROCESANDO', onClick: async () => { await ctx.app.reprocessOcr(c.uuid); toast('Reproceso en cola'); } }, icon('refresh'), 'Reprocesar') : null,
        sc?.status ? chip('neutral', 'info', `Confianza ${Math.round((sc.confidence ?? 0) * 100)} %`) : null),
      h('p', { class: 'xs muted' }, 'Para sustituir la foto, capture de nuevo al proveedor o avise a soporte: las evidencias guardadas no se borran desde el teléfono.')),
    ctx.nav(null));

}
