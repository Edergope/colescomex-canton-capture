// PANTALLA 10 — Ajustes: operador, cuenta, tema, conectividad, almacenamiento, rendimiento y cierre de sesión seguro.
import { h, toast, confirmSheet, liveUrlCount } from '../dom';
import { IS_PREVIEW } from '../../config/env';
import { icon } from '../icons';
import { appBar, kv, sectionCard, segmented } from '../components';
import { getThemePref, setThemePref, type ThemePref } from '../theme';
import { storagePressure } from '../../pipeline/resources';
import { APP_BUILD, APP_BUILT_AT, APP_VERSION } from '../../config/version';
import { PHASE_LABEL } from '../../pwa/update';
import { FEATURES } from '../features';
import type { Capture } from '../../domain/schema';
import type { Ctx } from '../views';

export async function settingsScreen(ctx: Ctx, all: Capture[]) {
  const u = ctx.user!;
  const sp = await storagePressure().catch(() => null);
  const persisted = ctx.info.storage?.persisted;
  const pending = all.filter((c) => c.sync_status !== 'CONFIRMADO').length;
  const g = ctx.app.governor;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { effectiveType?: string; saveData?: boolean } };
  const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;

  let theme = getThemePref();
  const themeBox = h('div');
  const drawTheme = () => themeBox.replaceChildren(segmented<ThemePref>('Tema', [['system', 'Sistema', 'monitor'], ['light', 'Claro', 'sun'], ['dark', 'Oscuro', 'moon']], theme,
    (v) => { theme = v; setThemePref(v); drawTheme(); }));
  drawTheme();

  return h('div', { class: 'screen has-nav', id: 'screen-settings' },
    appBar('Ajustes', { online: navigator.onLine }),
    h('main', { class: 'content' },
      sectionCard('set-operator', 'user', 'Operador', kv([
        ['Nombre', u.name], ['Código', u.id], ['Cuenta de Google', ctx.app.auth.mode === 'google' ? u.email : 'Modo de desarrollo (sin Google)'],
      ])),
      sectionCard('set-theme', 'sun', 'Apariencia', h('div', { class: 'stack' }, themeBox,
        h('p', { class: 'xs muted' }, '«Sistema» sigue el modo claro u oscuro del teléfono. Para exteriores con mucho sol, el modo claro ofrece más contraste.'))),
      sectionCard('set-conn', navigator.onLine ? 'wifi' : 'wifi-off', 'Conectividad', kv([
        ['Estado', navigator.onLine ? 'En línea' : 'Sin conexión: las capturas siguen funcionando'],
        ['Red', nav.connection?.effectiveType ? `${nav.connection.effectiveType}${nav.connection.saveData ? ' · ahorro de datos' : ''}` : undefined],
        ['Pendientes de enviar', String(pending)],
      ]), h('button', { class: 'btn sm', onClick: () => ctx.go({ name: 'sync' }) }, 'Sincronizar')),
      sectionCard('set-storage', 'database', 'Almacenamiento', h('div', { class: 'stack' },
        kv([
          ['Uso', sp ? `${sp.usageMb} de ${sp.quotaMb} MB (${Math.round(sp.ratio * 100)} %)` : undefined],
          ['Persistente', persisted === undefined ? undefined : persisted ? 'Sí, el navegador lo protege' : IS_PREVIEW ? 'No garantizado (vista previa de pruebas)' : 'No garantizado: instale la app'],
          ['Capturas en el teléfono', String(all.length)],
        ]),
        sp ? h('div', { class: 'meter', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(sp.ratio * 100)), 'aria-label': 'Almacenamiento usado' },
          h('span', { style: `width:${Math.min(100, Math.round(sp.ratio * 100))}%`, class: sp.ratio > 0.85 ? 'warn' : '' })) : null)),
      sectionCard('set-perf', 'gauge', 'Rendimiento', h('div', { class: 'stack' },
        kv([
          ['Perfil de memoria', g ? (g.profile === 'low' ? 'Bajo consumo (más estable)' : 'Estándar') : 'No aplica'],
          ['Motivo', g?.state.reason],
          ['Memoria del dispositivo', nav.deviceMemory ? `${nav.deviceMemory} GB` : undefined],
          ['Memoria de la app', heap ? `${Math.round(heap / 1048576)} MB` : undefined],
          ['Imágenes abiertas', String(liveUrlCount())],
          ['Motor de lectura', ctx.info.engineName],
        ]),
        g ? segmented<'standard' | 'low'>('Perfil de memoria', [['standard', 'Estándar'], ['low', 'Bajo consumo']], g.profile,
          async (v) => { await g.setProfile(v, 'elegido por el usuario'); toast(v === 'low' ? 'Modo de bajo consumo activado' : 'Modo estándar activado'); ctx.refresh(); }) : null)),
      FEATURES.documentTypes ? sectionCard('set-doctypes', 'file', 'Tipos de documento', h('p', { class: 'small muted' }, 'Vista previa interna. Solo «Tarjeta comercial» está disponible.')) : null,
      await driveLinksSection(ctx),
      updateSection(ctx),
      h('button', { class: 'btn danger block', id: 'btn-logout', onClick: async () => {
        const ok = await confirmSheet('Cerrar sesión', pending
          ? `Hay ${pending} captura(s) sin confirmar en Google. NO se borrarán: seguirán en este teléfono y se enviarán cuando vuelva a iniciar sesión.`
          : 'Sus capturas permanecen en este teléfono. Podrá volver a entrar con su cuenta.', 'Cerrar sesión', 'Cancelar', 'danger');
        if (!ok) return;
        await ctx.app.auth.signOut();
        ctx.setUser(null); ctx.replace({ name: 'login' });
      } }, icon('logout'), 'Cerrar sesión')),
    ctx.nav('settings'));
}

