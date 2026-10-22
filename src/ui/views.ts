import { h, mount, toast, pickFiles, blobUrl, releaseUrls } from './dom';
import type { CaptureApp } from '../app/service';
import {
  EDITABLE_FIELDS, EVIDENCE_LABELS, SYNC_LABELS, type Capture, type CommercialField, type EvidenceKind, type FieldMeta,
  type OcrStatus, type SyncStatus, type UserProfile,
} from '../domain/schema';
import type { QuickFields } from '../storage/repo';
import { AuthRequiredError, NotAuthorizedError } from '../adapters/contracts';

const FIELD_LABELS: Partial<Record<CommercialField, string>> = {
  company_name: 'Empresa (inglés)', company_name_cn: 'Empresa (chino)', contact_name: 'Contacto', job_title: 'Cargo',
  phone_1: 'Teléfono 1', phone_2: 'Teléfono 2', wechat: 'WeChat', whatsapp: 'WhatsApp', email: 'Email', website: 'Web',
  address: 'Dirección', city: 'Ciudad', province: 'Provincia', country: 'País', hall: 'Hall', booth: 'Stand',
  supplier_type: 'Tipo de proveedor', main_products: 'Productos principales', product_interest: 'Producto de interés',
  notes: 'Notas', follow_up: 'Seguimiento',
};
const OCR_LABEL: Record<OcrStatus, [string, string]> = {
  CAPTURADO: ['OCR en cola', 'info'], PROCESANDO: ['Leyendo tarjeta…', 'info'], EXTRAIDO: ['Datos extraídos', 'ok'],
  REQUIERE_REVISION: ['Requiere revisión', 'warn'], ERROR: ['Error OCR', 'err'],
};
const SYNC_CLASS: Record<SyncStatus, string> = { LOCAL: '', PENDIENTE: 'info', SINCRONIZANDO: 'info', CONFIRMADO: 'ok', ERROR: 'err' };
const ocrChip = (s: OcrStatus) => h('span', { class: `chip ${OCR_LABEL[s][1]}` }, OCR_LABEL[s][0]);
const syncChip = (s: SyncStatus) => h('span', { class: `chip ${SYNC_CLASS[s]}`, 'data-sync': s }, s === 'CONFIRMADO' ? '☁ ' : s === 'LOCAL' ? '📱 ' : '', SYNC_LABELS[s]);

type Route = { name: 'login' } | { name: 'home' } | { name: 'capture' } | { name: 'list'; filter?: string } | { name: 'detail'; uuid: string };

interface DraftEvidence { kind: EvidenceKind; blob: Blob; name?: string }
interface Draft { step: 'front' | 'askBack' | 'back' | 'extras'; evidences: DraftEvidence[]; quick: QuickFields }

export class UI {
  private route: Route = { name: 'home' };
  private user: UserProfile | null = null;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private draft: Draft = emptyDraft();
  private authProblem = false;
  private saving = false;

  constructor(private root: HTMLElement, private app: CaptureApp, private info: { configProblems: string[]; engineName: string; storage?: { persisted: boolean } }) {
    app.repo.onChange(() => this.scheduleRefresh());
    window.addEventListener('online', () => this.scheduleRefresh());
    window.addEventListener('offline', () => this.scheduleRefresh());
    window.addEventListener('popstate', () => { this.route = (history.state as Route) ?? { name: 'home' }; void this.render(); });
  }

  async start() {
    this.user = await this.app.auth.currentUser();
    if (this.user) this.draft = (await this.app.repo.getMeta<Draft>(`draft:${this.user.id}`)) ?? emptyDraft();
    if (this.draft.step === 'front' && this.draft.evidences.some((e) => e.kind === 'card_front')) this.draft.step = 'askBack';
    this.route = this.user ? (this.draft.evidences.length ? { name: 'capture' } : { name: 'home' }) : { name: 'login' };
    history.replaceState(this.route, '');
    await this.render();
    if (this.user && this.draft.evidences.length) toast('Se recuperó una captura sin guardar');
  }

