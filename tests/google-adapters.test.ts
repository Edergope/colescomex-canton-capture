// Verifica la FORMA de las peticiones REST y la idempotencia de los adaptadores Google contra un
// emulador mínimo de Drive v3 / Sheets v4. No sustituye la prueba real que debe hacer Antigravity.
import { describe, expect, it } from 'vitest';
import { GoogleDriveAdapter, GoogleSheetsAdapter, col } from '../src/adapters/google';
import { MockAuth } from '../src/adapters/mock';
import { AuthRequiredError, TransientRemoteError } from '../src/adapters/contracts';
import { fakeGoogle } from './support/fake-google';
import { classifySyncError } from '../src/ui/model';

// emulador compartido (subida reanudable, motivos de error reales de Google)

async function authed() { const a = new MockAuth([{ id: 'EDR', name: 'Eder' }]); await a.signIn('EDR'); return a; }

describe('GoogleDriveAdapter', () => {
  it('carpeta y archivos idempotentes por appProperties', async () => {
    const g = fakeGoogle(); const drive = new GoogleDriveAdapter(await authed(), 'ROOT', g.fetch);
    const f1 = await drive.ensureCaptureFolder({ capture_uuid: 'u-1', external_ref: 'CF26F2-EDR-AB12-0001' });
    const f2 = await drive.ensureCaptureFolder({ capture_uuid: 'u-1', external_ref: 'CF26F2-EDR-AB12-0001' });
    expect(f1.folderId).toBe(f2.folderId);
    const up = { evidence_id: 'e-1', capture_uuid: 'u-1', external_ref: 'CF26F2-EDR-AB12-0001', kind: 'card_front', file_name: 'x_01_card_front.jpg', mime: 'image/jpeg', blob: new Blob(['jpeg']) };
    const a = await drive.uploadEvidence(f1.folderId, up);
    const b = await drive.uploadEvidence(f1.folderId, up);
    expect(a.fileId).toBe(b.fileId);
    expect(g.files.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder')).toHaveLength(1);
    expect(g.files[1]).toMatchObject({ name: 'x_01_card_front.jpg', parents: [f1.folderId], appProperties: { evidence_id: 'e-1', capture_uuid: 'u-1' } });
  });
  it('respeta el ámbito de carpeta padre y no confunde archivo del respaldo con carpeta principal', async () => {
    const g = fakeGoogle();
    const mainDrive = new GoogleDriveAdapter(await authed(), 'ROOT_MAIN', g.fetch);
    const archiveDrive = new GoogleDriveAdapter(await authed(), 'ROOT_ARCHIVE', g.fetch);
    const mainFolder = await mainDrive.ensureCaptureFolder({ capture_uuid: 'u-1', external_ref: 'CF26F2-EDR-AB12-0001' });
    const archiveFolder = await archiveDrive.ensureCaptureFolder({ capture_uuid: 'u-1', external_ref: 'CF26F2-EDR-AB12-0001' });
    expect(mainFolder.folderId).not.toBe(archiveFolder.folderId);

    const up = { evidence_id: 'e-1', capture_uuid: 'u-1', external_ref: 'CF26F2-EDR-AB12-0001', kind: 'card_front', file_name: 'x_01_card_front.jpg', mime: 'image/jpeg', blob: new Blob(['jpeg']) };
    // 1. Primero se respalda en la carpeta de archivo
    const archUp = await archiveDrive.uploadEvidence(archiveFolder.folderId, up);
    // 2. Luego se sube a la carpeta principal (no debe devolver el archivo del archivo)
    const mainUp = await mainDrive.uploadEvidence(mainFolder.folderId, up);
    expect(mainUp.fileId).not.toBe(archUp.fileId);
    expect(g.files.find((f) => f.id === mainUp.fileId)!.parents).toEqual([mainFolder.folderId]);
    expect(g.files.find((f) => f.id === archUp.fileId)!.parents).toEqual([archiveFolder.folderId]);
  });
  it('clasifica errores: 401 → reautenticar, 503 → transitorio', async () => {
    const g = fakeGoogle(); const drive = new GoogleDriveAdapter(await authed(), 'ROOT', g.fetch);
    g.failWith(401);
    await expect(drive.ensureCaptureFolder({ capture_uuid: 'u', external_ref: 'r' })).rejects.toBeInstanceOf(AuthRequiredError);
    g.failWith(503);
    await expect(drive.ensureCaptureFolder({ capture_uuid: 'u', external_ref: 'r' })).rejects.toBeInstanceOf(TransientRemoteError);
  });
});

describe('GoogleDriveAdapter — subida reanudable y motivos reales de error (incidente HCT)', () => {
  const photo = (n: number) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 255; return new Blob([b], { type: 'image/jpeg' }); };
  const up = (blob: Blob, id = 'ev-1') => ({ evidence_id: id, capture_uuid: 'cap-1', external_ref: 'CF26F2-HCT-CCCB-0001', kind: 'card_front' as const, file_name: 'CF26F2-HCT-CCCB-0001_01_card_front.jpg', mime: 'image/jpeg', blob });
  const same = async (a: Uint8Array | undefined, b: Blob) => { const x = new Uint8Array(await b.arrayBuffer()); return !!a && a.length === x.length && a.every((v, i) => v === x[i]); };

  it('foto grande (> 5 MB, como las de cámaras de muchos megapíxeles) se sube por bloques con los bytes idénticos', async () => {
    const g = fakeGoogle(); const d = new GoogleDriveAdapter(await authed(), 'ROOT', g.fetch);
    const big = photo(6 * 1024 * 1024 + 123);
    const r = await d.uploadEvidence('ROOT', up(big));
    const f = g.files.find((x) => x.id === r.fileId)!;
    expect(f.size).toBe(big.size);
    expect(await same(f.bytes, big)).toBe(true);
    expect(g.log.filter((l) => l === 'PUT /upload/drive/v3/files')).toHaveLength(2); // dos bloques de 4 MB
  });

  it('corte de red a mitad: continúa desde el último byte confirmado, sin archivo duplicado', async () => {
    const g = fakeGoogle(); const d = new GoogleDriveAdapter(await authed(), 'ROOT', g.fetch, 256 * 1024);
    const blob = photo(1024 * 1024 + 9);
    g.dropChunks(2);
    const r = await d.uploadEvidence('ROOT', up(blob));
    expect(g.files.filter((x) => x.appProperties?.evidence_id === 'ev-1')).toHaveLength(1);
    expect(await same(g.files.find((x) => x.id === r.fileId)!.bytes, blob)).toBe(true);
  });

  it('Drive lleno (403 storageQuotaExceeded): error PERMANENTE con su motivo, nunca «sin permiso»', async () => {
    const g = fakeGoogle(); const d = new GoogleDriveAdapter(await authed(), 'ROOT', g.fetch);
    g.quotaFull = true;
    const err = (await d.uploadEvidence('ROOT', up(photo(1000))).then(() => new Error('no falló'), (e: Error) => e));
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(TransientRemoteError);
    expect(err.message).toMatch(/Google HTTP 403 storageQuotaExceeded/);
    expect(classifySyncError(err.message)).toMatchObject({ kind: 'quota', title: 'El Drive de su cuenta de Google está lleno' });
    expect(classifySyncError('Google HTTP 403 insufficientFilePermissions: The user does not have sufficient permissions').kind).toBe('permission');
  });

  it('límite de ritmo de Google (403 userRateLimitExceeded) es TRANSITORIO: se reintenta solo', async () => {
    const g = fakeGoogle(); const d = new GoogleDriveAdapter(await authed(), 'ROOT', g.fetch);
    g.errorNext(403, 'userRateLimitExceeded', 'User rate limit exceeded.');
    await expect(d.ensureCaptureFolder({ capture_uuid: 'cap-1', external_ref: 'X' })).rejects.toBeInstanceOf(TransientRemoteError);
    expect(classifySyncError('Google HTTP 403 userRateLimitExceeded: User rate limit exceeded.').kind).toBe('server');
  });
});

