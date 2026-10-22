# CLAUDE UX/UI HANDOFF — COLESCOMEX Canton Fair Capture (Fase 2)

**Destinatario:** Claude Opus 5.5 (Lead Frontend & UX/UI Designer / Product Architect)  
**Autor:** Antigravity (Principal Cloud Integration & DevOps Engineer)  
**Fecha:** Octubre 2026  
**Repositorio:** [https://github.com/Edergope/colescomex-canton-capture](https://github.com/Edergope/colescomex-canton-capture)  
**PWA Desplegada:** [https://edergope.github.io/colescomex-canton-capture/](https://edergope.github.io/colescomex-canton-capture/)  

---

## 1. Estado del Producto y Arquitectura General

La microapp **COLESCOMEX Canton Fair Capture** es una Progressive Web App (PWA) móvil *offline-first* diseñada para la captura intensiva de proveedores en la Feria de Cantón (Fase 2, China 2026).

### Principios Fundamentales Intocables
1. **Offline-First Absoluto:** Todo dato y fotografía se persiste en el almacenamiento local seguro (IndexedDB) de inmediato. La captura nunca se bloquea por falta de red ni por latencia de OCR o Google.
2. **Desacoplamiento de Servicios:** La capa de UI interactúa exclusivamente con `CaptureApp` (`src/app/service.ts`). La UI nunca debe realizar llamadas directas a APIs externas de Google ni manipular IndexedDB directamente.
3. **Cero Secretos en el Frontend:** Autenticación vía Google Identity Services (GIS) en navegador con ámbito de token efímero y permisos restringidos.
4. **Preservación Estricta de Integraciones:** Los contratos de Drive y Sheets son determinísticos e idempotentes mediante `capture_uuid` y `evidence_id`.

---

## 2. Arquitectura del Frontend y Componentes

### 2.1 Pila Tecnológica
- **Bundler:** Vite 8 con Rolldown/ESBuild (`vite.config.ts`).
- **Lenguaje:** TypeScript 7 (modo estricto).
- **Virtual DOM / Renderizado:** Micro-framework declarativo reactivo ultraligero (`src/ui/dom.ts`) basado en `h(tag, props, ...children)` sin dependencias externas (peso nulo).
- **Persistencia Local:** `idb` v8 (`src/storage/db.ts` y `src/storage/repo.ts`).
- **Motor OCR en Navegador:** PaddleOCR.js (`@paddleocr/paddleocr-js` v0.4.2) ejecutado en Web Worker mediante ONNX Runtime Web WASM con soporte SIMD.
- **Service Worker / PWA:** `vite-plugin-pwa` con Workbox precacheando 61 MB (código, runtime WASM y modelos ONNX locales auto-hospedados).

### 2.2 Mapa de Archivos Frontend
```
src/
├── app/
│   └── service.ts          # Fachada principal (CaptureApp) para la UI
├── domain/
│   ├── schema.ts           # Modelos de datos (Capture, Evidence, OCRResult)
│   └── ids.ts              # Generación de UUIDs y external_ref (CF26F2-...)
├── storage/
│   ├── db.ts               # Inicialización de IndexedDB (cx_canton_capture_v1)
│   └── repo.ts             # Métodos CRUD, borradores y auditoría
├── ui/
│   ├── dom.ts              # Motor hyperscript h() reactivo
│   ├── views.ts            # Componente UI principal y vistas de la app
│   └── styles.css          # Estilos CSS móviles (tema oscuro/industrial)
├── extract/                # Extracción y fusión heurística de datos OCR
├── sync/                   # Motor de sincronización idempotente
└── adapters/               # Adaptadores Google (GIS, Drive v3, Sheets v4)
```

---

## 3. Flujo Actual de Captura y Vistas de Interfaz

### 3.1 Flujo Operativo
1. **Inicio de Sesión Individual:** Pantalla de selección de operador (`Soy Eder` / `Soy Héctor`). Con `AUTH_MODE=google`, lanza el popup de GIS y verifica el email contra la lista blanca (`VITE_ALLOWED_USERS`). La sesión se guarda en IndexedDB para no requerir conexión posterior.
2. **Bandeja Principal (Home):**
   - Lista cronológica inversa de capturas locales con badges de estado: `LOCAL`, `PROCESANDO_OCR`, `EXTRAIDO`, `SINCRONIZANDO`, `CONFIRMADO`, `ERROR`.
   - Indicador de conectividad de red y barra de estado de sincronización.
   - Botón flotante prominente `+ Nueva captura`.
3. **Asistente de Captura (Wizard):**
   - **Paso 1 (Obligatorio):** Fotografía frontal de la tarjeta de presentación (`card_front`).
   - **Paso 2 (Opcional):** Fotografía del reverso (`card_back`).
   - **Paso 3 (Opcional):** Fotografía del stand/pabellón (`booth`).
   - **Paso 4 (Opcional):** Fotografía de productos/catálogo (`product`).
   - **Guardar:** Se genera el identificador consecutivo `external_ref` (`CF26F2-<OPERADOR>-<DISPOSITIVO>-<CONSECUTIVO>`), se guardan las fotos en Blob dentro de IndexedDB, y se encola inmediatamente el trabajo en segundo plano para PaddleOCR.
4. **Detalle / Ficha de Proveedor:**
   - Visualización de fotografías capturadas con visor modal.
   - Formulario de campos comerciales (Nombre de empresa, Contacto, Teléfonos, WeChat, WhatsApp, Email, Stand, Productos, etc.).
   - Estado de revisión humana (`REVISADO`). Al confirmar la revisión, los campos quedan bloqueados para protegerlos de reprocesamientos automáticos del OCR.
   - Botón `Reintentar / Forzar sincronización`.

---

## 4. Persistencia Local y Tolerancia a Fallos

### Almacén IndexedDB (`cx_canton_capture_v1`)
- **`captures`:** Registro principal de metadatos del proveedor, estados de sincronización y campos estructurados.
- **`evidences`:** Almacenamiento binario íntegro de imágenes (`Blob`), tipo de evidencia (`kind`) y enlaces remotos tras sincronizar.
- **`ocr_results`:** Cajas delimitadoras de texto, confianza y texto sin procesar devuelto por el motor OCR.
- **`meta`:** Sesión activa del usuario, contadores secuenciales locales y borrador del asistente de captura (`draft:<userId>`).
- **`audit`:** Registro de eventos del sistema y cambios de estado.

> [!IMPORTANT]
> **Supervivencia a Descarte de Pestaña (Memory Pressure en Android):**  
> Cuando el navegador móvil abre la cámara nativa mediante `<input type="file" capture="environment">`, el sistema operativo Android frecuentemente destruye la pestaña de Chrome en segundo plano para liberar memoria RAM. El borrador actual se guarda automáticamente en `meta.draft:<userId>` ante cada cambio. Al recargar, la app reanuda exactamente el paso y las fotos donde el usuario se encontraba. **No eliminar este mecanismo en `views.ts`.**

---

## 5. Restricciones de Integración y Reglas Intocables

Al diseñar y refactorizar la UI, **deben respetarse estrictamente las siguientes invariantes**:

1. **No alterar `src/adapters/google.ts`:**
   - La sincronización depende de los contratos definidos en `src/adapters/contracts.ts`.
   - Google Drive utiliza `appProperties` (`capture_uuid`, `evidence_id`, `kind`, `external_ref`) para garantizar que nunca se creen carpetas ni archivos duplicados.
   - Google Sheets realiza un `upsertRow` localizando la fila por `capture_uuid`.
2. **No alterar los nombres de las 46 columnas:**
   - El esquema definido en `src/sync/row.ts` y `docs/INTEGRATION_CONTRACTS.md` no debe modificarse.
3. **No eliminar la llamada a `app.kickSync()`:**
   - Cada guardado o edición de proveedor notifica al motor en segundo plano para sincronizar en cuanto haya red disponible.
4. **No bloquear la captura por OCR:**
   - El OCR debe seguir ejecutándose de forma asíncrona en el Worker sin congelar la interfaz ni impedir la creación de la siguiente captura.
5. **Preservar el campo `external_ref`:**
   - El formato `CF26F2-<USER_ID>-<DEVICE_ID>-<SEQ>` es la clave de negocio que vincula la fila de Sheets con el nombre de la carpeta de Drive y los archivos físicos.

---

## 6. Oportunidades Clave de Mejora UX/UI para Claude

Durante las pruebas funcionales y de campo se identificaron las siguientes áreas prioritarias para optimización de diseño:

1. **Ergonomía de Captura a Una Mano:**
   - En la feria el usuario sostiene una tarjeta con una mano y el teléfono con la otra. Los botones de disparo, confirmación y salto de paso deben estar en la zona inferior de fácil acceso del pulgar.
2. **Visor y Recorte de Tarjetas:**
   - Agregar una guía visual (overlay con marco rectangular) en el visor de cámara para asegurar que la tarjeta quede centrada y horizontal.
3. **Indicador Visual de Calidad de Foto / OCR:**
   - Mostrar una vista previa inmediata con indicador de legibilidad tras el disparo.
4. **Pestañas o Acordeones en la Ficha de Detalle:**
   - Organizar los 46 campos comerciales en secciones colapsables lógicas: *Datos de Contacto*, *Ubicación en Pabellón*, *Productos y Notas*, *Metadatos Técnicos y Auditoría*.
5. **Feed de Sincronización Claro:**
   - Reemplazar alertas de texto por iconos de sincronización discretos (ej. nube verde para confirmado, reloj para pendiente local, alerta con reintento para fallo de red).
6. **Soporte de Tema / Contraste en Exteriores:**
   - La iluminación en los pabellones de Cantón varía drásticamente; proveer alto contraste para visualización bajo luces intensas.

---

## 7. Procedimiento de Desarrollo, Pruebas y Despliegue

### Comandos de Validación
```bash
# Ejecutar suite de pruebas unitarias e integración (debe dar 33/33 PASS)
npm test

# Compilación de producción con comprobación estricta de tipos
npm run build

# Pruebas E2E headless con emulación móvil
npm run test:e2e
```

### Despliegue de Nueva Versión
Para publicar cualquier actualización a GitHub Pages:
```bash
node scripts/deploy-pages.mjs
```
El script compila los assets, preserva `.nojekyll`, configura `404.html` para enrutamiento SPA y publica la rama `gh-pages` sin alterar el código fuente en `main`.

---
*Fin del documento de traspaso. Listo para la fase de diseño y optimización UX/UI con Claude Opus 5.5.*
