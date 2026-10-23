# UX v1 — Experiencia móvil de captura en campo

Este documento describe las pantallas, los flujos, los mensajes y las decisiones de la versión 1. El sistema visual está en [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

## Principios

1. **La foto se protege antes que nada.** Al disparar, la foto queda en el borrador local (IndexedDB) antes de mostrar nada más.
2. **Nunca bloquear al operador.** El escáner, el OCR y la sincronización corren en segundo plano. «Guardar y siguiente proveedor» devuelve la cámara en menos de 3 s, verificado en E2E.
3. **Decir solo lo que es cierto.** Hay tres etapas independientes:

   | Etapa | Qué indica | Mensajes |
   |---|---|---|
   | Foto | Está en el teléfono | «Protegida en este dispositivo» |
   | Datos | Estado de la extracción | «En cola», «Procesando documento», «Datos extraídos», «Revisar n datos», «Fallo de lectura» |
   | Google | Copia en Drive y Sheets | «Pendiente de sincronización», «Subiendo a Google», «Confirmado en Google» o el error concreto |

   - «Confirmado en Google» ≠ datos verificados; la interfaz lo dice expresamente.
   - El recorte nunca se anuncia como terminado antes de que exista el archivo procesado. En la vista previa se ve «Bordes detectados · el recorte se hará al guardar».
4. **Nada se aprueba solo.** Las correcciones humanas quedan bloqueadas frente a reprocesos. La confirmación global exige un diálogo explícito.
5. **Una mano, al sol.**
   - La acción principal está abajo: el botón central de 62 px y el obturador de 78 px.
   - Los objetivos táctiles miden ≥ 40 px; 48 px es lo habitual.
   - El contraste es ≥ 7:1 en el texto principal.
   - El color nunca es la única señal.

## Pantallas

| # | Pantalla | Archivo | Claves |
|---|---|---|---|
| 1 | Acceso | `screens/login.ts` | Solo cuentas autorizadas y correo enmascarado (`ed••••@…`). OAuth sin cambios. Estado de red |
| 2 | Inicio | `screens/home.ts` | «Nueva captura» como acción principal; Proveedores, Sincronizar y Revisar pendientes; 7 métricas pulsables; aviso de borrador sin terminar; avisos de almacenamiento, persistencia, memoria y configuración |
| 3 | Cámara | `screens/capture.ts`, `camera.ts`, `camera-hint.worker.ts` | Ver detalle abajo |
| 4 | Documento | `screens/document.ts`, `screens/corners.ts` | Procesado, original y comparación. Estado real del escáner (recortado, procesando, bordes dudosos, varias tarjetas). Ajuste de 4 esquinas (táctil y teclado). Reprocesar |
| 5 | Guardar y siguiente | `screens/capture.ts` | Persiste, encola y vuelve a la cámara. Toast «Captura protegida en este dispositivo · REF». Píldora de cola (procesando o por sincronizar) |
| 6 | Proveedores | `screens/list.ts` | Búsqueda por empresa, contacto, referencia o stand. Filtros: Todos, Pendientes, Revisión, Errores, Confirmados y operador. Página de 30 con carga incremental. Miniaturas diferidas. «Empresa pendiente de identificar» |
| 7 | Ficha | `screens/detail.ts` | Ver detalle abajo |
| 8 | Revisión | `screens/review.ts` | Cola de capturas con datos dudosos. Por dato: texto reconocido, valor sugerido, otras lecturas, **región del documento** recortada de la imagen leída, campo editable, «Aprobar», «Guardar corrección», «Dejar sin dato» y «Conservar original». «Siguiente pendiente» |
| 9 | Sincronización | `screens/sync.ts` | Ver detalle abajo |
| 10 | Ajustes | `screens/settings.ts` | Operador, cuenta, tema (sistema/claro/oscuro), conectividad, almacenamiento con medidor, rendimiento (perfil de memoria, RAM, imágenes abiertas, motor), versión. Cerrar sesión con aviso de pendientes y **sin borrar datos** |

### Cámara (pantalla 3)

- Visor a pantalla completa en cualquier orientación.
- Obturador abajo en el centro.
- Pasos visibles: Anverso, Reverso y Extras.
- Guía de encuadre opcional; se recuerda la preferencia.
- Pista discreta del detector real: «Tarjeta detectada», «Bordes poco claros: puede disparar igualmente», «Hay varias tarjetas».
- Linterna, si el dispositivo la tiene.
- Galería y cámara del sistema como alternativa si no hay permiso.
- Hoja tras el disparo con:
  - «Guardar y siguiente proveedor»;
  - «Fotografiar reverso»;
  - Stand, Producto, Catálogo y Otra;
  - datos rápidos (hall, stand, interés, notas);
  - «Repetir foto», «Guardar y salir» y «Descartar» (con confirmación).

### Ficha (pantalla 7)

- Las tres etapas.
- Llamada a revisar.
- Errores concretos con su acción.
- Secciones:
  - **Identificación**: empresas adicionales, contacto, cargo, país, provincia, ciudad, dirección, hall y stand;
  - **Comunicación**: móvil, fijo, email, web, WeChat, WhatsApp, QQ, fax y código postal;
  - **Productos**: lista, categorías, interés, notas y seguimiento;
  - **Evidencias**: miniaturas, estado del escaneo y lo que falta;
  - **Trazabilidad**: referencia, identificador, lectura, Google, fecha, operador, versión enviada, correcciones humanas y texto OCR.
- Edición por sección, con insignias «Corregido» y «Anotado».

### Sincronización (pantalla 9)

- Tres etapas agregadas: Fotos, Información y Google.
- Avisos agrupados por causa:
  - sin conexión;
  - falló por falta de conexión;
  - sesión expirada (con «Reconectar Google»);
  - sin permiso;
  - Google no respondió;
  - configuración;
  - fallo de subida;
  - fallo de lectura (OCR);
  - almacenamiento insuficiente.
- «Reintentar sincronización» es idempotente: no crea filas nuevas, como se verifica en E2E.
- Lista de pendientes.

## Borrador y recuperación

- El borrador (`meta draft:<userId>`) conserva fotos y datos rápidos tras cada cambio.
- Si Android descarta la pestaña, al volver se reabre la cámara con la última foto y el aviso «Se recuperó una captura sin guardar».
- Tras recargar, la app vuelve a la misma pantalla (ruta en `history.state`).

## Funciones futuras (desactivadas)

- El selector de tipo de documento (ficha técnica, factura, cotización, catálogo) está diseñado, pero oculto tras `localStorage['cx.features']='documentTypes'`.
- Aun activado, solo «Tarjeta comercial» es seleccionable; el resto muestra «Próximamente».

## Capturas de pantalla

`docs/ux/screenshots/` contiene, con datos ficticios:

- la matriz completa de **2 tamaños Android × 2 temas × 9 pantallas** (`android-{pequeno,grande}-{claro,oscuro}-NN-*.jpg`);
- las capturas de flujos (`flujo-*.jpg`).
