// Extracción de entidades a partir de las líneas OCR de UNA imagen.
// Etapas: líneas OCR → segmentos etiquetados / no etiquetados → entidades normalizadas y validadas.
// Regla central: solo se devuelve texto que aparece en la imagen. Las heurísticas se marcan para revisión.

import type { FieldStatus, OcrField, OcrLine } from '../domain/schema';
import {
  BOOTH_RE, CJK_RE, cleanSpaces, fixDigitConfusions, isCjkDominant, nfkc, normalizeEmail, normalizePhone,
  normalizeWebsite, normalizeWechat, parseBooth, type NormalizedPhone,
} from './normalize';
import { ILLEGIBLE_CONFIDENCE, LOW_CONFIDENCE, isValidEmail, isValidWebsite, isValidWechatId } from './validate';
import { findPlaces } from './places';

export interface Hit {
  field: OcrField | 'phone' | 'fax' | 'qq';
  value: string;
  raw: string;
  line: number;
  score: number;
  labeled: boolean;
  status: FieldStatus;
  /** mayor = más fiable; sirve para elegir entre candidatos del mismo campo */
  strength: number;
  reason?: string;
  phoneKind?: NormalizedPhone['kind'];
  /** etiqueta de teléfono: mobile/tel/whatsapp/wechat para priorizar phone_1 */
  phoneRole?: 'mobile' | 'tel' | 'other';
}

export interface FieldCandidate {
  value: string;
  status: FieldStatus;
  confidence: number;
  reason?: string;
  candidates: string[];
  line?: number;
}

export interface SideExtraction {
  fields: Partial<Record<OcrField, FieldCandidate>>;
  /** teléfonos ordenados por prioridad (móvil etiquetado primero); se asignan a phone_1/phone_2 al fusionar */
  phones: Hit[];
  /** campos para los que hubo indicio pero no lectura válida */
  illegible: Partial<Record<OcrField, string>>;
  /** valores mencionados fuera de contexto (p. ej. ciudad en el nombre de la empresa): se sugieren, no se rellenan */
  suggestions: Partial<Record<OcrField, string>>;
  extras: { fax: string[]; qq: string[] };
  hits: Hit[];
}

type LabelType = 'tel' | 'mobile' | 'fax' | 'email' | 'web' | 'wechat' | 'whatsapp' | 'address' | 'booth' | 'products' | 'name' | 'title' | 'qq' | 'ignore';
interface LabelDef { src: string; type: LabelType; latin: boolean; strict: boolean }

