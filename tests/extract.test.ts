import { describe, expect, it } from 'vitest';
import { extractEntities } from '../src/extract/entities';
import { mergeSides } from '../src/extract/merge';
import { normalizePhone, parseBooth } from '../src/extract/normalize';
import type { OcrLine } from '../src/domain/schema';

const L = (...t: (string | [string, number])[]): OcrLine[] => t.map((x) => (Array.isArray(x) ? { text: x[0], score: x[1] } : { text: x, score: 0.97 }));

describe('normalización', () => {
  it('teléfonos chinos a E.164', () => {
    expect(normalizePhone('+86 138 0013 8000')?.e164).toBe('+8613800138000');
    expect(normalizePhone('0086-13800138000')?.e164).toBe('+8613800138000');
    expect(normalizePhone('020-8888 6666')?.e164).toBe('+862088886666');
    expect(normalizePhone('+86-(0)20-8888-6666')?.e164).toBe('+862088886666');
    expect(normalizePhone('86-757-2233 4455')?.e164).toBe('+8675722334455');
    expect(normalizePhone('138OO138OOO')?.e164).toBe('+8613800138000');
    expect(normalizePhone('12')).toBeNull();
  });
  it('stand de Cantón', () => {
    expect(parseBooth('Booth No.: 12.1 E35-36')).toEqual({ hall: '12.1', booth: 'E35-36' });
    expect(parseBooth('展位号：9.2D18')).toEqual({ hall: '9.2', booth: 'D18' });
  });
});

describe('extracción de una tarjeta bilingüe', () => {
  const front = L(
    '广州市明亮照明科技有限公司',
    'GUANGZHOU BRIGHT LIGHTING TECHNOLOGY CO., LTD.',
    '王伟 销售经理',
    'Jason Wang  Sales Manager',
    'Tel: +86-20-8888 6666   Fax: +86-20-8888 6667',
    'Mob/WeChat/WhatsApp: +86 138 0013 8000',
    'E-mail: jason@brightlighting.com.cn',
    'Web: www.brightlighting.com.cn',
    'Add: No. 18 Huangpu Road, Baiyun District, Guangzhou, Guangdong, China',
    'Booth No.: 11.2 C15',
  );
  const r = extractEntities(front);
  it('campos con etiqueta', () => {
    expect(r.fields.email?.value).toBe('jason@brightlighting.com.cn');
    expect(r.fields.website?.value).toBe('www.brightlighting.com.cn');
    expect(r.fields.wechat?.value).toBe('+8613800138000');
    expect(r.fields.whatsapp?.value).toBe('+8613800138000');
    expect(r.phones.map((p) => p.value)).toEqual(['+8613800138000', '+862088886666']);
    expect(r.extras.fax).toEqual(['+862088886667']);
    expect(r.fields.hall?.value).toBe('11.2');
    expect(r.fields.booth?.value).toBe('C15');
  });
  it('empresa, persona, cargo y lugar', () => {
    expect(r.fields.company_name_cn?.value).toBe('广州市明亮照明科技有限公司');
    expect(r.fields.company_name?.value).toBe('GUANGZHOU BRIGHT LIGHTING TECHNOLOGY CO., LTD.');
    expect(r.fields.contact_name?.value).toMatch(/王伟|Jason Wang/);
    expect(r.fields.contact_name?.candidates.concat(r.fields.contact_name.value)).toEqual(expect.arrayContaining(['王伟', 'Jason Wang']));
    expect(r.fields.job_title?.value).toMatch(/销售经理|Sales Manager/);
    expect(r.fields.address?.value).toContain('Huangpu Road');
    expect(r.fields.city?.value).toBe('Guangzhou');
    expect(r.fields.province?.value).toBe('Guangdong');
    expect(r.fields.company_name_cn?.status).toBe('ok');
  });
});

describe('no inventa datos', () => {
  it('tarjeta con solo nombre y email → resto ausente', () => {
    const r = extractEntities(L('Lily Chen', 'lily.chen@163.com'));
    const m = mergeSides(r, undefined);
    expect(m.fields.email).toBe('lily.chen@163.com');
    expect(m.fields.phone_1).toBe('');
    expect(m.meta.phone_1?.status).toBe('absent');
    expect(m.fields.website).toBe('');
    expect(m.fields.address).toBe('');
    expect(m.fields.company_name).toBe('');
    expect(m.status).toBe('REQUIERE_REVISION'); // sin empresa
  });
  it('etiqueta con valor ilegible → illegible, no se rellena', () => {
    const r = extractEntities(L('ACME TRADING CO., LTD', 'Tel: ?#~', 'Email: sales@@', 'M: 13900139000'));
    const m = mergeSides(r, undefined);
    expect(m.fields.email).toBe('');
    expect(m.meta.email?.status).toBe('illegible');
    expect(m.fields.phone_1).toBe('+8613900139000');
  });
  it('baja confianza OCR → revisión', () => {
    const r = extractEntities(L('ACME TRADING CO., LTD', ['E: sales@acme.com', 0.6]));
    expect(r.fields.email?.status).toBe('review');
    expect(mergeSides(r, undefined).status).toBe('REQUIERE_REVISION');
  });
});

