// Armazón de la interfaz: enrutado, navegación, refresco en vivo y contexto compartido por las pantallas.
// La UI solo habla con CaptureApp (y lee el repositorio local); nunca con Google directamente.
import { h, mount, releaseUrls, toast, LazyThumbs, pickerOpen, confirmSheet } from './dom';
import { icon } from './icons';
import type { UpdateManager } from '../pwa/update';
import { updateSafety } from '../pwa/safety';
import { bottomNav, type NavKey } from './components';
import { applyTheme, watchSystemTheme } from './theme';
import type { CaptureApp } from '../app/service';
import type { UserProfile } from '../domain/schema';
import { reviewItems } from './model';
import { loginScreen } from './screens/login';
import { homeScreen } from './screens/home';
import { listScreen } from './screens/list';
import { detailScreen } from './screens/detail';
import { documentScreen } from './screens/document';
import { reviewScreen } from './screens/review';
import { syncScreen } from './screens/sync';
import { settingsScreen } from './screens/settings';
import { CaptureFlow, loadDraft } from './screens/capture';

export type Route =
  | { name: 'login' } | { name: 'home' } | { name: 'capture' }
  | { name: 'list'; filter?: string; q?: string; op?: string }
  | { name: 'detail'; uuid: string }
  | { name: 'doc'; uuid: string; kind: string; view?: 'processed' | 'original' | 'compare' }
  | { name: 'review'; uuid?: string }
  | { name: 'sync' } | { name: 'settings' };

export interface UiInfo { configProblems: string[]; engineName: string; storage?: { persisted: boolean }; updater?: UpdateManager }

export interface Ctx {
  app: CaptureApp;
  info: UiInfo;
  user: UserProfile | null;
  route: Route;
  thumbs: LazyThumbs;
  go(r: Route): void;
  replace(r: Route): void;
  back(): void;
  refresh(): void;
  setUser(u: UserProfile | null): void;
  /** la pantalla actual tiene cambios sin guardar: se pausa el refresco en vivo */
  setDirty(d: boolean): void;
  nav(current: NavKey | null): HTMLElement;
  /** aplica una actualización lista si es seguro (o explica por qué todavía no) */
  applyUpdateNow(): Promise<void>;
}

const NAV_ROUTE: Record<NavKey, Route> = { home: { name: 'home' }, list: { name: 'list' }, capture: { name: 'capture' }, review: { name: 'review' }, settings: { name: 'settings' } };

export class UI implements Ctx {
  route: Route = { name: 'home' };
  user: UserProfile | null = null;
  thumbs = new LazyThumbs();
  private dirty = false;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private capture?: CaptureFlow;
  private reviewCount = 0;
  private renderSeq = 0;
  /** entradas de historial creadas por la app en esta sesión (back() nunca sale de la app) */
  private depth = 0;

  constructor(private root: HTMLElement, readonly app: CaptureApp, readonly info: UiInfo) {
    applyTheme(); watchSystemTheme();
    app.repo.onChange(() => this.scheduleRefresh());
    window.addEventListener('online', () => this.scheduleRefresh());
    window.addEventListener('offline', () => this.scheduleRefresh());
    window.addEventListener('popstate', () => { this.depth = Math.max(0, this.depth - 1); this.leave(); this.route = (history.state as Route) ?? { name: 'home' }; void this.render(); });
    const up = info.updater;
    if (up) {
      up.setSafetyProbe((mode) => this.updateSafety(mode));
      up.onChange(() => this.drawUpdateBar());
    }
  }

  /**
   * ¿Se puede recargar la app ahora para aplicar una actualización sin perder nada?
   * Automático: nunca con la cámara abierta. Manual: la captura en curso se conserva (borrador persistido),
   * salvo en pleno disparo o guardado.
   */
  updateSafety(mode: 'auto' | 'manual'): { safe: boolean; reason?: string } {
    return updateSafety({
      mode, route: this.route.name, captureBusy: !!this.capture?.isBusy(), pickerOpen: pickerOpen(), dirty: this.dirty,
      overlayOpen: !!document.querySelector('.scrim, .ce-overlay'), ocrBusy: this.app.ocr.busy, syncBusy: this.app.sync.busy,
    });
  }

