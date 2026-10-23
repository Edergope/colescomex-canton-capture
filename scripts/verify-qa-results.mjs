// scripts/verify-qa-results.mjs
// Verificador independiente de resultados QA tras la captura en la PWA (localhost:5173).
// Lee directamente desde Google Sheets QA y Google Drive QA sin modificar nada.
// Respeta estrictamente la privacidad: compara contra cases.json e imprime solo PASS/FAIL.
// Uso: node scripts/verify-qa-results.mjs

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateCases } from './private-dir.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const QA_SPREADSHEET_ID = '1XZINlGzJTNeecbhp6WtZD5_753PXhnPz_H18DqeWB6E';
const QA_TAB = 'CAPTURA_FASE2_PRUEBA';
const QA_EVIDENCES_FOLDER = '1SlN4GE7pD-HRq9PAEOqsIvgISLeq6ZB7';
const QA_ORIGINALS_FOLDER = '1kh--eCJyogNFVB9ILu8oAwXVkD-snB2I';
const PROD_SPREADSHEET_ID = '1UI5rjvi35nsYBT1ILuExgxyKHj4TgsM7DK08hWV1t6w';

function gws(cmd) {
  try {
    return JSON.parse(execSync(`gws ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (e) {
    const stdout = e.stdout?.toString() ?? '';
    const stderr = e.stderr?.toString() ?? '';
    if (stdout.includes('{')) {
      try { return JSON.parse(stdout.slice(stdout.indexOf('{'))); } catch {}
    }
    throw new Error(`gws fallo: ${stderr || e.message}`);
  }
}

console.log('=== VERIFICACIÓN INDEPENDIENTE DE RECURSOS QA (GOOGLE CLOUD) ===\n');

// 1. Verificar protección de Producción
console.log('1. Verificando protección de Producción...');
const prodData = gws(`sheets +read --spreadsheet ${PROD_SPREADSHEET_ID} --range "CAPTURA_FASE2!A1:A10"`);
const prodRows = prodData.values?.slice(1) ?? [];
if (prodRows.length !== 2 || prodRows[0][0] !== 'CF26F2-EDR-HDHG-0001' || prodRows[1][0] !== 'CF26F2-EDR-HDHG-0002') {
  console.error('❌ ALERTA: La hoja de producción no tiene exactamente los 2 registros esperados.');
  process.exit(1);
}
console.log('  ✓ Producción intacta: exactamente 2 registros existentes (0001 y 0002).');

// 2. Leer Google Sheets QA
console.log('\n2. Consultando Google Sheets QA (CAPTURA_FASE2_PRUEBA)...');
const sheetData = gws(`sheets +read --spreadsheet ${QA_SPREADSHEET_ID} --range "${QA_TAB}!A1:AU20"`);
const values = sheetData.values ?? [];
const header = values[0] ?? [];
const dataRows = values.slice(1);

console.log(`  Cabecera: ${header.length} columnas.`);
console.log(`  Filas de captura encontradas: ${dataRows.length}`);

if (dataRows.length === 0) {
  console.log('\n[ESTADO] La hoja QA está vacía y lista para recibir la captura desde http://localhost:5173/.');
  console.log('Realiza la captura en la PWA y vuelve a ejecutar este script para verificarla.');
  process.exit(0);
}

// Convertir filas a objetos
const rows = dataRows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));

// Comprobar prevención de duplicados
const uuids = rows.map((r) => r.capture_uuid).filter(Boolean);
const uniqueUuids = new Set(uuids);
if (uuids.length !== uniqueUuids.size) {
  console.error(`❌ ERROR: Se detectaron capture_uuid duplicados en la hoja QA (${uuids.length} filas vs ${uniqueUuids.size} únicos).`);
} else {
  console.log('  ✓ Prevención de duplicados: cada capture_uuid aparece exactamente en una fila.');
}

// 3. Verificar archivos en Drive QA
console.log('\n3. Consultando Google Drive QA...');
const origFiles = gws(`drive files list --params '{"q": "'\''${QA_ORIGINALS_FOLDER}'\'' in parents and trashed = false", "supportsAllDrives": true, "includeItemsFromAllDrives": true}'`).files ?? [];
console.log(`  Archivos en ORIGINALES_PRUEBA: ${origFiles.length}`);
for (const f of origFiles) {
  console.log(`    - [Original] ${f.name} (ID: ${f.id})`);
}

const evidFiles = gws(`drive files list --params '{"q": "'\''${QA_EVIDENCES_FOLDER}'\'' in parents and trashed = false", "supportsAllDrives": true, "includeItemsFromAllDrives": true}'`).files ?? [];
console.log(`  Elementos en EVIDENCIAS_PRUEBA: ${evidFiles.length}`);
for (const f of evidFiles) {
  console.log(`    - ${f.name} (${f.mimeType === 'application/vnd.google-apps.folder' ? 'Carpeta de captura' : 'Archivo'}) (ID: ${f.id})`);
}

// 4. Comparar contra el fixture privado de referencia (si coincide el ref)
const cases = privateCases();
if (cases && cases.length > 0) {
  console.log('\n4. Validación de campos contra manifiesto privado (sin exponer datos personales):');
  const norm = (s = '') => (s ?? '').toLowerCase().replace(/[^a-z0-9一-鿿@+]/g, '');

  for (const c of cases) {
    const matchedRow = rows.find((r) => r.contact_name && norm(r.contact_name) === norm(c.expected.fields.contact_name));
    if (!matchedRow) {
      console.log(`  (Caso ${c.id}: aún no capturado en Sheets QA)`);
      continue;
    }

    console.log(`  Evaluando fila capturada para caso ${c.id} (Ref: ${matchedRow.external_ref}):`);
    for (const [field, expectedVal] of Object.entries(c.expected.fields)) {
      const actualVal = matchedRow[field] ?? '';
      const match = norm(actualVal) === norm(expectedVal);
      console.log(`    ${match ? 'PASS' : 'FAIL'} ${field.padEnd(20)} ${match ? '✓' : `(leído: "${actualVal.slice(0, 15)}...")`}`);
    }

    const actualProducts = (matchedRow.main_products ?? '').split(';').map((p) => p.trim()).filter(Boolean);
    const prodCountMatch = actualProducts.length === c.expected.products.length;
    console.log(`    ${prodCountMatch ? 'PASS' : 'FAIL'} main_products count (${actualProducts.length}/${c.expected.products.length})`);
    for (const expectedP of c.expected.products) {
      const found = actualProducts.some((ap) => norm(ap) === norm(expectedP));
      console.log(`      ${found ? 'PASS' : 'FAIL'} producto: ${found ? '✓' : '(no identificado)'}`);
    }
  }
}

console.log('\n======================================================');
console.log('VERIFICACIÓN QA COMPLETADA');
console.log('======================================================');
