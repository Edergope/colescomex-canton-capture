# ANTIGRAVITY HANDOFF — COLESCOMEX Canton Fair Capture

Destinatario: Google Antigravity (integrador).
Objetivo: conectar autenticación, Drive y Sheets reales, desplegar la PWA y ejecutar las pruebas de extremo a extremo.

## 0. Qué recibes

- Núcleo funcional y probado: captura, IndexedDB, OCR en el navegador (PaddleOCR.js), parser, cola OCR persistente, motor de sincronización idempotente, UI móvil, PWA offline.
- Adaptadores Google **escritos pero NO verificados contra Google real**: [src/adapters/google.ts](src/adapters/google.ts). Solo se probaron contra un emulador local de las APIs ([tests/google-adapters.test.ts](tests/google-adapters.test.ts)).
- Contratos: [docs/INTEGRATION_CONTRACTS.md](docs/INTEGRATION_CONTRACTS.md). Variables: [docs/ENV_VARS.md](docs/ENV_VARS.md).

**No modifiques** `src/domain`, `src/extract`, `src/storage`, `src/pipeline`, `src/sync` para integrar Google. Si un adaptador real necesita cambiar, cambia solo `src/adapters/google.ts` y mantén la semántica de idempotencia del contrato.

No declares operativa la integración hasta completar el §6 con operaciones reales.

## 1. Preparar el entorno local

```bash
npm install
```

```bash
npm run setup:assets
```

```bash
npx playwright install chromium
```

```bash
npm test
```

```bash
npm run build && npm run test:e2e
```

Todo debe pasar antes de tocar Google (resultados de referencia en [docs/TEST_REPORT.md](docs/TEST_REPORT.md)).

## 2. Google Cloud

1. Crear (o reutilizar) un proyecto de Google Cloud de COLESCOMEX.
2. Habilitar **Google Drive API** y **Google Sheets API**.
3. Pantalla de consentimiento OAuth:
   - Si las cuentas de Eder y Héctor son de un Google Workspace propio: tipo **Internal**.
   - Si no: tipo **External** en modo **Testing**, añadiendo exactamente los correos de Eder y Héctor como *test users*. (Nadie más podrá autorizar la app.) En *Testing*, Google puede pedir de nuevo el consentimiento periódicamente; es aceptable para 2 usuarios.
   - Ámbitos: `openid`, `email`, `profile`, `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/spreadsheets`.
4. Crear credencial **OAuth client ID → Web application**:
   - *Authorized JavaScript origins*: la URL HTTPS de producción (§4) y `http://localhost:5173`.
   - No se necesitan *redirect URIs* (flujo de token con ventana emergente).
   - **No** descargar ni usar el `client_secret` en ningún sitio del frontend.

### Sobre el ámbito de Drive

El código usa `drive` (completo) porque escribe dentro de una carpeta **existente** (`EVIDENCIAS_FASE2`) que la app no creó. Alternativa más restrictiva si se prefiere: `drive.file` + que la app cree la carpeta `EVIDENCIAS_FASE2` en el primer uso (o que el usuario la elija una vez con Google Picker). Si cambias el ámbito, actualiza `GOOGLE_SCOPES` en `src/adapters/google.ts` y verifica que la búsqueda por `appProperties` sigue encontrando los archivos.

## 3. Drive y Sheets

1. Localizar o crear la carpeta `Colescomex/04_LIVE_OPERATIONS/03_SUPPLIERS/2026_CANTON_FAIR/EVIDENCIAS_FASE2` y copiar su ID (`.../folders/<ID>`).
2. Crear el Spreadsheet de Fase 2 (archivo **nuevo**, p. ej. `COLESCOMEX_Canton_Fair_Fase2_Captura`) con una pestaña `CAPTURA_FASE2`.
   - Opcional: pegar en la fila 1 las columnas comerciales en el orden de Fase 1 (ver contratos §3). Si la fila 1 está vacía, la app crea la cabecera en la primera sincronización.
   - **No** usar `COLESCOMEX_Canton_Fair_Fase1_Importacion`. Copiar su ID a `VITE_PHASE1_SPREADSHEET_ID` como salvaguarda.
3. Compartir carpeta y Spreadsheet **con permiso de edición solo** a las cuentas de Eder y Héctor (además del propietario). Esta es la restricción de acceso real.

## 4. Despliegue

Requisitos del hosting: HTTPS, servir `.wasm` con `Content-Type: application/wasm`, y que `sw.js` **no** se cachee de forma agresiva (`Cache-Control: no-cache` para `sw.js` e `index.html`). Opciones: Firebase Hosting, Cloudflare Pages, Netlify.

1. Variables de producción (en el hosting o en `.env.production.local`):

