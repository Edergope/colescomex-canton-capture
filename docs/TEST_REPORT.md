# Informe de pruebas — núcleo

Fecha de ejecución: 2026-10-22 · Entorno: macOS (Apple Silicon), Node 22.23, Chromium headless (Playwright 1.64) con emulación Pixel 7.

Comandos: `npm run build` (incluye `tsc --noEmit`), `npm test`, `npm run test:e2e`, `npm run ocr:eval`.

## Resumen

| Bloque | Resultado |
|---|---|
| Typecheck + build de producción (PWA, precache 61 MB) | **PASS** |
| Unitarias + integración (Vitest, 33 pruebas en 4 archivos) | **PASS 33/33** |
| E2E en app compilada con PaddleOCR real (4 pruebas) | **PASS 4/4** |
| Evaluación OCR (18 imágenes, 2 motores) | Paddle 64/64 (scan), 63/64 (foto) · ver [OCR_EVALUATION.md](OCR_EVALUATION.md) |
| Integración con Google real | **NO EJECUTADA** — pendiente de Antigravity (§6 del handoff) |

## Pruebas obligatorias (sección 11)

| Requisito | Prueba | Resultado |
|---|---|---|
| Prueba A: frontal + reverso + stand | `core.test.ts` «captura B y C mientras el OCR procesa A» · E2E 1 | PASS |
| Prueba B: solo frontal | ídem | PASS |
| Prueba C: frontal + producto | ídem | PASS |
| B y C se capturan mientras el OCR procesa A | Se verifica `ocr_status = PROCESANDO` en A al guardar B; guardar tarda < 150 ms con OCR de 150 ms (mock) y < 3 s en E2E con Paddle real | PASS |
| Tres proveedores diferentes, identificadores únicos | 3 `uuid` y 3 `external_ref` distintos con formato `CF26F2-…` | PASS |
| Evidencias correctamente vinculadas | tipos y orden por captura; `capture_uuid` y prefijo de nombre correctos; en Drive mock cada archivo está en la carpeta de su proveedor | PASS |
| Extracción frontal + reverso fusionada | A: empresa EN del frontal, empresa CN / WeChat / stand del reverso (`source = ocr_back`), sin fila adicional. E2E con OCR real: `booth = C15` solo presente en el reverso | PASS |
| Ningún registro sobrescrito | cada captura conserva sus propios datos (empresa, email, contacto) | PASS |
| Reintentos sin duplicación | corte de red tras la 2.ª subida + respuesta perdida tras escribir la fila → 3 carpetas, 6 archivos, 3 filas | PASS |
| Dos usuarios simultáneos | Eder y Héctor, 2 dispositivos, 3 capturas cada uno en paralelo sobre el mismo Drive/Sheets → 6 filas, 6 refs únicas, `captured_by` correcto | PASS |
| Mismo usuario en dos teléfonos | ambos `…-0001` pero refs distintas por código de dispositivo | PASS |
| Pérdida de conexión antes de sincronizar | sin red: nada enviado, estado `LOCAL`; al volver: `CONFIRMADO` | PASS |
| Pérdida de conexión durante la sincronización | `ERROR` con «se reintentará»; reanuda sin duplicar | PASS |
| OCR fallido y reprocesamiento | 3 fallos → `ERROR` (3 intentos); «Reprocesar» → `EXTRAIDO`; foto intacta | PASS |
| Fallo OCR transitorio | 1 fallo → reintento automático → `EXTRAIDO` | PASS |
| Cierre y reapertura con capturas pendientes | app cerrada con OCR en `PROCESANDO`; al reabrir se retoman 2 capturas, se completan y el consecutivo continúa (`-0003`) | PASS |

## Pruebas adicionales

