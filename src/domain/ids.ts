// Identificadores. uuid = clave inmutable; external_ref = referencia legible sin colisiones:
//   CF26F2-<USUARIO>-<DISPOSITIVO>-<CONSECUTIVO>
// USUARIO distingue a Eder y Héctor, DISPOSITIVO (aleatorio, 4 chars base32, fijado en la instalación)
// distingue teléfonos del mismo usuario y CONSECUTIVO es monotónico por dispositivo (persistido en IndexedDB).

const B32 = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // sin 0/O/1/I/L/U para lectura en voz alta

export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function randomCode(len = 4): string {
  const b = crypto.getRandomValues(new Uint8Array(len));
  return [...b].map((x) => B32[x % B32.length]).join('');
}

export const REF_PREFIX = 'CF26F2';
export function formatExternalRef(userId: string, deviceCode: string, seq: number): string {
  return `${REF_PREFIX}-${userId}-${deviceCode}-${String(seq).padStart(4, '0')}`;
}
export const EXTERNAL_REF_RE = /^CF26F2-[A-Z0-9]{2,6}-[A-Z0-9]{4}-\d{4,}$/;

/** Fecha local del dispositivo en formato YYYY-MM-DD. */
export function localDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
