import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve, join, normalize } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { privateDir } from './scripts/private-dir.mjs';

/** Solo en `vite dev`: sirve /@private/* desde el directorio privado de fixtures (evaluaciones locales). Nunca entra en el build. */
function privateFixtures(): Plugin {
  return {
    name: 'cx-private-fixtures', apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/@private/', (req, res, next) => {
        const base = privateDir() as string;
        const file = normalize(join(base, decodeURIComponent((req.url ?? '').split('?')[0])));
        if (!file.startsWith(base) || !existsSync(file)) { res.statusCode = 404; res.end('privado no disponible'); return; }
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(file));
        void next;
      });
    },
  };
}

// Sin COOP/COEP a propósito: Google Identity Services necesita ventanas emergentes (popup) y
// el aislamiento de origen las rompe. El OCR corre en WASM SIMD de 1 hilo dentro de un Worker.
export default defineConfig(({ mode }) => {
  const instance = (loadEnv(mode, process.cwd()).VITE_INSTANCE || 'production').toLowerCase();
  const preview = instance !== 'production';
  return {
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), lab: resolve(__dirname, 'ocr-lab.html') } },
  },
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@paddleocr/paddleocr-js', 'onnxruntime-web'],
    include: ['@paddleocr/paddleocr-js > clipper-lib', '@paddleocr/paddleocr-js > js-yaml', '@paddleocr/paddleocr-js > @techstark/opencv-js'],
  },
  server: { port: 5173, strictPort: true },
  plugins: [
    privateFixtures(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: preview ? `COLESCOMEX Canton Capture — VISTA PREVIA (${instance})` : 'COLESCOMEX Canton Capture', short_name: preview ? 'CX PREVIEW' : 'CX Capture', lang: 'es',
        id: preview ? `./?instance=${instance}` : './',
        description: 'Captura de proveedores — Feria de Cantón Fase 2, China 2026',
        start_url: './', scope: './', display: 'standalone', orientation: 'portrait',
        background_color: '#0f1b2d', theme_color: '#0f1b2d',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // Todo lo indispensable (incluidos modelos OCR y WASM) se precachea en la instalación.
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,ico,webmanifest,wasm,tar,onnx}'],
        // Excluidos: Tesseract (motor alternativo, no por defecto) y el WASM JSEP/WebGPU de ORT que el
        // bundler emite para la ruta de hilo principal de Paddle (no se usa: el OCR corre en modo worker).
        // También la copia de ORT que emite el bundler para los imports (se usa la auto-hospedada en ocr-assets/ort).
        globIgnores: ['**/tesseract/**', '**/*.jsep*.wasm', 'assets/ort-wasm-*.wasm'],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
};
});
