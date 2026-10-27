# Incidente P0 — 23 capturas de Héctor sin archivos en Drive ni filas en Sheets

**Rama:** `fix/hct-sync-recovery` (CX Capture v1.2.3) · **no integrada en `main` ni publicada en producción**.
**Recuperación real:** pendiente del teléfono de Héctor y de tu autorización.
No se ha escrito nada en Drive, Sheets ni en ningún dispositivo.

## 1. Hechos

**Auditoría independiente:**
- 41 filas `EDR` y 0 filas `HCT` en `CAPTURA_FASE2`;
- 23 carpetas `CF26F2-HCT-CCCB-0001…0023` en `EVIDENCIAS_FASE2`, todas vacías;
- 23 carpetas HCT también en `ORIGINALES_FASE2`;
- Héctor es editor de las carpetas y de la hoja.

**Código de CX Capture** (comprobado en este repositorio):
- Solo CX Capture crea carpetas `CF26F2-…`, y guarda el `capture_uuid` en las `appProperties` de cada carpeta.
- Orden de sincronización por captura:
  1. carpeta del proveedor;
  2. carpeta del respaldo y subida de los originales;
  3. archivos en la carpeta del proveedor;
  4. **solo entonces** la fila (*upsert* por `capture_uuid`).
- Si falla el primer archivo, la captura queda en `ERROR`, **sin fila**, y las carpetas ya creadas quedan **vacías en ambos destinos**: es lo observado. Nunca se marca «Confirmado».

**COLESCOMEX OS** es otro sistema, con otra API y otro almacenamiento; no escribe en Google. Sus cifras (45 proveedores, 8 pendientes) **no** son estas 23 capturas. Queda fuera de esta incidencia.

## 2. Causa raíz: hipótesis pendiente de confirmar con el error real del teléfono

Todas las capturas fallan en el **primer** archivo, mientras que crear carpetas (que no ocupan espacio) funciona. Eso indica un fallo **sistemático** de la cuenta o el dispositivo de Héctor.

| Hipótesis | Situación |
|---|---|
| **Drive de Héctor lleno** (`403 storageQuotaExceeded`): un archivo subido por él ocupa **su** cuota aunque la carpeta sea de Eder | **La más probable.** Encaja con todos los síntomas. La v1.2.2 lo mostraba como «Sin permiso…», lo que explica que los permisos parecieran correctos. Se reproduce exacto en las pruebas |
| **Red o VPN inestable** con fotos grandes y sin reanudación | Posible; corregido con la subida reanudable |
| **Límite de 5 MB de la subida multipart** | **Descartada como límite duro.** La documentación de Google da 5 MB como *orientación* para elegir el tipo de subida, no como límite de la API. La multipart sí obliga a reenviar todo el archivo ante un corte |

**Cómo se confirmará:** con la v1.2.3, Héctor podrá copiar el diagnóstico desde *Sincronización*. La causa real de cada captura aparecerá con el motivo de Google. Con la v1.2.2 el texto exacto no era visible.

## 3. Correcciones

**Subida a Drive** (`src/adapters/google.ts`):
- **Reanudable** por bloques de 4 MB (múltiplos de 256 KiB, como exige Drive).
- **Cortes de red, 429 y 5xx:** espera exponencial con jitter (1 s, 2 s, 4 s… hasta 32 s), consulta de cuánto recibió Drive (`bytes */total`) y continuación desde ahí.
- **Sesión caducada o invalidada (404/410):** antes de abrir otra sesión se busca el archivo por `evidence_id`; **nunca se duplica**.
- **Respuesta final perdida** (el archivo llegó pero no la confirmación): la consulta de estado lo detecta y no se vuelve a subir.
- **Verificación independiente del contenido:** un archivo, nuevo o reutilizado por `evidence_id`, solo se marca subido si coinciden con la foto del teléfono:
  - el **tamaño**;
  - el **`md5Checksum` que Google Drive calcula sobre los bytes que almacena**, comparado con el MD5 calculado en el teléfono (por bloques, sin cargar la foto entera).

  Si Drive no informa tamaño o MD5 se consultan los metadatos. Si aun así no se puede verificar, o no coincide, la captura queda **pendiente**, con el aviso «El archivo en Drive no coincide con la foto del teléfono»: no se duplica ni se borra nada.

  El `sha256` que guarda la app en `appProperties` lo escribe el propio cliente. Solo se usa para detectar otra versión de la evidencia, **nunca** como prueba de integridad. MD5 no protege frente a manipulaciones deliberadas, pero sí verifica que Drive guardó exactamente esos bytes.