```
VITE_AUTH_MODE=google
VITE_SYNC_MODE=google
VITE_ALLOWED_USERS=EDR:Eder:<email de Eder>,HCT:Héctor:<email de Héctor>
VITE_GOOGLE_CLIENT_ID=<client id>
VITE_DRIVE_EVIDENCE_FOLDER_ID=<id carpeta EVIDENCIAS_FASE2>
VITE_SHEETS_SPREADSHEET_ID=<id spreadsheet Fase 2>
VITE_SHEETS_TAB_NAME=CAPTURA_FASE2
VITE_PHASE1_SPREADSHEET_ID=<id spreadsheet Fase 1>
VITE_OCR_ENGINE=paddle
```

2. Compilar y publicar la carpeta `dist/`:

```bash
npm run build
```

3. **No** añadir cabeceras COOP/COEP (`Cross-Origin-Opener-Policy: same-origin` rompe la ventana emergente de Google).
4. Accesibilidad desde China: Google (Drive, Sheets, OAuth) está bloqueado en China continental sin VPN/roaming internacional. La **captura y el OCR funcionan sin conexión**; la sincronización ocurrirá cuando el teléfono tenga salida a Google (roaming, eSIM internacional o VPN). Elegir un hosting accesible desde China para la carga inicial es deseable, pero la app debe instalarse **antes del viaje**.

## 5. Instalación en los teléfonos (antes del viaje)

1. En cada Android, abrir la URL en **Chrome** con Wi-Fi.
2. «Soy Eder» / «Soy Héctor» → iniciar sesión con la cuenta propia → aceptar permisos.
3. Menú ⋮ → **Instalar aplicación** / Añadir a pantalla de inicio.
4. Esperar ~1-2 min con la app abierta (descarga de ~61 MB: modelos OCR y runtime).
5. Verificación offline: modo avión → abrir la app instalada → registrar una tarjeta de prueba → debe guardarse y extraer datos sin red. Quitar el modo avión → «Sincronizar ahora» → `Confirmado en Google`.
6. Abrir `<url>/ocr-lab.html` y fotografiar 3-5 tarjetas reales para comprobar tiempos y precisión en ese teléfono concreto.

## 6. Pruebas de extremo a extremo con Google real (obligatorias)

Registrar PASS/FAIL de cada una en `docs/TEST_REPORT.md` (sección «Verificación Antigravity»).

| # | Prueba | Criterio PASS |
|---|---|---|
| G1 | Login Eder y login Héctor en dos teléfonos | Cada uno ve su nombre; una cuenta no autorizada recibe «no está autorizada» |
| G2 | Prueba A (frontal + reverso + stand), B (frontal), C (frontal + producto) capturadas seguidas | 3 carpetas en `EVIDENCIAS_FASE2` con 3, 1 y 2 archivos; 3 filas en `CAPTURA_FASE2`; `external_ref` distintos |
| G3 | Ambos capturan a la vez 3 proveedores cada uno | 6 filas, 6 carpetas, sin mezcla de fotos (cada archivo en la carpeta cuyo nombre coincide con su prefijo) |
| G4 | Sincronizar → modo avión en mitad de la subida → reconectar → sincronizar | Sin carpetas, archivos ni filas duplicadas; estado final `Confirmado en Google` |
| G5 | Editar un campo en el teléfono y sincronizar | Se actualiza la **misma** fila (mismo `capture_uuid`), sin fila nueva |
| G6 | Dejar expirar el token (>1 h) y sincronizar | Aparece «Reconectar Google»; tras reconectar, confirma sin pérdidas |
| G7 | Reprocesar OCR tras corregir un campo y sincronizar | El campo corregido no cambia en la fila |
| G8 | Revisar Fase 1 | `COLESCOMEX_Canton_Fair_Fase1_Importacion` sin cambios (fecha de última modificación) |
| G9 | Abrir un archivo de Drive | Es la foto original (resolución del teléfono) |
| G10 | Cerrar la app con capturas pendientes, reabrir | Las capturas siguen ahí y se sincronizan |

## 7. Puntos a vigilar

- Cuota de almacenamiento del navegador: la app solicita almacenamiento persistente; si el aviso amarillo aparece en inicio, instalar la PWA y sincronizar con frecuencia. Las fotos locales **no** se borran automáticamente tras confirmar (decisión conservadora). Si en el futuro se necesita liberar espacio, implementar un borrado manual solo de evidencias con `remote_file_id` confirmado.
- `navigator.deviceMemory ≤ 3` selecciona PP-OCRv6 tiny (más ligero, algo menos preciso).
- Si se cambia `VITE_ALLOWED_USERS[].id`, cambiaría el formato de `external_ref`: no hacerlo durante la feria.
- Tesseract.js no se precachea (motor alternativo). Si se elige `VITE_OCR_ENGINE=tesseract`, quitar `**/tesseract/**` de `globIgnores` en `vite.config.ts`.

