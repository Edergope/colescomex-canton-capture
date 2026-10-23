// Verifica la FORMA de las peticiones REST y la idempotencia de los adaptadores Google contra un
// emulador mínimo de Drive v3 / Sheets v4. No sustituye la prueba real que debe hacer Antigravity.
import { describe, expect, it } from 'vitest';
import { GoogleDriveAdapter, GoogleSheetsAdapter, col } from '../src/adapters/google';
import { MockAuth } from '../src/adapters/mock';
import { AuthRequiredError, TransientRemoteError } from '../src/adapters/contracts';

function fakeGoogle() {
  const files: { id: string; name: string; parents: string[]; mimeType: string; appProperties: Record<string, string>; size: number }[] = [];
  let grid: string[][] = [];
  const log: string[] = [];
  let failNext: number | null = null;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  const parseA1 = (r: string) => {
    const m = decodeURIComponent(r).match(/!([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?/)!;
    const toN = (c: string) => [...c].reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0);
    return { c1: m[1] ? toN(m[1]) : 1, r1: m[2] ? Number(m[2]) : 1, c2: m[3] ? toN(m[3]) : m[1] ? toN(m[1]) : 999, r2: m[4] ? Number(m[4]) : m[3] === undefined && m[2] ? Number(m[2]) : 99999 };
  };
  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input)); const method = init.method ?? 'GET';
    log.push(`${method} ${url.pathname}`);
    if (!(init.headers as Record<string, string>)?.Authorization?.startsWith('Bearer ')) return json({ error: 'no auth' }, 401);
    if (failNext) { const s = failNext; failNext = null; return json({}, s); }
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const qs = url.searchParams.get('q')!;
      const props = [...qs.matchAll(/key='([^']+)' and value='([^']+)'/g)];
      const parent = qs.match(/'([^']+)' in parents/)?.[1];
      const out = files.filter((f) => props.every(([, k, v]) => f.appProperties[k] === v) && (!parent || f.parents.includes(parent)));
      return json({ files: out.map((f) => ({ id: f.id, webViewLink: `https://drive/${f.id}` })) });
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const b = JSON.parse(String(init.body)); const f = { ...b, id: `F${files.length + 1}`, size: 0 }; files.push(f);
      return json({ id: f.id, webViewLink: `https://drive/${f.id}` });
    }
    if (url.pathname === '/upload/drive/v3/files') {
      expect(url.searchParams.get('uploadType')).toBe('multipart');
      const text = await (init.body as Blob).text();
      const meta = JSON.parse(text.split('\r\n\r\n')[1].split('\r\n')[0]);
      const f = { ...meta, id: `F${files.length + 1}`, size: text.length }; files.push(f);
      return json({ id: f.id, webViewLink: `https://drive/${f.id}` });
    }
    const sm = url.pathname.match(/\/v4\/spreadsheets\/[^/]+\/values\/(.+?)(:(?:append|clear))?$/);
    if (sm) {
      const a = parseA1(sm[1]);
      if (method === 'GET') {
        const vals = grid.slice(a.r1 - 1, a.r2).map((r) => r.slice(a.c1 - 1, a.c2));
        return json({ values: vals.length ? vals : undefined });
      }
      if (sm[2] === ':clear') {
        if (grid[a.r1 - 1]) grid[a.r1 - 1] = [];
        return json({ clearedRange: sm[1] });
      }
      const body = JSON.parse(String(init.body)) as { values: (string | null)[][] };
      expect(url.searchParams.get('valueInputOption')).toBe('RAW');
      if (sm[2] === ':append') { grid.push(body.values[0].map((v) => v ?? '')); return json({ updates: { updatedRange: `'T'!A${grid.length}:Z${grid.length}` } }); }
      const r = grid[a.r1 - 1] ?? (grid[a.r1 - 1] = []);
      body.values[0].forEach((v, i) => { if (v !== null) r[a.c1 - 1 + i] = v; });
      return json({});
    }
    return json({ error: `ruta no emulada ${url.pathname}` }, 404);
  };
  return { files, get grid() { return grid; }, set grid(g) { grid = g; }, log, fetch: fetchImpl as typeof fetch, failWith: (s: number) => { failNext = s; } };
}

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
