# COLESCOMEX — Canton Fair Capture (núcleo)

PWA móvil, offline-first, para que **Eder y Héctor** capturen proveedores en la **Fase 2 de la Feria de Cantón (China 2026)** desde sus teléfonos Android: fotos de tarjeta (frontal y reverso), stand, producto y catálogo. El OCR extrae los datos en segundo plano y todo se sincroniza después con Google Drive y Google Sheets.

> Esta microapp **no** es COLESCOMEX OS: no aprueba, no califica y no homologa proveedores. `CAPTURADO` nunca significa `SUPPLIER APPROVED`.

## Estado

| Componente | Estado |
|---|---|
| **v1.2 Smart Document Scanner**: detección de la tarjeta, recorte sin manos ni fondo, perspectiva, orientación automática 0/90/180/270°, motor reutilizable por tipo de documento, control de memoria para Android | **Implementado y probado** con fotos reales privadas (rama `feat/smart-document-scanner`, ver [docs/SMART_SCANNER.md](docs/SMART_SCANNER.md)); **pendiente de validación en Android** y no publicado |
| Captura, almacenamiento local, cola OCR, parser, sincronización con reintentos | **Implementado y probado** (ver [docs/TEST_REPORT.md](docs/TEST_REPORT.md)) |
| OCR en el navegador (PaddleOCR.js, chino + inglés) | **Implementado y medido** en Chromium (ver [docs/OCR_EVALUATION.md](docs/OCR_EVALUATION.md)) |
| Adaptadores Google (OAuth, Drive, Sheets) | **Escritos y probados contra un emulador, NO verificados con Google real.** Los conecta Antigravity: [ANTIGRAVITY_HANDOFF.md](ANTIGRAVITY_HANDOFF.md) |

## Privacidad

El repositorio es público. **No versionar fotografías reales de tarjetas, datos de contacto ni salidas con valores reales.** Las pruebas con tarjetas reales leen un directorio privado fuera del repositorio ([docs/PRIVATE_FIXTURES.md](docs/PRIVATE_FIXTURES.md)) y se omiten si no está disponible. Antes de subir cualquier rama:

```bash
npm run check:private
```

## Requisitos

- Node.js 22+ y npm 10+
- ~200 MB de disco para dependencias y recursos OCR

## Instalación y ejecución

```bash
npm install
```

```bash
npm run setup:assets
```

`setup:assets` descarga los modelos PaddleOCR (desde los servidores oficiales de PaddlePaddle) y copia los WASM de ONNX Runtime y Tesseract a `public/ocr-assets/` para auto-hospedarlos (sin CDN durante la feria).

```bash
cp .env.example .env.local
```

```bash
npm run dev
```

Abrir `http://localhost:5173`. Por defecto usa autenticación y sincronización **mock** (sin Google) y PaddleOCR real.

Compilación de producción y vista previa (con service worker):

```bash
npm run build
```

```bash
npm run preview
```

## Pruebas

```bash
npm test
```

Unitarias + integración del núcleo (Vitest, IndexedDB simulado): pruebas A/B/C, dos usuarios, cortes de red, OCR fallido, reapertura.

```bash
npx playwright install chromium
```

```bash
npm run build && npm run test:e2e
```

E2E sobre la app compilada con **PaddleOCR real**, emulación Pixel 7, modo sin conexión vía service worker.

```bash
npm run ocr:fixtures && npm run ocr:eval
```

Banco de evaluación OCR (PaddleOCR vs Tesseract.js) — resultados en `ocr-eval/results/`.

```bash
npm run scanner:eval
```

Evaluación de extremo a extremo del escáner (recorte + orientación + OCR + parser) con las fotos reales de CF26F2-EDR-HDHG-0001 y escenas sintéticas. Resultados en `ocr-eval/results/scanner-eval.json`; imágenes en `docs/scanner/`.

Para probar con **tarjetas reales en el teléfono**: abrir `/ocr-lab.html` de la app desplegada, elegir motor y fotografiar una tarjeta (no guarda nada).

## Arquitectura

```
Cámara/galería ──► Asistente de captura ──► IndexedDB (transacción atómica: captura + fotos Blob + consecutivo + auditoría)
                     │ (borrador persistido tras cada foto)          │
                     ▼                                                ├──► Cola OCR (persistente, 1 a la vez, Web Worker)
              «Guardar y siguiente»                                    │      OCRAdapter → entidades → normalización → validación → fusión
              (no espera OCR)                                          │
                                                                       └──► SyncEngine (idempotente, reintentos)
                                                                              DriveAdapter: carpeta por proveedor → evidencias
                                                                              SheetsAdapter: upsert de 1 fila por capture_uuid
```

