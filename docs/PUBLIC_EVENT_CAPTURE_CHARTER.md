# Public Event Capture — Product & Isolation Charter (v0.1)
Fecha: 2026-10-29
Estado: **aprobado para desarrollo exploratorio**; **no publicado al publico**.
Origen: evolucion de COLESCOMEX CX Capture v1.2.3.
Rama: `feat/event-capture-public-mvp`.

## Vision y alcance

Convertir CX Capture en una app global de captura, consulta y gestion de contactos obtenidos en ferias, congresos y eventos. Cualquier persona elegible con cuenta Google podra registrarse, capturar tarjetas/documentos de contacto, organizarlos por evento y recuperar su biblioteca desde cualquier dispositivo **conectado**. El almacenamiento de archivos y el indice estructurado pertenecen al usuario, en su propio Google Drive/Google Sheets. La app funciona offline para la captura y para la informacion ya descargada. **No decidir pricing, paywalls ni monetizacion antes de validar product-market fit.**

## Invariantes y separacion irreversible

1. No cambiar ni desplegar en `main`, `gh-pages` ni el dominio GitHub Pages actual de CX Capture durante el desarrollo exploratorio.
2. No escribir ni migrar datos de COLESCOMEX: las 41 capturas EDR y las capturas HCT pendientes/recuperadas quedan bajo su configuracion, Drive, Sheets y OAuth actuales. Ningun usuario publico puede ver esos recursos.
3. **Rama distinta NO significa entorno distinto:** crear un hosting aislado, origen/URL distinto, configuracion distinta, Google Cloud project/OAuth client distinto, manifest, service worker scope e IndexedDB propios. Prohibido reutilizar el `colescomex-capture-preview.web.app` o recursos actuales de produccion sin comprobacion explicita de aislamiento.
4. Usar Google OAuth **External** en Testing inicialmente, con lista limitada de testers y cuentas de prueba no asociadas a COLESCOMEX; proyecto OAuth separado de produccion. No exponer secretos en frontend, repo ni logs. Preparar verificacion de marca/scopes y politicas antes del lanzamiento abierto.
5. El principio de menor privilegio obliga a evaluar `openid email profile` + `https://www.googleapis.com/auth/drive.file`, probando operaciones Drive + Sheets reales con ese alcance. No reutilizar permisos amplios `drive`/`spreadsheets` sin justificacion y evaluacion de verificacion.
6. Separacion de identidades por Google `sub` (estable), nunca solo email. Una cuenta no puede listar, leer, crear o modificar archivos locales/remotos de otra. Revisar uso compartido del dispositivo, cierre de sesion y aislamiento de IndexedDB.
7. No declarar sincronizacion `CONFIRMADA` sin verificar todos los archivos y el indice remoto; mantener idempotencia por UUID, reintentos y comprobaciones binarias.
8. No inventar capacidad de acceso a Drive cuando Google esta inaccesible (ej. algunas redes en China); conservar el modo captura offline con sincronizacion posterior.

## Modelo de datos inicial

- **Cuenta**: Google subject, nombre publico, configuracion local, referencias a carpeta raiz/hoja creadas por la app.
- **Evento**: UUID, nombre, lugar, pais, fechas, categoria, idioma, estado.
- **Contacto**: UUID inmutable, evento, empresa, nombre, cargo, telefonos, email, productos/interes, etiquetas, notas, revision humana, proxima accion; auditoria minima.
- **Evidencia**: UUID, tipo, foto original, imagen procesada, hash local, Drive file ID, integridad/estado.
- **Indice remoto**: Hoja de Google Sheets creada por la aplicacion con schema versionado, filas por UUID y control de revision, sin depender de archivos hardcodeados ni del navegador de captura.
- **Archivos**: organizados por evento y contacto en carpeta raiz visible del usuario. Si la app necesita metadatos ocultos, evaluar `appDataFolder` separadamente.

## Arquitectura de lectura entre dispositivos

Al iniciar sesion: localizar (por identificador persistido + busqueda restringida a archivos de la app) la raiz/indice propiedad del usuario; enumerar los registros en Sheets con paginacion y cambios; construir la biblioteca local. Los datos del telefono se fusionan en forma deterministica con los del indice, sin sobrescribir ediciones ni duplicar contactos. Desde otra computadora se muestran registros y miniaturas autorizadas desde Drive, con estados `solo local`, `en Google`, `conflicto` y `error`. Cualquier actualizacion debe respetar control de versiones y reglas de conflictos.

## Orden de desarrollo (sin monetizacion)

### Sprint 0 — seguridad e infraestructura aislada
- Crear hosting/origen independiente, cliente OAuth de pruebas, configuracion por entorno y checks que impiden apuntar a IDs de COLESCOMEX.
- Probar que service worker/manifest/IndexedDB y despliegues no comparten espacio con la PWA v1.2.3.
- Configurar proteccion de ramas/CI si se puede; pruebas sin datos reales.
**Gate:** demo aislada y auditada en cuentas Google de prueba; cero escrituras en operaciones COLESCOMEX.

### Sprint 1 — biblioteca en nube
- Crear un lector de la hoja/archivos del usuario y un repositorio `CloudCaptureRepository` distinto del repositorio local.
- Biblioteca unificada entre movil y escritorio, filtros, detalles, miniaturas, paginacion, estados y errores; prueba de dos dispositivos.
**Gate:** contacto creado en telefono A, visible y verificable en computadora B con la misma cuenta, sin tocar Drive manualmente.

### Sprint 2 — registro publico e inicio de sesion
- Reemplazar `VITE_ALLOWED_USERS` por Google Sign-In External, onboarding con permisos claros y revocacion.
- Aislar credenciales y datos por `sub`, incluida prueba de dos cuentas en el mismo dispositivo.
**Gate:** usuario de prueba A nunca ve registros de B.

### Sprint 3 — Drive particular + eventos
- Provisionar idempotentemente carpeta/indice/estructura por cuenta, recuperar instalaciones previas; crear eventos multiples e idiomas base ES/EN.
**Gate:** usuario nuevo crea primer evento y captura sin intervencion del administrador.

### Sprint 4 — gestion y resiliencia
- Editar registros, seguimiento, deduplicacion sugerida sin fusion silenciosa, exportar, sincronizar en ambos sentidos, conflictos y recuperacion.
- Offline, cuota llena, errores OAuth/403/429, reanudacion, integridad fotos y multi-dispositivo.
**Gate:** pruebas E2E de recuperacion de fallos y consulta fiable.

### Sprint 5 — lanzamiento publico
- Marca y dominio verificados, home, privacidad, terminos, eliminacion/exportacion de datos, soporte, consentimiento, accesibilidad, limites de uso y proteccion antiabuso.
- Revisar requisitos de Google OAuth y verificacion de scopes antes de abrir a cualquier cuenta.
**Gate:** QA, seguridad y aprobacion explicita para publicar al publico.

## Decisiones fuera de alcance

- No incorporar COLESCOMEX OS/Torre de Control, ni mezclar proveedores del negocio.
- No agregar CRM empresarial, colaboracion multiusuario, backend privado, facturacion ni pagos en esta fase.
- No elegir marca definitiva antes de revisar posicionamiento y validacion con usuarios.
- No cambiar la app actual para "mostrar en PC": ese caso corresponde a la biblioteca remota del nuevo producto, no a importar silenciosamente datos del equipo.

## Fuentes oficiales consultadas (2026-10-29)

- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/identity/protocols/oauth2/policies
- https://developers.google.com/identity/protocols/oauth2/production-readiness/overview
- https://developers.google.com/workspace/drive/api/guides/appdata
