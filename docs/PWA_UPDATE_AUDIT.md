# Auditoría: la app instalada no muestra la v1.2 — diagnóstico y corrección

- **Rama:** `fix/claude-pwa-update-audit`, creada desde `v1.2.0` (`6c0c9d0`, lo publicado). No toca `main` ni el checkout de Antigravity.
- **Fecha:** 23-10-2026.
- **Método:**
  - inspección de los dos orígenes en vivo (solo lectura);
  - historial de `gh-pages`;
  - metadatos de Drive (sin leer contenido personal);
  - código de vite-plugin-pwa 2.0.0;
  - pruebas automatizadas que reproducen la actualización en el mismo origen.

---

## A. Causa comprobada

**La app del teléfono ejecuta la v1.0.0 instalada desde GitHub Pages.** El Service Worker de las versiones publicadas no se activa solo, y el código de la página instalada nunca le pide que lo haga. Por eso la versión nueva se descarga, pero se queda «en espera» mientras la app siga abierta.

### Evidencias

| # | Hecho | Fuente |
|---|---|---|
| 1 | `gh-pages` anterior (`9945243`, 22-10 10:22 −05:00) contenía **v1.0.0**. Hoy (`d6d8cd3`, 23-10 04:00 −05:00) hay **v1.2.0**. El despliegue usa `push -f` sobre una rama huérfana | `git log` / `git show` |
| 2 | Las carpetas `CF26F2-EDR-HDHG-0001` (22-10 15:55 UTC) y `-0002` (23-10 02:30 UTC) están en la carpeta de evidencias de **producción** `1bqlJA…`. Contienen `_01_card_front.jpg`, sin `_scan` ni copia en ORIGINALES: es el comportamiento de la **v1.0.0** | Metadatos de Drive |
| 3 | La hoja de producción `1UI5…` se modificó a las 02:30:56 UTC, segundos después de crear la carpeta de la 0002 | Metadatos de Drive |
| 4 | La vista previa de Firebase usa **otra** hoja (`1XZIN…`, «Hoja de PRUEBA») y otras carpetas, tiene el Client ID de OAuth **vacío** y sigue en **v1.1.0**. No pudo producir esas filas | `main-*.js` publicado en `colescomex-capture-preview.web.app` |
| 5 | El `sw.js` publicado (v1.0.0 y v1.2.0) solo contiene `addEventListener("message", … SKIP_WAITING → skipWaiting())`: **no** hay `skipWaiting()` automático ni `clientsClaim()` | `sw.js` en vivo |
| 6 | vite-plugin-pwa 2.0.0 solo añade `skipWaiting`/`clientsClaim` si `injectRegister` es `auto`. El proyecto usa `injectRegister: false` | `node_modules/vite-plugin-pwa/dist/index.js:874` |
| 7 | En modo `autoUpdate`, el cliente `registerSW` **no envía nunca** `SKIP_WAITING`: espera que el SW se active solo y recarga en el evento `activated` | `node_modules/vite-plugin-pwa/dist/client/build/register.js` |

### Consecuencia

1. Al abrir la app, Chrome descarga el `sw.js` de la v1.2.0 y lo instala.
2. Queda en estado `waiting` hasta que se cierren **todos** los clientes del origen: la app en «Recientes» y cualquier pestaña de Chrome con `edergope.github.io`.
3. En Android eso casi nunca ocurre por sí solo, así que el teléfono sigue mostrando la v1.0.0.

### Primera instalación frente a actualización

La primera instalación sí funciona, porque no hay SW previo. El fallo afecta **a todas las actualizaciones**, incluidas las futuras desde la v1.2.0.

---

## B. Diagnóstico de Antigravity

| Afirmación | Veredicto |
|---|---|
| «Es el ciclo de vida del Service Worker» | ✅ Correcto. La causa exacta es el punto 6: `injectRegister: false` desactiva los valores automáticos del plugin |
| v1.2.0: `onNeedRefresh → updateSW(true)` | ❌ No tiene efecto. En modo `autoUpdate`, `onNeedRefresh` nunca se invoca y `updateSW()` no hace nada (`if (!auto) …`). Por eso la v1.2.0 publicada tampoco se actualizará a la siguiente |
| v1.2.0: `registration.update()` al volver a primer plano y cada 60 s | ⚠️ Detecta la versión nueva, pero no la activa (punto 5). Además, 60 s es una frecuencia innecesaria en datos móviles |
| v1.2.0: botón «Buscar actualización» | ⚠️ Solo llama a `update()`: misma limitación |
| Commit local **no publicado** `15fe3b3`: `skipWaiting: true`, `clientsClaim: true` | ✅ **Necesario** y suficiente para que la actualización **llegue** a la v1.0.0 del teléfono. Mantengo exactamente esas dos líneas |
| `15fe3b3`: `controllerchange → location.reload()` incondicional | ❌ **Peligroso**. Recarga en cualquier momento: cámara abierta, foto saliendo de la cámara del sistema, edición sin guardar, OCR en curso. Si es durante el OCR, el gobernador lo registra como cierre por memoria y pasa al perfil lento. También duplica la recarga que ya hace `registerSW` en `activated`. **No debe desplegarse.** En mi rama lo sustituye `UpdateManager` |
| Defecto de Drive: búsqueda por `evidence_id` sin `'<carpeta>' in parents` (`6713478`, ya en v1.2.0) | ✅ Diagnóstico correcto y corrección correcta (detalle abajo) |
| Prueba de regresión del adaptador en `15fe3b3` | ✅ Correcta. Mis pruebas cubren además el `SyncEngine` completo, la reparación y la fila de Sheets |

