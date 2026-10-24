# Smart Document Scanner — corrección prioritaria (v1.2.2)

- **Rama:** `fix/scanner-quality`, creada desde la producción v1.2.1 (`580ea95`).
- **Estado:** lista para revisión. **No publicada en producción.** No se tocó `main` ni `gh-pages`.
- **Revisión del propietario (`f16611d`):** el guardado aceptaba en silencio un recorte con estado `ok` y podía adelantarse al análisis. Corregido: decisión explícita por cara (§2.1).
- **Datos:**
  - no hay tarjetas reales ni datos personales en el repositorio;
  - todas las escenas de prueba son sintéticas;
  - las 8 fotos reales privadas (R1) solo se usan en local (`ocr-eval/scanner-fixtures/`, ignorado por git), y su informe se guarda fuera del repositorio.

---

## 1. Diagnóstico

Se revisó todo el recorrido: cámara → foto → worker → detección → perspectiva → orientación → OCR.

| Punto revisado | Hallazgo |
|---|---|
| Captura (`camera.ts`) | **Correcta.** Usa `ImageCapture.takePhoto()` a resolución máxima. Si no está disponible, toma un fotograma de la vista en vivo (JPEG 0,92). El original se guarda tal cual en IndexedDB antes de cualquier proceso. |
| EXIF y orientación | **Correctos.** El worker y la vista previa decodifican con `imageOrientation: 'from-image'`, y las esquinas se expresan siempre en la foto con EXIF aplicado. |
| Pérdida de calidad antes del OCR | **No significativa.** El OCR recibe el documento rectificado a `ocrInputSide` con JPEG 0,92. El problema no estaba en la compresión. |
| **Detector (`detect.ts`)** | **Causa principal.** Daba por hecho una tarjeta **clara sobre fondo oscuro**: máscara de «papel» y polaridad fija del borde. Además, suponía que la tarjeta llenaba el encuadre. Con fondos claros o mesas blancas, o con tarjetas oscuras o metálicas, se pegaba a bordes internos, a marcos decorativos o al fondo. Resultado: recortes que cortaban texto o esquinas inventadas. |
| **Pista de la cámara** | **Prometía lo que no se cumplía.** La pista analizaba a 480 px, sin la etapa fina, y mostraba «Tarjeta detectada». Ese polígono no era el recorte final. En el banco, la pista de la v1.2.1 dijo «Tarjeta detectada» 86 veces: 32 con un error superior al 3 %, y 9 sin ninguna tarjeta recortable. |
| **Experiencia de recorte** | **Recorte nunca visto.** El texto «Bordes detectados · el recorte se hará al guardar» anunciaba un recorte que el operador no veía antes del OCR. Un recorte malo llegaba al OCR sin que nadie lo hubiera revisado. |
| Esquinas falsas y tarjetas parciales | La v1.2.1 aceptaba cuadriláteros que tocaban el borde de la foto o encerraban fondo. Hoy hay controles específicos (§2). |

---

## 2. Correcciones

### Detector (`src/scanner/detect.ts`, `profiles.ts`)

**Tercer generador de candidatos: «fondo».**
- Modela el fondo con un plano robusto por canal, ajustado en la banda del borde de la foto. La piel queda excluida, para que los dedos no cuenten como fondo.
- Funciona con tarjetas claras u oscuras, y sobre fondos claros, oscuros o en degradado.

**Polaridad del borde.**
- Hay dos modos: global (la tarjeta es más clara o más oscura que el fondo) y libre (por lado).
- Se prueban los dos y se queda el de mejor puntuación. El refinado fino usa el mismo modo.

**Controles contra recortes incorrectos.**
- Rechaza cuadriláteros que tocan el borde de la foto.
- Exige un mínimo de evidencia en cada lado.
- Rechaza el candidato si la tarjeta continúa fuera de él, si encierra fondo o si no contiene tinta.
- Rechaza proporciones imposibles.

**Elección del contorno.**
- Prefiere la línea más exterior, para no recortar dentro de un marco impreso.
- Prefiere el candidato que encierra a otro, para no quedarse con un bloque interior.
- «Varias tarjetas» solo se declara con candidatos separados que parecen tarjetas.

