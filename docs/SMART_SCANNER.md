# Smart Document Scanner + OCR independiente de la orientación (v1.2)

Rama: `feat/smart-document-scanner` · Punto de restauración: tag `restore/pre-smart-scanner` (última versión publicada antes del escáner).

> **Privacidad.** El repositorio es público. Las fotografías reales y los datos de contacto **no** están en el repositorio: viven en un directorio privado (ver [PRIVATE_FIXTURES.md](PRIVATE_FIXTURES.md)). En este documento, la tarjeta real del registro `CF26F2-EDR-HDHG-0001` se llama **R1**, y sus valores aparecen solo como PASS/FAIL. Las pruebas públicas usan una tarjeta **gemela ficticia** con la misma estructura (`tests/fixtures/twin-card.ts`).

## 1. Problema de partida

R1 se fotografió con la tarjeta **vertical en la mano**, el texto del anverso girado 90° antihorario y el del reverso 90° horario, con dedos, pared y lámparas alrededor. La versión anterior:
- no reconoció el anverso (empresa, correo y teléfonos vacíos);
- tomó el último producto del reverso como nombre de contacto;
- subió a Drive la foto con manos como evidencia principal.

## 2. Arquitectura: motor reutilizable + perfiles de documento

```
                 ┌──────────────── motor reutilizable (src/scanner/engine.ts → processDocument) ─────────────────┐
foto original ──►│ Worker escáner: EXIF → detección → perspectiva → clasificador de orientación (ONNX)             │
(inmutable)      │ DocumentOrientation: candidatos por probabilidad + verificación con la lectura OCR + geometría │──► texto, rotación,
                 │ OCR (OCRAdapter: PaddleOCR) · control de recursos (ResourceGovernor)                            │    documento procesado
                 └────────────────────────────────────────────────────────────────────────────────────────────────┘
                        ▲ DocumentProfile (geometría, resoluciones)            │
                        │  business_card · a4_document · …                     ▼
                                                     parser del tipo de documento (tarjeta: src/extract) + persistencia (cola OCR)
```

| Módulo | Responsabilidad | Depende del tipo de documento |
|---|---|---|
| `src/scanner/imageops.ts`, `homography.ts` | Primitivas de visión (TS puro, Node y navegador) | No |
| `src/scanner/detect.ts` | Detección del documento, esquinas, compuertas de confianza | No (recibe `aspectRange`/`minAreaFrac` del perfil) |
| `src/scanner/classifier.ts`, `orientation.ts` | Orientación 0/90/180/270° | No |
| `src/scanner/scanner.worker.ts`, `client.ts` | Worker del escáner (`terminate()` libera toda su memoria) | No |
| `src/scanner/engine.ts` | `processDocument()`: orquestación genérica | No |
| `src/scanner/profiles.ts` | Perfiles: `business_card` (en uso), `a4_document` (preparado) | Sí: es lo único que cambia |
| `src/extract/*` | Parser de tarjetas comerciales | Sí: cada documento tendrá su parser |
| `src/pipeline/ocrQueue.ts` | Cola persistente: usa el motor con el perfil de tarjeta y guarda los resultados | Sí: la persistencia de tarjetas |

**Siguiente fase:** fichas técnicas, facturas, catálogos y cotizaciones reutilizan el motor tal cual. Para cada uno se añade un perfil (geometría y resoluciones) y un parser de entidades propio.

La detección de una página A4 sintética con el perfil `a4_document` ya está verificada: error de esquina 0,01 % de la diagonal, cobertura 99,98 %.

### Decisiones técnicas (vigentes)

| Decisión | Motivo |
|---|---|
| Visión en TypeScript puro dentro de un Worker propio, sin OpenCV.js | +~20 kB frente a ~10 MB más de precache; probado en Node con fotos reales |
| Clasificador oficial `PP-LCNet_x1_0_doc_ori` (6,8 MB, ~16 ms) + verificación OCR | 1 solo OCR por cara en 22/22 casos |
| Geometría de las líneas en la elección de orientación | PaddleOCR «lee» texto vertical, y la imagen se archivaría sin enderezar |
| Esquinas locales tras la recta global | Las tarjetas reales están curvadas (error de esquina de 67 px → 14 px) |
| Compuertas sobre el cuadrilátero final | Una tarjeta oscura o que se sale del encuadre irían a un recorte silenciosamente incorrecto; ahora van a revisión |
| Entrada OCR de 1600 px | Es la única resolución probada sin valores falsos (ver §4.2) |

