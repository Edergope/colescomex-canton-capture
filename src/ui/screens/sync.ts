// PANTALLA 9 — Sincronización: foto local · información extraída · Google confirmado, por separado.
import { h, toast } from '../dom';
import { SIMULATED_SYNC } from '../../config/env';
import { icon } from '../icons';
import { appBar, emptyState, notice } from '../components';
import { classifySyncError, type SyncProblem } from '../model';
import { storagePressure } from '../../pipeline/resources';
import { AuthRequiredError } from '../../adapters/contracts';
import type { Capture } from '../../domain/schema';
import type { Ctx } from '../views';
import { supplierCard } from './shared';

let lastReport: { at: number; text: string; tone: 'ok' | 'warn' | 'err' } | undefined;
let running = false;

export async function syncScreen(ctx: Ctx, all: Capture[]) {
  const total = all.length;
  const extracted = all.filter((c) => c.ocr_status === 'EXTRAIDO' || c.ocr_status === 'REQUIERE_REVISION').length;
  const reading = all.filter((c) => c.ocr_status === 'CAPTURADO' || c.ocr_status === 'PROCESANDO').length;
  const ocrFailed = all.filter((c) => c.ocr_status === 'ERROR').length;
  const confirmed = all.filter((c) => c.sync_status === 'CONFIRMADO').length;
  const uploading = all.filter((c) => c.sync_status === 'SINCRONIZANDO').length;
  const errors = all.filter((c) => c.sync_status === 'ERROR');
  const pending = all.filter((c) => c.sync_status !== 'CONFIRMADO');
  const sp = await storagePressure().catch(() => null);

  // agrupación de errores por causa: un mensaje específico por tipo, no un «error» genérico
  const groups = new Map<SyncProblem, { title: string; help: string; n: number }>();
  for (const c of errors) {
    const p = classifySyncError(c.sync_error);
    // con conexión recuperada, el error anterior por red se explica como intento fallido (no como estado actual)
    if (p.kind === 'offline' && navigator.onLine) Object.assign(p, { title: 'Falló por falta de conexión', help: 'Ya hay conexión: se reintentará solo, o pulse «Reintentar sincronización».' });
    const g = groups.get(p.kind) ?? { ...p, n: 0 }; g.n++; groups.set(p.kind, g);
  }
  if (!navigator.onLine && !groups.has('offline')) groups.set('offline', { ...classifySyncError('Sin conexión'), n: pending.length });

  const stage = (id: string, ic: string, title: string, big: string, detail: string, tone: '' | 'ok' | 'warn' | 'err' | 'info') =>
    h('div', { class: `track ${tone}`, 'data-stage': id, role: 'group', 'aria-label': `${title}: ${big}. ${detail}` },
      h('span', { class: 'label' }, title), h('span', { class: 'value', style: 'font-size:var(--t-xl)' }, icon(ic), big), h('span', { class: 'xs muted' }, detail));

  const btn: HTMLButtonElement = h('button', { class: 'btn primary lg block', id: 'btn-sync-now', disabled: running, 'aria-busy': running ? 'true' : undefined, onClick: async () => {
    if (running) return;
    running = true; btn.disabled = true; btn.replaceChildren(icon('loader'), 'Subiendo a Google…');
    try {
      const r = await ctx.app.syncNow(true);
      lastReport = r.offline ? { at: Date.now(), tone: 'warn', text: 'Sin conexión: no se envió nada. Todo sigue protegido en el teléfono.' }
        : r.authRequired ? { at: Date.now(), tone: 'err', text: 'La sesión de Google expiró. Vuelva a conectar la cuenta.' }
        : r.failed ? { at: Date.now(), tone: 'err', text: `${r.confirmed} confirmada(s) en Google, ${r.failed} con error.` }
        : { at: Date.now(), tone: 'ok', text: r.confirmed ? `${r.confirmed} captura(s) confirmadas en Google.` : 'No había nada pendiente de enviar.' };
      toast(lastReport.text);
    } catch (e) {
      lastReport = { at: Date.now(), tone: 'err', text: `No se pudo sincronizar: ${(e as Error).message}` };
      toast(lastReport.text, 6000);
    } finally { running = false; ctx.refresh(); }
  } }, running ? icon('loader') : icon('refresh'), running ? 'Subiendo a Google…' : 'Reintentar sincronización');

  const reconnect = async (b: HTMLButtonElement) => {
    b.disabled = true;
    try { await ctx.app.auth.signIn(ctx.user?.id); toast('Cuenta reconectada · sincronizando'); ctx.app.kickSync(); }
    catch (e) { toast(e instanceof AuthRequiredError ? 'No se pudo reconectar. Inténtelo con conexión.' : (e as Error).message, 6000); }
    finally { b.disabled = false; ctx.refresh(); }
  };

  return h('div', { class: 'screen has-nav', id: 'screen-sync' },
    appBar('Sincronización', { back: () => ctx.back(), online: navigator.onLine }),
    h('main', { class: 'content' },
      h('div', { class: 'tracks-3', id: 'sync-stages' },
        stage('photo', 'shield', 'Fotos', `${total}`, 'Protegidas en este dispositivo', total ? 'ok' : ''),
        stage('data', reading ? 'loader' : ocrFailed ? 'alert-circle' : 'check-circle', 'Información', `${extracted}/${total}`, [reading ? `${reading} en proceso` : '', ocrFailed ? `${ocrFailed} con fallo de lectura` : ''].filter(Boolean).join(' · ') || 'Datos extraídos', ocrFailed ? 'err' : reading ? 'info' : extracted ? 'ok' : ''),
        stage('google', uploading ? 'loader' : 'cloud-ok', SIMULATED_SYNC ? 'Google (simulado)' : 'Google', `${confirmed}/${total}`, uploading ? 'Subiendo a Google' : SIMULATED_SYNC ? 'Simulado' : 'Confirmado en Google', errors.length ? 'err' : confirmed === total && total ? 'ok' : 'info')),
      h('p', { class: 'xs muted' }, SIMULATED_SYNC ? 'Vista previa de pruebas: la sincronización es SIMULADA y nada se envía a Google.' : '«Confirmado en Google» indica que Drive y Sheets recibieron la captura. No significa que los datos estén verificados.'),
      ...[...groups.entries()].map(([kind, g]) => notice(kind === 'offline' ? 'warn' : 'err', kind === 'offline' ? 'wifi-off' : kind === 'auth' ? 'key' : kind === 'permission' ? 'lock' : 'alert-circle',
        g.title, h('p', null, `${g.help}${g.n ? ` (${g.n} captura${g.n === 1 ? '' : 's'})` : ''}`),
        kind === 'auth' ? [((): HTMLButtonElement => { const b: HTMLButtonElement = h('button', { class: 'btn sm primary', id: 'btn-reconnect', onClick: () => reconnect(b) }, icon('key', 'sm'), 'Reconectar Google'); return b; })()] : undefined,
        `sync-${kind}`)),
      ocrFailed ? notice('err', 'alert-circle', 'Fallo de lectura (OCR)', h('p', null, `${ocrFailed} captura(s) no se pudieron leer. Las fotos están intactas y se suben igualmente; puede reprocesarlas desde su ficha.`), [h('button', { class: 'btn sm', onClick: () => ctx.go({ name: 'list', filter: 'errors' }) }, 'Ver capturas')], 'sync-ocr') : null,
      sp && sp.ratio > 0.85 ? notice('warn', 'database', 'Almacenamiento insuficiente', h('p', null, `${sp.usageMb} de ${sp.quotaMb} MB usados. Sincronice cuanto antes; no desinstale la app.`), undefined, 'sync-storage') : null,
      lastReport ? notice(lastReport.tone, lastReport.tone === 'ok' ? 'cloud-ok' : 'info', 'Último intento', h('p', null, `${lastReport.text} · ${new Date(lastReport.at).toLocaleTimeString('es', { timeStyle: 'short' })}`), undefined, 'sync-report') : null,
      btn,
      h('p', { class: 'xs muted', style: 'text-align:center' }, 'Reintentar no crea registros nuevos: cada captura conserva su identificador y su fila.'),
      errors.length ? h('details', { id: 'sync-detail' }, h('summary', { class: 'small strong' }, `Detalle técnico por captura (${errors.length})`),
        h('p', { class: 'xs muted' }, 'Muestre esta lista (o «Ajustes → Copiar diagnóstico») al responsable técnico: no contiene datos de proveedores.'),
        h('ul', { class: 'mono xs', style: 'padding-left:1em;margin:0' }, ...errors.map((c) => h('li', { 'data-ref': c.external_ref },
          h('b', null, c.external_ref), ` · intento ${c.sync_attempts} · `, c.sync_error ?? 'sin detalle')))) : null,
      h('h2', { class: 'section-title' }, pending.length ? `Pendientes (${pending.length})` : 'Pendientes'),
      pending.length ? h('div', { class: 'list', id: 'sync-pending' }, ...pending.slice(0, 20).map((c) => supplierCard(ctx, c)),
        pending.length > 20 ? h('button', { class: 'btn ghost block', onClick: () => ctx.go({ name: 'list', filter: 'pending' }) }, `Ver las ${pending.length}`) : null)
        : emptyState('cloud-ok', SIMULATED_SYNC ? 'Todo sincronizado (simulado)' : 'Todo confirmado en Google', total ? 'No hay capturas pendientes de enviar.' : 'Aún no hay capturas.')),
    ctx.nav(null));
}
