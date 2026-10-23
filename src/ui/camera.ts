// Cámara en la app: vista en vivo, disparo a resolución completa y pista de encuadre con el detector real.
// Si el navegador no ofrece cámara (permiso denegado, sin dispositivo), la pantalla usa la cámara del sistema.

export interface HintResult { status: 'ok' | 'low_confidence' | 'not_found'; multiple: boolean; confidence: number; quad?: { x: number; y: number }[] }

type ImageCaptureLike = { takePhoto(): Promise<Blob> };
declare const ImageCapture: { new (t: MediaStreamTrack): ImageCaptureLike } | undefined;

export class LiveCamera {
  stream?: MediaStream;
  private track?: MediaStreamTrack;
  private grabber?: ImageCaptureLike;
  torchOn = false;

  static supported(): boolean { return !!navigator.mediaDevices?.getUserMedia; }

  async start(video: HTMLVideoElement): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
    this.track = this.stream.getVideoTracks()[0];
    video.srcObject = this.stream;
    video.setAttribute('playsinline', ''); video.muted = true;
    await video.play().catch(() => undefined);
    try { if (typeof ImageCapture !== 'undefined' && this.track) this.grabber = new ImageCapture(this.track); } catch { /* sin ImageCapture */ }
  }

  get canTorch(): boolean {
    const caps = (this.track?.getCapabilities?.() ?? {}) as { torch?: boolean };
    return !!caps.torch;
  }
  async toggleTorch(): Promise<boolean> {
    if (!this.track || !this.canTorch) return false;
    this.torchOn = !this.torchOn;
    await this.track.applyConstraints({ advanced: [{ torch: this.torchOn } as MediaTrackConstraintSet] }).catch(() => { this.torchOn = false; });
    return this.torchOn;
  }

  /** Foto a máxima resolución (ImageCapture) o fotograma de la vista en vivo como alternativa. */
  async capture(video: HTMLVideoElement): Promise<Blob> {
    if (this.grabber) {
      try { const b = await this.grabber.takePhoto(); if (b.size > 0) return b; } catch { /* alternativa: fotograma */ }
    }
    const c = document.createElement('canvas');
    c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d')!.drawImage(video, 0, 0);
    return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo capturar la imagen'))), 'image/jpeg', 0.92));
  }

  stop() { this.stream?.getTracks().forEach((t) => t.stop()); this.stream = undefined; this.track = undefined; this.grabber = undefined; }
}

/** Cliente del Worker de pista (una instancia; los fotogramas se descartan si el anterior no ha terminado). */
export class HintDetector {
  private w?: Worker;
  private busy = false;
  private seq = 0;
  private pending = new Map<number, (r: HintResult) => void>();
  private canvas = document.createElement('canvas');

  private worker(): Worker {
    if (!this.w) {
      this.w = new Worker(new URL('./camera-hint.worker.ts', import.meta.url), { type: 'module', name: 'cx-camera-hint' });
      this.w.onmessage = (e) => { this.busy = false; this.pending.get(e.data.id)?.(e.data as HintResult); this.pending.delete(e.data.id); };
      this.w.onerror = () => { this.busy = false; };
    }
    return this.w;
  }

  private analyze(src: CanvasImageSource, sw: number, sh: number, maxSide: number): Promise<HintResult> | null {
    if (this.busy || !sw || !sh) return null;
    const s = Math.min(1, maxSide / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * s)), hh = Math.max(1, Math.round(sh * s));
    this.canvas.width = w; this.canvas.height = hh;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0, w, hh);
    const data = ctx.getImageData(0, 0, w, hh);
    const id = ++this.seq; this.busy = true;
    return new Promise((res) => {
      this.pending.set(id, res);
      this.worker().postMessage({ id, width: w, height: hh, buffer: data.data.buffer }, [data.data.buffer]);
    });
  }

  frame(video: HTMLVideoElement): Promise<HintResult> | null { return this.analyze(video, video.videoWidth, video.videoHeight, 480); }

  async photo(blob: Blob): Promise<HintResult | null> {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' } as ImageBitmapOptions);
      // espera a que el análisis en vivo termine para no descartar el de la foto
      for (let i = 0; i < 40 && this.busy; i++) await new Promise((r) => setTimeout(r, 25));
      const r = await this.analyze(bmp, bmp.width, bmp.height, 720);
      bmp.close();
      return r;
    } catch { return null; }
  }

  terminate() { this.w?.terminate(); this.w = undefined; this.busy = false; this.pending.clear(); }
}
