// Regresión de extracción comercial sobre una tarjeta GEMELA FICTICIA con la misma estructura que la tarjeta real R1
// (los datos reales viven en el directorio privado: tests/private-real-cards.test.ts) y tarjetas de control para
// demostrar que las reglas generalizan (no hay datos fijos en el parser).
import { describe, expect, it } from 'vitest';
import { extractEntities } from '../src/extract/entities';
import { mergeSides } from '../src/extract/merge';
import type { OcrLine } from '../src/domain/schema';
import { TWIN_BACK, TWIN_EXPECTED as X, TWIN_FRONT, TWIN_PRODUCTS } from './fixtures/twin-card';

const L = (...t: string[]): OcrLine[] => t.map((text) => ({ text, score: 0.96 }));
const norm = (s = '') => s.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff@]/g, '');
const MY_FRONT = L(...TWIN_FRONT);
const MY_BACK = L(...TWIN_BACK);
const EXPECTED_PRODUCTS = TWIN_PRODUCTS;

describe('tarjeta gemela ficticia (estructura de la tarjeta real R1)', () => {
  const front = extractEntities(MY_FRONT);
  const back = extractEntities(MY_BACK);
  const m = mergeSides(front, back);

  it('empresa principal y segunda empresa identificada', () => {
    expect(norm(m.fields.company_name)).toBe(norm(X.company_name));
    expect(m.extras.secondary_companies.map(norm)).toEqual([norm(X.secondary)]);
    expect(m.meta.company_name?.status).toBe('ok');
  });
  it('contacto, teléfonos, fax, correo, QQ, código postal', () => {
    expect(m.fields.contact_name).toBe(X.contact_name);
    expect(m.meta.contact_name?.status).toBe('ok'); // nombre justo encima de "Mobile:"
    expect(m.fields.phone_1).toBe(X.phone_1);
    expect(m.fields.phone_2).toBe(X.phone_2);
    expect(m.extras.fax).toEqual([X.fax]);
    expect(m.fields.email).toBe(X.email);
    expect(m.extras.qq).toEqual([X.qq]);
    expect(m.extras.postal_code).toEqual([X.postal]);
  });
  it('dirección completa, ciudad y provincia explícitas', () => {
    const toks = norm(m.fields.address);
    for (const part of ['9 Example Road', 'Sample Town', 'Taicang City', 'Jiangsu Province', 'China']) expect(toks).toContain(norm(part));
    expect(m.fields.address).not.toMatch(/ZipCode|215400/);
    expect(m.fields.city).toBe(X.city);
    expect(m.fields.province).toBe('Jiangsu');
  });
  it('productos del reverso como lista (WE PRODUCE: es encabezado) y nunca como persona', () => {
    const items = m.fields.main_products!.split(/;\s*/);
    expect(items).toEqual(EXPECTED_PRODUCTS);
    expect(m.fields.main_products).not.toMatch(/WE PRODUCE/i);
    expect(back.fields.contact_name).toBeUndefined();
    expect(m.fields.contact_name).not.toMatch(/PLASTIC|GARDEN|LIGHT/i);
  });
  it('no inventa cargo, stand, web ni WeChat', () => {
    for (const f of ['job_title', 'booth', 'hall', 'website', 'wechat', 'whatsapp'] as const) {
      expect(m.fields[f]).toBe('');
      expect(m.meta[f]?.status).toBe('absent');
    }
  });
  it('el reverso solo, procesado aislado, no produce una persona', () => {
    const solo = mergeSides(back, undefined);
    expect(solo.fields.contact_name).toBe('');
    expect(solo.fields.main_products).toContain('PLASTIC GARDEN LIGHTS');
  });
  it('lectura tipo PaddleOCR del reverso (sin espacio en el encabezado, espacios anchos)', () => {
    const real = extractEntities(L('WEPRODUCE:', 'SOLAR LIGHTING  LED LIGHTING', 'GARDEN LIGHTING', 'STEEL POLE (TAPER AND POLYGON POLE)',
      'ALUMINIUM  POLE', 'HIGH MAST POLE', 'ELECTRIC POLE', 'COMMUNICATION POLE', 'FLOOD LIGTH  POLE', 'PLASTIC  GARDEN LIGHTS'));
    expect(real.fields.main_products?.value.split('; ')).toEqual(EXPECTED_PRODUCTS);
    expect(real.fields.contact_name).toBeUndefined();
  });
  it('palabras pegadas por el OCR: se conserva lo leído, se marca para revisión y se sugiere la separación', () => {
    const r = extractEntities(L('WE PRODUCE:', 'SOLARLIGHTING LED LIGHTING', 'GARDEN LIGHTING', 'HIGH MASTPOLE', 'COMMUNICATIONPOLE', 'ELECTRIC POLE'));
    const f = r.fields.main_products!;
    expect(f.value).toBe('SOLARLIGHTING LED LIGHTING; GARDEN LIGHTING; HIGH MASTPOLE; COMMUNICATIONPOLE; ELECTRIC POLE'); // texto leído intacto
    expect(f.status).toBe('review');
    expect(f.reason).toContain('"SOLARLIGHTING" → ¿"SOLAR LIGHTING"?');
    expect(f.reason).toContain('"MASTPOLE" → ¿"MAST POLE"?');
    expect(f.reason).toContain('"COMMUNICATIONPOLE" → ¿"COMMUNICATION POLE"?');
    expect(f.reason).toContain('parece contener 2 productos');
    expect(f.candidates).toContain('SOLAR LIGHTING; LED LIGHTING; GARDEN LIGHTING; HIGH MAST POLE; COMMUNICATION POLE; ELECTRIC POLE');
    expect(mergeSides(r, undefined).status).toBe('REQUIERE_REVISION');
  });
  it('lista bien leída no se marca (sin falsos positivos con palabras largas legítimas)', () => {
    const r = extractEntities(L('Main Products:', 'BLUETOOTH SPEAKERS', 'ALUMINIUM POLE', 'COMMUNICATION POLE', 'STAINLESS STEEL COOKWARE'));
    expect(r.fields.main_products?.status).toBe('ok');
    expect(r.fields.main_products?.candidates).toEqual([]);
  });
  it('lectura con logotipo "CE" intercalado y renglón partido por el detector', () => {
    const f = mergeSides(extractEntities(L(TWIN_FRONT[0], X.contact_name, TWIN_FRONT[3], TWIN_FRONT[4], 'CE', 'Jiangsu Province China', TWIN_FRONT[6], 'ZipCode:215400')), undefined);
    expect(f.fields.province).toBe('Jiangsu');
    expect(f.fields.address).toContain('Jiangsu Province China');
    const b = extractEntities(L('WE PRODUCE:', 'HIGH MAST POLE', 'ISO', 'ELECTRIC POLE'));
    expect(b.fields.main_products?.value).toBe('HIGH MAST POLE; ELECTRIC POLE');
  });
  it('variantes de lectura (etiquetas pegadas, renglones separados) siguen funcionando', () => {
    const r = mergeSides(extractEntities(L(TWIN_FRONT[0], TWIN_FRONT[1], X.contact_name, TWIN_FRONT[3], 'Add:9 Example Road Sample Town Taicang City',
      'Jiangsu Province China', 'ZipCode:215400', TWIN_FRONT[6], TWIN_FRONT[7], TWIN_FRONT[8], TWIN_FRONT[9])), undefined);
    expect(r.fields.phone_1).toBe(X.phone_1);
    expect(r.fields.email).toBe(X.email);
    expect(r.extras.postal_code).toEqual([X.postal]);
    expect(norm(r.fields.address)).toContain(norm('Jiangsu Province China'));
  });
});

