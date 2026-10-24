// PANTALLAS 3 y 5 — Cámara inteligente y «Guardar y siguiente proveedor».
// La foto se protege en el teléfono al instante; escáner, OCR y sincronización siguen en segundo plano.
// La pista de encuadre usa el detector real del motor, pero es solo orientativa: nunca bloquea el disparo.
import { h, toast, confirmSheet, pickFiles, blobUrl, revokeUrl, sheet } from '../dom';
import { icon } from '../icons';
import { chip } from '../components';
import { LiveCamera, HintDetector, type HintResult } from '../camera';
import { FEATURES, DOC_TYPES } from '../features';
import { EVIDENCE_LABELS, type EvidenceKind, type UserProfile } from '../../domain/schema';
import { ScanPreview, cropState, fullFrame, CROP_LABEL, type PreviewResult } from '../scan-preview';
import { openCornerEditor } from './corners';
import type { Quad } from '../../scanner/homography';
import type { QuickFields } from '../../storage/repo';
import type { CaptureApp } from '../../app/service';
import type { Ctx } from '../views';

/** Recorte propuesto por el escáner real y decisión del operador (se guarda en el borrador al instante). */
interface DraftCrop { decision?: 'auto' | 'manual' | 'full'; quad?: Quad; /** propuesta original del detector */ autoQuad?: Quad; detector?: { status: string; confidence: number }; reasons?: string[]; source?: { width: number; height: number } }
interface DraftEvidence { kind: EvidenceKind; blob: Blob; name?: string; crop?: DraftCrop }
/** Formato compatible con el borrador previo (`meta draft:<userId>`). */
export interface Draft { step: 'front' | 'askBack' | 'back' | 'extras'; evidences: DraftEvidence[]; quick: QuickFields }
const emptyDraft = (): Draft => ({ step: 'front', evidences: [], quick: {} });

export async function loadDraft(app: CaptureApp, user: UserProfile): Promise<Draft> {
  const d = (await app.repo.getMeta<Draft>(`draft:${user.id}`)) ?? emptyDraft();
  if (!Array.isArray(d.evidences)) return emptyDraft();
  if (d.step === 'front' && d.evidences.some((e) => e.kind === 'card_front')) d.step = 'askBack';
  d.quick ??= {};
  return d;
}

type Mode = { shoot: EvidenceKind } | { sheet: true };
const SHORT: Record<EvidenceKind, string> = { card_front: 'Anverso', card_back: 'Reverso', stand: 'Stand', product: 'Producto', catalog: 'Catálogo', other: 'Otra' };
const GUIDE_KEY = 'cx.guide';
const guidePref = (): boolean => { try { return localStorage.getItem(GUIDE_KEY) !== 'off'; } catch { return true; } };

export class CaptureFlow {
  private draft: Draft = emptyDraft();
  private mode: Mode = { shoot: 'card_front' };
  private cam = new LiveCamera();
  private hints = new HintDetector();
  private live = false;
  private camError = '';
  private saving = false;
  private shooting = false;
  private closed = false;
  private raf = 0;
  private lastHintAt = 0;
  private lastHintStatus = '';
  private guide = guidePref();
  private urls = new Set<string>();
  private lastShot?: { blob: Blob; kind: EvidenceKind; ev?: DraftEvidence; preview?: PreviewResult | 'error' };
  private scanPreview = new ScanPreview();

  private root = h('div', { class: 'camera', id: 'screen-capture', role: 'region', 'aria-label': 'Cámara de captura' });
  private video = h('video', { autoplay: true, muted: true, playsInline: true, 'aria-hidden': 'true' });
  private viewport = h('div', { class: 'viewport', 'aria-label': 'Visor de la cámara' });
  private overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private hintEl = h('div', { class: 'hint', role: 'status', 'aria-live': 'polite', id: 'cam-hint' });
  private top = h('div', { class: 'cam-top' });
  private bottom = h('div');
  private queuePill = h('button', { class: 'queue-pill', id: 'queue-pill' });