  /** Aviso persistente de actualización (no bloquea; se aplica sola en un momento seguro). */
  private drawUpdateBar() {
    const s = this.info.updater?.state;
    let bar = document.getElementById('update-bar');
    if (!s || (s.phase !== 'ready' && s.phase !== 'applying')) { bar?.remove(); return; }
    if (!bar) { bar = h('div', { id: 'update-bar', class: 'update-bar', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(bar); }
    const applying = s.phase === 'applying';
    bar.replaceChildren(icon(applying ? 'loader' : 'sparkles', applying ? 'sm spin' : 'sm'),
      h('span', { class: 'grow' }, applying ? 'Actualizando a la nueva versión…' : s.blockedBy ? `Nueva versión lista. Se aplicará sola en cuanto sea seguro (ahora ${s.blockedBy}).` : 'Nueva versión lista.'),
      applying ? '' : h('button', { class: 'btn sm', id: 'btn-update-now', onClick: () => void this.applyUpdateNow() }, 'Actualizar ahora'));
  }

  async applyUpdateNow() {
    const up = this.info.updater; if (!up) return;
    const p = this.updateSafety('manual');
    if (!p.safe) { toast(`Todavía no: ${p.reason}. Se actualizará en cuanto sea seguro.`, 5000); up.maybeApply('auto'); return; }
    if (this.route.name === 'capture' && !(await confirmSheet('Actualizar ahora', 'La app se recargará. Las fotos de la captura en curso ya están guardadas en este teléfono y se recuperarán.', 'Actualizar'))) return;
    up.maybeApply('manual');
  }

  async start() {
    this.user = await this.app.auth.currentUser();
    const draft = this.user ? await loadDraft(this.app, this.user) : undefined;
    // tras recargar (o si Android liberó la pestaña) se vuelve a la misma pantalla
    const saved = history.state as Route | null;
    const resumable = saved && typeof saved === 'object' && 'name' in saved && saved.name !== 'login' ? saved : null;
    this.route = !this.user ? { name: 'login' } : draft?.evidences.length ? { name: 'capture' } : resumable ?? { name: 'home' };
    history.replaceState(this.route, '');
    await this.render();
    if (this.user && draft?.evidences.length) toast('Se recuperó una captura sin guardar');
    const out = this.info.updater?.state.outcome;
    if (out) toast(out.ok ? `Actualizada a la versión ${out.to}. Sus capturas siguen en este teléfono.` : 'La actualización no llegó a aplicarse; se reintentará automáticamente.', 7000);
    this.drawUpdateBar();
  }

  go(r: Route) { this.leave(); this.route = r; this.depth++; history.pushState(r, ''); void this.render(); window.scrollTo(0, 0); this.afterNavigate(); }
  replace(r: Route) { this.leave(); this.route = r; history.replaceState(r, ''); void this.render(); this.afterNavigate(); }
  /** Al salir de la cámara o volver a Inicio, una actualización pendiente puede aplicarse sin interrumpir nada. */
  private afterNavigate() { if (this.info.updater?.state.phase === 'ready') setTimeout(() => this.info.updater?.maybeApply('auto'), 300); }
  /** Volver solo dentro de la app: si la pantalla se abrió al arrancar (p. ej. borrador recuperado), se va a Inicio. */
  back() { if (this.depth > 0) history.back(); else this.replace({ name: 'home' }); }
  refresh() { void this.render(true); }
  setUser(u: UserProfile | null) { this.user = u; }
  setDirty(d: boolean) { this.dirty = d; }
  nav(current: NavKey | null) {
    return bottomNav(current, (k) => (k === current && k !== 'capture' ? window.scrollTo({ top: 0 }) : this.go(NAV_ROUTE[k])), { review: this.reviewCount });
  }

  private leave() {
    this.dirty = false;
    this.capture?.close(); this.capture = undefined;
    this.thumbs.disconnect(); this.thumbs = new LazyThumbs();
    releaseUrls();
    document.body.classList.remove('camera-open');
  }

  private scheduleRefresh() {
    if (this.route.name === 'capture') { this.capture?.onDataChanged(); return; }
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => { if (!this.dirty) void this.render(true); }, 500);
  }

  private async render(keepScroll = false): Promise<void> {
    const seq = ++this.renderSeq;
    const y = window.scrollY;
    if (this.route.name !== 'login' && !this.user) { this.route = { name: 'login' }; history.replaceState(this.route, ''); }
    if (this.route.name !== 'capture') {
      // cada render construye miniaturas nuevas: se liberan las anteriores (memoria acotada en listas largas)
      this.thumbs.disconnect(); this.thumbs = new LazyThumbs(); releaseUrls();
    }
    const all = this.user ? await this.app.repo.list() : [];
    this.reviewCount = all.filter((c) => reviewItems(c).length > 0).length;
    let view: Node | Node[];
    switch (this.route.name) {
      case 'login': view = loginScreen(this); break;
      case 'home': view = await homeScreen(this, all); break;
      case 'list': view = await listScreen(this, all, this.route); break;
      case 'detail': view = await detailScreen(this, this.route.uuid); break;
      case 'doc': view = await documentScreen(this, this.route); break;
      case 'review': view = await reviewScreen(this, all, this.route.uuid); break;
      case 'sync': view = await syncScreen(this, all); break;
      case 'settings': view = await settingsScreen(this, all); break;
      case 'capture':
        if (this.capture) return; // la cámara gestiona su propio estado
        this.capture = new CaptureFlow(this);
        view = await this.capture.open();
        break;
    }
    if (seq !== this.renderSeq) return; // otro render más reciente ganó
    mount(this.root, view);
    if (keepScroll) window.scrollTo(0, y);
  }
}
