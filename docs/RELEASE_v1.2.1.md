# COLESCOMEX Canton Fair Capture v1.2.1 — entrega final

**Responsable técnico:** Claude.

- **Rama:** `release/v1.2.1`. Integra `fix/claude-pwa-update-audit` y la integración de Antigravity (`integrate/v1.2.1-pwa-update` hasta `c873d8f`, con su historial conservado).
- **Estado:** listo para publicar. **No publicado**: requiere tu autorización expresa.

Documentos de referencia:

- diagnóstico: [PWA_UPDATE_AUDIT.md](PWA_UPDATE_AUDIT.md);
- detalle técnico de integración: [ANTIGRAVITY_PWA_HANDOFF.md](ANTIGRAVITY_PWA_HANDOFF.md).

---

## 1. Pruebas ejecutadas (23-10-2026, `release/v1.2.1`)

| Control | Resultado |
|---|---|
| TypeScript (`tsc --noEmit`) | ✅ 0 errores |
| Unitarias (`vitest`) | ✅ **149/149** en 15 archivos · 0 fallidas · 0 omitidas |
| Build de producción (`npm run build`, configuración real de producción) | ✅ |
| Artefacto publicable (`check:dist`) | ✅ 27 entradas de precaché · 16 archivos OCR (71,6 MB) idénticos al origen · SW con activación automática · sin secretos · 45 fixtures privados comparados sin coincidencias |
| E2E Playwright (Chromium, Pixel 7) | ✅ **28/28** · 0 fallidas · 0 omitidas (desglose abajo) |
| Datos privados (`check:private`) | ✅ 17 patrones, 0 coincidencias |
| Simulacro de despliegue (`npm run deploy:dry-run`) | ✅ v1.2.1, compilación del commit, 2 assets retenidos de la v1.2.0, `check:dist` OK. Nada publicado |
| Configuración del build de producción frente a la v1.2.0 publicada | ✅ Idéntica: hoja, carpetas de evidencias y originales, cliente OAuth, usuarios. Sin recursos de QA |
| Google QA **real**, solo lectura (`scripts/verify-qa-drive-links.mjs`) | 4 PASS · 2 FAIL (ver §3). No se escribió nada |

**Desglose de las 28 E2E:**

| Archivo | Casos | Notas |
|---|---|---|
| `00-hermetic.spec.ts` | 1 | Guardián hermético (ver abajo) |
| `capture.spec.ts` | 5 | OCR PaddleOCR real y tarjeta real privada R1 |
| `ux.spec.ts` | 14 | |
| `camera-live.spec.ts` | 1 | |
| `pwa-update.spec.ts` | 7 | Ver abajo |

**Guardián hermético.** El build de pruebas no contiene IDs reales y usa Google simulado. En el control negativo, sin entorno hermético, se filtraban 13 identificadores reales de los `.env` locales; ahora 0.

**Escenarios de `pwa-update.spec.ts`:**

1. v1.0.0 → 1.2.1;
2. v1.2.0 → 1.2.1;
3. captura en curso;
4. edición sin guardar;
5. descarga interrumpida;
6. otro origen (Firebase);
7. publicación sin activación automática.

Usan los artefactos realmente publicados (`deployed/v1.0.0` = `9945243`, `deployed/v1.2.0` = `d6d8cd3`) y **datos sintéticos** (referencias `CF26F2-EDR-T3ST-…`), nunca capturas reales.

**No ejecutado** (no se declara aprobado):

- Android físico / WebAPK;
- red móvil;
- TalkBack;
- **escritura** en Google real: la sesión `gws` disponible solo tiene `drive.readonly`. Una prueba de escritura en QA requiere que tú concedas en el navegador los permisos de Drive y Sheets al cliente OAuth existente.

---

## 2. Qué recibe tu app instalada

Misma URL, mismo manifiesto (`id`/`scope`/`start_url` = `./`, nombre «CX Capture») y misma base IndexedDB (`colescomex-canton-capture`, esquema 1): **no se reinstala**.

Recibe:

- la interfaz nueva;
- Smart Document Scanner (recorte, perspectiva y orientación);
- PaddleOCR con la extracción mejorada;
- la revisión inteligente;
- la sincronización corregida;
- versión visible (Ajustes y acceso);
- actualizaciones futuras automáticas y seguras.

**La transición desde la v1.0.0:**

