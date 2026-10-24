// PANTALLAS 3 y 5 — Cámara inteligente y «Guardar y siguiente proveedor».
// La foto se protege en el teléfono al instante; escáner, OCR y sincronización siguen en segundo plano.
// La pista de encuadre usa el detector real del motor, pero es solo orientativa: nunca bloquea el disparo.
import { h, toast, confirmSheet, pickFiles, blobUrl, revokeUrl, sheet } from '../dom';
import { icon } from '../icons';
import { chip } from '../components';
import { LiveCamera, HintDetector, type HintResult } from '../camera';
import { FEATURES, DOC_TYPES } from '../features';
import { SIMULATED_SYNC } from '../../config/env';
import { EVIDENCE_LABELS, type EvidenceKind, type UserProfile } from '../../domain/schema';
import { ScanPreview, cropState, fullFrame, CROP_LABEL, DECIDED, type PreviewResult } from '../scan-preview';
import { openCornerEditor } from './corners';
import type { Quad } from '../../scanner/homography';
import type { QuickFields } from '../../storage/repo';
import type { CaptureApp } from '../../app/service';
import type { Ctx } from '../views';

/** Recorte propuesto por el escáner real y decisión del operador (se guarda en el borrador al instante). */
interface DraftCrop {
  decision?: 'auto' | 'manual' | 'full'; quad?: Quad; /** propuesta original del detector */ autoQuad?: Quad;
  detector?: { status: string; confidence: number }; reasons?: string[]; source?: { width: number; height: number };
  /** documento recortado y enderezado YA GENERADO para `imageQuad` (se guarda como documento procesado) */
  image?: Blob; imageQuad?: Quad; rot?: number;
  /** último fallo al generar el recorte (se muestra con «Reintentar») */
  renderError?: string;
}
interface DraftEvidence { kind: EvidenceKind; blob: Blob; name?: string; crop?: DraftCrop }
/** Formato compatible con el borrador previo (`meta draft:<userId>`). */
export interface Draft { step: 'front' | 'askBack' | 'back' | 'extras'; evidences: DraftEvidence[]; quick: QuickFields }
const emptyDraft = (): Draft => ({ step: 'front', evidences: [], quick: {} });
const isCardFace = (e: DraftEvidence) => (e.kind === 'card_front' || e.kind === 'card_back') && e.blob.type.startsWith('image/');
const sameQuad = (a?: Quad, b?: Quad) => !!a && !!b && a.length === 4 && a.every((p, i) => p.x === b[i]?.x && p.y === b[i]?.y);
/** El recorte decidido EXISTE (imagen generada para esas mismas esquinas) o la decisión es la foto completa. */
const materialized = (e: DraftEvidence) => e.crop?.decision === 'full' || (!!e.crop?.decision && !!e.crop.image && sameQuad(e.crop.imageQuad, e.crop.quad));
/** Caras de la tarjeta sin decisión del operador o con un recorte aún no generado: la captura no puede terminarse. */
const pendingFaces = (d: Draft) => d.evidences.filter((e) => isCardFace(e) && !materialized(e));
const pendingText = (e: DraftEvidence) => `${SHORT[e.kind].toLowerCase()} (${e.crop?.decision ? 'recorte sin generar' : 'falta decidir'})`;

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
  /** caras cuyo recorte se está generando ahora */
  private rendering = new Set<DraftEvidence>();
  /** ver la foto original en lugar del recorte (comprobación visual) */
  private viewOriginal = false;

  private root = h('div', { class: 'camera', id: 'screen-capture', role: 'region', 'aria-label': 'Cámara de captura' });
  private video = h('video', { autoplay: true, muted: true, playsInline: true, 'aria-hidden': 'true' });
  private viewport = h('div', { class: 'viewport', 'aria-label': 'Visor de la cámara' });
  /** capa sobre el vídeo (guía, pista, foto tomada, mensajes): se redibuja sin tocar el <video> */
  private stage = h('div', { class: 'cam-stage' });
  private overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private hintEl = h('div', { class: 'hint', role: 'status', 'aria-live': 'polite', id: 'cam-hint' });
  private top = h('div', { class: 'cam-top' });
  private bottom = h('div');
  private queuePill = h('button', { class: 'queue-pill', id: 'queue-pill' });

  constructor(private ctx: Ctx) {
    this.overlay.setAttribute('class', 'guide'); this.overlay.setAttribute('aria-hidden', 'true');
    this.queuePill.addEventListener('click', () => this.ctx.go({ name: 'list', filter: 'pending' }));
    // El <video> queda montado toda la sesión: si se retira del documento el navegador lo PAUSA (norma HTML) y al
    // reinsertarlo el visor se queda congelado (defecto «Fotografiar reverso» en Android). Solo se oculta.
    this.video.hidden = true;
    this.viewport.append(this.video, this.stage);
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
    document.addEventListener('visibilitychange', this.onVisibility);
    return this.root;
  }

  close() {
    this.closed = true;
    document.removeEventListener('visibilitychange', this.onVisibility);
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
      cancelAnimationFrame(this.raf); this.loop();
    } catch (e) {
      const n = (e as Error).name;
      this.camError = n === 'NotAllowedError' ? 'Permiso de cámara denegado. Puede usar la cámara del sistema o la galería.' : 'No se pudo abrir la cámara. Use la cámara del sistema o la galería.';
    }
    if (!this.closed) this.draw();
  }

  private onVisibility = () => { if (!document.hidden) void this.ensureLive(); };

  /**
   * Garantiza que el visor reproduce la cámara cuando debe verse: misma sesión MediaStream (sin nuevas solicitudes de
   * permiso); `play()` si quedó en pausa (vuelta de segundo plano, ocultación); solo si la pista terminó (el sistema
   * cerró la cámara) se vuelve a abrir.
   */
  private async ensureLive() {
    if (this.closed || !this.live || !('shoot' in this.mode) || document.hidden) return;
    const v = this.video, stream = this.cam.stream;
    if (!stream || !stream.active || stream.getVideoTracks().every((t) => t.readyState === 'ended')) {
      this.live = false; this.cam.stop(); await this.startCamera(); return;
    }
    if (v.srcObject !== stream) v.srcObject = stream;
    if (v.paused) await v.play().catch(() => undefined); // se reintenta en el próximo cambio de modo o de visibilidad
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
   * el análisis solo propone esquinas: nada se valida sin una decisión del operador. Una cara ya decidida con su
   * recorte generado no se vuelve a analizar; si la decisión aún no tiene su recorte, se genera.
   */
  private async analyzeShot() {
    const shot = this.lastShot; const ev = shot?.ev;
    if (!shot || !ev || !isCardFace(ev)) return;
    const d = ev.crop?.decision;
    if ((d === 'auto' || d === 'manual')) {
      if (!materialized(ev) && !this.rendering.has(ev) && !ev.crop?.renderError) void this.materialize(ev);
      this.draw(); return;
    }
    shot.preview = undefined; this.draw();
    try {
      const r = await this.scanPreview.analyze(ev.blob);
      if (this.closed) return;
      const a = r.analysis;
      // «no encontrado» = no hay propuesta (nunca se inventan esquinas); fiable o dudoso = propuesta revisable
      const proposal = a.status === 'ok' || a.status === 'low_confidence' ? a.quad : undefined;
      const diag = { source: a.source, reasons: a.reasons, detector: { status: a.status, confidence: a.confidence }, autoQuad: proposal };
      // una decisión tomada mientras se analizaba no se pisa: solo se completa
      const now = ev.crop?.decision;
      ev.crop = now ? { ...ev.crop, ...diag, quad: now === 'full' ? fullFrame(a) : ev.crop!.quad } : { ...ev.crop, ...diag, quad: proposal };
      await this.persist();
      if (this.lastShot === shot) shot.preview = r;
    } catch {
      if (this.lastShot === shot) shot.preview = 'error';
    }
    if (!this.closed && this.lastShot === shot) this.draw();
  }

  /** Estado del recorte de una cara: generado, generándose o fallido. */
  private renderState(ev: DraftEvidence): 'ok' | 'pending' | 'error' {
    if (materialized(ev)) return 'ok';
    if (this.rendering.has(ev)) return 'pending';
    return ev.crop?.renderError ? 'error' : 'pending';
  }

  /**
   * ETAPA A — genera de verdad el documento recortado y enderezado para las esquinas decididas, comprueba que la
   * imagen existe y la guarda en el borrador. Independiente del OCR. Devuelve false (con el error visible) si falla.
   */
  private async materialize(ev: DraftEvidence): Promise<boolean> {
    const quad = ev.crop?.quad; if (!quad || !ev.crop) return false;
    this.rendering.add(ev); ev.crop.renderError = undefined;
    if (!this.closed) this.draw();
    try {
      const m = await this.scanPreview.materialize(ev.blob, quad);
      if (ev.crop?.quad !== quad) return false; // las esquinas cambiaron mientras tanto
      ev.crop = { ...ev.crop, image: m.image, imageQuad: quad, rot: m.rot, source: ev.crop.source ?? m.source, renderError: undefined };
      await this.persist();
      return true;
    } catch (e) {
      if (ev.crop?.quad === quad) ev.crop.renderError = (e as Error).message || 'Error desconocido';
      return false;
    } finally {
      this.rendering.delete(ev);
      if (!this.closed) this.draw();
    }
  }

  private currentCropState() {
    const shot = this.lastShot; const ev = shot?.ev; if (!ev || !isCardFace(ev)) return null;
    const d = ev.crop?.decision;
    if (d) return cropState(undefined, d, this.renderState(ev));
    if (shot!.preview === 'error') return 'error' as const;
    return cropState(shot!.preview?.analysis);
  }

  private async decideCrop(decision: 'auto' | 'manual' | 'full') {
    const shot = this.lastShot; const ev = shot?.ev; if (!shot || !ev) return;
    this.viewOriginal = false;
    if (decision === 'manual') {
      // se abre la foto ORIGINAL con las últimas esquinas elegidas (o la propuesta del detector)
      const start = ev.crop?.decision === 'full' ? ev.crop.autoQuad : ev.crop?.quad ?? ev.crop?.autoQuad;
      await openCornerEditor({ blob: ev.blob, quad: start }, {
        title: `Ajustar esquinas · ${SHORT[ev.kind]}`,
        workingLabel: 'Generando recorte…',
        onSave: async (q) => {
          ev.crop = { ...ev.crop, decision: 'manual', quad: q as Quad, image: undefined, imageQuad: undefined, renderError: undefined };
          await this.persist();
          if (!(await this.materialize(ev))) throw new Error(`No se pudo generar el recorte: ${ev.crop?.renderError ?? 'error desconocido'}. Sus esquinas se conservan; pulse «Aplicar» para reintentar.`);
        },
        onFull: async () => this.decideCrop('full'),
      });
      return;
    }
    const pv = shot.preview && shot.preview !== 'error' ? shot.preview : undefined;
    if (decision === 'full') {
      ev.crop = { ...ev.crop, decision: 'full', quad: ev.crop?.source ? fullFrame({ source: ev.crop.source }) : undefined, image: undefined, imageQuad: undefined, renderError: undefined };
      await this.persist(); this.draw(); return;
    }
    // aceptar el recorte automático propuesto (solo si existe una propuesta)
    const auto = ev.crop?.autoQuad; if (!auto) return;
    ev.crop = { ...ev.crop, decision: 'auto', quad: auto, renderError: undefined };
    if (ev.crop.detector?.status === undefined && pv) ev.crop.detector = { status: pv.analysis.status, confidence: pv.analysis.confidence };
    // el recorte que ya se ve (análisis fiable de esas mismas esquinas) es el documento: una pulsación basta
    if (pv && pv.analysis.cropped && sameQuad(pv.analysis.quad, auto)) Object.assign(ev.crop, { image: pv.image, imageQuad: auto, rot: pv.rot });
    await this.persist();
    if (!materialized(ev)) { void this.materialize(ev); return; }
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
    // nunca se acepta un recorte en silencio: cada cara necesita una decisión explícita del operador
    const pending = pendingFaces(this.draft);
    if (pending.length) {
      const e = pending[0];
      toast(`Antes de guardar: ${pending.map(pendingText).join(' y ')}. Las fotos siguen protegidas.`, 4000);
      if (this.lastShot?.ev !== e) { this.lastShot = { blob: e.blob, kind: e.kind, ev: e }; this.mode = { sheet: true }; this.draw(); void this.analyzeShot(); }
      document.getElementById('crop-review')?.focus();
      return;
    }
    this.saving = true; this.drawBottom();
    try {
      const evs = await Promise.all(this.draft.evidences.map(async (e) => ({ kind: e.kind, blob: e.blob, name: e.name, crop: await cropForSave(e) })));
      const c = await this.ctx.app.saveCapture(evs, this.draft.quick);
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
    this.queuePill.title = reading ? `${reading} procesando documento` : up ? `${up} pendientes de sincronización` : SIMULATED_SYNC ? 'Todo sincronizado (simulado)' : 'Todo confirmado en Google';
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
    const showVideo = shooting && this.live;
    this.video.hidden = !showVideo;
    if (showVideo) {
      nodes.push(this.overlay, this.hintEl,
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
      const shot = this.lastShot; const ev = shot.ev; const st = this.currentCropState();
      const pv = shot.preview && shot.preview !== 'error' ? shot.preview : undefined;
      // se muestra EXACTAMENTE lo que se procesará: el recorte generado (aplicado) o, sin decisión, la propuesta
      const cropImg = (st === 'auto_accepted' || st === 'manual') ? ev?.crop?.image : st === 'auto_ok' && pv?.analysis.cropped ? pv.image : undefined;
      if (cropImg && !this.viewOriginal) nodes.push(h('img', { class: 'still crop', src: this.url(cropImg), alt: `Recorte de ${EVIDENCE_LABELS[shot.kind]}`, id: 'cam-still', 'data-view': 'crop' }));
      else {
        const img = h('img', { class: 'still', src: this.url(shot.blob), alt: `Foto tomada: ${EVIDENCE_LABELS[shot.kind]}`, id: 'cam-still', 'data-view': 'original' });
        nodes.push(img, this.overlay);
        const q = ev?.crop?.decision === 'full' ? undefined : ev?.crop?.quad;
        const src = ev?.crop?.source;
        img.addEventListener('load', () => {
          this.lastHintStatus = '';
          // contorno propuesto o elegido (si lo hay) sobre la foto completa, normalizado a la foto con EXIF aplicado
          this.showHint(q && src ? { status: 'low_confidence', multiple: false, confidence: 0, quad: q.map((p) => ({ x: p.x / src.width, y: p.y / src.height })) } : null, img.naturalWidth, img.naturalHeight);
          this.hintEl.hidden = true;
        }, { once: true });
      }
      if (st === 'rendering') nodes.push(h('div', { class: 'cam-badge', id: 'crop-working', role: 'status' }, icon('loader', 'sm'), ' Generando recorte…'));
      if (cropImg) nodes.push(h('button', { class: 'queue-pill view-toggle', id: 'btn-view-toggle', 'aria-pressed': String(this.viewOriginal),
        onClick: () => { this.viewOriginal = !this.viewOriginal; this.drawViewport(); } }, icon(this.viewOriginal ? 'crop' : 'image', 'sm'), this.viewOriginal ? 'Ver recorte' : 'Ver original'));
    } else {
      nodes.push(h('div', { class: 'cam-msg' }, icon('shield', 'lg'), h('b', null, 'Fotos protegidas en este dispositivo'), h('p', { class: 'small', style: 'color:#d6deea' }, 'Elija cómo continuar.')));
    }
    this.stage.replaceChildren(...nodes);
    if (showVideo) void this.ensureLive();
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
    const dec = ev?.crop?.decision; // solo lo que el operador eligió; ver un recorte no es aprobarlo
    const pending = pendingFaces(d);
    const hasQuad = !!ev?.crop?.autoQuad;
    const busy = st === 'rendering';
    const act = (id: string, ic: string, label: string, onClick: () => void, o: { pressed?: boolean; disabled?: boolean; primary?: boolean } = {}) =>
      h('button', { class: `btn${o.primary ? ' primary' : ''}`, id, 'aria-pressed': o.pressed === undefined ? undefined : String(o.pressed), disabled: this.saving || busy || !!o.disabled, onClick }, icon(ic), label);
    // acciones de recorte: la principal a todo lo ancho; las alternativas debajo, en dos columnas legibles
    const main = st === 'render_error'
      ? act('btn-crop-retry', 'refresh', 'Reintentar recorte', () => { if (ev) void this.materialize(ev); }, { primary: true })
      : act('btn-crop-auto', 'crop', dec === 'auto' ? 'Recorte automático aplicado' : 'Usar recorte automático', () => this.decideCrop('auto'), { pressed: dec === 'auto', disabled: !hasQuad, primary: st === 'auto_ok' });
    const cropReview = st && ev ? h('section', { class: `crop-review${DECIDED.has(st) ? ' done' : ' pending'}`, id: 'crop-review', tabindex: '-1', 'aria-labelledby': 'crop-title', 'data-state': st },
      h('div', { class: 'crop-head' },
        h('b', { id: 'crop-title' }, `Recorte del ${SHORT[ev.kind].toLowerCase()}`),
        h('span', { class: 'small muted', id: 'crop-face-count' }, faceCount(d, ev))),
      h('p', { class: 'small', id: 'crop-help' }, st === 'render_error' && ev.crop?.renderError ? `${lbl!.help} (${ev.crop.renderError})` : lbl!.help),
      h('div', { class: 'crop-actions' },
        main,
        h('div', { class: 'crop-alt' },
          act('btn-crop-adjust', 'edit', dec === 'manual' ? 'Ajustar de nuevo' : 'Ajustar manualmente', () => this.decideCrop('manual'), { pressed: dec === 'manual' }),
          act('btn-crop-full', 'image', 'Conservar foto completa', () => this.decideCrop('full'), { pressed: dec === 'full' })))) : null;
    const btn = (id: string, ic: string, label: string, onClick: () => void, cls = 'btn') => h('button', { class: cls, id, onClick, disabled: this.saving }, icon(ic), label);
    const faceTag = (e: DraftEvidence) => {
      if (!isCardFace(e)) return '';
      const r = this.renderState(e);
      return !e.crop?.decision ? 'falta decidir' : e.crop.decision === 'full' ? 'foto completa' : r === 'ok' ? 'recorte aplicado' : r === 'error' ? 'recorte fallido' : 'generando recorte';
    };
    const strip = h('div', { class: 'mini-strip', 'aria-label': 'Fotos de esta captura' }, ...d.evidences.map((e) =>
      h('button', { class: 'evidence', 'data-crop': isCardFace(e) ? e.crop?.decision ?? 'pending' : undefined, 'data-ready': isCardFace(e) ? String(materialized(e)) : undefined,
        'aria-label': `${EVIDENCE_LABELS[e.kind]}${isCardFace(e) ? ` · ${faceTag(e)}` : ''}`, 'aria-pressed': String(this.lastShot?.ev === e),
        onClick: () => { this.lastShot = { blob: e.blob, kind: e.kind, ev: e }; this.viewOriginal = false; this.draw(); void this.analyzeShot(); } },
        e.blob.type.startsWith('image/') ? h('img', { src: this.url(isCardFace(e) && materialized(e) && e.crop?.image ? e.crop.image : e.blob), alt: '' }) : h('span', { class: 'doc' }, 'PDF'),
        h('span', { class: 'tag' }, SHORT[e.kind]),
        isCardFace(e) ? h('span', { class: `face-state ${materialized(e) ? 'ok' : 'todo'}`, 'aria-hidden': 'true' }, icon(materialized(e) ? 'check' : 'alert', 'sm')) : null)));
    const quick = (k: keyof QuickFields, label: string, ph: string) => h('div', { class: 'field' }, h('label', { for: `q-${k}` }, label),
      h('input', { id: `q-${k}`, name: k, value: d.quick[k] ?? '', placeholder: ph, autocomplete: 'off', onInput: (e: Event) => { d.quick[k] = (e.target as HTMLInputElement).value; void this.persist(); } }));

    return [
      h('div', { class: 'row between' }, h('h2', null, has('card_back') ? 'Anverso y reverso listos' : has('card_front') ? 'Anverso listo' : 'Captura en curso'), status),
      h('p', { class: 'small muted', id: 'draft-protected' }, icon('shield', 'sm'), ' Las fotos ya están protegidas en este dispositivo.'),
      cropReview,
      strip,
      pending.length ? h('p', { class: 'small', id: 'crop-pending', role: 'status' }, icon('alert', 'sm'),
        ` Antes de guardar: ${pending.map(pendingText).join(' y ')}.`)
        : has('card_front') ? h('p', { class: 'small', id: 'crop-ready', role: 'status' }, icon('check', 'sm'), ' Listo para guardar: cada cara tiene su recorte decidido.') : null,
      has('card_front') ? h('button', { class: 'btn primary lg block', id: 'btn-save-next', disabled: this.saving, 'data-blocked': pending.length ? 'crop' : undefined, 'aria-describedby': pending.length ? 'crop-pending' : undefined, 'aria-busy': this.saving ? 'true' : undefined, onClick: () => this.save(true) },
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
        has('card_front') ? h('button', { class: 'btn grow', id: 'btn-save-done', disabled: this.saving, 'data-blocked': pending.length ? 'crop' : undefined, 'aria-describedby': pending.length ? 'crop-pending' : undefined, onClick: () => this.save(false) }, icon('home'), 'Guardar y salir') : null),
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
 * Decisión de recorte que se guarda: SIEMPRE la elegida por el operador (el guardado se bloquea antes si falta).
 * «Foto completa» elegida mientras se analizaba aún no conoce el tamaño: se lee de la propia foto (EXIF aplicado).
 */
async function cropForSave(e: DraftEvidence) {
  const c = e.crop;
  if (!isCardFace(e) || !c?.decision) return undefined;
  const quad = c.decision === 'full' ? fullFrame({ source: c.source ?? await imageSize(e.blob) }) : c.quad;
  if (!quad) return undefined;
  // el recorte ya generado y visto se guarda como documento procesado (no depende del OCR)
  const image = c.decision !== 'full' && materialized(e) ? c.image : undefined;
  return { decision: c.decision, quad, detector: c.detector, ...(image ? { image, rot: c.rot ?? 0 } : {}) };
}

async function imageSize(b: Blob) {
  const bmp = await createImageBitmap(b, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  try { return { width: bmp.width, height: bmp.height }; } finally { bmp.close(); }
}

/** «Cara 1 de 2 · 1 lista» — qué cara se revisa y cuántas están resueltas. */
function faceCount(d: Draft, ev: DraftEvidence) {
  const faces = d.evidences.filter(isCardFace);
  return `Cara ${faces.indexOf(ev) + 1} de ${faces.length} · ${faces.filter(materialized).length} lista${faces.filter(materialized).length === 1 ? '' : 's'}`;
}

const nn = (...xs: (Node | string | null | undefined)[]) => xs.filter((x): x is Node | string => x != null);
