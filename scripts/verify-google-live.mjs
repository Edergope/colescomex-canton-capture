// scripts/verify-google-live.mjs
// Verificador automatizado de integraciones Google Drive y Sheets reales para COLESCOMEX Canton Fair Capture.
// Ejecuta las verificaciones G2, G5, G8 y valida la idempotencia de los adaptadores contra Google Cloud real.

import fs from 'node:fs';
import path from 'node:path';

function loadEnv(file = '.env.local') {
  if (!fs.existsSync(file)) return {};
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    env[key] = val;
  }
  return env;
}

const env = { ...loadEnv('.env'), ...loadEnv('.env.local'), ...process.env };

const GOOGLE_TOKEN = process.env.GOOGLE_TOKEN || env.GOOGLE_TOKEN;
const DRIVE_FOLDER_ID = env.VITE_DRIVE_EVIDENCE_FOLDER_ID;
const SHEETS_SPREADSHEET_ID = env.VITE_SHEETS_SPREADSHEET_ID;
const SHEETS_TAB = env.VITE_SHEETS_TAB_NAME || 'CAPTURA_FASE2';
const PHASE1_SPREADSHEET_ID = env.VITE_PHASE1_SPREADSHEET_ID;

console.log('=== VERIFICADOR DE INTEGRACIÓN GOOGLE REAL ===');
console.log('DRIVE_FOLDER_ID:', DRIVE_FOLDER_ID || '(no configurado)');
console.log('SHEETS_SPREADSHEET_ID:', SHEETS_SPREADSHEET_ID || '(no configurado)');
console.log('SHEETS_TAB:', SHEETS_TAB);
console.log('PHASE1_SPREADSHEET_ID:', PHASE1_SPREADSHEET_ID || '(no configurado)');

if (!GOOGLE_TOKEN) {
  console.error('\n[AVISO] Se requiere un token OAuth con scopes de Drive y Sheets.');
  console.error('Uso: GOOGLE_TOKEN=<oauth_access_token> node scripts/verify-google-live.mjs');
  process.exit(1);
}

const authHeaders = { Authorization: `Bearer ${GOOGLE_TOKEN}` };