## 3. Evidencias: original y procesada

| | Original de captura | Documento procesado |
|---|---|---|
| Qué es | Foto del teléfono, sin tocar (SHA-256 verificado) | Tarjeta recortada, enderezada y orientada |
| Carpeta del proveedor (`EVIDENCIAS_FASE2/<ref>`) | Solo si no hubo recorte fiable | **Sí: imagen principal** (`<ref>_01_card_front_scan.jpg`) |
| Respaldo restringido (`ORIGINALES_FASE2/<ref>`) | **Siempre**, desde la primera sincronización | — |
| Teléfono (IndexedDB) | Siempre; nunca se borra automáticamente | Siempre |

Con Google real y el escáner activo, el respaldo es **obligatorio**: sin `VITE_DRIVE_ORIGINALS_FOLDER_ID`, la sincronización se bloquea de forma visible. Una captura solo queda `CONFIRMADO` cuando sus originales están en el respaldo y cada cara está representada en la carpeta del proveedor. Detalle en [INTEGRATION_CONTRACTS.md §6](INTEGRATION_CONTRACTS.md).

## 4. Resultados

### 4.1 Detección: 24 casos con referencia independiente

Las esquinas de R1 se anotaron a mano en las fotos originales (en el directorio privado). En las escenas sintéticas se usa la homografía exacta con la que se generaron. Comando: `npx vitest run tests/scanner-detect.test.ts`; resultados en `ocr-eval/results/scanner-detect.json`.

| Caso | Esperado | Resultado | Error de esquina | Cobertura | Fondo |
|---|---|---|---|---|---|
| R1 anverso (0/90/180/270°) | recorte | **recorte** ×4 | 0,21–0,31 % | ≥ 99,8 % | ≤ 0,63 % |
| R1 reverso (0/90/180/270°) | recorte | **recorte** ×4 | 0,24–0,27 % | ≥ 99,9 % | ≤ 0,31 % |
| Mesa con perspectiva oblicua (0/90/180/270°) | recorte | **recorte** ×4 | ≤ 0,03 % | ≥ 99,9 % | ≤ 0,12 % |
| Alto contraste, QR al borde, iluminación desigual, desenfoque, dedos delante, vertical, 35° | recorte | **recorte** ×7 | ≤ 0,05 % | ≥ 99,9 % | ≤ 0,11 % |
| Tarjeta blanca sobre fondo claro | recorte o revisión | **recorte** | 0,03 % | 100 % | 0,03 % |
| Página A4 (perfil `a4_document`) | recorte | **recorte** | 0,01 % | 99,98 % | 0,01 % |
| Tarjeta oscura · varias tarjetas · fuera del encuadre | revisión | **revisión** ×3 | — | — | — |

Imágenes antes/después de los casos sintéticos: `docs/scanner/before-after/`. Las de R1 están solo en el directorio privado.

### 4.2 Orientación, OCR y extracción: tubería real en Chromium (Pixel 7 emulado)

Comando: `npm run scanner:eval` (usa el mismo `processDocument` que la app). Resultados públicos en `ocr-eval/results/scanner-eval.json` (sin texto ni valores reales); los completos, en el directorio privado.

- Orientación correcta en **22/22** casos con orientación esperada, siempre con 1 OCR por cara.
- Campos de las tarjetas sintéticas: 102/105. Los 3 fallos son texto tapado por dedos, que se deja vacío (no se inventa).
- **R1, anverso y reverso fusionados: 16/17 campos PASS.**
  - Correctos: empresa principal, segunda empresa, contacto, móvil, fijo, fax, correo, dirección, ciudad, provincia, código postal y QQ.
  - Cargo, stand, web y WeChat vacíos, como corresponde.
  - El único FAIL es la **lista de productos**:

