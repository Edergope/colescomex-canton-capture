// Conciliación de SOLO LECTURA entre Google Drive, Google Sheets y el libro de sincronización de un teléfono.
// Cruza por capture_uuid: carpetas del proveedor (EVIDENCIAS) y del respaldo (ORIGINALES) con sus archivos, filas de
// la pestaña de captura y, si se aporta, el diagnóstico copiado del teléfono («Ajustes → Copiar diagnóstico»).
// Nunca escribe en Google: solo usa métodos list/get. El informe no contiene datos de proveedores (ni empresa ni
// contactos): referencias, identificadores, conteos y estados. Se guarda FUERA del repositorio.
//
// Uso:
//   node --import tsx scripts/reconcile-google.ts --user HCT [--ledger diagnostico.json] [--out <dir privado>]
// Requiere `gws` autenticado con alcance de solo lectura (drive.readonly y spreadsheets.readonly).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface DriveFolder { id: string; name: string; createdTime?: string; owner?: string; capture_uuid?: string; files: { name: string; size?: number; evidence_id?: string; kind?: string }[] }
export interface LedgerEntry { external_ref: string; capture_uuid: string; sync_status: string; sync_attempts?: number; sync_error?: string; main?: { expected: number; uploaded: number }; archive?: { expected: number; uploaded: number } }
export type Verdict = 'COMPLETA' | 'CARPETA_VACIA_SIN_FILA' | 'CARPETA_CON_ARCHIVOS_SIN_FILA' | 'FILA_SIN_ARCHIVOS' | 'SOLO_EN_DISPOSITIVO' | 'FILA_SIN_CARPETA';
export interface Reconciled {
  external_ref: string; capture_uuid: string; verdict: Verdict;
  main: { folder: boolean; files: number }; archive: { folder: boolean; files: number };
  row: { present: boolean; rows: number; captured_by?: string };
  device?: { sync_status: string; attempts?: number; error?: string; expected_main?: number; expected_archive?: number };
  folder_created?: string; folder_owner?: string;
}

/** Cruce puro (probado en tests/reconcile.test.ts). `rows` = filas de la hoja como objetos por cabecera. */
export function reconcile(input: { user: string; main: DriveFolder[]; archive: DriveFolder[]; rows: Record<string, string>[]; ledger?: LedgerEntry[] }) {
  const prefix = `CF26F2-${input.user}-`;
  const byUuid = new Map<string, Reconciled>();
  const get = (uuid: string, ref: string): Reconciled => {
    let r = byUuid.get(uuid);
    if (!r) byUuid.set(uuid, r = { external_ref: ref, capture_uuid: uuid, verdict: 'SOLO_EN_DISPOSITIVO', main: { folder: false, files: 0 }, archive: { folder: false, files: 0 }, row: { present: false, rows: 0 } });
    if (!r.external_ref && ref) r.external_ref = ref;
    return r;
  };
  // carpeta sin capture_uuid (no debería ocurrir): se identifica por nombre para no perderla
  const key = (f: DriveFolder) => f.capture_uuid || `sin-uuid:${f.name}`;
  for (const f of input.main.filter((x) => x.name.startsWith(prefix))) {
    const r = get(key(f), f.name); r.main.folder = true; r.main.files += f.files.length;
    r.folder_created ??= f.createdTime; r.folder_owner ??= f.owner;
  }
  for (const f of input.archive.filter((x) => x.name.startsWith(prefix))) { const r = get(key(f), f.name); r.archive.folder = true; r.archive.files += f.files.length; }
  for (const row of input.rows.filter((x) => (x.external_ref ?? '').startsWith(prefix) || x.user_id === input.user)) {
    const r = get(row.capture_uuid || `sin-uuid:${row.external_ref}`, row.external_ref); r.row.present = true; r.row.rows++; r.row.captured_by = row.captured_by;
  }
  for (const l of input.ledger ?? []) {
    if (!l.external_ref.startsWith(prefix)) continue;
    const r = get(l.capture_uuid, l.external_ref);
    r.device = { sync_status: l.sync_status, attempts: l.sync_attempts, error: l.sync_error, expected_main: l.main?.expected, expected_archive: l.archive?.expected };
  }
  for (const r of byUuid.values()) {
    const files = r.main.files + r.archive.files;
    r.verdict = r.row.present
      ? (!r.main.folder ? 'FILA_SIN_CARPETA' : r.main.files === 0 ? 'FILA_SIN_ARCHIVOS' : 'COMPLETA')
      : r.main.folder || r.archive.folder ? (files ? 'CARPETA_CON_ARCHIVOS_SIN_FILA' : 'CARPETA_VACIA_SIN_FILA') : 'SOLO_EN_DISPOSITIVO';
    // «completa» exige además los archivos esperados según el teléfono, si se conocen
    if (r.verdict === 'COMPLETA' && r.device?.expected_main && r.main.files < r.device.expected_main) r.verdict = 'FILA_SIN_ARCHIVOS';
  }
  const list = [...byUuid.values()].sort((a, b) => a.external_ref.localeCompare(b.external_ref));
  const count = (v: Verdict) => list.filter((r) => r.verdict === v).length;
  return {
    user: input.user, identified: list.length,
    complete: count('COMPLETA'),
    pending: list.filter((r) => r.verdict !== 'COMPLETA').length,
    by_verdict: Object.fromEntries((['COMPLETA', 'CARPETA_VACIA_SIN_FILA', 'CARPETA_CON_ARCHIVOS_SIN_FILA', 'FILA_SIN_ARCHIVOS', 'FILA_SIN_CARPETA', 'SOLO_EN_DISPOSITIVO'] as Verdict[]).map((v) => [v, count(v)])),
    duplicate_rows: list.filter((r) => r.row.rows > 1).map((r) => r.capture_uuid),
    device_errors: Object.entries(list.reduce<Record<string, number>>((m, r) => { const k = r.device?.error?.match(/Google HTTP \d+ ?\w*/)?.[0] ?? (r.device?.error ? 'otro' : ''); if (k) m[k] = (m[k] ?? 0) + 1; return m; }, {})),
    captures: list,
  };
}