### Efecto del defecto de Drive

El `SyncEngine` sube **primero** el respaldo restringido y **después** la carpeta del proveedor.

Cuando una tarjeta no tiene recorte fiable (o con versiones antiguas), el original va a los dos destinos. Al subirlo a la carpeta principal, la búsqueda global encontraba la copia del respaldo y la daba por buena. Como resultado:

- la carpeta del proveedor se quedaba sin la tarjeta;
- Sheets enlazaba un archivo de la carpeta restringida;
- la captura se declaraba CONFIRMADA.

La prueba `defecto anterior` lo reproduce.

**Capturas HDHG-0001/0002:** fueron sincronizadas por la v1.0.0, que no tenía respaldo, así que **no están afectadas**.

---

## C. Cambios implementados (rama `fix/claude-pwa-update-audit`)

### Actualización segura

| Archivo | Cambio |
|---|---|
| `vite.config.ts` | `workbox.skipWaiting` y `clientsClaim` (las mismas líneas que `15fe3b3`). `version.json` publicado fuera del precaché. Identificador de compilación (`VITE_BUILD_ID` o commit) inyectado en la app |
| `src/pwa/update.ts` (nuevo) | `UpdateManager`, descrito abajo |
| `src/ui/views.ts` | Sonda de seguridad (ver abajo), aviso no bloqueante «Nueva versión lista» con «Actualizar ahora», aplicación al volver a Inicio y verificación tras recargar |
| `src/ui/screens/settings.ts` | «Versión y actualizaciones»: versión y compilación instaladas, versión publicada en el servidor, estado, última comprobación, dirección (origen), «Buscar actualización», «Actualizar ahora» y «Copiar diagnóstico» (JSON sin datos personales) |
| `src/ui/screens/login.ts` | Versión y compilación visibles antes de iniciar sesión |
| `src/main.ts` | El SW se registra **antes** de abrir datos o interfaz. Si el arranque falla, se muestra «Reintentar» o «Buscar actualización» y se avisa de que no se borró nada. Se eliminó el bloque `registerSW` sin efecto |
| `src/ui/dom.ts` | Detecta si la cámara del sistema o la galería están abiertas |
| `src/pipeline/ocrQueue.ts`, `src/sync/SyncEngine.ts` | Solo lectura: `get busy()` |
| `scripts/deploy-pages.mjs` | Retención de los assets con hash de la publicación anterior (una versión; no crece) y mensaje de commit con versión y compilación |
| `package.json`, `src/config/version.ts` | v1.2.1 |

**`UpdateManager`:**

- Sigue la descarga (`updatefound` y `statechange`) y detecta instalaciones interrumpidas.
- Comprueba al volver a primer plano (como mucho una vez por minuto), al recuperar la red y cada 30 min.
- Usa `onNeedReload` (no recarga a ciegas) y aplica la recarga solo cuando la sonda de seguridad lo permite.
- Reintenta cada 10 s.
- Recuerda la versión de origen y verifica tras recargar que la compilación cambió de verdad.
- Activa a mano un SW en espera heredado (`SKIP_WAITING`).

**Sonda de seguridad (`updateSafety`):** la recarga automática nunca ocurre si:

- la cámara está abierta;
- la cámara del sistema o la galería están abiertas;
- hay una edición sin guardar;
- hay un diálogo o el editor de esquinas abierto;
- el OCR está en curso;
- hay una sincronización en curso.

### Defectos encontrados por las pruebas de actualización (corregidos)

- **«Cerrar la cámara» podía salir de la app.** Ocurría cuando la app arrancaba directamente en la cámara (borrador recuperado, típico tras una actualización): llamaba a `history.back()`. Ahora la navegación hacia atrás nunca sale de la app (`src/ui/views.ts`).
- **Condición de carrera en `UpdateManager`.** Si la versión nueva se activaba durante una comprobación, el estado «aplicando» se sobrescribía y no se recargaba. Ahora:
  - el estado nunca se degrada;
  - `controllerchange` es una señal independiente;
  - el reintento se mantiene hasta que la recarga ocurre.
