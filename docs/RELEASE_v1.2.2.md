# COLESCOMEX Canton Capture v1.2.2 — informe final

**Estado: PUBLICADA en producción** · https://edergope.github.io/colescomex-canton-capture/

| | |
|---|---|
| Código publicado | `733c3279d708bd1ac79a3937689f706a70cd4610` (`main` avanzó en modo fast-forward desde `580ea95`, sin commit de fusión) |
| `gh-pages` | `4b7624a` («deploy: PWA v1.2.2 (compilación 733c3279)») |
| Recuperación | etiqueta `deployed/v1.2.1` → `c493c74` (producción anterior) |
| Vista previa (pruebas) | https://colescomex-capture-preview.web.app/ con la misma compilación `733c3279` |

Este informe se añadió después con un commit que solo toca documentación; el código publicado es `733c327`.

---

## 1. Causa raíz: el recorte manual no se materializaba

Se reprodujo antes de corregir (`e2e`, foto de 12 MP). Tras pulsar «Aplicar», la interfaz pasaba al instante a «Esquinas ajustadas por usted», con tono de éxito, mientras seguía mostrando la **foto completa**.

1. **Éxito falso.**
   - `onSave` guardaba las coordenadas y lanzaba `void this.analyzeShot()` sin esperar.
   - `cropState()` daba prioridad a la decisión sobre el resultado.
   - Si el render tardaba, fallaba o caducaba (en el teléfono: fotos grandes, memoria), el éxito falso quedaba fijo y el recorte nunca existía.
   - El editor solo mostraba coordenadas, nunca una imagen recortada.
2. **El recorte visto se descartaba al guardar.**
   - Solo viajaban coordenadas; el documento recortado se generaba después, dentro de la cola de OCR.
   - Si el escáner fallaba allí, o en modo mínimo (3.er intento o poca memoria), el OCR leía la foto original.
   - La sincronización subía entonces el original como si fuera el documento escaneado.
3. **Editor en Android.** La imagen tenía una altura fija de `70dvh` dentro de una fila de la rejilla que no podía encoger, así que en pantallas bajas el pie con «Aplicar» quedaba fuera de la pantalla.

## 2. Corrección (archivos)

- **Etapa A**, separada del OCR (`src/ui/scan-preview.ts`, `src/ui/screens/capture.ts`, `corners.ts`):
  - `materialize()` genera el documento recortado y enderezado con exactamente las 4 esquinas, lo decodifica y comprueba que tiene dimensiones;
  - «Aplicar» espera ese resultado;
  - si falla, el editor sigue abierto con las mismas esquinas y muestra el error para reintentar;
  - estados: «Generando recorte…», «Recorte manual aplicado» y «No se pudo generar el recorte» (con «Reintentar»).
- **Persistencia** (`src/storage/repo.ts`, `src/domain/schema.ts`):
  - el recorte generado se guarda al instante como documento procesado (`preliminary`, campo opcional, sin migración);
  - el proceso final lo sustituye **en el mismo registro**, con las mismas esquinas y a resolución completa;
  - el original no se toca.
- **OCR** (`src/scanner/engine.ts`, `src/pipeline/ocrQueue.ts`): sin escáner, se lee el recorte aprobado y nunca la foto completa. Un fallo del OCR no elimina el recorte.
- **Sincronización** (`src/sync/SyncEngine.ts`): el documento preliminar espera al proceso final, para no subirse dos veces. A la carpeta del proveedor solo va el recorte; el original va al respaldo restringido.
- **Capturas ya guardadas** (`document.ts`, `service.applyCrop`): mismo flujo.
- **Vista previa** (`config/env.ts`, `shared.ts`, `model.ts`, `sync.ts`, `home.ts`, `settings.ts`, `main.ts`):
  - no recomienda instalarla y bloquea el aviso de instalación de Chrome;
  - rotula la sincronización como «simulada».
- **Pruebas unitarias herméticas** (`vitest.config.ts`): la instancia ya no depende del `.env.local` de cada máquina.

## 3. Evidencia visual (`docs/scanner/evidencia/`, escena sintética)

**Escena:** foto de 3000×2000 con EXIF orientación 6; tarjeta de límites conocidos sobre un fondo magenta y verde; 4 marcas de color junto a las esquinas.

**Imágenes:**
- `01-foto-original-sintetica.jpg`: la foto de partida;
- `02-editor-cuatro-esquinas.jpg`: el editor con las 4 esquinas;
- `03-recorte-aplicado.jpg`: el recorte aplicado;
- `04-original-con-contorno.jpg`: el original con el contorno elegido;
- `05-documento-final.jpg`: el documento final.

**Medidas** (`medidas.json`):

| | Proporción (objetivo 1,7143) | Fondo exterior | Marcas conservadas |
|---|---|---|---|
| Vista previa (1185×691) | 1,7149 | 0,01 % | 4/4 |
| Documento final (1778×1037) | 1,7146 | 0 % | 4/4 |

## 4. UX/UI

- **Editor:**
  - ocupa el área visible real (`100dvh`), con la foto ajustada al espacio disponible;
  - esquinas de 15 px en pantalla; se sigue moviendo la esquina más cercana al dedo y la lupa ×3 funciona igual;
  - pie con «Cancelar» y «Foto completa» arriba y **«Aplicar» a todo lo ancho**, con margen para la navegación por gestos.
- **Revisión «Anverso y reverso listos»:**
  - panel «Recorte del anverso / del reverso» que indica la cara («Cara 1 de 2 · 1 lista») y su estado real;
  - acción principal a todo lo ancho; alternativas en dos columnas legibles;
  - «Ver original / Ver recorte»;
  - miniaturas con ✓ o ⚠ por cara;
  - «Antes de guardar: reverso (falta decidir)» o «Listo para guardar»;
  - textos que se ajustan con letra grande, sin desbordarse.
