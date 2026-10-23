// PANTALLA 10 — Ajustes: operador, cuenta, tema, conectividad, almacenamiento, rendimiento y cierre de sesión seguro.
import { h, toast, confirmSheet, liveUrlCount } from '../dom';
import { icon } from '../icons';
import { appBar, kv, sectionCard, segmented } from '../components';
import { getThemePref, setThemePref, type ThemePref } from '../theme';
import { storagePressure } from '../../pipeline/resources';
import { APP_VERSION } from '../../config/version';
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
          ['Persistente', persisted === undefined ? undefined : persisted ? 'Sí, el navegador lo protege' : 'No garantizado: instale la app'],
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
      sectionCard('set-about', 'info', 'Acerca de', kv([
        ['Versión', APP_VERSION], ['Proyecto', 'COLESCOMEX · Feria de Cantón · Fase 2'],
      ])),
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