**Confianza.**
- El estado «ok» automático solo se da si dos generadores coinciden, o si es un primer plano claro.
- En cualquier otro caso es una **sugerencia** que se revisa: nunca se valida sola.

**Tarjetas pequeñas.**
- El área mínima baja del 4 % al 2 % del encuadre.

### Experiencia de captura (`capture.ts`, `scan-preview.ts`, `corners.ts`, `document.ts`, `detail.ts`)

**Flujo profesional:** capturar → proteger el original → detectar → **mostrar el recorte real** → **decisión explícita del operador** → OCR de exactamente lo aprobado.

- **Protección inmediata.** El original se guarda en IndexedDB nada más tomar la foto, antes de cualquier análisis.
- **Vista previa real.** Usa el mismo worker, el mismo detector y la misma perspectiva que el proceso final, a 2000 px.
- **Panel de decisión** por cara de la tarjeta:
  - **Usar recorte automático:** una sola pulsación acepta el recorte visible. Desactivado si no hay propuesta.
  - **Ajustar manualmente:** editor de 4 esquinas con **lupa ×3**, arrastre táctil y teclado.
  - **Conservar fotografía completa.**
- **Estados:**
  - mientras no hay decisión, son propuestas: «Recorte propuesto — decida», «Bordes dudosos — decida», «No se encontraron los bordes», «Hay varias tarjetas en la foto», «El escáner no respondió»;
  - solo una decisión del operador produce «Recorte automático aceptado», «Esquinas ajustadas por usted» o «Foto completa».
- **La pista en vivo** pasa de «Tarjeta detectada» a «**Bordes visibles**».
- **Nunca se inventan esquinas.** Si el detector duda o no encuentra bordes, no se propone recorte.
- **Repetir la foto** sustituye solo esa cara; el resto del borrador se conserva.
- **Decisión trazable:** `Evidence.crop` guarda la decisión, la fecha, el autor y el estado del detector, y queda en la auditoría.
- **Capturas guardadas:** desde el documento se puede ajustar el recorte o conservar la foto completa, caso por caso.

#### 2.1 Corrección tras la revisión del propietario: ningún recorte se acepta en silencio

| Requisito | Implementación |
|---|---|
| 1. Decisión explícita por cara | «Guardar y siguiente» y «Guardar y salir» no guardan si alguna cara carece de decisión. Muestran «Falta decidir el recorte: …», llevan a esa cara y resaltan el panel. Antes, `cropForSave()` convertía un `ok` en `auto`; ahora solo guarda la decisión elegida. |
| 2. Ver no es aprobar | Ningún botón aparece pulsado sin una pulsación del operador. El recorte visible se rotula «Recorte propuesto — decida». |
| 3. Análisis en curso | El original ya está en IndexedDB, pero no se puede terminar la captura sin decidir. Si el análisis termina después, tampoco acepta nada por sí solo. Y si el operador decide durante el análisis (p. ej. foto completa), el resultado posterior no pisa esa decisión. |
| 4. Fallo del escáner | «Conservar foto completa» y «Ajustar manualmente» están disponibles **desde el primer instante**, sin esperar al análisis. Si el escáner no responde en 20 s, aparece «El escáner no respondió». El tamaño para la foto completa se lee de la propia foto, sin escáner. |
| 5. Rapidez | Aceptar el recorte visible es **una pulsación**. La foto completa no espera al análisis. |
| 6. Anverso y reverso | Cada cara se decide por separado. La tira de miniaturas marca las pendientes, y al guardar se lleva al operador a la primera que falte. |
| 7. Procesar lo aprobado | «Manual» y «foto completa» se procesan con esas esquinas exactas. «Auto» se procesa con el recorte aprobado; solo se sustituye por la detección a resolución completa si coincide con él (esquinas a ≤ 0,6 % de la diagonal). Así se conserva la precisión del OCR sin cambiar lo aprobado; si no coinciden, se usa exactamente lo aprobado. |
| 8. Registros anteriores | Sin reproceso ni modificación automática. Los borradores anteriores sin decisión piden una decisión al guardarse; nunca se supone. |

#### 2.2 Visor congelado al pulsar «Fotografiar reverso» (prueba física del propietario)