---

# Versión 1.2 — Smart Document Scanner (rama `feat/smart-document-scanner`)

Detalle técnico y resultados: [docs/SMART_SCANNER.md](docs/SMART_SCANNER.md). Contratos: [docs/INTEGRATION_CONTRACTS.md §6](docs/INTEGRATION_CONTRACTS.md). Fixtures reales: [docs/PRIVATE_FIXTURES.md](docs/PRIVATE_FIXTURES.md).

Punto de restauración: tag `restore/pre-smart-scanner` (publicado en GitHub). La rama **no** está fusionada en `main` ni publicada en producción.

**No se modificaron** `src/adapters/google.ts`, las credenciales OAuth existentes, EDR/HCT, la carpeta `EVIDENCIAS_FASE2` ni el Spreadsheet de Fase 2.

## V0. Privacidad (obligatorio antes de cualquier push)

- Las fotos y datos reales de prueba están **fuera** del repositorio (`../colescomex-private-fixtures` o `CX_PRIVATE_DIR`). Respaldarlos en una carpeta restringida de Drive (`…/2026_CANTON_FAIR/QA_PRIVADO`).
- Antes de cada `git push`:
  ```bash
  npm run check:private
  ```
- Nunca usar `git add -A` con fotos de prueba en el árbol. Las salidas con datos reales se escriben solo en el directorio privado.

## V1. Comprobación local

```bash
git fetch origin && git checkout feat/smart-document-scanner
```

```bash
npm install && npm run setup:assets
```

`setup:assets` descarga ahora también `PP-LCNet_x1_0_doc_ori.onnx`.

```bash
npm test && npm run build && npm run test:e2e
```

```bash
npm run ocr:eval && npm run scanner:eval
```

Resultados de referencia en `docs/TEST_REPORT.md` (sección v1.2). Sin el directorio privado, las pruebas con R1 se **omiten**: no cuentan como PASS.

## V2. Respaldo restringido de originales (obligatorio)

1. Crear `Colescomex/04_LIVE_OPERATIONS/03_SUPPLIERS/2026_CANTON_FAIR/ORIGINALES_FASE2`. Debe ser distinta de `EVIDENCIAS_FASE2`.
2. Compartirla **solo** con Eder, Héctor y quien audite. Nada de «cualquier persona con el enlace».
3. Añadir `VITE_DRIVE_ORIGINALS_FOLDER_ID=<id>` a `.env.production.local`.

Sin esta variable, la app bloquea la sincronización y muestra el motivo.

## V3. Vista previa verdaderamente aislada

Una vista previa bajo `edergope.github.io/<otra-ruta>` compartiría origen (IndexedDB, caché, service worker) con producción. Por eso la vista previa se publica en **otro origen**, Cloudflare Pages (`https://<proyecto>.pages.dev`), con la **instancia `preview`**. Eso supone:
- base de datos local propia;
- franja roja «VISTA PREVIA»;
- bloqueo de los recursos de producción en la app y en el script.

1. Crear recursos de **prueba**: una copia vacía del Spreadsheet de Fase 2 con la pestaña `CAPTURA_FASE2_PRUEBA`, una carpeta `EVIDENCIAS_PRUEBA` y una carpeta `ORIGINALES_PRUEBA`.
2. OAuth: crear un **cliente OAuth de prueba** (tipo Web) en el mismo proyecto de Google Cloud, con el origen autorizado `https://<proyecto>.pages.dev` y `https://preview.<proyecto>.pages.dev`. Así no se toca el cliente de producción. Si se prefiere reutilizar el de producción, añadir esos orígenes requiere la aprobación de Eder.
3. Copiar `.env.preview.example` → `.env.preview.local` (no se versiona) con:
   - los IDs de **prueba**;
   - el cliente de prueba;
   - los IDs de **producción** en `VITE_PRODUCTION_*`, para que queden bloqueados.
4. Iniciar sesión en Cloudflare con la cuenta de COLESCOMEX:
   ```bash
   npx wrangler@4 login
   ```
5. Verificar el build sin publicar:
   ```bash
   node scripts/deploy-preview.mjs --dry-run
   ```
6. Publicar:
   ```bash
   node scripts/deploy-preview.mjs
   ```

El script se niega a publicar en `*.github.io` o contra recursos de producción, no toca git ni GitHub Pages, y ejecuta las pruebas antes de publicar.

## V4. Validación en los teléfonos Android (vista previa)