  private go(route: Route) { this.route = route; history.pushState(route, ''); releaseUrls(); void this.render(); window.scrollTo(0, 0); }
  private back() { history.back(); }

  private scheduleRefresh() {
    if (this.route.name === 'capture') return; // no interrumpir el asistente de captura
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      if (this.route.name === 'detail' && this.root.querySelector('[data-dirty="1"]')) { this.renderBadgeOnly(); return; }
      void this.render(true);
    }, 400);
  }

  private async render(keepScroll = false): Promise<void> {
    const y = window.scrollY;
    const r = this.route;
    if (r.name !== 'login' && !this.user) { this.route = { name: 'login' }; return this.render(); }
    if (r.name === 'login') mount(this.root, this.loginView());
    else if (r.name === 'home') mount(this.root, await this.homeView());
    else if (r.name === 'capture') mount(this.root, this.captureView());
    else if (r.name === 'list') mount(this.root, await this.listView(r.filter ?? 'all'));
    else if (r.name === 'detail') mount(this.root, await this.detailView(r.uuid));
    if (keepScroll) window.scrollTo(0, y);
  }

  private renderBadgeOnly() { /* en edición: se evita re-renderizar el formulario */ }

  private topbar(title: string, withBack = false) {
    return h('header', { class: 'topbar' },
      withBack && h('button', { class: 'back', 'aria-label': 'Volver', onClick: () => this.back() }, '‹'),
      h('span', { class: `net ${navigator.onLine ? '' : 'off'}`, title: navigator.onLine ? 'Con conexión' : 'Sin conexión' }),
      h('h1', null, title),
      this.user && h('button', { class: 'who', onClick: () => this.signOut() }, `👤 ${this.user.name}`));
  }

  // ───────────────────────── Login ─────────────────────────
  private loginView() {
    const users = this.app.auth.allowedUsers();
    return [
      h('main', null,
        h('div', { class: 'card' },
          h('div', { class: 'logo' }, 'COLESCOMEX'),
          h('div', { class: 'q' }, 'Canton Fair Capture · Fase 2'),
          h('p', { class: 'muted' }, this.app.auth.mode === 'google'
            ? 'Inicia sesión con tu cuenta de Google autorizada. Solo se requiere conexión esta primera vez.'
            : 'Modo desarrollo (sin Google). Elige tu perfil: cada persona usa el suyo.')),
        this.info.configProblems.length > 0 && h('div', { class: 'banner err' }, 'Configuración incompleta: ', this.info.configProblems.join(' · ')),
        h('div', { class: 'users' }, users.map((u) => h('button', { class: 'btn huge primary', onClick: () => this.signIn(u.id) }, `Soy ${u.name}`)))),
    ];
  }

  private async signIn(id: string) {
    try {
      this.user = await this.app.auth.signIn(id);
      this.draft = (await this.app.repo.getMeta<Draft>(`draft:${this.user.id}`)) ?? emptyDraft();
      this.authProblem = false;
      this.go({ name: 'home' });
      this.app.kickSync();
    } catch (e) {
      toast(e instanceof NotAuthorizedError ? (e as Error).message : `No se pudo iniciar sesión: ${(e as Error).message}`, 5000);
    }
  }

  private async signOut() {
    const c = await this.app.counts();
    const pend = c.total - c.confirmed;
    if (!confirm(pend ? `Hay ${pend} captura(s) sin confirmar en Google. Seguirán guardadas en este teléfono. ¿Cerrar sesión?` : '¿Cerrar sesión?')) return;
    await this.app.auth.signOut();
    this.user = null;
    this.go({ name: 'login' });
  }

  // ───────────────────────── Inicio ─────────────────────────
  private async homeView() {
    const c = await this.app.counts();
    const rep = this.app.sync.lastReport;
    if (rep?.authRequired) this.authProblem = true;
    return [
      this.topbar('Canton Capture · Fase 2'),
      h('main', null,
        h('button', { class: 'btn huge primary', id: 'btn-register', onClick: () => this.go({ name: 'capture' }) }, '📷  Registrar proveedor'),
        this.draft.evidences.length > 0 && h('div', { class: 'banner warn' }, `Hay una captura sin terminar (${this.draft.evidences.length} foto(s)). Pulsa «Registrar proveedor» para continuarla.`),
        !navigator.onLine && h('div', { class: 'banner info' }, 'Sin conexión: puedes seguir capturando. Todo queda guardado en el teléfono y se sincroniza al volver la conexión.'),
        this.info.storage && !this.info.storage.persisted && h('div', { class: 'banner warn' }, 'El navegador no garantizó almacenamiento persistente. Instala la app (Añadir a pantalla de inicio) y sincroniza con frecuencia.'),
        this.authProblem && h('div', { class: 'banner err' }, 'La sesión de Google expiró. ',
          h('button', { class: 'btn small', onClick: () => this.reconnect() }, 'Reconectar Google')),
        h('div', { class: 'card' },
          h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', null, `Capturas: ${c.total}`), h('span', { class: 'muted small' }, `OCR pendiente: ${c.ocrPending}`)),
          h('div', { class: 'stats', style: 'margin-top:10px' },
            stat(c.local, SYNC_LABELS.LOCAL, ''), stat(c.pending, SYNC_LABELS.PENDIENTE, 'info'),
            stat(c.syncing, SYNC_LABELS.SINCRONIZANDO, 'info'), stat(c.confirmed, SYNC_LABELS.CONFIRMADO, 'ok'),
            stat(c.syncError, SYNC_LABELS.ERROR, c.syncError ? 'err' : ''), stat(c.review, 'Requieren revisión', c.review ? 'warn' : '')),
          h('div', { class: 'row', style: 'margin-top:10px' },
            h('button', { class: 'btn', id: 'btn-sync', onClick: () => this.syncNow() }, '⟳ Sincronizar ahora'),
            h('button', { class: 'btn', onClick: () => this.go({ name: 'list' }) }, '☰ Ver capturas')),
          rep && h('p', { class: 'muted small' }, syncSummary(rep))),
        h('p', { class: 'muted small' }, `OCR: ${this.info.engineName} · Sincronización: ${this.app.auth.mode === 'google' ? 'Google' : 'simulada (mock)'}`)),
    ];
  }

  private async reconnect() {
    try { await this.app.auth.signIn(this.user!.id); this.authProblem = false; await this.syncNow(); }
    catch (e) { toast((e as Error).message, 5000); }
  }

  private async syncNow() {
    if (!navigator.onLine) { toast('Sin conexión: se sincronizará automáticamente al volver'); return; }
    toast('Sincronizando…');
    try {
      const r = await this.app.syncNow(true);
      this.authProblem = r.authRequired;
      toast(syncSummary(r), 4000);
    } catch (e) { toast((e as Error).message); if (e instanceof AuthRequiredError) this.authProblem = true; }
    void this.render(true);
  }

  // ───────────────────────── Captura ─────────────────────────
  private async persistDraft() {
    if (this.user) await this.app.repo.setMeta(`draft:${this.user.id}`, this.draft.evidences.length ? this.draft : null);
  }

  private async takePhoto(kind: EvidenceKind, opts: { camera?: boolean; accept?: string } = { camera: true }) {
    const files = await pickFiles({ camera: opts.camera, accept: opts.accept, multiple: !opts.camera && kind !== 'card_front' && kind !== 'card_back' });
    if (!files.length) return false;
    for (const f of files) {
      if (kind === 'card_front' || kind === 'card_back') this.draft.evidences = this.draft.evidences.filter((e) => e.kind !== kind);
      this.draft.evidences.push({ kind, blob: f, name: f.name });
    }
    // El paso avanza ANTES de persistir: si Android descarta la página, se reanuda en el paso correcto.
    if (kind === 'card_front' && this.draft.step === 'front') this.draft.step = 'askBack';
    if (kind === 'card_back') this.draft.step = 'extras';
    await this.persistDraft(); // la foto queda a salvo aunque Android cierre la página
    return true;
  }

  private captureView() {
    const d = this.draft;
    const front = d.evidences.find((e) => e.kind === 'card_front');
    const back = d.evidences.find((e) => e.kind === 'card_back');
    const rerender = () => mount(this.root, this.captureView());
    const step = d.step;
    const body: Node[] = [];

    if (step === 'front' || !front) {
      body.push(h('div', { class: 'card' },
        h('div', { class: 'step' }, 'Paso 1 · Tarjeta'),
        h('div', { class: 'q' }, 'Fotografía FRONTAL de la tarjeta'),
        h('p', { class: 'muted' }, 'Encuadra la tarjeta completa, sin reflejos. La foto original se conserva sin cambios.'),
        h('button', { class: 'btn huge primary', id: 'btn-front', onClick: async () => { if (await this.takePhoto('card_front')) { d.step = 'askBack'; rerender(); } } }, '📷  Tomar foto frontal'),
        h('button', { class: 'btn block', style: 'margin-top:8px', onClick: async () => { if (await this.takePhoto('card_front', { camera: false })) { d.step = 'askBack'; rerender(); } } }, 'Elegir de la galería')));
    } else if (step === 'askBack') {
      body.push(h('div', { class: 'card' },
        h('img', { class: 'preview', src: blobUrl(front.blob), alt: 'Frontal' }),
        h('div', { class: 'q', style: 'margin-top:12px' }, '¿Tiene información al respaldo?'),
        h('div', { class: 'grid2' },
          h('button', { class: 'btn huge primary', id: 'btn-back-yes', onClick: async () => { if (await this.takePhoto('card_back')) { d.step = 'extras'; await this.persistDraft(); rerender(); } } }, 'Sí · Foto'),
          h('button', { class: 'btn huge', id: 'btn-back-no', onClick: async () => { d.step = 'extras'; await this.persistDraft(); rerender(); } }, 'No')),
        h('button', { class: 'btn block small', style: 'margin-top:8px', onClick: async () => { if (await this.takePhoto('card_front')) rerender(); } }, '↺ Repetir foto frontal')));
    } else {
      const extras = d.evidences.filter((e) => e.kind !== 'card_front' && e.kind !== 'card_back');
      body.push(h('div', { class: 'card' },
        h('div', { class: 'step' }, 'Evidencias'),
        h('div', { class: 'thumbs' }, d.evidences.map((e) => thumb(e, () => { d.evidences = d.evidences.filter((x) => x !== e); if (e.kind === 'card_front') d.step = 'front'; void this.persistDraft(); rerender(); }))),
        !back && h('button', { class: 'btn block small', style: 'margin-top:8px', onClick: async () => { if (await this.takePhoto('card_back')) rerender(); } }, '+ Añadir reverso de la tarjeta'),
        h('div', { class: 'q', style: 'margin-top:12px' }, 'Otras evidencias (opcional)'),
        h('div', { class: 'grid2' },
          h('button', { class: 'btn', id: 'btn-stand', onClick: async () => { if (await this.takePhoto('stand')) rerender(); } }, '🏬 Stand'),
          h('button', { class: 'btn', id: 'btn-product', onClick: async () => { if (await this.takePhoto('product')) rerender(); } }, '📦 Producto'),
          h('button', { class: 'btn', onClick: async () => { if (await this.takePhoto('catalog', { camera: false, accept: 'application/pdf,image/*' })) rerender(); } }, '📄 Catálogo / PDF'),
          h('button', { class: 'btn', onClick: async () => { if (await this.takePhoto('other', { camera: false, accept: 'image/*,application/pdf' })) rerender(); } }, '➕ Otra')),
        extras.length > 0 && h('p', { class: 'muted small' }, `${extras.length} evidencia(s) adicional(es)`)),
        h('details', { class: 'card' },
          h('summary', null, 'Datos rápidos (opcional)'),
          quickInput('Hall', 'hall', d, '11.2'), quickInput('Stand', 'booth', d, 'C15'),
          quickInput('Producto de interés', 'product_interest', d, ''), quickInput('Nota', 'notes', d, '')),
        h('button', { class: 'btn huge primary', id: 'btn-save-next', disabled: this.saving, onClick: () => this.save(true) }, '💾  Guardar y siguiente'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', id: 'btn-save-done', onClick: () => this.save(false) }, 'Guardar y terminar'),
          h('button', { class: 'btn danger', onClick: async () => { if (confirm('¿Descartar esta captura sin guardar?')) { this.draft = emptyDraft(); await this.persistDraft(); this.go({ name: 'home' }); } } }, 'Descartar')));
    }
    return [this.topbar('Nueva captura', true), h('main', null, ...body)];
  }

  private async save(next: boolean) {
    if (this.saving) return;
    this.saving = true;
    try {
      const c = await this.app.saveCapture(this.draft.evidences.map((e) => ({ kind: e.kind, blob: e.blob, name: e.name })), this.draft.quick);
      this.draft = emptyDraft();
      await this.persistDraft();
      toast(`✓ Guardado en el teléfono · ${c.external_ref}`);
      if (next) { releaseUrls(); mount(this.root, this.captureView()); window.scrollTo(0, 0); } else this.go({ name: 'home' });
    } catch (e) {
      toast(`No se pudo guardar: ${(e as Error).message}`, 6000);
    } finally { this.saving = false; }
  }

  // ───────────────────────── Lista ─────────────────────────
  private async listView(filter: string) {
    const all = await this.app.repo.list();
    const filters: [string, string, (c: Capture) => boolean][] = [
      ['all', 'Todas', () => true],
      ['review', 'Revisar', (c) => c.ocr_status === 'REQUIERE_REVISION' && c.review_status !== 'REVISADO'],
      ['pending', 'Sin confirmar', (c) => c.sync_status !== 'CONFIRMADO'],
      ['errors', 'Errores', (c) => c.sync_status === 'ERROR' || c.ocr_status === 'ERROR'],
      ['mine', 'Mías', (c) => c.user_id === this.user?.id],
    ];
    const f = filters.find((x) => x[0] === filter) ?? filters[0];
    const items = all.filter(f[2]);
    const listEl = h('div', { class: 'list', id: 'capture-list' });
    const fill = async (q: string) => {
      const ql = q.trim().toLowerCase();
      const shown = ql ? items.filter((c) => [c.external_ref, c.fields.company_name, c.fields.company_name_cn, c.fields.contact_name, c.fields.booth].join(' ').toLowerCase().includes(ql)) : items;
      const nodes = await Promise.all(shown.map(async (c) => {
        const front = (await this.app.repo.evidences(c.uuid)).find((e) => e.kind === 'card_front');
        return h('button', { class: 'item', 'data-ref': c.external_ref, onClick: () => this.go({ name: 'detail', uuid: c.uuid }) },
          front ? h('img', { class: 'ph', src: blobUrl(front.blob), alt: '' }) : h('div', { class: 'ph' }),
          h('div', { style: 'min-width:0' },
            h('div', { class: 't' }, c.fields.company_name || c.fields.company_name_cn || (c.ocr_status === 'ERROR' ? 'Sin datos (OCR falló)' : 'Leyendo tarjeta…')),
            h('div', { class: 'muted small' }, `${c.external_ref} · ${c.fields.captured_by}${c.fields.booth ? ` · ${c.fields.hall} ${c.fields.booth}` : ''}`),
            h('div', { class: 's' }, ocrChip(c.ocr_status), syncChip(c.sync_status), c.review_status === 'REVISADO' && h('span', { class: 'chip ok' }, '✔ Revisado'))));
      }));
      mount(listEl, nodes.length ? nodes : h('p', { class: 'muted' }, 'No hay capturas en esta vista.'));
    };
    await fill('');
    return [
      this.topbar('Capturas', true),
      h('main', null,
        h('div', { class: 'tabs' }, filters.map(([id, label, fn]) => h('button', { class: id === f[0] ? 'on' : '', onClick: () => { this.route = { name: 'list', filter: id }; history.replaceState(this.route, ''); void this.render(); } }, `${label} (${all.filter(fn).length})`))),
        h('input', { class: 'text', type: 'search', placeholder: 'Buscar empresa, contacto, ref, stand…', onInput: (e: Event) => void fill((e.target as HTMLInputElement).value) }),
        listEl),
    ];
  }

  // ───────────────────────── Detalle / corrección ─────────────────────────
  private async detailView(uuid: string) {
    const c = await this.app.repo.get(uuid);
    if (!c) return [this.topbar('Captura', true), h('main', null, h('p', null, 'No encontrada'))];
    const evs = await this.app.repo.evidences(uuid);
    const ocr = await this.app.repo.ocrResults(uuid);
    const form = h('form', { class: 'card', id: 'edit-form', onSubmit: (e: Event) => e.preventDefault() });
    const inputs = new Map<CommercialField, HTMLInputElement | HTMLTextAreaElement>();
    const markDirty = () => { form.dataset.dirty = '1'; saveBtn.disabled = false; };
    for (const f of EDITABLE_FIELDS) {
      const m = c.field_meta[f];
      const long = ['address', 'main_products', 'notes', 'follow_up'].includes(f);
      const input = long ? h('textarea', { name: f, onInput: markDirty }, c.fields[f]) : h('input', { name: f, value: c.fields[f], onInput: markDirty, inputMode: f.startsWith('phone') || f === 'whatsapp' ? 'tel' : f === 'email' ? 'email' : undefined });
      inputs.set(f, input);
      form.appendChild(h('div', { class: `field ${m?.status ?? ''}` },
        h('label', null, FIELD_LABELS[f] ?? f, fieldBadge(m)),
        input,
        m?.reason && m.status !== 'ok' && h('div', { class: 'reason' }, m.reason),
        m?.candidates?.length ? h('div', { class: 'cands' }, h('span', { class: 'muted small' }, 'Otros valores leídos:'),
          m.candidates.map((v) => h('button', { type: 'button', onClick: () => { input.value = v; markDirty(); } }, v))) : null));
    }
    const saveBtn = h('button', { class: 'btn primary block', id: 'btn-save-edit', disabled: true, onClick: async () => {
      const edits: Partial<Record<CommercialField, string>> = {};
      for (const [f, el] of inputs) if (el.value.trim() !== (c.fields[f] ?? '')) edits[f] = el.value;
      await this.app.editFields(uuid, edits);
      toast('Corrección guardada (no la sobrescribirá el OCR)');
      void this.render(true);
    } }, 'Guardar correcciones');
    form.appendChild(saveBtn);

    return [
      this.topbar(c.external_ref, true),
      h('main', null,
        h('div', { class: 'card' },
          h('div', { class: 'row' }, ocrChip(c.ocr_status), syncChip(c.sync_status), c.review_status === 'REVISADO' ? h('span', { class: 'chip ok' }, '✔ Revisado') : h('span', { class: 'chip' }, 'Sin revisar')),
          h('p', { class: 'muted small' }, `Capturado por ${c.fields.captured_by} · ${new Date(c.created_at).toLocaleString()} · rev. ${c.revision}`),
          c.ocr_error && h('div', { class: 'banner err' }, `OCR: ${c.ocr_error}`),
          c.sync_error && h('div', { class: 'banner err' }, `Sincronización: ${c.sync_error}`),
          c.ocr_extras?.fax.length ? h('p', { class: 'muted small' }, `Fax: ${c.ocr_extras.fax.join(', ')}`) : null,
          h('p', { class: 'muted small' }, 'Estado de captura ≠ aprobación: este registro es información inicial, no un proveedor aprobado.'),
          h('div', { class: 'thumbs' }, evs.map((e) => thumb(e))),
          h('div', { class: 'row', style: 'margin-top:10px' },
            h('button', { class: 'btn small', id: 'btn-reprocess', disabled: c.ocr_status === 'PROCESANDO', onClick: async () => { await this.app.reprocessOcr(uuid); toast('OCR en cola'); } }, '↻ Reprocesar OCR'),
            h('button', { class: 'btn small', id: 'btn-confirm', onClick: async () => { if (form.dataset.dirty === '1') { toast('Guarda primero las correcciones'); return; } await this.app.confirmReview(uuid); toast('Revisión confirmada'); void this.render(true); } }, '✔ Confirmar revisión'),
            h('button', { class: 'btn small', onClick: () => this.syncNow() }, '⟳ Sincronizar'))),
        form,
        h('details', { class: 'card' }, h('summary', null, 'Texto OCR original'),
          ocr.length ? ocr.map((o) => [h('div', { class: 'muted small' }, `${o.side === 'front' ? 'Frontal' : 'Reverso'} · ${o.engine} · ${o.ms} ms`), h('pre', { class: 'ocr' }, o.text || '(sin texto)')]) : h('p', { class: 'muted' }, 'Aún no procesado.')),
        h('details', { class: 'card' }, h('summary', null, 'Trazabilidad'),
          h('pre', { class: 'ocr' }, (await this.app.repo.audit(uuid)).map((a) => `${a.at}  ${a.actor}  ${a.type}`).join('\n')),
          h('p', { class: 'muted small' }, `UUID ${c.uuid}`))),
    ];
  }
}