- la app se recargará **una vez** por su propio código antiguo;
- las fotos ya tomadas y los borradores están en IndexedDB y se recuperan (verificado byte a byte con el artefacto v1.0.0 real);
- solo se perdería una foto que esté dentro de la cámara del sistema en ese instante.

---

## 3. Datos históricos que podrían verse afectados por reparaciones

| Entorno | Hallazgo (solo lectura) | Qué hará la v1.2.1 |
|---|---|---|
| **Producción** (hoja `1UI5…`) | 2 filas, ambas escritas por la **v1.0.0**. 0 con respaldo restringido. **0 afectadas**. 0 `capture_uuid` duplicados | **Nada automático.** Si alguna captura del teléfono estuviera afectada, Ajustes mostrará «Enlaces de Drive por revisar» y solo se repara al pulsar el botón y confirmar. La v1.0.0 nunca escribió los campos implicados, así que se esperan 0 |
| **QA** (hoja `1XZIN…`) | 1 fila (v1.1.0, tarjeta sin recorte) cuyo enlace «principal» apunta al **archivo del respaldo**. La carpeta del proveedor está vacía: es el defecto de la v1.1, confirmado en Google real | En el navegador de QA que tiene esa captura se repara **automáticamente** al abrir la v1.2.1: vuelve a subir a la carpeta del proveedor y corrige la fila, sin borrar nada |

La reparación **nunca borra** archivos de Drive ni toca campos editados por personas.

---

## 4. Publicación (solo con tu autorización)

```bash
git switch main
git merge --ff-only release/v1.2.1
git push origin main
npm run deploy
```

Si `main` avanzó, se integra con `--no-ff`; nunca con `--force`. `npm run deploy` hace, por orden: build de producción, retención de assets, `check:dist` (bloquea si falla) y publicación en `gh-pages`.

Tras unos 10 minutos (caché de GitHub Pages), comprueba:

- `https://edergope.github.io/colescomex-canton-capture/version.json` → `1.2.1` y la compilación del commit;
- que `sw.js` contiene `self.skipWaiting()` y `clientsClaim()`.

**Reversión:** los datos del teléfono no se tocan en ningún caso.

1. Revertir el merge en `main` (`git revert -m 1 …`).
2. Mantener en `vite.config.ts` la activación automática del SW, porque si no la reversión no llegaría a los teléfonos.
3. Subir la versión (1.2.2) y volver a desplegar.

Nunca: desinstalar, borrar datos del sitio, eliminar IndexedDB ni cambiar la URL.

---

## 5. Comprobación en tu teléfono (solo tú puedes darla por completada)

### A. Origen de la app (antes de actualizar, sin borrar nada)

- El nombre bajo el icono debe ser «**CX Capture**». «CX PREVIEW» sería la vista previa de Firebase.
- En Chrome → ⋮ → Configuración → Configuración de sitios → Todos los sitios, `edergope.github.io` debe tener datos (cientos de MB). **No pulses «Borrar».**
- Tras actualizar, **Ajustes → Versión y actualizaciones → Dirección** mostrará `edergope.github.io/colescomex-canton-capture/`.

### B. Antes de actualizar

Abre la app con Wi-Fi y pulsa **Sincronizar**.

### C. Actualizar

1. Quédate en **Inicio** de 1 a 2 minutos, sin capturar. La app se recarga sola una vez.
2. Si no cambia: ciérrala desde Recientes, cierra las pestañas de Chrome de ese sitio y reábrela.

### D. Aceptación

1. **Ajustes → Versión y actualizaciones:** **1.2.1**, con la misma compilación que `version.json`. Estado «Al día».
2. **Interfaz nueva:** navegación inferior con el botón central de cámara.
3. **Proveedores:** siguen `CF26F2-EDR-HDHG-0001` y `-0002`, con sus datos.
4. **Cámara:** fotografía una tarjeta real. La vista previa indica los bordes y la captura se guarda con «Captura protegida en este dispositivo».
5. **OCR:** en pocos segundos aparecen empresa, contacto y teléfonos. Revisa lo que marque como dudoso.
6. **Drive:** la carpeta del proveedor contiene `…_scan.jpg` y ORIGINALES_FASE2 contiene el original.
7. **Sheets:** una fila por proveedor, sin duplicados, con los enlaces a esos archivos.
8. **Futuras actualizaciones:** cuando se publique otra versión, aparecerá «Nueva versión lista» y se aplicará sola en un momento seguro, sin reinstalar.

Si algo falla: **Ajustes → Copiar diagnóstico** (sin datos personales) y envíamelo.
