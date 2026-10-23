// Componentes de presentación reutilizables del sistema de diseño COLESCOMEX.
import { h } from './dom';
import { icon } from './icons';
import type { Tone, Track } from './model';

type Child = Parameters<typeof h>[2];

export function appBar(title: string, opts: { back?: () => void; sub?: string; actions?: Child[]; online?: boolean } = {}) {
  return h('header', { class: 'appbar' },
    opts.back ? h('button', { class: 'icon-btn', 'aria-label': 'Volver', onClick: opts.back }, icon('back')) : null,
    h('h1', null, title, opts.sub ? h('span', { class: 'sub' }, opts.sub) : null),
    opts.online === undefined ? null : h('span', { class: 'net-pill', role: 'status' }, icon(opts.online ? 'wifi' : 'wifi-off', 'sm'), opts.online ? 'En línea' : 'Sin conexión'),
    ...(opts.actions ?? []));
}

export type NavKey = 'home' | 'list' | 'capture' | 'review' | 'settings';
export function bottomNav(current: NavKey | null, go: (k: NavKey) => void, badges: Partial<Record<NavKey, number>> = {}) {
  const item = (k: NavKey, ic: string, label: string) => h('button', {
    'aria-current': current === k ? 'page' : undefined, 'data-nav': k, onClick: () => go(k),
    'aria-label': badges[k] ? `${label} (${badges[k]} pendientes)` : label,
  }, icon(ic), label, badges[k] ? h('span', { class: 'count', 'aria-hidden': 'true' }, String(badges[k] > 99 ? '99+' : badges[k])) : null);
  return h('nav', { class: 'bottom-nav', 'aria-label': 'Navegación principal' },
    item('home', 'home', 'Inicio'),
    item('list', 'list', 'Proveedores'),
    h('button', { class: 'fab', id: 'nav-capture', 'data-nav': 'capture', 'aria-label': 'Nueva captura', onClick: () => go('capture') }, icon('camera', 'lg')),
    item('review', 'review', 'Revisión'),
    item('settings', 'settings', 'Ajustes'));
}

export function chip(tone: Tone, ic: string, label: string, opts: { busy?: boolean; title?: string } = {}) {
  return h('span', { class: `chip ${tone === 'neutral' ? '' : tone}${opts.busy ? ' busy' : ''}`, title: opts.title }, icon(ic), label);
}
export function trackChip(t: Track, prefix?: string) {
  return chip(t.tone, t.icon, prefix ? `${prefix}: ${t.label}` : t.label, { busy: t.busy, title: t.detail });
}

/** Las tres etapas separadas: Foto (teléfono) · Datos (extracción) · Google (copia en la nube). */
export function tracks3(photo: Track, data: Track, google: Track) {
  const one = (label: string, t: Track, id: string) => h('div', { class: `track ${t.tone}${t.busy ? ' busy' : ''}`, 'data-track': id, role: 'group', 'aria-label': `${label}: ${t.label}` },
    h('span', { class: 'label' }, label),
    h('span', { class: 'value' }, icon(t.icon), t.label),
    t.detail ? h('span', { class: 'xs muted' }, t.detail) : null);
  return h('div', { class: 'tracks-3' }, one('Foto', photo, 'photo'), one('Datos', data, 'data'), one('Google', google, 'google'));
}

export function metric(n: number, label: string, ic: string, opts: { tone?: 'attention' | 'error' | 'good'; onClick?: () => void; id?: string } = {}) {
  return h('button', { class: `metric ${opts.tone ?? ''}`, id: opts.id, onClick: opts.onClick, 'aria-label': `${label}: ${n}` },
    h('b', null, String(n)), h('span', null, icon(ic, 'sm'), label));
}

export function notice(tone: Tone, ic: string, title: string, body?: Child, actions?: Child[], id?: string) {
  return h('div', { class: `notice ${tone}`, id, role: tone === 'err' ? 'alert' : undefined },
    icon(ic), h('div', { class: 'grow' }, h('b', null, title), body ?? null, actions?.length ? h('div', { class: 'actions' }, ...actions) : null));
}

export function emptyState(ic: string, title: string, body: string, action?: Child) {
  return h('div', { class: 'empty' }, icon(ic), h('b', null, title), h('p', null, body), action ?? null);
}

export function skeletonList(n = 4) {
  return h('div', { class: 'list', 'aria-busy': 'true', 'aria-label': 'Cargando' },
    ...Array.from({ length: n }, () => h('div', { class: 'supplier', 'aria-hidden': 'true' },
      h('div', { class: 'thumb-box skeleton' }),
      h('div', { class: 'stack' }, h('div', { class: 'skeleton line', style: 'width:70%' }), h('div', { class: 'skeleton line', style: 'width:45%' }), h('div', { class: 'skeleton line', style: 'width:60%' })))));
}

export function kv(rows: [string, Child | string | undefined, { href?: string; badge?: Child; id?: string }?][]) {
  return h('dl', { class: 'kv' }, ...rows.flatMap(([k, v, o]) => {
    const empty = v === undefined || v === '' || (Array.isArray(v) && !v.length);
    return [h('dt', null, k), h('dd', { class: empty ? 'is-empty' : '', 'data-kv': o?.id },
      empty ? 'Sin dato' : o?.href ? h('a', { href: o.href, rel: 'noopener', target: o.href.startsWith('http') ? '_blank' : undefined }, v as string) : v, o?.badge ?? null)];
  }));
}

export function sectionCard(id: string, ic: string, title: string, body: Child, action?: Child) {
  return h('section', { class: 'card section-card', id, 'aria-labelledby': `${id}-t` },
    h('header', null, h('h2', { id: `${id}-t` }, icon(ic), title), action ?? null), body);
}

export function segmented<T extends string>(label: string, options: [T, string, string?][], value: T, onChange: (v: T) => void) {
  return h('div', { class: 'segmented', role: 'group', 'aria-label': label },
    ...options.map(([v, text, ic]) => h('button', { 'aria-pressed': String(v === value), 'data-value': v, onClick: () => onChange(v) }, ic ? icon(ic, 'sm') : null, text)));
}

export function filterChips<T extends string>(label: string, options: [T, string][], value: T, onChange: (v: T) => void) {
  return h('div', { class: 'filters', role: 'group', 'aria-label': label },
    ...options.map(([v, text]) => h('button', { class: 'filter', 'aria-pressed': String(v === value), 'data-filter': v, onClick: () => onChange(v) }, text)));
}

export const EVIDENCE_ICON: Record<string, string> = { card_front: 'card', card_back: 'flip', stand: 'store', product: 'box', catalog: 'file', other: 'image' };
