// Utilidades de presentación sin framework. Los textos siempre se insertan como texto (nunca como HTML).
type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'style' && k !== 'list' && !k.startsWith('aria') && k !== 'role') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function mount(root: HTMLElement, ...nodes: Child[]) { root.replaceChildren(); append(root, nodes); }

// ── Toast accesible (región aria-live persistente) ──
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toastRegion(): HTMLElement {
  let r = document.getElementById('toast-region');
  if (!r) { r = h('div', { id: 'toast-region', class: 'toast-region', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }); document.body.appendChild(r); }
  return r;
}
export function toast(msg: string | Node, ms = 3200) {
  const r = toastRegion();
  mount(r, h('div', { class: 'toast' }, msg));
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => r.replaceChildren(), ms);
}

// ── Hoja inferior / diálogo modal accesible ──
export function sheet(title: string, build: (close: () => void) => Child, opts: { label?: string } = {}): () => void {
  const prev = document.activeElement as HTMLElement | null;
  const titleId = `sheet-${Math.random().toString(36).slice(2, 8)}`;
  const close = () => { scrim.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('div', { class: 'grabber', 'aria-hidden': 'true' }), h('h2', { id: titleId }, title));
  append(panel, [build(close)]);
  const scrim = h('div', { class: 'scrim', onClick: (e: Event) => { if (e.target === scrim) close(); } }, panel);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') { // foco atrapado dentro del diálogo
      const f = [...panel.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.hasAttribute('disabled'));
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(scrim);
  (panel.querySelector<HTMLElement>('[autofocus], button.primary, button') ?? panel).focus();
  void opts;
  return close;
}

/** Confirmación accesible (sustituye a window.confirm). */
export function confirmSheet(title: string, body: string, ok: string, cancel = 'Cancelar', tone: 'primary' | 'danger' = 'primary'): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean, close: () => void) => { if (done) return; done = true; close(); resolve(v); };
    const closeFn = sheet(title, (close) => [
      h('p', { class: 'muted' }, body),
      h('div', { class: 'row' },
        h('button', { class: 'btn grow', onClick: () => finish(false, close) }, cancel),
        h('button', { class: `btn grow ${tone === 'danger' ? 'danger' : 'primary'}`, 'data-confirm': '1', onClick: () => finish(true, close) }, ok)),
    ]);
    void closeFn;
  });
}

/** Abre la cámara del sistema o la galería y devuelve los archivos elegidos. */
export function pickFiles(opts: { camera?: boolean; accept?: string; multiple?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: opts.accept ?? 'image/*', class: 'hidden' }) as HTMLInputElement;
    if (opts.camera) input.setAttribute('capture', 'environment');
    if (opts.multiple) input.multiple = true;
    input.addEventListener('change', () => { resolve([...(input.files ?? [])]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

// ── URLs de objeto: se liberan al cambiar de pantalla o al salir del viewport ──
const urls = new Set<string>();
export function blobUrl(b: Blob): string { const u = URL.createObjectURL(b); urls.add(u); return u; }
export function revokeUrl(u: string) { if (urls.delete(u)) URL.revokeObjectURL(u); }
export function releaseUrls() { for (const u of urls) URL.revokeObjectURL(u); urls.clear(); }
export function liveUrlCount(): number { return urls.size; }

/**
 * Miniaturas diferidas: la imagen solo se carga (y su URL existe) mientras el elemento está cerca del viewport.
 * Evita cargar cientos de fotos a la vez en listas largas.
 */
export class LazyThumbs {
  private io?: IntersectionObserver;
  private loaders = new Map<Element, { load: () => Promise<Blob | undefined>; url?: string }>();
  constructor() {
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const st = this.loaders.get(e.target); if (!st) continue;
          const box = e.target as HTMLElement;
          if (e.isIntersecting && !st.url) {
            void st.load().then((b) => {
              if (!b || st.url || !this.loaders.has(box)) return;
              st.url = blobUrl(b);
              mount(box, h('img', { src: st.url, alt: '', decoding: 'async' }));
            });
          } else if (!e.isIntersecting && st.url) {
            revokeUrl(st.url); st.url = undefined; box.replaceChildren(h('span', { class: 'xs' }, '···'));
          }
        }
      }, { rootMargin: '400px 0px' });
    }
  }
  observe(box: HTMLElement, load: () => Promise<Blob | undefined>) {
    this.loaders.set(box, { load });
    if (this.io) this.io.observe(box);
    else void load().then((b) => { if (b) mount(box, h('img', { src: blobUrl(b), alt: '' })); });
  }
  disconnect() { this.io?.disconnect(); for (const st of this.loaders.values()) if (st.url) revokeUrl(st.url); this.loaders.clear(); }
}
