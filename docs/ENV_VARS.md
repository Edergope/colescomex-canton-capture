# Variables de entorno y credenciales

Todas las variables `VITE_*` se **incrustan en el JavaScript público**. Ninguna es secreta y ninguna debe serlo. Archivo: `.env.local` (desarrollo) o variables del proveedor de hosting (producción). Plantilla: [.env.example](../.env.example).

| Variable | Obligatoria | Ejemplo | Descripción |
|---|---|---|---|
| `VITE_AUTH_MODE` | sí | `google` | `mock` (desarrollo) o `google` |
| `VITE_SYNC_MODE` | sí | `google` | `mock` (remoto en memoria) o `google` |
| `VITE_ALLOWED_USERS` | sí | `EDR:Eder:eder@dominio.com,HCT:Héctor:hector@dominio.com` | `id:Nombre:email`. El `id` (2-6 letras/dígitos) va en `external_ref`. **No cambiar los id durante la feria.** |
| `VITE_GOOGLE_CLIENT_ID` | con `google` | `1234-abc.apps.googleusercontent.com` | ID de cliente OAuth 2.0 tipo *Aplicación web* (público por diseño) |
| `VITE_DRIVE_EVIDENCE_FOLDER_ID` | con `google` | `1AbC...` | ID de la carpeta `EVIDENCIAS_FASE2` |
| `VITE_SHEETS_SPREADSHEET_ID` | con `google` | `1XyZ...` | Spreadsheet de **Fase 2** |
| `VITE_SHEETS_TAB_NAME` | no | `CAPTURA_FASE2` | Pestaña destino |
| `VITE_PHASE1_SPREADSHEET_ID` | recomendada | `1Fase1...` | ID del archivo de Fase 1; si coincide con el de Fase 2 la app bloquea la sincronización |
| `VITE_OCR_ENGINE` | no | `paddle` | `paddle` (defecto), `tesseract`, `remote`, `mock` |
| `VITE_OCR_REMOTE_URL` | con `remote` | `https://ocr-xxxx.run.app/ocr` | Backend OCR propio (ver contratos §4) |

## Credenciales que se configuran fuera del código

| Credencial | Dónde vive | Quién la crea |
|---|---|---|
| Proyecto de Google Cloud con Drive API y Sheets API habilitadas | Google Cloud Console | Antigravity |
| Pantalla de consentimiento OAuth (modo *Testing* con Eder y Héctor como usuarios de prueba, o *Internal* si es Workspace) | Google Cloud Console | Antigravity |
| ID de cliente OAuth *Aplicación web* con los orígenes JavaScript autorizados (URL de producción y `http://localhost:5173`) | Google Cloud Console | Antigravity |
| Permiso de **edición** de Eder y Héctor sobre `EVIDENCIAS_FASE2` y el Spreadsheet de Fase 2 | Google Drive | Propietario de la carpeta |
| (Opcional) clave/cuenta de servicio de Cloud Vision | **Solo** en el backend OCR | Antigravity |

## Nunca en el frontend

- `client_secret` de OAuth
- Claves privadas o JSON de cuentas de servicio
- Claves de API de Cloud Vision u otros servicios de pago
- Tokens de acceso o de actualización
