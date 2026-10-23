# Traspaso UX v1 → Antigravity

**Rama:** `feat/ux-mobile-scanner-v1`

- **Base:** `0a2368258f4ec3dc643a509dcaa648f2b8dc2c8f`.
- **No toca** `main` ni `integrate/smart-scanner-prod`.
- **Producción:** no se ha publicado nada. No se usó ningún recurso de Google (Drive, Sheets ni OAuth) durante el trabajo.

## 1. Qué cambia

Solo la capa de presentación y sus pruebas.

| Ruta | Cambio |
|---|---|
| `src/ui/views.ts` | Reescrito: es el armazón (rutas, navegación, refresco en vivo y restauración de pantalla tras recargar). Mantiene `new UI(root, app, info)` y `start()` |
| `src/ui/styles.css` | Reescrito: sistema de diseño claro/oscuro |
| `src/ui/dom.ts` | Ampliado: toast accesible, hojas o diálogos, `confirmSheet`, `LazyThumbs` |
| `src/ui/{icons,theme,model,components,features,camera}.ts` | Nuevos |
| `src/ui/camera-hint.worker.ts` | Nuevo |
| `src/ui/screens/*.ts` | Nuevos: login, home, list, detail, document, corners, review, sync, settings, capture, shared |
| `e2e/capture.spec.ts` | Selectores actualizados al nuevo flujo; las aserciones de datos no cambian |
| `e2e/ux.spec.ts`, `e2e/camera-live.spec.ts`, `e2e/support/seed.ts` | Nuevos |
| `tests/ui-design.test.ts` | Nuevo: contraste de tokens y modelo de presentación |
| `docs/ux/*` | Documentación y capturas (solo datos ficticios) |

### Sin cambios (verificable)

```bash
git diff --stat 0a2368258f4ec3dc643a509dcaa648f2b8dc2c8f..feat/ux-mobile-scanner-v1 -- src/adapters src/sync src/scanner src/storage src/pipeline src/extract src/ocr src/app src/domain src/config src/main.ts firebase.json .firebaserc vite.config.ts package.json
```

La salida debe estar **vacía**: no hay cambios en adaptadores de Google, OAuth, IDs de Drive o Sheets, Firebase, esquema de Sheets, deduplicación, sincronización, OCR, escáner ni almacenamiento.

## 2. Cómo usa la UI los contratos existentes

La UI solo llama a `CaptureApp` y lee el repositorio local. **Nunca** llama a las APIs de Google.

| Pantalla | Llamadas |
|---|---|
| Acceso | `auth.allowedUsers()`, `auth.signIn(id)`, `auth.currentUser()` |
| Cámara / guardar | `saveCapture(evidences, quick)`. Borrador en `repo.setMeta('draft:<userId>')`, el mismo formato que la versión anterior |
| Ficha | `repo.get/evidences/audit/ocrResults`, `editFields`, `confirmReview` (solo tras diálogo explícito), `reprocessOcr` |
| Documento | `repo.evidences`, `setManualCorners(evidenceId, quad \| undefined)`, `reprocessOcr` |
| Revisión | `reviewItems()` (modelo puro), `editFields({campo: valor})` por cada decisión; `confirmReview` solo con confirmación |
| Sincronización | `syncNow(true)` (reintento forzado, idempotente), `auth.signIn` para reconectar, `storagePressure()` |
| Ajustes | `governor.setProfile()`, `auth.signOut()` (no borra datos locales), `storagePressure()` |

La pista de encuadre en vivo usa el detector real `detectDocument` (`src/scanner/detect.ts`) en un Worker propio de la UI, **sin modificarlo**. Es solo orientativa: el recorte definitivo lo sigue haciendo la tubería del motor tras guardar.

## 3. Interfaces que la UI necesitaría (propuestas, NO implementadas)

Para no crear un segundo motor ni tocar el almacenamiento estructural, estas funciones quedan **fuera** de la v1.