- **Página reclamada en la primera visita.** Si la página se reclamaba en la primera visita (`clientsClaim`), una actualización posterior a una descarga fallida no se detectaba: workbox-window no emite `activated` para ese SW «externo». Ahora se sigue el controlador de forma dinámica.
- **Reintento tras descarga interrumpida.** El mensaje decía «se reintentará automáticamente», pero no había reintento automático. Ahora se reintenta a los 15 s, con espera creciente hasta 5 min. Verificado tres veces seguidas.

### Drive y sincronización

| Archivo | Cambio |
|---|---|
| `src/adapters/google.ts` | Una respuesta de Drive sin `id` es un **error**, no un éxito. Antes se guardaba `remote_file_id: undefined` |
| `src/sync/SyncEngine.ts` + `src/storage/repo.ts` | `repairMisfiledEvidence()` (ver abajo) |
| `src/app/service.ts` | Ejecuta la reparación al arrancar |
| `src/adapters/mock.ts` | El mock de Drive busca dentro de la carpeta, igual que Drive real |

**`repairMisfiledEvidence()`** es una reparación **no destructiva**. Se aplica a las evidencias cuyo enlace principal apunta al respaldo (`remote_file_id === archive_file_id`) o con `remote_target: 'archive'` heredado:

- el enlace pasa a figurar como respaldo y no se borra nada en Drive;
- la captura queda PENDIENTE;
- la siguiente sincronización sube la tarjeta a la carpeta del proveedor y corrige la fila;
- se audita como `DRIVE_LINK_REPAIRED`.

### Pruebas

| Archivo | Cobertura |
|---|---|
| `tests/drive-sync-regression.test.ts` | 9 casos con los adaptadores Google reales contra el emulador (ver abajo) |
| `e2e/pwa-update.spec.ts` | 4 casos de actualización real en el mismo origen y ruta que GitHub Pages (ver abajo) |
| `tests/support/fake-google.ts` | Emulador compartido |

**`tests/drive-sync-regression.test.ts`:**

- destinos correctos con y sin recorte;
- la misma evidencia en dos carpetas;
- fila de Sheets = archivos reales;
- fallo a mitad de la subida → ERROR y reintento sin duplicados;
- Drive sin `id` → ERROR;
- Sheets 403 → ERROR;
- reproducción del defecto anterior;
- reparación no destructiva;
- `remote_target: 'archive'` heredado.

**`e2e/pwa-update.spec.ts`:**

- **v1.0.0 real → nueva:** se actualiza sola, sin reinstalar; datos idénticos byte a byte; borrador recuperado; numeración continua; escáner y OCR funcionan.
- **v1.2.0 real → nueva:** misma garantía.
- **Nueva → más nueva:** no recarga durante la captura y se aplica al volver.
- **Descarga interrumpida:** sigue en la versión actual y reintenta.

---

## D. Garantía de que no se pierde ninguna captura

1. **Mismo origen, misma base.** La app del teléfono y la versión nueva comparten origen (`https://edergope.github.io`) y alcance (`/colescomex-canton-capture/`). La base IndexedDB es `colescomex-canton-capture`, esquema versión 1, **sin cambios desde la v1.0.0**: no hay migración que pueda fallar.
2. **Una actualización no toca IndexedDB.** Solo sustituye el código y el precaché (Cache Storage). `cleanupOutdatedCaches` solo borra el precaché antiguo.
3. **El momento de la recarga.**
   - La v1.0.0 instalada recargará **una vez** al activarse el SW nuevo; es su propio código y no se puede cambiar.
   - Sus fotos de borrador se guardan en IndexedDB nada más tomarlas, así que se recuperan tras la recarga (verificado con el artefacto real).
   - Lo único que podría perderse es una foto que esté **en la cámara del sistema justo en ese instante**. Por eso el procedimiento pide actualizar en Inicio, sin capturar.
4. **Las versiones siguientes** no recargan nunca durante una captura (prueba automatizada).
5. **La prueba de la v1.0.0 real** compara SHA-256 de cada foto, el borrador, las correcciones humanas bloqueadas, el estado de sincronización, la auditoría y el consecutivo antes y después.
6. **Firebase y GitHub Pages son orígenes distintos.** IndexedDB, Service Worker e instalación son independientes. Actualizar uno no afecta al otro, y una app instalada desde Firebase **no** se convertiría en la de GitHub Pages. Como la del teléfono pertenece a GitHub Pages, **no hace falta migrar**.

