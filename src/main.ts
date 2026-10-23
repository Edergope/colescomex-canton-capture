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
import { WorkerScanner } from './scanner/client';

async function boot() {
  // Sesión del usuario persistida en el dispositivo (permite capturar sin conexión).
  const db = await openCaptureDB(config.dbName);
  const sessionStore = {
    get: async () => ((await db.get('meta', 'session')) as UserProfile | null) ?? null,
    set: async (u: UserProfile | null) => { await db.put('meta', u, 'session'); },
  };
  const auth: AuthAdapter = config.authMode === 'google'
    ? new GoogleAuthAdapter(config.googleClientId ?? '', config.users, sessionStore)
    : new MockAuth(config.users, sessionStore);

  let drive: DriveAdapter, sheets: SheetsAdapter;
  let archiveDrive: DriveAdapter | undefined;
  if (config.syncMode === 'google' && configProblems().length) {
    // Nunca caer al mock en producción: sin configuración válida, la sincronización falla de forma visible.
    const blocked = async (): Promise<never> => { throw new Error(`Sincronización bloqueada: ${configProblems().join(' · ')}`); };
    drive = { ensureCaptureFolder: blocked, uploadEvidence: blocked };
    sheets = { upsertRow: blocked };
  } else if (config.syncMode === 'google') {
    drive = new GoogleDriveAdapter(auth, config.driveFolderId!);
    // Archivo de originales (opcional): misma implementación, otra carpeta raíz con permisos restringidos.
    if (config.originalsFolderId) archiveDrive = new GoogleDriveAdapter(auth, config.originalsFolderId);
    sheets = new GoogleSheetsAdapter(auth, config.spreadsheetId!, config.sheetTab);
  } else {
    // Remoto simulado en memoria (desarrollo). Respeta el estado de red real del navegador.
    const net = new MockNetwork();
    Object.defineProperty(net, 'online', { get: () => navigator.onLine, set: () => undefined });
    drive = new MockDrive(net); sheets = new MockSheets(net);
    archiveDrive = new MockDrive(net, 'ORIGINALES_FASE2'); // respaldo restringido simulado
  }

  // Motor OCR: PaddleOCR por defecto; modelo ligero en teléfonos con ≤3 GB de RAM.
  const lowMem = ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 3;
  const ocr: OCRAdapter = config.ocrEngine === 'mock' ? new MockOCRAdapter({ delayMs: 300 })
    : config.ocrEngine === 'tesseract' ? new TesseractOCRAdapter()
      : config.ocrEngine === 'remote' && config.ocrRemoteUrl ? new RemoteOCRAdapter(config.ocrRemoteUrl, auth)
        : new PaddleOCRAdapter(undefined, { model: lowMem ? 'PP-OCRv6_tiny' : 'PP-OCRv5_mobile' });

  const scanner = config.scanner && config.ocrEngine !== 'mock' ? new WorkerScanner() : undefined;
  const app = await CaptureApp.create({ dbName: config.dbName, auth, ocr, drive, sheets, scanner, archiveDrive, autoSyncMs: 60_000 });
  if (config.instance !== 'production') {
    document.body.classList.add('instance-preview');
    document.body.setAttribute('data-instance', `VISTA PREVIA · ${config.instance} · datos aislados`);
    document.title = `[${config.instance.toUpperCase()}] ${document.title}`;
  }
  const storage = await requestPersistentStorage().catch(() => ({ persisted: false }));
  const ui = new UI(document.getElementById('app')!, app, { configProblems: configProblems(), engineName: ocr.name, storage });
  await ui.start();
  await app.start();
  // Para pruebas E2E e inspección en desarrollo (solo sin Google real).
  if (config.syncMode !== 'google') Object.assign(window, { __cx: { app, drive, sheets, archive: archiveDrive } });

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // Activa inmediatamente la nueva versión y recarga la página de forma automática
      void updateSW(true);
    },
    onOfflineReady() {
      console.info('[PWA] lista para uso sin conexión');
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Comprobar actualización al volver al primer plano en el teléfono (desbloqueo / cambio de app)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          void registration.update().catch(() => undefined);
        }
      });
      // Comprobar actualización automáticamente cada 60 segundos
      setInterval(() => {
        void registration.update().catch(() => undefined);
      }, 60_000);
    },
  });
}

boot().catch((e) => {
  document.getElementById('app')!.textContent = `Error al iniciar: ${(e as Error).message}`;
  console.error(e);
});
