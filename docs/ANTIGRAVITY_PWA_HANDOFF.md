# Traspaso a Antigravity — corrección de actualización PWA (v1.2.1)

**Rama a integrar:** `fix/claude-pwa-update-audit`. Está publicada en GitHub; el SHA figura en el informe final.

- **Base:** `v1.2.0` (`6c0c9d0`).
- **Diagnóstico completo:** [PWA_UPDATE_AUDIT.md](PWA_UPDATE_AUDIT.md).

---

## 1. Qué integrar y qué conservar

Integre la rama completa. Archivos clave:

| Área | Archivos |
|---|---|
| Activación del SW | `vite.config.ts` (`skipWaiting` y `clientsClaim`, `version.json`, identificador de compilación) |
| Actualización segura | `src/pwa/update.ts`, `src/pwa/safety.ts`, `src/main.ts`, `src/ui/views.ts`, `src/ui/screens/settings.ts`, `src/ui/screens/login.ts`, `src/ui/dom.ts`, `src/ui/screens/capture.ts`, `src/ui/styles.css` |
| Señales de actividad | `src/pipeline/ocrQueue.ts` y `src/sync/SyncEngine.ts` (`busy`) |
| Drive | `src/adapters/google.ts`, `src/adapters/mock.ts`, `src/storage/repo.ts` (`moveMainLinkToArchive`), `src/sync/SyncEngine.ts` (`repairMisfiledEvidence`), `src/app/service.ts` |
| Despliegue | `scripts/deploy-pages.mjs`, `scripts/lib/retain-assets.mjs`, `scripts/check-dist.mjs`, `package.json` (`check:dist`, versión 1.2.1) |
| Pruebas | `tests/drive-sync-regression.test.ts`, `tests/pwa-safety.test.ts`, `tests/retain-assets.test.ts`, `tests/support/fake-google.ts`, `e2e/pwa-update.spec.ts` |
| Documentación | `docs/PWA_UPDATE_AUDIT.md`, este documento |

---

## 2. Conflicto con sus cambios locales

Su `main` local tiene el commit **`15fe3b3`**, no publicado. Lo comprobé con `git merge-tree`, sin tocar su checkout:

| Archivo | Resultado al fusionar | Qué hacer |
|---|---|---|
| `vite.config.ts` | ✅ Se fusiona solo: las líneas `skipWaiting: true` / `clientsClaim: true` son idénticas | Nada |
| `tests/google-adapters.test.ts` | ✅ Se fusiona solo; su prueba nueva se conserva | Nada |
| `src/main.ts` | ❌ **Conflicto** | Quedarse **con la versión de esta rama**: elimine el bloque `controllerchange → window.location.reload()` y el `registerSW` antiguo. El `UpdateManager` ya cubre esa función sin recargar en momentos inseguros |

Pasos sugeridos (sin `--force` y sin reescribir historia):

```bash
git fetch origin
git switch main
git merge --no-ff origin/fix/claude-pwa-update-audit
```

Si `src/main.ts` queda en conflicto, tome la versión de la rama:

```bash
git checkout --theirs src/main.ts
git add src/main.ts
git commit
```

---

## 3. Pruebas tras fusionar (todas obligatorias)

```bash
npm ci
npx tsc --noEmit
npm test
npm run build
npm run check:dist
npm run test:e2e
npm run check:private
```

`e2e/pwa-update.spec.ts` usa los artefactos **realmente publicados** antes. En su clon, cree las etiquetas **locales**; no hace falta publicarlas:

```bash
git tag deployed/v1.0.0 9945243
git tag deployed/v1.2.0 d6d8cd3
```

- Si los objetos no están en su clon, `git fetch origin` no los traerá, porque `gh-pages` se publica con push forzado.
- En ese caso los 2 escenarios que dependen de ellos se **omiten** y lo indican. Los otros 4 se ejecutan siempre.

---

## 4. Precauciones con el Service Worker y los assets

- **No publique nunca** un `sw.js` sin activación automática. `npm run check:dist` falla si falta. Ejecútelo siempre antes de `npm run deploy`.
- **No despliegue `15fe3b3` tal cual**: su recarga incondicional puede interrumpir capturas.
- **Retención de assets.** `npm run deploy` conserva **una versión** de los chunks y modelos anteriores (`retained-assets.json`). No los borre a mano del `gh-pages` publicado.
- **Modelos OCR.** No cambie los nombres ni el contenido de `public/ocr-assets` sin necesidad. Con contenido idéntico, el precaché los reutiliza: de v1.2.0 a v1.2.1 hay 0 descargas de modelos.
- **Caché del servidor.** GitHub Pages sirve `sw.js` con `max-age=600`: espere hasta 10 minutos tras desplegar antes de validar en el teléfono.
- **No cambie** la URL, el alcance (`/colescomex-canton-capture/`), `base: './'`, `manifest.id` ni el nombre de la base IndexedDB. Cualquiera de esos cambios separaría la app instalada de sus datos.
- **Vista previa (Firebase).** Es otro origen, sigue en 1.1.0 y no afecta al teléfono. Si la actualiza, hágalo desde esta misma rama.