**Resultado de la prueba física:**
- **aprobado:** ajuste manual de las 4 esquinas (sin cambios en esta corrección);
- **defecto:** tras fotografiar el anverso y pulsar «Fotografiar reverso», el visor no mostraba la cámara, aunque el obturador sí capturaba.

**Reproducción antes de corregir** (`e2e/camera-live.spec.ts`, cámara simulada de Chromium). Estado medido del `<video>` tras «Fotografiar reverso»:

```
inDom: true, visible: true, streamActive: true, readyState: 4, 3840×2160,
paused: TRUE, fotogramas nuevos en 1,2 s: 0, avance de currentTime: 0, píxeles cambiados: 0
```

**Causa:**
- `drawViewport()` hacía `viewport.replaceChildren(...)` y retiraba el `<video>` del documento al mostrar la foto tomada.
- La norma HTML **pausa** un elemento multimedia retirado del documento, y al reinsertarlo nadie llamaba a `play()`: el visor quedaba congelado.
- El `MediaStream` seguía activo, y por eso `takePhoto()` capturaba igualmente: lee la pista, no el `<video>`.

**Corrección** (`src/ui/screens/capture.ts` y dos reglas CSS). No toca el detector, el editor de esquinas, el OCR ni la sincronización.
- El `<video>` queda **montado toda la sesión de cámara**. Al ver la foto solo se oculta (`hidden`); la guía, la pista y la foto se redibujan en una capa aparte (`.cam-stage`).
- `ensureLive()` se ejecuta cada vez que el visor vuelve y al regresar de segundo plano (`visibilitychange`):
  - mantiene la **misma sesión `MediaStream`**;
  - vuelve a enlazar `srcObject` si hiciera falta;
  - llama a `play()` si está en pausa, controlando el error;
  - solo si el sistema cerró la cámara (pista `ended`) la vuelve a abrir.

**Después de corregir** (misma prueba, en los seis puntos): `paused: false`, `readyState: 4`, 3840×2160, unos 25 fotogramas nuevos en 1,2 s, `currentTime` avanzando unos 1,3 s y píxeles distintos entre dos instantes. Además, **una sola** llamada a `getUserMedia` y el mismo `MediaStream` en todo el recorrido. Los seis puntos son:
1. al abrir la cámara;
2. tras «Fotografiar reverso»;
3. al volver a la cámara para un extra;
4. tras «Repetir foto»;
5. tras «Guardar y siguiente proveedor»;
6. al volver de segundo plano.

**Aceptación en Android físico (propietario):**
- fotografiar el anverso → «Fotografiar reverso» → se ve **inmediatamente** la imagen en vivo, se encuadra y se captura;
- repetir con «Repetir foto», con «Guardar y siguiente proveedor» y cambiando a otra app y volviendo.

**Defecto de sincronización encontrado durante esta corrección** (`src/sync/SyncEngine.ts`; ya existía en `f16611d`):
- Al guardar una decisión de recorte se crea un registro de escaneo provisional con las esquinas aprobadas.
- La sincronización lo tomaba por «ya escaneada» y podía subir la **foto original** (con dedos y fondo) a la carpeta del proveedor antes de que existiera el recorte.
- Ahora espera al resultado real del escáner.
- Prueba de regresión: `tests/drive-sync-regression.test.ts`, que falla sin la corrección.

### Extracción (`src/extract/entities.ts`)

- La web con espacios típicos del OCR (`www. demo.example`) ahora se normaliza.
- Nueva batería de **9 casos adversarios ficticios** (`tests/extract-adversarial.test.ts`), todos superados:
  - productos en mayúsculas que no deben tomarse por persona;
  - tarjeta de catálogo sin persona;
  - «WE PRODUCE» en el reverso;
  - prefijos +86, 0086, +34 y +1;
  - WeChat en chino;
  - empresa bilingüe;
  - tarjeta ilegible, en la que no se inventa nada.

  Los campos dudosos quedan en revisión, nunca como «ok».

---

## 3. Antes y después

