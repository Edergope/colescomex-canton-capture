// Armazón de la interfaz: enrutado, navegación, refresco en vivo y contexto compartido por las pantallas.
// La UI solo habla con CaptureApp (y lee el repositorio local); nunca con Google directamente.
import { mount, releaseUrls, toast, LazyThumbs } from './dom';
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

export interface UiInfo { configProblems: string[]; engineName: string; storage?: { persisted: boolean } }

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

  constructor(private root: HTMLElement, readonly app: CaptureApp, readonly info: UiInfo) {
    applyTheme(); watchSystemTheme();
    app.repo.onChange(() => this.scheduleRefresh());
    window.addEventListener('online', () => this.scheduleRefresh());
    window.addEventListener('offline', () => this.scheduleRefresh());
    window.addEventListener('popstate', () => { this.leave(); this.route = (history.state as Route) ?? { name: 'home' }; void this.render(); });
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
  }

  go(r: Route) { this.leave(); this.route = r; history.pushState(r, ''); void this.render(); window.scrollTo(0, 0); }
  replace(r: Route) { this.leave(); this.route = r; history.replaceState(r, ''); void this.render(); }
  back() { if (history.state && history.length > 1) history.back(); else this.replace({ name: 'home' }); }
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