const L = (src: string, type: LabelType, strict = false): LabelDef => ({ src, type, latin: /^[A-Za-z]/.test(src), strict });
const LABEL_DEFS: LabelDef[] = [
  L('Mobile Phone', 'mobile'), L('Cellphone', 'mobile'), L('Mobile', 'mobile'), L('Mob', 'mobile'), L('Cell', 'mobile'), L('HP', 'mobile', true), L('M', 'mobile', true),
  L('手机号码', 'mobile'), L('手机', 'mobile'), L('移动电话', 'mobile'),
  L('Telephone', 'tel'), L('Phone', 'tel'), L('Tel', 'tel'), L('TEL', 'tel'), L('Ph', 'tel', true), L('Office', 'tel', true), L('T', 'tel', true),
  L('电话', 'tel'), L('座机', 'tel'), L('固话', 'tel'),
  L('Fax', 'fax'), L('F', 'fax', true), L('传真', 'fax'),
  L('E-mail', 'email'), L('Email', 'email'), L('EMAIL', 'email'), L('Mail', 'email', true), L('E', 'email', true), L('邮箱', 'email'), L('电邮', 'email'), L('邮件', 'email'),
  L('Website', 'web'), L('Web', 'web'), L('Site', 'web', true), L('URL', 'web', true), L('Homepage', 'web'), L('W', 'web', true), L('网址', 'web'), L('网站', 'web'), L('主页', 'web'),
  L('WeChat ID', 'wechat'), L('Wechat ID', 'wechat'), L('WeChat', 'wechat'), L('Wechat', 'wechat'), L('WECHAT', 'wechat'), L('WX', 'wechat', true), L('微信号', 'wechat'), L('微信', 'wechat'), L('V信', 'wechat'),
  L('WhatsApp', 'whatsapp'), L('Whatsapp', 'whatsapp'), L('WHATSAPP', 'whatsapp'), L('WA', 'whatsapp', true),
  L('Address', 'address'), L('ADDRESS', 'address'), L('Addr', 'address'), L('Add', 'address', true), L('Adds', 'address', true),
  L('公司地址', 'address'), L('工厂地址', 'address'), L('厂址', 'address'), L('地址', 'address'),
  L('Booth No', 'booth'), L('Booth', 'booth'), L('Stand No', 'booth'), L('展位号', 'booth'), L('展位', 'booth'), L('摊位号', 'booth'),
  L('Main Products', 'products'), L('Products', 'products', true), L('Product', 'products', true),
  L('主营产品', 'products', true), L('主营', 'products', true), L('主要产品', 'products', true), L('经营范围', 'products', true), L('产品', 'products', true),
  L('Contact Person', 'name'), L('Contact', 'name', true), L('Name', 'name', true), L('联系人', 'name'), L('姓名', 'name', true),
  L('Title', 'title', true), L('Position', 'title', true), L('职位', 'title', true), L('职务', 'title', true),
  L('QQ', 'qq'), L('Skype', 'ignore'), L('Zip', 'ignore', true), L('Post Code', 'ignore', true), L('邮编', 'ignore'),
].sort((a, b) => b.src.length - a.src.length);

const SEP_BEFORE = /[\s|,;/·•()（）、，；]/;

interface LabelMatch { start: number; end: number; type: LabelType; valueStart: number; group: LabelType[] }

function findLabels(text: string): LabelMatch[] {
  const raw: { start: number; end: number; def: LabelDef }[] = [];
  for (const def of LABEL_DEFS) {
    const re = new RegExp(def.src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), def.latin ? 'g' : 'g');
    for (let m; (m = re.exec(text));) {
      const start = m.index, end = start + def.src.length;
      if (def.latin && (/[A-Za-z]/.test(text[start - 1] ?? '') || /[A-Za-z]/.test(text[end] ?? ''))) continue;
      const colonAfter = /^\s?[:：]/.test(text.slice(end));
      // separador antes, o etiqueta seguida de ":" (tolera un carácter espurio del OCR: "9M:")
      if (start > 0 && !SEP_BEFORE.test(text[start - 1]) && !colonAfter) continue;
      if (raw.some((r) => start < r.end && end > r.start)) continue; // solapado con una etiqueta más larga
      raw.push({ start, end, def });
    }
  }
  raw.sort((a, b) => a.start - b.start);
  const out: LabelMatch[] = [];
  for (let i = 0; i < raw.length; i++) {
    const group: LabelDef[] = [raw[i].def];
    let j = raw[i].end; let k = i;
    // grupos: "WeChat/WhatsApp: ..." o "Tel & WeChat: ..."
    while (k + 1 < raw.length) {
      const between = text.slice(j, raw[k + 1].start);
      if (/^\s*[/&、]\s*$/.test(between)) { k++; group.push(raw[k].def); j = raw[k].end; } else break;
    }
    const after = text.slice(j);
    const colon = after.match(/^\s*[:：]\s*/) ?? (group[0].latin ? after.match(/^\.\s*/) : null);
    let valueStart: number | null = null;
    if (colon) valueStart = j + colon[0].length;
    else if (!group.some((g) => g.strict)) {
      const sp = after.match(/^\s+/);
      if (sp || (!group[0].latin && /^[\d+(（A-Za-z一-鿿]/.test(after))) valueStart = j + (sp?.[0].length ?? 0);
    }
    if (valueStart === null) continue;
    out.push({ start: raw[i].start, end: j, type: group[0].type, valueStart, group: group.map((g) => g.type) });
    i = k;
  }
  return out;
}

