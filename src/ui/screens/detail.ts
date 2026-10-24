// PANTALLA 7 — Ficha del proveedor por secciones, con edición puntual por sección (sin mostrar 47 campos).
import { h, toast, confirmSheet } from '../dom';
import { icon } from '../icons';
import { appBar, chip, emptyState, kv, notice, sectionCard, tracks3, EVIDENCE_ICON } from '../components';
import { classifySyncError, dataTrack, displayName, FIELD_LABELS, googleTrack, photoTrack, reviewItems } from '../model';
import { primaryEvidences } from '../../storage/repo';
import { EVIDENCE_LABELS, type Capture, type CommercialField, type Evidence } from '../../domain/schema';
import type { Ctx } from '../views';

type Row = [CommercialField, string?];
const IDENT: Row[] = [['company_name'], ['company_name_cn'], ['contact_name'], ['job_title'], ['country', 'País'], ['province'], ['city'], ['address'], ['hall'], ['booth']];
const COMMS: Row[] = [['phone_1', 'Móvil'], ['phone_2', 'Fijo'], ['email'], ['website'], ['wechat'], ['whatsapp']];
const PRODS: Row[] = [['main_products'], ['supplier_type', 'Categorías'], ['product_interest'], ['notes'], ['follow_up']];
const SHORT_EV: Record<string, string> = { card_front: 'Anverso', card_back: 'Reverso', stand: 'Stand', product: 'Producto', catalog: 'Catálogo', other: 'Otra' };
const LONG = new Set<CommercialField>(['address', 'main_products', 'notes', 'follow_up']);

const SCAN_LABEL: Record<string, [string, 'ok' | 'warn']> = {
  ok: ['Recortada y enderezada', 'ok'], manual: ['Esquinas ajustadas a mano', 'ok'],
  low_confidence: ['Bordes dudosos: se usa la foto original', 'warn'], not_found: ['Bordes no detectados: se usa la foto original', 'warn'],
};

