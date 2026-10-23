# Auditoría PWA COLESCOMEX: la app instalada no se actualiza

| Dato | Valor |
|---|---|
| Rama | `fix/claude-pwa-update-audit`, creada desde `v1.2.0` (`6c0c9d0`, lo publicado hoy) |
| Fecha | 23-10-2026 |
| Traspaso a Antigravity | [ANTIGRAVITY_PWA_HANDOFF.md](ANTIGRAVITY_PWA_HANDOFF.md) |
| Ámbito | Sin cambios en `main`, `gh-pages` ni el checkout de Antigravity. Nada desplegado |

**Método:**

- los dos orígenes en vivo (solo lectura);
- el historial de `gh-pages`;
- el código de vite-plugin-pwa 2.0.0;
- metadatos de Drive (sin leer contenido personal);
- pruebas automatizadas que reproducen la actualización con los artefactos realmente publicados.

---

## A. Diagnóstico

### Causa comprobada

Las versiones publicadas generan un Service Worker que **solo se activa si la página se lo pide**. Ninguna versión publicada se lo pide nunca.

- **El Service Worker solo se activa con un mensaje.** `vite.config.ts` usa `registerType: 'autoUpdate'` con `injectRegister: false`. En vite-plugin-pwa 2.0.0, `skipWaiting` y `clientsClaim` solo se añaden si `injectRegister` es `auto`. Ver `node_modules/vite-plugin-pwa/dist/index.js:874`. Por eso el `sw.js` publicado (v1.0.0 y v1.2.0) solo contiene `message → SKIP_WAITING → skipWaiting()`.
- **La página nunca envía ese mensaje.** En modo `autoUpdate`, el cliente `registerSW` no envía `SKIP_WAITING`, porque espera que el SW se active solo. Ver `node_modules/vite-plugin-pwa/dist/client/build/register.js`. En la v1.2.0, `onNeedRefresh → updateSW(true)` no tiene efecto: ese callback no se invoca en `autoUpdate` y `updateSW()` no hace nada.
- **Resultado:**
  1. el teléfono descarga la versión nueva;
  2. queda en estado `waiting`;
  3. solo se activa cuando se cierran **todas** las ventanas del origen: la app en «Recientes» y las pestañas de Chrome.

  En Android eso casi nunca ocurre. Además afecta a **todas** las actualizaciones, incluidas las futuras desde la v1.2.0.

**Reproducción automatizada:** `node scripts/check-dist.mjs dist-update/A-v1.2.0` falla con «sw.js sin activación automática», y `e2e/pwa-update.spec.ts` reproduce la actualización con los artefactos publicados.

### Origen de la instalación del teléfono

Es un **indicio fuerte, no una prueba**; hay que confirmarlo en el teléfono (sección F).

- **Las carpetas de producción tienen el comportamiento de la v1.0.0.** En la carpeta de evidencias de **producción** (`1bqlJA…`) están `CF26F2-EDR-HDHG-0001` (22-10 15:55 UTC) y `-0002` (23-10 02:30 UTC). Contienen solo `_01_card_front.jpg`, sin `_scan` ni copia en ORIGINALES.
- **La hoja de producción se modificó a la vez.** La hoja `1UI5…` cambió a las 02:30:56 UTC.
- **La vista previa de Firebase no encaja.** Está en v1.1.0, usa **otra** hoja (`1XZIN…`, «Hoja de PRUEBA») y otras carpetas, y su Client ID de OAuth está vacío. Con esa configuración publicada no pudo crear esas filas. Además su nombre instalado es «CX PREVIEW».
- **Conclusión probable:** la app del teléfono es la **v1.0.0 instalada desde `https://edergope.github.io/colescomex-canton-capture/`**.
- **Lo que estos datos no demuestran:** que no exista además otra instalación, ni que el icono que usa el propietario sea ese.

### Diagnóstico de Antigravity

| Afirmación | Veredicto |
|---|---|
| Ciclo de vida del Service Worker | ✅ Correcto |
| `skipWaiting: true`, `clientsClaim: true` (commit local `15fe3b3`) | ✅ Necesario. Incluido con las mismas líneas |
| `controllerchange → location.reload()` incondicional (`15fe3b3`) | ❌ Peligroso: interrumpe la cámara, ediciones y OCR, y duplica la recarga de `registerSW`. **No desplegar** |
| `onNeedRefresh → updateSW(true)`, botón y `update()` cada 60 s (v1.2.0) | ⚠️ No activan nada; solo detectan |
| Defecto de Drive: búsqueda sin `'<carpeta>' in parents` (`6713478`, ya en v1.2.0) | ✅ Diagnóstico y corrección correctos. Probado además a través de `SyncEngine` (sección E) |

