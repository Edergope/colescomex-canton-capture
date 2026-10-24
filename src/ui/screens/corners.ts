// Ajuste manual de las 4 esquinas, con LUPA para colocarlas con precisión. Trabaja sobre la foto ORIGINAL
// (nunca la modifica). Se usa en la captura (antes de guardar) y en el documento de una captura guardada.
// «Aplicar» espera a que el recorte EXISTA (lo genera quien llama): si falla, el editor sigue abierto con las mismas
// esquinas y muestra el error para reintentar. La imagen se ajusta al espacio visible real (barras dinámicas de
// Chrome, navegación por gestos, texto grande): los botones del pie nunca quedan fuera de la pantalla.
import { h, blobUrl, revokeUrl } from '../dom';
import { icon } from '../icons';

type P = { x: number; y: number };
const NAMES = ['superior izquierda', 'superior derecha', 'inferior derecha', 'inferior izquierda'];
const ZOOM = 3, LOUPE = 132;
/** radio visible de cada esquina en píxeles de pantalla (el dedo puede pulsar en cualquier punto: se elige la más cercana) */
const HANDLE_PX = 15;

export interface CornerSource { blob: Blob; quad?: P[] }
export interface CornerEditorOptions {
  /** genera y comprueba el recorte; si lanza un error, el editor sigue abierto y lo muestra */
  onSave: (q: P[]) => Promise<void>;
  /** volver a la detección automática (solo si ya había un ajuste manual) */
  onAuto?: () => Promise<void>;
  /** conservar la foto completa (sin recorte) */
  onFull?: () => Promise<void>;
  onClose?: () => void;
  title?: string;
  /** texto del botón «Aplicar» mientras trabaja (p. ej. «Generando recorte…») */
  workingLabel?: string;
}

export async function openCornerEditor(src: CornerSource, opts: CornerEditorOptions) {
  const url = blobUrl(src.blob);
  const img = h('img', { src: url, alt: 'Foto original de la tarjeta', class: 'ce-img', draggable: 'false' });
  await img.decode().catch(() => undefined);
  const W = img.naturalWidth || 1, H = img.naturalHeight || 1;
  const pts: P[] = (src.quad?.length === 4 ? src.quad : [{ x: W * 0.1, y: H * 0.1 }, { x: W * 0.9, y: H * 0.1 }, { x: W * 0.9, y: H * 0.9 }, { x: W * 0.1, y: H * 0.9 }]).map((p) => ({ x: clamp(p.x, W), y: clamp(p.y, H) }));
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'ce-svg');
  svg.setAttribute('preserveAspectRatio', 'none'); // el marco tiene exactamente la proporción de la foto
  const poly = document.createElementNS(NS, 'polygon'); poly.setAttribute('class', 'ce-poly'); svg.appendChild(poly);
  const loupe = h('canvas', { class: 'ce-loupe', width: LOUPE * 2, height: LOUPE * 2, 'aria-hidden': 'true' });
  loupe.hidden = true;
  // marco con el tamaño EXACTO de la foto mostrada: la foto y las esquinas comparten coordenadas sin bandas
  const frame = h('div', { class: 'ce-frame' }, img, svg);
  const stage = h('div', { class: 'ce-stage' }, frame, loupe);
  let active = -1;
  let drag = -1;
  const handles = pts.map((_, i) => {
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', 'ce-handle'); c.setAttribute('data-i', String(i));
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
  let scale = 1; // píxeles de foto por píxel de pantalla
  function draw() {
    poly.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
    // radio en píxeles de foto que se ve siempre de HANDLE_PX en pantalla (nunca diminuto en fotos grandes)
    const r = HANDLE_PX * scale;
    handles.forEach((c, i) => {
      c.setAttribute('cx', String(pts[i].x)); c.setAttribute('cy', String(pts[i].y));
      c.setAttribute('r', String(r)); c.classList.toggle('active', i === active);
    });
  }
  /** Ajusta el marco al espacio disponible (contain) cada vez que cambia el tamaño visible. */
  function fit() {
    const box = stage.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const k = Math.min(box.width / W, box.height / H);
    frame.style.width = `${Math.floor(W * k)}px`; frame.style.height = `${Math.floor(H * k)}px`;
    scale = 1 / k; draw();
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

  const ro = new ResizeObserver(fit);
  const onVV = () => fit();
  const prev = document.activeElement as HTMLElement | null;
  const close = () => { ro.disconnect(); window.visualViewport?.removeEventListener('resize', onVV); overlay.remove(); revokeUrl(url); document.removeEventListener('keydown', onKey); opts.onClose?.(); prev?.focus?.(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !working) close(); };
  document.addEventListener('keydown', onKey);
  const errorEl = h('p', { class: 'ce-error', id: 'ce-error', role: 'alert' }); errorEl.hidden = true;
  let working = false;
  const buttons: HTMLButtonElement[] = [];
  const run = (b: HTMLButtonElement, fn: () => Promise<void>, label?: string) => async () => {
    if (working) return;
    working = true; errorEl.hidden = true;
    const text = b.textContent; buttons.forEach((x) => { x.disabled = true; });
    if (label) b.replaceChildren(icon('loader'), label);
    b.setAttribute('aria-busy', 'true');
    try { await fn(); close(); }
    catch (e) { errorEl.textContent = (e as Error).message || 'No se pudo completar la acción. Reintente.'; errorEl.hidden = false; }
    finally {
      working = false; buttons.forEach((x) => { x.disabled = false; }); b.removeAttribute('aria-busy');
      if (label && b.isConnected) b.replaceChildren(icon('check'), text ?? '');
    }
  };
  const save: HTMLButtonElement = h('button', { class: 'btn primary lg', id: 'ce-save' }, icon('check'), 'Aplicar');
  save.addEventListener('click', run(save, () => opts.onSave(pts.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }))), opts.workingLabel));
  const cancel: HTMLButtonElement = h('button', { class: 'btn', id: 'ce-cancel', onClick: () => { if (!working) close(); } }, 'Cancelar');
  const auto: HTMLButtonElement | null = opts.onAuto ? h('button', { class: 'btn', id: 'ce-auto' }, 'Volver a automático') : null;
  if (auto) auto.addEventListener('click', run(auto, opts.onAuto!));
  const full: HTMLButtonElement | null = opts.onFull ? h('button', { class: 'btn', id: 'ce-full' }, 'Foto completa') : null;
  if (full) full.addEventListener('click', run(full, opts.onFull!));
  buttons.push(...[save, cancel, auto, full].filter((x): x is HTMLButtonElement => !!x));
  const overlay = h('div', { class: 'ce-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ajustar esquinas del documento', id: 'corner-editor' },
    h('div', { class: 'ce-head' },
      h('button', { class: 'icon-btn', style: 'color:#fff', 'aria-label': 'Cerrar sin guardar', onClick: () => { if (!working) close(); } }, icon('x')),
      h('div', { class: 'grow' }, h('b', null, opts.title ?? 'Ajustar esquinas'),
        h('p', { class: 'ce-help' }, 'Arrastre cada esquina hasta el borde de la tarjeta; la lupa muestra el punto exacto. La foto original no se modifica.'))),
    stage,
    errorEl,
    h('div', { class: 'ce-foot' }, h('div', { class: 'ce-secondary' }, cancel, full ?? '', auto ?? ''), save));
  document.body.appendChild(overlay);
  ro.observe(stage);
  window.visualViewport?.addEventListener('resize', onVV);
  fit();
  save.focus();
}
const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));
