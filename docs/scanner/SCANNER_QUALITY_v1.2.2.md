# Smart Document Scanner — corrección prioritaria (v1.2.2)

- **Rama:** `fix/scanner-quality`, creada desde la producción v1.2.1 (`580ea95`).
- **Estado:** lista para revisión. **No publicada.** No se tocó `main` ni `gh-pages`, y no hubo despliegue.
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

**Flujo profesional:** capturar → proteger el original → detectar → **mostrar el recorte real** → aprobar o ajustar → OCR.

- **Protección inmediata.** El original se guarda en IndexedDB nada más tomar la foto («Captura protegida…»).
- **Vista previa real.** Usa el mismo worker, el mismo detector y la misma perspectiva que el proceso final (`fullSide` 2000). Lo que se aprueba es lo que se procesa: las esquinas aprobadas viajan como `manual_quad`.
- **Panel de revisión** con tres opciones:
  - **Usar recorte automático** (desactivado si no hay propuesta);
  - **Ajustar manualmente**;
  - **Conservar fotografía completa**.
- **Ver antes de decidir.** Se puede alternar entre el recorte y el original con la propuesta superpuesta.
- **Editor de 4 esquinas:**
  - arrastre táctil;
  - **lupa ×3** con retícula, en el lado opuesto al dedo;
  - control por teclado (accesible);
  - botones «Aplicar», «Foto completa» y «Volver a automático».
- **Estados de confianza claros:**
  - «Recorte automático — revíselo»;
  - «Bordes dudosos»;
  - «No se encontraron los bordes»;
  - «Hay varias tarjetas en la foto»;
  - «Esquinas ajustadas por usted»;
  - «Foto completa»;
  - «El escáner no respondió».

  Ningún estado dice «validado» sin una decisión del operador. La pista en vivo pasa de «Tarjeta detectada» a «**Bordes visibles**».
- **Si el detector duda o no encuentra bordes:** no se propone recorte y por defecto se conserva la **foto completa**. Nunca se inventan esquinas.
- **Repetir la foto** sustituye solo esa cara. El resto del borrador se conserva.
- **Decisión trazable.** Se guarda en la evidencia (`Evidence.crop`: decisión, fecha, autor y estado del detector) y queda en la auditoría.
- **Capturas guardadas.** Desde el documento se puede ajustar el recorte, volver a automático o conservar la foto completa, caso por caso.

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

Verificación final del 23-10-2026 en `fix/scanner-quality`:

| Control | Resultado |
|---|---|
| TypeScript (`tsc --noEmit`) | ✅ 0 errores |
| Unitarias (`vitest`) | ✅ **158/158** · 0 fallidas · 0 omitidas |
| Build de producción | ✅ |
| `check:dist` | ✅ 27 entradas de precaché verificadas |
| E2E Playwright | ✅ **33/33** · 0 fallidas · 0 omitidas |
| `check:private` | ✅ 17 patrones, 0 coincidencias |

Pruebas nuevas en `e2e/scanner-review.spec.ts`:
1. protección inmediata más vista previa del recorte real;
2. conservar la foto completa;
3. ajuste manual con lupa;
4. foto sin bordes: no hay propuesta y por defecto se conserva la foto completa;
5. repetir la foto conserva el borrador.

También siguen pasando:
- `pwa-update.spec.ts`: actualización desde v1.0.0 y v1.2.0, con capturas en curso y ediciones sin guardar;
- la prueba estricta de precisión del detector sobre R1 (`tests/scanner-detect.test.ts`).

---

## 6. Plan de aceptación en Android físico (solo el propietario puede darlo por completado)

Con la app de prueba, nunca la de producción mientras no se autorice la publicación:

1. **Tarjeta blanca sobre mesa clara**
   - Esperado: «Recorte automático — revíselo».
   - El recorte no corta texto.
   - «Usar recorte automático» → el OCR lee la tarjeta.
2. **Tarjeta oscura o negra sobre mesa**
   - Esperado: recorte correcto, o «Bordes dudosos» con propuesta.
   - Nunca un recorte dentro del logotipo.
3. **Tarjeta metálica o con reflejo**
   - Esperado: «Bordes dudosos» o «No se encontraron los bordes».
   - Con «Ajustar manualmente» y la lupa se colocan las 4 esquinas, y el OCR procesa exactamente ese recorte.
4. **Tarjeta sujeta con los dedos**
   - El recorte no incluye los dedos, o pide revisión.
5. **Dos tarjetas en la foto**
   - Debe aparecer «Hay varias tarjetas en la foto».
6. **Tarjeta vertical y foto en perspectiva**
   - Recorte correcto y texto derecho.
7. **Repetir la foto del reverso**
   - El anverso y los datos del borrador siguen ahí.
8. **Conservar foto completa**
   - La ficha muestra «Foto completa (sin recorte)».
9. **Captura guardada → Documento → Ajustar recorte**
   - Cambia solo esa captura.
   - Los campos corregidos a mano se conservan.
10. **Tiempo**
    - Desde el disparo hasta ver el recorte: anotar los segundos en un teléfono de gama media.

---

## 7. Sin pérdida de datos

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