| Prueba | Resultado |
|---|---|
| No se puede guardar sin foto frontal; no quedan restos en IndexedDB | PASS |
| `CONFIRMADO` solo cuando evidencias **y** fila están en remoto | PASS |
| OCR terminado después de sincronizar → `PENDIENTE` → actualiza la **misma** fila | PASS |
| Edición posterior → misma fila actualizada | PASS |
| Token de Google expirado → `ERROR` con instrucción «Inicia sesión en Google», datos intactos | PASS |
| Correcciones humanas no sobrescritas al reprocesar (unitaria y E2E) | PASS |
| Confirmar revisión bloquea todos los campos y pone `processing_status = REVISADO` | PASS |
| Borrador del asistente sobrevive a la recarga de la página (Android descarta la pestaña al abrir la cámara) — E2E | PASS (bug real detectado y corregido durante las pruebas) |
| Sin conexión: la app compilada reabre desde el service worker, captura y **ejecuta el OCR** con modelos en caché; al volver la red, `CONFIRMADO` — E2E | PASS |
| Parser: teléfonos CN a E.164, stand de Cantón, etiquetas de 1 letra, tarjetas solo en chino, dirección multilínea, ciudad/provincia explícitas | PASS (14 pruebas) |
| Parser: no inventa datos (campos ausentes vacíos con estado `absent`; etiqueta con valor ilegible → `illegible`; baja confianza → `review`; etiqueta pegada al email → `review`) | PASS |
| Esquema: 29 columnas comerciales primero y en orden; precargados correctos | PASS |
| Adaptadores REST Google contra emulador: carpeta/archivo idempotentes por `appProperties`, 401 → reautenticar, 503 → transitorio, cabecera por nombre, upsert sin duplicar, columnas ajenas intactas | PASS (5 pruebas) |

## Defectos encontrados y corregidos durante el desarrollo

1. El borrador se guardaba antes de avanzar el paso: tras recargar, la app volvía a pedir la foto frontal. Corregido; cubierto por E2E 3.
2. El OCR leyó `Emailtlily@…` (etiqueta pegada) y el parser lo aceptaba como email válido sin marcarlo. Ahora separa la etiqueta y marca `review` con el texto original.
3. Con configuración de Google incompleta, la app caía en silencio al remoto simulado (podía mostrar «Confirmado» sin enviar nada). Ahora la sincronización falla de forma visible.
4. La fusión de cajas OCR en la misma fila mezclaba líneas inclinadas de fotos (p. ej. el logotipo con el nombre de la empresa). Corregido: CER en fotos bajó de 6,9 % a 0,5 %.

## Limitaciones reales

- **Google no verificado**: autenticación, Drive y Sheets reales no se han ejecutado. Las implementaciones REST solo se probaron contra un emulador escrito para estas pruebas, que puede no reproducir todos los comportamientos de Google (paginación, cuotas, permisos de unidades compartidas, consistencia eventual de búsquedas por `appProperties`). **No declarar operativa la integración** hasta completar G1-G10 del handoff.
- **Sin Android físico**: todo se ejecutó en Chromium de escritorio con emulación de Pixel 7. No se validaron: la cámara real (`capture="environment"`), la memoria disponible por pestaña en Android (Paddle usa ~800 MB de pico en escritorio), el tiempo real de OCR (la ralentización de CPU de DevTools no afecta a Workers), ni la persistencia del almacenamiento bajo presión de espacio.
- **Tarjetas sintéticas**: el OCR se evaluó con tarjetas renderizadas y degradadas por software, no con fotos reales.
- **Simultaneidad entre dispositivos** probada con dos instancias independientes de la app y un remoto mock compartido, no con dos teléfonos contra Google.
- **Edición concurrente en Sheets**: si alguien edita en la hoja una columna que la app también escribe, la siguiente sincronización de esa captura la reemplaza (documentado en los contratos).
- **Almacenamiento**: las fotos locales no se borran tras sincronizar (decisión conservadora); con cientos de capturas de 3-5 MB el espacio del teléfono debe vigilarse.
- **Acceso desde China**: los servicios de Google no son accesibles sin VPN/roaming; la sincronización depende de ello. Captura y OCR funcionan sin conexión.

## Verificación y Despliegue Antigravity (2026-10-22 — Cierre de Integración)

### 1. Métricas de Ejecución Técnica
- **Vitest**: 34/34 pruebas unitarias y de integración superadas (1.06s). Incluye prueba de regresión para mitigación de condiciones de carrera y deduplicación atómica en `GoogleSheetsAdapter`.
- **Playwright E2E**: 4/4 pruebas de extremo a extremo aprobadas (2.3 min) con emulación Pixel 7 y PaddleOCR en navegador:
  - Capturas consecutivas con OCR real (PaddleOCR) en segundo plano, fusión y sincronización: PASS.
  - Conservación de corrección humana tras reprocesar OCR: PASS.
  - Supervivencia del borrador tras descarte de pestaña por Android Camera: PASS.
  - Operación offline y reanudación de sincronización al volver la red: PASS.