const COMPANY_CN_RE = /有限公司|有限责任公司|股份|集团|公司|厂|商行|实业|工贸|贸易行|工作室|经营部|制造/;
const COMPANY_CN_STRONG = /有限公司|有限责任公司|股份有限|集团/;
const COMPANY_EN_RE = /\b(co\.?\s*,?\s*(ltd|limited)\.?|company|corp(oration)?\.?|limited|inc\.?|industr(y|ial|ies)|trading|technology|tech\.?|manufactur\w*|factory|group|enterprises?|imp\.?\s*(&|and)\s*exp\.?|import|export|llc|gmbh|electronics?|international|intl\.?)\b/i;
const COMPANY_EN_STRONG = /\b(co\.?\s*,?\s*(ltd|limited)|limited|corporation|inc\.?|llc|gmbh)\b/i;
const TITLE_EN_RE = /\b(manager|director|ceo|cfo|coo|cto|president|vice president|vp|sales|salesman|saleswoman|marketing|purchasing|export|engineer|supervisor|assistant|representative|executive|owner|founder|chairman|boss|merchandiser|account|business development|bd|general manager|gm|secretary|consultant|specialist|leader|head)\b/i;
const TITLE_CN_RE = /总经理|副总经理|经理|总监|主管|董事长|董事|总裁|销售|业务员|业务|外贸|采购|主任|助理|专员|厂长|工程师|代表|老板|负责人|经理人|跟单/;
const ADDRESS_CN_RE = /省|市|区|县|镇|乡|村|路|街|道|号|巷|弄|大厦|广场|工业园|工业区|开发区|园区|楼|室|栋/;
const ADDRESS_EN_RE = /\b(road|rd\.?|street|st\.?|avenue|ave\.?|district|dist\.?|town|county|city|province|industrial (park|zone|area|district)|zone|building|bldg\.?|floor|fl\.?|room|rm\.?|no\.?\s*\d+|village|lane|highway|p\.?\s?r\.?\s?china|china)\b/i;
const PRODUCTS_RE = /(专业生产|专业制造|主营|专注于|生产销售)|\b(specializ\w+ in|manufacturer of|we (produce|make|supply)|supplier of|professional (manufacturer|supplier) of)\b/i;
const NAME_STOPWORDS = /\b(china|guangzhou|shenzhen|foshan|dongguan|ningbo|yiwu|xiamen|sales|manager|company|limited|ltd|road|street|province|city|district|canton|fair|booth|hall|tel|fax|email|mobile|phone|web|website|wechat|whatsapp|address|products?|factory|group|industrial|trading|technology|the|and|of|international|electronics?|export|import|lighting|furniture|machinery|co)\b/i;
// Apellidos chinos frecuentes (aumentan la confianza en nombres de 2-4 caracteres).
const CN_SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤';

function lineStatus(score: number): { status: FieldStatus; reason?: string } {
  if (score < ILLEGIBLE_CONFIDENCE) return { status: 'illegible', reason: `confianza OCR ${score.toFixed(2)}` };
  if (score < LOW_CONFIDENCE) return { status: 'review', reason: `confianza OCR baja (${score.toFixed(2)})` };
  return { status: 'ok' };
}