  constructor(private ctx: Ctx) {
    this.overlay.setAttribute('class', 'guide'); this.overlay.setAttribute('aria-hidden', 'true');
    this.queuePill.addEventListener('click', () => this.ctx.go({ name: 'list', filter: 'pending' }));
  }

  async open(): Promise<HTMLElement> {
    document.body.classList.add('camera-open');
    if (this.ctx.user) this.draft = await loadDraft(this.ctx.app, this.ctx.user);
    this.mode = this.draft.evidences.length ? { sheet: true } : { shoot: 'card_front' };
    const last = this.draft.evidences.at(-1);
    if (last) this.lastShot = { blob: last.blob, kind: last.kind, ev: last };
    this.root.append(this.top, this.viewport, this.bottom);
    this.draw();
    if (last) void this.analyzeShot();
    void this.updateQueue();
    void this.startCamera();
    return this.root;
  }

  close() {
    this.closed = true;
    this.scanPreview.close();
    cancelAnimationFrame(this.raf);
    this.cam.stop(); this.hints.terminate();
    for (const u of this.urls) revokeUrl(u); this.urls.clear();
    document.body.classList.remove('camera-open');
  }

  onDataChanged() { void this.updateQueue(); }

  /** En pleno disparo o guardado: una recarga ahora podría perder la foto que se está tomando. */
  isBusy(): boolean { return this.shooting || this.saving; }

  // ───────────── cámara ─────────────
  private async startCamera() {
    if (!LiveCamera.supported()) { this.camError = 'Este navegador no permite la cámara dentro de la app.'; this.draw(); return; }
    try {
      await this.cam.start(this.video);
      if (this.closed) { this.cam.stop(); return; }
      this.live = true; this.camError = '';
      this.loop();
    } catch (e) {
      const n = (e as Error).name;
      this.camError = n === 'NotAllowedError' ? 'Permiso de cámara denegado. Puede usar la cámara del sistema o la galería.' : 'No se pudo abrir la cámara. Use la cámara del sistema o la galería.';
    }
    if (!this.closed) this.draw();
  }

  private loop = () => {
    if (this.closed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.live || !('shoot' in this.mode) || document.hidden) return;
    const now = performance.now();
    if (now - this.lastHintAt < 320) return;
    this.lastHintAt = now;
    const p = this.hints.frame(this.video);
    if (p) void p.then((r) => { if (!this.closed && 'shoot' in this.mode) this.showHint(r, this.video.videoWidth, this.video.videoHeight); });
  };

  /** Dibuja el contorno detectado sobre el visor (object-fit: contain) y un mensaje breve. */
  private showHint(r: HintResult | null | undefined, sw: number, sh: number) {
    const W = this.viewport.clientWidth, H = this.viewport.clientHeight;
    const NS = 'http://www.w3.org/2000/svg';
    this.overlay.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.overlay.replaceChildren();
    if (this.guide && 'shoot' in this.mode) {
      const gw = Math.min(W * 0.86, (H * 0.7) * 1.7), gh = gw / 1.7;
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('class', 'guide-frame'); rect.setAttribute('rx', '14');
      rect.setAttribute('x', String((W - gw) / 2)); rect.setAttribute('y', String((H - gh) / 2)); rect.setAttribute('width', String(gw)); rect.setAttribute('height', String(gh));
      this.overlay.appendChild(rect);
    }
    if (r?.quad && sw && sh && r.status !== 'not_found') {
      const s = Math.min(W / sw, H / sh), ox = (W - sw * s) / 2, oy = (H - sh * s) / 2;
      const poly = document.createElementNS(NS, 'polygon');
      poly.setAttribute('class', 'detected');
      poly.setAttribute('points', r.quad.map((p) => `${ox + p.x * sw * s},${oy + p.y * sh * s}`).join(' '));
      this.overlay.appendChild(poly);
    }
    const [cls, ic, msg] = !r ? ['', 'info', ''] :
      r.multiple ? ['', 'alert', 'Hay varias tarjetas: deje solo una a la vista'] :
      r.status === 'ok' ? ['ok', 'check', 'Bordes visibles'] :
      r.status === 'low_confidence' ? ['', 'info', 'Bordes poco claros: puede disparar igualmente'] :
      ['', 'info', 'Encuadre la tarjeta (opcional)'];
    const key = `${cls}:${msg}`;
    if (key === this.lastHintStatus) return;
    this.lastHintStatus = key;
    this.hintEl.className = `hint ${cls}`;
    this.hintEl.replaceChildren(...(msg ? [icon(ic, 'sm'), msg] : []));
    this.hintEl.hidden = !msg;
  }