---

## B. Correcciones

### Actualización

| Archivo | Cambio |
|---|---|
| `vite.config.ts` | `workbox.skipWaiting`/`clientsClaim` (desactivables solo con `VITE_SW_NO_AUTOACTIVATE=1`, para la prueba de resiliencia). Identificador de compilación (`VITE_BUILD_ID` o commit) inyectado. `version.json` publicado fuera del precaché |
| `src/pwa/update.ts` (nuevo) | `UpdateManager`, descrito abajo |
| `src/pwa/safety.ts` (nuevo) | Función pura que decide si recargar es seguro. Bloquea con: cámara abierta, foto tomándose o guardándose, cámara del sistema o galería abiertas, edición sin guardar, diálogo abierto, OCR o escáner en curso, envío a Google |
| `src/ui/views.ts` | Usa la sonda; aviso no bloqueante «Nueva versión lista / Actualizar ahora»; aplica al navegar a una pantalla segura; notifica el resultado. **Corrige** `back()`, que podía salir de la app cuando arrancaba en la cámara con un borrador recuperado |
| `src/ui/screens/settings.ts` | «Versión y actualizaciones»: versión y compilación instaladas, compilación en el servidor, estado, dirección (origen), «Buscar actualización», «Actualizar ahora» y «Copiar diagnóstico» (sin datos personales) |
| `src/ui/screens/login.ts` | Versión y compilación visibles antes de iniciar sesión |
| `src/main.ts` | El SW se registra **antes** de abrir datos o interfaz. Si el arranque falla: «Reintentar» o «Buscar actualización», sin borrar nada |
| `src/ui/dom.ts`, `src/ui/screens/capture.ts` | Señales para la sonda: cámara del sistema abierta, disparo o guardado en curso |
| `src/pipeline/ocrQueue.ts`, `src/sync/SyncEngine.ts` | `get busy()` (solo lectura) |
| `src/config/version.ts`, `package.json` | 1.2.1 |

**`UpdateManager`:**

- sigue la descarga y detecta descargas interrumpidas;
- reintenta automáticamente (15 s, con espera creciente hasta 5 min);
- comprueba al volver a primer plano (como mucho una vez por minuto), al recuperar la red y cada 30 min;
- recarga **solo** en un momento seguro;
- verifica tras recargar que la compilación cambió;
- detecta la activación por dos vías (workbox-window y `controllerchange`), sin condiciones de carrera;
- activa también un SW «en espera» heredado: envía `SKIP_WAITING` y recarga solo cuando el SW nuevo ya controla la página (o a los 5 s). Probado con una compilación sin activación automática.

### Despliegue

| Archivo | Cambio |
|---|---|
| `scripts/lib/retain-assets.mjs` (nuevo) | Conserva **una versión** de los chunks y modelos anteriores que falten en la nueva. No crece, no pisa archivos nuevos, no toca `index.html` ni `sw.js` y no entra en el precaché |
| `scripts/deploy-pages.mjs` | Usa el módulo anterior. Mensaje de commit con versión y compilación |
| `scripts/check-dist.mjs` (nuevo), `npm run check:dist` | Ver abajo |

**`check:dist`** verifica antes de desplegar:

- `sw.js` con activación automática;
- cada entrada del precaché existe y su revisión es correcta;
- los 16 archivos OCR (71,6 MB) son idénticos al origen y están precacheados;
- no hay secretos, archivos `.env` ni archivos idénticos a fixtures privados.

### Drive y sincronización

| Archivo | Cambio |
|---|---|
| `src/adapters/google.ts` | Una respuesta de Drive sin `id` es **error**, no éxito |
| `src/storage/repo.ts`, `src/sync/SyncEngine.ts`, `src/app/service.ts` | Reparación **no destructiva** al arrancar (ver abajo) |
| `src/adapters/mock.ts` | El mock busca dentro de la carpeta, como Drive real |

**Reparación no destructiva:** se aplica a las evidencias cuyo enlace principal apunta al respaldo (`remote_file_id === archive_file_id`) o con `remote_target: 'archive'` heredado.

- El enlace pasa a figurar como respaldo y no se borra nada en Drive.
- La captura queda PENDIENTE y la siguiente sincronización completa la carpeta del proveedor y corrige la fila.
- Se audita como `DRIVE_LINK_REPAIRED`.

### Pruebas nuevas

