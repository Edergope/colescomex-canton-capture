import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { resolve } from 'node:path';

// Sin COOP/COEP a propósito: Google Identity Services necesita ventanas emergentes (popup) y
// el aislamiento de origen las rompe. El OCR corre en WASM SIMD de 1 hilo dentro de un Worker.
export default defineConfig({
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
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: {
        name: 'COLESCOMEX Canton Capture', short_name: 'CX Capture', lang: 'es',
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
        // Todo lo indispensable (incluidos modelos OCR y WASM) se precachea en la instalación.
        globPatterns: ['**/*.{js,mjs,css,html,png,svg,ico,webmanifest,wasm,tar}'],
        // Excluidos: Tesseract (motor alternativo, no por defecto) y el WASM JSEP/WebGPU de ORT que el
        // bundler emite para la ruta de hilo principal de Paddle (no se usa: el OCR corre en modo worker).
        globIgnores: ['**/tesseract/**', '**/*.jsep*.wasm'],
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
});
