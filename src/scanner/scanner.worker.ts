/// <reference lib="webworker" />
// Worker del Smart Document Scanner: decodifica (aplicando EXIF), detecta la tarjeta, corrige la perspectiva,
// clasifica la orientación y renderiza candidatos girados para el OCR. Mantiene la imagen rectificada en
// memoria solo durante la sesión (se libera explícitamente). Nunca modifica la foto original.
import { detectDocument } from './detect';
import { rectifiedSize, warpPerspective, type Quad } from './homography';
import { downscale, rotate90, type RGBAImage } from './imageops';
import { classifyOrientation } from './classifier';
import { CROP_STATUSES, MAX_OUTPUT_SIDE, type ScanAnalysis, type ScanStatus } from './types';
import { DETECT_WORK_SIDE, FINE_SIDE } from './detect';

declare const self: DedicatedWorkerGlobalScope;
const sessions = new Map<number, RGBAImage>();
let base = '';

async function bitmapToImage(bmp: ImageBitmap): Promise<RGBAImage> {
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
  c.width = c.height = 1; // libera el lienzo de 12 MP de inmediato
  return { width: d.width, height: d.height, data: d.data };
}

async function encode(img: RGBAImage, quality: number): Promise<Blob> {
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data.buffer as ArrayBuffer, img.data.byteOffset, img.data.length), img.width, img.height), 0, 0);
  return c.convertToBlob({ type: 'image/jpeg', quality });
}

self.onmessage = async (e: MessageEvent) => {
  const { id, type } = e.data as { id: number; type: string };
  try {
    if (type === 'init') { base = e.data.base; self.postMessage({ id, ok: true }); return; }
    if (type === 'release') { sessions.delete(e.data.sid); self.postMessage({ id, ok: true }); return; }
    if (type === 'render') {
      const img = sessions.get(e.data.sid);
      if (!img) throw new Error('Sesión de escaneo inexistente');
      const small = downscale(img, e.data.maxSide ?? MAX_OUTPUT_SIDE).img;
      const blob = await encode(rotate90(small, e.data.rot), e.data.quality ?? 0.9);
      self.postMessage({ id, ok: true, blob });
      return;
    }
    if (type === 'scan') {
      const t0 = performance.now();
      const blob: Blob = e.data.blob;
      let bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); // EXIF aplicado
      const W = bmp.width, H = bmp.height;
      const cap = e.data.fullSide as number | undefined; // modo reducido: decodificación limitada (menos memoria)
      if (cap && Math.max(W, H) > cap) {
        const s = cap / Math.max(W, H);
        bmp.close();
        bmp = await createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: Math.round(W * s), resizeHeight: Math.round(H * s), resizeQuality: 'high' });
      }
      const full = await bitmapToImage(bmp);
      bmp.close();
      const k = W / full.width; // de coordenadas de trabajo a la foto original
      // pirámide desde la misma decodificación (una sola decodificación de la foto de 12 MP: menos memoria)
      const fine = downscale(full, FINE_SIDE).img;
      const work = downscale(fine, DETECT_WORK_SIDE).img;
      const tDecode = performance.now();
      let status: ScanStatus, quad: Quad | undefined, confidence = 1, method: string | undefined, multiple = false, reasons: string[] = [];
      if (e.data.manualQuad) { status = 'manual'; quad = (e.data.manualQuad as Quad).map((p) => ({ x: p.x / k, y: p.y / k })) as Quad; method = 'manual'; }
      else {
        const r = detectDocument(full, { work, fine }, e.data.detect ?? {});
        status = r.status; quad = r.quad; confidence = r.confidence; method = r.method; multiple = r.multiple; reasons = r.reasons;
      }
      const tDetect = performance.now();
      const cropped = CROP_STATUSES.includes(status) && !multiple && !!quad;
      let out: RGBAImage;
      const maxOut = (e.data.maxOutputSide as number | undefined) ?? MAX_OUTPUT_SIDE;
      if (cropped) { const sz = rectifiedSize(quad!, maxOut); out = warpPerspective(full, quad!, sz.width, sz.height); }
      else out = downscale(full, maxOut).img;
      const tWarp = performance.now();
      let probs: ScanAnalysis['orientationProbs'] = null;
      try { probs = await classifyOrientation(out, base); } catch (err) { reasons.push(`Clasificador de orientación no disponible: ${(err as Error).message}`); }
      const tEnd = performance.now();
      sessions.set(id, out);
      const analysis: ScanAnalysis = {
        status, confidence, quad: quad?.map((p) => ({ x: +(p.x * k).toFixed(1), y: +(p.y * k).toFixed(1) })) as Quad | undefined, method, multiple, reasons, orientationProbs: probs, cropped,
        source: { width: W, height: H }, output: { width: out.width, height: out.height },
        ms: { decode: Math.round(tDecode - t0), detect: Math.round(tDetect - tDecode), warp: Math.round(tWarp - tDetect), classify: Math.round(tEnd - tWarp), total: Math.round(tEnd - t0) },
      };
      self.postMessage({ id, ok: true, analysis });
      return;
    }
    throw new Error(`Mensaje desconocido: ${type}`);
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err as Error).message || String(err) });
  }
};
