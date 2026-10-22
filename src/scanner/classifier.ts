// Clasificador de orientación PP-LCNet_x1_0_doc_ori (PaddlePaddle, ONNX) con ONNX Runtime Web (WASM).
// Preprocesado oficial (inference.yml): lado corto 256, recorte central 224, normalización ImageNet, CHW.
import type { RGBAImage } from './imageops';
import { downscale } from './imageops';
import type { OrientationProbs } from './orientation';

type Ort = typeof import('onnxruntime-web');
let sessionP: Promise<{ ort: Ort; session: import('onnxruntime-web').InferenceSession }> | undefined;

export function preprocess(img: RGBAImage): Float32Array {
  const small = downscale(img, 512).img; // antialias antes del muestreo
  const s = 256 / Math.min(small.width, small.height);
  const W = Math.round(small.width * s), H = Math.round(small.height * s);
  const ox = Math.floor((W - 224) / 2), oy = Math.floor((H - 224) / 2);
  const out = new Float32Array(3 * 224 * 224);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  for (let y = 0; y < 224; y++) for (let x = 0; x < 224; x++) {
    const sx = Math.min(small.width - 1, Math.floor(((x + ox) / W) * small.width));
    const sy = Math.min(small.height - 1, Math.floor(((y + oy) / H) * small.height));
    const i = (sy * small.width + sx) * 4;
    for (let c = 0; c < 3; c++) out[c * 50176 + y * 224 + x] = (small.data[i + c] / 255 - mean[c]) / std[c];
  }
  return out;
}

export async function classifyOrientation(img: RGBAImage, base: string): Promise<OrientationProbs> {
  sessionP ??= (async () => {
    const ort = (await import('onnxruntime-web/wasm')) as unknown as Ort;
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.proxy = false;
    // el paquete onnxruntime-web/wasm ya incluye el código "glue"; solo se indica el binario auto-hospedado
    ort.env.wasm.wasmPaths = { wasm: `${base}ort/ort-wasm-simd-threaded.wasm` } as never;
    const session = await ort.InferenceSession.create(`${base}models/PP-LCNet_x1_0_doc_ori.onnx`, { executionProviders: ['wasm'] });
    return { ort, session };
  })().catch((e) => { sessionP = undefined; throw e; });
  const { ort, session } = await sessionP;
  const t = new ort.Tensor('float32', preprocess(img), [1, 3, 224, 224]);
  const out = await session.run({ [session.inputNames[0]]: t });
  const p = Array.from(out[session.outputNames[0]].data as Float32Array);
  return [p[0], p[1], p[2], p[3]];
}