export async function detailScreen(ctx: Ctx, uuid: string) {
  const c = await ctx.app.repo.get(uuid);
  if (!c) return h('div', { class: 'screen' }, appBar('Proveedor', { back: () => ctx.back() }), h('main', { class: 'content' }, emptyState('alert', 'Captura no encontrada', 'Puede que se haya abierto desde otro dispositivo.')));
  const evs = await ctx.app.repo.evidences(uuid);
  const n = displayName(c);
  const rv = reviewItems(c);
  let editing: string | null = null;

  const fieldBadge = (f: CommercialField) => {
    const m = c.field_meta[f];
    if (m?.locked && m.source === 'human') return /^editado/.test(m.reason ?? '') ? chip('neutral', 'lock', 'Corregido') : /^confirmado/.test(m.reason ?? '') ? undefined : chip('neutral', 'edit', 'Anotado');
    if (m && !m.locked && (m.status === 'review' || m.status === 'illegible')) return chip('warn', 'alert', m.status === 'illegible' ? 'Ilegible' : 'Revisar');
    return undefined;
  };
  const value = (f: CommercialField) => {
    if (f === 'main_products' && c.fields[f]) {
      const items = c.fields[f].split(/\s*[;\n]\s*/).filter(Boolean);
      if (items.length > 1) return h('ul', { class: 'product-list' }, ...items.map((p) => h('li', null, p)));
    }
    return c.fields[f];
  };
  const href = (f: CommercialField): string | undefined => {
    const v = c.fields[f]; if (!v) return undefined;
    if (f === 'email') return `mailto:${v}`;
    if (f === 'website') return /^https?:/i.test(v) ? v : `https://${v}`;
    if (f === 'phone_1' || f === 'phone_2') return `tel:${v.replace(/[^\d+]/g, '')}`;
    return undefined;
  };

  /** Sección editable: lectura en `kv`; al editar, campos con name=<campo> y guardado por sección. */
  const editable = (id: string, ic: string, title: string, rows: Row[], extra?: [string, string | undefined, { id?: string }?][]) => {
    const body = h('div');
    const show = () => body.replaceChildren(kv([
      ...rows.map(([f, l]) => [l ?? FIELD_LABELS[f] ?? f, value(f), { href: href(f), badge: fieldBadge(f), id: f }] as [string, ReturnType<typeof value>, { href?: string; badge?: HTMLElement; id: string }]),
      ...(extra ?? []).filter(([, v]) => v),
    ]));
    const edit = () => {
      if (editing && editing !== id) { toast('Guarde o cancele primero la otra sección'); return; }
      editing = id; ctx.setDirty(true);
      const inputs = new Map<CommercialField, HTMLInputElement | HTMLTextAreaElement>();
      const form = h('form', { class: 'stack', id: `form-${id}`, onSubmit: (e: Event) => { e.preventDefault(); void save(); } },
        ...rows.map(([f, l]) => {
          const m = c.field_meta[f];
          const attrs = { name: f, id: `f-${f}`, value: c.fields[f] ?? '', autocomplete: 'off',
            inputMode: f.startsWith('phone') || f === 'whatsapp' ? 'tel' : f === 'email' ? 'email' : f === 'website' ? 'url' : undefined };
          const input = LONG.has(f) ? h('textarea', { name: f, id: `f-${f}` }, c.fields[f] ?? '') : h('input', attrs);
          inputs.set(f, input);
          return h('div', { class: `field${m && !m.locked && (m.status === 'review' || m.status === 'illegible') ? ' needs-review' : ''}` },
            h('label', { for: `f-${f}` }, l ?? FIELD_LABELS[f] ?? f, fieldBadge(f)), input,
            m?.candidates?.length ? h('div', { class: 'row xs' }, h('span', { class: 'muted' }, 'También leído:'),
              ...m.candidates.map((v) => h('button', { type: 'button', class: 'btn sm', onClick: () => { input.value = v; } }, v))) : null);
        }),
        h('p', { class: 'xs muted' }, 'Lo que usted corrija queda bloqueado: ningún reproceso automático lo sobrescribe.'),
        h('div', { class: 'row' },
          h('button', { type: 'button', class: 'btn grow', onClick: () => { editing = null; ctx.setDirty(false); show(); btn.hidden = false; } }, 'Cancelar'),
          h('button', { type: 'submit', class: 'btn primary grow', id: 'btn-save-edit' }, icon('check'), 'Guardar')));
      const save = async () => {
        const edits: Partial<Record<CommercialField, string>> = {};
        for (const [f, el] of inputs) if (el.value.trim() !== (c.fields[f] ?? '')) edits[f] = el.value;
        editing = null; ctx.setDirty(false);
        if (!Object.keys(edits).length) { ctx.refresh(); return; }
        await ctx.app.editFields(uuid, edits);
        toast('Corrección guardada en este dispositivo · pendiente de sincronización');
        ctx.refresh();
      };
      body.replaceChildren(form); btn.hidden = true;
      (form.querySelector('input,textarea') as HTMLElement | null)?.focus();
    };
    const btn = h('button', { class: 'btn ghost sm', 'data-edit': id, 'aria-label': `Editar ${title}`, onClick: edit }, icon('edit', 'sm'), 'Editar');
    show();
    return sectionCard(id, ic, title, body, btn);
  };

  const x = c.ocr_extras;
  const g = googleTrack(c);
  const syncErr = c.sync_status === 'ERROR' ? classifySyncError(c.sync_error) : null;

  return h('div', { class: 'screen has-nav', id: 'screen-detail' },
    appBar(c.external_ref, { back: () => ctx.back(), sub: n.pending ? 'Proveedor' : n.text }),
    h('main', { class: 'content' },
      h('div', { class: 'card stack', id: 'detail-head' },
        h('h2', { class: n.pending ? 'pending' : '', style: n.pending ? 'color:var(--warn)' : '' }, n.text),
        c.fields.contact_name ? h('p', { class: 'muted' }, [c.fields.contact_name, c.fields.job_title].filter(Boolean).join(' · ')) : null,
        tracks3(photoTrack(), dataTrack(c), g),
        h('p', { class: 'xs muted' }, 'Estos datos son información inicial capturada en feria; no constituyen un proveedor aprobado.'),
        rv.length ? notice('warn', 'alert', `${rv.length} ${rv.length === 1 ? 'dato necesita' : 'datos necesitan'} su revisión`, h('p', null, 'Nada se aprueba automáticamente.'),
          [h('button', { class: 'btn sm primary', id: 'btn-open-review', onClick: () => ctx.go({ name: 'review', uuid }) }, icon('review', 'sm'), 'Revisar ahora')], 'review-cta') : null,
        c.ocr_status === 'ERROR' ? notice('err', 'alert-circle', 'No se pudo leer la tarjeta', h('p', null, dataTrack(c).detail ?? ''), [reprocessBtn(ctx, c)]) : null,
        syncErr ? notice(syncErr.kind === 'offline' ? 'warn' : 'err', 'cloud-off', syncErr.title, h('p', null, syncErr.help), [h('button', { class: 'btn sm', onClick: () => ctx.go({ name: 'sync' }) }, 'Ver sincronización')], 'sync-error') : null,
        h('div', { class: 'row' },
          c.ocr_status !== 'ERROR' ? reprocessBtn(ctx, c) : null,
          c.review_status !== 'REVISADO' && (c.ocr_status === 'EXTRAIDO' || c.ocr_status === 'REQUIERE_REVISION') ? h('button', { class: 'btn sm', id: 'btn-confirm', onClick: async () => {
            if (editing) { toast('Guarde primero la sección que está editando'); return; }
            const ok = await confirmSheet('Confirmar todos los datos', rv.length ? `Quedan ${rv.length} dato(s) marcados para revisión. Al confirmar, usted aprueba todos los valores tal como están y quedan bloqueados.` : 'Usted aprueba los valores actuales; quedarán bloqueados frente a reprocesos.', 'Confirmar revisión');
            if (!ok) return;
            await ctx.app.confirmReview(uuid); toast('Revisión confirmada'); ctx.refresh();
          } }, icon('check-circle', 'sm'), 'Confirmar revisión') : null)),

      editable('sec-ident', 'building', 'Identificación', IDENT, [['Empresas adicionales', x?.secondary_companies?.join(' · '), { id: 'secondary_companies' }]]),
      editable('sec-comms', 'chat', 'Comunicación', COMMS, [['QQ', x?.qq?.join(' · '), { id: 'qq' }], ['Fax', x?.fax?.join(' · '), { id: 'fax' }], ['Código postal', x?.postal_code?.join(' · '), { id: 'postal_code' }]]),
      editable('sec-products', 'box', 'Productos', PRODS),

      sectionCard('sec-evidence', 'image', 'Evidencias', evidenceBlock(ctx, c, evs)),
      sectionCard('sec-trace', 'history', 'Trazabilidad', await traceBlock(ctx, c))),
    ctx.nav(null));
}

