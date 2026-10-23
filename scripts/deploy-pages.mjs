// scripts/deploy-pages.mjs
// Despliegue de COLESCOMEX Canton Fair Capture PWA a GitHub Pages
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { retainPreviousAssets } from './lib/retain-assets.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function run(cmd, cwd = projectRoot) {
  console.log(`> ${cmd} (in ${cwd})`);
  return execSync(cmd, { cwd, stdio: 'inherit' });
}

console.log('=== DESPLIEGUE A GITHUB PAGES (COLESCOMEX CANTON FAIR CAPTURE) ===');

// 1. Compilar aplicación con variables de producción
console.log('\n[1/4] Compilando aplicación de producción (PWA y assets locales)...');
run('npm run build');

// 2. Preparar archivos para GitHub Pages (.nojekyll y 404.html)
console.log('\n[2/4] Configurando .nojekyll y fallback 404.html en dist/...');
const distDir = path.join(projectRoot, 'dist');
fs.writeFileSync(path.join(distDir, '.nojekyll'), '');
fs.copyFileSync(path.join(distDir, 'index.html'), path.join(distDir, '404.html'));

// 2b. Retención de assets de la publicación anterior (una versión). Una app instalada que todavía ejecuta la
//     versión anterior (p. ej. esperando un momento seguro para recargar, o con el OCR en curso) puede pedir
//     chunks con hash antiguos (workers del OCR y del escáner). Si desaparecen del servidor fallarían con 404.
//     Solo se conservan los propios de la publicación anterior (no los que ella ya retenía): el tamaño no crece.
console.log('\n[2b] Conservando assets de la publicación anterior (compatibilidad durante la actualización)...');
try {
  execSync('git fetch origin gh-pages', { cwd: projectRoot, stdio: 'pipe' });
  const { retained, skippedPreviouslyRetained } = retainPreviousAssets({ cwd: projectRoot, ref: 'origin/gh-pages', distDir });
  console.log(`✓ ${retained.length} archivo(s) de la versión anterior conservados (fuera del precaché); ${skippedPreviouslyRetained.length} antiguos retirados.`);
} catch (e) {
  console.log(`(sin publicación anterior que conservar: ${String(e.message).split('\n')[0]})`);
  fs.writeFileSync(path.join(distDir, 'retained-assets.json'), '{ "files": [] }\n');
}

// 3. Verificar repositorio remoto
const repoName = 'colescomex-canton-capture';
console.log(`\n[3/4] Verificando repositorio remoto en GitHub (${repoName})...`);
try {
  execSync(`gh repo view Edergope/${repoName}`, { stdio: 'pipe' });
  console.log(`✓ Repositorio Edergope/${repoName} ya existe.`);
} catch {
  console.log(`Creando repositorio público Edergope/${repoName}...`);
  run(`gh repo create Edergope/${repoName} --public --description "COLESCOMEX — Canton Fair Capture (Fase 2, China 2026) PWA"`);
}

// 4. Publicar dist/ en la rama gh-pages
console.log('\n[4/4] Desplegando dist/ en la rama gh-pages...');
const tmpGitDir = path.join(distDir, '.git');
if (fs.existsSync(tmpGitDir)) {
  fs.rmSync(tmpGitDir, { recursive: true, force: true });
}

run('git init -b gh-pages', distDir);
run(`git remote add origin https://github.com/Edergope/${repoName}.git`, distDir);
run('git add -A', distDir);
const { version, build } = JSON.parse(fs.readFileSync(path.join(distDir, 'version.json'), 'utf8'));
run(`git commit -m "deploy: PWA v${version} (compilación ${build})"`, distDir);
run('git push -f origin gh-pages', distDir);

// Configurar GitHub Pages en el repositorio para que sirva desde gh-pages
console.log('\nConfigurando GitHub Pages en el repositorio...');
try {
  run(`gh api -X POST repos/Edergope/${repoName}/pages -f source='{"branch":"gh-pages","path":"/"}' || true`);
} catch (e) {
  console.log('Pages ya configurado o en proceso de activación.');
}

console.log('\n======================================================');
console.log('✓ DESPLIEGUE COMPLETADO CON ÉXITO');
console.log(`URL de producción PWA: https://edergope.github.io/${repoName}/`);
console.log('Origen JavaScript para Google OAuth: https://edergope.github.io');
console.log('======================================================');