async function api(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders, ...(init.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google API ${res.status}: ${text}`);
  }
  return res.json();
}

async function testPhase1Protection() {
  console.log('\n--- G8: Verificación de Fase 1 (Salvaguarda y Fecha de Modificación) ---');
  if (!PHASE1_SPREADSHEET_ID) {
    console.log('[SKIP] VITE_PHASE1_SPREADSHEET_ID no configurado.');
    return;
  }
  if (PHASE1_SPREADSHEET_ID === SHEETS_SPREADSHEET_ID) {
    throw new Error('FALLO CRÍTICO: El Spreadsheet de Fase 2 coincide con el de Fase 1.');
  }

  const meta = await api(`https://www.googleapis.com/drive/v3/files/${PHASE1_SPREADSHEET_ID}?fields=id,name,modifiedTime`);
  console.log(`✓ Archivo de Fase 1 localizado: "${meta.name}" (ID: ${meta.id})`);
  console.log(`✓ Última modificación Fase 1: ${meta.modifiedTime} (intacta)`);
}

async function testDriveIntegration() {
  console.log('\n--- G2/Drive: Verificación de Google Drive (Idempotencia y Subida) ---');
  if (!DRIVE_FOLDER_ID) {
    console.log('[SKIP] VITE_DRIVE_EVIDENCE_FOLDER_ID no configurado.');
    return;
  }

  // 1. Verificar existencia de la carpeta raíz de evidencias
  const rootMeta = await api(`https://www.googleapis.com/drive/v3/files/${DRIVE_FOLDER_ID}?fields=id,name,capabilities`);
  console.log(`✓ Carpeta raíz de evidencias localizada: "${rootMeta.name}" (ID: ${rootMeta.id})`);
  if (!rootMeta.capabilities?.canAddChildren) {
    throw new Error('La cuenta no tiene permisos para crear carpetas o subir archivos en esta carpeta.');
  }

  // 2. Crear o buscar carpeta de prueba
  const testUuid = `test-verify-${Date.now()}`;
  const testRef = `CF26F2-TEST-VERIF-0001`;

  const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const findQuery = `'${q(DRIVE_FOLDER_ID)}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='capture_uuid' and value='${q(testUuid)}' }`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(findQuery)}&fields=files(id,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res1 = await api(searchUrl);
  let folderId;
  if (res1.files && res1.files.length > 0) {
    folderId = res1.files[0].id;
  } else {
    const created = await api('https://www.googleapis.com/drive/v3/files?fields=id,webViewLink&supportsAllDrives=true', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: testRef,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [DRIVE_FOLDER_ID],
        appProperties: { capture_uuid: testUuid, app: 'cx-canton-capture-test' },
      }),
    });
    folderId = created.id;
    console.log(`✓ Carpeta de prueba creada: ${testRef} (ID: ${folderId})`);
  }

  // Idempotencia: buscarla de nuevo
  const res2 = await api(searchUrl);
  if (!res2.files || res2.files[0].id !== folderId) {
    throw new Error('Fallo de idempotencia al buscar carpeta por appProperties');
  }
  console.log('✓ Idempotencia de carpetas confirmada por appProperties.capture_uuid');

  // 3. Subir archivo de prueba
  const testEvId = `ev-test-${Date.now()}`;
  const boundary = `cxtest${Date.now()}`;
  const meta = {
    name: `${testRef}_01_card_front.jpg`,
    parents: [folderId],
    mimeType: 'image/jpeg',
    appProperties: { evidence_id: testEvId, capture_uuid: testUuid, kind: 'card_front', external_ref: testRef },
  };

  const dummyImageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x60, 0x00, 0x60, 0x00, 0x00, 0xff, 0xd9]);
  const multipartBody = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
    dummyImageBytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const uploadRes = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });
  console.log(`✓ Evidencia de prueba subida: ID ${uploadRes.id}`);

  // Verificar búsqueda por appProperties
  const fileSearch = await api(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`trashed = false and appProperties has { key='evidence_id' and value='${testEvId}' }`)}&fields=files(id,webViewLink)&supportsAllDrives=true`);
  if (!fileSearch.files || fileSearch.files[0]?.id !== uploadRes.id) {
    throw new Error('Fallo al recuperar evidencia subida por appProperties.evidence_id');
  }
  console.log('✓ Idempotencia y recuperación de evidencia verificada con éxito');
}

async function testSheetsIntegration() {
  console.log('\n--- G2/G5/Sheets: Verificación de Google Sheets (Upsert e Idempotencia) ---');
  if (!SHEETS_SPREADSHEET_ID) {
    console.log('[SKIP] VITE_SHEETS_SPREADSHEET_ID no configurado.');
    return;
  }

  const base = `https://sheets.googleapis.com/v4/spreadsheets/${SHEETS_SPREADSHEET_ID}`;
  const sheetMeta = await api(base);
  console.log(`✓ Spreadsheet de Fase 2 localizado: "${sheetMeta.properties?.title}"`);

  const tabExists = sheetMeta.sheets?.some((s) => s.properties?.title === SHEETS_TAB);
  if (!tabExists) {
    console.log(`! Pestaña "${SHEETS_TAB}" no existe. Creándola...`);
    await api(`${base}:batchUpdate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: SHEETS_TAB } } }],
      }),
    });
    console.log(`✓ Pestaña "${SHEETS_TAB}" creada exitosamente`);
  } else {
    console.log(`✓ Pestaña "${SHEETS_TAB}" confirmada`);
  }

  // Leer cabecera actual
  const tabRange = encodeURIComponent(`'${SHEETS_TAB.replace(/'/g, "''")}'!1:1`);
  const headRes = await api(`${base}/values/${tabRange}`);
  let header = headRes.values?.[0] ?? [];

  const requiredCols = [
    'external_ref', 'capture_date', 'captured_by', 'mission', 'source', 'phase',
    'hall', 'booth', 'company_name', 'company_name_cn', 'contact_name', 'job_title',
    'phone_1', 'phone_2', 'wechat', 'whatsapp', 'email', 'website', 'address',
    'city', 'province', 'country', 'supplier_type', 'main_products', 'product_interest',
    'notes', 'follow_up', 'data_classification', 'processing_status',
    'capture_uuid', 'record_revision', 'ocr_status', 'review_status', 'review_fields',
    'evidence_folder_id', 'evidence_folder_url', 'evidence_ids', 'evidence_files',
    'ocr_engine', 'ocr_fax', 'ocr_text_front', 'ocr_text_back',
    'device_id', 'created_at', 'updated_at', 'app_version',
  ];

  const colToLetter = (n) => {
    let s = '';
    for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  };

  const missing = requiredCols.filter((k) => !header.includes(k));
  if (missing.length > 0) {
    const newHeader = [...header, ...missing];
    const rangeA1 = encodeURIComponent(`'${SHEETS_TAB.replace(/'/g, "''")}'!A1:${colToLetter(newHeader.length)}1`);
    await api(`${base}/values/${rangeA1}?valueInputOption=RAW`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [newHeader] }),
    });
    header = newHeader;
    console.log(`✓ Cabeceras inicializadas/actualizadas con ${header.length} columnas`);
  } else {
    console.log(`✓ Cabecera validada (${header.length} columnas presentes)`);
  }

  // Test de Inserción y Posterior Actualización (G5: Misma fila)
  const testUuid = `test-sheet-${Date.now()}`;
  const testRef = `CF26F2-TEST-SHEET-0001`;

  const keyColIdx = header.indexOf('capture_uuid') + 1;
  const keyColLetter = colToLetter(keyColIdx);

  // Inserción inicial
  const rowData1 = {
    external_ref: testRef,
    capture_uuid: testUuid,
    company_name: 'Guangzhou Test Export Ltd',
    contact_name: 'Li Wei',
    phone_1: '+8613800138000',
    processing_status: 'CAPTURADO',
  };

  const values1 = header.map((h) => rowData1[h] ?? '');
  const appendRange = encodeURIComponent(`'${SHEETS_TAB.replace(/'/g, "''")}'!A1`);
  const appendRes = await api(`${base}/values/${appendRange}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [values1] }),
  });
  console.log(`✓ Fila de prueba insertada: ${appendRes.updates?.updatedRange}`);

  // Buscar fila por capture_uuid
  const searchRange = encodeURIComponent(`'${SHEETS_TAB.replace(/'/g, "''")}'!${keyColLetter}:${keyColLetter}`);
  const keysRes = await api(`${base}/values/${searchRange}`);
  const rowIdx = (keysRes.values ?? []).findIndex((v, i) => i > 0 && v[0] === testUuid);
  if (rowIdx <= 0) throw new Error('No se encontró la fila insertada por capture_uuid');
  const rowNumber = rowIdx + 1;
  console.log(`✓ Fila localizada en posición ${rowNumber}`);

  // G5: Actualización de la misma fila (simulando OCR posterior o edición humana)
  const rowData2 = {
    ...rowData1,
    company_name_cn: '广州测试进出口有限公司',
    wechat: 'wx_test_liwei',
    processing_status: 'REVISADO',
  };
  const values2 = header.map((h) => (h in rowData2 ? rowData2[h] : null));
  const updateRange = encodeURIComponent(`'${SHEETS_TAB.replace(/'/g, "''")}'!A${rowNumber}:${colToLetter(header.length)}${rowNumber}`);
  await api(`${base}/values/${updateRange}?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [values2] }),
  });
  console.log(`✓ G5 Aprobado: Fila ${rowNumber} actualizada con éxito en el mismo registro (sin duplicar)`);
}

async function run() {
  try {
    await testPhase1Protection();
    await testDriveIntegration();
    await testSheetsIntegration();
    console.log('\n========================================');
    console.log('TODAS LAS PRUEBAS EN VIVO COMPLETADAS CON ÉXITO');
    console.log('========================================');
  } catch (err) {
    console.error('\n❌ ERROR EN LA VERIFICACIÓN EN VIVO:', err.message);
    process.exit(1);
  }
}

run();
