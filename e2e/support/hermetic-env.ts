import fs from 'node:fs';
import path from 'node:path';

// Entorno HERMÉTICO de las pruebas E2E: Vite da prioridad a las variables de proceso sobre los archivos .env*,
// así que ningún `.env.local` / `.env.production.local` de la máquina (con IDs reales de Drive/Sheets/OAuth)
// puede filtrarse al build de pruebas. Autenticación y sincronización SIEMPRE simuladas; usuarios ficticios.
export const HERMETIC_ENV: Record<string, string> = {
  VITE_INSTANCE: 'production', // mismo nombre de base IndexedDB que la app instalada (las pruebas de actualización lo necesitan)
  VITE_AUTH_MODE: 'mock',
  VITE_SYNC_MODE: 'mock',
  VITE_ALLOWED_USERS: 'EDR:Eder:eder@example.com,HCT:Héctor:hector@example.com',
  VITE_OCR_ENGINE: 'paddle',
  VITE_SCANNER: 'on',
  VITE_GOOGLE_CLIENT_ID: '',
  VITE_DRIVE_EVIDENCE_FOLDER_ID: '',
  VITE_DRIVE_ORIGINALS_FOLDER_ID: '',
  VITE_SHEETS_SPREADSHEET_ID: '',
  VITE_SHEETS_TAB_NAME: '',
  VITE_PRODUCTION_SPREADSHEET_ID: '',
  VITE_PRODUCTION_DRIVE_FOLDER_ID: '',
  VITE_PRODUCTION_ORIGINALS_FOLDER_ID: '',
  VITE_PHASE1_SPREADSHEET_ID: '',
  VITE_OCR_REMOTE_URL: '',
};

export const LOCAL_ENV_FILES = fs.readdirSync('.').filter((f) => /^\.env(\..+)?$/.test(f) && !/example/.test(f));
const SECRET_VALUES = LOCAL_ENV_FILES.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n')
  .map((l) => l.match(/^\s*(VITE_[A-Z0-9_]*(ID|URL|CLIENT_ID))\s*=\s*(.+?)\s*$/)?.[3] ?? '')
  .filter((v) => v.length >= 20));

export function assertHermetic(distDir: string) {
  const js = fs.readdirSync(path.join(distDir, 'assets')).filter((f) => /^main-.*\.js$/.test(f)).map((f) => fs.readFileSync(path.join(distDir, 'assets', f), 'utf8')).join('\n');
  const leaked = SECRET_VALUES.filter((v) => js.includes(v));
  return { leaked: leaked.length, mockAuth: /VITE_AUTH_MODE:`mock`/.test(js), mockSync: /VITE_SYNC_MODE:`mock`/.test(js), scanned: SECRET_VALUES.length };
}