- [antes-despues.jpg](antes-despues.jpg): 7 escenas sintéticas comparando el recorte de la v1.2.1 con el nuevo.
- [screenshots/revision-recorte-automatico.jpg](screenshots/revision-recorte-automatico.jpg): panel de revisión del recorte en la cámara.
- [screenshots/ajuste-esquinas-lupa.jpg](screenshots/ajuste-esquinas-lupa.jpg): editor de esquinas con lupa.

---

## 4. Resultados cuantitativos

**Reproducir:** `npx tsx ocr-eval/scanner-bench.ts`.
- Semilla 7, 240 escenas sintéticas.
- Compara con una copia congelada del detector de producción (`ocr-eval/bench/detect-v1.2.1.ts`).
- Resumen en `ocr-eval/results/bench/report.json`, sin datos personales.

**Criterios:**
- **correcto:** esquinas a ≤2 % de la diagonal;
- **aceptable:** no corta texto (≤0,5 % de tinta fuera) y tiene ≤6 % de fondo;
- **falso positivo:** recorte declarado fiable que corta la tarjeta o incluye fondo;
- **conserva foto:** el detector no se fía y pide revisión.

| Métrica (240 escenas sintéticas, 206 recortables) | v1.2.1 | v1.2.2 |
|---|---|---|
| Recorte útil (correcto + aceptable) | 30,1 % | **44,2 %** |
| Falsos positivos | 9,6 % (23) | **6,7 % (16)** |
| Recortes que cortan texto | 14 | **9** |
| Pérdida media de contenido | 7,72 % | **3,29 %** |
| Pérdida máxima de contenido | 100 % | 62 % |
| Conserva la foto completa (pide revisión) | 61,2 % | 49,0 % |
| Tiempo, mediana / p95 (Node, sin aceleración) | 198 / 325 ms | 502 / 1042 ms |
| **Tarjetas reales privadas R1 (8 fotos)** | 8/8 correctas | **8/8 correctas** (sin regresión; pérdida media 0,1 %) |

### Por tipo de tarjeta (útil · falsos positivos)

| Tarjeta | n | v1.2.1 | v1.2.2 |
|---|---|---|---|
| Blanca | 66 | 58,9 % · 3 | **66,1 % · 0** |
| Oscura | 28 | 0 % · 1 | **69,2 % · 0** |
| Con marco | 27 | 50 % · 6 | 59,1 % · 4 |
| De color | 29 | 16,7 % · 2 | 29,2 % · 2 |
| Crema | 25 | 63,6 % · 3 | 54,5 % · 3 |
| Metálica | 37 | 0 % · 3 | 12,9 % · 3 |
| Bloque oscuro sobre claro | 28 | 0 % · 5 | 0 % · 4 |

### Por condición

| Condición | n | v1.2.1 | v1.2.2 |
|---|---|---|---|
| Sin dificultad | 19 | 47,4 % · 1 | **73,7 % · 0** |
| Dedos | 31 | 19,4 % · 1 | **45,2 % · 0** |
| Girada | 15 | 40 % · 0 | **73,3 % · 0** |
| Perspectiva | 40 | 37,5 % · 8 | 47,5 % · 7 |
| Desenfoque | 19 | 31,6 % · 1 | 42,1 % · 0 |
| JPEG fuerte | 13 | 15,4 % · 0 | 46,2 % · 0 |
| Vertical | 12 | 41,7 % · 0 | 50 % · 0 |
| Luz desigual | 11 | 27,3 % · 1 | 36,4 % · 1 |
| Reflejos | 27 | 25,9 % · 6 | 22,2 % · 6 |
| Varias tarjetas | 18 | 0 % · 5 | 0 % · 2 |
| Tarjeta parcial (no recortable) | 16 | 0 % · 0 | 0 % · 0 |
| Pequeña | 19 | 15,8 % · 0 | 15,8 % · 0 |

### Por fondo

| Fondo | v1.2.1 | v1.2.2 |
|---|---|---|
| Degradado | 37 % · 2 | **70,4 % · 1** |
| Gris claro | 30,4 % · 5 | **65,2 % · 3** |
| Madera | 33,3 % · 3 | **59,3 % · 2** |
| Mesa blanca | 16,7 % · 1 | 33,3 % · 2 |
| Desorden | 28,9 % · 2 | 31,6 % · 0 |
| Oscuro | 40 % · 4 | 36,7 % · 3 |
| Tela | 25,8 % · 6 | 25,8 % · 5 |