---

## 5. Verificar en la PWA instalada (Android del propietario)

1. **Antes:** abra la app con Wi-Fi y pulse **Sincronizar**.
2. **Confirmar el origen:**
   - el icono dice «**CX Capture**»;
   - en Chrome → Configuración de sitios → Todos los sitios, `edergope.github.io` tiene datos.
   - **No borre nada.**
3. **Actualizar:** abra la app, quédese en **Inicio** de 1 a 2 minutos y espere la recarga automática, que ocurre una vez. Si no cambia, ciérrela desde Recientes, cierre las pestañas de ese sitio en Chrome y reábrala.
4. **Comprobar:**
   - **Ajustes → Versión y actualizaciones** muestra **1.2.1**, con una compilación igual a la de `https://edergope.github.io/colescomex-canton-capture/version.json`;
   - las capturas `CF26F2-EDR-HDHG-0001` y `-0002` siguen en Proveedores;
   - una tarjeta nueva se recorta y se lee;
   - Drive tiene `_scan.jpg` en la carpeta del proveedor y el original en ORIGINALES;
   - Sheets actualiza la misma fila;
   - sin conexión, la app abre y lee una tarjeta.
5. Si algo falla: **Ajustes → Copiar diagnóstico** (no contiene datos personales) y adjúntelo.

---

## 6. Reversión si la actualización falla

**Los datos no corren peligro.** Ninguna versión borra IndexedDB, y la reversión es solo de código.

1. **Error de interfaz o de flujo.**
   - Revierta el merge con `git revert -m 1 <merge>` sobre `main`, **conservando** en `vite.config.ts` las dos líneas `skipWaiting` y `clientsClaim`. Si no, la reversión no llegará a los teléfonos.
   - Suba la versión (p. ej. 1.2.2), ejecute `check:dist` y despliegue.
   - Los teléfonos con 1.2.1 la recibirán por el mismo mecanismo seguro.
2. **La app no arranca.** La 1.2.1 registra el SW antes del arranque y muestra «Buscar actualización», así que una versión corregida llega igualmente. No pida desinstalar ni borrar datos.
3. **SW en espera.** Si alguna publicación futura olvidara la activación automática, las páginas 1.2.1+ igualmente activan el SW en espera (`SKIP_WAITING`) en un momento seguro.
4. **Nunca** use como solución desinstalar la app, borrar la caché del sitio, eliminar IndexedDB ni cambiar de URL.

---

## Resultados

Verificación integral del 23-10-2026 en la rama, worktree limpio y artefactos recompilados.

| Control | Comando | Aprobadas | Fallidas | Omitidas |
|---|---|---|---|---|
| TypeScript | `npx tsc --noEmit` | ✅ sin errores | 0 | — |
| Pruebas unitarias | `npx vitest run` | **147** (15 archivos) | 0 | 0 |
| Compilación | `npm run build` | ✅ | — | — |
| Artefactos publicables | `npm run check:dist` | ✅ | 0 problemas | — |
| E2E (Playwright, Chromium Pixel 7) | `npx playwright test` | **27** | 0 | 0 |
| Datos privados | `npm run check:private` | ✅ 17 patrones, 0 coincidencias | — | — |

**Pruebas unitarias.** Incluyen:

- 9 de Drive/Sheets a través de `SyncEngine` (simulación);
- 10 de la sonda de seguridad;
- 2 de retención de assets;
- las del núcleo, escáner, extracción y adaptadores.

**`check:dist`.** Verifica 27 entradas del precaché y 16 archivos OCR (71,6 MB) idénticos al origen. Revisa además 38 archivos sin encontrar secretos y los compara con 45 fixtures privados, sin coincidencias.

**Pruebas E2E por archivo:**

| Archivo | Casos |
|---|---|
| `capture.spec.ts` | 5, con OCR PaddleOCR real y la tarjeta **real privada R1** (fixtures disponibles en esta máquina) |
| `ux.spec.ts` | 14 |
| `camera-live.spec.ts` | 1 |
| `pwa-update.spec.ts` | 7, con los artefactos publicados v1.0.0 y v1.2.0 (ver abajo) |

Los 7 escenarios de `pwa-update.spec.ts`:

1. v1.0.0 → nueva;
2. v1.2.0 → nueva;
3. sin recarga durante la captura;
4. descarga interrumpida con reintento automático;
5. edición sin guardar;
6. otro origen (Firebase);
7. publicación sin activación automática.

**No ejecutado** (no se declara como superado):

- Android físico y WebAPK instalada;
- TalkBack;
- red móvil real;
- Google Drive y Sheets reales.
