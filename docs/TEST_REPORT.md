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


---

# v1.2 — Smart Document Scanner (rama `feat/smart-document-scanner`)

Fecha: 2026-10-22 · Entorno: macOS (Apple Silicon), Node 22.23, Chromium headless con emulación Pixel 7.

Ejecutado **con** el directorio privado de fixtures reales ([PRIVATE_FIXTURES.md](PRIVATE_FIXTURES.md)). La tarjeta real del registro `CF26F2-EDR-HDHG-0001` aparece como **R1** y sus valores no se publican. Registros en `test-logs/` (no versionado).

## Comandos obligatorios

| Comando | Resultado |
|---|---|
| `npm test` | **PASS 79/79** (11 archivos). Sin el directorio privado: 77 PASS y 2 omitidas (no cuentan como PASS) |
| `npm run build` | **PASS**, precache 68 MB |
| `npm run test:e2e` | **PASS 5/5**, 2,4 min (incluye la E2E con R1 a través de la interfaz) |
| `npm run ocr:eval` | **PASS**: PaddleOCR 64/64 (scan) y 63/64 (foto); Tesseract 64/64 y 50/64. Sin regresiones |
| `npm run scanner:eval` | Orientación **22/22** (1 OCR por cara); campos sintéticos 102/105; **R1 16/17** (FAIL: lista de productos, marcada para revisión) |
| `npm run check:private` | **PASS** sobre el árbol y la historia publicada (ver «Privacidad») |

## Matriz de validación

| | Qué se valida | Referencia independiente | Resultado |
|---|---|---|---|
| A | Detección del documento | 24 casos: R1 (2 caras × 4 rotaciones exactas) + 16 escenas sintéticas, incluida una página A4 | **24/24** según lo esperado (21 recortes; 3 a revisión: varias tarjetas, fuera del encuadre, tarjeta oscura) |
| B | Cuatro esquinas | Esquinas de R1 anotadas a mano; sintéticas por homografía | R1 ≤ **0,31 %** de la diagonal; sintéticas ≤ 0,05 % |
| C | Recorte y fondo | Cobertura ≥ 98,5 % y fondo ≤ 1,5 % por muestreo geométrico | R1: cobertura ≥ 99,8 %, fondo ≤ 0,63 % |
| D | Perspectiva | Derivada de B; la procesada de R1 es apaisada (E2E) | PASS |
| E | Orientación | Rotación esperada por caso | **22/22** |
| F | OCR | CER (`ocr:eval`) y texto de R1 | CER en fotos 0,5 %. R1: anverso completo; reverso con espacios perdidos en 3 renglones |
| G | Extracción comercial | Resultado esperado (privado), campo a campo | R1 **16/17**; sintéticas 102/105 (los 3 fallos son texto tapado por dedos, que se deja vacío) |
| H | Integridad | SHA-256 de los originales = archivos de Drive; el original no cambia; la procesada no sobrescribe | PASS |
| I | Memoria y tiempo | RSS máxima y tiempo por cara | Estándar 1182 MB y 1,3 s/cara; **bajo 1018 MB** (≈ PaddleOCR solo) y 2,2 s/cara |
| J | Captura consecutiva | «Guardar y siguiente» < 3 s mientras se procesa R1 (E2E) | PASS |

### R1: productos (el único FAIL)

| Producto impreso | Resultado |
|---|---|
| STREET LIGHTING | **FALLA**: leído junto al siguiente como `STREETLIGHTING LED LIGHTING` |
| LED LIGHTING | **FALLA**: no aparece como elemento propio |
| HIGH MAST POLE | espacio perdido en perfil estándar (`HIGH MASTPOLE`); exacto en perfil bajo |
| COMMUNICATION POLE | espacio perdido (`COMMUNICATIONPOLE`) |
| Los 6 restantes | exactos (incluida la errata impresa `GARDEN LIGHING POLE`) |

**Recuento estricto:** 6/10 (estándar) y 7/10 (bajo); las letras se conservan en 8/10. El «8/10 exactos» del informe v1.1 contaba sin espacios y queda corregido.

El campo se conserva tal como se leyó, queda en **`review`** con el motivo (las cuatro incidencias) y ofrece como candidato la separación sugerida, que coincide con la lista impresa. No se aprueba como exacto.

## Cambios de esta versión (v1.2) y pruebas que los cubren

| Cambio | Pruebas |
|---|---|
| **Privacidad**: fixtures reales y valores fuera del repositorio; tarjeta gemela ficticia; verificador anti-fuga; historia de la rama reconstruida sin datos reales | `tests/extract-structure.test.ts`, `tests/private-real-cards.test.ts` (se omite sin directorio privado), `npm run check:private` |
| **Vista previa aislada**: otro origen (Cloudflare Pages) + instancia `preview` (base de datos propia, bloqueo de recursos de producción) | `tests/config-guard.test.ts`; `deploy-preview.mjs --dry-run` (verificado: rechaza `*.github.io` y recursos de producción) |
| **Respaldo obligatorio de originales** en Drive restringido (doble destino por evidencia) | `tests/scanner-pipeline.test.ts` (respaldo, bordes dudosos en ambos destinos, fallo del respaldo → no confirma, respaldo de originales históricos), E2E R1 |
| **Productos ambiguos** marcados para revisión sin alterar lo leído | `tests/extract-structure.test.ts` (palabras pegadas, dos productos en un renglón, sin falsos positivos) |
| **Control de memoria y recuperación** (perfiles, alternancia, marcador de caída, degradación, vigilancia, liberación por inactividad) | `tests/resources.test.ts` (7 pruebas) + medición en navegador (I) |
| **Motor reutilizable + perfiles** (`processDocument`, `business_card`, `a4_document`) | `tests/resources.test.ts` (perfil A4), `scanner-detect` (página A4) |

## Privacidad

- `git grep` y `scripts/check-private-data.mjs` sobre la rama publicada: **0 coincidencias** de los patrones privados. Los patrones (nombre, teléfonos, correo, QQ, dirección, IDs de Drive, huellas de los archivos) también se guardan fuera del repositorio.
- La rama se reconstruyó desde `restore/pre-smart-scanner` en commits nuevos. **Ninguna versión anterior con fotografías o datos reales se subió nunca a GitHub**: esos commits solo existieron en la copia local.
- `origin/main` no contenía datos de R1. Contiene correos de cuentas operativas (Eder, Héctor) en `CLAUDE_UX_UI_HANDOFF.md` y `.env.test`, aportados por Antigravity. Se dejaron como están porque esta entrega no modifica `main`; conviene que Eder decida si deben retirarse.

## Pendientes para los dispositivos Android (handoff V4)

| # | Pendiente | Por qué importa |
|---|---|---|
| D1/D2 | Medir en el Android de Eder y en el de Héctor (`ocr-lab.html` de la vista previa): tiempos por etapa, `deviceMemory`, recargas de la pestaña | Toda la medición actual es de escritorio; la memoria (~1,0–1,2 GB de pico en escritorio) es el riesgo principal |
| D3/D4 | 10 capturas seguidas en perfil estándar y en bajo | Validar que la alternancia y la recuperación evitan cierres; ajustar el umbral de 4 GB |
| S1–S8 | Flujo completo contra Drive y Sheets **de prueba** desde la vista previa aislada | Las subidas reales de la versión procesada, del respaldo y de `ocr_extras` solo se han probado con simulaciones y emulador |
| V5 | Reproceso de `CF26F2-EDR-HDHG-0001` en producción, tras la promoción | La vista previa aislada no puede (ni debe) ver ese registro |
