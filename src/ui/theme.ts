// Tema: claro / oscuro / sistema. Preferencia por dispositivo (localStorage, tolerante a fallos).
export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'cx.theme';

export function getThemePref(): ThemePref {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; }
}
export function applyTheme(pref: ThemePref = getThemePref()) {
  const root = document.documentElement;
  if (pref === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', pref);
  const dark = pref === 'dark' || (pref === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d1626' : '#0f1b2d');
}
export function setThemePref(pref: ThemePref) {
  try { if (pref === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, pref); } catch { /* sin almacenamiento: solo esta sesión */ }
  applyTheme(pref);
}
export function watchSystemTheme() {
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (getThemePref() === 'system') applyTheme('system'); }); } catch { /* navegadores antiguos */ }
}
