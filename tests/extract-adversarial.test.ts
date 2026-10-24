// Auditoría de la interpretación comercial con tarjetas FICTICIAS difíciles (salida típica del OCR, sin datos reales):
// productos en mayúsculas que parecen nombres, tarjetas sin persona, prefijos internacionales, WeChat sin etiqueta,
// líneas bilingües. Regla: nunca inventar; lo dudoso queda en revisión o vacío.
import { describe, expect, it } from 'vitest';
import { extractEntities } from '../src/extract/entities';
import { mergeSides } from '../src/extract/merge';
import type { OcrLine } from '../src/domain/schema';

const L = (...t: string[]): OcrLine[] => t.map((text) => ({ text, score: 0.95 }));
const run = (front: string[], back?: string[]) => mergeSides(extractEntities(L(...front)), back ? extractEntities(L(...back)) : undefined);
const PRODUCT_WORDS = /LIGHT|LED|POLE|VALVE|PUMP|PANEL|CABLE|FURNITURE|STEEL|GARDEN|SOLAR|LAMP|MOTOR/i;

describe('productos nunca se toman por personas', () => {
  it('tarjeta de catálogo sin persona: lista de productos en mayúsculas', () => {
    const m = run(['DEMO LIGHTING CO., LTD.', 'STREET LIGHT', 'SOLAR LAMP', 'HIGH MAST POLE', 'Tel: +86 755 5550 1234', 'www.demo-lighting.example']);
    expect(m.fields.contact_name ?? '').not.toMatch(PRODUCT_WORDS);
    expect(m.fields.job_title ?? '').not.toMatch(PRODUCT_WORDS);
  });
  it('«We produce» seguido de productos: van a productos, no a contacto', () => {
    const m = run(['Nimbus Demo Valves Co., Ltd.', 'Ada Ejemplo', 'Sales Manager', 'M: +86 138 0013 8000'], ['WE PRODUCE:', 'BALL VALVE', 'GATE VALVE', 'CHECK VALVE']);
    expect(m.fields.contact_name).toBe('Ada Ejemplo');
    expect(m.fields.contact_name).not.toMatch(PRODUCT_WORDS);
    expect(m.fields.main_products ?? '').toMatch(/BALL VALVE/i);
  });
  it('productos con dos palabras capitalizadas («Garden Lamp») no se aceptan como persona con confianza', () => {
    const m = run(['Demo Outdoor Ltd.', 'Garden Lamp', 'Solar Panel', 'E: info@outdoor.example']);
    const name = m.fields.contact_name ?? '';
    if (name) expect(m.meta.contact_name?.status).not.toBe('ok');
    expect(name).not.toMatch(PRODUCT_WORDS);
  });
});

describe('teléfonos y prefijos internacionales', () => {
  it('móvil chino con +86, fijo con 0086 y paréntesis', () => {
    const m = run(['Demo Trading Co.', 'Leo Prueba', 'Mobile: +86 139 5550 1234', 'Tel: 0086-(20)-5550-6789']);
    expect(m.fields.phone_1?.replace(/\D/g, '')).toMatch(/^86139/);
    expect(m.fields.phone_2?.replace(/\D/g, '')).toMatch(/^8620/);
  });
  it('número internacional no chino (+34, +1) conserva su prefijo', () => {
    const m = run(['Demo Imports SL', 'Mia Ficticia', 'Tel: +34 612 555 123', 'WhatsApp: +1 415 555 0134']);
    expect(m.fields.phone_1?.replace(/\D/g, '')).toMatch(/^34612/);
    expect(m.fields.whatsapp?.replace(/\D/g, '')).toMatch(/^1415/);
  });
});

describe('correo, web y WeChat', () => {
  it('correo y web con errores típicos del OCR (espacios) se normalizan', () => {
    const m = run(['Demo Hardware Ltd.', 'Tom Muestra', 'E-mail: tom @demo-hw.example', 'Web: www. demo-hw.example']);
    expect(m.fields.email).toBe('tom@demo-hw.example');
    expect(m.fields.website).toMatch(/demo-hw\.example/);
  });
  it('WeChat etiquetado en chino', () => {
    const m = run(['示例照明有限公司', '王小明 销售经理', '微信：demo_wx_2026', '手机：139 5550 1234']);
    expect(m.fields.wechat).toBe('demo_wx_2026');
    expect(m.fields.company_name_cn || m.fields.company_name).toMatch(/示例照明/);
  });
});

describe('bilingüe chino-inglés', () => {
  it('nombre chino y cargo en la misma línea; empresa en ambos idiomas', () => {
    const m = run(['佛山市示例家具有限公司', 'FOSHAN DEMO FURNITURE CO., LTD.', '陈示例 总经理', '手机：138 0013 8000', '邮箱：chen@demo-furniture.example']);
    expect(m.fields.company_name_cn).toMatch(/示例家具/);
    expect(m.fields.company_name).toMatch(/FURNITURE/i);
    expect(m.fields.contact_name).toBe('陈示例');
    expect(m.fields.job_title).toMatch(/总经理/);
    expect(m.fields.email).toBe('chen@demo-furniture.example');
  });
});

describe('sin datos: no se inventa', () => {
  it('tarjeta casi ilegible: campos vacíos, sin valores inventados', () => {
    const m = run(['~~ ##', 'l1l', '....']);
    for (const f of ['company_name', 'contact_name', 'email', 'phone_1', 'website', 'wechat'] as const) expect(m.fields[f] ?? '', f).toBe('');
  });
});