**Pista de cámara de la v1.2.1:** dijo «Tarjeta detectada» 86 veces, 32 de ellas con un error superior al 3 % y 9 sin tarjeta recortable. Ese mensaje ya no existe.

### Lectura honesta

- **Lo que mejora:**
  - tarjetas oscuras;
  - tarjetas blancas sobre fondo claro, que pasan a 0 falsos positivos;
  - dedos;
  - giro;
  - fondos en degradado, gris claro y madera.
- **Lo que no mejora lo suficiente:**
  - tarjetas metálicas;
  - reflejos;
  - bloque oscuro sobre tarjeta clara;
  - perspectiva fuerte;
  - fondo de tela.
- **La confianza numérica no separa** los falsos positivos que quedan: varios tienen confianza 1,0. Por eso la defensa real es la **revisión visual obligatoria del recorte** antes del OCR. Un recorte equivocado ya no llega al OCR sin que el operador lo vea, y la foto completa siempre está a un toque.
- **Tiempo:** el detector nuevo es unas 2,5 veces más lento. En el teléfono corre en un worker mientras el operador mira el recorte. Hay que medirlo en Android físico (§6).

---

## 5. Pruebas ejecutadas (emulación Android: Chromium, Pixel 7)

Verificación final en `fix/scanner-quality` (ver el commit de la corrección):

| Control | Resultado |
|---|---|
| TypeScript (`tsc --noEmit`) | ✅ 0 errores |
| Unitarias (`vitest`) | ✅ **160/160** en 16 archivos · 0 fallidas · 0 omitidas |
| Build de producción | ✅ |
| `check:dist` | ✅ 27 entradas de precaché · 16 archivos OCR (71,6 MB) idénticos al origen |
| E2E Playwright | ✅ **38/38** · 0 fallidas · 0 omitidas (incluye el visor en vivo, §2.2) |
| `check:private` | ✅ 17 patrones, 0 coincidencias |

**Pruebas E2E de la decisión de recorte** (`e2e/scanner-review.spec.ts`, 9 casos):
1. **Confianza alta:** el recorte se ve pero ningún botón está pulsado. «Guardar y salir» y «Guardar y siguiente» **no guardan** (0 capturas). Una pulsación en «Usar recorte automático» lo acepta, y se guarda `auto` con las esquinas aprobadas.
2. **Confianza baja** (tarjeta que toca el borde): «Bordes dudosos — decida». Guardar sin decidir no guarda. El operador elige la foto completa, y se guarda `full` con el diagnóstico `low_confidence`.
3. **El guardado no se adelanta al análisis.** El escáner se ralentiza a 6 s para garantizar la comprobación durante el análisis. Con «Analizando bordes…» ya visible:
   - el original está en IndexedDB;
   - «Usar recorte automático» está desactivado; «Conservar foto completa» y «Ajustar» están activos;
   - guardar no guarda.

   Al terminar el análisis tampoco se acepta nada solo. Una decisión tomada durante el análisis no la pisa el resultado.
4. **Escáner colgado** (no responde): no bloquea. Aparece «El escáner no respondió», y la foto completa se guarda con el tamaño leído de la foto.
5. **Anverso y reverso:** con solo el reverso decidido, no se guarda. La app lleva al anverso pendiente, y se guardan `manual` y `auto` por separado.
6–9. Foto completa, ajuste con lupa, foto sin bordes (sin propuesta; el operador elige) y repetir foto sin perder el borrador.

**Unitarias nuevas:**
- `auto` viaja al escáner como recorte aprobado; `manual` y `full` viajan como esquinas exactas, y lo aprobado queda registrado (`tests/scanner-pipeline.test.ts`);
- regresión de sincronización (§2.1).

**El resto de E2E** usan el ayudante `e2e/support/crop.ts`, que decide como lo haría un operador. Incluye:
- tarjetas reales privadas R1, con recorte aceptado y extracción comercial exacta;
- actualización desde v1.0.0: el borrador antiguo sin decisión la pide.

---

## 6. Plan de aceptación en Android físico (solo el propietario puede darlo por completado)

