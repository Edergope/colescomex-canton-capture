// PANTALLA 1 — Acceso: solo las cuentas autorizadas y el estado de conexión. El mecanismo OAuth no cambia.
import { h, toast } from '../dom';
import { icon } from '../icons';
import { notice } from '../components';
import type { Ctx } from '../views';
import { NotAuthorizedError } from '../../adapters/contracts';

export function loginScreen(ctx: Ctx) {
  const users = ctx.app.auth.allowedUsers();
  const google = ctx.app.auth.mode === 'google';
  const signIn = async (id: string, btn: HTMLButtonElement) => {
    btn.disabled = true; btn.setAttribute('aria-busy', 'true');
    try {
      const u = await ctx.app.auth.signIn(id);
      ctx.setUser(u);
      ctx.replace({ name: 'home' });
      ctx.app.kickSync();
    } catch (e) {
      toast(e instanceof NotAuthorizedError ? (e as Error).message : `No se pudo iniciar sesión: ${(e as Error).message}`, 6000);
    } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
  };
  return h('main', { class: 'login', id: 'screen-login' },
    h('div', { class: 'brand' },
      h('div', { class: 'wordmark', 'aria-hidden': 'true' }, 'COLESCOMEX'),
      h('h1', null, 'Captura de proveedores', h('br'), 'Feria de Cantón · Fase 2'),
      h('p', null, google ? 'Inicie sesión con su cuenta de Google autorizada. Solo se necesita conexión la primera vez.' : 'Modo de desarrollo (sin Google). Cada operador usa su propio perfil.')),
    h('div', { class: 'accounts' },
      ctx.info.configProblems.length ? notice('err', 'alert-circle', 'Configuración incompleta', h('p', null, ctx.info.configProblems.join(' · '))) : null,
      ...users.map((u) => {
        const b: HTMLButtonElement = h('button', { class: 'account', 'data-user': u.id, onClick: () => signIn(u.id, b), 'aria-label': `Continuar como ${u.name}` },
          h('span', { class: 'avatar', 'aria-hidden': 'true' }, u.name.slice(0, 1)),
          h('span', null, h('span', { class: 'strong', style: 'display:block' }, `Soy ${u.name}`), h('span', { class: 'small', style: 'color:#d6deea' }, u.email ? maskEmail(u.email) : `Operador ${u.id}`)),
          icon(google ? 'key' : 'chevron'));
        return b;
      }),
      h('span', { class: 'net', role: 'status' }, icon(navigator.onLine ? 'wifi' : 'wifi-off', 'sm'), navigator.onLine ? 'Conectado' : 'Sin conexión: solo puede entrar si ya inició sesión en este teléfono')));
}

/** El correo se muestra parcialmente: basta para elegir la cuenta y no expone la dirección completa en pantalla. */
export function maskEmail(e: string): string {
  const [user, domain] = e.split('@');
  if (!domain) return e;
  return `${user.slice(0, 2)}${'•'.repeat(Math.max(2, Math.min(6, user.length - 2)))}@${domain}`;
}