| Archivo | Cobertura |
|---|---|
| `tests/drive-sync-regression.test.ts` | 9 casos |
| `tests/pwa-safety.test.ts` | 10 casos |
| `tests/retain-assets.test.ts` | 2 casos |
| `tests/support/fake-google.ts` | Emulador compartido |
| `e2e/pwa-update.spec.ts` | 7 escenarios |

---

## C. Validación

Las cifras exactas están en [Resultados](ANTIGRAVITY_PWA_HANDOFF.md#resultados).

| Escenario pedido | Prueba | Resultado |
|---|---|---|
| A. Versión antigua (v1.0.0 real) → corregida | `pwa-update`: «v1.0.0 instalada…» | ✅ |
| B. v1.2.0 real → corregida | `pwa-update`: «v1.2.0 publicada hoy…» | ✅ |
| C. Captura en curso: cámara | `pwa-update`: «actualizaciones siguientes…» | ✅ Sin recarga durante 12 s con la cámara abierta; se aplica al salir |
| C. Foto guardándose, cámara del sistema, diálogo, OCR, sincronización | `tests/pwa-safety.test.ts` | ✅ Unitarias; el OCR en curso también se ejercita en E2E (espera a que termine) |
| C. Edición sin guardar | `pwa-update`: «edición sin guardar…» | ✅ El texto escrito se conserva; se aplica tras guardar |
| D. Descarga interrumpida | `pwa-update`: «descarga interrumpida…» | ✅ Sigue en la versión operativa, informa y **reintenta sola** |
| E. Futuras actualizaciones | B1 → B2 en dos escenarios | ✅ Sin parche manual. Sin bucles: 15 s sin recarga ni descargas tras aplicar |
| F. Otro origen (Firebase) | `pwa-update`: «escenario F…» | ✅ Ver detalle abajo |
| Resiliencia: publicación futura **sin** activación automática | `pwa-update`: «resiliencia…» (compilada con `VITE_SW_NO_AUTOACTIVATE=1`, solo para la prueba) | ✅ La app 1.2.1 activa el SW en espera en un momento seguro y verifica la compilación |
| Sin descargas repetidas de modelos | Registro de peticiones del servidor | ✅ v1.2.0 → nueva: **0** descargas de modelos. v1.0.0 → nueva: solo `PP-LCNet_x1_0_doc_ori.onnx` (clasificador nuevo desde v1.1) |
| Retención de assets | `tests/retain-assets.test.ts` | ✅ Una versión, sin crecer y sin pisar archivos nuevos |
| Integridad OCR y artefactos | `npm run check:dist` | ✅ 27 entradas de precaché, 16 archivos OCR idénticos y sin secretos |

**Detalle del escenario F** (otro origen, simulado con otra dirección y puerto):

- sesión e IndexedDB no compartidas;
- publicar en GitHub Pages actualiza solo esa instalación;
- la otra sigue en B1 con sus datos.

**Datos comprobados en A y B.** Se leyó IndexedDB directamente, sin pasar por la app:

- SHA-256 de cada foto y del borrador;
- `capture_uuid`/`external_ref`;
- campo editado y bloqueado;
- estados de OCR y sincronización;
- auditoría y consecutivo (la siguiente captura es `…-0003`/`0004`, sin duplicados);
- la captura local-only de la v1.0 se sincroniza después sin duplicar la ya confirmada;
- el escáner y el OCR funcionan con el precaché nuevo.

---

## D. Seguridad de los datos

1. **Misma base, mismo esquema.** IndexedDB `colescomex-canton-capture`, versión de esquema **1**, idéntica desde la v1.0.0: no hay migración. Mismo origen y alcance (`/colescomex-canton-capture/`) y misma URL de `sw.js`: la app no se reinstala.
2. **Una actualización solo sustituye código y precaché** (Cache Storage). Ningún paso borra IndexedDB, almacenamiento ni cachés generales.
3. **La única recarga no controlada** es la de la propia v1.0.0, una vez, al activarse la versión nueva: es su código y no se puede cambiar.
   - Las fotos de su borrador ya están en IndexedDB y se recuperan (probado con el artefacto real).
   - Solo se perdería una foto **dentro de la cámara del sistema en ese instante**. Por eso el procedimiento pide actualizar en Inicio.
4. **A partir de la 1.2.1 nunca se recarga en un momento inseguro.** Si el arranque fallara, nada se borra y se puede buscar una corrección.
5. **Firebase y GitHub Pages son orígenes distintos:** almacenamiento, SW e instalación independientes. Nunca se accede al almacenamiento de otro origen.
   - Si hubiera que migrar, el procedimiento sería: exportar a un archivo local en la app de origen (función por implementar), importar en la de destino verificando SHA-256 y referencias, y mantener la de origen hasta comprobarlo.
   - Según el indicio de la sección A, no hace falta migrar.

---

## E. Google Drive

| Comprobación | Simulación (adaptadores reales + emulador) | Google real |
|---|---|---|
| Carpeta del proveedor recibe la evidencia correcta (procesada si el recorte es fiable; original si no) | ✅ | ⏳ Pendiente (Antigravity, recursos de QA) |
| El respaldo restringido recibe el original | ✅ | ⏳ |
| La misma evidencia en dos destinos = dos archivos independientes | ✅ | ⏳ |
| El procesado sustituye visualmente al original; el original queda para auditoría | ✅ | ⏳ |
| Los enlaces de Sheets corresponden a los archivos guardados | ✅ | ⏳ |
| Reintentos sin duplicados (fallo a mitad de la subida + reenvíos) | ✅ | ⏳ |
| Error remoto (503, 403 de Sheets, respuesta sin `id`) ≠ «Confirmado en Google» | ✅ | ⏳ |
| Reproducción del defecto antiguo y reparación no destructiva | ✅ | — |

Todas las pruebas recorren `SyncEngine.syncOne/syncAll` con `GoogleDriveAdapter` y `GoogleSheetsAdapter` reales sobre un emulador HTTP de Drive v3 y Sheets v4. **No se ejecutó nada contra Google real** en esta auditoría.

**HDHG-0001/0002** fueron sincronizadas por la v1.0.0, que no tenía respaldo, así que el defecto no las afecta.

---

## F. Dispositivo físico (pendiente: nada de esto se ha ejecutado)

### 1. Confirmar el origen (sin borrar nada)

- **Icono:** «**CX Capture**» = GitHub Pages; «**CX PREVIEW**» = Firebase.
- **Chrome:** ⋮ → Configuración → Configuración de sitios → Todos los sitios. Mire qué origen tiene datos (cientos de MB por los modelos): `edergope.github.io` o `colescomex-capture-preview.web.app`. **No pulse «Borrar».**

### 2. Antes de actualizar

Abra la app con Wi-Fi y pulse **Sincronizar**.

### 3. Actualizar

1. Quédese en **Inicio** de 1 a 2 minutos, sin capturar. La app se recarga sola una vez.
2. Si no cambia: ciérrela desde Recientes, cierre las pestañas de Chrome de ese sitio y reábrala.

### 4. Verificar

- **Ajustes → Versión y actualizaciones** muestra 1.2.1, la compilación igual a la de `…/version.json` y la dirección `edergope.github.io/colescomex-canton-capture/`.
- Las capturas HDHG-0001/0002 están en Proveedores.
- Una tarjeta nueva se recorta y se lee.
- Drive tiene `_scan.jpg` en la carpeta del proveedor y el original en ORIGINALES.
- Sheets actualiza la misma fila.
- Sin conexión, la app abre y lee una tarjeta.

---

## G. Despliegue

Ver [ANTIGRAVITY_PWA_HANDOFF.md](ANTIGRAVITY_PWA_HANDOFF.md): integración, conflicto con `15fe3b3`, pruebas, precauciones y reversión.

---

## H. Limitaciones y riesgos abiertos

1. **Sin validación física.** No se ha probado en Android físico, con WebAPK real, TalkBack ni red móvil. Chromium de escritorio con emulación no reproduce la gestión de procesos de Android.
2. **Recarga única de la v1.0.0.** No se puede controlar (sección D.3).
3. **Origen de instalación.** Deducido por indicios; confirmación pendiente (sección F.1).
4. **Google real.** La corrección de Drive y la reparación solo se probaron con emulador.
5. **Caché de GitHub Pages.** Sirve con `max-age=600`: la versión nueva puede tardar hasta 10 minutos en verse tras desplegar.
6. **Primer despliegue sin retención.** La v1.2.0 → 1.2.1 retendrá lo que la v1.2.0 tenía. La v1.0.0 ya no está en el servidor (no hubo retención en su momento), pero su página se recarga sola al activarse la nueva, así que no necesita sus chunks.
7. **Vista previa de Firebase.** Sigue en 1.1.0, sin el arreglo. Solo afecta a quien la tenga instalada.
8. **Sin exportación de respaldo.** No existe una función para exportar un respaldo local a archivo (necesaria solo para migrar entre orígenes).