- **Sin cambios:** la decisión explícita por cara, el visor en vivo de `f9519fc` y el ajuste manual que ya habías aprobado.

## 5. Pruebas sobre la versión final (`733c327`, clon limpio, `npm ci`)

| Control | Resultado |
|---|---|
| `npx tsc --noEmit` | ✅ 0 errores |
| `npm test` | ✅ **162/162** en 16 archivos |
| Build de producción | ✅ |
| `npm run check:dist` | ✅ 27 entradas de precaché · 16 archivos OCR (71,6 MB) idénticos · 38 archivos sin secretos · 46 fixtures privados comparados sin coincidencias |
| Playwright E2E completa | ✅ **44/44** · 0 fallidas · 0 omitidas |
| `npm run check:private` | ✅ 17 patrones, 0 coincidencias |
| Contra la **vista previa publicada** | ✅ 7/7: recorte real, fallo sin falso éxito, visor en vivo y distribución en pantallas de 360/393/412 px |

**Desglose de las 44 E2E:**

| Archivo | Pruebas | Qué cubre |
|---|---|---|
| `crop-materialize` | 2 | Recorte con píxeles, original intacto (SHA-256), mismas esquinas al volver a editar, OCR y Drive simulado sobre el recorte. Fallo → error real y reintento. |
| `responsive-crop` | 3 | Anchos de 360/393/412 px × alturas de 640/780/915 px × texto al 100/130 %, con margen de gestos emulado. Se miden rectángulos reales y el elemento que recibe el toque. |
| `pwa-update` | 8 | v1.0.0, v1.2.0 y **v1.2.1 → v1.2.2**: datos byte a byte, borrador conservado, sin reinstalar y sin volver a descargar los modelos. |
| `scanner-review` | 9 | Decisión explícita por cara. |
| `camera-live` | 2 | Visor en vivo en anverso, reverso, repetir, siguiente y segundo plano. |
| `capture` | 5 | Incluye la tarjeta real privada R1, que solo existe en el ordenador. |
| `ux` | 14 | Pantallas y flujos generales. |
| `00-hermetic` | 1 | Ninguna prueba escribe en Google real. |

## 6. Despliegue y comprobaciones posteriores

- **Versión:** `version.json` = 1.2.2 / `733c3279`.
- **Service worker:** `sw.js` con `skipWaiting` y `clientsClaim`, mismo alcance.
- **Manifiesto:** sin cambios (`id`/`scope`/`start_url` = `./`, «CX Capture»).
- **Archivos:** las 24 URL de precaché responden 200, incluidos los 7 recursos OCR; los 9 archivos retenidos de la v1.2.1 están presentes; el JavaScript publicado coincide **byte a byte** con el artefacto verificado.
- **Configuración de Google:** idéntica a la de la v1.2.1 en sus 15 variables. Mismos hoja, carpetas, cliente OAuth e instancia `production`, misma base IndexedDB.
- **Sitio oficial:** abre la pantalla de acceso de Google con «Versión 1.2.2 · compilación 733c3279», sin errores en consola. Un navegador que tenía una versión anterior se actualizó solo, sin reinstalar.

## 7. Pendiente y riesgos (separados)

**Pendiente de tu verificación (no se declara hecho):**
- la prueba física en tu Android;
- la escritura real en Google con esta versión: solo se usó Google simulado.

**Riesgos conocidos:**
- el tiempo de «Generando recorte…» en un teléfono de gama baja con fotos muy grandes (límite de 45 s, después aparece el error con reintento);
- los límites del detector automático (tarjetas metálicas, reflejos), documentados en `SCANNER_QUALITY_v1.2.2.md`; el ajuste manual cubre esos casos.

**Comportamiento esperado con borradores antiguos:** si al actualizar había un borrador abierto en la cámara, la actualización espera a que vuelvas a Inicio. Las caras de ese borrador pedirán decidir el recorte; nunca se supone.

## 8. Actualizar la PWA instalada en tu Android sin perder datos

1. Abre **la misma app «CX Capture»** del icono, con Wi-Fi. No la desinstales, no borres datos y no instales la vista previa.
2. Si se abre en la cámara con una captura en curso, **guárdala o sal a Inicio** con la ✕: la actualización espera a un momento seguro.
3. Quédate en **Inicio** entre 1 y 2 minutos. La app se recarga sola una vez.
4. Comprueba en **Ajustes → Versión y actualizaciones** que pone **1.2.2 · compilación 733c3279**. Si no ha cambiado, ciérrala desde Recientes y vuelve a abrirla desde el icono.
5. **Aceptación:**
   1. Fotografía el anverso y luego «Fotografiar reverso»: el visor debe verse en vivo.
   2. Pulsa «Ajustar manualmente», coloca las 4 esquinas y pulsa **«Aplicar»**. Debes ver la tarjeta **recortada y enderezada, sin fondo**, con «Recorte manual aplicado».
   3. Vuelve a ajustar: deben aparecer tus esquinas anteriores.
   4. Comprueba que «Aplicar» se ve entero.
   5. Guarda. En la ficha debe poner «Recorte manual aplicado»; en «Documento → Procesado», el recorte.
   6. Tras sincronizar, en Drive la carpeta del proveedor debe contener `…_scan.jpg` y el original debe estar en ORIGINALES.
   7. Tus proveedores anteriores deben seguir ahí.
6. **Si algo falla:** usa Ajustes → «Copiar diagnóstico» (no contiene datos personales).
7. **Volver a la v1.2.1:** es posible con la etiqueta `deployed/v1.2.1`, sin tocar los datos del teléfono.
