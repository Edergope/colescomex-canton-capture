// Emulador mínimo de Drive v3 / Sheets v4 compartido por las pruebas (misma lógica que tests/google-adapters.test.ts):
// las búsquedas respetan `'<carpeta>' in parents` como Drive real.
import { expect } from 'vitest';

export function fakeGoogle() {
  const files: { id: string; name: string; parents: string[]; mimeType: string; appProperties: Record<string, string>; size: number }[] = [];
  let grid: string[][] = [];
  const log: string[] = [];
  let failNext: number | null = null;
  let uploadWithoutId = false;
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  const parseA1 = (r: string) => {
    const m = decodeURIComponent(r).match(/!([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?/)!;
    const toN = (c: string) => [...c].reduce((s, ch) => s * 26 + ch.charCodeAt(0) - 64, 0);
    return { c1: m[1] ? toN(m[1]) : 1, r1: m[2] ? Number(m[2]) : 1, c2: m[3] ? toN(m[3]) : m[1] ? toN(m[1]) : 999, r2: m[4] ? Number(m[4]) : m[3] === undefined && m[2] ? Number(m[2]) : 99999 };
  };
  const fetchImpl = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input)); const method = init.method ?? 'GET';
    log.push(`${method} ${url.pathname}`);
    if (!(init.headers as Record<string, string>)?.Authorization?.startsWith('Bearer ')) return json({ error: 'no auth' }, 401);
    if (failNext) { const s = failNext; failNext = null; return json({}, s); }
    if (url.pathname === '/drive/v3/files' && method === 'GET') {
      const qs = url.searchParams.get('q')!;
      const props = [...qs.matchAll(/key='([^']+)' and value='([^']+)'/g)];
      const parent = qs.match(/'([^']+)' in parents/)?.[1];
      const out = files.filter((f) => props.every(([, k, v]) => f.appProperties[k] === v) && (!parent || f.parents.includes(parent)));
      return json({ files: out.map((f) => ({ id: f.id, webViewLink: `https://drive/${f.id}` })) });
    }
    if (url.pathname === '/drive/v3/files' && method === 'POST') {
      const b = JSON.parse(String(init.body)); const f = { ...b, id: `F${files.length + 1}`, size: 0 }; files.push(f);
      return json({ id: f.id, webViewLink: `https://drive/${f.id}` });
    }
    if (url.pathname === '/upload/drive/v3/files') {
      expect(url.searchParams.get('uploadType')).toBe('multipart');
      const text = await (init.body as Blob).text();
      const meta = JSON.parse(text.split('\r\n\r\n')[1].split('\r\n')[0]);
      if (uploadWithoutId) { uploadWithoutId = false; return json({}); }
      const f = { ...meta, id: `F${files.length + 1}`, size: text.length }; files.push(f);
      return json({ id: f.id, webViewLink: `https://drive/${f.id}` });
    }
    const sm = url.pathname.match(/\/v4\/spreadsheets\/[^/]+\/values\/(.+?)(:(?:append|clear))?$/);
    if (sm) {
      const a = parseA1(sm[1]);
      if (method === 'GET') {
        const vals = grid.slice(a.r1 - 1, a.r2).map((r) => r.slice(a.c1 - 1, a.c2));
        return json({ values: vals.length ? vals : undefined });
      }
      if (sm[2] === ':clear') {
        if (grid[a.r1 - 1]) grid[a.r1 - 1] = [];
        return json({ clearedRange: sm[1] });
      }
      const body = JSON.parse(String(init.body)) as { values: (string | null)[][] };
      expect(url.searchParams.get('valueInputOption')).toBe('RAW');
      if (sm[2] === ':append') { grid.push(body.values[0].map((v) => v ?? '')); return json({ updates: { updatedRange: `'T'!A${grid.length}:Z${grid.length}` } }); }
      const r = grid[a.r1 - 1] ?? (grid[a.r1 - 1] = []);
      body.values[0].forEach((v, i) => { if (v !== null) r[a.c1 - 1 + i] = v; });
      return json({});
    }
    return json({ error: `ruta no emulada ${url.pathname}` }, 404);
  };
  return { files, get grid() { return grid; }, set grid(g) { grid = g; }, log, fetch: fetchImpl as typeof fetch, failWith: (s: number) => { failNext = s; }, uploadWithoutIdNext: () => { uploadWithoutId = true; } };
}
