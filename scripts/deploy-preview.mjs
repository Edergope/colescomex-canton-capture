// Despliegue de VISTA PREVIA verdaderamente aislada (NO producción).
//
// Aislamiento en dos capas:
//  1. ORIGEN distinto (Cloudflare Pages: https://<proyecto>.pages.dev). IndexedDB, Cache Storage y el service
//     worker son por origen: la vista previa no puede ver ni modificar las capturas de la app de producción
//     (https://edergope.github.io). Por eso se rechaza cualquier destino *.github.io.
//  2. INSTANCIA `preview` en el código: base de datos local con otro nombre, franja "VISTA PREVIA" y bloqueo de
//     sincronización contra la hoja / carpetas de producción (VITE_PRODUCTION_* en .env.preview.local).
//
// No hace commit, push ni merge de ninguna rama y no toca GitHub Pages.
// Requisitos: .env.preview.local (ver .env.preview.example), `npx wrangler login` con la cuenta de Cloudflare de COLESCOMEX.
// Uso: node scripts/deploy-preview.mjs [--project=colescomex-capture-preview] [--dry-run]
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const project = arg('project', 'colescomex-capture-preview');
const dry = process.argv.includes('--dry-run');
const run = (cmd) => { console.log(`> ${cmd}`); return execSync(cmd, { cwd: root, stdio: 'inherit' }); };
const fail = (m) => { console.error(`✗ ${m}`); process.exit(1); };

if (/github\.io|edergope/i.test(project)) fail('Destino no permitido: una vista previa en *.github.io compartiría origen (IndexedDB) con producción.');
const envFile = path.join(root, '.env.preview.local');
if (!fs.existsSync(envFile)) fail('Falta .env.preview.local (copie .env.preview.example y complete los IDs de PRUEBA).');
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split('\n').filter((l) => /^\s*VITE_/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
if ((env.VITE_INSTANCE || 'production').toLowerCase() === 'production') fail('VITE_INSTANCE debe ser "preview" en .env.preview.local.');
const prodIds = [env.VITE_PRODUCTION_SPREADSHEET_ID, env.VITE_PRODUCTION_DRIVE_FOLDER_ID, env.VITE_PRODUCTION_ORIGINALS_FOLDER_ID, env.VITE_PHASE1_SPREADSHEET_ID].filter(Boolean);
if (prodIds.length < 2) fail('Declare VITE_PRODUCTION_SPREADSHEET_ID y VITE_PRODUCTION_DRIVE_FOLDER_ID (IDs de producción a BLOQUEAR).');
for (const k of ['VITE_SHEETS_SPREADSHEET_ID', 'VITE_DRIVE_EVIDENCE_FOLDER_ID', 'VITE_DRIVE_ORIGINALS_FOLDER_ID']) {
  if (env.VITE_SYNC_MODE === 'google' && !env[k]) fail(`Falta ${k} (recurso de PRUEBA) en .env.preview.local.`);
  if (env[k] && prodIds.includes(env[k])) fail(`${k} apunta a un recurso de PRODUCCIÓN.`);
}

// OAuth: cliente de PRUEBA, distinto del de producción (el de producción no debe autorizar orígenes de prueba sin aprobación)
if (env.VITE_AUTH_MODE === 'google') {
  if (!env.VITE_GOOGLE_CLIENT_ID) (dry ? console.warn : fail)('⚠ Falta VITE_GOOGLE_CLIENT_ID (cliente OAuth Web de PRUEBA con el origen *.pages.dev).');
  if (env.VITE_GOOGLE_CLIENT_ID && env.VITE_GOOGLE_CLIENT_ID === env.VITE_PRODUCTION_GOOGLE_CLIENT_ID && !process.argv.includes('--allow-production-oauth-client'))
    fail('VITE_GOOGLE_CLIENT_ID es el cliente de PRODUCCIÓN. Use un cliente de prueba (o --allow-production-oauth-client con aprobación expresa).');
}
if (!env.VITE_PHASE1_SPREADSHEET_ID) fail('Declare VITE_PHASE1_SPREADSHEET_ID para bloquear el archivo histórico de Fase 1.');
run('node scripts/check-private-data.mjs');

const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: root }).toString().trim();
const sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
console.log(`Vista previa aislada de ${branch}@${sha} → https://${project}.pages.dev`);

run('npm test');
run('npx tsc --noEmit && npx vite build --mode preview');
// Verificación del artefacto: usa la base de datos aislada y lleva incrustados los recursos de PRUEBA.
// (Los IDs de producción también van incrustados, a propósito, como lista de bloqueo.)
const dist = path.join(root, 'dist');
const js = fs.readdirSync(path.join(dist, 'assets')).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(dist, 'assets', f), 'utf8')).join('\n');
if (!js.includes('colescomex-canton-capture--') || !new RegExp(`["'\`]${env.VITE_INSTANCE}["'\`]`).test(js)) fail('El build no usa la base de datos aislada (¿VITE_INSTANCE?).');
for (const k of ['VITE_SHEETS_SPREADSHEET_ID', 'VITE_DRIVE_EVIDENCE_FOLDER_ID']) if (env[k] && !js.includes(env[k])) fail(`El build no contiene ${k} de prueba.`);
fs.writeFileSync(path.join(dist, 'PREVIEW.txt'), `Vista previa aislada ${branch}@${sha} ${new Date().toISOString()}\n`);
if (dry) { console.log('✓ --dry-run: build verificado, no se publicó.'); process.exit(0); }
run(`npx wrangler@4 pages deploy dist --project-name ${project} --branch preview --commit-message "preview ${branch}@${sha}" --commit-dirty=true`);
console.log(`\n✓ Vista previa: https://preview.${project}.pages.dev (y https://${project}.pages.dev si es el primer despliegue)`);
console.log('  Añada ese origen al cliente OAuth de PRUEBA (no al de producción) — ver ANTIGRAVITY_HANDOFF.md V3.');
