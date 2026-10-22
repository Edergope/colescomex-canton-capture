import './ui/styles.css';
import { registerSW } from 'virtual:pwa-register';
import { config, configProblems } from './config/env';
import { CaptureApp } from './app/service';
import { UI } from './ui/views';
import { requestPersistentStorage, openCaptureDB } from './storage/db';
import { MockAuth, MockDrive, MockNetwork, MockSheets } from './adapters/mock';
import { GoogleAuthAdapter, GoogleDriveAdapter, GoogleSheetsAdapter } from './adapters/google';
import type { AuthAdapter, DriveAdapter, SheetsAdapter } from './adapters/contracts';
import type { OCRAdapter } from './ocr/OCRAdapter';
import type { UserProfile } from './domain/schema';
import { MockOCRAdapter } from './ocr/mock';
import { PaddleOCRAdapter } from './ocr/paddle';
import { TesseractOCRAdapter } from './ocr/tesseract';
import { RemoteOCRAdapter } from './ocr/remote';

async function boot() {
  // Sesión del usuario persistida en el dispositivo (permite capturar sin conexión).
  const db = await openCaptureDB();
  const sessionStore = {
    get: async () => ((await db.get('meta', 'session')) as UserProfile | null) ?? null,
    set: async (u: UserProfile | null) => { await db.put('meta', u, 'session'); },
  };
  const auth: AuthAdapter = config.authMode === 'google'
    ? new GoogleAuthAdapter(config.googleClientId ?? '', config.users, sessionStore)
    : new MockAuth(config.users, sessionStore);

  let drive: DriveAdapter, sheets: SheetsAdapter;
  if (config.syncMode === 'google' && configProblems().length) {
    // Nunca caer al mock en producción: sin configuración válida, la sincronización falla de forma visible.
    const blocked = async (): Promise<never> => { throw new Error(`Sincronización bloqueada: ${configProblems().join(' · ')}`); };
    drive = { ensureCaptureFolder: blocked, uploadEvidence: blocked };
    sheets = { upsertRow: blocked };
  } else if (config.syncMode === 'google') {
    drive = new GoogleDriveAdapter(auth, config.driveFolderId!);
    sheets = new GoogleSheetsAdapter(auth, config.spreadsheetId!, config.sheetTab);
  } else {
    // Remoto simulado en memoria (desarrollo). Respeta el estado de red real del navegador.
    const net = new MockNetwork();
    Object.defineProperty(net, 'online', { get: () => navigator.onLine, set: () => undefined });
    drive = new MockDrive(net); sheets = new MockSheets(net);
  }

  // Motor OCR: PaddleOCR por defecto; modelo ligero en teléfonos con ≤3 GB de RAM.
  const lowMem = ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 3;
  const ocr: OCRAdapter = config.ocrEngine === 'mock' ? new MockOCRAdapter({ delayMs: 300 })
    : config.ocrEngine === 'tesseract' ? new TesseractOCRAdapter()
      : config.ocrEngine === 'remote' && config.ocrRemoteUrl ? new RemoteOCRAdapter(config.ocrRemoteUrl, auth)
        : new PaddleOCRAdapter(undefined, { model: lowMem ? 'PP-OCRv6_tiny' : 'PP-OCRv5_mobile' });

  const app = await CaptureApp.create({ auth, ocr, drive, sheets, autoSyncMs: 60_000 });
  const storage = await requestPersistentStorage().catch(() => ({ persisted: false }));
  const ui = new UI(document.getElementById('app')!, app, { configProblems: configProblems(), engineName: ocr.name, storage });
  await ui.start();
  await app.start();
  // Para pruebas E2E e inspección en desarrollo (solo sin Google real).
  if (config.syncMode !== 'google') Object.assign(window, { __cx: { app, drive, sheets } });

  registerSW({ immediate: true, onOfflineReady() { console.info('[PWA] lista para uso sin conexión'); } });
}

boot().catch((e) => {
  document.getElementById('app')!.textContent = `Error al iniciar: ${(e as Error).message}`;
  console.error(e);
});
