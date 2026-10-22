// Implementaciones REST de Google (Drive v3 / Sheets v4 / Google Identity Services).
// ⚠ NO VERIFICADAS contra Google real: Antigravity debe configurarlas y probarlas (ANTIGRAVITY_HANDOFF.md).
// Seguridad: solo usan el token OAuth del usuario (flujo de token de GIS en el navegador). Sin secretos en el frontend.
import type { UserProfile } from '../domain/schema';
import {
  AuthRequiredError, NotAuthorizedError, TransientRemoteError,
  type AuthAdapter, type DriveAdapter, type EvidenceUpload, type SheetsAdapter,
} from './contracts';

export const GOOGLE_SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/drive', // escribir en una carpeta existente compartida (ver handoff: alternativa drive.file)
  'https://www.googleapis.com/auth/spreadsheets',
].join(' ');

type TokenFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** fetch con token + clasificación de errores (401 → reautenticar, 429/5xx/red → transitorio). */
export function authedFetch(auth: AuthAdapter, f: typeof fetch = fetch): TokenFetch {
  return async (url, init = {}) => {
    const token = await auth.getAccessToken();
    let res: Response;
    try {
      res = await f(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
    } catch (e) { throw new TransientRemoteError(`Red: ${(e as Error).message}`); }
    if (res.status === 401) throw new AuthRequiredError('La sesión de Google expiró');
    if (res.status === 429 || res.status >= 500) throw new TransientRemoteError(`Google HTTP ${res.status}`);
    if (!res.ok) throw new Error(`Google HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  };
}

const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

export class GoogleDriveAdapter implements DriveAdapter {
  private api: TokenFetch;
  constructor(auth: AuthAdapter, private evidenceRootId: string, f: typeof fetch = fetch) { this.api = authedFetch(auth, f); }

  private async findOne(query: string): Promise<{ id: string; webViewLink?: string } | undefined> {
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,webViewLink)&supportsAllDrives=true&includeItemsFromAllDrives=true&pageSize=2`;
    const body = (await (await this.api(url)).json()) as { files: { id: string; webViewLink?: string }[] };
    return body.files[0];
  }

  async ensureCaptureFolder(c: { capture_uuid: string; external_ref: string }) {
    const found = await this.findOne(`'${q(this.evidenceRootId)}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='capture_uuid' and value='${q(c.capture_uuid)}' }`);
    if (found) return { folderId: found.id, url: found.webViewLink ?? `https://drive.google.com/drive/folders/${found.id}` };
    const res = await this.api('https://www.googleapis.com/drive/v3/files?fields=id,webViewLink&supportsAllDrives=true', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: c.external_ref, mimeType: 'application/vnd.google-apps.folder', parents: [this.evidenceRootId], appProperties: { capture_uuid: c.capture_uuid, app: 'cx-canton-capture' } }),
    });
    const f = (await res.json()) as { id: string; webViewLink?: string };
    return { folderId: f.id, url: f.webViewLink ?? `https://drive.google.com/drive/folders/${f.id}` };
  }

  async uploadEvidence(folderId: string, e: EvidenceUpload) {
    const found = await this.findOne(`trashed = false and appProperties has { key='evidence_id' and value='${q(e.evidence_id)}' }`);
    if (found) return { fileId: found.id, url: found.webViewLink ?? `https://drive.google.com/file/d/${found.id}/view` };
    const meta = { name: e.file_name, parents: [folderId], mimeType: e.mime,
      appProperties: { evidence_id: e.evidence_id, capture_uuid: e.capture_uuid, kind: e.kind, external_ref: e.external_ref, ...(e.sha256 ? { sha256: e.sha256 } : {}) } };
    const boundary = `cx${crypto.randomUUID().replace(/-/g, '')}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${boundary}\r\nContent-Type: ${e.mime}\r\n\r\n`, e.blob, `\r\n--${boundary}--`,
    ]);
    const res = await this.api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true', {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
    });
    const f = (await res.json()) as { id: string; webViewLink?: string };
    return { fileId: f.id, url: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view` };
  }
}

export class GoogleSheetsAdapter implements SheetsAdapter {
  private api: TokenFetch;
  constructor(auth: AuthAdapter, private spreadsheetId: string, private tab: string, f: typeof fetch = fetch) { this.api = authedFetch(auth, f); }
  private base() { return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(this.spreadsheetId)}`; }
  private range(r: string) { return encodeURIComponent(`'${this.tab.replace(/'/g, "''")}'!${r}`); }

  async upsertRow(row: Record<string, string>) {
    // 1. Cabecera: se crea/completa por nombre (nunca se reordenan columnas existentes).
    const headRes = (await (await this.api(`${this.base()}/values/${this.range('1:1')}`)).json()) as { values?: string[][] };
    let header = headRes.values?.[0] ?? [];
    const missing = Object.keys(row).filter((k) => !header.includes(k));
    if (missing.length) {
      const newHeader = [...header, ...missing];
      await this.api(`${this.base()}/values/${this.range(`A1:${col(newHeader.length)}1`)}?valueInputOption=RAW`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [newHeader] }),
      });
      header = newHeader;
    }
    // 2. Buscar todas las filas con este capture_uuid para resolver posibles carreras concurrentes.
    const keyColIdx = header.indexOf('capture_uuid') + 1;
    const keyCol = col(keyColIdx);
    const keys = (await (await this.api(`${this.base()}/values/${this.range(`${keyCol}:${keyCol}`)}`)).json()) as { values?: string[][] };
    const matches: number[] = [];
    (keys.values ?? []).forEach((v, i) => {
      if (i > 0 && v[0] === row.capture_uuid) matches.push(i + 1);
    });

    // RAW: evita que Sheets interprete "+86..." como fórmula o número. Los null preservan columnas existentes.
    const values = header.map((h) => (h in row ? row[h] : null));

    // Si ya existe al menos una fila previa: actualizar la primera (canónica) y limpiar duplicados si los hubiera.
    if (matches.length > 0) {
      const canonicalRow = matches[0];
      await this.api(`${this.base()}/values/${this.range(`A${canonicalRow}:${col(header.length)}${canonicalRow}`)}?valueInputOption=RAW`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [values] }),
      });
      for (let d = 1; d < matches.length; d++) {
        const dupRow = matches[d];
        await this.api(`${this.base()}/values/${this.range(`A${dupRow}:${col(header.length)}${dupRow}`)}:clear`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
        });
      }
      return { rowNumber: canonicalRow, action: 'updated' as const };
    }

    // Inserción atómica mediante append
    const res = await this.api(`${this.base()}/values/${this.range('A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ values: [values.map((v) => v ?? '')] }),
    });
    const upd = (await res.json()) as { updates?: { updatedRange?: string } };
    const n = Number(upd.updates?.updatedRange?.match(/(\d+)(?::|$)/)?.[1] ?? 0);

    // Verificación post-inserción inmediata contra inserciones concurrentes de otros dispositivos/hilos
    try {
      const verifyKeys = (await (await this.api(`${this.base()}/values/${this.range(`${keyCol}:${keyCol}`)}`)).json()) as { values?: string[][] };
      const postMatches: number[] = [];
      (verifyKeys.values ?? []).forEach((v, i) => {
        if (i > 0 && v[0] === row.capture_uuid) postMatches.push(i + 1);
      });
      if (postMatches.length > 1) {
        const canonical = postMatches[0];
        for (let d = 1; d < postMatches.length; d++) {
          const dupRow = postMatches[d];
          await this.api(`${this.base()}/values/${this.range(`A${dupRow}:${col(header.length)}${dupRow}`)}:clear`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
          });
        }
        return { rowNumber: canonical, action: (canonical === n ? 'inserted' : 'updated') as 'inserted' | 'updated' };
      }
    } catch {
      // Si la verificación post-inserción no responde por red, el append inicial ya fue confirmado
    }

    return { rowNumber: n, action: 'inserted' as const };
  }
}

export function col(n: number): string { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }

/**
 * Google Identity Services (token client). Cada persona inicia sesión con SU cuenta de Google;
 * solo se aceptan los correos de VITE_ALLOWED_USERS. El perfil se guarda en el dispositivo para
 * poder capturar sin conexión; el token (1 h) solo se usa para sincronizar.
 */
export class GoogleAuthAdapter implements AuthAdapter {
  readonly mode = 'google' as const;
  private token?: { value: string; exp: number };
  private user: UserProfile | null = null;
  constructor(private clientId: string, private users: UserProfile[], private store: { get: () => Promise<UserProfile | null>; set: (u: UserProfile | null) => Promise<void> }) {}
  allowedUsers() { return this.users; }
  async currentUser() { this.user ??= await this.store.get(); return this.user; }

  private async loadGis(): Promise<GisOauth2> {
    const w = window as unknown as { google?: { accounts: { oauth2: GisOauth2 } } };
    if (!w.google?.accounts?.oauth2) {
      await new Promise<void>((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
        s.onload = () => res(); s.onerror = () => rej(new TransientRemoteError('No se pudo cargar Google Identity Services (¿sin conexión?)'));
        document.head.appendChild(s);
      });
    }
    return w.google!.accounts.oauth2;
  }

  private async requestToken(prompt: '' | 'consent' | 'select_account', hint?: string): Promise<string> {
    const oauth2 = await this.loadGis();
    return new Promise((resolve, reject) => {
      const client = oauth2.initTokenClient({
        client_id: this.clientId, scope: GOOGLE_SCOPES, hint, prompt,
        callback: (r) => {
          if (r.error || !r.access_token) return reject(new AuthRequiredError(r.error_description ?? r.error ?? 'Autenticación cancelada'));
          this.token = { value: r.access_token, exp: Date.now() + (Number(r.expires_in ?? 3600) - 120) * 1000 };
          resolve(r.access_token);
        },
        error_callback: (e) => reject(new AuthRequiredError(e?.message ?? 'Ventana de Google cerrada')),
      });
      client.requestAccessToken({ prompt });
    });
  }

  async signIn(userId?: string) {
    const expected = this.users.find((u) => u.id === userId);
    const token = await this.requestToken('select_account', expected?.email);
    const info = (await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } })).json()) as { email?: string; email_verified?: boolean };
    const u = this.users.find((x) => x.email && info.email && x.email.toLowerCase() === info.email.toLowerCase());
    if (!u || !info.email_verified) {
      this.token = undefined;
      throw new NotAuthorizedError(`La cuenta ${info.email ?? '(desconocida)'} no está autorizada para esta aplicación`);
    }
    this.user = u; await this.store.set(u);
    return u;
  }
  async signOut() {
    if (this.token) (await this.loadGis().catch(() => undefined))?.revoke(this.token.value, () => undefined);
    this.token = undefined; this.user = null; await this.store.set(null);
  }
  async getAccessToken() {
    if (this.token && this.token.exp > Date.now()) return this.token.value;
    if (!this.user) throw new AuthRequiredError();
    // Renovación silenciosa (sin ventana si el consentimiento ya existe). Si falla, la UI pide "Reconectar Google".
    try { return await this.requestToken('', this.user.email); } catch { throw new AuthRequiredError('Reconecta tu cuenta de Google para sincronizar'); }
  }
}

interface GisOauth2 {
  initTokenClient(cfg: { client_id: string; scope: string; hint?: string; prompt?: string; callback: (r: { access_token?: string; expires_in?: string | number; error?: string; error_description?: string }) => void; error_callback?: (e: { message?: string }) => void }): { requestAccessToken(o?: { prompt?: string }): void };
  revoke(token: string, cb: () => void): void;
}