| # | Necesidad UX | Interfaz propuesta | Mientras tanto |
|---|---|---|---|
| 1 | «Repetir foto» de una captura ya guardada | `CaptureApp.replaceEvidence(captureUuid, kind, blob): Promise<void>` (conserva el original anterior como superseded y audita) | Se repite la foto antes de guardar; tras guardar, el texto indica capturar de nuevo |
| 2 | Añadir stand, producto o catálogo a una captura guardada | `CaptureApp.addEvidence(captureUuid, kind, blob)` | Solo durante la captura |
| 3 | Estado global «Subiendo a Google» y hora del último envío | `SyncEngine.onState(cb: {running, lastRun, lastReport})` | Se deriva de `sync_status` por captura; el último informe solo se recuerda en la sesión |
| 4 | Distinguir «escaneando» de «leyendo texto» | `Capture.ocr_stage?: 'scan' \| 'ocr'` o evento del `ResourceGovernor` | Se muestra «Procesando documento» |
| 5 | Reconectar Google sin elegir usuario | `AuthAdapter.reconnect()` | `auth.signIn(user.id)` |
| 6 | Tipos de documento (fichas, facturas, cotizaciones, catálogos) | `saveCapture(..., { profile })` con `DocumentProfile` | Selector oculto tras `localStorage['cx.features']='documentTypes'`, sin efecto funcional |

## 4. Integración sugerida (para Antigravity)

1. Revisar el PR de `feat/ux-mobile-scanner-v1` contra `integrate/smart-scanner-prod`. No hay conflictos esperables fuera de `src/ui/` y `e2e/capture.spec.ts`.
2. En la rama de integración:

   ```bash
   npm test && npm run build && npm run test:e2e && npm run check:private
   ```

3. Validar en un Android real (vista previa aislada, nunca producción):
   - cámara en vivo con permiso concedido y denegado (alternativa: cámara del sistema o galería);
   - linterna, si el dispositivo la expone;
   - zonas seguras con gestos y con barra de navegación;
   - modo oscuro del sistema;
   - instalación como PWA.
4. El texto «Captura protegida en este dispositivo» sustituye a «Guardado en el teléfono». La UI **no** afirma «Confirmado en Google» hasta `sync_status === 'CONFIRMADO'`.

## 5. Pendientes y riesgos conocidos

- **Referencia visual:** la imagen de Amigo GPT no se recibió; el acabado se basa en las directrices escritas.
- **Pruebas en dispositivo real:** no se probó en un Android físico. Se usó emulación de Chromium (360×740 y 412×915) y la cámara simulada de Chromium.
- **Sin axe-core:** no hay dependencia de axe. La auditoría de accesibilidad es propia: nombres accesibles, etiquetas, alt, tamaño táctil, desbordes y contraste de tokens. Conviene una pasada con TalkBack.
- **Servidor de desarrollo en el worktree:** con `node_modules` enlazado fuera de la raíz, Vite (dev) no sirve el worker de PaddleOCR. No afecta al build: el E2E usa `dist` y pasa con OCR real.

## 6. Resultados de verificación (22-10-2026, rama `feat/ux-mobile-scanner-v1`)

| Comando | Resultado |
|---|---|
| `npm test` | ✅ 125/125: incluye `tests/ui-design.test.ts` (40 pares de contraste y el modelo de presentación) |
| `npm run build` | ✅ |
| `npm run test:e2e` | ✅ 20/20: `capture.spec.ts` (5, con OCR real y la tarjeta real privada R1), `ux.spec.ts` (14) y `camera-live.spec.ts` (1) |
| `npm run check:private` | ✅ Sin datos reales en el árbol versionado |

Cobertura E2E de UX:

- **Dispositivos y tema:** Android pequeño (360×740) y grande (412×915) × claro/oscuro, con auditoría de accesibilidad y desbordes en 9 pantallas.
- **Cámara:**
  - en vivo con dispositivo simulado;
  - anverso y reverso;
  - capturas consecutivas en menos de 3 s.
- **Estados mostrados:** OCR pendiente, correcto y en revisión; Google pendiente, confirmado y con error; sin conexión.
- **Recuperación y edición:**
  - borrador recuperado tras recargar;
  - esquinas manuales;
  - edición humana bloqueada;
  - revisión sin aprobación automática.
- **Sincronización y escala:**
  - reintento sin filas duplicadas;
  - 150 proveedores con render incremental.
- **Ajustes y futuro:**
  - tema persistido;
  - cierre de sesión sin pérdida de datos;
  - tipos de documento ocultos.
