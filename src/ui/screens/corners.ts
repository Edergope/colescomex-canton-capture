// Ajuste manual de las 4 esquinas, con LUPA para colocarlas con precisión. Trabaja sobre la foto ORIGINAL
// (nunca la modifica). Se usa en la captura (antes de guardar) y en el documento de una captura guardada.
import { h, blobUrl, revokeUrl } from '../dom';
import { icon } from '../icons';

type P = { x: number; y: number };
const NAMES = ['superior izquierda', 'superior derecha', 'inferior derecha', 'inferior izquierda'];
const ZOOM = 3, LOUPE = 132;

export interface CornerSource { blob: Blob; quad?: P[] }
export interface CornerEditorOptions {
  onSave: (q: P[]) => Promise<void>;
  /** volver a la detección automática (solo si ya había un ajuste manual) */
  onAuto?: () => Promise<void>;
  /** conservar la foto completa (sin recorte) */
  onFull?: () => Promise<void>;
  onClose?: () => void;
  title?: string;
}

export async function openCornerEditor(src: CornerSource, opts: CornerEditorOptions) {
  const url = blobUrl(src.blob);
  const img = h('img', { src: url, alt: 'Foto original de la tarjeta', class: 'ce-img' });
  await img.decode().catch(() => undefined);
  const W = img.naturalWidth || 1, H = img.naturalHeight || 1;
  const pts: P[] = (src.quad?.length === 4 ? src.quad : [{ x: W * 0.1, y: H * 0.1 }, { x: W * 0.9, y: H * 0.1 }, { x: W * 0.9, y: H * 0.9 }, { x: W * 0.1, y: H * 0.9 }]).map((p) => ({ x: clamp(p.x, W), y: clamp(p.y, H) }));
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'ce-svg');
  const poly = document.createElementNS(NS, 'polygon'); poly.setAttribute('class', 'ce-poly'); svg.appendChild(poly);
  const r = Math.max(W, H) * 0.028;
  const loupe = h('canvas', { class: 'ce-loupe', width: LOUPE * 2, height: LOUPE * 2, 'aria-hidden': 'true' });
  loupe.hidden = true;
  let active = -1;
  let drag = -1;
  const handles = pts.map((_, i) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('r', String(r)); c.setAttribute('class', 'ce-handle'); c.setAttribute('data-i', String(i));
    c.setAttribute('tabindex', '0'); c.setAttribute('role', 'slider'); c.setAttribute('aria-label', `Esquina ${NAMES[i]} (use las flechas)`);
    c.addEventListener('focus', () => { active = i; draw(); showLoupe(); });
    c.addEventListener('blur', () => { if (drag < 0) loupe.hidden = true; });
    c.addEventListener('keydown', (e: KeyboardEvent) => {
      const step = Math.max(W, H) * (e.shiftKey ? 0.02 : 0.003);
      const d: Record<string, P> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
      if (!d[e.key]) return; e.preventDefault();
      pts[i] = { x: clamp(pts[i].x + d[e.key].x, W), y: clamp(pts[i].y + d[e.key].y, H) }; draw(); showLoupe();
    });
    svg.appendChild(c); return c;
  });
  function draw() {
    poly.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
    handles.forEach((c, i) => { c.setAttribute('cx', String(pts[i].x)); c.setAttribute('cy', String(pts[i].y)); c.classList.toggle('active', i === active); });
  }
  /** Lupa ×3 de la zona bajo la esquina activa, en el lado opuesto al dedo. */
  function showLoupe() {
    if (active < 0) { loupe.hidden = true; return; }
    const p = pts[active];
    const ctx = loupe.getContext('2d'); if (!ctx) return;
    const b = svg.getBoundingClientRect();
    const k = W / Math.max(1, b.width); // píxeles de foto por píxel de pantalla
    const sw = (LOUPE / ZOOM) * k;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, loupe.width, loupe.height);
    ctx.drawImage(img, p.x - sw / 2, p.y - sw / 2, sw, sw, 0, 0, loupe.width, loupe.height);
    const toL = (q: P) => ({ x: ((q.x - (p.x - sw / 2)) / sw) * loupe.width, y: ((q.y - (p.y - sw / 2)) / sw) * loupe.height });
    ctx.strokeStyle = 'rgba(141,179,255,.95)'; ctx.lineWidth = 3;
    ctx.beginPath(); pts.forEach((q, j) => { const t = toL(q); if (j) ctx.lineTo(t.x, t.y); else ctx.moveTo(t.x, t.y); }); ctx.closePath(); ctx.stroke();
    ctx.strokeStyle = '#f4b400'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(loupe.width / 2, 0); ctx.lineTo(loupe.width / 2, loupe.height); ctx.moveTo(0, loupe.height / 2); ctx.lineTo(loupe.width, loupe.height / 2); ctx.stroke();
    const right = p.x / W < 0.5; // el dedo a la izquierda → lupa a la derecha
    loupe.style.right = right ? '8px' : ''; loupe.style.left = right ? '' : '8px';
    loupe.hidden = false;
  }
  draw();
  const toImg = (e: PointerEvent) => { const b = svg.getBoundingClientRect(); return { x: ((e.clientX - b.left) / b.width) * W, y: ((e.clientY - b.top) / b.height) * H }; };
  svg.addEventListener('pointerdown', (e) => {
    const p = toImg(e);
    // la esquina más cercana al dedo: no hace falta acertar el punto exacto
    drag = pts.reduce((m, q, i) => (Math.hypot(q.x - p.x, q.y - p.y) < Math.hypot(pts[m].x - p.x, pts[m].y - p.y) ? i : m), 0);
    active = drag; svg.setPointerCapture(e.pointerId); draw(); showLoupe();
  });
  svg.addEventListener('pointermove', (e) => { if (drag < 0) return; const p = toImg(e); pts[drag] = { x: clamp(p.x, W), y: clamp(p.y, H) }; draw(); showLoupe(); });
  const end = () => { drag = -1; loupe.hidden = true; };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  const prev = document.activeElement as HTMLElement | null;
  const close = () => { overlay.remove(); revokeUrl(url); document.removeEventListener('keydown', onKey); opts.onClose?.(); prev?.focus?.(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  const busy = (b: HTMLButtonElement, fn: () => Promise<void>) => async () => { b.disabled = true; try { await fn(); close(); } finally { b.disabled = false; } };
  const save: HTMLButtonElement = h('button', { class: 'btn primary grow', id: 'ce-save' }, icon('check'), 'Aplicar');
  save.addEventListener('click', busy(save, () => opts.onSave(pts.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })))));
  const auto: HTMLButtonElement | null = opts.onAuto ? h('button', { class: 'btn grow', id: 'ce-auto' }, 'Volver a automático') : null;
  if (auto) auto.addEventListener('click', busy(auto, opts.onAuto!));
  const full: HTMLButtonElement | null = opts.onFull ? h('button', { class: 'btn grow', id: 'ce-full' }, 'Foto completa') : null;
  if (full) full.addEventListener('click', busy(full, opts.onFull!));
  const overlay = h('div', { class: 'ce-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ajustar esquinas del documento', id: 'corner-editor' },
    h('div', { class: 'ce-head' }, h('button', { class: 'icon-btn', style: 'color:#fff', 'aria-label': 'Cerrar sin guardar', onClick: close }, icon('x')),
      h('b', { class: 'grow' }, opts.title ?? 'Ajustar esquinas')),
    h('div', { class: 'ce-stage' }, img, svg, loupe),
    h('div', { class: 'stack', style: 'padding:0 16px' },
      h('p', { class: 'small', style: 'color:#d6deea' }, 'Arrastre cada esquina amarilla hasta el borde de la tarjeta; la lupa muestra el punto exacto. La foto original no se modifica.')),
    h('div', { class: 'ce-foot' }, h('button', { class: 'btn grow', onClick: close }, 'Cancelar'), full ?? '', auto ?? '', save));
  document.body.appendChild(overlay);
  save.focus();
}
const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));