function reprocessBtn(ctx: Ctx, c: Capture) {
  return h('button', { class: 'btn sm', id: 'btn-reprocess', disabled: c.ocr_status === 'PROCESANDO', onClick: async () => {
    await ctx.app.reprocessOcr(c.uuid); toast('Reproceso en cola · sus correcciones se conservan');
  } }, icon('refresh', 'sm'), 'Reprocesar lectura');
}

function evidenceBlock(ctx: Ctx, c: Capture, evs: Evidence[]) {
  const prim = primaryEvidences(evs);
  const originals = evs.filter((e) => (e.kind === 'card_front' || e.kind === 'card_back') && e.role !== 'processed');
  const grid = h('div', { class: 'evidence-grid', id: 'evidence-thumbs' }, ...prim.map((e) => {
    const box = h('div', { class: 'thumb-fill', style: 'position:absolute;inset:0;display:grid;place-items:center' }, icon(EVIDENCE_ICON[e.kind] ?? 'image'));
    if (e.mime.startsWith('image/')) ctx.thumbs.observe(box, async () => e.blob);
    return h('button', { class: 'evidence', 'data-evidence': e.kind, 'aria-label': `${EVIDENCE_LABELS[e.kind]}${e.role === 'processed' ? ' (procesada)' : ''}`, onClick: () => ctx.go({ name: 'doc', uuid: c.uuid, kind: e.kind }) },
      box, h('span', { class: 'tag' }, SHORT_EV[e.kind] ?? EVIDENCE_LABELS[e.kind], e.role === 'processed' ? ' · recortado' : ''));
  }));
  const scans = originals.filter((e) => e.scan).map((e) => {
    const sc = e.scan!;
    // la decisión del OPERADOR manda; sin ella, el recorte es automático y no fue revisado por una persona
    const CROP: Record<string, [string, 'ok' | 'warn']> = { auto: ['Recorte automático aceptado por usted', 'ok'], manual: ['Esquinas ajustadas por usted', 'ok'], full: ['Foto completa (sin recorte)', 'ok'] };
    const [label, tone] = e.crop ? CROP[e.crop.decision] : sc.multiple ? ['Varias tarjetas: se usa la foto original', 'warn' as const]
      : sc.status === 'ok' ? ['Recorte automático · sin revisar', 'warn' as const] : SCAN_LABEL[sc.status] ?? ['Sin procesar', 'warn' as const];
    return h('div', { class: 'row small', 'data-scan': `${e.kind}:${sc.status}` },
      chip(tone, tone === 'ok' ? 'crop' : 'alert', `${e.kind === 'card_front' ? 'Anverso' : 'Reverso'}: ${label}`),
      sc.rotation ? chip('neutral', 'refresh', `Girada ${sc.rotation}°`) : null,
      h('button', { class: 'btn ghost sm', 'data-adjust': e.kind, onClick: () => ctx.go({ name: 'doc', uuid: c.uuid, kind: e.kind, view: 'original' }) }, 'Ver y ajustar'));
  });
  const kinds = new Set(prim.map((e) => e.kind));
  const missing = (['card_back', 'stand', 'product', 'catalog'] as const).filter((k) => !kinds.has(k)).map((k) => EVIDENCE_LABELS[k]);
  return h('div', { class: 'stack' }, prim.length ? grid : h('p', { class: 'muted' }, 'Sin evidencias'), ...scans,
    missing.length ? h('p', { class: 'xs muted' }, `Sin: ${missing.join(', ')}.`) : null,
    h('p', { class: 'xs muted' }, 'La foto original nunca se modifica: el documento procesado es una copia derivada.'));
}

