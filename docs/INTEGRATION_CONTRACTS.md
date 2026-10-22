# Contratos de integración

Interfaces en [src/adapters/contracts.ts](../src/adapters/contracts.ts) y [src/ocr/OCRAdapter.ts](../src/ocr/OCRAdapter.ts). El núcleo solo depende de estas interfaces; las implementaciones se eligen en [src/main.ts](../src/main.ts) según las variables de entorno.

## 1. AuthAdapter

| Método | Semántica |
|---|---|
| `allowedUsers()` | Lista autorizada (`VITE_ALLOWED_USERS`). No hay identidad compartida: cada persona tiene su `id` (`EDR`, `HCT`). |
| `currentUser()` | Usuario con sesión en **este** dispositivo, persistido en IndexedDB (`meta/session`) para capturar sin conexión. |
| `signIn(userId)` | Interactivo. Debe rechazar con `NotAuthorizedError` cualquier cuenta fuera de la lista. |
| `signOut()` | Cierra sesión; las capturas locales **no** se borran. |
| `getAccessToken()` | Token OAuth para Drive/Sheets. Si no es posible sin interacción → `AuthRequiredError` (la UI muestra «Reconectar Google»). |

Implementación real: `GoogleAuthAdapter` (Google Identity Services, *token client*, sin backend). Verifica el correo con `oauth2/v3/userinfo` (`email_verified` + lista autorizada).

**Importante**: la lista autorizada en el frontend es una comodidad, no una barrera de seguridad. La barrera real es que **solo las cuentas de Eder y Héctor tengan permiso de edición** sobre la carpeta de Drive y el Spreadsheet de Fase 2 (y que el cliente OAuth esté en modo *Testing* con ellos dos como usuarios de prueba, o sea un cliente *Internal* de Workspace).

## 2. DriveAdapter

```ts
ensureCaptureFolder({ capture_uuid, external_ref }) → { folderId, url }
uploadEvidence(folderId, { evidence_id, capture_uuid, external_ref, kind, file_name, mime, blob }) → { fileId, url }
```

Estructura en Drive:

```
Colescomex/04_LIVE_OPERATIONS/03_SUPPLIERS/2026_CANTON_FAIR/EVIDENCIAS_FASE2/   ← VITE_DRIVE_EVIDENCE_FOLDER_ID
  CF26F2-EDR-YC53-0001/                       appProperties: { capture_uuid, app }
    CF26F2-EDR-YC53-0001_01_card_front.jpg    appProperties: { evidence_id, capture_uuid, kind, external_ref }
    CF26F2-EDR-YC53-0001_02_card_back.jpg
    CF26F2-EDR-YC53-0001_03_stand.jpg
  CF26F2-HCT-K8PD-0001/
    ...
```

Idempotencia (obligatoria en cualquier implementación):

- La carpeta se busca por `appProperties.capture_uuid` dentro de la raíz antes de crearla.
- Cada archivo se busca por `appProperties.evidence_id` antes de subirlo. Repetir la llamada devuelve el mismo `fileId`.
- Nunca se sobrescribe, mueve ni borra nada en Drive.
- El archivo subido es el **original** del teléfono (sin recompresión).

Errores: `AuthRequiredError` (401), `TransientRemoteError` (red, 429, 5xx → reintento con espera exponencial), `Error` (4xx no recuperable → `ERROR` visible).

## 3. SheetsAdapter

```ts
upsertRow(row: Record<string, string>) → { rowNumber, action: 'inserted' | 'updated' }
```

