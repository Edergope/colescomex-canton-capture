import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { COMMERCIAL_FIELDS, SHEET_COLUMNS } from '../src/domain/schema';
import { toSheetRow } from '../src/sync/row';
import { openCaptureDB } from '../src/storage/db';
import { CaptureRepo } from '../src/storage/repo';

describe('esquema de Sheets', () => {
  it('las 29 columnas comerciales van primero y en el orden de Fase 1', () => {
    expect(COMMERCIAL_FIELDS).toEqual(['external_ref', 'capture_date', 'captured_by', 'mission', 'source', 'phase', 'hall', 'booth',
      'company_name', 'company_name_cn', 'contact_name', 'job_title', 'phone_1', 'phone_2', 'wechat', 'whatsapp', 'email', 'website',
      'address', 'city', 'province', 'country', 'supplier_type', 'main_products', 'product_interest', 'notes', 'follow_up',
      'data_classification', 'processing_status']);
    expect(SHEET_COLUMNS.slice(0, 29)).toEqual([...COMMERCIAL_FIELDS]);
  });
  it('la fila contiene exactamente las columnas declaradas, con precargados', async () => {
    const repo = new CaptureRepo(await openCaptureDB(`schema-${Math.random()}`));
    const c = await repo.createCapture({ id: 'EDR', name: 'Eder' }, [{ kind: 'card_front', blob: new Blob(['x'], { type: 'image/jpeg' }) }], { booth: 'C15' });
    const row = toSheetRow(c, await repo.evidences(c.uuid), []);
    expect(Object.keys(row)).toEqual([...SHEET_COLUMNS]);
    expect(row).toMatchObject({ mission: 'China 2026', source: 'Canton Fair', phase: 'Fase 2', country: 'China', data_classification: 'REAL',
      processing_status: 'CAPTURADO', booth: 'C15', captured_by: 'Eder', capture_uuid: c.uuid });
    expect(c.field_meta.booth).toMatchObject({ source: 'human', locked: true });
  });
});
