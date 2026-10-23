// Ajuste manual de las 4 esquinas (excepcional). Trabaja sobre la foto ORIGINAL; nunca la modifica.
import { h, blobUrl, revokeUrl } from '../dom';
import { icon } from '../icons';
import type { Evidence } from '../../domain/schema';

type P = { x: number; y: number };
const NAMES = ['superior izquierda', 'superior derecha', 'inferior derecha', 'inferior izquierda'];

export async function openCornerEditor(ev: Evidence, opts: { onSave: (q: P[]) => Promise<void>; onAuto?: () => Promise<void>; onClose?: () => void }) {
  const url = blobUrl(ev.blob);
  const img = h('img', { src: url, alt: 'Foto original de la tarjeta', class: 'ce-img' });
  await img.decode().catch(() => undefined);
  const W = img.naturalWidth || 1, H = img.naturalHeight || 1;
  const pts: P[] = (ev.scan?.manual_quad ?? ev.scan?.quad ?? [{ x: W * 0.1, y: H * 0.1 }, { x: W * 0.9, y: H * 0.1 }, { x: W * 0.9, y: H * 0.9 }, { x: W * 0.1, y: H * 0.9 }]).map((p) => ({ ...p }));
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'ce-svg');
  const poly = document.createElementNS(NS, 'polygon'); poly.setAttribute('class', 'ce-poly'); svg.appendChild(poly);
  const r = Math.max(W, H) * 0.028;
  const handles = pts.map((_, i) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', String(r)); c.setAttribute('class', 'ce-handle'); c.setAttribute('data-i', String(i));
    c.setAttribute('tabindex', '0'); c.setAttribute('role', 'slider'); c.setAttribute('aria-label', `Esquina ${NAMES[i]} (use las flechas)`);
    c.addEventListener('keydown', (e: KeyboardEvent) => {
      const step = Math.max(W, H) * (e.shiftKey ? 0.02 : 0.005);
      const d: Record<string, P> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
      if (!d[e.key]) return; e.preventDefault();
      pts[i] = { x: clamp(pts[i].x + d[e.key].x, W), y: clamp(pts[i].y + d[e.key].y, H) }; draw();
    });
    svg.appendChild(c); return c;
  });
  const draw = () => {
    poly.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
    handles.forEach((c, i) => { c.setAttribute('cx', String(pts[i].x)); c.setAttribute('cy', String(pts[i].y)); });
  };
  draw();
  let drag = -1;
  const toImg = (e: PointerEvent) => { const b = svg.getBoundingClientRect(); return { x: ((e.clientX - b.left) / b.width) * W, y: ((e.clientY - b.top) / b.height) * H }; };
  svg.addEventListener('pointerdown', (e) => {
    const p = toImg(e);
    // la esquina más cercana al dedo: no hace falta acertar el punto exacto
    drag = pts.reduce((m, q, i) => (Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(pts[m].x - p.x, pts[m].y - p.y) ? i : m), 0);
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => { if (drag < 0) return; const p = toImg(e); pts[drag] = { x: clamp(p.x, W), y: clamp(p.y, H) }; draw(); });
  svg.addEventListener('pointerup', () => { drag = -1; });

  const prev = document.activeElement as HTMLElement | null;
  const close = () => { overlay.remove(); revokeUrl(url); document.removeEventListener('keydown', onKey); opts.onClose?.(); prev?.focus?.(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const busy = (b: HTMLButtonElement, fn: () => Promise<void>) => async () => { b.disabled = true; try { await fn(); close(); } finally { b.disabled = false; } };
  const save: HTMLButtonElement = h('button', { class: 'btn primary grow', id: 'ce-save' }, icon('check'), 'Guardar esquinas');
  save.addEventListener('click', busy(save, () => opts.onSave(pts)));
  const auto: HTMLButtonElement | null = ev.scan?.manual_quad && opts.onAuto ? h('button', { class: 'btn grow', id: 'ce-auto' }, 'Volver a automático') : null;
  auto?.addEventListener('click', busy(auto, opts.onAuto!));
  const overlay = h('div', { class: 'ce-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ajustar esquinas del documento', id: 'corner-editor' },
    h('div', { class: 'ce-head' }, h('button', { class: 'icon-btn', style: 'color:#fff', 'aria-label': 'Cerrar sin guardar', onClick: close }, icon('x')),
      h('b', { class: 'grow' }, 'Ajustar esquinas')),
    h('div', { class: 'ce-stage' }, img, svg),
    h('div', { class: 'stack', style: 'padding:0 16px' },
      h('p', { class: 'small', style: 'color:#d6deea' }, 'Arrastre cada esquina amarilla hasta el borde de la tarjeta. La foto original no se modifica; se generará un nuevo recorte.')),
    h('div', { class: 'ce-foot' }, h('button', { class: 'btn grow', onClick: close }, 'Cancelar'), auto, save));
  document.body.appendChild(overlay);
  save.focus();
}
const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));