| Ruta | Responsabilidad |
|---|---|
| `src/domain/` | Esquema comercial (29 columnas), columnas técnicas, IDs (`uuid`, `external_ref`) |
| `src/storage/` | IndexedDB (`idb`): capturas, evidencias (Blob), resultados OCR, metadatos, auditoría |
| `src/ocr/` | `OCRAdapter` + PaddleOCR (por defecto), Tesseract.js, remoto (backend), mock |
| `src/scanner/` | Motor reutilizable de documentos (`processDocument`): detección, homografía, clasificador de orientación (ONNX), `DocumentOrientation`, Worker; perfiles por tipo de documento (`profiles.ts`) |
| `src/pipeline/resources.ts` | Control de memoria y recuperación para Android (perfiles `standard`/`low`, alternancia escáner↔OCR, marcador de caída, degradación por intentos) |
| `src/extract/` | Texto OCR → entidades → normalización → validación → fusión frontal/reverso |
| `src/pipeline/ocrQueue.ts` | Procesamiento asíncrono con estados `CAPTURADO → PROCESANDO → EXTRAIDO / REQUIERE_REVISION / ERROR` |
| `src/sync/` | Motor de sincronización y construcción de la fila de Sheets |
| `src/adapters/` | Contratos + mocks + implementaciones REST de Google |
| `src/app/service.ts` | Orquestación (la UI y las pruebas solo usan esta clase) |
| `src/ui/` | Interfaz móvil sin framework |

### Decisiones técnicas

- **Vite + TypeScript sin framework de UI**: 5 pantallas no justifican React; menos peso y menos dependencias.
- **IndexedDB** con transacciones multi-store: una captura nunca queda sin sus fotos ni con fotos huérfanas.
- **PaddleOCR.js (PP-OCRv5 mobile)** como motor por defecto; PP-OCRv6 tiny automático en teléfonos con ≤3 GB de RAM; Tesseract.js disponible como alternativa. Justificación en [docs/OCR_EVALUATION.md](docs/OCR_EVALUATION.md).
- **Sin COOP/COEP**: Google Identity Services usa ventanas emergentes que el aislamiento de origen rompe; el OCR corre en WASM de 1 hilo (SIMD) dentro de un Worker.
- **Precache completo (~61 MB)**: app, modelos y WASM se descargan en la instalación; la app y el OCR funcionan sin conexión después.
- **El teléfono es la fuente de verdad** durante la feria; Sheets se escribe por nombre de columna con upsert por `capture_uuid`.

### Identificadores

- `uuid`: UUID v4 inmutable (clave primaria local y en Sheets/Drive vía `capture_uuid`).
- `external_ref`: `CF26F2-<USUARIO>-<DISPOSITIVO>-<NNNN>`, p. ej. `CF26F2-EDR-YC53-0007`. El usuario separa a Eder/Héctor, el código de dispositivo (aleatorio, fijado al instalar) separa teléfonos del mismo usuario y el consecutivo es monotónico por dispositivo. No puede colisionar entre dispositivos.

### Estados

- **OCR**: `CAPTURADO`, `PROCESANDO`, `EXTRAIDO`, `REQUIERE_REVISION`, `ERROR`.
- **Sincronización** (independiente del OCR): `LOCAL` (Guardado localmente), `PENDIENTE` (Pendiente de sincronización), `SINCRONIZANDO`, `CONFIRMADO` (Confirmado en Google), `ERROR` (Error de sincronización). `CONFIRMADO` exige que todas las evidencias tengan `fileId` en Drive **y** que la revisión actual esté escrita en Sheets.
- **Campo**: `ok`, `review` (ambiguo / conflicto frontal-reverso / baja confianza), `illegible` (hay indicio pero no se leyó con certeza), `absent` (no aparece). Las correcciones humanas quedan `locked` y ningún OCR posterior las cambia.

## Documentación

- [ANTIGRAVITY_HANDOFF.md](ANTIGRAVITY_HANDOFF.md) — pasos para conectar Google, desplegar y probar de extremo a extremo
- [docs/INTEGRATION_CONTRACTS.md](docs/INTEGRATION_CONTRACTS.md) — contratos de adaptadores, columnas de Sheets, estructura de Drive
- [docs/ENV_VARS.md](docs/ENV_VARS.md) — variables y credenciales necesarias (sin secretos)
- [docs/SMART_SCANNER.md](docs/SMART_SCANNER.md) — escáner de documentos: arquitectura reutilizable, métricas, memoria, limitaciones
- [docs/PRIVATE_FIXTURES.md](docs/PRIVATE_FIXTURES.md) — fotografías y datos reales de prueba (fuera del repositorio)
- [docs/OCR_EVALUATION.md](docs/OCR_EVALUATION.md) — evaluación PaddleOCR vs Tesseract.js
- [docs/TEST_REPORT.md](docs/TEST_REPORT.md) — informe PASS/FAIL y limitaciones reales
