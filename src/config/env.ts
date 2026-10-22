import type { UserProfile } from '../domain/schema';

const env = import.meta.env;
export function parseUsers(raw: string | undefined): UserProfile[] {
  return (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const [id, name, email] = s.split(':').map((x) => x.trim());
    return { id: id.toUpperCase(), name: name || id, email: email || undefined };
  }).filter((u) => /^[A-Z0-9]{2,6}$/.test(u.id));
}

export const config = {
  authMode: (env.VITE_AUTH_MODE ?? 'mock') as 'mock' | 'google',
  syncMode: (env.VITE_SYNC_MODE ?? 'mock') as 'mock' | 'google',
  ocrEngine: (env.VITE_OCR_ENGINE ?? 'paddle') as 'paddle' | 'tesseract' | 'mock' | 'remote',
  ocrRemoteUrl: env.VITE_OCR_REMOTE_URL as string | undefined,
  users: parseUsers(env.VITE_ALLOWED_USERS ?? 'EDR:Eder,HCT:Héctor'),
  googleClientId: env.VITE_GOOGLE_CLIENT_ID as string | undefined,
  driveFolderId: env.VITE_DRIVE_EVIDENCE_FOLDER_ID as string | undefined,
  spreadsheetId: env.VITE_SHEETS_SPREADSHEET_ID as string | undefined,
  sheetTab: (env.VITE_SHEETS_TAB_NAME as string | undefined) || 'CAPTURA_FASE2',
  /** Salvaguarda: ID del archivo de Fase 1, que NUNCA debe usarse como destino. */
  phase1SpreadsheetId: env.VITE_PHASE1_SPREADSHEET_ID as string | undefined,
};

export function configProblems(): string[] {
  const p: string[] = [];
  if (!config.users.length) p.push('VITE_ALLOWED_USERS vacío');
  if (config.authMode === 'google' && !config.googleClientId) p.push('Falta VITE_GOOGLE_CLIENT_ID');
  if (config.authMode === 'google' && config.users.some((u) => !u.email)) p.push('Con AUTH_MODE=google cada usuario necesita email');
  if (config.syncMode === 'google') {
    if (config.authMode !== 'google') p.push('SYNC_MODE=google requiere AUTH_MODE=google');
    if (!config.driveFolderId) p.push('Falta VITE_DRIVE_EVIDENCE_FOLDER_ID');
    if (!config.spreadsheetId) p.push('Falta VITE_SHEETS_SPREADSHEET_ID');
    if (config.phase1SpreadsheetId && config.spreadsheetId === config.phase1SpreadsheetId) p.push('BLOQUEADO: el Spreadsheet configurado es el de Fase 1');
  }
  return p;
}