const EMAIL_SCAN = /[A-Za-z0-9._%+-]+\s?[@＠]\s?[A-Za-z0-9-]+(?:\s?\.\s?[A-Za-z0-9-]+)*\s?\.\s?[A-Za-z]{2,}/g;
const WEB_SCAN = /(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com\.cn|net\.cn|org\.cn|com\.hk|[a-z]{2,8})(?:\/[^\s,，;；]*)?/gi;
const PHONE_SCAN = /(?:\+|00)?\(?\d[\d\s\-().]{5,}\d/g;

export function extractEntities(lines: OcrLine[]): SideExtraction {
  const hits: Hit[] = [];
  const extras = { fax: [] as string[], qq: [] as string[] };
  const illegible: Partial<Record<OcrField, string>> = {};
  const plain: { idx: number; text: string; score: number }[] = [];
  const addressLines = new Set<number>();

  const push = (h: Omit<Hit, 'status' | 'reason'> & { status?: FieldStatus; reason?: string }) => {
    const ls = lineStatus(h.score);
    const status = h.status && h.status !== 'ok' ? h.status : ls.status;
    hits.push({ ...h, status, reason: h.reason ?? ls.reason });
  };

  const phoneHits = (value: string, idx: number, score: number, labeled: boolean, role: Hit['phoneRole'], field: Hit['field'] = 'phone') => {
    const parts = value.split(/\s*[/,，;；|]\s*|\s{3,}/).filter((p) => /\d/.test(p));
    let any = false;
    for (const part of parts) {
      const p = normalizePhone(part);
      if (!p || (p.kind === 'unknown' && !labeled)) continue;
      const fixed = fixDigitConfusions(nfkc(part)).fixed;
      any = true;
      push({ field, value: p.e164, raw: part.trim(), line: idx, score, labeled, strength: labeled ? 3 : p.kind === 'mobile_cn' ? 2 : 1,
        phoneKind: p.kind, phoneRole: role,
        status: p.kind === 'unknown' ? 'review' : fixed ? 'review' : !labeled && p.kind !== 'mobile_cn' ? 'review' : undefined,
        reason: p.kind === 'unknown' ? 'formato de teléfono no reconocido' : fixed ? 'se corrigieron letras confundidas con dígitos' : !labeled && p.kind !== 'mobile_cn' ? 'número sin etiqueta (podría ser fax)' : undefined });
    }
    return any;
  };

  lines.forEach((ln, idx) => {
    const text = nfkc(ln.text).replace(/\s+/g, ' ').trim();
    if (!text) return;
    const score = ln.score ?? 1;
    const labels = findLabels(text);
    const unlabeledParts: string[] = [];
    if (labels.length === 0) unlabeledParts.push(text);
    else if (labels[0].start > 0) unlabeledParts.push(text.slice(0, labels[0].start));

    labels.forEach((lb, i) => {
      const value = text.slice(lb.valueStart, labels[i + 1]?.start ?? text.length).replace(/^[\s:：]+|[\s,，;；|/]+$/g, '');
      for (const type of lb.group) {
        switch (type) {
          case 'tel': case 'mobile':
            if (!phoneHits(value, idx, score, true, type === 'mobile' ? 'mobile' : 'tel') && value) { illegible.phone_1 ??= value; }
            break;
          case 'whatsapp': {
            const p = normalizePhone(value);
            if (p && p.kind !== 'unknown') push({ field: 'whatsapp', value: p.e164, raw: value, line: idx, score, labeled: true, strength: 3 });
            else if (value) illegible.whatsapp ??= value;
            if (lb.group.includes('tel') || lb.group.includes('mobile')) break;
            if (p && p.kind !== 'unknown' && lb.group.length > 1) phoneHits(value, idx, score, true, 'other');
            break;
          }
          case 'fax': {
            const p = normalizePhone(value);
            if (p) extras.fax.push(p.e164);
            break;
          }
          case 'email': {
            const m = value.match(EMAIL_SCAN);
            const v = normalizeEmail(m?.[0] ?? value);
            if (isValidEmail(v)) push({ field: 'email', value: v, raw: value, line: idx, score, labeled: true, strength: 3 });
            else if (value) illegible.email ??= value;
            break;
          }
          case 'web': {
            const v = normalizeWebsite(value.split(/\s+/)[0] ?? '');
            const val = isValidWebsite(v);
            if (val.valid) push({ field: 'website', value: v, raw: value, line: idx, score, labeled: true, strength: 3, status: val.knownTld ? undefined : 'review', reason: val.knownTld ? undefined : 'dominio poco común' });
            else if (value) illegible.website ??= value;
            break;
          }
          case 'wechat': {
            const v = normalizeWechat(value.split(/\s{2,}/)[0]);
            const ph = /^\+?[\d\s-]{7,}$/.test(v) ? normalizePhone(v) : null;
            const out = ph && ph.kind !== 'unknown' ? ph.e164 : v;
            if (isValidWechatId(out)) push({ field: 'wechat', value: out, raw: value, line: idx, score, labeled: true, strength: 3 });
            else if (value) illegible.wechat ??= value;
            break;
          }
          case 'address':
            if (value) { push({ field: 'address', value: cleanSpaces(value), raw: value, line: idx, score, labeled: true, strength: 3 }); addressLines.add(idx); }
            break;
          case 'booth': {
            const b = parseBooth(value);
            if (b) {
              push({ field: 'hall', value: b.hall, raw: value, line: idx, score, labeled: true, strength: 3 });
              push({ field: 'booth', value: b.booth, raw: value, line: idx, score, labeled: true, strength: 3 });
            } else if (value) illegible.booth ??= value;
            break;
          }
          case 'products':
            if (value) push({ field: 'main_products', value: cleanSpaces(value), raw: value, line: idx, score, labeled: true, strength: 3 });
            break;
          case 'name':
            if (value) push({ field: 'contact_name', value: cleanSpaces(value), raw: value, line: idx, score, labeled: true, strength: 4 });
            break;
          case 'title':
            if (value) push({ field: 'job_title', value: cleanSpaces(value), raw: value, line: idx, score, labeled: true, strength: 4 });
            break;
          case 'qq': extras.qq.push(value); break;
          default: break;
        }
      }
    });

    for (let part of unlabeledParts) {
      // correos y webs sin etiqueta
      part = part.replace(EMAIL_SCAN, (m) => {
        // Etiqueta pegada al valor por el OCR ("Emailtlily@..."): se quita y se pide revisión, nunca se acepta tal cual.
        const glued = m.match(/^(e-?mail|mail|邮箱|电邮)[:：.]?/i);
        const v = normalizeEmail(glued ? m.slice(glued[0].length) : m);
        if (isValidEmail(v)) push({ field: 'email', value: v, raw: m, line: idx, score, labeled: !!glued, strength: 2,
          status: glued ? 'review' : undefined, reason: glued ? `etiqueta pegada al correo en el OCR ("${m}")` : undefined });
        else if (glued) illegible.email ??= m;
        return ' ';
      });
      part = part.replace(WEB_SCAN, (m) => {
        if (/^\d+(\.\d+)+$/.test(m) || BOOTH_RE.test(m)) return m;
        const v = normalizeWebsite(m);
        const val = isValidWebsite(v);
        const looksWeb = /^(https?:|www\.)/i.test(m) || val.knownTld;
        if (!val.valid || !looksWeb || /^(co|ltd|no|rd|st|tel)\.[a-z]{2,3}$/i.test(v)) return m;
        push({ field: 'website', value: v, raw: m, line: idx, score, labeled: false, strength: /^(https?:|www\.)/i.test(m) ? 2 : 1,
          status: /^(https?:|www\.)/i.test(m) ? undefined : 'review', reason: /^(https?:|www\.)/i.test(m) ? undefined : 'dominio sin "www" ni etiqueta' });
        return ' ';
      });
      const booth = part.match(BOOTH_RE);
      if (booth) {
        const b = parseBooth(booth[0])!;
        push({ field: 'hall', value: b.hall, raw: booth[0], line: idx, score, labeled: false, strength: 2 });
        push({ field: 'booth', value: b.booth, raw: booth[0], line: idx, score, labeled: false, strength: 2 });
        part = part.replace(booth[0], ' ');
      }
      let hadPhone = false;
      part = part.replace(PHONE_SCAN, (m) => {
        const digits = m.replace(/\D/g, '');
        if (digits.length < 7) return m;
        hadPhone = phoneHits(m, idx, score, false, 'other') || hadPhone;
        return ' ';
      });
      const rest = cleanSpaces(part.replace(/[|•·]/g, ' '));
      if (rest.length >= 2 && (labels.length === 0 || CJK_RE.test(rest) || /[A-Za-z]{2,}/.test(rest))) plain.push({ idx, text: rest, score });
      void hadPhone;
    }
  });

  // Clasificación de líneas sin etiqueta: empresa, cargo, nombre, dirección, productos.
  const titleLines = new Set<number>();
  const consumed = new Set<number>(); // líneas añadidas como continuación de otra
  const endsWithComma = (i: number) => /[,，]\s*$/.test(lines[i]?.text ?? '');
  for (const p of plain) {
    const t = p.text;
    const cjk = isCjkDominant(t);
    if (cjk && COMPANY_CN_RE.test(t) && t.length >= 4 && !ADDRESS_CN_RE.test(t.replace(/有限公司|公司|集团|厂/g, '')) ) {
      push({ field: 'company_name_cn', value: t.replace(/\s+/g, ''), raw: t, line: p.idx, score: p.score, labeled: false, strength: COMPANY_CN_STRONG.test(t) ? 3 : 1,
        status: COMPANY_CN_STRONG.test(t) ? undefined : 'review', reason: COMPANY_CN_STRONG.test(t) ? undefined : 'nombre de empresa sin forma jurídica' });
      continue;
    }
    if (cjk && COMPANY_CN_RE.test(t) && /有限公司|集团/.test(t)) {
      push({ field: 'company_name_cn', value: t.replace(/\s+/g, ''), raw: t, line: p.idx, score: p.score, labeled: false, strength: 2 });
      continue;
    }
    if (!cjk && COMPANY_EN_RE.test(t) && !ADDRESS_EN_RE.test(t.replace(/\bchina\b/i, '')) && t.split(' ').length >= 2
      && (COMPANY_EN_STRONG.test(t) || !TITLE_EN_RE.test(t))) {
      const strong = COMPANY_EN_STRONG.test(t);
      push({ field: 'company_name', value: t, raw: t, line: p.idx, score: p.score, labeled: false, strength: strong ? 3 : 1,
        status: strong ? undefined : 'review', reason: strong ? undefined : 'nombre de empresa sin forma jurídica' });
      continue;
    }
    // Nombre + cargo en la misma línea: "王伟 销售经理" / "Jason Wang | Sales Manager"
    const cnTitle = cjk ? t.match(TITLE_CN_RE) : null;
    if (cnTitle && t.length <= 16) {
      const before = t.slice(0, cnTitle.index).replace(/[\s/|,，·•]/g, '');
      const titleText = cleanSpaces(t.slice(before.length ? t.indexOf(cnTitle[0]) : 0));
      if (/^[一-鿿]{2,4}$/.test(before)) {
        push({ field: 'contact_name', value: before, raw: t, line: p.idx, score: p.score, labeled: false, strength: CN_SURNAMES.includes(before[0]) ? 3 : 2 });
        push({ field: 'job_title', value: titleText, raw: t, line: p.idx, score: p.score, labeled: false, strength: 2 });
      } else {
        push({ field: 'job_title', value: t, raw: t, line: p.idx, score: p.score, labeled: false, strength: 2 });
      }
      titleLines.add(p.idx);
      continue;
    }
    if (!cjk && TITLE_EN_RE.test(t) && t.length <= 48 && !ADDRESS_EN_RE.test(t)) {
      const words = t.replace(/\s*[|,/–]\s*/g, ' | ').split(' ');
      const n = [3, 2].find((k) => words.length > k && isEnglishName(words.slice(0, k).join(' ')) && TITLE_EN_RE.test(words.slice(k).join(' ')));
      if (n) {
        push({ field: 'contact_name', value: words.slice(0, n).join(' '), raw: t, line: p.idx, score: p.score, labeled: false, strength: 3 });
        push({ field: 'job_title', value: words.slice(n).join(' ').replace(/^\|\s*/, ''), raw: t, line: p.idx, score: p.score, labeled: false, strength: 2 });
      } else {
        push({ field: 'job_title', value: t, raw: t, line: p.idx, score: p.score, labeled: false, strength: 2 });
      }
      titleLines.add(p.idx);
      continue;
    }
    const prevProducts = hits.find((h) => h.field === 'main_products' && h.line === p.idx - 1 && h.labeled);
    if (prevProducts && !findLabels(t).length && !/@|www\.|\d{5,}/.test(t)) {
      prevProducts.value = cleanSpaces(`${prevProducts.value}${endsWithComma(p.idx - 1) ? ',' : ''} ${t}`);
      consumed.add(p.idx);
      continue;
    }
    if (PRODUCTS_RE.test(t)) {
      push({ field: 'main_products', value: t, raw: t, line: p.idx, score: p.score, labeled: false, strength: 1, status: 'review', reason: 'productos detectados sin etiqueta' });
      continue;
    }
    const placeLike = !!(findPlaces(t).city || findPlaces(t).province);
    const isAddr = (cjk && ADDRESS_CN_RE.test(t) && /\d|号|路|区/.test(t) && t.length >= 6) || (!cjk && ADDRESS_EN_RE.test(t) && (/\d/.test(t) || /,/.test(t)) && t.length >= 10);
    const isAddrCont = addressLines.has(p.idx - 1) && (isAddr || placeLike || (cjk ? ADDRESS_CN_RE.test(t) : ADDRESS_EN_RE.test(t)));
    if (isAddr || isAddrCont) {
      // continuación de una dirección etiquetada en la línea anterior
      if (addressLines.has(p.idx - 1)) {
        const prev = [...hits].reverse().find((h) => h.field === 'address' && h.line === p.idx - 1);
        if (prev && isCjkDominant(prev.value) === cjk) {
          prev.value = cleanSpaces(`${prev.value}${endsWithComma(p.idx - 1) ? ',' : ''} ${t}`);
          addressLines.add(p.idx); consumed.add(p.idx); continue;
        }
      }
      push({ field: 'address', value: t, raw: t, line: p.idx, score: p.score, labeled: false, strength: 2 });
      addressLines.add(p.idx);
      continue;
    }
  }
  // Nombres sin etiqueta (después de conocer las líneas de cargo).
  for (const p of plain) {
    if (consumed.has(p.idx) || hits.some((h) => h.line === p.idx && !['phone', 'email', 'website', 'wechat', 'whatsapp', 'hall', 'booth'].includes(h.field))) continue;
    const t = p.text;
    const compact = t.replace(/\s+/g, '');
    const nearTitle = titleLines.has(p.idx - 1) || titleLines.has(p.idx + 1);
    if (/^[一-鿿]{2,4}$/.test(compact) && !COMPANY_CN_RE.test(compact) && !TITLE_CN_RE.test(compact) && !ADDRESS_CN_RE.test(compact.slice(1))) {
      const surname = CN_SURNAMES.includes(compact[0]);
      const ok = surname && nearTitle;
      push({ field: 'contact_name', value: compact, raw: t, line: p.idx, score: p.score, labeled: false, strength: ok ? 3 : surname ? 2 : 1,
        status: ok ? undefined : 'review', reason: ok ? undefined : 'nombre deducido por posición (sin etiqueta)' });
    } else if (/^[A-Za-z .'-]+\s+[\u4e00-\u9fff]{2,4}$/.test(t) && isEnglishName(t.replace(/\s+[\u4e00-\u9fff]{2,4}$/, ''))) {
      // "Lily Chen 陈丽丽": nombre latino + nombre chino en la misma línea
      const cn = t.match(/[\u4e00-\u9fff]{2,4}$/)![0];
      const en = t.slice(0, -cn.length).trim();
      push({ field: 'contact_name', value: en, raw: t, line: p.idx, score: p.score, labeled: false, strength: 3 });
      push({ field: 'contact_name', value: cn, raw: t, line: p.idx, score: p.score, labeled: false, strength: 2 });
    } else if (isEnglishName(t)) {
      const honorific = /^(mr|ms|mrs|miss)\.?\s/i.test(t);
      const ok = nearTitle || honorific;
      push({ field: 'contact_name', value: t, raw: t, line: p.idx, score: p.score, labeled: false, strength: ok ? 3 : 1,
        status: ok ? undefined : 'review', reason: ok ? undefined : 'nombre deducido por posición (sin etiqueta)' });
    }
  }

  // Ciudad / provincia: solo si aparecen explícitamente en una dirección (o en el texto, con revisión).
  const addrText = hits.filter((h) => h.field === 'address').map((h) => h.value).join(' ');
  const allText = lines.map((l) => nfkc(l.text)).join(' ');
  const placesAddr = findPlaces(addrText);
  const places = placesAddr.city || placesAddr.province ? placesAddr : findPlaces(allText);
  const suggestions: Partial<Record<OcrField, string>> = {};
  if (placesAddr.city || placesAddr.province) {
    if (places.city) push({ field: 'city', value: places.city, raw: places.city, line: -1, score: 1, labeled: false, strength: 2 });
    if (places.province) push({ field: 'province', value: places.province, raw: places.province, line: -1, score: 1, labeled: false, strength: 2 });
  } else {
    if (places.city) suggestions.city = places.city;
    if (places.province) suggestions.province = places.province;
  }

  return { ...buildFields(hits, illegible), suggestions, extras, hits };
}

function isEnglishName(t: string): boolean {
  const s = t.replace(/^(mr|ms|mrs|miss)\.?\s+/i, '').trim();
  if (s.length > 32 || NAME_STOPWORDS.test(s) || /\d|@/.test(s)) return false;
  return /^[A-Z][a-z]+(?:[ -][A-Z][a-z]+){1,2}$/.test(s) || /^[A-Z]{2,}(?: [A-Z]{2,}){1,2}$/.test(s) || /^[A-Z][a-z]+ [A-Z]{2,}$/.test(s);
}

function buildFields(hits: Hit[], illegible: Partial<Record<OcrField, string>>): Pick<SideExtraction, 'fields' | 'phones' | 'illegible'> {
  const fields: Partial<Record<OcrField, FieldCandidate>> = {};
  const byField = new Map<string, Hit[]>();
  for (const h of hits) { if (!byField.has(h.field)) byField.set(h.field, []); byField.get(h.field)!.push(h); }

  for (const [field, list] of byField) {
    if (field === 'phone' || field === 'fax' || field === 'qq') continue;
    const sorted = [...list].sort((a, b) => b.strength - a.strength || (a.status === 'ok' ? -1 : 1) || a.line - b.line);
    const best = sorted[0];
    const distinct = [...new Set(sorted.map((h) => h.value))];
    let status = best.status;
    let reason = best.reason;
    // ambigüedad: dos candidatos distintos igual de fuertes (salvo campos multivalor naturales)
    const rivals = sorted.filter((h) => h.value !== best.value && h.strength === best.strength);
    if (rivals.length && !['address', 'main_products', 'email', 'website'].includes(field) && status === 'ok') {
      status = 'review'; reason = 'varios valores posibles';
    }
    let value = best.value;
    if (field === 'address') {
      // dirección bilingüe: conservar ambas versiones (latina / china)
      const latin = sorted.find((h) => !isCjkDominant(h.value)); const cn = sorted.find((h) => isCjkDominant(h.value));
      value = latin && cn ? `${latin.value} / ${cn.value}` : best.value;
    }
    fields[field as OcrField] = { value, status, confidence: best.score, reason, line: best.line, candidates: distinct.filter((v) => v !== value && !value.includes(v)) };
  }

  // teléfonos: móvil etiquetado > fijo etiquetado > móvil sin etiqueta > resto; sin duplicados
  const phones: Hit[] = [];
  const pList = (byField.get('phone') ?? []).sort((a, b) => rank(b) - rank(a) || a.line - b.line);
  for (const h of pList) if (!phones.some((p) => p.value === h.value)) phones.push(h);
  return { fields, phones, illegible };
}

function rank(h: Hit): number {
  return (h.labeled ? 10 : 0) + (h.phoneRole === 'mobile' ? 3 : h.phoneRole === 'tel' ? 2 : 0) + (h.phoneKind === 'mobile_cn' ? 1 : 0);
}
