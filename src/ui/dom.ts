type Child = Node | string | number | null | undefined | false | Child[];
type Props = Record<string, unknown> & { class?: string; style?: string };

/** Creador mínimo de elementos DOM (sin framework). Los textos se insertan como texto, nunca como HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k in el && k !== 'style' && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function mount(root: HTMLElement, ...nodes: Child[]) { root.replaceChildren(); append(root, nodes); }

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, ms = 2600) {
  document.querySelector('.toast')?.remove();
  const t = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }, msg);
  document.body.appendChild(t);
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

/** Abre la cámara (o galería) y devuelve los archivos elegidos. */
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

/** URLs de objeto con liberación automática al cambiar de vista. */
const urls = new Set<string>();
export function blobUrl(b: Blob): string { const u = URL.createObjectURL(b); urls.add(u); return u; }
export function releaseUrls() { for (const u of urls) URL.revokeObjectURL(u); urls.clear(); }