  // ───────────── estado / borrador ─────────────
  private async persist() {
    if (this.ctx.user) await this.ctx.app.repo.setMeta(`draft:${this.ctx.user.id}`, this.draft.evidences.length ? this.draft : null);
  }

  private async addPhotos(kind: EvidenceKind, blobs: Blob[]) {
    if (!blobs.length) return;
    if (kind === 'card_front' || kind === 'card_back') this.draft.evidences = this.draft.evidences.filter((e) => e.kind !== kind);
    for (const b of (kind === 'card_front' || kind === 'card_back') ? blobs.slice(0, 1) : blobs) this.draft.evidences.push({ kind, blob: b, name: (b as File).name });
    if (kind === 'card_front') this.draft.step = this.draft.evidences.some((e) => e.kind === 'card_back') ? 'extras' : 'askBack';
    if (kind === 'card_back') this.draft.step = 'extras';
    await this.persist(); // protegido en el teléfono antes de continuar
    const last = blobs[blobs.length - 1];
    this.lastShot = { blob: last, kind, ev: this.draft.evidences.find((e) => e.blob === last) };
    this.mode = { sheet: true };
    this.draw();
    void this.analyzeShot();
  }

  /**
   * Vista previa REAL del recorte (mismo escáner que el procesamiento). La foto ya está guardada en el borrador;
   * el análisis solo propone esquinas: nada se valida sin una decisión del operador.
   */
  private async analyzeShot() {
    const shot = this.lastShot; const ev = shot?.ev;
    if (!shot || !ev || !ev.blob.type.startsWith('image/') || !(ev.kind === 'card_front' || ev.kind === 'card_back')) return;
    shot.preview = undefined; this.draw();
    try {
      // se fuerza el recorte elegido: esquinas ajustadas, o el recorte dudoso que el operador decidió usar
      const forced = ev.crop?.decision === 'manual' || (ev.crop?.decision === 'auto' && ev.crop.detector?.status !== 'ok') ? ev.crop.quad : undefined;
      const r = await this.scanPreview.analyze(ev.blob, forced);
      if (!r || this.closed || this.lastShot !== shot) return;
      shot.preview = r;
      const a = r.analysis;
      // con esquinas forzadas se conserva el diagnóstico original del detector (trazabilidad)
      // «no encontrado» = no hay propuesta (nunca se inventan esquinas); fiable o dudoso = propuesta revisable
      const proposal = a.status === 'ok' || a.status === 'low_confidence' ? a.quad : undefined;
      ev.crop = forced ? { ...ev.crop, source: a.source } : { ...ev.crop, source: a.source, reasons: a.reasons, detector: { status: a.status, confidence: a.confidence }, quad: proposal, autoQuad: proposal };
      await this.persist();
    } catch { if (this.lastShot === shot) shot.preview = 'error'; }
    if (!this.closed && this.lastShot === shot) this.draw();
  }

  private currentCropState() {
    const shot = this.lastShot; if (!shot?.ev?.kind.startsWith('card_')) return null;
    if (shot.preview === 'error') return shot.ev.crop?.decision ? cropState(undefined, shot.ev.crop.decision) : 'error' as const;
    return cropState(shot.preview?.analysis, shot.ev.crop?.decision);
  }

