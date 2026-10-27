// Versión visible de la app. El identificador de compilación (commit + fecha) lo inyecta Vite al compilar
// y se publica también en `version.json` para comprobar qué hay en el servidor frente a lo instalado.
declare const __APP_BUILD__: string | undefined;
declare const __APP_BUILT_AT__: string | undefined;

export const APP_VERSION = '1.2.3';
export const APP_BUILD: string = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 'dev';
export const APP_BUILT_AT: string = typeof __APP_BUILT_AT__ !== 'undefined' ? __APP_BUILT_AT__ : '';
