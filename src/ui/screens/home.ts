// PANTALLA 2 — Inicio: estado de la jornada de un vistazo y acceso inmediato a «Nueva captura».
import { h } from '../dom';
import { icon } from '../icons';
import { appBar, emptyState, metric, notice } from '../components';
import { matchesFilter } from '../model';
import type { Capture } from '../../domain/schema';
import type { Ctx } from '../views';
import { deviceNotices, online, supplierCard } from './shared';

export async function homeScreen(ctx: Ctx, all: Capture[]) {
  const u = ctx.user!;
  const today = new Date().toDateString();
  const mine = all.filter((c) => new Date(c.created_at).toDateString() === today);
  const ocrPending = all.filter((c) => c.ocr_status === 'CAPTURADO' || c.ocr_status === 'PROCESANDO').length;
  const syncPending = all.filter((c) => c.sync_status !== 'CONFIRMADO' && c.sync_status !== 'ERROR').length;
  const confirmed = all.filter((c) => c.sync_status === 'CONFIRMADO').length;
  const review = all.filter((c) => matchesFilter(c, 'review')).length;
  const errors = all.filter((c) => matchesFilter(c, 'errors')).length;
  const draft = await ctx.app.repo.getMeta<{ evidences: unknown[] }>(`draft:${u.id}`);

  return h('div', { class: 'screen has-nav', id: 'screen-home' },
    appBar(`Hola, ${u.name}`, { sub: 'Feria de Cantón · Fase 2', online: online() }),
    h('main', { class: 'content' },
      ...(await deviceNotices(ctx)),
      draft?.evidences?.length ? notice('warn', 'camera', 'Captura sin terminar', h('p', null, `Hay ${draft.evidences.length} foto(s) protegidas en este teléfono sin guardar como proveedor.`),
        [h('button', { class: 'btn sm primary', id: 'btn-resume', onClick: () => ctx.go({ name: 'capture' }) }, 'Continuar captura')], 'draft-warn') : null,
      h('button', { class: 'btn primary lg block', id: 'btn-register', onClick: () => ctx.go({ name: 'capture' }) }, icon('camera'), 'Nueva captura'),
      h('div', { class: 'row' },
        h('button', { class: 'btn grow', id: 'btn-list', onClick: () => ctx.go({ name: 'list' }) }, icon('list'), 'Proveedores'),
        h('button', { class: 'btn grow', id: 'btn-sync', onClick: () => ctx.go({ name: 'sync' }) }, icon('refresh'), 'Sincronizar')),
      review ? h('button', { class: 'btn block', id: 'btn-review', onClick: () => ctx.go({ name: 'review' }) }, icon('review'), `Revisar pendientes (${review})`) : null,
      h('h2', { class: 'section-title' }, 'Resumen'),
      h('div', { class: 'metrics', id: 'metrics' },
        metric(all.length, 'Capturas totales', 'layers', { id: 'm-total', onClick: () => ctx.go({ name: 'list' }) }),
        metric(mine.length, 'Hoy', 'clock', { id: 'm-today', onClick: () => ctx.go({ name: 'list' }) }),
        metric(ocrPending, 'Lectura pendiente', 'loader', { id: 'm-ocr', onClick: () => ctx.go({ name: 'list', filter: 'pending' }) }),
        metric(syncPending, 'Sincronización pendiente', 'cloud-up', { id: 'm-sync', onClick: () => ctx.go({ name: 'sync' }) }),
        metric(confirmed, 'Confirmadas en Google', 'cloud-ok', { id: 'm-confirmed', tone: 'good', onClick: () => ctx.go({ name: 'list', filter: 'confirmed' }) }),
        metric(review, 'Requieren revisión', 'alert', { id: 'm-review', tone: review ? 'attention' : undefined, onClick: () => ctx.go({ name: 'review' }) }),
        metric(errors, 'Con errores', 'alert-circle', { id: 'm-errors', tone: errors ? 'error' : undefined, onClick: () => ctx.go({ name: 'list', filter: 'errors' }) })),
      h('p', { class: 'xs muted' }, '«Confirmada en Google» significa que la foto y la fila llegaron a Drive y Sheets; no que los datos estén verificados.'),
      h('div', { class: 'row between' }, h('h2', { class: 'section-title' }, 'Últimas capturas'),
        all.length ? h('button', { class: 'btn ghost sm', onClick: () => ctx.go({ name: 'list' }) }, 'Ver todas') : null),
      all.length
        ? h('div', { class: 'list', id: 'capture-list' }, ...all.slice(0, 5).map((c) => supplierCard(ctx, c)))
        : emptyState('camera', 'Todavía no hay capturas', 'Pulse «Nueva captura» y fotografíe la tarjeta del proveedor. Funciona sin conexión.')),
    ctx.nav('home'));
}