  private async decideCrop(decision: 'auto' | 'manual' | 'full') {
    const shot = this.lastShot; const ev = shot?.ev; if (!shot || !ev) return;
    if (decision === 'manual') {
      await openCornerEditor({ blob: ev.blob, quad: ev.crop?.quad }, {
        title: `Ajustar esquinas · ${SHORT[ev.kind]}`,
        onSave: async (q) => { ev.crop = { ...ev.crop, decision: 'manual', quad: q as Quad }; await this.persist(); void this.analyzeShot(); },
        onFull: async () => this.decideCrop('full'),
      });
      return;
    }
    const a = shot.preview && shot.preview !== 'error' ? shot.preview.analysis : undefined;
    if (decision === 'full') ev.crop = { ...ev.crop, decision: 'full', quad: ev.crop?.source ? fullFrame({ source: ev.crop.source }) : undefined };
    else { // volver al recorte automático propuesto
      ev.crop = { ...ev.crop, decision: 'auto', quad: ev.crop?.autoQuad ?? a?.quad ?? ev.crop?.quad };
      if (ev.crop.detector?.status === undefined && a) ev.crop.detector = { status: a.status, confidence: a.confidence };
    }
    await this.persist();
    if (decision === 'auto' && (!a || !a.cropped || a.status === 'manual')) { void this.analyzeShot(); return; }
    this.draw();
  }

  private shoot = async () => {
    if (!('shoot' in this.mode) || this.shooting) return;
    const kind = this.mode.shoot;
    if (!this.live) { await this.systemCamera(); return; }
    this.shooting = true; this.drawBottom();
    try {
      const blob = await this.cam.capture(this.video);
      navigator.vibrate?.(30);
      await this.addPhotos(kind, [blob]);
    } catch (e) { toast(`No se pudo tomar la foto: ${(e as Error).message}. Pruebe con la cámara del sistema.`, 5000); }
    finally { this.shooting = false; if (!this.closed) this.drawBottom(); }
  };

  private async systemCamera() {
    const kind = 'shoot' in this.mode ? this.mode.shoot : 'card_front';
    await this.addPhotos(kind, await pickFiles({ camera: true }));
  }
  private async gallery() {
    const kind = 'shoot' in this.mode ? this.mode.shoot : 'card_front';
    const card = kind === 'card_front' || kind === 'card_back';
    await this.addPhotos(kind, await pickFiles({ multiple: !card, accept: card ? 'image/*' : 'image/*,application/pdf' }));
  }

  private target(kind: EvidenceKind) { this.mode = { shoot: kind }; this.lastHintStatus = ''; this.draw(); }

  private async save(next: boolean) {
    if (this.saving) return;
    if (!this.draft.evidences.some((e) => e.kind === 'card_front')) { toast('Falta la foto del anverso de la tarjeta'); this.target('card_front'); return; }
    this.saving = true; this.drawBottom();
    try {
      const c = await this.ctx.app.saveCapture(this.draft.evidences.map((e) => ({ kind: e.kind, blob: e.blob, name: e.name, crop: cropForSave(e) })), this.draft.quick);
      this.draft = emptyDraft(); await this.persist();
      this.lastShot = undefined;
      for (const u of this.urls) revokeUrl(u); this.urls.clear();
      toast(h('span', { id: 'saved-toast' }, icon('shield', 'sm'), ` Captura protegida en este dispositivo · ${c.external_ref}`), 4000);
      if (next) { this.target('card_front'); void this.updateQueue(); }
      else this.ctx.replace({ name: 'home' });
    } catch (e) {
      toast(`No se pudo guardar: ${(e as Error).message}. Las fotos siguen en el borrador.`, 7000);
    } finally { this.saving = false; if (!this.closed) this.drawBottom(); }
  }

  private async discard() {
    const ok = await confirmSheet('Descartar captura', `Se eliminarán las ${this.draft.evidences.length} foto(s) de esta captura sin guardar. Las capturas ya guardadas no se tocan.`, 'Descartar', 'Conservar', 'danger');
    if (!ok) return;
    this.draft = emptyDraft(); await this.persist(); this.lastShot = undefined;
    this.target('card_front');
  }

