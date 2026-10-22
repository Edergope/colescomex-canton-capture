# Evaluación del motor OCR

Fecha: 2026-10-22 · Reproducible con `npm run ocr:fixtures && npm run ocr:eval` · Datos brutos en `ocr-eval/results/`.

## Candidatos

| Motor | Versión | Modelos | Peso descargado (auto-hospedado) |
|---|---|---|---|
| **PaddleOCR.js** (`@paddleocr/paddleocr-js`, repositorio oficial PaddlePaddle/PaddleOCR/paddleocr-js) | 0.4.2 | PP-OCRv5 mobile det + rec (multilingüe chino/inglés) | modelos 21,5 MB + ORT WASM 14 MB + worker con OpenCV.js 11 MB |
| PaddleOCR.js con PP-OCRv6 tiny | 0.4.2 | PP-OCRv6 tiny det + rec | modelos 6,3 MB (+ mismo runtime) |
| **Tesseract.js** | 7.0.0 | `eng` + `chi_sim` (4.0.0_best_int, LSTM) | ~15 MB |

## Método

- **Tarjetas**: 6 tarjetas ficticias, 9 caras (frontal/reverso) con diseños variados: bilingüe, solo inglés, solo chino con tipografía Song, fondo oscuro, texto denso con QR, minimalista. Cada cara en dos versiones:
  - `scan`: imagen limpia.
  - `photo`: simulación de foto de teléfono — fondo de mesa, perspectiva 3D, rotación, desenfoque 0,9 px, iluminación irregular, ruido y JPEG calidad 0,7 (ver `ocr-eval/fixtures/*_photo.jpg`).
- **Entorno**: Chromium (Playwright) con emulación Pixel 7 y CPU ralentizada ×4, motor ejecutado dentro de un Web Worker, WASM SIMD de 1 hilo (la configuración real de la app). Imagen reducida a 1600 px de lado mayor, límite de detección 960 px.
- **Métricas**:
  - CER: distancia de edición sobre el texto completo (sin espacios) / longitud de la referencia.
  - Recuperación CJK: proporción de caracteres chinos de la referencia presentes en el resultado.
  - **Precisión de campos**: el texto OCR pasa por el parser real de la app (`src/extract`) y se compara campo a campo (empresa EN/CN, contacto, teléfonos, email, web, WeChat, WhatsApp, hall/stand, ciudad, provincia, productos) con la referencia. Es la métrica que decide.
  - Memoria: RSS máxima de todo el árbol de procesos del navegador (línea base del navegador vacío: 238 MB).

## Resultados

| Motor | Imágenes | Tiempo medio/imagen | CER | Recuperación CJK | Campos correctos | Pico RSS (sobre base) |
|---|---|---|---|---|---|---|
| **PaddleOCR v5 mobile** | scan | 754 ms | 0,3 % | 100 % | **64/64** | 1 061 MB (+823) |
| **PaddleOCR v5 mobile** | photo | 729 ms | 0,5 % | 100 % | **63/64** | |
| PaddleOCR v6 tiny | scan | 273 ms | 0,2 % | 100 % | 62/64 | 861 MB (+623) |
| PaddleOCR v6 tiny | photo | 344 ms | 0,8 % | 99,7 % | 58/64 | |
| Tesseract.js | scan | 297 ms | 1,5 % | 97,2 % | 64/64 | 567 MB (+329) |
| Tesseract.js | photo | 565 ms | 10,2 % | 96,7 % | **50/64** | |

Inicialización (con recursos ya en caché): Paddle 1,4 s; Tesseract 0,1 s.

### Errores relevantes en fotos

- **PaddleOCR v5**: 1 fallo — leyó `Email:lily@xcdaily.com` como `Emailtliy@xcdally.com`. El parser separa la etiqueta pegada y **marca el campo para revisión** con el texto original, en lugar de aceptarlo.
- **Tesseract.js**: 14 fallos, varios con valores **falsos pero verosímiles**: `huang@greenieafpack.com`, `www.greenieafpack.com`, `NINGBO OCEAN vp, & Exp, CO.,LTD.`; una tarjeta entera (c5) sin empresa, WeChat ni email; teléfonos móvil/fijo intercambiados.

## Decisión

**PaddleOCR.js con PP-OCRv5 mobile como motor por defecto.**

1. Es el único que mantiene la precisión de campos con fotos reales de teléfono (63/64 frente a 50/64). Las tarjetas en la feria se fotografían a mano, con ángulo y reflejos; el caso `scan` no es representativo.
2. Tesseract produce errores plausibles (dominios y correos con una letra cambiada) que el parser no puede detectar como ilegibles: justo el riesgo de «inventar datos» que el producto debe evitar.
3. Reconocimiento chino superior (100 % frente a ~97 %), incluida tipografía Song.
4. El coste es memoria (~800 MB de pico) y tamaño (~47 MB). Mitigaciones implementadas:
   - OCR secuencial (una imagen a la vez) en un Worker; la UI nunca espera.
   - Teléfonos con `navigator.deviceMemory ≤ 3` usan PP-OCRv6 tiny automáticamente (~200 MB menos, 3× más rápido, 58/64).
   - Si el motor falla (p. ej. falta de memoria), la captura y las fotos ya están guardadas: queda en `ERROR` y se puede reprocesar; la foto original se sincroniza igualmente.
5. Tesseract.js se conserva como adaptador alternativo (`VITE_OCR_ENGINE=tesseract`) y `RemoteOCRAdapter` permite pasar a Google Cloud Vision vía backend sin tocar el parser.

Detalle técnico: el worker de paddleocr-js 0.4.2 incluye ONNX Runtime Web 1.24.3 y por defecto descarga la variante JSEP/WebGPU (28 MB) desde jsDelivr. La app fija `wasmPaths` a la variante WASM simple (14 MB) auto-hospedada; probado y funcional.

## Limitaciones de esta evaluación (reales)

- **No se probó en un Android físico.** La ralentización de CPU de Chrome DevTools (×4) **no** afecta a los Web Workers, por lo que los tiempos medidos corresponden a la CPU del Mac de desarrollo. En un Android de gama media se esperan tiempos varias veces mayores (estimación: 3-8 s por cara con v5). No bloquea la captura (el OCR es asíncrono), pero conviene medirlo con `/ocr-lab.html` en los teléfonos reales.
- La memoria medida es la del Chromium de escritorio; en Android el límite por pestaña es menor. Riesgo principal a verificar en los teléfonos de Eder y Héctor.
- Las tarjetas son sintéticas (renderizadas y degradadas por software), con tipografías del sistema. No incluyen reflejos especulares reales, laminados, tipografías decorativas, texto vertical ni tarjetas muy pequeñas. Se recomienda repetir la medición con 10-20 tarjetas reales antes del viaje.
- El conjunto es pequeño (9 caras, 64 campos por variante): sirve para comparar motores, no para estimar una tasa de error de producción.