| # | Prueba | Criterio PASS |
|---|---|---|
| D1/D2 | `…pages.dev/ocr-lab.html` en el Android de Eder y en el de Héctor, con 5 tarjetas reales en distintas orientaciones (vertical, horizontal, al revés, en la mano, sobre la mesa) | Recorte correcto y texto derecho. Anotar los tiempos por etapa, `navigator.deviceMemory` y si la pestaña se recarga sola |
| D3 | 10 capturas seguidas (anverso + reverso), sin esperar | Sin cierres de la pestaña. Si hay alguno: aviso «Modo de bajo consumo» al reabrir y la captura se completa sola |
| D4 | En un teléfono de ≤ 4 GB (o tras un cierre) aparece el aviso «Modo de bajo consumo de memoria»: repetir D3 y comparar los tiempos con el modo estándar (botón «Usar modo estándar») | En modo bajo, más lento pero sin cierres |
| S1 | 3 proveedores seguidos con tarjetas giradas | «Guardar y siguiente» inmediato; las 3 terminan en «Datos extraídos» o «Requiere revisión» |
| S2 | Carpeta de cada proveedor en `EVIDENCIAS_PRUEBA` | Solo `…_card_front_scan.jpg` / `…_card_back_scan.jpg` (tarjetas limpias) más stand y producto |
| S3 | `ORIGINALES_PRUEBA` | Todos los originales de tarjeta, en subcarpetas `<ref>`; permisos restringidos |
| S4 | Fila en `CAPTURA_FASE2_PRUEBA` | Una por proveedor; `ocr_extras` al final; las 29 columnas comerciales intactas; `evidence_files` con `[escaneada]` y `[original, respaldo restringido]` |
| S5 | Foto con dos tarjetas o con la tarjeta cortada | «Requiere revisión»; «Ajustar esquinas» → reprocesa y sube la versión recortada |
| S6 | Modo avión: 2 capturas | Recorte y OCR sin red; se sincronizan al volver la conexión |
| S7 | Lista de productos con palabras pegadas | Campo marcado «⚠ revisar» con el motivo; tocar la sugerencia la aplica; tras guardar, queda bloqueada |
| S8 | Producción | La app de producción y sus capturas siguen intactas: la vista previa no las ve |

## V5. Reproceso de `CF26F2-EDR-HDHG-0001` (después de V6, en producción)

La vista previa aislada **no** ve las capturas del teléfono de Eder, y es lo correcto. El registro y sus originales están en el IndexedDB de producción de ese teléfono, así que el reproceso se hace **en producción una vez promovida la versión**:

1. Antes, anotar:
   - los archivos de la carpeta del proveedor (originales `_01_card_front.jpg` / `_02_card_back.jpg`);
   - el número de fila y el total de filas de `CAPTURA_FASE2`;
   - la fecha de modificación de Fase 1.
2. En el teléfono de Eder: Capturas → `CF26F2-EDR-HDHG-0001` → «Reprocesar OCR». Esperar a que termine.
3. Verificar en la ficha:
   - «Frontal: Recortada y enderezada ↻ 90°» y «Reverso: … ↻ 270°»;
   - los campos contra `cases.json` del directorio privado (16 de 17 deben coincidir);
   - Productos principales marcado «⚠ revisar», con la sugerencia de separación. Aceptarla si coincide con la tarjeta y guardar: queda como corrección humana.
4. «Sincronizar». Debe quedar «Confirmado en Google».
5. Comprobar:
   - **dos archivos nuevos** `_scan` en la misma carpeta, con los originales intactos;
   - **copias de los originales** en `ORIGINALES_FASE2/CF26F2-EDR-HDHG-0001`;
   - **la misma fila** actualizada, con el mismo total de filas;
   - Fase 1 sin cambios;
   - «Trazabilidad» con `OCR_RESULT_SUPERSEDED` (OCR anterior conservado) y `SCAN_PROCESSED`.
6. Repetir «Sincronizar»: no debe aparecer nada nuevo.

Si el teléfono ya no tuviera el registro, **no** reconstruirlo a mano. Avisar: haría falta una función de «recuperar captura desde Drive», que no forma parte de esta entrega.

## V6. Promoción a producción (solo con V1–V4 en PASS y aprobación de Eder)

1. PR `feat/smart-document-scanner` → `main`, revisado.
2. Repetir V1 sobre `main`, y `npm run check:private`.
3. Configurar V2 en `.env.production.local`.
4. Publicar:
   ```bash
   node scripts/deploy-pages.mjs
   ```
   Advertencia: este script hace `git add/commit/push` de `main`; ejecutarlo con el árbol limpio y tras `check:private`.
5. En cada teléfono, abrir la app con Wi-Fi para descargar el nuevo precache (~68 MB).
6. Ejecutar V5.

**Marcha atrás:**

```bash
git checkout restore/pre-smart-scanner && node scripts/deploy-pages.mjs
```

Los datos locales se conservan: el esquema de IndexedDB no cambió de versión. La v1.0 no distingue original y procesada, así que subiría a la carpeta del proveedor las evidencias pendientes (incluidas fotos con manos). No borra nada.
