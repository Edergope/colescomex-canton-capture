// Piezas compartidas entre pantallas (tarjeta de proveedor, miniatura diferida, avisos globales).
import { h } from '../dom';
import { IS_PREVIEW, SIMULATED_SYNC } from '../../config/env';
import { icon } from '../icons';
import { chip, notice, trackChip } from '../components';
import { dataTrack, displayName, googleTrack, relTime, reviewItems } from '../model';
import { primaryEvidences } from '../../storage/repo';
import { storagePressure } from '../../pipeline/resources';
import type { Capture } from '../../domain/schema';
import type { Ctx } from '../views';

/** Miniatura procesada (o la original si aún no hay recorte) de la cara frontal, cargada solo cerca del viewport. */
export function thumbBox(ctx: Ctx, c: Capture) {
  const box = h('div', { class: 'thumb-box', 'aria-hidden': 'true' }, icon('card'));
  ctx.thumbs.observe(box, async () => {
    const evs = primaryEvidences(await ctx.app.repo.evidences(c.uuid));
    const e = evs.find((x) => x.kind === 'card_front') ?? evs.find((x) => x.mime.startsWith('image/'));
    return e && e.mime.startsWith('image/') ? e.blob : undefined;
  });
  return box;
}

export function supplierCard(ctx: Ctx, c: Capture, onOpen?: () => void) {
  const n = displayName(c);
  const rv = reviewItems(c).length;
  const sub = [c.fields.contact_name, c.fields.booth ? `Stand ${c.fields.booth}` : ''].filter(Boolean).join(' · ');
  return h('button', { class: 'supplier', 'data-ref': c.external_ref, 'data-uuid': c.uuid, onClick: onOpen ?? (() => ctx.go({ name: 'detail', uuid: c.uuid })),
    'aria-label': `${n.text}. ${c.external_ref}. ${dataTrack(c).label}. ${googleTrack(c).label}` },
    thumbBox(ctx, c),
    h('div', { class: 'stack', style: 'gap:2px;min-width:0' },
      h('span', { class: `name${n.pending ? ' pending' : ''}` }, n.text),
      sub ? h('span', { class: 'meta' }, sub) : null,
      h('span', { class: 'meta mono' }, `${c.external_ref} · ${relTime(c.created_at)} · ${c.fields.captured_by || c.user_id}`),
      h('span', { class: 'chips' },
        trackChip(dataTrack(c)),
        trackChip(googleTrack(c)),
        rv && c.ocr_status !== 'REQUIERE_REVISION' ? chip('warn', 'alert', `Revisar ${rv}`) : null)));
}

/** Avisos de estado del dispositivo: almacenamiento, persistencia, memoria baja, configuración. */
export async function deviceNotices(ctx: Ctx): Promise<HTMLElement[]> {
  const out: HTMLElement[] = [];
  if (ctx.info.configProblems.length) out.push(notice('err', 'alert-circle', 'Sincronización bloqueada por configuración', h('p', null, 'Las capturas se guardan en el teléfono, pero no se enviarán a Google hasta corregir la configuración. Avise al responsable técnico.'), undefined, 'config-warn'));
  const sp = await storagePressure().catch(() => null);
  if (sp && sp.ratio > 0.85) out.push(notice('warn', 'database', 'Almacenamiento insuficiente', h('p', null, `El teléfono tiene ${sp.usageMb} de ${sp.quotaMb} MB ocupados. Sincronice con Google pronto; no borre la app.`), undefined, 'storage-warn'));
  if (SIMULATED_SYNC) out.push(notice('warn', 'alert', 'Vista previa de pruebas', h('p', null, 'Sincronización SIMULADA: nada se envía a Google. Use la app oficial para capturas reales. No instale esta vista previa.'), undefined, 'preview-warn'));
  // la vista previa es solo para pruebas: no se recomienda instalarla
  if (!IS_PREVIEW && ctx.info.storage && !ctx.info.storage.persisted) out.push(notice('info', 'shield', 'Instale la app en la pantalla de inicio', h('p', null, 'El navegador no garantizó almacenamiento persistente. Instalada, sus capturas están más protegidas.')));
  const g = ctx.app.governor;
  if (g?.profile === 'low') out.push(notice('info', 'gauge', 'Modo de bajo consumo activo', h('p', null, `El escáner y la lectura se alternan para no agotar la memoria (${g.state.reason}). Es más lento pero más estable.`),
    [h('button', { class: 'btn sm', onClick: async () => { await g.setProfile('standard', 'elegido por el usuario'); ctx.refresh(); } }, 'Usar modo estándar')], 'low-memory'));
  return out;
}

export function online() { return navigator.onLine; }
