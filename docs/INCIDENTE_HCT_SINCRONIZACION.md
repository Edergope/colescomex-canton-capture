# Incidente P0 — capturas de Héctor ausentes en Google Sheets

**Estado:**
- diagnóstico del código y de los sistemas: completo;
- corrección: implementada en la rama `fix/hct-sync-recovery` y probada; **no publicada** (requiere tu aprobación);
- recuperación: **pendiente**, porque necesita el teléfono de Héctor y la lectura de Google.

No se ha escrito nada en Drive, Sheets, la base de COLESCOMEX OS ni ningún dispositivo.

---

## 1. Hay DOS aplicaciones y DOS destinos distintos

| | **CX Capture** (`edergope.github.io/colescomex-canton-capture`) | **COLESCOMEX OS** («Torre de Control», «Registro Rápido») |
|---|---|---|
| Código | Este repositorio | `Edergope/colescomex`, rama `feat/foundation-1-platform` (trabajo de Codex) |
| Almacén en el teléfono | IndexedDB `colescomex-canton-capture` del origen `edergope.github.io` | IndexedDB propio de su origen |
| Destino | **Google Drive** (`EVIDENCIAS_FASE2`, `ORIGINALES_FASE2`) y **Google Sheets** `CAPTURA_FASE2` | Backend propio: Cloudflare Workers, Postgres Neon (Hyperdrive) y archivos en R2. **No escribe en Google Drive ni en Sheets** (comprobado en ambas ramas) |
| Referencia | `CF26F2-<USUARIO>-<DISPOSITIVO>-<SEC>` | `capture_id` del servidor, con clave idempotente `clientKey` = id local |

**Consecuencias:**
- Lo que Héctor captura en COLESCOMEX OS **nunca** aparecerá en `CAPTURA_FASE2`. No es un fallo de sincronización: es otro sistema.
- Las 23 carpetas `CF26F2-HCT-CCCB-0001…0023` las creó **CX Capture** con la sesión de Héctor en un dispositivo de código `CCCB`. Es la única aplicación que crea carpetas `CF26F2-…`, y guarda el `capture_uuid` en las `appProperties` de cada carpeta.

## 2. Qué significan las cifras del teléfono de Héctor (COLESCOMEX OS)

**«45 proveedores».** Es el **directorio compartido de la organización**, no las capturas de Héctor. La conciliación de Eder hecha por Codex (24-10, corte 15:40 UTC) cuenta 55 proveedores REAL tras 10 recuperaciones aplicadas esa mañana: 55 − 10 = **45**, la cifra de la pantalla de Héctor. De esos 55, 17 los creó Héctor.

**«16 → 10 → 8 pendientes».** Es la cola local de COLESCOMEX OS hacia **su** backend. Disminuye porque se va enviando.

**El mensaje «reintentaremos al recuperar conexión o sesión».** Solo aparece si al menos una captura está en `SYNC_FAILED` o `AUTH_REQUIRED` (`CaptureSyncManager.tsx`). Las tarjetas visibles dicen «Foto guardada · pendiente de enviar», no «necesitamos reconectar».

**El botón «Sincronizar» de la Torre de Control.** **Solo recarga los datos de la API** (`loadData` en `ControlTowerView.tsx`); no envía capturas. El envío lo hace aparte `CaptureSyncManager`:
- cada 15 s mientras la app está abierta;
- al recuperar conexión, al volver a la app y al abrirla.

Las capturas en `AUTH_REQUIRED` no se reintentan con el temporizador, solo en esos momentos.

**Capturas que no se cuentan.** La cola filtra por `organización:usuario`: una captura guardada con otra sesión ni se cuenta ni se reintenta. Hay que comprobarlo en el dispositivo.

## 3. CX Capture: cómo se produce una carpeta vacía sin fila (comprobado en el código)

`SyncEngine.syncOne`, por captura:
1. crea o reutiliza la carpeta del proveedor;
2. crea la carpeta del respaldo y sube los originales;
3. sube los archivos a la carpeta del proveedor;
4. **solo entonces** escribe la fila (*upsert* por `capture_uuid`).

Si el primer archivo falla, la captura queda en `ERROR` con reintento automático y la fila no se escribe. El resultado son **carpetas creadas en ambos destinos y vacías**: es lo observado. Nunca se declara «Confirmado».

**Causa raíz, a confirmar con el texto del error del teléfono.** Todas las capturas fallan en el primer archivo y las carpetas sí se crean, así que el fallo es **sistemático** de la cuenta o el dispositivo de Héctor, no un corte esporádico. Las hipótesis compatibles, de más a menos probable:

1. **El Drive de Héctor está lleno** (`403 storageQuotaExceeded`). Un archivo subido por Héctor ocupa **su** cuota aunque la carpeta sea de Eder; las carpetas no ocupan espacio. Por eso los permisos de editor son correctos y aun así nada se sube.
2. **Fotos de más de 5 MB** de una cámara de muchos megapíxeles: CX Capture subía cada archivo en una sola petición *multipart*, pensada para archivos de hasta 5 MB.
3. **Red o VPN inestable** para archivos grandes, sin reanudación (cada intento empezaba de cero).

**Defecto de diagnóstico comprobado:** CX Capture mostraba **cualquier** `HTTP 403` como «Sin permiso en Google Drive o Sheets — pida acceso de edición». También lo hacía con Drive lleno o con un límite de ritmo (que además es transitorio). El texto real del error no aparecía en ninguna pantalla ni en «Copiar diagnóstico».

## 4. Corrección implementada (rama `fix/hct-sync-recovery`, no publicada)

