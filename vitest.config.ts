import { defineConfig } from 'vitest/config';
// Unitarias herméticas: la instancia no depende del `.env.local` de cada máquina (la de producción es la referencia).
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 20000, env: { VITE_INSTANCE: 'production' } } });