  private async updateQueue() {
    const all = await this.ctx.app.repo.list();
    const reading = all.filter((c) => c.ocr_status === 'CAPTURADO' || c.ocr_status === 'PROCESANDO').length;
    const up = all.filter((c) => c.sync_status !== 'CONFIRMADO').length;
    this.queuePill.replaceChildren(icon(reading ? 'loader' : up ? 'cloud-up' : 'cloud-ok', 'sm'), reading ? String(reading) : up ? String(up) : '');
    this.queuePill.classList.toggle('busy', reading > 0);
    this.queuePill.title = reading ? `${reading} procesando documento` : up ? `${up} pendientes de sincronización` : 'Todo confirmado en Google';
    this.queuePill.setAttribute('aria-label', `${reading} capturas procesando documento, ${up} pendientes de sincronización. Ver lista`);
  }

  // ───────────── render ─────────────
  private url(b: Blob) { const u = blobUrl(b); this.urls.add(u); return u; }

  private draw() { this.drawTop(); this.drawViewport(); this.drawBottom(); }

  private drawTop() {
    const has = (k: EvidenceKind) => this.draft.evidences.some((e) => e.kind === k);
    const cur = 'shoot' in this.mode ? this.mode.shoot : null;
    const extras = this.draft.evidences.filter((e) => !e.kind.startsWith('card_')).length;
    const pill = (label: string, done: boolean, active: boolean) => h('span', { class: `step-pill${done ? ' done' : ''}`, 'aria-current': active ? 'step' : undefined },
      done ? icon('check', 'sm') : null, label, done ? h('span', { class: 'sr-only' }, ' (hecho)') : null);
    this.top.replaceChildren(...nn(
      h('button', { class: 'icon-btn', id: 'btn-cam-close', 'aria-label': this.draft.evidences.length ? 'Salir (el borrador se conserva)' : 'Salir de la cámara', onClick: () => this.ctx.back() }, icon('x')),
      h('div', { class: 'steps', 'aria-label': 'Progreso de la captura' },
        pill('Anverso', has('card_front'), cur === 'card_front'),
        pill('Reverso', has('card_back'), cur === 'card_back'),
        pill(extras ? `Extras ${extras}` : 'Extras', extras > 0, !!cur && !cur.startsWith('card_'))),
      FEATURES.documentTypes ? h('button', { class: 'queue-pill', id: 'btn-doctype', onClick: () => this.docTypes() }, icon('card', 'sm'), 'Tarjeta') : null,
      this.live && this.cam.canTorch ? h('button', { class: 'icon-btn', id: 'btn-torch', 'aria-pressed': String(this.cam.torchOn), 'aria-label': 'Linterna', onClick: async () => { await this.cam.toggleTorch(); this.drawTop(); } }, icon('flash')) : null,
      this.queuePill));
  }

