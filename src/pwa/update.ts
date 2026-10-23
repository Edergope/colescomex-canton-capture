// Ciclo de vida de las actualizaciones de la PWA instalada.
//
// - El Service Worker nuevo se activa solo (`skipWaiting` + `clientsClaim`): es imprescindible para que las
//   instalaciones antiguas (v1.0.0 / v1.2.0), cuyo código nunca envía SKIP_WAITING, reciban la actualización.
// - Esta página NO se recarga sola en cualquier momento: espera a un momento seguro (sin captura en curso, sin
//   edición sin guardar, sin diálogo abierto, sin cámara del sistema abierta y sin documento procesándose).
// - Tras recargar se verifica que el identificador de compilación cambió de verdad.
// - IndexedDB nunca se toca: una actualización solo sustituye el código y la caché de archivos de la app.
import { registerSW } from 'virtual:pwa-register';
import { APP_BUILD, APP_BUILT_AT, APP_VERSION } from '../config/version';

export type UpdatePhase = 'unsupported' | 'checking' | 'current' | 'downloading' | 'ready' | 'applying' | 'offline' | 'error';
export interface ServerVersion { version: string; build: string; builtAt?: string }
export interface UpdateState {
  phase: UpdatePhase;
  /** por qué no se aplica todavía una versión lista */
  blockedBy?: string;
  lastCheck?: number;
  server?: ServerVersion;
  error?: string;
  /** resultado de la última actualización aplicada (verificado tras recargar) */
  outcome?: { ok: boolean; from: string; to: string };
}
export type SafetyProbe = (mode: 'auto' | 'manual') => { safe: boolean; reason?: string };

