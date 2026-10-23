// PANTALLA 6 — Proveedores: búsqueda, filtros y render incremental (cientos de capturas sin cargar todas las fotos).
import { h } from '../dom';
import { icon } from '../icons';
import { appBar, emptyState, filterChips } from '../components';
import { matchesFilter, matchesSearch, type ListFilter } from '../model';
import type { Capture } from '../../domain/schema';
import type { Ctx, Route } from '../views';
import { supplierCard } from './shared';

const PAGE = 30;
const FILTERS: [ListFilter, string][] = [['all', 'Todos'], ['pending', 'Pendientes'], ['review', 'Revisión'], ['errors', 'Errores'], ['confirmed', 'Confirmados']];

export async function listScreen(ctx: Ctx, all: Capture[], route: Extract<Route, { name: 'list' }>) {
  let filter = (FILTERS.some(([f]) => f === route.filter) ? route.filter : 'all') as ListFilter;
  let q = route.q ?? '';
  let op = route.op ?? 'all';
  const operators = [...new Set(all.map((c) => c.user_id))].sort();
  const users = new Map(ctx.app.auth.allowedUsers().map((u) => [u.id, u.name]));

  const listEl = h('div', { class: 'list', id: 'capture-list', 'aria-live': 'polite' });
  const countEl = h('p', { class: 'xs muted', id: 'list-count', role: 'status' });
  const filtersEl = h('div');
  let shown = 0; let rows: Capture[] = [];
  let io: IntersectionObserver | undefined;
  const sentinel = h('div', { class: 'sentinel', 'aria-hidden': 'true' });

  const persist = () => history.replaceState({ name: 'list', filter, q, op } satisfies Route, '');
  const more = () => {
    const next = rows.slice(shown, shown + PAGE);
    for (const c of next) listEl.appendChild(supplierCard(ctx, c));
    shown += next.length;
    if (shown < rows.length) listEl.appendChild(sentinel); else sentinel.remove();
  };
  const fill = () => {
    rows = all.filter((c) => matchesFilter(c, filter) && matchesSearch(c, q) && (op === 'all' || c.user_id === op));
    listEl.replaceChildren(); shown = 0;
    countEl.textContent = rows.length === all.length ? `${all.length} proveedores` : `${rows.length} de ${all.length} proveedores`;
    if (!rows.length) {
      listEl.appendChild(all.length
        ? emptyState('search', 'Sin resultados', q ? `Nada coincide con «${q}». Pruebe con la empresa, el contacto o la referencia.` : 'No hay proveedores con este filtro.')
        : emptyState('camera', 'Todavía no hay capturas', 'Las capturas aparecerán aquí en cuanto las guarde.', h('button', { class: 'btn primary', onClick: () => ctx.go({ name: 'capture' }) }, icon('camera'), 'Nueva captura')));
      return;
    }
    more();
  };
  const renderFilters = () => {
    filtersEl.replaceChildren(
      filterChips('Filtrar por estado', FILTERS.map(([f, l]) => [f, `${l} ${all.filter((c) => matchesFilter(c, f)).length}`] as [ListFilter, string]), filter, (v) => { filter = v; persist(); renderFilters(); fill(); }),
      operators.length > 1 ? filterChips('Filtrar por operador', [['all', 'Todos los operadores'], ...operators.map((o) => [o, users.get(o) ?? o] as [string, string])], op, (v) => { op = v; persist(); renderFilters(); fill(); }) : '');
  };

  if (typeof IntersectionObserver !== 'undefined') io = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) more(); }, { rootMargin: '600px 0px' });
  io?.observe(sentinel);
  renderFilters(); fill();

  let t: ReturnType<typeof setTimeout> | undefined;
  const search = h('label', { class: 'search' }, icon('search', 'sm'),
    h('span', { class: 'sr-only' }, 'Buscar proveedor'),
    h('input', { type: 'search', id: 'list-search', value: q, placeholder: 'Empresa, contacto o referencia', autocomplete: 'off', enterKeyHint: 'search',
      onInput: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (t) clearTimeout(t); t = setTimeout(() => { q = v; persist(); fill(); }, 150); } }));

  return h('div', { class: 'screen has-nav', id: 'screen-list' },
    appBar('Proveedores', { sub: `${all.length} capturados`, online: navigator.onLine }),
    h('main', { class: 'content' }, search, filtersEl, countEl, listEl,
      io ? null : h('button', { class: 'btn block', onClick: more }, 'Mostrar más')),
    ctx.nav('list'));
}