- **Errores con el motivo real de Google:**
  - `storageQuotaExceeded`: permanente;
  - `userRateLimitExceeded` / `rateLimitExceeded`: transitorio, aunque llegue como 403;
  - `insufficientFilePermissions`: permiso real;
  - 401: sesión de Google.
- La URL de la sesión reanudable **nunca** aparece en mensajes ni registros.

**Mensajes y diagnóstico:**
- Mensajes por causa (`src/ui/model.ts`):
  - «El almacenamiento de su cuenta de Google está lleno»;
  - «La conexión se interrumpió; la subida se reintentará»;
  - «La sesión de Google expiró; reconecte su cuenta»;
  - «Google limitó temporalmente las solicitudes»;
  - «Sin permiso en Google Drive o Sheets» (solo para el permiso real);
  - «No fue posible subir este archivo».
- Pantalla de *Sincronización*:
  - resumen: guardadas en el teléfono, completas en Google, pendientes y con error;
  - causa por captura;
  - detalle técnico;
  - **«Copiar diagnóstico técnico»**.
- Registro técnico por captura, sin datos comerciales (`src/sync/ledger.ts`): `capture_uuid`, `external_ref`, operador, dispositivo, versión, estado local, originales y procesados, archivos esperados y confirmados (evidencias y respaldo), carpetas, estado de la fila, error real, intentos y última operación correcta.

**Sincronización automática** (`src/app/service.ts`, `SyncEngine.ts`):
- cola persistente en IndexedDB;
- reintento periódico cada 60 s, con espera por captura exponencial y jitter;
- reintento **inmediato** al abrir la app, al volver a primer plano, al recuperar la conexión y al **renovar la sesión de Google**.

«Confirmado» solo llega con los archivos requeridos y la fila verificados (sin cambios).

**Background Sync:**
- **Periodic Background Sync** solo funciona con la PWA **instalada**; su frecuencia la decide Chrome (uso de la app, batería, red) y **no está garantizada**.
- **Background Sync de una sola vez** reenvía peticiones, pero la subida exige el **token OAuth de Google**, que vive en la página, caduca en 1 h y no puede renovarse en segundo plano sin el usuario.

**No se promete subir con la app cerrada:** la subida continúa al abrirla o al volver a ella.

**Conciliación de solo lectura** (`scripts/reconcile-google.ts`):
- cruza Drive (evidencias y originales), Sheets y el diagnóstico del teléfono por `capture_uuid`;
- emite la tabla `external_ref | archivos esperados | archivos encontrados | fila Sheets | error | estado`;
- compara antes y después (recuperadas, pendientes, regresiones) y detecta filas duplicadas;
- solo permite métodos `list`/`get` y guarda el informe **fuera** del repositorio.

**Recuperación:** etiqueta `deployed/v1.2.2` → `4b7624a`, la producción actual.

## 3b. Verificación (clon limpio, `npm ci`, código `e92fb931f135a400aef7d4c920973f9f3eac23a1`)

| Control | Resultado |
|---|---|
| `tsc --noEmit` | ✅ 0 errores |
| Unitarias | ✅ **181/181** (17 archivos) |
| Build de producción | ✅ |
| `check:dist` | ✅ 27 entradas de precaché · 16 archivos OCR (71,6 MB) idénticos · 38 archivos sin secretos · 46 fixtures privados sin coincidencias |
| E2E | ✅ **45/45** · 0 fallidas · 0 omitidas (incluye 9 de actualización de la PWA, entre ellas **v1.2.2 → v1.2.3**, y la tarjeta real privada R1) |
| `check:private` | ✅ 17 patrones, 0 coincidencias |

