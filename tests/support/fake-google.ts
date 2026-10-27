// Emulador mínimo de Drive v3 / Sheets v4 compartido por las pruebas (misma lógica que tests/google-adapters.test.ts):
// las búsquedas respetan `'<carpeta>' in parents` como Drive real. Subida REANUDABLE como Drive (sesión, bloques con
// Content-Range, 308 + Range, consulta de estado) y fallos reales inyectables: cuota llena, límite de ritmo, cortes de red.
import { expect } from 'vitest';

export function fakeGoogle() {
  const files: { id: string; name: string; parents: string[]; mimeType: string; appProperties: Record<string, string>; size: number; bytes?: Uint8Array }[] = [];
  const sessions = new Map<string, { meta: Record<string, unknown>; total: number; parts: Uint8Array[]; received: number; fileId?: string }>();
  let errorNext: { status: number; reason: string; message: string } | null = null;
  let quotaFull = false;
  let dropChunks = 0;
  const gErr = (status: number, reason: string, message: string) => json({ error: { code: status, message, errors: [{ reason, message }] } }, status);
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
    if (errorNext) { const e = errorNext; errorNext = null; return gErr(e.status, e.reason, e.message); }
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
    if (url.pathname === '/upload/drive/v3/files' && method === 'POST') {
      // la app debe usar la subida REANUDABLE (la multipart está pensada para ≤ 5 MB)
      expect(url.searchParams.get('uploadType')).toBe('resumable');
      // la cuota la consume la cuenta que SUBE el archivo, aunque la carpeta sea de otra persona
      if (quotaFull) return gErr(403, 'storageQuotaExceeded', "The user's Drive storage quota has been exceeded.");
      const h = init.headers as Record<string, string>;
      const id = `S${sessions.size + 1}`;
      sessions.set(id, { meta: JSON.parse(String(init.body)), total: Number(h['X-Upload-Content-Length']), parts: [], received: 0 });
      return new Response(null, { status: 200, headers: { Location: `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=${id}` } });
    }
    if (url.pathname === '/upload/drive/v3/files' && method === 'PUT') {
      const ses = sessions.get(url.searchParams.get('upload_id') ?? '');
      if (!ses) return gErr(404, 'notFound', 'Upload session not found');
      const range = (init.headers as Record<string, string>)['Content-Range'];
      const done = () => {
        if (!ses.fileId) {
          const bytes = new Uint8Array(ses.received); let o = 0; for (const p of ses.parts) { bytes.set(p, o); o += p.length; }
          const f = { ...(ses.meta as object), id: `F${files.length + 1}`, size: ses.received, bytes } as (typeof files)[number]; files.push(f); ses.fileId = f.id;
        }
        if (uploadWithoutId) { uploadWithoutId = false; return json({}); }
        return json({ id: ses.fileId, webViewLink: `https://drive/${ses.fileId}` });
      };
      const partial = () => new Response(null, { status: 308, headers: ses.received ? { Range: `bytes=0-${ses.received - 1}` } : {} });
      const q = /^bytes \*\/(\d+)$/.exec(range);
      if (q) return ses.received === ses.total ? done() : partial(); // consulta de estado
      const m = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range);
      expect(m, `Content-Range válido: ${range}`).toBeTruthy();
      const [a, b] = [Number(m![1]), Number(m![2])];
      if (dropChunks > 0) { dropChunks--; throw new TypeError('Failed to fetch'); } // corte de red: no llega nada de este bloque
      if (a !== ses.received) return partial();
      const chunk = new Uint8Array(await (init.body as Blob).arrayBuffer());
      expect(chunk.length).toBe(b - a + 1);
      ses.parts.push(chunk); ses.received += chunk.length;
      return ses.received === ses.total ? done() : partial();
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
  return { files, get grid() { return grid; }, set grid(g) { grid = g; }, log, fetch: fetchImpl as typeof fetch, failWith: (s: number) => { failNext = s; }, uploadWithoutIdNext: () => { uploadWithoutId = true; },
    /** siguiente petición: error de Google con su motivo real (p. ej. 403 userRateLimitExceeded) */
    errorNext: (status: number, reason: string, message = reason) => { errorNext = { status, reason, message }; },
    /** el Drive de la cuenta que sube está lleno (403 storageQuotaExceeded en cada subida) */
    set quotaFull(v: boolean) { quotaFull = v; },
    /** los próximos `n` bloques se pierden por un corte de red */
    dropChunks: (n: number) => { dropChunks = n; } };
}