/** Comparación con un informe anterior: qué capturas pasaron a COMPLETA (recuperadas) y cuáles fallan aún. */
export function compareReports(before: ReturnType<typeof reconcile>, after: ReturnType<typeof reconcile>) {
  const prev = new Map(before.captures.map((c) => [c.capture_uuid, c.verdict]));
  return {
    recovered: after.captures.filter((c) => c.verdict === 'COMPLETA' && prev.has(c.capture_uuid) && prev.get(c.capture_uuid) !== 'COMPLETA').map((c) => c.external_ref),
    still_pending: after.captures.filter((c) => c.verdict !== 'COMPLETA').map((c) => `${c.external_ref}: ${c.verdict}`),
    regressed: after.captures.filter((c) => prev.get(c.capture_uuid) === 'COMPLETA' && c.verdict !== 'COMPLETA').map((c) => c.external_ref),
  };
}

// ───────────── CLI (solo lectura vía gws) ─────────────
const READ_ONLY = /^(drive files (list|get)|sheets spreadsheets values get)$/;
function gws(service: string, resource: string, method: string, params: Record<string, unknown>): unknown[] {
  const cmd = `${service} ${resource} ${method}`;
  if (!READ_ONLY.test(cmd)) throw new Error(`Operación no permitida (solo lectura): ${cmd}`);
  const out = execFileSync('gws', [...cmd.split(' '), '--params', JSON.stringify(params), '--page-all', '--page-limit', '100'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return out.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => JSON.parse(l));
}
function folders(root: string, prefix: string): DriveFolder[] {
  const pages = gws('drive', 'files', 'list', { q: `'${root}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder' and name contains '${prefix}'`,
    fields: 'nextPageToken,files(id,name,createdTime,owners(emailAddress),appProperties)', pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true }) as { files?: { id: string; name: string; createdTime: string; owners?: { emailAddress: string }[]; appProperties?: Record<string, string> }[] }[];
  return pages.flatMap((p) => p.files ?? []).filter((f) => f.name.startsWith(prefix)).map((f) => {
    const kids = (gws('drive', 'files', 'list', { q: `'${f.id}' in parents and trashed=false`, fields: 'nextPageToken,files(name,size,appProperties)', pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true }) as { files?: { name: string; size?: string; appProperties?: Record<string, string> }[] }[]).flatMap((p) => p.files ?? []);
    return { id: f.id, name: f.name, createdTime: f.createdTime, owner: f.owners?.[0]?.emailAddress, capture_uuid: f.appProperties?.capture_uuid,
      files: kids.map((k) => ({ name: k.name, size: k.size ? Number(k.size) : undefined, evidence_id: k.appProperties?.evidence_id, kind: k.appProperties?.kind })) };
  });
}
function sheetRows(spreadsheetId: string, tab: string): Record<string, string>[] {
  const [page] = gws('sheets', 'spreadsheets', 'values get', { spreadsheetId, range: `'${tab}'` }) as { values?: string[][] }[];
  const [head = [], ...rest] = page?.values ?? [];
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
function env(file: string): Record<string, string> {
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').filter((l) => /^\s*VITE_/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}

if (process.argv[1] && /reconcile-google\.ts$/.test(process.argv[1])) {
  const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
  const user = (arg('user') ?? 'HCT').toUpperCase();
  const e = env(arg('env') ?? '.env.production.local');
  const out = path.resolve(arg('out') ?? path.join('..', 'colescomex-private-fixtures', 'reports'));
  if (out.startsWith(path.resolve('.'))) throw new Error('El informe contiene identificadores operativos: guárdelo fuera del repositorio (--out).');
  const ledgerFile = arg('ledger');
  const ledger = ledgerFile ? ((JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) as { sync?: LedgerEntry[] }).sync ?? []) : undefined;
  const prefix = `CF26F2-${user}-`;
  const report = reconcile({
    user, ledger,
    main: folders(e.VITE_DRIVE_EVIDENCE_FOLDER_ID, prefix),
    archive: e.VITE_DRIVE_ORIGINALS_FOLDER_ID ? folders(e.VITE_DRIVE_ORIGINALS_FOLDER_ID, prefix) : [],
    rows: sheetRows(e.VITE_SHEETS_SPREADSHEET_ID, e.VITE_SHEETS_TAB_NAME || 'CAPTURA_FASE2'),
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `conciliacion-${user}-${stamp}.json`);
  const prevFile = arg('previous');
  const diff = prevFile ? compareReports(JSON.parse(fs.readFileSync(prevFile, 'utf8')), report) : undefined;
  fs.writeFileSync(file, JSON.stringify({ generated_at: new Date().toISOString(), read_only: true, ...report, ...(diff ? { comparison: diff } : {}) }, null, 2), { mode: 0o600 });
  const { captures: _omit, ...summary } = report;
  console.log(JSON.stringify({ ...summary, ...(diff ? { comparison: diff } : {}), saved: file }, null, 2));
}
