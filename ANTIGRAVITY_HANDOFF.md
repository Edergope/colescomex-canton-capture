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