describe('generalización a otras tarjetas', () => {
  it('lista "Main Products:" con viñetas y comas, y un nombre real en mayúsculas', () => {
    const r = mergeSides(extractEntities(L(
      'YONGKANG HOMEWARE CO., LTD.', 'KEVIN ZHOU', 'M: +86 135 7777 8888', 'Main Products:', '• Stainless steel pots, Frying pans', '• Kitchen tools',
      'E: kevin@ykhome.com')), undefined);
    expect(r.fields.main_products).toBe('Stainless steel pots; Frying pans; Kitchen tools');
    expect(r.fields.contact_name).toBe('KEVIN ZHOU');
    expect(r.fields.email).toBe('kevin@ykhome.com');
  });
  it('productos en chino con encabezado 主营产品：', () => {
    const r = mergeSides(extractEntities(L('宁波明辉电器有限公司', '主营产品：', '电风扇、取暖器', '空气净化器', '手机：13812345678')), undefined);
    expect(r.fields.main_products).toBe('电风扇; 取暖器; 空气净化器');
    expect(r.fields.phone_1).toBe('+8613812345678');
  });
  it('línea de producto en mayúsculas sin encabezado no se toma como persona', () => {
    const r = mergeSides(extractEntities(L('ACME TRADING CO., LTD', 'SOLAR GARDEN LAMPS', 'E: info@acme.com')), undefined);
    expect(r.fields.contact_name).toBe('');
  });
  it('tres empresas: principal + dos adicionales en orden', () => {
    const r = mergeSides(extractEntities(L('ALPHA LIGHTING CO., LTD', 'BETA ELECTRIC CO., LTD', 'GAMMA IMP & EXP CO., LTD', 'Tel: 0755-1234 5678')), undefined);
    expect(r.fields.company_name).toBe('ALPHA LIGHTING CO., LTD');
    expect(r.extras.secondary_companies).toEqual(['BETA ELECTRIC CO., LTD', 'GAMMA IMP & EXP CO., LTD']);
  });
  it('ciudad explícita fuera de la tabla, en inglés y en chino', () => {
    const en = mergeSides(extractEntities(L('X CO., LTD', 'Add: 5 Renmin Road, Cixi City, Zhejiang Province, China')), undefined);
    expect(en.fields.city).toBe('Cixi'); expect(en.fields.province).toBe('Zhejiang');
    const cn = mergeSides(extractEntities(L('慈溪市某某电器有限公司', '地址：浙江省慈溪市观海卫镇工业园88号')), undefined);
    expect(cn.fields.city).toBe('慈溪'); expect(cn.fields.province).toBe('Zhejiang');
  });
  it('código postal con distintas etiquetas', () => {
    for (const lbl of ['Zip Code: 528300', 'Postcode:528300', '邮编：528300']) {
      expect(extractEntities(L('X CO., LTD', lbl)).extras.postal_code).toEqual(['528300']);
    }
  });
});