async function traceBlock(ctx: Ctx, c: Capture) {
  const audit = await ctx.app.repo.audit(c.uuid);
  const ocr = await ctx.app.repo.ocrResults(c.uuid);
  const users = new Map(ctx.app.auth.allowedUsers().map((u) => [u.id, u.name]));
  const edits = audit.filter((a) => a.type === 'HUMAN_EDIT' || a.type === 'REVIEW_CONFIRMED' || a.type === 'MANUAL_CORNERS');
  const AUDIT: Record<string, string> = { HUMAN_EDIT: 'Corrección', REVIEW_CONFIRMED: 'Revisión confirmada', MANUAL_CORNERS: 'Esquinas ajustadas' };
  return h('div', { class: 'stack' },
    kv([
      ['Referencia', c.external_ref], ['Identificador', h('span', { class: 'mono xs' }, c.uuid)],
      ['Lectura', dataTrack(c).label], ['Google', googleTrack(c).label],
      ['Fecha', new Date(c.created_at).toLocaleString('es')], ['Operador', users.get(c.user_id) ?? c.fields.captured_by ?? c.user_id],
      ['Revisión', `v${c.revision}${c.synced_revision ? ` · enviada v${c.synced_revision}` : ''}`],
      ['Motor', c.ocr_engine],
    ]),
    edits.length ? h('div', { class: 'stack' }, h('b', { class: 'small' }, `Correcciones humanas (${edits.length})`),
      h('ul', { class: 'product-list small' }, ...edits.slice(-8).reverse().map((a) => h('li', null,
        `${AUDIT[a.type]} · ${users.get(a.actor) ?? a.actor} · ${new Date(a.at).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}`,
        a.type === 'HUMAN_EDIT' && a.detail ? h('span', { class: 'muted' }, ` — ${Object.keys(a.detail as object).map((k) => FIELD_LABELS[k] ?? k).join(', ')}`) : null)))) : h('p', { class: 'xs muted' }, 'Sin correcciones humanas.'),
    h('details', null, h('summary', { class: 'small strong' }, 'Texto leído por el OCR'),
      ocr.length ? ocr.map((o) => h('div', { class: 'stack', style: 'margin-top:8px' }, h('span', { class: 'xs muted' }, `${o.side === 'front' ? 'Anverso' : 'Reverso'} · ${o.engine} · ${o.ms} ms${o.rotation ? ` · girada ${o.rotation}°` : ''}`),
        h('pre', { class: 'mono xs', style: 'white-space:pre-wrap;margin:0' }, o.text || '(sin texto)'))) : h('p', { class: 'xs muted' }, 'Aún no procesado.')));
}