describe('GoogleSheetsAdapter', () => {
  it('crea cabecera, inserta, y en reintento actualiza la misma fila', async () => {
    const g = fakeGoogle(); const sheets = new GoogleSheetsAdapter(await authed(), 'SHEET', 'CAPTURA_FASE2', g.fetch);
    const r1 = await sheets.upsertRow({ external_ref: 'R1', company_name: 'A', capture_uuid: 'u-1', phone_1: '+8613800138000' });
    const r2 = await sheets.upsertRow({ external_ref: 'R2', company_name: 'B', capture_uuid: 'u-2', phone_1: '' });
    const r3 = await sheets.upsertRow({ external_ref: 'R1', company_name: 'A2', capture_uuid: 'u-1', phone_1: '+8613800138000' });
    expect(r1.action).toBe('inserted'); expect(r2.action).toBe('inserted');
    expect(r3).toEqual({ rowNumber: 2, action: 'updated' });
    expect(g.grid[0]).toEqual(['external_ref', 'company_name', 'capture_uuid', 'phone_1']);
    expect(g.grid).toHaveLength(3);
    expect(g.grid[1]).toEqual(['R1', 'A2', 'u-1', '+8613800138000']);
  });
  it('respeta columnas existentes y añade las técnicas al final', async () => {
    const g = fakeGoogle();
    g.grid = [['external_ref', 'company_name', 'notas_manuales'], ['OLD', 'Proveedor previo', 'no tocar']];
    const sheets = new GoogleSheetsAdapter(await authed(), 'SHEET', 'CAPTURA_FASE2', g.fetch);
    await sheets.upsertRow({ external_ref: 'R1', company_name: 'A', capture_uuid: 'u-1' });
    expect(g.grid[0]).toEqual(['external_ref', 'company_name', 'notas_manuales', 'capture_uuid']);
    expect(g.grid[1]).toEqual(['OLD', 'Proveedor previo', 'no tocar']);
    expect(g.grid[2]).toEqual(['R1', 'A', '', 'u-1']);
  });
  it('detecta duplicados de capture_uuid generados concurrentemente, actualiza canónica y limpia réplicas', async () => {
    const g = fakeGoogle();
    g.grid = [
      ['external_ref', 'company_name', 'capture_uuid', 'custom_col'],
      ['R1', 'Nombre Viejo 1', 'u-dup', 'valor_importante_1'],
      ['R1_DUP', 'Nombre Viejo 2', 'u-dup', 'valor_importante_2'], // Duplicado creado por concurrencia
    ];
    const sheets = new GoogleSheetsAdapter(await authed(), 'SHEET', 'CAPTURA_FASE2', g.fetch);
    const res = await sheets.upsertRow({ external_ref: 'R1', company_name: 'Nombre Actualizado', capture_uuid: 'u-dup' });
    expect(res).toEqual({ rowNumber: 2, action: 'updated' });
    // Fila 2 (canónica) actualizada conservando custom_col (null en row no sobreescribe)
    expect(g.grid[1]).toEqual(['R1', 'Nombre Actualizado', 'u-dup', 'valor_importante_1']);
    // Fila 3 (duplicada) limpiada
    expect(g.grid[2]).toEqual([]);
  });
  it('preserva notas humanas existentes en la hoja si la fila entrante no tiene nuevo contenido', async () => {
    const g = fakeGoogle();
    g.grid = [
      ['external_ref', 'company_name', 'capture_uuid', 'notes', 'follow_up'],
      ['R1', 'Empresa Original', 'u-notes', 'Nota importante escrita por operador en Sheets', 'Contactar el viernes'],
    ];
    const sheets = new GoogleSheetsAdapter(await authed(), 'SHEET', 'CAPTURA_FASE2', g.fetch);
    // Simular un re-sync donde notes y follow_up vienen vacíos desde el móvil
    const res = await sheets.upsertRow({ external_ref: 'R1', company_name: 'Empresa Actualizada', capture_uuid: 'u-notes', notes: '', follow_up: '' });
    expect(res).toEqual({ rowNumber: 2, action: 'updated' });
    expect(g.grid[1]).toEqual(['R1', 'Empresa Actualizada', 'u-notes', 'Nota importante escrita por operador en Sheets', 'Contactar el viernes']);
  });
  it('letras de columna', () => { expect([1, 26, 27, 45, 52, 53].map(col)).toEqual(['A', 'Z', 'AA', 'AS', 'AZ', 'BA']); });
});