- Archivo: el Spreadsheet de **Fase 2** (`VITE_SHEETS_SPREADSHEET_ID`), pestaña `CAPTURA_FASE2` (`VITE_SHEETS_TAB_NAME`). **Nunca** el archivo de Fase 1 (`COLESCOMEX_Canton_Fair_Fase1_Importacion`); si se configura `VITE_PHASE1_SPREADSHEET_ID`, la app se niega a sincronizar cuando coinciden.
- Una fila = una captura. Clave: columna `capture_uuid`.
- Escritura **por nombre de columna** (fila 1 = cabecera). Las columnas que falten se añaden al final; las existentes no se reordenan; columnas ajenas (p. ej. notas manuales) no se tocan.
- `valueInputOption=RAW`: `+8613800138000` queda como texto, no como número/fórmula.
- Reintento tras «respuesta perdida»: el siguiente intento encuentra la fila por `capture_uuid` y la actualiza (no duplica).
- Limitación conocida: si alguien edita en Sheets una columna que la app también escribe, la siguiente sincronización de esa captura la reemplaza con el valor del teléfono. Para anotaciones en la hoja usar columnas adicionales.

### Columnas

Comerciales (en este orden, compatibles con Fase 1):

`external_ref, capture_date, captured_by, mission, source, phase, hall, booth, company_name, company_name_cn, contact_name, job_title, phone_1, phone_2, wechat, whatsapp, email, website, address, city, province, country, supplier_type, main_products, product_interest, notes, follow_up, data_classification, processing_status`

Técnicas (después):

| Columna | Contenido |
|---|---|
| `capture_uuid` | UUID inmutable (clave del upsert) |
| `record_revision` | Revisión local enviada |
| `ocr_status` | Estado OCR |
| `review_status` | `SIN_REVISAR` / `REVISADO` |
| `review_fields` | Campos marcados `review`/`illegible` |
| `evidence_folder_id`, `evidence_folder_url` | Carpeta de Drive del proveedor |
| `evidence_ids` | IDs de evidencias (orden de captura) |
| `evidence_files` | `tipo: url` por evidencia |
| `ocr_engine` | Motor y modelo usados |
| `ocr_fax` | Fax detectado (sin columna comercial) |
| `ocr_text_front`, `ocr_text_back` | Texto OCR original (truncado a 45 000 caracteres) |
| `device_id`, `created_at`, `updated_at`, `app_version` | Trazabilidad |

Precargados: `mission=China 2026`, `source=Canton Fair`, `phase=Fase 2`, `country=China`, `data_classification=REAL`.
`processing_status` refleja el estado OCR y pasa a `REVISADO` cuando una persona confirma la revisión. Nunca toma valores de aprobación.

## 4. OCRAdapter (motor reemplazable)

```ts
init(onProgress?) → void
recognize(image: Blob) → { lines: { text, score, box? }[], ms, engine }
dispose() → void
```

El adaptador **solo** devuelve líneas de texto con confianza. La clasificación comercial vive en `src/extract/` y es la misma para cualquier motor.

OCR remoto opcional (`VITE_OCR_ENGINE=remote`, `VITE_OCR_REMOTE_URL`): `RemoteOCRAdapter` hace

```
POST <VITE_OCR_REMOTE_URL>
Authorization: Bearer <token OAuth del usuario>
Content-Type: image/jpeg
<bytes de la imagen>

200 → { "lines": [ { "text": "...", "score": 0.97, "box": [[x,y],...] } ] }
429/5xx → reintento; 4xx → ERROR
```

El backend (p. ej. Cloud Run + Google Cloud Vision `DOCUMENT_TEXT_DETECTION`) valida el token del usuario contra la lista autorizada y guarda la clave de Vision en el servidor. **Nunca** poner claves de Vision en el frontend.

## 5. Flujo de sincronización por captura

1. `sync_status = SINCRONIZANDO`
2. `ensureCaptureFolder` → guarda `remote.folder_id` localmente
3. Para cada evidencia sin `remote_file_id`: `uploadEvidence` → guarda `remote_file_id`
4. `upsertRow(toSheetRow(captura actual))`
5. `synced_revision = revisión enviada`; `CONFIRMADO` si no hubo cambios entretanto, si no `PENDIENTE` y se repite.

Cualquier fallo → `ERROR` con mensaje y reintento automático (5 s × 2ⁿ, máx. 10 min); disparadores: guardado, fin de OCR, edición, evento `online`, cada 60 s y botón «Sincronizar ahora». Los archivos locales nunca se borran automáticamente.