  private drawViewport() {
    const shooting = 'shoot' in this.mode;
    const nodes: Node[] = [];
    if (shooting && this.live) {
      nodes.push(this.video, this.overlay, this.hintEl,
        h('button', { class: 'queue-pill', id: 'btn-guide', style: 'position:absolute;top:8px;right:8px', 'aria-pressed': String(this.guide), onClick: () => {
          this.guide = !this.guide; try { localStorage.setItem(GUIDE_KEY, this.guide ? 'on' : 'off'); } catch { /* sin almacenamiento */ }
          this.lastHintStatus = ''; this.showHint(null, 0, 0); this.drawViewport();
        } }, icon('grid', 'sm'), this.guide ? 'Guía' : 'Sin guía'));
      this.showHint(null, 0, 0);
    } else if (shooting) {
      nodes.push(h('div', { class: 'cam-msg', id: 'cam-fallback' },
        icon('camera', 'lg'),
        h('b', null, `Fotografíe: ${EVIDENCE_LABELS[(this.mode as { shoot: EvidenceKind }).shoot]}`),
        h('p', { class: 'small', style: 'color:#d6deea' }, this.camError || 'Abriendo la cámara…'),
        this.camError ? h('div', { class: 'row', style: 'justify-content:center' },
          h('button', { class: 'btn primary', id: 'btn-system-camera', onClick: () => this.systemCamera() }, icon('camera'), 'Cámara del sistema'),
          h('button', { class: 'btn', onClick: () => this.gallery() }, icon('gallery'), 'Galería')) : null));
    } else if (this.lastShot && this.lastShot.blob.type.startsWith('image/')) {
      const shot = this.lastShot; const st = this.currentCropState();
      const pv = shot.preview && shot.preview !== 'error' ? shot.preview : undefined;
      // se muestra EXACTAMENTE lo que se procesará: el recorte (automático o ajustado) o la foto completa
      const showCrop = !!pv && pv.analysis.cropped && (st === 'auto_ok' || st === 'manual' || (st === 'auto_doubtful' && shot.ev?.crop?.decision === 'auto'));
      if (showCrop) nodes.push(h('img', { class: 'still crop', src: this.url(pv!.image), alt: `Recorte de ${EVIDENCE_LABELS[shot.kind]}`, id: 'cam-still', 'data-view': 'crop' }));
      else {
        const img = h('img', { class: 'still', src: this.url(shot.blob), alt: `Foto tomada: ${EVIDENCE_LABELS[shot.kind]}`, id: 'cam-still', 'data-view': 'original' });
        nodes.push(img, this.overlay);
        const q = shot.ev?.crop?.decision === 'full' ? undefined : shot.ev?.crop?.quad;
        const src = shot.ev?.crop?.source;
        img.addEventListener('load', () => {
          this.lastHintStatus = '';
          // contorno propuesto (si lo hay) sobre la foto completa, normalizado a la foto con EXIF aplicado
          this.showHint(q && src ? { status: 'low_confidence', multiple: false, confidence: 0, quad: q.map((p) => ({ x: p.x / src.width, y: p.y / src.height })) } : null, img.naturalWidth, img.naturalHeight);
          this.hintEl.hidden = true;
        }, { once: true });
      }
    } else {
      nodes.push(h('div', { class: 'cam-msg' }, icon('shield', 'lg'), h('b', null, 'Fotos protegidas en este dispositivo'), h('p', { class: 'small', style: 'color:#d6deea' }, 'Elija cómo continuar.')));
    }
    this.viewport.replaceChildren(...nodes);
  }

  private drawBottom() {
    if ('shoot' in this.mode) {
      const kind = this.mode.shoot;
      const last = this.draft.evidences.at(-1);
      this.bottom.className = 'cam-bottom';
      this.bottom.replaceChildren(
        h('button', { class: 'side-btn', id: 'btn-gallery', 'aria-label': 'Elegir de la galería', onClick: () => this.gallery() }, h('span', { class: 'thumb-mini' }, icon('gallery')), 'Galería'),
        h('button', { class: 'shutter', id: 'btn-shutter', disabled: this.shooting, 'aria-label': `Tomar foto: ${EVIDENCE_LABELS[kind]}`, onClick: this.shoot }),
        this.draft.evidences.length
          ? h('button', { class: 'side-btn right', id: 'btn-draft', 'aria-label': `Ver la captura en curso (${this.draft.evidences.length} fotos)`, onClick: () => { this.mode = { sheet: true }; this.draw(); } },
              last && last.blob.type.startsWith('image/') ? h('img', { class: 'thumb-mini', src: this.url(last.blob), alt: '' }) : h('span', { class: 'thumb-mini' }, icon('layers')), `${this.draft.evidences.length} foto(s)`)
          : h('button', { class: 'side-btn right', id: 'btn-system-camera-alt', 'aria-label': 'Usar la cámara del sistema', onClick: () => this.systemCamera() }, h('span', { class: 'thumb-mini' }, icon('camera')), 'Sistema'));
      return;
    }
    this.bottom.className = 'cam-sheet';
    this.bottom.setAttribute('role', 'group');
    this.bottom.setAttribute('aria-label', 'Opciones de la captura');
    this.bottom.replaceChildren(...nn(...this.sheetContent()));
  }