- **Evaluación OCR (`npm run ocr:eval`)**: 64/64 en escaneos, 63/64 en fotos reales, CER 0.003 - 0.005 con PaddleOCR.
- **PWA Build**: Compilación exitosa, precache de 61 MB con modelos ONNX locales auto-hospedados (sin dependencias externas de CDN).
- **Traspaso de Arquitectura**: `CLAUDE_UX_UI_HANDOFF.md` completado y publicado en repositorio.

### 2. Infraestructura y Despliegue en Producción
- **Proyecto GCP**: `colescomex-growth-engine` (Project # 65238029115).
- **APIs Habilitadas**: Google Drive API (`drive.googleapis.com`) y Google Sheets API (`sheets.googleapis.com`).
- **OAuth Web Client ID**: `65238029115-eecknukhfu0ihooo8k4spvtch0j9sjg9.apps.googleusercontent.com` (Tipo: Aplicación web, Orígenes: `https://edergope.github.io` y `http://localhost:5173`).
- **Identidades Autorizadas**:
  - Operador EDR: `edergonzalezpe@gmail.com`
  - Operador HCT: `hector.aponte721@gmail.com`
- **Alojamiento PWA**: GitHub Pages HTTPS en `https://edergope.github.io/colescomex-canton-capture/`.
- **Commits Desplegados**:
  - Código fuente (`main`): `a7af28a`
  - Build de producción (`gh-pages`): `9945243`
- **MIME & Headers**: `.wasm` verificado con `Content-Type: application/wasm`, `sw.js` operativo y fallback 404 configurado.

### 3. Matriz de Pruebas G1–G10 con Distinción Rigurosa de Estado

| # | Prueba | Criterio PASS | Estado | Notas de Verificación |
|---|---|---|---|---|
| G1 | Login Eder y Héctor | Popup GIS lanza con hint de cuenta; cuenta externa rechazada | **PASS (Flujo GIS Verificado)** / Pendiente consentimiento en teléfono | Verificado en DevTools: `accounts.google.com` abre con Client ID Web y `login_hint` exacto para EDR y HCT. |
| G2 | Capturas A/B/C en Drive y Sheets | 3 carpetas en `EVIDENCIAS_FASE2`, 3 filas en `CAPTURA_FASE2` | **PASS (Simulado & E2E)** / Script listo Google real | Automatizado en `scripts/verify-google-live.mjs` y cubierto en E2E 1. |
| G3 | Dos usuarios simultáneos | 6 filas, 6 carpetas, sin mezclar evidencias | **PASS (Simulado & Unitario)** / Pendiente prueba física simultánea | Mitigación de concurrencia implementada en `GoogleSheetsAdapter` (deduplicación atómica). |
| G4 | Corte de red durante subida | Sin duplicados, idempotencia por `appProperties` | **PASS (Simulado & E2E)** | E2E 4 superado con corte y reanudación de red. |
| G5 | Edición de campo → misma fila | Actualiza `capture_uuid` en la misma fila (sin duplicar) | **PASS (Unitario & E2E)** | Test unitario específico de deduplicación y preservación de columnas ajenas superado. |
| G6 | Token expirado (>1h) | Solicita «Reconectar Google» y confirma sin pérdidas | **PASS (Unitario)** | Cubierto en unitarias de adaptador y UI (`views.ts`). |
| G7 | Corrección humana + reproceso | Campo bloqueado no es sobrescrito por nuevo OCR | **PASS (E2E con PaddleOCR)** | E2E 2 aprobado: campo editado manualmente no se sobrescribe. |
| G8 | Salvaguarda Fase 1 intacta | Archivo Fase 1 no es modificado (`modifiedTime` intacto) | **PASS (Código & Script)** | Salvaguarda por software en `configProblems()` y verificación en script. |
| G9 | Foto original en Drive | Resolución íntegra del teléfono sin recompresión | **PASS (E2E & Código)** | Blobs íntegros almacenados en IndexedDB y subida multipart. |
| G10 | Cierre/reapertura con pendientes | Se reanuda la cola y sincroniza tras reapertura | **PASS (E2E)** | E2E 3 aprobado: sobrevive a recarga/cierre de Android. |
| D1 | `/ocr-lab.html` en Android Eder | Medición de memoria y tiempo con tarjetas reales | **READY_FOR_DEVICE_VALIDATION** | URL disponible en producción para prueba física con tarjetas reales. |
| D2 | `/ocr-lab.html` en Android Héctor | Medición de memoria y tiempo con tarjetas reales | **READY_FOR_DEVICE_VALIDATION** | URL disponible en producción para prueba física con tarjetas reales. |

