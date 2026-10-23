// Verificación REAL y de SOLO LECTURA de los recursos QA (Drive + hoja QA) con la CLI `gws` ya autenticada.
// Comprueba que cada enlace de `evidence_files` apunta a un archivo existente en el destino correcto
// (carpeta del proveedor bajo EVIDENCIAS QA, o subcarpeta de ORIGINALES QA para el respaldo restringido),
// que ningún enlace «principal» es en realidad el respaldo (defecto anterior) y que no hay duplicados.
// Nunca escribe nada. Nunca toca producción. Solo imprime recuentos y PASS/FAIL (sin datos personales).
// Uso: node scripts/verify-qa-drive-links.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const QA = {
  sheet: '1XZINlGzJTNeecbhp6WtZD5_753PXhnPz_H18DqeWB6E',
  evidences: '1SlN4GE7pD-HRq9PAEOqsIvgISLeq6ZB7',
  originals: '1kh--eCJyogNFVB9ILu8oAwXVkD-snB2I',
};
const PRODUCTION = new Set(['1UI5rjvi35nsYBT1ILuExgxyKHj4TgsM7DK08hWV1t6w', '1bqlJA_adbPpd_T4LvsjPtwEZrhys6-tF', '1-GEmu_QhY64NgQ9Gr4wEqVnDgix7QwLr', '1kEtxERqdcZYrKNWPfCnSvfFfRxxGEEJQC2skWm5UicQ']);
for (const id of Object.values(QA)) if (PRODUCTION.has(id)) { console.error('✗ ID de producción en la configuración QA: abortado'); process.exit(2); }

const gws = (...args) => {
  const out = execFileSync('gws', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  return out.trim().startsWith('{') ? JSON.parse(out.slice(out.indexOf('{'))) : out;
};
const get = (fileId) => gws('drive', 'files', 'get', '--params', JSON.stringify({ fileId, fields: 'id,name,parents,trashed,mimeType,appProperties', supportsAllDrives: true }));
const children = (folderId) => gws('drive', 'files', 'list', '--params', JSON.stringify({ q: `'${folderId}' in parents and trashed = false`, fields: 'files(id,name,mimeType,appProperties)', pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true })).files ?? [];

/** CSV mínimo (comillas dobles, saltos de línea dentro de campos) */
function parseCsv(t) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...rest] = rows;
  return rest.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ''])));
}

// `gws` solo escribe dentro del directorio actual: archivo temporal que se borra al instante
const tmp = `.qa-export-${process.pid}.csv`;
let csv = '';
try {
  execFileSync('gws', ['drive', 'files', 'export', '--params', JSON.stringify({ fileId: QA.sheet, mimeType: 'text/csv' }), '--output', tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
  csv = fs.readFileSync(tmp, 'utf8');
} finally { fs.rmSync(tmp, { force: true }); }
const rows = parseCsv(csv);
const origSubfolders = new Map(children(QA.originals).filter((f) => f.mimeType === 'application/vnd.google-apps.folder').map((f) => [f.id, f]));
const results = [];
const check = (ref, name, ok, detail = '') => results.push({ ref, name, ok, detail });

for (const r of rows) {
  const ref = r.external_ref || '(sin ref)';
  const folder = r.evidence_folder_id;
  const folderMeta = folder ? get(folder) : null;
  check(ref, 'carpeta del proveedor bajo EVIDENCIAS QA', !!folderMeta?.parents?.includes(QA.evidences));
  const lines = (r.evidence_files || '').split('\n').filter(Boolean);
  const ids = { main: new Set(), archive: new Set() };
  for (const line of lines) {
    const m = line.match(/\/d\/([\w-]{20,})/);
    if (!m) { check(ref, `enlace presente: «${line.replace(/https?:\S+/, '').slice(0, 40)}»`, /pendiente|sin respaldo/.test(line), 'sin URL'); continue; }
    const meta = get(m[1]);
    const archive = /respaldo restringido/.test(line);
    (archive ? ids.archive : ids.main).add(m[1]);
    const parent = meta.parents?.[0];
    if (archive) check(ref, `${line.split(':')[0]} → subcarpeta de ORIGINALES QA`, !meta.trashed && origSubfolders.has(parent));
    else check(ref, `${line.split(':')[0]} → carpeta del proveedor`, !meta.trashed && parent === folder);
  }
  const misfiled = [...ids.main].filter((id) => ids.archive.has(id));
  check(ref, 'ningún enlace principal es el respaldo (defecto anterior)', misfiled.length === 0, misfiled.length ? `${misfiled.length} afectado(s)` : '');
  if (folder) {
    const byEv = new Map();
    for (const f of children(folder)) { const k = f.appProperties?.evidence_id ?? f.name; byEv.set(k, (byEv.get(k) ?? 0) + 1); }
    check(ref, 'sin duplicados en la carpeta del proveedor', [...byEv.values()].every((n) => n === 1), `${byEv.size} evidencia(s)`);
  }
}
const rowsByUuid = new Map(); for (const r of rows) rowsByUuid.set(r.capture_uuid, (rowsByUuid.get(r.capture_uuid) ?? 0) + 1);
check('(hoja)', 'una sola fila por capture_uuid', [...rowsByUuid.values()].every((n) => n === 1), `${rows.length} fila(s)`);

for (const x of results) console.log(`${x.ok ? 'PASS' : 'FAIL'}  ${x.ref.replace(/^(CF26F2-\w+-)\w+/, '$1····')}  ${x.name}${x.detail ? ` (${x.detail})` : ''}`);
const failed = results.filter((x) => !x.ok).length;
console.log(`\nResultado QA real (solo lectura): ${results.length - failed} PASS · ${failed} FAIL`);
process.exit(failed ? 1 : 0);