  private sheetContent(): (Node | null)[] {
    const d = this.draft;
    const has = (k: EvidenceKind) => d.evidences.some((e) => e.kind === k);
    const st = this.currentCropState();
    const lbl = st ? CROP_LABEL[st] : null;
    const status = lbl ? chip(lbl.tone === 'neutral' ? 'neutral' : lbl.tone, st === 'analyzing' ? 'loader' : lbl.tone === 'ok' ? 'crop' : 'alert', lbl.text, { busy: st === 'analyzing' }) : null;
    const ev = this.lastShot?.ev;
    const dec = ev?.crop?.decision ?? (st === 'auto_ok' ? 'auto' : st && st !== 'analyzing' ? 'full' : undefined);
    const hasQuad = !!ev?.crop?.autoQuad;
    const cropReview = st ? h('div', { class: 'crop-review', id: 'crop-review', role: 'group', 'aria-label': `Recorte de ${ev ? SHORT[ev.kind] : 'la tarjeta'}` },
      h('p', { class: 'small', id: 'crop-help' }, lbl!.help),
      h('div', { class: 'crop-actions' },
        h('button', { class: 'btn', id: 'btn-crop-auto', 'aria-pressed': String(dec === 'auto'), disabled: !hasQuad || this.saving, onClick: () => this.decideCrop('auto') }, icon('crop'), 'Usar recorte automático'),
        h('button', { class: 'btn', id: 'btn-crop-adjust', 'aria-pressed': String(dec === 'manual'), disabled: this.saving || st === 'analyzing', onClick: () => this.decideCrop('manual') }, icon('edit'), 'Ajustar manualmente'),
        h('button', { class: 'btn', id: 'btn-crop-full', 'aria-pressed': String(dec === 'full'), disabled: this.saving || st === 'analyzing', onClick: () => this.decideCrop('full') }, icon('image'), 'Conservar foto completa'))) : null;
    const btn = (id: string, ic: string, label: string, onClick: () => void, cls = 'btn') => h('button', { class: cls, id, onClick, disabled: this.saving }, icon(ic), label);
    const strip = h('div', { class: 'mini-strip', 'aria-label': 'Fotos de esta captura' }, ...d.evidences.map((e) =>
      h('button', { class: 'evidence', 'aria-label': `${EVIDENCE_LABELS[e.kind]}${e.crop?.decision ? ` · ${CROP_LABEL[cropState(undefined, e.crop.decision)].text}` : ''}`, 'aria-pressed': String(this.lastShot?.ev === e),
        onClick: () => { this.lastShot = { blob: e.blob, kind: e.kind, ev: e }; this.draw(); void this.analyzeShot(); } },
        e.blob.type.startsWith('image/') ? h('img', { src: this.url(e.blob), alt: '' }) : h('span', { class: 'doc' }, 'PDF'),
        h('span', { class: 'tag' }, SHORT[e.kind]))));
    const quick = (k: keyof QuickFields, label: string, ph: string) => h('div', { class: 'field' }, h('label', { for: `q-${k}` }, label),
      h('input', { id: `q-${k}`, name: k, value: d.quick[k] ?? '', placeholder: ph, autocomplete: 'off', onInput: (e: Event) => { d.quick[k] = (e.target as HTMLInputElement).value; void this.persist(); } }));

    return [
      h('div', { class: 'row between' }, h('h2', null, has('card_back') ? 'Anverso y reverso listos' : has('card_front') ? 'Anverso listo' : 'Captura en curso'), status),
      h('p', { class: 'small muted', id: 'draft-protected' }, icon('shield', 'sm'), ' Las fotos ya están protegidas en este dispositivo.'),
      cropReview,
      strip,
      has('card_front') ? h('button', { class: 'btn primary lg block', id: 'btn-save-next', disabled: this.saving, 'aria-busy': this.saving ? 'true' : undefined, onClick: () => this.save(true) },
        icon(this.saving ? 'loader' : 'check'), this.saving ? 'Guardando…' : 'Guardar y siguiente proveedor') : btn('btn-shoot-front', 'card', 'Fotografiar anverso', () => this.target('card_front'), 'btn primary lg block'),
      !has('card_back') && has('card_front') ? btn('btn-back-yes', 'flip', 'Fotografiar reverso', () => this.target('card_back'), 'btn block') : null,
      h('div', { class: 'extras-grid' },
        btn('btn-add-stand', 'store', 'Stand', () => this.target('stand')),
        btn('btn-add-product', 'box', 'Producto', () => this.target('product')),
        btn('btn-add-catalog', 'file', 'Catálogo', () => this.target('catalog')),
        btn('btn-add-other', 'image', 'Otra', () => this.target('other'))),
      h('details', null, h('summary', { class: 'small strong' }, 'Datos rápidos (opcional)'),
        h('div', { class: 'stack', style: 'margin-top:8px' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, quick('hall', 'Hall', 'p. ej. 11.2')), h('div', { class: 'grow' }, quick('booth', 'Stand', 'p. ej. B23'))),
          quick('product_interest', 'Producto de interés', ''), quick('notes', 'Notas', ''))),
      h('div', { class: 'row' },
        this.lastShot ? btn('btn-retake', 'refresh', 'Repetir foto', () => this.retake(), 'btn grow') : null,
        has('card_front') ? btn('btn-save-done', 'home', 'Guardar y salir', () => this.save(false), 'btn grow') : null),
      h('button', { class: 'btn ghost block', id: 'btn-discard', onClick: () => this.discard(), disabled: this.saving }, icon('x', 'sm'), 'Descartar esta captura'),
    ];
  }

  private retake() {
    const s = this.lastShot; if (!s) return;
    const i = this.draft.evidences.map((e) => e.blob).lastIndexOf(s.blob);
    if (i >= 0) this.draft.evidences.splice(i, 1);
    if (s.kind === 'card_front') this.draft.step = 'front';
    if (s.kind === 'card_back') this.draft.step = 'askBack';
    void this.persist();
    this.lastShot = undefined;
    this.target(s.kind);
  }

  private docTypes() {
    sheet('Tipo de documento', (close) => [
      h('p', { class: 'small muted' }, 'Vista previa de diseño: por ahora solo se procesan tarjetas comerciales.'),
      h('div', { class: 'stack' }, ...DOC_TYPES.map((t) => h('button', { class: 'btn block', style: 'justify-content:flex-start', disabled: !t.available, 'aria-disabled': String(!t.available), onClick: close },
        icon(t.icon), h('span', { class: 'grow', style: 'text-align:left' }, t.label), t.available ? chip('ok', 'check', 'Disponible') : chip('neutral', 'clock', 'Próximamente')))),
    ]);
  }
}

/**
 * Decisión de recorte que se guarda. Sin elección explícita: si se mostraba un recorte fiable, ese recorte (el
 * operador lo vio al guardar); si era dudoso o no había bordes, la foto completa (lo que se mostraba). Si el
 * análisis no terminó, no se decide nada y el procesamiento hará su propia detección (marcada como no revisada).
 */
function cropForSave(e: DraftEvidence) {
  if (!(e.kind === 'card_front' || e.kind === 'card_back') || !e.crop?.source) return undefined;
  const c = e.crop;
  const decision = c.decision ?? (c.detector?.status === 'ok' && c.quad ? 'auto' : 'full');
  const quad = decision === 'full' ? fullFrame({ source: c.source! }) : c.quad;
  return quad ? { decision, quad, detector: c.detector } : undefined;
}

const nn = (...xs: (Node | string | null | undefined)[]) => xs.filter((x): x is Node | string => x != null);
