import { defineConfig, devices } from '@playwright/test';

// E2E sobre la app COMPILADA (dist) con PaddleOCR real y sincronización mock.
export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  expect: { timeout: 120_000 },
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: { ...devices['Pixel 7'], baseURL: 'http://localhost:4174', trace: 'retain-on-failure', serviceWorkers: 'allow' },
  webServer: { command: 'npx vite preview --port 4174 --strictPort', port: 4174, reuseExistingServer: false, timeout: 60_000 },
});