const PENDING_KEY = 'cx.update.pending';
const CHECK_THROTTLE_MS = 60_000;
const store = {
  get(): { fromBuild: string; fromVersion: string; at: number } | null { try { return JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null'); } catch { return null; } },
  set(v: unknown) { try { if (v) localStorage.setItem(PENDING_KEY, JSON.stringify(v)); else localStorage.removeItem(PENDING_KEY); } catch { /* sin almacenamiento */ } },
};

export class UpdateManager {
  state: UpdateState = { phase: 'unsupported' };
  private reg?: ServiceWorkerRegistration;
  private listeners = new Set<(s: UpdateState) => void>();
  private probe: SafetyProbe = () => ({ safe: true });
  private retryTimer?: ReturnType<typeof setInterval>;
  private applyTimer?: ReturnType<typeof setTimeout>;
  private lastCheckAt = 0;

  constructor(private opts: { checkEveryMs?: number; reload?: () => void; versionUrl?: string } = {}) {}

  get current() { return { version: APP_VERSION, build: APP_BUILD, builtAt: APP_BUILT_AT }; }

  onChange(fn: (s: UpdateState) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  setSafetyProbe(p: SafetyProbe) { this.probe = p; }
  private set(patch: Partial<UpdateState>) { this.state = { ...this.state, ...patch }; for (const l of this.listeners) l(this.state); }

  /** Verifica el resultado de una actualización previa (se llama al arrancar, antes de registrar el SW). */
  verifyPreviousUpdate(): UpdateState['outcome'] {
    const p = store.get();
    if (!p) return undefined;
    store.set(null);
    const outcome = { ok: p.fromBuild !== APP_BUILD, from: `${p.fromVersion} (${p.fromBuild})`, to: `${APP_VERSION} (${APP_BUILD})` };
    this.set({ outcome });
    return outcome;
  }

  start() {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    this.set({ phase: 'checking' });
    registerSW({
      immediate: true,
      // modo autoUpdate: el SW nuevo ya se activó; aquí solo decidimos CUÁNDO recargar esta página
      onNeedReload: () => this.markReady(),
      onRegisteredSW: (_url, reg) => { if (reg) this.attach(reg); },
      onRegisterError: (e) => this.set({ phase: 'error', error: `No se pudo registrar el servicio sin conexión: ${String(e)}` }),
    });
    // señal independiente de workbox-window: el SW nuevo tomó el control de esta página (versión antigua en memoria)
    // (el primer control tras la instalación inicial — clientsClaim — no es una actualización)
    let controller = navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      const prev = controller; controller = navigator.serviceWorker.controller;
      if (prev && controller && prev !== controller) this.markReady();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.check();
      else this.maybeApply('auto'); // al pasar a segundo plano (si es seguro) es el mejor momento para recargar
    });
    window.addEventListener('online', () => void this.check());
    setInterval(() => void this.check(), this.opts.checkEveryMs ?? 30 * 60_000);
  }

  private attach(reg: ServiceWorkerRegistration) {
    this.reg = reg;
    const follow = (w: ServiceWorker | null) => {
      if (!w) return;
      this.set({ phase: 'downloading', error: undefined });
      w.addEventListener('statechange', () => {
        // instalación interrumpida (red caída, almacenamiento lleno): el navegador la reintentará en la próxima comprobación
        if (w.state === 'redundant' && this.state.phase === 'downloading') {
          this.set({ phase: 'error', error: 'La descarga de la nueva versión se interrumpió. Se reintentará automáticamente.' });
          this.scheduleRetry();
        }
      });
    };
    if (reg.installing) follow(reg.installing);
    reg.addEventListener('updatefound', () => follow(reg.installing));
    // SW en espera heredado de una versión sin activación automática: se puede activar a mano
    if (reg.waiting && navigator.serviceWorker.controller) this.set({ phase: 'ready' });
    else if (this.state.phase === 'checking') this.set({ phase: 'current' });
    void this.check(true);
  }

  /** Busca una versión nueva (sw.js) y consulta `version.json` del servidor. No recarga nada. */
  async check(force = false): Promise<UpdateState> {
    if (!this.reg || this.state.phase === 'applying') return this.state;
    if (!force && Date.now() - this.lastCheckAt < CHECK_THROTTLE_MS) return this.state;
    this.lastCheckAt = Date.now();
    if (!navigator.onLine) { if (this.state.phase !== 'ready') this.set({ phase: 'offline' }); return this.state; }
    try {
      await this.reg.update();
      const server = await this.fetchServerVersion();
      // mientras se comprobaba pudo activarse la versión nueva: nunca se degrada «lista» o «aplicando»
      const now = this.state.phase as UpdatePhase; // puede haber cambiado durante el await
      if (now === 'ready' || now === 'applying') { this.set({ server, lastCheck: Date.now() }); return this.state; }
      const phase: UpdatePhase = this.reg.installing ? 'downloading' : this.reg.waiting ? 'ready' : server && server.build !== APP_BUILD ? 'downloading' : 'current';
      this.set({ phase, server, lastCheck: Date.now(), error: undefined });
      if (phase === 'ready') this.maybeApply('auto');
    } catch (e) {
      this.set({ phase: this.state.phase === 'ready' ? 'ready' : 'error', error: `No se pudo comprobar la actualización: ${(e as Error).message}`, lastCheck: Date.now() });
    }
    return this.state;
  }

  private async fetchServerVersion(): Promise<ServerVersion | undefined> {
    try {
      const url = this.opts.versionUrl ?? new URL(`version.json?t=${Date.now()}`, document.baseURI).href;
      const r = await fetch(url, { cache: 'no-store' });
      return r.ok ? ((await r.json()) as ServerVersion) : undefined;
    } catch { return undefined; }
  }

  private retryDelay = 15_000;
  private errorRetry?: ReturnType<typeof setTimeout>;
  /** Reintento automático tras una descarga interrumpida (15 s, luego hasta 5 min). */
  private scheduleRetry() {
    if (this.errorRetry) return;
    this.errorRetry = setTimeout(() => {
      this.errorRetry = undefined;
      if (this.state.phase !== 'error') return;
      void this.check(true).then((st) => { if (st.phase === 'error') this.scheduleRetry(); else this.retryDelay = 15_000; });
      this.retryDelay = Math.min(this.retryDelay * 2, 5 * 60_000);
    }, this.retryDelay);
  }

  /** Hay una versión nueva activa y esta página todavía ejecuta la anterior. */
  private markReady() {
    if (this.state.phase === 'applying') return;
    this.set({ phase: 'ready', error: undefined });
    this.maybeApply('auto');
  }

  /** Aplica la versión lista si el momento es seguro; si no, recuerda el motivo y reintenta en segundo plano. */
  maybeApply(mode: 'auto' | 'manual'): boolean {
    if (this.state.phase !== 'ready' && this.state.phase !== 'applying') return false;
    const p = this.probe(mode);
    if (!p.safe) {
      this.set({ blockedBy: p.reason });
      // reintento periódico: p. ej. al terminar el OCR o al guardar la captura
      if (!this.retryTimer) this.retryTimer = setInterval(() => this.maybeApply('auto'), 10_000);
      return false;
    }
    // el reintento se mantiene hasta que la recarga ocurra de verdad
    if (!this.retryTimer) this.retryTimer = setInterval(() => { if (this.state.phase === 'ready') this.maybeApply('auto'); }, 10_000);
    if (this.state.phase === 'applying' && this.applyTimer) return true;
    this.set({ phase: 'applying', blockedBy: undefined });
    // pequeño margen visible (y segunda comprobación de seguridad) antes de recargar con la app en primer plano
    const delay = mode === 'manual' || document.visibilityState === 'hidden' ? 0 : 2500;
    if (this.applyTimer) clearTimeout(this.applyTimer);
    this.applyTimer = setTimeout(() => {
      this.applyTimer = undefined;
      if (!this.probe(mode).safe) { this.set({ phase: 'ready' }); this.maybeApply('auto'); return; }
      if (this.retryTimer) { clearInterval(this.retryTimer); this.retryTimer = undefined; }
      store.set({ fromBuild: APP_BUILD, fromVersion: APP_VERSION, at: Date.now() });
      const reload = this.opts.reload ?? (() => window.location.reload());
      const waiting = this.reg?.waiting;
      if (!waiting) { reload(); return; }
      // SW heredado en espera (publicación sin activación automática): pedirle que se active y recargar
      // cuando ya controle la página (o a los 5 s), para no cargar otra vez la versión anterior
      let done = false;
      const go = () => { if (!done) { done = true; reload(); } };
      navigator.serviceWorker.addEventListener('controllerchange', go, { once: true });
      setTimeout(go, 5000);
      waiting.postMessage({ type: 'SKIP_WAITING' });
    }, delay);
    return true;
  }

  /** Información técnica verificable, sin datos personales (para soporte y validación en Android). */
  async diagnostics(extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const reg = this.reg ?? (await navigator.serviceWorker?.getRegistration().catch(() => undefined));
    let cachesInfo: Record<string, number> = {};
    try { for (const k of await caches.keys()) cachesInfo[k] = (await (await caches.open(k)).keys()).length; } catch { cachesInfo = {}; }
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    const persisted = await navigator.storage?.persisted?.().catch(() => undefined);
    const standalone = matchMedia?.('(display-mode: standalone)').matches;
    return {
      app: { version: APP_VERSION, build: APP_BUILD, builtAt: APP_BUILT_AT },
      origin: location.origin, scope: reg?.scope, standalone,
      serviceWorker: {
        controller: navigator.serviceWorker?.controller?.scriptURL ?? null,
        active: reg?.active?.state ?? null, waiting: reg?.waiting?.state ?? null, installing: reg?.installing?.state ?? null,
      },
      update: { phase: this.state.phase, blockedBy: this.state.blockedBy ?? null, server: this.state.server ?? null, lastCheck: this.state.lastCheck ? new Date(this.state.lastCheck).toISOString() : null, error: this.state.error ?? null },
      caches: cachesInfo,
      storage: { usageMb: est?.usage ? Math.round(est.usage / 1048576) : null, quotaMb: est?.quota ? Math.round(est.quota / 1048576) : null, persisted: persisted ?? null },
      userAgent: navigator.userAgent,
      ...extra,
    };
  }
}

export const PHASE_LABEL: Record<UpdatePhase, string> = {
  unsupported: 'No disponible en este navegador',
  checking: 'Comprobando…',
  current: 'Al día',
  downloading: 'Descargando nueva versión…',
  ready: 'Nueva versión lista',
  applying: 'Actualizando…',
  offline: 'Sin conexión: se comprobará al volver la red',
  error: 'Error de actualización',
};
