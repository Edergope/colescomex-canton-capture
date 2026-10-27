// MD5 propio (necesario para comparar con el md5Checksum que calcula Google Drive): vectores RFC 1321 y comparación
// con node:crypto en tamaños que cruzan los límites de bloque (55/56/63/64/65 bytes) y lectura por trozos.
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Md5, md5Blob } from '../src/sync/md5';

const enc = (s: string) => new TextEncoder().encode(s);
const node = (b: Uint8Array) => createHash('md5').update(b).digest('hex');
const bytes = (n: number, seed = 1) => { const b = new Uint8Array(n); let x = seed; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) >>> 0; b[i] = x >>> 24; } return b; };

describe('MD5', () => {
  it('vectores de la RFC 1321', () => {
    expect(new Md5().hex()).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(new Md5().update(enc('a')).hex()).toBe('0cc175b9c0f1b6a831c399e269772661');
    expect(new Md5().update(enc('abc')).hex()).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(new Md5().update(enc('message digest')).hex()).toBe('f96b697d7cb7938d525a2f31aaf161d0');
    expect(new Md5().update(enc('12345678901234567890123456789012345678901234567890123456789012345678901234567890')).hex()).toBe('57edf4a22be3c955ac49da2e2107b67a');
  });
  it('coincide con node:crypto en límites de bloque, entradas troceadas y Blobs grandes', async () => {
    for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 127, 128, 1000, 65_537]) {
      const b = bytes(n, n + 7);
      expect(new Md5().update(b).hex(), `n=${n}`).toBe(node(b));
      const m = new Md5(); for (let i = 0; i < n; i += 13) m.update(b.subarray(i, i + 13));
      expect(m.hex(), `troceado n=${n}`).toBe(node(b));
    }
    const big = bytes(6 * 1024 * 1024 + 321, 99);
    expect(await md5Blob(new Blob([big]), 1024 * 1024)).toBe(node(big));
  });
});