describe('fusión frontal + reverso', () => {
  const front = extractEntities(L('NINGBO OCEAN IMP. & EXP. CO., LTD.', 'Tony Li', 'Export Manager', 'M: +86 139 5744 1234', 'E: tony@ocean-nb.com'));
  const back = extractEntities(L('宁波海洋进出口有限公司', '李涛 外贸经理', '手机: 13957441234', '电话: 0574-8765 4321', '邮箱: tony@ocean-nb.com', '地址：浙江省宁波市鄞州区天童南路588号', '微信: tonyli_nb'));
  it('reverso completa, sin duplicar teléfonos', () => {
    const m = mergeSides(front, back);
    expect(m.fields.company_name).toBe('NINGBO OCEAN IMP. & EXP. CO., LTD.');
    expect(m.fields.company_name_cn).toBe('宁波海洋进出口有限公司');
    expect(m.meta.company_name_cn?.source).toBe('ocr_back');
    expect(m.fields.phone_1).toBe('+8613957441234');
    expect(m.fields.phone_2).toBe('+8657487654321');
    expect(m.fields.wechat).toBe('tonyli_nb');
    expect(m.fields.address).toContain('天童南路588号');
    expect(m.fields.city).toBe('Ningbo');
    expect(m.fields.province).toBe('Zhejiang');
    expect(m.meta.contact_name?.candidates).toContain('李涛');
    expect(m.status).toBe('EXTRAIDO');
  });
  it('contradicción → conserva frontal, guarda reverso como candidato y marca revisión', () => {
    const back2 = extractEntities(L('E: tony.li@ocean-nb.com'));
    const m = mergeSides(front, back2);
    expect(m.fields.email).toBe('tony@ocean-nb.com');
    expect(m.meta.email?.status).toBe('review');
    expect(m.meta.email?.candidates).toContain('tony.li@ocean-nb.com');
    expect(m.status).toBe('REQUIERE_REVISION');
  });
  it('respeta correcciones humanas bloqueadas', () => {
    const current = { fields: { email: 'tony.corrected@ocean-nb.com' } as never, field_meta: { email: { source: 'human' as const, status: 'ok' as const, locked: true } } };
    const m = mergeSides(front, back, current);
    expect(m.fields.email).toBeUndefined();
    expect(m.meta.email).toBeUndefined();
  });
});

describe('formatos variados', () => {
  it('tarjeta solo en chino', () => {
    const r = mergeSides(extractEntities(L('佛山市顺德区美家家具有限公司', '陈小明', '总经理', '手机：139 2233 4455', '电话：0757-2233 4455', '地址：广东省佛山市顺德区乐从镇家具城B座12号', 'QQ: 12345678')), undefined);
    expect(r.fields.company_name_cn).toBe('佛山市顺德区美家家具有限公司');
    expect(r.fields.contact_name).toBe('陈小明');
    expect(r.meta.contact_name?.status).toBe('ok');
    expect(r.fields.job_title).toBe('总经理');
    expect(r.fields.phone_1).toBe('+8613922334455');
    expect(r.fields.phone_2).toBe('+8675722334455');
    expect(r.fields.city).toBe('Foshan');
    expect(r.fields.province).toBe('Guangdong');
    expect(r.extras.qq).toEqual(['12345678']);
  });
  it('etiquetas de una letra y web sin www', () => {
    const r = mergeSides(extractEntities(L('SHENZHEN TOPWAY ELECTRONICS CO.,LTD', 'Amy Zhang', 'Sales Director', 'T: 0755-2345 6789', 'M: 18688889999', 'E: amy@topway-sz.com', 'W: topway-sz.com', 'WhatsApp: +86 186 8888 9999')), undefined);
    expect(r.fields.company_name).toBe('SHENZHEN TOPWAY ELECTRONICS CO.,LTD');
    expect(r.fields.contact_name).toBe('Amy Zhang');
    expect(r.fields.job_title).toBe('Sales Director');
    expect(r.fields.phone_1).toBe('+8618688889999');
    expect(r.fields.phone_2).toBe('+8675523456789');
    expect(r.fields.website).toBe('topway-sz.com');
    expect(r.fields.whatsapp).toBe('+8618688889999');
    expect(r.fields.city).toBe('');
    expect(r.meta.city?.candidates).toEqual(['Shenzhen']);
    expect(r.status).toBe('EXTRAIDO');
  });
  it('etiqueta pegada al email → se separa y queda para revisión', () => {
    const r = mergeSides(extractEntities(L('ACME TRADING CO., LTD', 'Emailtlily@xcdaily.com')), undefined);
    expect(r.fields.email).toBe('tlily@xcdaily.com');
    expect(r.meta.email?.status).toBe('review');
    expect(r.status).toBe('REQUIERE_REVISION');
  });
  it('nombre latino + chino en una línea', () => {
    const r = extractEntities(L('YIWU XINGCHEN DAILY PRODUCTS CO., LTD', 'Lily Chen 陈丽丽', 'WeChat: lilychen_yw88'));
    expect(r.fields.contact_name?.value).toBe('Lily Chen');
    expect(r.fields.contact_name?.candidates).toContain('陈丽丽');
  });
});