| Cambio | Archivo |
|---|---|
| **Subida reanudable** por bloques de 4 MB: fotos de cualquier tamaño y continuación desde el último byte confirmado ante cortes de red o VPN | `src/adapters/google.ts` |
| **Errores con su motivo real de Google** (`storageQuotaExceeded`, `userRateLimitExceeded`…); los límites de ritmo, aunque lleguen como 403, son reintentables | `src/adapters/google.ts` |
| Mensajes por causa: **«El Drive de su cuenta de Google está lleno»** (con la explicación de que la cuota es de quien sube) y «Archivo demasiado grande», distintos de «Sin permiso» | `src/ui/model.ts` |
| **Libro de sincronización por captura**, sin datos de proveedores: referencia, `capture_uuid`, estado, intentos, error real y archivos subidos frente a esperados. Visible en *Sincronización → Detalle técnico* e incluido en «Copiar diagnóstico» | `src/sync/ledger.ts`, `sync.ts`, `settings.ts` |
| **Conciliación de solo lectura** Drive + Sheets + teléfono, por `capture_uuid`. Clasifica cada captura en: completa, carpeta vacía sin fila, carpeta con archivos sin fila, fila sin archivos, fila sin carpeta o solo en el dispositivo. Detecta filas duplicadas y compara con un informe anterior (recuperadas, pendientes, regresiones) | `scripts/reconcile-google.ts` |

**Sin cambios** (ya eran correctos y las pruebas lo confirman):
- carpeta y archivos idempotentes por `capture_uuid` y `evidence_id`;
- fila con *upsert* por `capture_uuid`;
- «Confirmado» solo tras verificar archivos y fila;
- reintento automático cada 60 s con la app abierta, al volver la conexión y con espera exponencial, sin necesidad de pulsar «Sincronizar»;
- el `captured_by` y la referencia salen de la propia captura;
- no se borra nada del teléfono.

**Límite de una PWA:** con la app **cerrada** no se puede subir; se reanuda al abrirla.

## 5. Pruebas (rama `fix/hct-sync-recovery`)

- **Unitarias: 171/171.** Las nuevas:
  - foto de 6 MB subida por bloques con los bytes idénticos;
  - corte de red a mitad, que se reanuda sin duplicar;
  - Drive lleno: error permanente con motivo `storageQuotaExceeded` y mensaje «Drive lleno», nunca «sin permiso»;
  - límite de ritmo tratado como transitorio;
  - **reproducción del incidente** con los adaptadores reales contra el simulador de Google: tres capturas de Héctor con su Drive lleno → 6 carpetas creadas y **vacías**, cero filas HCT, filas de Eder intactas, ninguna «confirmada»;
  - **recuperación automática** al liberarse la cuota: mismas 6 carpetas, archivos subidos, **una fila por `capture_uuid`** con `captured_by = Héctor` y sin duplicados en una segunda pasada;
  - conciliación: 23 carpetas vacías → 23 pendientes; libro del teléfono; recuperadas, regresiones y duplicados.
- **E2E: 44/44**, 0 fallidas, 0 omitidas; build, `check:dist` y `check:private` correctos.

## 6. Procedimiento de recuperación (cada paso con escritura requiere tu aprobación)

1. **Lectura de Google (solo lectura, te lo pido a ti).** El token de solo lectura de `gws` caducó. Renuévalo con:
   `gws auth login --scopes https://www.googleapis.com/auth/drive.readonly,https://www.googleapis.com/auth/spreadsheets.readonly`
   Después ejecuto `node --import tsx scripts/reconcile-google.ts --user HCT`, que produce la **línea base**:
   - las 23 carpetas, con su `capture_uuid`, propietario y fecha;
   - los archivos de cada carpeta;
   - las filas.

   El informe se guarda fuera del repositorio.
2. **Teléfono de Héctor, sin borrar nada.** Que abra **CX Capture** (icono «CX Capture», no COLESCOMEX OS) con su cuenta y envíe:
   - una captura de pantalla de *Sincronización*;
   - el número de capturas en *Proveedores*.

   Que compruebe además el espacio de su cuenta en `drive.google.com/settings/storage` y, si está lleno, libere espacio. **No** debe desinstalar, borrar datos ni volver a capturar.
3. **Publicar la corrección como v1.2.3** (requiere tu aprobación): mismo procedimiento validado de la v1.2.2, con la etiqueta de recuperación `deployed/v1.2.2`. El teléfono de Héctor se actualiza solo al volver a Inicio.
4. **Recuperación en el teléfono.** Héctor deja CX Capture abierta en Inicio o en *Sincronización*, con Wi-Fi o VPN estable. Los reintentos automáticos suben los archivos a **las mismas carpetas** y escriben **una fila por captura**. Si algo sigue fallando, *Ajustes → Copiar diagnóstico* da el error exacto por captura.
5. **Conciliación final** (solo lectura): `--previous <informe base>` produce el informe de recuperadas, pendientes y fallidas, sin tocar las 41 filas de Eder.

**COLESCOMEX OS (aparte):** sus 8 pendientes van a su propio backend. Se ven en *Registrar → Escanear tarjeta → Ver registros anteriores*, con estado y último error. La comprobación en el servidor puede hacerse con la herramienta de solo lectura que usó Codex (`tooling/capture-incident-staging.mjs`), pero despliega un worker temporal con las credenciales de Cloudflare, así que requiere tu aprobación.

## 7. Qué NO se hizo

- No se escribió en Drive, Sheets, Neon o R2.
- No se tocaron dispositivos.
- No se cambiaron permisos ni carpetas raíz.
- No se publicó ninguna versión.
- No se usaron credenciales de Google Cloud de la máquina para leer Drive: la herramienta lo bloqueó como exploración de credenciales y no se buscó otra vía.