function emptyDraft(): Draft { return { step: 'front', evidences: [], quick: {} }; }
function stat(n: number, label: string, cls: string) { return h('div', { class: `stat ${cls}` }, h('b', null, n), h('span', null, label)); }
function syncSummary(r: { attempted: number; confirmed: number; failed: number; offline: boolean; authRequired: boolean }) {
  if (r.offline) return 'Sin conexión: nada enviado. Todo sigue guardado en el teléfono.';
  if (r.authRequired) return 'Se necesita reconectar Google para sincronizar.';
  return `Último envío: ${r.confirmed} confirmada(s), ${r.failed} con error.`;
}
function thumb(e: { kind: EvidenceKind; blob: Blob }, onRemove?: () => void) {
  const isPdf = e.blob.type === 'application/pdf';
  const open = () => { if (isPdf) { window.open(blobUrl(e.blob), '_blank'); return; } const v = h('div', { class: 'viewer', onClick: () => v.remove() }, h('img', { src: blobUrl(e.blob), alt: '' })); document.body.appendChild(v); };
  return h('div', { class: 'thumb', onClick: open },
    isPdf ? h('div', { class: 'pdf' }, 'PDF') : h('img', { src: blobUrl(e.blob), alt: EVIDENCE_LABELS[e.kind] }),
    h('span', { class: 'lbl' }, EVIDENCE_LABELS[e.kind]),
    onRemove && h('button', { class: 'x', 'aria-label': 'Quitar', onClick: (ev: Event) => { ev.stopPropagation(); onRemove(); } }, '×'));
}
function quickInput(label: string, key: keyof QuickFields | 'hall' | 'booth', d: Draft, ph: string) {
  return h('div', { class: 'field' }, h('label', null, label),
    h('input', { value: (d.quick as Record<string, string>)[key] ?? '', placeholder: ph, onInput: (e: Event) => { (d.quick as Record<string, string>)[key] = (e.target as HTMLInputElement).value; } }));
}
function fieldBadge(m?: FieldMeta) {
  if (!m) return null;
  if (m.locked && m.source === 'human') return h('span', { class: 'chip ok' }, '✎ humano');
  if (m.status === 'review') return h('span', { class: 'chip warn' }, '⚠ revisar');
  if (m.status === 'illegible') return h('span', { class: 'chip err' }, '? ilegible');
  if (m.status === 'absent') return h('span', { class: 'chip' }, '— ausente');
  if (m.locked) return h('span', { class: 'chip ok' }, '✔ confirmado');
  return m.source === 'ocr_back' ? h('span', { class: 'chip info' }, 'reverso') : null;
}