/** Versión instalada, estado de actualización y diagnóstico verificable (sin datos personales). */
function updateSection(ctx: Ctx) {
  const up = ctx.info.updater;
  const body = h('div', { class: 'stack' });
  const when = (iso: string) => (iso ? new Date(iso).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' }) : undefined);
  const draw = () => {
    const st = up?.state;
    const server = st?.server;
    body.replaceChildren(
      kv([
        ['Versión instalada', h('span', { id: 'app-version', 'data-build': APP_BUILD }, `${APP_VERSION} · compilación ${APP_BUILD}`)],
        ['Compilada', when(APP_BUILT_AT)],
        ['Publicada en el servidor', server ? `${server.version} · compilación ${server.build}` : undefined],
        ['Estado', st ? h('span', { id: 'update-phase', 'data-phase': st.phase }, PHASE_LABEL[st.phase], st.blockedBy ? ` (espera: ${st.blockedBy})` : '') : 'Sin servicio de actualización'],
        ['Última comprobación', st?.lastCheck ? new Date(st.lastCheck).toLocaleTimeString('es', { timeStyle: 'short' }) : undefined],
        ['Dirección', `${location.host}${location.pathname.replace(/index\.html$/, '')}`],
        ['Proyecto', 'COLESCOMEX · Feria de Cantón · Fase 2'],
      ]),
      st?.error ? h('p', { class: 'small', style: 'color:var(--err)' }, st.error) : '',
      h('div', { class: 'row' },
        h('button', { class: 'btn sm', type: 'button', id: 'btn-check-update', disabled: !up, onClick: async () => {
          toast('Buscando actualizaciones…');
          const r = await up!.check(true);
          toast(r.phase === 'ready' ? 'Hay una versión nueva lista.' : r.phase === 'downloading' ? 'Descargando la versión nueva…' : r.phase === 'offline' ? 'Sin conexión: no se pudo comprobar.' : r.phase === 'error' ? (r.error ?? 'Error') : 'Ya tiene la última versión.');
        } }, 'Buscar actualización'),
        st?.phase === 'ready' ? h('button', { class: 'btn sm primary', type: 'button', id: 'btn-apply-update', onClick: () => void ctx.applyUpdateNow() }, 'Actualizar ahora') : null,
        h('button', { class: 'btn sm ghost', type: 'button', id: 'btn-copy-diag', onClick: async () => {
          const all = await ctx.app.repo.list();
          // incluye el registro técnico de TODAS las capturas: estado, archivos y error real (sin datos de proveedores)
          const sync = await ctx.app.syncLedger(false);
          const extra = { captures: all.length, pendingSync: all.filter((c) => c.sync_status !== 'CONFIRMADO').length, user: ctx.user?.id, sync };
          const d = await (up?.diagnostics(extra) ?? Promise.resolve({ app: { version: APP_VERSION, build: APP_BUILD }, ...extra }));
          const text = JSON.stringify(d, null, 2);
          pre.textContent = text; det.open = true;
          try { await navigator.clipboard.writeText(text); toast('Diagnóstico copiado (sin datos personales)'); } catch { toast('Diagnóstico mostrado abajo'); }
        } }, 'Copiar diagnóstico')),
      det);
  };
  const pre = h('pre', { class: 'mono xs', id: 'diag-text', style: 'white-space:pre-wrap;margin:0' });
  const det = h('details', null, h('summary', { class: 'small strong' }, 'Diagnóstico técnico'), pre);
  draw();
  const off = up?.onChange(() => { if (!body.isConnected) { off?.(); return; } draw(); });
  return sectionCard('set-about', 'info', 'Versión y actualizaciones', body);
}

/**
 * Enlaces de Drive mal archivados por versiones anteriores (el enlace principal apuntaba al respaldo restringido).
 * En producción no se reparan solos: se muestran y el operador decide. La reparación no borra nada en Drive.
 */
async function driveLinksSection(ctx: Ctx) {
  const found = await ctx.app.findMisfiledLinks().catch(() => ({ captures: 0, evidences: 0, refs: [] as string[] }));
  if (!found.evidences) return null;
  return sectionCard('set-drive-links', 'alert', 'Enlaces de Drive por revisar', h('div', { class: 'stack' },
    h('p', { class: 'small' }, `${found.evidences} foto(s) de ${found.captures} captura(s) figuran en la carpeta del proveedor pero en realidad solo están en el respaldo restringido (defecto de una versión anterior).`),
    h('p', { class: 'xs muted' }, `Afectadas: ${found.refs.join(', ')}. La reparación no borra ningún archivo: vuelve a subir la foto a la carpeta del proveedor y corrige la fila de Sheets.`),
    h('button', { class: 'btn sm primary', id: 'btn-repair-links', onClick: async () => {
      const ok = await confirmSheet('Reparar enlaces de Drive', `Se volverán a subir ${found.evidences} foto(s) a la carpeta de su proveedor y se actualizará su fila. No se borra nada.`, 'Reparar');
      if (!ok) return;
      const n = await ctx.app.repairMisfiledLinks();
      toast(`${n} enlace(s) en reparación · se completará al sincronizar`);
      ctx.refresh();
    } }, 'Revisar y reparar')));
}
