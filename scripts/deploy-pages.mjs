// scripts/deploy-pages.mjs
// Despliegue de COLESCOMEX Canton Fair Capture PWA a GitHub Pages
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function run(cmd, cwd = process.cwd()) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { cwd, stdio: 'inherit' });
}

console.log('=== DESPLIEGUE A GITHUB PAGES (COLESCOMEX CANTON FAIR CAPTURE) ===');

// 1. Compilar aplicación con variables de producción
console.log('\n[1/5] Compilando aplicación de producción (PWA y assets locales)...');
run('npm run build');

// 2. Preparar archivos para GitHub Pages (.nojekyll y 404.html)
console.log('\n[2/5] Configurando .nojekyll y fallback 404.html en dist/...');
fs.writeFileSync(path.join('dist', '.nojekyll'), '');
fs.copyFileSync(path.join('dist', 'index.html'), path.join('dist', '404.html'));

// 3. Crear repositorio remoto si no existe
const repoName = 'colescomex-canton-capture';
console.log(`\n[3/5] Verificando repositorio remoto en GitHub (${repoName})...`);
try {
  execSync(`gh repo view Edergope/${repoName}`, { stdio: 'pipe' });
  console.log(`✓ Repositorio Edergope/${repoName} ya existe.`);
} catch {
  console.log(`Creando repositorio público Edergope/${repoName}...`);
  run(`gh repo create Edergope/${repoName} --public --description "COLESCOMEX — Canton Fair Capture (Fase 2, China 2026) PWA"`);
}

// 4. Configurar remoto en el repo principal y subir main si no se ha subido
console.log('\n[4/5] Asegurando sincronización de código fuente en main...');
try {
  execSync('git remote get-url origin', { stdio: 'pipe' });
} catch {
  run(`git remote add origin https://github.com/Edergope/${repoName}.git`);
}

try {
  run('git add -A');
  run('git commit -m "feat: core Canton Fair Capture and live integrations" || true');
  run('git push -u origin main || true');
} catch (e) {
  console.warn('Nota sobre commit/push principal:', e.message);
}

// 5. Publicar dist/ en la rama gh-pages
console.log('\n[5/5] Desplegando dist/ en la rama gh-pages...');
const distDir = path.resolve('dist');
const tmpGitDir = path.join(distDir, '.git');
if (fs.existsSync(tmpGitDir)) {
  fs.rmSync(tmpGitDir, { recursive: true, force: true });
}

run('git init -b gh-pages', distDir);
run(`git remote add origin https://github.com/Edergope/${repoName}.git`, distDir);
run('git add -A', distDir);
run('git commit -m "deploy: PWA production build with self-hosted OCR models"', distDir);
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
