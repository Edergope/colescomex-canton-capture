// Guardián: el build que prueban los E2E no contiene NINGÚN identificador real (Drive, Sheets, OAuth) de los
// archivos .env* locales de la máquina, y usa autenticación y sincronización simuladas.
import { test, expect } from '@playwright/test';
import { assertHermetic, LOCAL_ENV_FILES } from './support/hermetic-env';

test('el build de pruebas es hermético: sin IDs reales y con Google simulado', () => {
  const r = assertHermetic('dist');
  test.info().annotations.push({ type: 'hermético', description: `${r.scanned} identificadores locales comprobados en ${LOCAL_ENV_FILES.join(', ') || '(sin .env locales)'}` });
  expect(r.leaked, 'identificadores reales presentes en el build de pruebas').toBe(0);
  expect(r.mockAuth).toBe(true);
  expect(r.mockSync).toBe(true);
});