Las pruebas de Google (`tests/google-adapters.test.ts`, `tests/drive-sync-regression.test.ts`, `tests/scanner-pipeline.test.ts`, `tests/reconcile.test.ts`) cubren, con Google **simulado**:
- foto pequeña y grande (6 MB) con los bytes idénticos;
- corte de red a mitad;
- sesión caducada (404) sin duplicar;
- respuesta final perdida;
- 429 con espera exponencial y jitter, y 429 persistente → transitorio;
- cuota llena (403 `storageQuotaExceeded`);
- permiso real (403 `insufficientFilePermissions`);
- límite de ritmo (403 `userRateLimitExceeded`);
- OAuth: 401 a mitad, renovación y reanudación inmediata;
- originales byte a byte;
- captura antigua;
- una fila por `capture_uuid`, sin duplicados en una segunda pasada;
- filas de Eder intactas;
- reproducción del incidente y su recuperación automática.

## 4. Invariantes protegidas

- **Filas de Eder:** sin tocar (el *upsert* solo actúa sobre su `capture_uuid`; se comprueba en las pruebas).
- **Datos de Héctor:** las 23 referencias HCT no cambian.
- **Sin borrados:** no se borran fotos ni carpetas.
- **Sin duplicados:** ni archivos (`evidence_id`) ni filas (`capture_uuid`).
- **Ediciones humanas:** no se sobrescriben campos editados a mano.
- **Identidad de la app:** misma URL, mismo `manifest.id`/`scope`/`start_url` y mismo nombre de IndexedDB; sin borrado de caché ni migraciones.
- **Pruebas:** con Google **simulado** y entorno hermético.

## 5. Estado de las 23 capturas HCT

**No verificable todavía desde aquí.**
- El token de solo lectura de `gws` de este equipo está caducado. No se usaron otras credenciales: la herramienta bloqueó el intento como exploración de credenciales.
- La auditoría independiente (conector de Google Drive) establece: **23 carpetas en evidencias y 23 en originales, sin archivos en las principales, y 0 filas** → **0 completas y 23 que requieren recuperación**.
- **Si los archivos siguen en el teléfono de Héctor no está verificado.** No se declara recuperada ninguna foto.

## 6. Procedimiento de recuperación (con aprobaciones)

1. **Lectura (sin escrituras).** Renovar `gws` con `drive.readonly` y `spreadsheets.readonly` y ejecutar `node --import tsx scripts/reconcile-google.ts --user HCT --out <carpeta privada>` → línea base.
2. **Teléfono de Héctor, sin borrar ni reinstalar:**
   - abrir **CX Capture** con su cuenta y comprobar en *Proveedores* que las 23 capturas siguen ahí;
   - revisar `drive.google.com/settings/storage` y **liberar espacio si está lleno**.
3. **Autorización A — publicar v1.2.3** con el procedimiento validado (avance rápido de `main` y `npm run deploy`, recuperable con `deployed/v1.2.2`).
4. **En el teléfono:**
   - con la v1.2.3, la app reintenta sola al abrirla;
   - Héctor la mantiene abierta en *Sincronización*, con Wi-Fi o VPN estable, hasta que «Completas en Google» llegue a 23;
   - si no llega, pulsa «Copiar diagnóstico técnico» y lo envía.
5. **Conciliación final** (lectura) con `--ledger <diagnóstico>` y `--previous <línea base>`. Criterio de éxito:
   - 23 completas, o cada excepción identificada;
   - archivos verificables y una fila por `capture_uuid`;
   - 0 duplicados y 41 filas EDR intactas.
6. **Autorización B, aparte:** cualquier recuperación que escriba directamente en Google sin pasar por el teléfono. **No es necesaria si los archivos están en el teléfono**, y no se hará sin tu aprobación específica.