**Dónde:** `https://colescomex-capture-preview.web.app`, la vista previa de pruebas que ya existía. Se abre **solo en Chrome**, sin instalar la app.

**Por qué es segura:**
- tiene origen propio, distinto de la app de producción (`edergope.github.io`), así que no ve ni modifica sus capturas;
- usa la base de datos aislada `colescomex-canton-capture--preview`;
- muestra la franja «VISTA PREVIA · preview · datos aislados»;
- el acceso y la sincronización son **simulados**: nada sale del teléfono y no se escribe en Drive ni en Sheets. Si aparece «Confirmado en Google», es una simulación.

**Antes de empezar:** en Ajustes → Versión debe verse **1.2.2**, con la compilación del commit entregado. Si la pestaña ya estaba abierta, ciérrala y vuelve a abrir la dirección.

| # | Prueba | Esperado |
|---|---|---|
| 1 | **Tarjeta blanca** sobre mesa | «Recorte propuesto — decida». Guardar sin decidir **no guarda** y muestra «Falta decidir el recorte». Una pulsación en «Usar recorte automático» lo acepta y guarda. El texto no queda cortado. |
| 2 | **Tarjeta oscura o negra** | Recorte propuesto correcto, o «Bordes dudosos — decida». Nunca un recorte dentro del logotipo. |
| 3 | **Tarjeta con reflejos** | «Bordes dudosos» o «No se encontraron los bordes». Probar **Ajustar manualmente**: arrastrar las 4 esquinas con la lupa. Valorar si es fácil colocar cada esquina con el dedo. |
| 4 | Anverso y reverso | Decidir solo una cara y pulsar guardar: la app lleva a la cara pendiente. |
| 5 | Guardar en cuanto aparece «Analizando bordes…» | No guarda. «Conservar foto completa» funciona de inmediato. |
| 6 | Captura guardada → Documento | El recorte coincide con el aprobado. La ficha indica la decisión («Recorte automático aceptado por usted», «Esquinas ajustadas por usted» o «Foto completa»). |
| 7 | Tiempo | Segundos desde el disparo hasta ver el recorte, en tu teléfono. |

Anota, por cada tarjeta, el estado mostrado, la decisión tomada y si el recorte final era correcto. Si algo falla, una captura de pantalla de la vista previa (es de prueba, sin datos de producción).

---

## 7. Sin pérdida de datos

- **Sincronización:** la foto original ya no puede publicarse en la carpeta del proveedor antes de recortarse (§2.1).
- **Base de datos sin cambios.** Base `colescomex-canton-capture`, esquema 1, sin migración. Los campos nuevos (`Evidence.crop`) son **opcionales**: las capturas anteriores se leen igual y muestran «Recorte automático · sin revisar».
- **Original intacto.** Se guarda antes de cualquier proceso, y el editor de esquinas trabaja sobre él sin modificarlo.
- **Sin reproceso masivo.** No hay reproceso automático de capturas históricas, ni sustitución de archivos en Drive, ni escrituras en Sheets de producción. El ajuste de recorte es individual, a petición del operador, y conserva los campos bloqueados por corrección humana.
- **Nada cambia en la identidad de la app:** misma URL, mismo manifiesto, mismo alcance del Service Worker y mismos identificadores de almacenamiento.
- **Actualización probada.** Las 7 pruebas de `pwa-update.spec.ts` (v1.0.0 → 1.2.2 y v1.2.0 → 1.2.2, entre otras) verifican que borradores, fotos y capturas sobreviven a la actualización.

---

## 8. Limitaciones y lo que necesito

- **Escenas sintéticas.** El banco usa escenas sintéticas más 8 fotos reales. Para afinar tarjetas metálicas, reflejos y bloques oscuros hacen falta fotos reales de esos casos.
- **Petición.** Por favor, 2–3 pares de fotos tomadas con tu teléfono: el original de la cámara y el resultado procesado que te pareció malo. Se guardarán **solo en local** (`ocr-eval/scanner-fixtures/`, ignorado por git) y nunca se subirán a GitHub.
- **Sin Android físico.** No se ha probado en Android físico, red móvil ni TalkBack. No se declara aprobado.
