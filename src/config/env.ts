import type { UserProfile } from '../domain/schema';

const env = import.meta.env;
export function parseUsers(raw: string | undefined): UserProfile[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [id, name, email] = s.split(':').map((x) => x.trim());
    return { id: id.toUpperCase(), name: name || id, email: email || undefined };
  }).filter((u) => /^[A-Z0-9]{2,6}$/.test(u.id));
}

const instance = ((env.VITE_INSTANCE as string | undefined) || 'production').toLowerCase();

export const config = {
  /** `production` o un nombre de instancia aislada (p. ej. `preview`): base de datos local propia y guardas contra producción. */
  instance,
  /** Base de datos local: la instancia de vista previa nunca abre la de producción (aunque compartiera origen). */
  dbName: instance === 'production' ? 'colescomex-canton-capture' : `colescomex-canton-capture--${instance}`,
  /** IDs de los recursos de PRODUCCIÓN: una instancia no productiva se niega a sincronizar contra ellos. */
  productionIds: [env.VITE_PRODUCTION_SPREADSHEET_ID, env.VITE_PRODUCTION_DRIVE_FOLDER_ID, env.VITE_PRODUCTION_ORIGINALS_FOLDER_ID].filter(Boolean) as string[],
  authMode: (env.VITE_AUTH_MODE ?? 'mock') as 'mock' | 'google',
  syncMode: (env.VITE_SYNC_MODE ?? 'mock') as 'mock' | 'google',
  ocrEngine: (env.VITE_OCR_ENGINE ?? 'paddle') as 'paddle' | 'tesseract' | 'mock' | 'remote',
  ocrRemoteUrl: env.VITE_OCR_REMOTE_URL as string | undefined,
  users: parseUsers(env.VITE_ALLOWED_USERS ?? 'EDR:Eder,HCT:Héctor'),
  googleClientId: env.VITE_GOOGLE_CLIENT_ID as string | undefined,
  driveFolderId: env.VITE_DRIVE_EVIDENCE_FOLDER_ID as string | undefined,
  spreadsheetId: env.VITE_SHEETS_SPREADSHEET_ID as string | undefined,
  sheetTab: (env.VITE_SHEETS_TAB_NAME as string | undefined) || 'CAPTURA_FASE2',
  /** Carpeta de archivo de originales (opcional, permisos restringidos). Sin ella, los originales con recorte fiable quedan solo en el teléfono. */
  originalsFolderId: (env.VITE_DRIVE_ORIGINALS_FOLDER_ID as string | undefined) || undefined,
  /** Smart Document Scanner activo (por defecto sí). VITE_SCANNER=off lo desactiva. */
  scanner: (env.VITE_SCANNER ?? 'on') !== 'off',
  /** Salvaguarda: ID del archivo de Fase 1, que NUNCA debe usarse como destino. */
  phase1SpreadsheetId: env.VITE_PHASE1_SPREADSHEET_ID as string | undefined,
};

export function configProblems(): string[] {
  const p: string[] = [];
  if (!config.users.length) p.push('VITE_ALLOWED_USERS vacío');
  if (config.authMode === 'google' && !config.googleClientId) p.push('Falta VITE_GOOGLE_CLIENT_ID');
  if (config.authMode === 'google' && config.users.some((u) => !u.email)) p.push('Con AUTH_MODE=google cada usuario necesita email');
  if (config.instance !== 'production') {
    if (config.syncMode === 'google' && config.productionIds.length < 2) p.push('Vista previa: declare VITE_PRODUCTION_SPREADSHEET_ID y VITE_PRODUCTION_DRIVE_FOLDER_ID para poder bloquear los recursos de producción');
    for (const id of [config.spreadsheetId, config.driveFolderId, config.originalsFolderId]) {
      if (id && config.productionIds.includes(id)) p.push(`BLOQUEADO: la instancia "${config.instance}" apunta a un recurso de producción (${id.slice(0, 6)}…)`);
    }
  }
  if (config.syncMode === 'google') {
    if (config.authMode !== 'google') p.push('SYNC_MODE=google requiere AUTH_MODE=google');
    if (!config.driveFolderId) p.push('Falta VITE_DRIVE_EVIDENCE_FOLDER_ID');
    if (!config.spreadsheetId) p.push('Falta VITE_SHEETS_SPREADSHEET_ID');
    if (config.phase1SpreadsheetId && config.spreadsheetId === config.phase1SpreadsheetId) p.push('BLOQUEADO: el Spreadsheet configurado es el de Fase 1');
    if (config.scanner && !config.originalsFolderId) p.push('Falta VITE_DRIVE_ORIGINALS_FOLDER_ID: los originales de las tarjetas deben respaldarse en una carpeta restringida de Drive');
    if (config.originalsFolderId && config.originalsFolderId === config.driveFolderId) p.push('La carpeta de originales debe ser distinta de EVIDENCIAS_FASE2');
  }
  return p;
}
