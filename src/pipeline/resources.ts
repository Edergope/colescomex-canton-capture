// Gobernador de recursos para teléfonos Android: evita que el escáner y PaddleOCR agoten la memoria a la vez
// y recupera el procesamiento si el sistema cierra la pestaña.
//
// - Perfil `standard` / `low` (≤ 4 GB de RAM, o tras detectar una caída durante una tarea pesada).
// - Perfil `low`: alternancia estricta — el Worker del escáner se termina antes del OCR y PaddleOCR se libera
//   antes de escanear (nunca residen ambos en memoria).
// - Marcador de "tarea pesada en curso" persistido en IndexedDB: si al abrir la app sigue presente, la pestaña
//   murió durante el proceso (típicamente por memoria) → se pasa a `low` y se registra la incidencia.
// - Degradación por intentos de una misma captura: 1 normal · 2 resolución reducida · ≥3 sin escáner
//   (OCR sobre la foto original), para no entrar en un bucle de caídas con la misma foto.
// - Liberación de PaddleOCR tras inactividad y vigilancia de tiempo de cada etapa.
import type { CaptureRepo } from '../storage/repo';

export type ResourceProfile = 'standard' | 'low';
export type ProcessingMode = 'normal' | 'reduced' | 'minimal';

export interface HeavyTaskMarker { capture_uuid: string; stage: 'scan' | 'ocr'; at: string; profile: ResourceProfile }
export interface ResourceState { profile: ResourceProfile; reason: string; crashes: number; updated_at: string }

export interface GovernorOptions {
  deviceMemoryGb?: number;
  /** liberar PaddleOCR tras este tiempo sin trabajo (ms) */
  idleReleaseMs?: { standard: number; low: number };
  /** tiempo máximo por etapa antes de abortar (ms) */
  stageTimeoutMs?: { scan: number; ocr: number };
  now?: () => Date;
}

const META_STATE = 'resources:state';
const META_HEAVY = 'resources:heavy_task';

export class ResourceGovernor {
  state: ResourceState;
  readonly opts: Required<Omit<GovernorOptions, 'deviceMemoryGb' | 'now'>> & Pick<GovernorOptions, 'deviceMemoryGb' | 'now'>;
  /** marcador encontrado al arrancar (la pestaña se cerró durante una tarea pesada) */
  recoveredFrom?: HeavyTaskMarker;

  private constructor(private repo: CaptureRepo, state: ResourceState, opts: GovernorOptions) {
    this.state = state;
    this.opts = {
      idleReleaseMs: opts.idleReleaseMs ?? { standard: 120_000, low: 10_000 },
      stageTimeoutMs: opts.stageTimeoutMs ?? { scan: 90_000, ocr: 180_000 },
      deviceMemoryGb: opts.deviceMemoryGb, now: opts.now,
    };
  }

  static async create(repo: CaptureRepo, opts: GovernorOptions = {}): Promise<ResourceGovernor> {
    const now = (opts.now ?? (() => new Date()))().toISOString();
    const saved = await repo.getMeta<ResourceState>(META_STATE);
    const mem = opts.deviceMemoryGb ?? (typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined);
    const state: ResourceState = saved ?? { profile: mem !== undefined && mem <= 4 ? 'low' : 'standard', reason: mem !== undefined ? `memoria del dispositivo: ${mem} GB` : 'por defecto', crashes: 0, updated_at: now };
    const g = new ResourceGovernor(repo, state, opts);
    const marker = await repo.getMeta<HeavyTaskMarker>(META_HEAVY);
    if (marker) {
      // La app se cerró en mitad de una tarea pesada: probable falta de memoria.
      g.recoveredFrom = marker;
      g.state = { profile: 'low', reason: `interrupción durante ${marker.stage === 'scan' ? 'el escaneo' : 'el OCR'} (${marker.at})`, crashes: state.crashes + 1, updated_at: now };
      await repo.setMeta(META_HEAVY, null);
      await repo.addAudit({ capture_uuid: marker.capture_uuid, actor: 'system', type: 'PROCESS_INTERRUPTED', detail: marker });
    }
    await repo.setMeta(META_STATE, g.state);
    return g;
  }

  get profile(): ResourceProfile { return this.state.profile; }
  /** alternancia estricta escáner ↔ OCR */
  get exclusive(): boolean { return this.state.profile === 'low'; }
  get idleReleaseMs(): number { return this.opts.idleReleaseMs[this.state.profile]; }

  /** Modo de procesamiento según el número de intento de la captura (y el perfil). */
  modeFor(attempt: number): ProcessingMode {
    if (attempt >= 3) return 'minimal';
    if (attempt === 2 || this.state.profile === 'low') return 'reduced';
    return 'normal';
  }

  async begin(capture_uuid: string, stage: HeavyTaskMarker['stage']): Promise<void> {
    await this.repo.setMeta(META_HEAVY, { capture_uuid, stage, at: (this.opts.now ?? (() => new Date()))().toISOString(), profile: this.state.profile } satisfies HeavyTaskMarker);
  }
  async end(): Promise<void> { await this.repo.setMeta(META_HEAVY, null); }

  /** Ejecuta una etapa con vigilancia de tiempo; al vencer, `onTimeout` libera el recurso (p. ej. termina el Worker). */
  async guard<T>(stage: 'scan' | 'ocr', fn: () => Promise<T>, onTimeout: () => void): Promise<T> {
    const ms = this.opts.stageTimeoutMs[stage];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([fn(), new Promise<never>((_, rej) => { timer = setTimeout(() => { onTimeout(); rej(new Error(`La etapa de ${stage === 'scan' ? 'escaneo' : 'OCR'} superó ${Math.round(ms / 1000)} s; se liberaron los recursos`)); }, ms); })]);
    } finally { if (timer) clearTimeout(timer); }
  }

  /** El usuario puede volver al perfil estándar (p. ej. tras cerrar otras apps). */
  async setProfile(profile: ResourceProfile, reason: string): Promise<void> {
    this.state = { ...this.state, profile, reason, updated_at: (this.opts.now ?? (() => new Date()))().toISOString() };
    await this.repo.setMeta(META_STATE, this.state);
  }
}

/** Parámetros de cada modo: resolución de decodificación del escáner y de la entrada OCR. */
export const MODE_PARAMS: Record<ProcessingMode, { scanner: boolean; fullSide?: number }> = {
  normal: { scanner: true },
  reduced: { scanner: true, fullSide: 2400 },
  minimal: { scanner: false },
};

/** Espacio de almacenamiento del navegador casi lleno (las fotos se guardan localmente). */
export async function storagePressure(): Promise<{ ratio: number; usageMb: number; quotaMb: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  if (!e.quota) return null;
  return { ratio: (e.usage ?? 0) / e.quota, usageMb: Math.round((e.usage ?? 0) / 1048576), quotaMb: Math.round(e.quota / 1048576) };
}