| # | Producto impreso | Leído (perfil estándar) | Resultado estricto (con espacios) |
|---|---|---|---|
| 1 | STREET LIGHTING | `STREETLIGHTING LED LIGHTING` (un solo elemento) | **FALLA**: unido al siguiente y sin espacio |
| 2 | LED LIGHTING | (dentro del elemento anterior) | **FALLA**: no aparece como elemento propio |
| 3 | GARDEN LIGHTING | `GARDEN LIGHTING` | exacto |
| 4 | STEEL POLE (TAPER AND POLYGON POLE) | idéntico | exacto |
| 5 | ALUMINIUM POLE | idéntico | exacto |
| 6 | HIGH MAST POLE | `HIGH MASTPOLE` (en perfil bajo, `HIGH MAST POLE`) | espacio perdido; letras correctas |
| 7 | ELECTRIC POLE | idéntico | exacto |
| 8 | COMMUNICATION POLE | `COMMUNICATIONPOLE` | espacio perdido; letras correctas |
| 9 | GARDEN LIGHING POLE (errata impresa) | idéntico | exacto (la errata se conserva) |
| 10 | PLASTIC GARDEN LIGHTS | idéntico | exacto (no se toma como persona) |

**Resumen:** 6/10 exactos en perfil estándar y 7/10 en perfil bajo; las letras se conservan en 8/10. **Los dos productos que fallan son STREET LIGHTING y LED LIGHTING.** En el informe v1.1 decía «8/10 exactos»: ese recuento ignoraba los espacios y se corrige aquí.

**Tratamiento:**
- **Se conserva todo lo leído**, sin alterar el texto.
- El campo `main_products` queda en **`review`** y la captura en `REQUIERE_REVISION`, con el motivo:
  > posibles errores de separación: "STREETLIGHTING" → ¿"STREET LIGHTING"? · "STREETLIGHTING LED LIGHTING" parece contener 2 productos · "MASTPOLE" → ¿"MAST POLE"? · "COMMUNICATIONPOLE" → ¿"COMMUNICATION POLE"?
- La separación sugerida se ofrece como **candidato** que la persona acepta con un toque; no se aplica sola. En R1 coincide con la lista impresa completa.
- La detección de palabras pegadas solo usa palabras presentes en la propia tarjeta o en un vocabulario de productos, y no marca palabras largas legítimas (probado).

Estudio de resolución de la entrada OCR (v1.1): con 1280 px R1 sale 10/10, pero aparece un correo falso en otra tarjeta (`meiia` en lugar de `meijia`). Se mantiene 1600 px.

### 4.3 Memoria y tiempo (control de recursos para Android)

Chromium de escritorio con emulación de Pixel 7, 24 casos. **No es un Android real.**

| Perfil | Comportamiento | Pico de memoria del navegador (base 238 MB) | Tiempo medio por cara |
|---|---|---|---|
| `standard` | Workers persistentes; se liberan tras 2 min sin trabajo | 1182 MB | 1,3 s |
| `low` (≤ 4 GB o tras una caída) | **Alternancia estricta**: PaddleOCR se libera antes de escanear y el Worker del escáner se termina antes del OCR; decodificación limitada a 2400 px; liberación a los 10 s sin trabajo | **1018 MB** (≈ PaddleOCR solo: 1080 MB en `ocr:eval`) | 2,2 s |

Recuperación (pruebas en `tests/resources.test.ts`):
- **Marcador de tarea pesada** en IndexedDB: si la pestaña muere durante el escaneo o el OCR, al reabrir se registra `PROCESS_INTERRUPTED`, se pasa al perfil `low` y la captura se retoma automáticamente.
- **Degradación por intentos** de la misma captura: 1 normal · 2 reducido · ≥ 3 sin escáner (OCR sobre el original, con aviso). Una foto problemática no puede provocar un bucle de caídas.
- **Vigilancia de tiempo**: 90 s para el escaneo y 180 s para el OCR. Si un Worker se cuelga, se termina; si es el escáner, se lee la foto original.
- **Avisos en la interfaz**: modo de bajo consumo activo (con opción de volver al estándar) y almacenamiento del navegador casi lleno (> 85 %).

Estimación para un Android de gama media: 3–8× más lento, es decir, 5–12 s por cara en perfil estándar. No bloquea la captura. **Pendiente de medir en los teléfonos** (D1/D2 del handoff).

## 5. Limitaciones reales

- **Sin Android físico**: todos los tiempos y memorias son de escritorio. El umbral de 4 GB para el perfil `low` es una estimación prudente y debe ajustarse con D1/D2.
- **Una sola tarjeta real (R1)** en el conjunto de regresión.
- **Productos con espaciado estrecho**: el OCR une palabras (§4.2). Se marcan para revisión; no se corrigen solos.
- **Tarjetas oscuras**: siempre a revisión, sin recorte.
- **Contenido tapado por dedos**: no se reconstruye.
- **Curvatura fuerte**: la homografía corrige la perspectiva, no la curvatura del papel.