> Si en algún momento hubiera que mover datos entre orígenes, el procedimiento sería:
>
> 1. exportar desde la app de origen a un archivo local (función por implementar);
> 2. importar en la de destino con verificación de SHA-256 y referencias;
> 3. dejar la de origen instalada hasta comprobarlo.
>
> Nunca se accede al almacenamiento de otro origen.

---

## E. Qué falta para actualizar el teléfono

1. **Antigravity** integra y despliega esta rama en GitHub Pages (sección F). Hasta entonces, la v1.2.0 publicada **tampoco** se activará sola.
2. **Antes de actualizar**, en el teléfono:
   1. Abra la app con Wi-Fi.
   2. Pulse **Sincronizar**.
   3. Compruebe que no quedan capturas pendientes (opcional, pero recomendable).
3. **Actualizar** (no capture durante estos pasos):
   1. Abra la app y quédese en **Inicio** de 1 a 2 minutos con Wi-Fi.
   2. La app se recargará sola **una vez**.
   3. Si tras 3 minutos no cambió:
      - cierre la app desde **Recientes** (deslizar);
      - cierre cualquier pestaña de Chrome con `edergope.github.io`;
      - vuelva a abrirla.
4. **Verificar:**
   - **Ajustes → Versión y actualizaciones** muestra **1.2.1** y la compilación publicada, que debe coincidir con `https://edergope.github.io/colescomex-canton-capture/version.json`.
   - En **Proveedores** siguen las capturas `CF26F2-EDR-HDHG-0001` y `-0002`.
   - Una captura de prueba se recorta y se lee.
   - En Drive aparecen `…_scan.jpg` en la carpeta del proveedor y el original en ORIGINALES.
   - En Sheets se actualiza la misma fila, sin duplicados.

**Identificación del origen en el teléfono** (no borra nada):

- El nombre bajo el icono es «**CX Capture**» si es producción y «**CX PREVIEW**» si es la vista previa.
- También se puede consultar en Chrome → ⋮ → Configuración → Configuración de sitios → Todos los sitios → `edergope.github.io`. Ahí se ven los datos almacenados. **No pulse «Borrar»**.

**Pruebas físicas:** ninguna prueba en Android físico se ha ejecutado ni se declara aprobada. Las pruebas automatizadas usan Chromium con los artefactos reales.

---

## F. Integración y despliegue (Antigravity)

1. **No desplegar `15fe3b3` tal cual.** Integrar esta rama sobre `main`. Al fusionar:
   - `vite.config.ts` coincide: las dos líneas son idénticas;
   - en `src/main.ts`, **quedarse con la versión de esta rama**, sin el bloque `controllerchange → reload`;
   - conservar su prueba de `tests/google-adapters.test.ts`.
2. Verificar:

   ```bash
   npm test && npm run build && npm run test:e2e && npm run check:private
   ```

   `e2e/pwa-update.spec.ts` necesita las etiquetas locales `deployed/v1.0.0` (`9945243`) y `deployed/v1.2.0` (`d6d8cd3`). Sin ellas, sus casos se omiten.
3. Desplegar con `npm run deploy`. El script conserva los assets de la versión anterior y crea `version.json` y `retained-assets.json`.
4. Tras desplegar, comprobar:
   - `version.json` en el servidor;
   - que `sw.js` contiene `self.skipWaiting()` y `clientsClaim()`, no solo el `message` de `SKIP_WAITING`.

   GitHub Pages sirve con `max-age=600`, así que puede tardar hasta 10 minutos en verse.
5. Vista previa de Firebase:
   - está en 1.1.0, con recursos aislados y sin Client ID;
   - actualizarla es opcional y no afecta al teléfono;
   - si se despliega, que sea con esta misma rama.
6. Ejecutar el procedimiento E en el teléfono y registrar el resultado.

---

## Resultados de verificación (23-10-2026, rama `fix/claude-pwa-update-audit`)

| Comando | Resultado |
|---|---|
| `npm test` | ✅ 135/135, incluidas las 9 de `tests/drive-sync-regression.test.ts` |
| `npm run build` | ✅. El `sw.js` generado contiene `self.skipWaiting(), e.clientsClaim()` |
| `npm run test:e2e` | ✅ 24/24 (detalle abajo) |
| `npm run check:private` | ✅ Sin datos reales |

Desglose de las 24 E2E:

| Archivo | Casos | Notas |
|---|---|---|
| `capture.spec.ts` | 5 | Con OCR real y la tarjeta real privada R1 |
| `ux.spec.ts` | 14 | |
| `camera-live.spec.ts` | 1 | |
| `pwa-update.spec.ts` | 4 | v1.0.0 real → nueva; v1.2.0 real → nueva; sin recarga durante la captura; descarga interrumpida con reintento automático |

**No ejecutado (pendiente de verificación física):**

- actualización en el Android real del propietario;
- WebAPK instalada;
- TalkBack;
- red móvil real.
