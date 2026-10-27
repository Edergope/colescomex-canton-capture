// MD5 incremental (RFC 1321) para verificar archivos contra el `md5Checksum` que Google Drive CALCULA sobre los bytes
// que almacena. WebCrypto no ofrece MD5. No se usa como protección criptográfica (MD5 no resiste ataques deliberados),
// sino para comprobar de forma independiente que Drive guardó exactamente los bytes de la foto del teléfono.

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export class Md5 {
  private h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  private buf = new Uint8Array(64);
  private bufLen = 0;
  private bytes = 0;
  private w = new Uint32Array(16);

  update(data: Uint8Array): this {
    this.bytes += data.length;
    let i = 0;
    if (this.bufLen) {
      const take = Math.min(64 - this.bufLen, data.length);
      this.buf.set(data.subarray(0, take), this.bufLen); this.bufLen += take; i = take;
      if (this.bufLen === 64) { this.block(this.buf, 0); this.bufLen = 0; }
    }
    for (; i + 64 <= data.length; i += 64) this.block(data, i);
    if (i < data.length) { this.buf.set(data.subarray(i), 0); this.bufLen = data.length - i; }
    return this;
  }

  /** Huella en hexadecimal (32 caracteres, minúsculas, como `md5Checksum` de Drive). */
  hex(): string {
    const bits = this.bytes * 8;
    const pad = new Uint8Array(((this.bufLen < 56 ? 56 : 120) - this.bufLen) + 8);
    pad[0] = 0x80;
    const dv = new DataView(pad.buffer);
    dv.setUint32(pad.length - 8, bits >>> 0, true);
    dv.setUint32(pad.length - 4, Math.floor(bits / 2 ** 32), true);
    const bytes = this.bytes; this.update(pad); this.bytes = bytes;
    return this.h.map((v) => [0, 8, 16, 24].map((s) => ((v >>> s) & 255).toString(16).padStart(2, '0')).join('')).join('');
  }

  private block(d: Uint8Array, o: number) {
    const w = this.w;
    for (let j = 0; j < 16; j++) w[j] = d[o + j * 4] | (d[o + j * 4 + 1] << 8) | (d[o + j * 4 + 2] << 16) | (d[o + j * 4 + 3] << 24);
    let [a, b, c, e] = this.h;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) { f = (b & c) | (~b & e); g = i; }
      else if (i < 32) { f = (e & b) | (~e & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ e; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~e); g = (7 * i) % 16; }
      const t = e; e = c; c = b;
      const x = (a + f + K[i] + w[g]) | 0;
      b = (b + ((x << S[i]) | (x >>> (32 - S[i])))) | 0;
      a = t;
    }
    this.h[0] = (this.h[0] + a) | 0; this.h[1] = (this.h[1] + b) | 0; this.h[2] = (this.h[2] + c) | 0; this.h[3] = (this.h[3] + e) | 0;
    this.h = this.h.map((v) => v >>> 0);
  }
}

/** MD5 de un Blob leído por bloques de 4 MiB (no carga fotos grandes enteras en memoria). */
export async function md5Blob(blob: Blob, chunk = 4 * 1024 * 1024): Promise<string> {
  const m = new Md5();
  for (let o = 0; o < blob.size; o += chunk) m.update(new Uint8Array(await blob.slice(o, o + chunk).arrayBuffer()));
  return m.hex();
}
